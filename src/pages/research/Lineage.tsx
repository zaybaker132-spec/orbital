import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, CornerDownRight, ExternalLink, FileSearch, Search } from "lucide-react";
import { useResource } from "@/lib/resource";
import { Badge, Pulse, cx } from "@/components/ui";
import { GRADE_STYLE } from "./SourceIntel";
import { locale, tn, tx } from "@/i18n";

const LEVEL: Record<string, "ok" | "info" | "warn"> = { verified: "ok", inference: "info", speculation: "warn" };

/**
 * Research lineage: pick a conclusion (or a finding) and follow it all the way down —
 * findings and the reasoning behind them, the earlier findings they build on, the exact passage in
 * each source, the source's credibility, the search that found it, and the question it all came from.
 */
export function Lineage({ researchId, focusFinding }: { researchId: string; focusFinding?: number | null }) {
  const { data: l } = useResource<any>(`/research/${researchId}/lineage`);
  const [sel, setSel] = useState<{ kind: "conclusion" | "finding"; index: number } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusFinding != null) setSel({ kind: "finding", index: focusFinding }); }, [focusFinding]);
  useEffect(() => { if (l && !sel) setSel(l.conclusions.length ? { kind: "conclusion", index: 0 } : l.findings.length ? { kind: "finding", index: 0 } : null); }, [l, sel]);

  // The chain of findings under the selection, including the earlier findings they build on.
  const chain = useMemo(() => {
    if (!l || !sel) return [] as number[];
    const start = sel.kind === "conclusion" ? l.conclusions[sel.index]?.finding_refs ?? [] : [sel.index];
    const seen = new Set<number>(), order: number[] = [];
    const visit = (i: number) => { if (seen.has(i) || !l.findings[i]) return; seen.add(i); order.push(i); for (const j of l.findings[i].builds_on) visit(j); };
    start.forEach(visit);
    return order;
  }, [l, sel]);

  if (!l) return <div className="py-10 text-center"><Pulse /></div>;
  if (!l.findings.length) return <p className="text-[0.88rem] text-mute">{l.conclusions.length ? tx("This report has no findings to trace.") : tx("This report has no findings to trace yet.")} {tx("Lineage is built when Orbital synthesizes a report from its sources.")}</p>;
  const src = (n: number) => l.sources.find((s: any) => s.n === n);
  const kItem = (ref: string) => l.knowledge.find((k: any) => k.ref === ref);
  const usedSources = [...new Set(chain.flatMap((i) => l.findings[i].evidence.map((e: any) => e.source)))] as number[];

  return (
    <div ref={top}>
      <nav aria-label={tx("Trace from")} className="space-y-3">
        {l.conclusions.length > 0 && (
          <div>
            <div className="label mb-1.5">{tx("Trace a conclusion")}</div>
            <ul className="space-y-1">{l.conclusions.map((c: any, i: number) => (
              <li key={i}><button onClick={() => setSel({ kind: "conclusion", index: i })} className={cx("w-full rounded-lg border px-3 py-2 text-left text-[0.84rem] leading-snug transition-colors", sel?.kind === "conclusion" && sel.index === i ? "border-white/40 bg-white/[0.06] text-white" : "border-line text-mute-bright hover:border-line-strong")}>{c.statement}</button></li>
            ))}</ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">{tx("Or a finding")}</span>
          {l.findings.map((f: any) => (
            <button key={f.index} title={f.statement} onClick={() => setSel({ kind: "finding", index: f.index })}
              className={cx("h-7 min-w-7 rounded-md border px-2 font-mono text-[0.74rem] transition-colors", sel?.kind === "finding" && sel.index === f.index ? "border-white bg-white text-black" : chain.includes(f.index) ? "border-white/40 text-white" : "border-line text-mute hover:text-white")}>{f.index + 1}</button>
          ))}
        </div>
      </nav>

      <div className="mt-6 min-w-0">
        {/* Top of the chain */}
        {sel?.kind === "conclusion" && (
          <div className="rounded-xl border border-white/25 bg-white/[0.04] px-5 py-4">
            <div className="label mb-1">{tx("Conclusion")}</div>
            <p className="text-[1rem] leading-relaxed text-white">{l.conclusions[sel.index].statement}</p>
            <p className="mt-2 text-[0.76rem] text-mute">{tx("Rests on {findings} and {sources}.", { findings: tn(chain.length, "{n} finding", "{n} findings"), sources: tn(usedSources.length, "{n} source", "{n} sources") })}</p>
          </div>
        )}

        <ol className={cx("space-y-4", sel?.kind === "conclusion" && "mt-4 border-l border-white/15 pl-5")}>
          {chain.map((i) => {
            const f = l.findings[i];
            return (
              <li key={i} className="relative">
                {sel?.kind === "conclusion" && <span aria-hidden className="absolute -left-[25px] top-5 h-2 w-2 rounded-full bg-white/50" />}
                <div className="glow-card rounded-xl border border-line px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Badge tone={LEVEL[f.level]} className="mt-0.5 shrink-0">{f.level}</Badge>
                    <div className="min-w-0">
                      <p className="text-[0.92rem] leading-relaxed text-white/90"><span className="mr-1.5 font-mono text-[0.74rem] text-mute">{f.index + 1}</span>{f.statement}</p>
                      {f.reasoning && <p className="mt-1.5 text-[0.8rem] leading-relaxed text-mute-bright"><span className="text-mute">{tx("Reasoning ·")} </span>{f.reasoning}</p>}
                      {f.builds_on.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.76rem] text-mute"><CornerDownRight size={12} />{tx("Builds on")}
                          {f.builds_on.map((j: number) => <button key={j} onClick={() => setSel({ kind: "finding", index: j })} className="rounded border border-line px-1.5 font-mono text-white/80 hover:border-white/40">{tx("finding")} {j + 1}</button>)}</p>
                      )}
                      {f.history?.length > 0 && <p className="mt-1.5 text-[0.74rem] text-mute">{tx("Refreshed")} {new Date(f.refreshed_at).toLocaleDateString(locale())} {tx("· previously: “")}{f.history[f.history.length - 1].statement}”</p>}
                    </div>
                  </div>

                  {/* Evidence: the passage in each source, the source, and how it was found. */}
                  {f.evidence.length > 0 ? (
                    <ul className="mt-4 space-y-3 border-t border-line pt-3">
                      {f.evidence.map((e: any) => {
                        const s = src(e.source);
                        return (
                          <li key={e.source} className="space-y-2">
                            <blockquote className={cx("border-l pl-3 text-[0.82rem] italic leading-relaxed", e.matched ? "border-emerald-300/40 text-white/80" : "border-white/15 text-mute")}>
                              “{e.passage}”
                              {!e.matched && <span className="mt-1 block not-italic text-[0.7rem] text-mute">{tx("No sentence closely matches the finding: read the full source.")}</span>}
                            </blockquote>
                            {s && (
                              <div className="text-[0.74rem] leading-snug">
                                <a href={s.url} target="_blank" rel="noreferrer noopener" className="flex items-start gap-1 text-white/85 hover:text-white"><span className="font-mono text-mute">[{s.n}]</span><span className="line-clamp-2">{s.title}</span><ExternalLink size={10} className="mt-0.5 shrink-0" /></a>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-mute">
                                  {s.grade && <span style={{ color: GRADE_STYLE[s.grade].color }}>{s.score} · {s.grade}</span>}
                                  <span>{s.provider}</span>{s.published && <span>· {s.published}</span>}
                                </div>
                                {s.subquestion && <div className="mt-1 flex items-start gap-1 text-mute"><Search size={10} className="mt-0.5 shrink-0" /><span>{tx("Found searching for “{q}”", { q: s.position || s.subquestion })}</span></div>}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p className="mt-3 border-t border-line pt-3 text-[0.78rem] text-mute">{tx("No source supports this directly: it's")} {f.level === "inference" ? tx("reasoned from other findings") : tx("unsupported speculation")}.</p>}

                  {f.knowledge_refs.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.74rem] text-mute"><Brain size={12} />{tx("Connects to what you know:")}
                      {f.knowledge_refs.map((r: string) => { const k = kItem(r); return k ? <Link key={r} to={k.type === "memory" ? "/knowledge?tab=memory" : `/connections?node=${k.id}`} className="rounded border border-line px-1.5 text-white/80 hover:border-white/40">{k.title.slice(0, 60)}</Link> : null; })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* The bottom of the chain: where it all started. */}
        <div className="mt-6 rounded-xl border border-dashed border-white/15 px-5 py-4 text-[0.82rem]">
          <div className="label mb-2 flex items-center gap-1.5"><FileSearch size={12} /> {tx("Original research")}</div>
          <p className="text-white/85">{l.question}</p>
          {l.interpretation && <p className="mt-1 text-mute">{l.interpretation}</p>}
          {l.hypothesis && <p className="mt-1 text-mute">{tx("Testing the hypothesis")} <Link to={`/hypotheses/${l.hypothesis.id}`} className="text-white/85 underline decoration-white/20">“{l.hypothesis.statement}”</Link></p>}
          {l.plan.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-mute">{l.plan.map((p: any, i: number) => <li key={i}>· {p.position ? <span className="text-white/70">{p.position}: </span> : null}{p.query}</li>)}</ul>
          )}
          <p className="mt-2 text-[0.72rem] text-mute-soft">{tx("Started")} {new Date(l.created_at).toLocaleString(locale())}{l.completed_at ? tx(" · completed {date}", { date: new Date(l.completed_at).toLocaleString(locale()) }) : ""}{l.refreshed_at ? tx(" · refreshed {date}", { date: new Date(l.refreshed_at).toLocaleString(locale()) }) : ""}</p>
        </div>
      </div>
    </div>
  );
}
