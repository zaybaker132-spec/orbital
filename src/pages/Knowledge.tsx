import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FileText, FolderPlus, Plus, Search, Trash2, Upload, Eye, PenLine, Check, X, Folder, Hash, Layers, Archive, Link2, Scissors, HeartPulse } from "lucide-react";
import { api, getWorkspaceId } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { usePanel, toast, toastError } from "@/state/ui";
import { useCan } from "@/state/app";
import { Badge, Button, Dialog, Empty, IconButton, Input, PageHeader, Pulse, Select, Tabs, Textarea, cx } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { ClipPage, ClipBookmarklet } from "./Clip";
import { RemindMenu } from "@/components/RemindMenu";
import { ExtractionView } from "./knowledge/Extraction";
import { NotFoundPage } from "./NotFound";
import { Section } from "@/components/RightPanel";
import { label, pct, timeAgo } from "@/lib/format";
import { tn, tx } from "@/i18n";

type Tab = "notes" | "memory" | "review";
export const MEMORY_CATEGORIES = ["preference", "goal", "skill", "interest", "decision", "project", "business_idea", "research_finding", "topic", "lesson", "context"];

export function KnowledgePage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "notes";
  const { data: pending } = useResource<any[]>("/memories?status=pending");
  const { data: graph } = useResource<any>("/graph");
  const suggested = graph?.edges.filter((e: any) => e.status === "suggested").length ?? 0;
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => () => setContent("", null), [setContent]);

  if (id) return <DocumentEditor id={id} />;
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tx("Knowledge")} subtitle={tx("Notes, documents and what Orbital remembers — all searchable, all connectable.")}
        actions={<Link to="/maintenance" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[0.8rem] text-mute-bright hover:text-white"><HeartPulse size={13} />{tx("Knowledge health")}</Link>} />
      <Tabs className="mx-8" value={tab} onChange={(t) => setParams(t === "notes" ? {} : { tab: t })}
        tabs={[{ value: "notes", label: "Notes & documents" }, { value: "memory", label: "Memory" }, { value: "review", label: "Review", count: (pending?.length ?? 0) + suggested }]} />
      <div className="min-h-0 flex-1">
        {tab === "notes" && <Notes />}
        {tab === "memory" && <Memories />}
        {tab === "review" && <Review />}
      </div>
    </div>
  );
}

