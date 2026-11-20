import { Router } from "express";
import { z } from "zod/v4";
import { db } from "../db/client.js";
import { actor, ah, HttpError, idParam, parse, ws } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";
import { isAppRoute } from "../../shared/routes.js";

/**
 * Recently viewed (the last things you opened) and favorites (bookmarks you pin). Both are private to
 * the person, per workspace. Items are stored by id and looked up when listed: titles follow renames,
 * and anything deleted, or no longer yours to see, simply drops out.
 */
export const trail = Router();

const ITEM_KINDS = ["document", "paper", "conversation", "project", "research"] as const;
type ItemKind = (typeof ITEM_KINDS)[number];
const KEEP_RECENT = 50, SHOW_RECENT = 10, MAX_BOOKMARKS = 50;

/** Is this item in the workspace (and, for a conversation, yours)? */
async function itemExists(workspaceId: string, userId: string, kind: ItemKind, id: string) {
  const sql: Record<ItemKind, string> = {
    document: "SELECT 1 FROM documents WHERE id=$1 AND workspace_id=$2 AND kind<>'doc'",
    paper: "SELECT 1 FROM documents WHERE id=$1 AND workspace_id=$2 AND kind='doc'",
    conversation: "SELECT 1 FROM conversations WHERE id=$1 AND workspace_id=$2 AND created_by=$3",
    project: "SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2",
    research: "SELECT 1 FROM research_sessions WHERE id=$1 AND workspace_id=$2",
  };
  const params = kind === "conversation" ? [id, workspaceId, userId] : [id, workspaceId];
  return (await db().query(sql[kind], params)).rows.length > 0;
}

/** The item's current title and a detail (document kind, project status…), or null when it's gone. */
const RESOLVE = `CASE x.kind
    WHEN 'document' THEN (SELECT json_build_object('title', d.title, 'sub', d.kind) FROM documents d WHERE d.id = x.ref::uuid AND d.workspace_id = x.workspace_id AND d.kind <> 'doc')
    WHEN 'paper' THEN (SELECT json_build_object('title', d.title, 'sub', 'doc') FROM documents d WHERE d.id = x.ref::uuid AND d.workspace_id = x.workspace_id AND d.kind = 'doc')
    WHEN 'conversation' THEN (SELECT json_build_object('title', c.title, 'sub', c.mode) FROM conversations c WHERE c.id = x.ref::uuid AND c.workspace_id = x.workspace_id AND c.created_by = x.user_id)
    WHEN 'project' THEN (SELECT json_build_object('title', p.name, 'sub', p.status) FROM projects p WHERE p.id = x.ref::uuid AND p.workspace_id = x.workspace_id)
    WHEN 'research' THEN (SELECT json_build_object('title', r.question, 'sub', r.status) FROM research_sessions r WHERE r.id = x.ref::uuid AND r.workspace_id = x.workspace_id)
  END`;

const ItemRef = z.object({ kind: z.enum(ITEM_KINDS), ref: z.uuid() });

// ── Recently viewed ──────────────────────────────────────────────────────────────────────────────────

trail.post("/recent", rateLimit({ windowMs: 60_000, max: 120, key: "user", name: "recent" }), ah(async (req, res) => {
  const b = parse(ItemRef, req.body);
  if (!(await itemExists(ws(req), actor(req), b.kind, b.ref))) throw new HttpError(404, "Not found", "not_found");
  await db().query(
    `INSERT INTO recent_items(workspace_id, user_id, kind, ref) VALUES ($1,$2,$3,$4)
     ON CONFLICT (workspace_id, user_id, kind, ref) DO UPDATE SET viewed_at = now()`, [ws(req), actor(req), b.kind, b.ref]);
  // Keep the trail short.
  await db().query(
    `DELETE FROM recent_items WHERE workspace_id=$1 AND user_id=$2 AND (kind, ref) NOT IN
       (SELECT kind, ref FROM recent_items WHERE workspace_id=$1 AND user_id=$2 ORDER BY viewed_at DESC LIMIT ${KEEP_RECENT})`, [ws(req), actor(req)]);
  res.json({ ok: true });
}));

