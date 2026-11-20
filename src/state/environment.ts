import { useEffect } from "react";
import { useApp } from "./app";
import { useLightTheme } from "@/lib/theme";
import {
  ACCENT_HEX, DEFAULT_ENVIRONMENT, NAV_KEYS, type Dashboard, type Environment, type NavKey,
} from "../../shared/environment";

export type FullEnvironment = typeof DEFAULT_ENVIRONMENT;

/** Your environment with defaults filled in (and anything stale, like an unknown section, dropped). */
export function resolveEnvironment(e: Environment | undefined): FullEnvironment {
  const env = { ...DEFAULT_ENVIRONMENT, ...(e ?? {}) } as FullEnvironment;
  if (!env.dashboards?.length) env.dashboards = DEFAULT_ENVIRONMENT.dashboards;
  if (!env.dashboards.some((d) => d.id === env.activeDashboard)) env.activeDashboard = env.dashboards[0].id;
  // Sections added in a later version appear at the end of a saved order.
  const order = (env.nav?.order ?? []).filter((k) => (NAV_KEYS as readonly string[]).includes(k));
  env.nav = { order: [...order, ...NAV_KEYS.filter((k) => !order.includes(k))], hidden: (env.nav?.hidden ?? []).filter((k) => NAV_KEYS.includes(k)) };
  return env;
}

export function useEnvironment() {
  const prefs = useApp((s) => s.prefs);
  return resolveEnvironment(prefs.environment);
}

/** Save part of the environment (the whole object is stored, so it's merged here first). */
export async function saveEnvironment(patch: Partial<Environment>) {
  const current = resolveEnvironment(useApp.getState().prefs.environment);
  await useApp.getState().setPrefs({ environment: { ...current, ...patch } });
}
export async function saveDashboard(d: Dashboard) {
  const env = resolveEnvironment(useApp.getState().prefs.environment);
  await saveEnvironment({ dashboards: env.dashboards.map((x) => (x.id === d.id ? d : x)) });
}
export const navVisible = (env: FullEnvironment) => env.nav.order.filter((k: NavKey) => !env.nav.hidden.includes(k));

const hexChannels = (h: string) => `${parseInt(h.slice(1, 3), 16)} ${parseInt(h.slice(3, 5), 16)} ${parseInt(h.slice(5, 7), 16)}`;
const TEXT_PX = { small: "14px", default: "15px", large: "16.5px" } as const;

/** Applies the visual theme (accent, text size, background) to the whole app. Rendered once, at the root. */
export function EnvironmentEffects() {
  const env = useEnvironment();
  const light = useLightTheme();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--c-accent", hexChannels(ACCENT_HEX[env.accent][light ? 1 : 0]));
    root.style.fontSize = TEXT_PX[env.textSize];
    root.dataset.background = env.background;
  }, [env.accent, env.textSize, env.background, light]);
  return null;
}