// ── Notes & documents ────────────────────────────────────────────────────
function Notes() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const folder = params.get("folder") ?? "";
  const tag = params.get("tagf") ?? "";
  const collection = params.get("collection") ?? "";
  const query = new URLSearchParams({ ...(q && { q }), ...(folder && { folder }), ...(tag && { tag }), ...(collection && { collection }) }).toString();
  const { data: docs, loading } = useResource<any[]>(`/documents${query ? `?${query}` : ""}`);
  const { data: folders } = useResource<any[]>("/folders");
  const { data: tags } = useResource<any[]>("/tags");
  const { data: collections } = useResource<any[]>("/collections");
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const can = useCan();
  const [clipOpen, setClipOpen] = useState(false);

  useEffect(() => { if (params.get("clip")) setClipOpen(true); }, [params]);
  useEffect(() => { if (params.get("import")) setTimeout(() => fileRef.current?.click(), 200); }, [params]);

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    ["folder", "tagf", "collection"].forEach((x) => next.delete(x));
    next.delete("import");
    if (v) next.set(k, v);
    setParams(next);
  };
  const create = async () => {
    try { const d = await api.post("/documents", { title: "Untitled", body: "", folderId: folder || null }); invalidate("/documents"); navigate(`/knowledge/${d.id}`); } catch (e) { toastError(e); }
  };
  const upload = async (files: FileList) => {
    setUploading(true);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      if (folder) fd.append("folderId", folder);
      try { const d = await api.upload("/documents/upload", fd); toast(d.notice ? tx("Imported {name}. {notice}", { name: f.name, notice: d.notice }) : tx("Imported {name}", { name: f.name })); } catch (e) { toastError(e); }
    }
    setUploading(false);
    invalidate("/documents", "/tags");
    if (fileRef.current) fileRef.current.value = "";
  };

  const filterBtn = (active: boolean, onClick: () => void, children: React.ReactNode, key: string) => (
    <li key={key}><button onClick={onClick} className={cx("flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[0.82rem] transition-colors", active ? "bg-white/[0.07] text-white" : "text-mute hover:text-white")}>{children}</button></li>
  );

  return (
    <div className="flex h-full">
      <Dialog open={clipOpen} onClose={() => setClipOpen(false)} title={tx("Clip a web page")}>
        <ClipPage embedded onDone={() => setClipOpen(false)} />
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-[0.8rem] text-mute">{tx("Clip from any site: drag this button to your bookmarks bar, then click it on a page you want to keep. Select text first to save a highlight.")}</p>
          <ClipBookmarklet />
        </div>
      </Dialog>
      <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-line px-3 py-4" aria-label={tx("Filters")}>
        <ul className="space-y-px">{filterBtn(!folder && !tag && !collection, () => setFilter("", ""), <><Layers size={13} />{tx("All knowledge")}</>, "all")}</ul>
        <div className="label mb-1.5 mt-5 flex items-center px-2">{tx("Folders")}<button className="ml-auto text-mute hover:text-white" aria-label={tx("New folder")} onClick={() => setNewFolder("")}><FolderPlus size={13} /></button></div>
        <ul className="space-y-px">
          {newFolder !== null && (
            <li><input autoFocus className="input h-7 py-0 text-[0.8rem]" placeholder={tx("Folder name")} value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
              onBlur={() => setNewFolder(null)}
              onKeyDown={async (e) => { if (e.key === "Enter" && newFolder.trim()) { await api.post("/folders", { name: newFolder.trim() }).catch(toastError); invalidate("/folders"); setNewFolder(null); } if (e.key === "Escape") setNewFolder(null); }} /></li>
          )}
          {folders?.map((f) => filterBtn(folder === f.id, () => setFilter("folder", f.id), <><Folder size={13} /><span className="truncate">{f.name}</span></>, f.id))}
          {folders?.length === 0 && newFolder === null && <li className="px-2 text-[0.76rem] text-mute-soft">{tx("None yet")}</li>}
        </ul>
        <div className="label mb-1.5 mt-5 flex items-center px-2">{tx("Collections")}<button className="ml-auto text-mute hover:text-white" aria-label={tx("New collection")} onClick={() => setNewCollection("")}><Plus size={13} /></button></div>
        <ul className="space-y-px">
          {newCollection !== null && (
            <li><input autoFocus className="input h-7 py-0 text-[0.8rem]" placeholder={tx("Collection name")} value={newCollection} onChange={(e) => setNewCollection(e.target.value)} onBlur={() => setNewCollection(null)}
              onKeyDown={async (e) => { if (e.key === "Enter" && newCollection.trim()) { await api.post("/collections", { name: newCollection.trim() }).catch(toastError); invalidate("/collections"); setNewCollection(null); } if (e.key === "Escape") setNewCollection(null); }} /></li>
          )}
          {collections?.map((c) => filterBtn(collection === c.id, () => setFilter("collection", c.id), <><Layers size={13} /><span className="truncate">{c.name}</span><span className="ml-auto text-mute-soft">{c.document_ids.length}</span></>, c.id))}
          {collections?.length === 0 && newCollection === null && <li className="px-2 text-[0.76rem] text-mute-soft">{tx("None yet")}</li>}
        </ul>
        {tags && tags.length > 0 && (
          <>
            <div className="label mb-1.5 mt-5 px-2">{tx("Tags")}</div>
            <ul className="space-y-px">{tags.slice(0, 30).map((t) => filterBtn(tag === t.tag, () => setFilter("tagf", t.tag), <><Hash size={12} /><span className="truncate">{t.tag}</span><span className="ml-auto text-mute-soft">{t.n}</span></>, t.tag))}</ul>
          </>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-6 py-3">
          <div className="relative max-w-sm flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search notes and documents")} className="h-9 pl-9" aria-label={tx("Search notes")} />
          </div>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.csv,.tsv,.json,.html" onChange={(e) => e.target.files && upload(e.target.files)} />
          {can.write && <Button className="ml-auto" icon={<Scissors size={14} />} onClick={() => setClipOpen(true)}>{tx("Clip a page")}</Button>}
          {can.write && <Button icon={<Upload size={14} />} loading={uploading} onClick={() => fileRef.current?.click()}>{tx("Import")}</Button>}
          {can.write && <Button variant="primary" icon={<Plus size={14} />} onClick={create}>{tx("New note")}</Button>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
          {loading && <div className="py-10 text-center"><Pulse /></div>}
          {docs?.length === 0 && (q || folder || tag || collection
            ? <Empty title={tx("Nothing matches")} />
            : <Empty title={tx("No notes yet")} action={<div className="flex gap-2"><Button variant="primary" onClick={create}>{tx("Write a note")}</Button><Button onClick={() => fileRef.current?.click()}>{tx("Import a file")}</Button></div>}>
                {tx("Write notes or import PDFs, Word, Excel and PowerPoint files, and images. Everything becomes searchable, feeds Orbital's answers, and join your knowledge graph. Link notes with [[Note title]].")}
              </Empty>)}
          <ul className="divide-y divide-line">
            {docs?.map((d) => (
              <li key={d.id}>
                <Link to={`/knowledge/${d.id}`} className="group flex gap-4 py-3.5">
                  <FileText size={15} className="mt-0.5 shrink-0 text-mute" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[0.92rem] text-white group-hover:underline decoration-white/30 underline-offset-2">{d.title}</span>
                      {d.kind !== "note" && <Badge>{label(d.kind)}</Badge>}
                      {d.ai_generated && <Badge tone="ai">{tx("AI-generated")}</Badge>}
                    </div>
                    {d.preview && <p className="mt-0.5 line-clamp-1 text-[0.82rem] text-mute">{d.preview}</p>}
                  </div>
                  <div className="flex shrink-0 items-start gap-1.5">{d.tags.slice(0, 3).map((t: string) => <span key={t} className="text-[0.72rem] text-mute">#{t}</span>)}</div>
                  <span className="w-16 shrink-0 text-right text-[0.72rem] text-mute-soft">{timeAgo(d.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function DocumentEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "extraction" ? "extraction" : "document";
  const can = useCan();
  const [doc, setDoc] = useState<any>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [tagInput, setTagInput] = useState("");
  const [missing, setMissing] = useState(false);
  const { data: folders } = useResource<any[]>("/folders");
  const { data: projects } = useResource<any[]>("/projects");
  const { data: collections } = useResource<any[]>("/collections");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const setContent = usePanel((s) => s.setContent);

  useEffect(() => {
    setMissing(false);
    api.get(`/documents/${id}`).then((d) => { setDoc(d); setMode(d.kind === "note" && !d.body ? "write" : d.kind === "note" ? "write" : "preview"); }).catch((e) => { if (e?.status === 404 || e?.status === 400) setMissing(true); else navigate("/knowledge", { replace: true }); });
  }, [id, navigate]);

  useEffect(() => {
    setContent("Related", <RelatedPanel docId={id} />);
    return () => setContent("", null);
  }, [id, setContent]);

  const save = (patch: Record<string, unknown>) => {
    setDoc((d: any) => ({ ...d, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k === "folderId" ? "folder_id" : k === "projectId" ? "project_id" : k, v])) }));
    setSaving("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api.patch(`/documents/${id}`, patch); setSaving("saved"); invalidate("/documents", "/tags"); } catch (e) { toastError(e); setSaving("idle"); }
    }, 700);
  };

  if (missing) return <NotFoundPage what="note" back={{ to: "/knowledge", label: "All knowledge" }} />;
  if (!doc) return <div className="p-10 text-center"><Pulse /></div>;
  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (t && !doc.tags.includes(t)) save({ tags: [...doc.tags, t] });
    setTagInput("");
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-6 pt-3">
        <Link to="/knowledge" className="text-[0.8rem] text-mute hover:text-white">{tx("← Knowledge")}</Link>
        <span className="text-[0.74rem] text-mute-soft" aria-live="polite">{saving === "saving" ? tx("Saving…") : saving === "saved" ? tx("Saved") : ""}</span>
        <div className="ml-auto flex items-center gap-1">
          {doc.ai_generated && <Badge tone="ai">{tx("AI-generated")}</Badge>}
          <RemindMenu itemType="document" itemId={id} />
          <IconButton label={mode === "write" ? tx("Preview") : tx("Edit")} onClick={() => setMode(mode === "write" ? "preview" : "write")}>{mode === "write" ? <Eye size={15} /> : <PenLine size={15} />}</IconButton>
          <IconButton label={tx("Delete")} onClick={async () => { if (!confirm(tx("Delete this document?"))) return; await api.del(`/documents/${id}`).catch(toastError); invalidate("/documents", "/graph", "/growth"); navigate("/knowledge"); }}><Trash2 size={15} /></IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 pb-24 pt-6">
          <input value={doc.title} onChange={(e) => save({ title: e.target.value })} aria-label={tx("Title")} className="w-full bg-transparent text-[1.6rem] font-light tracking-[-0.02em] outline-none placeholder:text-mute-soft" placeholder={tx("Untitled")} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8rem]">
            <Select label={tx("Folder")} value={doc.folder_id ?? ""} onChange={(v) => save({ folderId: v || null })} className="h-7 w-40 text-[0.78rem]" options={[{ value: "", label: "No folder" }, ...(folders ?? []).map((f) => ({ value: f.id, label: f.name }))]} />
            <Select label={tx("Project")} value={doc.project_id ?? ""} onChange={(v) => save({ projectId: v || null })} className="h-7 w-44 text-[0.78rem]" options={[{ value: "", label: "No project" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            {collections && collections.length > 0 && (
              <Select label={tx("Add to collection")} value="" className="h-7 w-44 text-[0.78rem]" onChange={async (v) => { if (!v) return; await api.put(`/collections/${v}/documents/${id}`).catch(toastError); invalidate("/collections"); toast(tx("Added to collection")); }}
                options={[{ value: "", label: "Add to collection…" }, ...collections.map((c) => ({ value: c.id, label: `${c.document_ids.includes(id) ? "✓ " : ""}${c.name}` }))]} />
            )}
            {doc.tags.map((t: string) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[0.75rem] text-mute-bright">#{t}<button aria-label={tx("Remove tag {t}", { t: t })} onClick={() => save({ tags: doc.tags.filter((x: string) => x !== t) })} className="hover:text-white"><X size={11} /></button></span>
            ))}
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder={tx("+ tag")} aria-label={tx("Add tag")} className="w-20 bg-transparent text-[0.78rem] outline-none placeholder:text-mute-soft" />
            {doc.source_url && <a href={doc.source_url} target="_blank" rel="noreferrer noopener" className="text-mute hover:text-white">{tx("Source ↗")}</a>}
            {doc.file_name && <span className="text-mute-soft">{tx("Imported from")} {doc.file_name}</span>}
          </div>
          {doc.kind === "image" && (
            <figure className="mt-6 overflow-hidden rounded-xl border border-line bg-panel">
              <img src={`/api/documents/${id}/file${getWorkspaceId() ? `?workspace=${getWorkspaceId()}` : ""}`} alt={doc.title} className="mx-auto max-h-[60vh] w-auto" />
            </figure>
          )}
          {doc.kind === "image" && !doc.body && mode !== "write" && <p className="mt-4 text-[0.84rem] text-mute">{tx("Connect an AI provider and Orbital will read this image's text and contents. Until then you can describe it yourself with Edit.")}</p>}
          <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
            {([["document", "Document"], ["extraction", "Extracted knowledge"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setParams(k === "document" ? {} : { view: k })}
                className={cx("-mb-px flex items-center gap-1.5 border-b px-3 pb-2 text-[0.84rem] transition-colors", view === k ? "border-white text-white" : "border-transparent text-mute hover:text-white")}>
                {k === "extraction" && <Layers size={13} />}{tx(label)}</button>
            ))}
          </div>
          {view === "extraction" ? <div className="mt-6"><ExtractionView docId={id} focusItem={params.get("item")} canWrite={can.write} /></div> : (
          <div className="mt-6">
            {mode === "write" ? (
              <Textarea value={doc.body} onChange={(e) => save({ body: e.target.value })} aria-label={tx("Note body (Markdown)")}
                placeholder={tx("Write in Markdown. Link other notes with [[Note title]].")}
                className="min-h-[60vh] border-none bg-transparent px-0 font-mono text-[0.88rem] leading-[1.75] focus:bg-transparent" />
            ) : doc.body ? <Markdown text={doc.body} /> : doc.kind === "image" ? null : <p className="text-mute">{tx("Empty.")}</p>}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RelatedPanel({ docId }: { docId: string }) {
  const { data } = useResource<any>(`/documents/${docId}/related`);
  if (!data) return <Pulse />;
  if (!data.nodeId) return <p className="text-[0.82rem] text-mute">{tx("Indexing… related knowledge appears once this note is processed.")}</p>;
  const connect = async (targetId: string) => {
    try { await api.post("/edges", { sourceId: data.nodeId, targetId, relation: "related_to" }); invalidate(`/documents/${docId}/related`, "/graph", "/growth"); toast(tx("Connected")); } catch (e) { toastError(e); }
  };
  return (
    <>
      <Section title={tx("Suggested related knowledge")} count={data.related.length}>
        {data.related.length === 0 && <p className="text-[0.82rem] text-mute">{tx("Nothing related yet.")}</p>}
        <ul className="space-y-1">
          {data.related.map((r: any) => (
            <li key={r.id} className="group -mx-2 flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <Link to={r.ref_type === "document" ? `/knowledge/${r.ref_id}` : `/connections?node=${r.id}`} className="text-[0.84rem] leading-snug text-white/85 hover:text-white">{r.title}</Link>
                <div className="text-[0.7rem] text-mute">{r.kind} · {pct(Number(r.similarity))} {tx("similar")}{r.link_status ? ` · ${r.link_status}` : ""}</div>
              </div>
              {!r.link_status && <IconButton label={tx("Connect")} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => connect(r.id)}><Link2 size={13} /></IconButton>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={tx("In the graph")}><Link className="text-[0.83rem] text-mute-bright hover:text-white" to={`/connections?node=${data.nodeId}`}>{tx("Open in Connections →")}</Link></Section>
    </>
  );
}

// ── Memory ───────────────────────────────────────────────────────────────
function Memories() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const qs = new URLSearchParams({ status: "active", ...(q && { q }), ...(cat && { category: cat }) }).toString();
  const { data, loading } = useResource<any[]>(`/memories?${qs}`);
  const [adding, setAdding] = useState(false);
  const can = useCan();
  return (
    <div className="h-full overflow-y-auto px-8 pb-10">
      <div className="flex items-center gap-2 py-4">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search memories")} className="h-9 pl-9" aria-label={tx("Search memories")} />
        </div>
        <Select label={tx("Category")} value={cat} onChange={setCat} className="w-44" options={[{ value: "", label: "All categories" }, ...MEMORY_CATEGORIES.map((c) => ({ value: c, label: label(c) }))]} />
        {can.write && <Button variant="primary" className="ml-auto" icon={<Plus size={14} />} onClick={() => setAdding(true)}>{tx("Add memory")}</Button>}
      </div>
      <p className="mb-4 max-w-2xl text-[0.8rem] leading-relaxed text-mute">{tx("This is everything Orbital remembers about you, and why. Edit anything that's wrong — corrected memories take priority. Delete anything you'd rather it forgot.")}</p>
      {loading && <div className="py-10 text-center"><Pulse /></div>}
      {data?.length === 0 && !q && !cat && <Empty title={tx("No memories yet")}>{tx("Orbital remembers durable things you tell it — goals, skills, decisions, projects. Say “remember that…” in a conversation, or add one here.")}</Empty>}
      <ul className="divide-y divide-line">{data?.map((m) => <MemoryRow key={m.id} m={m} />)}</ul>
      <AddMemory open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function MemoryRow({ m, review }: { m: any; review?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(m.content);
  const [category, setCategory] = useState(m.category);
  const [why, setWhy] = useState(false);
  const update = async (patch: any) => {
    try { await api.patch(`/memories/${m.id}`, patch); invalidate("/memories", "/growth", "/graph"); } catch (e) { toastError(e); }
  };
  const del = async () => {
    if (!confirm(tx("Delete this memory permanently?"))) return;
    try { await api.del(`/memories/${m.id}`); invalidate("/memories", "/growth", "/graph"); } catch (e) { toastError(e); }
  };
  return (
    <li className="py-3.5">
      {editing ? (
        <div className="space-y-2">
          <Textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} aria-label={tx("Memory")} />
          <div className="flex items-center gap-2">
            <Select label={tx("Category")} value={category} onChange={setCategory} className="w-44" options={MEMORY_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} />
            <Button size="sm" variant="primary" onClick={async () => { await update({ content, category, ...(review ? { status: "active" } : {}) }); setEditing(false); }}>{review ? tx("Save & confirm") : tx("Save")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{tx("Cancel")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[0.92rem] leading-relaxed text-white/90">{m.content}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.72rem] text-mute">
              <Badge>{label(m.category)}</Badge>
              {m.user_corrected && <Badge tone="ok">{tx("corrected by you")}</Badge>}
              <span>{m.origin === "extracted" ? tx("Learned from conversation") : m.origin === "research" ? tx("From research") : m.origin === "explicit" ? tx("You asked Orbital to remember") : tx("Added by you")}</span>
              {m.origin === "extracted" && <span>{tx("· confidence")} {pct(m.confidence)}</span>}
              <span>{tx("· importance")} {pct(m.importance)}</span>
              {m.use_count > 0 && <span>· {tn(m.use_count, "used in {n} answer", "used in {n} answers")}</span>}
              <span>· {timeAgo(m.updated_at)}</span>
              <button onClick={() => setWhy(!why)} className="text-mute-bright underline decoration-white/20 underline-offset-2 hover:text-white">{why ? "hide" : "why?"}</button>
            </div>
            {why && (
              <div className="mt-2 space-y-1 border-l border-line pl-3 text-[0.8rem] text-mute-bright">
                {m.reason && <p>{m.reason}</p>}
                {m.source_excerpt && <p className="italic text-mute">“{m.source_excerpt}”</p>}
                {m.source_type === "conversation" && m.source_id && <Link to={`/c/${m.source_id}`} className="text-mute hover:text-white">{tx("From:")} {m.source_title ?? "conversation"} →</Link>}
                {m.source_type === "research" && m.source_id && <Link to={`/research/${m.source_id}`} className="text-mute hover:text-white">{tx("From research →")}</Link>}
                {m.related?.length > 0 && <p className="text-mute">{tx("Connected to:")} {m.related.slice(0, 4).map((r: any) => r.title).join(" · ")}</p>}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {review ? (
              <>
                <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => update({ status: "active" })}>{tx("Confirm")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>{tx("Edit")}</Button>
                <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => update({ status: "rejected" })}>{tx("Reject")}</Button>
              </>
            ) : (
              <>
                <IconButton label={tx("Edit")} onClick={() => setEditing(true)}><PenLine size={14} /></IconButton>
                <IconButton label={tx("Archive")} onClick={() => update({ status: "archived" })}><Archive size={14} /></IconButton>
                <IconButton label={tx("Delete")} onClick={del}><Trash2 size={14} /></IconButton>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function AddMemory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("goal");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post("/memories", { content, category });
      invalidate("/memories", "/growth", "/graph");
      toast(r.duplicate ? tx("Orbital already remembers this — reinforced it") : tx("Memory added"));
      setContent(""); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("Add a memory")}>
      <div className="space-y-3">
        <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder={tx("e.g. Building a scheduling product for independent salons")} aria-label={tx("Memory")} />
        <Select label={tx("Category")} value={category} onChange={setCategory} options={MEMORY_CATEGORIES.map((c) => ({ value: c, label: label(c) }))} />
        <div className="flex justify-end gap-2 pt-1"><Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button variant="primary" loading={busy} disabled={content.trim().length < 3} onClick={submit}>{tx("Add memory")}</Button></div>
      </div>
    </Dialog>
  );
}

// ── Review queue ─────────────────────────────────────────────────────────
function Review() {
  const { data: pending } = useResource<any[]>("/memories?status=pending");
  const { data: graph } = useResource<any>("/graph");
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n: any) => [n.id, n])), [graph]);
  const suggested = (graph?.edges ?? []).filter((e: any) => e.status === "suggested").sort((a: any, b: any) => b.confidence - a.confidence);
  const edge = async (id: string, status: "confirmed" | "rejected") => {
    try { await api.patch(`/edges/${id}`, { status }); invalidate("/graph", "/growth"); } catch (e) { toastError(e); }
  };
  return (
    <div className="h-full overflow-y-auto px-8 pb-10 pt-5">
      <h2 className="text-[0.95rem]">{tx("Proposed memories")}</h2>
      <p className="mt-1 text-[0.8rem] text-mute">{tx("Orbital saves memories automatically only when you stated them clearly. Anything less certain waits here for you.")}</p>
      {pending?.length === 0 ? <p className="mt-4 text-[0.84rem] text-mute">{tx("Nothing waiting.")}</p> : <ul className="mt-2 divide-y divide-line">{pending?.map((m) => <MemoryRow key={m.id} m={m} review />)}</ul>}

      <h2 className="mt-10 text-[0.95rem]">{tx("Suggested connections")}</h2>
      <p className="mt-1 text-[0.8rem] text-mute">{tx("Relationships Orbital noticed. They stay marked as suggestions until you confirm them.")}</p>
      {suggested.length === 0 ? <p className="mt-4 text-[0.84rem] text-mute">{tx("No suggestions right now.")}</p> : (
        <ul className="mt-2 divide-y divide-line">
          {suggested.slice(0, 60).map((e: any) => {
            const a: any = byId.get(e.source_id), b: any = byId.get(e.target_id);
            if (!a || !b) return null;
            return (
              <li key={e.id} className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1 text-[0.88rem]">
                  <Link to={`/connections?node=${a.id}`} className="text-white hover:underline">{a.title}</Link>
                  <span className={cx("mx-2", e.relation === "contradicts" ? "text-amber-200" : "text-mute")}>{label(e.relation)}</span>
                  <Link to={`/connections?node=${b.id}`} className="text-white hover:underline">{b.title}</Link>
                  <div className="mt-1 text-[0.75rem] text-mute">{e.rationale} · {e.origin === "ai" ? tx("AI-classified") : "similarity"} · {pct(e.confidence)}</div>
                </div>
                <Button size="sm" variant="primary" onClick={() => edge(e.id, "confirmed")}>{tx("Confirm")}</Button>
                <Button size="sm" variant="ghost" onClick={() => edge(e.id, "rejected")}>{tx("Reject")}</Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
