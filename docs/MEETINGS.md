---
title: Meetings
date: 2026-11-18
tags: [meetings, webrtc]
---

# Meetings

Video rooms inside Orbital, joined with a code like `kfm-qxtw-pdz` or a link (`/m/kfm-qxtw-pdz`). Anyone with an account on the same Orbital server can join with the code.

## What's in a meeting

- Lobby: camera and microphone preview, mute and camera toggles, your display name, who's already in the room.
- Video grid that adapts to the number of people; a highlight ring on whoever is speaking.
- Mute (Ctrl/⌘ D), camera (Ctrl/⌘ E), screen sharing with a presenter layout, raise hand.
- Chat for everyone in the room. It is relayed live and **not stored**.
- People list with each person's mic and camera state.
- Host controls: lock the room (no one new can join), remove someone, end the meeting for everyone.
- Recent meetings on the Meetings page, with copy-link and rejoin.

## How it works

Audio and video go **directly between participants' browsers** (WebRTC), encrypted in transit by the browser. The Orbital server never receives media. It stores the room (code, title, host) and relays the short messages browsers use to find each other (offers, answers, network candidates), plus chat and participant state, over a per-person event stream. The server only relays between people in the same room, and only on behalf of the signed-in person who owns that connection.

Each person connects to every other person (a "mesh"), so every participant uploads their video once per other participant. That keeps the system simple and private, and works well for small rooms. The default limit is **8 people** (`MEETING_MAX_PARTICIPANTS`). Larger meetings need a media server (an SFU such as LiveKit or mediasoup), which is not built in.

## Networks and the relay server (TURN)

Browsers find a direct path using public STUN servers (Google's by default, `STUN_URLS`). That works on most home and office networks. On strict networks (some corporate firewalls, some mobile carriers) a direct path is impossible, and the connection needs a **TURN relay**. Without one, those participants see "Can't connect (network)" on other people's tiles.

To add one, run a TURN server (for example coturn, or a hosted service such as Cloudflare Calls or Twilio Network Traversal) and set:

```bash
TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
```

```bash
TURN_USERNAME=orbital
```

```bash
TURN_CREDENTIAL=…
```

TURN credentials are sent to participants' browsers (that's how TURN works), so use a dedicated account with usage limits, or short-lived credentials from your provider.

## Desktop app

The desktop app allows camera, microphone and screen capture for Orbital's own window only. On macOS the system asks once for camera and microphone access; screen sharing uses the system picker on macOS 15 and later.

## Limits

- Live rooms are tracked in the server's memory: run one server process (the default). Several processes behind a load balancer would need a shared message bus.
- No recording, no phone dial-in, no breakout rooms, no waiting room beyond locking.

Related: [Architecture](ARCHITECTURE.md) describes the server this runs in · [Orbital for business](BUSINESS.md) covers team workspaces · Up: [README](../README.md)
