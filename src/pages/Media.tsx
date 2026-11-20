import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera, Circle, Download, FileAudio, FileVideo, Image as ImageIcon, Mic, MonitorUp, Pencil, Search, Square, Trash2, Upload, Video, X } from "lucide-react";
import { locale, tx } from "@/i18n";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { timeAgo } from "@/lib/format";
import { Button, Empty, Input, Pulse } from "@/components/ui";
import { toast, toastError } from "@/state/ui";
import { useApp } from "@/state/app";
import {
  canCaptureScreen, canRecord, captureError, formatBytes, formatDuration, probe, recordCamera, recordScreen, recordVoice, takeScreenshot, uploadMedia,
  type Captured, type MediaKind, type Recorder,
} from "@/lib/capture";

export interface MediaItem {
  id: string; kind: MediaKind; title: string; mime: string; size: number; duration_ms: number | null; width: number | null; height: number | null;
  has_thumbnail: boolean; has_transcript: boolean; transcript?: string; meeting_code: string | null; created_by: string | null; created_at: string;
}
const FILTERS: [MediaKind | "", string][] = [
  ["", "All"], ["screenshot", "Screenshots"], ["screen_recording", "Screen recordings"], ["voice", "Voice"], ["recording", "Recordings"], ["meeting", "Meetings"], ["upload", "Uploads"],
];
const KIND_LABEL: Record<MediaKind, string> = { screenshot: "Screenshot", screen_recording: "Screen recording", voice: "Voice recording", recording: "Recording", meeting: "Meeting recording", upload: "Upload" };

export function MediaPage() {
  const { id } = useParams();
  return id ? <MediaDetail id={id} /> : <MediaLibrary />;
}

type Pending = { captured: Captured; kind: MediaKind; url: string; title: string };
type Live = { recorder: Recorder; kind: MediaKind };

