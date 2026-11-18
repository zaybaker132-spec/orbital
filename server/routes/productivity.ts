import { Router } from "express";
import multer from "multer";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { ah, HttpError, idParam, notFound, parse, ws, actor } from "../lib/http.js";
import { logActivity } from "../lib/activity.js";
import { computeNudges, ITEM_TYPES, itemTitle, listReminders, tickReminders } from "../engines/reminders.js";
import { createDocument, updateDocument } from "../engines/knowledge.js";
import { ownProject } from "./core.js";
import { config } from "../config.js";
import { rateLimit } from "../lib/rateLimit.js";
import { emit } from "../lib/events.js";
import { getLLM, describeAiError } from "../ai/provider.js";
import { extractMemories } from "../engines/memory.js";

/** Personal productivity: reminders, nudges and focus sessions. Each person sees only their own. */
export const productivity = Router();

// ── Reminders ──────────────────────────────────────────────────────────────
productivity.get("/reminders", ah(async (req, res) => {
  res.json(await listReminders(ws(req), actor(req)));
}));

const ReminderInput = z.object({
  title: z.string().trim().max(300).optional(),
  note: z.string().max(2000).default(""),
  dueAt: z.iso.datetime({ offset: true }),
  itemType: z.enum(ITEM_TYPES).nullish(),
  itemId: z.uuid().nullish(),
});

productivity.post("/reminders", ah(async (req, res) => {
  const b = parse(ReminderInput, req.body);
  if (!!b.itemType !== !!b.itemId) throw new HttpError(400, "itemType and itemId go together", "invalid_input");
  let title = b.title ?? "";
  if (b.itemType && b.itemId) {
    const t = await itemTitle(ws(req), actor(req), b.itemType, b.itemId);
    if (t === null) throw notFound("Item");
    if (!title) title = t;
  }
  if (!title) throw new HttpError(400, "Give the reminder a title", "invalid_input");
  const r = await db().query<any>(
    "INSERT INTO reminders(workspace_id, user_id, title, note, due_at, item_type, item_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    [ws(req), actor(req), title.slice(0, 300), b.note, b.dueAt, b.itemType ?? null, b.itemId ?? null]);
  // A reminder set in the past (or for "now") fires on the next tick; run one immediately.
  if (Date.parse(b.dueAt) <= Date.now()) await tickReminders();
  res.status(201).json(r.rows[0]);
}));

productivity.patch("/reminders/:id", ah(async (req, res) => {
  const b = parse(z.object({
    title: z.string().trim().min(1).max(300).optional(),
    note: z.string().max(2000).optional(),
    dueAt: z.iso.datetime({ offset: true }).optional(),
    status: z.enum(["done", "dismissed"]).optional(),
  }), req.body);
  // Rescheduling (snooze) puts a fired reminder back on the schedule.
  const r = await db().query<any>(
    `UPDATE reminders SET title=COALESCE($4,title), note=COALESCE($5,note), due_at=COALESCE($6,due_at),
       status = CASE WHEN $7::text IS NOT NULL THEN $7 WHEN $6::timestamptz IS NOT NULL THEN 'scheduled' ELSE status END,
       fired_at = CASE WHEN $6::timestamptz IS NOT NULL AND $7::text IS NULL THEN NULL ELSE fired_at END, updated_at=now()
     WHERE id=$1 AND workspace_id=$2 AND user_id=$3 RETURNING *`,
    [idParam(req), ws(req), actor(req), b.title ?? null, b.note ?? null, b.dueAt ?? null, b.status ?? null]);
  if (!r.rows[0]) throw notFound("Reminder");
  res.json(r.rows[0]);
}));

productivity.delete("/reminders/:id", ah(async (req, res) => {
  await db().query("DELETE FROM reminders WHERE id=$1 AND workspace_id=$2 AND user_id=$3", [idParam(req), ws(req), actor(req)]);
  res.json({ ok: true });
}));

// ── Nudges (computed suggestions) ──────────────────────────────────────────
productivity.get("/nudges", ah(async (req, res) => {
  const today = typeof req.query.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.today) && !Number.isNaN(Date.parse(req.query.today))
    ? req.query.today : new Date().toISOString().slice(0, 10);
  res.json(await computeNudges(ws(req), actor(req), today));
}));

productivity.post("/nudges/dismiss", ah(async (req, res) => {
  const b = parse(z.object({ key: z.string().min(3).max(200).regex(/^[a-z_]+:[0-9a-f-]{36}(:[\w-]+)?$/), snoozeDays: z.number().int().min(1).max(90).nullish() }), req.body);
  await db().query(
    `INSERT INTO nudge_dismissals(workspace_id, user_id, nudge_key, until) VALUES ($1,$2,$3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END)
     ON CONFLICT (workspace_id, user_id, nudge_key) DO UPDATE SET until=EXCLUDED.until, created_at=now()`,
    [ws(req), actor(req), b.key, b.snoozeDays ?? null]);
  res.json({ ok: true });
}));

