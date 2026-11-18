import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Compass, ExternalLink, RotateCcw, Trash2, BookmarkPlus, ThumbsUp, ThumbsDown, ShieldCheck, GitBranch, Scale, FlaskConical, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp } from "@/state/app";
import { usePanel, toast, toastError } from "@/state/ui";
import { Badge, Button, ErrorNote, IconButton, Pulse, Textarea, cx } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { timeAgo } from "@/lib/format";
import { NotFoundPage } from "./NotFound";
import { Section } from "@/components/RightPanel";
import { SourceIntelligence, GRADE_STYLE } from "./research/SourceIntel";
import { Lineage } from "./research/Lineage";
import { ContradictionLab, FreshnessBanner, FindingFreshness } from "./research/ReportParts";
import { locale, tn, tx } from "@/i18n";

const RUNNING = ["queued", "planning", "searching", "synthesizing", "refreshing"];

export function ResearchPage() {
  const { id } = useParams();
  const { data: list } = useResource<any[]>("/research");
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => () => setContent("", null), [setContent]);
  return (
    <div className="flex h-full">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div className="px-5 pb-3 pt-6">
          <h1 className="text-[1.05rem] font-normal">{tx("Research")}</h1>
          <p className="mt-0.5 text-[0.78rem] text-mute">{tx("Multi-step, cited, verified.")}</p>
          <div className="mt-3 flex gap-1 text-[0.78rem]">
            <span className="rounded-full bg-white px-3 py-1 text-black">{tx("Reports")}</span>
            <Link to="/hypotheses" className="rounded-full px-3 py-1 text-mute hover:bg-white/[0.06] hover:text-white">{tx("Hypotheses")}</Link>
          </div>
        </div>
        <div className="px-3"><Link to="/research"><Button variant="secondary" className="w-full" icon={<Compass size={14} />}>{tx("New research")}</Button></Link></div>
        <ul className="mt-3 min-h-0 flex-1 space-y-px overflow-y-auto px-3 pb-4">
          {list?.length === 0 && <li className="px-2 py-2 text-[0.8rem] text-mute">{tx("No research yet.")}</li>}
          {list?.map((r) => (
            <li key={r.id}>
              <Link to={`/research/${r.id}`} className={cx("block rounded-lg px-3 py-2 transition-colors", r.id === id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}>
                <div className="line-clamp-2 text-[0.84rem] leading-snug text-white/90">{r.question}</div>
                <div className="mt-1 flex items-center gap-2 text-[0.7rem] text-mute">
                  {r.kind === "contradiction" && <span className="text-sky-200/80">{tx("lab")}</span>}
                  {r.kind === "hypothesis" && <span className="text-fuchsia-200/80">{tx("hypothesis")}</span>}
                  {r.freshness === "stale" && <span className="text-amber-200/80" title={tx("Some facts may be out of date")}>{tx("outdated")}</span>}
                  {RUNNING.includes(r.status) ? <span className="flex items-center gap-1.5"><Pulse />{r.status}</span> : r.status === "failed" ? <span className="text-red-300/80">{tx("failed")}</span> : <span>{tn(r.sources, "{n} source", "{n} sources")} · {tn(r.findings, "{n} finding", "{n} findings")}</span>}
                  <span className="ml-auto">{timeAgo(r.created_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">{id ? <ResearchDetail id={id} /> : <NewResearch />}</div>
    </div>
  );
}

function NewResearch() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState<"standard" | "contradiction" | "hypothesis">((params.get("kind") as any) ?? "standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();
  const ai = useApp((s) => s.ai);
  const { data: projects } = useResource<any[]>("/projects");
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      if (kind === "hypothesis") {
        const h = await api.post("/hypotheses", { statement: q, projectId: projectId || null });
        await api.post(`/hypotheses/${h.id}/test`);
        invalidate("/hypotheses", "/research");
        navigate(`/hypotheses/${h.id}`);
        return;
      }
      const r = await api.post("/research", { question: q, projectId: projectId || null, kind });
      invalidate("/research");
      navigate(`/research/${r.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-[680px] px-8 pt-16">
      <div className="mb-6 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={tx("Kind of research")}>
        {([
          ["standard", Compass, "Research", "Answer a question with cited, verified sources"],
          ["contradiction", Scale, "Contradiction lab", "Gather opposing views and find out exactly why they disagree"],
          ["hypothesis", FlaskConical, "Test a hypothesis", "Evidence for and against, a verdict, and what to test next"],
        ] as const).map(([k, Icon, title, hint]) => (
          <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={cx("rounded-xl border px-4 py-3 text-left transition-colors", kind === k ? "border-white/60 bg-white/[0.05]" : "border-line hover:border-line-strong")}>
            <Icon size={15} className={kind === k ? "text-white" : "text-mute"} />
            <div className="mt-2 text-[0.88rem] text-white">{title}</div>
            <div className="mt-0.5 text-[0.74rem] leading-snug text-mute">{hint}</div>
          </button>
        ))}
      </div>
      <h2 className="text-[1.35rem] font-light tracking-[-0.015em]">{kind === "contradiction" ? tx("What's contested?") : kind === "hypothesis" ? tx("What do you believe might be true?") : tx("What should Orbital investigate?")}</h2>
      <p className="mt-2 text-[0.88rem] leading-relaxed text-mute">
        {ai?.webSearch ? tx("Orbital breaks the question into sub-questions, searches the web, Wikipedia and scholarly literature (OpenAlex), extracts findings, compares perspectives and verifies every citation and statistic against the retrieved source text before showing it.") : tx("Orbital breaks the question into sub-questions, searches Wikipedia and scholarly literature (OpenAlex), extracts findings, compares perspectives and verifies every citation and statistic against the retrieved source text before showing it.")}
      </p>
      <Textarea autoFocus rows={4} value={q} onChange={(e) => setQ(e.target.value)} className="mt-6 text-[0.95rem]"
        placeholder={kind === "contradiction" ? tx("e.g. Does remote work raise or lower productivity?") : kind === "hypothesis" ? tx("e.g. Independent salons will pay for AI scheduling if it cuts no-shows by a fifth.") : tx("e.g. Research the growth of artificial intelligence and identify its biggest business opportunities.")}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && q.trim().length > 7) start(); }} />
      <div className="mt-3 flex items-center gap-3">
        <select aria-label={tx("Project")} value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input h-9 w-56 py-0">
          <option value="">{tx("No project")}</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button variant="primary" className="ml-auto" loading={busy} disabled={q.trim().length < 8} onClick={start}>{kind === "contradiction" ? tx("Open the lab") : kind === "hypothesis" ? tx("Test it") : tx("Start research")}</Button>
      </div>
      <div className="mt-3"><ErrorNote error={err} /></div>
      {ai?.provider === "none" && <p className="mt-6 text-[0.8rem] text-amber-200/80">{tx("No AI provider is configured: Orbital will gather and store sources, but won't synthesize findings until one is set up.")}</p>}
      {!ai?.webSearch && ai?.provider !== "none" && <p className="mt-6 text-[0.8rem] text-mute">{tx("Live web search is available with the Anthropic provider. This server uses encyclopedic and scholarly sources.")}</p>}
    </div>
  );
}

const LEVEL_TONE: Record<string, "ok" | "info" | "warn"> = { verified: "ok", inference: "info", speculation: "warn" };

function ResearchDetail({ id }: { id: string }) {
  const { data: r, error } = useResource<any>(`/research/${id}`);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "report" | "sources" | "lineage") ?? "report";
  const focusFinding = params.get("finding") != null ? Number(params.get("finding")) : null;
  const ai = useApp((s) => s.ai);
  const setContent = usePanel((s) => s.setContent);
  const [rating, setRating] = useState<number | null>(null);

  useEffect(() => {
    if (r) setContent("Research", <ResearchSide r={r} />);
  }, [r, setContent]);

  if (error && (error as any).status === 404) return <NotFoundPage what="research report" back={{ to: "/research", label: "All research" }} />;
  if (error) return <div className="p-8"><ErrorNote error={error} /></div>;
  if (!r) return <div className="p-10 text-center"><Pulse /></div>;
  const running = RUNNING.includes(r.status);
  const rep = r.report;
  const sources = r.sources ?? [];
  const cite = (refs: number[]) => refs?.length ? <span className="ml-1 whitespace-nowrap">{refs.map((n) => <SourceRef key={n} n={n} sources={sources} />)}</span> : null;

  const del = async () => {
    if (!confirm(tx("Delete this research session and its sources?"))) return;
    await api.del(`/research/${id}`).catch(toastError);
    invalidate("/research", "/graph", "/growth");
    navigate("/research");
  };

  return (
    <article className="mx-auto max-w-[820px] px-8 pb-20 pt-8">
      <div className="flex items-start gap-4">
        <h1 className="flex-1 text-[1.3rem] font-light leading-snug tracking-[-0.015em]">{r.question}</h1>
        <div className="flex shrink-0 items-center gap-1">
          {r.status === "completed" && <IconButton label={tx("Save as note")} onClick={async () => { try { const d = await api.post(`/research/${id}/save-note`); invalidate("/documents"); toast(tx("Saved to Knowledge"), { action: { label: "Open", to: `/knowledge/${d.id}` } }); } catch (e) { toastError(e); } }}><BookmarkPlus size={15} /></IconButton>}
          {r.status === "failed" && <IconButton label={tx("Retry")} onClick={async () => { await api.post(`/research/${id}/retry`).catch(toastError); invalidate(`/research`); }}><RotateCcw size={15} /></IconButton>}
          {r.status === "completed" && (
            <>
              <IconButton label={tx("Useful")} active={rating === 1} onClick={() => { setRating(1); api.post("/feedback", { targetType: "research", targetId: id, rating: 1 }).catch(toastError); }}><ThumbsUp size={14} /></IconButton>
              <IconButton label={tx("Not useful")} active={rating === -1} onClick={() => { setRating(-1); api.post("/feedback", { targetType: "research", targetId: id, rating: -1 }).catch(toastError); }}><ThumbsDown size={14} /></IconButton>
            </>
          )}
          <IconButton label={tx("Delete")} onClick={del}><Trash2 size={14} /></IconButton>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.75rem] text-mute">
        <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" ? "warn" : "info"}>{r.status}</Badge>
        <span>{tx("Started")} {timeAgo(r.created_at)}</span>
        {sources.length > 0 && <span>· {tn(sources.length, "{n} source", "{n} sources")}</span>}
        {rep?.mode === "synthesized" && <Badge tone="ai">{tx("AI-synthesized from cited sources")}</Badge>}
      </div>

      {rep && (
        <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
          {([["report", "Report"], ["sources", "Sources"], ["lineage", "Lineage"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParams(k === "report" ? {} : { tab: k })}
              className={cx("-mb-px border-b px-3 pb-2 text-[0.84rem] transition-colors", tab === k ? "border-white text-white" : "border-transparent text-mute hover:text-white")}>{tx(label)}{k === "sources" && sources.length ? ` · ${sources.length}` : ""}</button>
          ))}
        </div>
      )}
      {rep && tab === "report" && <FreshnessBanner r={r} ai={ai?.provider !== "none"} />}
      {rep && tab === "sources" && <div className="mt-8"><SourceIntelligence researchId={id} sources={sources} canAssess={r.status === "completed"} /></div>}
      {rep && tab === "lineage" && <div className="mt-8"><Lineage researchId={id} focusFinding={focusFinding} /></div>}

      {(running || r.status === "failed") && <Steps steps={r.steps} running={running} />}
      {r.status === "failed" && <div className="mt-4"><ErrorNote error={r.error} /></div>}

      {rep && tab === "report" && (
        <div className="mt-8 space-y-10">
          {rep.mode === "sources_only" && <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-[0.84rem] text-amber-100/80">{rep.limitations}</p>}
          {rep.executive_summary && (
            <section>
              <h2 className="label mb-3">{tx("Executive summary")}</h2>
              <Markdown text={rep.executive_summary} sources={sources} />
            </section>
          )}
          {rep.hypothesis && (
            <section className="rounded-xl border border-white/20 bg-white/[0.03] px-5 py-4">
              <div className="label mb-2">{tx("Hypothesis verdict")}</div>
              <div className="flex items-baseline gap-3"><span className="text-[1.1rem] capitalize text-white">{rep.hypothesis.verdict}</span><span className="text-[0.8rem] text-mute">{tx("confidence")} {Math.round(rep.hypothesis.confidence * 100)}%</span></div>
              <p className="mt-1 text-[0.86rem] text-mute-bright">{rep.hypothesis.reasoning}</p>
              {r.hypothesis_id && <Link to={`/hypotheses/${r.hypothesis_id}`} className="mt-2 inline-block text-[0.8rem] text-white/85 underline decoration-white/20">{tx("Open the hypothesis →")}</Link>}
            </section>
          )}
          {rep.conclusions?.length > 0 && (
            <section>
              <h2 className="label mb-3">{tx("Conclusions")}</h2>
              <ol className="space-y-2">{rep.conclusions.map((c: any, i: number) => (
                <li key={i} className="flex items-start gap-3 text-[0.92rem] leading-relaxed text-white/90">
                  <span className="font-mono text-[0.74rem] text-mute">{i + 1}</span><span className="flex-1">{c.statement}</span>
                  <button onClick={() => setParams({ tab: "lineage" })} className="flex shrink-0 items-center gap-1 text-[0.72rem] text-mute hover:text-white"><GitBranch size={12} />{tx("Trace")}</button>
                </li>
              ))}</ol>
            </section>
          )}
          {rep.lab && <ContradictionLab lab={rep.lab} cite={cite} />}
          {rep.research_questions?.length > 0 && !rep.lab && (
            <section>
              <h2 className="label mb-3">{tx("Research questions")}</h2>
              <ol className="list-decimal space-y-1 pl-5 text-[0.9rem] text-white/85 marker:text-mute">{rep.research_questions.map((q: string) => <li key={q}>{q}</li>)}</ol>
            </section>
          )}
          {rep.findings?.length > 0 && (
            <section>
              <h2 className="label mb-1">{tx("Main findings")}</h2>
              <p className="mb-3 text-[0.75rem] text-mute">{tx("Each finding is labelled:")} <b className="font-normal text-emerald-200/90">{tx("verified")}</b> {tx("— stated by the cited sources ·")} <b className="font-normal text-sky-200/90">{tx("inference")}</b> {tx("— reasoned from them ·")} <b className="font-normal text-amber-200/90">{tx("speculation")}</b> {tx("— plausible, unsupported.")}</p>
              <ul className="divide-y divide-line">
                {rep.findings.map((f: any, i: number) => (
                  <li key={i} className="group flex gap-3 py-3">
                    <Badge tone={LEVEL_TONE[f.level]} className="mt-0.5 h-fit shrink-0">{f.level}</Badge>
                    <p className="flex-1 text-[0.92rem] leading-relaxed text-white/90">{f.statement}{cite(f.source_refs)}{f.node_id && <Link to={`/connections?node=${f.node_id}`} className="ml-2 text-[0.72rem] text-mute hover:text-white">{tx("in graph →")}</Link>}
                      <FindingFreshness f={f} item={r.freshness?.items?.find((x: any) => x.section === "finding" && x.index === i)} /></p>
                    <button onClick={() => setParams({ tab: "lineage", finding: String(i) })} title={tx("Trace this finding to its sources")} className="flex h-fit shrink-0 items-center gap-1 text-[0.72rem] text-mute opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"><GitBranch size={12} />{tx("Trace")}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rep.statistics?.length > 0 && (
            <section>
              <h2 className="label mb-3">{tx("Important statistics")}</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {rep.statistics.map((s: any, i: number) => (
                  <li key={i} className="rounded-xl border border-line p-4">
                    <div className="text-[1.3rem] font-light tracking-tight">{s.value}</div>
                    <div className="mt-1 text-[0.84rem] text-white/80">{s.context}<SourceRef n={s.source_ref} sources={sources} />
                      {r.freshness?.items?.some((x: any) => x.section === "statistic" && x.index === i && x.state === "stale") && <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-300/15 px-1.5 text-[0.66rem] text-amber-200"><AlertTriangle size={10} />{tx("may be outdated")}</span>}
                      {s.refreshed_at && <span className="ml-2 rounded bg-sky-300/10 px-1.5 text-[0.66rem] text-sky-200/90">{tx("refreshed")} {new Date(s.refreshed_at).toLocaleDateString(locale())}</span>}</div>
                    <blockquote className="mt-2 border-l border-white/15 pl-3 text-[0.78rem] italic leading-relaxed text-mute">“{s.quote}”</blockquote>
                    <div className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-mute">{s.verified ? <><ShieldCheck size={12} className="text-emerald-300/80" /> {tx("Quote matched in source text")}</> : tx("Figure found in source; quote paraphrased")}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rep.supporting_evidence?.length > 0 && (
            <section>
              <h2 className="label mb-3">{tx("Supporting evidence")}</h2>
              <ul className="space-y-2 text-[0.9rem] text-white/85">{rep.supporting_evidence.map((e: any, i: number) => <li key={i}>• {e.point}{cite(e.source_refs)}</li>)}</ul>
            </section>
          )}
          {rep.conflicting_evidence?.length > 0 && !rep.lab && (
            <section>
              <h2 className="label mb-3">{tx("Conflicting evidence")}</h2>
              <ul className="space-y-3">{rep.conflicting_evidence.map((e: any, i: number) => (
                <li key={i} className="border-l border-amber-300/30 pl-4 text-[0.9rem] text-white/85">{e.point}{cite(e.source_refs)}<p className="mt-1 text-[0.8rem] text-mute">{e.note}</p></li>
              ))}</ul>
            </section>
          )}
          {(rep.limitations && rep.mode === "synthesized") && (
            <section>
              <h2 className="label mb-3">{tx("Limitations")}</h2>
              <p className="text-[0.86rem] leading-relaxed text-mute-bright">{rep.limitations}</p>
              {(rep.dropped?.findings > 0 || rep.dropped?.statistics > 0) && (
                <p className="mt-2 text-[0.78rem] text-mute">{tx("Verification removed {stats} and {cites}.", { stats: tn(rep.dropped.statistics, "{n} statistic that didn't appear in the sources", "{n} statistics that didn't appear in the sources"), cites: tn(rep.dropped.findings, "{n} citation to sources that weren't retrieved", "{n} citations to sources that weren't retrieved") })}</p>
              )}
            </section>
          )}
          {rep.further_research?.length > 0 && (
            <section>
              <h2 className="label mb-3">{tx("Further research")}</h2>
              <ul className="divide-y divide-line">{rep.further_research.map((q: string) => (
                <li key={q} className="flex items-center gap-3 py-2"><span className="flex-1 text-[0.88rem] text-white/85">{q}</span>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/research?q=${encodeURIComponent(q)}`)}>{tx("Research →")}</Button></li>
              ))}</ul>
            </section>
          )}
          <section>
            <div className="mb-3 flex items-baseline gap-3"><h2 className="label">{tx("Sources")}</h2><button onClick={() => setParams({ tab: "sources" })} className="text-[0.74rem] text-mute hover:text-white">{tx("Credibility details →")}</button></div>
            <ol className="space-y-4">{sources.map((s: any) => <SourceItem key={s.ref_number} s={s} />)}</ol>
          </section>
          <details className="text-[0.8rem] text-mute"><summary className="cursor-pointer hover:text-white">{tx("Workflow log")}</summary><Steps steps={r.steps} running={false} /></details>
        </div>
      )}
    </article>
  );
}

