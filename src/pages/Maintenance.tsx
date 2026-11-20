import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Archive, Check, Clock, Copy, GitMerge, Link2, Link2Off, RefreshCw, ScanSearch, Sparkles, Undo2, Unplug, X } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useCan } from "@/state/app";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Empty, PageHeader, Pulse, Textarea, cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { ScoreRing } from "./research/SourceIntel";
import { tn, tx } from "@/i18n";

const KIND: Record<string, { label: string; icon: any; color: string; blurb: string }> = {
  conflicting_memories: { label: "Conflicts", icon: Unplug, color: "#ff5a1f", blurb: "Memories that can't both be true" },
  duplicate_notes: { label: "Duplicate notes", icon: Copy, color: "#ffd23a", blurb: "Notes that say the same thing" },
  duplicate_memories: { label: "Duplicate memories", icon: Copy, color: "#ffd23a", blurb: "Memories that repeat each other" },
  outdated: { label: "Outdated", icon: Clock, color: "#b02bff", blurb: "Time has passed what they describe" },
  disconnected: { label: "Disconnected", icon: Link2Off, color: "#1fd0ff", blurb: "Knowledge linked to nothing" },
  broken_link: { label: "Broken links", icon: Link2, color: "#2f7dff", blurb: "[[Links]] to notes that don't exist" },
};

/**
 * Knowledge health: what automatic maintenance found, with a suggested fix for each. Nothing
 * changes until someone chooses; every change can be undone for 30 days.
 */
