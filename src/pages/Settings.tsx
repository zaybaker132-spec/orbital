import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Monitor, FolderOpen, KeyRound, LogOut, BellRing, Volume2 } from "lucide-react";
import { useApp } from "@/state/app";
import { useResource, invalidate } from "@/lib/resource";
import { api, getWorkspaceId } from "@/lib/api";
import { availableVoices, canSpeak, speak } from "@/lib/voice";
import { ClipBookmarklet } from "./Clip";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Dialog, Input, PageHeader, Select, cx } from "@/components/ui";
import { modKey } from "@/lib/format";
import { MODES } from "./Chat";
import { LANGUAGES, language, locale, resolveLanguage, setLanguage, tn, tx } from "@/i18n";

const SECTIONS = [
  ["account", "Account"], ["workspace", "Workspace"], ["ai", "AI & research"], ["voice", "Voice"], ["reminders", "Reminders & focus"],
  ["appearance", "Appearance"], ["language", "Language"], ["meetings", "Meetings"], ["tools", "Desktop & web clipper"], ["keyboard", "Keyboard"], ["data", "Your data"], ["about", "About"],
] as const;

export function SettingsPage() {
  const { ai, prefs, setPrefs, serverAdmin } = useApp();
  const [deleting, setDeleting] = useState(false);
  const save = (p: any) => setPrefs(p).then(() => toast(tx("Saved"))).catch(toastError);
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={tx("Settings")} />
      <div className="flex gap-10 px-8 pb-20">
        <nav aria-label={tx("Settings sections")} className="sticky top-4 hidden h-fit w-44 shrink-0 lg:block">
          <ul className="space-y-px">
            {[...SECTIONS, ...(serverAdmin ? [["waitlist", "Waitlist"] as const] : [])].map(([id, label]) => (
              <li key={id}><a href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                className="block rounded-lg px-3 py-1.5 text-[0.84rem] text-mute transition-colors hover:bg-white/[0.04] hover:text-white">{tx(label)}</a></li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-[760px] flex-1 space-y-12">
          <AccountGroup />
          <WorkspaceGroup />

          <Group id="ai" title={tx("AI & research")} description={tx("Orbital's AI runs on your server. API keys live in server environment variables (or the desktop app's keychain) and are never sent to the browser.")}>
            <Row label={tx("Provider")}>{ai?.provider === "none" ? <Badge tone="warn">{tx("Not configured")}</Badge> : <span>{ai?.provider} · <span className="font-mono text-[0.82rem]">{ai?.model}</span></span>}</Row>
            <Row label={tx("Web search")}>{ai?.webSearch ? <Badge tone="ok">{tx("enabled")}</Badge> : <span className="text-mute">{tx("Not available: research uses Wikipedia and OpenAlex")}</span>}</Row>
            <Row label={tx("Embeddings")}>{ai?.embeddings}</Row>
            {ai?.provider === "none" && !window.orbitalDesktop && (
              <div className="rounded-lg border border-line bg-white/[0.02] p-4 text-[0.84rem] leading-relaxed text-mute-bright">
                {tx("To turn on AI, set this on the server and restart:")}
                <pre className="mt-2 rounded-md bg-black px-3 py-2 font-mono text-[0.8rem] text-white">{tx("ANTHROPIC_API_KEY=…")}</pre>
                {tx("Or point Orbital at any OpenAI-compatible endpoint with")} <code className="font-mono">{tx("AI_PROVIDER=openai")}</code>, <code className="font-mono">{tx("OPENAI_BASE_URL")}</code> {tx("and")} <code className="font-mono">{tx("OPENAI_MODEL")}</code>. {tx("See README.")}
              </div>
            )}
            <Row label={tx("Learn from conversations")}>
              <Select label={tx("Automatic memory extraction")} value={prefs.autoExtractMemories === false ? "off" : "on"} onChange={(v) => save({ autoExtractMemories: v === "on" })} className="w-56"
                options={[{ value: "on", label: "On: propose memories" }, { value: "off", label: "Off: only when I ask" }]} />
            </Row>
            <Row label={tx("Default chat mode")}>
              <Select label={tx("Default mode")} value={prefs.defaultMode ?? "standard"} onChange={(v) => save({ defaultMode: v })} className="w-56" options={MODES.map((m) => ({ value: m.id, label: m.label }))} />
            </Row>
            <AiFeatures />
          </Group>

          <VoiceGroup save={save} />

          <Group id="reminders" title={tx("Reminders & focus")}>
            <NotificationsRow />
            <Row label={tx("Suggestions")}>
              <Select label={tx("Orbital noticed")} value={prefs.nudges === false ? "off" : "on"} onChange={(v) => save({ nudges: v === "on" })} className="w-72"
                options={[{ value: "on", label: "Show what Orbital notices slipping" }, { value: "off", label: "Only reminders I set" }]} />
              <p className="mt-1.5 text-[0.76rem] text-mute">{tx("Overdue tasks, approaching deadlines, stalled projects, unfinished ideas and out-of-date reports, on the Reminders page.")}</p>
            </Row>
            <Row label={tx("Focus session length")}>
              <Select label={tx("Default focus length")} value={String(prefs.focusMinutes ?? 50)} onChange={(v) => save({ focusMinutes: Number(v) })} className="w-56"
                options={[{ value: "25", label: "25 minutes" }, { value: "50", label: "50 minutes" }, { value: "90", label: "90 minutes" }]} />
            </Row>
            <Row label={tx("Knowledge health")}><Link to="/maintenance" className="text-white/85 underline decoration-white/20 hover:text-white">{tx("Review cleanup suggestions →")}</Link><p className="mt-1 text-[0.76rem] text-mute">{tx("Orbital checks daily for duplicates, conflicts, outdated and disconnected knowledge. Nothing changes until you choose.")}</p></Row>
          </Group>

          <Group id="appearance" title={tx("Appearance")} description={tx("Orbital is designed in black, with colour reserved for the Neural Core.")}>
            <Row label={tx("Reduced motion")}>
              <Select label={tx("Reduced motion")} value={prefs.reducedMotion ?? "system"} onChange={(v) => save({ reducedMotion: v })} className="w-56"
                options={[{ value: "system", label: "Follow system" }, { value: "on", label: "Reduce motion" }, { value: "off", label: "Full motion" }]} />
            </Row>
            <Row label={tx("Particle density")}>
              <Select label={tx("Particle density")} value={prefs.particleDensity ?? "auto"} onChange={(v) => save({ particleDensity: v })} className="w-72"
                options={[{ value: "auto", label: "Automatic (adapts to frame rate)" }, { value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} />
            </Row>
            <Row label={tx("Intro animation")}><Button size="sm" variant="ghost" onClick={() => { try { sessionStorage.removeItem("orbital.intro"); } catch { /* ignore */ } toast(tx("The formation will play next time the Neural Core opens")); }}>{tx("Replay it next time")}</Button></Row>
          </Group>

          <Group id="language" title={tx("Language")} description={tx("The whole interface, Orbital's answers, research reports, voice and dates use this language.")}>
            <Row label={tx("Language")}>
              <Select label={tx("Language")} value={prefs.language ?? "auto"} className="w-72"
                onChange={async (v) => { try { await setPrefs({ language: v as any }); setLanguage(v); location.reload(); } catch (e) { toastError(e); } }}
                options={[{ value: "auto", label: tx("Match this device ({name})", { name: LANGUAGES.find((l) => l.code === resolveLanguage("auto"))!.native }) }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.code === language() ? l.native : `${l.native} · ${tx(l.name)}` }))]} />
            </Row>
            <p className="text-[0.76rem] text-mute">{tx("Things you write and documents you import stay in their own language. Changing this reloads Orbital.")}</p>
          </Group>

          <MeetingsGroup />

          <section id="tools" className="scroll-mt-6 space-y-12">
            <DesktopGroup />
            <Group title={tx("Web clipper")} description={tx("Save any web page, or the part you select, into Knowledge.")}>
              <Row label={tx("Bookmarklet")}><ClipBookmarklet /><p className="mt-1.5 text-[0.76rem] text-mute">{tx("Drag it to your browser's bookmarks bar, then click it on any page. You can also use Knowledge → Clip a page.")}</p></Row>
            </Group>
          </section>

          <Group id="keyboard" title={tx("Keyboard")}>
            <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[0.86rem]">
              {[
                ["Command palette: search, navigate, act", `${modKey} K`], ["New conversation", "⌥ N"], ["Toggle sidebar", `${modKey} \\`], ["Toggle context panel", `${modKey} .`],
                ["Focus message box", "/"], ["Send · new line", "Enter · Shift Enter"],
                ["Go to Neural Core · Research · Knowledge · Connections", "g n · g r · g k · g g"],
                ["Go to Projects · Reminders · Focus · Opportunities", "g p · g t · g f · g o"],
                ["Go to Meetings · Operations · Chat · Settings", "g m · g w · g c · g s"],
                ["In a meeting: mute · camera", `${modKey} D · ${modKey} E`],
                ["Focus mode: pause or resume", "Space"],
                ["Voice: interrupt Orbital · end", "Space · Esc"],
              ].map(([a, b]) => (<Fragment key={a}><dt className="text-mute-bright">{a}</dt><dd><span className="kbd">{b}</span></dd></Fragment>))}
            </dl>
          </Group>

          <Group id="data" title={tx("Your data")} description={tx("Everything in Orbital belongs to you. Export it at any time, or delete it permanently.")}>
            <p className="text-[0.82rem] leading-relaxed text-mute">{tx("The export is a JSON file of this workspace: conversations, memories, notes and files' text, research with sources, hypotheses, extracted knowledge, projects, opportunities, the knowledge graph, and your own reminders, focus sessions and preferences.")}</p>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/export${getWorkspaceId() ? `?workspace=${getWorkspaceId()}` : ""}`} download><Button icon={<Download size={14} />}>{tx("Export this workspace (JSON)")}</Button></a>
              <Button variant="danger" onClick={() => setDeleting(true)}>{tx("Delete account")}</Button>
            </div>
          </Group>

          <AboutGroup />

          <WaitlistGroup />
        </div>
      </div>
      <DeleteAccount open={deleting} onClose={() => setDeleting(false)} />
    </div>
  );
}

function AccountGroup() {
  const user = useApp((s) => s.user);
  const setUser = useApp((s) => s.setUser);
  const [name, setName] = useState(user?.displayName ?? "");
  const [pw, setPw] = useState(false);
  const { data: sessions } = useResource<any[]>("/auth/sessions");
  const others = sessions?.filter((s) => !s.current).length ?? 0;
  const saveName = async () => {
    if (name.trim() === (user?.displayName ?? "")) return;
    try { await api.patch("/auth/me", { displayName: name.trim() }); setUser({ displayName: name.trim() }); toast(tx("Name saved")); } catch (e) { toastError(e); }
  };
  return (
    <Group id="account" title={tx("Account")}>
      <Row label={tx("Email")}>{user?.email}</Row>
      <Row label={tx("Name")}>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} placeholder={tx("How Orbital greets you")} aria-label={tx("Name")} className="max-w-xs" maxLength={80} />
        </form>
      </Row>
      <Row label={tx("Password")}><Button size="sm" icon={<KeyRound size={13} />} onClick={() => setPw(true)}>{tx("Change password")}</Button></Row>
      <Row label={tx("Signed in")}>
        {!sessions ? <span className="text-mute">…</span> : (
          <div className="space-y-1.5">
            <ul className="space-y-0.5 text-[0.84rem]">{sessions.map((s, i) => (
              <li key={i} className="flex items-center gap-2"><span className={s.current ? "text-white" : "text-mute-bright"}>{s.device}</span>{s.current && <Badge tone="ok">{tx("this device")}</Badge>}<span className="text-[0.72rem] text-mute">{tx("since")} {new Date(s.created_at).toLocaleDateString(locale())}</span></li>
            ))}</ul>
            <div className="flex gap-2 pt-1">
              {others > 0 && <Button size="sm" variant="ghost" onClick={async () => { try { const r = await api.post("/auth/sessions/revoke-others"); invalidate("/auth/sessions"); toast(tn(r.signedOut, "Signed out {n} other device", "Signed out {n} other devices")); } catch (e) { toastError(e); } }}>{tx("Sign out other devices")}</Button>}
              <Button size="sm" variant="ghost" icon={<LogOut size={13} />} onClick={async () => { await api.post("/auth/logout").catch(() => {}); location.href = "/login"; }}>{tx("Sign out")}</Button>
            </div>
          </div>
        )}
      </Row>
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </Group>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const mismatch = f.again.length > 0 && f.next !== f.again;
  const submit = async () => {
    setBusy(true);
    try { await api.post("/auth/password", { current: f.current, next: f.next }); toast(tx("Password changed: other devices were signed out")); setF({ current: "", next: "", again: "" }); invalidate("/auth/sessions"); onClose(); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title={tx("Change password")}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input type="password" autoComplete="current-password" placeholder={tx("Current password")} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} aria-label={tx("Current password")} />
        <Input type="password" autoComplete="new-password" placeholder={tx("New password (at least 10 characters)")} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} aria-label={tx("New password")} />
        <Input type="password" autoComplete="new-password" placeholder={tx("New password again")} value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} aria-label={tx("Repeat new password")} />
        {mismatch && <p className="text-[0.8rem] text-red-300">{tx("The new passwords don't match.")}</p>}
        <p className="text-[0.76rem] text-mute">{tx("Every other device signed in to your account will be signed out.")}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={onClose}>{tx("Cancel")}</Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!f.current || f.next.length < 10 || f.next !== f.again}>{tx("Change password")}</Button></div>
      </form>
    </Dialog>
  );
}

function WorkspaceGroup() {
  const { workspace, workspaces } = useApp();
  if (!workspace) return null;
  const business = workspace.kind === "business";
  return (
    <Group id="workspace" title={tx("Workspace")} description={business ? tx("A shared workspace: knowledge, research and projects are shared with its members; each person's conversations, reminders and focus sessions stay private.") : tx("Your personal workspace is private to you.")}>
      <Row label={tx("Current")}>{workspace.name} <span className="ml-2 text-[0.76rem] text-mute">{business ? tx("Business · you are {role}", { role: workspace.role }) : tx("Personal")}</span></Row>
      <Row label={tx("Workspaces")}>{workspaces.length} {tx("· switch from the menu at the top of the sidebar")}</Row>
      {business && (
        <Row label={tx("Team & business")}>
          <Link to="/team" className="text-white/85 underline decoration-white/20 hover:text-white">{tx("Members, roles, invites, business context, API & integrations, audit log →")}</Link>
          <p className="mt-1"><Link to="/operations" className="text-[0.8rem] text-mute underline decoration-white/20 hover:text-white">{tx("Automations, approvals and connectors →")}</Link></p>
        </Row>
      )}
      {!business && <Row label={tx("For a team")}><span className="text-mute">{tx("Create a business workspace from the workspace menu to share knowledge with a team and run automations.")}</span></Row>}
    </Group>
  );
}

/** What needs an AI provider, at a glance. */
function AiFeatures() {
  const ai = useApp((s) => s.ai);
  const server = useApp((s) => s.server);
  const on = ai?.provider !== "none";
  const browserSpeech = !!((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) && !/Electron\//.test(navigator.userAgent);
  const rows: [string, boolean | string][] = [
    ["Answers, research synthesis, Learning mode", on],
    ["Memory extraction, opportunity discovery, operations agent", on],
    ["Contradiction lab, hypothesis verdicts, refreshing reports", on],
    ["Reading images and scanned PDFs", on],
    ["Knowledge extraction", on ? true : "basic (dates, figures, key terms)"],
    ["Source credibility", on ? true : "from address, dates and keywords"],
    ["Live web research", ai?.webSearch ?? false],
    ["Voice input", browserSpeech ? "this browser's speech recognition" : server?.transcription ? "server transcription" : false],
  ];
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="label mb-2">{tx("What's available")}</div>
      <ul className="grid gap-x-6 gap-y-1.5 text-[0.82rem] sm:grid-cols-2">
        {rows.map(([label, v]) => (
          <li key={label} className="flex items-start gap-2">
            <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", v === true ? "bg-emerald-300" : v ? "bg-amber-200" : "bg-white/20")} />
            <span className={v ? "text-white/85" : "text-mute"}>{label}{typeof v === "string" && <span className="text-mute">: {v}</span>}{v === false && <span className="text-mute">: {label === "Voice input" ? tx("needs Chrome, Edge or Safari, or server transcription") : label === "Live web research" ? tx("needs the Anthropic provider") : tx("needs an AI provider")}</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VoiceGroup({ save }: { save: (p: any) => void }) {
  const prefs = useApp((s) => s.prefs);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => availableVoices());
  useEffect(() => {
    if (!canSpeak()) return;
    const update = () => setVoices(availableVoices());
    window.speechSynthesis.addEventListener?.("voiceschanged", update);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", update);
  }, []);
  const [rate, setRate] = useState(prefs.voiceRate ?? 1.03);
  return (
    <Group id="voice" title={tx("Voice")} description={tx("Talk to Orbital from the chat box. Spoken answers use your computer's own voices.")}>
      <Row label={tx("Speak answers")}>
        <Select label={tx("Speak answers aloud")} value={prefs.speakAnswers === false ? "off" : "on"} onChange={(v) => save({ speakAnswers: v === "on" })} className="w-56"
          options={[{ value: "on", label: "Read answers aloud" }, { value: "off", label: "Show answers as text only" }]} />
      </Row>
      {canSpeak() ? (
        <>
          <Row label={tx("Voice")}>
            <Select label={tx("Voice")} value={prefs.voiceName ?? ""} onChange={(v) => save({ voiceName: v })} className="w-72"
              options={[{ value: "", label: "Automatic (best available)" }, ...voices.map((v) => ({ value: v.name, label: `${v.name}${v.localService ? "" : " · online"}` }))]} />
          </Row>
          <Row label={tx("Speed")}>
            <div className="flex items-center gap-3">
              <input type="range" min={0.7} max={1.5} step={0.05} value={rate} onChange={(e) => setRate(Number(e.target.value))} onMouseUp={() => save({ voiceRate: rate })} onKeyUp={() => save({ voiceRate: rate })} onTouchEnd={() => save({ voiceRate: rate })} aria-label={tx("Speaking speed")} className="w-48 accent-white" />
              <span className="w-10 font-mono text-[0.8rem] text-mute">{rate.toFixed(2)}×</span>
              <Button size="sm" variant="ghost" icon={<Volume2 size={13} />} onClick={() => speak("This is how Orbital will sound when it reads your answers.", { rate, voiceName: prefs.voiceName })}>{tx("Test")}</Button>
            </div>
          </Row>
        </>
      ) : <Row label={tx("Voice")}><span className="text-mute">{tx("This browser can't speak, so answers appear as text.")}</span></Row>}
    </Group>
  );
}

function NotificationsRow() {
  const [perm, setPerm] = useState(() => ("Notification" in window ? Notification.permission : "unsupported"));
  return (
    <Row label={tx("Notifications")}>
      {perm === "granted" ? <span className="flex items-center gap-2"><Badge tone="ok">{tx("on")}</Badge><span className="text-[0.8rem] text-mute">{tx("Reminders notify you when Orbital is in the background (held during focus sessions).")}</span></span>
        : perm === "denied" ? <span className="text-[0.84rem] text-mute">{tx("Blocked in your browser's site settings: reminders still appear inside Orbital.")}</span>
        : perm === "unsupported" ? <span className="text-[0.84rem] text-mute">{tx("Not supported here: reminders appear inside Orbital.")}</span>
        : <Button size="sm" icon={<BellRing size={13} />} onClick={() => Notification.requestPermission().then(setPerm)}>{tx("Turn on notifications")}</Button>}
    </Row>
  );
}

function MeetingsGroup() {
  const server = useApp((s) => s.server);
  const [perm, setPerm] = useState<{ camera?: string; microphone?: string }>({});
  useEffect(() => {
    const q = (name: string) => (navigator.permissions?.query({ name: name as PermissionName }).then((r) => r.state).catch(() => undefined) ?? Promise.resolve(undefined));
    Promise.all([q("camera"), q("microphone")]).then(([camera, microphone]) => setPerm({ camera, microphone }));
  }, []);
  const label = (s?: string) => (s === "granted" ? tx("allowed") : s === "denied" ? tx("blocked") : tx("asked when you join"));
  return (
    <Group id="meetings" title={tx("Meetings")} description={tx("Video rooms joined by code. Audio and video go directly between participants.")}>
      <Row label={tx("Camera & microphone")}><span className="text-[0.84rem]">{tx("Camera: {camera} · Microphone: {microphone}", { camera: label(perm.camera), microphone: label(perm.microphone) })}</span></Row>
      <Row label={tx("Room size")}>{tx("Up to {n} people", { n: server?.maxParticipants ?? 8 })}</Row>
      <Row label={tx("Strict networks")}>{server?.turn ? <Badge tone="ok">{tx("relay configured")}</Badge> : <span className="text-[0.84rem] text-mute">{tx("No relay server: people on some office or mobile networks may not connect. See docs/MEETINGS.md (TURN).")}</span>}</Row>
      <Row label={tx("Start or join")}><Link to="/meetings" className="text-white/85 underline decoration-white/20 hover:text-white">{tx("Meetings →")}</Link></Row>
    </Group>
  );
}

function AboutGroup() {
  const server = useApp((s) => s.server);
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);
  useEffect(() => { window.orbitalDesktop?.status().then((s) => setDesktopVersion(s.version)).catch(() => {}); }, []);
  return (
    <Group id="about" title={tx("About")}>
      <Row label={tx("Version")}>{tx("Orbital")} {desktopVersion ?? server?.version ?? ""}{desktopVersion ? tx(" (desktop)") : ""}</Row>
      <Row label={tx("Database")}>{server?.database === "postgres" ? tx("PostgreSQL") : tx("Built-in (stored on this server)")}</Row>
      <Row label={tx("Pages")}><span className="text-[0.84rem]"><Link to="/maintenance" className="underline decoration-white/20 hover:text-white">{tx("Knowledge health")}</Link> · <Link to="/search" className="underline decoration-white/20 hover:text-white">{tx("Search")}</Link> · <Link to="/hypotheses" className="underline decoration-white/20 hover:text-white">{tx("Hypotheses")}</Link> · <Link to="/reminders" className="underline decoration-white/20 hover:text-white">{tx("Reminders")}</Link></span></Row>
    </Group>
  );
}

function Group({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
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
    <Dialog open={open} onClose={onClose} title={tx("Delete account")}>
      <p className="text-[0.86rem] leading-relaxed text-mute-bright">{tx("This permanently deletes your account and everything in it — conversations, memories, notes, research, projects and opportunities. It cannot be undone.")}</p>
      <Input className="mt-4" placeholder={tx("Type \"DELETE\" to confirm")} value={text} onChange={(e) => setText(e.target.value)} aria-label={tx("Confirmation")} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{tx("Cancel")}</Button>
        <Button variant="danger" disabled={text !== "DELETE"} onClick={async () => { try { await api.post("/account/delete", { confirm: "DELETE" }); location.href = "/"; } catch (e) { toastError(e); } }}>{tx("Delete everything")}</Button>
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
      <Group title={tx("Desktop app")} description={tx("Orbital runs as a native app on macOS, Windows and Linux, with its own private database on your computer.")}>
        {downloadUrl ? <a href={downloadUrl} target="_blank" rel="noreferrer noopener"><Button icon={<Monitor size={14} />}>{tx("Download Orbital for desktop")}</Button></a>
          : <p className="text-[0.84rem] text-mute">{tx("Installers are built from this codebase (see docs/DESKTOP.md). Set")} <code className="font-mono">{tx("ORBITAL_DOWNLOAD_URL")}</code> {tx("on the server to show a download button here.")}</p>}
        <p className="text-[0.8rem] text-mute">{tx("You can also install this web app from your browser's address bar (Chrome, Edge) for a dock or taskbar icon.")}</p>
      </Group>
    );
  }
  const save = async (value: string | null) => {
    setBusy(true);
    try { await bridge.setApiKey(value); toast(value ? tx("Key saved — Orbital restarted with AI enabled") : tx("Key removed")); } catch (e) { toastError(e); setBusy(false); }
  };
  return (
    <Group title={tx("Desktop")} description={tx("Orbital {v0} · your data lives only on this computer.", { v0: status?.version ?? "" })}>
      <Row label={tx("Anthropic API key")}>
        {status?.hasApiKey ? (
          <div className="flex items-center gap-3"><Badge tone="ok">{tx("saved securely")}</Badge><Button size="sm" variant="ghost" disabled={busy} onClick={() => save(null)}>{tx("Remove")}</Button></div>
        ) : (
          <div className="flex gap-2">
            <Input type="password" placeholder={tx("sk-ant-…")} value={key} onChange={(e) => setKey(e.target.value)} aria-label={tx("Anthropic API key")} autoComplete="off" />
            <Button variant="primary" loading={busy} disabled={key.trim().length < 20 || status?.secureStorage === false} onClick={() => save(key)}>{tx("Save")}</Button>
          </div>
        )}
        <p className="mt-1.5 text-[0.76rem] text-mute">{status?.secureStorage === false ? tx("Secure storage isn't available on this system, so the key can't be saved.") : tx("Encrypted with your operating system's keychain and given only to the local Orbital server. Get a key at console.anthropic.com.")}</p>
      </Row>
      <Row label={tx("Data")}><Button size="sm" icon={<FolderOpen size={13} />} onClick={() => bridge.openDataFolder()}>{tx("Open data folder")}</Button></Row>
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
    <Group id="waitlist" title={tx("Waitlist")} description={tx("People who joined from the public waitlist page (/waitlist).")}>
      {!data ? <p className="text-[0.84rem] text-mute">{tx("Loading…")}</p> : (
        <>
          <Row label={tx("Signups")}>{data.total} {tx("total ·")} {data.last7} {tx("in the last 7 days")}</Row>
          <Row label={tx("Who")}>{tally(data.personas)}</Row>
          <Row label={tx("Main computer")}>{tally(data.computers)}</Row>
          <Row label={tx("Heard from")}>{tally(data.sources)}</Row>
          <a href="/api/admin/waitlist.csv"><Button icon={<Download size={14} />}>{tx("Export CSV")}</Button></a>
          {data.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[0.8rem]">
                <thead className="text-mute"><tr><th className="py-2 pr-4 font-normal">{tx("Email")}</th><th className="py-2 pr-4 font-normal">{tx("Is")}</th><th className="py-2 pr-4 font-normal">{tx("Wants Orbital for")}</th><th className="py-2 font-normal">{tx("Joined")}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.rows.slice(0, 50).map((r: any) => (
                    <tr key={r.email}><td className="py-2 pr-4 text-white">{r.email}</td><td className="py-2 pr-4 text-mute-bright">{r.persona}</td><td className="py-2 pr-4 text-mute-bright">{[...r.remember, r.remember_other].filter(Boolean).join("; ")}</td><td className="whitespace-nowrap py-2 text-mute">{new Date(r.created_at).toLocaleDateString(locale())}</td></tr>
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
