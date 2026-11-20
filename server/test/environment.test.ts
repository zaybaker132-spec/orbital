import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

// Custom Orbital environment: dashboards, layout and theme are validated, saved per person, and the
// dashboard's tasks widget only ever sees the current workspace.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-env-test-"));
Object.assign(process.env, { ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_ALLOW_SIGNUP: "true", RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false" });
let server: Server;
let base = "";
class Client {
  cookie = "";
  ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  async req(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-orbital-request": "1", "x-forwarded-for": this.ip, cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
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

const ENV = {
  home: "dashboard", activeDashboard: "work", accent: "violet", corePalette: "aurora", background: "glow", textSize: "large", contextPanel: "closed",
  nav: { order: ["dashboard", "projects", "core"], hidden: ["meetings"] },
  dashboards: [
    { id: "main", name: "My Orbital", widgets: [{ id: "today", type: "today", size: "l" }, { id: "tasks", type: "tasks", size: "m" }] },
    { id: "work", name: "Work", widgets: [{ id: "projects", type: "projects", size: "s" }] },
  ],
};

test("environment: saved as given, returned on sign-in, and replaced whole", async () => {
  const c = new Client();
  assert.equal((await c.req("POST", "/api/auth/signup", { email: "env@orbital.test", password: "long enough password" })).status, 201);
  const r = await c.req("PUT", "/api/preferences", { environment: ENV });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const me = await c.req("GET", "/api/auth/me");
  assert.deepEqual(me.data.preferences.environment, ENV);
  // Other preferences are untouched by an environment change, and vice versa.
  await c.req("PUT", "/api/preferences", { language: "fr" });
  const me2 = await c.req("GET", "/api/auth/me");
  assert.equal(me2.data.preferences.language, "fr");
  assert.deepEqual(me2.data.preferences.environment, ENV);
});

test("environment: anything outside the known shapes and limits is refused", async () => {
  const c = new Client();
  await c.req("POST", "/api/auth/signup", { email: "env-bad@orbital.test", password: "long enough password" });
  const bad = (environment: unknown) => c.req("PUT", "/api/preferences", { environment });
  const dash = (widgets: unknown[], extra = {}) => ({ dashboards: [{ id: "main", name: "Main", widgets, ...extra }] });
  assert.equal((await bad(dash([{ id: "x", type: "evil", size: "s" }]))).status, 400, "unknown widget type");
  assert.equal((await bad(dash([{ id: "x", type: "tasks", size: "xl" }]))).status, 400, "unknown size");
  assert.equal((await bad(dash([{ id: "x", type: "tasks", size: "s", html: "<script>" }]))).status, 400, "extra fields");
  assert.equal((await bad(dash([{ id: "../x", type: "tasks", size: "s" }]))).status, 400, "ids are slugs");
  assert.equal((await bad(dash(Array.from({ length: 25 }, (_, i) => ({ id: `w${i}`, type: "tasks", size: "s" }))))).status, 400, "at most 24 widgets");
  assert.equal((await bad({ dashboards: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, name: "D", widgets: [] })) })).status, 400, "at most 8 dashboards");
  assert.equal((await bad({ dashboards: [] })).status, 400, "at least one dashboard");
  assert.equal((await bad({ dashboards: [{ id: "d", name: "x".repeat(41), widgets: [] }] })).status, 400, "names are short");
  assert.equal((await bad({ accent: "#ff0000" })).status, 400, "accents come from the list");
  assert.equal((await bad({ nav: { order: ["settings"], hidden: [] } })).status, 400, "only known sections");
  assert.equal((await bad({ theme: "x" })).status, 400, "no unknown keys");
  assert.equal((await c.req("GET", "/api/auth/me")).data.preferences.environment, undefined, "nothing was stored");
});

test("dashboard tasks: open tasks of this workspace only, soonest first, overdue flagged", async () => {
  const a = new Client(), b = new Client();
  await a.req("POST", "/api/auth/signup", { email: "dash-a@orbital.test", password: "long enough password" });
  await b.req("POST", "/api/auth/signup", { email: "dash-b@orbital.test", password: "long enough password" });
  const p = (await a.req("POST", "/api/projects", { name: "Launch" })).data;
  const today = new Date().toISOString().slice(0, 10), yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await a.req("POST", `/api/projects/${p.id}/tasks`, { title: "No date" });
  await a.req("POST", `/api/projects/${p.id}/tasks`, { title: "Today", dueDate: today });
  const late = (await a.req("POST", `/api/projects/${p.id}/tasks`, { title: "Late", dueDate: yesterday })).data;
  const done = (await a.req("POST", `/api/projects/${p.id}/tasks`, { title: "Done already", dueDate: today })).data;
  await a.req("PATCH", `/api/tasks/${done.id}`, { done: true });
  const r = await a.req("GET", `/api/dashboard/tasks?today=${today}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map((t: any) => t.title), ["Late", "Today", "No date"]);
  assert.equal(r.data[0].overdue, true);
  assert.equal(r.data[0].project_name, "Launch");
  assert.equal(r.data[0].id, late.id);
  assert.deepEqual((await b.req("GET", `/api/dashboard/tasks?today=${today}`)).data, [], "another person's workspace sees none of them");
  assert.equal((await new Client().req("GET", "/api/dashboard/tasks")).status, 401);
});
