import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, CheckCircle2, Layers, Lightbulb, Network, Quote, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { toastError } from "@/state/ui";
import { Badge, Button, Empty, Input, Pulse, cx } from "@/components/ui";

type Kind = "concept" | "evidence" | "event" | "relation";
const TABS: { kind: Kind; label: string; icon: any }[] = [
  { kind: "concept", label: "Concepts", icon: Lightbulb },
  { kind: "evidence", label: "Evidence", icon: Quote },
  { kind: "event", label: "Timeline", icon: CalendarDays },
  { kind: "relation", label: "Relationships", icon: Network },
];

/**
 * Knowledge extracted from one document: concepts, evidence (each with its exact quote), a timeline
 * and relationships. Everything here is searchable from universal search and the concepts join the graph.
 */
export function ExtractionView({ docId, focusItem, canWrite }: { docId: string; focusItem?: string | null; canWrite: boolean }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data: ex, loading } = useResource<any>(`/documents/${docId}/extraction${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  const [tab, setTab] = useState<Kind>("concept");
  const [busy, setBusy] = useState(false);
  const focused = useRef<HTMLLIElement>(null);

  const items: any[] = ex?.items ?? [];
  const of = (k: Kind) => items.filter((i) => i.kind === k);
  // Opening a search result: show its tab and scroll to it.
  useEffect(() => {
    const it = focusItem && items.find((i) => i.id === focusItem);
    if (it) { setTab(it.kind); setTimeout(() => focused.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 80); }
  }, [focusItem, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ex?.status === "running" || ex?.status === "queued") { const t = setInterval(() => invalidate(`/documents/${docId}/extraction`), 3000); return () => clearInterval(t); } }, [ex?.status, docId]);

  const start = async () => {
    setBusy(true);
    try { await api.post(`/documents/${docId}/extract`); invalidate(`/documents/${docId}/extraction`); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const timeline = useMemo(() => {
    const ev = of("event");
    const dated = ev.filter((e) => e.sort_date).sort((a, b) => a.sort_date.localeCompare(b.sort_date));
    return { dated, undated: ev.filter((e) => !e.sort_date) };
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !ex) return <div className="py-10 text-center"><Pulse /></div>;
  if (!ex && !query) {
    return (
      <Empty title="Extract knowledge from this document" action={canWrite ? <Button variant="primary" icon={<Layers size={14} />} loading={busy} onClick={start}>Extract knowledge</Button> : undefined}>
        Orbital reads the whole document, however long, and pulls out its key concepts, evidence with exact quotes, a timeline of dated events and the relationships between ideas. Concepts join your knowledge graph and everything becomes searchable.
      </Empty>
    );
  }
  if (ex && (ex.status === "queued" || ex.status === "running")) {
    const pct = ex.parts_total ? Math.round((ex.parts_done / ex.parts_total) * 100) : 0;
    return (
      <div className="py-12 text-center">
        <Pulse label="Extracting" />
        <p className="mt-4 text-[0.92rem] text-white/90">Reading part {Math.min(ex.parts_done + 1, ex.parts_total || 1)} of {ex.parts_total || "…"}</p>
        <div className="mx-auto mt-3 h-1 w-64 rounded-full bg-white/10"><div className="h-1 rounded-full bg-white/70 transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="mt-3 text-[0.76rem] text-mute">Long documents take a few minutes. You can leave this page; Orbital lets you know when it's done.</p>
      </div>
    );
  }
  if (ex?.status === "failed") return <Empty title="Extraction failed" action={canWrite ? <Button onClick={start} loading={busy}>Try again</Button> : undefined}>{ex.error}</Empty>;

  const s = ex?.stats ?? {};
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 text-[0.76rem] text-mute">
        <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-300/70" />{ex.mode === "ai" ? "Extracted by AI, every quote checked against the text" : "Basic extraction (no AI provider): dates, figures and frequent terms"}</span>
        {s.parts && <span>· {s.parts} part{s.parts === 1 ? "" : "s"} read</span>}
        {s.dropped_unverified > 0 && <span>· {s.dropped_unverified} item{s.dropped_unverified === 1 ? "" : "s"} dropped because the quote wasn't in the text</span>}
        {s.truncated && <span className="text-amber-200/80">· only the first part of a very long document was read</span>}
        {canWrite && <Button size="sm" variant="ghost" className="ml-auto" icon={<RefreshCw size={12} />} loading={busy} onClick={start}>Re-extract</Button>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.kind} role="tab" aria-selected={tab === t.kind} onClick={() => setTab(t.kind)}
              className={cx("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] transition-colors", tab === t.kind ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>
              <t.icon size={13} />{t.label}<span className="opacity-60">{of(t.kind).length}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-56">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="h-8 pl-8 text-[0.82rem]" aria-label="Filter extracted knowledge" />
        </div>
      </div>
      {s.graph_concepts > 0 && tab === "concept" && <p className="mt-3 text-[0.76rem] text-mute">{s.graph_concepts} concepts joined your knowledge graph{s.graph_links ? `, with ${s.graph_links} suggested connection${s.graph_links === 1 ? "" : "s"} between them` : ""}. <Link to="/connections" className="text-white/80 underline decoration-white/20">Open Connections →</Link></p>}

      <div className="mt-5">
        {of(tab).length === 0 && <p className="py-6 text-center text-[0.86rem] text-mute">{query ? "Nothing matches the filter." : tab === "relation" && ex.mode === "basic" ? "Relationships need an AI provider." : "Nothing of this kind was found."}</p>}
        {tab === "concept" && (
          <ul className="grid gap-2 sm:grid-cols-2">{of("concept").map((c) => (
            <li key={c.id} ref={c.id === focusItem ? focused : undefined} className={cx("rounded-xl border px-4 py-3", c.id === focusItem ? "border-white/50" : "border-line")}>
              <div className="flex items-baseline gap-2"><span className="text-[0.92rem] text-white">{c.title}</span>{c.mentions > 1 && <span className="text-[0.7rem] text-mute">×{c.mentions}</span>}
                {c.node_id && <Link to={`/connections?node=${c.node_id}`} className="ml-auto text-[0.7rem] text-mute hover:text-white">in graph →</Link>}</div>
              {c.detail && <p className="mt-1 text-[0.82rem] leading-relaxed text-mute-bright">{c.detail}</p>}
            </li>
          ))}</ul>
        )}
        {tab === "evidence" && (
          <ul className="space-y-2">{of("evidence").map((e) => (
            <li key={e.id} ref={e.id === focusItem ? focused : undefined} className={cx("rounded-xl border px-4 py-3", e.id === focusItem ? "border-white/50" : "border-line")}>
              <div className="flex items-start gap-2"><Badge>{e.subtype || "evidence"}</Badge><p className="flex-1 text-[0.88rem] leading-relaxed text-white/90">{e.title}</p>{e.part > 0 && <span className="shrink-0 text-[0.7rem] text-mute">part {e.part}</span>}</div>
              {e.quote && e.quote !== e.title && <blockquote className="mt-2 border-l border-emerald-300/30 pl-3 text-[0.8rem] italic leading-relaxed text-mute-bright">“{e.quote}”</blockquote>}
            </li>
          ))}</ul>
        )}
        {tab === "event" && (
          <ol className="relative ml-2 space-y-4 border-l border-white/15 pl-6">
            {[...timeline.dated, ...timeline.undated].map((e) => (
              <li key={e.id} ref={e.id === focusItem ? focused : undefined} className="relative">
                <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-black bg-white/80" />
                <div className="font-mono text-[0.74rem] text-sky-200/90">{e.date_text || "undated"}</div>
                <p className={cx("mt-0.5 text-[0.88rem] leading-relaxed", e.id === focusItem ? "text-white" : "text-white/85")}>{e.title}</p>
                {e.quote && e.quote !== e.title && <p className="mt-1 text-[0.76rem] italic text-mute">“{e.quote.slice(0, 280)}{e.quote.length > 280 ? "…" : ""}”</p>}
              </li>
            ))}
          </ol>
        )}
        {tab === "relation" && (
          <ul className="space-y-2">{of("relation").map((r) => (
            <li key={r.id} ref={r.id === focusItem ? focused : undefined} className={cx("rounded-xl border px-4 py-3", r.id === focusItem ? "border-white/50" : "border-line")}>
              <div className="flex flex-wrap items-center gap-2 text-[0.88rem]">
                <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-white">{r.data?.subject}</span>
                <span className="flex items-center gap-1 text-mute"><ArrowRight size={12} />{r.subtype}<ArrowRight size={12} /></span>
                <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-white">{r.data?.object}</span>
              </div>
              <blockquote className="mt-2 border-l border-white/15 pl-3 text-[0.78rem] italic text-mute">“{r.quote}”</blockquote>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
