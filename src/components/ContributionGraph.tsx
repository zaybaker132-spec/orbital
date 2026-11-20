import { useEffect, useMemo, useRef, useState } from "react";
import { useResource } from "@/lib/resource";
import { Pulse, cx } from "./ui";
import { locale, tn, tx } from "@/i18n";

/**
 * A year of work, one square per day, like a GitHub contribution graph. Each day takes the colour
 * of the kind of work that led it (Orbital's own palette) and grows brighter with how much was done.
 */
type Kind = "build" | "knowledge" | "research" | "thinking" | "opportunity";
type Day = { date: string; total: number } & Record<Kind, number>;
interface Calendar { days: Day[]; total: number; activeDays: number; currentStreak: number; longestStreak: number; busiest: { date: string; total: number } | null; totals: Record<Kind, number> }

export const KIND_META: { kind: Kind; label: string; hint: string; color: string }[] = [
  { kind: "build", label: "Build", hint: "tasks, milestones, focus sessions", color: "#2cff7a" },
  { kind: "knowledge", label: "Knowledge", hint: "notes, files, clips, memories", color: "#1fd0ff" },
  { kind: "research", label: "Research", hint: "research reports and questions", color: "#b02bff" },
  { kind: "thinking", label: "Conversations", hint: "what you asked Orbital", color: "#ff2bd6" },
  { kind: "opportunity", label: "Opportunities", hint: "found, validated, acted on", color: "#ffd23a" },
];
const COLOR = Object.fromEntries(KIND_META.map((k) => [k.kind, k.color])) as Record<Kind, string>;
const LEVEL_ALPHA = [0, 0.3, 0.52, 0.76, 1];
const EMPTY = "rgb(var(--c-fg) / 0.05)";
const GAP = 3, LEFT = 30, TOP = 18;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hexA = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale(), { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ContributionGraph({ projectId, title, compact = false }: { projectId?: string; title?: string; compact?: boolean }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, loading } = useResource<Calendar>(`/activity/calendar?tz=${encodeURIComponent(tz)}${projectId ? `&project=${projectId}` : ""}`);
  const [only, setOnly] = useState<Kind | null>(null);
  const [hover, setHover] = useState<Day | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weeks run Sunday to Saturday, like GitHub; the first column is padded so dates line up.
  const weeks = useMemo(() => {
    if (!data) return [];
    const pad = dow(data.days[0].date);
    const cells: (Day | null)[] = [...Array(pad).fill(null), ...data.days];
    const out: (Day | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [data]);

  // Intensity levels from this calendar's own spread (quartiles of active days), so a quiet year still reads.
  const level = useMemo(() => {
    const vals = (data?.days ?? []).map((d) => (only ? d[only] : d.total)).filter(Boolean).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 1;
    const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
    return (n: number) => (n <= 0 ? 0 : n <= a ? 1 : n <= b ? 2 : n <= c ? 3 : 4);
  }, [data, only]);

  // Squares grow to fill the width (like GitHub's), down to a minimum; below that the grid scrolls to today.
  const CELL = weeks.length && boxWidth ? Math.max(8, Math.min(16, Math.floor((boxWidth - LEFT) / weeks.length) - GAP)) : 11;
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, [weeks.length, CELL]);

  if (loading && !data) return <div className="py-6"><Pulse /></div>;
  if (!data) return null;

  const fill = (d: Day | null) => {
    if (!d) return "transparent";
    const n = only ? d[only] : d.total;
    if (!n) return EMPTY;
    const lead = only ?? KIND_META.reduce((best, k) => (d[k.kind] > d[best] ? k.kind : best), "build" as Kind);
    return hexA(COLOR[lead], LEVEL_ALPHA[level(n)]);
  };
  const width = LEFT + weeks.length * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const monthLabels: { x: number; label: string }[] = [];
  weeks.forEach((w, i) => {
    const first = w.find(Boolean);
    if (!first) return;
    const m = Number(first.date.slice(5, 7)) - 1;
    const prev = i ? weeks[i - 1].find(Boolean) : null;
    if (!prev || Number(prev.date.slice(5, 7)) - 1 !== m) {
      const x = LEFT + i * (CELL + GAP);
      if (!monthLabels.length || x - monthLabels[monthLabels.length - 1].x > 24) monthLabels.push({ x, label: MONTHS[m] });
    }
  });
  const shown = only ? data.totals[only] : data.total;
  const describe = (d: Day) => {
    const parts = KIND_META.filter((k) => d[k.kind]).map((k) => `${d[k.kind]} ${k.label.toLowerCase()}`);
    return `${d.total ? tn(d.total, "{n} contribution", "{n} contributions") : tx("No contributions")} · ${longDate(d.date)}${parts.length ? ` · ${parts.join(", ")}` : ""}`;
  };

  return (
    <section aria-label={title ?? tx("Activity")}>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h2 className={cx(compact ? "text-[0.92rem]" : "text-[1.05rem]", "font-normal text-white")}>
          {only ? `${shown} ${tx(KIND_META.find((k) => k.kind === only)!.label).toLowerCase()}` : tn(shown, "{n} contribution", "{n} contributions")} {tx("in the last year")}
        </h2>
        <div className="flex flex-wrap gap-x-4 text-[0.74rem] text-mute">
          <span><b className="font-normal text-white/85">{data.currentStreak}</b> {tx("day streak")}</span>
          <span>{tx("Longest")} <b className="font-normal text-white/85">{data.longestStreak}</b> {tx("days")}</span>
          <span><b className="font-normal text-white/85">{data.activeDays}</b> {tx("active days")}</span>
          {data.busiest && !compact && <span>{tx("Busiest")} {longDate(data.busiest.date).replace(/^\w+, /, "")} ({data.busiest.total})</span>}
        </div>
      </div>

      <div className="mt-3 glow-card rounded-xl border border-line px-4 pb-3 pt-4">
        <div ref={scroller} className="overflow-x-auto pb-1">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tx("{total} contributions in the last year, {currentStreak} day current streak", { total: data.total, currentStreak: data.currentStreak })} onMouseLeave={() => setHover(null)} className="block">
            {monthLabels.map((m) => <text key={m.x} x={m.x} y={10} className="fill-[#8a8a93] text-[10px]">{tx(m.label)}</text>)}
            {[["Mon", 1], ["Wed", 3], ["Fri", 5]].map(([l, r]) => <text key={l} x={0} y={TOP + (r as number) * (CELL + GAP) + CELL - 2} className="fill-[#8a8a93] text-[10px]">{l}</text>)}
            {weeks.map((w, i) => w.map((d, r) => d && (
              <rect key={d.date} x={LEFT + i * (CELL + GAP)} y={TOP + r * (CELL + GAP)} width={CELL} height={CELL} rx={Math.max(2, CELL / 4.5)}
                style={{ fill: fill(d), stroke: d.date === data.days[data.days.length - 1].date ? "rgb(var(--c-fg) / 0.45)" : "none" }} strokeWidth={1}
                onMouseEnter={() => setHover(d)}>
                <title>{describe(d)}</title>
              </rect>
            )))}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.72rem] text-mute">
          <span className="min-h-[1.2em] min-w-0 flex-1 truncate" aria-live="polite">{hover ? describe(hover) : tx("Hover a day for details · click a colour to show only that kind of work")}</span>
          <span className="flex items-center gap-1">{tx("Less")}
            {LEVEL_ALPHA.map((a, i) => <i key={i} className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: i ? (only ? hexA(COLOR[only], a) : `rgb(var(--c-fg) / ${a * 0.85})`) : EMPTY }} />)}
            {tx("More")}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label={tx("Colour key")}>
          {KIND_META.map((k) => (
            <button key={k.kind} onClick={() => setOnly(only === k.kind ? null : k.kind)} aria-pressed={only === k.kind} title={k.hint}
              className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[0.72rem] transition-colors",
                only === k.kind ? "border-white/60 text-white" : only ? "border-line text-mute-soft hover:text-white" : "border-line text-mute-bright hover:text-white")}>
              <i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: k.color }} />{tx(k.label)}<span className="opacity-60">{data.totals[k.kind]}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
