import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from "d3-force";
import { Search, Plus, List, Network as NetIcon, Trash2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { usePanel, toast, toastError } from "@/state/ui";
import { Button, Dialog, Empty, IconButton, Input, Pulse, Select, Textarea, cx } from "@/components/ui";
import { Section } from "@/components/RightPanel";
import { label, pct } from "@/lib/format";
import { useCan, useMotionPrefs } from "@/state/app";
import { tn, tx } from "@/i18n";

const KIND_COLOR: Record<string, string> = {
  concept: "#e5e7eb", note: "#7dd3fc", document: "#38bdf8", memory: "#c4b5fd", finding: "#fcd34d", research: "#fbbf24", project: "#86efac", opportunity: "#fb923c",
};
const KINDS = Object.keys(KIND_COLOR);
const RELATIONS = ["related_to", "supports", "contradicts", "derived_from", "explains", "expands_upon", "similar_to", "depends_on"];

interface N { id: string; kind: string; title: string; summary: string; category: string; ref_type: string | null; ref_id: string | null; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; degree: number }
interface E { id: string; source: any; target: any; source_id: string; target_id: string; relation: string; status: string; confidence: number }

export function ConnectionsPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("node");
  const [kinds, setKinds] = useState<string[]>([]);
  const [showSuggested, setShowSuggested] = useState(true);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"graph" | "list">("graph");
  const [adding, setAdding] = useState(false);
  const can = useCan();
  const { data, loading } = useResource<any>("/graph");
  const setContent = usePanel((s) => s.setContent);

  const select = useCallback((id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("node", id); else next.delete("node");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    setContent(selected ? "Inspector" : "Connections", selected ? <Inspector id={selected} onSelect={select} /> : <GraphHelp />);
  }, [selected, setContent, select]);
  useEffect(() => () => setContent("", null), [setContent]);

  const graph = useMemo(() => {
    if (!data) return null;
    const nodes: N[] = data.nodes.filter((n: any) => !kinds.length || kinds.includes(n.kind)).map((n: any) => ({ ...n, degree: 0 }));
    const ids = new Set(nodes.map((n) => n.id));
    const edges: E[] = data.edges.filter((e: any) => ids.has(e.source_id) && ids.has(e.target_id) && (showSuggested || e.status === "confirmed"))
      .map((e: any) => ({ ...e, source: e.source_id, target: e.target_id }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const e of edges) { byId.get(e.source_id)!.degree++; byId.get(e.target_id)!.degree++; }
    return { nodes, edges };
  }, [data, kinds, showSuggested]);

  const matches = useMemo(() => {
    if (!q.trim() || !graph) return new Set<string>();
    const s = q.toLowerCase();
    return new Set(graph.nodes.filter((n) => n.title.toLowerCase().includes(s) || n.summary.toLowerCase().includes(s)).map((n) => n.id));
  }, [q, graph]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <h1 className="mr-3 text-[1.05rem] font-normal">{tx("Connections")}</h1>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search nodes")} aria-label={tx("Search nodes")} className="h-8 pl-9 text-[0.84rem]"
            onKeyDown={(e) => { if (e.key === "Enter" && matches.size) select([...matches][0]); }} />
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={tx("Filter by kind")}>
          {KINDS.map((k) => (
            <button key={k} aria-pressed={kinds.includes(k)} onClick={() => setKinds((ks) => ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k])}
              className={cx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.74rem] transition-colors", kinds.includes(k) ? "bg-white/[0.1] text-white" : "text-mute hover:text-white")}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}
            </button>
          ))}
        </div>
        <label className="ml-2 flex cursor-pointer items-center gap-2 text-[0.78rem] text-mute">
          <input type="checkbox" checked={showSuggested} onChange={(e) => setShowSuggested(e.target.checked)} className="accent-white" /> {tx("Show suggested")}
        </label>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={tx("Graph view")} active={view === "graph"} onClick={() => setView("graph")}><NetIcon size={15} /></IconButton>
          <IconButton label={tx("List view")} active={view === "list"} onClick={() => setView("list")}><List size={15} /></IconButton>
          {can.write && <Button size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>{tx("Concept")}</Button>}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 border-t border-line">
        {loading && <div className="py-16 text-center"><Pulse /></div>}
        {graph && graph.nodes.length === 0 && (
          <Empty title={tx("No knowledge to connect yet")} action={<Link to="/knowledge"><Button variant="primary">{tx("Add a note")}</Button></Link>}>
            {tx("Notes, memories, research findings and projects appear here as nodes. Orbital suggests relationships; you confirm them.")}
          </Empty>
        )}
        {graph && graph.nodes.length > 0 && (view === "graph"
          ? <GraphCanvas graph={graph} selected={selected} matches={matches} onSelect={select} />
          : <GraphList graph={graph} onSelect={select} selected={selected} q={q} />)}
      </div>
      <AddConcept open={adding} onClose={() => setAdding(false)} onCreated={select} />
    </div>
  );
}

