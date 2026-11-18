import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Minimize2, Pause, Play, Plus, Target } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { toastError, useQuiet } from "@/state/ui";
import { useCan } from "@/state/app";
import { Button, Empty, Input, PageHeader, Pulse, Select, Textarea, cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";

/**
 * Focus mode: one objective, a timer, the tasks that serve it and a scratchpad. The rest of
 * Orbital steps back: navigation is hidden and notifications are held until the session ends.
 */
export function FocusPage() {
  const { data, loading } = useResource<any>("/focus");
  if (loading || !data) return <div className="p-10 text-center"><Pulse /></div>;
  return data.active ? <FocusSession session={data.active} /> : <FocusSetup week={data.week} recent={data.recent} />;
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};
const minutes = (sec: number) => `${Math.round(sec / 60)} min`;

function FocusSetup({ week, recent }: { week: { seconds: number; sessions: number }; recent: any[] }) {
  const [params] = useSearchParams();
  const { data: projects } = useResource<any[]>("/projects");
  const [objective, setObjective] = useState(params.get("objective") ?? "");
  const [projectId, setProjectId] = useState(params.get("project") ?? "");
  const [planned, setPlanned] = useState(50);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Coming from a project: suggest its next open task as the objective.
    if (!projectId || objective) return;
    api.get(`/projects/${projectId}`).then((p) => { const next = p.tasks.find((t: any) => !t.done); setObjective(next ? next.title : `Move ${p.name} forward`); }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const start = async () => {
    if (!objective.trim()) return;
    setBusy(true);
    try { await api.post("/focus", { objective: objective.trim(), projectId: projectId || null, plannedMinutes: planned }); invalidate("/focus"); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <div className="h-full overflow-y-auto pb-16">
      <PageHeader title="Focus" subtitle="One objective, a timer and nothing else. Orbital holds notifications until you're done." />
      <div className="grid gap-10 px-8 lg:grid-cols-[minmax(0,560px)_1fr]">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <label className="grid gap-2"><span className="label">What's the one thing?</span>
            <Input autoFocus value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. Draft the pricing page" className="h-11 text-[1rem]" aria-label="Objective" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2"><span className="label">Project</span>
              <Select label="Project" value={projectId} onChange={setProjectId} options={[{ value: "", label: "No project" }, ...(projects ?? []).filter((p) => p.status === "active" || p.id === projectId).map((p) => ({ value: p.id, label: p.name }))]} /></div>
            <div className="grid gap-2"><span className="label">Length</span>
              <div className="flex gap-1.5">
                {[25, 50, 90].map((m) => (
                  <button key={m} type="button" onClick={() => setPlanned(m)} className={cx("h-9 flex-1 rounded-lg border text-[0.84rem]", planned === m ? "border-white bg-white text-black" : "border-line text-mute-bright hover:text-white")}>{m} min</button>
                ))}
              </div></div>
          </div>
          <Button variant="primary" type="submit" icon={<Target size={14} />} loading={busy} disabled={!objective.trim()} className="h-11 justify-self-start px-6">Start focus</Button>
        </form>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line px-4 py-3"><div className="text-[1.4rem] font-light">{minutes(week.seconds)}</div><div className="text-[0.74rem] text-mute">focused this week</div></div>
            <div className="rounded-xl border border-line px-4 py-3"><div className="text-[1.4rem] font-light">{week.sessions}</div><div className="text-[0.74rem] text-mute">session{week.sessions === 1 ? "" : "s"} this week</div></div>
          </div>
          <section>
            <h2 className="label mb-2">Recent sessions</h2>
            {recent.length === 0 ? <Empty title="No sessions yet">Your focus history appears here, with time spent and tasks finished.</Empty> : (
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex items-baseline gap-3"><span className="flex-1 truncate text-[0.88rem] text-white/90">{r.objective}</span><span className="shrink-0 text-[0.72rem] text-mute">{timeAgo(r.started_at)}</span></div>
                    <div className="text-[0.74rem] text-mute">{minutes(r.focused_seconds)}{r.tasks_completed ? ` · ${r.tasks_completed} task${r.tasks_completed === 1 ? "" : "s"} done` : ""}{r.project_name ? ` · ${r.project_name}` : ""}
                      {r.document_id && <> · <Link to={`/knowledge/${r.document_id}`} className="underline decoration-white/20 hover:text-white">notes</Link></>}</div>
                    {r.outcome && <p className="mt-0.5 text-[0.8rem] text-mute-bright">{r.outcome}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function FocusSession({ session }: { session: any }) {
  const navigate = useNavigate();
  const can = useCan();
  const quiet = useQuiet();
  const [elapsed, setElapsed] = useState<number>(session.focused_seconds);
  const [running, setRunning] = useState(session.focused_seconds === 0);
  const [notes, setNotes] = useState<string>(session.notes ?? "");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [ending, setEnding] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [summary, setSummary] = useState<any>(null);
  const [newTask, setNewTask] = useState("");
  const elapsedRef = useRef(elapsed);
  elapsedRef.current = elapsed;
  const chimed = useRef(elapsed >= session.planned_minutes * 60);
  const { data: project } = useResource<any>(session.project_id ? `/projects/${session.project_id}` : null);
  const planned = session.planned_minutes * 60;

  // Hold notifications while the session is open.
  useEffect(() => { quiet.set(true); quiet.clear(); return () => quiet.set(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    const t = setInterval(() => { const now = Date.now(); setElapsed((e) => e + (now - last) / 1000); last = now; }, 250);
    return () => clearInterval(t);
  }, [running]);

  const ended = useRef(false);
  const persist = useCallback(() => { if (!ended.current) api.patch(`/focus/${session.id}`, { focusedSeconds: Math.floor(elapsedRef.current) }).catch(() => {}); }, [session.id]);
  useEffect(() => { if (!running) { persist(); return; } const t = setInterval(persist, 30_000); return () => clearInterval(t); }, [running, persist]);
  useEffect(() => {
    const save = () => { persist(); };
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [persist]);

  // A soft chime when the planned time is up. The timer keeps going.
  useEffect(() => {
    if (chimed.current || elapsed < planned) return;
    chimed.current = true;
    try {
      const ctx = new AudioContext();
      [0, 0.18].forEach((d, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = i ? 880 : 660; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.9);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 1);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch { /* no audio */ }
  }, [elapsed, planned]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.code === "Space") { e.preventDefault(); setRunning((r) => !r); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const editNotes = (v: string) => {
    setNotes(v);
    setSaved("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await api.patch(`/focus/${session.id}`, { notes: v }); setSaved("saved"); } catch (e) { toastError(e); setSaved("idle"); }
    }, 900);
  };

  const reloadProject = () => session.project_id && invalidate(`/projects/${session.project_id}`, "/projects");
  const toggle = async (t: any) => { await api.patch(`/tasks/${t.id}`, { done: !t.done }).catch(toastError); reloadProject(); };
  const addTask = async () => { if (!newTask.trim() || !session.project_id) return; await api.post(`/projects/${session.project_id}/tasks`, { title: newTask.trim() }).catch(toastError); setNewTask(""); reloadProject(); };

  const end = async () => {
    clearTimeout(saveTimer.current);
    try {
      if (can.write && notes !== (session.notes ?? "")) await api.patch(`/focus/${session.id}`, { notes });
      const r = await api.post(`/focus/${session.id}/end`, { focusedSeconds: Math.floor(elapsed), outcome: outcome.trim() });
      ended.current = true;
      setSummary({ ...r, held: useQuiet.getState().held.length });
      quiet.set(false);
    } catch (e) { toastError(e); }
  };

  const remaining = planned - elapsed;
  const progress = Math.min(1, elapsed / planned);
  const tasks: any[] = project?.tasks ?? [];
  const open = tasks.filter((t) => !t.done), doneHere = tasks.filter((t) => t.done && t.completed_at && Date.parse(t.completed_at) >= Date.parse(session.started_at));

  if (summary) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black px-6">
        <div className="grid max-w-md justify-items-center gap-3 text-center">
          <div className="label">Session complete</div>
          <h1 className="text-[1.8rem] font-light tracking-[-0.02em]">{summary.objective}</h1>
          <p className="text-mute-bright">{minutes(summary.focused_seconds)} focused{summary.tasks_completed ? ` · ${summary.tasks_completed} task${summary.tasks_completed === 1 ? "" : "s"} done` : ""}</p>
          {summary.held > 0 && <p className="text-[0.84rem] text-mute">{summary.held} notification{summary.held === 1 ? " was" : "s were"} held while you focused. Check Reminders and Operations for anything waiting.</p>}
          <div className="mt-3 flex gap-2">
            {summary.document_id && <Button onClick={() => navigate(`/knowledge/${summary.document_id}`)}>Open notes</Button>}
            <Button variant="primary" onClick={() => { invalidate("/focus", "/growth"); navigate("/focus"); }}>Done</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      <header className="flex items-center gap-3 px-6 py-4">
        <span className="flex items-center gap-2 text-[0.74rem] uppercase tracking-[0.18em] text-mute"><Target size={13} /> Focus{session.project_name ? ` · ${session.project_name}` : ""}</span>
        <span className="text-[0.74rem] text-mute-soft">Notifications held</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Minimize2 size={13} />} title="Leave the session running and go back to Orbital" onClick={() => { persist(); navigate("/"); }}>Step out</Button>
          <Button size="sm" onClick={() => { setRunning(false); setEnding(true); }}>End session</Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-8 overflow-y-auto px-6 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:px-16">
        <div className="flex flex-col items-center justify-center gap-6 py-6 text-center">
          <h1 className="max-w-xl text-[clamp(1.6rem,3vw,2.4rem)] font-light leading-tight tracking-[-0.02em]">{session.objective}</h1>
          <div className="relative h-56 w-56">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
              <circle cx="50" cy="50" r="46" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={`${progress * 289} 289`} style={{ transition: "stroke-dasharray .3s linear" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-mono text-[2.4rem] font-light tabular-nums" role="timer" aria-live="off">{remaining >= 0 ? fmt(remaining) : `+${fmt(-remaining)}`}</div>
              <div className="text-[0.74rem] text-mute">{remaining >= 0 ? `of ${session.planned_minutes} min` : "past your planned time"}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" icon={running ? <Pause size={14} /> : <Play size={14} />} onClick={() => setRunning(!running)}>{running ? "Pause" : elapsed > 0 ? "Resume" : "Start"}</Button>
          </div>
          <p className="text-[0.74rem] text-mute-soft">Space to pause · {minutes(elapsed)} focused so far</p>
        </div>

        <div className="flex min-h-0 flex-col gap-6 py-6">
          {session.project_id && (
            <section>
              <h2 className="label mb-2">Tasks</h2>
              <ul className="space-y-0.5">
                {open.slice(0, 12).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-1">
                    <button aria-label="Mark complete" onClick={() => toggle(t)} className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/30 hover:border-white/70" />
                    <span className="text-[0.9rem] text-white/90">{t.title}</span>
                  </li>
                ))}
                {doneHere.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-1">
                    <button aria-label="Mark incomplete" onClick={() => toggle(t)} className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white bg-white text-black"><Check size={11} /></button>
                    <span className="text-[0.9rem] text-mute line-through">{t.title}</span>
                  </li>
                ))}
                {project && open.length === 0 && doneHere.length === 0 && <li className="text-[0.84rem] text-mute">No open tasks in this project.</li>}
              </ul>
              {can.write && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); addTask(); }}>
                  <Input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task" className="h-8 text-[0.84rem]" aria-label="New task" />
                  <Button size="sm" type="submit" icon={<Plus size={12} />}>Add</Button>
                </form>
              )}
            </section>
          )}
          <section className="flex min-h-[240px] flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2"><h2 className="label">Scratchpad</h2><span className="text-[0.7rem] text-mute-soft">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved to Knowledge" : can.write ? "Saved to Knowledge as you type" : "Viewers' notes aren't saved"}</span></div>
            <Textarea value={notes} onChange={(e) => editNotes(e.target.value)} disabled={!can.write} placeholder="Think out loud. Drafts, decisions, next steps…"
              className="min-h-[200px] flex-1 border-line bg-white/[0.02] font-mono text-[0.86rem] leading-[1.7]" aria-label="Scratchpad" />
          </section>
        </div>
      </div>

      {ending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6" role="dialog" aria-label="End focus session">
          <form className="grid w-full max-w-md gap-3 rounded-2xl border border-line-strong bg-ink-2 p-6" onSubmit={(e) => { e.preventDefault(); end(); }}>
            <div className="text-[1rem]">How did it go?</div>
            <Textarea autoFocus rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What you got done, or where to pick up next time (optional)" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => { setEnding(false); setRunning(true); }}>Keep going</Button>
              <Button variant="primary" type="submit">End session</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
