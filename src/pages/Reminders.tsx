import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellRing, Check, Clock, Lightbulb, Repeat, Sparkles, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useResource, invalidate } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Empty, IconButton, Input, PageHeader, Pulse, cx } from "@/components/ui";
import { formatWhen, localToday, quickTimes, toLocalInput } from "@/lib/when";
import { useApp } from "@/state/app";
import { tx } from "@/i18n";
import { createReminder, describeReminder, repeatLabel, type RepeatRule } from "@/lib/reminders";
import { parseReminder } from "../../shared/reminderText";

const NUDGE_LABEL: Record<string, string> = {
  overdue: "Overdue", due_soon: "Due soon", milestone: "Milestone", deadline: "Deadline", stalled_project: "Stalled",
  unfinished_idea: "Unfinished idea", stale_opportunity: "Opportunity", open_question: "Open question",
};

export function RemindersPage() {
  const { data: reminders, loading } = useResource<any[]>("/reminders");
  const today = localToday();
  const showNudges = useApp((s) => s.prefs.nudges) !== false;
  const { data: nudges } = useResource<any[]>(showNudges ? `/nudges?today=${today}` : null);
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));

  const due = reminders?.filter((r) => r.status === "fired") ?? [];
  const upcoming = reminders?.filter((r) => r.status === "scheduled") ?? [];
  const finished = reminders?.filter((r) => r.status === "done" || r.status === "dismissed") ?? [];
  const refresh = () => invalidate("/reminders", "/nudges");

  const patch = async (id: string, body: Record<string, unknown>) => { try { await api.patch(`/reminders/${id}`, body); refresh(); } catch (e) { toastError(e); } };
  const snooze = (id: string, ms: number) => patch(id, { dueAt: new Date(Date.now() + ms).toISOString() });
  const remindLater = async (n: any) => {
    try {
      await api.post("/reminders", { title: n.title, note: n.detail, itemType: n.itemType, itemId: n.itemId, dueAt: quickTimes().find((q) => q.label === "Tomorrow morning")!.date.toISOString() });
      await api.post("/nudges/dismiss", { key: n.key, snoozeDays: 1 });
      refresh();
      toast(tx("Reminder set for tomorrow morning"));
    } catch (e) { toastError(e); }
  };
  const dismiss = async (n: any, snoozeDays: number | null) => {
    try { await api.post("/nudges/dismiss", { key: n.key, snoozeDays }); invalidate("/nudges"); } catch (e) { toastError(e); }
  };

  return (
    <div className="h-full overflow-y-auto pb-16">
      <PageHeader title={tx("Reminders")} subtitle={tx("Things you asked Orbital to bring back, and what it noticed you might be letting slip.")}
        actions={window.orbitalDesktop ? undefined /* the desktop app sends system notifications itself */
          : perm === "default" ? <Button icon={<BellRing size={14} />} onClick={() => Notification.requestPermission().then(setPerm)}>{tx("Turn on notifications")}</Button>
          : perm === "denied" ? <span className="text-[0.74rem] text-mute-soft">{tx("Notifications are blocked for this site: reminders show inside Orbital.")}</span> : undefined} />
      <div className="mx-auto max-w-[880px] space-y-8 px-8">
        <NewReminder />
        <div className="min-w-0 space-y-8">
          {due.length > 0 && (
            <section>
              <h2 className="label mb-3">{tx("Due now")}</h2>
              <ul className="space-y-2">
                {due.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 rounded-xl border border-white/25 bg-white/[0.04] px-4 py-3">
                    <BellRing size={16} className="mt-0.5 shrink-0 text-white" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.92rem] text-white">{r.link ? <Link to={r.link} className="hover:underline">{r.title}</Link> : r.title}</div>
                      {r.note && <p className="mt-0.5 text-[0.82rem] text-mute-bright">{r.note}</p>}
                      <div className="mt-1 flex items-center gap-1.5 text-[0.72rem] text-mute">{formatWhen(r.due_at)}{r.series_id && <><span>·</span><Repeat size={10} /> {tx("Repeats")}</>}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => snooze(r.id, 60 * 60_000)}>{tx("1 hour")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => patch(r.id, { dueAt: quickTimes().find((q) => q.label === "Tomorrow morning")!.date.toISOString() })}>{tx("Tomorrow")}</Button>
                      <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => patch(r.id, { status: "done" })}>{tx("Done")}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!showNudges ? <p className="text-[0.8rem] text-mute">{tx("Suggestions about overdue work and unfinished ideas are turned off.")} <Link to="/settings" className="underline decoration-white/20 hover:text-white">{tx("Turn them on in Settings")}</Link>.</p> : (
          <section>
            <h2 className="label mb-3 flex items-center gap-2"><Lightbulb size={12} /> {tx("Orbital noticed")}</h2>
            {!nudges && <Pulse />}
            {nudges?.length === 0 && <p className="text-[0.86rem] text-mute">{tx("Nothing slipping. Orbital watches for overdue tasks, approaching deadlines, stalled projects, ideas you haven't returned to (notes tagged #idea or #draft), quiet opportunities and long-open questions.")}</p>}
            <ul className="space-y-1.5">
              {nudges?.map((n) => (
                <li key={n.key} className="group flex items-start gap-3 glow-card rounded-xl border border-line px-4 py-3 hover:border-line-strong">
                  <Badge tone={n.kind === "overdue" || n.kind === "deadline" ? "warn" : undefined}>{tx(NUDGE_LABEL[n.kind] ?? n.kind)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.9rem] text-white/90">{n.link ? <Link to={n.link} className="hover:text-white hover:underline">{n.title}</Link> : n.title}</div>
                    <div className="text-[0.76rem] text-mute">{n.detail}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100">
                    {n.itemType && <Button size="sm" variant="ghost" icon={<Bell size={12} />} onClick={() => remindLater(n)}>{tx("Tomorrow")}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => dismiss(n, 3)}>{tx("Snooze")}</Button>
                    <IconButton label={tx("Dismiss")} onClick={() => dismiss(n, null)}><X size={14} /></IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          )}

          <section>
            <h2 className="label mb-3">{tx("Upcoming")}</h2>
            {loading && <Pulse />}
            {reminders && upcoming.length === 0 && <Empty title={tx("No reminders scheduled")}>{tx("Set one here, or use the bell on any task, note, project or opportunity.")}</Empty>}
            <ul className="divide-y divide-line rounded-xl border border-line empty:hidden">
              {upcoming.map((r) => (
                <li key={r.id} className="group flex items-center gap-3 px-4 py-2.5">
                  <Clock size={14} className="shrink-0 text-mute" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.88rem] text-white/90">{r.link ? <Link to={r.link} className="hover:underline">{r.title}</Link> : r.title}</div>
                    {(r.note || r.repeat) && <div className="flex items-center gap-1.5 truncate text-[0.76rem] text-mute">
                      {r.repeat && <span className="inline-flex shrink-0 items-center gap-1 text-mute-bright"><Repeat size={11} /> {repeatLabel(r.repeat)}</span>}
                      {r.repeat && r.note && <span>·</span>}{r.note && <span className="truncate">{r.note}</span>}
                    </div>}
                  </div>
                  <span className="shrink-0 text-[0.78rem] text-mute-bright">{r.repeat ? tx("Next: {when}", { when: formatWhen(r.due_at) }) : formatWhen(r.due_at)}</span>
                  {r.repeat && <Button size="sm" variant="ghost" className="hidden group-focus-within:inline-flex group-hover:inline-flex" onClick={() => patch(r.id, { repeat: null })}>{tx("Stop repeating")}</Button>}
                  <IconButton label={r.repeat ? tx("Delete repeating reminder") : tx("Delete reminder")} className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={async () => { await api.del(`/reminders/${r.id}`).catch(toastError); refresh(); }}><Trash2 size={13} /></IconButton>
                </li>
              ))}
            </ul>
          </section>

          {finished.length > 0 && (
            <section>
              <h2 className="label mb-3">{tx("Finished this week")}</h2>
              <ul className="space-y-1">
                {finished.map((r) => <li key={r.id} className="flex items-center gap-2 text-[0.82rem] text-mute"><Check size={12} /> <span className="line-through decoration-white/20">{r.title}</span></li>)}
              </ul>
            </section>
          )}
        </div>

      </div>
    </div>
  );
}

