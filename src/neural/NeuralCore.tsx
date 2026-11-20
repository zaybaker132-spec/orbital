import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { BRAIN_CENTER, buildPointCloud, CLUSTER_CENTROIDS, type PointCloud } from "./geometry";
import { fragmentShader, lineFragmentShader, lineVertexShader, vertexShader } from "./shaders";
import { useCore, type CoreState } from "@/state/core";
import { useMotionPrefs } from "@/state/app";
import { isLight, useLightTheme } from "@/lib/theme";
import { useEnvironment } from "@/state/environment";
import { CORE_PALETTE_STOPS, type CorePalette } from "../../shared/environment";

type Density = "low" | "medium" | "high";
const DENSITY: Record<Density, number> = { low: 0.35, medium: 0.65, high: 1 };
const cache = new Map<string, PointCloud>();
const getCloud = (d: Density, palette: CorePalette = "spectrum") => {
  if (!cache.has(d)) cache.set(d, buildPointCloud(DENSITY[d]));
  const base = cache.get(d)!;
  if (palette === "spectrum") return base;
  const key = `${d}:${palette}`;
  if (!cache.has(key)) cache.set(key, { ...base, color: recolour(base.color, palette), orbColor: recolour(base.orbColor, palette) });
  return cache.get(key)!;
};

/**
 * A Neural Core colour scheme (Settings → Your environment): each speck keeps its brightness and how
 * saturated it is, and its hue is mapped onto the scheme's colours, so the orb's structure stays the same.
 */
function recolour(src: Float32Array, palette: Exclude<CorePalette, "spectrum">) {
  const stops = CORE_PALETTE_STOPS[palette].map((h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max <= 0) continue;
    const d = max - min, sat = d / max;
    let h = 0;
    if (d > 0) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const t = (h / 6) * stops.length, k = Math.floor(t) % stops.length, f = t - Math.floor(t);
    const a = stops[k], c = stops[(k + 1) % stops.length];
    for (let j = 0; j < 3; j++) {
      const target = a[j] + (c[j] - a[j]) * f;
      out[i + j] = (1 - sat + sat * target) * max; // greys and whites stay; colours take the scheme's
    }
  }
  return out;
}

/** Line geometry: each segment endpoint carries its particle's attributes so lines move with particles. */
const lineCache = new WeakMap<PointCloud, THREE.BufferGeometry>();
function buildLines(cloud: PointCloud) {
  const cached = lineCache.get(cloud);
  if (cached) return cached;
  const n = cloud.lines.length;
  const copy = (src: Float32Array, size: number) => {
    const out = new Float32Array(n * size);
    for (let v = 0; v < n; v++) for (let k = 0; k < size; k++) out[v * size + k] = src[cloud.lines[v] * size + k];
    return out;
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(copy(cloud.position, 3), 3));
  g.setAttribute("aGraph", new THREE.BufferAttribute(copy(cloud.graph, 3), 3));
  g.setAttribute("aOrb", new THREE.BufferAttribute(copy(cloud.orb, 3), 3));
  g.setAttribute("aOrbColor", new THREE.BufferAttribute(copy(cloud.orbColor, 3), 3));
  g.setAttribute("color", new THREE.BufferAttribute(copy(cloud.color, 3), 3));
  for (const [name, arr] of [["aSize", cloud.size], ["aSeed", cloud.seed], ["aRegion", cloud.region], ["aCluster", cloud.cluster], ["aBirth", cloud.birth], ["aBright", cloud.bright]] as const) {
    g.setAttribute(name, new THREE.BufferAttribute(copy(arr, 1), 1));
  }
  const end = new Float32Array(n), lseed = new Float32Array(n);
  for (let v = 0; v < n; v += 2) { end[v + 1] = 1; lseed[v] = lseed[v + 1] = ((v * 0.6180339887) % 1); }
  g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
  g.setAttribute("aLineSeed", new THREE.BufferAttribute(lseed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.4, 0), 3);
  lineCache.set(cloud, g);
  return g;
}

