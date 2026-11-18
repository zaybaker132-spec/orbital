import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Copy, KeyRound, Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { invalidate, useResource } from "@/lib/resource";
import { useApp, useCan } from "@/state/app";
import { usePanel, toast, toastError } from "@/state/ui";
import { Badge, Button, Dialog, Empty, IconButton, Input, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type Tab = "members" | "context" | "api" | "audit";

export function TeamPage() {
  const ws = useApp((s) => s.workspace);
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "members";
  const setContent = usePanel((s) => s.setContent);
  useEffect(() => () => setContent("", null), [setContent]);
  if (ws?.kind !== "business") {
    return <Empty title="Teams live in business workspaces">Create a business workspace from the workspace menu at the top of the sidebar to invite your team, share knowledge, and run automations.</Empty>;
  }
  const tabs: { value: Tab; label: string }[] = [{ value: "members", label: "Members" }, { value: "context", label: "Business context" }];
  if (can.admin) tabs.push({ value: "api", label: "API & integrations" }, { value: "audit", label: "Audit log" });
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={ws.name} subtitle={`Business workspace · you are ${ws.role}`} />
      <Tabs className="mx-8" value={tab} onChange={(t) => setParams(t === "members" ? {} : { tab: t })} tabs={tabs} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16 pt-5">
        {tab === "members" && <Members />}
        {tab === "context" && <Context />}
        {tab === "api" && can.admin && <ApiTokens />}
        {tab === "audit" && can.admin && <Audit />}
      </div>
    </div>
  );
}

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including ownership and deleting the workspace",
  admin: "Manage members, connectors, automations, API tokens; approve actions",
  member: "Create and edit shared knowledge, research and projects",
  viewer: "Read everything and ask Orbital questions; can't change shared knowledge",
};

function Members() {
  const { data: members } = useResource<any[]>("/workspace/members");
  const can = useCan();
  const me = useApp((s) => s.user);
  const { data: invites } = useResource<any[]>(can.admin ? "/workspace/invites" : null);
  const [inviting, setInviting] = useState(false);
  const { refreshWorkspaces } = useApp();
  const navigate = useNavigate();
  const setRole = async (id: string, role: string) => { try { await api.patch(`/workspace/members/${id}`, { role }); invalidate("/workspace/members"); } catch (e) { toastError(e); } };
  const remove = async (m: any) => {
    const self = m.id === me?.id;
    if (!confirm(self ? "Leave this workspace?" : `Remove ${m.email}?`)) return;
    try {
      await api.del(`/workspace/members/${m.id}`);
      if (self) { await refreshWorkspaces(); navigate("/"); } else invalidate("/workspace/members");
    } catch (e) { toastError(e); }
  };
  return (
    <>
      <div className="mb-4 flex items-center">
        <p className="flex-1 text-[0.84rem] text-mute">Knowledge, research, projects and automations are shared. Each person's conversations stay private to them.</p>
        {can.admin && <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setInviting(true)}>Invite</Button>}
      </div>
      <ul className="divide-y divide-line">
        {members?.map((m) => (
          <li key={m.id} className="flex items-center gap-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-[0.8rem] uppercase text-white">{(m.display_name || m.email)[0]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[0.9rem] text-white">{m.display_name || m.email}{m.id === me?.id && <span className="ml-2 text-[0.75rem] text-mute">you</span>}</div>
              <div className="text-[0.75rem] text-mute">{m.email} · joined {timeAgo(m.created_at)}</div>
            </div>
            {can.admin && m.id !== me?.id ? (
              <Select label="Role" value={m.role} onChange={(v) => setRole(m.id, v)} className="h-8 w-32 text-[0.8rem]" options={["owner", "admin", "member", "viewer"].map((r) => ({ value: r, label: r }))} />
            ) : <span title={ROLE_HELP[m.role]}><Badge>{m.role}</Badge></span>}
            {(can.admin || m.id === me?.id) && <IconButton label={m.id === me?.id ? "Leave workspace" : "Remove"} onClick={() => remove(m)}><Trash2 size={14} /></IconButton>}
          </li>
        ))}
      </ul>
      <dl className="mt-8 grid gap-2 text-[0.8rem] sm:grid-cols-2">
        {Object.entries(ROLE_HELP).map(([r, h]) => <div key={r}><dt className="inline text-white">{r}</dt> <dd className="inline text-mute">— {h}</dd></div>)}
      </dl>
      {can.admin && invites && invites.filter((i) => !i.accepted_at).length > 0 && (
        <section className="mt-8">
          <h2 className="label mb-2">Pending invites</h2>
          <ul className="divide-y divide-line">{invites.filter((i) => !i.accepted_at).map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2 text-[0.85rem]">
              <span className="flex-1">{i.email}</span><Badge>{i.role}</Badge>
              <span className="text-[0.72rem] text-mute">{new Date(i.expires_at) < new Date() ? "expired" : `expires ${new Date(i.expires_at).toLocaleDateString()}`}</span>
              <IconButton label="Revoke invite" onClick={async () => { await api.del(`/workspace/invites/${i.id}`).catch(toastError); invalidate("/workspace/invites"); }}><Trash2 size={13} /></IconButton>
            </li>
          ))}</ul>
        </section>
      )}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
    </>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [link, setLink] = useState<string | null>(null);
  const create = async () => {
    try { const r = await api.post("/workspace/invites", { email, role }); setLink(r.link); invalidate("/workspace/invites"); } catch (e) { toastError(e); }
  };
  const close = () => { setLink(null); setEmail(""); onClose(); };
  return (
    <Dialog open={open} onClose={close} title="Invite to workspace">
      {link ? (
        <div className="space-y-3">
          <p className="text-[0.84rem] text-mute-bright">Send this link to <span className="text-white">{email}</span>. It works once, for that email address, for 7 days. Orbital doesn't send email — share it however you like.</p>
          <div className="flex gap-2"><Input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} /><Button icon={<Copy size={13} />} onClick={() => { navigator.clipboard.writeText(link); toast("Link copied"); }}>Copy</Button></div>
          <div className="flex justify-end"><Button variant="primary" onClick={close}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <Input type="email" placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
          <Select label="Role" value={role} onChange={setRole} options={["admin", "member", "viewer"].map((r) => ({ value: r, label: `${r} — ${ROLE_HELP[r]}` }))} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={!email.includes("@")} onClick={create}>Create invite link</Button></div>
        </div>
      )}
    </Dialog>
  );
}

