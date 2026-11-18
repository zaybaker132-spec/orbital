import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUp, Check, Copy, FileText, Paperclip, Square, ThumbsDown, ThumbsUp, Compass, X, FolderKanban, BookmarkPlus, Mic, AudioLines } from "lucide-react";
import { api, streamPost } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp } from "@/state/app";
import { useCore } from "@/state/core";
import { usePanel, toast, toastError, type AnswerContext } from "@/state/ui";
import { NeuralCore } from "@/neural/NeuralCore";
import { Markdown } from "@/components/Markdown";
import { Badge, Button, IconButton, Pulse, Select, cx } from "@/components/ui";
import { VoiceMode } from "@/components/VoiceMode";
import { useSpeechInput } from "@/lib/voice";
import { useCan } from "@/state/app";
import { NotFoundPage } from "./NotFound";
import { tn, tx } from "@/i18n";

export const MODES = [
  { id: "standard", label: "Standard", hint: "Everyday questions with your context" },
  { id: "deep_research", label: "Deep Research", hint: "Multi-step research with external sources and citations" },
  { id: "deep_thinking", label: "Deep Thinking", hint: "Careful analysis across everything you've accumulated" },
  { id: "opportunity", label: "Opportunity", hint: "Find practical opportunities grounded in your knowledge" },
  { id: "learning", label: "Learning", hint: "Explanations, knowledge gaps and learning paths" },
] as const;
type ModeId = (typeof MODES)[number]["id"];

interface Msg { id: string; role: "user" | "assistant"; content: string; mode: string; metadata: any; created_at?: string; streaming?: boolean; error?: string }

