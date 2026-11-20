import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

// Media library: streamed uploads in 1 MiB pieces, exact byte ranges for seeking (across piece
// boundaries), limits and quota, safe types only, thumbnails, rename, delete, workspace isolation.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbital-media-test-"));
Object.assign(process.env, {
  ORBITAL_DATA_DIR: dir, AI_PROVIDER: "none", DATABASE_URL: process.env.TEST_DATABASE_URL || "", ORBITAL_ALLOW_SIGNUP: "true",
  RESEARCH_WIKIPEDIA: "false", RESEARCH_OPENALEX: "false", MEDIA_MAX_MB: "3", MEDIA_QUOTA_MB: "5", TRANSCRIPTION_BASE_URL: "", OPENAI_API_KEY: "",
});
let server: Server;
let base = "";
class Client {
  cookie = "";
  ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  headers(extra: Record<string, string> = {}) { return { "x-orbital-request": "1", "x-forwarded-for": this.ip, cookie: this.cookie, ...extra }; }
  async req(method: string, url: string, body?: unknown) {
    const res = await fetch(base + url, { method, headers: this.headers({ "content-type": "application/json" }), body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text as any }; }
  }
  async upload(url: string, bytes: Uint8Array, type: string) {
    const res = await fetch(base + url, { method: "POST", headers: this.headers({ "content-type": type }), body: bytes });
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text as any }; }
  }
  raw(url: string, headers: Record<string, string> = {}) { return fetch(base + url, { headers: this.headers(headers) }); }
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

const MiB = 1024 * 1024;
const video = crypto.randomBytes(Math.floor(2.5 * MiB)); // 2.5 MiB: three pieces

test("media: a recording streams in, plays back exactly, and seeks across piece boundaries", async () => {
  const c = await signup("media@orbital.test");
  const up = await c.upload("/api/media?kind=screen_recording&title=Demo&duration=12000&width=1280&height=720", video, "video/webm;codecs=vp9");
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.size, video.length);
  assert.equal(up.data.mime, "video/webm", "codec parameters are dropped");
  assert.equal(up.data.duration_ms, 12000);
  const id = up.data.id;
  const list = (await c.req("GET", "/api/media")).data;
  assert.equal(list[0].id, id);
  assert.equal((await c.req("GET", "/api/media?type=audio")).data.length, 0);
  assert.equal((await c.req("GET", "/api/media?kind=screen_recording")).data.length, 1);

  const full = await c.raw(`/api/media/${id}/file`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(video), "the whole file comes back byte for byte");
  const check = async (range: string, from: number, to: number) => {
    const r = await c.raw(`/api/media/${id}/file`, { range });
    assert.equal(r.status, 206, range);
    assert.equal(r.headers.get("content-range"), `bytes ${from}-${to}/${video.length}`);
    assert.ok(Buffer.from(await r.arrayBuffer()).equals(video.subarray(from, to + 1)), range);
  };
  await check("bytes=0-99", 0, 99);
  await check(`bytes=${MiB - 10}-${MiB + 10}`, MiB - 10, MiB + 10);
  await check("bytes=-16", video.length - 16, video.length - 1);
  await check(`bytes=${2 * MiB}-`, 2 * MiB, video.length - 1);
  assert.equal((await c.raw(`/api/media/${id}/file`, { range: `bytes=${video.length + 5}-` })).status, 416);
  const dl = await c.raw(`/api/media/${id}/file?download=1`);
  assert.match(dl.headers.get("content-disposition") ?? "", /^attachment; filename="Demo\.webm"$/);
  await dl.arrayBuffer();

  // Thumbnail, rename, transcript search.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(500)]);
  const t = await fetch(`${base}/api/media/${id}/thumbnail`, { method: "PUT", headers: c.headers({ "content-type": "image/jpeg" }), body: jpeg });
  assert.equal(t.status, 200);
  assert.ok(Buffer.from(await (await c.raw(`/api/media/${id}/thumbnail`)).arrayBuffer()).equals(jpeg));
  const png = await fetch(`${base}/api/media/${id}/thumbnail`, { method: "PUT", headers: c.headers({ "content-type": "image/jpeg" }), body: Buffer.from("<svg onload=alert(1)>") });
  assert.equal(png.status, 415, "thumbnails must really be JPEG");
  assert.equal((await c.req("PATCH", `/api/media/${id}`, { title: "Product demo", transcript: "We walk through pricing" })).status, 200);
  assert.equal((await c.req("GET", "/api/media?q=pricing")).data[0].title, "Product demo");
  assert.equal((await c.req("POST", `/api/media/${id}/transcribe`, {})).status, 503, "no transcription service: said plainly");
});

