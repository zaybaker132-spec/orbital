import { locale, t } from "@/i18n";

export function timeAgo(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return t("just now");
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "always", style: "narrow" });
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), "day");
  return d.toLocaleDateString(locale(), { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const label = (s: string) => s.replace(/_/g, " ");
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";
