import { Fragment, useEffect, useState } from "react";
import { Download, Monitor, FolderOpen } from "lucide-react";
import { useApp } from "@/state/app";
import { useResource } from "@/lib/resource";
import { api } from "@/lib/api";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Dialog, Input, PageHeader, Select } from "@/components/ui";
import { modKey } from "@/lib/format";
import { MODES } from "./Chat";

export function SettingsPage() {
  const { user, ai, prefs, setPrefs } = useApp();
  const [deleting, setDeleting] = useState(false);
  const save = (p: any) => setPrefs(p).then(() => toast("Saved")).catch(toastError);
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="max-w-[760px] space-y-12 px-8 pb-20">
        <Group title="Account">
          <Row label="Email">{user?.email}</Row>
          <Row label="Name">{user?.displayName || <span className="text-mute">Not set</span>}</Row>
        </Group>

        <DesktopGroup />

        <WaitlistGroup />

        <Group title="AI" description="Orbital's AI runs on your server. API keys live in server environment variables and are never sent to the browser.">
          <Row label="Provider">{ai?.provider === "none" ? <Badge tone="warn">Not configured</Badge> : <span>{ai?.provider} · <span className="font-mono text-[0.82rem]">{ai?.model}</span></span>}</Row>
          <Row label="Web search">{ai?.webSearch ? <Badge tone="ok">enabled</Badge> : <span className="text-mute">Not available — research uses Wikipedia and OpenAlex</span>}</Row>
          <Row label="Embeddings">{ai?.embeddings}</Row>
          {ai?.provider === "none" && !(window as any).orbitalDesktop && (
            <div className="rounded-lg border border-line bg-white/[0.02] p-4 text-[0.84rem] leading-relaxed text-mute-bright">
              To enable answers, research synthesis, memory extraction and opportunity discovery, set this on the server and restart:
              <pre className="mt-2 rounded-md bg-black px-3 py-2 font-mono text-[0.8rem] text-white">ANTHROPIC_API_KEY=…</pre>
              Or point Orbital at any OpenAI-compatible endpoint with <code className="font-mono">AI_PROVIDER=openai</code>, <code className="font-mono">OPENAI_BASE_URL</code> and <code className="font-mono">OPENAI_MODEL</code>. See README.
            </div>
          )}
          <Row label="Learn from conversations">
            <Select label="Automatic memory extraction" value={prefs.autoExtractMemories === false ? "off" : "on"} onChange={(v) => save({ autoExtractMemories: v === "on" })} className="w-56"
              options={[{ value: "on", label: "On — propose memories" }, { value: "off", label: "Off — only when I ask" }]} />
          </Row>
          <Row label="Default mode">
            <Select label="Default mode" value={prefs.defaultMode ?? "standard"} onChange={(v) => save({ defaultMode: v })} className="w-56" options={MODES.map((m) => ({ value: m.id, label: m.label }))} />
          </Row>
        </Group>

        <Group title="Neural Core & motion">
          <Row label="Reduced motion">
            <Select label="Reduced motion" value={prefs.reducedMotion ?? "system"} onChange={(v) => save({ reducedMotion: v })} className="w-56"
              options={[{ value: "system", label: "Follow system" }, { value: "on", label: "Reduce motion" }, { value: "off", label: "Full motion" }]} />
          </Row>
          <Row label="Particle density">
            <Select label="Particle density" value={prefs.particleDensity ?? "auto"} onChange={(v) => save({ particleDensity: v })} className="w-56"
              options={[{ value: "auto", label: "Automatic (adapts to frame rate)" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
          </Row>
        </Group>

        <Group title="Keyboard">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[0.86rem]">
            {[
              ["Command palette", `${modKey} K`], ["New conversation", "⌥ N"], ["Toggle sidebar", `${modKey} \\`], ["Toggle context panel", `${modKey} .`],
              ["Focus message box", "/"], ["Send · new line", "Enter · Shift Enter"], ["Go to Neural Core / Research / Knowledge", "g n · g r · g k"],
              ["Go to Connections / Projects / Opportunities", "g g · g p · g o"], ["Go to Chat / Settings", "g c · g s"],
            ].map(([a, b]) => (<Fragment key={a}><dt className="text-mute-bright">{a}</dt><dd><span className="kbd">{b}</span></dd></Fragment>))}
          </dl>
        </Group>

        <Group title="Your data" description="Everything in Orbital belongs to you. Export it at any time, or delete it permanently.">
          <div className="flex gap-2">
            <a href="/api/export" download><Button icon={<Download size={14} />}>Export all data (JSON)</Button></a>
            <Button variant="danger" onClick={() => setDeleting(true)}>Delete account</Button>
          </div>
        </Group>
      </div>
      <DeleteAccount open={deleting} onClose={() => setDeleting(false)} />
    </div>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[0.95rem] text-white">{title}</h2>
      {description && <p className="mt-1 text-[0.8rem] text-mute">{description}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-6 border-b border-line pb-3 text-[0.88rem]"><span className="w-40 shrink-0 text-mute">{label}</span><div className="min-w-0 flex-1">{children}</div></div>
);

function DeleteAccount({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title="Delete account">
      <p className="text-[0.86rem] leading-relaxed text-mute-bright">This permanently deletes your account and everything in it — conversations, memories, notes, research, projects and opportunities. It cannot be undone.</p>
      <Input className="mt-4" placeholder='Type "DELETE" to confirm' value={text} onChange={(e) => setText(e.target.value)} aria-label="Confirmation" />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={text !== "DELETE"} onClick={async () => { try { await api.post("/account/delete", { confirm: "DELETE" }); location.href = "/"; } catch (e) { toastError(e); } }}>Delete everything</Button>
      </div>
    </Dialog>
  );
}

declare global {
  interface Window { orbitalDesktop?: { isDesktop: true; status(): Promise<{ version: string; platform: string; hasApiKey: boolean; secureStorage: boolean; dataDir: string }>; setApiKey(key: string | null): Promise<{ ok: boolean }>; openDataFolder(): Promise<void> } }
}

/** Desktop app: API key in the OS keychain-backed store. Web: link to download the desktop app. */
function DesktopGroup() {
  const bridge = window.orbitalDesktop;
  const downloadUrl = useApp((s) => s.downloadUrl);
  const [status, setStatus] = useState<Awaited<ReturnType<NonNullable<typeof bridge>["status"]>> | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { bridge?.status().then(setStatus).catch(() => {}); }, [bridge]);
  if (!bridge) {
    return (
      <Group title="Desktop app" description="Orbital runs as a native app on macOS, Windows and Linux, with its own private database on your computer.">
        {downloadUrl ? <a href={downloadUrl} target="_blank" rel="noreferrer noopener"><Button icon={<Monitor size={14} />}>Download Orbital for desktop</Button></a>
          : <p className="text-[0.84rem] text-mute">Installers are built from this codebase (see docs/DESKTOP.md). Set <code className="font-mono">ORBITAL_DOWNLOAD_URL</code> on the server to show a download button here.</p>}
        <p className="text-[0.8rem] text-mute">You can also install this web app from your browser's address bar (Chrome, Edge) for a dock or taskbar icon.</p>
      </Group>
    );
  }
  const save = async (value: string | null) => {
    setBusy(true);
    try { await bridge.setApiKey(value); toast(value ? "Key saved — Orbital restarted with AI enabled" : "Key removed"); } catch (e) { toastError(e); setBusy(false); }
  };
  return (
    <Group title="Desktop" description={`Orbital ${status?.version ?? ""} · your data lives only on this computer.`}>
      <Row label="Anthropic API key">
        {status?.hasApiKey ? (
          <div className="flex items-center gap-3"><Badge tone="ok">saved securely</Badge><Button size="sm" variant="ghost" disabled={busy} onClick={() => save(null)}>Remove</Button></div>
        ) : (
          <div className="flex gap-2">
            <Input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Anthropic API key" autoComplete="off" />
            <Button variant="primary" loading={busy} disabled={key.trim().length < 20 || status?.secureStorage === false} onClick={() => save(key)}>Save</Button>
          </div>
        )}
        <p className="mt-1.5 text-[0.76rem] text-mute">{status?.secureStorage === false ? "Secure storage isn't available on this system, so the key can't be saved." : "Encrypted with your operating system's keychain and given only to the local Orbital server. Get a key at console.anthropic.com."}</p>
      </Row>
      <Row label="Data"><Button size="sm" icon={<FolderOpen size={13} />} onClick={() => bridge.openDataFolder()}>Open data folder</Button></Row>
    </Group>
  );
}

/** Server admins (ORBITAL_ADMIN_EMAILS) see who has joined the public waitlist. */
function WaitlistGroup() {
  const serverAdmin = useApp((s) => s.serverAdmin);
  const { data } = useResource<any>(serverAdmin ? "/admin/waitlist" : null);
  if (!serverAdmin) return null;
  const tally = (rows: { k: string; n: number }[]) => rows.map((r) => `${r.k || "—"} ${r.n}`).join(" · ") || "—";
  return (
    <Group title="Waitlist" description="People who joined from the public waitlist page (/waitlist).">
      {!data ? <p className="text-[0.84rem] text-mute">Loading…</p> : (
        <>
          <Row label="Signups">{data.total} total · {data.last7} in the last 7 days</Row>
          <Row label="Who">{tally(data.personas)}</Row>
          <Row label="Main computer">{tally(data.computers)}</Row>
          <Row label="Heard from">{tally(data.sources)}</Row>
          <a href="/api/admin/waitlist.csv"><Button icon={<Download size={14} />}>Export CSV</Button></a>
          {data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[0.8rem]">
                <thead className="text-mute"><tr><th className="py-2 pr-4 font-normal">Email</th><th className="py-2 pr-4 font-normal">Is</th><th className="py-2 pr-4 font-normal">Wants Orbital for</th><th className="py-2 font-normal">Joined</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.rows.slice(0, 50).map((r: any) => (
                    <tr key={r.email}><td className="py-2 pr-4 text-white">{r.email}</td><td className="py-2 pr-4 text-mute-bright">{r.persona}</td><td className="py-2 pr-4 text-mute-bright">{[...r.remember, r.remember_other].filter(Boolean).join("; ")}</td><td className="whitespace-nowrap py-2 text-mute">{new Date(r.created_at).toLocaleDateString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Group>
  );
}