trail.get("/recent", ah(async (req, res) => {
  const rows = (await db().query<any>(
    `SELECT x.kind, x.ref, x.viewed_at, ${RESOLVE} AS item FROM recent_items x
     WHERE x.workspace_id=$1 AND x.user_id=$2 ORDER BY x.viewed_at DESC LIMIT ${KEEP_RECENT}`, [ws(req), actor(req)])).rows;
  res.json(rows.filter((r) => r.item).slice(0, SHOW_RECENT).map((r) => ({ kind: r.kind, ref: r.ref, viewedAt: r.viewed_at, title: r.item.title, sub: r.item.sub })));
}));

trail.delete("/recent", ah(async (req, res) => {
  await db().query("DELETE FROM recent_items WHERE workspace_id=$1 AND user_id=$2", [ws(req), actor(req)]);
  res.json({ ok: true });
}));

// ── Favorites ────────────────────────────────────────────────────────────────────────────────────────

trail.get("/bookmarks", ah(async (req, res) => {
  const rows = (await db().query<any>(
    `SELECT x.id, x.kind, x.ref, x.title, x.label, x.position, CASE WHEN x.kind = 'page' THEN json_build_object('title', x.title, 'sub', '') ELSE ${RESOLVE} END AS item
     FROM bookmarks x WHERE x.workspace_id=$1 AND x.user_id=$2 ORDER BY x.position, x.created_at`, [ws(req), actor(req)])).rows;
  res.json(rows.filter((r) => r.item).map((r) => ({ id: r.id, kind: r.kind, ref: r.ref, title: r.label || r.item.title, label: r.label, sub: r.item.sub })));
}));

const Page = z.object({
  kind: z.literal("page"),
  ref: z.string().max(300).refine((p) => p.startsWith("/") && !p.startsWith("//") && isAppRoute(p.split(/[?#]/)[0]), "Not a page in Orbital"),
  title: z.string().trim().min(1).max(120),
});

trail.post("/bookmarks", ah(async (req, res) => {
  const b = parse(z.union([ItemRef, Page]), req.body);
  if (b.kind !== "page" && !(await itemExists(ws(req), actor(req), b.kind, b.ref))) throw new HttpError(404, "Not found", "not_found");
  const existing = (await db().query<{ id: string }>("SELECT id FROM bookmarks WHERE workspace_id=$1 AND user_id=$2 AND kind=$3 AND ref=$4", [ws(req), actor(req), b.kind, b.ref])).rows[0];
  if (existing) return res.json({ id: existing.id, existed: true });
  const count = (await db().query<{ n: number }>("SELECT count(*)::int AS n FROM bookmarks WHERE workspace_id=$1 AND user_id=$2", [ws(req), actor(req)])).rows[0].n;
  if (count >= MAX_BOOKMARKS) throw new HttpError(400, `You can keep up to ${MAX_BOOKMARKS} favorites. Remove one to add another.`, "limit");
  const r = await db().query<{ id: string }>(
    `INSERT INTO bookmarks(workspace_id, user_id, kind, ref, title, position)
     VALUES ($1,$2,$3,$4,$5, COALESCE((SELECT max(position) + 1 FROM bookmarks WHERE workspace_id=$1 AND user_id=$2), 0)) RETURNING id`,
    [ws(req), actor(req), b.kind, b.ref, b.kind === "page" ? b.title : ""]);
  res.status(201).json({ id: r.rows[0].id });
}));

trail.patch("/bookmarks/:id", ah(async (req, res) => {
  const b = parse(z.object({ label: z.string().trim().max(120) }), req.body);
  const r = await db().query("UPDATE bookmarks SET label=$4 WHERE id=$1 AND workspace_id=$2 AND user_id=$3 RETURNING id", [idParam(req), ws(req), actor(req), b.label]);
  if (!r.rows.length) throw new HttpError(404, "Not found", "not_found");
  res.json({ ok: true });
}));

trail.delete("/bookmarks/:id", ah(async (req, res) => {
  await db().query("DELETE FROM bookmarks WHERE id=$1 AND workspace_id=$2 AND user_id=$3", [idParam(req), ws(req), actor(req)]);
  res.json({ ok: true });
}));

/** New order: the ids of your favorites, first to last (others keep their place after them). */
trail.put("/bookmarks/order", ah(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(MAX_BOOKMARKS) }), req.body);
  await db().tx(async (q) => {
    for (let i = 0; i < ids.length; i++) await q.query("UPDATE bookmarks SET position=$4 WHERE id=$1 AND workspace_id=$2 AND user_id=$3", [ids[i], ws(req), actor(req), i]);
  });
  res.json({ ok: true });
}));
