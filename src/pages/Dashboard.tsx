import { useState } from "react";
import { ArrowLeft, ArrowRight, GripVertical, LayoutGrid, Plus, Settings2, Trash2, X } from "lucide-react";
import { tx } from "@/i18n";
import { Button, Dialog, Input } from "@/components/ui";
import { toastError } from "@/state/ui";
import { saveDashboard, saveEnvironment, useEnvironment } from "@/state/environment";
import { LIMITS, TEMPLATES, WIDGETS, type Dashboard, type Widget, type WidgetSize, type WidgetType } from "../../shared/environment";
import { WIDGET_BODIES, WIDGET_LINKS, WidgetLink } from "./dashboard/widgets";

const SPAN: Record<WidgetSize, string> = { s: "lg:col-span-4", m: "lg:col-span-6", l: "lg:col-span-12" };

const meta = (type: WidgetType) => WIDGETS.find((w) => w.type === type)!;
const newId = (taken: string[], base: string) => { let id = base.slice(0, 32) || "dash", n = 2; while (taken.includes(id)) id = `${base.slice(0, 30)}-${n++}`; return id; };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Your dashboards: widgets you choose, sized and arranged the way you like. */
export function DashboardPage() {
  const env = useEnvironment();
  const dash = env.dashboards.find((d) => d.id === env.activeDashboard) ?? env.dashboards[0];
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  const update = (d: Dashboard) => saveDashboard(d).catch(toastError);
  const setWidgets = (widgets: Widget[]) => update({ ...dash, widgets });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= dash.widgets.length || from === to) return;
    const ws = [...dash.widgets]; const [w] = ws.splice(from, 1); ws.splice(to, 0, w); setWidgets(ws);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pb-16 pt-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={tx("Dashboards")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {env.dashboards.map((d) => (
              <button key={d.id} role="tab" aria-selected={d.id === dash.id} onClick={() => saveEnvironment({ activeDashboard: d.id }).catch(toastError)}
                className={d.id === dash.id ? "rounded-lg bg-white/[0.08] px-3 py-1.5 text-[0.9rem] text-white" : "rounded-lg px-3 py-1.5 text-[0.9rem] text-mute hover:bg-white/[0.04] hover:text-white"}>
                {d.name}
              </button>
            ))}
            {env.dashboards.length < LIMITS.dashboards && (
              <button onClick={() => setCreating(true)} className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-white/[0.04] hover:text-white" aria-label={tx("New dashboard")} title={tx("New dashboard")}><Plus size={15} /></button>
            )}
          </div>
          {editing && <Button size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={dash.widgets.length >= LIMITS.widgets}><Plus size={14} /> {tx("Add widget")}</Button>}
          <Button size="sm" variant={editing ? "primary" : "ghost"} onClick={() => setEditing(!editing)}>{editing ? tx("Done") : <><Settings2 size={14} /> {tx("Customize")}</>}</Button>
        </div>

        {editing && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3 text-[0.82rem]">
            <label className="flex items-center gap-2 text-mute">{tx("Name")}
              <Input defaultValue={dash.name} key={dash.id} maxLength={LIMITS.name} className="h-8 w-52"
                onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== dash.name) update({ ...dash, name }); }} />
            </label>
            <span className="text-mute-soft">{tx("Drag widgets to rearrange them; resize or remove them from their corner.")}</span>
            {env.dashboards.length > 1 && (
              <Button size="sm" variant="ghost" className="ml-auto text-red-300" onClick={() => {
                if (!confirm(tx("Delete the dashboard \"{name}\"? Your data isn't affected.", { name: dash.name }))) return;
                const rest = env.dashboards.filter((d) => d.id !== dash.id);
                saveEnvironment({ dashboards: rest, activeDashboard: rest[0].id }).catch(toastError);
                setEditing(false);
              }}><Trash2 size={14} /> {tx("Delete dashboard")}</Button>
            )}
          </div>
        )}

        {dash.widgets.length === 0 ? (
          <div className="mt-16 grid place-items-center gap-3 text-center">
            <LayoutGrid size={28} className="text-mute-soft" />
            <p className="text-[0.95rem] text-white">{tx("This dashboard is empty")}</p>
            <p className="max-w-sm text-[0.84rem] text-mute">{tx("Add widgets for the things you check most: tasks, projects, notes, research and more.")}</p>
            <Button size="sm" onClick={() => { setEditing(true); setAdding(true); }}><Plus size={14} /> {tx("Add widget")}</Button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-12 gap-4">
            {dash.widgets.map((w, i) => {
              const m = meta(w.type), Body = WIDGET_BODIES[w.type], link = WIDGET_LINKS[w.type];
              return (
                <section key={w.id} aria-label={tx(m.title)}
                  className={`col-span-12 ${SPAN[w.size]} flex min-w-0 flex-col rounded-xl border bg-ink-1/60 p-4 transition-[border-color,opacity] ${dragging === w.id ? "opacity-40" : ""} ${editing ? "border-dashed border-line-strong" : "border-line"}`}
                  draggable={editing}
                  onDragStart={(e) => { setDragging(w.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (dragging) move(dash.widgets.findIndex((x) => x.id === dragging), i); setDragging(null); }}>
                  <header className="mb-3 flex items-center gap-2">
                    {editing && <GripVertical size={14} className="shrink-0 cursor-grab text-mute" aria-hidden />}
                    {w.type !== "today" && <h2 className="label min-w-0 flex-1 truncate">{tx(m.title)}</h2>}
                    {w.type === "today" && <span className="flex-1" />}
                    {!editing && link && <WidgetLink to={link} />}
                    {editing && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-1 text-mute hover:text-white disabled:opacity-30" aria-label={tx("Move earlier")} title={tx("Move earlier")}><ArrowLeft size={13} /></button>
                        <button onClick={() => move(i, i + 1)} disabled={i === dash.widgets.length - 1} className="rounded p-1 text-mute hover:text-white disabled:opacity-30" aria-label={tx("Move later")} title={tx("Move later")}><ArrowRight size={13} /></button>
                        <div role="group" aria-label={tx("Size")} className="ml-1 flex rounded-md border border-line">
                          {(["s", "m", "l"] as const).map((s) => (
                            <button key={s} onClick={() => setWidgets(dash.widgets.map((x) => (x.id === w.id ? { ...x, size: s } : x)))} aria-pressed={w.size === s} title={{ s: tx("Small"), m: tx("Medium"), l: tx("Wide") }[s]}
                              className={w.size === s ? "bg-white px-1.5 text-[0.7rem] text-black" : "px-1.5 text-[0.7rem] text-mute hover:text-white"}>{s.toUpperCase()}</button>
                          ))}
                        </div>
                        <button onClick={() => setWidgets(dash.widgets.filter((x) => x.id !== w.id))} className="ml-1 rounded p-1 text-mute hover:text-red-300" aria-label={tx("Remove widget")} title={tx("Remove widget")}><X size={14} /></button>
                      </div>
                    )}
                  </header>
                  <div className={editing ? "pointer-events-none select-none" : ""}><Body /></div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title={tx("Add a widget")} width="max-w-2xl">
        <ul className="grid gap-2 sm:grid-cols-2">
          {WIDGETS.map((m) => {
            const added = dash.widgets.some((w) => w.type === m.type);
            return (
              <li key={m.type}>
                <button disabled={added} onClick={() => { setWidgets([...dash.widgets, { id: m.type, type: m.type, size: m.size }]); setAdding(false); }}
                  className="w-full rounded-lg border border-line px-3 py-2.5 text-left hover:border-white/30 hover:bg-white/[0.03] disabled:cursor-default disabled:opacity-45 disabled:hover:border-line disabled:hover:bg-transparent">
                  <div className="flex items-center gap-2 text-[0.88rem] text-white">{tx(m.title)}{added && <span className="text-[0.7rem] text-mute">· {tx("added")}</span>}</div>
                  <div className="mt-0.5 text-[0.78rem] text-mute">{tx(m.description)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <NewDashboard open={creating} onClose={() => setCreating(false)} onCreate={(name, template) => {
        const t = TEMPLATES.find((x) => x.id === template)!;
        const id = newId(env.dashboards.map((d) => d.id), slugify(name) || t.id);
        saveEnvironment({ dashboards: [...env.dashboards, { id, name, widgets: t.widgets }], activeDashboard: id }).catch(toastError);
        setCreating(false);
        if (template === "blank") setEditing(true);
      }} />
    </div>
  );
}

function NewDashboard({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string, template: string) => void }) {
  const [template, setTemplate] = useState("overview");
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title={tx("New dashboard")} width="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onCreate(name.trim() || tx(TEMPLATES.find((t) => t.id === template)!.name), template); setName(""); }}>
        <label className="block space-y-1.5 text-[0.82rem] text-mute">{tx("Name")}
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} placeholder={tx(TEMPLATES.find((t) => t.id === template)!.name)} autoFocus />
        </label>
        <div role="radiogroup" aria-label={tx("Start from")} className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button type="button" role="radio" aria-checked={template === t.id} key={t.id} onClick={() => setTemplate(t.id)}
              className={template === t.id ? "rounded-lg border border-accent bg-white/[0.04] px-3 py-2.5 text-left" : "rounded-lg border border-line px-3 py-2.5 text-left hover:border-white/30"}>
              <div className="text-[0.88rem] text-white">{tx(t.name)}</div>
              <div className="mt-0.5 text-[0.76rem] text-mute">{tx(t.description)}</div>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>{tx("Cancel")}</Button>
          <Button type="submit" size="sm">{tx("Create")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