test("media: limits, quota and safe types; nothing half-stored on refusal", async () => {
  const c = await signup("media-limits@orbital.test");
  assert.equal((await c.upload("/api/media", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"), "image/svg+xml")).status, 415);
  assert.equal((await c.upload("/api/media", Buffer.from("<html>"), "text/html")).status, 415);
  assert.equal((await c.upload("/api/media", Buffer.alloc(0), "audio/webm")).status, 400, "empty files");
  assert.equal((await c.upload("/api/media?kind=evil", Buffer.alloc(10, 1), "audio/webm")).status, 400);
  const big = await c.upload("/api/media", crypto.randomBytes(3 * MiB + 10), "video/mp4");
  assert.equal(big.status, 413, "bigger than MEDIA_MAX_MB");
  assert.equal(big.data.code, "too_large");
  const { db } = await import("../db/client.js");
  assert.equal((await db().query("SELECT 1 FROM media m JOIN users u ON u.id=m.created_by WHERE u.email='media-limits@orbital.test'")).rows.length, 0, "nothing left behind");
  assert.equal((await c.upload("/api/media", crypto.randomBytes(Math.floor(2.8 * MiB)), "audio/mpeg")).status, 201);
  const over = await c.upload("/api/media", crypto.randomBytes(Math.floor(2.8 * MiB)), "audio/mpeg");
  assert.equal(over.status, 413, "workspace quota");
  assert.equal(over.data.code, "quota");
  const usage = (await c.req("GET", "/api/media/usage")).data;
  assert.equal(usage.quota, 5 * MiB);
  assert.ok(usage.used > 2.7 * MiB && usage.used < 2.9 * MiB);
  assert.equal(usage.transcription, false);
});

test("media: other workspaces can't see, play, rename or delete it; unfinished uploads are cleaned up", async () => {
  const a = await signup("media-a@orbital.test"), b = await signup("media-b@orbital.test");
  const id = (await a.upload("/api/media?kind=voice", crypto.randomBytes(2000), "audio/webm")).data.id;
  assert.equal((await b.req("GET", `/api/media/${id}`)).status, 404);
  assert.equal((await b.raw(`/api/media/${id}/file`)).status, 404);
  assert.equal((await b.req("PATCH", `/api/media/${id}`, { title: "pwned" })).status, 404);
  await b.req("DELETE", `/api/media/${id}`);
  assert.equal((await a.req("GET", `/api/media/${id}`)).data.title.startsWith("Voice recording"), true, "still there, default title");
  assert.deepEqual((await b.req("GET", "/api/media")).data, []);
  assert.equal((await new Client().req("GET", "/api/media")).status, 401);
  assert.equal((await a.req("DELETE", `/api/media/${id}`)).status, 200);
  assert.equal((await a.req("GET", `/api/media/${id}`)).status, 404);
  const { db } = await import("../db/client.js");
  const ws = (await db().query<any>("SELECT id FROM workspaces LIMIT 1")).rows[0].id;
  const stale = (await db().query<any>("INSERT INTO media(workspace_id, kind, mime, status, created_at) VALUES ($1,'upload','video/webm','uploading', now() - interval '2 days') RETURNING id", [ws])).rows[0].id;
  const { runHousekeeping } = await import("../lib/housekeeping.js");
  await runHousekeeping();
  assert.equal((await db().query("SELECT 1 FROM media WHERE id=$1", [stale])).rows.length, 0);
});
