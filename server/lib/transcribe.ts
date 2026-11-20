import { config } from "../config.js";
import { HttpError } from "./http.js";

/** Speech to text through the configured OpenAI-compatible /audio/transcriptions endpoint. */
export const transcriptionKey = () => process.env.TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY || "";
export const transcriptionAvailable = () => !!config.transcription.baseUrl;

export async function transcribeAudio(audio: Buffer, mime: string, language?: string): Promise<string> {
  if (!transcriptionAvailable()) throw new HttpError(503, "Voice input in this app needs a transcription service. Set TRANSCRIPTION_BASE_URL (or OPENAI_API_KEY) on the server, or use Chrome, Edge or Safari, which recognise speech themselves.", "transcription_unavailable");
  const form = new FormData();
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : "webm";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append("model", config.transcription.model);
  if (language && /^[a-z]{2}$/.test(language)) form.append("language", language);
  const headers: Record<string, string> = {};
  if (transcriptionKey()) headers.authorization = `Bearer ${transcriptionKey()}`;
  let r: Response;
  try {
    r = await fetch(`${config.transcription.baseUrl}/audio/transcriptions`, { method: "POST", headers, body: form, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new HttpError(502, "Couldn't reach the transcription service.");
  }
  if (r.status === 401 || r.status === 403) throw new HttpError(502, "The transcription service rejected the API key.");
  if (!r.ok) throw new HttpError(502, `The transcription service returned an error (${r.status}).`);
  const j: any = await r.json().catch(() => ({}));
  return String(j.text ?? "").trim();
}
