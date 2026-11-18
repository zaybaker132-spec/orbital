import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Scale } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, cx } from "@/components/ui";

const CAUSE: Record<string, string> = {
  definitions: "Different definitions", methodology: "Different methods", data: "Different data", timeframe: "Different time periods", scope: "Different scope or population",
  incentives: "Incentives / funding", values: "Different values", interpretation: "Different readings of the evidence", uncertainty: "Genuine uncertainty",
};
/** One colour per position, consistent across the lab view. */
export const POSITION_COLORS = ["#1fd0ff", "#ff2bd6", "#ffd23a", "#2cff7a"];

export function ContradictionLab({ lab, cite }: { lab: any; cite: (refs: number[]) => React.ReactNode }) {
  const color = (label: string) => POSITION_COLORS[Math.max(0, lab.positions.findIndex((p: any) => p.label === label)) % POSITION_COLORS.length];
  return (
    <div className="space-y-10">
      <section>
        <h2 className="label mb-3">Positions</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {lab.positions.map((p: any, i: number) => (
            <div key={i} className="rounded-xl border border-line p-4" style={{ borderTopColor: POSITION_COLORS[i % 4], borderTopWidth: 2 }}>
              <div className="text-[0.92rem] text-white">{p.label}</div>
              <p className="mt-1.5 text-[0.84rem] leading-relaxed text-mute-bright">{p.summary}{cite(p.source_refs)}</p>
              {!p.source_refs.length && <p className="mt-2 text-[0.72rem] text-amber-200/80">No retrieved source makes this case directly.</p>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="label mb-3">Where and why they disagree</h2>
        <ol className="space-y-4">
          {lab.disagreements.map((d: any, i: number) => (
            <li key={i} className="rounded-xl border border-line">
              <div className="border-b border-line px-5 py-3 text-[0.95rem] text-white">{d.topic}</div>
              <div className="grid gap-px bg-[rgba(255,255,255,0.06)] sm:grid-cols-2">
                {d.claims.map((c: any, j: number) => (
                  <div key={j} className="bg-black px-5 py-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[0.72rem]" style={{ color: color(c.position) }}><i className="h-1.5 w-1.5 rounded-full" style={{ background: color(c.position) }} />{c.position}</div>
                    <p className="text-[0.86rem] leading-relaxed text-white/85">{c.claim}{cite(c.source_refs)}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2 px-5 py-4">
                <div className="flex flex-wrap gap-1.5">{d.causes.map((c: string) => <Badge key={c}>{CAUSE[c] ?? c}</Badge>)}</div>
                <p className="text-[0.86rem] leading-relaxed text-white/85"><span className="text-mute">Why · </span>{d.explanation}</p>
                <p className="text-[0.84rem] leading-relaxed text-mute-bright"><span className="text-mute">What would settle it · </span>{d.resolution}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {lab.common_ground.length > 0 && (
        <section>
          <h2 className="label mb-3">Common ground</h2>
          <ul className="space-y-2 text-[0.9rem] text-white/85">{lab.common_ground.map((c: any, i: number) => <li key={i}>• {c.point}{cite(c.source_refs)}</li>)}</ul>
        </section>
      )}

      <section className="rounded-xl border border-white/20 bg-white/[0.03] px-5 py-4">
        <div className="label mb-2 flex items-center gap-1.5"><Scale size={12} /> Weight of evidence</div>
        <p className="text-[0.95rem] text-white">{lab.weight_of_evidence.leaning}</p>
        <p className="mt-1 text-[0.84rem] leading-relaxed text-mute-bright">{lab.weight_of_evidence.reasoning}</p>
        <p className="mt-2 text-[0.74rem] text-mute">Confidence: {lab.weight_of_evidence.confidence}. Based only on the sources retrieved here.</p>
      </section>
    </div>
  );
}

/** Living report: which facts may be out of date, with a one-click refresh. */
export function FreshnessBanner({ r, ai }: { r: any; ai: boolean }) {
  const f = r.freshness;
  const [sel, setSel] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  if (r.status === "refreshing") return (
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-sky-300/25 bg-sky-300/[0.04] px-4 py-3 text-[0.86rem] text-sky-100/90"><RefreshCw size={15} className="animate-spin" />Refreshing sections with new sources…</div>
  );
  if (!f || f.status === "fresh") return r.refreshed_at || f ? (
    <p className="mt-6 flex items-center gap-2 text-[0.76rem] text-mute"><CheckCircle2 size={13} className="text-emerald-300/70" />Every fact is within its shelf life{r.refreshed_at ? ` · refreshed ${new Date(r.refreshed_at).toLocaleDateString()}` : ""}.</p>
  ) : null;
  const keyOf = (i: any) => `${i.section}:${i.index}`;
  const chosen: string[] = sel ?? f.items.filter((i: any) => i.state === "stale").map(keyOf);
  const refresh = async () => {
    setBusy(true);
    try {
      await api.post(`/research/${r.id}/refresh`, { items: f.items.filter((i: any) => chosen.includes(keyOf(i))).slice(0, 8).map((i: any) => ({ section: i.section, index: i.index })) });
      invalidate(`/research/${r.id}`, "/research");
      toast("Refreshing: Orbital is checking those facts against new sources");
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className={cx("mt-6 rounded-xl border px-4 py-3", f.status === "stale" ? "border-amber-300/30 bg-amber-300/[0.04]" : "border-line")}>
      <div className="flex flex-wrap items-center gap-3">
        {f.status === "stale" ? <AlertTriangle size={15} className="text-amber-200" /> : <Clock size={15} className="text-mute" />}
        <span className="text-[0.88rem] text-white/90">{f.stale ? `${f.stale} fact${f.stale === 1 ? " is" : "s are"} past ${f.stale === 1 ? "its" : "their"} shelf life` : ""}{f.stale && f.aging ? " · " : ""}{f.aging ? `${f.aging} getting old` : ""}</span>
        <Button size="sm" className="ml-auto" icon={<RefreshCw size={12} />} loading={busy} disabled={!ai || !chosen.length} title={ai ? "" : "Refreshing needs an AI provider"} onClick={refresh}>Refresh {chosen.length || ""} selected</Button>
      </div>
      <ul className="mt-3 space-y-1.5">
        {f.items.map((i: any) => (
          <li key={keyOf(i)}>
            <label className="flex cursor-pointer items-start gap-2.5 text-[0.8rem]">
              <input type="checkbox" className="mt-0.5 accent-white" checked={chosen.includes(keyOf(i))} onChange={(e) => setSel(e.target.checked ? [...chosen, keyOf(i)] : chosen.filter((k) => k !== keyOf(i)))} />
              <span className="min-w-0 flex-1 text-white/80"><span className="line-clamp-1">{i.label}</span>
                <span className="text-[0.72rem] text-mute">{i.section} · {i.sensitivity === "fast" ? "changes in weeks" : i.sensitivity === "moderate" ? "changes in months" : "changes over years"} · evidence as of {i.as_of} ({i.age_days} days)</span></span>
              <span className={cx("shrink-0 text-[0.7rem]", i.state === "stale" ? "text-amber-200" : "text-mute")}>{i.state}</span>
            </label>
          </li>
        ))}
      </ul>
      {!ai && <p className="mt-2 text-[0.74rem] text-mute">Connect an AI provider to refresh sections automatically.</p>}
    </div>
  );
}

/** A finding's freshness chip and refresh history. */
export function FindingFreshness({ f, item }: { f: any; item?: any }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle">
      {item && <span className={cx("rounded px-1.5 py-px text-[0.66rem]", item.state === "stale" ? "bg-amber-300/15 text-amber-200" : "bg-white/[0.06] text-mute")}>{item.state === "stale" ? "may be outdated" : "aging"}</span>}
      {f.history?.length > 0 && (
        <button onClick={() => setOpen(!open)} className="rounded bg-sky-300/10 px-1.5 py-px text-[0.66rem] text-sky-200/90 hover:bg-sky-300/20">refreshed {new Date(f.refreshed_at).toLocaleDateString()}</button>
      )}
      {open && (
        <span className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-[0.76rem] text-mute">
          {f.history.map((h: any, i: number) => <span key={i} className="block">{new Date(h.at).toLocaleDateString()} · <b className="font-normal text-white/70">{h.status}</b>: previously “{h.statement ?? h.value}”. {h.note}</span>)}
        </span>
      )}
    </span>
  );
}
