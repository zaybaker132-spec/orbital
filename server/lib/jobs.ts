import { db } from "../db/client.js";
import { config } from "../config.js";
import { currentLanguage, runInLanguage } from "./language.js";
import { currentContext, runInContext } from "./context.js";
import { log } from "./log.js";

/**
 * Durable in-process job queue backed by the `jobs` table. Jobs survive restarts
 * (interrupted 'running' jobs are re-queued on boot). One worker loop, bounded concurrency.
 */
type Handler = (job: { id: string; workspaceId: string; payload: any }) => Promise<void>;
const handlers = new Map<string, Handler>();
let running = 0;
const MAX_CONCURRENCY = 3;
let timer: NodeJS.Timeout | null = null;

export function registerJob(type: string, handler: Handler) {
  handlers.set(type, handler);
}

export async function enqueue(workspaceId: string, type: string, payload: Record<string, unknown> = {}) {
  // Remember who's waiting on it and in which language, so its output is written in that language.
  if (payload._lang === undefined && currentLanguage() !== "en") payload = { ...payload, _lang: currentLanguage() };
  // …and who it's for, so AI usage from background work is attributed to them.
  const by = currentContext()?.userId;
  if (by && payload._user === undefined) payload = { ...payload, _user: by };
  const r = await db().query<{ id: string }>("INSERT INTO jobs(workspace_id, type, payload) VALUES ($1,$2,$3) RETURNING id", [workspaceId, type, JSON.stringify(payload)]);
  setImmediate(tick);
  return r.rows[0].id;
}

/** Queue a job unless the same one (type + key field) is already waiting: for work triggered by every keystroke save. */
export async function enqueueOnce(workspaceId: string, type: string, key: string, payload: Record<string, unknown>) {
  const waiting = await db().query("SELECT 1 FROM jobs WHERE workspace_id=$1 AND type=$2 AND status='queued' AND payload->>$3 = $4 LIMIT 1", [workspaceId, type, key, String(payload[key])]);
  if (waiting.rows.length) return null;
  return enqueue(workspaceId, type, payload);
}

let stopped = false;
const HEARTBEAT_MS = 30_000;
/** A running job whose heartbeat stopped this long ago belonged to a process that died: run it again. */
const STALE = "2 minutes";
export async function requeueStale() {
  const r = await db().query(`UPDATE jobs SET status='queued', run_after=NULL WHERE status='running' AND updated_at < now() - interval '${STALE}' RETURNING id`);
  if (r.rows.length) log.warn("requeued interrupted jobs", { count: r.rows.length });
}
let sweeper: NodeJS.Timeout | null = null;
async function tick() {
  while (running < MAX_CONCURRENCY && !stopped) {
    const r = await db().query<{ id: string; workspace_id: string; type: string; payload: any; attempts: number }>(
      // SKIP LOCKED + the status check: with several server instances, each job is claimed exactly once.
      `UPDATE jobs SET status='running', attempts=attempts+1, updated_at=now()
       WHERE status='queued' AND id = (SELECT id FROM jobs WHERE status='queued' AND (run_after IS NULL OR run_after <= now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id, workspace_id, type, payload, attempts`,
    );
    const job = r.rows[0];
    if (!job) return;
    running++;
    const handler = handlers.get(job.type);
    (async () => {
      // Heartbeat: a running job keeps touching its row, so other instances can tell it from one whose process died.
      const beat = setInterval(() => void db().query("UPDATE jobs SET updated_at=now() WHERE id=$1 AND status='running'", [job.id]).catch(() => {}), HEARTBEAT_MS);
      beat.unref();
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        const started = Date.now();
        await runInContext({ requestId: `job-${job.id.slice(0, 8)}`, workspaceId: job.workspace_id, userId: typeof job.payload?._user === "string" ? job.payload._user : undefined, feature: `job:${job.type}` }, () =>
          runInLanguage(job.payload?._lang, () => handler({ id: job.id, workspaceId: job.workspace_id, payload: job.payload })));
        if (Date.now() - started > 60_000) log.info("long job finished", { type: job.type, ms: Date.now() - started });
        await db().query("UPDATE jobs SET status='done', updated_at=now() WHERE id=$1", [job.id]);
      } catch (e: any) {
        const retry = job.attempts < 2 && !e?.noRetry;
        (retry ? log.warn : log.error)(retry ? "job failed, will retry" : "job failed", { type: job.type, job: job.id, attempt: job.attempts, error: String(e?.message ?? e).slice(0, 300) });
        // Retries back off (30 s, then 2 min) so a rate limit or brief outage has time to clear.
        await db().query("UPDATE jobs SET status=$2, error=$3, run_after=$4, updated_at=now() WHERE id=$1",
          [job.id, retry ? "queued" : "failed", String(e?.message ?? e).slice(0, 2000), retry ? new Date(Date.now() + (job.attempts === 1 ? 30_000 : 120_000)) : null]);
      } finally {
        clearInterval(beat);
        running--;
        setImmediate(tick);
      }
    })();
  }
}

export async function startJobs() {
  // Jobs interrupted by a restart run again. The embedded database belongs to this process alone, so its
  // running jobs are certainly orphaned; on a shared Postgres only jobs whose heartbeat stopped are, since
  // another instance may be running the rest.
  if (!config.databaseUrl) await db().query("UPDATE jobs SET status='queued' WHERE status='running'");
  else await requeueStale();
  sweeper = setInterval(() => void requeueStale().catch((e) => log.warn("job sweep failed", { err: e })), 60_000);
  sweeper.unref();
  timer = setInterval(tick, 5000);
  timer.unref();
  setImmediate(tick);
}

/** Graceful shutdown: take no new jobs and wait (up to `ms`) for running ones to finish. */
export async function stopJobs(ms = 25_000) {
  if (timer) clearInterval(timer);
  if (sweeper) clearInterval(sweeper);
  timer = sweeper = null;
  stopped = true;
  const until = Date.now() + ms;
  while (running > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  return running;
}

export const jobsRunning = () => running;