function Steps({ steps, running }: { steps: any[]; running: boolean }) {
  return (
    <ol className="mt-6 space-y-2 border-l border-line pl-4">
      {steps.map((s, i) => (
        <li key={i} className="relative text-[0.84rem]">
          <span className={cx("absolute -left-[19.5px] top-[7px] h-1.5 w-1.5 rounded-full", running && i === steps.length - 1 ? "animate-pulse bg-white" : "bg-white/35")} />
          <span className="text-white/85">{tx(s.label)}</span>
          {s.detail && <span className="ml-2 text-mute">{s.detail}</span>}
        </li>
      ))}
      {running && steps.length === 0 && <li className="text-[0.84rem] text-mute"><Pulse /> {tx("Queued")}</li>}
    </ol>
  );
}

function SourceRef({ n, sources }: { n: number; sources: any[] }) {
  const s = sources.find((x) => x.ref_number === n);
  return (
    <a href={s?.url} target="_blank" rel="noreferrer noopener" title={s ? `${s.title} — ${s.url}` : tx("Source {n}", { n: n })}
      className="ml-0.5 inline-block font-mono text-[0.7rem] text-sky-200/80 hover:text-sky-100">[{n}]</a>
  );
}

function SourceItem({ s }: { s: any }) {
  const [open, setOpen] = useState(false);
  return (
    <li id={`source-${s.ref_number}`} className="flex gap-3">
      <span className="w-6 shrink-0 pt-px text-right font-mono text-[0.72rem] text-mute">{s.ref_number}</span>
      <div className="min-w-0">
        <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[0.88rem] text-white hover:underline decoration-white/30 underline-offset-2">{s.title}<ExternalLink size={11} className="text-mute" /></a>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.72rem] text-mute">
          {s.assessment && <span style={{ color: GRADE_STYLE[s.assessment.grade].color }} title={tx("Credibility score")}>{s.assessment.score} · {s.assessment.grade}</span>}
          <Badge>{s.source_type}</Badge><span>{s.provider}</span>{s.authors && <span>· {s.authors}</span>}{s.published && <span>· {s.published}</span>}
          <span className="truncate">· {new URL(s.url).hostname}</span>
        </div>
        <button onClick={() => setOpen(!open)} className="mt-1 text-[0.74rem] text-mute hover:text-white">{open ? tx("Hide retrieved text") : tx("Show retrieved text")}</button>
        {open && <p className="mt-1.5 whitespace-pre-wrap text-[0.8rem] leading-relaxed text-mute-bright">{s.excerpt}</p>}
      </div>
    </li>
  );
}

