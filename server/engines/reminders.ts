import { db } from "../db/client.js";
import { emit } from "../lib/events.js";

/**
 * Smart reminders.
 *  - Reminders: set by a person for a time, optionally tied to a task, note, project, opportunity,
 *    open question or conversation. Personal to whoever set them. Fired by a scheduler tick.
 *  - Nudges: computed from real state on demand (overdue tasks, approaching deadlines, stalled
 *    projects, ideas left unfinished). Nothing is invented; each nudge links to its source item.
 */

export const ITEM_TYPES = ["task", "document", "project", "opportunity", "gap", "conversation", "research"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

const ITEM_TABLE: Record<ItemType, { table: string; title: string }> = {
  task: { table: "tasks", title: "title" },
  document: { table: "documents", title: "title" },
  project: { table: "projects", title: "name" },
  opportunity: { table: "opportunities", title: "title" },
  gap: { table: "knowledge_gaps", title: "question" },
  conversation: { table: "conversations", title: "title" },
  research: { table: "research_sessions", title: "question" },
};

/** The item a reminder points at must exist in this workspace (and, for conversations, be the person's own). */
export async function itemTitle(workspaceId: string, userId: string, type: ItemType, id: string): Promise<string | null> {
  const t = ITEM_TABLE[type];
  const own = type === "conversation" ? " AND created_by=$3" : "";
  const r = await db().query<{ title: string }>(`SELECT ${t.title} AS title FROM ${t.table} WHERE id=$1 AND workspace_id=$2${own}`, type === "conversation" ? [id, workspaceId, userId] : [id, workspaceId]);
  return r.rows[0]?.title ?? null;
}

export function itemLink(type: string | null, id: string | null, extra?: { projectId?: string | null }): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "task": return extra?.projectId ? `/projects/${extra.projectId}` : "/projects";
    case "document": return `/knowledge/${id}`;
    case "project": return `/projects/${id}`;
    case "opportunity": return "/opportunities";
    case "gap": return "/core";
    case "conversation": return `/c/${id}`;
    case "research": return `/research/${id}`;
    default: return null;
  }
}

export async function listReminders(workspaceId: string, userId: string) {
  const r = await db().query<any>(
    `SELECT r.*, CASE WHEN r.item_type='task' THEN (SELECT project_id FROM tasks t WHERE t.id=r.item_id) END AS task_project_id
     FROM reminders r WHERE r.workspace_id=$1 AND r.user_id=$2 AND (r.status IN ('scheduled','fired') OR r.updated_at > now() - interval '7 days')
     ORDER BY (r.status='fired') DESC, (r.status IN ('done','dismissed')), r.due_at`, [workspaceId, userId]);
  return r.rows.map(({ task_project_id, ...x }) => ({ ...x, link: itemLink(x.item_type, x.item_id, { projectId: task_project_id }) }));
}

