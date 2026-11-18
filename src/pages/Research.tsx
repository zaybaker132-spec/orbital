import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Compass, ExternalLink, RotateCcw, Trash2, BookmarkPlus, ThumbsUp, ThumbsDown, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp } from "@/state/app";
import { usePanel, toast, toastError } from "@/state/ui";
import { Badge, Button, ErrorNote, IconButton, Pulse, Textarea, cx } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { timeAgo } from "@/lib/format";
import { Section } from "@/components/RightPanel";

const RUNNING = ["queued", "planning", "searching", "synthesizing"];

export function ResearchPage() {
  const { id } = useParams();
  const { data: list } = useResource<any[]>("/research");
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => () => setContent("", null), [setContent]);
  return (
    <div className="flex h-full">
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line">
        <div className="px-5 pb-3 pt-6">
          <h1 className="text-[1.05rem] font-normal">Research</h1>
          <p className="mt-0.5 text-[0.78rem] text-mute">Multi-step, cited, verified.</p>
        </div>
        <div className="px-3"><Link to="/research"><Button variant="secondary" className="w-full" icon={<Compass size={14} />}>New research</Button></Link></div>
        <ul className="mt-3 min-h-0 flex-1 space-y-px overflow-y-auto px-3 pb-4">
          {list?.length === 0 && <li className="px-2 py-2 text-[0.8rem] text-mute">No research yet.</li>}
          {list?.map((r) => (
            <li key={r.id}>
              <Link to={`/research/${r.id}`} className={cx("block rounded-lg px-3 py-2 transition-colors", r.id === id ? "bg-white/[0.07]" : "hover:bg-white/[0.04]")}>
                <div className="line-clamp-2 text-[0.84rem] leading-snug text-white/90">{r.question}</div>
                <div className="mt-1 flex items-center gap-2 text-[0.7rem] text-mute">
                  {RUNNING.includes(r.status) ? <span className="flex items-center gap-1.5"><Pulse />{r.status}</span> : r.status === "failed" ? <span className="text-red-300/80">failed</span> : <span>{r.sources} sources · {r.findings} findings</span>}
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();
  const ai = useApp((s) => s.ai);
  const { data: projects } = useResource<any[]>("/projects");
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post("/research", { question: q, projectId: projectId || null });
      invalidate("/research");
      navigate(`/research/${r.id}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-[680px] px-8 pt-16">
      <h2 className="text-[1.35rem] font-light tracking-[-0.015em]">What should Orbital investigate?</h2>
      <p className="mt-2 text-[0.88rem] leading-relaxed text-mute">
        Orbital breaks the question into sub-questions, searches {ai?.webSearch ? "the web, " : ""}Wikipedia and scholarly literature (OpenAlex), extracts findings, compares perspectives and
        verifies every citation and statistic against the retrieved source text before showing it.
      </p>
      <Textarea autoFocus rows={4} value={q} onChange={(e) => setQ(e.target.value)} className="mt-6 text-[0.95rem]"
        placeholder="e.g. Research the growth of artificial intelligence and identify its biggest business opportunities."
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && q.trim().length > 7) start(); }} />
      <div className="mt-3 flex items-center gap-3">
        <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input h-9 w-56 py-0">
          <option value="">No project</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button variant="primary" className="ml-auto" loading={busy} disabled={q.trim().length < 8} onClick={start}>Start research</Button>
      </div>
      <div className="mt-3"><ErrorNote error={err} /></div>
      {ai?.provider === "none" && <p className="mt-6 text-[0.8rem] text-amber-200/80">No AI provider is configured: Orbital will gather and store sources, but won't synthesize findings until one is set up.</p>}
      {!ai?.webSearch && ai?.provider !== "none" && <p className="mt-6 text-[0.8rem] text-mute">Live web search is available with the Anthropic provider. This server uses encyclopedic and scholarly sources.</p>}
    </div>
  );
}

const LEVEL_TONE: Record<string, "ok" | "info" | "warn"> = { verified: "ok", inference: "info", speculation: "warn" };

function ResearchDetail({ id }: { id: string }) {
  const { data: r, error } = useResource<any>(`/research/${id}`);
  const navigate = useNavigate();
  const setContent = usePanel((s) => s.setContent);
  const [rating, setRating] = useState<number | null>(null);

  useEffect(() => {
    if (r) setContent("Research", <ResearchSide r={r} />);
  }, [r, setContent]);

  if (error) return <div className="p-8"><ErrorNote error={error} /></div>;
  if (!r) return <div className="p-10 text-center"><Pulse /></div>;
  const running = RUNNING.includes(r.status);
  const rep = r.report;
  const sources = r.sources ?? [];
  const cite = (refs: number[]) => refs?.length ? <span className="ml-1 whitespace-nowrap">{refs.map((n) => <SourceRef key={n} n={n} sources={sources} />)}</span> : null;

  const del = async () => {
    if (!confirm("Delete this research session and its sources?")) return;
    await api.del(`/research/${id}`).catch(toastError);
    invalidate("/research", "/graph", "/growth");
    navigate("/research");
  };

  return (
    <article className="mx-auto max-w-[820px] px-8 pb-20 pt-8">
      <div className="flex items-start gap-4">
        <h1 className="flex-1 text-[1.3rem] font-light leading-snug tracking-[-0.015em]">{r.question}</h1>
        <div className="flex shrink-0 items-center gap-1">
          {r.status === "completed" && <IconButton label="Save as note" onClick={async () => { try { const d = await api.post(`/research/${id}/save-note`); invalidate("/documents"); toast("Saved to Knowledge", { action: { label: "Open", to: `/knowledge/${d.id}` } }); } catch (e) { toastError(e); } }}><BookmarkPlus size={15} /></IconButton>}
          {r.status === "failed" && <IconButton label="Retry" onClick={async () => { await api.post(`/research/${id}/retry`).catch(toastError); invalidate(`/research`); }}><RotateCcw size={15} /></IconButton>}
          {r.status === "completed" && (
            <>
              <IconButton label="Useful" active={rating === 1} onClick={() => { setRating(1); api.post("/feedback", { targetType: "research", targetId: id, rating: 1 }).catch(toastError); }}><ThumbsUp size={14} /></IconButton>
              <IconButton label="Not useful" active={rating === -1} onClick={() => { setRating(-1); api.post("/feedback", { targetType: "research", targetId: id, rating: -1 }).catch(toastError); }}><ThumbsDown size={14} /></IconButton>
            </>
          )}
          <IconButton label="Delete" onClick={del}><Trash2 size={14} /></IconButton>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.75rem] text-mute">
        <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" ? "warn" : "info"}>{r.status}</Badge>
        <span>Started {timeAgo(r.created_at)}</span>
        {sources.length > 0 && <span>· {sources.length} sources</span>}
        {rep?.mode === "synthesized" && <Badge tone="ai">AI-synthesized from cited sources</Badge>}
      </div>

      {(running || r.status === "failed") && <Steps steps={r.steps} running={running} />}
      {r.status === "failed" && <div className="mt-4"><ErrorNote error={r.error} /></div>}

      {rep && (
        <div className="mt-8 space-y-10">
          {rep.mode === "sources_only" && <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-[0.84rem] text-amber-100/80">{rep.limitations}</p>}
          {rep.executive_summary && (
            <section>
              <h2 className="label mb-3">Executive summary</h2>
              <Markdown text={rep.executive_summary} sources={sources} />
            </section>
          )}
          {rep.research_questions?.length > 0 && (
            <section>
              <h2 className="label mb-3">Research questions</h2>
              <ol className="list-decimal space-y-1 pl-5 text-[0.9rem] text-white/85 marker:text-mute">{rep.research_questions.map((q: string) => <li key={q}>{q}</li>)}</ol>
            </section>
          )}
          {rep.findings?.length > 0 && (
            <section>
              <h2 className="label mb-1">Main findings</h2>
              <p className="mb-3 text-[0.75rem] text-mute">Each finding is labelled: <b className="font-normal text-emerald-200/90">verified</b> — stated by the cited sources · <b className="font-normal text-sky-200/90">inference</b> — reasoned from them · <b className="font-normal text-amber-200/90">speculation</b> — plausible, unsupported.</p>
              <ul className="divide-y divide-line">
                {rep.findings.map((f: any, i: number) => (
                  <li key={i} className="flex gap-3 py-3">
                    <Badge tone={LEVEL_TONE[f.level]} className="mt-0.5 h-fit shrink-0">{f.level}</Badge>
                    <p className="text-[0.92rem] leading-relaxed text-white/90">{f.statement}{cite(f.source_refs)}{f.node_id && <Link to={`/connections?node=${f.node_id}`} className="ml-2 text-[0.72rem] text-mute hover:text-white">in graph →</Link>}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rep.statistics?.length > 0 && (
            <section>
              <h2 className="label mb-3">Important statistics</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {rep.statistics.map((s: any, i: number) => (
                  <li key={i} className="rounded-xl border border-line p-4">
                    <div className="text-[1.3rem] font-light tracking-tight">{s.value}</div>
                    <div className="mt-1 text-[0.84rem] text-white/80">{s.context}<SourceRef n={s.source_ref} sources={sources} /></div>
                    <blockquote className="mt-2 border-l border-white/15 pl-3 text-[0.78rem] italic leading-relaxed text-mute">“{s.quote}”</blockquote>
                    <div className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-mute">{s.verified ? <><ShieldCheck size={12} className="text-emerald-300/80" /> Quote matched in source text</> : "Figure found in source; quote paraphrased"}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rep.supporting_evidence?.length > 0 && (
            <section>
              <h2 className="label mb-3">Supporting evidence</h2>
              <ul className="space-y-2 text-[0.9rem] text-white/85">{rep.supporting_evidence.map((e: any, i: number) => <li key={i}>• {e.point}{cite(e.source_refs)}</li>)}</ul>
            </section>
          )}
          {rep.conflicting_evidence?.length > 0 && (
            <section>
              <h2 className="label mb-3">Conflicting evidence</h2>
              <ul className="space-y-3">{rep.conflicting_evidence.map((e: any, i: number) => (
                <li key={i} className="border-l border-amber-300/30 pl-4 text-[0.9rem] text-white/85">{e.point}{cite(e.source_refs)}<p className="mt-1 text-[0.8rem] text-mute">{e.note}</p></li>
              ))}</ul>
            </section>
          )}
          {(rep.limitations && rep.mode === "synthesized") && (
            <section>
              <h2 className="label mb-3">Limitations</h2>
              <p className="text-[0.86rem] leading-relaxed text-mute-bright">{rep.limitations}</p>
              {(rep.dropped?.findings > 0 || rep.dropped?.statistics > 0) && (
                <p className="mt-2 text-[0.78rem] text-mute">Verification removed {rep.dropped.statistics} statistic{rep.dropped.statistics === 1 ? "" : "s"} that didn't appear in the sources and {rep.dropped.findings} citation{rep.dropped.findings === 1 ? "" : "s"} to sources that weren't retrieved.</p>
              )}
            </section>
          )}
          {rep.further_research?.length > 0 && (
            <section>
              <h2 className="label mb-3">Further research</h2>
              <ul className="divide-y divide-line">{rep.further_research.map((q: string) => (
                <li key={q} className="flex items-center gap-3 py-2"><span className="flex-1 text-[0.88rem] text-white/85">{q}</span>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/research?q=${encodeURIComponent(q)}`)}>Research →</Button></li>
              ))}</ul>
            </section>
          )}
          <section>
            <h2 className="label mb-3">Sources</h2>
            <ol className="space-y-4">{sources.map((s: any) => <SourceItem key={s.ref_number} s={s} />)}</ol>
          </section>
          <details className="text-[0.8rem] text-mute"><summary className="cursor-pointer hover:text-white">Workflow log</summary><Steps steps={r.steps} running={false} /></details>
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
          <span className="text-white/85">{s.label}</span>
          {s.detail && <span className="ml-2 text-mute">{s.detail}</span>}
        </li>
      ))}
      {running && steps.length === 0 && <li className="text-[0.84rem] text-mute"><Pulse /> Queued</li>}
    </ol>
  );
}