// ── Focus sessions ─────────────────────────────────────────────────────────
const focusRow = async (workspaceId: string, userId: string, id: string) =>
  (await db().query<any>(
    `SELECT f.*, p.name AS project_name, d.body AS notes FROM focus_sessions f
     LEFT JOIN projects p ON p.id=f.project_id LEFT JOIN documents d ON d.id=f.document_id
     WHERE f.id=$1 AND f.workspace_id=$2 AND f.user_id=$3`, [id, workspaceId, userId])).rows[0];

productivity.get("/focus", ah(async (req, res) => {
  const [active, recent, week] = await Promise.all([
    db().query<any>("SELECT id FROM focus_sessions WHERE workspace_id=$1 AND user_id=$2 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", [ws(req), actor(req)]),
    db().query<any>(
      `SELECT f.id, f.objective, f.project_id, p.name AS project_name, f.planned_minutes, f.focused_seconds, f.tasks_completed, f.outcome, f.started_at, f.ended_at, f.document_id
       FROM focus_sessions f LEFT JOIN projects p ON p.id=f.project_id WHERE f.workspace_id=$1 AND f.user_id=$2 AND f.ended_at IS NOT NULL ORDER BY f.started_at DESC LIMIT 12`, [ws(req), actor(req)]),
    db().query<any>(
      `SELECT COALESCE(sum(focused_seconds),0)::int AS seconds, count(*)::int AS sessions FROM focus_sessions
       WHERE workspace_id=$1 AND user_id=$2 AND ended_at IS NOT NULL AND started_at > now() - interval '7 days'`, [ws(req), actor(req)]),
  ]);
  res.json({ active: active.rows[0] ? await focusRow(ws(req), actor(req), active.rows[0].id) : null, recent: recent.rows, week: week.rows[0] });
}));