function GraphCanvas({ graph, selected, matches, onSelect }: { graph: { nodes: N[]; edges: E[] }; selected: string | null; matches: Set<string>; onSelect: (id: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<N, E> | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<N | null>(null);
  const drag = useRef<{ node: N | null; panning: boolean; sx: number; sy: number; moved: boolean }>({ node: null, panning: false, sx: 0, sy: 0, moved: false });
  const { reducedMotion } = useMotionPrefs();
  const state = useRef({ selected, matches });
  state.current = { selected, matches };
  const [tip, setTip] = useState<{ x: number; y: number; n: N } | null>(null);

  // Preserve positions across re-renders of the same nodes.
  const positions = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    const nodes = graph.nodes.map((n) => ({ ...n, ...(positions.current.get(n.id) ?? {}) }));
    const edges = graph.edges.map((e) => ({ ...e }));
    const sim = forceSimulation<N>(nodes)
      .force("link", forceLink<N, E>(edges).id((d) => d.id).distance((e) => (e.status === "confirmed" ? 55 : 80)).strength((e) => (e.status === "confirmed" ? 0.5 : 0.15)))
      .force("charge", forceManyBody<N>().strength(-90).distanceMax(380))
      .force("collide", forceCollide<N>().radius((d) => 6 + Math.sqrt(d.degree) * 2))
      .force("x", forceX<N>(0).strength(0.035))
      .force("y", forceY<N>(0).strength(0.035))
      .force("center", forceCenter(0, 0));
    if (reducedMotion) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); }
    simRef.current = sim;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let frames = 0;
    const fitted = { done: positions.current.size > 0 };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      // Zoom to fit once the layout has mostly settled.
      if (!fitted.done && ++frames > 70 && nodes.length) {
        fitted.done = true;
        const xs = nodes.map((n) => n.x!), ys = nodes.map((n) => n.y!);
        const w0 = Math.max(...xs) - Math.min(...xs) + 160, h0 = Math.max(...ys) - Math.min(...ys) + 120;
        const k = Math.max(0.3, Math.min(2.4, Math.min(canvas.clientWidth / w0, canvas.clientHeight / h0)));
        view.current = { k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k };
      }
      const dpr = devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Theme colours, read once per frame (canvas can't use CSS classes).
      const css = getComputedStyle(document.documentElement);
      const fgc = css.getPropertyValue("--c-fg").trim() || "255 255 255";
      const F = (a: number) => `rgb(${fgc} / ${a})`;
      ctx.fillStyle = `rgb(${css.getPropertyValue("--c-ink-1").trim() || "5 5 5"})`;
      ctx.fillRect(0, 0, w, h);
      const { x: vx, y: vy, k } = view.current;
      ctx.translate(w / 2 + vx, h / 2 + vy);
      ctx.scale(k, k);
      const sel = state.current.selected;
      const focus = hover.current?.id ?? sel;
      const neighbors = new Set<string>();
      if (focus) for (const e of edges) { const s = (e.source as N).id, t = (e.target as N).id; if (s === focus) neighbors.add(t); if (t === focus) neighbors.add(s); }
      const dim = (id: string) => (focus ? id !== focus && !neighbors.has(id) : false) || (state.current.matches.size > 0 && !state.current.matches.has(id));

      for (const e of edges) {
        const s = e.source as N, t = e.target as N;
        const on = focus && (s.id === focus || t.id === focus);
        ctx.strokeStyle = e.relation === "contradicts" ? `rgb(${css.getPropertyValue("--c-amber-300").trim()} / ${on ? 0.8 : 0.35})` : F(on ? 0.55 : e.status === "confirmed" ? 0.16 : 0.07);
        ctx.lineWidth = (on ? 1.2 : 0.7) / k;
        ctx.setLineDash(e.status === "suggested" ? [3 / k, 3 / k] : []);
        ctx.beginPath(); ctx.moveTo(s.x!, s.y!); ctx.lineTo(t.x!, t.y!); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const n of nodes) {
        const r = 2.6 + Math.sqrt(n.degree) * 1.4;
        const d = dim(n.id);
        ctx.globalAlpha = d ? 0.18 : 1;
        ctx.fillStyle = KIND_COLOR[n.kind] ?? F(1);
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2); ctx.fill();
        if (n.id === sel) { ctx.strokeStyle = F(1); ctx.lineWidth = 1.2 / k; ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 3.5 / k, 0, Math.PI * 2); ctx.stroke(); }
        const showLabel = nodes.length <= 40 || n.id === focus || neighbors.has(n.id) || state.current.matches.has(n.id) || (k > 1.4 && n.degree > 1) || n.degree >= 6;
        if (showLabel && !d) {
          ctx.font = `${11.5 / k}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = n.id === focus ? F(1) : F(0.7);
          ctx.fillText(n.title.length > 42 ? n.title.slice(0, 40) + "…" : n.title, n.x! + r + 4 / k, n.y! + 4 / k);
        }
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) positions.current.set(n.id, { x: n.x!, y: n.y! });
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); sim.stop(); };
  }, [graph, reducedMotion]);

  // Center on selected node when it changes from outside (search, URL).
  useEffect(() => {
    if (!selected) return;
    const t = setTimeout(() => {
      const n = simRef.current?.nodes().find((x) => x.id === selected);
      if (n && n.x !== undefined) { view.current.x = -n.x * view.current.k; view.current.y = -n.y! * view.current.k; }
    }, 350);
    return () => clearTimeout(t);
  }, [selected]);

  const toWorld = (cx: number, cy: number) => {
    const c = canvasRef.current!.getBoundingClientRect();
    const { x, y, k } = view.current;
    return { x: (cx - c.left - c.width / 2 - x) / k, y: (cy - c.top - c.height / 2 - y) / k };
  };
  const pick = (cx: number, cy: number) => {
    const p = toWorld(cx, cy);
    let best: N | null = null, bd = 12 / view.current.k;
    for (const n of simRef.current?.nodes() ?? []) {
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d < bd + Math.sqrt(n.degree)) { bd = d; best = n; }
    }
    return best;
  };

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full cursor-grab active:cursor-grabbing" role="img" aria-label={tx("Knowledge graph with {length} nodes and {length1} connections. Use list view for keyboard navigation.", { length: graph.nodes.length, length1: graph.edges.length })}
        onWheel={(e) => {
          const c = canvasRef.current!.getBoundingClientRect();
          const mx = e.clientX - c.left - c.width / 2, my = e.clientY - c.top - c.height / 2;
          const v = view.current;
          const nk = Math.max(0.2, Math.min(5, v.k * Math.exp(-e.deltaY * 0.0015)));
          v.x = mx - ((mx - v.x) * nk) / v.k; v.y = my - ((my - v.y) * nk) / v.k; v.k = nk;
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const n = pick(e.clientX, e.clientY);
          drag.current = { node: n, panning: !n, sx: e.clientX, sy: e.clientY, moved: false };
          if (n) { n.fx = n.x; n.fy = n.y; simRef.current?.alphaTarget(0.25).restart(); }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d.node || d.panning) {
            if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
            if (d.node) { const p = toWorld(e.clientX, e.clientY); d.node.fx = p.x; d.node.fy = p.y; }
            else { view.current.x += e.movementX; view.current.y += e.movementY; }
            return;
          }
          const n = pick(e.clientX, e.clientY);
          hover.current = n;
          const c = canvasRef.current!.getBoundingClientRect();
          setTip(n ? { x: e.clientX - c.left, y: e.clientY - c.top, n } : null);
        }}
        onPointerUp={() => {
          const d = drag.current;
          if (d.node) { d.node.fx = null; d.node.fy = null; simRef.current?.alphaTarget(0); }
          if (!d.moved) onSelect(d.node ? d.node.id : null);
          drag.current = { node: null, panning: false, sx: 0, sy: 0, moved: false };
        }}
        onPointerLeave={() => { hover.current = null; setTip(null); }}
      />
      {tip && (
        <div className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-line-strong bg-ink-2/95 px-3 py-2 text-[0.78rem] shadow-xl" style={{ left: tip.x + 14, top: tip.y + 10 }}>
          <div className="text-white">{tip.n.title}</div>
          <div className="mt-0.5 text-mute">{tip.n.kind}{tip.n.category ? ` · ${label(tip.n.category)}` : ""} · {tn(tip.n.degree, "{n} connection", "{n} connections")}</div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-4 text-[0.7rem] text-mute-soft">{tx("Scroll to zoom · drag to pan · drag nodes · click to inspect · dashed = suggested")}</div>
    </div>
  );
}

function GraphList({ graph, onSelect, selected, q }: { graph: { nodes: N[]; edges: E[] }; onSelect: (id: string) => void; selected: string | null; q: string }) {
  const nodes = [...graph.nodes].filter((n) => !q || n.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.degree - a.degree);
  return (
    <ul className="h-full divide-y divide-line overflow-y-auto px-6">
      {nodes.map((n) => (
        <li key={n.id}>
          <button onClick={() => onSelect(n.id)} className={cx("flex w-full items-center gap-3 py-2.5 text-left", selected === n.id && "text-white")}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[n.kind] }} />
            <span className="min-w-0 flex-1 truncate text-[0.88rem] text-white/90">{n.title}</span>
            <span className="text-[0.72rem] text-mute">{n.kind}</span>
            <span className="w-24 text-right text-[0.72rem] text-mute">{tn(n.degree, "{n} connection", "{n} connections")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function sourceLink(n: any): string | null {
  if (n.ref_type === "document") return `/knowledge/${n.ref_id}`;
  if (n.ref_type === "research") return `/research/${n.ref_id}`;
  if (n.ref_type === "project") return `/projects/${n.ref_id}`;
  if (n.ref_type === "memory") return `/knowledge?tab=memory`;
  if (n.ref_type === "opportunity") return `/opportunities`;
  return null;
}

function Inspector({ id, onSelect }: { id: string; onSelect: (id: string | null) => void }) {
  const { data, error } = useResource<any>(`/nodes/${id}`);
  const [connecting, setConnecting] = useState(false);
  const navigate = useNavigate();
  if (error) return <p className="text-[0.82rem] text-mute">{tx("This node no longer exists.")}</p>;
  if (!data) return <Pulse />;
  const n = data.node;
  const edge = async (eid: string, status: "confirmed" | "rejected") => {
    try { await api.patch(`/edges/${eid}`, status === "confirmed" ? { status } : { status }); invalidate("/graph", `/nodes/${id}`, "/growth"); } catch (e) { toastError(e); }
  };
  const confirmed = data.edges.filter((e: any) => e.status === "confirmed");
  const suggested = data.edges.filter((e: any) => e.status === "suggested");
  const src = sourceLink(n);
  return (
    <>
      <div className="mt-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[n.kind] }} /><span className="text-[0.72rem] text-mute">{n.kind}{n.category ? ` · ${label(n.category)}` : ""}</span></div>
      <h2 className="mt-1.5 text-[1rem] leading-snug text-white">{n.title}</h2>
      {n.summary && n.summary !== n.title && <p className="mt-2 line-clamp-[10] text-[0.83rem] leading-relaxed text-mute-bright">{n.summary}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {src && <Button size="sm" onClick={() => navigate(src)}>{tx("Open source")}</Button>}
        <Button size="sm" onClick={() => setConnecting(true)}>{tx("Connect…")}</Button>
        <Button size="sm" variant="ghost" icon={<Sparkles size={12} />} onClick={async () => { const r = await api.post(`/nodes/${id}/suggest`).catch(toastError); invalidate("/graph", `/nodes/${id}`); if (r) toast(r.added ? tn(r.added, "{n} new suggestion", "{n} new suggestions") : tx("No new relationships found")); }}>{tx("Find links")}</Button>
        {(n.kind === "concept" || n.kind === "finding") && <IconButton label={tx("Delete node")} onClick={async () => { if (!confirm(tx("Delete this node?"))) return; await api.del(`/nodes/${id}`).catch(toastError); invalidate("/graph", "/growth"); onSelect(null); }}><Trash2 size={13} /></IconButton>}
      </div>
      {data.sources?.length > 0 && (
        <Section title={tx("Sources")} count={data.sources.length}>
          <ul className="space-y-1.5">{data.sources.map((s: any) => <li key={s.ref_number + s.url} className="text-[0.8rem] leading-snug"><a href={s.url} target="_blank" rel="noreferrer noopener" className="text-white/85 hover:text-white">{s.title}</a> <span className="text-mute">· {s.provider}</span></li>)}</ul>
        </Section>
      )}
      <Section title={tx("Confirmed connections")} count={confirmed.length}>
        {confirmed.length === 0 && <p className="text-[0.8rem] text-mute">{tx("None yet.")}</p>}
        <ul className="space-y-1">{confirmed.map((e: any) => <EdgeRow key={e.id} e={e} onSelect={onSelect} />)}</ul>
      </Section>
      {suggested.length > 0 && (
        <Section title={tx("Suggested — not verified")} count={suggested.length}>
          <ul className="space-y-2">{suggested.map((e: any) => (
            <li key={e.id}>
              <EdgeRow e={e} onSelect={onSelect} />
              <div className="ml-4 mt-1 flex gap-1"><Button size="sm" variant="secondary" onClick={() => edge(e.id, "confirmed")}>{tx("Confirm")}</Button><Button size="sm" variant="ghost" onClick={() => edge(e.id, "rejected")}>{tx("Reject")}</Button></div>
            </li>
          ))}</ul>
        </Section>
      )}
      <ConnectDialog open={connecting} onClose={() => setConnecting(false)} sourceId={id} />
    </>
  );
}

function EdgeRow({ e, onSelect }: { e: any; onSelect: (id: string) => void }) {
  const rel = label(e.relation);
  return (
    <div className="text-[0.82rem] leading-snug">
      <span className={cx("text-mute", e.relation === "contradicts" && "text-amber-200/90")}>{e.direction === "out" ? rel : `← ${rel}`}</span>{" "}
      <button onClick={() => onSelect(e.other_id)} className="text-white/85 hover:text-white hover:underline">{e.other_title}</button>
      {e.rationale && <div className="mt-0.5 text-[0.72rem] text-mute-soft">{e.rationale}{e.status === "suggested" ? ` · ${pct(e.confidence)}` : ""}</div>}
    </div>
  );
}

function ConnectDialog({ open, onClose, sourceId }: { open: boolean; onClose: () => void; sourceId: string }) {
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<any>(null);
  const [relation, setRelation] = useState("related_to");
  const [rationale, setRationale] = useState("");
  const { data } = useResource<any>(open ? "/graph" : null);
  const results = (data?.nodes ?? []).filter((n: any) => n.id !== sourceId && q && n.title.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const submit = async () => {
    try { await api.post("/edges", { sourceId, targetId: target.id, relation, rationale }); invalidate("/graph", `/nodes/${sourceId}`, "/growth"); toast(tx("Connection created")); onClose(); setTarget(null); setQ(""); } catch (e) { toastError(e); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("Create a connection")}>
      <div className="space-y-3">
        {target ? (
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[0.86rem]"><span className="flex-1">{target.title}</span><button className="text-mute hover:text-white" onClick={() => setTarget(null)}>{tx("change")}</button></div>
        ) : (
          <>
            <Input autoFocus placeholder={tx("Find a node to connect to")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tx("Find node")} />
            <ul className="max-h-48 overflow-y-auto">{results.map((n: any) => <li key={n.id}><button className="w-full rounded-md px-2 py-1.5 text-left text-[0.85rem] hover:bg-white/[0.06]" onClick={() => setTarget(n)}>{n.title} <span className="text-[0.72rem] text-mute">{n.kind}</span></button></li>)}</ul>
          </>
        )}
        <Select label={tx("Relationship")} value={relation} onChange={setRelation} options={RELATIONS.map((r) => ({ value: r, label: label(r) }))} />
        <Textarea rows={2} placeholder={tx("Why are these connected? (optional)")} value={rationale} onChange={(e) => setRationale(e.target.value)} aria-label={tx("Rationale")} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button variant="primary" disabled={!target} onClick={submit}>{tx("Connect")}</Button></div>
      </div>
    </Dialog>
  );
}

function AddConcept({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const submit = async () => {
    try { const r = await api.post("/nodes", { title, summary }); invalidate("/graph", "/growth"); onCreated(r.id); onClose(); setTitle(""); setSummary(""); } catch (e) { toastError(e); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("New concept")}>
      <div className="space-y-3">
        <Input placeholder={tx("Concept")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={tx("Concept title")} />
        <Textarea rows={3} placeholder={tx("What is it? (helps Orbital find connections)")} value={summary} onChange={(e) => setSummary(e.target.value)} aria-label={tx("Summary")} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button variant="primary" disabled={!title.trim()} onClick={submit}>{tx("Create")}</Button></div>
      </div>
    </Dialog>
  );
}

function GraphHelp() {
  return (
    <>
      <Section title={tx("Legend")}>
        <ul className="space-y-1.5">{KINDS.map((k) => <li key={k} className="flex items-center gap-2 text-[0.82rem] text-mute-bright"><span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}</li>)}</ul>
      </Section>
      <Section title={tx("Relationships")}>
        <p className="text-[0.82rem] leading-relaxed text-mute">{tx("Solid lines are confirmed. Dashed lines are Orbital's suggestions — inspect a node to confirm or reject them. Amber lines mark possible contradictions.")}</p>
      </Section>
      <Section title={tx("Review")}><Link to="/knowledge?tab=review" className="text-[0.83rem] text-mute-bright hover:text-white">{tx("Review all suggestions →")}</Link></Section>
    </>
  );
}
