import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, Pause, Play, Plus, Send, Trash2, X, Zap, Newspaper, Radar, Bot, Webhook } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp, useCan } from "@/state/app";
import { usePanel, toast, toastError } from "@/state/ui";
import { Badge, Button, Dialog, Empty, IconButton, Input, PageHeader, Pulse, Select, Tabs, Textarea, cx } from "@/components/ui";
import { Section } from "@/components/RightPanel";
import { timeAgo } from "@/lib/format";
import { locale, tx } from "@/i18n";

type Tab = "approvals" | "automations" | "connectors";

export function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "approvals";
  const { data: actions } = useResource<any[]>("/actions");
  const pending = actions?.filter((a) => a.status === "proposed").length ?? 0;
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => { setContent("Operations", <OpsSide />); return () => setContent("", null); }, [setContent]);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={tx("Operations")} subtitle={tx("Orbital working for the business on a schedule — briefings, monitoring and an operations agent, with you approving anything that leaves the system.")} />
      <Tabs className="mx-8" value={tab} onChange={(t) => setParams(t === "approvals" ? {} : { tab: t })}
        tabs={[{ value: "approvals", label: "Approvals", count: pending }, { value: "automations", label: "Automations" }, { value: "connectors", label: "Connectors" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-5">
        {tab === "approvals" && <Approvals actions={actions} />}
        {tab === "automations" && <Automations />}
        {tab === "connectors" && <Connectors />}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { create_task: "Create task", create_note: "Write note", start_research: "Start research", send_message: "Send message" };

function Approvals({ actions }: { actions?: any[] }) {
  const can = useCan();
  if (!actions) return <Pulse />;
  const pending = actions.filter((a) => a.status === "proposed");
  const history = actions.filter((a) => a.status !== "proposed");
  return (
    <>
      {pending.length === 0 ? (
        <Empty title={tx("Nothing waiting for approval")}>{tx("When an automation proposes something that leaves Orbital — like posting to your team channel — it waits here for an admin.")}</Empty>
      ) : (
        <ul className="space-y-3">{pending.map((a) => <PendingAction key={a.id} a={a} canApprove={can.admin} />)}</ul>
      )}
      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="label mb-2">{tx("History")}</h2>
          <ul className="divide-y divide-line">
            {history.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5 text-[0.85rem]">
                <Badge tone={a.status === "executed" ? "ok" : a.status === "failed" ? "warn" : "default"}>{a.status}</Badge>
                <span className="text-mute">{tx(KIND_LABEL[a.kind])}</span>
                <span className="min-w-0 flex-1 truncate text-white/85">{a.title}</span>
                {a.status === "failed" && <span className="truncate text-[0.75rem] text-red-200/80">{a.result?.error}</span>}
                {a.result?.taskId && a.result?.projectId && <Link className="text-[0.75rem] text-mute hover:text-white" to={`/projects/${a.result.projectId}`}>{tx("task →")}</Link>}
                {a.result?.documentId && <Link className="text-[0.75rem] text-mute hover:text-white" to={`/knowledge/${a.result.documentId}`}>{tx("note →")}</Link>}
                {a.result?.researchId && <Link className="text-[0.75rem] text-mute hover:text-white" to={`/research/${a.result.researchId}`}>{tx("research →")}</Link>}
                <span className="w-44 shrink-0 text-right text-[0.72rem] text-mute">{a.decided_by_email ? `${a.decided_by_email} · ` : a.automation_name ? tx("automatic · ") : ""}{timeAgo(a.decided_at ?? a.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function PendingAction({ a, canApprove }: { a: any; canApprove: boolean }) {
  const [text, setText] = useState(a.payload?.text ?? "");
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const r = approve ? await api.post(`/actions/${a.id}/approve`, a.kind === "send_message" ? { text } : {}) : await api.post(`/actions/${a.id}/reject`);
      if (approve && r.status === "failed") toastError(r.error); else toast(approve ? tx("Approved and carried out") : tx("Rejected"));
      invalidate("/actions");
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <li className="rounded-xl border border-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={a.risk === "external" ? "warn" : "default"}>{a.risk === "external" ? tx("leaves Orbital") : "internal"}</Badge>
        <span className="text-[0.78rem] text-mute">{tx(KIND_LABEL[a.kind])}{a.automation_name ? tx(" · proposed by {automation_name}", { automation_name: a.automation_name }) : ""} · {timeAgo(a.created_at)}</span>
      </div>
      <div className="mt-2 text-[0.95rem] text-white">{a.title}</div>
      {a.rationale && <p className="mt-1 text-[0.84rem] leading-relaxed text-mute-bright">{a.rationale}</p>}
      {a.kind === "send_message" && (
        <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} disabled={!canApprove} aria-label={tx("Message to send")} className="mt-3 text-[0.86rem]" />
      )}
      {a.kind === "start_research" && <p className="mt-2 text-[0.84rem] text-white/80">{tx("Question:")} {a.payload.question}</p>}
      {a.kind === "create_note" && <p className="mt-2 line-clamp-3 text-[0.84rem] text-white/80">{a.payload.body}</p>}
      <div className="mt-3 flex gap-2">
        {canApprove ? (
          <>
            <Button size="sm" variant="primary" loading={busy} icon={a.kind === "send_message" ? <Send size={13} /> : <Check size={13} />} onClick={() => decide(true)}>{a.kind === "send_message" ? tx("Approve & send") : tx("Approve")}</Button>
            <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy} onClick={() => decide(false)}>{tx("Reject")}</Button>
          </>
        ) : <span className="text-[0.78rem] text-mute">{tx("An admin needs to approve this.")}</span>}
      </div>
    </li>
  );
}

const KINDS = [
  { id: "briefing", label: "Briefing", icon: Newspaper, desc: "A daily or weekly brief: what changed, what's due, open questions, pending approvals." },
  { id: "monitor", label: "Monitor", icon: Radar, desc: "Recurring cited research on a market, competitor or topic." },
  { id: "operator", label: "Operations agent", icon: Bot, desc: "Reviews the workspace against a standing objective and proposes tasks, notes, research and team messages." },
] as const;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const describeSchedule = (s: any) => s.freq === "hourly" ? `Hourly at :${String(s.minute).padStart(2, "0")}` :
  `${s.freq === "weekly" ? `${DAYS[s.weekday]}s` : "Daily"} at ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} ${s.tz}`;

function Automations() {
  const { data } = useResource<any[]>("/automations");
  const { data: connectors } = useResource<any[]>("/connectors");
  const can = useCan();
  const [editing, setEditing] = useState<any | null>(null);
  const ai = useApp((s) => s.ai);
  const run = async (id: string) => { try { await api.post(`/automations/${id}/run`); toast(tx("Running now — results appear here and in Approvals")); setTimeout(() => invalidate("/automations"), 4000); } catch (e) { toastError(e); } };
  const toggle = async (a: any) => { try { await api.patch(`/automations/${a.id}`, { enabled: !a.enabled }); invalidate("/automations"); } catch (e) { toastError(e); } };
  const del = async (a: any) => { if (!confirm(tx("Delete \"{name}\"?", { name: a.name }))) return; await api.del(`/automations/${a.id}`).catch(toastError); invalidate("/automations"); };
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <p className="flex-1 text-[0.84rem] text-mute">{ai?.provider === "none" ? tx("No AI provider: briefings are compiled from your data without AI summaries; monitors gather sources; the operations agent needs AI.") : tx("Automations run on the server on schedule — the app doesn't need to be open.")}</p>
        {can.admin && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({})}>{tx("New automation")}</Button>}
      </div>
      {data?.length === 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {KINDS.map((k) => (
            <button key={k.id} disabled={!can.admin} onClick={() => setEditing({ kind: k.id })} className="rounded-xl border border-line p-5 text-left transition-colors hover:border-line-strong disabled:opacity-60">
              <k.icon size={18} strokeWidth={1.5} className="text-mute-bright" />
              <div className="mt-3 text-[0.92rem] text-white">{tx(k.label)}</div>
              <p className="mt-1 text-[0.8rem] leading-relaxed text-mute">{k.desc}</p>
            </button>
          ))}
        </div>
      )}
      <ul className="divide-y divide-line">
        {data?.map((a) => {
          const K = KINDS.find((k) => k.id === a.kind)!;
          const conn = connectors?.find((c) => c.id === a.config.connectorId);
          return (
            <li key={a.id} className="flex items-start gap-4 py-4">
              <K.icon size={16} strokeWidth={1.5} className={cx("mt-0.5 shrink-0", a.enabled ? "text-white" : "text-mute-soft")} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx("text-[0.92rem]", a.enabled ? "text-white" : "text-mute")}>{a.name}</span>
                  <Badge>{tx(K.label)}</Badge>
                  {!a.enabled && <Badge>{tx("paused")}</Badge>}
                  {a.last_status === "error" && <Badge tone="warn">{tx("last run failed")}</Badge>}
                </div>
                <div className="mt-1 text-[0.78rem] text-mute">
                  {describeSchedule(a.schedule)}{a.enabled && a.next_run_at ? tx(" · next {date}", { date: new Date(a.next_run_at).toLocaleString(locale()) }) : ""}{a.last_run_at ? tx(" · last ran {v0}", { v0: timeAgo(a.last_run_at) }) : ""}
                </div>
                <div className="mt-1 text-[0.78rem] text-mute-bright">
                  {a.kind === "monitor" && <>{tx("Question:")} {a.config.question}</>}
                  {a.kind === "operator" && <>{tx("Objective:")} {a.config.objective}{a.config.autoApproveInternal ? tx(" · internal actions run automatically") : tx(" · every action needs approval")}</>}
                  {a.kind === "briefing" && <>{a.config.period === "week" ? tx("Weekly") : tx("Daily")} {tx("brief")}</>}
                  {conn && <> · {a.config.autoDeliver ? tx("delivers to {name} automatically (standing authorization)", { name: conn.name }) : tx("delivers to {name} after approval", { name: conn.name })}</>}
                </div>
                {a.last_status === "error" && <p className="mt-1 text-[0.76rem] text-red-200/80">{a.last_error}</p>}
              </div>
              {can.admin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button size="sm" variant="ghost" icon={<Zap size={13} />} onClick={() => run(a.id)}>{tx("Run now")}</Button>
                  <IconButton label={a.enabled ? tx("Pause") : tx("Resume")} onClick={() => toggle(a)}>{a.enabled ? <Pause size={14} /> : <Play size={14} />}</IconButton>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>{tx("Edit")}</Button>
                  <IconButton label={tx("Delete")} onClick={() => del(a)}><Trash2 size={14} /></IconButton>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <AutomationDialog initial={editing} connectors={connectors ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function AutomationDialog({ initial, connectors, onClose }: { initial: any; connectors: any[]; onClose: () => void }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [f, setF] = useState({
    name: initial.name ?? "", kind: initial.kind ?? "briefing",
    schedule: initial.schedule ?? { freq: "daily", hour: 8, minute: 0, weekday: 1, tz },
    config: { period: "day", question: "", objective: "", connectorId: "", autoDeliver: false, autoApproveInternal: false, ...(initial.config ?? {}) },
  });
  const [busy, setBusy] = useState(false);
  const set = (p: any) => setF((x) => ({ ...x, ...p }));
  const setS = (p: any) => setF((x) => ({ ...x, schedule: { ...x.schedule, ...p } }));
  const setC = (p: any) => setF((x) => ({ ...x, config: { ...x.config, ...p } }));
  const save = async () => {
    setBusy(true);
    const body = { ...f, name: f.name || KINDS.find((k) => k.id === f.kind)!.label, config: { ...f.config, connectorId: f.config.connectorId || null } };
    try {
      if (initial.id) await api.patch(`/automations/${initial.id}`, body); else await api.post("/automations", body);
      invalidate("/automations"); onClose();
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={initial.id ? tx("Edit automation") : tx("New automation")} width="max-w-xl">
      <div className="space-y-4">
        {!initial.id && (
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={tx("Kind")}>
            {KINDS.map((k) => (
              <button key={k.id} role="radio" aria-checked={f.kind === k.id} onClick={() => set({ kind: k.id })} className={cx("rounded-lg border px-3 py-2.5 text-left text-[0.82rem] transition-colors", f.kind === k.id ? "border-white/60 text-white" : "border-line text-mute hover:text-white")}>
                <k.icon size={14} className="mb-1" />{tx(k.label)}
              </button>
            ))}
          </div>
        )}
        <p className="text-[0.8rem] text-mute">{KINDS.find((k) => k.id === f.kind)!.desc}</p>
        <Input placeholder={tx("Name")} value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label={tx("Name")} />
        {f.kind === "monitor" && <Textarea rows={2} placeholder={tx("What should Orbital keep researching? e.g. What are competitors in salon booking software launching and charging?")} value={f.config.question} onChange={(e) => setC({ question: e.target.value })} aria-label={tx("Research question")} />}
        {f.kind === "operator" && <Textarea rows={2} placeholder={tx("Standing objective, e.g. Keep the sales pipeline moving and make sure no customer request goes unanswered.")} value={f.config.objective} onChange={(e) => setC({ objective: e.target.value })} aria-label={tx("Objective")} />}
        {f.kind === "briefing" && <Select label={tx("Period")} value={f.config.period} onChange={(v) => setC({ period: v })} options={[{ value: "day", label: "Covers the last 24 hours" }, { value: "week", label: "Covers the last 7 days" }]} />}
        <div className="grid grid-cols-3 gap-2">
          <Select label={tx("Frequency")} value={f.schedule.freq} onChange={(v) => setS({ freq: v })} options={[{ value: "hourly", label: "Hourly" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} />
          {f.schedule.freq === "weekly" && <Select label={tx("Day")} value={String(f.schedule.weekday)} onChange={(v) => setS({ weekday: +v })} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} />}
          {f.schedule.freq !== "hourly" && (
            <Input type="time" aria-label={tx("Time")} value={`${String(f.schedule.hour).padStart(2, "0")}:${String(f.schedule.minute).padStart(2, "0")}`}
              onChange={(e) => { const [h, m] = e.target.value.split(":").map(Number); setS({ hour: h || 0, minute: m || 0 }); }} />
          )}
          {f.schedule.freq === "hourly" && <Input type="number" min={0} max={59} aria-label={tx("Minute past the hour")} value={f.schedule.minute} onChange={(e) => setS({ minute: Math.max(0, Math.min(59, +e.target.value)) })} />}
        </div>
        <p className="text-[0.74rem] text-mute-soft">{tx("Time zone:")} {f.schedule.tz}</p>
        <div className="rounded-lg border border-line p-3">
          <Select label={tx("Deliver to")} value={f.config.connectorId} onChange={(v) => setC({ connectorId: v })}
            options={[{ value: "", label: connectors.length ? "Don't send anywhere — keep it in Orbital" : "No connectors yet — add one in Connectors" }, ...connectors.map((c) => ({ value: c.id, label: `${c.name} (${c.config_hint})` }))]} />
          {f.config.connectorId && f.kind !== "operator" && (
            <label className="mt-3 flex items-start gap-2 text-[0.82rem] text-mute-bright">
              <input type="checkbox" className="mt-0.5 accent-white" checked={f.config.autoDeliver} onChange={(e) => setC({ autoDeliver: e.target.checked })} />
              <span>{tx("Send automatically without approval.")} <span className="text-mute">{tx("This grants standing authorization under your name; it's recorded in the audit log.")}</span></span>
            </label>
          )}
          {f.config.connectorId && f.kind === "operator" && <p className="mt-2 text-[0.78rem] text-mute">{tx("Messages proposed by the operations agent always wait for approval.")}</p>}
        </div>
        {f.kind === "operator" && (
          <label className="flex items-start gap-2 text-[0.82rem] text-mute-bright">
            <input type="checkbox" className="mt-0.5 accent-white" checked={f.config.autoApproveInternal} onChange={(e) => setC({ autoApproveInternal: e.target.checked })} />
            <span>{tx("Carry out internal actions automatically (create tasks, write notes, start research).")} <span className="text-mute">{tx("Nothing leaves Orbital without approval.")}</span></span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1"><Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button><Button variant="primary" loading={busy} onClick={save}>{initial.id ? tx("Save") : tx("Create automation")}</Button></div>
      </div>
    </Dialog>
  );
}

function Connectors() {
  const { data } = useResource<any[]>("/connectors");
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", url: "", secret: "" });
  const add = async () => {
    try { await api.post("/connectors", { name: f.name, url: f.url, secret: f.secret || undefined }); invalidate("/connectors"); setOpen(false); setF({ name: "", url: "", secret: "" }); } catch (e) { toastError(e); }
  };
  const test = async (id: string) => { try { await api.post(`/connectors/${id}/test`); toast(tx("Test message delivered")); invalidate("/connectors"); } catch (e) { toastError(e); } };
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <p className="flex-1 text-[0.84rem] leading-relaxed text-mute">{tx("Connectors are outbound webhooks: Slack or Teams incoming webhooks, Zapier, Make or n8n catch hooks, or your own endpoint. Payloads include")} <code className="font-mono text-[0.8rem]">{tx("text")}</code>, <code className="font-mono text-[0.8rem]">{tx("title")}</code> {tx("and")} <code className="font-mono text-[0.8rem]">{tx("body")}</code>. {tx("Payloads are signed with HMAC-SHA256 when you set a secret. URLs and secrets are encrypted at rest and visible to no one after saving.")}</p>
        {can.admin && <Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpen(true)}>{tx("Add connector")}</Button>}
      </div>
      {data?.length === 0 && <Empty title={tx("No connectors")}>{tx("Add one to let briefings and the operations agent reach your team where it works.")}</Empty>}
      <ul className="divide-y divide-line">
        {data?.map((c) => (
          <li key={c.id} className="flex items-center gap-4 py-3.5">
            <Webhook size={15} className="text-mute" />
            <div className="min-w-0 flex-1">
              <div className="text-[0.9rem] text-white">{c.name} {!c.enabled && <Badge>{tx("disabled")}</Badge>}</div>
              <div className="text-[0.75rem] text-mute">{c.config_hint}{c.last_used_at ? tx(" · last used {v0}", { v0: timeAgo(c.last_used_at) }) : ""}</div>
            </div>
            {can.admin && (
              <>
                <Button size="sm" variant="ghost" onClick={() => test(c.id)}>{tx("Send test")}</Button>
                <Button size="sm" variant="ghost" onClick={async () => { await api.patch(`/connectors/${c.id}`, { enabled: !c.enabled }).catch(toastError); invalidate("/connectors"); }}>{c.enabled ? tx("Disable") : tx("Enable")}</Button>
                <IconButton label={tx("Delete")} onClick={async () => { if (!confirm(tx("Delete connector?"))) return; await api.del(`/connectors/${c.id}`).catch(toastError); invalidate("/connectors"); }}><Trash2 size={14} /></IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={open} onClose={() => setOpen(false)} title={tx("Add a webhook connector")}>
        <div className="space-y-3">
          <Input placeholder={tx("Name, e.g. #ops in Slack")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label={tx("Name")} />
          <Input placeholder={tx("https://hooks.slack.com/services/…")} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} aria-label={tx("Webhook URL")} />
          <Input placeholder={tx("Signing secret (optional)")} value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} aria-label={tx("Signing secret")} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>{tx("Cancel")}</Button><Button variant="primary" disabled={!f.name || !f.url} onClick={add}>{tx("Add")}</Button></div>
        </div>
      </Dialog>
    </>
  );
}

function OpsSide() {
  return (
    <>
      <Section title={tx("How Orbital runs operations")}>
        <ol className="list-decimal space-y-1.5 pl-4 text-[0.82rem] leading-relaxed text-mute-bright marker:text-mute">
          <li>{tx("Automations run on schedule on the server")}</li>
          <li>{tx("They read the workspace: projects, tasks, research, knowledge")}</li>
          <li>{tx("They write briefs, research and proposed actions")}</li>
          <li>{tx("Internal actions can run automatically if you allow it")}</li>
          <li>{tx("Anything leaving Orbital waits for an admin, unless an admin gave a specific automation standing authorization")}</li>
          <li>{tx("Every decision is in the audit log")}</li>
        </ol>
      </Section>
      <Section title={tx("Connect your other tools")}><Link to="/team?tab=api" className="text-[0.83rem] text-mute-bright hover:text-white">{tx("API tokens for your CRM and tools →")}</Link></Section>
    </>
  );
}