function ResearchSide({ r }: { r: any }) {
  const rep = r.report;
  return (
    <>
      {r.plan?.interpretation && <Section title={tx("Understanding")}><p className="text-[0.83rem] leading-relaxed text-mute-bright">{r.plan.interpretation}</p></Section>}
      {rep?.related_knowledge?.length > 0 && (
        <Section title={tx("Related knowledge")} count={rep.related_knowledge.length}>
          <ul className="space-y-1">{rep.related_knowledge.map((k: any) => <li key={k.id}><Link to={`/connections?node=${k.id}`} className="text-[0.83rem] text-white/85 hover:text-white">{k.title} <span className="text-[0.7rem] text-mute">{k.kind}</span></Link></li>)}</ul>
        </Section>
      )}
      {r.sources?.length > 0 && (
        <Section title={tx("Sources")} count={r.sources.length}>
          <ul className="space-y-2">{r.sources.map((s: any) => (
            <li key={s.ref_number} className="text-[0.8rem] leading-snug"><span className="mr-1.5 font-mono text-mute">{s.ref_number}</span><a href={s.url} target="_blank" rel="noreferrer noopener" className="text-white/85 hover:text-white">{s.title}</a></li>
          ))}</ul>
        </Section>
      )}
      {!rep && <Section title={tx("Status")}><p className="text-[0.83rem] text-mute">{r.status}</p></Section>}
    </>
  );
}

