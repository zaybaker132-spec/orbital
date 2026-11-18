import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

// Isolated, AI-free environment: exercises everything that must work without an AI provider.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-test-"));
process.env.ORBITAL_DATA_DIR = dir;
process.env.AI_PROVIDER = "none";
process.env.RESEARCH_WIKIPEDIA = "false";
process.env.RESEARCH_OPENALEX = "false";
process.env.DATABASE_URL = "";
process.env.ORBITAL_ADMIN_EMAILS = "alice@example.com";

let server: Server;
let base = "";

class Client {
  cookie = "";
  async req(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", "x-orbital-request": "1", cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* SSE or text */ }
    return { status: res.status, data, text };
  }
}

const settle = () => new Promise((r) => setTimeout(r, 600)); // let background jobs (indexing) run

before(async () => {
  const { createApp } = await import("./index.js");
  const app = await createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  server?.close();
  const { db } = await import("./db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const alice = new Client();
const bob = new Client();

test("auth: signup, csrf header required, session", async () => {
  const noHeader = await fetch(base + "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(noHeader.status, 403);
  assert.equal((await alice.req("POST", "/api/auth/signup", { email: "alice@example.com", password: "short" })).status, 400);
  assert.equal((await alice.req("POST", "/api/auth/signup", { email: "alice@example.com", password: "correct horse battery" })).status, 201);
  assert.equal((await bob.req("POST", "/api/auth/signup", { email: "bob@example.com", password: "another long password" })).status, 201);
  const me = await alice.req("GET", "/api/auth/me");
  assert.equal(me.data.user.email, "alice@example.com");
  assert.equal(me.data.ai.provider, "none");
  assert.equal((await new Client().req("GET", "/api/memories")).status, 401);
});

test("knowledge: notes are indexed, wiki-linked, searchable", async () => {
  const a = await alice.req("POST", "/api/documents", { title: "Local business automation", body: "Small local businesses waste hours on scheduling and invoicing. Automation tools could save them time.", tags: ["Business"] });
  assert.equal(a.status, 201);
  const b = await alice.req("POST", "/api/documents", { title: "AI agents for scheduling", body: "AI scheduling agents can automate appointment booking for local businesses. See [[Local business automation]].", tags: ["ai"] });
  assert.equal(b.status, 201);
  await settle();
  const graph = await alice.req("GET", "/api/graph");
  assert.ok(graph.data.nodes.length >= 2, "notes became graph nodes");
  const wiki = graph.data.edges.find((e: any) => e.status === "confirmed" && e.origin === "user");
  assert.ok(wiki, "wiki link produced a confirmed connection");
  const search = await alice.req("GET", "/api/search?q=scheduling");
  assert.ok(search.data.some((r: any) => r.type === "document"));
  const docs = await alice.req("GET", "/api/documents?q=invoicing");
  assert.equal(docs.data.length, 1);
  const tags = await alice.req("GET", "/api/tags");
  assert.ok(tags.data.some((t: any) => t.tag === "business"));
});

test("memory: create, correct, dedupe, delete", async () => {
  const m = await alice.req("POST", "/api/memories", { content: "Wants to build a software business serving local companies", category: "goal" });
  assert.equal(m.status, 201);
  const dup = await alice.req("POST", "/api/memories", { content: "Wants to build a software business serving local companies.", category: "goal" });
  assert.equal(dup.data.duplicate, true);
  await alice.req("POST", "/api/memories", { content: "Skilled in TypeScript and React", category: "skill" });
  const list = await alice.req("GET", "/api/memories");
  assert.equal(list.data.length, 2);
  const corrected = await alice.req("PATCH", `/api/memories/${m.data.id}`, { content: "Wants to build a SaaS business for local service companies" });
  assert.equal(corrected.data.user_corrected, true);
  const del = await alice.req("DELETE", `/api/memories/${list.data.find((x: any) => x.category === "skill").id}`);
  assert.equal(del.status, 200);
});

test("chat without AI: retrieval works, explicit memories honoured, answer is honest", async () => {
  const c = await alice.req("POST", "/api/conversations", {});
  const r = await alice.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "Remember that I prefer concise answers", mode: "standard" });
  assert.match(r.text, /event: memory/);
  const r2 = await alice.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "What do I know about scheduling automation for local businesses?", mode: "standard" });
  assert.match(r2.text, /event: context/);
  assert.match(r2.text, /No AI provider is configured/);
  const conv = await alice.req("GET", `/api/conversations/${c.data.id}`);
  assert.equal(conv.data.messages.length, 4);
  const ctx = conv.data.messages[3].metadata.context;
  assert.ok(ctx.nodes.length + ctx.memories.length > 0, "retrieved relevant knowledge");
  const found = await alice.req("GET", "/api/conversations?q=scheduling");
  assert.equal(found.data.length, 1);
});