function Context() {
  const { data } = useResource<any>("/workspace");
  const can = useCan();
  const [text, setText] = useState<string | null>(null);
  const value = text ?? data?.settings?.context ?? "";
  return (
    <div className="max-w-[720px]">
      <p className="text-[0.84rem] leading-relaxed text-mute">Tell Orbital what this business is: what you sell, to whom, how you work, priorities and tone. It's included as reference whenever anyone here asks a question and when automations run, so answers fit the business without everyone repeating it.</p>
      <Textarea rows={12} value={value} onChange={(e) => setText(e.target.value)} disabled={!can.admin} className="mt-4 text-[0.88rem]" aria-label="Business context"
        placeholder={"We run Acme Salons, 4 locations in Austin.\nCustomers: walk-in and booked clients, mostly 25–45.\nPriorities this quarter: online booking adoption, reduce no-shows.\nTone: friendly, concise."} />
      {can.admin ? <Button className="mt-3" variant="primary" disabled={text === null} onClick={async () => { try { await api.patch("/workspace", { settings: { context: value } }); setText(null); invalidate("/workspace"); toast("Saved"); } catch (e) { toastError(e); } }}>Save</Button>
        : <p className="mt-2 text-[0.78rem] text-mute">Only admins can edit this.</p>}
    </div>
  );
}

