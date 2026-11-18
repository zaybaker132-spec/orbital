import { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { useApp } from "@/state/app";
import { cx } from "@/components/ui";

/** Orbital's palette, the same colours the Neural Core's clusters use. */
const PALETTE = ["#ff1f2e", "#ff5a1f", "#ff9a1a", "#ffd23a", "#a6ff2e", "#2cff7a", "#1fd0ff", "#2f7dff", "#7a2cff", "#b02bff", "#ff2bd6"];

/**
 * Particles orbiting an empty centre (where the page should be), and one that has drifted off
 * and keeps going. Canvas 2D: light, and still when the person prefers reduced motion.
 */
function LostOrbit({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, w = 0, h = 0, dpr = 1;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Three tilted rings plus a faint halo of dust.
    const parts = Array.from({ length: 760 }, (_, i) => {
      const ring = i % 3;
      return {
        ring,
        a: rnd() * Math.PI * 2,
        r: [1, 0.78, 1.18][ring] * (0.96 + rnd() * 0.08),
        speed: [0.16, -0.12, 0.09][ring] * (0.85 + rnd() * 0.3),
        size: 0.7 + rnd() * rnd() * 2.4,
        color: PALETTE[Math.floor(rnd() * PALETTE.length)],
        twinkle: rnd() * Math.PI * 2,
      };
    });
    const dust = Array.from({ length: 160 }, () => ({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, s: rnd() * 1.1, a: rnd() * 0.35 }));
    const tilt = [[0.34, -0.35], [0.22, 0.6], [0.42, 1.25]];
    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = reduced ? 8 : (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.27, R = Math.min(w * 0.3, h * 0.15);
      for (const d of dust) { ctx.globalAlpha = d.a; ctx.fillStyle = "#fff"; ctx.fillRect(cx + d.x * w * 0.5, cy + d.y * h * 0.5, d.s, d.s); }
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = "lighter";
      for (const p of parts) {
        const a = p.a + t * p.speed;
        const [sq, rot] = tilt[p.ring];
        const x0 = Math.cos(a) * p.r * R, y0 = Math.sin(a) * p.r * R * sq;
        const x = x0 * Math.cos(rot) - y0 * Math.sin(rot), y = x0 * Math.sin(rot) + y0 * Math.cos(rot);
        // Particles "behind" the empty centre are dimmer, which gives the rings depth.
        const depth = Math.sin(a) > 0 ? 1 : 0.5;
        ctx.globalAlpha = depth * (0.7 + 0.3 * Math.sin(t * 1.7 + p.twinkle));
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(cx + x, cy + y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      // The one that got away: leaves the outer ring and drifts off, trailing light, then starts again.
      const cycle = 9, k = (t % cycle) / cycle;
      const start = { x: cx + R * 1.18 * 0.86, y: cy - R * 0.32 };
      const dx = start.x + k * k * w * 0.42 + Math.sin(k * 6) * 6, dy = start.y - k * h * 0.26;
      for (let i = 0; i < 18; i++) {
        const q = Math.max(0, k - i * 0.006);
        ctx.globalAlpha = (1 - i / 18) * 0.5 * (1 - k * 0.6);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(start.x + q * q * w * 0.42 + Math.sin(q * 6) * 6, start.y - q * h * 0.26, 2.2 * (1 - i / 18), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1 - k * 0.7;
      const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, 14);
      glow.addColorStop(0, "rgba(255,255,255,0.95)"); glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(dx, dy, 14, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const vis = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduced) raf = requestAnimationFrame(draw); };
    document.addEventListener("visibilitychange", vis);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return <canvas ref={ref} aria-hidden className={className} />;
}

/** Words from the missing address, for a "search for it" suggestion: /projects/q3-launch-plan → "q3 launch plan". */
function wordsFrom(pathname: string) {
  const last = decodeURIComponent(pathname).split("/").filter(Boolean).pop() ?? "";
  if (/^[0-9a-f-]{20,}$/i.test(last)) return "";
  return last.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_+.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * "Not found", for a mistyped address (whole page) or an item that no longer exists (inside the app).
 * `what` names the missing thing ("project", "note"); `back` is where its list lives.
 */
export function NotFoundPage({ what, back, standalone }: { what?: string; back?: { to: string; label: string }; standalone?: boolean }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const user = useApp((s) => s.user);
  const words = what ? "" : wordsFrom(loc.pathname);
  const btn = "inline-flex h-10 items-center gap-2 rounded-full px-5 text-[0.88rem] transition-colors";
  return (
    <div className={cx("relative flex flex-col items-center justify-center overflow-hidden bg-black px-6 text-center", standalone ? "min-h-full" : "h-full")}>
      <LostOrbit className="pointer-events-none absolute inset-0 h-full w-full opacity-90" />

      {standalone && (
        <Link to="/" className="absolute left-6 top-5 z-10 text-[0.82rem] tracking-[0.3em] text-white/90">ORBITAL</Link>
      )}
      <div className="relative z-10 mt-[30vh] max-w-[560px] pb-10">
        <div className="font-mono text-[0.74rem] uppercase tracking-[0.3em] text-mute">{what ? `${what} not found` : "404 · Lost in orbit"}</div>
        <h1 className="mt-4 text-[clamp(2rem,4.5vw,3rem)] font-light leading-[1.08] tracking-[-0.025em] text-white">
          {what ? `This ${what} has left orbit.` : "This page drifted out of orbit."}
        </h1>
        <p className="mx-auto mt-4 max-w-[46ch] text-[0.95rem] leading-relaxed text-mute-bright">
          {what
            ? `It may have been deleted, or it belongs to a workspace you're not in right now.`
            : <>Nothing lives at <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-white/85">{loc.pathname.length > 48 ? `${loc.pathname.slice(0, 45)}…` : loc.pathname}</code>. The link may be mistyped, or the page has moved.</>}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {user ? (
            <>
              <Link to={back?.to ?? "/"} className={cx(btn, "bg-white text-black hover:bg-white/90")}>{back?.label ?? "Back to Orbital"}</Link>
              <Link to={words ? `/search?q=${encodeURIComponent(words)}` : "/search"} className={cx(btn, "border border-white/20 text-white hover:border-white/50")}>
                <Search size={14} />{words ? `Search for “${words}”` : "Search everything"}
              </Link>
            </>
          ) : (
            <>
              <Link to="/" className={cx(btn, "bg-white text-black hover:bg-white/90")}>Go to Orbital</Link>
              <Link to="/login" className={cx(btn, "border border-white/20 text-white hover:border-white/50")}>Sign in</Link>
            </>
          )}
          {window.history.length > 1 && (
            <button onClick={() => navigate(-1)} className={cx(btn, "text-mute hover:text-white")}><ArrowLeft size={14} />Go back</button>
          )}
        </div>
      </div>
    </div>
  );
}
