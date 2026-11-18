import { useEffect, useRef, useState } from "react";
import { BellPlus } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { formatWhen, quickTimes, toLocalInput } from "@/lib/when";
import { IconButton, cx } from "./ui";

export type RemindItem = "task" | "document" | "project" | "opportunity" | "gap" | "conversation";

/** "Remind me" for any item: pick a time and Orbital brings it back. */
export function RemindMenu({ itemType, itemId, title, className, size = 14 }: { itemType: RemindItem; itemId: string; title?: string; className?: string; size?: number }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const set = async (date: Date) => {
    try {
      await api.post("/reminders", { itemType, itemId, title, dueAt: date.toISOString() });
      invalidate("/reminders");
      toast(`Reminder set for ${formatWhen(date.toISOString())}`, { action: { label: "Reminders", to: "/reminders" } });
      setOpen(false);
    } catch (e) { toastError(e); }
  };

  return (
    <div ref={ref} className={cx("relative", className)}>
      <IconButton label="Remind me" onClick={() => setOpen((o) => !o)} active={open}><BellPlus size={size} /></IconButton>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-line-strong bg-ink-2 p-1.5 shadow-2xl">
          <div className="label px-2 pb-1 pt-1">Remind me</div>
          {quickTimes().map((q) => (
            <button key={q.label} role="menuitem" onClick={() => set(q.date)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[0.84rem] text-white/90 hover:bg-white/[0.06]">
              {q.label}<span className="text-[0.72rem] text-mute">{formatWhen(q.date.toISOString()).replace(/^(Today|Tomorrow) /, "")}</span>
            </button>
          ))}
          <form className="mt-1 flex gap-1 border-t border-line px-1 pt-2" onSubmit={(e) => { e.preventDefault(); if (custom) set(new Date(custom)); }}>
            <input type="datetime-local" aria-label="Custom time" value={custom} min={toLocalInput(new Date())} onChange={(e) => setCustom(e.target.value)} className="input h-7 min-w-0 flex-1 px-2 py-0 text-[0.76rem]" />
            <button type="submit" disabled={!custom} className="rounded-md bg-white px-2 text-[0.76rem] text-black disabled:opacity-40">Set</button>
          </form>
        </div>
      )}
    </div>
  );
}
