import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import * as Y from "yjs";
import { startMockAnthropic, type MockCall } from "./mockAnthropic.js";

// Docs: create, real-time co-editing (Yjs merge + relay), snapshots feed search, versions, comments, roles, writing help.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-docs-test-"));
let server: Server;
let base = "";
let mock: { url: string; calls: MockCall[]; close: () => void };

class Client {
  cookie = "";
  workspace = "";
  async req(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", "x-orbital-request": "1", cookie: this.cookie, ...(this.workspace ? { "x-orbital-workspace": this.workspace } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, data };
  }
  /** Open the live event stream and collect events. */
  async listen() {
    const events: any[] = [];
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events?workspace=${this.workspace}`, { headers: { cookie: this.cookie }, signal: ctrl.signal });
    (async () => {
      const reader = res.body!.getReader();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += new TextDecoder().decode(value);
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (line) events.push(JSON.parse(line.slice(6)));
          }
        }
      } catch { /* aborted */ }
    })();
    return { events, close: () => ctrl.abort() };
  }
}
async function until<T>(fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

const owner = new Client(), member = new Client(), viewer = new Client(), outsider = new Client();

before(async () => {
  mock = await startMockAnthropic();
  Object.assign(process.env, {
    ORBITAL_DATA_DIR: dir, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: mock.url,
    RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", DATABASE_URL: "",
  });
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const [c, email] of [[owner, "owner@docs.test"], [member, "member@docs.test"], [viewer, "viewer@docs.test"], [outsider, "outsider@else.test"]] as const) {
    assert.equal((await c.req("POST", "/api/auth/signup", { email, password: "long enough password" })).status, 201);
  }
  const w = await owner.req("POST", "/api/workspaces", { name: "Docs Co" });
  owner.workspace = w.data.id;
  for (const [c, email, role] of [[member, "member@docs.test", "member"], [viewer, "viewer@docs.test", "viewer"]] as const) {
    const inv = await owner.req("POST", "/api/workspace/invites", { email, role });
    assert.equal((await c.req("POST", "/api/invites/accept", { token: inv.data.link.split("/invite/")[1] })).status, 200);
  }
  member.workspace = viewer.workspace = outsider.workspace = w.data.id;
});

after(async () => {
  server?.close(); mock?.close();
  await new Promise((r) => setTimeout(r, 800));
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let docId = "";

test("two people edit the same doc at once; both edits survive and are relayed live", async () => {
  const d = await owner.req("POST", "/api/docs", { title: "Launch plan" });
  assert.equal(d.status, 201);
  docId = d.data.id;
  const live = await member.listen();

  // Both editors start from the server's (empty) state, then type concurrently.
  const start = await owner.req("GET", `/api/docs/${docId}`);
  assert.equal(start.data.canWrite, true);
  const a = new Y.Doc(), b = new Y.Doc();
  if (start.data.ydoc) { Y.applyUpdate(a, fromB64(start.data.ydoc)); Y.applyUpdate(b, fromB64(start.data.ydoc)); }
  const upd = (doc: Y.Doc, fn: () => void) => { const sv = Y.encodeStateVector(doc); fn(); return b64(Y.encodeStateAsUpdate(doc, sv)); };
  const ua = upd(a, () => a.getText("t").insert(0, "Owner writes. "));
  const ub = upd(b, () => b.getText("t").insert(0, "Member writes. "));
  const [ra, rb] = await Promise.all([
    owner.req("POST", `/api/docs/${docId}/sync`, { update: ua, client: "owner-tab" }),
    member.req("POST", `/api/docs/${docId}/sync`, { update: ub, client: "member-tab" }),
  ]);
  assert.equal(ra.status, 200, JSON.stringify(ra.data)); assert.equal(rb.status, 200, JSON.stringify(rb.data));

  // The member's window receives the owner's change, tagged with the owner's tab so it isn't echoed back.
  const relayed = await until(() => live.events.find((e) => e.type === "doc.update" && e.docId === docId && e.client === "owner-tab"));
  Y.applyUpdate(b, fromB64(relayed.update));
  live.close();

  // A late joiner (or a reconnecting tab) catches up by state vector and sees both sentences.
  const c = new Y.Doc();
  const sync = await member.req("POST", `/api/docs/${docId}/sync`, { stateVector: b64(Y.encodeStateVector(c)), client: "late-tab" });
  Y.applyUpdate(c, fromB64(sync.data.update));
  const text = c.getText("t").toString();
  assert.match(text, /Owner writes\./); assert.match(text, /Member writes\./);
  assert.equal(b.getText("t").toString(), text, "the member's editor converges on the same text");
  // Nothing missing on either side afterwards.
  const again = await member.req("POST", `/api/docs/${docId}/sync`, { stateVector: b64(Y.encodeStateVector(c)), client: "late-tab" });
  const empty = new Y.Doc(); Y.applyUpdate(empty, fromB64(again.data.update));
  assert.equal(empty.getText("t").toString(), "");
});

test("snapshots make the doc searchable and keep version history", async () => {
  const s = await member.req("PUT", `/api/docs/${docId}/snapshot`, { title: "Spring launch plan", html: "<h1>Spring launch</h1><p>Pilot with twelve salons in Austin.</p>", text: "# Spring launch\n\nPilot with twelve salons in Austin.", words: 8 });
  assert.equal(s.data.saved, true);
  assert.equal((await member.req("PUT", `/api/docs/${docId}/snapshot`, { title: "Spring launch plan", html: "<h1>Spring launch</h1><p>Pilot with twelve salons in Austin.</p>", text: "x", words: 8 })).data.saved, false, "unchanged content isn't re-saved");
  const list = await owner.req("GET", "/api/docs");
  const row = list.data.find((x: any) => x.id === docId);
  assert.equal(row.title, "Spring launch plan");
  assert.equal(row.editor_name, "member");
  const hits = await until(async () => { const r = await owner.req("GET", "/api/search/all?q=salons%20Austin"); return r.data.find((h: any) => h.id === docId) && r.data; });
  const hit = hits.find((h: any) => h.id === docId);
  assert.equal(hit.type, "doc"); assert.equal(hit.link, `/papers/${docId}`);
  // Docs live on their own page, not in the notes list.
  assert.ok(!(await owner.req("GET", "/api/documents")).data.some((x: any) => x.id === docId));

  const versions = await owner.req("GET", `/api/docs/${docId}/versions`);
  assert.equal(versions.data.length, 1);
  const named = await owner.req("POST", `/api/docs/${docId}/versions`, { label: "Sent to the team" });
  assert.equal(named.status, 201);
  const v = await owner.req("GET", `/api/docs/${docId}/versions/${named.data.id}`);
  assert.match(v.data.html, /twelve salons/);
  assert.equal(v.data.label, "Sent to the team");
});

test("comments: threads, replies, resolve; live notice", async () => {
  const thread = "7d3c1a52-8a9e-4c55-9f6a-0d2b3c4d5e6f";
  const live = await owner.listen();
  await member.req("POST", `/api/docs/${docId}/comments`, { threadId: thread, quote: "twelve salons", body: "Is twelve enough?" });
  await owner.req("POST", `/api/docs/${docId}/comments`, { threadId: thread, body: "Yes for a pilot." });
  await until(() => live.events.find((e) => e.type === "doc.comments" && e.docId === docId));
  live.close();
  const cs = await owner.req("GET", `/api/docs/${docId}/comments`);
  assert.equal(cs.data.length, 2);
  assert.equal(cs.data[0].quote, "twelve salons");
  await owner.req("PATCH", `/api/docs/${docId}/threads/${thread}`, { resolved: true });
  assert.ok((await owner.req("GET", `/api/docs/${docId}/comments`)).data.every((c: any) => c.resolved));
  const mine = cs.data.find((c: any) => c.body === "Yes for a pilot.");
  assert.equal((await member.req("DELETE", `/api/docs/${docId}/comments/${mine.id}`)).status, 403, "members can't delete others' comments");
});

test("viewers read and follow along but can't change the doc; outsiders see nothing", async () => {
  const v = await viewer.req("GET", `/api/docs/${docId}`);
  assert.equal(v.data.canWrite, false);
  const sv = await viewer.req("POST", `/api/docs/${docId}/sync`, { stateVector: b64(Y.encodeStateVector(new Y.Doc())), client: "viewer-tab" });
  assert.equal(sv.status, 200, "viewers can catch up");
  const doc = new Y.Doc(); doc.getText("t").insert(0, "viewer edit");
  assert.equal((await viewer.req("POST", `/api/docs/${docId}/sync`, { update: b64(Y.encodeStateAsUpdate(doc)), client: "viewer-tab" })).status, 403);
  assert.equal((await viewer.req("PUT", `/api/docs/${docId}/snapshot`, { title: "x", html: "", text: "", words: 0 })).status, 403);
  assert.equal((await viewer.req("POST", `/api/docs/${docId}/awareness`, { update: "AA==", client: "viewer-tab" })).status, 200, "viewers still show their cursor");
  assert.equal((await outsider.req("GET", `/api/docs/${docId}`)).status, 404);
  assert.equal((await member.req("POST", `/api/docs/${docId}/sync`, { update: "not-a-yjs-update", client: "x" })).status, 400);
});

test("star, copy (with live content), first-open seeding is claimed once, delete", async () => {
  await member.req("POST", `/api/docs/${docId}/star`, { on: true });
  assert.equal((await member.req("GET", "/api/docs?filter=starred")).data.length, 1);
  assert.equal((await owner.req("GET", "/api/docs?filter=starred")).data.length, 0, "stars are per person");
  const copy = await member.req("POST", `/api/docs/${docId}/copy`, {});
  assert.equal(copy.data.title, "Copy of Spring launch plan");
  const c = await member.req("GET", `/api/docs/${copy.data.id}`);
  const y = new Y.Doc(); Y.applyUpdate(y, fromB64(c.data.ydoc));
  assert.match(y.getText("t").toString(), /Owner writes/);

  const t = await owner.req("POST", "/api/docs", { title: "Meeting notes", html: "<h1>Meeting notes</h1>", text: "Meeting notes" });
  const claims = await Promise.all([owner.req("POST", `/api/docs/${t.data.id}/seed`), member.req("POST", `/api/docs/${t.data.id}/seed`)]);
  assert.equal(claims.filter((r) => r.data.seed).length, 1, "only one editor turns the template into live content");
  assert.equal((await member.req("DELETE", `/api/docs/${copy.data.id}`)).status, 200);
  assert.equal((await member.req("GET", `/api/docs/${copy.data.id}`)).status, 404);
});

test("writing help: rewrites a selection; 'write' uses the knowledge base", async () => {
  const before = mock.calls.length;
  const r = await member.req("POST", `/api/docs/${docId}/assist`, { action: "improve", selection: "we is going to launch soon maybe", title: "Spring launch plan" });
  assert.equal(r.status, 200);
  assert.equal(typeof r.data.text, "string");
  const call = mock.calls.slice(before).find((x) => x.body.stream);
  assert.match(JSON.stringify(call!.body.system), /writing assistant/);
  assert.match(JSON.stringify(call!.body.messages), /we is going to launch soon maybe/);
  assert.equal((await member.req("POST", `/api/docs/${docId}/assist`, { action: "improve", selection: "" })).status, 400, "rewrites need a selection");
  assert.equal((await viewer.req("POST", `/api/docs/${docId}/assist`, { action: "summarize" })).status, 403);
});
