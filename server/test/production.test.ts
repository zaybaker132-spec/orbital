import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startMockAnthropic, type MockCall } from "./mockAnthropic.js";
import { AI_TOOLS, COMPUTERS, DEVICES, HEARD_FROM, NOTES_APPS, PERSONAS, REMEMBER, SCALE } from "../../shared/waitlist.js";

/**
 * Production-readiness regression tests: cross-workspace access (IDOR), security headers, CSRF and
 * cookies, per-account lockout, password reset by email, account deletion, waitlist consent /
 * confirmation / unsubscribe, AI usage and budget, health and admin-only operations, retention.
 * Email goes to a local stand-in for the Resend API; AI goes to the local Anthropic mock. No network.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-prod-test-"));
let server: Server;
let base = "";
let mock: { url: string; calls: MockCall[]; close: () => void };
const emails: any[] = [];
let resend: http.Server;
let resendFails = false;

class Client {
  cookie = "";
  workspace = "";
  // Each client looks like a different visitor (the test server trusts its loopback proxy), so per-IP
  // rate limits apply per client the way they would in production.
  ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  constructor(public csrf = true) {}
  async req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { "content-type": "application/json", cookie: this.cookie, "x-forwarded-for": this.ip, ...extra };
    if (this.csrf) headers["x-orbital-request"] = "1";
    if (this.workspace) headers["x-orbital-workspace"] = this.workspace;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* html or empty */ }
    return { status: res.status, data, text, headers: res.headers, setCookie: set };
  }
}

