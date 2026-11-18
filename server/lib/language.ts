import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

/**
 * The language Orbital writes in for the person it's working for: chat answers, research reports,
 * briefs, extracted knowledge. Requests carry it (the app sends `x-orbital-language`); jobs capture
 * it when they're queued, so a report finished later is still written in the requester's language.
 */
export const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish (Español)", fr: "French (Français)", pt: "Portuguese (Português)", de: "German (Deutsch)" };
export type Lang = keyof typeof LANGUAGE_NAMES;

const store = new AsyncLocalStorage<{ lang: string }>();
export const normalizeLanguage = (v: unknown): string => (typeof v === "string" && v.toLowerCase().slice(0, 2) in LANGUAGE_NAMES ? v.toLowerCase().slice(0, 2) : "en");
export const currentLanguage = () => store.getStore()?.lang ?? "en";
export const runInLanguage = <T>(lang: unknown, fn: () => T): T => store.run({ lang: normalizeLanguage(lang) }, fn);

export const languageFromRequest: RequestHandler = (req, _res, next) => runInLanguage(req.get("x-orbital-language"), next);

/** Appended to every model instruction when the language isn't English. */
export function languageInstruction(lang = currentLanguage()) {
  if (lang === "en") return "";
  return `\n\nOutput language: write every human-readable sentence of your answer in ${LANGUAGE_NAMES[lang]}, whatever language the sources or these instructions are in. Keep exact quotations, cited text, names, URLs, code, and any JSON field names or listed enum values exactly as given.`;
}
