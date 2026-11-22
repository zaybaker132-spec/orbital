import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

// The desktop app's server: a fresh install opens on "create account", a forgotten password can be
// reset from the app itself (and only by the app, which holds a secret), and the no-AI answer points
// to Settings instead of server variables.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-desktop-test-"));
const TOKEN = "d".repeat(64);
Object.assign(process.env, { ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_DESKTOP: "1", ORBITAL_DESKTOP_TOKEN: TOKEN, RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false" });
let server: Server;
let base = "";
async function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}, cookie = "") {
  const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: any = text; try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
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

test("desktop: first run opens on sign-up; a forgotten password is reset by the app only", async () => {
  const fresh = await req("GET", "/api/auth/me");
  assert.equal(fresh.data.desktop, true);
  assert.equal(fresh.data.firstRun, true, "no accounts yet");
  const signup = await req("POST", "/api/auth/signup", { email: "me@example.com", password: "long enough password" });
  assert.equal(signup.status, 201);
  assert.equal((await req("GET", "/api/auth/me")).data.firstRun, false, "after the first account, sign-in is the default");

  // Without the app's secret (a web page, another program): refused.
  assert.equal((await req("POST", "/api/auth/password/desktop-reset", { email: "me@example.com" })).status, 403);
  assert.equal((await req("POST", "/api/auth/password/desktop-reset", { email: "me@example.com" }, { "x-orbital-desktop-token": "x".repeat(64) })).status, 403);
  assert.equal((await req("POST", "/api/auth/password/desktop-reset", { email: "me@example.com" }, { "x-orbital-desktop-token": TOKEN.slice(1) })).status, 403);
  // With it: the usual "choose a new password" page.
  const none = await req("POST", "/api/auth/password/desktop-reset", { email: "nobody@example.com" }, { "x-orbital-desktop-token": TOKEN });
  assert.equal(none.status, 404);
  const r = await req("POST", "/api/auth/password/desktop-reset", { email: "Me@Example.com" }, { "x-orbital-desktop-token": TOKEN });
  assert.equal(r.status, 200);
  assert.match(r.data.path, /^\/reset-password\?token=[\w-]+$/);
  const token = new URLSearchParams(r.data.path.split("?")[1]).get("token");
  const reset = await req("POST", "/api/auth/password/reset", { token, password: "a brand new password" });
  assert.equal(reset.status, 200);
  assert.equal((await req("POST", "/api/auth/login", { email: "me@example.com", password: "long enough password" })).status, 401, "old password no longer works");
  const login = await req("POST", "/api/auth/login", { email: "me@example.com", password: "a brand new password" });
  assert.equal(login.status, 200);
  assert.ok([400, 429].includes((await req("POST", "/api/auth/password/reset", { token, password: "another new password" })).status), "the link works once");

  // No AI key: the answer says where to add one, in words a person understands.
  const conv = (await req("POST", "/api/conversations", {}, {}, login.cookie)).data;
  const res = await fetch(`${base}/api/conversations/${conv.id}/messages`, { method: "POST", headers: { "content-type": "application/json", "x-orbital-request": "1", cookie: login.cookie }, body: JSON.stringify({ content: "Hello" }) });
  const stream = await res.text();
  assert.match(stream, /Settings → AI & research\]\(\/settings#ai\)/);
  assert.doesNotMatch(stream, /ANTHROPIC_API_KEY/);
});
