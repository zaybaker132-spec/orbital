import { useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/resource";
import { toastError } from "@/state/ui";
import { Badge, Button, cx } from "@/components/ui";
import { tx } from "@/i18n";

export const GRADE_STYLE: Record<string, { label: string; color: string }> = {
  high: { label: "High credibility", color: "#2cff7a" },
  moderate: { label: "Moderate", color: "#ffd23a" },
  low: { label: "Low credibility", color: "#ff5a1f" },
};
const FACTORS: { key: string; label: string; hint: string }[] = [
  { key: "authority", label: "Authority", hint: "Who published it" },
  { key: "methodology", label: "Methodology", hint: "What kind of evidence it is" },
  { key: "recency", label: "Recency", hint: "How current it is" },
  { key: "independence", label: "Independence", hint: "Signs of conflicts of interest" },
  { key: "corroboration", label: "Corroboration", hint: "Whether findings rely on it and others agree" },
];

/** A small ring with the overall score, coloured by grade. */
export function ScoreRing({ score, grade, size = 44 }: { score: number; grade: string; size?: number }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  const color = GRADE_STYLE[grade]?.color ?? "#8a8a93";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={tx("Credibility {score} of 100, {grade}", { score: score, grade: grade })} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={size * 0.3} fontWeight="300">{score}</text>
    </svg>
  );
}

export function SourceIntelligence({ researchId, sources, canAssess }: { researchId: string; sources: any[]; canAssess: boolean }) {
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<"ref" | "score">("ref");
  const assessed = sources.filter((s) => s.assessment);
  const avg = assessed.length ? Math.round(assessed.reduce((a, s) => a + s.assessment.score, 0) / assessed.length) : null;
  const counts = { high: 0, moderate: 0, low: 0 } as Record<string, number>;
  for (const s of assessed) counts[s.assessment.grade]++;
  const list = [...sources].sort((a, b) => (sort === "score" ? (b.assessment?.score ?? -1) - (a.assessment?.score ?? -1) : a.ref_number - b.ref_number));
  const assess = async () => {
    setBusy(true);
    try { await api.post(`/research/${researchId}/assess`); invalidate(`/research/${researchId}`); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {avg !== null && <div className="flex items-center gap-3"><ScoreRing score={avg} grade={avg >= 75 ? "high" : avg >= 55 ? "moderate" : "low"} size={52} /><div><div className="text-[0.95rem] text-white">{tx("Average credibility")}</div><div className="text-[0.76rem] text-mute">{assessed.length} {tx("of")} {sources.length} {tx("sources assessed")}</div></div></div>}
        <div className="flex gap-3 text-[0.78rem] text-mute">
          {Object.entries(counts).map(([g, n]) => <span key={g} className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full" style={{ background: GRADE_STYLE[g].color }} />{n} {g}</span>)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select aria-label={tx("Sort sources")} value={sort} onChange={(e) => setSort(e.target.value as any)} className="input h-8 w-auto py-0 text-[0.8rem]">
            <option value="ref">{tx("By number")}</option><option value="score">{tx("Most credible first")}</option>
          </select>
          {canAssess && <Button size="sm" icon={<RefreshCw size={12} />} loading={busy} onClick={assess}>{assessed.length ? tx("Re-assess") : tx("Assess sources")}</Button>}
        </div>
      </div>
      <p className="mt-3 max-w-[70ch] text-[0.78rem] leading-relaxed text-mute">
        {assessed.some((s) => s.assessment.ai) ? tx("Scores weigh authority (30%), methodology (25%), recency, independence and corroboration (15% each), using the source's address, dates and retrieved text, read by the AI for study design and conflicts of interest.") : tx("Scores weigh authority (30%), methodology (25%), recency, independence and corroboration (15% each), using the source's address, dates and retrieved text.")} {tx("They're a guide to what to check, not a verdict on a publisher.")}
      </p>
      <ol className="mt-5 space-y-3">
        {list.map((s) => <SourceCard key={s.ref_number} s={s} />)}
      </ol>
    </section>
  );
}

function SourceCard({ s }: { s: any }) {
  const [open, setOpen] = useState(false);
  const a = s.assessment;
  let host = "";
  try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  return (
    <li id={`source-${s.ref_number}`} className="rounded-xl border border-line p-4">
      <div className="flex gap-4">
        {a ? <ScoreRing score={a.score} grade={a.grade} /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed border-white/20 font-mono text-[0.72rem] text-mute">{s.ref_number}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <span className="font-mono text-[0.72rem] text-mute">[{s.ref_number}]</span>
            <a href={s.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-w-0 items-center gap-1.5 text-[0.9rem] text-white hover:underline decoration-white/30 underline-offset-2"><span className="truncate">{s.title}</span><ExternalLink size={11} className="shrink-0 text-mute" /></a>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.72rem] text-mute">
            {a && <span style={{ color: GRADE_STYLE[a.grade].color }}>{tx(GRADE_STYLE[a.grade].label)}</span>}
            <Badge>{s.source_type}</Badge><span>{host}</span>{s.published && <span>· {s.published}</span>}
            {s.position && <Badge tone="info">{tx("for:")} {s.position}</Badge>}
            {a?.ai && <span className="flex items-center gap-1"><ShieldCheck size={11} /> {tx("text reviewed by AI")}</span>}
          </div>
        </div>
      </div>
      {a && (
        <div className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {FACTORS.map((f) => {
            const v = a.factors[f.key];
            return (
              <div key={f.key} title={f.hint}>
                <div className="flex items-baseline justify-between text-[0.74rem]"><span className="text-white/80">{tx(f.label)}</span><span className="tabular-nums text-mute">{v.score}</span></div>
                <div className="mt-1 h-1 rounded-full bg-white/[0.07]"><div className="h-1 rounded-full" style={{ width: `${v.score}%`, background: v.score >= 75 ? "#2cff7a" : v.score >= 55 ? "#ffd23a" : "#ff5a1f", opacity: 0.85 }} /></div>
                <div className="mt-1 text-[0.74rem] leading-snug text-mute">{v.note}</div>
              </div>
            );
          })}
        </div>
      )}
      <button onClick={() => setOpen(!open)} className={cx("mt-3 text-[0.74rem] text-mute hover:text-white")}>{open ? tx("Hide retrieved text") : tx("Show retrieved text")}</button>
      {open && <p className="mt-1.5 whitespace-pre-wrap text-[0.8rem] leading-relaxed text-mute-bright">{s.excerpt}</p>}
    </li>
  );
}
