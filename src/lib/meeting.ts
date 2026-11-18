import { useCallback, useEffect, useRef, useState } from "react";
import { api, getWorkspaceId } from "./api";

/**
 * WebRTC mesh for a meeting room. Every participant holds one RTCPeerConnection per other
 * participant. The newcomer sends offers to everyone already in the room (no offer collisions);
 * signalling goes through the Orbital server, media goes directly between browsers.
 */
export interface PeerState { audio: boolean; video: boolean; screen: boolean; hand: boolean }
export interface Participant { peerId: string; name: string; host: boolean; state: PeerState; stream: MediaStream | null; connection: RTCPeerConnectionState | "new" }
export interface ChatMessage { id: string; peerId: string; name: string; text: string; at: number }
export type RoomStatus = "connecting" | "live" | "ended" | "removed" | "error";

interface PeerConn { pc: RTCPeerConnection; stream: MediaStream; pendingIce: RTCIceCandidateInit[]; audio: RTCRtpSender | null; video: RTCRtpSender | null }

export function useMeeting(code: string, opts: { name: string; local: MediaStream | null; enabled: boolean }) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [locked, setLocked] = useState(false);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const conns = useRef(new Map<string, PeerConn>());
  const selfRef = useRef<string | null>(null);
  const localRef = useRef<MediaStream | null>(opts.local);
  const outgoingVideo = useRef<MediaStreamTrack | null>(null);
  const iceServers = useRef<RTCIceServer[]>([]);
  localRef.current = opts.local;

  const post = useCallback((path: string, body: unknown) => api.post(`/meetings/${code}/${path}`, body).catch(() => {}), [code]);
  const patchPeer = (peerId: string, patch: Partial<Participant>) =>
    setParticipants((ps) => (ps[peerId] ? { ...ps, [peerId]: { ...ps[peerId], ...patch } } : ps));

  /**
   * Create the connection to one remote peer. The caller (offerer) creates exactly one audio and one
   * video slot; the answerer fills the slots the offer creates (see attachLocal). Fixed slots mean
   * screen sharing and muting never need renegotiation.
   */
  const connect = useCallback((peerId: string, role: "offerer" | "answerer") => {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current });
    const stream = new MediaStream();
    const local = localRef.current;
    const conn: PeerConn = { pc, stream, pendingIce: [], audio: null, video: null };
    if (role === "offerer") {
      const a = local?.getAudioTracks()[0] ?? null;
      const v = outgoingVideo.current ?? local?.getVideoTracks()[0] ?? null;
      conn.audio = pc.addTransceiver(a ?? "audio", { direction: "sendrecv", streams: local ? [local] : [] }).sender;
      conn.video = pc.addTransceiver(v ?? "video", { direction: "sendrecv", streams: local ? [local] : [] }).sender;
    }
    pc.ontrack = (e) => {
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      patchPeer(peerId, { stream });
    };
    pc.onicecandidate = (e) => { if (e.candidate && selfRef.current) post("signal", { from: selfRef.current, to: peerId, kind: "ice", data: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => patchPeer(peerId, { connection: pc.connectionState });
    conns.current.set(peerId, conn);
    return conn;
  }, [post]);

  /** Answerer: put our tracks on the slots created by the remote offer. */
  const attachLocal = async (conn: PeerConn) => {
    const local = localRef.current;
    for (const t of conn.pc.getTransceivers()) {
      const kind = t.receiver.track.kind;
      const track = kind === "audio" ? local?.getAudioTracks()[0] ?? null : outgoingVideo.current ?? local?.getVideoTracks()[0] ?? null;
      t.direction = "sendrecv";
      await t.sender.replaceTrack(track);
      if (local) (t.sender as RTCRtpSender & { setStreams?: (...s: MediaStream[]) => void }).setStreams?.(local);
      if (kind === "audio") conn.audio = t.sender; else conn.video = t.sender;
    }
  };

  const drop = (peerId: string) => {
    conns.current.get(peerId)?.pc.close();
    conns.current.delete(peerId);
    setParticipants((ps) => { const n = { ...ps }; delete n[peerId]; return n; });
  };

  useEffect(() => {
    if (!opts.enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    (async () => {
      try {
        const cfg = await api.get("/meetings/config");
        iceServers.current = cfg.iceServers;
      } catch { /* fall back to host candidates only */ }
      const local = localRef.current;
      const qs = new URLSearchParams({
        name: opts.name,
        audio: local?.getAudioTracks().some((t) => t.enabled) ? "1" : "0",
        video: local?.getVideoTracks().some((t) => t.enabled) ? "1" : "0",
        ...(getWorkspaceId() ? { workspace: getWorkspaceId()! } : {}),
      });
      // A failed join comes back as an HTTP error; check it first so the reason can be shown.
      const probe = await fetch(`/api/meetings/${code}`, { headers: { "x-orbital-request": "1" } });
      if (!probe.ok) { setStatus("error"); setError((await probe.json().catch(() => ({}))).error ?? "Couldn't open this meeting."); return; }
      if (closed) return;
      es = new EventSource(`/api/meetings/${code}/stream?${qs}`, { withCredentials: true });
      const on = (ev: string, fn: (d: any) => void) => es!.addEventListener(ev, (m) => fn(JSON.parse((m as MessageEvent).data)));

      on("welcome", async (d) => {
        selfRef.current = d.peerId;
        setSelfId(d.peerId);
        setIsHost(d.isHost);
        setStatus("live");
        const initial: Record<string, Participant> = {};
        for (const p of d.peers) initial[p.peerId] = { peerId: p.peerId, name: p.name, host: p.host, state: p.state, stream: null, connection: "new" };
        setParticipants(initial);
        // The newcomer calls everyone already here.
        for (const p of d.peers) {
          const c = connect(p.peerId, "offerer");
          const offer = await c.pc.createOffer();
          await c.pc.setLocalDescription(offer);
          post("signal", { from: d.peerId, to: p.peerId, kind: "offer", data: { type: offer.type, sdp: offer.sdp } });
        }
      });
      on("peer-joined", (p) => setParticipants((ps) => ({ ...ps, [p.peerId]: { peerId: p.peerId, name: p.name, host: p.host, state: p.state, stream: null, connection: "new" } })));
      on("peer-left", (p) => drop(p.peerId));
      on("state", (p) => patchPeer(p.peerId, { state: p.state }));
      on("chat", (m) => setChat((c) => [...c.slice(-199), m]));
      on("locked", (d) => setLocked(d.locked));
      on("ended", () => { setStatus("ended"); es?.close(); });
      on("removed", () => { setStatus("removed"); es?.close(); });
      on("signal", async ({ from, kind, data }) => {
        let c = conns.current.get(from);
        try {
          if (kind === "offer") {
            if (!c) c = connect(from, "answerer");
            await c.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
            await attachLocal(c);
            const answer = await c.pc.createAnswer();
            await c.pc.setLocalDescription(answer);
            post("signal", { from: selfRef.current, to: from, kind: "answer", data: { type: answer.type, sdp: answer.sdp } });
          } else if (kind === "answer" && c) {
            await c.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
          } else if (kind === "ice" && c) {
            if (c.pc.remoteDescription) await c.pc.addIceCandidate(data as RTCIceCandidateInit);
            else c.pendingIce.push(data as RTCIceCandidateInit);
            return;
          }
          if (c) { for (const ice of c.pendingIce.splice(0)) await c.pc.addIceCandidate(ice).catch(() => {}); }
        } catch (err) {
          console.warn("[meeting] signalling failed", err);
        }
      });
      es.onerror = () => {
        // The server refused or dropped the stream (ended, locked, full, network).
        if (es?.readyState === EventSource.CLOSED) setStatus((s) => (s === "live" || s === "connecting" ? "error" : s));
      };
    })();
    return () => {
      closed = true;
      es?.close();
      for (const c of conns.current.values()) c.pc.close();
      conns.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, opts.enabled]);

  /** Swap what we send on every connection (camera <-> screen) without renegotiating. */
  const setOutgoingVideo = useCallback(async (track: MediaStreamTrack | null) => {
    outgoingVideo.current = track;
    await Promise.all([...conns.current.values()].map((c) => c.video?.replaceTrack(track)));
  }, []);
  const setOutgoingAudio = useCallback(async (track: MediaStreamTrack | null) => {
    await Promise.all([...conns.current.values()].map((c) => c.audio?.replaceTrack(track)));
  }, []);

  const sendState = useCallback((state: PeerState) => { if (selfRef.current) post("state", { from: selfRef.current, state }); }, [post]);
  const sendChat = useCallback((text: string) => selfRef.current ? api.post(`/meetings/${code}/chat`, { from: selfRef.current, text }) : Promise.resolve(), [code]);

  return { status, error, selfId, isHost, locked, setLocked, participants, chat, sendState, sendChat, setOutgoingVideo, setOutgoingAudio };
}

/** Rough speaking detector for a stream: 0..1 level, updated a few times a second. */
export function useAudioLevel(stream: MediaStream | null, active = true) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !active || !stream.getAudioTracks().length) { setLevel(0); return; }
    let ctx: AudioContext | null = null;
    try { ctx = new AudioContext(); } catch { return; }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const t = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 30));
    }, 150);
    return () => { clearInterval(t); src.disconnect(); ctx?.close(); };
  }, [stream, active]);
  return level;
}
