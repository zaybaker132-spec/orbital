import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http, { type Server } from "node:http";
import crypto from "node:crypto";
import { startMockAnthropic } from "./test/mockAnthropic.js";

// Business layer: workspaces, roles, invites, private conversations, API tokens, connectors, automations, approvals, audit.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-biz-test-"));
let server: Server, hook: Server, mock: Awaited<ReturnType<typeof startMockAnthropic>>;
let base = "", hookUrl = "";
const received: { body: any; sig: string | undefined }[] = [];

class Client {
  cookie = "";
  workspace = "";
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", "x-orbital-request": "1", cookie: this.cookie, ...(this.workspace ? { "x-orbital-workspace": this.workspace } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* sse */ }
    return { status: res.status, data, text };
  }
}
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 10000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 150));
  }
}

const owner = new Client(), member = new Client(), viewer = new Client(), outsider = new Client();
let bizId = "";

before(async () => {
  mock = await startMockAnthropic();
  hook = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => { received.push({ body: JSON.parse(raw), sig: req.headers["x-orbital-signature"] as string | undefined }); res.end("ok"); });
  });
  await new Promise<void>((r) => hook.listen(0, () => r()));
  const ha = hook.address();
  hookUrl = `http://127.0.0.1:${typeof ha === "object" && ha ? ha.port : 0}/hook`;
  Object.assign(process.env, {
    ORBITAL_DATA_DIR: dir, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: mock.url,
    RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", DATABASE_URL: "", ORBITAL_ALLOW_PRIVATE_WEBHOOKS: "true",
    ORBITAL_SECRET_KEY: "a-test-secret-key-that-is-long-enough-123",
  });
  const { createApp } = await import("./index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const [c, email] of [[owner, "owner@acme.test"], [member, "member@acme.test"], [viewer, "viewer@acme.test"], [outsider, "outsider@else.test"]] as const) {
    assert.equal((await c.req("POST", "/api/auth/signup", { email, password: "long enough password" })).status, 201);
  }
});

after(async () => {
  server?.close(); hook?.close(); mock?.close();
  const { db } = await import("./db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("workspaces: create, invite by link, email-bound acceptance, roles", async () => {
  const w = await owner.req("POST", "/api/workspaces", { name: "Acme Salons" });
  assert.equal(w.status, 201);
  bizId = w.data.id;
  owner.workspace = bizId;
  const me = await owner.req("GET", "/api/auth/me");
  assert.deepEqual(me.data.workspaces.map((x: any) => x.kind), ["personal", "business"]);

  const inviteM = await owner.req("POST", "/api/workspace/invites", { email: "member@acme.test", role: "member" });
  const inviteV = await owner.req("POST", "/api/workspace/invites", { email: "viewer@acme.test", role: "viewer" });
  const tokM = inviteM.data.link.split("/invite/")[1], tokV = inviteV.data.link.split("/invite/")[1];
  assert.equal((await outsider.req("POST", "/api/invites/accept", { token: tokM })).status, 403, "invite is bound to its email");
  assert.equal((await member.req("POST", "/api/invites/accept", { token: tokM })).data.role, "member");
  assert.equal((await member.req("POST", "/api/invites/accept", { token: tokM })).status, 404, "single use");
  await viewer.req("POST", "/api/invites/accept", { token: tokV });
  member.workspace = bizId; viewer.workspace = bizId;
  outsider.workspace = bizId;
  assert.equal((await outsider.req("GET", "/api/documents")).status, 404, "non-members can't open the workspace");
  outsider.workspace = "";

  const members = await owner.req("GET", "/api/workspace/members");
  assert.equal(members.data.length, 3);
  const memberId = members.data.find((m: any) => m.email === "member@acme.test").id;
  assert.equal((await member.req("PATCH", `/api/workspace/members/${memberId}`, { role: "admin" })).status, 403, "members can't promote themselves");
  const ownerId = members.data.find((m: any) => m.role === "owner").id;
  assert.equal((await owner.req("PATCH", `/api/workspace/members/${ownerId}`, { role: "admin" })).status, 400, "the last owner can't be demoted");
});

test("shared knowledge, private conversations, viewer is read-only, personal space stays separate", async () => {
  const d = await member.req("POST", "/api/documents", { title: "Pricing policy", body: "Standard plan is 49 per month per location." });
  assert.equal(d.status, 201);
  assert.equal((await owner.req("GET", `/api/documents/${d.data.id}`)).status, 200, "knowledge is shared");
  assert.equal((await viewer.req("GET", `/api/documents/${d.data.id}`)).status, 200);
  assert.equal((await viewer.req("POST", "/api/documents", { title: "x", body: "y" })).status, 403, "viewer can't write");
  assert.equal((await viewer.req("PATCH", `/api/documents/${d.data.id}`, { title: "hijack" })).status, 403);

  const c = await viewer.req("POST", "/api/conversations", {});
  assert.equal(c.status, 201, "viewers can ask questions");
  const r = await viewer.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "What is our standard plan price?" });
  assert.match(r.text, /event: done/);
  const call = mock.calls.filter((x) => x.body.stream && !x.body.output_config?.format).at(-1)!;
  assert.match(JSON.stringify(call.body.system), /shared business workspace/);
  assert.equal((await owner.req("GET", `/api/conversations/${c.data.id}`)).status, 404, "conversations are private to their author");
  assert.equal((await owner.req("GET", "/api/conversations")).data.length, 0);

  const personal = new Client(); personal.cookie = member.cookie; // same person, personal workspace
  assert.equal((await personal.req("GET", "/api/documents")).data.length, 0, "personal workspace doesn't see business knowledge");
  const p = await personal.req("POST", "/api/documents", { title: "My private journal", body: "secret" });
  assert.equal((await owner.req("GET", `/api/documents/${p.data.id}`)).status, 404);
  assert.equal((await owner.req("GET", "/api/search?q=journal")).data.length, 0);
});

