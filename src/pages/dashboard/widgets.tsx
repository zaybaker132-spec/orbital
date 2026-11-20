import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";
import { tx, tn, locale } from "@/i18n";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { label, timeAgo } from "@/lib/format";
import { formatWhen, localToday } from "@/lib/when";
import { useApp } from "@/state/app";
import { Button, Pulse } from "@/components/ui";
import { toast, toastError } from "@/state/ui";
import { NeuralCore } from "@/neural/NeuralCore";
import { ContributionGraph } from "@/components/ContributionGraph";
import type { WidgetType } from "../../../shared/environment";
import { TrailList, type TrailItem } from "@/components/Trail";

/** A widget's body. Each one reads its own data, so a dashboard only loads what it shows. */
export const WIDGET_BODIES: Record<WidgetType, () => ReactNode> = {
  today: Today, ask: Ask, core: Core, "quick-note": QuickNote, tasks: Tasks, projects: Projects, reminders: Reminders,
  nudges: Nudges, notes: Notes, papers: Papers, research: Research, focus: Focus, activity: Activity, growth: Growth,
  questions: Questions, opportunities: Opportunities, recent: Recent, favorites: Favorites,
};
/** Where a widget's "open" arrow goes. */
export const WIDGET_LINKS: Partial<Record<WidgetType, string>> = {
  tasks: "/projects", projects: "/projects", reminders: "/reminders", notes: "/knowledge", papers: "/papers", research: "/research",
  focus: "/focus", growth: "/core", questions: "/maintenance", opportunities: "/opportunities", core: "/core",
};

const today = () => localToday();
function List({ items, empty }: { items: ReactNode[] | undefined; empty: string }) {
  if (!items) return <Pulse />;
  if (!items.length) return <p className="py-2 text-[0.82rem] text-mute-soft">{empty}</p>;
  return <ul className="-mx-1.5 space-y-px">{items}</ul>;
}
function Row({ to, title, meta, warn }: { to: string; title: string; meta?: ReactNode; warn?: boolean }) {
  return (
    <li>
      <Link to={to} className="flex items-baseline gap-3 rounded-md px-1.5 py-1.5 text-[0.84rem] hover:bg-white/[0.04]">
        <span className="min-w-0 flex-1 truncate text-white/90">{title}</span>
        {meta && <span className={warn ? "shrink-0 text-[0.74rem] text-amber-300" : "shrink-0 text-[0.74rem] text-mute"}>{meta}</span>}
      </Link>
    </li>
  );
}

function Today() {
  const user = useApp((s) => s.user);
  const { data: tasks } = useResource<any[]>(`/dashboard/tasks?today=${today()}`);
  const { data: reminders } = useResource<any[]>("/reminders");
  const h = new Date().getHours();
  const name = user?.displayName;
  const greet = h < 5 ? (name ? tx("Working late, {name}.", { name }) : tx("Working late."))
    : h < 12 ? (name ? tx("Good morning, {name}.", { name }) : tx("Good morning."))
    : h < 18 ? (name ? tx("Good afternoon, {name}.", { name }) : tx("Good afternoon."))
    : (name ? tx("Good evening, {name}.", { name }) : tx("Good evening."));
  const due = (tasks ?? []).filter((t) => t.due_date && String(t.due_date).slice(0, 10) <= today());
  const overdue = due.filter((t) => t.overdue).length;
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  const rem = (reminders ?? []).filter((r) => r.status !== "done" && r.status !== "dismissed" && new Date(r.due_at) <= endOfDay).length;
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-[0.78rem] text-mute">{new Date().toLocaleDateString(locale(), { weekday: "long", month: "long", day: "numeric" })}</div>
        <div className="mt-1 text-[1.6rem] font-light leading-tight text-white">{greet}</div>
      </div>
      <div className="flex gap-6 text-[0.82rem]">
        <span><b className="text-[1.25rem] font-light text-white">{due.length}</b> <span className="text-mute">{tn(due.length, "task due", "tasks due")}</span>{overdue > 0 && <span className="text-amber-300"> · {tx("{n} overdue", { n: overdue })}</span>}</span>
        <span><b className="text-[1.25rem] font-light text-white">{rem}</b> <span className="text-mute">{tn(rem, "reminder today", "reminders today")}</span></span>
      </div>
    </div>
  );
}

