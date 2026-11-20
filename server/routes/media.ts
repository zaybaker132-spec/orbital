import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { actor, ah, HttpError, idParam, parse, ws } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { requireRole } from "../auth/workspace.js";
import { transcribeAudio, transcriptionAvailable } from "../lib/transcribe.js";
import { logActivity } from "../lib/activity.js";

/**
 * Media library: screenshots, screen recordings, voice and camera recordings, meeting recordings and
 * uploaded images, video and audio, shared within the workspace like notes. Uploads stream straight
 * into 1 MiB pieces in the database (never a whole video in memory); playback serves HTTP ranges so
 * long videos seek instantly.
 */
export const media = Router();

export const CHUNK = 1024 * 1024;
const KINDS = ["screenshot", "screen_recording", "voice", "recording", "meeting", "upload"] as const;
/** Formats browsers can show or play. No SVG or HTML: nothing that can carry script. */
const MIME = /^(image\/(png|jpeg|webp|gif)|video\/(webm|mp4|quicktime|ogg|x-matroska)|audio\/(webm|ogg|mpeg|mp4|wav|x-wav|wave|aac|x-m4a|flac))$/;
const COLS = "id, kind, title, mime, size::float8 AS size, duration_ms, width, height, status, meeting_code, (thumbnail IS NOT NULL) AS has_thumbnail, length(transcript) > 0 AS has_transcript, created_by, created_at, updated_at";

const maxBytes = () => config.media.maxMb * CHUNK;
async function usedBytes(workspaceId: string) {
  return Number((await db().query<{ n: string }>("SELECT COALESCE(sum(size), 0)::bigint AS n FROM media WHERE workspace_id=$1", [workspaceId])).rows[0].n);
}
async function own(workspaceId: string, id: string) {
  const m = (await db().query<any>(`SELECT ${COLS}, transcript FROM media WHERE id=$1 AND workspace_id=$2 AND status='complete'`, [id, workspaceId])).rows[0];
  if (!m) throw new HttpError(404, "Not found", "not_found");
  return m;
}
const baseMime = (h: string | undefined) => (h ?? "").split(";")[0].trim().toLowerCase();

media.get("/media/usage", ah(async (req, res) => {
  res.json({ used: await usedBytes(ws(req)), quota: config.media.quotaMb ? config.media.quotaMb * CHUNK : null, maxFile: maxBytes(), transcription: transcriptionAvailable() });
}));

media.get("/media", ah(async (req, res) => {
  const q = parse(z.object({ kind: z.enum(KINDS).optional(), type: z.enum(["image", "video", "audio"]).optional(), q: z.string().trim().max(200).optional() }), req.query);
  const params: unknown[] = [ws(req)];
  let where = "workspace_id=$1 AND status='complete'";
  if (q.kind) { params.push(q.kind); where += ` AND kind=$${params.length}`; }
  if (q.type) { params.push(`${q.type}/%`); where += ` AND mime LIKE $${params.length}`; }
  if (q.q) { params.push(`%${q.q}%`); where += ` AND (title ILIKE $${params.length} OR transcript ILIKE $${params.length})`; }
  res.json((await db().query(`SELECT ${COLS} FROM media WHERE ${where} ORDER BY created_at DESC LIMIT 500`, params)).rows);
}));

media.get("/media/:id", ah(async (req, res) => { res.json(await own(ws(req), idParam(req))); }));

/**
 * Upload: the request body is the file itself (Content-Type = its type); details in the query string.
 * Streams into the database a piece at a time, enforcing the size limit and the workspace's storage.
 */
