import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { ArrowLeft, Cloud, CloudOff, Eye, FileText, Globe, History, ListTree, Loader2, Lock, MessageSquare, Mic, Star } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { invalidate } from "@/lib/resource";
import { DocSync, type SyncStatus } from "@/lib/docSync";
import { onDocEvent } from "@/state/events";
import { useApp } from "@/state/app";
import { toast, toastError } from "@/state/ui";
import { Button, Dialog, Input, Pulse, cx } from "@/components/ui";
import { NotFoundPage } from "@/pages/NotFound";
import { useSpeechInput } from "@/lib/voice";
import { isMac } from "@/lib/format";
import { locale, tx } from "@/i18n";
import { docExtensions } from "./extensions";
import { toMarkdown, toPlainText } from "./convert";
import { keys, MenuBar, Toolbar, type MenuDef } from "./Toolbar";
import { AssistPanel, CommentsPanel, FindBar, groupThreads, Outline, VersionPreview, VersionsPanel, type Thread } from "./Panels";
import "./doc.css";

const PALETTE = ["#ff5a1f", "#ffd23a", "#2cff7a", "#1fd0ff", "#2f7dff", "#b02bff", "#ff2bd6", "#a6ff2e", "#ff9a1a"];
const colorFor = (id: string) => PALETTE[[...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const stored = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** /docs/:id — loads the doc, then hands it to the editor (remounted per doc). */
export function DocEditorPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  useEffect(() => {
    setDoc(null); setError(null);
    api.get(`/docs/${id}`).then(setDoc).catch(setError);
  }, [id]);
  if (error) return error instanceof ApiError && error.status === 404 ? <NotFoundPage what={tx("document")} back={{ to: "/papers", label: tx("Back to Papers") }} /> : <div className="p-10 text-red-300">{error.message}</div>;
  if (!doc) return <div className="grid h-full place-items-center"><Pulse label={tx("Opening document")} /></div>;
  return <DocWorkspace key={doc.id} initial={doc} />;
}

function DocWorkspace({ initial }: { initial: any }) {
  const navigate = useNavigate();
  const user = useApp((s) => s.user)!;
  const workspace = useApp((s) => s.workspace);
  const ai = useApp((s) => s.ai);
  const canWrite = !!initial.canWrite;
  const docId: string = initial.id;
  const [sync] = useState(() => new DocSync(docId, initial.ydoc, canWrite));
  const meta = useMemo(() => sync.doc.getMap<string>("meta"), [sync]);
  const [title, setTitle] = useState<string>(() => (meta.get("title") as string) ?? initial.title);
  const [status, setStatus] = useState<SyncStatus>(sync.status);
  const [peers, setPeers] = useState<{ id: number; name: string; color: string }[]>([]);
  const [starred, setStarred] = useState(!!initial.starred);
  const [zoom, setZoomState] = useState(() => Number(stored("orbital.docs.zoom", "100")) || 100);
  const [paper, setPaper] = useState(() => stored("orbital.docs.paper", "light") === "light");
  const [outline, setOutline] = useState(() => stored("orbital.docs.outline", "1") === "1" && window.innerWidth > 1200);
  const [side, setSide] = useState<"comments" | "versions" | "assist" | null>(null);
  const [find, setFind] = useState<null | { replace: boolean }>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [draft, setDraft] = useState<{ quote: string } | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [version, setVersion] = useState<any | null>(null);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  // Shrink the page to fit when panels leave less room than it needs (like a word processor's "fit").
  const scroller = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(2000);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth - 32));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = window.innerWidth <= 900 ? 1 : Math.min(1, Math.max(0.5, room / 818));
  const titleRef = useRef<HTMLInputElement>(null);
  const pendingClick = useRef<(() => void) | null>(null);
  const me = useMemo(() => ({ name: user.displayName || user.email.split("@")[0], color: colorFor(user.id) }), [user]);

  const editor = useEditor({
    extensions: docExtensions({ collab: { doc: sync.doc, awareness: sync.caretAwareness, user: me }, placeholder: canWrite ? tx("Type here, or ask Orbital to write…") : undefined }),
    editable: canWrite,
    immediatelyRender: true,
    editorProps: {
      attributes: { class: "doc-body", spellcheck: "true", "aria-label": tx("Document text"), lang: locale() },
      handlePaste: (_view, event) => insertImageFiles(event.clipboardData?.files),
      // A click is read from the browser's selection a moment later. If someone else's cursor redraws in
      // that instant, the browser's report can be dropped and the caret stays where it was. So shortly
      // after each click, make sure the caret is where you clicked.
      handleClick: (view, pos, event) => {
        if (event.shiftKey || event.detail > 1) return false;
        const doc = view.state.doc;
        const check = () => {
          pendingClick.current = null;
          if (view.isDestroyed || (view.state.doc !== doc && !view.state.doc.eq(doc))) return;
          const target = TextSelection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)));
          const cur = view.state.selection;
          // Node selections (a clicked image) are the click's own doing; anything else should be a caret at the click.
          if (!(cur instanceof NodeSelection) && (cur.from !== target.from || cur.to !== target.to)) view.dispatch(view.state.tr.setSelection(target));
        };
        pendingClick.current = check;
        setTimeout(() => { if (pendingClick.current === check) check(); }, 40);
        return false;
      },
      // Typing straight after a click: settle the click first.
      handleKeyDown: () => { pendingClick.current?.(); return false; },
      handleDrop: (_view, event) => insertImageFiles((event as DragEvent).dataTransfer?.files),
    },
  }, [sync]);

  function insertImageFiles(files?: FileList | null) {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!images.length || !canWrite) return false;
    images.forEach((f) => void imageToDataUrl(f).then((src) => editor?.chain().focus().setImage({ src, alt: f.name }).run()).catch(toastError));
    return true;
  }

  // ── Live state: status, presence, title, comments ─────────────────────────
  useEffect(() => sync.onStatus(setStatus), [sync]);
  useEffect(() => {
    const update = () => {
      const list: { id: number; name: string; color: string }[] = [];
      sync.awareness.getStates().forEach((st: any, id) => { if (id !== sync.doc.clientID && st.user) list.push({ id, ...st.user }); });
      setPeers(list);
    };
    sync.awareness.on("change", update);
    return () => sync.awareness.off("change", update);
  }, [sync]);
  useEffect(() => {
    const obs = () => { const t = meta.get("title"); if (typeof t === "string" && document.activeElement !== titleRef.current) setTitle(t); };
    meta.observe(obs);
    return () => meta.unobserve(obs);
  }, [meta]);
  useEffect(() => () => sync.destroy(), [sync]);
  // The page needs the room: close the app's context panel while writing, and bring it back after.
  useEffect(() => {
    const { rightPanel, toggleRightPanel } = useApp.getState();
    if (rightPanel) toggleRightPanel(false);
    return () => { if (rightPanel) useApp.getState().toggleRightPanel(true); };
  }, []);
  useEffect(() => { document.title = `${title || tx("Untitled document")} · Orbital`; return () => { document.title = "Orbital"; }; }, [title]);

  const loadComments = useCallback(() => { api.get(`/docs/${docId}/comments`).then((rows) => setThreads(groupThreads(rows))).catch(() => {}); }, [docId]);
  useEffect(() => { loadComments(); }, [loadComments]);
  useEffect(() => onDocEvent((e) => { if (e.docId === docId && e.type === "doc.comments") loadComments(); }), [docId, loadComments]);
  useEffect(() => { if (threads.some((t) => !t.resolved) && window.innerWidth > 1100 && side === null) setSide("comments"); }, [threads.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── First open of a doc made from a template, note or copy ────────────────
  useEffect(() => {
    if (!editor || initial.ydoc || !initial.html || !canWrite) return;
    api.post(`/docs/${docId}/seed`).then((r) => {
      if (r.seed && editor.isEmpty) {
        editor.commands.setContent(initial.html);
        if (!meta.get("title")) meta.set("title", initial.title);
        editor.commands.focus("end");
      }
    }).catch(() => {});
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editor && canWrite && editor.isEmpty && !initial.html && !initial.ydoc) titleRef.current?.select(); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snapshot (what search, answers and exports read), a moment after edits settle ─
  const dirty = useRef(false);
  const saveSnapshot = useCallback(async () => {
    if (!editor || !dirty.current || !canWrite) return;
    dirty.current = false;
    const json = editor.getJSON();
    try {
      await api.putQuiet(`/docs/${docId}/snapshot`, {
        title: (meta.get("title") as string) || title || tx("Untitled document"),
        html: editor.getHTML(), text: toMarkdown(json), words: editor.storage.characterCount.words(),
      });
      invalidate("/docs");
    } catch { dirty.current = true; }
  }, [editor, docId, meta, title, canWrite]);
  useEffect(() => {
    if (!canWrite) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = 0;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === "remote" || origin === "server") return;
      dirty.current = true;
      if (!first) first = Date.now();
      if (timer) clearTimeout(timer);
      // Save 1.5 s after typing stops, and at least every 8 s while it continues.
      timer = setTimeout(() => { first = 0; void saveSnapshot(); }, Date.now() - first > 8000 ? 0 : 1500);
    };
    sync.doc.on("update", onUpdate);
    const beforeUnload = (e: BeforeUnloadEvent) => { if (sync.hasPending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { sync.doc.off("update", onUpdate); if (timer) clearTimeout(timer); window.removeEventListener("beforeunload", beforeUnload); void saveSnapshot(); };
  }, [sync, saveSnapshot, canWrite]);

  // ── Comments: highlight the active thread; clicking a highlighted passage opens it ─
  useEffect(() => {
    if (!editor) return;
    const onSel = () => {
      const m = editor.state.selection.$from.marks().find((x) => x.type.name === "comment");
      if (m) { setActiveThread(m.attrs.threadId); setSide((s) => s ?? "comments"); }
    };
    editor.on("selectionUpdate", onSel);
    return () => { editor.off("selectionUpdate", onSel); };
  }, [editor]);
  const commentCss = useMemo(() => {
    const resolved = threads.filter((t) => t.resolved).map((t) => `.doc-comment[data-comment="${t.id}"]{background:none;border-bottom:0;cursor:text}`);
    const active = activeThread ? `.doc-comment[data-comment="${activeThread}"]{background:rgba(255,190,30,.6)}` : "";
    return resolved.join("") + active;
  }, [threads, activeThread]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const setZoom = (z: number) => { setZoomState(z); store("orbital.docs.zoom", String(z)); };
  const changeTitle = (t: string) => { setTitle(t); if (canWrite) meta.set("title", t); };
  const addComment = () => {
    if (!editor || editor.state.selection.empty) { toast(tx("Select the text you want to comment on.")); return; }
    const { from, to } = editor.state.selection;
    setDraft({ quote: editor.state.doc.textBetween(from, to, " ") });
    setSide("comments");
  };
  const print = () => {
    if (!editor) return;
    setPrintHtml(`<h1 class="print-title" style="font-size:20pt;font-weight:400;margin:0 0 18pt">${escapeHtml(title)}</h1>${editor.getHTML()}`);
    setTimeout(() => { window.print(); setPrintHtml(null); }, 60);
  };
  const download = (kind: "md" | "txt" | "html" | "doc") => {
    if (!editor) return;
    const name = (title || tx("Untitled document")).replace(/[\\/:*?"<>|]+/g, " ").trim() || "document";
    const html = editor.getHTML();
    const page = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.55;color:#111}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}img{max-width:100%}</style></head><body><h1>${escapeHtml(title)}</h1>${html}</body></html>`;
    const files = {
      md: { data: `# ${title}\n\n${toMarkdown(editor.getJSON())}\n`, type: "text/markdown", ext: "md" },
      txt: { data: `${title}\n\n${toPlainText(editor.getJSON())}\n`, type: "text/plain", ext: "txt" },
      html: { data: page, type: "text/html", ext: "html" },
      // Word opens HTML saved with its own MIME type and extension, keeping headings, lists, tables and formatting.
      doc: { data: `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">${page.slice(page.indexOf("<head>"))}`, type: "application/msword", ext: "doc" },
    }[kind];
    const url = URL.createObjectURL(new Blob(["﻿", files.data], { type: `${files.type};charset=utf-8` }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.${files.ext}` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const copyDoc = async () => { try { const c = await api.post(`/docs/${docId}/copy`, { title: tx("Copy of {title}", { title }) }); navigate(`/papers/${c.id}`); } catch (e) { toastError(e); } };
  const newDoc = async () => { try { const d = await api.post("/docs", { title: tx("Untitled document") }); navigate(`/papers/${d.id}`); } catch (e) { toastError(e); } };
  const remove = async () => {
    if (!confirm(tx("Delete “{title}”? This can't be undone.", { title }))) return;
    try { await api.del(`/docs/${docId}`); invalidate("/docs"); navigate("/papers"); toast(tx("Document deleted")); } catch (e) { toastError(e); }
  };
  const toggleStar = async () => { try { await api.post(`/docs/${docId}/star`, { on: !starred }); setStarred(!starred); invalidate("/docs"); } catch (e) { toastError(e); } };
  const restore = (v: any) => {
    if (!editor || !version) return;
    editor.commands.setContent(version.html);
    if (version.title) changeTitle(version.title);
    setVersion(null); setSide(null);
    toast(tx("Version restored. Undo brings back what was there."));
    void v;
  };
  const insertDate = () => editor?.chain().focus().insertContent(new Date().toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" })).run();

  // ── Voice typing ──────────────────────────────────────────────────────────
  const [interim, setInterim] = useState("");
  const voice = useSpeechInput({
    continuous: true,
    onInterim: setInterim,
    onFinal: (text) => { setInterim(""); editor?.chain().focus().insertContent(`${text} `).run(); },
  });
  const toggleVoice = () => { if (voice.listening) voice.stop(); else if (!voice.available) toast(tx("Voice typing isn't available in this browser. Try Chrome, Edge or Safari.")); else void voice.start(); };
  useEffect(() => { if (voice.error) toast(tx(voice.error), { tone: "error" }); }, [voice.error]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = e.metaKey || e.ctrlKey;
      if (!m) { if (e.key === "Escape" && find) setFind(null); return; }
      const k = e.key.toLowerCase();
      // Handled here first (capture), and kept from the app's own shortcuts (⌘K palette, ⌘\ sidebar).
      const take = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
      if (k === "f" && !e.shiftKey) take(() => setFind({ replace: false }));
      // ⌘H hides the app on a Mac, so find & replace is ⌘⇧H there (as in other Mac word processors).
      else if (k === "h" && (isMac ? e.shiftKey : !e.shiftKey)) take(() => setFind({ replace: true }));
      else if (k === "p" && !e.shiftKey) take(print);
      else if (k === "k" && !e.shiftKey && canWrite && editor?.isFocused) take(() => setLinkOpen(true));
      else if (e.code === "KeyM" && e.altKey && canWrite) take(addComment);
      else if (k === "\\" && canWrite && editor?.isFocused) take(() => editor?.chain().focus().unsetAllMarks().run());
      else if (k === "s" && !e.shiftKey && !e.altKey) take(() => { void sync.flush(); void saveSnapshot(); toast(tx("Every change is saved automatically.")); });
      else if (e.shiftKey && k === "c" && !e.altKey) take(() => setWordsOpen(true));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // re-bound every render so handlers see current state

  const words = useEditorState({ editor, selector: ({ editor: e }) => (e ? { words: e.storage.characterCount.words(), chars: e.storage.characterCount.characters(), sel: e.state.selection.empty ? 0 : (e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length } : { words: 0, chars: 0, sel: 0 }) });

  if (!editor) return null;
  const openThreads = threads.filter((t) => !t.resolved).length;
  const menus: MenuDef[] = [
    { label: "File", items: [
      { label: "New document", run: newDoc, disabled: !canWrite },
      { label: "Make a copy", run: copyDoc, disabled: !canWrite },
      { label: "Rename", run: () => titleRef.current?.select(), disabled: !canWrite },
      { label: starred ? "Remove star" : "Star", run: toggleStar },
      "-",
      { label: "Download as PDF", run: print },
      { label: "Download as Word (.doc)", run: () => download("doc") },
      { label: "Download as Markdown (.md)", run: () => download("md") },
      { label: "Download as plain text (.txt)", run: () => download("txt") },
      { label: "Download as web page (.html)", run: () => download("html") },
      "-",
      { label: "Version history", run: () => setSide("versions") },
      { label: "Print", shortcut: `${keys.mod}P`, run: print },
      "-",
      { label: "Move to trash", run: remove, disabled: !canWrite },
    ] },
    { label: "Edit", items: [
      { label: "Undo", shortcut: `${keys.mod}Z`, run: () => editor.chain().focus().undo().run(), disabled: !canWrite },
      { label: "Redo", shortcut: `${keys.mod}${keys.shift}Z`, run: () => editor.chain().focus().redo().run(), disabled: !canWrite },
      "-",
      { label: "Select all", shortcut: `${keys.mod}A`, run: () => editor.chain().focus().selectAll().run() },
      { label: "Find and replace", shortcut: isMac ? `${keys.mod}${keys.shift}H` : `${keys.mod}H`, run: () => setFind({ replace: true }) },
    ] },
    { label: "View", items: [
      { label: "Show outline", checked: outline, run: () => { setOutline(!outline); store("orbital.docs.outline", outline ? "0" : "1"); } },
      { label: "Show comments", checked: side === "comments", run: () => setSide(side === "comments" ? null : "comments") },
      "-",
      { label: "Paper page", checked: paper, run: () => { setPaper(true); store("orbital.docs.paper", "light"); } },
      { label: "Dark page", checked: !paper, run: () => { setPaper(false); store("orbital.docs.paper", "dark"); } },
      "-",
      ...[75, 100, 125, 150].map((z) => ({ label: `${z}%`, checked: zoom === z, run: () => setZoom(z) })),
    ] },
    ...(canWrite ? [
      { label: "Insert", items: [
        { label: "Image", run: () => imageInput.current?.click() },
        { label: "Table", run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
        { label: "Link", shortcut: `${keys.mod}K`, run: () => setLinkOpen(true) },
        { label: "Comment", shortcut: `${keys.mod}${keys.alt}M`, run: addComment },
        "-",
        { label: "Checklist", run: () => editor.chain().focus().toggleTaskList().run() },
        { label: "Horizontal line", run: () => editor.chain().focus().setHorizontalRule().run() },
        { label: "Page break", shortcut: `${keys.mod}↵`, run: () => editor.chain().focus().setPageBreak().run() },
        { label: "Today's date", run: insertDate },
      ] as MenuDef["items"] },
      { label: "Format", items: [
        { label: "Bold", shortcut: `${keys.mod}B`, run: () => editor.chain().focus().toggleBold().run() },
        { label: "Italic", shortcut: `${keys.mod}I`, run: () => editor.chain().focus().toggleItalic().run() },
        { label: "Underline", shortcut: `${keys.mod}U`, run: () => editor.chain().focus().toggleUnderline().run() },
        { label: "Strikethrough", shortcut: `${keys.mod}${keys.shift}S`, run: () => editor.chain().focus().toggleStrike().run() },
        "-",
        { label: "Normal text", shortcut: `${keys.mod}${keys.alt}0`, run: () => editor.chain().focus().setParagraph().run() },
        ...[1, 2, 3].map((l) => ({ label: `Heading ${l}`, shortcut: `${keys.mod}${keys.alt}${l}`, run: () => editor.chain().focus().setHeading({ level: l as 1 | 2 | 3 }).run() })),
        "-",
        { label: "Add row below", run: () => editor.chain().focus().addRowAfter().run(), disabled: !editor.isActive("table") },
        { label: "Add column right", run: () => editor.chain().focus().addColumnAfter().run(), disabled: !editor.isActive("table") },
        { label: "Delete row", run: () => editor.chain().focus().deleteRow().run(), disabled: !editor.isActive("table") },
        { label: "Delete column", run: () => editor.chain().focus().deleteColumn().run(), disabled: !editor.isActive("table") },
        { label: "Delete table", run: () => editor.chain().focus().deleteTable().run(), disabled: !editor.isActive("table") },
        "-",
        { label: "Clear formatting", shortcut: `${keys.mod}\\`, run: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
      ] as MenuDef["items"] },
    ] : []),
    { label: "Tools", items: [
      { label: "Word count", shortcut: `${keys.mod}${keys.shift}C`, run: () => setWordsOpen(true) },
      ...(canWrite ? [
        { label: "Voice typing", run: toggleVoice, checked: voice.listening },
        { label: "Ask Orbital", run: () => setSide("assist") },
      ] : []),
    ] },
  ];

  const statusEl = status === "readonly" ? <span className="flex items-center gap-1.5"><Eye size={13} />{tx("View only")}</span>
    : status === "offline" ? <span className="flex items-center gap-1.5 text-amber-300/90"><CloudOff size={13} />{tx("Offline: changes will sync when you reconnect")}</span>
    : status === "saving" ? <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />{tx("Saving…")}</span>
    : status === "connecting" ? <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" />{tx("Connecting…")}</span>
    : <span className="flex items-center gap-1.5"><Cloud size={13} />{tx("All changes saved")}</span>;

  return (
    <div className="flex h-full flex-col">
      <style>{commentCss}</style>
      {/* Title row + menus */}
      <header className="flex items-start gap-3 px-4 pb-2 pt-2.5">
        <Link to="/papers" aria-label={tx("Back to Papers")} title={tx("Back to Papers")} className="mt-1.5 rounded-md p-1.5 text-mute hover:bg-white/[0.06] hover:text-white"><ArrowLeft size={16} /></Link>
        <FileText size={30} strokeWidth={1.2} className="mt-1 shrink-0 text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input ref={titleRef} value={title} onChange={(e) => changeTitle(e.target.value)} readOnly={!canWrite} aria-label={tx("Document name")} placeholder={tx("Untitled document")}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor.commands.focus(); } }}
              style={{ width: `${Math.min(56, Math.max(10, title.length + 2))}ch` }}
              className="min-w-0 rounded border border-transparent bg-transparent px-1 text-[1.05rem] text-white outline-none hover:border-white/15 focus:border-sky-400" />
            <button aria-label={starred ? tx("Remove star") : tx("Star")} title={starred ? tx("Remove star") : tx("Star")} onClick={toggleStar} className="rounded p-1 text-mute hover:text-white"><Star size={15} className={starred ? "fill-amber-300 text-amber-300" : ""} /></button>
            <span className="hidden items-center gap-1 text-[0.72rem] text-mute sm:flex" title={workspace?.kind === "business" ? tx("Everyone in {name} can open this document", { name: workspace.name }) : tx("Only you can open this document")}>
              {workspace?.kind === "business" ? <Globe size={12} /> : <Lock size={12} />}{workspace?.kind === "business" ? workspace.name : tx("Private")}
            </span>
            <span className="ml-1 hidden text-[0.74rem] text-mute md:block" aria-live="polite">{statusEl}</span>
          </div>
          <MenuBar menus={menus} />
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          <div className="flex -space-x-1.5" aria-label={tx("People in this document")}>
            {peers.slice(0, 5).map((p) => <span key={p.id} title={p.name} className="grid h-8 w-8 place-items-center rounded-full border-2 text-[0.72rem] font-medium text-black" style={{ background: p.color, borderColor: "#000" }}>{p.name.slice(0, 1).toUpperCase()}</span>)}
            {peers.length > 5 && <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-black bg-white/20 text-[0.7rem]">+{peers.length - 5}</span>}
          </div>
          <button onClick={() => setSide(side === "versions" ? null : "versions")} aria-label={tx("Version history")} title={tx("Version history")} className={cx("rounded-full p-2 hover:bg-white/[0.06]", side === "versions" ? "text-white" : "text-mute")}><History size={17} /></button>
          <button onClick={() => setSide(side === "comments" ? null : "comments")} aria-label={tx("Comments")} title={tx("Comments")} className={cx("relative rounded-full p-2 hover:bg-white/[0.06]", side === "comments" ? "text-white" : "text-mute")}>
            <MessageSquare size={17} />{openThreads > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-amber-300 px-1 text-[0.6rem] leading-[14px] text-black">{openThreads}</span>}
          </button>
          <button onClick={() => { setOutline(!outline); store("orbital.docs.outline", outline ? "0" : "1"); }} aria-label={tx("Show outline")} title={tx("Show outline")} className={cx("hidden rounded-full p-2 hover:bg-white/[0.06] lg:block", outline ? "text-white" : "text-mute")}><ListTree size={17} /></button>
        </div>
      </header>
      <div className="px-4 pb-2">
        <Toolbar editor={editor} canWrite={canWrite} zoom={zoom} setZoom={setZoom} onPrint={print} onLink={() => setLinkOpen(true)} onImage={() => imageInput.current?.click()}
          onComment={addComment} onAssist={() => setSide(side === "assist" ? null : "assist")} onVoice={toggleVoice} voiceActive={voice.listening} />
      </div>

      {/* Canvas */}
      <div className={cx("doc-canvas relative flex min-h-0 flex-1 border-t border-line", paper && "paper")}>
        {outline && <div className="hidden w-[220px] shrink-0 overflow-y-auto px-4 py-6 lg:block"><Outline editor={editor} /></div>}
        <div ref={scroller} className="min-w-0 flex-1 overflow-auto px-4 py-6" onMouseDown={(e) => { if (e.target === e.currentTarget && canWrite) editor.commands.focus("end"); }}>
          {version ? (
            <div style={{ zoom: (zoom / 100) * fit }}>
              <div className="mx-auto mb-3 flex max-w-[816px] items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-[0.8rem] text-sky-100">
                <History size={14} />{tx("Viewing a saved version from {when}", { when: new Date(version.created_at).toLocaleString(locale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })}
                <button onClick={() => setVersion(null)} className="ml-auto underline">{tx("Back to current")}</button>
              </div>
              <VersionPreview html={version.html} paper={paper} />
            </div>
          ) : (
            <div style={{ zoom: (zoom / 100) * fit }}>
              <div className={cx("doc-page doc-content", paper && "paper")}><EditorContent editor={editor} /></div>
            </div>
          )}
        </div>
        {find && <div className="absolute right-6 top-3 z-30"><FindBar editor={editor} replace={find.replace} canWrite={canWrite} onClose={() => { setFind(null); editor.commands.focus(); }} /></div>}
        {side && (
          <div className="w-[320px] shrink-0 overflow-y-auto border-l border-line bg-black/40 p-4">
            {side === "comments" && <CommentsPanel docId={docId} editor={editor} threads={threads} draft={draft} onDraftDone={() => setDraft(null)} active={activeThread} onActivate={setActiveThread} canWrite={canWrite} reload={loadComments} />}
            {side === "versions" && <VersionsPanel docId={docId} selected={version?.id ?? null} onSelect={setVersion} onRestore={restore} canWrite={canWrite} onClose={() => { setSide(null); setVersion(null); }} />}
            {side === "assist" && <AssistPanel docId={docId} editor={editor} title={title} aiAvailable={!!ai && ai.provider !== "none"} onClose={() => setSide(null)} />}
          </div>
        )}
        <button onClick={() => setWordsOpen(true)} className="absolute bottom-3 left-4 rounded-full border border-line bg-black/70 px-3 py-1 text-[0.72rem] text-mute-bright backdrop-blur hover:text-white">
          {words.sel ? tx("{sel} of {n} words", { sel: words.sel, n: words.words.toLocaleString(locale()) }) : tx("{n} words", { n: words.words.toLocaleString(locale()) })}
        </button>
        {voice.listening && (
          <div className="absolute bottom-3 left-1/2 flex max-w-[60%] -translate-x-1/2 items-center gap-2 rounded-full border border-red-400/40 bg-black/80 px-4 py-1.5 text-[0.8rem] text-white backdrop-blur">
            <Mic size={14} className="animate-pulse text-red-400" /><span className="truncate">{interim || tx("Listening… speak, then press the microphone again to insert.")}</span>
            <button onClick={() => voice.stop()} className="ml-1 text-[0.74rem] text-mute-bright underline">{tx("Stop")}</button>
          </div>
        )}
      </div>

      <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => { insertImageFiles(e.target.files); e.target.value = ""; }} />
      <LinkDialog open={linkOpen} editor={editor} onClose={() => setLinkOpen(false)} />
      <Dialog open={wordsOpen} onClose={() => setWordsOpen(false)} title={tx("Word count")}>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[0.88rem]">
          <dt className="text-mute">{tx("Words")}</dt><dd className="text-right text-white">{words.words.toLocaleString(locale())}</dd>
          <dt className="text-mute">{tx("Characters")}</dt><dd className="text-right text-white">{words.chars.toLocaleString(locale())}</dd>
          <dt className="text-mute">{tx("Reading time")}</dt><dd className="text-right text-white">{tx("{n} min", { n: Math.max(1, Math.round(words.words / 230)) })}</dd>
          {words.sel > 0 && <><dt className="text-mute">{tx("Selected words")}</dt><dd className="text-right text-white">{words.sel.toLocaleString(locale())}</dd></>}
        </dl>
      </Dialog>
      {printHtml !== null && createPortal(<div className="doc-content"><div className="ProseMirror" dangerouslySetInnerHTML={{ __html: printHtml }} /></div>, ensurePrintRoot())}
    </div>
  );
}

function LinkDialog({ open, editor, onClose }: { open: boolean; editor: Editor; onClose: () => void }) {
  const [text, setText] = useState("");
  const [href, setHref] = useState("");
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const { from, to, empty } = editor.state.selection;
    const existing = editor.getAttributes("link").href as string | undefined;
    if (existing && empty) { editor.chain().extendMarkRange("link").run(); }
    const sel = editor.state.selection;
    setRange({ from: sel.from, to: sel.to });
    setText(editor.state.doc.textBetween(sel.from, sel.to, " ") || (empty ? "" : editor.state.doc.textBetween(from, to, " ")));
    setHref(existing ?? "");
  }, [open, editor]);
  const apply = () => {
    if (!range) return;
    let url = href.trim();
    if (!url) { editor.chain().focus().setTextSelection(range).unsetLink().run(); onClose(); return; }
    if (!/^(https?:|mailto:|tel:|#|\/)/i.test(url)) url = `https://${url}`;
    const label = text.trim() || url;
    editor.chain().focus().insertContentAt(range, { type: "text", text: label, marks: [{ type: "link", attrs: { href: url } }] }).run();
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("Link")}>
      <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="space-y-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Text")} aria-label={tx("Text")} />
        <Input value={href} onChange={(e) => setHref(e.target.value)} placeholder={tx("Paste or type a link")} aria-label={tx("Link address")} />
        <div className="flex justify-end gap-2">
          {editor.isActive("link") && <Button type="button" variant="ghost" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); onClose(); }}>{tx("Remove link")}</Button>}
          <Button type="submit" variant="primary">{tx("Apply")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ensurePrintRoot() {
  let el = document.getElementById("doc-print-root");
  if (!el) { el = document.createElement("div"); el.id = "doc-print-root"; document.body.appendChild(el); }
  return el;
}
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Images are stored inside the doc, scaled down so a photo doesn't make it slow to sync. */
function imageToDataUrl(file: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 20 * 1024 * 1024) { reject(new Error(tx("That image is too large (20 MB max)."))); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const png = file.type === "image/png" || file.type === "image/gif";
      resolve(canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tx("Couldn't read that image."))); };
    img.src = url;
  });
}
