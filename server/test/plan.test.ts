import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http, { type Server } from "node:http";

// Orbital Pro in the desktop app: 14-day trial of everything, then Pro actions need a license; what
// you made stays readable; keys are checked with the license service and keep working offline.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-plan-test-"));
const GOOD = "ORB-c3ViX1BBSUQxMjM0NQ-abcdefghijklmnopqrstuvwxyz012345";
const GONE = "ORB-c3ViX0dPTkUxMjM0NQ-abcdefghijklmnopqrstuvwxyz012345";
let licenseActive = true, licenseReachable = true, verifyCalls = 0;
const lic = http.createServer((q, r) => {
  let body = ""; q.on("data", (c) => (body += c)); q.on("end", () => {
    if (!licenseReachable) { q.socket.destroy(); return; }
    const key = body ? JSON.parse(body).key : "";
    r.setHeader("content-type", "application/json");
    if (q.url === "/verify") {
      verifyCalls++;
      if (key === GOOD) return r.end(JSON.stringify({ active: licenseActive, status: licenseActive ? "active" : "canceled", plan: "yearly", email: "buyer@example.com", periodEnd: Math.floor(Date.now() / 1000) + (licenseActive ? 300 * 86400 : -86400), cancelAtPeriodEnd: false }));
      if (key === GONE) return r.end(JSON.stringify({ active: false, status: "canceled" }));
      r.statusCode = 400; return r.end(JSON.stringify({ active: false }));
    }
    if (q.url === "/portal") return r.end(JSON.stringify({ url: "https://billing.stripe.com/p/session/x" }));
    r.statusCode = 404; r.end("{}");
  });
});
let server: Server, base = "", cookie = "";
const req = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const t = await res.text(); let data: any = t; try { data = JSON.parse(t); } catch { /* text */ }
  return { status: res.status, data };
};
before(async () => {
  await new Promise<void>((ok) => lic.listen(0, "127.0.0.1", ok));
  Object.assign(process.env, { ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_DESKTOP: "1", ORBITAL_LICENSE_URL: `http://127.0.0.1:${(lic.address() as any).port}`, RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false" });
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  assert.equal((await req("POST", "/api/auth/signup", { email: "me@example.com", password: "long enough password" })).status, 201);
});
after(async () => {
  server?.close(); lic.close();
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const endTrial = async () => { const { db } = await import("../db/client.js"); await db().query("UPDATE app_license SET trial_started_at = now() - interval '15 days'"); };

test("plan: trial, then Pro features need a license; existing work stays readable", async () => {
  const p = (await req("GET", "/api/plan")).data;
  assert.equal(p.state, "trial");
  assert.equal(p.trialDaysLeft, 14);
  assert.match(p.buyUrl.monthly, /\/buy\?plan=monthly$/);
  assert.ok(p.features.research && p.prices.yearly.amount === 96);

  // During the trial, Pro features work.
  const research = await req("POST", "/api/research", { question: "What do students use for notes?" });
  assert.ok([200, 201, 202].includes(research.status), JSON.stringify(research.data));
  const meeting = await req("POST", "/api/meetings", {});
  assert.ok([200, 201].includes(meeting.status));

  // Trial over: creating with Pro features is refused with a clear reason; free features and old work are fine.
  await endTrial();
  assert.equal((await req("GET", "/api/plan")).data.state, "free");
  const blocked = await req("POST", "/api/research", { question: "Another question about notes?" });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.data.code, "pro_required");
  assert.equal(blocked.data.feature, "research");
  assert.match(blocked.data.error, /Orbital Pro/);
  for (const [url, feature] of [["/api/meetings", "meetings"], ["/api/hypotheses", "research"], ["/api/opportunities/discover", "opportunities"], ["/api/maintenance/scan", "maintenance"]] as const) {
    const r = await req("POST", url, url === "/api/hypotheses" ? { statement: "Students prefer paper notes" } : {});
    assert.equal(r.status, 402, url); assert.equal(r.data.feature, feature);
  }
  const conv = (await req("POST", "/api/conversations", {})).data;
  assert.equal((await req("POST", `/api/conversations/${conv.id}/messages`, { content: "hi", mode: "deep_research" })).status, 402, "deep research in chat");
  assert.equal((await req("POST", `/api/conversations/${conv.id}/messages`, { content: "hi" })).status, 200, "normal chat is free");
  assert.equal((await req("GET", "/api/research")).status, 200, "past research is still readable");
  assert.equal((await req("GET", `/api/research/${research.data.id}`)).status, 200);
  assert.equal((await req("POST", "/api/documents", { title: "Notes stay free", body: "x" })).status, 201);
  assert.equal((await req("POST", "/api/projects", { name: "Projects stay free" })).status, 201);
});

test("plan: license keys: invalid, inactive, active, offline, cancelled, removed", async () => {
  assert.equal((await req("POST", "/api/plan/activate", { key: "hello" })).status, 400);
  const gone = await req("POST", "/api/plan/activate", { key: GONE });
  assert.equal(gone.status, 400); assert.match(gone.data.error, /isn't active/);
  licenseReachable = false;
  const offline = await req("POST", "/api/plan/activate", { key: GOOD });
  assert.equal(offline.status, 502); assert.match(offline.data.error, /license service/);
  licenseReachable = true;

  const ok = await req("POST", "/api/plan/activate", { key: GOOD });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.state, "pro");
  assert.equal(ok.data.license.plan, "yearly");
  assert.equal(ok.data.license.email, "buyer@example.com");
  assert.equal(ok.data.license.keyEnding, GOOD.slice(-6));
  assert.ok(!JSON.stringify(ok.data).includes(GOOD), "the full key is never sent back to the page");
  assert.ok([200, 201, 202].includes((await req("POST", "/api/research", { question: "Pro again: what about notes?" })).status));
  assert.equal((await req("POST", "/api/plan/manage")).data.url, "https://billing.stripe.com/p/session/x");

  // Offline later: Pro carries on (no check needed until the paid period ends).
  licenseReachable = false;
  const { refreshLicense } = await import("../lib/plan.js");
  await assert.rejects(refreshLicense());
  assert.equal((await req("GET", "/api/plan")).data.state, "pro");
  licenseReachable = true;

  // Cancelled and expired: the next check ends Pro.
  licenseActive = false;
  await refreshLicense();
  assert.equal((await req("GET", "/api/plan")).data.state, "free");
  licenseActive = true;
  await refreshLicense();
  assert.equal((await req("GET", "/api/plan")).data.state, "pro");

  // A daily re-check happens on its own.
  const { db } = await import("../db/client.js");
  await db().query("UPDATE app_license SET checked_at = now() - interval '2 days'");
  const before = verifyCalls;
  await req("GET", "/api/plan");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(verifyCalls, before + 1);

  assert.equal((await req("DELETE", "/api/plan/license")).data.state, "free");
  assert.equal((await req("POST", "/api/plan/manage")).status, 400);
});