media.post("/media", rateLimit({ windowMs: 60_000, max: 30, key: "user", name: "media-upload" }), ah(async (req: Request, res: Response) => {
  const mime = baseMime(req.get("content-type"));
  if (!MIME.test(mime)) throw new HttpError(415, "That kind of file can't go in the media library. Images (PNG, JPEG, WebP, GIF), video (WebM, MP4, MOV) and audio (WebM, MP3, M4A, WAV, OGG, FLAC) can.", "unsupported_media");
  const meta = parse(z.object({
    kind: z.enum(KINDS).default("upload"), title: z.string().trim().max(200).default(""),
    duration: z.coerce.number().int().min(0).max(24 * 3600_000).optional(), width: z.coerce.number().int().min(1).max(20000).optional(),
    height: z.coerce.number().int().min(1).max(20000).optional(), meeting: z.string().regex(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/).optional(),
  }), req.query);
  const declared = Number(req.get("content-length") || 0);
  if (declared > maxBytes()) throw new HttpError(413, `Files can be up to ${config.media.maxMb} MB.`, "too_large");
  const quota = config.media.quotaMb * CHUNK;
  const used = quota ? await usedBytes(ws(req)) : 0;
  if (quota && used + declared > quota) throw new HttpError(413, "This workspace's media storage is full. Delete some recordings to make room.", "quota");

  const id = (await db().query<{ id: string }>(
    "INSERT INTO media(workspace_id, created_by, kind, title, mime, duration_ms, width, height, meeting_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
    [ws(req), actor(req), meta.kind, meta.title, mime, meta.duration ?? null, meta.width ?? null, meta.height ?? null, meta.meeting ?? null])).rows[0].id;
  let size = 0, seq = 0, pending: Buffer[] = [], pendingLen = 0;
  const flush = async (all: boolean) => {
    let buf = Buffer.concat(pending); pending = []; pendingLen = 0;
    while (buf.length >= CHUNK || (all && buf.length > 0)) {
      const piece = buf.subarray(0, CHUNK);
      await db().query("INSERT INTO media_chunks(media_id, seq, data) VALUES ($1,$2,$3)", [id, seq++, Buffer.from(piece)]);
      buf = buf.subarray(piece.length);
    }
    if (buf.length) { pending = [buf]; pendingLen = buf.length; }
  };
  try {
    for await (const part of req as AsyncIterable<Buffer>) {
      size += part.length;
      if (size > maxBytes()) throw new HttpError(413, `Files can be up to ${config.media.maxMb} MB.`, "too_large");
      if (quota && used + size > quota) throw new HttpError(413, "This workspace's media storage is full. Delete some recordings to make room.", "quota");
      pending.push(part); pendingLen += part.length;
      if (pendingLen >= CHUNK) await flush(false);
    }
    await flush(true);
    if (size === 0) throw new HttpError(400, "The file was empty.", "empty");
    const title = meta.title || defaultTitle(meta.kind);
    const row = (await db().query(`UPDATE media SET size=$2, status='complete', title=$3, updated_at=now() WHERE id=$1 RETURNING ${COLS}`, [id, size, title])).rows[0];
    await logActivity(ws(req), "media.created", title, { type: "media", id }).catch(() => {});
    res.status(201).json(row);
  } catch (e) {
    await db().query("DELETE FROM media WHERE id=$1", [id]).catch(() => {});
    if (!res.headersSent && e instanceof HttpError) req.resume(); // drain what's left so the error reaches the browser
    throw e;
  }
}));

function defaultTitle(kind: (typeof KINDS)[number]) {
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  return ({ screenshot: "Screenshot", screen_recording: "Screen recording", voice: "Voice recording", recording: "Recording", meeting: "Meeting recording", upload: "Upload" } as const)[kind] + ` ${when}`;
}

/** The file, with HTTP range support (seeking). ?download=1 saves it instead of playing it. */
media.get("/media/:id/file", ah(async (req, res) => {
  const m = await own(ws(req), idParam(req));
  const size = Number(m.size);
  const ext = m.mime.split("/")[1].replace("x-", "").replace("quicktime", "mov").replace("jpeg", "jpg").replace("mpeg", "mp3").replace("x-matroska", "mkv");
  const name = `${(m.title || "media").replace(/[^\w .()-]+/g, "").slice(0, 80) || "media"}.${ext}`;
  res.set({
    "content-type": m.mime, "accept-ranges": "bytes", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; media-src 'self'; img-src 'self'", "content-disposition": `${req.query.download === "1" ? "attachment" : "inline"}; filename="${name}"`,
  });
  let start = 0, end = size - 1, partial = false;
  const range = req.get("range");
  if (range) {
    const r = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!r || (r[1] === "" && r[2] === "")) { res.status(416).set("content-range", `bytes */${size}`).end(); return; }
    if (r[1] === "") { start = Math.max(0, size - Number(r[2])); } else { start = Number(r[1]); if (r[2] !== "") end = Math.min(end, Number(r[2])); }
    if (start >= size || start > end) { res.status(416).set("content-range", `bytes */${size}`).end(); return; }
    // An open-ended range ("bytes=0-") gets 8 MB at a time; players ask for more as they go.
    if (r[2] === "") end = Math.min(end, start + 8 * CHUNK - 1);
    partial = true;
  }
  res.status(partial ? 206 : 200).set("content-length", String(end - start + 1));
  if (partial) res.set("content-range", `bytes ${start}-${end}/${size}`);
  if (req.method === "HEAD") { res.end(); return; }
  for (let seq = Math.floor(start / CHUNK); seq <= Math.floor(end / CHUNK); seq++) {
    const row = (await db().query<{ data: Buffer }>("SELECT data FROM media_chunks WHERE media_id=$1 AND seq=$2", [m.id, seq])).rows[0];
    if (!row) break;
    const data = Buffer.from(row.data), base = seq * CHUNK;
    const slice = data.subarray(Math.max(0, start - base), Math.min(data.length, end - base + 1));
    if (!res.write(slice)) await new Promise((r) => res.once("drain", r));
    if (res.destroyed) return;
  }
  res.end();
}));