productivity.post("/focus", ah(async (req, res) => {
  const b = parse(z.object({ objective: z.string().trim().min(1).max(300), projectId: z.uuid().nullish(), plannedMinutes: z.number().int().min(5).max(240).default(50) }), req.body);
  if (b.projectId) await ownProject(ws(req), b.projectId);
  // One session at a time: starting a new one closes any you left open.
  await db().query("UPDATE focus_sessions SET ended_at=now() WHERE workspace_id=$1 AND user_id=$2 AND ended_at IS NULL", [ws(req), actor(req)]);
  const r = await db().query<any>("INSERT INTO focus_sessions(workspace_id, user_id, objective, project_id, planned_minutes) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [ws(req), actor(req), b.objective, b.projectId ?? null, b.plannedMinutes]);
  res.status(201).json(await focusRow(ws(req), actor(req), r.rows[0].id));
}));

/** Autosave: focused time so far, and the session's scratch notes (kept as a note in Knowledge). */
productivity.patch("/focus/:id", ah(async (req, res) => {
  const b = parse(z.object({ focusedSeconds: z.number().int().min(0).max(86_400).optional(), notes: z.string().max(200_000).optional() }), req.body);
  const f = await focusRow(ws(req), actor(req), idParam(req));
  if (!f) throw notFound("Focus session");
  if (f.ended_at) throw new HttpError(409, "This focus session has ended", "ended");
  if (b.notes !== undefined) {
    if (req.workspace!.role === "viewer") throw new HttpError(403, "Viewers can't save notes to a shared workspace.", "forbidden");
    if (f.document_id) await updateDocument(ws(req), f.document_id, { body: b.notes });
    else if (b.notes.trim()) {
      const d = await createDocument(ws(req), { title: `Focus: ${f.objective}`.slice(0, 300), body: b.notes, kind: "note", tags: ["focus"], projectId: f.project_id });
      await db().query("UPDATE focus_sessions SET document_id=$2 WHERE id=$1", [f.id, d.id]);
    }
  }
  if (b.focusedSeconds !== undefined) await db().query("UPDATE focus_sessions SET focused_seconds=GREATEST(focused_seconds,$2) WHERE id=$1", [f.id, b.focusedSeconds]);
  res.json(await focusRow(ws(req), actor(req), f.id));
}));

productivity.post("/focus/:id/end", ah(async (req, res) => {
  const b = parse(z.object({ focusedSeconds: z.number().int().min(0).max(86_400), outcome: z.string().max(2000).default("") }), req.body);
  const f = await focusRow(ws(req), actor(req), idParam(req));
  if (!f) throw notFound("Focus session");
  if (f.ended_at) return res.json(f);
  const done = f.project_id
    ? (await db().query<any>("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1 AND done AND completed_at >= $2", [f.project_id, f.started_at])).rows[0].n
    : 0;
  await db().query("UPDATE focus_sessions SET ended_at=now(), focused_seconds=GREATEST(focused_seconds,$2), outcome=$3, tasks_completed=$4 WHERE id=$1", [f.id, b.focusedSeconds, b.outcome, done]);
  const minutes = Math.round(Math.max(f.focused_seconds, b.focusedSeconds) / 60);
  await logActivity(ws(req), "focus.completed", `${f.objective} · ${minutes} min${done ? ` · ${done} task${done === 1 ? "" : "s"} done` : ""}`, f.project_id ? { type: "project", id: f.project_id } : undefined);
  res.json(await focusRow(ws(req), actor(req), f.id));
}));

// ── Voice ──────────────────────────────────────────────────────────────────
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const transcriptionKey = () => process.env.TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY || "";

productivity.get("/voice/config", (_req, res) => {
  res.json({ serverTranscription: !!config.transcription.baseUrl });
});

/** Speech to text through the configured transcription endpoint (audio is not stored). */
productivity.post("/voice/transcribe", rateLimit({ windowMs: 60_000, max: 40, key: "user", name: "transcribe" }), audioUpload.single("audio"), ah(async (req, res) => {
  if (!config.transcription.baseUrl) throw new HttpError(503, "Voice input in this app needs a transcription service. Set TRANSCRIPTION_BASE_URL (or OPENAI_API_KEY) on the server, or use Chrome, Edge or Safari, which recognise speech themselves.", "transcription_unavailable");
  const f = req.file;
  if (!f || f.size < 800) throw new HttpError(400, "No audio received.");
  if (!/^audio\/|^video\/webm/.test(f.mimetype)) throw new HttpError(415, "That isn't an audio recording.");
  const form = new FormData();
  const ext = f.mimetype.includes("mp4") ? "m4a" : f.mimetype.includes("ogg") ? "ogg" : f.mimetype.includes("wav") ? "wav" : "webm";
  form.append("file", new Blob([new Uint8Array(f.buffer)], { type: f.mimetype }), `speech.${ext}`);
  form.append("model", config.transcription.model);
  if (typeof req.body?.language === "string" && /^[a-z]{2}$/.test(req.body.language)) form.append("language", req.body.language);
  const headers: Record<string, string> = {};
  if (transcriptionKey()) headers.authorization = `Bearer ${transcriptionKey()}`;
  let r: Response;
  try {
    r = await fetch(`${config.transcription.baseUrl}/audio/transcriptions`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new HttpError(502, "Couldn't reach the transcription service.");
  }
  if (r.status === 401 || r.status === 403) throw new HttpError(502, "The transcription service rejected the API key.");
  if (!r.ok) throw new HttpError(502, `The transcription service returned an error (${r.status}).`);
  const j: any = await r.json().catch(() => ({}));
  res.json({ text: String(j.text ?? "").trim() });
}));

/**
 * "Save to memory": keep the conversation as a searchable note (one per conversation, refreshed
 * on each save) and, with an AI provider, pull out durable facts you stated as memories.
 */
productivity.post("/conversations/:id/remember", rateLimit({ windowMs: 60_000, max: 10, key: "user", name: "remember" }), ah(async (req, res) => {
  const workspaceId = ws(req), id = idParam(req);
  const c = (await db().query<any>("SELECT id, title, project_id, saved_document_id FROM conversations WHERE id=$1 AND workspace_id=$2 AND created_by=$3", [id, workspaceId, actor(req)])).rows[0];
  if (!c) throw notFound("Conversation");
  const msgs = (await db().query<any>("SELECT role, content, created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at", [id])).rows;
  if (!msgs.length) throw new HttpError(400, "This conversation is empty.");
  const day = new Date(msgs[0].created_at).toISOString().slice(0, 10);
  const body = [`_Conversation from ${day}. [Open it](/c/${id})_`, ...msgs.map((m) => `**${m.role === "user" ? "You" : "Orbital"}:** ${m.content}`)].join("\n\n");
  let documentId: string = c.saved_document_id;
  if (documentId && (await updateDocument(workspaceId, documentId, { body }))) { /* refreshed */ }
  else {
    const d = await createDocument(workspaceId, { title: `Conversation: ${c.title}`.slice(0, 300), body, kind: "note", tags: ["conversation"], projectId: c.project_id });
    documentId = d.id;
    await db().query("UPDATE conversations SET saved_document_id=$2 WHERE id=$1", [id, documentId]);
  }
  let memories = 0, ai = false, aiError: string | null = null;
  if (await getLLM()) {
    ai = true;
    const userText = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n\n").slice(-6000);
    const assistantText = msgs.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n").slice(-3000);
    try { memories = await extractMemories(workspaceId, id, userText, assistantText); } catch (e) { aiError = describeAiError(e); }
  }
  const pending = (await db().query<any>("SELECT count(*)::int AS n FROM memories WHERE workspace_id=$1 AND source_id=$2 AND status='pending'", [workspaceId, id])).rows[0]?.n ?? 0;
  await logActivity(workspaceId, "conversation.remembered", c.title, { type: "conversation", id });
  if (memories) emit(workspaceId, { type: "knowledge", memoriesAdded: memories, pending });
  res.json({ documentId, memories, pending, ai, aiError });
}));
