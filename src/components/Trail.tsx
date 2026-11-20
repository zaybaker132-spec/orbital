import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, ChevronRight, Compass, FileText, FolderKanban, Globe, Hash, MessageSquare, Paperclip, Star, StickyNote, X } from "lucide-react";
import { tx } from "@/i18n";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { timeAgo } from "@/lib/format";
import { IconButton } from "@/components/ui";
import { toast, toastError } from "@/state/ui";
import { NAV } from "./Shell";

/**
 * Recently viewed and favorites. What you open is remembered (notes, files, clips, papers, conversations,
 * projects, research); the star in the top bar pins whatever you're looking at, page or item.
 */
export type TrailKind = "document" | "paper" | "conversation" | "project" | "research" | "page";
export interface TrailItem { kind: TrailKind; ref: string; title: string; sub?: string; viewedAt?: string; id?: string; label?: string }

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ITEM_PATHS: [RegExp, Exclude<TrailKind, "page">][] = [
  [new RegExp(`^/knowledge/(${UUID})$`, "i"), "document"], [new RegExp(`^/papers/(${UUID})$`, "i"), "paper"],
  [new RegExp(`^/c/(${UUID})$`, "i"), "conversation"], [new RegExp(`^/projects/(${UUID})$`, "i"), "project"],
  [new RegExp(`^/research/(${UUID})$`, "i"), "research"],
];
/** The item a page shows, if it shows one. */
export function pathToItem(pathname: string): { kind: Exclude<TrailKind, "page">; ref: string } | null {
  for (const [re, kind] of ITEM_PATHS) { const m = pathname.match(re); if (m) return { kind, ref: m[1].toLowerCase() }; }
  return null;
}
export function itemPath(i: { kind: TrailKind; ref: string }) {
  return { document: `/knowledge/${i.ref}`, paper: `/papers/${i.ref}`, conversation: `/c/${i.ref}`, project: `/projects/${i.ref}`, research: `/research/${i.ref}`, page: i.ref }[i.kind];
}
const PAGE_NAMES: Record<string, string> = { "/settings": "Settings", "/search": "Search", "/team": "Team", "/maintenance": "Knowledge health", "/hypotheses": "Hypotheses" };
/** A page's name for its favorite: the sidebar's label, or the page's own name. */
export function pageTitle(pathname: string, search: string) {
  const nav = NAV.find((n) => n.to === pathname);
  const base = nav ? tx(nav.label) : PAGE_NAMES[pathname] ? tx(PAGE_NAMES[pathname]) : document.title.replace(/\s*[·|-]\s*Orbital$/, "") || "Orbital";
  const q = new URLSearchParams(search).get("q");
  return (q ? `${base}: ${q}` : base).slice(0, 120);
}

export function TrailIcon({ item, size = 14 }: { item: TrailItem; size?: number }) {
  const props = { size, strokeWidth: 1.6, className: "shrink-0" };
  if (item.kind === "document") return item.sub === "web_clip" ? <Globe {...props} /> : item.sub === "file" ? <Paperclip {...props} /> : <StickyNote {...props} />;
  if (item.kind === "paper") return <FileText {...props} />;
  if (item.kind === "conversation") return <MessageSquare {...props} />;
  if (item.kind === "project") return <FolderKanban {...props} />;
  if (item.kind === "research") return <Compass {...props} />;
  const nav = NAV.find((n) => n.to === item.ref.split("?")[0]);
  return nav ? <nav.icon {...props} /> : <Hash {...props} />;
}

/** Remember each item you open (after a moment there, so passing through doesn't count). */
export function useTrackViews() {
  const loc = useLocation();
  useEffect(() => {
    const item = pathToItem(loc.pathname);
    if (!item) return;
    const t = setTimeout(() => { api.post("/recent", item).then(() => invalidate("/recent")).catch(() => { /* gone or not yours: nothing to remember */ }); }, 800);
    return () => clearTimeout(t);
  }, [loc.pathname]);
}

/** The star in the top bar: pin or unpin what's on screen. */
export function BookmarkButton() {
  const loc = useLocation();
  const { data: marks } = useResource<TrailItem[]>("/bookmarks");
  const item = pathToItem(loc.pathname);
  const pageRef = (loc.pathname + loc.search).slice(0, 300);
  const target = item ?? { kind: "page" as const, ref: pageRef };
  const mark = marks?.find((m) => m.kind === target.kind && m.ref === target.ref);
  if (loc.pathname === "/" || loc.pathname.startsWith("/m/")) return null; // a new conversation or a live meeting: nothing to keep
  const toggle = async () => {
    try {
      if (mark) { await api.del(`/bookmarks/${mark.id}`); toast(tx("Removed from favorites")); }
      else { await api.post("/bookmarks", item ?? { kind: "page", ref: pageRef, title: pageTitle(loc.pathname, loc.search) }); toast(tx("Added to favorites")); }
      invalidate("/bookmarks");
    } catch (e) { toastError(e); }
  };
  return (
    <IconButton label={mark ? tx("Remove from favorites") : tx("Add to favorites")} active={!!mark} onClick={toggle}>
      <Star size={15} className={mark ? "fill-accent text-accent" : ""} />
    </IconButton>
  );
}