function Ask() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const go = () => { if (q.trim()) navigate(`/?q=${encodeURIComponent(q.trim())}`); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex gap-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Ask anything — Orbital will draw on what you know")} aria-label={tx("Ask Orbital")}
        className="min-w-0 flex-1 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[0.88rem] text-white placeholder:text-mute-soft focus:border-white/30 focus:outline-none" />
      <Button type="submit" size="sm" disabled={!q.trim()}>{tx("Ask")}</Button>
    </form>
  );
}

function Core() {
  return <NeuralCore framing="head" interactive={false} className="h-56 w-full overflow-hidden rounded-lg" label={tx("Neural Core")} />;
}

function QuickNote() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      const first = body.split("\n")[0].slice(0, 120);
      await api.post("/documents", { title: first, body });
      setText(""); invalidate("/documents"); toast(tx("Saved to your notes"));
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={tx("A thought, a link, an idea…")} aria-label={tx("Quick note")}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}
        className="w-full resize-none rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-[0.86rem] text-white placeholder:text-mute-soft focus:border-white/30 focus:outline-none" />
      <div className="flex items-center justify-between">
        <span className="text-[0.72rem] text-mute-soft">{tx("Ctrl/⌘ + Enter to save")}</span>
        <Button size="sm" onClick={save} loading={busy} disabled={!text.trim()}>{tx("Save note")}</Button>
      </div>
    </div>
  );
}

function Tasks() {
  const { data } = useResource<any[]>(`/dashboard/tasks?today=${today()}`);
  const done = async (id: string) => {
    try { await api.patch(`/tasks/${id}`, { done: true }); invalidate("/dashboard", "/projects"); } catch (e) { toastError(e); }
  };
  return (
    <List empty={tx("No open tasks. Add some in a project.")} items={data?.map((t) => (
      <li key={t.id} className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-white/[0.04]">
        <button onClick={() => done(t.id)} aria-label={tx("Mark done")} title={tx("Mark done")}
          className="grid h-4 w-4 shrink-0 place-items-center rounded border border-white/30 text-transparent hover:border-white hover:text-white"><Check size={11} /></button>
        <Link to={`/projects/${t.project_id}`} className="min-w-0 flex-1 truncate text-[0.84rem] text-white/90">{t.title}</Link>
        <span className="hidden shrink-0 truncate text-[0.72rem] text-mute-soft sm:inline">{t.project_name}</span>
        {t.due_date && <span className={t.overdue ? "shrink-0 text-[0.74rem] text-amber-300" : "shrink-0 text-[0.74rem] text-mute"}>{new Date(`${String(t.due_date).slice(0, 10)}T12:00:00`).toLocaleDateString(locale(), { month: "short", day: "numeric" })}</span>}
      </li>
    ))} />
  );
}

function Projects() {
  const { data } = useResource<any[]>(`/projects?today=${today()}`);
  const active = data?.filter((p) => p.status === "active").slice(0, 6);
  return (
    <List empty={tx("No active projects yet.")} items={active?.map((p) => {
      const pct = p.task_count ? Math.round((p.tasks_done / p.task_count) * 100) : 0;
      return (
        <li key={p.id}>
          <Link to={`/projects/${p.id}`} className="block rounded-md px-1.5 py-1.5 hover:bg-white/[0.04]">
            <div className="flex items-baseline gap-3 text-[0.84rem]">
              <span className="min-w-0 flex-1 truncate text-white/90">{p.name}</span>
              <span className="text-[0.74rem] text-mute">{p.task_count ? `${pct}%` : tx("no tasks")}</span>
              {p.tasks_overdue > 0 && <span className="text-[0.74rem] text-amber-300">{tx("{n} overdue", { n: p.tasks_overdue })}</span>}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
          </Link>
        </li>
      );
    })} />
  );
}

function Reminders() {
  const { data } = useResource<any[]>("/reminders");
  const upcoming = data?.filter((r) => r.status === "scheduled" || r.status === "fired").sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at)).slice(0, 6);
  return <List empty={tx("Nothing scheduled.")} items={upcoming?.map((r) => <Row key={r.id} to={r.link ?? "/reminders"} title={r.title} meta={formatWhen(r.due_at)} warn={r.status === "fired"} />)} />;
}

