/// <reference lib="webworker" />
/**
 * On-device speech recognition: Whisper running in this worker with Transformers.js (ONNX Runtime as
 * WebAssembly). The model comes from Orbital's own server (which keeps a copy in its data folder), and
 * the audio never leaves this computer.
 */
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.remoteHost = `${self.location.origin}/api/voice/models/`;
env.remotePathTemplate = "{model}/resolve/{revision}/";
env.useBrowserCache = typeof caches !== "undefined";
const onnx = env.backends.onnx as any;
onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;
onnx.wasm.proxy = false;

type In = { id: number; type: "load"; model: string } | { id: number; type: "transcribe"; model: string; audio: Float32Array; language?: string };
let asr: Promise<any> | null = null;
const files = new Map<string, { loaded: number; total: number }>();

function load(model: string, id: number) {
  asr ??= pipeline("automatic-speech-recognition", model, {
    device: "wasm",
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" } as any,
    progress_callback: (p: any) => {
      if (p.status === "progress" && p.file && p.total) {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        self.postMessage({ id, type: "progress", loaded, total });
      }
    },
  }).catch((e) => { asr = null; throw e; });
  return asr;
}

self.onmessage = async (ev: MessageEvent<In>) => {
  const m = ev.data;
  try {
    const run = await load(m.model, m.id);
    if (m.type === "load") return self.postMessage({ id: m.id, type: "done" });
    const out = await run(m.audio, {
      task: "transcribe",
      ...(m.language ? { language: m.language } : {}),
      // Long recordings are read in overlapping 30-second pieces.
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = (Array.isArray(out) ? out.map((o: any) => o.text).join(" ") : out.text) as string;
    self.postMessage({ id: m.id, type: "done", text: text.replace(/\s+/g, " ").trim() });
  } catch (e: any) {
    self.postMessage({ id: m.id, type: "error", error: String(e?.message ?? e) });
  }
};
