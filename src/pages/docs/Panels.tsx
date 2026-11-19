import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Check, ChevronDown, ChevronUp, CornerDownLeft, History, Loader2, MessageSquare, RotateCcw, Sparkles, Tag, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { toast, toastError } from "@/state/ui";
import { Button, Input, Textarea, cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { locale, tx } from "@/i18n";
import { docExtensions, searchState } from "./extensions";
import { markdownToHtml } from "./convert";

// ── Outline ─────────────────────────────────────────────────────────────────
export function Outline({ editor }: { editor: Editor }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: { level: number; text: string; pos: number }[] = [];
      e.state.doc.forEach((node, pos) => { if (node.type.name === "heading" && node.textContent.trim()) out.push({ level: node.attrs.level, text: node.textContent, pos }); });
      return out;
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const go = (pos: number) => {
    editor.chain().focus().setTextSelection(pos + 1).run();
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <nav aria-label={tx("Document outline")} className="text-[0.8rem]">
      <div className="label mb-2">{tx("Outline")}</div>
      {headings.length === 0 ? <p className="leading-relaxed text-mute">{tx("Headings you add to the document will appear here.")}</p> : (
        <ul className="space-y-0.5">
          {headings.map((h, i) => (
            <li key={i}><button onClick={() => go(h.pos)} className="block w-full truncate rounded px-2 py-1 text-left text-mute-bright hover:bg-white/[0.05] hover:text-white" style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>{h.text}</button></li>
          ))}
        </ul>
      )}
    </nav>
  );
}

// ── Find & replace ──────────────────────────────────────────────────────────
export function FindBar({ editor, replace, canWrite, onClose }: { editor: Editor; replace: boolean; canWrite: boolean; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [rep, setRep] = useState("");
  const [cs, setCs] = useState(false);
  const [showReplace, setShowReplace] = useState(replace);
  const input = useRef<HTMLInputElement>(null);
  const st = useEditorState({ editor, selector: ({ editor: e }) => { const s = searchState(e); return { n: s.results.length, i: s.index }; } });
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => { setShowReplace((r) => r || replace); }, [replace]);
  useEffect(() => { editor.commands.setSearch(term, cs); }, [term, cs, editor]);
  useEffect(() => () => { editor.commands.setSearch(""); }, [editor]);
  const field = "h-8 rounded-md border border-line bg-black/40 px-2.5 text-[0.82rem] text-white outline-none focus:border-sky-400";
  return (
    <div className="w-[360px] rounded-xl border border-line-strong bg-ink-2 p-3 shadow-2xl" role="search">
      <div className="flex items-center gap-1.5">
        <input ref={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tx("Find in document")} aria-label={tx("Find in document")} className={cx(field, "flex-1")}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? editor.commands.searchPrev() : editor.commands.searchNext(); } if (e.key === "Escape") onClose(); }} />
        <span className="w-14 text-center text-[0.72rem] text-mute">{term ? tx("{i} of {n}", { i: st.n ? st.i + 1 : 0, n: st.n }) : ""}</span>
        <button aria-label={tx("Previous match")} onClick={() => editor.commands.searchPrev()} className="rounded p-1 text-mute hover:text-white"><ChevronUp size={15} /></button>
        <button aria-label={tx("Next match")} onClick={() => editor.commands.searchNext()} className="rounded p-1 text-mute hover:text-white"><ChevronDown size={15} /></button>
        <button aria-label={tx("Close")} onClick={onClose} className="rounded p-1 text-mute hover:text-white"><X size={15} /></button>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[0.74rem] text-mute">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} className="accent-sky-400" />{tx("Match case")}</label>
        {canWrite && !showReplace && <button onClick={() => setShowReplace(true)} className="hover:text-white">{tx("Replace…")}</button>}
      </div>
      {canWrite && showReplace && (
        <div className="mt-2 flex items-center gap-1.5">
          <input value={rep} onChange={(e) => setRep(e.target.value)} placeholder={tx("Replace with")} aria-label={tx("Replace with")} className={cx(field, "flex-1")}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor.commands.replaceCurrent(rep); } }} />
          <Button size="sm" variant="ghost" disabled={!st.n} onClick={() => editor.commands.replaceCurrent(rep)}>{tx("Replace")}</Button>
          <Button size="sm" disabled={!st.n} onClick={() => { const n = st.n; editor.commands.replaceAll(rep); toast(tx("Replaced {n} matches", { n })); }}>{tx("All")}</Button>
        </div>
      )}
    </div>
  );
}

