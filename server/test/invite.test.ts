import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { AI_TOOLS, COMPUTERS, DEVICES, HEARD_FROM, NOTES_APPS, PERSONAS, REMEMBER, SCALE } from "../../shared/waitlist.js";

// Invite-only launch: sign-up closed, admins can always join, waitlist people join once let in.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-invite-test-"));
Object.assign(process.env, { ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_ALLOW_SIGNUP: "false", ORBITAL_ADMIN_EMAILS: "boss@orbital.test", RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false" });
let server: Server;
let base = "";
class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text as any }; }
  }
}
before(async () => {
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(async () => {
  server?.close();
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("invite-only: admin joins, strangers wait, admitted waitlist people join", async () => {
  const boss = new Client(), ana = new Client();
  assert.equal((await boss.req("POST", "/api/auth/signup", { email: "boss@orbital.test", password: "long enough password" })).status, 201, "admins can always create their account");
  const refused = await ana.req("POST", "/api/auth/signup", { email: "ana@example.test", password: "long enough password" });
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /invite-only/);
  const joined = await ana.req("POST", "/api/public/waitlist", { email: "ana@example.test", persona: PERSONAS[0], remember: [REMEMBER[0]], scale: SCALE[0], aiTools: [AI_TOOLS[0]], notesApps: [NOTES_APPS[0]], computers: [COMPUTERS[0]], devices: [DEVICES[0]], heardFrom: HEARD_FROM[0], consent: true });
  assert.ok(joined.status < 300, JSON.stringify(joined.data));
  const list = await boss.req("GET", "/api/admin/waitlist");
  assert.equal(list.data.signupOpen, false);
  const row = list.data.rows.find((r: any) => r.email === "ana@example.test");
  assert.equal(row.admitted_at, null);
  assert.ok([401, 403].includes((await ana.req("POST", `/api/admin/waitlist/${row.id}/admit`, {})).status), "only admins let people in");
  assert.equal((await boss.req("POST", `/api/admin/waitlist/${row.id}/admit`, {})).status, 200);
  assert.equal((await ana.req("POST", "/api/auth/signup", { email: "Ana@Example.test", password: "long enough password" })).status, 201, "admitted (email case doesn't matter)");
});

test("hosted Postgres connections are encrypted; local ones aren't", async () => {
  const { postgresConnection } = await import("../db/client.js");
  const hosted = postgresConnection("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require");
  assert.deepEqual(hosted.ssl, { rejectUnauthorized: false });
  assert.doesNotMatch(hosted.connectionString, /sslmode/);
  assert.equal(postgresConnection("postgres://u:p@localhost:5432/db").ssl, false);
  process.env.DATABASE_SSL_CA = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
  assert.deepEqual(postgresConnection("postgres://u:p@db.example.com/db").ssl, { ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  delete process.env.DATABASE_SSL_CA;
});