export function ChatPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [convId, setConvId] = useState<string | null>(params.id ?? null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const prefs = useApp((s) => s.prefs);
  const [mode, setMode] = useState<ModeId>((prefs.defaultMode as ModeId) ?? "standard");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const setAnswer = usePanel((s) => s.setAnswer);
  const setPanelContent = usePanel((s) => s.setContent);
  const [search, setSearch] = useSearchParams();
  const [voice, setVoice] = useState(search.get("voice") === "1");
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    const m = search.get("mode");
    if (m && MODES.some((x) => x.id === m)) setMode(m as ModeId);
    if (search.get("voice") === "1") setVoice(true);
    const q = search.get("q");
    if (q) setDraft(m === "learning" ? `Teach me about ${q}` : q);
    if (m || q || search.get("voice")) setSearch({}, { replace: true });
  }, [search, setSearch]);

  useEffect(() => { setPanelContent("", null); }, [setPanelContent]);

  // Load the conversation when the route changes (but not when we just created it ourselves).
  useEffect(() => {
    const id = params.id ?? null;
    if (id === convId && messages.length) return;
    setConvId(id);
    setMissing(false);
    if (!id) { setMessages([]); setTitle(""); setProjectId(null); setAnswer(null); return; }
    setLoading(true);
    api.get(`/conversations/${id}`).then((c) => {
      setMessages(c.messages);
      setTitle(c.title);
      setProjectId(c.project_id);
      const last = [...c.messages].reverse().find((m: Msg) => m.role === "assistant" && m.metadata?.context);
      setAnswer(last?.metadata.context ?? null);
    }).catch((e) => { if (e?.status === 404 || e?.status === 400) setMissing(true); else navigate("/", { replace: true }); }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    if (stick.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(async (text: string, attachments: { id: string; title: string }[]) => {
    let id = convId;
    try {
      if (!id) {
        const c = await api.post("/conversations", { mode, projectId });
        id = c.id as string;
        setConvId(id);
        navigate(`/c/${id}`, { replace: true });
      }
    } catch (e) { toastError(e); return; }
    stick.current = true;
    const tmpUser: Msg = { id: `tmp-u-${Date.now()}`, role: "user", content: text, mode, metadata: attachments.length ? { attachments: attachments.map((a) => a.id), attachmentTitles: attachments.map((a) => a.title) } : {} };
    const tmpAsst: Msg = { id: `tmp-a-${Date.now()}`, role: "assistant", content: "", mode, metadata: {}, streaming: true };
    setMessages((m) => [...m, tmpUser, tmpAsst]);
    setStreaming(true);
    if (mode !== "deep_research") useCore.getState().set("thinking", true);
    const ac = new AbortController();
    abortRef.current = ac;
    const patch = (fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === tmpAsst.id ? fn(m) : m)));
    try {
      await streamPost(`/conversations/${id}/messages`, { content: text, mode, attachments: attachments.map((a) => a.id) }, (event, data) => {
        if (event === "context") { patch((m) => ({ ...m, metadata: { ...m.metadata, context: data } })); setAnswer(data); }
        else if (event === "delta") patch((m) => ({ ...m, content: m.content + data.text }));
        else if (event === "memory") toast(data.duplicate ? tx("Already remembered") : tx("Saved to memory"), { action: { label: "View", to: "/knowledge?tab=memory" } });
        else if (event === "research") patch((m) => ({ ...m, content: "", metadata: { researchId: data.researchId, kind: "research_started" } }));
        else if (event === "done") { patch((m) => ({ ...m, id: data.id, streaming: false, created_at: data.created_at, metadata: { ...m.metadata, ...(data.metadata ?? {}) } })); }
        else if (event === "error") patch((m) => ({ ...m, streaming: false, error: data.message }));
      }, ac.signal);
    } catch (e: any) {
      patch((m) => ({ ...m, streaming: false, error: ac.signal.aborted ? "Stopped." : e.message }));
    } finally {
      setStreaming(false);
      useCore.getState().set("thinking", false);
      abortRef.current = null;
      invalidate("/conversations", "/growth");
      if (id) api.get(`/conversations/${id}`).then((c) => setTitle(c.title)).catch(() => {});
    }
  }, [convId, mode, projectId, navigate, setAnswer]);

  const empty = !convId && !messages.length;
  const can = useCan();
  const remember = async () => {
    if (!convId) return;
    try {
      const r = await api.post(`/conversations/${convId}/remember`);
      invalidate("/documents", "/memories", "/graph", "/growth");
      const parts = [r.memories ? tn(r.memories, "{n} new memory", "{n} new memories") : "", r.pending ? tx("{n} for review", { n: r.pending }) : ""].filter(Boolean).join(", ");
      toast(r.aiError ? tx("Saved the conversation as a note. Memories weren't extracted: {aiError}", { aiError: r.aiError }) : r.ai ? tx("Saved to memory{v0}", { v0: parts ? `: ${parts}` : " (no new facts to remember)" }) : tx("Saved the conversation as a searchable note"), { action: { label: "Open note", to: `/knowledge/${r.documentId}` } });
    } catch (e) { toastError(e); }
  };

  if (missing) return <NotFoundPage what="conversation" back={{ to: "/", label: "New conversation" }} />;
  return (
    <div className="flex h-full flex-col">
      {voice && <VoiceMode messages={messages} streaming={streaming} onSend={(t) => send(t, [])} onClose={() => setVoice(false)} onRemember={remember} canRemember={!!convId && can.write} />}
      {!empty && <ChatHeader convId={convId} title={title} projectId={projectId} onProject={setProjectId} onRemember={can.write ? remember : undefined} />}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {empty ? (
          <EmptyState onPick={(t, m) => { if (m) setMode(m); return t; }} />
        ) : (
          <div className="mx-auto max-w-[760px] px-8 pb-10 pt-4">
            {loading && <div className="py-10 text-center"><Pulse /></div>}
            {messages.map((m) => <MessageView key={m.id} m={m} />)}
          </div>
        )}
      </div>
      <Composer draft={draft} onVoice={() => setVoice(true)} onSend={send} mode={mode} setMode={setMode} streaming={streaming} onStop={() => abortRef.current?.abort()} projectId={projectId} setProjectId={empty ? setProjectId : undefined} hero={empty} />
    </div>
  );
}

function ChatHeader({ convId, title, projectId, onProject, onRemember }: { convId: string | null; title: string; projectId: string | null; onProject: (id: string | null) => void; onRemember?: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const { data: projects } = useResource<any[]>("/projects");
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(title);
  useEffect(() => setVal(title), [title]);
  const save = async () => {
    setEditing(false);
    if (!convId || !val.trim() || val === title) return;
    await api.patch(`/conversations/${convId}`, { title: val.trim() }).catch(toastError);
    invalidate("/conversations");
  };
  return (
    <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 px-8 pb-1 pt-1">
      {editing ? (
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} className="input h-8 max-w-sm py-0" aria-label={tx("Conversation title")} />
      ) : (
        <button onClick={() => setEditing(true)} className="truncate text-[0.9rem] text-white/80 hover:text-white" title={tx("Rename")}>{title || tx("Conversation")}</button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {onRemember && convId && <Button size="sm" variant="ghost" icon={<BookmarkPlus size={13} />} loading={saving} title={tx("Keep this conversation as a searchable note and remember what you said")} onClick={async () => { setSaving(true); try { await onRemember(); } finally { setSaving(false); } }}>{tx("Save to memory")}</Button>}
        <FolderKanban size={13} className="text-mute" />
        <Select label={tx("Project")} value={projectId ?? ""} className="h-7 w-44 text-[0.8rem]"
          onChange={async (v) => { onProject(v || null); if (convId) { await api.patch(`/conversations/${convId}`, { projectId: v || null }).catch(toastError); invalidate("/conversations"); } }}
          options={[{ value: "", label: "No project" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string, mode?: ModeId) => string }) {
  const user = useApp((s) => s.user);
  const { data: projects } = useResource<any[]>("/projects");
  const { data: maint } = useResource<any>("/growth/maintenance");
  void onPick;
  const hour = new Date().getHours();
  const name = user?.displayName;
  const greet = hour < 5 ? (name ? tx("Working late, {name}.", { name }) : tx("Working late."))
    : hour < 12 ? (name ? tx("Good morning, {name}.", { name }) : tx("Good morning."))
    : hour < 18 ? (name ? tx("Good afternoon, {name}.", { name }) : tx("Good afternoon."))
    : (name ? tx("Good evening, {name}.", { name }) : tx("Good evening."));
  const active = (projects ?? []).filter((p) => p.status === "active").slice(0, 2);
  const gaps = (maint?.gaps ?? []).slice(0, 2);
  return (
    <div className="relative flex h-full flex-col items-center">
      <div className="relative h-[58%] min-h-[300px] w-full">
        <NeuralCore framing="head" className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#040404] to-transparent" />
      </div>
      <div className="relative z-10 -mt-4 w-full max-w-[720px] px-8 text-center">
        <h1 className="text-[1.5rem] font-light tracking-[-0.02em] text-white">{greet}</h1>
        <p className="mt-1.5 text-[0.9rem] text-mute">{tx("What are we thinking about?")}</p>
        {(active.length > 0 || gaps.length > 0) && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {active.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="rounded-full border border-line px-3.5 py-1.5 text-[0.8rem] text-mute-bright transition-colors hover:border-line-strong hover:text-white">
                {tx("Continue")} {p.name} →
              </Link>
            ))}
            {gaps.map((g: any) => (
              <Link key={g.id} to="/core#questions" className="max-w-[320px] truncate rounded-full border border-line px-3.5 py-1.5 text-[0.8rem] text-mute-bright transition-colors hover:border-line-strong hover:text-white" title={g.question}>
                {tx("Open question:")} {g.question}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageView({ m }: { m: Msg }) {
  const setAnswer = usePanel((s) => s.setAnswer);
  const toggleRight = useApp((s) => s.toggleRightPanel);
  if (m.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-8 flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.07] px-4 py-2.5 text-[0.94rem] leading-relaxed text-white/95 whitespace-pre-wrap">
          {m.content}
          {m.metadata?.attachmentTitles?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">{m.metadata.attachmentTitles.map((t: string) => <Badge key={t}><FileText size={11} />{t}</Badge>)}</div>
          )}
          {!m.metadata?.attachmentTitles && m.metadata?.attachments?.length > 0 && <div className="mt-2"><Badge><FileText size={11} />{m.metadata.attachments.length} {tx("attachment")}{m.metadata.attachments.length > 1 ? "s" : ""}</Badge></div>}
        </div>
      </motion.div>
    );
  }
  if (m.metadata?.researchId) return <ResearchMessage m={m} />;
  const ctx: AnswerContext | undefined = m.metadata?.context;
  const used = ctx ? ctx.memories.length + ctx.nodes.length + ctx.connected.length + ctx.documents.length : 0;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="group mt-7">
      {m.content ? (
        <Markdown text={m.content} onRef={(ref) => { if (ctx) { setAnswer(ctx, ref); toggleRight(true); } }} />
      ) : m.streaming ? (
        <div className="py-2"><Pulse label={tx("Orbital is thinking")} /></div>
      ) : null}
      {m.error && <p role="alert" className="mt-2 text-sm text-red-300/90">{m.error}</p>}
      {!m.streaming && !m.error && m.content && (
        <div className="mt-3 flex items-center gap-1 text-mute opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {m.metadata?.aiGenerated ? <Badge tone="ai">{tx("AI-generated")}</Badge> : m.metadata?.aiGenerated === false ? <Badge>{tx("From your knowledge base")}</Badge> : null}
          {ctx && (
            <button onClick={() => { setAnswer(ctx); toggleRight(true); }} className="ml-1 rounded-md px-2 py-1 text-[0.75rem] hover:bg-white/[0.06] hover:text-white">
              {used ? tn(used, "Informed by {n} item", "Informed by {n} items") : tx("No stored context used")}
            </button>
          )}
          <span className="flex-1" />
          <MessageActions m={m} />
        </div>
      )}
    </motion.div>
  );
}

function MessageActions({ m }: { m: Msg }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const navigate = useNavigate();
  const real = !m.id.startsWith("tmp");
  const rate = async (r: 1 | -1) => {
    if (!real) return;
    setRating(r);
    await api.post("/feedback", { targetType: "message", targetId: m.id, rating: r }).catch(toastError);
    invalidate("/growth");
  };
  return (
    <>
      <IconButton label={tx("Copy")} onClick={() => { navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
      <IconButton label={tx("Save as note")} disabled={!real} onClick={async () => {
        try { const d = await api.post("/documents/from-message", { messageId: m.id }); invalidate("/documents"); toast(tx("Saved to Knowledge"), { action: { label: "Open", to: `/knowledge/${d.id}` } }); } catch (e) { toastError(e); }
      }}><BookmarkPlus size={14} /></IconButton>
      <IconButton label={tx("Research this further")} onClick={() => navigate(`/research?new=1&q=${encodeURIComponent(m.content.split("\n").find((l) => l.trim().length > 20)?.replace(/[#*_>`]/g, "").trim().slice(0, 300) ?? "")}`)}><Compass size={14} /></IconButton>
      <IconButton label={tx("Helpful")} active={rating === 1} onClick={() => rate(1)}><ThumbsUp size={14} /></IconButton>
      <IconButton label={tx("Not helpful")} active={rating === -1} onClick={() => rate(-1)}><ThumbsDown size={14} /></IconButton>
    </>
  );
}

function ResearchMessage({ m }: { m: Msg }) {
  const id = m.metadata.researchId;
  const { data } = useResource<any>(`/research/${id}`);
  const done = data?.status === "completed";
  const failed = data?.status === "failed";
  const lastStep = data?.steps?.[data.steps.length - 1];
  return (
    <div className="mt-7 rounded-xl border border-line bg-white/[0.015] px-5 py-4">
      <div className="flex items-center gap-2.5">
        <Compass size={15} className="text-mute-bright" />
        <span className="text-[0.86rem] text-white">{m.metadata.kind === "research_report" ? tx("Research report") : tx("Deep research")}</span>
        <Badge tone={done ? "ok" : failed ? "warn" : "info"}>{data?.status ?? "queued"}</Badge>
        <Link to={`/research/${id}`} className="ml-auto text-[0.8rem] text-mute hover:text-white">{tx("Open report →")}</Link>
      </div>
      {!done && !failed && <p className="mt-2.5 flex items-center gap-2 text-[0.84rem] text-mute"><Pulse />{lastStep?.label ?? tx("Queued")}</p>}
      {failed && <p className="mt-2.5 text-[0.84rem] text-red-200/80">{data.error}</p>}
      {done && m.content && <div className="mt-3"><Markdown text={m.content} /></div>}
      {done && data.report?.mode === "sources_only" && <p className="mt-2.5 text-[0.84rem] text-mute">{tx("Sources gathered ({n}). Configure an AI provider to synthesize findings.", { n: data.sources?.length ?? 0 })}</p>}
    </div>
  );
}

function Composer({ draft, onSend, onVoice, mode, setMode, streaming, onStop, hero, projectId, setProjectId }: {
  draft: string; onVoice: () => void;
  onSend: (t: string, a: { id: string; title: string }[]) => void; mode: ModeId; setMode: (m: ModeId) => void; streaming: boolean; onStop: () => void; hero: boolean;
  projectId: string | null; setProjectId?: (id: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<{ id: string; title: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const ai = useApp((s) => s.ai);
  const { data: projects } = useResource<any[]>(setProjectId ? "/projects" : null);
  useEffect(() => { if (draft) { setText(draft); ta.current?.focus(); } }, [draft]);
  // Dictation: speech goes into the message box so you can check it before sending.
  const base = useRef("");
  const dictation = useSpeechInput({
    onInterim: (t) => setText((base.current ? base.current + " " : "") + t),
    onFinal: (t) => { setText((base.current ? base.current + " " : "") + t); ta.current?.focus(); },
  });
  useEffect(() => { if (dictation.error) toastError(new Error(dictation.error)); }, [dictation.error]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(260, el.scrollHeight) + "px";
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); ta.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    ta.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    onSend(t, attachments);
    setText("");
    setAttachments([]);
  };

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (projectId) fd.append("projectId", projectId);
      const d = await api.upload("/documents/upload", fd);
      setAttachments((a) => [...a, { id: d.id, title: d.title }]);
      invalidate("/documents");
    } catch (e) { toastError(e); } finally { setUploading(false); if (file.current) file.current.value = ""; }
  };

  const current = useMemo(() => MODES.find((m) => m.id === mode)!, [mode]);
  return (
    <div className={cx("shrink-0 px-8 pb-5", hero ? "pt-2" : "pt-2")}>
      <div className="mx-auto max-w-[760px]">
        <div className="mb-2 flex flex-wrap items-center gap-1" role="radiogroup" aria-label={tx("AI mode")}>
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}
              className={cx("rounded-full px-3 py-1 text-[0.78rem] transition-colors", mode === m.id ? "bg-white text-black" : "text-mute hover:bg-white/[0.06] hover:text-white")}>
              {tx(m.label)}
            </button>
          ))}
          {setProjectId && (
            <Select label={tx("Project")} value={projectId ?? ""} onChange={(v) => setProjectId(v || null)} className="ml-auto h-7 w-44 text-[0.78rem]"
              options={[{ value: "", label: "No project" }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          )}
        </div>
        <div className="rounded-2xl border border-line-strong bg-ink-2/80 transition-colors focus-within:border-white/25">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[0.75rem] text-mute-bright">
                  <FileText size={12} />{a.title}
                  <button aria-label={tx("Remove {title}", { title: a.title })} onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} className="hover:text-white"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label={tx("Message Orbital")}
            placeholder={mode === "deep_research" ? tx("What should Orbital research?") : mode === "learning" ? tx("What do you want to understand?") : mode === "opportunity" ? tx("Where should Orbital look for opportunities?") : tx("Ask anything — Orbital will draw on what you know")}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            className="block max-h-[260px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[0.95rem] leading-relaxed outline-none placeholder:text-mute-soft" />
          <div className="flex items-center gap-1 px-2.5 pb-2.5">
            <input ref={file} type="file" hidden accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.csv,.tsv,.json,.html" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <IconButton label={tx("Attach a file (PDF, Word, Excel, PowerPoint, image, text)")} onClick={() => file.current?.click()} disabled={uploading}>{uploading ? <Pulse label={tx("Uploading")} /> : <Paperclip size={15} />}</IconButton>
            {dictation.available && (
              <IconButton label={dictation.listening ? tx("Stop dictation") : dictation.transcribing ? tx("Transcribing…") : tx("Dictate")} active={dictation.listening}
                onClick={() => { if (dictation.listening) dictation.stop(); else { base.current = text.trim(); dictation.start(); } }}>
                {dictation.transcribing ? <Pulse label={tx("Transcribing")} /> : <Mic size={15} className={cx(dictation.listening && "text-red-300")} />}
              </IconButton>
            )}
            <IconButton label={tx("Talk to Orbital (voice conversation)")} onClick={onVoice}><AudioLines size={15} /></IconButton>
            <span className="ml-1 truncate text-[0.74rem] text-mute-soft">{tx(current.hint)}</span>
            {ai?.provider === "none" && mode !== "deep_research" && <Badge tone="warn" className="ml-2">{tx("No AI provider — answers use your knowledge only")}</Badge>}
            {streaming ? (
              <button onClick={onStop} aria-label={tx("Stop")} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white text-black hover:bg-white/85"><Square size={11} fill="currentColor" /></button>
            ) : (
              <button onClick={submit} aria-label={tx("Send")} disabled={!text.trim()} className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition-opacity hover:bg-white/85 disabled:opacity-25"><ArrowUp size={15} /></button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[0.7rem] text-mute-soft">{tx("Orbital can be wrong. Answers cite what informed them — check the context panel.")}</p>
      </div>
    </div>
  );
}

