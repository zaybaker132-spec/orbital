import { db } from "../db/client.js";

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
  const r = await db().query<{ id: string }>("INSERT INTO jobs(workspace_id, type, payload) VALUES ($1,$2,$3) RETURNING id", [workspaceId, type, JSON.stringify(payload)]);
  setImmediate(tick);
  return r.rows[0].id;
}

async function tick() {
  while (running < MAX_CONCURRENCY) {
    const r = await db().query<{ id: string; workspace_id: string; type: string; payload: any; attempts: number }>(
      `UPDATE jobs SET status='running', attempts=attempts+1, updated_at=now()
       WHERE id = (SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1)
       RETURNING id, workspace_id, type, payload, attempts`,
    );
    const job = r.rows[0];
    if (!job) return;
    running++;
    const handler = handlers.get(job.type);
    (async () => {
      try {
        if (!handler) throw new Error(`No handler for job type ${job.type}`);
        await handler({ id: job.id, workspaceId: job.workspace_id, payload: job.payload });
        await db().query("UPDATE jobs SET status='done', updated_at=now() WHERE id=$1", [job.id]);
      } catch (e: any) {
        console.error(`[jobs] ${job.type} failed:`, e?.message ?? e);
        const retry = job.attempts < 2 && !e?.noRetry;
        await db().query("UPDATE jobs SET status=$2, error=$3, updated_at=now() WHERE id=$1", [job.id, retry ? "queued" : "failed", String(e?.message ?? e).slice(0, 2000)]);
      } finally {
        running--;
        setImmediate(tick);
      }
    })();
  }
}

export async function startJobs() {
  await db().query("UPDATE jobs SET status='queued' WHERE status='running'");
  timer = setInterval(tick, 5000);
  timer.unref();
  setImmediate(tick);
}