test("graph: manual connections and suggestion review", async () => {
  const n1 = await alice.req("POST", "/api/nodes", { title: "Customer acquisition", summary: "How to find first customers" });
  const n2 = await alice.req("POST", "/api/nodes", { title: "Cold outreach", summary: "Emailing local businesses directly" });
  const e = await alice.req("POST", "/api/edges", { sourceId: n2.data.id, targetId: n1.data.id, relation: "supports" });
  assert.equal(e.status, 201);
  const detail = await alice.req("GET", `/api/nodes/${n1.data.id}`);
  assert.ok(detail.data.edges.some((x: any) => x.relation === "supports" && x.status === "confirmed"));
  const graph = await alice.req("GET", "/api/graph");
  const suggested = graph.data.edges.find((x: any) => x.status === "suggested");
  if (suggested) assert.equal((await alice.req("PATCH", `/api/edges/${suggested.id}`, { status: "confirmed" })).data.id, suggested.id);
});

test("projects: tasks, milestones, brief without AI", async () => {
  const p = await alice.req("POST", "/api/projects", { name: "Launch My SaaS", description: "Scheduling tool for local businesses", goals: "10 paying customers" });
  const ms = await alice.req("POST", `/api/projects/${p.data.id}/milestones`, { title: "Validate demand" });
  const t = await alice.req("POST", `/api/projects/${p.data.id}/tasks`, { title: "Interview 5 salon owners", milestoneId: ms.data.id });
  await alice.req("PATCH", `/api/tasks/${t.data.id}`, { done: true });
  const full = await alice.req("GET", `/api/projects/${p.data.id}`);
  assert.equal(full.data.tasks[0].done, true);
  const brief = await alice.req("GET", `/api/projects/${p.data.id}/brief`);
  assert.equal(brief.data.aiGenerated, false);
  assert.deepEqual(brief.data.facts.recentlyCompleted, ["Interview 5 salon owners"]);
});

test("opportunities: discovery refuses without AI; manual tracking works", async () => {
  assert.equal((await alice.req("POST", "/api/opportunities/discover", {})).status, 503);
  const o = await alice.req("POST", "/api/opportunities", { title: "Booking assistant for salons", explanation: "Manual entry" });
  const u = await alice.req("PATCH", `/api/opportunities/${o.data.id}`, { status: "investigating", outcomeNotes: "Talked to 2 owners" });
  assert.equal(u.data.status, "investigating");
});

test("growth: real counts, timeline, maintenance", async () => {
  const g = await alice.req("GET", "/api/growth");
  assert.ok(g.data.stats.volume.nodes >= 4);
  assert.ok(g.data.stats.volume.memories >= 2);
  assert.ok(g.data.timeline.recent.length > 0);
  const m = await alice.req("GET", "/api/growth/maintenance");
  assert.ok(Array.isArray(m.data.duplicates));
});

