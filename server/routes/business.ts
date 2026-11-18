import { Router, type Request } from "express";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { actor, ah, HttpError, idParam, notFound, parse, ws } from "../lib/http.js";
import { requireRole, atLeast, type Role } from "../auth/workspace.js";
import { audit } from "../lib/audit.js";
import { encrypt, randomToken, sha256 } from "../lib/crypto.js";
import { rateLimit } from "../lib/rateLimit.js";
import { assertSafeUrl, deliver, executeAction, nextRun, runNow, ScheduleSchema, validTimeZone } from "../engines/automation.js";

/** Workspaces, teams, connectors, automations, approvals, API tokens and the audit log. */
export const business = Router();

const who = (req: Request) => ({ id: actor(req), label: req.user!.email });
const business_only = (req: Request) => {
  if (req.workspace!.kind !== "business") throw new HttpError(400, "Teams are available in business workspaces. Create one from the workspace menu.", "personal_workspace");
};

// ── Workspaces ─────────────────────────────────────────────────────────────
business.get("/workspaces", ah(async (req, res) => {
  res.json((await db().query(
    `SELECT w.id, w.name, w.kind, m.role, (SELECT count(*)::int FROM workspace_members x WHERE x.workspace_id=w.id) AS members
     FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY (w.kind='personal') DESC, w.name`, [actor(req)])).rows);
}));

business.post("/workspaces", rateLimit({ windowMs: 60 * 60_000, max: 20, key: "user", name: "ws-create" }), ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
  const id = await db().tx(async (q) => {
    const w = await q.query<{ id: string }>("INSERT INTO workspaces(name, kind, created_by) VALUES ($1,'business',$2) RETURNING id", [b.name, actor(req)]);
    await q.query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,'owner')", [w.rows[0].id, actor(req)]);
    return w.rows[0].id;
  });
  await audit(id, who(req), "workspace.created", { type: "workspace", id }, { name: b.name });
  res.status(201).json({ id, name: b.name, kind: "business", role: "owner" });
}));

business.get("/workspace", ah(async (req, res) => {
  const w = (await db().query("SELECT id, name, kind, settings, created_at FROM workspaces WHERE id=$1", [ws(req)])).rows[0];
  res.json({ ...w, role: req.workspace!.role });
}));

business.patch("/workspace", requireRole("admin"), ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), settings: z.object({ context: z.string().max(4000).optional() }).optional() }), req.body);
  if (b.name && req.workspace!.kind === "personal") throw new HttpError(400, "The personal workspace can't be renamed.");
  const r = await db().query("UPDATE workspaces SET name=COALESCE($2,name), settings = settings || $3 WHERE id=$1 RETURNING id, name, kind, settings", [ws(req), b.name ?? null, JSON.stringify(b.settings ?? {})]);
  await audit(ws(req), who(req), "workspace.updated", { type: "workspace", id: ws(req) }, b);
  res.json(r.rows[0]);
}));

business.delete("/workspace", requireRole("owner"), ah(async (req, res) => {
  business_only(req);
  const b = parse(z.object({ confirm: z.string() }), req.body ?? {});
  if (b.confirm !== req.workspace!.name) throw new HttpError(400, "Type the workspace name to confirm deletion.");
  await db().query("DELETE FROM workspaces WHERE id=$1 AND kind='business'", [ws(req)]);
  res.json({ ok: true });
}));

// ── Members & invites ──────────────────────────────────────────────────────
business.get("/workspace/members", ah(async (req, res) => {
  res.json((await db().query(
    `SELECT u.id, u.email, u.display_name, m.role, m.created_at FROM workspace_members m JOIN users u ON u.id=m.user_id
     WHERE m.workspace_id=$1 ORDER BY m.role='owner' DESC, m.created_at`, [ws(req)])).rows);
}));

