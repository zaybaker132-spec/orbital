import { useSyncExternalStore } from "react";

/**
 * Dark (Orbital's original look), light, or whatever the computer uses. Stored on this device
 * (`orbital.theme`) so the sign-in screen is right too; public/theme-init.js applies it before first paint.
 */
export type ThemePref = "system" | "dark" | "light";
const KEY = "orbital.theme";
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
const listeners = new Set<() => void>();

export function themePref(): ThemePref {
  try { const t = localStorage.getItem(KEY); if (t === "dark" || t === "light") return t; } catch { /* storage blocked */ }
  return "system";
}
export const isLight = () => document.documentElement.classList.contains("light");

function apply() {
  const p = themePref();
  const light = p === "light" || (p === "system" && !!media?.matches);
  document.documentElement.classList.toggle("light", light);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#ffffff" : "#000000");
  listeners.forEach((l) => l());
}

export function setThemePref(p: ThemePref) {
  try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* storage blocked */ }
  apply();
}

media?.addEventListener?.("change", () => { if (themePref() === "system") apply(); });
if (typeof document !== "undefined") apply();

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
/** True while the light theme is showing; re-renders on change. */
export function useLightTheme() { return useSyncExternalStore(subscribe, isLight, () => false); }
export function useThemePref() { return useSyncExternalStore(subscribe, themePref, () => "system" as ThemePref); }

/** The current foreground colour at an opacity, for canvas and SVG drawing that can't use CSS classes. */
export function fg(alpha = 1) {
  const c = getComputedStyle(document.documentElement).getPropertyValue("--c-fg").trim() || "255 255 255";
  return `rgb(${c} / ${alpha})`;
}
