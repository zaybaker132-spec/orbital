import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http, { type Server } from "node:http";
import { zipSync, strToU8 } from "fflate";
import { startMockAnthropic } from "./mockAnthropic.js";

// Files, web clipper, reminders and nudges, project tracking, focus sessions, universal search, voice.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-prod-test-"));
let server: Server, site: Server, stt: Server, mock: Awaited<ReturnType<typeof startMockAnthropic>>;
let base = "", siteUrl = "", sttCalls = 0;

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
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* binary */ }
    return { status: res.status, data, text, headers: res.headers };
  }
  async upload(url: string, name: string, bytes: Uint8Array, type: string, field = "file") {
    const fd = new FormData();
    fd.append(field, new Blob([new Uint8Array(bytes)], { type }), name);
    const res = await fetch(base + url, { method: "POST", headers: { "x-orbital-request": "1", cookie: this.cookie }, body: fd });
    const data: any = await res.json().catch(() => null);
    return { status: res.status, data };
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

const ARTICLE = `<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="How salons lose 20% of bookings">
<meta property="og:site_name" content="Salon Weekly"><meta name="author" content="Dana Ruiz">
<meta property="article:published_time" content="2025-03-04T10:00:00Z">
<script>window.tracking = "should not appear";</script><style>.x{color:red}</style></head>
<body><nav><a href="/">Home</a> <a href="/subscribe">Subscribe now</a></nav>
<article><h1>How salons lose 20% of bookings</h1>
<p>Missed calls are the <strong>biggest</strong> source of lost appointments for small salons, according to a survey of 400 owners.</p>
<p>Owners who added online booking recovered most of those appointments within three months &amp; reported fewer no-shows.</p>
<ul><li>Missed calls during service</li><li>No reminder texts</li></ul>
<p>Read the <a href="/methodology">full methodology</a>.</p></article>
<footer>Copyright Salon Weekly</footer></body></html>`;

const owner = new Client(), other = new Client();

before(async () => {
  mock = await startMockAnthropic();
  site = http.createServer((req, res) => {
    if (req.url === "/article") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(ARTICLE); }
    if (req.url === "/moved") { res.writeHead(302, { location: "/article" }); return res.end(); }
    if (req.url === "/private") { res.writeHead(403); return res.end("no"); }
    res.writeHead(404); res.end();
  });
  stt = http.createServer((req, res) => {
    let n = 0;
    req.on("data", (c) => (n += c.length));
    req.on("end", () => { sttCalls++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ text: ` heard ${n > 0 ? "audio" : "nothing"} ` })); });
  });
  await Promise.all([new Promise<void>((r) => site.listen(0, () => r())), new Promise<void>((r) => stt.listen(0, () => r()))]);
  const sa = site.address(), ta = stt.address();
  siteUrl = `http://127.0.0.1:${typeof sa === "object" && sa ? sa.port : 0}`;
  Object.assign(process.env, {
    ORBITAL_DATA_DIR: dir, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: mock.url,
    RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", DATABASE_URL: process.env.TEST_DATABASE_URL || "",
    TRANSCRIPTION_BASE_URL: `http://127.0.0.1:${typeof ta === "object" && ta ? ta.port : 0}/v1`, TRANSCRIPTION_API_KEY: "stt-test-key",
  });
  const { createApp } = await import("../index.js");
  const app = await createApp();
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  assert.equal((await owner.req("POST", "/api/auth/signup", { email: "owner@example.com", password: "a long enough password" })).status, 201);
  assert.equal((await other.req("POST", "/api/auth/signup", { email: "other@example.com", password: "another long password" })).status, 201);
});