function Section({ id, title, children, action, defaultOpen = true }: { id: string; title: string; children: ReactNode; action?: ReactNode; defaultOpen?: boolean }) {
  const key = `orbital.section.${id}`;
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; } });
  const flip = () => { setOpen(!open); try { localStorage.setItem(key, open ? "0" : "1"); } catch { /* ignore */ } };
  return (
    <div className="mt-4">
      <div className="group flex items-center px-5 pb-1.5">
        <button onClick={flip} className="label flex items-center gap-1 hover:text-white" aria-expanded={open}>
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}{title}
        </button>
        <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">{action}</span>
      </div>
      {open && children}
    </div>
  );
}

/** Favorites and Recent, in the sidebar above Conversations. */
export function SidebarTrail() {
  const loc = useLocation();
  const { data: marks } = useResource<TrailItem[]>("/bookmarks");
  const { data: recent } = useResource<TrailItem[]>("/recent");
  const [dragging, setDragging] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const here = (i: TrailItem) => itemPath(i) === loc.pathname + (i.kind === "page" ? loc.search : "");
  const row = (active: boolean) => `group flex h-7 items-center gap-2 rounded-lg px-2.5 text-[0.83rem] transition-colors ${active ? "bg-white/[0.07] text-white" : "text-mute hover:bg-white/[0.04] hover:text-white/90"}`;

  const reorder = async (fromId: string, toId: string) => {
    if (!marks || fromId === toId) return;
    const ids = marks.map((m) => m.id!);
    const from = ids.indexOf(fromId), to = ids.indexOf(toId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    try { await api.put("/bookmarks/order", { ids }); invalidate("/bookmarks"); } catch (e) { toastError(e); }
  };

  return (
    <>
      {!!marks?.length && (
        <Section id="favorites" title={tx("Favorites")}>
          <ul className="space-y-px px-2.5">
            {marks.map((m) => (
              <li key={m.id} draggable onDragStart={() => setDragging(m.id!)} onDragEnd={() => setDragging(null)}
                onDragOver={(e) => { if (dragging) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (dragging) reorder(dragging, m.id!); setDragging(null); }}
                className={dragging === m.id ? "opacity-40" : ""}>
                {renaming === m.id ? (
                  <RenameField item={m} done={() => setRenaming(null)} />
                ) : (
                  <Link to={itemPath(m)} className={row(here(m))} onDoubleClick={(e) => { e.preventDefault(); setRenaming(m.id!); }} title={tx("Double-click to rename · drag to reorder")}>
                    <TrailIcon item={m} />
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <button onClick={async (e) => { e.preventDefault(); e.stopPropagation(); try { await api.del(`/bookmarks/${m.id}`); invalidate("/bookmarks"); } catch (err) { toastError(err); } }}
                      className="hidden rounded p-0.5 text-mute hover:text-white group-hover:block" aria-label={tx("Remove from favorites")}><X size={12} /></button>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!recent?.length && (
        <Section id="recent" title={tx("Recent")} action={
          <button onClick={async () => { try { await api.del("/recent"); invalidate("/recent"); } catch (e) { toastError(e); } }} className="text-[0.68rem] text-mute hover:text-white">{tx("Clear")}</button>
        }>
          <ul className="space-y-px px-2.5">
            {recent.map((r) => (
              <li key={`${r.kind}:${r.ref}`}>
                <Link to={itemPath(r)} className={row(here(r))} title={r.viewedAt ? `${r.title} · ${timeAgo(r.viewedAt)}` : r.title}>
                  <TrailIcon item={r} />
                  <span className="min-w-0 flex-1 truncate">{r.title || tx("Untitled")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function RenameField({ item, done }: { item: TrailItem; done: () => void }) {
  const [v, setV] = useState(item.label || item.title);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  const save = async () => {
    const label = v.trim() === item.title && !item.label ? "" : v.trim();
    try { await api.patch(`/bookmarks/${item.id}`, { label }); invalidate("/bookmarks"); } catch (e) { toastError(e); }
    done();
  };
  return (
    <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} maxLength={120} aria-label={tx("Favorite name")}
      onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") done(); }}
      className="h-7 w-full rounded-lg border border-white/25 bg-black/40 px-2.5 text-[0.83rem] text-white focus:outline-none" />
  );
}

/** A plain list of trail items (dashboard widgets, command palette). */
export function TrailList({ items, empty }: { items: TrailItem[] | undefined; empty: string }) {
  if (!items) return null;
  if (!items.length) return <p className="py-2 text-[0.82rem] text-mute-soft">{empty}</p>;
  return (
    <ul className="-mx-1.5 space-y-px">
      {items.map((r) => (
        <li key={`${r.kind}:${r.ref}`}>
          <Link to={itemPath(r)} className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[0.84rem] text-white/90 hover:bg-white/[0.04]">
            <span className="text-mute"><TrailIcon item={r} /></span>
            <span className="min-w-0 flex-1 truncate">{r.title || tx("Untitled")}</span>
            {r.viewedAt && <span className="shrink-0 text-[0.74rem] text-mute">{timeAgo(r.viewedAt)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