test("public API: token scopes, ingest, search, ask, revocation, tenant isolation", async () => {
  assert.equal((await member.req("POST", "/api/workspace/tokens", { name: "CRM", scopes: ["ingest"] })).status, 403, "admin only");
  const t = await owner.req("POST", "/api/workspace/tokens", { name: "CRM", scopes: ["ingest", "query"] });
  const ingestOnly = await owner.req("POST", "/api/workspace/tokens", { name: "Ingest", scopes: ["ingest"] });
  const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });
  const api = new Client();
  const doc = await api.req("POST", "/api/v1/documents", { title: "Customer call: Bella Salon", body: "Bella wants SMS reminders and a waitlist." }, bearer(t.data.token));
  assert.equal(doc.status, 201);
  const mem = await api.req("POST", "/api/v1/memories", { content: "Bella Salon renews in March", category: "context" }, bearer(t.data.token));
  assert.equal(mem.status, 201);
  const pending = await owner.req("GET", "/api/memories?status=pending");
  assert.ok(pending.data.some((m: any) => m.content.includes("Bella Salon renews")), "API memories wait for review");
  await new Promise((r) => setTimeout(r, 600));
  assert.ok((await api.req("GET", "/api/v1/search?q=waitlist", undefined, bearer(t.data.token))).data.results.length >= 1);
  assert.equal((await api.req("GET", "/api/v1/search?q=waitlist", undefined, bearer(ingestOnly.data.token))).status, 403, "scope enforced");
  const ask = await api.req("POST", "/api/v1/ask", { question: "What does Bella Salon want?" }, bearer(t.data.token));
  assert.equal(ask.status, 200);
  assert.equal(ask.data.aiGenerated, true);
  assert.ok(ask.data.context.documents.length + ask.data.context.nodes.length > 0);

  const other = await outsider.req("POST", "/api/workspaces", { name: "Other Co" });
  outsider.workspace = other.data.id;
  const ot = await outsider.req("POST", "/api/workspace/tokens", { name: "x", scopes: ["query"] });
  assert.equal((await api.req("GET", "/api/v1/search?q=waitlist", undefined, bearer(ot.data.token))).data.results.length, 0, "tokens only see their own workspace");

  await owner.req("DELETE", `/api/workspace/tokens/${t.data.id}`);
  assert.equal((await api.req("GET", "/api/v1/search?q=x", undefined, bearer(t.data.token))).status, 401, "revoked");
  assert.equal((await api.req("GET", "/api/v1/search?q=x")).status, 401);
});

