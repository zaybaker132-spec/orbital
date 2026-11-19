import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, FileText, LayoutGrid, List, MoreVertical, Pencil, Plus, Search, Star, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { useApp } from "@/state/app";
import { Button, Dialog, Empty, Input, Pulse, cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { tx } from "@/i18n";
import { TEMPLATES, type DocTemplate } from "./templates";

type Filter = "all" | "mine" | "others" | "starred";
const FILTERS: { value: Filter; label: string; business?: boolean }[] = [
  { value: "all", label: "All documents" },
  { value: "mine", label: "Created by me", business: true },
  { value: "others", label: "Created by others", business: true },
  { value: "starred", label: "Starred" },
];

/** Docs home: start from a template, or reopen a recent document. */
export function DocsHome() {
  const navigate = useNavigate();
  const business = useApp((s) => s.workspace?.kind === "business");
  const canWrite = useApp((s) => s.workspace?.role !== "viewer");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "list">(() => { try { return (localStorage.getItem("orbital.docs.view") as any) || "grid"; } catch { return "grid"; } });
  const [creating, setCreating] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<any>(null);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { try { localStorage.setItem("orbital.docs.view", view); } catch { /* ignore */ } }, [view]);
  const key = `/docs?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(filter !== "all" ? { filter } : {}) })}`;
  const { data: docs, loading } = useResource<any[]>(key);

  const create = async (t: DocTemplate) => {
    setCreating(t.id);
    try {
      const html = t.html();
      const d = await api.post("/docs", { title: t.title() || tx("Untitled document"), html, text: html ? new DOMParser().parseFromString(html, "text/html").body.innerText : "" });
      invalidate("/docs");
      navigate(`/papers/${d.id}`);
    } catch (e) { toastError(e); } finally { setCreating(null); }
  };
  const star = async (d: any) => { try { await api.post(`/docs/${d.id}/star`, { on: !d.starred }); invalidate("/docs"); } catch (e) { toastError(e); } };
  const copy = async (d: any) => { try { const c = await api.post(`/docs/${d.id}/copy`, { title: tx("Copy of {title}", { title: d.title }) }); invalidate("/docs"); navigate(`/papers/${c.id}`); } catch (e) { toastError(e); } };
  const remove = async (d: any) => {
    if (!confirm(tx("Delete “{title}”? This can't be undone.", { title: d.title }))) return;
    try { await api.del(`/docs/${d.id}`); invalidate("/docs"); toast(tx("Document deleted")); } catch (e) { toastError(e); }
  };

  return (
    <div className="h-full overflow-y-auto pb-20">
      <section className="border-b border-line bg-white/[0.015]">
        <div className="mx-auto max-w-[1100px] px-8 pb-8 pt-8">
          <div className="flex items-center gap-4">
            <h1 className="text-[1.5rem] font-light tracking-[-0.02em] text-white">{tx("Papers")}</h1>
            <div className="relative ml-auto w-full max-w-[420px]">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search documents")} aria-label={tx("Search documents")} className="h-10 rounded-full pl-10" />
            </div>
          </div>
          {canWrite && (
            <>
              <h2 className="label mb-3 mt-7">{tx("Start a new document")}</h2>
              <div className="flex gap-4 overflow-x-auto pb-1">
                {TEMPLATES.map((t) => (
                  <button key={t.id} onClick={() => create(t)} disabled={!!creating} className="group shrink-0 text-left disabled:opacity-60">
                    <TemplateThumb t={t} busy={creating === t.id} />
                    <div className="mt-2 text-[0.82rem] text-white/85 group-hover:text-white">{tx(t.label)}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-[1100px] px-8 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-3 text-[0.95rem] text-white">{query ? tx("Results") : tx("Recent documents")}</h2>
          {FILTERS.filter((f) => !f.business || business).map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
              className={cx("h-7 rounded-full border px-3 text-[0.78rem] transition-colors", filter === f.value ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>{tx(f.label)}</button>
          ))}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-line p-0.5">
            <button aria-label={tx("Grid view")} title={tx("Grid view")} onClick={() => setView("grid")} className={cx("rounded-md p-1.5", view === "grid" ? "bg-white/10 text-white" : "text-mute hover:text-white")}><LayoutGrid size={14} /></button>
            <button aria-label={tx("List view")} title={tx("List view")} onClick={() => setView("list")} className={cx("rounded-md p-1.5", view === "list" ? "bg-white/10 text-white" : "text-mute hover:text-white")}><List size={14} /></button>
          </div>
        </div>

        {loading && !docs && <div className="py-12 text-center"><Pulse /></div>}
        {docs && docs.length === 0 && (
          <div className="mt-10">
            <Empty title={query ? tx("No documents match") : filter === "starred" ? tx("No starred documents") : tx("No documents yet")}>
              {query || filter !== "all" ? null : tx("Write anything here: plans, reports, letters, notes. Everything you write becomes part of what Orbital knows, so its answers can draw on it.")}
            </Empty>
            {!query && filter === "all" && canWrite && <div className="mt-4 text-center"><Button variant="primary" icon={<Plus size={14} />} onClick={() => create(TEMPLATES[0])}>{tx("New document")}</Button></div>}
          </div>
        )}

        {docs && docs.length > 0 && view === "grid" && (
          <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-5">
            {docs.map((d) => (
              <li key={d.id} className="group">
                <Link to={`/papers/${d.id}`} className="block overflow-hidden rounded-lg border border-line bg-[#f4f4f2] transition-colors group-hover:border-white/40">
                  <Thumb preview={d.preview} />
                </Link>
                <div className="mt-2 flex items-start gap-1">
                  <FileText size={14} className="mt-0.5 shrink-0 text-sky-300/80" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/papers/${d.id}`} className="block truncate text-[0.86rem] text-white hover:underline">{d.title}</Link>
                    <div className="truncate text-[0.72rem] text-mute">{d.starred && <Star size={10} className="-mt-0.5 mr-1 inline fill-amber-300 text-amber-300" />}{tx("Edited {when}", { when: timeAgo(d.updated_at) })}{business && d.editor_name ? ` · ${d.editor_name}` : ""}</div>
                  </div>
                  <DocMenu d={d} canWrite={canWrite} onStar={star} onCopy={copy} onRename={setRenaming} onDelete={remove} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {docs && docs.length > 0 && view === "list" && (
          <table className="mt-4 w-full text-[0.84rem]">
            <thead><tr className="text-left text-[0.72rem] text-mute"><th className="py-2 font-normal">{tx("Name")}</th>{business && <th className="py-2 font-normal">{tx("Owner")}</th>}<th className="py-2 font-normal">{tx("Last edited")}</th><th className="py-2 text-right font-normal">{tx("Words")}</th><th className="w-8" /></tr></thead>
            <tbody className="divide-y divide-line">
              {docs.map((d) => (
                <tr key={d.id} className="group hover:bg-white/[0.03]">
                  <td className="py-2.5"><Link to={`/papers/${d.id}`} className="flex items-center gap-2 text-white"><FileText size={14} className="text-sky-300/80" /><span className="truncate">{d.title}</span>{d.starred && <Star size={11} className="fill-amber-300 text-amber-300" />}</Link></td>
                  {business && <td className="py-2.5 text-mute-bright">{d.mine ? tx("me") : d.owner_name}</td>}
                  <td className="py-2.5 text-mute-bright">{timeAgo(d.updated_at)}{business && d.editor_name ? ` · ${d.editor_name}` : ""}</td>
                  <td className="py-2.5 text-right text-mute">{d.words.toLocaleString()}</td>
                  <td className="py-2.5 text-right"><DocMenu d={d} canWrite={canWrite} onStar={star} onCopy={copy} onRename={setRenaming} onDelete={remove} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <RenameDialog doc={renaming} onClose={() => setRenaming(null)} />
    </div>
  );
}

function TemplateThumb({ t, busy }: { t: DocTemplate; busy: boolean }) {
  const lines = useMemo(() => Array.from({ length: 9 }, (_, i) => 30 + ((i * 37) % 55)), []);
  return (
    <div className="relative flex h-[168px] w-[130px] flex-col gap-1.5 overflow-hidden rounded-md border border-line bg-[#f4f4f2] p-3 transition-all group-hover:-translate-y-0.5 group-hover:border-white/50">
      {t.id === "blank" ? <Plus size={44} strokeWidth={1} className="m-auto text-black/50" /> : (
        <>
          <div className="h-2 w-3/4 rounded-sm" style={{ background: t.swatch }} />
          {lines.map((w, i) => <div key={i} className={cx("h-1 rounded-sm bg-black/15", i % 4 === 0 && "mt-1.5 bg-black/30")} style={{ width: `${w}%` }} />)}
        </>
      )}
      {busy && <div className="absolute inset-0 grid place-items-center bg-white/60"><Pulse /></div>}
    </div>
  );
}

/** A page-shaped preview of the doc's opening lines. */
function Thumb({ preview }: { preview: string }) {
  const lines = (preview ?? "").split("\n").filter((l) => l.trim() && !/^\|?(\s*-{3,}\s*\|)+\s*-*\s*$/.test(l.trim()) && l.trim() !== "---")
    .map((l) => (l.trim().startsWith("|") ? l.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join("   ") : l))
    .filter(Boolean).slice(0, 12);
  return (
    <div className="h-[200px] overflow-hidden px-4 pt-4 text-black/75">
      {lines.length === 0 ? <div className="text-[0.6rem] text-black/30">{tx("Empty document")}</div> : lines.map((l, i) => {
        const h = l.match(/^(#{1,4})\s+(.*)/);
        return <div key={i} className={cx("truncate leading-snug", h ? (h[1].length === 1 ? "mb-1 text-[0.72rem] font-medium text-black" : "mt-1 text-[0.6rem] font-medium text-black/85") : "text-[0.5rem]")}>{(h ? h[2] : l).replace(/\*\*|__|`|~~|\[( |x)\]/g, "").replace(/^[-*]\s/, "• ")}</div>;
      })}
    </div>
  );
}

function DocMenu({ d, canWrite, onStar, onCopy, onRename, onDelete }: { d: any; canWrite: boolean; onStar: (d: any) => void; onCopy: (d: any) => void; onRename: (d: any) => void; onDelete: (d: any) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const close = () => setOpen(false); setTimeout(() => window.addEventListener("click", close), 0); return () => window.removeEventListener("click", close); }, [open]);
  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[0.8rem] text-white/85 hover:bg-white/[0.07]";
  return (
    <div className="relative">
      <button aria-label={tx("More actions")} onClick={(e) => { e.preventDefault(); setOpen(!open); }} className="rounded-md p-1 text-mute opacity-60 hover:bg-white/[0.06] hover:text-white group-hover:opacity-100"><MoreVertical size={14} /></button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-48 rounded-lg border border-line-strong bg-ink-2 p-1 shadow-2xl" role="menu">
          <button className={item} onClick={() => onStar(d)}><Star size={13} />{d.starred ? tx("Remove star") : tx("Star")}</button>
          {canWrite && <button className={item} onClick={() => onRename(d)}><Pencil size={13} />{tx("Rename")}</button>}
          {canWrite && <button className={item} onClick={() => onCopy(d)}><Copy size={13} />{tx("Make a copy")}</button>}
          {canWrite && <button className={cx(item, "text-red-300")} onClick={() => onDelete(d)}><Trash2 size={13} />{tx("Delete")}</button>}
        </div>
      )}
    </div>
  );
}

/** Renaming from the list edits the live title, so anyone with the doc open sees it change. */
function RenameDialog({ doc, onClose }: { doc: any; onClose: () => void }) {
  const [title, setTitle] = useState("");
  useEffect(() => { if (doc) setTitle(doc.title); }, [doc]);
  const save = async () => {
    try {
      await api.patch(`/docs/${doc.id}`, { title: title.trim() || tx("Untitled document") });
      invalidate("/docs"); onClose();
    } catch (e) { toastError(e); }
  };
  return (
    <Dialog open={!!doc} onClose={onClose} title={tx("Rename")}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label={tx("Document name")} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button type="submit" variant="primary">{tx("Rename")}</Button></div>
      </form>
    </Dialog>
  );
}
