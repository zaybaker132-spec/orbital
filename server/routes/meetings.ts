import { Router, type Response } from "express";
import crypto from "node:crypto";
import * as z from "zod/v4";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { actor, ah, HttpError, notFound, parse } from "../lib/http.js";
import { rateLimit } from "../lib/rateLimit.js";

/**
 * MEETINGS — video rooms joined by code.
 * Media goes peer-to-peer over WebRTC (a full mesh, so rooms are small). The server only stores
 * rooms and relays signalling (offers, answers, ICE candidates), chat and participant state over
 * a per-participant Server-Sent Events stream. Signalling is accepted only between peers in the
 * same room, and only from the signed-in person who owns the sending peer.
 */
export const meetings = Router();

// ── Codes ──────────────────────────────────────────────────────────────────
const ALPHABET = "abcdefghjkmnpqrstuvwxyz"; // no i, l, o: easy to read aloud
function newCode() {
  const pick = (n: number) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}
/** Accepts "abc-defg-hij", "abcdefghij", or a full link ending in the code. */
export function normalizeCode(raw: string) {
  const m = raw.toLowerCase().match(/([a-z]{3})-?([a-z]{4})-?([a-z]{3})\s*$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ── Live rooms (in memory; single server node) ─────────────────────────────
interface PeerState { audio: boolean; video: boolean; screen: boolean; hand: boolean; recording?: boolean }
interface Peer { id: string; userId: string; name: string; res: Response; state: PeerState; joinedAt: number }
interface Room { meetingId: string; hostId: string; peers: Map<string, Peer> }
const rooms = new Map<string, Room>();

const send = (p: Peer, event: string, data: unknown) => { if (!p.res.writableEnded) p.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
const broadcast = (room: Room, event: string, data: unknown, except?: string) => { for (const p of room.peers.values()) if (p.id !== except) send(p, event, data); };
const publicPeer = (p: Peer, room: Room) => ({ peerId: p.id, userId: p.userId, name: p.name, state: p.state, host: p.userId === room.hostId, joinedAt: p.joinedAt });

async function loadMeeting(code: string) {
  return (await db().query<{ id: string; code: string; title: string; host_id: string; locked: boolean; created_at: string; ended_at: string | null; host_name: string }>(
    `SELECT m.*, COALESCE(NULLIF(u.display_name,''), split_part(u.email,'@',1)) AS host_name FROM meetings m JOIN users u ON u.id=m.host_id WHERE m.code=$1`, [code])).rows[0];
}
const codeParam = (raw: string) => {
  const c = normalizeCode(raw);
  if (!c) throw new HttpError(400, "That doesn't look like a meeting code. Codes look like abc-defg-hij.", "invalid_code");
  return c;
};

// ── Rooms ──────────────────────────────────────────────────────────────────
meetings.get("/meetings/config", (_req, res) => {
  const m = config.meetings;
  const iceServers: RTCIceServerLike[] = [];
  if (m.stunUrls.length) iceServers.push({ urls: m.stunUrls });
  if (m.turnUrls.length) iceServers.push({ urls: m.turnUrls, username: m.turnUsername, credential: m.turnCredential });
  res.json({ iceServers, maxParticipants: m.maxParticipants, relay: m.turnUrls.length > 0 });
});
type RTCIceServerLike = { urls: string[]; username?: string; credential?: string };

meetings.post("/meetings", rateLimit({ windowMs: 60 * 60_000, max: 60, key: "user", name: "meeting-create" }), ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().max(120).default("") }), req.body ?? {});
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const r = await db().query<{ code: string }>("INSERT INTO meetings(code, title, host_id) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING RETURNING code", [code, b.title, actor(req)]);
    if (r.rows[0]) return res.status(201).json({ code });
  }
  throw new HttpError(503, "Couldn't create a meeting code. Try again.");
}));

