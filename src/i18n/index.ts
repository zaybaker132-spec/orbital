/**
 * Interface language.
 *
 * Text is written in English in the code and looked up in a catalog for the chosen language:
 * `t("New conversation")`. Anything without a translation falls back to English, so a missing
 * entry never breaks a screen. Placeholders use braces: `t("{n} sources", { n })`.
 *
 * The language is chosen once per page load (Settings saves it and reloads), so `t()` is a plain
 * function and works anywhere: components, toasts, constants rendered later.
 */
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";
import de from "./locales/de.json";

export const LANGUAGES = [
  { code: "en", name: "English", native: "English", locale: "en-US" },
  { code: "es", name: "Spanish", native: "Español", locale: "es-ES" },
  { code: "fr", name: "French", native: "Français", locale: "fr-FR" },
  { code: "pt", name: "Portuguese", native: "Português", locale: "pt-BR" },
  { code: "de", name: "German", native: "Deutsch", locale: "de-DE" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

const CATALOGS: Record<Lang, Record<string, string>> = { en: {}, es, fr, pt, de };
const STORE_KEY = "orbital.language";

/** "auto" follows the browser; otherwise one of LANGUAGES. */
export function resolveLanguage(pref?: string | null): Lang {
  if (pref && pref !== "auto" && pref in CATALOGS) return pref as Lang;
  const browser = (typeof navigator !== "undefined" ? navigator.languages?.[0] ?? navigator.language : "en").slice(0, 2).toLowerCase();
  return (browser in CATALOGS ? browser : "en") as Lang;
}

let current: Lang = resolveLanguage(stored());
if (typeof document !== "undefined") document.documentElement.lang = current;
function stored() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }

/** Apply a language for this page load (and remember it for signed-out pages). */
export function setLanguage(pref: string | null | undefined) {
  current = resolveLanguage(pref);
  try { if (pref) localStorage.setItem(STORE_KEY, pref); } catch { /* private mode */ }
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
export const language = () => current;
export const languagePref = () => stored() ?? "auto";
/** The BCP 47 locale for dates, numbers and speech. */
export const locale = () => LANGUAGES.find((l) => l.code === current)!.locale;

export function t(text: string, vars?: Record<string, string | number>): string {
  const out = (current === "en" ? text : CATALOGS[current][text]) || text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Singular or plural: tn(n, "{n} source", "{n} sources"). */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>) {
  const rule = new Intl.PluralRules(locale()).select(n);
  return t(rule === "one" ? one : other, { n, ...vars });
}

/** The catalogs, for the coverage check. */
export const _catalogs = CATALOGS;

/** Same as t(): the name screens import, so it never clashes with local variables called `t`. */
export const tx = t;
