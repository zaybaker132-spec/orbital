import { getWorkspaceId } from "./api";
import { language, tx } from "@/i18n";

/**
 * Capturing and saving media: screenshots, screen / voice / camera recordings (MediaRecorder), small
 * preview thumbnails, and uploads with progress. Everything happens in the browser until it's saved.
 */
export type MediaKind = "screenshot" | "screen_recording" | "voice" | "recording" | "meeting" | "upload";
export interface Captured { blob: Blob; mime: string; durationMs?: number; width?: number; height?: number }

const pick = (types: string[]) => types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
export const videoType = () => pick(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]);
export const audioType = () => pick(["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]);
export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices;
export const canCaptureScreen = () => !!navigator.mediaDevices?.getDisplayMedia;

/** Explain a capture failure in plain words (permission refused, nothing to record…). */
export function captureError(e: unknown): string {
  const name = (e as any)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return tx("Permission was refused. Allow screen, camera or microphone access for Orbital and try again.");
  if (name === "NotFoundError") return tx("No camera or microphone was found.");
  if (name === "NotReadableError") return tx("Another app is using the camera or microphone.");
  if (name === "AbortError") return tx("Capture was cancelled.");
  return (e as any)?.message || tx("Capture didn't work.");
}

/** A still of a screen or window the person picks. */
export async function takeScreenshot(): Promise<Captured> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
  try {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    await new Promise((r) => setTimeout(r, 250)); // let the first real frame arrive
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error(tx("Capture didn't work.")))), "image/png"));
    return { blob, mime: "image/png", width: c.width, height: c.height };
  } finally { stream.getTracks().forEach((t) => t.stop()); }
}

export interface Recorder { stream: MediaStream; startedAt: number; stop(): Promise<Captured>; cancel(): void; onEnded?: () => void }

/** Record a stream (already obtained) with MediaRecorder. */
export function recordStream(stream: MediaStream, video: boolean, cleanup: () => void = () => {}): Recorder {
  const mime = video ? videoType() : audioType();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: video ? 3_000_000 : undefined } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const startedAt = Date.now();
  rec.start(1000);
  const stopTracks = () => { stream.getTracks().forEach((t) => t.stop()); cleanup(); };
  const self: Recorder = {
    stream, startedAt,
    stop: () => new Promise((resolve) => {
      const vt = stream.getVideoTracks()[0]?.getSettings();
      rec.onstop = () => {
        stopTracks();
        const type = (rec.mimeType || mime || (video ? "video/webm" : "audio/webm")).split(";")[0];
        resolve({ blob: new Blob(parts, { type }), mime: type, durationMs: Date.now() - startedAt, width: vt?.width, height: vt?.height });
      };
      if (rec.state !== "inactive") rec.stop(); else rec.onstop(new Event("stop"));
    }),
    cancel: () => { rec.onstop = null; if (rec.state !== "inactive") rec.stop(); stopTracks(); },
  };
  // The person stopped sharing from the browser's own bar: treat it as "stop".
  stream.getVideoTracks()[0]?.addEventListener("ended", () => self.onEnded?.());
  return self;
}

/** Screen (or window) recording, with the microphone mixed in if wanted. */
export async function recordScreen(withMic: boolean): Promise<Recorder> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  let mic: MediaStream | null = null;
  if (withMic) { try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { mic = null; } }
  const audioTracks = [...display.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
  let ctx: AudioContext | null = null;
  let audio: MediaStreamTrack[] = audioTracks;
  if (audioTracks.length > 1) {
    // Several sound sources (the screen's and the microphone): mix them into one track.
    ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const t of audioTracks) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
    audio = dest.stream.getAudioTracks();
  }
  const stream = new MediaStream([...display.getVideoTracks(), ...audio]);
  return recordStream(stream, true, () => { display.getTracks().forEach((t) => t.stop()); mic?.getTracks().forEach((t) => t.stop()); ctx?.close(); });
}
export async function recordVoice(): Promise<Recorder> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return recordStream(s, false);
}
export async function recordCamera(): Promise<Recorder> {
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
  return recordStream(s, true);
}

/** Duration and size of a file someone drops in (read by the browser's own player). */
export async function probe(file: Blob): Promise<{ durationMs?: number; width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image(); img.src = url; await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio") as HTMLVideoElement;
    el.preload = "metadata"; el.src = url;
    await new Promise<void>((ok) => { el.onloadedmetadata = () => ok(); el.onerror = () => ok(); setTimeout(ok, 4000); });
    const d = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : undefined;
    return { durationMs: d, width: el.videoWidth || undefined, height: el.videoHeight || undefined };
  } catch { return {}; } finally { URL.revokeObjectURL(url); }
}

/** A small JPEG preview from an image or a video's early frame; none for audio. */
export async function thumbnail(blob: Blob): Promise<Blob | null> {
  if (!/^(image|video)\//.test(blob.type)) return null;
  const url = URL.createObjectURL(blob);
  try {
    let src: CanvasImageSource, w: number, h: number;
    if (blob.type.startsWith("image/")) {
      const img = new Image(); img.src = url; await img.decode(); src = img; w = img.naturalWidth; h = img.naturalHeight;
    } else {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      await new Promise<void>((ok, fail) => { v.onloadeddata = () => ok(); v.onerror = () => fail(new Error("video")); setTimeout(() => fail(new Error("timeout")), 6000); });
      v.currentTime = Math.min(1, (Number.isFinite(v.duration) ? v.duration : 2) / 3);
      await new Promise<void>((ok) => { v.onseeked = () => ok(); setTimeout(ok, 1500); });
      src = v; w = v.videoWidth; h = v.videoHeight;
    }
    if (!w || !h) return null;
    const scale = Math.min(1, 480 / w);
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    return await new Promise<Blob | null>((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.78));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** Save to the media library, reporting progress (0..1). Adds a thumbnail afterwards when it can. */
export function uploadMedia(blob: Blob, meta: { kind: MediaKind; title?: string; durationMs?: number; width?: number; height?: number; meeting?: string }, onProgress?: (p: number) => void): Promise<any> {
  const q = new URLSearchParams({ kind: meta.kind });
  if (meta.title) q.set("title", meta.title.slice(0, 200));
  if (meta.durationMs) q.set("duration", String(Math.round(meta.durationMs)));
  if (meta.width) q.set("width", String(meta.width));
  if (meta.height) q.set("height", String(meta.height));
  if (meta.meeting) q.set("meeting", meta.meeting);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `/api/media?${q}`);
    x.setRequestHeader("content-type", blob.type || "application/octet-stream");
    x.setRequestHeader("x-orbital-request", "1");
    x.setRequestHeader("x-orbital-language", language());
    const ws = getWorkspaceId(); if (ws) x.setRequestHeader("x-orbital-workspace", ws);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onerror = () => reject(new Error(tx("The upload didn't finish. Check your connection and try again.")));
    x.onload = async () => {
      let body: any = null; try { body = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status !== 201) return reject(new Error(body?.error ?? tx("The upload didn't finish. Check your connection and try again.")));
      const thumb = await thumbnail(blob);
      if (thumb && thumb.size < 300 * 1024) {
        await fetch(`/api/media/${body.id}/thumbnail`, { method: "PUT", body: thumb, headers: { "content-type": "image/jpeg", "x-orbital-request": "1", ...(ws ? { "x-orbital-workspace": ws } : {}) } }).catch(() => {});
      }
      resolve(body);
    };
    x.send(blob);
  });
}

export const formatDuration = (ms?: number | null) => {
  if (!ms && ms !== 0) return "";
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
export const formatBytes = (n: number) => (n === 0 ? "0 KB" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`);