meetings.get("/meetings", ah(async (req, res) => {
  const r = await db().query(
    `SELECT m.code, m.title, m.created_at, m.ended_at, m.host_id = $1 AS is_host,
            COALESCE(NULLIF(u.display_name,''), split_part(u.email,'@',1)) AS host_name,
            GREATEST(m.created_at, COALESCE(p.last_seen_at, m.created_at)) AS last_active
     FROM meetings m JOIN users u ON u.id=m.host_id
     LEFT JOIN meeting_participants p ON p.meeting_id=m.id AND p.user_id=$1
     WHERE m.host_id=$1 OR p.user_id=$1
     ORDER BY last_active DESC LIMIT 30`, [actor(req)]);
  res.json(r.rows.map((m: any) => ({ ...m, live: rooms.get(m.code)?.peers.size ?? 0 })));
}));

meetings.get("/meetings/:code", ah(async (req, res) => {
  const m = await loadMeeting(codeParam(req.params.code));
  if (!m) throw notFound("Meeting");
  const room = rooms.get(m.code);
  res.json({
    code: m.code, title: m.title, hostName: m.host_name, isHost: m.host_id === actor(req), locked: m.locked,
    ended: !!m.ended_at, createdAt: m.created_at, inRoom: room ? [...room.peers.values()].map((p) => p.name) : [],
    maxParticipants: config.meetings.maxParticipants,
  });
}));

// ── Joining: one SSE stream per participant ────────────────────────────────
meetings.get("/meetings/:code/stream", ah(async (req, res) => {
  const code = codeParam(req.params.code);
  const m = await loadMeeting(code);
  if (!m) throw notFound("Meeting");
  if (m.ended_at) throw new HttpError(410, "This meeting has ended.", "ended");
  const me = actor(req);
  const isHost = m.host_id === me;
  if (m.locked && !isHost) throw new HttpError(423, "The host has locked this meeting.", "locked");
  let room = rooms.get(code);
  if (room && room.peers.size >= config.meetings.maxParticipants) throw new HttpError(429, `This meeting is full (${config.meetings.maxParticipants} people).`, "full");
  const name = String(req.query.name ?? "").trim().slice(0, 60) || req.user!.displayName || req.user!.email.split("@")[0];
  const state: PeerState = { audio: req.query.audio === "1", video: req.query.video === "1", screen: false, hand: false };

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  if (!room) { room = { meetingId: m.id, hostId: m.host_id, peers: new Map() }; rooms.set(code, room); }
  const peer: Peer = { id: crypto.randomUUID(), userId: me, name, res, state, joinedAt: Date.now() };
  // Existing peers learn about the newcomer; the newcomer gets everyone already here and sends them offers.
  send(peer, "welcome", { peerId: peer.id, isHost, title: m.title, peers: [...room.peers.values()].map((p) => publicPeer(p, room!)) });
  broadcast(room, "peer-joined", publicPeer(peer, room));
  room.peers.set(peer.id, peer);
  await db().query(
    `INSERT INTO meeting_participants(meeting_id, user_id) VALUES ($1,$2)
     ON CONFLICT (meeting_id, user_id) DO UPDATE SET last_seen_at=now()`, [m.id, me]);

  const ping = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 20_000);
  req.on("close", () => {
    clearInterval(ping);
    const r = rooms.get(code);
    if (!r || !r.peers.delete(peer.id)) return;
    broadcast(r, "peer-left", { peerId: peer.id });
    if (!r.peers.size) rooms.delete(code);
    db().query("UPDATE meeting_participants SET last_seen_at=now() WHERE meeting_id=$1 AND user_id=$2", [m.id, me]).catch(() => {});
  });
}));

/** The sending peer must exist in this room and belong to the signed-in person. */
function ownPeer(code: string, peerId: string, userId: string) {
  const room = rooms.get(code);
  const peer = room?.peers.get(peerId);
  if (!room || !peer || peer.userId !== userId) throw new HttpError(404, "You're not in this meeting.", "not_in_meeting");
  return { room, peer };
}

