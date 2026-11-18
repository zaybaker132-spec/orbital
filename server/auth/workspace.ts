import type { RequestHandler } from "express";
import { db, type Queryable } from "../db/client.js";
import { HttpError } from "../lib/http.js";

/** GET endpoints a browser loads without custom headers (EventSource, <img>) may name the workspace in the query. */
const QUERY_WORKSPACE_PATHS = /^\/(events|export|documents\/[^/]+\/file)$/;

export type Role = "owner" | "admin" | "member" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

/** Every account gets a private personal workspace whose id equals the user id. */
export async function createPersonalWorkspace(q: Queryable, userId: string) {
  await q.query("INSERT INTO workspaces(id, name, kind, created_by) VALUES ($1,'Personal','personal',$1) ON CONFLICT DO NOTHING", [userId]);
  await q.query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$1,'owner') ON CONFLICT DO NOTHING", [userId]);
}

export async function membership(userId: string, workspaceId: string) {
  return (await db().query<{ id: string; name: string; kind: "personal" | "business"; role: Role }>(
    `SELECT w.id, w.name, w.kind, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
     WHERE w.id = $1 AND m.user_id = $2`,
    [workspaceId, userId],
  )).rows[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Viewers can read everything in a workspace and ask Orbital questions (their conversations are private),
 * but cannot change shared knowledge. These are the only writes they may make.
 */
const VIEWER_WRITES = [
  /^\/conversations(\/[^/]+)?$/,
  /^\/conversations\/[^/]+\/messages$/,
  /^\/feedback$/,
  /^\/preferences$/,
  /^\/invites\/accept$/,
  /^\/workspaces$/,
  /^\/(reminders|focus)(\/[^/]+(\/end)?)?$/, // personal: reminders and focus sessions
  /^\/nudges\/dismiss$/,
  /^\/voice\/transcribe$/,
  /^\/meetings(\/[^/]+(\/(signal|state|chat|lock|remove|end))?)?$/, // meetings are personal, not workspace knowledge
];

/** Resolve the active workspace from the X-Orbital-Workspace header (default: personal) and check membership. */
export const resolveWorkspace: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) return next(new HttpError(401, "Not authenticated", "unauthenticated"));
    // EventSource can't set headers, so the live event stream passes the workspace as a query parameter.
    const requested = req.get("x-orbital-workspace") ?? (QUERY_WORKSPACE_PATHS.test(req.path) && typeof req.query.workspace === "string" ? req.query.workspace : undefined);
    const id = requested && UUID_RE.test(requested) ? requested : req.user.id;
    const m = await membership(req.user.id, id);
    if (!m) return next(new HttpError(404, "Workspace not found", "workspace_not_found"));
    req.workspace = m;
    if (m.role === "viewer" && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !VIEWER_WRITES.some((r) => r.test(req.path))) {
      return next(new HttpError(403, "Viewers can read and ask questions, but not change workspace knowledge.", "forbidden"));
    }
    next();
  } catch (e) {
    next(e);
  }
};

export const requireRole = (min: Role): RequestHandler => (req, _res, next) => {
  if (!req.workspace || !atLeast(req.workspace.role, min)) return next(new HttpError(403, `This requires the ${min} role in this workspace.`, "forbidden"));
  next();
};
