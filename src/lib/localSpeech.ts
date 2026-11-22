import { useSyncExternalStore } from "react";
import { api } from "./api";

/**
 * Speech to text on this computer (Whisper in a Web Worker). Used by voice conversations, voice typing
 * in Papers and "Transcribe" in Media whenever the browser can't recognise speech itself — notably the
 * desktop app. Free, private and offline after the one-time model download.
 */
export const localSpeechSupported = typeof WebAssembly === "object" && typeof Worker !== "undefined" && typeof AudioContext !== "undefined";

export interface ModelStatus { state: "idle" | "downloading" | "ready" | "error"; progress: number; error?: string }
let status: ModelStatus = { state: "idle", progress: 0 };
const listeners = new Set<() => void>();
const setStatus = (s: Partial<ModelStatus>) => { status = { ...status, ...s }; listeners.forEach((l) => l()); };
export const useModelStatus = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => status);

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
let modelName: Promise<string> | null = null;
const model = () => (modelName ??= api.get("/voice/config").then((c) => c.localModel as string).catch(() => "onnx-community/whisper-base"));

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data, p = pending.get(m.id);
    if (m.type === "progress") { if (status.state !== "ready") setStatus({ state: "downloading", progress: m.total ? m.loaded / m.total : 0 }); return; }
    if (!p) return;
    pending.delete(m.id);
    if (m.type === "error") p.fail(new Error(m.error)); else p.ok(m);
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.fail(new Error(e.message || "Speech recognition stopped")); pending.clear(); worker = null; };
  return worker;
}
async function call(msg: Record<string, unknown>, transfer: Transferable[] = []) {
  const id = ++seq, w = getWorker(), m = await model();
  return new Promise<any>((ok, fail) => { pending.set(id, { ok, fail }); w.postMessage({ ...msg, id, model: m }, transfer); });
}

let preparing: Promise<void> | null = null;
/** Download (first time) and start the speech model. Safe to call repeatedly. */
export function prepareLocalSpeech() {
  if (status.state === "ready") return Promise.resolve();
  preparing ??= (async () => {
    setStatus({ state: "downloading", error: undefined });
    try { await call({ type: "load" }); setStatus({ state: "ready", progress: 1 }); }
    catch (e: any) {
      const offline = /fetch|network|Failed to|gateway|unavailable|50[234]|load file/i.test(e?.message ?? "");
      const error = offline ? "Couldn't download the speech model (a one-time download of about 80 MB). Check your internet connection and try again." : "Speech recognition couldn't start on this computer.";
      setStatus({ state: "error", error });
      throw new Error(error);
    } finally { preparing = null; }
  })();
  return preparing;
}

/** Any recording (webm, mp4, wav…) → 16 kHz mono samples, which is what Whisper listens to. */
async function toSamples(blob: Blob, maxSeconds: number): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16_000 });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration > maxSeconds) throw new Error(`Recordings up to ${Math.round(maxSeconds / 60)} minutes can be transcribed on this computer.`);
    if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice();
    const out = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / audio.numberOfChannels; }
    return out;
  } finally { void ctx.close(); }
}

/** Speech in a recording → text, on this computer. */
export async function transcribeLocally(blob: Blob, language?: string, maxSeconds = 60 * 60): Promise<string> {
  const [samples] = await Promise.all([toSamples(blob, maxSeconds), prepareLocalSpeech()]);
  const r = await call({ type: "transcribe", audio: samples, language }, [samples.buffer]);
  return r.text as string;
}