const ownersLeft = async (workspaceId: string, excluding: string) =>
  Number((await db().query("SELECT count(*)::int n FROM workspace_members WHERE workspace_id=$1 AND role='owner' AND user_id<>$2", [workspaceId, excluding])).rows[0].n);

business.patch("/workspace/members/:userId", requireRole("admin"), ah(async (req, res) => {
  business_only(req);
  const b = parse(z.object({ role: z.enum(["owner", "admin", "member", "viewer"]) }), req.body);
  const target = idParam(req, "userId");
  const cur = (await db().query<{ role: Role }>("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [ws(req), target])).rows[0];
  if (!cur) throw notFound("Member");
  const me = req.workspace!.role;
  if ((b.role === "owner" || cur.role === "owner") && me !== "owner") throw new HttpError(403, "Only owners can grant or remove the owner role.");
  if (cur.role === "owner" && b.role !== "owner" && (await ownersLeft(ws(req), target)) === 0) throw new HttpError(400, "A workspace needs at least one owner.");
  await db().query("UPDATE workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2", [ws(req), target, b.role]);
  await audit(ws(req), who(req), "member.role", { type: "user", id: target }, { from: cur.role, to: b.role });
  res.json({ ok: true });
}));

business.delete("/workspace/members/:userId", ah(async (req, res) => {
  business_only(req);
  const target = idParam(req, "userId");
  const self = target === actor(req);
  if (!self && !atLeast(req.workspace!.role, "admin")) throw new HttpError(403, "Only admins can remove members.");
  const cur = (await db().query<{ role: Role }>("SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [ws(req), target])).rows[0];
  if (!cur) throw notFound("Member");
  if (cur.role === "owner" && !self && req.workspace!.role !== "owner") throw new HttpError(403, "Only owners can remove an owner.");
  if (cur.role === "owner" && (await ownersLeft(ws(req), target)) === 0) throw new HttpError(400, "Transfer ownership before the last owner leaves.");
  await db().query("DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2", [ws(req), target]);
  await audit(ws(req), who(req), self ? "member.left" : "member.removed", { type: "user", id: target });
  res.json({ ok: true });
}));

business.get("/workspace/invites", requireRole("admin"), ah(async (req, res) => {
  res.json((await db().query("SELECT id, email, role, expires_at, accepted_at, created_at FROM workspace_invites WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100", [ws(req)])).rows);
}));

business.post("/workspace/invites", requireRole("admin"), rateLimit({ windowMs: 60 * 60_000, max: 50, key: "user", name: "invite" }), ah(async (req, res) => {
  business_only(req);
  const b = parse(z.object({ email: z.email().transform((e) => e.toLowerCase().trim()), role: z.enum(["admin", "member", "viewer"]) }), req.body);
  if (b.role === "admin" && req.workspace!.role !== "owner" && req.workspace!.role !== "admin") throw new HttpError(403, "Not allowed");
  const token = randomToken(24);
  await db().query(
    "INSERT INTO workspace_invites(workspace_id, email, role, token_hash, invited_by, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '7 days')",
    [ws(req), b.email, b.role, sha256(token), actor(req)]);
  await audit(ws(req), who(req), "invite.created", { type: "invite" }, { email: b.email, role: b.role });
  const origin = config.publicUrl || `${req.protocol}://${req.get("host")}`;
  // Orbital does not send email: the admin shares this link. It is shown once.
  res.status(201).json({ link: `${origin}/invite/${token}`, expiresInDays: 7 });
}));

business.delete("/workspace/invites/:id", requireRole("admin"), ah(async (req, res) => {
  await db().query("DELETE FROM workspace_invites WHERE id=$1 AND workspace_id=$2 AND accepted_at IS NULL", [idParam(req), ws(req)]);
  res.json({ ok: true });
}));

business.post("/invites/accept", rateLimit({ windowMs: 15 * 60_000, max: 20, key: "user", name: "invite-accept" }), ah(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
  const inv = (await db().query<any>(
    `SELECT i.*, w.name FROM workspace_invites i JOIN workspaces w ON w.id=i.workspace_id
     WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.expires_at > now()`, [sha256(b.token)])).rows[0];
  if (!inv) throw new HttpError(404, "This invite link is invalid, expired or already used.", "invite_invalid");
  if (inv.email !== req.user!.email.toLowerCase()) throw new HttpError(403, `This invite was sent to ${inv.email}. Sign in with that email to accept it.`, "invite_email");
  await db().query("INSERT INTO workspace_members(workspace_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (workspace_id, user_id) DO NOTHING", [inv.workspace_id, actor(req), inv.role]);
  await db().query("UPDATE workspace_invites SET accepted_at=now() WHERE id=$1", [inv.id]);
  await audit(inv.workspace_id, who(req), "invite.accepted", { type: "user", id: actor(req) }, { role: inv.role });
  res.json({ id: inv.workspace_id, name: inv.name, role: inv.role });
}));

// ── API tokens (for the public /api/v1) ────────────────────────────────────
business.get("/workspace/tokens", requireRole("admin"), ah(async (req, res) => {
  res.json((await db().query("SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at FROM api_tokens WHERE workspace_id=$1 ORDER BY created_at DESC", [ws(req)])).rows);
}));
business.post("/workspace/tokens", requireRole("admin"), ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(["ingest", "query"])).min(1) }), req.body);
  const token = `orb_${randomToken(30)}`;
  const r = await db().query<{ id: string }>(
    "INSERT INTO api_tokens(workspace_id, name, prefix, token_hash, scopes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [ws(req), b.name, token.slice(0, 10), sha256(token), b.scopes, actor(req)]);
  await audit(ws(req), who(req), "token.created", { type: "token", id: r.rows[0].id }, { name: b.name, scopes: b.scopes });
  res.status(201).json({ id: r.rows[0].id, token }); // shown once; only the hash is stored
}));
business.delete("/workspace/tokens/:id", requireRole("admin"), ah(async (req, res) => {
  await db().query("UPDATE api_tokens SET revoked_at=now() WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)]);
  await audit(ws(req), who(req), "token.revoked", { type: "token", id: idParam(req) });
  res.json({ ok: true });
}));

// ── Connectors ─────────────────────────────────────────────────────────────
business.get("/connectors", ah(async (req, res) => {
  res.json((await db().query("SELECT id, kind, name, config_hint, enabled, last_used_at, created_at FROM connectors WHERE workspace_id=$1 ORDER BY created_at", [ws(req)])).rows);
}));
business.post("/connectors", requireRole("admin"), ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), url: z.url().max(2000), secret: z.string().max(200).optional() }), req.body);
  try { await assertSafeUrl(b.url); } catch (e: any) { throw new HttpError(400, e.message); }
  const u = new URL(b.url);
  const r = await db().query<{ id: string }>(
    "INSERT INTO connectors(workspace_id, kind, name, config_encrypted, config_hint, created_by) VALUES ($1,'webhook',$2,$3,$4,$5) RETURNING id",
    [ws(req), b.name, encrypt(JSON.stringify({ url: b.url, secret: b.secret })), `${u.host}${u.pathname.length > 1 ? "/…" : ""}`, actor(req)]);
  await audit(ws(req), who(req), "connector.created", { type: "connector", id: r.rows[0].id }, { name: b.name, host: u.host });
  res.status(201).json({ id: r.rows[0].id });
}));
business.patch("/connectors/:id", requireRole("admin"), ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional() }), req.body);
  const r = await db().query("UPDATE connectors SET name=COALESCE($3,name), enabled=COALESCE($4,enabled) WHERE id=$1 AND workspace_id=$2 RETURNING id", [idParam(req), ws(req), b.name ?? null, b.enabled ?? null]);
  if (!r.rows[0]) throw notFound("Connector");
  await audit(ws(req), who(req), "connector.updated", { type: "connector", id: idParam(req) }, b);
  res.json({ ok: true });
}));
business.delete("/connectors/:id", requireRole("admin"), ah(async (req, res) => {
  await db().query("DELETE FROM connectors WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)]);
  await audit(ws(req), who(req), "connector.deleted", { type: "connector", id: idParam(req) });
  res.json({ ok: true });
}));
business.post("/connectors/:id/test", requireRole("admin"), rateLimit({ windowMs: 60_000, max: 10, key: "user", name: "connector-test" }), ah(async (req, res) => {
  try {
    const r = await deliver(ws(req), idParam(req), { title: "Orbital connector test", text: `Sent by ${req.user!.email} from ${req.workspace!.name}.` });
    res.json({ ok: true, ...r });
  } catch (e: any) {
    throw new HttpError(502, `Delivery failed: ${e.message}`, "delivery_failed");
  }
}));

// ── Automations ────────────────────────────────────────────────────────────
const AutomationInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["briefing", "monitor", "operator"]),
  schedule: ScheduleSchema,
  enabled: z.boolean().default(true),
  config: z.object({
    period: z.enum(["day", "week"]).optional(),
    question: z.string().max(2000).optional(),
    objective: z.string().max(2000).optional(),
    connectorId: z.uuid().nullish(),
    autoDeliver: z.boolean().optional(),
    autoApproveInternal: z.boolean().optional(),
  }).default({}),
});