media.get("/media/:id/thumbnail", ah(async (req, res) => {
  const r = (await db().query<{ thumbnail: Buffer | null }>("SELECT thumbnail FROM media WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!r?.thumbnail) throw new HttpError(404, "No thumbnail", "not_found");
  res.set({ "content-type": "image/jpeg", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
  res.send(Buffer.from(r.thumbnail));
}));

/** A small preview picture (made in the browser from the first frame), JPEG up to 300 KB. */
media.put("/media/:id/thumbnail", ah(async (req, res) => {
  if (baseMime(req.get("content-type")) !== "image/jpeg") throw new HttpError(415, "Thumbnails are JPEG images.");
  const parts: Buffer[] = []; let n = 0;
  for await (const part of req as AsyncIterable<Buffer>) { n += part.length; if (n > 300 * 1024) throw new HttpError(413, "Thumbnail too large."); parts.push(part); }
  const buf = Buffer.concat(parts);
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(415, "Thumbnails are JPEG images.");
  const r = await db().query("UPDATE media SET thumbnail=$3 WHERE id=$1 AND workspace_id=$2 RETURNING id", [idParam(req), ws(req), buf]);
  if (!r.rows.length) throw new HttpError(404, "Not found", "not_found");
  res.json({ ok: true });
}));

media.patch("/media/:id", ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(200).optional(), transcript: z.string().max(200_000).optional() }), req.body);
  const r = await db().query(`UPDATE media SET title=COALESCE($3, title), transcript=COALESCE($4, transcript), updated_at=now() WHERE id=$1 AND workspace_id=$2 AND status='complete' RETURNING ${COLS}`,
    [idParam(req), ws(req), b.title ?? null, b.transcript ?? null]);
  if (!r.rows.length) throw new HttpError(404, "Not found", "not_found");
  res.json(r.rows[0]);
}));

/** Delete: whoever made it, or a workspace admin. */
media.delete("/media/:id", ah(async (req, res) => {
  const m = (await db().query<{ created_by: string | null }>("SELECT created_by FROM media WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!m) return res.json({ ok: true });
  const admin = ["owner", "admin"].includes(req.workspace!.role);
  if (m.created_by !== actor(req) && !admin) throw new HttpError(403, "Only the person who added it, or an admin, can delete it.", "forbidden");
  await db().query("DELETE FROM media WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)]);
  res.json({ ok: true });
}));

/** Speech to text for an audio (or short video) recording up to 25 MB; the text is kept with it and searchable. */
media.post("/media/:id/transcribe", requireRole("member"), rateLimit({ windowMs: 60 * 60_000, max: 30, key: "user", name: "media-transcribe" }), ah(async (req, res) => {
  const m = await own(ws(req), idParam(req));
  if (!/^(audio|video)\//.test(m.mime)) throw new HttpError(400, "Only recordings with sound can be transcribed.");
  if (Number(m.size) > 25 * CHUNK) throw new HttpError(413, "Transcription works on recordings up to 25 MB.", "too_large");
  const rows = (await db().query<{ data: Buffer }>("SELECT data FROM media_chunks WHERE media_id=$1 ORDER BY seq", [m.id])).rows;
  const lang = parse(z.object({ language: z.string().regex(/^[a-z]{2}$/).optional() }), req.body ?? {}).language;
  const text = await transcribeAudio(Buffer.concat(rows.map((r) => Buffer.from(r.data))), m.mime, lang);
  const r = await db().query(`UPDATE media SET transcript=$3, updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING ${COLS}, transcript`, [m.id, ws(req), text]);
  res.json(r.rows[0]);
}));
