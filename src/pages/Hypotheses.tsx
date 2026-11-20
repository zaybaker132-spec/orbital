import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Brain, Compass, ExternalLink, FlaskConical, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp, useCan } from "@/state/app";
import { toast, toastError, usePanel } from "@/state/ui";
import { Badge, Button, Empty, IconButton, Pulse, Select, Textarea, cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { GRADE_STYLE } from "./research/SourceIntel";
import { NotFoundPage } from "./NotFound";
import { tn, tx } from "@/i18n";

/** Verdict colours, shared by the list, the detail page and the history. */
export const VERDICT: Record<string, { label: string; color: string; hint: string }> = {
  untested: { label: "Untested", color: "#8a8a93", hint: "Not tested yet" },
  testing: { label: "Testing…", color: "#1fd0ff", hint: "Gathering evidence for and against" },
  supported: { label: "Supported", color: "#2cff7a", hint: "Strong evidence for, little against" },
  contested: { label: "Contested", color: "#ffd23a", hint: "Substantial evidence both ways" },
  refuted: { label: "Refuted", color: "#ff5a1f", hint: "Strong evidence against" },
  insufficient: { label: "Insufficient evidence", color: "#b02bff", hint: "Not enough evidence either way" },
};

function VerdictBadge({ status }: { status: string }) {
  const v = VERDICT[status] ?? VERDICT.untested;
  return <span className="inline-flex items-center gap-1.5 text-[0.74rem]" style={{ color: v.color }} title={v.hint}><i className={cx("h-1.5 w-1.5 rounded-full", status === "testing" && "animate-pulse")} style={{ background: v.color }} />{tx(v.label)}</span>;
}

export function HypothesesPage() {
  const { id } = useParams();
  const { data: list } = useResource<any[]>("/hypotheses");
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => () => setContent("", null), [setContent]);
  return (
    <div className="flex h-full">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div className="px-5 pb-3 pt-6">
          <h1 className="text-[1.05rem] font-normal">{tx("Research")}</h1>
          <p className="mt-0.5 text-[0.78rem] text-mute">{tx("Test what you believe against the evidence.")}</p>
          <div className="mt-3 flex gap-1 text-[0.78rem]">
            <Link to="/research" className="rounded-full px-3 py-1 text-mute hover:bg-white/[0.06] hover:text-white">{tx("Reports")}</Link>
            <span className="rounded-full bg-white px-3 py-1 text-black">{tx("Hypotheses")}</span>
          </div>
        </div>
        <div className="px-3"><Link to="/hypotheses"><Button variant="secondary" className="w-full" icon={<Plus size={14} />}>{tx("New hypothesis")}</Button></Link></div>
        <ul className="mt-3 min-h-0 flex-1 space-y-px overflow-y-auto px-3 pb-4">
          {list?.length === 0 && <li className="px-2 py-2 text-[0.8rem] text-mute">{tx("No hypotheses yet.")}</li>}
          {list?.map((h) => (
            <li key={h.id}>
              <Link to={`/hypotheses/${h.id}`} className={cx("block rounded-lg px-3 py-2 transition-colors", h.id === id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}>
                <div className="line-clamp-2 text-[0.84rem] leading-snug text-white/90">{h.statement}</div>
                <div className="mt-1 flex items-center gap-2 text-[0.7rem] text-mute">
                  <VerdictBadge status={h.status} />{h.confidence != null && h.status !== "testing" && <span>{Math.round(h.confidence * 100)}%</span>}
                  <span className="ml-auto">{tn(h.tests, "{n} test", "{n} tests")}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">{id ? <HypothesisDetail id={id} /> : <NewHypothesis />}</div>
    </div>
  );
}

function NewHypothesis() {
  const [params] = useSearchParams();
  const [statement, setStatement] = useState(params.get("q") ?? "");
  const [rationale, setRationale] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: projects } = useResource<any[]>("/projects");
  const ai = useApp((s) => s.ai);
  const navigate = useNavigate();
  const create = async (test: boolean) => {
    setBusy(true);
    try {
      const h = await api.post("/hypotheses", { statement, rationale, projectId: projectId || null });
      if (test) await api.post(`/hypotheses/${h.id}/test`);
      invalidate("/hypotheses", "/research");
      navigate(`/hypotheses/${h.id}`);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-[680px] px-8 pt-16">
      <FlaskConical size={18} className="text-mute" />
      <h2 className="mt-3 text-[1.35rem] font-light tracking-[-0.015em]">{tx("What do you believe might be true?")}</h2>
      <p className="mt-2 text-[0.88rem] leading-relaxed text-mute">
        {tx("Orbital searches for evidence that supports it")} <em>{tx("and")}</em> {tx("evidence against it with equal effort, weighs in what you already know, gives a verdict with a confidence, and suggests the next tests that would change its mind.")}
      </p>
      <Textarea autoFocus rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} className="mt-6 text-[0.95rem]" aria-label={tx("Hypothesis")}
        placeholder={tx("e.g. Independent salons will pay for AI scheduling if it cuts no-shows by a fifth.")} />
      <Textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} className="mt-2 text-[0.88rem]" aria-label={tx("Why you think so")}
        placeholder={tx("Why you think so (optional): your reasons are kept with the hypothesis.")} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select label={tx("Project")} value={projectId} onChange={setProjectId} className="w-56" options={[{ value: "", label: "No project" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Button className="ml-auto" disabled={statement.trim().length < 8} loading={busy} onClick={() => create(false)}>{tx("Save")}</Button>
        <Button variant="primary" disabled={statement.trim().length < 8} loading={busy} onClick={() => create(true)}>{tx("Save and test")}</Button>
      </div>
      {ai?.provider === "none" && <p className="mt-6 text-[0.8rem] text-amber-200/80">{tx("No AI provider is configured: tests gather sources on both sides, but a verdict needs an AI provider.")}</p>}
    </div>
  );
}

function HypothesisDetail({ id }: { id: string }) {
  const { data: h, error } = useResource<any>(`/hypotheses/${id}`);
  const navigate = useNavigate();
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ statement: "", rationale: "" });
  const [busy, setBusy] = useState(false);
  // While a test runs, check back every few seconds.
  useEffect(() => { if (h?.status !== "testing") return; const t = setInterval(() => invalidate(`/hypotheses/${id}`, "/hypotheses"), 4000); return () => clearInterval(t); }, [h?.status, id]);
  if (error && (error as any).status === 404) return <NotFoundPage what="hypothesis" back={{ to: "/hypotheses", label: "All hypotheses" }} />;
  if (!h) return <div className="p-10 text-center"><Pulse /></div>;
  const v = h.verdict;
  const reload = () => invalidate(`/hypotheses/${id}`, "/hypotheses", "/research");
  const test = async () => { setBusy(true); try { await api.post(`/hypotheses/${id}/test`); reload(); toast(tx("Testing: gathering evidence for and against")); } catch (e) { toastError(e); } finally { setBusy(false); } };
  const next = async (i: number) => { try { const r = await api.post(`/hypotheses/${id}/next-test`, { index: i }); reload(); navigate(`/research/${r.researchId}`); } catch (e) { toastError(e); } };
  const src = (n: number) => h.sources.find((s: any) => s.ref_number === n);
  const cite = (refs: number[]) => refs.map((n) => { const s = src(n); return <a key={n} href={s?.url} target="_blank" rel="noreferrer noopener" title={s?.title} className="ml-0.5 font-mono text-[0.7rem] text-sky-200/80 hover:text-sky-100">[{n}]</a>; });
  const color = (VERDICT[h.status] ?? VERDICT.untested).color;
  const evidence = (title: string, items: any[], tone: string) => (
    <section>
      <h3 className="label mb-2" style={{ color: tone }}>{title} · {items.length}</h3>
      {items.length === 0 ? <p className="text-[0.82rem] text-mute">{tx("None found in the sources retrieved.")}</p> : (
        <ul className="space-y-2">{items.map((e: any, i: number) => (
          <li key={i} className="rounded-lg border border-line px-3 py-2 text-[0.86rem] leading-relaxed text-white/85">
            <span className={cx("mr-2 rounded px-1.5 py-px text-[0.64rem] uppercase tracking-wider", e.strength === "strong" ? "bg-white/15 text-white" : "bg-white/[0.05] text-mute")}>{e.strength}</span>{e.point}{cite(e.source_refs)}
          </li>
        ))}</ul>
      )}
    </section>
  );

  return (
    <article className="mx-auto max-w-[860px] px-8 pb-20 pt-8">
      <div className="flex items-start gap-3">
        <FlaskConical size={16} className="mt-1.5 shrink-0 text-mute" />
        {editing ? (
          <div className="flex-1 space-y-2">
            <Textarea rows={2} value={draft.statement} onChange={(e) => setDraft({ ...draft, statement: e.target.value })} aria-label={tx("Hypothesis")} />
            <Textarea rows={2} value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} aria-label={tx("Rationale")} placeholder={tx("Why you think so")} />
            <div className="flex gap-2"><Button size="sm" variant="primary" onClick={async () => { await api.patch(`/hypotheses/${id}`, draft).catch(toastError); setEditing(false); reload(); }}>{tx("Save")}</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{tx("Cancel")}</Button></div>
          </div>
        ) : (
          <div className="flex-1">
            <h1 className="text-[1.3rem] font-light leading-snug tracking-[-0.015em]">{h.statement}</h1>
            {h.rationale && <p className="mt-1.5 text-[0.86rem] text-mute"><span className="text-white/60">{tx("Why you think so ·")} </span>{h.rationale}</p>}
          </div>
        )}
        {can.write && !editing && (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setDraft({ statement: h.statement, rationale: h.rationale }); setEditing(true); }}>{tx("Edit")}</Button>
            <IconButton label={tx("Delete hypothesis")} onClick={async () => { if (!confirm(tx("Delete this hypothesis? Its research reports are kept."))) return; await api.del(`/hypotheses/${id}`).catch(toastError); invalidate("/hypotheses"); navigate("/hypotheses"); }}><Trash2 size={14} /></IconButton>
          </div>
        )}
      </div>

      <section className="mt-6 rounded-2xl border px-6 py-5" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <div className="label">{tx("Current verdict")}</div>
            <div className="mt-1 text-[1.5rem] font-light" style={{ color }}>{tx((VERDICT[h.status] ?? VERDICT.untested).label)}</div>
          </div>
          {h.confidence != null && h.status !== "testing" && (
            <div className="min-w-[160px]">
              <div className="label">{tx("Confidence")}</div>
              <div className="mt-2 h-1.5 w-40 rounded-full bg-white/10"><div className="h-1.5 rounded-full" style={{ width: `${Math.round(h.confidence * 100)}%`, background: color }} /></div>
              <div className="mt-1 text-[0.76rem] text-mute">{Math.round(h.confidence * 100)}{tx("% · tested")} {timeAgo(h.tested_at)}</div>
            </div>
          )}
          {can.write && (
            <Button className="ml-auto" variant={h.status === "untested" ? "primary" : "secondary"} icon={h.status === "testing" ? <Pulse label={tx("Testing")} /> : <RefreshCw size={13} />} loading={busy} disabled={h.status === "testing"} onClick={test}>
              {h.status === "testing" ? tx("Testing…") : h.status === "untested" ? tx("Test now") : tx("Re-test with new evidence")}
            </Button>
          )}
        </div>
        {v?.reasoning && <p className="mt-3 text-[0.9rem] leading-relaxed text-white/85">{v.reasoning}</p>}
        {h.status === "untested" && !v && <p className="mt-3 text-[0.84rem] text-mute">{tx("Run a test to gather evidence for and against.")}</p>}
      </section>

      {v && (
        <>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {evidence("Evidence for", v.evidence_for, "#2cff7a")}
            {evidence("Evidence against", v.evidence_against, "#ff5a1f")}
          </div>
          {v.knowledge_evidence?.length > 0 && (
            <section className="mt-8">
              <h3 className="label mb-2 flex items-center gap-1.5"><Brain size={12} /> {tx("From what you already know")}</h3>
              <ul className="space-y-1.5">{v.knowledge_evidence.map((k: any, i: number) => (
                <li key={i} className="text-[0.86rem] text-white/85"><span className={cx("mr-2 text-[0.7rem]", k.stance === "for" ? "text-emerald-300/80" : k.stance === "against" ? "text-orange-300/80" : "text-mute")}>{k.stance}</span>{k.point}</li>
              ))}</ul>
            </section>
          )}
          {v.next_tests?.length > 0 && (
            <section className="mt-10">
              <h3 className="label mb-3">{tx("What would test it further")}</h3>
              <ol className="space-y-3">{v.next_tests.map((t: any, i: number) => (
                <li key={i} className="glow-card rounded-xl border border-line px-5 py-4">
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-[0.74rem] text-mute">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.92rem] text-white">{t.question}</p>
                      <p className="mt-1 text-[0.8rem] text-mute">{t.why}</p>
                      <div className="mt-2 grid gap-2 text-[0.78rem] sm:grid-cols-2">
                        <p><span className="text-emerald-300/80">{tx("Supports it if ·")} </span><span className="text-mute-bright">{t.would_support_if}</span></p>
                        <p><span className="text-orange-300/80">{tx("Refutes it if ·")} </span><span className="text-mute-bright">{t.would_refute_if}</span></p>
                      </div>
                    </div>
                    {can.write && <Button size="sm" variant="ghost" icon={<Compass size={12} />} onClick={() => next(i)}>{tx("Research")}</Button>}
                  </div>
                </li>
              ))}</ol>
              <p className="mt-2 text-[0.74rem] text-mute">{tx("Follow-up research joins your knowledge, so the next re-test takes it into account.")}</p>
            </section>
          )}
        </>
      )}

      <section className="mt-10">
        <h3 className="label mb-3">{tx("Test history")}</h3>
        {h.tests.length === 0 ? <Empty title={tx("No tests yet")}>{tx("Each test is kept as a full research report, so you can see how the evidence moved.")}</Empty> : (
          <ol className="relative space-y-2 border-l border-line pl-5">
            {h.tests.map((t: any) => (
              <li key={t.id} className="relative">
                <span className="absolute -left-[23.5px] top-2 h-2 w-2 rounded-full" style={{ background: t.verdict ? VERDICT[t.verdict]?.color : "#5c5c66" }} />
                <Link to={`/research/${t.id}`} className="flex flex-wrap items-baseline gap-x-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                  <span className="text-[0.86rem] text-white/90">{t.kind === "hypothesis" ? tx("Test") : tx("Follow-up research")}{t.kind !== "hypothesis" && <span className="text-mute">: {t.question}</span>}</span>
                  {t.verdict ? <VerdictBadge status={t.verdict} /> : <span className="text-[0.72rem] text-mute">{t.status}</span>}
                  {t.confidence != null && <span className="text-[0.72rem] text-mute">{Math.round(t.confidence * 100)}%</span>}
                  <span className="ml-auto text-[0.72rem] text-mute">{tn(t.sources, "{n} source", "{n} sources")} · {timeAgo(t.created_at)}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {h.sources.length > 0 && (
        <section className="mt-10">
          <h3 className="label mb-3">{tx("Sources in the latest test")}</h3>
          <ol className="space-y-1.5">{h.sources.map((s: any) => (
            <li key={s.ref_number} className="flex items-baseline gap-2 text-[0.82rem]">
              <span className="w-6 shrink-0 text-right font-mono text-[0.7rem] text-mute">{s.ref_number}</span>
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-white/85 hover:text-white">{s.title}</a><ExternalLink size={10} className="shrink-0 text-mute" />
              {s.position && <Badge tone={s.position === "against" ? "warn" : "ok"}>{s.position}</Badge>}
              {s.grade && <span className="shrink-0 text-[0.7rem]" style={{ color: GRADE_STYLE[s.grade].color }}>{s.score}</span>}
            </li>
          ))}</ol>
          {h.last_research_id && <Link to={`/research/${h.last_research_id}?tab=lineage`} className="mt-3 inline-block text-[0.8rem] text-mute hover:text-white">{tx("Trace the verdict to its sources →")}</Link>}
        </section>
      )}
    </article>
  );
}