const signalLimit = rateLimit({ windowMs: 10_000, max: 600, key: "user", name: "meeting-signal" });

meetings.post("/meetings/:code/signal", signalLimit, ah(async (req, res) => {
  const b = parse(z.object({
    from: z.uuid(), to: z.uuid(),
    kind: z.enum(["offer", "answer", "ice"]),
    data: z.record(z.string(), z.unknown()),
  }), req.body);
  if (JSON.stringify(b.data).length > 64_000) throw new HttpError(413, "Signal too large");
  const { room } = ownPeer(codeParam(req.params.code), b.from, actor(req));
  const target = room.peers.get(b.to);
  if (!target) return res.status(202).json({ ok: false }); // they just left; harmless
  send(target, "signal", { from: b.from, kind: b.kind, data: b.data });
  res.json({ ok: true });
}));

meetings.post("/meetings/:code/state", signalLimit, ah(async (req, res) => {
  const b = parse(z.object({ from: z.uuid(), state: z.object({ audio: z.boolean(), video: z.boolean(), screen: z.boolean(), hand: z.boolean(), recording: z.boolean().optional() }) }), req.body);
  const { room, peer } = ownPeer(codeParam(req.params.code), b.from, actor(req));
  peer.state = b.state;
  broadcast(room, "state", { peerId: peer.id, state: peer.state });
  res.json({ ok: true });
}));

meetings.post("/meetings/:code/chat", rateLimit({ windowMs: 10_000, max: 20, key: "user", name: "meeting-chat" }), ah(async (req, res) => {
  const b = parse(z.object({ from: z.uuid(), text: z.string().trim().min(1).max(2000) }), req.body);
  const { room, peer } = ownPeer(codeParam(req.params.code), b.from, actor(req));
  // Chat is relayed live and not stored.
  broadcast(room, "chat", { id: crypto.randomUUID(), peerId: peer.id, name: peer.name, text: b.text, at: Date.now() });
  res.json({ ok: true });
}));

// ── Host controls ──────────────────────────────────────────────────────────
async function hostOnly(rawCode: string, userId: string) {
  const code = codeParam(rawCode);
  const m = await loadMeeting(code);
  if (!m) throw notFound("Meeting");
  if (m.host_id !== userId) throw new HttpError(403, "Only the host can do that.", "forbidden");
  return { code, m };
}

meetings.post("/meetings/:code/lock", ah(async (req, res) => {
  const b = parse(z.object({ locked: z.boolean() }), req.body);
  const { code, m } = await hostOnly(req.params.code, actor(req));
  await db().query("UPDATE meetings SET locked=$2 WHERE id=$1", [m.id, b.locked]);
  const room = rooms.get(code);
  if (room) broadcast(room, "locked", { locked: b.locked });
  res.json({ ok: true });
}));

meetings.post("/meetings/:code/remove", ah(async (req, res) => {
  const b = parse(z.object({ peerId: z.uuid() }), req.body);
  const { code } = await hostOnly(req.params.code, actor(req));
  const room = rooms.get(code);
  const p = room?.peers.get(b.peerId);
  if (!room || !p) throw notFound("Participant");
  send(p, "removed", {});
  room.peers.delete(p.id);
  p.res.end();
  broadcast(room, "peer-left", { peerId: p.id });
  res.json({ ok: true });
}));

meetings.post("/meetings/:code/end", ah(async (req, res) => {
  const { code, m } = await hostOnly(req.params.code, actor(req));
  await db().query("UPDATE meetings SET ended_at=now() WHERE id=$1 AND ended_at IS NULL", [m.id]);
  const room = rooms.get(code);
  if (room) {
    broadcast(room, "ended", {});
    for (const p of room.peers.values()) p.res.end();
    rooms.delete(code);
  }
  res.json({ ok: true });
}));
