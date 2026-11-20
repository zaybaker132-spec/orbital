/**
 * Repeating reminders. A rule plus the time zone it was set in, so "every day at 9am" stays at 9am
 * in the person's own clock across daylight-saving changes. Shared by the server (scheduling) and the
 * app (labels and previews).
 */
export const REPEAT_FREQS = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
export type RepeatFreq = (typeof REPEAT_FREQS)[number];

export interface RepeatRule {
  freq: RepeatFreq;
  /** Every N days/weeks/months/years (1 = every). Ignored for weekdays. */
  interval?: number;
  /** For weekly: which days, 0 = Sunday … 6 = Saturday. Defaults to the first occurrence's day. */
  days?: number[];
  /** Last day (YYYY-MM-DD, in the rule's time zone) an occurrence may fall on. */
  until?: string;
}

interface Wall { y: number; mo: number; d: number; h: number; mi: number; dow: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Is this an IANA time zone the runtime knows? */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { fmt(tz); return true; } catch { return false; }
}

/** The wall-clock time of an instant in a time zone. */
export function wallTime(ms: number, tz: string): Wall {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: DOW[p.weekday] ?? 0 };
}

/** The instant a wall-clock time happens in a time zone (a time skipped by DST moves forward). */
export function fromWallTime(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (ms: number) => { const w = wallTime(ms, tz); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60_000) * 60_000; };
  let guess = target - offset(target);
  guess = target - offset(guess);
  return guess;
}

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const addDays = (y: number, mo: number, d: number, n: number) => { const x = new Date(Date.UTC(y, mo - 1, d + n)); return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), dow: x.getUTCDay() }; };
const ymd = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * The next occurrence strictly after `afterMs`, following `rule` from the series' current occurrence
 * `currentMs` (whose wall-clock time and day anchor the series). `anchorDay` keeps "the 31st" on the
 * 31st (or the month's last day) instead of drifting. Returns null when the series has ended.
 */
export function nextOccurrence(rule: RepeatRule, currentMs: number, afterMs: number, tz: string, anchorDay?: number): number | null {
  const start = wallTime(currentMs, tz);
  const iv = Math.max(1, Math.min(99, Math.floor(rule.interval ?? 1)));
  const dayOfMonth = anchorDay ?? start.d;
  let cur = { y: start.y, mo: start.mo, d: start.d, dow: start.dow };
  // Bounded walk: even every-99-years reaches past any realistic gap well inside this.
  for (let i = 0; i < 5000; i++) {
    switch (rule.freq) {
      case "daily": cur = addDays(cur.y, cur.mo, cur.d, iv); break;
      case "weekdays": do { cur = addDays(cur.y, cur.mo, cur.d, 1); } while (cur.dow === 0 || cur.dow === 6); break;
      case "weekly": {
        const days = rule.days?.length ? [...new Set(rule.days)].filter((n) => n >= 0 && n <= 6).sort() : [start.dow];
        // Next chosen day later this week; otherwise the first chosen day `iv` weeks on.
        const later = days.find((n) => n > cur.dow);
        if (later !== undefined) cur = addDays(cur.y, cur.mo, cur.d, later - cur.dow);
        else cur = addDays(cur.y, cur.mo, cur.d, 7 * iv - cur.dow + days[0]);
        break;
      }
      case "monthly": {
        let mo = cur.mo + iv, y = cur.y;
        while (mo > 12) { mo -= 12; y++; }
        const d = Math.min(dayOfMonth, daysInMonth(y, mo));
        cur = { y, mo, d, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
        break;
      }
      case "yearly": {
        const y = cur.y + iv, d = Math.min(dayOfMonth, daysInMonth(y, start.mo));
        cur = { y, mo: start.mo, d, dow: new Date(Date.UTC(y, start.mo - 1, d)).getUTCDay() };
        break;
      }
    }
    if (rule.until && ymd(cur.y, cur.mo, cur.d) > rule.until) return null;
    const ms = fromWallTime(cur.y, cur.mo, cur.d, start.h, start.mi, tz);
    if (ms > afterMs) return ms;
  }
  return null;
}

/** The first occurrence on or after `fromMs` for a weekly rule whose chosen days may not include the start day. */
export function firstOccurrence(rule: RepeatRule, fromMs: number, tz: string): number {
  if (rule.freq === "weekly" && rule.days?.length) {
    const w = wallTime(fromMs, tz);
    if (!rule.days.includes(w.dow)) return nextOccurrence({ ...rule, interval: 1 }, fromMs, fromMs, tz) ?? fromMs;
  }
  if (rule.freq === "weekdays") {
    const w = wallTime(fromMs, tz);
    if (w.dow === 0 || w.dow === 6) return nextOccurrence(rule, fromMs, fromMs, tz) ?? fromMs;
  }
  return fromMs;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Every day", "Every 2 weeks on Mon, Thu", "Every month until Mar 1" (English; the app translates the pieces). */
export function describeRepeat(rule: RepeatRule): string {
  const iv = Math.max(1, rule.interval ?? 1);
  const unit = { daily: "day", weekdays: "weekday", weekly: "week", monthly: "month", yearly: "year" }[rule.freq];
  let s = rule.freq === "weekdays" ? "Every weekday" : iv === 1 ? `Every ${unit}` : `Every ${iv} ${unit}s`;
  if (rule.freq === "weekly" && rule.days?.length) {
    const days = [...rule.days].sort();
    const names = days.length === 1 ? DAY_NAMES[days[0]] : days.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
    s = iv === 1 ? `Every ${names}` : `Every ${iv} weeks on ${names}`;
  }
  if (rule.until) s += ` until ${rule.until}`;
  return s;
}