after(async () => {
  server?.close(); site?.close(); stt?.close(); mock?.close();
  const { stopReminders } = await import("../engines/reminders.js");
  stopReminders();
  const { db } = await import("../db/client.js");
  await db().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── File intelligence ──────────────────────────────────────────────────────
const docx = () => zipSync({
  "[Content_Types].xml": strToU8("<Types/>"),
  "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly plan</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Expand into </w:t></w:r><w:r><w:t>Lisbon &amp; Porto</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Hire two stylists</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>City</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Budget</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>Lisbon</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`),
});
const xlsx = () => zipSync({
  "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Revenue" sheetId="1" r:id="rId1"/></sheets></workbook>`),
  "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
  "xl/sharedStrings.xml": strToU8(`<sst><si><t>Month</t></si><si><t>Revenue</t></si><si><r><t>Jan</t></r><r><t>uary</t></r></si></sst>`),
  "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1250.5</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>February</t></is></c><c r="B3"><v>980</v></c></row>
  </sheetData></worksheet>`),
});
const pptx = () => zipSync({
  "ppt/slides/slide1.xml": strToU8(`<p:sld><a:p><a:r><a:t>Launch plan</a:t></a:r></a:p><a:p><a:r><a:t>Ship booking in May</a:t></a:r></a:p></p:sld>`),
  "ppt/slides/slide2.xml": strToU8(`<p:sld><a:p><a:r><a:t>Risks</a:t></a:r></a:p></p:sld>`),
  "ppt/notesSlides/notesSlide1.xml": strToU8(`<p:notes><a:p><a:r><a:t>Mention the waitlist</a:t></a:r></a:p></p:notes>`),
});
// 1x1 transparent PNG
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

test("files: Word, Excel and PowerPoint become searchable Markdown", async () => {
  const w = await owner.upload("/api/documents/upload", "plan.docx", docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(w.status, 201, JSON.stringify(w.data));
  const wd = (await owner.req("GET", `/api/documents/${w.data.id}`)).data;
  assert.equal(wd.kind, "docx");
  assert.match(wd.body, /^# Quarterly plan/m);
  assert.match(wd.body, /Expand into Lisbon & Porto/);
  assert.match(wd.body, /^- Hire two stylists/m);
  assert.match(wd.body, /\| City \| Budget \|\n\| --- \| --- \|\n\| Lisbon \| 40000 \|/);

  const x = await owner.upload("/api/documents/upload", "numbers.xlsx", xlsx(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(x.status, 201, JSON.stringify(x.data));
  const xd = (await owner.req("GET", `/api/documents/${x.data.id}`)).data;
  assert.match(xd.body, /## Revenue/);
  assert.match(xd.body, /\| January \|  \| 1250.5 \|/, "rich-text shared strings joined; empty column kept in place");
  assert.match(xd.body, /\| February \| 980 \|/);

  const p = await owner.upload("/api/documents/upload", "deck.pptx", pptx(), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(p.status, 201);
  const pd = (await owner.req("GET", `/api/documents/${p.data.id}`)).data;
  assert.match(pd.body, /## Slide 1: Launch plan\n\nShip booking in May\n\n_Notes:_ Mention the waitlist/);
  assert.match(pd.body, /## Slide 2: Risks/);

  assert.equal((await owner.upload("/api/documents/upload", "fake.docx", Uint8Array.from([1, 2, 3, 4]), "application/octet-stream")).status, 415, "not a zip");
  assert.equal((await owner.upload("/api/documents/upload", "broken.xlsx", Uint8Array.from([0x50, 0x4b, 3, 4, 9, 9]), "application/octet-stream")).status, 400);
  assert.equal((await owner.upload("/api/documents/upload", "tool.exe", Uint8Array.from([77, 90]), "application/octet-stream")).status, 415);
});

test("files: images are read by the AI provider and served back only to their workspace", async () => {
  const before = mock.calls.length;
  const r = await owner.upload("/api/documents/upload", "whiteboard.png", PNG, "image/png");
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const call = mock.calls.slice(before).find((c) => Array.isArray(c.body.messages?.[0]?.content));
  const blocks = call!.body.messages[0].content;
  assert.equal(blocks[0].type, "image");
  assert.equal(blocks[0].source.media_type, "image/png");
  assert.equal(blocks[0].source.data, Buffer.from(PNG).toString("base64"));
  const d = (await owner.req("GET", `/api/documents/${r.data.id}`)).data;
  assert.equal(d.kind, "image");
  assert.equal(d.ai_generated, true, "AI-read text is labelled");
  assert.ok(d.body.length > 10);
  const file = await owner.req("GET", `/api/documents/${r.data.id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal((await other.req("GET", `/api/documents/${r.data.id}/file`)).status, 404, "another person's workspace can't fetch it");
  // An image extension with the wrong bytes is rejected.
  assert.equal((await owner.upload("/api/documents/upload", "fake.png", strToU8("<svg onload=alert(1)>"), "image/png")).status, 415);
});

// ── Web clipper ────────────────────────────────────────────────────────────
test("clipper: article extraction keeps the story and drops the chrome", async () => {
  const { extractArticle } = await import("../engines/clipper.js");
  const a = extractArticle(ARTICLE, "https://salonweekly.example/article");
  assert.equal(a.title, "How salons lose 20% of bookings");
  assert.equal(a.site, "Salon Weekly");
  assert.equal(a.author, "Dana Ruiz");
  assert.equal(a.published, "2025-03-04");
  assert.match(a.markdown, /Missed calls are the \*\*biggest\*\* source/);
  assert.match(a.markdown, /three months & reported/);
  assert.match(a.markdown, /- Missed calls during service/);
  assert.match(a.markdown, /\[full methodology\]\(https:\/\/salonweekly\.example\/methodology\)/, "relative links made absolute");
  assert.doesNotMatch(a.markdown, /tracking|Subscribe now|Copyright|color:red/);
});

test("clipper: refuses private addresses, saves pages and selections, dedupes", async () => {
  // This test server isn't in desktop mode and doesn't allow private targets.
  const blocked = await owner.req("POST", "/api/clip", { url: `${siteUrl}/article` });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /private or local network/);
  assert.equal((await owner.req("POST", "/api/clip", { url: "file:///etc/passwd" })).status, 400);

  process.env.ORBITAL_ALLOW_PRIVATE_WEBHOOKS = "true"; // let the clipper reach the local test site
  try {
    const r = await owner.req("POST", "/api/clip", { url: `${siteUrl}/moved`, note: "For the pricing page" });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const d = (await owner.req("GET", `/api/documents/${r.data.id}`)).data;
    assert.equal(d.kind, "web_clip");
    assert.equal(d.title, "How salons lose 20% of bookings");
    assert.equal(d.source_url, `${siteUrl}/article`, "redirect followed and recorded");
    assert.ok(d.tags.includes("web-clip"));
    assert.match(d.body, /\*\*My note:\*\* For the pricing page/);
    assert.match(d.body, /Missed calls are the/);

    const again = await owner.req("POST", "/api/clip", { url: `${siteUrl}/article` });
    assert.equal(again.data.existing, true);
    assert.equal(again.data.id, r.data.id);

    // A page that blocks fetching still saves the highlighted text.
    const sel = await owner.req("POST", "/api/clip", { url: `${siteUrl}/private`, title: "Members-only report", selection: "Retention rose 12% after reminders." });
    assert.equal(sel.status, 201);
    assert.equal(sel.data.partial, true);
    const sd = (await owner.req("GET", `/api/documents/${sel.data.id}`)).data;
    assert.match(sd.body, /> Retention rose 12% after reminders\./);
    assert.match(sd.body, /couldn't be saved/);
    assert.equal((await owner.req("POST", "/api/clip", { url: `${siteUrl}/private?page=2` })).status, 422, "nothing to save");
  } finally {
    delete process.env.ORBITAL_ALLOW_PRIVATE_WEBHOOKS;
  }
});

// ── Projects, reminders, nudges ────────────────────────────────────────────
let projectId = "", taskLate = "", taskSoon = "";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("projects: deadline, progress and overdue counts", async () => {
  const p = await owner.req("POST", "/api/projects", { name: "Salon booking app", deadline: day(5) });
  assert.equal(p.status, 201);
  projectId = p.data.id;
  assert.equal(p.data.deadline, day(5));
  taskLate = (await owner.req("POST", `/api/projects/${projectId}/tasks`, { title: "Interview five owners", dueDate: day(-2) })).data.id;
  taskSoon = (await owner.req("POST", `/api/projects/${projectId}/tasks`, { title: "Draft pricing", dueDate: day(1) })).data.id;
  const t3 = (await owner.req("POST", `/api/projects/${projectId}/tasks`, { title: "Pick a name" })).data.id;
  await owner.req("PATCH", `/api/tasks/${t3}`, { done: true });
  await owner.req("POST", `/api/projects/${projectId}/milestones`, { title: "MVP", targetDate: day(2) });
  const list = (await owner.req("GET", `/api/projects?today=${day(0)}`)).data;
  const row = list.find((x: any) => x.id === projectId);
  assert.deepEqual([row.task_count, row.tasks_done, row.tasks_overdue, row.milestone_count, row.milestones_done], [3, 1, 1, 1, 0]);
  assert.equal(row.next_due, day(-2));
  assert.equal((await owner.req("PATCH", `/api/projects/${projectId}`, { deadline: null })).data.deadline, null, "deadline can be cleared");
  assert.equal((await owner.req("PATCH", `/api/projects/${projectId}`, { deadline: day(5) })).data.deadline, day(5));
  assert.equal((await owner.req("PATCH", `/api/projects/${projectId}`, { deadline: "next friday" })).status, 400);
});

test("nudges: overdue and upcoming work, deadlines, stale ideas; dismiss and snooze", async () => {
  const idea = (await owner.req("POST", "/api/documents", { title: "Loyalty card idea", body: "Stamp card for repeat clients", tags: ["idea"] })).data;
  const { db } = await import("../db/client.js");
  await db().query("UPDATE documents SET updated_at = now() - interval '9 days' WHERE id=$1", [idea.id]);
  const nudges = (await owner.req("GET", `/api/nudges?today=${day(0)}`)).data;
  const kinds = (k: string) => nudges.filter((n: any) => n.kind === k);
  assert.equal(kinds("overdue")[0].itemId, taskLate);
  assert.match(kinds("overdue")[0].detail, /overdue by 2 days/);
  assert.equal(kinds("due_soon")[0].itemId, taskSoon);
  assert.match(kinds("due_soon")[0].detail, /due tomorrow/);
  assert.ok(kinds("milestone").length === 1);
  assert.match(kinds("deadline")[0].detail, /in 5 days · 33% of tasks done/);
  assert.equal(kinds("unfinished_idea")[0].itemId, idea.id);
  assert.equal(nudges[0].kind, "overdue", "most urgent first");
  assert.equal((await other.req("GET", `/api/nudges?today=${day(0)}`)).data.length, 0, "another person's workspace is separate");

  assert.equal((await owner.req("POST", "/api/nudges/dismiss", { key: kinds("overdue")[0].key })).status, 200);
  assert.equal((await owner.req("POST", "/api/nudges/dismiss", { key: kinds("unfinished_idea")[0].key, snoozeDays: 3 })).status, 200);
  assert.equal((await owner.req("POST", "/api/nudges/dismiss", { key: "'; drop table users; --" })).status, 400);
  const after = (await owner.req("GET", `/api/nudges?today=${day(0)}`)).data;
  assert.ok(!after.some((n: any) => n.kind === "overdue" || n.kind === "unfinished_idea"));
  assert.ok(after.some((n: any) => n.kind === "due_soon"));
});

test("reminders: personal, fire on time over the live stream, snooze and finish", async () => {
  const { tickReminders } = await import("../engines/reminders.js");
  const later = await owner.req("POST", "/api/reminders", { itemType: "task", itemId: taskSoon, dueAt: new Date(Date.now() + 3_600_000).toISOString() });
  assert.equal(later.status, 201);
  assert.equal(later.data.title, "Draft pricing", "title taken from the task");
  assert.equal((await owner.req("POST", "/api/reminders", { dueAt: new Date().toISOString() })).status, 400, "needs a title or an item");
  assert.equal((await other.req("POST", "/api/reminders", { itemType: "task", itemId: taskSoon, dueAt: new Date().toISOString() })).status, 404, "can't point at another workspace's task");

  // Listen to the live stream, then set a reminder that is already due.
  const ac = new AbortController();
  const events: any[] = [];
  const stream = await fetch(base + "/api/events", { headers: { cookie: owner.cookie }, signal: ac.signal });
  const otherStream = await fetch(base + "/api/events", { headers: { cookie: other.cookie }, signal: ac.signal });
  const otherEvents: any[] = [];
  const pump = async (res: Response, sink: any[]) => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (const m of buf.split("\n\n").slice(0, -1)) if (m.startsWith("data: ")) sink.push(JSON.parse(m.slice(6)));
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    } catch { /* aborted */ }
  };
  void pump(stream, events); void pump(otherStream, otherEvents);
  await until(async () => events.length > 0 && otherEvents.length > 0);
  const now = await owner.req("POST", "/api/reminders", { title: "Call the accountant", note: "Ask about VAT", dueAt: new Date(Date.now() - 1000).toISOString() });
  const fired = await until(async () => events.find((e) => e.type === "reminder" && e.id === now.data.id));
  assert.equal(fired.title, "Call the accountant");
  assert.equal(fired.note, "Ask about VAT");
  assert.ok(!otherEvents.some((e) => e.type === "reminder"), "reminders reach only their owner");
  ac.abort();

  let mine = (await owner.req("GET", "/api/reminders")).data;
  assert.equal(mine.find((r: any) => r.id === now.data.id).status, "fired");
  assert.equal(mine.find((r: any) => r.id === later.data.id).link, `/projects/${projectId}`);
  assert.equal((await other.req("GET", "/api/reminders")).data.length, 0);
  assert.equal((await other.req("PATCH", `/api/reminders/${now.data.id}`, { status: "done" })).status, 404, "can't touch someone else's");

  const snoozed = await owner.req("PATCH", `/api/reminders/${now.data.id}`, { dueAt: new Date(Date.now() + 600_000).toISOString() });
  assert.equal(snoozed.data.status, "scheduled", "snoozing reschedules a fired reminder");
  assert.equal(await tickReminders(), 0, "nothing due yet");
  assert.equal((await owner.req("PATCH", `/api/reminders/${now.data.id}`, { status: "done" })).data.status, "done");
  assert.equal((await owner.req("DELETE", `/api/reminders/${later.data.id}`)).status, 200);
  mine = (await owner.req("GET", "/api/reminders")).data;
  assert.ok(!mine.some((r: any) => r.status === "scheduled"));
});

// ── Focus ──────────────────────────────────────────────────────────────────
test("focus: one session at a time, notes saved to Knowledge, tasks finished are counted", async () => {
  const first = await owner.req("POST", "/api/focus", { objective: "Warm-up", plannedMinutes: 25 });
  assert.equal(first.status, 201);
  const s = await owner.req("POST", "/api/focus", { objective: "Draft pricing", projectId, plannedMinutes: 50 });
  assert.equal(s.status, 201);
  assert.equal(s.data.project_name, "Salon booking app");
  const state = (await owner.req("GET", "/api/focus")).data;
  assert.equal(state.active.id, s.data.id, "starting a new session closes the old one");
  assert.ok(state.recent.some((r: any) => r.id === first.data.id));

  const n1 = await owner.req("PATCH", `/api/focus/${s.data.id}`, { notes: "Three tiers: basic, pro, team", focusedSeconds: 300 });
  assert.ok(n1.data.document_id);
  await owner.req("PATCH", `/api/focus/${s.data.id}`, { notes: "Three tiers: basic, pro, team. Annual discount 20%.", focusedSeconds: 120 });
  const doc = (await owner.req("GET", `/api/documents/${n1.data.document_id}`)).data;
  assert.equal(doc.title, "Focus: Draft pricing");
  assert.match(doc.body, /Annual discount/);
  assert.equal(doc.project_id, projectId);

  await owner.req("PATCH", `/api/tasks/${taskSoon}`, { done: true });
  const ended = await owner.req("POST", `/api/focus/${s.data.id}/end`, { focusedSeconds: 1500, outcome: "Pricing drafted" });
  assert.equal(ended.data.tasks_completed, 1);
  assert.equal(ended.data.focused_seconds, 1500);
  assert.equal((await owner.req("PATCH", `/api/focus/${s.data.id}`, { notes: "late" })).status, 409);
  const week = (await owner.req("GET", "/api/focus")).data;
  assert.equal(week.active, null);
  assert.equal(week.week.sessions, 2);
  assert.equal((await other.req("POST", `/api/focus/${s.data.id}/end`, { focusedSeconds: 1 })).status, 404);
});

// ── Universal search ───────────────────────────────────────────────────────
test("search: finds words inside conversations, notes, files, clips and research, with highlights", async () => {
  const c = await owner.req("POST", "/api/conversations", {});
  await owner.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "Should I offer a membership tier for balayage clients?" });
  const oc = await other.req("POST", "/api/conversations", {});
  await other.req("POST", `/api/conversations/${oc.data.id}/messages`, { content: "Secret balayage plans for my own salon" });
  const { db } = await import("../db/client.js");
  const me = (await owner.req("GET", "/api/auth/me")).data.user.id;
  await db().query(
    "INSERT INTO research_sessions(workspace_id, question, status, report) VALUES ($1, 'What do salons charge for colour?', 'completed', $2)",
    [me, JSON.stringify({ executive_summary: "Balayage averages $180 in large cities.", findings: [{ statement: "Prices vary by region." }] })]);
  await until(async () => (await owner.req("GET", "/api/search/all?q=Lisbon")).data.length > 0);

  const hits = (await owner.req("GET", "/api/search/all?q=balayage")).data;
  const types = new Set(hits.map((h: any) => h.type));
  assert.ok(types.has("conversation") && types.has("research"), JSON.stringify(hits));
  const conv = hits.find((h: any) => h.type === "conversation");
  assert.match(conv.snippet, /⟦balayage⟧/);
  assert.equal(conv.link, `/c/${c.data.id}`);
  assert.ok(!hits.some((h: any) => h.id === oc.data.id), "another person's conversations never appear");

  assert.equal((await owner.req("GET", "/api/search/all?q=Lisbon")).data[0].type, "file", "words inside a Word file");
  assert.equal((await owner.req("GET", "/api/search/all?q=methodology&types=clip")).data[0].type, "clip");
  assert.ok((await owner.req("GET", "/api/search/all?q=February")).data.some((h: any) => h.meta.startsWith("Spreadsheet")));
  const onlyTasks = (await owner.req("GET", "/api/search/all?q=pricing&types=task")).data;
  assert.ok(onlyTasks.length && onlyTasks.every((h: any) => h.type === "task"));
  assert.ok(onlyTasks.some((h: any) => /done/.test(h.meta)));
  assert.equal((await owner.req("GET", '/api/search/all?q="loyalty card" -nothing')).data[0].title, "Loyalty card idea", "websearch syntax");
  assert.deepEqual((await owner.req("GET", "/api/search/all?q=")).data, []);
  assert.equal((await owner.req("GET", "/api/search/all?q=%25%25%25")).status, 200, "wildcards are escaped");
});

// ── Voice and memory ───────────────────────────────────────────────────────
test("voice: server transcription and saving a conversation to memory", async () => {
  assert.equal((await owner.req("GET", "/api/voice/config")).data.serverTranscription, true);
  const r = await owner.upload("/api/voice/transcribe", "speech.webm", new Uint8Array(4000).fill(7), "audio/webm", "audio");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text, "heard audio");
  assert.equal(sttCalls, 1);
  assert.equal((await owner.upload("/api/voice/transcribe", "x.txt", new Uint8Array(4000), "text/plain", "audio")).status, 415);

  const c = await owner.req("POST", "/api/conversations", {});
  await owner.req("POST", `/api/conversations/${c.data.id}/messages`, { content: "I want to open a second salon in Porto next spring. Help me plan it." });
  const saved = await owner.req("POST", `/api/conversations/${c.data.id}/remember`);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.ai, true);
  assert.equal(saved.data.aiError, null);
  // The goal is remembered (by this save, or already by the chat's own extraction; never twice).
  const note = (await owner.req("GET", `/api/documents/${saved.data.documentId}`)).data;
  assert.match(note.body, /\*\*You:\*\* I want to open a second salon in Porto/);
  assert.ok(note.tags.includes("conversation"));
  const again = await owner.req("POST", `/api/conversations/${c.data.id}/remember`);
  assert.equal(again.data.documentId, saved.data.documentId, "saving again refreshes the same note");
  const mems = await until(async () => { const m = (await owner.req("GET", "/api/memories")).data; return m.some((x: any) => /Porto/.test(x.content)) && m; });
  assert.equal(mems.filter((m: any) => /Porto/.test(m.content)).length, 1);
  // Let background indexing and extraction finish before the database closes.
  const { db } = await import("../db/client.js");
  await until(async () => (await db().query<any>("SELECT count(*)::int AS n FROM jobs WHERE status IN ('queued','running')")).rows[0].n === 0);
  assert.equal((await other.req("POST", `/api/conversations/${c.data.id}/remember`)).status, 404);
});

test("activity calendar: a year of days, colour-coded by kind, per project and in the viewer's time zone", async () => {
  const { db } = await import("../db/client.js");
  const me = (await owner.req("GET", "/api/auth/me")).data.user.id;
  // Three tasks done on one day ten days ago (11:30 UTC), one note the day before.
  for (let i = 0; i < 3; i++) await db().query("INSERT INTO activity_events(workspace_id, type, title, ref_type, ref_id, created_at) VALUES ($1,'task.completed','t','project',$2, date_trunc('day', now()) - interval '10 days' + interval '11 hours 30 minutes')", [me, projectId]);
  await db().query("INSERT INTO documents(workspace_id, title, body, created_at) VALUES ($1,'Old note','x', date_trunc('day', now()) - interval '11 days' + interval '11 hours')", [me]);

  const cal = (await owner.req("GET", "/api/activity/calendar?tz=UTC")).data;
  assert.equal(cal.days.length, 371);
  assert.equal(cal.days[cal.days.length - 1].date, new Date().toISOString().slice(0, 10), "ends today");
  const tenAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  const d10 = cal.days.find((d: any) => d.date === tenAgo);
  assert.ok(d10.build >= 3, JSON.stringify(d10));
  assert.ok(cal.totals.knowledge >= 1 && cal.totals.thinking >= 1 && cal.totals.research >= 1);
  assert.equal(cal.total, cal.days.reduce((s: number, d: any) => s + d.total, 0));
  assert.ok(cal.currentStreak >= 1, "activity today starts a streak");

  // In Tokyo (UTC+9) 11:30 UTC is 20:30 the same day, so the day doesn't move.
  const tokyo = (await owner.req("GET", "/api/activity/calendar?tz=Asia/Tokyo")).data;
  assert.ok(tokyo.days.find((d: any) => d.date === tenAgo).build >= 3);
  const bogus = (await owner.req("GET", "/api/activity/calendar?tz=Not/AZone")).data;
  assert.equal(bogus.timeZone, "UTC");

  const proj = (await owner.req("GET", `/api/activity/calendar?tz=UTC&project=${projectId}`)).data;
  assert.equal(proj.days.find((d: any) => d.date === tenAgo).build, 3, "only this project's work");
  assert.equal(proj.totals.knowledge >= 1, true, "the focus note linked to the project counts");
  assert.ok(proj.total < cal.total);
  assert.equal((await other.req("GET", `/api/activity/calendar?project=${projectId}`)).status, 404);
  assert.equal((await other.req("GET", "/api/activity/calendar")).data.totals.build, 0, "another person's workspace is separate");
});
