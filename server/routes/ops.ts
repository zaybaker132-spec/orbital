import { Router } from "express";
import os from "node:os";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { ah, HttpError, idParam } from "../lib/http.js";
import { requireRole } from "../auth/workspace.js";
import { isServerAdmin } from "./waitlist.js";
import { aiStatus } from "../ai/provider.js";
import { emailConfigured } from "../lib/email.js";
import { usageSummary } from "../lib/usage.js";
import { jobsRunning } from "../lib/jobs.js";
import { runHousekeeping } from "../lib/housekeeping.js";

/**
 * Operations: AI usage and cost (workspace admins see their workspace; server admins see everything),
 * background-job health with failed jobs and retry, and a status overview for whoever runs the server.
 */
export const ops = Router();
const started = Date.now();

const requireServerAdmin = (email?: string) => {
  if (!isServerAdmin(email)) throw new HttpError(403, "Only server admins (ORBITAL_ADMIN_EMAILS) can see this.", "forbidden");
};

/** This workspace's AI usage this month (admins and owners of the workspace). */
ops.get("/workspace/ai-usage", requireRole("admin"), ah(async (req, res) => {
  res.json(await usageSummary(req.workspace!.id));
}));

ops.get("/admin/ai-usage", ah(async (req, res) => {
  requireServerAdmin(req.user?.email);
  res.json(await usageSummary(null));
}));

/** One screen for whoever runs Orbital: database, jobs, AI, email, process. */
ops.get("/admin/status", ah(async (req, res) => {
  requireServerAdmin(req.user?.email);
  const t0 = Date.now();
  await db().query("SELECT 1");
  const dbMs = Date.now() - t0;
  const jobs = (await db().query<any>(
    `SELECT count(*) FILTER (WHERE status='queued')::int AS queued, count(*) FILTER (WHERE status='running')::int AS running,
            count(*) FILTER (WHERE status='failed' AND updated_at > now() - interval '24 hours')::int AS failed_24h,
            EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status='queued')))::int AS oldest_queued_s
     FROM jobs`)).rows[0];
  const users = (await db().query<any>("SELECT count(*)::int AS n FROM users")).rows[0].n;
  const emails = (await db().query<any>("SELECT status, count(*)::int AS n FROM email_log WHERE created_at > now() - interval '7 days' GROUP BY status")).rows;
  const mem = process.memoryUsage();
  res.json({
    version: config.version,
    uptimeS: Math.round((Date.now() - started) / 1000),
    database: { kind: config.databaseUrl ? "postgres" : "embedded", pingMs: dbMs },
    jobs: { ...jobs, workerRunning: jobsRunning() },
    ai: { ...aiStatus(), monthlyTokenCap: config.aiLimits.monthlyTokensPerWorkspace || null },
    email: { configured: emailConfigured(), last7Days: Object.fromEntries(emails.map((e: any) => [e.status, e.n])) },
    users,
    process: { rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), load: os.loadavg()[0] },
    security: { forceHttps: config.forceHttps, trustProxy: config.trustProxy, signupOpen: config.allowSignup, alertsConfigured: !!config.alertWebhook },
  });
}));

/** Failed background jobs (newest first), without their payloads (which can hold user content). */
ops.get("/admin/jobs/failed", ah(async (req, res) => {
  requireServerAdmin(req.user?.email);
  res.json((await db().query(
    "SELECT id, workspace_id, type, attempts, left(error, 500) AS error, created_at, updated_at FROM jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 100")).rows);
}));

ops.post("/admin/jobs/:id/retry", ah(async (req, res) => {
  requireServerAdmin(req.user?.email);
  const r = await db().query("UPDATE jobs SET status='queued', attempts=0, run_after=NULL, error=NULL, updated_at=now() WHERE id=$1 AND status='failed' RETURNING id", [idParam(req)]);
  if (!r.rows.length) throw new HttpError(404, "No failed job with that id", "not_found");
  res.json({ ok: true });
}));

ops.post("/admin/housekeeping", ah(async (req, res) => {
  requireServerAdmin(req.user?.email);
  res.json({ removed: await runHousekeeping() });
}));