/** Map a brain-space cluster centroid onto the orb's surface (or keep it, for the brain). */
const _v = new THREE.Vector3();
function effectPoint(c: [number, number, number], u: Record<string, THREE.IUniform>) {
  if (u.uOrbMode.value < 0.5) return _v.set(...c);
  const dir = new THREE.Vector3(c[0] - BRAIN_CENTER[0], c[1] - BRAIN_CENTER[1], c[2] - BRAIN_CENTER[2]);
  if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
  dir.normalize().multiplyScalar(u.uOrbRadius.value * 0.9);
  return _v.set(BRAIN_CENTER[0], BRAIN_CENTER[1], BRAIN_CENTER[2]).add(u.uGraphOffset.value).add(dir);
}

/** The formation intro plays once per session (and on request), never with reduced motion. */
let introPlayed = (() => { try { return sessionStorage.getItem("orbital.intro") === "1"; } catch { return false; } })();
let lastNonce = 0;
const INTRO_HOLD = 1.4, INTRO_MORPH = 3.6;

export type Framing = "full" | "head";
/** The shape the core settles into: Orbital's orb (default) or the original head and brain. */
export const CORE_SHAPE: "orb" | "brain" = "orb";

const FRAMING: Record<Framing, { camZ: number; y: number; scale: number; orb: number }> = {
  full: { camZ: 6.9, y: 0.42, scale: 1.25, orb: 1.12 },
  head: { camZ: 4.1, y: -0.2, scale: 0.95, orb: 0.68 },
};

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function initialDensity(pref: string): Density {
  if (pref === "low" || pref === "medium" || pref === "high") return pref;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as any).deviceMemory ?? 8;
  if (cores <= 4 || mem <= 4) return "medium";
  return "high";
}

/** `holdGraph`: stay in knowledge-graph form (slowly orbiting) until it turns false, then form the brain. */
interface Props { framing?: Framing; className?: string; interactive?: boolean; label?: string; holdGraph?: boolean }

export function NeuralCore({ framing = "full", className = "", interactive = true, label = "Neural Core: a particle orb that grows with your knowledge", holdGraph = false }: Props) {
  const { reducedMotion, density: densityPref } = useMotionPrefs();
  const [supported] = useState(webglAvailable);
  const [density, setDensity] = useState<Density>(() => initialDensity(densityPref));
  const [contextLost, setContextLost] = useState(false);
  useEffect(() => setDensity(initialDensity(densityPref)), [densityPref]);

  const light = useLightTheme();
  const palette = useEnvironment().corePalette;
  if (!supported || contextLost) return <FallbackCore className={className} reducedMotion={reducedMotion} framing={framing} label={label} />;

  const f = FRAMING[framing];
  return (
    <div className={/\b(absolute|fixed|relative)\b/.test(className) ? className : `relative ${className}`} role="img" aria-label={label}>
      <Canvas
        key={light ? "light" : "dark"}
        dpr={[1, density === "low" ? 1.25 : 2]}
        gl={{ antialias: false, alpha: light, powerPreference: "high-performance", preserveDrawingBuffer: false }}
        camera={{ position: [0, 0, f.camZ], fov: 34, near: 0.1, far: 50 }}
        onCreated={({ gl }) => {
          // Dark: particles add light onto black (a glow). Light: a see-through canvas over the page,
          // with particles painted normally, since adding light onto white would wash them out.
          gl.setClearColor("#000000", light ? 0 : 1);
          gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setContextLost(true); });
        }}
      >
        <Particles
          key={density}
          cloud={getCloud(density, palette)}
          framing={framing}
          interactive={interactive}
          motion={reducedMotion ? 0 : 1}
          holdGraph={holdGraph}
          light={light}
          onSlow={() => densityPref === "auto" && setDensity((d) => (d === "high" ? "medium" : d === "medium" ? "low" : d))}
        />
      </Canvas>
    </div>
  );
}

const STATES: Exclude<CoreState, "idle">[] = ["thinking", "researching", "learning", "connecting", "opportunity"];

