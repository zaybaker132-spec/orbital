/**
 * Voice → orb uniforms, shared by the app's Neural Core and the standalone one (website, preview).
 * The mic level rises fast and falls slowly so the orb breathes rather than flickers; each spoken
 * word kicks a pulse that decays. Browsers that don't report words while speaking get a gentle,
 * speech-like rhythm instead.
 */
export interface VoiceSignal { level: number; listening: boolean; speaking: boolean; transcribing: boolean; speakKick: number }

export function applyVoice(u: Record<string, { value: any }>, t: number, step: number, v: VoiceSignal) {
  const ease = (name: string, target: number, up: number, down: number) => {
    const cur = u[name].value as number;
    u[name].value = cur + (target - cur) * Math.min(1, step * (target > cur ? up : down));
  };
  ease("uListening", v.listening ? 1 : 0, 3, 2);
  ease("uVoice", v.listening ? Math.min(1, v.level) : 0, 14, 4);
  ease("uSpeaking", v.speaking ? 1 : 0, 3, 2);
  ease("uSwirl", v.transcribing ? 1 : 0, 2.5, 1.6);
  const sinceWord = (Date.now() - v.speakKick) / 1000;
  const word = v.speaking ? Math.exp(-sinceWord * 5) : 0;
  const rhythm = v.speaking && sinceWord > 0.7 ? 0.55 * Math.max(0, Math.sin(t * 8.3) * Math.sin(t * 2.9 + 1)) : 0;
  ease("uSpeakLevel", Math.max(word, rhythm), 18, 6);
}