test("isolation: one user can never read or change another's data", async () => {
  const mine = await alice.req("GET", "/api/memories");
  const id = mine.data[0].id;
  assert.equal((await bob.req("GET", "/api/memories")).data.length, 0);
  assert.equal((await bob.req("PATCH", `/api/memories/${id}`, { content: "hijacked content" })).status, 404);
  assert.equal((await bob.req("DELETE", `/api/memories/${id}`)).status, 404);
  assert.equal((await bob.req("GET", "/api/graph")).data.nodes.length, 0);
  assert.equal((await bob.req("GET", "/api/search?q=scheduling")).data.length, 0);
  const aliceConv = (await alice.req("GET", "/api/conversations")).data[0].id;
  assert.equal((await bob.req("GET", `/api/conversations/${aliceConv}`)).status, 404);
  assert.equal((await bob.req("POST", `/api/conversations/${aliceConv}/messages`, { content: "hello there" })).status, 404);
  const c = await bob.req("POST", "/api/conversations", {});
  const r = await bob.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "What do I know about scheduling automation?" });
  assert.doesNotMatch(r.text, /local business/i, "bob's retrieval never surfaces alice's knowledge");
  const nodes = (await alice.req("GET", "/api/graph")).data.nodes;
  assert.equal((await bob.req("POST", "/api/edges", { sourceId: nodes[0].id, targetId: nodes[1].id, relation: "supports" })).status, 404);
});