// ── Comments ────────────────────────────────────────────────────────────────
export interface Thread { id: string; quote: string; resolved: boolean; comments: any[] }

export function groupThreads(rows: any[]): Thread[] {
  const map = new Map<string, Thread>();
  for (const r of rows) {
    const t: Thread = map.get(r.thread_id) ?? { id: r.thread_id, quote: "", resolved: r.resolved, comments: [] as any[] };
    if (!t.quote && r.quote) t.quote = r.quote;
    t.resolved = r.resolved;
    t.comments.push(r);
    map.set(r.thread_id, t);
  }
  return [...map.values()];
}

export function CommentsPanel({ docId, editor, threads, draft, onDraftDone, active, onActivate, canWrite, reload }: {
  docId: string; editor: Editor; threads: Thread[]; draft: { quote: string } | null; onDraftDone: () => void;
  active: string | null; onActivate: (id: string | null) => void; canWrite: boolean; reload: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);

  const start = async () => {
    if (!text.trim() || !draft) return;
    setBusy(true);
    const threadId = crypto.randomUUID();
    try {
      await api.post(`/docs/${docId}/comments`, { threadId, quote: draft.quote.slice(0, 2000), body: text.trim() });
      editor.chain().setComment(threadId).run();
      setText(""); onDraftDone(); onActivate(threadId); reload();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <aside aria-label={tx("Comments")} className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="label">{tx("Comments")}</div>
        {resolved.length > 0 && <button onClick={() => setShowResolved(!showResolved)} className="ml-auto text-[0.72rem] text-mute hover:text-white">{showResolved ? tx("Hide resolved") : tx("Show resolved ({n})", { n: resolved.length })}</button>}
      </div>
      {draft && (
        <div className="rounded-xl border border-sky-400/40 bg-ink-2 p-3 shadow-xl">
          <p className="mb-2 line-clamp-2 border-l-2 border-amber-300/70 pl-2 text-[0.76rem] italic text-mute-bright">{draft.quote}</p>
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Add a comment")} aria-label={tx("Add a comment")} rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start(); if (e.key === "Escape") onDraftDone(); }} />
          <div className="mt-2 flex justify-end gap-1.5"><Button size="sm" variant="ghost" onClick={onDraftDone}>{tx("Cancel")}</Button><Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={start}>{tx("Comment")}</Button></div>
        </div>
      )}
      {open.length === 0 && !draft && <p className="text-[0.8rem] leading-relaxed text-mute">{tx("Select text and press the comment button to start a discussion about it.")}</p>}
      {[...open, ...(showResolved ? resolved : [])].map((t) => <ThreadCard key={t.id} t={t} docId={docId} editor={editor} active={active === t.id} onActivate={onActivate} canWrite={canWrite} reload={reload} />)}
    </aside>
  );
}

function ThreadCard({ t, docId, editor, active, onActivate, canWrite, reload }: { t: Thread; docId: string; editor: Editor; active: boolean; onActivate: (id: string | null) => void; canWrite: boolean; reload: () => void }) {
  const [reply, setReply] = useState("");
  const send = async () => {
    if (!reply.trim()) return;
    try { await api.post(`/docs/${docId}/comments`, { threadId: t.id, body: reply.trim() }); setReply(""); reload(); } catch (e) { toastError(e); }
  };
  const resolve = async (resolved: boolean) => { try { await api.patch(`/docs/${docId}/threads/${t.id}`, { resolved }); reload(); if (resolved) onActivate(null); } catch (e) { toastError(e); } };
  const remove = async (cid: string) => {
    try {
      await api.del(`/docs/${docId}/comments/${cid}`);
      if (t.comments.length === 1) editor.commands.unsetComment(t.id);
      reload();
    } catch (e) { toastError(e); }
  };
  const jump = () => {
    onActivate(t.id);
    let found: number | null = null;
    editor.state.doc.descendants((node, pos) => { if (found === null && node.marks.some((m) => m.type.name === "comment" && m.attrs.threadId === t.id)) found = pos; });
    if (found !== null) (editor.view.domAtPos(found).node as HTMLElement)?.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  return (
    <div onClick={jump} className={cx("cursor-pointer rounded-xl border bg-ink-2 p-3 transition-all", active ? "border-amber-300/60 shadow-xl" : "border-line hover:border-line-strong", t.resolved && "opacity-60")}>
      {t.quote && <p className="mb-2 line-clamp-2 border-l-2 border-amber-300/70 pl-2 text-[0.74rem] italic text-mute">{t.quote}</p>}
      <ul className="space-y-2.5">
        {t.comments.map((c) => (
          <li key={c.id} className="group">
            <div className="flex items-baseline gap-2">
              <span className="text-[0.78rem] text-white">{c.author_name ?? tx("Someone")}</span>
              <span className="text-[0.68rem] text-mute">{timeAgo(c.created_at)}</span>
              {c.mine && canWrite && <button aria-label={tx("Delete comment")} onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="ml-auto text-mute opacity-0 hover:text-red-300 group-hover:opacity-100"><Trash2 size={12} /></button>}
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-[0.82rem] leading-relaxed text-white/85">{c.body}</p>
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {!t.resolved && <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={tx("Reply")} aria-label={tx("Reply")} className="h-8 flex-1 text-[0.8rem]" onKeyDown={(e) => { if (e.key === "Enter") send(); }} />}
          {!t.resolved && reply.trim() && <button aria-label={tx("Send reply")} onClick={send} className="rounded p-1.5 text-sky-300 hover:bg-white/[0.06]"><CornerDownLeft size={14} /></button>}
          <button onClick={() => resolve(!t.resolved)} title={t.resolved ? tx("Reopen") : tx("Resolve")} aria-label={t.resolved ? tx("Reopen") : tx("Resolve")} className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-[0.74rem] hover:bg-white/[0.06]", t.resolved ? "text-mute-bright" : "text-emerald-300")}>
            {t.resolved ? <RotateCcw size={12} /> : <Check size={13} />}{t.resolved ? tx("Reopen") : tx("Resolve")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Version history ─────────────────────────────────────────────────────────
export function VersionsPanel({ docId, selected, onSelect, onRestore, canWrite, onClose }: { docId: string; selected: string | null; onSelect: (v: any | null) => void; onRestore: (v: any) => void; canWrite: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<any[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");
  const load = () => api.get(`/docs/${docId}/versions`).then(setVersions).catch(toastError);
  useEffect(() => { load(); }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (id: string) => { try { onSelect(await api.get(`/docs/${docId}/versions/${id}`)); } catch (e) { toastError(e); } };
  const name = async () => {
    if (!label.trim()) return;
    try { await api.post(`/docs/${docId}/versions`, { label: label.trim() }); setLabel(""); setNaming(false); toast(tx("Version saved")); load(); } catch (e) { toastError(e); }
  };
  const fmt = (d: string) => new Date(d).toLocaleString(locale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <aside aria-label={tx("Version history")} className="space-y-3">
      <div className="flex items-center gap-2"><History size={14} className="text-mute" /><div className="label">{tx("Version history")}</div><button aria-label={tx("Close")} onClick={onClose} className="ml-auto text-mute hover:text-white"><X size={15} /></button></div>
      <p className="text-[0.76rem] leading-relaxed text-mute">{tx("Orbital saves a version automatically every ten minutes while people write. Name one to find it easily later.")}</p>
      {canWrite && (naming ? (
        <form onSubmit={(e) => { e.preventDefault(); name(); }} className="flex gap-1.5"><Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tx("e.g. Sent to client")} aria-label={tx("Version name")} className="h-8 flex-1 text-[0.8rem]" /><Button size="sm" variant="primary" type="submit">{tx("Save")}</Button></form>
      ) : <Button size="sm" icon={<Tag size={12} />} onClick={() => setNaming(true)}>{tx("Name current version")}</Button>)}
      <ul className="space-y-1">
        <li><button onClick={() => onSelect(null)} className={cx("w-full rounded-lg px-3 py-2 text-left", !selected ? "bg-sky-400/15 text-white" : "text-mute-bright hover:bg-white/[0.04]")}>
          <div className="text-[0.82rem]">{tx("Current version")}</div></button></li>
        {versions?.map((v) => (
          <li key={v.id}><button onClick={() => pick(v.id)} className={cx("w-full rounded-lg px-3 py-2 text-left", selected === v.id ? "bg-sky-400/15 text-white" : "text-mute-bright hover:bg-white/[0.04]")}>
            {v.label && <div className="text-[0.82rem] text-white">{v.label}</div>}
            <div className={cx(v.label ? "text-[0.72rem] text-mute" : "text-[0.82rem]")}>{fmt(v.created_at)}</div>
            <div className="text-[0.7rem] text-mute">{v.author ?? ""}{v.author ? " · " : ""}{tx("{n} words", { n: v.words.toLocaleString(locale()) })}</div>
          </button></li>
        ))}
        {versions?.length === 0 && <li className="px-3 text-[0.78rem] text-mute">{tx("No saved versions yet.")}</li>}
      </ul>
      {selected && canWrite && <SelectedActions onRestore={() => onRestore(versions?.find((v) => v.id === selected))} />}
    </aside>
  );
}
function SelectedActions({ onRestore }: { onRestore: () => void }) {
  return <Button variant="primary" className="w-full" icon={<RotateCcw size={13} />} onClick={onRestore}>{tx("Restore this version")}</Button>;
}

/** A read-only render of a saved version (parsed through the editor's schema, so nothing unsafe gets through). */
export function VersionPreview({ html, paper }: { html: string; paper: boolean }) {
  const editor = useEditor({ extensions: docExtensions(), content: html, editable: false, immediatelyRender: true }, [html]);
  return <div className={cx("doc-page doc-content", paper && "paper")}><EditorContent editor={editor} /></div>;
}

// ── Ask Orbital (writing help) ──────────────────────────────────────────────
const QUICK = [
  { action: "improve", label: "Improve writing", needsSelection: true },
  { action: "fix", label: "Fix spelling & grammar", needsSelection: true },
  { action: "shorter", label: "Make shorter", needsSelection: true },
  { action: "longer", label: "Make longer", needsSelection: true },
  { action: "simplify", label: "Simplify", needsSelection: true },
  { action: "professional", label: "More professional", needsSelection: true },
  { action: "friendly", label: "More friendly", needsSelection: true },
  { action: "continue", label: "Continue writing", needsSelection: false },
  { action: "summarize", label: "Summarize", needsSelection: false },
  { action: "outline", label: "Suggest an outline", needsSelection: false },
] as const;

export function AssistPanel({ docId, editor, title, onClose, aiAvailable }: { docId: string; editor: Editor; title: string; onClose: () => void; aiAvailable: boolean }) {
  const [instruction, setInstruction] = useState("");
  const [useKnowledge, setUseKnowledge] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; from: number; to: number; replace: boolean } | null>(null);
  const hasSel = useEditorState({ editor, selector: ({ editor: e }) => !e.state.selection.empty });
  const preview = useMemo(() => (result ? markdownToHtml(result.text) : ""), [result]);

  const run = async (action: string) => {
    const { from, to, empty } = editor.state.selection;
    const doc = editor.state.doc;
    const selection = empty ? "" : doc.textBetween(from, to, "\n\n");
    const before = doc.textBetween(0, from, "\n\n").slice(-12_000);
    setBusy(action); setResult(null);
    try {
      const r = await api.post(`/docs/${docId}/assist`, { action, selection: action === "summarize" && !selection ? doc.textBetween(0, doc.content.size, "\n\n").slice(0, 40_000) : selection, before, instruction: action === "write" ? instruction : "", title, useKnowledge });
      const replace = !empty && !["continue", "summarize", "outline", "write"].includes(action);
      setResult({ text: r.text, from, to, replace });
    } catch (e) { toastError(e); } finally { setBusy(null); }
  };
  const apply = (mode: "replace" | "insert") => {
    if (!result) return;
    const html = markdownToHtml(result.text);
    const chain = editor.chain().focus();
    if (mode === "replace") chain.insertContentAt({ from: result.from, to: result.to }, html).run();
    else chain.insertContentAt(result.to, html).run();
    setResult(null);
  };
  return (
    <aside aria-label={tx("Ask Orbital")} className="space-y-3">
      <div className="flex items-center gap-2"><Sparkles size={14} className="text-fuchsia-300" /><div className="label">{tx("Ask Orbital")}</div><button aria-label={tx("Close")} onClick={onClose} className="ml-auto text-mute hover:text-white"><X size={15} /></button></div>
      {!aiAvailable ? <p className="text-[0.8rem] leading-relaxed text-mute">{tx("Writing help needs an AI provider. Set one up in Settings → AI & research.")}</p> : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); if (instruction.trim()) run("write"); }}>
            <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3} placeholder={tx("What should Orbital write? e.g. A two-paragraph intro for investors")} aria-label={tx("What should Orbital write?")}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && instruction.trim()) run("write"); }} />
            <div className="mt-2 flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[0.74rem] text-mute"><input type="checkbox" checked={useKnowledge} onChange={(e) => setUseKnowledge(e.target.checked)} className="accent-sky-400" />{tx("Use what Orbital knows")}</label>
              <Button size="sm" variant="primary" type="submit" className="ml-auto" loading={busy === "write"} disabled={!instruction.trim() || !!busy}>{tx("Write")}</Button>
            </div>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q.action} disabled={!!busy || (q.needsSelection && !hasSel)} onClick={() => run(q.action)} title={q.needsSelection && !hasSel ? tx("Select some text first.") : undefined}
                className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.74rem] text-mute-bright hover:border-white/30 hover:text-white disabled:opacity-35">
                {busy === q.action && <Loader2 size={11} className="animate-spin" />}{tx(q.label)}
              </button>
            ))}
          </div>
          {!hasSel && <p className="text-[0.72rem] text-mute">{tx("Select text to rewrite it, or place the cursor where new text should go.")}</p>}
          {result && (
            <div className="rounded-xl border border-fuchsia-300/30 bg-ink-2 p-3">
              <div className="doc-content max-h-[46vh] overflow-y-auto text-[0.84rem] leading-relaxed text-white/90 [&_h1]:text-[1.05rem] [&_h2]:text-[0.98rem] [&_li]:ml-4 [&_ol]:list-decimal [&_p+p]:mt-2 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: preview }} />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {result.replace && <Button size="sm" variant="primary" onClick={() => apply("replace")}>{tx("Replace selection")}</Button>}
                <Button size="sm" variant={result.replace ? "secondary" : "primary"} onClick={() => apply("insert")}>{result.replace ? tx("Insert below") : tx("Insert")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setResult(null)}>{tx("Discard")}</Button>
              </div>
              <p className="mt-2 text-[0.7rem] text-mute">{tx("Orbital can be wrong. Check facts before you share.")}</p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

export const CommentIcon = MessageSquare;
