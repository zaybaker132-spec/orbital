import { api } from "./api";
import { invalidate } from "./resource";
import { locale, t } from "@/i18n";
import { formatWhen } from "./when";
import { parseReminder, type ParsedReminder } from "../../shared/reminderText";
import type { RepeatRule } from "../../shared/recurrence";

export type { RepeatRule };
/** This device's time zone, so repeating reminders follow the person's own clock. */
export const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/** "Remind me to call Sam friday at 3" → a reminder, if the text says when. */
export function readReminder(text: string): ParsedReminder | null {
  const p = parseReminder(text);
  return p.when && p.title ? p : null;
}
/** Text that's clearly asking for a reminder (chat and ⌘K only act on these). */
export const isReminderRequest = (text: string) => /^\s*(?:hey\s+orbital,?\s*)?(?:please\s+)?(?:remind\s+me\b|set\s+a\s+reminder\b)/i.test(text);

export async function createReminder(p: { title: string; when: Date; repeat?: RepeatRule | null; note?: string }) {
  const r = await api.post("/reminders", { title: p.title, note: p.note ?? "", dueAt: p.when.toISOString(), ...(p.repeat ? { repeat: p.repeat, timeZone: timeZone() } : {}) });
  invalidate("/reminders");
  return r;
}

const dayName = (d: number) => new Date(2026, 10, 1 + d).toLocaleDateString(locale(), { weekday: "short" }); // 1 Nov 2026 is a Sunday
const fullDay = (d: number) => new Date(2026, 10, 1 + d).toLocaleDateString(locale(), { weekday: "long" });

/** "Every day", "Every weekday", "Every Monday", "Every 2 weeks on Mon, Thu", "Every month until Dec 31". */
export function repeatLabel(r: RepeatRule): string {
  const n = Math.max(1, r.interval ?? 1);
  let s: string;
  switch (r.freq) {
    case "daily": s = n === 1 ? t("Every day") : t("Every {n} days", { n }); break;
    case "weekdays": s = t("Every weekday"); break;
    case "weekly": {
      const days = [...(r.days ?? [])].sort();
      const names = days.length === 1 ? fullDay(days[0]) : days.map(dayName).join(", ");
      s = !days.length ? (n === 1 ? t("Every week") : t("Every {n} weeks", { n }))
        : n === 1 ? t("Every {days}", { days: names }) : t("Every {n} weeks on {days}", { n, days: names });
      break;
    }
    case "monthly": s = n === 1 ? t("Every month") : t("Every {n} months", { n }); break;
    case "yearly": s = n === 1 ? t("Every year") : t("Every {n} years", { n }); break;
  }
  if (r.until) s += " " + t("until {date}", { date: new Date(`${r.until}T12:00:00`).toLocaleDateString(locale(), { month: "short", day: "numeric" }) });
  return s;
}

/** "Fri 3:00 PM · Every week" for a toast or preview. */
export const describeReminder = (when: Date, repeat?: RepeatRule | null) => `${formatWhen(when.toISOString())}${repeat ? ` · ${repeatLabel(repeat)}` : ""}`;