function Particles({ cloud, framing, interactive, motion, onSlow, holdGraph, light }: { cloud: PointCloud; framing: Framing; interactive: boolean; motion: number; onSlow: () => void; holdGraph: boolean; light: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { size, camera, gl, raycaster, pointer } = useThree();

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.position, 3));
    g.setAttribute("color", new THREE.BufferAttribute(cloud.color, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(cloud.size, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(cloud.seed, 1));
    g.setAttribute("aRegion", new THREE.BufferAttribute(cloud.region, 1));
    g.setAttribute("aCluster", new THREE.BufferAttribute(cloud.cluster, 1));
    g.setAttribute("aBirth", new THREE.BufferAttribute(cloud.birth, 1));
    g.setAttribute("aBright", new THREE.BufferAttribute(cloud.bright, 1));
    g.setAttribute("aGraph", new THREE.BufferAttribute(cloud.graph, 3));
    g.setAttribute("aOrb", new THREE.BufferAttribute(cloud.orb, 3));
    g.setAttribute("aOrbColor", new THREE.BufferAttribute(cloud.orbColor, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.4, 0), 3);
    return g;
  }, [cloud]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 }, uPixelRatio: { value: 1 }, uScale: { value: 9 }, uMotion: { value: 1 }, uMorph: { value: 1 }, uSpin: { value: 0 }, uLineAlpha: { value: 0.028 }, uGraphOffset: { value: new THREE.Vector3() }, uGraphScale: { value: 1 }, uOrbMode: { value: CORE_SHAPE === "orb" ? 1 : 0 }, uLight: { value: light ? 1 : 0 }, uOrbRadius: { value: 1 }, uOrbSpin: { value: 0 },
          uMouse: { value: new THREE.Vector3(99, 99, 0) }, uMouseStrength: { value: 0 },
          uRipples: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -99)) },
          uActivity: { value: 0 }, uThinking: { value: 0 }, uResearch: { value: 0 }, uLearning: { value: 0 },
          uConnecting: { value: 0 }, uOpportunity: { value: 0 }, uResearchPhase: { value: 0 },
          uConnectA: { value: new THREE.Vector3() }, uConnectB: { value: new THREE.Vector3() }, uPulseX: { value: -2 },
          uLobeGrowth: { value: new Array(8).fill(0) }, uHighlight: { value: new Array(8).fill(0) },
        },
      }),
    [],
  );

  const lineGeometry = useMemo(() => buildLines(cloud), [cloud]);
  // Lines share every uniform with the particles (same object), so both animate identically.
  const lineMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: lineVertexShader, fragmentShader: lineFragmentShader, uniforms: material.uniforms,
    transparent: true, depthWrite: false, depthTest: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
  }), [material, light]);
  useEffect(() => () => { lineMaterial.dispose(); }, [lineMaterial]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);

  // Formation intro: start as a knowledge graph, stream into the brain.
  const intro = useRef<{ start: number | null }>({ start: null });
  const introNonce = useCore((s) => s.introNonce);
  useEffect(() => {
    if (holdGraph) return; // the graph is held; formation happens when it's released
    if (motion && (!introPlayed || introNonce !== lastNonce)) {
      lastNonce = introNonce;
      intro.current.start = -1; // resolved to clock time on the next frame
      introPlayed = true;
      try { sessionStorage.setItem("orbital.intro", "1"); } catch { /* ignore */ }
      material.uniforms.uMorph.value = 0;
    }
  }, [introNonce, motion, material, holdGraph]);

  // Held graph: stays a knowledge graph; on release it forms the brain straight away.
  const held = useRef(holdGraph);
  const spinOffset = useRef(0);
  useEffect(() => {
    if (held.current && !holdGraph) intro.current.start = motion ? -2 : null;
    if (!holdGraph && !motion) material.uniforms.uMorph.value = 1;
    held.current = holdGraph;
  }, [holdGraph, motion, material]);
  useEffect(() => () => { material.dispose(); }, [material]);

  // Pointer tracking + click ripples (on the canvas element).
  const hover = useRef(false);
  const rippleIdx = useRef(0);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    if (!interactive) return;
    const el = gl.domElement;
    const enter = () => (hover.current = true);
    const leave = () => (hover.current = false);
    const down = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit) && group.current) {
        const local = group.current.worldToLocal(hit.clone());
        const slot = material.uniforms.uRipples.value[rippleIdx.current++ % 4] as THREE.Vector4;
        slot.set(local.x, local.y, local.z, material.uniforms.uTime.value);
      }
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
    };
  }, [interactive, gl, camera, raycaster, plane, hit, material]);

  // Eased animation state.
  const eased = useRef<Record<string, number>>({ thinking: 0, researching: 0, learning: 0, connecting: 0, opportunity: 0 });
  const growth = useRef(new Array(8).fill(0));
  const mouseSmooth = useRef(new THREE.Vector3(99, 99, 0));
  const parallax = useRef(new THREE.Vector2());
  const connect = useRef({ until: 0, a: 0, b: 1 });
  const pulse = useRef({ start: -99 });
  const perf = useRef({ frames: 0, acc: 0, checked: false });
  const f = FRAMING[framing];

  useFrame((state, dt) => {
    const u = material.uniforms;
    const t = state.clock.elapsedTime;
    const step = Math.min(dt, 0.05);
    u.uTime.value = t;
    u.uPixelRatio.value = gl.getPixelRatio();
    // Normalised by camera distance so dot size stays tiny regardless of framing.
    u.uScale.value = 9.5 * (f.camZ / 6.9) * 0.92 * Math.max(0.55, Math.min(1.35, size.height / 860));
    u.uMotion.value += (motion - u.uMotion.value) * Math.min(1, step * 3);
    // Centre the intro graph on screen for this framing.
    u.uGraphOffset.value.set(0.05, -f.y - 0.45, 0);
    u.uGraphScale.value = f.scale;
    u.uOrbRadius.value = f.orb;
    u.uOrbSpin.value += step * 0.06 * motion; // the orb turns slowly
    if (held.current) {
      u.uMorph.value = 0;
      u.uSpin.value = t * (motion ? 0.22 : 0);
    } else if (intro.current.start !== null) {
      // -1: full intro (hold, then morph). -2: released from a held graph, morph now.
      if (intro.current.start === -2) { intro.current.start = t - INTRO_HOLD; spinOffset.current = u.uSpin.value - INTRO_HOLD * 0.45; }
      else if (intro.current.start < 0) { intro.current.start = t; spinOffset.current = 0; }
      const it = t - intro.current.start;
      u.uMorph.value = Math.min(1, Math.max(0, (it - INTRO_HOLD) / INTRO_MORPH));
      u.uSpin.value = spinOffset.current + it * 0.45;
      if (it > INTRO_HOLD + INTRO_MORPH + 0.5) { intro.current.start = null; u.uMorph.value = 1; }
    }

    // Real application state → eased uniform weights.
    const core = useCore.getState();
    const now = Date.now();
    const current = core.current();
    for (const s of STATES) {
      const exp = core.active[s];
      const target = exp && exp > now && (s === current || s === "researching") ? 1 : 0;
      eased.current[s] += (target - eased.current[s]) * Math.min(1, step * (target ? 2.2 : 1.1));
    }
    const e = eased.current;
    u.uThinking.value = e.thinking;
    u.uResearch.value = e.researching;
    u.uLearning.value = e.learning;
    u.uConnecting.value = e.connecting;
    u.uOpportunity.value = e.opportunity;
    u.uActivity.value = Math.min(1, e.thinking + e.researching * 0.8 + e.connecting * 0.6 + e.learning * 0.5 + e.opportunity * 0.6);
    u.uResearchPhase.value = (t * 0.9) % 6;

    // Knowledge growth per region (reveals reserve particles).
    for (let i = 0; i < 8; i++) {
      const target = 0.04 + 0.96 * (1 - Math.exp(-core.lobeCounts[i] / 30));
      growth.current[i] += (target - growth.current[i]) * Math.min(1, step * 0.6);
      u.uLobeGrowth.value[i] = growth.current[i];
    }

    // Connecting: cycle through cluster pairs.
    if (t > connect.current.until) {
      const a = Math.floor(Math.random() * 6);
      let b = Math.floor(Math.random() * 6);
      if (b === a) b = (a + 2) % 6;
      connect.current = { until: t + 2.2, a, b };
      u.uConnectA.value.copy(effectPoint(CLUSTER_CENTROIDS[a], u));
      u.uConnectB.value.copy(effectPoint(CLUSTER_CENTROIDS[b], u));
    }
    // Opportunity pulse: one sweep back→front every 2.6s while active.
    if (e.opportunity > 0.05 && t - pulse.current.start > 2.6) pulse.current.start = t;
    const pt = (t - pulse.current.start) / 1.6;
    // Opportunity pulse sweeps across whichever shape is showing.
    const span = CORE_SHAPE === "orb" ? u.uOrbRadius.value * 1.05 : 0.9;
    u.uPulseX.value = pt <= 1 ? -span + pt * span * 2 : -3;
    for (let i = 0; i < 8; i++) {
      const hl = (e.opportunity > 0.05 && (i === 0 || i === 1)) || (e.connecting > 0.05 && (i === connect.current.a || i === connect.current.b)) ? 1 : 0;
      u.uHighlight.value[i] += (hl - u.uHighlight.value[i]) * Math.min(1, step * 3);
    }

    // Cursor: smoothed position and strength → gentle repulsion and reorganisation.
    if (interactive && hover.current && group.current) {
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const local = group.current.worldToLocal(hit.clone());
        if (mouseSmooth.current.x > 50) mouseSmooth.current.copy(local);
        mouseSmooth.current.lerp(local, Math.min(1, step * 8));
      }
    }
    u.uMouse.value.copy(mouseSmooth.current);
    u.uMouseStrength.value += ((interactive && hover.current ? 1 : 0) - u.uMouseStrength.value) * Math.min(1, step * 2.5);

    // Subtle depth parallax; the profile stays recognisable.
    if (group.current) {
      const px = interactive && hover.current ? pointer.x : 0, py = interactive && hover.current ? pointer.y : 0;
      parallax.current.x += (px - parallax.current.x) * Math.min(1, step * 1.5);
      parallax.current.y += (py - parallax.current.y) * Math.min(1, step * 1.5);
      const sway = motion ? Math.sin(t * 0.13) * 0.06 : 0;
      group.current.rotation.y = -0.16 + parallax.current.x * 0.14 + sway;
      group.current.rotation.x = -parallax.current.y * 0.05;
      group.current.position.y = f.y;
    }

    // Frame-rate awareness: step density down if sustained frame time is poor.
    const p = perf.current;
    if (!p.checked && t > 2) {
      p.frames++;
      p.acc += dt;
      if (p.frames >= 120) {
        p.checked = true;
        if (p.acc / p.frames > 1 / 40) onSlow();
      }
    }
  });

  return (
    <group ref={group}>
      <lineSegments geometry={lineGeometry} material={lineMaterial} frustumCulled={false} />
      <points geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

/** Canvas 2D fallback for systems without WebGL: same point cloud, orthographic, lightweight. */
function FallbackCore({ className, reducedMotion, framing, label }: { className: string; reducedMotion: boolean; framing: Framing; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cloud = getCloud("low");
    let raf = 0, last = 0;
    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - last < 50) return;
      last = time;
      const w = (cv.width = cv.clientWidth * devicePixelRatio), h = (cv.height = cv.clientHeight * devicePixelRatio);
      const lightBg = isLight();
      if (lightBg) ctx.clearRect(0, 0, w, h);
      else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); }
      const orb = CORE_SHAPE === "orb";
      const scale = orb ? h * 0.36 : (framing === "head" ? 0.42 : 0.27) * h;
      const oy = orb ? h * 0.5 : framing === "head" ? h * 0.42 : h * 0.4;
      const t = reducedMotion ? 0 : time / 1000;
      ctx.globalCompositeOperation = lightBg ? "source-over" : "lighter";
      for (let i = 0; i < cloud.baseCount; i++) {
        const src = orb ? cloud.orb : cloud.position;
        const x = src[i * 3], y = src[i * 3 + 1];
        const s = cloud.seed[i];
        const dx = Math.sin(t * 0.5 + s * 40) * 0.006, dy = Math.sin(t * 0.45 + s * 23) * 0.006;
        const col = orb ? cloud.orbColor : cloud.color;
        const b = orb ? 1 : cloud.bright[i];
        ctx.fillStyle = `rgba(${(col[i * 3] * 255) | 0},${(col[i * 3 + 1] * 255) | 0},${(col[i * 3 + 2] * 255) | 0},${b})`;
        const r = cloud.size[i] * devicePixelRatio * 0.6;
        ctx.fillRect(w / 2 + (x + dx) * scale - r / 2, oy - (y + dy) * scale - r / 2, r, r);
      }
      ctx.globalCompositeOperation = "source-over";
      if (reducedMotion) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, framing]);
  return <canvas ref={ref} className={`block ${className}`} role="img" aria-label={label} />;
}
