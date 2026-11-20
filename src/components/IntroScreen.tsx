import { useEffect, useRef, useState } from "react";
import { tx } from "@/i18n";
import { isLight } from "@/lib/theme";

/**
 * The opening screen: the wordmark assembling itself. Specks in the Neural Core's colours stream in and
 * settle into the "o" (the brand's particle o), "rbital" fades in beside it, then a line of text, and the
 * whole screen dissolves into the app. Same palette and colour bands as the orb and the brand images.
 */
const PALETTE = ["#b02bff", "#ff2bd6", "#ff1f2e", "#ff5a1f", "#2f7dff", "#1fd0ff", "#ffd23a", "#ff9a1a", "#a6ff2e", "#2cff7a", "#7a2cff"];
const BANDS: [number, string, string][] = [
  [1.0, "#ff1f2e", "#ff5a1f"], [0.6, "#ff5a1f", "#ff2bd6"], [0.3, "#ff9a1a", "#b02bff"], [0.0, "#ffd23a", "#ffd23a"],
  [-0.3, "#a6ff2e", "#ff9a1a"], [-0.55, "#1fd0ff", "#b02bff"], [-0.8, "#2f7dff", "#7a2cff"], [-1.0, "#7a2cff", "#2f7dff"],
];
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
function band(y: number, side: number) {
  const t = Math.max(-1, Math.min(1, y));
  let i = 0;
  while (i < BANDS.length - 2 && t < BANDS[i + 1][0]) i++;
  const [y0, a0, b0] = BANDS[i], [y1, a1, b1] = BANDS[i + 1];
  let f = Math.max(0, Math.min(1, (y0 - t) / (y0 - y1))); f = f * f * (3 - 2 * f);
  const s = side * 0.5 + 0.5;
  return mix(mix(rgb(a0), rgb(b0), s), mix(rgb(a1), rgb(b1), s), f);
}
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

export type IntroKind = "open" | "welcome";