function ApiTokens() {
  const { data } = useResource<any[]>("/workspace/tokens");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["ingest", "query"]);
  const [shown, setShown] = useState<string | null>(null);
  const create = async () => {
    try { const r = await api.post("/workspace/tokens", { name, scopes }); setShown(r.token); setName(""); invalidate("/workspace/tokens"); } catch (e) { toastError(e); }
  };
  const origin = location.origin;
  return (
    <div className="max-w-[820px]">
      <p className="text-[0.84rem] leading-relaxed text-mute">Connect your CRM, help desk, forms or Zapier/Make/n8n. <b className="font-normal text-white/80">ingest</b> lets a system add documents and propose memories (which wait for review). <b className="font-normal text-white/80">query</b> lets it search and ask questions grounded in this workspace's knowledge.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input className="w-64" placeholder="Token name, e.g. HubSpot sync" value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" />
        {["ingest", "query"].map((s) => (
          <label key={s} className="flex items-center gap-1.5 text-[0.84rem] text-mute-bright"><input type="checkbox" className="accent-white" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => e.target.checked ? [...x, s] : x.filter((y) => y !== s))} />{s}</label>
        ))}
        <Button variant="primary" icon={<KeyRound size={13} />} disabled={!name.trim() || !scopes.length} onClick={create}>Create token</Button>
      </div>
      <ul className="mt-6 divide-y divide-line">
        {data?.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2.5 text-[0.86rem]">
            <span className="font-mono text-[0.78rem] text-mute">{t.prefix}…</span>
            <span className="flex-1 text-white/90">{t.name}</span>
            {t.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}
            <span className="w-36 text-right text-[0.72rem] text-mute">{t.revoked_at ? "revoked" : t.last_used_at ? `used ${timeAgo(t.last_used_at)}` : "never used"}</span>
            {!t.revoked_at && <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("Revoke this token? Systems using it stop working immediately.")) return; await api.del(`/workspace/tokens/${t.id}`).catch(toastError); invalidate("/workspace/tokens"); }}>Revoke</Button>}
          </li>
        ))}
      </ul>
      <section className="mt-8">
        <h2 className="label mb-2">Quick reference</h2>
        <pre className="overflow-x-auto rounded-lg border border-line bg-black p-4 font-mono text-[0.76rem] leading-relaxed text-white/80">{`# Add a document (scope: ingest)
curl -X POST ${origin}/api/v1/documents \\
  -H "Authorization: Bearer $ORBITAL_TOKEN" -H "Content-Type: application/json" \\
  -d '{"title":"Call notes: Bella Salon","body":"Wants SMS reminders…","tags":["crm"]}'

# Propose a memory (scope: ingest; waits for review)
curl -X POST ${origin}/api/v1/memories -H "Authorization: Bearer $ORBITAL_TOKEN" \\
  -H "Content-Type: application/json" -d '{"content":"Bella Salon renews in March","category":"context"}'

# Search, or ask a grounded question (scope: query)
curl "${origin}/api/v1/search?q=reminders" -H "Authorization: Bearer $ORBITAL_TOKEN"
curl -X POST ${origin}/api/v1/ask -H "Authorization: Bearer $ORBITAL_TOKEN" \\
  -H "Content-Type: application/json" -d '{"question":"What do our customers ask for most?"}'`}</pre>
      </section>
      <Dialog open={!!shown} onClose={() => setShown(null)} title="Copy your token now">
        <p className="text-[0.84rem] text-mute-bright">This is the only time it's shown. Store it in your other system's secret settings.</p>
        <div className="mt-3 flex gap-2"><Input readOnly value={shown ?? ""} onFocus={(e) => e.target.select()} aria-label="Token" className="font-mono text-[0.8rem]" /><Button icon={<Copy size={13} />} onClick={() => { navigator.clipboard.writeText(shown!); toast("Copied"); }}>Copy</Button></div>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => setShown(null)}>Done</Button></div>
      </Dialog>
    </div>
  );
}

function Audit() {
  const { data } = useResource<any[]>("/audit");
  return (
    <ul className="divide-y divide-line">
      {data?.length === 0 && <li className="py-3 text-[0.84rem] text-mute">No events yet.</li>}
      {data?.map((e) => (
        <li key={e.id} className="grid grid-cols-[150px_200px_1fr] gap-4 py-2 text-[0.82rem]">
          <span className="text-mute">{new Date(e.created_at).toLocaleString()}</span>
          <span className="truncate text-mute-bright">{e.actor || "system"}</span>
          <span className="min-w-0"><span className="font-mono text-[0.76rem] text-white">{e.action}</span> <span className="text-mute">{Object.entries(e.detail ?? {}).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 200)}</span></span>
        </li>
      ))}
    </ul>
  );
}