const REPEAT_CHOICES: { value: string; label: string; rule: RepeatRule | null }[] = [
  { value: "", label: "Doesn't repeat", rule: null },
  { value: "daily", label: "Every day", rule: { freq: "daily" } },
  { value: "weekdays", label: "Every weekday", rule: { freq: "weekdays" } },
  { value: "weekly", label: "Every week", rule: { freq: "weekly" } },
  { value: "monthly", label: "Every month", rule: { freq: "monthly" } },
  { value: "yearly", label: "Every year", rule: { freq: "yearly" } },
];

/** One line, typed the way you'd say it: "call Sam friday at 3", "pay rent every month on the 1st". */
function NewReminder() {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  // A chip or picked time overrides what was read from the text; so does choosing a repeat by hand.
  const [picked, setPicked] = useState<Date | null>(null);
  const [custom, setCustom] = useState("");
  const [repeatPick, setRepeatPick] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim() ? parseReminder(text) : null), [text]);
  const fromText = !!parsed?.when && !picked && !custom;
  const at = custom ? new Date(custom) : picked ?? parsed?.when ?? quickTimes()[0].date;
  const repeat: RepeatRule | null = repeatPick !== null ? REPEAT_CHOICES.find((c) => c.value === repeatPick)!.rule : parsed?.repeat ?? null;
  const title = (fromText || parsed?.repeat ? parsed?.title : text.trim()) || text.trim();

  const create = async () => {
    if (!title || Number.isNaN(at.getTime())) return;
    try {
      await createReminder({ title, note: note.trim(), when: at, repeat });
      setText(""); setNote(""); setCustom(""); setPicked(null); setRepeatPick(null);
      toast(tx("Reminder set for {v0}", { v0: describeReminder(at, repeat) }));
    } catch (e) { toastError(e); }
  };
  return (
    <form className="grid gap-3 rounded-xl border border-line p-4" onSubmit={(e) => { e.preventDefault(); create(); }} aria-label={tx("New reminder")}>
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("Remind me to… (try “call Sam Friday at 3” or “pay rent every month on the 1st”)")} aria-label={tx("Reminder")} className="flex-1" />
        <Button variant="primary" type="submit" disabled={!title || Number.isNaN(at.getTime())}>{tx("Set reminder")}</Button>
      </div>
      {fromText || parsed?.repeat ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[0.8rem] text-mute-bright" aria-live="polite">
          <Sparkles size={12} className="text-white" />
          <span className="text-white">{title}</span>
          <span className="text-mute">·</span> {formatWhen(at.toISOString())}
          {repeat && <><span className="text-mute">·</span> <Repeat size={12} /> {repeatLabel(repeat)}</>}
        </p>
      ) : null}
      {text.trim() && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx("Note (optional)")} aria-label={tx("Note")} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {quickTimes().map((q) => (
          <button key={q.label} type="button" onClick={() => { setPicked(q.date); setCustom(""); }}
            className={cx("rounded-full border px-3 py-1 text-[0.78rem]", !custom && !fromText && at.getTime() === q.date.getTime() ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>{tx(q.label)}</button>
        ))}
        <input type="datetime-local" aria-label={tx("Or pick a time")} value={custom} min={toLocalInput(new Date())} onChange={(e) => setCustom(e.target.value)} className="input h-8 w-auto py-0 text-[0.8rem]" />
        <select aria-label={tx("Repeat")} value={repeatPick ?? (repeat ? "__text" : "")} onChange={(e) => setRepeatPick(e.target.value)} className="input h-8 w-auto py-0 text-[0.8rem]">
          {repeat && repeatPick === null && <option value="__text">{repeatLabel(repeat)}</option>}
          {REPEAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{tx(c.label)}</option>)}
        </select>
        <span className="ml-auto text-[0.76rem] text-mute">{Number.isNaN(at.getTime()) ? "" : formatWhen(at.toISOString())}</span>
      </div>
    </form>
  );
}
