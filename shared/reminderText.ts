import type { RepeatRule } from "./recurrence";

/**
 * Understands reminders typed the way people say them, without AI:
 *   "remind me to call Sam friday at 3"      → "Call Sam", Friday 3:00 PM
 *   "pay rent every month on the 1st"         → "Pay rent", the 1st at 9:00 AM, monthly
 *   "standup every weekday at 9:30"           → weekdays at 9:30
 *   "stretch in 20 minutes" · "dentist March 5 at 2pm" · "review every other friday"
 * Times are in the clock of the `now` Date passed in (the person's own device). English only; anything
 * it doesn't understand stays in the title, and `when` is null so the caller can ask for a time.
 */
export interface ParsedReminder { title: string; when: Date | null; repeat: RepeatRule | null; /** The parts that were read as the time, for highlighting. */ matched: string[] }

const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WD_RE = "(?:sunday|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|saturday)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD = "(?:st|nd|rd|th)?";
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, "a couple of": 2, "a few": 3 };
const wd = (s: string) => WD.indexOf(s.toLowerCase().slice(0, 3));
const mon = (s: string) => MONTHS.indexOf(s.toLowerCase().slice(0, 3));
const num = (s: string) => (NUM_WORDS[s.toLowerCase()] ?? Number(s));
const PARTS: Record<string, number> = { morning: 9, afternoon: 14, evening: 18, tonight: 20, night: 20 };

interface Ctx { text: string; matched: string[] }
/** Find a pattern, remove it from the text, and return its groups. */
function take(c: Ctx, re: RegExp): RegExpExecArray | null {
  const m = new RegExp(re.source, re.flags.includes("i") ? re.flags : re.flags + "i").exec(c.text);
  if (!m) return null;
  c.matched.push(m[0].trim());
  c.text = (c.text.slice(0, m.index) + " " + c.text.slice(m.index + m[0].length)).replace(/\s+/g, " ");
  return m;
}