export function MaintenancePage() {
  const { data, loading } = useResource<any>("/maintenance");
  const [filter, setFilter] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const can = useCan();
  const reload = () => invalidate("/maintenance", "/growth", "/memories", "/documents", "/graph", "/nudges");
  const scan = async () => {
    setScanning(true);
    try { const r = await api.post("/maintenance/scan"); reload(); toast(r.added ? tn(r.added, "{n} new suggestion", "{n} new suggestions") : tx("No new issues found")); } catch (e) { toastError(e); } finally { setScanning(false); }
  };
  if (loading && !data) return <div className="p-10 text-center"><Pulse /></div>;
  if (!data) return null;
  const h = data.health;
  const list = data.suggestions.filter((s: any) => (filter ? s.kind === filter : true) && s.status === "open");
  const snoozed = data.suggestions.filter((s: any) => s.status === "snoozed");
  return (
    <div className="h-full overflow-y-auto pb-20">
      <PageHeader title={tx("Knowledge health")} subtitle={tx("Orbital looks for duplicates, conflicts, outdated information and disconnected ideas. It suggests; you decide. Every change can be undone.")}
        actions={can.write ? <Button icon={<ScanSearch size={14} />} loading={scanning} onClick={scan}>{tx("Check now")}</Button> : undefined} />
      <div className="mx-auto max-w-[900px] px-8">
        <section className="flex flex-wrap items-center gap-x-8 gap-y-4 glow-card rounded-2xl border border-line px-6 py-5">
          <div className="flex items-center gap-4">
            <ScoreRing score={h.score} grade={h.score >= 85 ? "high" : h.score >= 60 ? "moderate" : "low"} size={64} />
            <div><div className="text-[1.05rem] text-white">{h.score >= 85 ? tx("In good shape") : h.score >= 60 ? tx("A little tidying to do") : tx("Needs attention")}</div>
              <div className="text-[0.76rem] text-mute">{tn(h.open, "{n} open suggestion", "{n} open suggestions")} · {h.lastScan ? tx("checked {v0}", { v0: timeAgo(h.lastScan) }) : tx("not checked yet")}{h.lastStats?.ai ? tx(" · with AI review") : ""}</div></div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFilter(null)} className={cx("h-7 rounded-full border px-3 text-[0.76rem]", !filter ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>{tx("All")} {h.open}</button>
            {Object.entries(KIND).map(([k, v]) => h.byKind[k] ? (
              <button key={k} onClick={() => setFilter(filter === k ? null : k)} className={cx("inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[0.76rem]", filter === k ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: v.color }} />{tx(v.label)} {h.byKind[k]}</button>
            ) : null)}
          </div>
        </section>

        <div className="mt-6 space-y-3">
          {list.length === 0 && (
            <Empty title={h.lastScan ? tx("Nothing to tidy") : tx("Not checked yet")} action={!h.lastScan && can.write ? <Button variant="primary" loading={scanning} onClick={scan}>{tx("Check my knowledge")}</Button> : undefined}>
              {h.lastScan ? tx("No duplicates, conflicts, outdated memories or loose ends right now. Orbital checks again every day.") : tx("Orbital checks every day on its own. You can also run a check now.")}
            </Empty>
          )}
          {list.map((s: any) => <SuggestionCard key={s.id} s={s} canWrite={can.write} onDone={reload} />)}
        </div>

        {snoozed.length > 0 && <p className="mt-6 text-[0.78rem] text-mute">{tn(snoozed.length, "{n} snoozed suggestion will come back later.", "{n} snoozed suggestions will come back later.")}</p>}

        {data.recent.length > 0 && (
          <section className="mt-12">
            <h2 className="label mb-3">{tx("Recently handled")}</h2>
            <ul className="divide-y divide-line">
              {data.recent.map((r: any) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-[0.84rem]">
                  {r.status === "applied" ? <Check size={14} className="shrink-0 text-emerald-300/70" /> : <X size={14} className="shrink-0 text-mute" />}
                  <span className="min-w-0 flex-1"><span className="text-white/85">{r.title}</span> <span className="text-mute">· {r.resolution}</span></span>
                  <span className="shrink-0 text-[0.72rem] text-mute">{timeAgo(r.resolved_at)}</span>
                  {r.status === "applied" && r.undoable && can.write && (
                    <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} onClick={async () => { try { await api.post(`/maintenance/${r.id}/undo`); reload(); toast(tx("Undone")); } catch (e) { toastError(e); } }}>{tx("Undo")}</Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({ s, canWrite, onDone }: { s: any; canWrite: boolean; onDone: () => void }) {
  const k = KIND[s.kind];
  const navigate = useNavigate();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { const r = await api.post(`/maintenance/${s.id}/apply`, body); onDone(); toast(r.resolution, { action: { label: "Undo", to: "/maintenance" } }); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const dismiss = async (snoozeDays?: number) => { try { await api.post(`/maintenance/${s.id}/dismiss`, { snoozeDays: snoozeDays ?? null }); onDone(); } catch (e) { toastError(e); } };
  const [a, b] = s.items;
  const pair = s.kind === "duplicate_notes" || s.kind === "duplicate_memories" || s.kind === "conflicting_memories";
  const keep = s.proposal?.keep;
  const itemLink = (it: any) => it.type === "document" ? `/knowledge/${it.id}` : it.type === "research" ? `/research/${it.id}` : it.type === "node" ? `/connections?node=${it.id}` : "/knowledge?tab=memory";

  return (
    <article className="glow-card rounded-xl border border-line px-5 py-4" style={{ borderLeftColor: k.color, borderLeftWidth: 2 }}>
      <div className="flex items-start gap-3">
        <k.icon size={15} className="mt-0.5 shrink-0" style={{ color: k.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2"><h3 className="text-[0.95rem] text-white">{s.title}</h3>{s.ai && <Badge tone="ai"><Sparkles size={10} className="mr-1 inline" />{tx("AI review")}</Badge>}</div>
          <p className="mt-0.5 text-[0.82rem] text-mute-bright">{s.reason}</p>
        </div>
      </div>

      {pair && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[a, b].map((it: any, i: number) => {
            const side = i === 0 ? "a" : "b";
            return (
              <div key={it.id} className={cx("rounded-lg border px-3 py-2.5", keep === side ? "border-white/35 bg-white/[0.03]" : "border-line")}>
                <div className="mb-1 flex items-center gap-2 text-[0.7rem] text-mute">
                  {keep === side && <span className="text-white/80">{s.kind === "conflicting_memories" ? tx("Likely current") : tx("Suggested to keep")}</span>}
                  <span>{it.meta?.updated_at ? tx("updated {v0}", { v0: timeAgo(it.meta.updated_at) }) : ""}</span>
                  <Link to={itemLink(it)} className="ml-auto hover:text-white">{tx("open →")}</Link>
                </div>
                {it.title && <div className="text-[0.84rem] text-white/90">{it.title}</div>}
                <p className="line-clamp-4 whitespace-pre-wrap text-[0.82rem] leading-relaxed text-white/80">{it.text}</p>
              </div>
            );
          })}
        </div>
      )}
      {!pair && a && s.kind !== "broken_link" && (
        <div className="mt-3 rounded-lg border border-line px-3 py-2.5 text-[0.84rem] leading-relaxed text-white/85">
          {a.title && <div className="text-white/90">{a.title}</div>}{a.type !== "node" || !a.title ? a.text : a.text && <p className="text-[0.8rem] text-mute">{a.text}</p>}
          <Link to={itemLink(a)} className="ml-2 text-[0.72rem] text-mute hover:text-white">{tx("open →")}</Link>
        </div>
      )}

      {editing !== null && (
        <div className="mt-3">
          <Textarea rows={2} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label={tx("Corrected memory")} />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" loading={busy} disabled={editing.trim().length < 3} onClick={() => act(s.kind === "outdated" ? { action: "update", content: editing } : { action: "resolve", keep: keep ?? "a", content: editing })}>{tx("Save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{tx("Cancel")}</Button>
          </div>
        </div>
      )}

      {canWrite && editing === null && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(s.kind === "duplicate_notes" || s.kind === "duplicate_memories") && (
            <>
              <Button size="sm" variant={keep === "a" ? "primary" : "secondary"} icon={<GitMerge size={12} />} loading={busy} onClick={() => act({ action: "merge", keep: "a" })}>{tx("Keep the first")}</Button>
              <Button size="sm" variant={keep === "b" ? "primary" : "secondary"} icon={<GitMerge size={12} />} loading={busy} onClick={() => act({ action: "merge", keep: "b" })}>{tx("Keep the second")}</Button>
              <Button size="sm" variant="ghost" onClick={() => act({ action: "merge", keep: "both" })}>{tx("They're different")}</Button>
            </>
          )}
          {s.kind === "conflicting_memories" && (
            <>
              <Button size="sm" variant={keep === "a" ? "primary" : "secondary"} loading={busy} onClick={() => act({ action: "resolve", keep: "a" })}>{tx("First is true")}</Button>
              <Button size="sm" variant={keep === "b" ? "primary" : "secondary"} loading={busy} onClick={() => act({ action: "resolve", keep: "b" })}>{tx("Second is true")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing((keep === "b" ? b : a).text)}>{tx("Correct it")}</Button>
              <Button size="sm" variant="ghost" onClick={() => act({ action: "resolve", keep: "both" })}>{tx("Both are true")}</Button>
            </>
          )}
          {s.kind === "outdated" && a?.type === "memory" && (
            <>
              <Button size="sm" variant="primary" icon={<Check size={12} />} loading={busy} onClick={() => act({ action: "reviewed" })}>{tx("Still true")}</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(a.text)}>{tx("Update it")}</Button>
              <Button size="sm" variant="ghost" icon={<Archive size={12} />} onClick={() => act({ action: "archive" })}>{tx("Archive")}</Button>
            </>
          )}
          {s.kind === "outdated" && a?.type === "research" && (
            <Button size="sm" variant="primary" icon={<RefreshCw size={12} />} onClick={async () => { await act({ action: "refresh" }); navigate(`/research/${a.id}`); }}>{tx("Review and refresh")}</Button>
          )}
          {s.kind === "disconnected" && (
            <>
              {(s.proposal.options ?? []).map((o: any) => (
                <Button key={o.id} size="sm" variant="secondary" icon={<Link2 size={12} />} loading={busy} onClick={() => act({ action: "connect", targetId: o.id })}>{tx("Connect to “")}{o.title.slice(0, 40)}”</Button>
              ))}
              {!a?.meta?.ref_type && <Button size="sm" variant="ghost" onClick={() => act({ action: "archive" })}>{tx("Remove from graph")}</Button>}
            </>
          )}
          {s.kind === "broken_link" && (
            <>
              <Button size="sm" variant="primary" loading={busy} onClick={() => act({ action: "create_note" })}>{tx("Create “")}{s.proposal.title}”</Button>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/knowledge/${a.id}`)}>{tx("Fix the link")}</Button>
            </>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => dismiss(30)}>{tx("Snooze")}</Button>
          <Button size="sm" variant="ghost" icon={<X size={12} />} title={tx("Don't raise this again")} onClick={() => dismiss()}>{tx("Dismiss")}</Button>
        </div>
      )}
    </article>
  );
}
