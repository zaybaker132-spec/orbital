import { db } from "../db/client.js";
import { log } from "./log.js";

/**
 * Data retention. Removes only operational records that have expired or served their purpose; never
 * user content. Runs shortly after start and then every 6 hours.
 *
 *   expired sessions ................ when they expire
 *   used/expired password resets .... after 1 day
 *   finished background jobs ........ after 14 days (failed jobs: 60 days, for diagnosis)
 *   email delivery log .............. after 180 days
 *   security events (auth_events) ... after 365 days
 *   AI usage records ................ after 400 days (13 months of cost history)
 */
export const RETENTION = [
  { what: "sessions", sql: "DELETE FROM sessions WHERE expires_at < now()" },
  { what: "password_resets", sql: "DELETE FROM password_resets WHERE expires_at < now() - interval '1 day' OR used_at < now() - interval '1 day'" },
  { what: "jobs (done)", sql: "DELETE FROM jobs WHERE status='done' AND updated_at < now() - interval '14 days'" },
  { what: "jobs (failed)", sql: "DELETE FROM jobs WHERE status='failed' AND updated_at < now() - interval '60 days'" },
  { what: "email_log", sql: "DELETE FROM email_log WHERE created_at < now() - interval '180 days'" },
  { what: "auth_events", sql: "DELETE FROM auth_events WHERE created_at < now() - interval '365 days'" },
  { what: "ai_usage", sql: "DELETE FROM ai_usage WHERE created_at < now() - interval '400 days'" },
];

export async function runHousekeeping() {
  const removed: Record<string, number> = {};
  for (const r of RETENTION) {
    try {
      const res = await db().query(`${r.sql} RETURNING 1`);
      if (res.rows.length) removed[r.what] = res.rows.length;
    } catch (e) {
      log.warn("housekeeping step failed", { what: r.what, err: e });
    }
  }
  if (Object.keys(removed).length) log.info("housekeeping", { removed });
  return removed;
}

let timer: NodeJS.Timeout | null = null;
export function startHousekeeping() {
  setTimeout(() => void runHousekeeping(), 60_000).unref();
  timer = setInterval(() => void runHousekeeping(), 6 * 60 * 60_000);
  timer.unref();
}
