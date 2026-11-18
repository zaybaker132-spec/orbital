import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { NeuralCore } from "@/neural/NeuralCore";
import { useResource, invalidate } from "@/lib/resource";
import { api } from "@/lib/api";
import { useCore } from "@/state/core";
import { usePanel, toast, toastError } from "@/state/ui";
import { Badge, Button, Empty, Pulse, Stat, cx } from "@/components/ui";
import { label, timeAgo } from "@/lib/format";
import { Section } from "@/components/RightPanel";
import { ContributionGraph } from "@/components/ContributionGraph";

const STATE_COPY: Record<string, string> = {
  idle: "Resting. Particle density reflects what you've accumulated.",
  thinking: "Composing an answer from your context.",
  researching: "Research in progress — activity moves between regions as sub-questions are investigated.",
  learning: "New knowledge is forming. Regions grow denser as it accumulates.",
  connecting: "Discovering relationships between ideas.",
  opportunity: "An opportunity was identified in your knowledge.",
};

export function CorePage() {
  const { data, loading } = useResource<any>("/growth");
  const state = useCore((s) => { void s.active; return s.current(); });
  const detail = useCore((s) => s.detail);
  const setContent = usePanel((s) => s.setContent);
  const loc = useLocation();

  useEffect(() => {
    setContent("Activity", <RecentActivity />);
    return () => setContent("", null);
  }, [setContent]);

  useEffect(() => {
    if (loc.hash) setTimeout(() => document.querySelector(loc.hash)?.scrollIntoView({ behavior: "smooth" }), 300);
  }, [loc.hash, data]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative h-[72vh] min-h-[460px]">
        <NeuralCore framing="full" className="absolute inset-0" />
        <div className="pointer-events-none absolute left-8 top-6">
          <div className="label">Neural Core</div>
          <div className="mt-1.5 text-[1.05rem] font-light text-white">{state === "idle" ? "Idle" : state[0].toUpperCase() + state.slice(1)}</div>
          <p className="mt-1 max-w-xs text-[0.8rem] leading-relaxed text-mute">{STATE_COPY[state]}{detail && state !== "idle" ? ` — ${detail.slice(0, 80)}` : ""}</p>
        </div>
        <p className="pointer-events-none absolute bottom-5 left-8 text-[0.72rem] text-mute-soft">Move the cursor through the particles. Click to send a ripple.</p>
        <button onClick={() => useCore.getState().replayIntro()} className="absolute bottom-4 right-8 rounded-full border border-line px-3 py-1 text-[0.74rem] text-mute transition-colors hover:border-line-strong hover:text-white">Replay formation</button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#040404] to-transparent" />
      </div>

      <div className="mx-auto max-w-[1100px] px-8 pb-16">
        {loading || !data ? <div className="py-10 text-center"><Pulse /></div> : <Dashboard data={data} />}
        <Maintenance />
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: any }) {
  const { volume, quality, clusters } = data.stats;
  const isEmpty = volume.nodes === 0 && volume.memories === 0;
  if (isEmpty) {
    return (
      <Empty title="Your knowledge universe is empty" action={<div className="flex gap-2"><Link to="/"><Button variant="primary">Start a conversation</Button></Link><Link to="/knowledge"><Button>Add a note</Button></Link></div>}>
        Every conversation, note, document and research session you add becomes part of it. The Neural Core grows denser as it does.
      </Empty>
    );
  }
  return (
    <>
      <h2 className="label mt-4">Neural activity</h2>
      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-6 border-b border-line pb-8 sm:grid-cols-4">
        <Stat label="Knowledge nodes" value={volume.nodes} />
        <Stat label="Confirmed connections" value={volume.confirmedEdges} hint={`${volume.suggestedEdges} suggested, awaiting review`} />
        <Stat label="Memories" value={volume.memories} hint={`${volume.pendingMemories} pending review`} />
        <Stat label="Research sessions" value={volume.research} />
        <Stat label="New concepts · 30 days" value={volume.newConcepts30d} />
        <Stat label="Knowledge clusters" value={volume.clusters} />
        <Stat label="Unresolved questions" value={quality.openGaps} />
        <Stat label="Suggested connections" value={volume.suggestedEdges} />
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h2 className="label">Meaningful growth</h2>
          <p className="mt-1.5 text-[0.8rem] leading-relaxed text-mute">More stored information isn't more intelligence. These track knowledge that's verified, confirmed or acted on.</p>
          <dl className="mt-4 divide-y divide-line">
            {[
              ["Verified research findings", quality.verifiedFindings, "Findings directly supported by retrieved sources"],
              ["User-confirmed insights", quality.userConfirmedInsights, "AI-suggested connections you confirmed"],
              ["Memory retrievals", quality.memoryRetrievals, "Times a memory informed an answer"],
              ["Helpful retrievals", quality.helpfulRetrievals, "Answers that used memories and you rated helpful"],
              ["Corrected memories", quality.correctedMemories, "Memories you corrected — Orbital now uses your version"],
              ["Resolved knowledge gaps", quality.resolvedGaps, "Open questions you've closed"],
              ["Opportunities acted on", quality.opportunitiesActedOn, "Investigating, validated, executing or succeeded"],
            ].map(([k, v, hint]) => (
              <div key={k as string} className="flex items-baseline justify-between py-2.5" title={hint as string}>
                <dt className="text-[0.86rem] text-mute-bright">{k}</dt>
                <dd className="tabular-nums text-[0.95rem] text-white">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="label">Growing subjects · 30 days</h2>
          {data.subjects.length === 0 ? <p className="mt-3 text-[0.84rem] text-mute">Nothing new this month.</p> : (
            <ul className="mt-4 space-y-2.5">
              {data.subjects.map((s: any) => {
                const max = Math.max(...data.subjects.map((x: any) => x.recent));
                return (
                  <li key={s.subject} className="grid grid-cols-[120px_1fr_40px] items-center gap-3 text-[0.84rem]">
                    <span className="truncate text-mute-bright">{label(s.subject)}</span>
                    <span className="h-1 rounded-full bg-white/[0.06]"><span className="block h-1 rounded-full bg-white/70" style={{ width: `${(s.recent / max) * 100}%` }} /></span>
                    <span className="text-right tabular-nums text-mute">+{s.recent}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <h2 className="label mt-8">Largest clusters</h2>
          {clusters.length === 0 ? <p className="mt-3 text-[0.84rem] text-mute">Clusters form as ideas become connected.</p> : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {clusters.map((c: any) => <li key={c.label}><Badge>{c.label.slice(0, 40)} <span className="text-mute">{c.size}</span></Badge></li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-10"><ContributionGraph title="Your activity" /></div>
      <Timeline weekly={data.timeline.weekly} />
    </>
  );
}

const SERIES = [
  { key: "memory", label: "Memory", color: "#c084fc" },
  { key: "node", label: "Knowledge", color: "#60a5fa" },
  { key: "document", label: "Documents", color: "#34d399" },
  { key: "research", label: "Research", color: "#fbbf24" },
  { key: "edge", label: "Connections", color: "#f472b6" },
  { key: "opportunity", label: "Opportunities", color: "#fb923c" },
];

function Timeline({ weekly }: { weekly: { week: string; type: string; n: number }[] }) {
  const weeks = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    for (let i = 11; i >= 0; i--) {
      const w = new Date(d);
      w.setDate(d.getDate() - i * 7);
      out.push(w.toISOString().slice(0, 10));
    }
    return out;
  }, []);
  const by = (w: string, t: string) => weekly.filter((x) => x.week === w && x.type === t).reduce((a, b) => a + b.n, 0);
  const totals = weeks.map((w) => SERIES.reduce((a, s) => a + by(w, s.key), 0));
  const max = Math.max(1, ...totals);
  return (
    <section className="mt-10">
      <h2 className="label">How your knowledge evolved · 12 weeks</h2>
      <div className="mt-4 flex h-36 items-end gap-2" role="img" aria-label={`Weekly activity over 12 weeks; peak week had ${max} events`}>
        {weeks.map((w, i) => (
          <div key={w} className="flex h-full flex-1 flex-col justify-end" title={`Week of ${w}: ${totals[i]} events`}>
            {SERIES.map((s) => {
              const n = by(w, s.key);
              return n ? <div key={s.key} style={{ height: `${(n / max) * 100}%`, background: s.color }} className="w-full opacity-80 first:rounded-t-sm" /> : null;
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[0.68rem] text-mute-soft"><span>{weeks[0]}</span><span>this week</span></div>
      <div className="mt-3 flex flex-wrap gap-4">
        {SERIES.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[0.74rem] text-mute"><span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </section>
  );
}

function Maintenance() {
  const { data } = useResource<any>("/growth/maintenance");
  const navigate = useNavigate();
  if (!data) return null;
  const resolve = async (id: string, status: "resolved" | "dismissed") => {
    try { await api.patch(`/gaps/${id}`, { status }); invalidate("/growth"); } catch (e) { toastError(e); }
  };
  const research = async (id: string) => {
    try { const r = await api.post(`/gaps/${id}/research`); toast("Research started", { action: { label: "Open", to: `/research/${r.id}` } }); invalidate("/research"); } catch (e) { toastError(e); }
  };
  const edge = async (id: string, status: "confirmed" | "rejected") => {
    try { await api.patch(`/edges/${id}`, { status }); invalidate("/growth", "/graph"); } catch (e) { toastError(e); }
  };
  return (
    <>
      <section id="questions" className="mt-12 scroll-mt-6">
        <h2 className="label">Unresolved questions</h2>
        {data.gaps.length === 0 ? <p className="mt-3 text-[0.84rem] text-mute">No open questions. Deep Thinking, Learning and research sessions surface the questions worth answering.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {data.gaps.map((g: any) => (
              <li key={g.id} className="flex items-center gap-4 py-2.5">
                <span className="min-w-0 flex-1 text-[0.88rem] text-white/90">{g.question}</span>
                <span className="shrink-0 text-[0.72rem] text-mute">{g.origin} · {timeAgo(g.created_at)}</span>
                <Button size="sm" variant="ghost" onClick={() => research(g.id)}>Research</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve(g.id, "resolved")}>Resolved</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve(g.id, "dismissed")}>Dismiss</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <MaintenanceSummary />
      {data.contradictions.length > 0 && (
        <section className="mt-8">
          <Group title="Possible contradictions in your knowledge graph">
            {data.contradictions.map((c: any) => (
              <Row key={c.id} actions={<>
                <Button size="sm" variant="ghost" onClick={async () => { try { const r = await api.post(`/edges/${c.id}/investigate`); invalidate("/research"); navigate(`/research/${r.id}`); } catch (e) { toastError(e); } }}>Investigate in the lab</Button>
                {c.status === "suggested" ? <><Button size="sm" variant="ghost" onClick={() => edge(c.id, "confirmed")}>Confirm conflict</Button><Button size="sm" variant="ghost" onClick={() => edge(c.id, "rejected")}>Not a conflict</Button></> : <Badge tone="warn">confirmed</Badge>}
              </>}>
                <Link to={`/connections?node=${c.a_id}`} className="hover:underline">{c.a_title}</Link> <span className="text-mute">contradicts</span> <Link to={`/connections?node=${c.b_id}`} className="hover:underline">{c.b_title}</Link>
                {c.rationale && <span className="mt-0.5 block text-[0.76rem] text-mute">{c.rationale}</span>}
              </Row>
            ))}
          </Group>
        </section>
      )}
    </>
  );
}

/** Knowledge maintenance lives on its own page; this is the summary. */
function MaintenanceSummary() {
  const { data } = useResource<any>("/maintenance");
  if (!data) return null;
  const h = data.health;
  const top = data.suggestions.filter((s: any) => s.status === "open").slice(0, 3);
  return (
    <section id="maintenance" className="mt-12 scroll-mt-6">
      <div className="flex items-baseline gap-3">
        <h2 className="label">Knowledge maintenance</h2>
        <Link to="/maintenance" className="ml-auto text-[0.78rem] text-mute hover:text-white">Knowledge health {h.score} →</Link>
      </div>
      <p className="mt-1.5 text-[0.8rem] text-mute">Orbital checks daily for duplicate notes, conflicting memories, outdated information and disconnected ideas. Nothing changes without your approval, and every change can be undone.</p>
      {top.length === 0 ? <p className="mt-4 text-[0.84rem] text-mute">{h.lastScan ? "Everything looks consistent." : "The first check runs shortly."}</p> : (
        <ul className="mt-3 divide-y divide-line">{top.map((s: any) => (
          <li key={s.id}><Link to="/maintenance" className="flex items-baseline gap-3 py-2.5 hover:text-white"><span className="min-w-0 flex-1 truncate text-[0.86rem] text-white/90">{s.title}</span><span className="shrink-0 text-[0.74rem] text-mute">{s.reason.slice(0, 60)}</span></Link></li>
        ))}</ul>
      )}
      {h.open > top.length && <Link to="/maintenance" className="mt-2 inline-block text-[0.78rem] text-mute hover:text-white">{h.open - top.length} more →</Link>}
    </section>
  );
}

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mt-5"><h3 className="text-[0.84rem] text-white">{title}</h3><ul className="mt-2 divide-y divide-line">{children}</ul></div>
);
const Row = ({ children, actions }: { children: React.ReactNode; actions: React.ReactNode }) => (
  <li className="flex items-start gap-4 py-2.5"><div className="min-w-0 flex-1 text-[0.86rem] leading-relaxed text-white/90">{children}</div><div className="flex shrink-0 items-center gap-1">{actions}</div></li>
);

function RecentActivity() {
  const { data } = useResource<any>("/growth");
  const items = data?.timeline.recent ?? [];
  const to = (e: any) => e.ref_type === "research" ? `/research/${e.ref_id}` : e.ref_type === "document" ? `/knowledge/${e.ref_id}` : e.ref_type === "project" ? `/projects/${e.ref_id}` : e.ref_type === "memory" ? "/knowledge?tab=memory" : e.ref_type === "opportunity" ? "/opportunities" : e.ref_type === "node" ? `/connections?node=${e.ref_id}` : null;
  return (
    <Section title="Recent changes">
      {items.length === 0 ? <p className="text-[0.82rem] text-mute">No activity yet.</p> : (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {items.map((e: any) => {
            const href = to(e);
            return (
              <li key={e.id} className="relative">
                <span className={cx("absolute -left-[19.5px] top-1.5 h-1.5 w-1.5 rounded-full", e.type.startsWith("research") ? "bg-amber-300" : e.type.startsWith("memory") ? "bg-violet-300" : e.type.startsWith("edge") ? "bg-pink-300" : e.type.startsWith("opportunity") ? "bg-orange-300" : "bg-sky-300")} />
                <div className="text-[0.72rem] text-mute">{label(e.type.replace(".", " "))} · {timeAgo(e.created_at)}</div>
                {href ? <Link to={href} className="text-[0.83rem] leading-snug text-white/85 hover:text-white">{e.title}</Link> : <div className="text-[0.83rem] leading-snug text-white/85">{e.title}</div>}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
