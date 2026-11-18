import { Router, type RequestHandler } from "express";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { ah, HttpError, parse } from "../lib/http.js";
import { sha256 } from "../lib/crypto.js";
import { rateLimit } from "../lib/rateLimit.js";
import { createDocument } from "../engines/knowledge.js";
import { createMemory, MEMORY_CATEGORIES } from "../engines/memory.js";
import { answerOnce } from "../engines/chat.js";
import { friendlyAiError } from "./core.js";

/**
 * Public API for a workspace's own systems (CRM, help desk, internal tools, Zapier/Make/n8n).
 * Authenticated with workspace API tokens (Authorization: Bearer orb_…), never with cookies,
 * so it is mounted outside the browser session + CSRF middleware.
 *   ingest: POST /documents, POST /memories        query: GET /search, POST /ask
 */
export const v1 = Router();

const tokenAuth: RequestHandler = async (req, _res, next) => {
  try {
    const h = req.get("authorization") ?? "";
    const m = h.match(/^Bearer\s+(orb_[A-Za-z0-9_-]{20,})$/);
    if (!m) throw new HttpError(401, "Missing or malformed bearer token", "unauthenticated");
    const t = (await db().query<{ id: string; workspace_id: string; scopes: string[]; name: string; kind: string }>(
      `SELECT t.id, t.workspace_id, t.scopes, w.name, w.kind FROM api_tokens t JOIN workspaces w ON w.id=t.workspace_id
       WHERE t.token_hash=$1 AND t.revoked_at IS NULL`, [sha256(m[1])])).rows[0];
    if (!t) throw new HttpError(401, "Invalid or revoked token", "unauthenticated");
    req.apiToken = { id: t.id, scopes: t.scopes };
    req.workspace = { id: t.workspace_id, name: t.name, kind: t.kind as any, role: "member" };
    db().query("UPDATE api_tokens SET last_used_at=now() WHERE id=$1", [t.id]).catch(() => {});
    next();
  } catch (e) {
    next(e);
  }
};
const scope = (s: "ingest" | "query"): RequestHandler => (req, _res, next) =>
  req.apiToken?.scopes.includes(s) ? next() : next(new HttpError(403, `This token lacks the "${s}" scope`, "forbidden"));

v1.use(tokenAuth);
const limit = rateLimit({ windowMs: 60_000, max: 120, key: "token", name: "v1" });
v1.use(limit);

v1.post("/documents", scope("ingest"), ah(async (req, res) => {
  const b = parse(z.object({
    title: z.string().trim().min(1).max(300),
    body: z.string().max(2_000_000),
    tags: z.array(z.string().max(40)).max(30).default([]),
    source_url: z.url().max(2000).optional(),
  }), req.body);
  const d = await createDocument(req.workspace!.id, { title: b.title, body: b.body, tags: [...b.tags, "api"], kind: "text", sourceUrl: b.source_url ?? null });
  res.status(201).json({ id: d.id });
}));

v1.post("/memories", scope("ingest"), ah(async (req, res) => {
  const b = parse(z.object({ content: z.string().trim().min(3).max(2000), category: z.enum(MEMORY_CATEGORIES) }), req.body);
  // Facts arriving from other systems are proposed, not trusted: an admin confirms them in Review.
  const r = await createMemory(req.workspace!.id, { ...b, origin: "user", status: "pending", reason: "Submitted through the API.", confidence: 0.7 });
  res.status(201).json(r);
}));

v1.get("/search", scope("query"), ah(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  if (!q) throw new HttpError(400, "q is required");
  const r = await db().query(
    `(SELECT 'document' AS type, id, title, left(body, 300) AS snippet FROM documents WHERE workspace_id=$1 AND (tsv @@ plainto_tsquery('english',$2) OR title ILIKE '%'||$2||'%') ORDER BY updated_at DESC LIMIT 10)
     UNION ALL (SELECT 'memory', id, left(content, 200), category FROM memories WHERE workspace_id=$1 AND status='active' AND tsv @@ plainto_tsquery('english',$2) LIMIT 10)`,
    [req.workspace!.id, q]);
  res.json({ results: r.rows });
}));

v1.post("/ask", scope("query"), ah(async (req, res) => {
  const b = parse(z.object({ question: z.string().trim().min(3).max(4000) }), req.body);
  try {
    res.json(await answerOnce(req.workspace!.id, b.question));
  } catch (e) {
    throw new HttpError(502, friendlyAiError(e), "ai_error");
  }
}));
