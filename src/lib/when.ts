/** Times for reminders, in the person's own time zone. */

const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

export function quickTimes(now = new Date()): { label: string; date: Date }[] {
  const inHour = new Date(now.getTime() + 60 * 60_000);
  const evening = at(now, 18);
  const tomorrow = at(new Date(now.getTime() + 86_400_000), 9);
  const monday = (() => { const d = at(now, 9); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return d; })();
  const list = [{ label: "In 1 hour", date: inHour }];
  if (evening.getTime() - now.getTime() > 90 * 60_000) list.push({ label: "This evening", date: evening });
  list.push({ label: "Tomorrow morning", date: tomorrow });
  list.push({ label: "Next week", date: monday });
  return list;
}

/** "Today 6:00 PM", "Tomorrow 9:00 AM", "Mon, Nov 24 9:00 AM" */
export function formatWhen(iso: string, now = new Date()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })} ${time}`;
}

/** The local date as YYYY-MM-DD (for "is this task overdue?" in the person's own day). */
export const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Value for <input type="datetime-local"> */
export const toLocalInput = (d: Date) => `${localToday(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