function SourceRef({ n, sources }: { n: number; sources: any[] }) {
  const s = sources.find((x) => x.ref_number === n);
  return (
    <a href={s?.url} target="_blank" rel="noreferrer noopener" title={s ? `${s.title} — ${s.url}` : `Source ${n}`}
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
          <Badge>{s.source_type}</Badge><span>{s.provider}</span>{s.authors && <span>· {s.authors}</span>}{s.published && <span>· {s.published}</span>}
          <span className="truncate">· {new URL(s.url).hostname}</span>
        </div>
        <button onClick={() => setOpen(!open)} className="mt-1 text-[0.74rem] text-mute hover:text-white">{open ? "Hide retrieved text" : "Show retrieved text"}</button>
        {open && <p className="mt-1.5 whitespace-pre-wrap text-[0.8rem] leading-relaxed text-mute-bright">{s.excerpt}</p>}
      </div>
    </li>
  );
}

function ResearchSide({ r }: { r: any }) {
  const rep = r.report;
  return (
    <>
      {r.plan?.interpretation && <Section title="Understanding"><p className="text-[0.83rem] leading-relaxed text-mute-bright">{r.plan.interpretation}</p></Section>}
      {rep?.related_knowledge?.length > 0 && (
        <Section title="Related knowledge" count={rep.related_knowledge.length}>
          <ul className="space-y-1">{rep.related_knowledge.map((k: any) => <li key={k.id}><Link to={`/connections?node=${k.id}`} className="text-[0.83rem] text-white/85 hover:text-white">{k.title} <span className="text-[0.7rem] text-mute">{k.kind}</span></Link></li>)}</ul>
        </Section>
      )}
      {r.sources?.length > 0 && (
        <Section title="Sources" count={r.sources.length}>
          <ul className="space-y-2">{r.sources.map((s: any) => (
            <li key={s.ref_number} className="text-[0.8rem] leading-snug"><span className="mr-1.5 font-mono text-mute">{s.ref_number}</span><a href={s.url} target="_blank" rel="noreferrer noopener" className="text-white/85 hover:text-white">{s.title}</a></li>
          ))}</ul>
        </Section>
      )}
      {!rep && <Section title="Status"><p className="text-[0.83rem] text-mute">{r.status}</p></Section>}
    </>
  );
}

