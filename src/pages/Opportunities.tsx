import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Sparkles, Plus, Compass, FolderKanban, Trash2, ThumbsUp, ThumbsDown, ChevronDown, ExternalLink } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp, useCan } from "@/state/app";
import { usePanel, toast, toastError, useJobs } from "@/state/ui";
import { Badge, Button, Dialog, Empty, IconButton, Input, PageHeader, Pulse, Select, Textarea, cx } from "@/components/ui";
import { Section } from "@/components/RightPanel";
import { label, timeAgo } from "@/lib/format";
import { RemindMenu } from "@/components/RemindMenu";
import { ContributionGraph } from "@/components/ContributionGraph";
import { tx } from "@/i18n";

const STATUSES = ["identified", "investigating", "validated", "executing", "succeeded", "failed", "dismissed"];


export function OpportunitiesPage() {
  const { data, loading } = useResource<any[]>("/opportunities");
  const [params, setParams] = useSearchParams();
  const [discoverOpen, setDiscoverOpen] = useState(!!params.get("discover"));
  const [adding, setAdding] = useState(false);
  const running = useJobs((s) => s.discovering);
  const setRunning = useJobs((s) => s.setDiscovering);
  const ai = useApp((s) => s.ai);
  const can = useCan();
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => {
    setContent("Opportunity Engine", <EngineSide />);
    return () => setContent("", null);
  }, [setContent]);
  useEffect(() => { if (params.get("discover")) setDiscoverOpen(true); }, [params]);

  const active = data?.filter((o) => o.status !== "dismissed") ?? [];
  const dismissed = data?.filter((o) => o.status === "dismissed") ?? [];
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={tx("Opportunities")} subtitle={tx("Practical opportunities grounded in what you know — researched, evaluated and tracked to outcomes.")}
        actions={can.write && <>
          <Button icon={<Plus size={14} />} onClick={() => setAdding(true)}>{tx("Add manually")}</Button>
          <Button variant="primary" icon={running ? <Pulse /> : <Sparkles size={14} />} disabled={ai?.provider === "none" || running} title={ai?.provider === "none" ? tx("Requires an AI provider") : undefined} onClick={() => setDiscoverOpen(true)}>{tx("Discover")}</Button>
        </>} />
      <div className="px-8 pb-16">
        {loading && <div className="py-10 text-center"><Pulse /></div>}
        {data?.length === 0 && (
          <Empty title={tx("No opportunities yet")} action={ai?.provider !== "none" ? <Button variant="primary" onClick={() => setDiscoverOpen(true)}>{tx("Run discovery")}</Button> : undefined}>
            {tx("Orbital looks for patterns across your goals, skills, interests and research, then proposes a few specific, grounded opportunities. It needs at least three memories about you to start.")}
            {ai?.provider === "none" && tx(" Discovery requires an AI provider; you can still track opportunities manually.")}
          </Empty>
        )}
        <ul className="space-y-3">{active.map((o) => <OpportunityCard key={o.id} o={o} />)}</ul>
        {dismissed.length > 0 && (
          <details className="mt-8"><summary className="cursor-pointer text-[0.82rem] text-mute hover:text-white">{dismissed.length} {tx("dismissed")}</summary><ul className="mt-3 space-y-3">{dismissed.map((o) => <OpportunityCard key={o.id} o={o} />)}</ul></details>
        )}
      </div>
      <DiscoverDialog open={discoverOpen} onClose={() => { setDiscoverOpen(false); setParams({}); }} onStarted={() => setRunning(true)} />
      <AddDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function OpportunityCard({ o }: { o: any }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(o.outcome_notes);
  const navigate = useNavigate();
  const update = async (patch: any) => { try { await api.patch(`/opportunities/${o.id}`, patch); invalidate("/opportunities", "/growth"); } catch (e) { toastError(e); } };
  const validate = async () => {
    try { const r = await api.post(`/opportunities/${o.id}/validate`); invalidate("/opportunities", "/research"); toast(tx("Validation research started"), { action: { label: "Follow", to: `/research/${r.researchId}` } }); } catch (e) { toastError(e); }
  };
  const plan = async () => {
    if (!confirm(tx("Turn this opportunity into a project with milestones, so you can track progress?"))) return;
    try { const r = await api.post(`/opportunities/${o.id}/plan`); invalidate("/opportunities", "/projects", "/graph"); navigate(`/projects/${r.projectId}`); } catch (e) { toastError(e); }
  };
  const rate = async (rating: 1 | -1) => { await api.post("/feedback", { targetType: "opportunity", targetId: o.id, rating }).catch(toastError); invalidate("/opportunities"); };
  return (
    <li className={cx("glow-card rounded-xl border border-line transition-colors", open ? "bg-white/[0.02]" : "hover:border-line-strong")}>
      <button className="flex w-full items-start gap-4 px-5 py-4 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.98rem] text-white">{o.title}</span>
            {o.area && <Badge>{label(o.area)}</Badge>}
            {o.origin === "ai" && <Badge tone="ai">{tx("AI-identified")}</Badge>}
            {o.is_investment && <Badge tone="warn">{tx("research, not advice")}</Badge>}
          </div>
          <p className={cx("mt-1 text-[0.86rem] leading-relaxed text-mute-bright", !open && "line-clamp-2")}>{o.explanation.split("\n\nProblem:")[0]}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={["validated", "executing", "succeeded"].includes(o.status) ? "ok" : o.status === "failed" ? "warn" : "default"}>{o.status}</Badge>
          {o.difficulty !== "unknown" && <span className="text-[0.72rem] text-mute">{label(o.difficulty)} {tx("difficulty")}</span>}
        </div>
        <ChevronDown size={15} className={cx("mt-1 shrink-0 text-mute transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-x-10 gap-y-5 border-t border-line px-5 py-5 text-[0.86rem] leading-relaxed md:grid-cols-2">
              {o.explanation.includes("\n\nProblem:") && <Field title={tx("Problem")}>{o.explanation.split("\n\nProblem:")[1]}</Field>}
              <Field title={tx("Why Orbital identified it")}>{o.why_identified}</Field>
              {o.memories?.length > 0 && (
                <Field title={tx("Grounded in your memories")}>
                  <ul className="space-y-1">{o.memories.map((m: any) => <li key={m.id} className="text-white/80">• {m.content} <span className="text-[0.7rem] text-mute">{label(m.category)}</span></li>)}</ul>
                </Field>
              )}
              <Field title={tx("Market evidence")}>
                {o.market_evidence?.length ? (
                  <ul className="space-y-2">{o.market_evidence.map((e: any, i: number) => (
                    <li key={i}><a href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-white/85 hover:text-white">{e.title}<ExternalLink size={10} /></a><p className="text-[0.78rem] text-mute">{e.excerpt}</p></li>
                  ))}</ul>
                ) : <span className="text-mute">{tx("None gathered yet. Validate to research demand and competitors.")}</span>}
              </Field>
              {o.business_model && <Field title={tx("Potential business model")}>{o.business_model}</Field>}
              {o.resources && <Field title={tx("Required resources")}>{o.resources}</Field>}
              {o.risks && <Field title={tx("Risks")}>{o.risks}</Field>}
              {o.uncertainty && <Field title={tx("What's uncertain")}>{o.uncertainty}</Field>}
              <Field title={tx("Recommended next action")}><span className="text-white">{o.next_action || "—"}</span></Field>
              {o.is_investment && <p className="col-span-full rounded-lg border border-amber-300/20 px-3 py-2 text-[0.78rem] text-amber-100/80">{tx("This is research and education, not personalised financial advice. Do your own due diligence and consider consulting a licensed professional before investing.")}</p>}
            </div>
            {o.project_id && <div className="border-t border-line px-5 py-4"><ContributionGraph projectId={o.project_id} compact title={tx("Progress on this opportunity")} /></div>}
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
              {o.research_id ? (
                <Link to={`/research/${o.research_id}`}><Button size="sm" icon={<Compass size={13} />}>{tx("Validation research ·")} {o.research_status}</Button></Link>
              ) : <Button size="sm" icon={<Compass size={13} />} onClick={validate}>{tx("Validate demand & competitors")}</Button>}
              {o.project_id ? <Link to={`/projects/${o.project_id}`}><Button size="sm" icon={<FolderKanban size={13} />}>{tx("Track progress")}</Button></Link>
                : <Button size="sm" icon={<FolderKanban size={13} />} onClick={plan} title={tx("Turn this opportunity into a project with milestones")}>{tx("Track progress")}</Button>}
              <Select label={tx("Status")} value={o.status} onChange={(v) => update({ status: v })} className="h-7 w-36 text-[0.78rem]" options={STATUSES.map((s) => ({ value: s, label: s }))} />
              <span className="flex-1" />
              <IconButton label={tx("Useful suggestion")} active={o.rating === 1} onClick={() => rate(1)}><ThumbsUp size={13} /></IconButton>
              <IconButton label={tx("Not useful")} active={o.rating === -1} onClick={() => rate(-1)}><ThumbsDown size={13} /></IconButton>
              <RemindMenu itemType="opportunity" itemId={o.id} size={13} />
              <IconButton label={tx("Delete")} onClick={async () => { if (!confirm(tx("Delete this opportunity?"))) return; await api.del(`/opportunities/${o.id}`).catch(toastError); invalidate("/opportunities", "/graph"); }}><Trash2 size={13} /></IconButton>
            </div>
            <div className="border-t border-line px-5 py-3">
              <label className="label" htmlFor={`notes-${o.id}`}>{tx("Outcome tracking")}</label>
              <Textarea id={`notes-${o.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== o.outcome_notes && update({ outcomeNotes: notes })}
                placeholder={tx("What happened when you acted on this? Orbital uses outcomes and ratings to improve future suggestions.")} className="mt-1.5 text-[0.84rem]" />
              <p className="mt-1 text-[0.7rem] text-mute-soft">{tx("Identified")} {timeAgo(o.created_at)} {tx("· updated")} {timeAgo(o.updated_at)}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const Field = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><div className="label mb-1">{title}</div><div className="text-white/80">{children}</div></div>
);

function DiscoverDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post("/opportunities/discover", { focus: focus || undefined }); onStarted(); toast(tx("Opportunity discovery started — you'll be notified when it's done.")); onClose(); setFocus(""); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("Discover opportunities")}>
      <p className="text-[0.84rem] leading-relaxed text-mute">{tx("Orbital analyses your goals, skills, interests, knowledge clusters, research sources and your feedback on earlier suggestions. It proposes at most three opportunities, each grounded in specific memories.")}</p>
      <Input className="mt-4" placeholder={tx("Optional focus — e.g. software products for local businesses")} value={focus} onChange={(e) => setFocus(e.target.value)} aria-label={tx("Focus")} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button variant="primary" loading={busy} onClick={submit}>{tx("Discover")}</Button></div>
    </Dialog>
  );
}

function AddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ title: "", explanation: "", nextAction: "", isInvestment: false });
  const submit = async () => {
    try { await api.post("/opportunities", f); invalidate("/opportunities", "/graph"); onClose(); setF({ title: "", explanation: "", nextAction: "", isInvestment: false }); } catch (e) { toastError(e); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("Track an opportunity")}>
      <div className="space-y-3">
        <Input placeholder={tx("Title")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label={tx("Title")} />
        <Textarea rows={3} placeholder={tx("What is it and why might it work?")} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} aria-label={tx("Explanation")} />
        <Input placeholder={tx("Next action")} value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} aria-label={tx("Next action")} />
        <label className="flex items-center gap-2 text-[0.84rem] text-mute"><input type="checkbox" className="accent-white" checked={f.isInvestment} onChange={(e) => setF({ ...f, isInvestment: e.target.checked })} /> {tx("Investment-related")}</label>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button variant="primary" disabled={!f.title.trim()} onClick={submit}>{tx("Add")}</Button></div>
      </div>
    </Dialog>
  );
}

function EngineSide() {
  return (
    <>
      <Section title={tx("How it works")}>
        <ol className="list-decimal space-y-1.5 pl-4 text-[0.82rem] leading-relaxed text-mute-bright marker:text-mute">
          <li>{tx("Find patterns in your memories and knowledge clusters")}</li>
          <li>{tx("Identify problems worth solving")}</li>
          <li>{tx("Validate demand and competitors with cited research")}</li>
          <li>{tx("Evaluate model, difficulty, resources and risks")}</li>
          <li>{tx("Track progress: turn it into a project with milestones, and watch the work add up day by day")}</li>
          <li>{tx("Track outcomes — feedback shapes future suggestions")}</li>
        </ol>
      </Section>
      <Section title={tx("Principles")}>
        <p className="text-[0.82rem] leading-relaxed text-mute">{tx("No invented revenue figures or guarantees. Market evidence links to real retrieved sources. Nothing is acted on without you.")}</p>
      </Section>
    </>
  );
}