test("operations agent: internal actions auto-run, external messages wait for approval, then deliver signed", async () => {
  await owner.req("POST", "/api/projects", { name: "Grow pipeline", description: "Sign 10 salons", goals: "10 customers" });
  const conn = await owner.req("POST", "/api/connectors", { name: "Team Slack", url: hookUrl, secret: "shh" });
  assert.equal(conn.status, 201);
  const list = await member.req("GET", "/api/connectors");
  assert.doesNotMatch(JSON.stringify(list.data), /\/hook|shh/, "members never see webhook paths or secrets");
  assert.equal((await member.req("POST", "/api/automations", { name: "x", kind: "briefing", schedule: { freq: "daily" } })).status, 403);

  const auto = await owner.req("POST", "/api/automations", {
    name: "Pipeline operator", kind: "operator", schedule: { freq: "daily", hour: 9, tz: "America/New_York" },
    config: { objective: "Keep the sales pipeline moving", connectorId: conn.data.id, autoApproveInternal: true },
  });
  assert.equal(auto.status, 201);
  assert.equal((await owner.req("POST", "/api/automations", { name: "y", kind: "operator", schedule: { freq: "daily" }, config: { objective: "Keep things moving", autoDeliver: true } })).status, 400, "agent messages can't be pre-authorized");
  await owner.req("POST", `/api/automations/${auto.data.id}/run`);
  const actions = await until(async () => { const r = await owner.req("GET", "/api/actions"); return r.data.length >= 3 && r.data.every((a: any) => a.status !== "approved") && r.data; });
  const task = actions.find((a: any) => a.kind === "create_task");
  const research = actions.find((a: any) => a.kind === "start_research");
  const msg = actions.find((a: any) => a.kind === "send_message");
  assert.equal(task.status, "executed");
  assert.ok(task.result.projectId, "task landed in the referenced project");
  assert.equal(research.status, "executed");
  assert.equal(msg.status, "proposed", "external action waits");
  assert.equal(received.length, 0, "nothing sent before approval");

  assert.equal((await member.req("POST", `/api/actions/${msg.id}/approve`, {})).status, 403, "only admins approve");
  const ok = await owner.req("POST", `/api/actions/${msg.id}/approve`, { text: "Edited: log every lead by Friday." });
  assert.equal(ok.data.status, "executed");
  assert.equal(received.length, 1);
  assert.match(received[0].body.text, /Edited: log every lead by Friday/);
  const expected = "sha256=" + crypto.createHmac("sha256", "shh").update(JSON.stringify(received[0].body)).digest("hex");
  assert.equal(received[0].sig, expected, "payload is HMAC-signed");

  const audit = await owner.req("GET", "/api/audit");
  const kinds = audit.data.map((a: any) => a.action);
  for (const k of ["workspace.created", "invite.accepted", "token.created", "token.revoked", "connector.created", "automation.created", "action.create_task", "action.send_message"]) assert.ok(kinds.includes(k), k);
  assert.equal((await member.req("GET", "/api/audit")).status, 403);
});

test("briefing with standing authorization delivers automatically; scheduler fires due automations", async () => {
  const conn = (await owner.req("GET", "/api/connectors")).data[0];
  const b = await owner.req("POST", "/api/automations", { name: "Morning brief", kind: "briefing", schedule: { freq: "daily", hour: 7, tz: "Europe/London" }, config: { period: "day", connectorId: conn.id, autoDeliver: true } });
  const { db } = await import("./db/client.js");
  await db().query("UPDATE automations SET next_run_at = now() - interval '1 minute' WHERE id=$1", [b.data.id]);
  const { tickAutomations } = await import("./engines/automation.js");
  const before = received.length;
  assert.ok((await tickAutomations()) >= 1);
  await until(async () => received.length > before);
  assert.match(received.at(-1)!.body.title, /Morning brief: Quiet day/);
  const a = (await owner.req("GET", "/api/automations")).data.find((x: any) => x.id === b.data.id);
  assert.equal(a.last_status, "ok");
  assert.ok(new Date(a.next_run_at) > new Date(), "next run advanced");
  const docs = await owner.req("GET", "/api/documents?q=Morning");
  assert.ok(docs.data.some((d: any) => d.kind === "briefing"), "brief saved to knowledge");
});

test("schedules respect time zones; webhook SSRF guard", async () => {
  const { nextRun, assertSafeUrl } = await import("./engines/automation.js");
  const from = new Date("2026-03-07T15:00:00Z"); // Saturday, 10am in New York (EST)
  const ny = nextRun({ freq: "daily", hour: 9, minute: 0, weekday: 1, tz: "America/New_York" }, from);
  assert.equal(ny.toISOString(), "2026-03-08T13:00:00.000Z", "9am New York on the DST-change day is 13:00 UTC");
  const weekly = nextRun({ freq: "weekly", hour: 8, minute: 30, weekday: 1, tz: "UTC" }, from);
  assert.equal(weekly.toISOString(), "2026-03-09T08:30:00.000Z");
  process.env.ORBITAL_ALLOW_PRIVATE_WEBHOOKS = "false";
  await assert.rejects(assertSafeUrl("https://127.0.0.1/x"), /private/);
  await assert.rejects(assertSafeUrl("https://10.0.0.5/x"), /private/);
  await assert.rejects(assertSafeUrl("http://hooks.example.com/x"), /https/);
  process.env.ORBITAL_ALLOW_PRIVATE_WEBHOOKS = "true";
});