/** Fire every reminder whose time has come and tell its owner's open windows. */
export async function tickReminders() {
  const due = await db().query<any>(
    `UPDATE reminders SET status='fired', fired_at=now(), updated_at=now() WHERE status='scheduled' AND due_at <= now()
     RETURNING id, workspace_id, user_id, title, note, item_type, item_id, due_at`);
  for (const r of due.rows) {
    let projectId: string | null = null;
    if (r.item_type === "task") projectId = (await db().query<any>("SELECT project_id FROM tasks WHERE id=$1", [r.item_id])).rows[0]?.project_id ?? null;
    emit(r.workspace_id, { type: "reminder", userId: r.user_id, id: r.id, title: r.title, note: r.note, link: itemLink(r.item_type, r.item_id, { projectId }) });
  }
  return due.rows.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startReminders(intervalMs = 30_000) {
  if (timer) return;
  timer = setInterval(() => tickReminders().catch((e) => console.error("[reminders]", e.message)), intervalMs);
  timer.unref?.();
}
export function stopReminders() { if (timer) clearInterval(timer); timer = null; }

// ── Nudges ─────────────────────────────────────────────────────────────────
export interface Nudge {
  key: string;
  kind: "overdue" | "due_soon" | "milestone" | "deadline" | "stalled_project" | "unfinished_idea" | "stale_opportunity" | "open_question" | "stale_research" | "maintenance";
  title: string;
  detail: string;
  link: string | null;
  itemType: ItemType | null;
  itemId: string | null;
  /** Higher sorts first. */
  priority: number;
}

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** Tags that mark a note as an idea or something unfinished. */
export const IDEA_TAGS = ["idea", "ideas", "draft", "todo", "wip", "someday", "brainstorm"];

export async function computeNudges(workspaceId: string, userId: string, today: string): Promise<Nudge[]> {
  const q = <T = any>(sql: string, params: unknown[]) => db().query<T>(sql, params).then((r) => r.rows);
  const [tasks, milestones, projects, stalled, ideas, opps, gaps, dismissed, staleResearch, cleanup] = await Promise.all([
    q(`SELECT t.id, t.title, t.due_date, p.id AS project_id, p.name AS project FROM tasks t JOIN projects p ON p.id=t.project_id
       WHERE t.workspace_id=$1 AND NOT t.done AND t.due_date IS NOT NULL AND t.due_date <= $2::date + 2 AND p.status='active' ORDER BY t.due_date LIMIT 30`, [workspaceId, today]),
    q(`SELECT m.id, m.title, m.target_date, p.id AS project_id, p.name AS project FROM milestones m JOIN projects p ON p.id=m.project_id
       WHERE m.workspace_id=$1 AND NOT m.done AND m.target_date IS NOT NULL AND m.target_date <= $2::date + 3 AND p.status='active' ORDER BY m.target_date LIMIT 20`, [workspaceId, today]),
    q(`SELECT p.id, p.name, p.deadline, (SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id) AS total, (SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND t.done) AS done
       FROM projects p WHERE p.workspace_id=$1 AND p.status='active' AND p.deadline IS NOT NULL AND p.deadline <= $2::date + 7 LIMIT 20`, [workspaceId, today]),
    q(`SELECT p.id, p.name, (now()::date - p.updated_at::date) AS idle, (SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND NOT t.done) AS open
       FROM projects p WHERE p.workspace_id=$1 AND p.status='active' AND p.updated_at < now() - interval '14 days'
       AND EXISTS (SELECT 1 FROM tasks t WHERE t.project_id=p.id AND NOT t.done) ORDER BY p.updated_at LIMIT 10`, [workspaceId]),
    q(`SELECT d.id, d.title, (now()::date - d.updated_at::date) AS idle FROM documents d
       WHERE d.workspace_id=$1 AND d.kind='note' AND d.tags && $2::text[] AND d.updated_at < now() - interval '5 days' ORDER BY d.updated_at LIMIT 10`, [workspaceId, IDEA_TAGS]),
    q(`SELECT o.id, o.title, o.status, o.next_action, (now()::date - o.updated_at::date) AS idle FROM opportunities o
       WHERE o.workspace_id=$1 AND o.status IN ('identified','investigating','validated') AND o.updated_at < now() - interval '10 days' ORDER BY o.updated_at LIMIT 8`, [workspaceId]),
    q(`SELECT g.id, g.question, (now()::date - g.created_at::date) AS age FROM knowledge_gaps g
       WHERE g.workspace_id=$1 AND g.status='open' AND g.created_at < now() - interval '7 days' ORDER BY g.created_at LIMIT 6`, [workspaceId]),
    q<{ nudge_key: string }>(`SELECT nudge_key FROM nudge_dismissals WHERE workspace_id=$1 AND user_id=$2 AND (until IS NULL OR until > now())`, [workspaceId, userId]),
    q(`SELECT id, question, (freshness->>'stale')::int AS stale, (freshness->>'checked_at') AS checked FROM research_sessions
       WHERE workspace_id=$1 AND status='completed' AND freshness->>'status'='stale' ORDER BY completed_at DESC LIMIT 6`, [workspaceId]),
    q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE kind='conflicting_memories')::int AS conflicts FROM maintenance_suggestions WHERE workspace_id=$1 AND status='open'`, [workspaceId]),
  ]);
  const out: Nudge[] = [];
  for (const t of tasks) {
    const d = days(t.due_date, today);
    out.push(d < 0
      ? { key: `task:${t.id}:overdue`, kind: "overdue", title: t.title, detail: `${t.project} · overdue by ${plural(-d, "day")}`, link: `/projects/${t.project_id}`, itemType: "task", itemId: t.id, priority: 100 - d }
      : { key: `task:${t.id}:soon`, kind: "due_soon", title: t.title, detail: `${t.project} · due ${d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`}`, link: `/projects/${t.project_id}`, itemType: "task", itemId: t.id, priority: 80 - d * 5 });
  }
  for (const m of milestones) {
    const d = days(m.target_date, today);
    out.push({ key: `milestone:${m.id}:${m.target_date}`, kind: "milestone", title: m.title, detail: `${m.project} milestone · ${d < 0 ? `missed by ${plural(-d, "day")}` : d === 0 ? "target is today" : `target in ${plural(d, "day")}`}`, link: `/projects/${m.project_id}`, itemType: "project", itemId: m.project_id, priority: 85 - d * 3 });
  }
  for (const p of projects) {
    const d = days(p.deadline, today);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    if (p.total && p.done === p.total) continue;
    out.push({ key: `deadline:${p.id}:${p.deadline}`, kind: "deadline", title: p.name, detail: `Project deadline ${d < 0 ? `passed ${plural(-d, "day")} ago` : d === 0 ? "is today" : `in ${plural(d, "day")}`} · ${pct}% of tasks done`, link: `/projects/${p.id}`, itemType: "project", itemId: p.id, priority: 90 - d * 2 });
  }
  for (const p of stalled) out.push({ key: `stalled:${p.id}`, kind: "stalled_project", title: p.name, detail: `No progress in ${plural(p.idle, "day")} · ${plural(p.open, "open task")}`, link: `/projects/${p.id}`, itemType: "project", itemId: p.id, priority: 40 + Math.min(20, p.idle / 3) });
  for (const d of ideas) out.push({ key: `idea:${d.id}`, kind: "unfinished_idea", title: d.title, detail: `An idea you haven't touched in ${plural(d.idle, "day")}`, link: `/knowledge/${d.id}`, itemType: "document", itemId: d.id, priority: 35 + Math.min(15, d.idle / 4) });
  for (const o of opps) out.push({ key: `opp:${o.id}:${o.status}`, kind: "stale_opportunity", title: o.title, detail: `Opportunity ${o.status} for ${plural(o.idle, "day")}${o.next_action ? ` · next: ${o.next_action}` : ""}`, link: "/opportunities", itemType: "opportunity", itemId: o.id, priority: 30 + Math.min(15, o.idle / 4) });
  for (const g of gaps) out.push({ key: `gap:${g.id}`, kind: "open_question", title: g.question, detail: `Open question for ${plural(g.age, "day")}`, link: "/core", itemType: "gap", itemId: g.id, priority: 20 + Math.min(10, g.age / 5) });
  for (const r of staleResearch) out.push({ key: `research:${r.id}:stale`, kind: "stale_research", title: r.question, detail: `${plural(r.stale, "fact")} in this report may be out of date · refresh the affected sections`, link: `/research/${r.id}`, itemType: "research", itemId: r.id, priority: 45 + Math.min(10, r.stale * 2) });
  const c = cleanup[0];
  if (c && (c.conflicts > 0 || c.n >= 5)) {
    // One nudge, keyed by the count so it returns only when more has piled up.
    out.push({ key: `maintenance:00000000-0000-4000-8000-000000000000:${c.n}`, kind: "maintenance", title: c.conflicts ? `${plural(c.conflicts, "memory conflict")} to resolve` : `${c.n} knowledge cleanup suggestions`, detail: `${c.n} suggestion${c.n === 1 ? "" : "s"} from knowledge maintenance · nothing changes until you choose`, link: "/maintenance", itemType: null, itemId: null, priority: 38 + Math.min(12, c.conflicts * 4) });
  }
  const hidden = new Set(dismissed.map((d) => d.nudge_key));
  return out.filter((n) => !hidden.has(n.key)).sort((a, b) => b.priority - a.priority);
}
