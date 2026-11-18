import { db } from "../db/client.js";

/**
 * Contribution calendar: one cell per day for the last year, like a GitHub contribution graph,
 * with each day's work split by kind so it can be colour-coded. Counts real events only:
 * the activity log, documents, research, focus sessions and the person's own messages.
 */

export const KINDS = ["build", "knowledge", "research", "thinking", "opportunity"] as const;
export type Kind = (typeof KINDS)[number];
export type Day = { date: string; total: number } & Record<Kind, number>;

const kindOf = (type: string): Kind => {
  const p = type.split(".")[0];
  if (p === "task" || p === "milestone" || p === "project" || p === "focus") return "build";
  if (p === "research" || p === "gap") return "research";
  if (p === "opportunity") return "opportunity";
  if (p === "conversation" || p === "feedback" || p === "automation") return "thinking";
  return "knowledge";
};

/** A valid IANA zone, or UTC. */
export function safeZone(tz: unknown): string {
  if (typeof tz !== "string" || tz.length > 64) return "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

export async function contributionCalendar(workspaceId: string, userId: string, opts: { projectId?: string | null; tz?: string; days?: number }) {
  const tz = safeZone(opts.tz);
  const days = Math.min(371, Math.max(7, opts.days ?? 371));
  const pid = opts.projectId ?? null;
  // Hourly buckets in UTC keep the result small; each hour is then placed on the person's own calendar day.
  const rows = (await db().query<{ hour: string; type: string; n: number }>(
    `WITH since AS (SELECT now() - make_interval(days => $3::int + 1) AS t)
     SELECT to_char(date_trunc('hour', at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour, type, count(*)::int AS n FROM (
       -- The activity log, minus documents and research (counted from their own tables below, so nothing doubles).
       SELECT a.created_at AS at, a.type FROM activity_events a, since
        WHERE a.workspace_id=$1 AND a.created_at > since.t AND a.type NOT LIKE 'document.%' AND a.type NOT LIKE 'research.%'
          AND ($2::uuid IS NULL OR (a.ref_type='project' AND a.ref_id=$2::uuid))
       UNION ALL
       SELECT d.created_at, 'document.created' FROM documents d, since
        WHERE d.workspace_id=$1 AND d.created_at > since.t AND ($2::uuid IS NULL OR d.project_id=$2::uuid)
       UNION ALL
       SELECT r.created_at, 'research.started' FROM research_sessions r, since
        WHERE r.workspace_id=$1 AND r.created_at > since.t AND ($2::uuid IS NULL OR r.project_id=$2::uuid)
       UNION ALL
       SELECT m.created_at, 'conversation.message' FROM messages m JOIN conversations c ON c.id=m.conversation_id, since
        WHERE c.workspace_id=$1 AND c.created_by=$4 AND m.role='user' AND m.created_at > since.t AND ($2::uuid IS NULL OR c.project_id=$2::uuid)
     ) e GROUP BY 1, 2`,
    [workspaceId, pid, days, userId])).rows;

  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(new Date());
  const byDate = new Map<string, Day>();
  const blank = (date: string): Day => ({ date, total: 0, build: 0, knowledge: 0, research: 0, thinking: 0, opportunity: 0 });
  // Every day from `days` ago to today, in order, so the client can lay out the grid directly.
  const end = Date.parse(`${today}T12:00:00Z`);
  const list: Day[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    const day = blank(d);
    list.push(day);
    byDate.set(d, day);
  }
  for (const r of rows) {
    const d = byDate.get(fmt.format(new Date(r.hour)));
    if (!d) continue;
    d[kindOf(r.type)] += r.n;
    d.total += r.n;
  }

  // Streaks count back from today (or yesterday, if nothing has happened yet today).
  let current = 0, longest = 0, run = 0;
  for (const d of list) { run = d.total ? run + 1 : 0; longest = Math.max(longest, run); }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].total) current++;
    else if (i === list.length - 1) continue;
    else break;
  }
  const busiest = list.reduce<Day | null>((b, d) => (d.total && (!b || d.total > b.total) ? d : b), null);
  const totals = Object.fromEntries(KINDS.map((k) => [k, list.reduce((s, d) => s + d[k], 0)])) as Record<Kind, number>;
  return {
    timeZone: tz,
    today,
    days: list,
    total: list.reduce((s, d) => s + d.total, 0),
    activeDays: list.filter((d) => d.total).length,
    currentStreak: current,
    longestStreak: longest,
    busiest: busiest ? { date: busiest.date, total: busiest.total } : null,
    totals,
  };
}
