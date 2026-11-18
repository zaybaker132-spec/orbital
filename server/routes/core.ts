import { Router } from "express";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { ah, HttpError, idParam, notFound, parse, ws, actor, isUuid } from "../lib/http.js";
import { createPersonalWorkspace, resolveWorkspace } from "../auth/workspace.js";
import { isServerAdmin } from "./waitlist.js";
import { createSession, destroySession, hashPassword, verifyPassword, COOKIE, requireUser } from "../auth/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { aiStatus, describeAiError } from "../ai/provider.js";
import { subscribe } from "../lib/events.js";
import { MODES, respond } from "../engines/chat.js";
import { createMemory, deleteMemory, listMemories, MEMORY_CATEGORIES, strip, updateMemory } from "../engines/memory.js";
import { createEdge, getGraph, getNodeDetail, RELATIONS, setEdgeStatus, suggestConnections, upsertNode } from "../engines/graph.js";
import { logActivity } from "../lib/activity.js";

export const authRouter = Router();
const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 20, key: "ip", name: "auth" });

const Credentials = z.object({ email: z.email().max(200).transform((e) => e.toLowerCase().trim()), password: z.string().min(10, "Use at least 10 characters").max(200) });

authRouter.post("/signup", authLimit, ah(async (req, res) => {
  if (!config.allowSignup) throw new HttpError(403, "Sign-up is disabled on this server", "signup_disabled");
  const body = parse(Credentials.extend({ displayName: z.string().max(80).optional() }), req.body);
  const exists = await db().query("SELECT 1 FROM users WHERE email=$1", [body.email]);
  if (exists.rows.length) throw new HttpError(409, "An account with that email already exists", "exists");
  const hash = await hashPassword(body.password);
  const userId = await db().tx(async (q) => {
    const r = await q.query<{ id: string }>("INSERT INTO users(email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id", [body.email, hash, body.displayName ?? ""]);
    await q.query("INSERT INTO user_preferences(user_id) VALUES ($1)", [r.rows[0].id]);
    await createPersonalWorkspace(q, r.rows[0].id);
    return r.rows[0].id;
  });
  await createSession(res, userId, req.get("user-agent"));
  res.status(201).json({ ok: true });
}));

authRouter.post("/login", authLimit, ah(async (req, res) => {
  const body = parse(Credentials, req.body);
  const u = (await db().query<{ id: string; password_hash: string }>("SELECT id, password_hash FROM users WHERE email=$1", [body.email])).rows[0];
  // Always run a hash comparison so response timing doesn't reveal whether the email exists.
  const ok = await verifyPassword(body.password, u?.password_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
  if (!u || !ok) throw new HttpError(401, "Email or password is incorrect", "bad_credentials");
  await createSession(res, u.id, req.get("user-agent"));
  res.json({ ok: true });
}));

authRouter.post("/logout", ah(async (req, res) => {
  await destroySession(req.cookies?.[COOKIE], res);
  res.json({ ok: true });
}));

authRouter.get("/me", ah(async (req, res) => {
  if (!req.user) return res.json({ user: null, signupAllowed: config.allowSignup, ai: aiStatus(), desktop: config.desktop });
  const prefs = (await db().query<{ settings: any }>("SELECT settings FROM user_preferences WHERE user_id=$1", [req.user.id])).rows[0]?.settings ?? {};
  const workspaces = (await db().query(
    `SELECT w.id, w.name, w.kind, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
     WHERE m.user_id=$1 ORDER BY (w.kind='personal') DESC, w.name`, [req.user.id])).rows;
  res.json({ user: req.user, preferences: prefs, workspaces, ai: aiStatus(), signupAllowed: config.allowSignup, desktop: config.desktop, downloadUrl: config.downloadUrl, serverAdmin: isServerAdmin(req.user.email) });
}));

export const api = Router();
api.use(requireUser, resolveWorkspace);

// ── Live events (drives the Neural Core and progress UI) ─────────────────────
api.get("/events", (req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
  const off = subscribe(ws(req), res, actor(req));
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => { clearInterval(ping); off(); });
});

// ── Conversations ───────────────────────────────────────────────────────────
api.get("/conversations", ah(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const r = q
    ? await db().query(
        `SELECT c.id, c.title, c.mode, c.project_id, c.updated_at,
                (SELECT left(m.content, 180) FROM messages m WHERE m.conversation_id=c.id AND (m.tsv @@ plainto_tsquery('english',$2) OR m.content ILIKE '%'||$2||'%') ORDER BY m.created_at DESC LIMIT 1) AS match
         FROM conversations c WHERE c.workspace_id=$1 AND c.created_by=$3 AND (c.title ILIKE '%'||$2||'%' OR EXISTS (
           SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND (m.tsv @@ plainto_tsquery('english',$2) OR m.content ILIKE '%'||$2||'%')))
         ORDER BY c.updated_at DESC LIMIT 50`, [ws(req), q, actor(req)])
    : await db().query("SELECT id, title, mode, project_id, updated_at FROM conversations WHERE workspace_id=$1 AND created_by=$2 ORDER BY updated_at DESC LIMIT 200", [ws(req), actor(req)]);
  res.json(r.rows);
}));

