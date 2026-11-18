import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Compass, MessageSquarePlus, FileText, Check, Flag } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { usePanel, toast, toastError } from "@/state/ui";
import { useCan } from "@/state/app";
import { Badge, Button, Dialog, Empty, IconButton, Input, PageHeader, Pulse, Select, Textarea, cx } from "@/components/ui";
import { Section } from "@/components/RightPanel";
import { label, timeAgo } from "@/lib/format";

export function ProjectsPage() {
  const { id } = useParams();
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => () => setContent("", null), [setContent]);
  return id ? <ProjectDetail id={id} /> : <ProjectList />;
}

function ProjectList() {
  const { data, loading } = useResource<any[]>("/projects");
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(!!params.get("new"));
  const can = useCan();
  useEffect(() => { if (params.get("new")) setOpen(true); }, [params]);
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Projects" subtitle="Orbital keeps each project's context so you can pick up where you left off." actions={can.write ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpen(true)}>New project</Button> : undefined} />
      <div className="px-8 pb-12">
        {loading && <div className="py-10 text-center"><Pulse /></div>}
        {data?.length === 0 && <Empty title="No projects yet" action={<Button variant="primary" onClick={() => setOpen(true)}>Create a project</Button>}>A project gathers its goals, tasks, notes, research and conversations — and gives Orbital the context to help you continue.</Empty>}
        <ul className="divide-y divide-line">
          {data?.map((p) => {
            const progress = p.task_count ? p.tasks_done / p.task_count : 0;
            return (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="group flex items-center gap-6 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="text-[0.95rem] text-white group-hover:underline decoration-white/30 underline-offset-2">{p.name}</span>{p.status !== "active" && <Badge>{p.status}</Badge>}</div>
                    {p.description && <p className="mt-0.5 line-clamp-1 text-[0.83rem] text-mute">{p.description}</p>}
                  </div>
                  <div className="w-40 shrink-0">
                    <div className="h-1 rounded-full bg-white/[0.07]"><div className="h-1 rounded-full bg-white/70 transition-all" style={{ width: `${progress * 100}%` }} /></div>
                    <div className="mt-1 text-[0.72rem] text-mute">{p.task_count ? `${p.tasks_done} of ${p.task_count} tasks` : "No tasks"}</div>
                  </div>
                  <span className="w-20 shrink-0 text-right text-[0.72rem] text-mute-soft">{timeAgo(p.updated_at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <NewProject open={open} onClose={() => { setOpen(false); setParams({}); }} />
    </div>
  );
}

function NewProject({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: "", description: "", goals: "" });
  const navigate = useNavigate();
  const submit = async () => {
    try { const p = await api.post("/projects", f); invalidate("/projects", "/graph", "/growth"); onClose(); setF({ name: "", description: "", goals: "" }); navigate(`/projects/${p.id}`); } catch (e) { toastError(e); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="New project">
      <div className="space-y-3">
        <Input placeholder="Name — e.g. Launch My SaaS" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
        <Textarea rows={2} placeholder="What is it?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} aria-label="Description" />
        <Textarea rows={2} placeholder="Goals — what does success look like?" value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} aria-label="Goals" />
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!f.name.trim()} onClick={submit}>Create</Button></div>
      </div>
    </Dialog>
  );
}

function ProjectDetail({ id }: { id: string }) {
  const { data: p, error } = useResource<any>(`/projects/${id}`);
  const navigate = useNavigate();
  const setContent = usePanel((s) => s.setContent);
  const [task, setTask] = useState("");
  const [milestone, setMilestone] = useState("");
  const [msFor, setMsFor] = useState("");
  const [edit, setEdit] = useState(false);

  useEffect(() => { if (p) setContent("Project context", <ProjectSide p={p} />); }, [p, setContent]);
  if (error) return <div className="p-8 text-mute">Project not found.</div>;
  if (!p) return <div className="p-10 text-center"><Pulse /></div>;

  const reload = () => invalidate(`/projects/${id}`, "/projects");
  const addTask = async () => { if (!task.trim()) return; await api.post(`/projects/${id}/tasks`, { title: task, milestoneId: msFor || null }).catch(toastError); setTask(""); reload(); };
  const addMs = async () => { if (!milestone.trim()) return; await api.post(`/projects/${id}/milestones`, { title: milestone }).catch(toastError); setMilestone(""); reload(); };
  const toggle = async (t: any) => { await api.patch(`/tasks/${t.id}`, { done: !t.done }).catch(toastError); reload(); invalidate("/growth"); };
  const done = p.tasks.filter((t: any) => t.done).length;
  const groups = [...p.milestones.map((m: any) => ({ m, tasks: p.tasks.filter((t: any) => t.milestone_id === m.id) })), { m: null, tasks: p.tasks.filter((t: any) => !t.milestone_id) }];

  const newChat = async () => {
    const c = await api.post("/conversations", { projectId: id });
    invalidate("/conversations");
    navigate(`/c/${c.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 pb-20 pt-6">
        <Link to="/projects" className="text-[0.8rem] text-mute hover:text-white">← Projects</Link>
        <div className="mt-3 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.45rem] font-light tracking-[-0.015em]">{p.name}</h1>
            {!edit && p.description && <p className="mt-1.5 text-[0.9rem] leading-relaxed text-mute-bright">{p.description}</p>}
            {!edit && p.goals && <p className="mt-2 text-[0.86rem] text-mute"><span className="text-white/70">Goals · </span>{p.goals}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Select label="Status" value={p.status} className="h-8 w-32 text-[0.8rem]" onChange={async (v) => { await api.patch(`/projects/${id}`, { status: v }).catch(toastError); reload(); }}
              options={["active", "paused", "completed", "archived"].map((s) => ({ value: s, label: s }))} />
            <Button size="sm" variant="ghost" onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit"}</Button>
            <IconButton label="Delete project" onClick={async () => { if (!confirm("Delete this project and its tasks? Linked notes and research are kept.")) return; await api.del(`/projects/${id}`).catch(toastError); invalidate("/projects", "/graph"); navigate("/projects"); }}><Trash2 size={14} /></IconButton>
          </div>
        </div>
        {edit && <EditProject p={p} onSaved={reload} />}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" icon={<MessageSquarePlus size={13} />} onClick={newChat}>Discuss with Orbital</Button>
          <Button size="sm" icon={<Compass size={13} />} onClick={() => navigate(`/research?q=${encodeURIComponent(p.name + ": ")}`)}>Research for this project</Button>
          <Button size="sm" icon={<FileText size={13} />} onClick={async () => { const d = await api.post("/documents", { title: `${p.name} — note`, body: "", projectId: id }); invalidate("/documents"); navigate(`/knowledge/${d.id}`); }}>Add note</Button>
        </div>

        <Brief id={id} />

        <section className="mt-10">
          <div className="flex items-baseline gap-3">
            <h2 className="label">Tasks & milestones</h2>
            <span className="text-[0.75rem] text-mute">{done}/{p.tasks.length} complete</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-white/[0.06]"><div className="h-1 rounded-full bg-white/70 transition-all" style={{ width: `${p.tasks.length ? (done / p.tasks.length) * 100 : 0}%` }} /></div>
          {groups.map(({ m, tasks }) => (m || tasks.length > 0) && (
            <div key={m?.id ?? "none"} className="mt-6">
              {m && (
                <div className="mb-1.5 flex items-center gap-2">
                  <button aria-label={m.done ? "Mark milestone incomplete" : "Complete milestone"} onClick={async () => { await api.patch(`/milestones/${m.id}`, { done: !m.done }).catch(toastError); reload(); }}
                    className={cx("flex h-4 w-4 items-center justify-center rounded-full border", m.done ? "border-white bg-white text-black" : "border-white/40")}>{m.done && <Check size={10} />}</button>
                  <Flag size={12} className="text-mute" />
                  <span className={cx("text-[0.88rem]", m.done ? "text-mute line-through" : "text-white")}>{m.title}</span>
                  <IconButton label="Delete milestone" className="ml-auto h-6 w-6" onClick={async () => { await api.del(`/milestones/${m.id}`); reload(); }}><Trash2 size={12} /></IconButton>
                </div>
              )}
              {!m && p.milestones.length > 0 && <div className="mb-1.5 text-[0.8rem] text-mute">Other tasks</div>}
              <ul className={cx(m && "ml-6")}>
                {tasks.map((t: any) => (
                  <li key={t.id} className="group flex items-center gap-3 py-1.5">
                    <button aria-label={t.done ? "Mark incomplete" : "Mark complete"} onClick={() => toggle(t)} className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors", t.done ? "border-white bg-white text-black" : "border-white/30 hover:border-white/70")}>{t.done && <Check size={11} />}</button>
                    <span className={cx("flex-1 text-[0.88rem]", t.done ? "text-mute line-through" : "text-white/90")}>{t.title}</span>
                    {t.due_date && <span className="text-[0.72rem] text-mute">{t.due_date}</span>}
                    <IconButton label="Delete task" className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={async () => { await api.del(`/tasks/${t.id}`); reload(); }}><Trash2 size={12} /></IconButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-5 flex gap-2">
            <Input value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="Add a task" aria-label="New task" className="h-9" />
            {p.milestones.length > 0 && <Select label="Milestone" value={msFor} onChange={setMsFor} className="w-48" options={[{ value: "", label: "No milestone" }, ...p.milestones.map((m: any) => ({ value: m.id, label: m.title }))]} />}
            <Button onClick={addTask}>Add</Button>
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={milestone} onChange={(e) => setMilestone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMs()} placeholder="Add a milestone" aria-label="New milestone" className="h-9" />
            <Button variant="ghost" onClick={addMs}>Add milestone</Button>
          </div>
        </section>

        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <LinkedList title="Research" items={p.research.map((r: any) => ({ id: r.id, to: `/research/${r.id}`, title: r.question, meta: r.status }))} empty="No research linked." />
          <LinkedList title="Notes & documents" items={p.documents.map((d: any) => ({ id: d.id, to: `/knowledge/${d.id}`, title: d.title, meta: label(d.kind) }))} empty="No notes linked." />
          <LinkedList title="Conversations" items={p.conversations.map((c: any) => ({ id: c.id, to: `/c/${c.id}`, title: c.title, meta: timeAgo(c.updated_at) }))} empty="No conversations yet." />
          {p.opportunities.length > 0 && <LinkedList title="From opportunities" items={p.opportunities.map((o: any) => ({ id: o.id, to: `/opportunities`, title: o.title, meta: o.status }))} empty="" />}
        </div>
      </div>
    </div>
  );
}

function EditProject({ p, onSaved }: { p: any; onSaved: () => void }) {
  const [f, setF] = useState({ name: p.name, description: p.description, goals: p.goals });
  return (
    <div className="mt-4 space-y-2">
      <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
      <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" aria-label="Description" />
      <Textarea rows={2} value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} placeholder="Goals" aria-label="Goals" />
      <Button size="sm" variant="primary" onClick={async () => { await api.patch(`/projects/${p.id}`, f).catch(toastError); onSaved(); toast("Project updated"); }}>Save</Button>
    </div>
  );
}

function Brief({ id }: { id: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await api.get(`/projects/${id}/brief`)); } catch (e) { toastError(e); } finally { setLoading(false); }
  };
  return (
    <section className="mt-8 rounded-xl border border-line px-5 py-4">
      <div className="flex items-center gap-3">
        <h2 className="text-[0.9rem]">Continue where you left off</h2>
        {data?.aiGenerated && <Badge tone="ai">AI-generated</Badge>}
        <Button size="sm" variant="ghost" className="ml-auto" loading={loading} onClick={load}>{data ? "Refresh" : "Generate brief"}</Button>
      </div>
      {!data && !loading && <p className="mt-1.5 text-[0.82rem] text-mute">Summarises recent progress, open work, research and discussion for this project.</p>}
      {data?.brief && (
        <div className="mt-3 space-y-3 text-[0.88rem] leading-relaxed">
          <p className="text-white/90">{data.brief.where_you_left_off}</p>
          {data.brief.suggested_next_steps.length > 0 && <div><div className="label mb-1">Suggested next steps</div><ul className="space-y-1 text-white/85">{data.brief.suggested_next_steps.map((s: string) => <li key={s}>• {s}</li>)}</ul></div>}
          {data.brief.open_questions.length > 0 && <div><div className="label mb-1">Open questions</div><ul className="space-y-1 text-mute-bright">{data.brief.open_questions.map((s: string) => <li key={s}>• {s}</li>)}</ul></div>}
        </div>
      )}
      {data && !data.brief && (
        <div className="mt-3 grid gap-4 text-[0.84rem] sm:grid-cols-2">
          {data.error && <p className="col-span-full text-amber-200/80">{data.error}</p>}
          <div><div className="label mb-1">Recently completed</div>{data.facts.recentlyCompleted.length ? <ul className="space-y-0.5">{data.facts.recentlyCompleted.map((t: string) => <li key={t}>✓ {t}</li>)}</ul> : <p className="text-mute">Nothing yet.</p>}</div>
          <div><div className="label mb-1">Open tasks</div>{data.facts.openTasks.length ? <ul className="space-y-0.5">{data.facts.openTasks.map((t: string) => <li key={t}>○ {t}</li>)}</ul> : <p className="text-mute">None.</p>}</div>
        </div>
      )}
    </section>
  );
}

function LinkedList({ title, items, empty }: { title: string; items: { id: string; to: string; title: string; meta: string }[]; empty: string }) {
  return (
    <section>
      <h2 className="label mb-2">{title}</h2>
      {items.length === 0 ? <p className="text-[0.82rem] text-mute">{empty}</p> : (
        <ul className="space-y-1">{items.map((i) => <li key={i.id}><Link to={i.to} className="flex items-baseline gap-2 text-[0.86rem] text-white/85 hover:text-white"><span className="truncate">{i.title}</span><span className="shrink-0 text-[0.7rem] text-mute">{i.meta}</span></Link></li>)}</ul>
      )}
    </section>
  );
}

function ProjectSide({ p }: { p: any }) {
  return (
    <>
      <Section title="Relevant memories" count={p.related.memories.length}>
        {p.related.memories.length === 0 ? <p className="text-[0.8rem] text-mute">None found.</p> : <ul className="space-y-1.5">{p.related.memories.map((m: any) => <li key={m.id} className="text-[0.82rem] leading-snug text-white/85">{m.content} <span className="text-[0.7rem] text-mute">{label(m.category)}</span></li>)}</ul>}
      </Section>
      <Section title="Connected concepts" count={p.related.nodes.length}>
        {p.related.nodes.length === 0 ? <p className="text-[0.8rem] text-mute">None found.</p> : <ul className="space-y-1">{p.related.nodes.map((n: any) => <li key={n.id}><Link to={`/connections?node=${n.id}`} className="text-[0.82rem] text-white/85 hover:text-white">{n.title} <span className="text-[0.7rem] text-mute">{n.kind}</span></Link></li>)}</ul>}
      </Section>
    </>
  );
}