/** A calendar day from a date phrase, relative to `now` (time of day not set). */
function dayFrom(c: Ctx, now: Date): { date: Date; weekday?: number; explicitNext?: boolean } | null {
  const day = (offset: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d; };
  let m: RegExpExecArray | null;
  if (take(c, /\b(?:the\s+)?day after tomorrow\b/)) return { date: day(2) };
  if (take(c, /\b(?:tomorrow|tmrw|tmr)\b/)) return { date: day(1) };
  if (take(c, /\btoday\b/)) return { date: day(0) };
  if ((m = take(c, /\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/))) return { date: new Date(+m[1], +m[2] - 1, +m[3]) };
  const year = (mo: number, d: number, y?: string) => {
    if (y) return new Date(+y, mo, d);
    const x = new Date(now.getFullYear(), mo, d);
    return x.getTime() < day(0).getTime() ? new Date(now.getFullYear() + 1, mo, d) : x;
  };
  if ((m = take(c, new RegExp(`\\b(?:on\\s+)?(${MON_RE})\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`)))) return { date: year(mon(m[1]), +m[2], m[3]) };
  if ((m = take(c, new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MON_RE})(?:,?\\s+(\\d{4}))?\\b`)))) return { date: year(mon(m[2]), +m[1], m[3]) };
  if (take(c, /\bthis weekend\b/) || take(c, /\bon the weekend\b/)) { const d = day(0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); return { date: d }; }
  if (take(c, /\bnext week\b/)) { const d = day(0); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return { date: d }; }
  if (take(c, /\bnext month\b/)) { const d = day(0); d.setMonth(d.getMonth() + 1, 1); return { date: d }; }
  if ((m = take(c, new RegExp(`\\b(?:on\\s+)?(next|this|coming)?\\s*(${WD_RE})\\b`)))) {
    const target = wd(m[2]), d = day(0);
    d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
    return { date: d, weekday: target, explicitNext: m[1]?.toLowerCase() === "next" };
  }
  if ((m = take(c, new RegExp(`\\bon\\s+the\\s+(\\d{1,2})${ORD}\\b`)))) {
    const d = day(0), n = +m[1];
    if (n < d.getDate()) d.setMonth(d.getMonth() + 1);
    d.setDate(Math.min(n, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return { date: d };
  }
  return null;
}

/** A time of day: [hours, minutes]. */
function timeFrom(c: Ctx): [number, number] | null {
  let m: RegExpExecArray | null;
  if (take(c, /\b(?:at\s+)?noon\b/) || take(c, /\b(?:at\s+)?midday\b/)) return [12, 0];
  if (take(c, /\b(?:at\s+)?midnight\b/)) return [23, 59];
  if (take(c, /\b(?:by\s+)?(?:end of (?:the )?day|eod)\b/)) return [17, 0];
  if ((m = take(c, /(?:\b(?:at|@|by)\s*|\b)(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/))) {
    let h = +m[1] % 12; if (/^p/i.test(m[3])) h += 12;
    return [h, +(m[2] ?? 0)];
  }
  if ((m = take(c, /\b(?:at|@|by)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(?:o'?clock))?\b(?:\s+in the\s+(morning|afternoon|evening|night))?/))) {
    let h = +m[1];
    const part = m[3]?.toLowerCase();
    // "at 3" means 3 PM, "at 9" means 9 AM: people rarely set 3 AM reminders.
    if (part) { if (part !== "morning" && h < 12) h += 12; }
    else if (h >= 1 && h <= 7) h += 12;
    return [h % 24, +(m[2] ?? 0)];
  }
  if ((m = take(c, /\b(\d{1,2}):(\d{2})\b/))) return [+m[1] % 24, +m[2]];
  if ((m = take(c, /\b(?:in the |this |at )?(morning|afternoon|evening|tonight|night)\b/))) return [PARTS[m[1].toLowerCase()], 0];
  return null;
}

function repeatFrom(c: Ctx, now: Date): { rule: RepeatRule; part?: number } | null {
  let m: RegExpExecArray | null;
  const until = (now: Date): string | undefined => {
    const u = take(c, new RegExp(`\\buntil\\s+(?:the\\s+)?(?:(${MON_RE})\\.?\\s+(\\d{1,2})${ORD}|(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MON_RE})|(\\d{4}-\\d{2}-\\d{2}))(?:,?\\s+(\\d{4}))?`));
    if (!u) return undefined;
    if (u[5]) return u[5];
    const mo = mon(u[1] ?? u[4]) + 1, d = +(u[2] ?? u[3]);
    const y = u[6] ? +u[6] : (() => { const t = new Date(now.getFullYear(), mo - 1, d); return t < now ? now.getFullYear() + 1 : now.getFullYear(); })();
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const withUntil = (rule: RepeatRule, part?: number) => { const u = until(now); return { rule: u ? { ...rule, until: u } : rule, part }; };
  if (take(c, /\b(?:every\s+weekday|on\s+weekdays|weekdays|every\s+work\s*day)\b/)) return withUntil({ freq: "weekdays" });
  if ((m = take(c, /\bevery\s+(morning|afternoon|evening|night)\b/))) return withUntil({ freq: "daily" }, PARTS[m[1].toLowerCase()]);
  {
    // "every friday", "every other tuesday", "mondays and thursdays" repeat; a plain "friday" is a day.
    const re = new RegExp(`\\b(every\\s+(other\\s+)?|on\\s+)?((?:${WD_RE})s?(?:\\s*(?:,|and|&|\\+)\\s*(?:${WD_RE})s?)*)\\b`, "i");
    const p = re.exec(c.text);
    const tokens = p ? p[3].split(/\s*(?:,|and|&|\+)\s*/).filter(Boolean) : [];
    if (p && (/^every/i.test(p[1] ?? "") || tokens.every((t) => /days$/i.test(t)))) {
      m = take(c, re)!;
      const days = [...new Set(tokens.map((s) => wd(s)).filter((n) => n >= 0))];
      return withUntil(m[2] ? { freq: "weekly", interval: 2, days } : { freq: "weekly", days });
    }
  }
  if ((m = take(c, /\bevery\s+(other\s+)?(?:(\d{1,2}|two|three|four|five|six)\s+)?(day|week|month|year)s?\b/))) {
    const freq = ({ day: "daily", week: "weekly", month: "monthly", year: "yearly" } as const)[m[3].toLowerCase() as "day"];
    const iv = m[1] ? 2 : m[2] ? num(m[2]) : 1;
    return withUntil(iv > 1 ? { freq, interval: iv } : { freq });
  }
  if ((m = take(c, /\b(daily|weekly|monthly|yearly|annually|fortnightly|biweekly)\b/))) {
    const k = m[1].toLowerCase();
    if (k === "fortnightly" || k === "biweekly") return withUntil({ freq: "weekly", interval: 2 });
    return withUntil({ freq: k === "annually" ? "yearly" : (k as RepeatRule["freq"]) });
  }
  return null;
}

export function parseReminder(input: string, now = new Date()): ParsedReminder {
  const c: Ctx = { text: ` ${input.trim()} `, matched: [] };
  c.text = c.text.replace(/^\s*(?:hey\s+orbital,?\s*)?(?:please\s+)?(?:remind\s+me\s+(?:to\s+|about\s+|that\s+|of\s+)?|reminder:?\s*|remember\s+to\s+|set\s+a\s+reminder\s+(?:to\s+|for\s+)?)/i, " ");

  let when: Date | null = null;
  const rel = take(c, /\bin\s+(a couple of|a few|half an?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty-five|\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|weeks?|months?)\b/);
  const repeat = repeatFrom(c, now);
  const day = dayFrom(c, now);
  const time = timeFrom(c) ?? (repeat?.part !== undefined ? [repeat.part, 0] as [number, number] : null);

  if (rel) {
    const half = /^half/i.test(rel[1]);
    const n = half ? 0.5 : num(rel[1]);
    const u = rel[2].toLowerCase();
    when = new Date(now);
    if (/^m(?!o)/.test(u)) when.setTime(now.getTime() + n * 60_000);
    else if (/^h/.test(u)) when.setTime(now.getTime() + n * 3_600_000);
    else if (/^d/.test(u)) when.setDate(when.getDate() + n);
    else if (/^w/.test(u)) when.setDate(when.getDate() + 7 * n);
    else if (/^mo/.test(u)) when.setMonth(when.getMonth() + n);
    if (time && !/^[mh]/.test(u)) when.setHours(time[0], time[1], 0, 0);
    else when.setSeconds(0, 0);
  } else if (day || time || repeat) {
    const [h, mi] = time ?? [9, 0];
    when = new Date(day?.date ?? now);
    when.setHours(h, mi, 0, 0);
    if (day?.explicitNext && day.weekday !== undefined && when.getDate() === now.getDate() && when.getMonth() === now.getMonth()) when.setDate(when.getDate() + 7);
    // A time alone (or a weekday that's today) that has already passed means the next one.
    if (when.getTime() <= now.getTime() && (!day || day.weekday !== undefined)) when.setDate(when.getDate() + (day?.weekday !== undefined ? 7 : 1));
    if (repeat?.rule.freq === "weekly" && repeat.rule.days?.length && !day) {
      // Start on the first chosen day that's still ahead.
      for (let i = 0; i < 8 && (!repeat.rule.days.includes(when.getDay()) || when.getTime() <= now.getTime()); i++) when.setDate(when.getDate() + 1);
    }
    if (repeat?.rule.freq === "weekdays") while (when.getDay() === 0 || when.getDay() === 6 || when.getTime() <= now.getTime()) when.setDate(when.getDate() + 1);
  }

  let title = c.text.replace(/\s+/g, " ").trim()
    .replace(/^(?:to|about|that|of)\s+/i, "")
    .replace(/\s+(?:on|at|by|for|in|from|starting)$/i, "")
    .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "");
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title, when, repeat: repeat?.rule ?? null, matched: c.matched };
}
