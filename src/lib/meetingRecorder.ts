import { recordStream, type Recorder } from "./capture";

/**
 * Records a meeting as people see it: everyone's video laid out on one 1280×720 canvas (a shared screen
 * large with a strip of faces, otherwise a grid) with their names, and everyone's sound mixed together.
 * Runs entirely in the recorder's browser; the result goes to the media library.
 */
export interface Feed { id: string; name: string; stream: MediaStream | null; screen?: boolean; video: boolean }

const W = 1280, H = 720, FPS = 24;

export function recordMeeting(getFeeds: () => Feed[]): Recorder {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d")!;
  const videos = new Map<string, HTMLVideoElement>();
  const audio = new AudioContext();
  const mix = audio.createMediaStreamDestination();
  const wired = new Set<string>();

  const videoFor = (f: Feed) => {
    const key = `${f.id}:${f.stream?.id ?? "none"}`;
    let v = videos.get(key);
    if (!v && f.stream) {
      v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.srcObject = f.stream; void v.play().catch(() => {});
      videos.set(key, v);
    }
    return v;
  };
  const wireAudio = (feeds: Feed[]) => {
    for (const f of feeds) for (const t of f.stream?.getAudioTracks() ?? []) {
      if (wired.has(t.id)) continue;
      wired.add(t.id);
      try { audio.createMediaStreamSource(new MediaStream([t])).connect(mix); } catch { /* track ended */ }
    }
  };
  const tile = (f: Feed, x: number, y: number, w: number, h: number) => {
    g.fillStyle = "#111"; g.fillRect(x, y, w, h);
    const v = f.video || f.screen ? videoFor(f) : undefined;
    if (v && v.videoWidth) {
      // Cover for faces, contain for a shared screen (nothing cut off).
      const vr = v.videoWidth / v.videoHeight, tr = w / h;
      let dw = w, dh = h;
      if (f.screen ? vr > tr : vr < tr) { dh = w / vr; } else { dw = h * vr; }
      if (f.screen) { dw = Math.min(dw, w); dh = Math.min(dh, h); }
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      g.restore();
    } else {
      g.fillStyle = "#2a2a30"; g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.16, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.font = `${Math.round(Math.min(w, h) * 0.14)}px Inter, system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText((f.name.trim()[0] ?? "?").toUpperCase(), x + w / 2, y + h / 2);
    }
    g.font = "15px Inter, system-ui, sans-serif"; g.textAlign = "left"; g.textBaseline = "alphabetic";
    const label = f.name.slice(0, 40), tw = g.measureText(label).width;
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(x + 8, y + h - 30, tw + 16, 22);
    g.fillStyle = "#fff"; g.fillText(label, x + 16, y + h - 14);
  };
  const draw = () => {
    const feeds = getFeeds();
    wireAudio(feeds);
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    const screen = feeds.find((f) => f.screen);
    const people = feeds.filter((f) => f !== screen);
    const gap = 8;
    if (screen) {
      const strip = people.length ? 132 : 0;
      tile(screen, 0, 0, W, H - strip);
      const n = Math.min(people.length, 6), w = n ? Math.min(234, (W - gap * (n + 1)) / n) : 0;
      people.slice(0, 6).forEach((p, i) => tile(p, gap + i * (w + gap), H - strip + gap, w, strip - gap * 2));
    } else {
      const n = Math.max(1, people.length), cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
      const w = (W - gap * (cols + 1)) / cols, h = (H - gap * (rows + 1)) / rows;
      people.forEach((p, i) => tile(p, gap + (i % cols) * (w + gap), gap + Math.floor(i / cols) * (h + gap), w, h));
    }
    // A small, constant mark so a recording is never mistaken for a live call.
    g.fillStyle = "rgba(239,68,68,0.95)"; g.beginPath(); g.arc(W - 22, 22, 6, 0, Math.PI * 2); g.fill();
  };
  // A timer (not requestAnimationFrame) so recording continues if the window is in the background.
  const timer = setInterval(draw, 1000 / FPS);
  draw();
  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...mix.stream.getAudioTracks()]);
  return recordStream(stream, true, () => {
    clearInterval(timer);
    videos.forEach((v) => { v.srcObject = null; });
    void audio.close();
  });
}