async function checkAutomation(req: Request, a: z.infer<typeof AutomationInput>) {
  if (!validTimeZone(a.schedule.tz)) throw new HttpError(400, "Unknown time zone");
  if (a.kind === "monitor" && (a.config.question ?? "").trim().length < 8) throw new HttpError(400, "A monitor needs a research question.");
  if (a.kind === "operator" && (a.config.objective ?? "").trim().length < 8) throw new HttpError(400, "An operations agent needs a standing objective.");
  if (a.kind === "operator" && a.config.autoDeliver) throw new HttpError(400, "Messages proposed by the operations agent always require approval.");
  if (a.config.connectorId && !(await db().query("SELECT 1 FROM connectors WHERE id=$1 AND workspace_id=$2", [a.config.connectorId, ws(req)])).rows.length) throw notFound("Connector");
}

business.get("/automations", ah(async (req, res) => {
  res.json((await db().query(
    `SELECT a.*, u.email AS created_by_email FROM automations a LEFT JOIN users u ON u.id=a.created_by WHERE a.workspace_id=$1 ORDER BY a.created_at`, [ws(req)])).rows);
}));
business.post("/automations", requireRole("admin"), ah(async (req, res) => {
  const b = parse(AutomationInput, req.body);
  await checkAutomation(req, b);
  const r = await db().query<{ id: string }>(
    "INSERT INTO automations(workspace_id, created_by, name, kind, schedule, config, enabled, next_run_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [ws(req), actor(req), b.name, b.kind, JSON.stringify(b.schedule), JSON.stringify(b.config), b.enabled, b.enabled ? nextRun(b.schedule) : null]);
  await audit(ws(req), who(req), "automation.created", { type: "automation", id: r.rows[0].id }, { name: b.name, kind: b.kind, autoDeliver: !!b.config.autoDeliver, autoApproveInternal: !!b.config.autoApproveInternal });
  res.status(201).json({ id: r.rows[0].id });
}));
business.patch("/automations/:id", requireRole("admin"), ah(async (req, res) => {
  const cur = (await db().query<any>("SELECT * FROM automations WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)])).rows[0];
  if (!cur) throw notFound("Automation");
  const merged = parse(AutomationInput, { name: cur.name, kind: cur.kind, schedule: cur.schedule, enabled: cur.enabled, config: cur.config, ...req.body, ...(req.body?.config ? { config: { ...cur.config, ...req.body.config } } : {}) });
  await checkAutomation(req, merged);
  await db().query(
    "UPDATE automations SET name=$3, schedule=$4, config=$5, enabled=$6, next_run_at=$7, created_by=$8 WHERE id=$1 AND workspace_id=$2",
    // Whoever last changes an automation is the admin whose standing authorization it runs under.
    [cur.id, ws(req), merged.name, JSON.stringify(merged.schedule), JSON.stringify(merged.config), merged.enabled, merged.enabled ? nextRun(merged.schedule) : null, actor(req)]);
  await audit(ws(req), who(req), "automation.updated", { type: "automation", id: cur.id }, { enabled: merged.enabled, autoDeliver: !!merged.config.autoDeliver, autoApproveInternal: !!merged.config.autoApproveInternal });
  res.json({ ok: true });
}));
business.delete("/automations/:id", requireRole("admin"), ah(async (req, res) => {
  await db().query("DELETE FROM automations WHERE id=$1 AND workspace_id=$2", [idParam(req), ws(req)]);
  await audit(ws(req), who(req), "automation.deleted", { type: "automation", id: idParam(req) });
  res.json({ ok: true });
}));
business.post("/automations/:id/run", requireRole("admin"), rateLimit({ windowMs: 60 * 60_000, max: 30, key: "user", name: "automation-run" }), ah(async (req, res) => {
  if (!(await runNow(ws(req), idParam(req)))) throw notFound("Automation");
  res.status(202).json({ ok: true });
}));

// ── Approval queue ─────────────────────────────────────────────────────────
business.get("/actions", ah(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  res.json((await db().query(
    `SELECT x.*, a.name AS automation_name, u.email AS decided_by_email FROM actions x
     LEFT JOIN automations a ON a.id=x.automation_id LEFT JOIN users u ON u.id=x.decided_by
     WHERE x.workspace_id=$1 ${status ? "AND x.status=$2" : ""} ORDER BY (x.status='proposed') DESC, x.created_at DESC LIMIT 200`,
    status ? [ws(req), status] : [ws(req)])).rows);
}));
business.post("/actions/:id/approve", requireRole("admin"), ah(async (req, res) => {
  const b = parse(z.object({ text: z.string().max(4000).optional() }), req.body ?? {});
  const id = idParam(req);
  const a = (await db().query<any>("SELECT kind, status FROM actions WHERE id=$1 AND workspace_id=$2", [id, ws(req)])).rows[0];
  if (!a) throw notFound("Action");
  if (a.status !== "proposed") throw new HttpError(400, `This action is already ${a.status}.`);
  // Approvers may edit an outgoing message before it is sent.
  if (b.text !== undefined && a.kind === "send_message") await db().query("UPDATE actions SET payload = payload || $3 WHERE id=$1 AND workspace_id=$2", [id, ws(req), JSON.stringify({ text: b.text })]);
  res.json(await executeAction(ws(req), id, actor(req), "approval"));
}));
business.post("/actions/:id/reject", requireRole("admin"), ah(async (req, res) => {
  const r = await db().query("UPDATE actions SET status='rejected', decided_by=$3, decided_at=now() WHERE id=$1 AND workspace_id=$2 AND status='proposed' RETURNING title", [idParam(req), ws(req), actor(req)]);
  if (!r.rows[0]) throw notFound("Pending action");
  await audit(ws(req), who(req), "action.rejected", { type: "action", id: idParam(req) }, { title: r.rows[0].title });
  res.json({ ok: true });
}));

// ── Audit ──────────────────────────────────────────────────────────────────
business.get("/audit", requireRole("admin"), ah(async (req, res) => {
  res.json((await db().query(
    `SELECT l.id, l.action, l.target_type, l.target_id, l.detail, l.created_at, COALESCE(u.email, l.actor_label) AS actor
     FROM audit_log l LEFT JOIN users u ON u.id=l.actor_id WHERE l.workspace_id=$1 ORDER BY l.created_at DESC LIMIT 300`, [ws(req)])).rows);
}));
