import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Hand, Lock, LockOpen, MessageSquare, Mic, MicOff, MonitorUp, PhoneOff, ScreenShareOff, Send, Users, Video, VideoOff, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/state/app";
import { toast, toastError } from "@/state/ui";
import { useAudioLevel, useMeeting, type Participant, type PeerState } from "@/lib/meeting";
import { Button, Input, Pulse, cx } from "@/components/ui";
import { meetingLink, parseMeetingCode } from "./Meetings";

/** /m/:code — lobby (preview your camera and mic), then the room. */
export function MeetingRoomPage() {
  const params = useParams();
  const code = parseMeetingCode(params.code ?? "") ?? "";
  const navigate = useNavigate();
  const user = useApp((s) => s.user);
  const [meta, setMeta] = useState<any>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState(user?.displayName || user?.email.split("@")[0] || "");
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);

  useEffect(() => {
    if (!code) { setMetaError("That isn't a valid meeting code."); return; }
    api.get(`/meetings/${code}`).then(setMeta).catch((e) => setMetaError(e.message));
  }, [code]);

  // Camera and microphone. If either is unavailable, fall back so people can still join.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      const tries: MediaStreamConstraints[] = [
        { audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
        { audio: true, video: false },
        { audio: false, video: true },
      ];
      for (const c of tries) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch (e: any) {
          setMediaError(e?.name === "NotAllowedError" ? "Camera and microphone access was blocked. Allow it in your browser's site settings to be seen and heard." : "No camera or microphone was found.");
        }
      }
      if (cancelled) { stream?.getTracks().forEach((t) => t.stop()); return; }
      if (stream) {
        if (stream.getVideoTracks().length && stream.getAudioTracks().length) setMediaError(null);
        else if (stream.getAudioTracks().length) setMediaError("No camera found: you'll join with audio only.");
        else setMediaError("No microphone found: others won't hear you.");
      }
      setLocal(stream);
    })();
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => { local?.getAudioTracks().forEach((t) => (t.enabled = mic)); }, [local, mic]);
  useEffect(() => { local?.getVideoTracks().forEach((t) => (t.enabled = cam)); }, [local, cam]);

  if (metaError) return <Message title="Can't open this meeting" body={metaError} onBack={() => navigate("/meetings")} />;
  if (!meta) return <Overlay><div className="flex h-full items-center justify-center"><Pulse /></div></Overlay>;
  if (meta.ended) return <Message title="This meeting has ended" body="The host ended it. Start a new one from Meetings." onBack={() => navigate("/meetings")} />;

  if (!joined) {
    return (
      <Overlay>
        <div className="flex h-full flex-col items-center justify-center gap-10 px-6 lg:flex-row">
          <div className="w-full max-w-[640px]">
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-line bg-ink-2">
              {local?.getVideoTracks().length && cam ? <VideoEl stream={local} muted mirror /> : <Avatar name={name || "You"} />}
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 p-4">
                <RoundButton label={mic ? "Mute microphone" : "Unmute microphone"} off={!mic} onClick={() => setMic(!mic)} disabled={!local?.getAudioTracks().length}>{mic ? <Mic size={18} /> : <MicOff size={18} />}</RoundButton>
                <RoundButton label={cam ? "Turn camera off" : "Turn camera on"} off={!cam} onClick={() => setCam(!cam)} disabled={!local?.getVideoTracks().length}>{cam ? <Video size={18} /> : <VideoOff size={18} />}</RoundButton>
              </div>
            </div>
            {mediaError && <p className="mt-3 text-[0.8rem] text-amber-200/80">{mediaError}</p>}
          </div>
          <div className="w-full max-w-[340px]">
            <div className="label">Meeting</div>
            <h1 className="mt-2 text-[1.5rem] font-light tracking-[-0.02em]">{meta.title || "Ready to join?"}</h1>
            <p className="mt-1 text-[0.85rem] text-mute">
              Hosted by {meta.isHost ? "you" : meta.hostName} · <span className="font-mono">{meta.code}</span>
            </p>
            <p className="mt-3 text-[0.82rem] text-mute-bright">{meta.inRoom.length ? `In the room: ${meta.inRoom.join(", ")}` : "No one else is here yet."}</p>
            {meta.locked && !meta.isHost && <p className="mt-3 text-[0.82rem] text-amber-200/80">The host has locked this meeting.</p>}
            <label className="label mt-6 block" htmlFor="meeting-name">Your name</label>
            <Input id="meeting-name" className="mt-2" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <div className="mt-5 flex gap-2">
              <Button variant="primary" className="flex-1" disabled={!name.trim() || (meta.locked && !meta.isHost)} onClick={() => setJoined(true)}>Join now</Button>
              <Button variant="ghost" onClick={() => navigate("/meetings")}>Cancel</Button>
            </div>
            <button onClick={() => navigator.clipboard.writeText(meetingLink(meta.code)).then(() => toast("Meeting link copied"), () => {})} className="mt-4 flex items-center gap-2 text-[0.8rem] text-mute hover:text-white"><Copy size={13} /> Copy invite link</button>
          </div>
        </div>
      </Overlay>
    );
  }
  return <Room code={code} title={meta.title} name={name.trim()} local={local} mic={mic} cam={cam} setMic={setMic} setCam={setCam} />;
}