function MediaLibrary() {
  const [filter, setFilter] = useState<MediaKind | "">("");
  const [q, setQ] = useState("");
  const query = new URLSearchParams({ ...(filter ? { kind: filter } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString();
  const { data: items } = useResource<MediaItem[]>(`/media${query ? `?${query}` : ""}`);
  const { data: usage } = useResource<{ used: number; quota: number | null; maxFile: number }>("/media/usage");
  const role = useApp((s) => s.workspace?.role);
  const canAdd = role !== "viewer";
  const [live, setLive] = useState<Live | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const start = async (kind: MediaKind) => {
    try {
      if (kind === "screenshot") { const c = await takeScreenshot(); review(c, kind); return; }
      const recorder = kind === "screen_recording" ? await recordScreen(true) : kind === "voice" ? await recordVoice() : await recordCamera();
      recorder.onEnded = () => stop(recorder, kind);
      setLive({ recorder, kind });
    } catch (e) { if ((e as any)?.name !== "NotAllowedError" || kind !== "screenshot") toast(captureError(e), { tone: "error" }); }
  };
  const stop = async (recorder: Recorder, kind: MediaKind) => {
    setLive(null);
    const c = await recorder.stop();
    if (c.blob.size) review(c, kind);
  };
  const review = (captured: Captured, kind: MediaKind) => setPending({ captured, kind, url: URL.createObjectURL(captured.blob), title: "" });
  const save = async (p: Pending) => {
    setProgress(0);
    try {
      const m = await uploadMedia(p.captured.blob, { kind: p.kind, title: p.title.trim() || undefined, durationMs: p.captured.durationMs, width: p.captured.width, height: p.captured.height }, setProgress);
      toast(tx("Saved to Media")); URL.revokeObjectURL(p.url); setPending(null); invalidate("/media");
      return m;
    } catch (e) { toastError(e); } finally { setProgress(null); }
  };
  const uploadFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!/^(image|video|audio)\//.test(f.type)) { toast(tx("{name} isn't an image, video or audio file.", { name: f.name }), { tone: "error" }); continue; }
      setProgress(0);
      try {
        const meta = await probe(f);
        await uploadMedia(f, { kind: "upload", title: f.name.replace(/\.[^.]+$/, ""), ...meta }, setProgress);
        toast(tx("Uploaded {name}", { name: f.name }));
      } catch (e) { toastError(e); } finally { setProgress(null); }
    }
    invalidate("/media");
  };

  return (
    <div className="h-full overflow-y-auto" onDragOver={(e) => { if (canAdd && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={(e) => { e.preventDefault(); setDrag(false); if (canAdd) uploadFiles(e.dataTransfer.files); }}>
      <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-6 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.5rem] font-light text-white">{tx("Media")}</h1>
            <p className="mt-1 text-[0.84rem] text-mute">{tx("Screenshots, screen recordings, voice notes, recordings and meeting playbacks, in one place.")}</p>
          </div>
          {usage && <div className="text-right text-[0.74rem] text-mute">{usage.quota ? tx("{used} of {quota} used", { used: formatBytes(usage.used), quota: formatBytes(usage.quota) }) : tx("{used} used", { used: formatBytes(usage.used) })}</div>}
        </div>

        {canAdd && (
          <div className="mt-5 flex flex-wrap gap-2">
            {canCaptureScreen() && <Button size="sm" variant="secondary" onClick={() => start("screenshot")} disabled={!!live}><ImageIcon size={14} /> {tx("Screenshot")}</Button>}
            {canCaptureScreen() && canRecord() && <Button size="sm" variant="secondary" onClick={() => start("screen_recording")} disabled={!!live}><MonitorUp size={14} /> {tx("Record screen")}</Button>}
            {canRecord() && <Button size="sm" variant="secondary" onClick={() => start("voice")} disabled={!!live}><Mic size={14} /> {tx("Record voice")}</Button>}
            {canRecord() && <Button size="sm" variant="secondary" onClick={() => start("recording")} disabled={!!live}><Camera size={14} /> {tx("Record camera")}</Button>}
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}><Upload size={14} /> {tx("Upload")}</Button>
            <input ref={fileInput} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }} />
          </div>
        )}

        {progress !== null && (
          <div className="mt-4 flex items-center gap-3 text-[0.8rem] text-mute" role="status">
            <div className="h-1 w-56 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
            {tx("Saving… {pct}%", { pct: Math.round(progress * 100) })}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={tx("Kind")} className="flex flex-wrap gap-1">
            {FILTERS.map(([k, label]) => (
              <button key={k || "all"} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={filter === k ? "rounded-full bg-white px-3 py-1 text-[0.78rem] text-black" : "rounded-full border border-line px-3 py-1 text-[0.78rem] text-mute hover:text-white"}>{tx(label)}</button>
            ))}
          </div>
          <label className="ml-auto flex h-8 w-64 items-center gap-2 rounded-lg border border-line px-2.5 focus-within:border-white/30">
            <Search size={13} className="text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Search titles and transcripts")} aria-label={tx("Search media")} className="min-w-0 flex-1 bg-transparent text-[0.82rem] text-white placeholder:text-mute-soft focus:outline-none" />
          </label>
        </div>

        {!items ? <div className="mt-10"><Pulse /></div> : items.length === 0 ? (
          <div className="mt-10"><Empty title={q || filter ? tx("Nothing matches") : tx("No media yet")}>{tx("Take a screenshot, record your screen, your voice or your camera, or drop files here. Meeting recordings appear here too.")}</Empty></div>
        ) : (
          <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {items.map((m) => <MediaCard key={m.id} m={m} />)}
          </ul>
        )}
      </div>

      {drag && <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-black/60"><div className="rounded-2xl border-2 border-dashed border-white/50 px-10 py-8 text-white">{tx("Drop images, video or audio to add them")}</div></div>}
      {live && <RecordingBar live={live} onStop={() => stop(live.recorder, live.kind)} onCancel={() => { live.recorder.cancel(); setLive(null); }} />}
      {pending && <ReviewDialog p={pending} busy={progress !== null} onChange={setPending} onSave={() => save(pending)} onDiscard={() => { URL.revokeObjectURL(pending.url); setPending(null); }} />}
    </div>
  );
}

function MediaCard({ m }: { m: MediaItem }) {
  const Icon = m.mime.startsWith("audio/") ? FileAudio : m.mime.startsWith("video/") ? FileVideo : ImageIcon;
  return (
    <li>
      <Link to={`/media/${m.id}`} className="glow-card block overflow-hidden rounded-xl border border-line bg-ink-1/60">
        <div className="relative grid aspect-video place-items-center bg-white/[0.03]">
          {m.has_thumbnail ? <img src={`/api/media/${m.id}/thumbnail`} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : <Icon size={28} className="text-mute-soft" />}
          {m.duration_ms != null && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[0.68rem] tabular-nums text-white">{formatDuration(m.duration_ms)}</span>}
        </div>
        <div className="px-3 py-2.5">
          <div className="truncate text-[0.84rem] text-white">{m.title}</div>
          <div className="mt-0.5 flex gap-2 text-[0.72rem] text-mute"><span>{tx(KIND_LABEL[m.kind])}</span><span>·</span><span>{timeAgo(m.created_at)}</span></div>
        </div>
      </Link>
    </li>
  );
}

/** While recording: a timer, a live preview for screen and camera, stop or cancel. */
function RecordingBar({ live, onStop, onCancel }: { live: Live; onStop: () => void; onCancel: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(t); }, []);
  const preview = useRef<HTMLVideoElement>(null);
  const hasVideo = live.recorder.stream.getVideoTracks().length > 0;
  useEffect(() => { if (preview.current && hasVideo) preview.current.srcObject = live.recorder.stream; }, [live, hasVideo]);
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-line-strong bg-ink-2 px-4 py-3 shadow-2xl" role="status" aria-live="polite">
      {hasVideo && <video ref={preview} autoPlay muted playsInline className="h-16 w-28 rounded-md bg-black object-cover" />}
      <span className="flex items-center gap-2 text-[0.88rem] text-white"><Circle size={10} className="animate-pulse fill-red-500 text-red-500" />{tx(KIND_LABEL[live.kind])}</span>
      <span className="font-mono text-[0.9rem] tabular-nums text-white">{formatDuration(Date.now() - live.recorder.startedAt)}</span>
      <Button size="sm" onClick={onStop}><Square size={12} className="fill-current" /> {tx("Stop")}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>{tx("Cancel")}</Button>
    </div>
  );
}