api.post("/conversations", ah(async (req, res) => {
  const b = parse(z.object({ projectId: z.uuid().nullish(), mode: z.enum(MODES).optional() }), req.body ?? {});
  if (b.projectId) await ownProject(ws(req), b.projectId);
  const r = await db().query("INSERT INTO conversations(workspace_id, project_id, mode, created_by) VALUES ($1,$2,$3,$4) RETURNING id, title, mode, project_id, updated_at", [ws(req), b.projectId ?? null, b.mode ?? "standard", actor(req)]);
  res.status(201).json(r.rows[0]);
}));

api.get("/conversations/:id", ah(async (req, res) => {
  const id = idParam(req);
  const c = (await db().query("SELECT id, title, mode, project_id, created_at, updated_at FROM conversations WHERE id=$1 AND workspace_id=$2 AND created_by=$3", [id, ws(req), actor(req)])).rows[0];
  if (!c) throw notFound("Conversation");
  const m = await db().query("SELECT id, role, content, mode, metadata, created_at FROM messages WHERE conversation_id=$1 AND workspace_id=$2 ORDER BY created_at", [id, ws(req)]);
  res.json({ ...c, messages: m.rows });
}));

api.patch("/conversations/:id", ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().min(1).max(120).optional(), projectId: z.uuid().nullable().optional() }), req.body);
  if (b.projectId) await ownProject(ws(req), b.projectId);
  const r = await db().query(
    "UPDATE conversations SET title=COALESCE($3,title), project_id=CASE WHEN $4 THEN $5::uuid ELSE project_id END WHERE id=$1 AND workspace_id=$2 AND created_by=$6 RETURNING id, title, mode, project_id, updated_at",
    [idParam(req), ws(req), b.title ?? null, b.projectId !== undefined, b.projectId ?? null, actor(req)],
  );
  if (!r.rows[0]) throw notFound("Conversation");
  res.json(r.rows[0]);
}));

api.delete("/conversations/:id", ah(async (req, res) => {
  await db().query("DELETE FROM conversations WHERE id=$1 AND workspace_id=$2 AND created_by=$3", [idParam(req), ws(req), actor(req)]);
  res.json({ ok: true });
}));

const chatLimit = rateLimit({ windowMs: 60_000, max: 20, key: "user", name: "chat" });
api.post("/conversations/:id/messages", chatLimit, ah(async (req, res) => {
  const b = parse(z.object({ content: z.string().trim().min(1).max(20000), mode: z.enum(MODES).default("standard"), attachments: z.array(z.uuid()).max(5).default([]) }), req.body);
  const id = idParam(req);
  const workspaceId = ws(req);
  const owned = await db().query("SELECT 1 FROM conversations WHERE id=$1 AND workspace_id=$2 AND created_by=$3", [id, workspaceId, actor(req)]);
  if (!owned.rows.length) throw notFound("Conversation");
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ac.abort(); });
  const write = (event: string, data: unknown) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  try {
    await respond(workspaceId, id, b.content, b.mode, write, ac.signal, b.attachments, actor(req));
  } catch (e: any) {
    console.error("[chat]", e);
    write("error", { message: ac.signal.aborted ? "Stopped." : friendlyAiError(e) });
  }
  res.end();
}));

export const friendlyAiError = describeAiError;

// ── Memories ────────────────────────────────────────────────────────────────
api.get("/memories", ah(async (req, res) => {
  const s = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);
  res.json(await listMemories(ws(req), { status: s("status"), category: s("category"), q: s("q") }));
}));

api.post("/memories", ah(async (req, res) => {
  const b = parse(z.object({ content: z.string().trim().min(3).max(2000), category: z.enum(MEMORY_CATEGORIES), importance: z.number().min(0).max(1).optional() }), req.body);
  const r = await createMemory(ws(req), { ...b, origin: "user", reason: "Added by you.", confidence: 1 });
  res.status(201).json(r);
}));

api.patch("/memories/:id", ah(async (req, res) => {
  const b = parse(z.object({
    content: z.string().trim().min(3).max(2000).optional(),
    category: z.enum(MEMORY_CATEGORIES).optional(),
    importance: z.number().min(0).max(1).optional(),
    status: z.enum(["active", "pending", "archived", "rejected"]).optional(),
  }), req.body);
  const m = await updateMemory(ws(req), idParam(req), b);
  if (!m) throw notFound("Memory");
  res.json(m);
}));

api.delete("/memories/:id", ah(async (req, res) => {
  if (!(await deleteMemory(ws(req), idParam(req)))) throw notFound("Memory");
  res.json({ ok: true });
}));