function Room({ code, title, name, local, mic, cam, setMic, setCam }: { code: string; title: string; name: string; local: MediaStream | null; mic: boolean; cam: boolean; setMic: (v: boolean) => void; setCam: (v: boolean) => void }) {
  const navigate = useNavigate();
  const m = useMeeting(code, { name, local, enabled: true });
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [hand, setHand] = useState(false);
  const [panel, setPanel] = useState<"chat" | "people" | null>(null);
  const [unread, setUnread] = useState(0);
  const seen = useRef(0);
  const prev = useRef<Record<string, Participant>>({});

  const state: PeerState = useMemo(() => ({ audio: mic && !!local?.getAudioTracks().length, video: cam && !!local?.getVideoTracks().length, screen: !!screen, hand }), [mic, cam, screen, hand, local]);
  useEffect(() => { if (m.status === "live") m.sendState(state); }, [state, m.status, m.sendState]);

  // Join / leave notices.
  useEffect(() => {
    if (m.status !== "live") return;
    const before = prev.current;
    // The first update is everyone already here: no notices for them.
    if (seen.current > 0) for (const id of Object.keys(m.participants)) if (!before[id]) toast(`${m.participants[id].name} joined`);
    for (const id of Object.keys(before)) if (!m.participants[id]) toast(`${before[id].name} left`);
    prev.current = m.participants;
    seen.current++;
  }, [m.participants, m.status]);

  useEffect(() => { if (panel === "chat") setUnread(0); else if (m.chat.length) setUnread((u) => u + 1); }, [m.chat.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopShare = useCallback(async () => {
    screen?.getTracks().forEach((t) => t.stop());
    setScreen(null);
    await m.setOutgoingVideo(local?.getVideoTracks()[0] ?? null);
  }, [screen, local, m]);
  const share = async () => {
    if (screen) return stopShare();
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = s.getVideoTracks()[0];
      track.addEventListener("ended", () => { setScreen(null); m.setOutgoingVideo(local?.getVideoTracks()[0] ?? null); });
      setScreen(s);
      await m.setOutgoingVideo(track);
    } catch (e: any) {
      if (e?.name !== "NotAllowedError") toastError("Screen sharing isn't available here.");
    }
  };
  const leave = () => {
    screen?.getTracks().forEach((t) => t.stop());
    navigate("/meetings");
  };
  const endForAll = async () => {
    try { await api.post(`/meetings/${code}/end`); } catch (e) { toastError(e); }
  };
  const toggleLock = async () => {
    try { await api.post(`/meetings/${code}/lock`, { locked: !m.locked }); m.setLocked(!m.locked); toast(m.locked ? "Meeting unlocked" : "Meeting locked: no one new can join"); } catch (e) { toastError(e); }
  };

  // Keyboard: Ctrl/⌘+D mic, Ctrl/⌘+E camera.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "d") { e.preventDefault(); setMic(!mic); }
      if (e.key.toLowerCase() === "e") { e.preventDefault(); setCam(!cam); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mic, cam, setMic, setCam]);

  useEffect(() => () => { screen?.getTracks().forEach((t) => t.stop()); }, [screen]);

  if (m.status === "ended") return <Message title="The host ended the meeting" body="Thanks for joining." onBack={leave} />;
  if (m.status === "removed") return <Message title="You were removed from the meeting" body="The host removed you from this room." onBack={leave} />;
  if (m.status === "error") return <Message title="Couldn't join" body={m.error ?? "The meeting may be full, locked or ended."} onBack={leave} />;

  const others = Object.values(m.participants);
  const self = { peerId: "self", name: `${name} (you)`, host: m.isHost, state, stream: screen ?? local, connection: "connected" as const };
  const presenter = screen ? self : others.find((p) => p.state.screen);
  const tiles = [self, ...others].filter((p) => p !== presenter);
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : tiles.length <= 6 ? 3 : 4;

  return (
    <Overlay>
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 px-5 text-[0.85rem]">
          <span className="truncate text-white">{title || "Meeting"}</span>
          <span className="font-mono text-mute">{code}</span>
          {m.locked && <span className="flex items-center gap-1 text-[0.75rem] text-amber-200/80"><Lock size={12} /> Locked</span>}
          {m.status === "connecting" && <span className="flex items-center gap-2 text-mute"><Pulse /> Connecting</span>}
          <span className="ml-auto text-[0.78rem] text-mute">{others.length + 1} in the room</span>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 px-4 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {presenter && (
              <div className="min-h-0 flex-1">
                <Tile p={presenter} self={presenter === self} big />
              </div>
            )}
            <div className={cx("grid min-h-0 gap-3", presenter ? "h-36 shrink-0 auto-cols-[16rem] grid-flow-col overflow-x-auto" : "flex-1")}
              style={presenter ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}>
              {tiles.map((p) => <Tile key={p.peerId} p={p} self={p === self} />)}
            </div>
          </div>
          <AnimatePresence>
            {panel && (
              <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="shrink-0 overflow-hidden">
                <div className="flex h-full w-[320px] flex-col rounded-2xl border border-line bg-ink-1">
                  <div className="flex items-center gap-4 border-b border-line px-4 py-3 text-[0.85rem]">
                    <button onClick={() => setPanel("chat")} className={panel === "chat" ? "text-white" : "text-mute hover:text-white"}>Chat</button>
                    <button onClick={() => setPanel("people")} className={panel === "people" ? "text-white" : "text-mute hover:text-white"}>People · {others.length + 1}</button>
                    <button onClick={() => setPanel(null)} aria-label="Close panel" className="ml-auto text-mute hover:text-white"><X size={15} /></button>
                  </div>
                  {panel === "chat" ? <Chat messages={m.chat} selfId={m.selfId} onSend={m.sendChat} /> : (
                    <ul className="flex-1 space-y-1 overflow-y-auto p-3">
                      {[self, ...others].map((p) => (
                        <li key={p.peerId} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[0.85rem]">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-[0.75rem] uppercase">{p.name[0]}</span>
                          <span className="min-w-0 flex-1 truncate">{p.name}{p.host && <span className="ml-1.5 text-[0.7rem] text-mute">host</span>}</span>
                          {p.state.hand && <Hand size={14} className="text-amber-300" />}
                          {p.state.audio ? <Mic size={14} className="text-mute" /> : <MicOff size={14} className="text-red-300/80" />}
                          {p.state.video ? <Video size={14} className="text-mute" /> : <VideoOff size={14} className="text-mute-soft" />}
                          {m.isHost && p !== self && (
                            <button className="text-[0.72rem] text-mute hover:text-red-300" onClick={() => api.post(`/meetings/${code}/remove`, { peerId: p.peerId }).catch(toastError)}>Remove</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-3 px-5 pb-5 pt-1">
          <button onClick={() => navigator.clipboard.writeText(meetingLink(code)).then(() => toast("Meeting link copied"), () => toast(`Code: ${code}`))} className="hidden items-center gap-2 text-[0.8rem] text-mute hover:text-white md:flex"><Copy size={13} /> Invite</button>
          <div className="mx-auto flex items-center gap-2.5">
            <RoundButton label={`${mic ? "Mute" : "Unmute"} (Ctrl D)`} off={!mic} onClick={() => setMic(!mic)} disabled={!local?.getAudioTracks().length}>{mic ? <Mic size={18} /> : <MicOff size={18} />}</RoundButton>
            <RoundButton label={`Camera ${cam ? "off" : "on"} (Ctrl E)`} off={!cam} onClick={() => setCam(!cam)} disabled={!local?.getVideoTracks().length}>{cam ? <Video size={18} /> : <VideoOff size={18} />}</RoundButton>
            <RoundButton label={screen ? "Stop sharing" : "Share screen"} active={!!screen} onClick={share}>{screen ? <ScreenShareOff size={18} /> : <MonitorUp size={18} />}</RoundButton>
            <RoundButton label={hand ? "Lower hand" : "Raise hand"} active={hand} onClick={() => setHand(!hand)}><Hand size={18} /></RoundButton>
            <RoundButton label="Chat" active={panel === "chat"} onClick={() => { setPanel(panel === "chat" ? null : "chat"); setUnread(0); }} badge={panel === "chat" ? 0 : unread}><MessageSquare size={18} /></RoundButton>
            <RoundButton label="People" active={panel === "people"} onClick={() => setPanel(panel === "people" ? null : "people")}><Users size={18} /></RoundButton>
            {m.isHost && <RoundButton label={m.locked ? "Unlock meeting" : "Lock meeting"} active={m.locked} onClick={toggleLock}>{m.locked ? <Lock size={18} /> : <LockOpen size={18} />}</RoundButton>}
            <button onClick={leave} aria-label="Leave meeting" title="Leave" className="ml-2 flex h-12 items-center gap-2 rounded-full bg-red-500/90 px-5 text-[0.85rem] text-white transition-colors hover:bg-red-500"><PhoneOff size={18} /> Leave</button>
          </div>
          {m.isHost ? <button onClick={endForAll} className="hidden text-[0.8rem] text-red-300/80 hover:text-red-300 md:block">End for everyone</button> : <span className="hidden w-[7rem] md:block" />}
        </div>
      </div>
    </Overlay>
  );
}

function Tile({ p, self, big }: { p: { peerId: string; name: string; host: boolean; state: PeerState; stream: MediaStream | null; connection: string }; self: boolean; big?: boolean }) {
  const level = useAudioLevel(p.stream, p.state.audio);
  const showVideo = !!p.stream && (p.state.video || p.state.screen) && p.stream.getVideoTracks().length > 0;
  const speaking = level > 0.12 && p.state.audio;
  return (
    <div className={cx("relative h-full min-h-[120px] overflow-hidden rounded-2xl border bg-ink-2 transition-colors", speaking ? "border-white/70" : "border-line")}>
      {p.stream && <VideoEl stream={p.stream} muted={self} mirror={self && !p.state.screen} hidden={!showVideo} contain={p.state.screen} />}
      {!showVideo && <Avatar name={p.name} level={level} />}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[0.75rem] backdrop-blur">
        {!p.state.audio && <MicOff size={12} className="text-red-300" />}
        <span className="max-w-[14rem] truncate">{p.name}</span>
        {p.state.screen && <span className="text-mute">· presenting</span>}
      </div>
      {p.state.hand && <div className="absolute right-2 top-2 rounded-full bg-amber-300 p-1.5 text-black" title="Hand raised"><Hand size={14} /></div>}
      {!self && p.connection !== "connected" && p.connection !== "new" && (
        <div className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[0.7rem] text-mute">{p.connection === "failed" ? "Can't connect (network)" : "Connecting…"}</div>
      )}
      {big && <div className="sr-only">Presentation</div>}
    </div>
  );
}

function VideoEl({ stream, muted, mirror, hidden, contain }: { stream: MediaStream; muted?: boolean; mirror?: boolean; hidden?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {});
  });
  // Hidden with opacity, not display:none, so remote audio keeps playing.
  return <video ref={ref} autoPlay playsInline muted={muted} className={cx("absolute inset-0 h-full w-full", contain ? "object-contain" : "object-cover", mirror && "-scale-x-100", hidden && "opacity-0")} />;
}

function Avatar({ name, level = 0 }: { name: string; level?: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/[0.08] text-[1.8rem] font-light uppercase text-white transition-shadow"
        style={{ boxShadow: level > 0.12 ? `0 0 0 ${2 + level * 8}px rgba(255,255,255,0.25)` : "none" }}>{name.trim()[0] ?? "?"}</div>
    </div>
  );
}

function RoundButton({ label, off, active, disabled, badge, onClick, children }: { label: string; off?: boolean; active?: boolean; disabled?: boolean; badge?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={active ?? (off === undefined ? undefined : !off)}
      className={cx("relative flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:opacity-30",
        off ? "bg-red-500/90 text-white hover:bg-red-500" : active ? "bg-white text-black" : "bg-white/[0.09] text-white hover:bg-white/[0.16]")}>
      {children}
      {!!badge && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-white px-1.5 text-[0.65rem] leading-4 text-black">{badge}</span>}
    </button>
  );
}

function Chat({ messages, selfId, onSend }: { messages: { id: string; peerId: string; name: string; text: string; at: number }[]; selfId: string | null; onSend: (t: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    try { await onSend(t); } catch (e) { toastError(e); setText(t); }
  };
  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-[0.8rem] text-mute">Messages are only visible to people in the meeting right now, and aren't saved.</p>}
        {messages.map((m) => (
          <div key={m.id}>
            <div className="text-[0.72rem] text-mute">{m.peerId === selfId ? "You" : m.name} · {new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[0.86rem] text-white/90">{m.text}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()} placeholder="Message everyone" aria-label="Chat message" className="input h-9 py-0" />
        <button onClick={send} aria-label="Send" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-black disabled:opacity-30" disabled={!text.trim()}><Send size={14} /></button>
      </div>
    </>
  );
}

/** Full-screen layer above the app shell, like a call window. */
function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-40 bg-black text-white">{children}</div>;
}

function Message({ title, body, onBack }: { title: string; body: string; onBack: () => void }) {
  return (
    <Overlay>
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[1.4rem] font-light">{title}</h1>
        <p className="mt-2 max-w-md text-[0.9rem] text-mute">{body}</p>
        <Button className="mt-6" onClick={onBack}>Back to Meetings</Button>
      </div>
    </Overlay>
  );
}