export function IntroScreen({ kind, name, leaving, onGone }: { kind: IntroKind; name?: string | null; leaving: boolean; onGone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [gone, setGone] = useState(false);
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => { setGone(true); onGone(); }, 520);
    return () => clearTimeout(t);
  }, [leaving, onGone]);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0, alive = true;
    (async () => {
      try { await document.fonts.load("700 120px Outfit"); await document.fonts.load("400 120px Outfit"); } catch { /* falls back to the system font */ }
      if (!alive) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const W = cv.clientWidth, H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const light = isLight();
      const fgc = getComputedStyle(document.documentElement).getPropertyValue("--c-fg").trim() || "255 255 255";

      // Layout: the wordmark centred, "o" in bold, "rb" bold, "ital" regular (the Wordmark component's style).
      const fontPx = Math.max(56, Math.min(132, W * 0.11));
      const m = document.createElement("canvas").getContext("2d")!;
      const width = (t: string, w: number) => { m.font = `${w} ${fontPx}px Outfit`; return m.measureText(t).width; };
      const wo = width("o", 700), wrb = width("rb", 700), wital = width("ital", 400);
      const x0 = W / 2 - (wo + wrb + wital) / 2, base = H / 2 + fontPx * 0.28;

      // Target points: sample the "o" glyph.
      const mask = document.createElement("canvas");
      mask.width = Math.ceil(wo + 4); mask.height = Math.ceil(fontPx * 1.1);
      const mc = mask.getContext("2d")!;
      mc.font = `700 ${fontPx}px Outfit`; mc.fillStyle = "#fff"; mc.textBaseline = "alphabetic";
      mc.fillText("o", 2, fontPx * 0.9);
      const data = mc.getImageData(0, 0, mask.width, mask.height).data;
      const step = Math.max(2, Math.round(fontPx / 42));
      const pts: { tx: number; ty: number; sx: number; sy: number; c: number[]; r: number; d: number; ph: number }[] = [];
      let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const oy0 = base - fontPx * 0.9;
      for (let y = 0; y < mask.height; y += step) for (let x = 0; x < mask.width; x += step) {
        const jx = x + (rnd() - 0.5) * step, jy = y + (rnd() - 0.5) * step;
        const ix = Math.min(mask.width - 1, Math.max(0, jx | 0)), iy = Math.min(mask.height - 1, Math.max(0, jy | 0));
        if (data[(iy * mask.width + ix) * 4 + 3] < 128) continue;
        const nx = (jx / mask.width) * 2 - 1, ny = ((jy - fontPx * 0.35) / (fontPx * 0.55)) * 2 - 1;
        const roll = rnd();
        const c = roll < 0.05 ? [255, 255, 255] : roll < 0.15 ? rgb(PALETTE[(rnd() * PALETTE.length) | 0]) : band(-ny * 0.94 + nx * 0.34 + (rnd() - 0.5) * 0.15, nx);
        // Start far out on a wide ring, so the specks visibly fall into orbit.
        const a = rnd() * Math.PI * 2, R = Math.max(W, H) * (0.35 + rnd() * 0.4);
        const tx = x0 + jx - 2, ty = oy0 + jy;
        pts.push({ tx, ty, sx: tx + Math.cos(a) * R, sy: ty + Math.sin(a) * R * 0.7, c, r: 0.7 + Math.pow(rnd(), 2) * fontPx / 52, d: rnd() * 0.35, ph: rnd() * 6.28 });
      }
      const start = performance.now();
      const draw = (now: number) => {
        if (!alive) return;
        const t = reduced ? 10 : (now - start) / 1000;
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = light ? "source-over" : "lighter";
        for (const p of pts) {
          const k = ease((t - p.d) / 1.05);
          // Arrive along a gentle curve, then keep a faint shimmer, as if still in orbit.
          const swirl = (1 - k) * 0.9;
          const cx = p.sx + (p.tx - p.sx) * k, cy = p.sy + (p.ty - p.sy) * k;
          const ox = Math.sin(swirl * 3 + p.ph) * swirl * 40 + (k >= 1 ? Math.sin(t * 2 + p.ph) * 0.5 : 0);
          const oy = Math.cos(swirl * 3 + p.ph) * swirl * 40 + (k >= 1 ? Math.cos(t * 1.7 + p.ph) * 0.5 : 0);
          let col = p.c;
          if (light) { const mx = Math.max(...col) || 1; col = col.map((v) => (v / mx) * 255); const wh = Math.min(...col) / 255; col = col.map((v) => v * (1 - 0.6 * wh)); }
          ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${(0.25 + 0.75 * k) * (light ? 0.9 : 0.95)})`;
          ctx.beginPath(); ctx.arc(cx + ox, cy + oy, p.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        // "rbital" completes the word once the o has nearly formed.
        const ta = ease((t - 0.75) / 0.5);
        if (ta > 0) {
          ctx.fillStyle = `rgb(${fgc} / ${ta})`; ctx.textBaseline = "alphabetic";
          const slide = (1 - ta) * fontPx * 0.12;
          ctx.font = `700 ${fontPx}px Outfit`; ctx.fillText("rb", x0 + wo + slide, base);
          ctx.font = `400 ${fontPx}px Outfit`; ctx.fillText("ital", x0 + wo + wrb + slide, base);
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    })();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [reduced]);

  if (gone) return null;
  const line = kind === "welcome" ? (name ? tx("Welcome back, {name}.", { name }) : tx("Welcome back.")) : tx("Your intelligence. Compounding.");
  return (
    <div
      className="fixed inset-0 z-[100] bg-black transition-opacity duration-500 ease-out"
      style={{ opacity: leaving ? 0 : 1, pointerEvents: leaving ? "none" : "auto" }}
      role="status" aria-label={tx("Opening Orbital")}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full transition-transform duration-500 ease-out" style={{ transform: leaving ? "scale(1.04)" : "none" }} />
      <p className="intro-line absolute inset-x-0 top-1/2 mt-[clamp(70px,9vw,118px)] text-center font-brand text-[clamp(0.95rem,1.4vw,1.15rem)] text-mute">{line}</p>
    </div>
  );
}