test("waitlist: public signup, validation, spam trap, admin-only export", async () => {
  const anon = new Client();
  const entry = {
    email: "Founder@Startup.io", persona: "Founder or operator", remember: ["Projects I'm building"], scale: "Me and a small team",
    aiTools: ["Claude", "Cursor"], notesApps: ["Obsidian"], computers: ["macOS", "Windows"], devices: ["iPhone or iPad"],
    heardFrom: "A friend", instagram: "@founder.io", compound: "=HYPERLINK(\"x\")",
  };
  const a = await anon.req("POST", "/api/public/waitlist", entry);
  assert.equal(a.status, 201);
  assert.equal(a.data.position, 1);
  const again = await anon.req("POST", "/api/public/waitlist", { ...entry, persona: "Builder or engineer" });
  assert.equal(again.data.position, 1, "re-joining updates, never duplicates");
  assert.equal((await anon.req("POST", "/api/public/waitlist", { ...entry, email: "x@y.io", computers: ["macOS", "Windows", "Linux", "ChromeOS"] })).status, 400, "main + two more at most");
  assert.equal((await anon.req("POST", "/api/public/waitlist", { ...entry, email: "x@y.io", devices: ["None", "Android"] })).status, 400, "None stands alone");
  assert.equal((await anon.req("POST", "/api/public/waitlist", { ...entry, email: "x@y.io", remember: [], rememberOther: "" })).status, 400);
  assert.equal((await anon.req("POST", "/api/public/waitlist", { ...entry, email: "bot@spam.io", website: "http://spam" })).status, 201);
  assert.equal((await anon.req("GET", "/api/admin/waitlist")).status, 401);
  assert.equal((await bob.req("GET", "/api/admin/waitlist")).status, 403, "only server admins");
  const list = await alice.req("GET", "/api/admin/waitlist");
  assert.equal(list.data.total, 1, "spam-trap entry was not stored");
  assert.equal(list.data.rows[0].email, "founder@startup.io");
  assert.equal(list.data.rows[0].persona, "Builder or engineer");
  assert.equal(list.data.rows[0].instagram, "founder.io");
  const csv = await alice.req("GET", "/api/admin/waitlist.csv");
  assert.match(csv.text, /founder@startup\.io/);
  assert.match(csv.text, /"'=HYPERLINK/, "formula cells are neutralised");
  assert.equal((await alice.req("GET", "/api/auth/me")).data.serverAdmin, true);
});

/** Open a meeting stream and read its first event (the welcome), keeping the connection open. */
async function joinStream(c: Client, code: string) {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/meetings/${code}/stream?name=T`, { headers: { cookie: c.cookie }, signal: ac.signal });
  if (!res.ok) { ac.abort(); return { status: res.status, close: () => {} }; }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n\n")) buf += dec.decode((await reader.read()).value);
  const data = JSON.parse(buf.split("\n").find((l) => l.startsWith("data: "))!.slice(6));
  return { status: res.status, welcome: data, reader, close: () => ac.abort() };
}

test("meetings: codes, host controls, locked rooms, no spoofed signalling", async () => {
  const m = await alice.req("POST", "/api/meetings", { title: "Sync" });
  assert.equal(m.status, 201);
  assert.match(m.data.code, /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  const code = m.data.code;
  assert.equal((await bob.req("GET", `/api/meetings/${code.replace(/-/g, "")}`)).data.code, code, "codes work without dashes");
  assert.equal((await bob.req("GET", "/api/meetings/not-a-code")).status, 400);
  assert.equal((await bob.req("GET", "/api/meetings/zzz-zzzz-zzz")).status, 404);
  const cfg = await bob.req("GET", "/api/meetings/config");
  assert.ok(cfg.data.iceServers.length >= 1);

  const a = await joinStream(alice, code);
  const b = await joinStream(bob, code);
  assert.equal(b.welcome.peers.length, 1, "newcomer is told who is already here");
  const alicePeer = a.welcome.peerId, bobPeer = b.welcome.peerId;
  assert.equal((await bob.req("POST", `/api/meetings/${code}/signal`, { from: alicePeer, to: bobPeer, kind: "offer", data: { sdp: "x" } })).status, 404, "can't send as someone else's peer");
  assert.equal((await bob.req("POST", `/api/meetings/${code}/signal`, { from: bobPeer, to: alicePeer, kind: "offer", data: { type: "offer", sdp: "x" } })).data.ok, true);
  assert.equal((await bob.req("POST", `/api/meetings/${code}/lock`, { locked: true })).status, 403, "only the host locks");
  assert.equal((await bob.req("POST", `/api/meetings/${code}/end`)).status, 403, "only the host ends");
  assert.equal((await alice.req("POST", `/api/meetings/${code}/lock`, { locked: true })).status, 200);
  b.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await joinStream(bob, code)).status, 423, "locked rooms turn newcomers away");
  assert.ok((await bob.req("GET", "/api/meetings")).data.some((x: any) => x.code === code), "joined meetings appear in recent");
  assert.equal((await alice.req("POST", `/api/meetings/${code}/end`)).status, 200);
  a.close();
  assert.equal((await bob.req("GET", `/api/meetings/${code}`)).data.ended, true);
  assert.equal((await joinStream(alice, code)).status, 410, "ended meetings can't be rejoined");
});

test("without an AI provider: images are kept, conversations save as notes, voice explains what's needed", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "receipt.png");
  const up = await fetch(base + "/api/documents/upload", { method: "POST", headers: { "x-orbital-request": "1", cookie: alice.cookie }, body: fd });
  const doc: any = await up.json();
  assert.equal(up.status, 201);
  assert.match(doc.notice, /Connect an AI provider/);
  assert.equal((await alice.req("GET", `/api/documents/${doc.id}`)).data.kind, "image");

  const c = await alice.req("POST", "/api/conversations", {});
  await alice.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "Notes on the Lisbon trip budget" });
  const saved = await alice.req("POST", `/api/conversations/${c.data.id}/remember`);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ai, false);
  assert.match((await alice.req("GET", `/api/documents/${saved.data.documentId}`)).data.body, /Lisbon trip budget/);

  const audio = new FormData();
  audio.append("audio", new Blob([new Uint8Array(4000)], { type: "audio/webm" }), "speech.webm");
  const t = await fetch(base + "/api/voice/transcribe", { method: "POST", headers: { "x-orbital-request": "1", cookie: alice.cookie }, body: audio });
  assert.equal(t.status, 503);
  assert.match(((await t.json()) as any).error, /Chrome, Edge or Safari/);
  assert.equal((await alice.req("GET", "/api/voice/config")).data.serverTranscription, false);
  await settle();
});

test("routes: real pages are recognised; anything else is a 404", async () => {
  const { isAppRoute } = await import("../shared/routes.js");
  for (const p of ["/", "/login", "/c/123", "/projects", "/projects/abc", "/knowledge/x/", "/m/abc-defg-hij", "/invite/token", "/search", "/focus"]) assert.ok(isAppRoute(p), p);
  for (const p of ["/pricing", "/projects/a/b", "/c", "/wp-admin", "/knowledgebase", "/api/x"]) assert.ok(!isAppRoute(p), p);
});