api.post("/memories/merge", ah(async (req, res) => {
  const b = parse(z.object({ keepId: z.uuid(), removeId: z.uuid(), content: z.string().trim().min(3).max(2000).optional() }), req.body);
  const workspaceId = ws(req);
  if (b.content) await updateMemory(workspaceId, b.keepId, { content: b.content });
  await db().query("UPDATE memories SET importance = GREATEST(importance, (SELECT importance FROM memories WHERE id=$3 AND workspace_id=$2)) WHERE id=$1 AND workspace_id=$2", [b.keepId, workspaceId, b.removeId]);
  await deleteMemory(workspaceId, b.removeId);
  res.json({ ok: true });
}));

// ── Knowledge graph ────────────────────────────────────────────────────────
api.get("/graph", ah(async (req, res) => {
  const kinds = typeof req.query.kinds === "string" && req.query.kinds ? req.query.kinds.split(",") : undefined;
  res.json(await getGraph(ws(req), { kinds, includeSuggested: req.query.suggested !== "false" }));
}));

api.get("/nodes/:id", ah(async (req, res) => {
  const d = await getNodeDetail(ws(req), idParam(req));
  if (!d) throw notFound("Node");
  res.json(d);
}));

api.post("/nodes", ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(300), summary: z.string().max(4000).default(""), category: z.string().max(60).default("") }), req.body);
  const id = await upsertNode(ws(req), { kind: "concept", ...b });
  res.status(201).json({ id });
}));

api.patch("/nodes/:id", ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(300).optional(), summary: z.string().max(4000).optional(), category: z.string().max(60).optional() }), req.body);
  const r = await db().query("UPDATE knowledge_nodes SET title=COALESCE($3,title), summary=COALESCE($4,summary), category=COALESCE($5,category), updated_at=now() WHERE id=$1 AND workspace_id=$2 AND kind='concept' RETURNING id",
    [idParam(req), ws(req), b.title ?? null, b.summary ?? null, b.category ?? null]);
  if (!r.rows[0]) throw new HttpError(400, "Only concept nodes are edited here; edit notes, memories and research at their source.");
  res.json({ ok: true });
}));

api.delete("/nodes/:id", ah(async (req, res) => {
  const r = await db().query("DELETE FROM knowledge_nodes WHERE id=$1 AND workspace_id=$2 AND kind IN ('concept','finding') RETURNING id", [idParam(req), ws(req)]);
  if (!r.rows[0]) throw new HttpError(400, "Only concepts and findings can be deleted from the graph directly.");
  res.json({ ok: true });
}));

api.post("/nodes/:id/suggest", ah(async (req, res) => {
  res.json({ added: await suggestConnections(ws(req), idParam(req), 8) });
}));

api.post("/edges", ah(async (req, res) => {
  const b = parse(z.object({ sourceId: z.uuid(), targetId: z.uuid(), relation: z.enum(RELATIONS), rationale: z.string().max(500).default("") }), req.body);
  if (b.sourceId === b.targetId) throw new HttpError(400, "A node can't connect to itself");
  res.status(201).json({ id: await createEdge(ws(req), b.sourceId, b.targetId, b.relation, b.rationale) });
}));

api.patch("/edges/:id", ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(["confirmed", "rejected"]) }), req.body);
  const r = await setEdgeStatus(ws(req), idParam(req), b.status);
  if (!r) throw notFound("Connection");
  res.json(r);
}));

api.delete("/edges/:id", ah(async (req, res) => {
  await db().query("DELETE FROM knowledge_edges WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)]);
  res.json({ ok: true });
}));

// ── Feedback ───────────────────────────────────────────────────────────────
api.post("/feedback", ah(async (req, res) => {
  const b = parse(z.object({ targetType: z.enum(["message", "opportunity", "research", "memory", "edge"]), targetId: z.uuid(), rating: z.union([z.literal(-1), z.literal(1)]), comment: z.string().max(2000).default("") }), req.body);
  const table = { message: "messages", opportunity: "opportunities", research: "research_sessions", memory: "memories", edge: "knowledge_edges" }[b.targetType];
  const owned = await db().query(`SELECT 1 FROM ${table} WHERE id=$1 AND workspace_id=$2`, [b.targetId, ws(req)]);
  if (!owned.rows.length) throw notFound("Item");
  await db().query("DELETE FROM feedback WHERE workspace_id=$1 AND target_type=$2 AND target_id=$3 AND created_by=$4", [ws(req), b.targetType, b.targetId, actor(req)]);
  await db().query("INSERT INTO feedback(workspace_id, target_type, target_id, rating, comment, created_by) VALUES ($1,$2,$3,$4,$5,$6)", [ws(req), b.targetType, b.targetId, b.rating, b.comment, actor(req)]);
  await logActivity(ws(req), "feedback.given", `${b.rating > 0 ? "Helpful" : "Not helpful"}: ${b.targetType}`);
  res.json({ ok: true });
}));

export async function ownProject(workspaceId: string, projectId: string) {
  if (!isUuid(projectId)) throw new HttpError(400, "Invalid project");
  const r = await db().query("SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2", [projectId, workspaceId]);
  if (!r.rows.length) throw notFound("Project");
}

export { strip };
