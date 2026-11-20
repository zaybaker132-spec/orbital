import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

// Recently viewed and favorites: private per person, only real items you can see, titles kept current,
// deleted items drop off, the trail stays at 10, favorites can be pages, renamed, reordered and removed.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-trail-test-"));
Object.assign(process.env, { ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_ALLOW_SIGNUP: "true", RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false" });
let server: Server;
let base = "";
class Client {
  cookie = "";
  workspace = "";
  ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  async req(method: string, url: string, body?: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json", "x-orbital-request": "1", "x-forwarded-for": this.ip, cookie: this.cookie };
    if (this.workspace) headers["x-orbital-workspace"] = this.workspace;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text as any }; }
  }
}
const signup = async (email: string) => { const c = new Client(); assert.equal((await c.req("POST", "/api/auth/signup", { email, password: "long enough password" })).status, 201); return c; };
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

test("recently viewed: newest first, deduplicated, titles current, deleted items gone, last 10 only", async () => {
  const c = await signup("trail@orbital.test");
  const note = (await c.req("POST", "/api/documents", { title: "Launch notes", body: "x" })).data;
  const project = (await c.req("POST", "/api/projects", { name: "Launch" })).data;
  const conv = (await c.req("POST", "/api/conversations", {})).data;
  const paper = (await c.req("POST", "/api/docs", { title: "Board memo" })).data;
  for (const [kind, ref] of [["document", note.id], ["project", project.id], ["conversation", conv.id], ["paper", paper.id], ["document", note.id]]) {
    assert.equal((await c.req("POST", "/api/recent", { kind, ref })).status, 200);
  }
  let r = (await c.req("GET", "/api/recent")).data;
  assert.deepEqual(r.map((x: any) => x.kind), ["document", "paper", "conversation", "project"], "newest first, the note once");
  assert.equal(r[0].title, "Launch notes");
  assert.equal(r[3].title, "Launch");
  await c.req("PATCH", `/api/projects/${project.id}`, { name: "Launch v2" });
  await c.req("DELETE", `/api/documents/${note.id}`);
  r = (await c.req("GET", "/api/recent")).data;
  assert.equal(r.find((x: any) => x.kind === "project").title, "Launch v2", "renames show");
  assert.ok(!r.some((x: any) => x.ref === note.id), "deleted items drop off");
  for (let i = 0; i < 12; i++) {
    const d = (await c.req("POST", "/api/documents", { title: `Note ${i}`, body: "x" })).data;
    await c.req("POST", "/api/recent", { kind: "document", ref: d.id });
  }
  r = (await c.req("GET", "/api/recent")).data;
  assert.equal(r.length, 10);
  assert.equal(r[0].title, "Note 11");
  assert.equal((await c.req("DELETE", "/api/recent")).status, 200);
  assert.deepEqual((await c.req("GET", "/api/recent")).data, [], "history can be cleared");
});

test("trail and favorites only accept things you can see", async () => {
  const a = await signup("trail-a@orbital.test"), b = await signup("trail-b@orbital.test");
  const secret = (await a.req("POST", "/api/documents", { title: "Secret", body: "x" })).data;
  const conv = (await a.req("POST", "/api/conversations", {})).data;
  assert.equal((await b.req("POST", "/api/recent", { kind: "document", ref: secret.id })).status, 404, "another workspace's note");
  assert.equal((await b.req("POST", "/api/bookmarks", { kind: "conversation", ref: conv.id })).status, 404, "someone else's conversation");
  assert.equal((await a.req("POST", "/api/recent", { kind: "paper", ref: secret.id })).status, 404, "a note isn't a paper");
  assert.equal((await a.req("POST", "/api/recent", { kind: "folder", ref: secret.id })).status, 400);
  assert.equal((await a.req("POST", "/api/recent", { kind: "document", ref: "not-a-uuid" })).status, 400);
  assert.equal((await a.req("POST", "/api/bookmarks", { kind: "page", ref: "https://evil.example/", title: "x" })).status, 400, "pages are Orbital's own");
  assert.equal((await a.req("POST", "/api/bookmarks", { kind: "page", ref: "//evil.example/x", title: "x" })).status, 400);
  assert.equal((await a.req("POST", "/api/bookmarks", { kind: "page", ref: "/no-such-page", title: "x" })).status, 400);
  // B's lists never show A's things.
  await a.req("POST", "/api/recent", { kind: "document", ref: secret.id });
  await a.req("POST", "/api/bookmarks", { kind: "document", ref: secret.id });
  assert.deepEqual((await b.req("GET", "/api/recent")).data, []);
  assert.deepEqual((await b.req("GET", "/api/bookmarks")).data, []);
  assert.equal((await new Client().req("GET", "/api/bookmarks")).status, 401);
});

test("favorites: items and pages, no duplicates, custom names, reorder, remove, limit", async () => {
  const c = await signup("fav@orbital.test");
  const project = (await c.req("POST", "/api/projects", { name: "Orbital" })).data;
  const note = (await c.req("POST", "/api/documents", { title: "Ideas", body: "x" })).data;
  const p1 = await c.req("POST", "/api/bookmarks", { kind: "project", ref: project.id });
  assert.equal(p1.status, 201);
  const again = await c.req("POST", "/api/bookmarks", { kind: "project", ref: project.id });
  assert.equal(again.status, 200);
  assert.equal(again.data.id, p1.data.id, "pinning twice keeps one");
  const page = await c.req("POST", "/api/bookmarks", { kind: "page", ref: "/connections", title: "Connections" });
  assert.equal(page.status, 201);
  await c.req("POST", "/api/bookmarks", { kind: "page", ref: "/search?q=pricing", title: "Search: pricing" });
  const n = await c.req("POST", "/api/bookmarks", { kind: "document", ref: note.id });
  let list = (await c.req("GET", "/api/bookmarks")).data;
  assert.deepEqual(list.map((x: any) => x.title), ["Orbital", "Connections", "Search: pricing", "Ideas"]);
  assert.equal((await c.req("PATCH", `/api/bookmarks/${n.data.id}`, { label: "My ideas" })).status, 200);
  await c.req("PUT", "/api/bookmarks/order", { ids: [n.data.id, page.data.id, p1.data.id] });
  list = (await c.req("GET", "/api/bookmarks")).data;
  assert.deepEqual(list.map((x: any) => x.title).slice(0, 3), ["My ideas", "Connections", "Orbital"]);
  await c.req("PATCH", `/api/projects/${project.id}`, { name: "Orbital 2" });
  assert.ok((await c.req("GET", "/api/bookmarks")).data.some((x: any) => x.title === "Orbital 2"), "titles follow renames");
  await c.req("DELETE", `/api/documents/${note.id}`);
  assert.ok(!(await c.req("GET", "/api/bookmarks")).data.some((x: any) => x.ref === note.id), "deleted items drop off");
  await c.req("DELETE", `/api/bookmarks/${page.data.id}`);
  assert.ok(!(await c.req("GET", "/api/bookmarks")).data.some((x: any) => x.ref === "/connections"));
  for (let i = 0; i < 48; i++) await c.req("POST", "/api/bookmarks", { kind: "page", ref: `/search?q=${i}`, title: `Search ${i}` });
  const over = await c.req("POST", "/api/bookmarks", { kind: "page", ref: "/settings", title: "Settings" });
  assert.equal(over.status, 400);
  assert.equal(over.data.code, "limit");
});