function Nudges() {
  const { data } = useResource<any[]>(`/nudges?today=${today()}`);
  return <List empty={tx("Nothing needs your attention.")} items={data?.slice(0, 6).map((n) => <Row key={n.key} to={n.link ?? "/reminders"} title={n.title} meta={n.detail} warn={n.kind === "overdue" || n.kind === "deadline"} />)} />;
}

function Notes() {
  const { data } = useResource<any[]>("/documents");
  return <List empty={tx("No notes yet.")} items={data?.slice(0, 6).map((d) => <Row key={d.id} to={`/knowledge/${d.id}`} title={d.title || tx("Untitled")} meta={timeAgo(d.updated_at)} />)} />;
}

function Papers() {
  const { data } = useResource<any[]>("/docs");
  return <List empty={tx("No papers yet.")} items={data?.slice(0, 6).map((d) => <Row key={d.id} to={`/papers/${d.id}`} title={d.title || tx("Untitled document")} meta={timeAgo(d.updated_at)} />)} />;
}

function Research() {
  const { data } = useResource<any[]>("/research");
  return <List empty={tx("No research yet.")} items={data?.slice(0, 6).map((r) => <Row key={r.id} to={`/research/${r.id}`} title={r.question} meta={r.status === "complete" ? tn(r.sources, "{n} source", "{n} sources") : label(r.status)} warn={r.status === "failed"} />)} />;
}

function Focus() {
  const { data } = useResource<any>("/focus");
  if (!data) return <Pulse />;
  const hours = Math.floor(data.week.seconds / 3600), mins = Math.round((data.week.seconds % 3600) / 60);
  return (
    <div className="space-y-3">
      <div className="text-[0.84rem]">
        <b className="text-[1.25rem] font-light text-white">{hours ? `${hours} h ${mins} min` : `${mins} min`}</b>
        <span className="text-mute"> {tx("focused this week")} · {tn(data.week.sessions, "{n} session", "{n} sessions")}</span>
      </div>
      <Link to="/focus"><Button size="sm">{data.active ? tx("Back to your session") : tx("Start a focus session")}</Button></Link>
    </div>
  );
}

function Activity() {
  return <ContributionGraph compact />;
}

function Growth() {
  const { data } = useResource<any>("/growth");
  if (!data) return <Pulse />;
  const v = data.stats.volume, q = data.stats.quality;
  const cells: [number, string][] = [
    [v.nodes, tx("Knowledge nodes")], [v.confirmedEdges, tx("Confirmed connections")], [v.memories, tx("Memories")],
    [v.research, tx("Research sessions")], [q.verifiedFindings, tx("Verified findings")], [q.resolvedGaps, tx("Resolved questions")],
  ];
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3">
      {cells.map(([n, l]) => <div key={l}><div className="text-[1.3rem] font-light text-white">{n.toLocaleString(locale())}</div><div className="text-[0.72rem] text-mute">{l}</div></div>)}
    </div>
  );
}

function Questions() {
  const { data } = useResource<any>("/growth/maintenance");
  return <List empty={tx("No open questions.")} items={data?.gaps?.slice(0, 6).map((g: any) => <Row key={g.id} to="/maintenance" title={g.question} meta={timeAgo(g.created_at)} />)} />;
}

function Opportunities() {
  const { data } = useResource<any[]>("/opportunities");
  const open = data?.filter((o) => o.status !== "dismissed").slice(0, 6);
  return <List empty={tx("No opportunities yet.")} items={open?.map((o) => <Row key={o.id} to="/opportunities" title={o.title} meta={label(o.status)} />)} />;
}

function Recent() {
  const { data } = useResource<TrailItem[]>("/recent");
  return data ? <TrailList items={data} empty={tx("Nothing opened yet.")} /> : <Pulse />;
}

function Favorites() {
  const { data } = useResource<TrailItem[]>("/bookmarks");
  return data ? <TrailList items={data} empty={tx("Star a page, note, paper, conversation or project to keep it here.")} /> : <Pulse />;
}

export function WidgetLink({ to }: { to: string }) {
  return <Link to={to} className="text-mute hover:text-white" aria-label={tx("Open")} title={tx("Open")}><ArrowRight size={14} /></Link>;
}
