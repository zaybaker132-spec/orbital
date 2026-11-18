import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { language, locale } from "@/i18n";

/**
 * Voice in and out.
 *  - Speech to text: the browser's own recogniser when it has one (Chrome, Edge, Safari); otherwise
 *    record with the microphone and send the clip to the server's transcription endpoint (desktop
 *    app, Firefox), which needs TRANSCRIPTION_BASE_URL or OPENAI_API_KEY on the server.
 *  - Text to speech: the system voices through speechSynthesis.
 */

type Engine = "browser" | "server" | "none";
const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
/** Electron exposes webkitSpeechRecognition but it can't reach a recognition service. */
const isElectron = typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent);
const browserRecognition = !!SR && !isElectron;

let serverConfig: Promise<boolean> | null = null;
const serverTranscription = () => (serverConfig ??= api.get("/voice/config").then((c) => !!c.serverTranscription).catch(() => false));

export function useSpeechInput(opts: { onFinal: (text: string) => void; onInterim?: (text: string) => void; continuous?: boolean }) {
  const [engine, setEngine] = useState<Engine>(browserRecognition ? "browser" : "none");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(opts);
  cb.current = opts;
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => { if (!browserRecognition) serverTranscription().then((ok) => setEngine(ok ? "server" : "none")); }, []);

  const start = useCallback(async () => {
    setError(null);
    if (engine === "browser") {
      const rec = new SR();
      rec.lang = locale();
      rec.interimResults = true;
      rec.continuous = !!cb.current.continuous;
      let finalText = "";
      rec.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        cb.current.onInterim?.((finalText + interim).trim());
        if (!cb.current.continuous && finalText.trim()) { /* wait for onend */ }
      };
      rec.onerror = (e: any) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access was blocked. Allow it in your browser's site settings." : e.error === "network" ? "Speech recognition needs an internet connection in this browser." : "Couldn't hear that. Try again.");
      };
      rec.onend = () => {
        setListening(false);
        setLevel(0);
        const t = finalText.trim();
        if (t) cb.current.onFinal(t);
      };
      stopRef.current = () => { try { rec.stop(); } catch { /* already stopped */ } };
      try { rec.start(); setListening(true); } catch { setError("Couldn't start listening."); }
      return;
    }
    if (engine === "server") {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch { setError("Microphone access was blocked. Allow it in your system or browser settings."); return; }
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      // End of speech: about 1.3 s of quiet after some speech (or a 60 s cap).
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let spoke = false, quietSince = Date.now();
      const began = Date.now();
      const timer = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms / 25));
        if (rms > 6) { spoke = true; quietSince = Date.now(); }
        if ((spoke && Date.now() - quietSince > 1300) || Date.now() - began > 60_000 || (!spoke && Date.now() - began > 12_000)) stop();
      }, 100);
      const stop = () => { if (recorder.state !== "inactive") recorder.stop(); };
      recorder.onstop = async () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        setListening(false);
        setLevel(0);
        if (!spoke || !chunks.length) return;
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("audio", new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), "speech");
          const lang = language();
          if (/^[a-z]{2}$/.test(lang)) fd.append("language", lang);
          const r = await api.upload("/voice/transcribe", fd);
          if (r.text) cb.current.onFinal(r.text);
        } catch (e: any) { setError(e?.message ?? "Couldn't transcribe that."); }
        finally { setTranscribing(false); }
      };
      stopRef.current = stop;
      recorder.start(250);
      setListening(true);
      return;
    }
    setError("Voice input isn't available here. Use Chrome, Edge or Safari, or ask the server admin to set up transcription.");
  }, [engine]);

  const stop = useCallback(() => stopRef.current(), []);
  useEffect(() => () => stopRef.current(), []);
  return { engine, listening, transcribing, level, error, start, stop, available: engine !== "none" };
}

/** Markdown answer → something pleasant to hear: no code, URLs, citation markers or symbols. */
export function speakable(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(?:[MSDN]?\d+(?:\s*,\s*[MSDN]?\d+)*)\]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1$2")
    .replace(/[*~>#|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .replace(/(\.\s*){2,}/g, ". ")
    .trim();
}

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Speak in sentence-sized pieces (long single utterances get cut off in some browsers). */
export function speak(text: string, opts: { onEnd?: () => void; rate?: number; voiceName?: string } = {}) {
  if (!canSpeak()) { opts.onEnd?.(); return () => {}; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const p of parts) {
    if (chunks.length && (chunks[chunks.length - 1] + " " + p).length < 220) chunks[chunks.length - 1] += " " + p;
    else chunks.push(p);
  }
  let cancelled = false;
  const voice = pickVoice(opts.voiceName);
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? locale();
    u.rate = opts.rate ?? 1.03;
    if (i === chunks.length - 1) u.onend = () => { if (!cancelled) opts.onEnd?.(); };
    u.onerror = () => { if (i === chunks.length - 1 && !cancelled) opts.onEnd?.(); };
    synth.speak(u);
  });
  if (!chunks.length) opts.onEnd?.();
  return () => { cancelled = true; synth.cancel(); };
}

/** The system voices for the person's language, best-sounding first (for Settings). */
export function availableVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  const lang = language();
  const all = window.speechSynthesis.getVoices();
  const same = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return (same.length ? same : all).sort((a, b) => Number(/natural|neural|premium|enhanced|google/i.test(b.name)) - Number(/natural|neural|premium|enhanced|google/i.test(a.name)));
}

function pickVoice(preferred?: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const lang = locale().toLowerCase();
  // A saved voice is used only while it speaks the interface language (switching language picks a new one).
  if (preferred) { const v = voices.find((x) => x.name === preferred); if (v && v.lang.toLowerCase().startsWith(lang.slice(0, 2))) return v; }
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
  // Prefer natural-sounding voices where the system has them.
  return same.find((v) => /natural|neural|premium|enhanced|google/i.test(v.name)) ?? same.find((v) => v.lang.toLowerCase() === lang) ?? same[0] ?? null;
}
