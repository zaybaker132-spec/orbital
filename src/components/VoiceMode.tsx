import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Mic, MicOff, Square, X } from "lucide-react";
import { NeuralCore } from "@/neural/NeuralCore";
import { useCore } from "@/state/core";
import { useApp } from "@/state/app";
import { canSpeak, speak, speakable, useSpeechInput } from "@/lib/voice";
import { voiceSignal } from "@/state/core";
import { Button, cx } from "./ui";
import { tx } from "@/i18n";

type Phase = "listening" | "thinking" | "speaking" | "paused";
interface Msg { id: string; role: "user" | "assistant"; content: string; streaming?: boolean; error?: string; metadata?: any }

/**
 * Talk to Orbital: listen, answer, speak, listen again. Every turn is a normal message in the
 * conversation, so it's saved, searchable and can be kept in memory with one click.
 */
export function VoiceMode({ messages, streaming, onSend, onClose, onRemember, canRemember }: {
  messages: Msg[]; streaming: boolean; onSend: (text: string) => void; onClose: () => void; onRemember: () => Promise<void>; canRemember: boolean;
}) {
  const prefs = useApp((s) => s.prefs);
  const [phase, setPhase] = useState<Phase>("listening");
  const [interim, setInterim] = useState("");
  const [heard, setHeard] = useState("");
  const [saving, setSaving] = useState(false);
  const stopSpeaking = useRef<() => void>(() => {});
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const speech = useSpeechInput({
    onInterim: setInterim,
    onFinal: (text) => { setHeard(text); setInterim(""); setPhase("thinking"); onSend(text); },
  });
  const startRef = useRef(speech.start);
  startRef.current = speech.start;

  const listen = () => { setPhase("listening"); setInterim(""); startRef.current(); };

  // Start listening as soon as the engine is known.
  const engine = speech.engine;
  useEffect(() => { if (engine !== "none" && phaseRef.current === "listening") startRef.current(); }, [engine]);

  // When the answer finishes streaming, read it aloud, then listen again.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming) { wasStreaming.current = true; return; }
    if (!wasStreaming.current || phaseRef.current !== "thinking") return;
    wasStreaming.current = false;
    // The orb listens, speaks and swirls with the conversation (see NeuralCore applyVoice).
  useEffect(() => {
    voiceSignal.listening = phase === "listening" && speech.listening;
    voiceSignal.level = speech.listening ? speech.level : 0;
    voiceSignal.transcribing = speech.transcribing;
    voiceSignal.speaking = phase === "speaking";
  }, [phase, speech.listening, speech.level, speech.transcribing]);
  useEffect(() => () => { Object.assign(voiceSignal, { level: 0, listening: false, speaking: false, transcribing: false }); }, []);

  const last = [...messages].reverse().find((m) => m.role === "assistant");
    const text = last?.error ? `Sorry, ${last.error}` : last?.metadata?.kind === "research_started" ? "I've started a research report. I'll let you know when it's ready." : speakable(last?.content ?? "");
    if (!text || !canSpeak() || prefs.speakAnswers === false) { listen(); return; }
    setPhase("speaking");
    useCore.getState().pulse("learning", 2600);
    stopSpeaking.current = speak(text, { rate: prefs.voiceRate, voiceName: prefs.voiceName, onWord: () => { voiceSignal.speakKick = Date.now(); }, onEnd: () => { if (phaseRef.current === "speaking") listen(); } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  useEffect(() => () => { stopSpeaking.current(); speech.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        if (phaseRef.current === "speaking") { stopSpeaking.current(); listen(); }
        else if (phaseRef.current === "listening") { speech.stop(); }
        else if (phaseRef.current === "paused") listen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // A finished listen with nothing heard pauses rather than looping forever.
  useEffect(() => { if (!speech.listening && !speech.transcribing && phase === "listening" && engine !== "none") { const t = setTimeout(() => { if (phaseRef.current === "listening" && !heard) setPhase("paused"); }, 400); return () => clearTimeout(t); } }, [speech.listening, speech.transcribing]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = [...messages].reverse().find((m) => m.role === "assistant");
  // On-device speech: the first time, the speech model downloads once (shown as a percentage).
  const preparing = engine === "local" && speech.model.state === "downloading" && (speech.transcribing || phase === "listening");
  const status = speech.error ?? (engine === "none" ? "Voice input needs a newer browser. Try Chrome, Edge or Safari." :
    phase === "listening" ? (speech.transcribing ? (preparing ? tx("Getting voice ready (one-time download) · {pct}%", { pct: Math.round(speech.model.progress * 100) }) : "Transcribing…") : speech.listening ? "Listening…" : "Starting…") :
    phase === "thinking" ? "Thinking…" : phase === "speaking" ? "Speaking · Space to interrupt" : "Paused · Space or tap the mic to talk");

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black" role="dialog" aria-label={tx("Voice conversation")}>
      <div className="flex items-center gap-2 px-6 py-4">
        <span className="text-[0.74rem] uppercase tracking-[0.18em] text-mute">{tx("Voice")}</span>
        <div className="ml-auto flex items-center gap-2">
          {canRemember && <Button size="sm" variant="ghost" icon={<BookmarkPlus size={13} />} loading={saving} onClick={async () => { setSaving(true); try { await onRemember(); } finally { setSaving(false); } }}>{tx("Save to memory")}</Button>}
          <Button size="sm" icon={<X size={13} />} onClick={onClose}>{tx("End")}</Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <NeuralCore framing="full" className="absolute inset-0" />
      </div>
      <div className="mx-auto w-full max-w-[720px] px-6 pb-8 text-center">
        <p className="min-h-[1.5em] text-[1.05rem] text-white/90">{phase === "listening" ? interim || heard : heard}</p>
        {phase !== "listening" && last?.content && <p className="mx-auto mt-3 line-clamp-3 max-w-[60ch] text-[0.88rem] leading-relaxed text-mute-bright">{speakable(last.content)}</p>}
        <p className={cx("mt-4 text-[0.78rem]", speech.error ? "text-red-300" : "text-mute")} aria-live="polite">{tx(status)}</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          {phase === "speaking" ? (
            <button onClick={() => { stopSpeaking.current(); listen(); }} aria-label={tx("Stop speaking")} className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black"><Square size={16} fill="currentColor" /></button>
          ) : phase === "listening" && speech.listening ? (
            <button onClick={() => speech.stop()} aria-label={tx("Stop listening")} className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-black"><Mic size={20} /></button>
          ) : (
            <button onClick={listen} disabled={phase === "thinking" || engine === "none"} aria-label={tx("Talk")} className="flex h-14 w-14 items-center justify-center rounded-full border border-white/30 text-white hover:border-white disabled:opacity-30">{phase === "thinking" ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : <MicOff size={20} />}</button>
          )}
        </div>
        {!canSpeak() && <p className="mt-3 text-[0.74rem] text-mute-soft">{tx("This browser can't speak, so answers appear as text.")}</p>}
      </div>
    </div>
  );
}