/** After capturing: watch or listen back, name it, save or discard. */
function ReviewDialog({ p, busy, onChange, onSave, onDiscard }: { p: Pending; busy: boolean; onChange: (p: Pending) => void; onSave: () => void; onDiscard: () => void }) {
  const t = p.captured.mime;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={tx("Save recording")}>
      <div className="w-full max-w-2xl rounded-2xl border border-line-strong bg-ink-2 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-[1rem] text-white">{tx(KIND_LABEL[p.kind])}</h2><button onClick={onDiscard} aria-label={tx("Close")} className="text-mute hover:text-white"><X size={16} /></button></div>
        <div className="overflow-hidden rounded-xl bg-black">
          {t.startsWith("image/") ? <img src={p.url} alt="" className="max-h-[50vh] w-full object-contain" />
            : t.startsWith("video/") ? <video src={p.url} controls className="max-h-[50vh] w-full" />
            : <div className="p-6"><audio src={p.url} controls className="w-full" /></div>}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Input value={p.title} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder={tx("Name it (optional)")} maxLength={200} className="flex-1" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) onSave(); }} />
          <span className="text-[0.74rem] text-mute">{[formatDuration(p.captured.durationMs), formatBytes(p.captured.blob.size)].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy}>{tx("Discard")}</Button>
          <Button size="sm" onClick={onSave} loading={busy}>{tx("Save to Media")}</Button>
        </div>
      </div>
    </div>
  );
}

function MediaDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: m, error } = useResource<MediaItem>(`/media/${id}`);
  const { data: usage } = useResource<{ transcription: boolean }>("/media/usage");
  const user = useApp((s) => s.user);
  const role = useApp((s) => s.workspace?.role);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (error) return <div className="p-10"><Empty title={tx("This media is gone")}><Link to="/media" className="underline">{tx("Back to Media")}</Link></Empty></div>;
  if (!m) return <div className="p-10"><Pulse /></div>;
  const src = `/api/media/${m.id}/file`;
  const canDelete = m.created_by === user?.id || role === "owner" || role === "admin";
  const canEdit = role !== "viewer";
  const rename = async () => {
    const t = title.trim(); setEditing(false);
    if (!t || t === m.title) return;
    try { await api.patch(`/media/${m.id}`, { title: t }); invalidate("/media"); } catch (e) { toastError(e); }
  };
  const transcribe = async () => {
    setBusy(true);
    try { await api.post(`/media/${m.id}/transcribe`, {}); invalidate(`/media/${m.id}`, "/media?"); toast(tx("Transcript added")); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const saveNote = async () => {
    try { const d = await api.post("/documents", { title: m.title, body: m.transcript ?? "" }); invalidate("/documents"); navigate(`/knowledge/${d.id}`); } catch (e) { toastError(e); }
  };
  const remove = async () => {
    if (!confirm(tx("Delete \"{title}\"? This can't be undone.", { title: m.title }))) return;
    try { await api.del(`/media/${m.id}`); invalidate("/media"); navigate("/media"); } catch (e) { toastError(e); }
  };
  const audioLike = /^(audio|video)\//.test(m.mime);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-6 pb-16 pt-6 sm:px-8">
        <Link to="/media" className="flex items-center gap-1.5 text-[0.82rem] text-mute hover:text-white"><ArrowLeft size={14} /> {tx("Media")}</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {editing ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(false); }} autoFocus maxLength={200} className="h-9 max-w-xl text-[1.1rem]" />
          ) : (
            <h1 className="min-w-0 truncate text-[1.4rem] font-light text-white">{m.title}</h1>
          )}
          {canEdit && !editing && <button onClick={() => { setTitle(m.title); setEditing(true); }} className="text-mute hover:text-white" aria-label={tx("Rename")}><Pencil size={14} /></button>}
          <div className="ml-auto flex gap-2">
            <a href={`${src}?download=1`}><Button size="sm" variant="ghost"><Download size={14} /> {tx("Download")}</Button></a>
            {canDelete && <Button size="sm" variant="ghost" className="text-red-300" onClick={remove}><Trash2 size={14} /> {tx("Delete")}</Button>}
          </div>
        </div>
        <div className="mt-1 text-[0.78rem] text-mute">
          {[tx(KIND_LABEL[m.kind]), new Date(m.created_at).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }), formatDuration(m.duration_ms), m.width && m.height ? `${m.width}×${m.height}` : "", formatBytes(Number(m.size))].filter(Boolean).join(" · ")}
          {m.meeting_code && <> · <Link to={`/m/${m.meeting_code}`} className="underline-offset-2 hover:underline"><Video size={12} className="mr-1 inline" />{m.meeting_code}</Link></>}
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-black">
          {m.mime.startsWith("image/") ? <img src={src} alt={m.title} className="max-h-[70vh] w-full object-contain" />
            : m.mime.startsWith("video/") ? <video src={src} controls preload="metadata" className="max-h-[70vh] w-full" />
            : <div className="p-8"><audio src={src} controls preload="metadata" className="w-full" /></div>}
        </div>
        {audioLike && (
          <section className="mt-6">
            <div className="flex items-center gap-3">
              <h2 className="label">{tx("Transcript")}</h2>
              {canEdit && usage?.transcription && Number(m.size) <= 25 * 1024 * 1024 && (
                <Button size="sm" variant="ghost" onClick={transcribe} loading={busy}>{m.transcript ? tx("Transcribe again") : tx("Transcribe")}</Button>
              )}
              {m.transcript && <Button size="sm" variant="ghost" onClick={saveNote}>{tx("Save as a note")}</Button>}
            </div>
            {m.transcript ? <p className="mt-2 whitespace-pre-wrap text-[0.9rem] leading-relaxed text-white/90">{m.transcript}</p>
              : <p className="mt-2 text-[0.82rem] text-mute">{usage?.transcription ? (Number(m.size) > 25 * 1024 * 1024 ? tx("Transcription works on recordings up to 25 MB.") : tx("No transcript yet.")) : tx("Turning speech into text needs a transcription service on the server (TRANSCRIPTION_BASE_URL or an OpenAI key).")}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