const linkIn = (mail: any) => String(mail.text ?? mail.html).match(/https?:\/\/[^\s"<]+/)![0].replace(/&amp;/g, "&");

before(async () => {
  resend = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (resendFails) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"message":"down"}'); return; }
      emails.push({ ...JSON.parse(raw), auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `email_${emails.length}` }));
    });
  });
  await new Promise<void>((r) => resend.listen(0, "127.0.0.1", () => r()));
  const ra = resend.address();
  mock = await startMockAnthropic();
  Object.assign(process.env, {
    ORBITAL_DATA_DIR: dir, DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_ALLOW_SIGNUP: "true",
    ORBITAL_ADMIN_EMAILS: "root@orbital.test", ORBITAL_PUBLIC_URL: "http://localhost:5173",
    RESEND_API_KEY: "re_test_not_real", RESEND_API_URL: `http://127.0.0.1:${typeof ra === "object" && ra ? ra.port : 0}`, ORBITAL_EMAIL_FROM: "Orbital <hello@orbital.test>",
    AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: mock.url, ORBITAL_AI_MONTHLY_TOKENS: "1000",
    RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", RESEARCH_WEB_SEARCH: "false",
  });
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(async () => {
  server?.close();
  resend?.close();
  mock?.close();
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function signup(email: string) {
  const c = new Client();
  const r = await c.req("POST", "/api/auth/signup", { email, password: "long enough password" });
  assert.equal(r.status, 201, r.text);
  return c;
}

test("health: liveness and readiness (database ping), request ids, secure headers", async () => {
  const c = new Client();
  const live = await c.req("GET", "/api/health");
  assert.equal(live.status, 200);
  const ready = await c.req("GET", "/api/health/ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.data.ok, true);
  assert.ok(ready.data.db.ms >= 0);
  assert.match(live.headers.get("x-request-id") ?? "", /^[\w-]{8,}$/, "every response carries a request id");
  const echoed = await c.req("GET", "/api/health", undefined, { "x-request-id": "trace-abc-123" });
  assert.equal(echoed.headers.get("x-request-id"), "trace-abc-123", "a caller's request id is kept for tracing");
  const injected = await c.req("GET", "/api/health", undefined, { "x-request-id": "bad id\twith junk" });
  assert.notEqual(injected.headers.get("x-request-id"), "bad id\twith junk", "malformed ids are replaced");
  assert.equal(live.headers.get("x-content-type-options"), "nosniff");
  assert.match(live.headers.get("content-security-policy") ?? "", /default-src 'none'/, "API responses can't run anything");
  assert.match(live.headers.get("cache-control") ?? "", /no-store/, "API responses are not cached");
  assert.equal(live.headers.get("x-powered-by"), null, "no framework fingerprint");
  assert.ok(live.headers.get("referrer-policy"));
});

test("https: forced https redirects reads, refuses writes, and sends HSTS", async () => {
  const { config } = await import("../config.js");
  const was = config.forceHttps;
  (config as any).forceHttps = true;
  try {
    const c = new Client();
    const r = await c.req("GET", "/api/auth/me");
    assert.equal(r.status, 308);
    assert.equal((await c.req("GET", "/api/health")).status, 200, "health checks stay on http for the platform's probe");
    assert.match(r.headers.get("location") ?? "", /^https:\/\//);
    assert.equal((await c.req("POST", "/api/auth/login", { email: "a@b.co", password: "x" })).status, 403, "writes over http are refused, not redirected");
    const secure = await c.req("GET", "/api/auth/me", undefined, { "x-forwarded-proto": "https" });
    assert.equal(secure.status, 200, "behind a proxy that terminated TLS (trust proxy: loopback)");
    assert.match(secure.headers.get("strict-transport-security") ?? "", /max-age=\d{7,}/);
  } finally { (config as any).forceHttps = was; }
});

test("csrf and cookies: state changes need the Orbital header; session cookie is HttpOnly + SameSite", async () => {
  const noHeader = new Client(false);
  const r = await noHeader.req("POST", "/api/auth/signup", { email: "csrf@orbital.test", password: "long enough password" });
  assert.equal(r.status, 403, "a cross-site form post can't create sessions");
  const c = new Client();
  const s = await c.req("POST", "/api/auth/signup", { email: "cookie@orbital.test", password: "long enough password" });
  assert.equal(s.status, 201);
  assert.match(s.setCookie ?? "", /HttpOnly/i);
  assert.match(s.setCookie ?? "", /SameSite=Lax|SameSite=Strict/i);
  const forged = new Client(false);
  forged.cookie = c.cookie;
  assert.equal((await forged.req("POST", "/api/projects", { name: "forged" })).status, 403, "a stolen-ride request with the cookie but no header is refused");
  assert.equal((await c.req("POST", "/api/projects", { name: "mine" })).status, 201);
  const bad = await c.req("POST", "/api/projects", undefined, { "content-type": "application/json" });
  assert.ok([400, 201].includes(bad.status));
  const res = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json", "x-orbital-request": "1", cookie: c.cookie }, body: "{not json" });
  assert.equal(res.status, 400, "invalid JSON is a 400, not a 500");
  const err = await res.json();
  assert.ok(!JSON.stringify(err).includes("at "), "no stack traces leak");
});

test("IDOR: nothing in one workspace can be read, changed, linked or deleted from another", async () => {
  const alice = await signup("alice@orbital.test");
  const mallory = await signup("mallory@orbital.test");
  const folder = (await alice.req("POST", "/api/folders", { name: "Private" })).data;
  const doc = (await alice.req("POST", "/api/documents", { title: "Secret plan", body: "The launch is on the 14th.", folderId: folder.id })).data;
  const project = (await alice.req("POST", "/api/projects", { name: "Stealth" })).data;
  const milestone = (await alice.req("POST", `/api/projects/${project.id}/milestones`, { title: "Beta" })).data;
  const memory = (await alice.req("POST", "/api/memories", { content: "Alice prefers morning meetings", category: "preference" })).data;
  const paper = (await alice.req("POST", "/api/docs", { title: "Board memo" })).data;
  const conv = (await alice.req("POST", "/api/conversations", {})).data;
  for (const [what, v] of Object.entries({ folder, doc, project, milestone, memory, paper, conv })) assert.ok(v?.id, `${what} created`);

  const denied = (s: number) => [403, 404].includes(s);
  const deniedOrNoop = (m: string, s: number) => denied(s) || (m === "DELETE" && s === 200);
  const probes: [string, string, unknown?][] = [
    ["GET", `/api/documents/${doc.id}`], ["PATCH", `/api/documents/${doc.id}`, { title: "pwned" }], ["DELETE", `/api/documents/${doc.id}`],
    ["GET", `/api/projects/${project.id}`], ["PATCH", `/api/projects/${project.id}`, { name: "pwned" }], ["DELETE", `/api/projects/${project.id}`],
    ["POST", `/api/projects/${project.id}/tasks`, { title: "pwned" }], ["POST", `/api/projects/${project.id}/milestones`, { title: "pwned" }],
    ["PATCH", `/api/milestones/${milestone.id}`, { title: "pwned" }], ["DELETE", `/api/milestones/${milestone.id}`],
    ["PATCH", `/api/folders/${folder.id}`, { name: "pwned" }], ["DELETE", `/api/folders/${folder.id}`],
    ["PATCH", `/api/memories/${memory.id}`, { content: "pwned" }], ["DELETE", `/api/memories/${memory.id}`],
    ["GET", `/api/docs/${paper.id}`], ["PATCH", `/api/docs/${paper.id}`, { title: "pwned" }], ["DELETE", `/api/docs/${paper.id}`], ["GET", `/api/docs/${paper.id}/versions`],
    ["POST", `/api/docs/${paper.id}/copy`, {}],
    ["GET", `/api/conversations/${conv.id}`], ["DELETE", `/api/conversations/${conv.id}`],
  ];
  for (const [m, url, body] of probes) {
    const r = await mallory.req(m, url, body);
    assert.ok(deniedOrNoop(m, r.status), `${m} ${url} from another workspace gave ${r.status}`);
  }
  // Mallory's own records can't point at Alice's folder or milestone either.
  assert.ok(denied((await mallory.req("POST", "/api/documents", { title: "x", folderId: folder.id })).status), "document into a foreign folder");
  assert.ok(denied((await mallory.req("POST", "/api/docs", { title: "x", folderId: folder.id })).status), "paper into a foreign folder");
  assert.ok(denied((await mallory.req("POST", "/api/folders", { name: "x", parentId: folder.id })).status), "folder under a foreign folder");
  const own = (await mallory.req("POST", "/api/projects", { name: "Mine" })).data;
  assert.ok(denied((await mallory.req("POST", `/api/projects/${own.id}/tasks`, { title: "x", milestoneId: milestone.id })).status), "task on a foreign milestone");
  // Asking for Alice's workspace explicitly doesn't help.
  const aliceWs = (await alice.req("GET", "/api/auth/me")).data.workspaces?.[0]?.id ?? (await alice.req("GET", "/api/workspaces")).data?.[0]?.id;
  if (aliceWs) {
    mallory.workspace = aliceWs;
    assert.ok(denied((await mallory.req("GET", "/api/documents")).status), "selecting a workspace you're not in is refused");
    mallory.workspace = "";
  }
  // Deletes are idempotent (200 when there is nothing of yours to delete), so prove nothing was touched.
  assert.ok((await alice.req("GET", "/api/memories")).text.includes(memory.id), "memory intact");
  assert.equal((await alice.req("GET", `/api/conversations/${conv.id}`)).status, 200);
  const proj = (await alice.req("GET", `/api/projects/${project.id}`)).data;
  assert.ok(JSON.stringify(proj).includes(milestone.id), "milestone intact");
  assert.ok((await alice.req("GET", "/api/folders")).text.includes(folder.id), "folder intact");
  // Everything is still intact for Alice.
  assert.equal((await alice.req("GET", `/api/documents/${doc.id}`)).data.title, "Secret plan");
  assert.equal((await alice.req("GET", `/api/docs/${paper.id}`)).status, 200);
  assert.equal((await alice.req("GET", `/api/projects/${project.id}`)).data.name, "Stealth");
});

test("lockout: repeated wrong passwords throttle the account, whatever the IP", async () => {
  await signup("target@orbital.test");
  const attacker = new Client();
  for (let i = 0; i < 8; i++, attacker.ip = `198.51.100.${i + 1}`) assert.equal((await attacker.req("POST", "/api/auth/login", { email: "target@orbital.test", password: `guess-number-${i}` })).status, 401);
  const locked = await attacker.req("POST", "/api/auth/login", { email: "Target@Orbital.test", password: "long enough password" });
  assert.equal(locked.status, 429, "even the right password waits once the account is throttled");
  assert.equal(locked.data.code, "account_throttled");
  const { db } = await import("../db/client.js");
  const ev = (await db().query<any>("SELECT event, email_hash, ip_hash FROM auth_events WHERE event='login_failed' LIMIT 1")).rows[0];
  assert.match(ev.email_hash, /^[0-9a-f]{64}$/, "events store a hash, not the address");
  assert.doesNotMatch(JSON.stringify(ev), /target@|127\.0\.0\.1/);
});

test("password reset: email link, one use, signs out everywhere, no account discovery", async () => {
  const owner = await signup("forgetful@orbital.test");
  const other = new Client();
  assert.equal((await other.req("POST", "/api/auth/login", { email: "forgetful@orbital.test", password: "long enough password" })).status, 200);
  const anon = new Client();
  const before = emails.length;
  const unknown = await anon.req("POST", "/api/auth/password/forgot", { email: "nobody@orbital.test" });
  assert.equal(unknown.status, 200);
  assert.equal(emails.length, before, "no email for addresses without an account");
  const known = await anon.req("POST", "/api/auth/password/forgot", { email: "Forgetful@orbital.test" });
  assert.equal(known.status, 200);
  assert.equal(known.data.message, unknown.data.message, "same answer either way");
  const mail = emails.at(-1);
  assert.deepEqual(mail.to, ["forgetful@orbital.test"]);
  assert.equal(mail.auth, "Bearer re_test_not_real");
  const link = linkIn(mail);
  assert.match(link, /^http:\/\/localhost:5173\/reset-password\?token=/, "links use ORBITAL_PUBLIC_URL, never the Host header");
  const token = new URL(link).searchParams.get("token")!;
  assert.equal((await anon.req("POST", "/api/auth/password/reset", { token, password: "short" })).status, 400);
  const reset = await anon.req("POST", "/api/auth/password/reset", { token, password: "a brand new passphrase" });
  assert.equal(reset.status, 200);
  assert.equal((await anon.req("GET", "/api/auth/me")).data.user?.email, "forgetful@orbital.test", "signed in with the new password");
  assert.equal((await anon.req("POST", "/api/auth/password/reset", { token, password: "another new passphrase" })).status, 400, "links work once");
  assert.ok(!(await owner.req("GET", "/api/auth/me")).data.user, "old sessions were signed out");
  assert.ok(!(await other.req("GET", "/api/auth/me")).data.user);
  assert.equal((await new Client().req("POST", "/api/auth/login", { email: "forgetful@orbital.test", password: "long enough password" })).status, 401);
  const { db } = await import("../db/client.js");
  const stored = (await db().query<any>("SELECT token_hash FROM password_resets")).rows.map((r: any) => r.token_hash);
  assert.ok(!stored.includes(token), "only hashes of reset tokens are stored");
  // A failed send is reported, not claimed as sent.
  resendFails = true;
  try {
    const failed = await anon.req("POST", "/api/auth/password/forgot", { email: "forgetful@orbital.test" });
    assert.equal(failed.status, 502);
  } finally { resendFails = false; }
  const log = (await db().query<any>("SELECT status, to_hash FROM email_log WHERE kind='password_reset' ORDER BY created_at")).rows;
  assert.deepEqual(log.map((l: any) => l.status), ["sent", "failed"]);
  assert.doesNotMatch(JSON.stringify(log), /forgetful@/, "recipients are stored hashed");
});

test("account deletion needs the password and the word DELETE, and removes the data", async () => {
  const c = await signup("leaving@orbital.test");
  const doc = (await c.req("POST", "/api/documents", { title: "Mine", body: "something" })).data;
  assert.equal((await c.req("POST", "/api/account/delete", { confirm: "DELETE" })).status, 400);
  assert.equal((await c.req("POST", "/api/account/delete", { confirm: "yes", password: "long enough password" })).status, 400);
  assert.equal((await c.req("POST", "/api/account/delete", { confirm: "DELETE", password: "wrong password!!" })).status, 401);
  assert.equal((await c.req("GET", `/api/documents/${doc.id}`)).status, 200, "nothing removed by refused attempts");
  assert.equal((await c.req("POST", "/api/account/delete", { confirm: "DELETE", password: "long enough password" })).status, 200);
  assert.ok(!(await c.req("GET", "/api/auth/me")).data.user);
  const { db } = await import("../db/client.js");
  assert.equal((await db().query("SELECT 1 FROM users WHERE email='leaving@orbital.test'")).rows.length, 0);
  assert.equal((await db().query("SELECT 1 FROM documents WHERE id=$1", [doc.id])).rows.length, 0);
  assert.equal((await new Client().req("POST", "/api/auth/login", { email: "leaving@orbital.test", password: "long enough password" })).status, 401);
});

test("waitlist: consent required, confirmation email, one-click unsubscribe, honest admit notification", async () => {
  const anon = new Client();
  const entry = { email: "  Waiter@Example.test ", persona: PERSONAS[0], remember: [REMEMBER[0]], scale: SCALE[0], aiTools: [AI_TOOLS[0]], notesApps: [NOTES_APPS[0]], computers: [COMPUTERS[0]], devices: [DEVICES[0]], heardFrom: HEARD_FROM[0] };
  assert.equal((await anon.req("POST", "/api/public/waitlist", entry)).status, 400, "no consent, no entry");
  assert.equal((await anon.req("POST", "/api/public/waitlist", { ...entry, consent: false })).status, 400);
  const before = emails.length;
  const j = await anon.req("POST", "/api/public/waitlist", { ...entry, consent: true });
  assert.equal(j.status, 201);
  assert.equal(j.data.confirmation, "sent");
  assert.equal(emails.length, before + 1);
  const mail = emails.at(-1);
  assert.deepEqual(mail.to, ["waiter@example.test"], "addresses are normalized");
  assert.match(mail.headers?.["List-Unsubscribe"] ?? "", /unsubscribe\?token=/);
  assert.equal(mail.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const { db } = await import("../db/client.js");
  const row = (await db().query<any>("SELECT * FROM waitlist WHERE email='waiter@example.test'")).rows[0];
  assert.ok(row.consent_at && row.consent_text.length > 20, "the consent and its wording are recorded");
  assert.equal(row.confirmed_at, null);
  const confirm = await anon.req("GET", `/api/public/waitlist/confirm?token=${row.token}`);
  assert.equal(confirm.status, 200);
  assert.match(confirm.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal((await anon.req("GET", "/api/public/waitlist/confirm?token=not-a-real-token-at-all")).status, 404);
  assert.ok((await db().query<any>("SELECT confirmed_at FROM waitlist WHERE id=$1", [row.id])).rows[0].confirmed_at);
  // Re-joining after confirming doesn't overwrite answers or reset the address check.
  await anon.req("POST", "/api/public/waitlist", { ...entry, persona: PERSONAS[1], consent: true });
  const after = (await db().query<any>("SELECT persona, confirmed_at FROM waitlist WHERE id=$1", [row.id])).rows[0];
  assert.equal(after.persona, PERSONAS[0]);
  assert.ok(after.confirmed_at);
  // One-click unsubscribe (RFC 8058): a POST from the mail client, no cookies or CSRF header.
  const oneClick = await fetch(`${base}/api/public/waitlist/unsubscribe?token=${row.token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(oneClick.status, 200);
  assert.ok((await db().query<any>("SELECT unsubscribed_at FROM waitlist WHERE id=$1", [row.id])).rows[0].unsubscribed_at);
  // Admitting someone who unsubscribed: no email, and the admin is told so.
  const root = await signup("root@orbital.test");
  const sent = emails.length;
  const admit = await root.req("POST", `/api/admin/waitlist/${row.id}/admit`, {});
  assert.equal(admit.status, 200);
  assert.equal(admit.data.notification, "unsubscribed");
  assert.equal(emails.length, sent);
  // Someone still subscribed gets a real "you're in" email.
  const j2 = await anon.req("POST", "/api/public/waitlist", { ...entry, email: "second@example.test", consent: true });
  assert.equal(j2.status, 201);
  const id2 = (await db().query<any>("SELECT id FROM waitlist WHERE email='second@example.test'")).rows[0].id;
  const admit2 = await root.req("POST", `/api/admin/waitlist/${id2}/admit`, {});
  assert.equal(admit2.data.notification, "sent");
  assert.deepEqual(emails.at(-1).to, ["second@example.test"]);
  assert.equal((await root.req("POST", "/api/admin/waitlist/not-a-uuid/admit", {})).status, 400);
  const list = await root.req("GET", "/api/admin/waitlist");
  const r1 = list.data.rows.find((r: any) => r.email === "waiter@example.test");
  assert.ok(r1.unsubscribed_at && r1.confirmed_at && r1.consent_at);
  assert.equal(r1.token, undefined, "unsubscribe tokens are never sent to the admin UI");
});

test("waitlist: a server without email says so instead of pretending", async () => {
  const { config } = await import("../config.js");
  const key = config.email.resendApiKey;
  (config.email as any).resendApiKey = "";
  try {
    const r = await new Client().req("POST", "/api/public/waitlist", { email: "noemail@example.test", persona: PERSONAS[0], remember: [REMEMBER[0]], scale: SCALE[0], aiTools: [AI_TOOLS[0]], notesApps: [NOTES_APPS[0]], computers: [COMPUTERS[0]], devices: [DEVICES[0]], heardFrom: HEARD_FROM[0], consent: true });
    assert.equal(r.status, 201);
    assert.equal(r.data.confirmation, "not_configured");
    const f = await new Client().req("POST", "/api/auth/password/forgot", { email: "alice@orbital.test" });
    assert.equal(f.status, 503);
    assert.equal(f.data.code, "email_unavailable");
  } finally { (config.email as any).resendApiKey = key; }
});

test("AI: every call is metered (tokens, cost) and the monthly allowance is enforced", async () => {
  const c = await signup("ai-user@orbital.test");
  const conv = (await c.req("POST", "/api/conversations", {})).data;
  const r = await c.req("POST", `/api/conversations/${conv.id}/messages`, { content: "Plan my week around the product launch." });
  assert.equal(r.status, 200);
  const { db } = await import("../db/client.js");
  for (let i = 0; i < 50; i++) { if ((await db().query("SELECT 1 FROM ai_usage")).rows.length) break; await new Promise((s) => setTimeout(s, 100)); }
  const usage = await c.req("GET", "/api/workspace/ai-usage");
  assert.equal(usage.status, 200);
  assert.ok(usage.data.requests >= 1, "requests are recorded");
  assert.ok(usage.data.tokens.input + usage.data.tokens.output >= 20, "token counts come from the provider's usage report");
  assert.ok(usage.data.costUsd > 0, "an estimated cost is attached");
  assert.equal(usage.data.cap, 1000);
  assert.ok(usage.data.byFeature.length >= 1);
  // Push the workspace over its allowance; the next AI call is refused before reaching the provider.
  const ws = (await db().query<any>("SELECT workspace_id FROM ai_usage WHERE workspace_id IS NOT NULL LIMIT 1")).rows[0].workspace_id;
  await db().query("INSERT INTO ai_usage(workspace_id, provider, model, input_tokens, output_tokens) VALUES ($1,'anthropic','x',5000,0)", [ws]);
  const callsBefore = mock.calls.length;
  const over = await c.req("POST", `/api/conversations/${conv.id}/messages`, { content: "And next week?" });
  assert.match(over.text, /AI allowance/, "the person is told why");
  assert.equal(mock.calls.length, callsBefore, "no provider call once the allowance is used");
  // Only workspace admins and server admins see costs.
  assert.equal((await c.req("GET", "/api/admin/ai-usage")).status, 403);
});

test("ops: admin-only status, failed jobs with retry, retention", async () => {
  const user = await signup("plain@orbital.test");
  for (const [m, url] of [["GET", "/api/admin/status"], ["GET", "/api/admin/jobs/failed"], ["POST", "/api/admin/housekeeping"], ["GET", "/api/admin/ai-usage"]] as const) {
    assert.equal((await user.req(m, url, m === "POST" ? {} : undefined)).status, 403, `${url} is for server admins`);
    assert.equal((await new Client().req(m, url, m === "POST" ? {} : undefined)).status, 401);
  }
  const root = new Client();
  assert.equal((await root.req("POST", "/api/auth/login", { email: "root@orbital.test", password: "long enough password" })).status, 200);
  const st = await root.req("GET", "/api/admin/status");
  assert.equal(st.status, 200);
  assert.equal(st.data.email.configured, true);
  assert.ok(st.data.database.pingMs >= 0);
  assert.doesNotMatch(st.text, /re_test_not_real|test-key-not-real/, "no secrets in status");
  const { db } = await import("../db/client.js");
  const ws = (await db().query<any>("SELECT id FROM workspaces LIMIT 1")).rows[0].id;
  const job = (await db().query<any>("INSERT INTO jobs(workspace_id, type, payload, status, attempts, error) VALUES ($1,'noop','{\"secret\":\"payload\"}','failed',3,'boom') RETURNING id", [ws])).rows[0];
  const failed = await root.req("GET", "/api/admin/jobs/failed");
  const listed = failed.data.find((j: any) => j.id === job.id);
  assert.ok(listed);
  assert.equal(listed.payload, undefined, "job payloads (user content) stay out of the admin list");
  assert.equal((await root.req("POST", `/api/admin/jobs/${job.id}/retry`, {})).status, 200);
  assert.equal((await db().query<any>("SELECT status, attempts FROM jobs WHERE id=$1", [job.id])).rows[0].attempts, 0);
  assert.equal((await root.req("POST", `/api/admin/jobs/${job.id}/retry`, {})).status, 404, "only failed jobs can be retried");
  await db().query("UPDATE jobs SET status='done' WHERE id=$1", [job.id]);
  // Retention removes expired operational records and never user content.
  await db().query("INSERT INTO email_log(kind, to_hash, status, created_at) VALUES ('test','x','sent', now() - interval '200 days')");
  await db().query("UPDATE jobs SET updated_at = now() - interval '20 days' WHERE id=$1", [job.id]);
  const docsBefore = (await db().query<any>("SELECT count(*)::int AS n FROM documents")).rows[0].n;
  const hk = await root.req("POST", "/api/admin/housekeeping", {});
  assert.equal(hk.status, 200);
  assert.ok(hk.data.removed.email_log >= 1);
  assert.ok(hk.data.removed["jobs (done)"] >= 1);
  assert.equal((await db().query<any>("SELECT count(*)::int AS n FROM documents")).rows[0].n, docsBefore);
});

test("jobs: a failing job waits before retrying (backoff) and fails for good after its attempts", async () => {
  const { db } = await import("../db/client.js");
  const { registerJob, enqueue } = await import("../lib/jobs.js");
  let runs = 0;
  registerJob("test-always-fails", async () => { runs++; throw new Error("still broken"); });
  const ws = (await db().query<any>("SELECT id FROM workspaces LIMIT 1")).rows[0].id;
  const id = await enqueue(ws, "test-always-fails", {});
  for (let i = 0; i < 60 && runs < 1; i++) await new Promise((s) => setTimeout(s, 100));
  assert.equal(runs, 1);
  const j = (await db().query<any>("SELECT status, attempts, run_after, error FROM jobs WHERE id=$1", [id])).rows[0];
  assert.equal(j.status, "queued", "requeued after the first failure");
  assert.ok(new Date(j.run_after).getTime() > Date.now() + 20_000, "and told to wait before running again");
  assert.match(j.error, /still broken/);
  await new Promise((s) => setTimeout(s, 1500));
  assert.equal(runs, 1, "not retried immediately");
});

test("logs: secrets are scrubbed by key name and by value", async () => {
  const { redact } = await import("../lib/log.js");
  assert.equal(redact("401 for key sk-ant-api03-abcdefghijklmnop"), "401 for key [redacted]");
  assert.equal(redact("postgres://u.proj:hunter2pass@pooler.supabase.com:5432/db"), "postgres://u.proj:[redacted]@pooler.supabase.com:5432/db");
  assert.equal(redact("Authorization: Bearer abc.def"), "Authorization: Bearer [redacted]");
  assert.equal(redact("key re_ABCDEFGHIJKLMNOPQRST"), "key [redacted]");
  assert.equal(redact("sb_secret_XYZ123abc"), "[redacted]");
  assert.equal(redact("an ordinary session message"), "an ordinary session message");
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const { log } = await import("../lib/log.js");
  const { config } = await import("../config.js");
  const fmt = config.logFormat;
  (config as any).logFormat = "json";
  (process.stdout as any).write = (s: string) => { lines.push(String(s)); return true; };
  (process.stderr as any).write = (s: string) => { lines.push(String(s)); return true; };
  try {
    log.warn("upstream refused", { password: "hunter2", headers: { authorization: "Bearer zzz", cookie: "orbital_session=abc" }, err: new Error("bad key sk-ant-api03-abcdefghijklmnop") });
  } finally { (process.stdout as any).write = orig; (process.stderr as any).write = origErr; (config as any).logFormat = fmt; }
  const out = lines.join("");
  assert.match(out, /"msg":"upstream refused"/);
  assert.doesNotMatch(out, /hunter2|zzz|orbital_session=abc|abcdefghijklmnop/);
});

test("jobs: only jobs whose heartbeat stopped are taken over (safe with several instances)", async () => {
  const { db } = await import("../db/client.js");
  const { requeueStale } = await import("../lib/jobs.js");
  const ws = (await db().query<any>("SELECT id FROM workspaces LIMIT 1")).rows[0].id;
  const alive = (await db().query<any>("INSERT INTO jobs(workspace_id, type, payload, status, updated_at) VALUES ($1,'test-elsewhere','{}','running', now()) RETURNING id", [ws])).rows[0].id;
  const dead = (await db().query<any>("INSERT INTO jobs(workspace_id, type, payload, status, updated_at) VALUES ($1,'test-elsewhere','{}','running', now() - interval '10 minutes') RETURNING id", [ws])).rows[0].id;
  await requeueStale();
  const st = async (id: string) => (await db().query<any>("SELECT status FROM jobs WHERE id=$1", [id])).rows[0].status;
  assert.equal(await st(alive), "running", "a job another instance is still running is left alone");
  assert.notEqual(await st(dead), "running", "a job from a dead process is queued again");
  await db().query("DELETE FROM jobs WHERE id = ANY($1)", [[alive, dead]]);
});
