/**
 * Procedural anatomical point cloud: a human head (side profile, facing +x) with a brain,
 * built entirely from individually sampled particles in 3D. No meshes, lines or images.
 *
 * Coordinate space: x → face direction, y ↑, z depth. Head spans roughly y ∈ [-1.9, 1.0].
 */

export const CLUSTERS = {
  prefrontal: 0, frontal: 1, parietal: 2, occipital: 3, temporal: 4, cerebellum: 5, deep: 6, body: 7,
} as const;

/** Centroids per cluster, used for "connecting" and "researching" animations. */
export const CLUSTER_CENTROIDS: [number, number, number][] = [
  [0.48, 0.42, 0], [0.22, 0.72, 0], [-0.2, 0.78, 0], [-0.58, 0.4, 0], [0.12, 0.12, 0.3], [-0.43, 0.1, 0], [-0.05, 0.42, 0], [0, -0.6, 0],
];

export const BRAIN_CENTER: [number, number, number] = [-0.05, 0.45, 0];

// Side-profile silhouette (clockwise from crown), hand-placed from standard anatomical proportions.
const PROFILE: [number, number][] = [
  [0.0, 1.0], [0.22, 0.98], [0.42, 0.92], [0.57, 0.81], [0.68, 0.64], [0.75, 0.45], [0.78, 0.32],
  [0.8, 0.24], [0.78, 0.18], [0.77, 0.13], [0.81, 0.05], [0.87, -0.04], [0.93, -0.11], [0.95, -0.15],
  [0.9, -0.19], [0.84, -0.2], [0.82, -0.24], [0.84, -0.29], [0.81, -0.32], [0.78, -0.34], [0.81, -0.37],
  [0.8, -0.41], [0.75, -0.45], [0.76, -0.5], [0.79, -0.57], [0.76, -0.64], [0.68, -0.68], [0.55, -0.7],
  [0.43, -0.74], [0.38, -0.85], [0.37, -1.0], [0.39, -1.15], [0.46, -1.3], [0.68, -1.43], [0.95, -1.55],
  [1.12, -1.7], [1.2, -1.95], [-1.35, -1.95], [-1.28, -1.68], [-1.05, -1.5], [-0.72, -1.38], [-0.5, -1.2],
  [-0.44, -1.0], [-0.43, -0.82], [-0.5, -0.62], [-0.62, -0.42], [-0.75, -0.2], [-0.82, 0.05], [-0.82, 0.3],
  [-0.74, 0.55], [-0.6, 0.76], [-0.4, 0.92], [-0.2, 0.99],
];

// Seeded RNG so every session renders the same anatomy.
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth pseudo-noise from layered sines with fixed phases (cheap, deterministic, good enough for gyri).
const PH = Array.from({ length: 18 }, (_, i) => mulberry32(99 + i)() * Math.PI * 2);
function noise3(x: number, y: number, z: number) {
  let s = 0;
  s += Math.sin(x * 1.7 + PH[0]) * Math.sin(y * 2.3 + PH[1]) * Math.sin(z * 1.9 + PH[2]);
  s += 0.6 * Math.sin(x * 3.1 + y * 1.3 + PH[3]) * Math.sin(z * 2.9 + PH[4]);
  s += 0.5 * Math.sin(y * 3.7 + z * 1.1 + PH[5]) * Math.sin(x * 2.2 + PH[6]);
  s += 0.35 * Math.sin(x * 5.3 + PH[7]) * Math.sin(y * 4.7 + PH[8]) * Math.sin(z * 5.9 + PH[9]);
  return s / 1.6;
}
const fbm = (x: number, y: number, z: number) => noise3(x, y, z) * 0.65 + noise3(x * 2.1 + 5, y * 2.1, z * 2.1) * 0.35;

function insidePolygon(x: number, y: number) {
  let inside = false;
  for (let i = 0, j = PROFILE.length - 1; i < PROFILE.length; j = i++) {
    const [xi, yi] = PROFILE[i], [xj, yj] = PROFILE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Horizontal extent of the silhouette at height y around x: [left, right]. */
function rowExtent(x: number, y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0, j = PROFILE.length - 1; i < PROFILE.length; j = i++) {
    const [xi, yi] = PROFILE[i], [xj, yj] = PROFILE[j];
    if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
  }
  xs.sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) if (x >= xs[k] && x <= xs[k + 1]) return [xs[k], xs[k + 1]];
  return null;
}

const smooth = (a: number, b: number, t: number) => {
  const u = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/** Half-depth (z) of the body at height y: cranium → jaw → neck → shoulders. */
function halfWidth(y: number) {
  const cranium = 0.74 * Math.sqrt(Math.max(0.05, 1 - ((y - 0.28) / 1.05) ** 2));
  const neck = 0.36;
  const shoulders = 0.36 + Math.max(0, -1.28 - y) * 2.3;
  if (y > -0.62) return cranium;
  if (y > -1.2) return cranium + (neck - cranium) * smooth(-0.62, -0.85, y);
  return neck + (shoulders - neck) * smooth(-1.2, -1.5, y);
}

function zExtent(x: number, y: number) {
  const ext = rowExtent(x, y);
  if (!ext) return 0;
  const c = (ext[0] + ext[1]) / 2, h = (ext[1] - ext[0]) / 2;
  const u = (x - c) / h;
  return halfWidth(y) * Math.pow(Math.max(0, 1 - u * u), 0.55);
}

function hsv(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]] as const)[i % 6] as [number, number, number];
}


export interface PointCloud {
  count: number;
  /** First `baseCount` particles are always present; the rest are growth reserve (aBirth > 0). */
  baseCount: number;
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  seed: Float32Array;
  region: Float32Array; // 0 head surface, 1 cortex, 2 brain interior, 3 cerebellum/stem, 4 ambient
  cluster: Float32Array;
  birth: Float32Array;
  bright: Float32Array;
  /** Knowledge-graph layout each particle starts from in the intro (morphs into `position`). */
  graph: Float32Array;
  /** Faint connections: pairs of particle indices (hub spokes, local links, hub-to-hub web). */
  lines: Uint32Array;
  /** The orb each particle settles into: unit-sphere coordinates (scaled and centred in the shader). */
  orb: Float32Array;
  /** Orb colour with brightness baked in: amber top, dark equator, silver bottom. */
  orbColor: Float32Array;
}

const lerp3 = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A point of the Orbital orb and its colour. Region 4 (ambient dust) becomes a faint outer halo. */
function orbPoint(region: number, rnd: () => number): [number, number, number, number, number, number] {
  const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
  if (region === 4) {
    const r = 1.5 + rnd() * 0.9, v = 0.04 + rnd() * 0.07;
    return [sq * Math.cos(th) * r, u * r, sq * Math.sin(th) * r, v, v * 0.95, v * 0.9];
  }
  const shell = rnd() < 0.9;
  const r = shell ? 0.94 + rnd() * 0.06 : Math.cbrt(rnd()) * 0.9;
  let col: number[], b: number;
  if (u > 0.1) {
    const t = smooth(0.1, 1, u);
    col = t < 0.55 ? lerp3([1, 0.33, 0.05], [1, 0.52, 0.11], t / 0.55) : lerp3([1, 0.52, 0.11], [1, 0.8, 0.66], (t - 0.55) / 0.45);
    if (rnd() < 0.08) col = [1, 0.84, 0.3];
    b = 0.42 + 0.78 * smooth(0.08, 0.92, u);
  } else if (u < -0.1) {
    col = rnd() < 0.85 ? [0.86, 0.88, 0.93] : [1, 1, 1];
    b = 0.4 + 0.75 * smooth(-0.08, -0.92, u);
  } else {
    col = u >= 0 ? [1, 0.45, 0.12] : [0.8, 0.82, 0.88];
    b = 0.05 + rnd() * 0.05;
  }
  b *= (0.75 + rnd() * 0.25) * (shell ? 1 : 0.3);
  return [sq * Math.cos(th) * r, u * r, sq * Math.sin(th) * r, col[0] * b, col[1] * b, col[2] * b];
}

/**
 * Knowledge-graph palette: distinct, saturated clusters with white hubs — the look of a dense
 * Obsidian-style graph. Each cluster has an anatomical seed (where it lives in the brain) and a
 * position in the intro graph layout (unit disk around the brain centre).
 */
export const GRAPH_CLUSTERS: { color: string; seed: [number, number, number]; graph: [number, number] }[] = [
  { color: "#b02bff", seed: [0.52, 0.42, 0.3], graph: [0.3, -0.48] },   // purple
  { color: "#ff2bd6", seed: [0.3, 0.78, 0.25], graph: [0.55, 0.52] },   // magenta
  { color: "#ff1f2e", seed: [0.05, 0.92, 0.2], graph: [-0.55, 0.6] },   // red
  { color: "#ff5a1f", seed: [-0.3, 0.85, 0.3], graph: [-0.05, 0.74] },  // orange-red
  { color: "#2f7dff", seed: [-0.62, 0.55, 0.2], graph: [0.62, -0.18] }, // blue
  { color: "#1fd0ff", seed: [-0.55, 0.3, 0.4], graph: [-0.56, -0.36] }, // cyan
  { color: "#ffd23a", seed: [0.1, 0.18, 0.45], graph: [-0.62, 0.06] },  // yellow
  { color: "#ff9a1a", seed: [-0.2, 0.25, 0.5], graph: [-0.24, 0.12] },  // orange
  { color: "#a6ff2e", seed: [0.25, 0.55, 0.55], graph: [0.32, 0.26] },  // lime
  { color: "#2cff7a", seed: [-0.15, 0.6, 0.6], graph: [0.12, 0.02] },   // green
  { color: "#7a2cff", seed: [-0.43, 0.1, 0.2], graph: [-0.08, -0.6] },  // violet (cerebellum)
];
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const PALETTE = GRAPH_CLUSTERS.map((c) => hexRgb(c.color));
const CEREBELLUM_CLUSTER = 10;

function brainCluster(x: number, y: number, z: number, temporal: boolean): number {
  if (temporal) return CLUSTERS.temporal;
  if (x > 0.36) return CLUSTERS.prefrontal;
  if (x > 0.0 && y > 0.4) return CLUSTERS.frontal;
  if (x < -0.42) return CLUSTERS.occipital;
  if (y > 0.35) return CLUSTERS.parietal;
  return Math.abs(z) > 0.3 ? CLUSTERS.temporal : CLUSTERS.frontal;
}

/** Density multiplier: 1 = high (~72k particles). */
export function buildPointCloud(density = 1): PointCloud {
  const rnd = mulberry32(20241118);
  const pts: { p: [number, number, number]; c: [number, number, number]; s: number; r: number; k: number; b: number; br: number; ci?: number; hub?: number; g?: [number, number, number] }[] = [];
  const n = (x: number) => Math.round(x * density);

  /** Spectrum flows continuously around the brain (front magenta → crown violet/blue → back cyan/green → base yellow/orange), noise-mixed. */
  const brainColor = (k: number, x: number, y: number, z: number, interior = false): [number, number, number] => {
    if (rnd() < 0.06) return [0.95, 0.95, 1];
    let hue: number;
    if (k === CLUSTERS.cerebellum) hue = 0.985 + (rnd() - 0.5) * 0.1 + (x + 0.43) * 0.3;
    else {
      const ang = Math.atan2(y - bcy + 0.1, x - bcx); // 0 = front, π/2 = top, π = back
      hue = 0.93 - (ang / Math.PI) * 0.55;
      if (y < bcy - 0.18) hue = 0.08 + (x - bcx) * 0.12 + (bcy - 0.18 - y) * 0.2; // lower: warm band
      hue += fbm(x * 2.6, y * 2.6, z * 2.6) * 0.16 + (rnd() - 0.5) * 0.08;
    }
    if (rnd() < 0.1) hue = rnd();
    return hsv(hue, interior ? 0.5 + rnd() * 0.3 : 0.62 + rnd() * 0.33, 0.8 + rnd() * 0.2);
  };

  // ── Head, face, neck and shoulders: a sparse surface shell ──────────────────
  const shellTarget = n(15000);
  for (let made = 0, guard = 0; made < shellTarget && guard < shellTarget * 12; guard++) {
    const x = -1.35 + rnd() * 2.6, y = -1.95 + rnd() * 2.95;
    if (!insidePolygon(x, y)) continue;
    const ze = zExtent(x, y);
    // Sparser lower down: face/neck/shoulders fade, the cranium stays defined.
    const keep = y > -0.75 ? 1 : y > -1.3 ? 0.7 : 0.45 * smooth(-1.95, -1.4, y) + 0.12;
    if (rnd() > keep) continue;
    const z = (rnd() < 0.5 ? -1 : 1) * ze * (0.96 + rnd() * 0.04);
    const v = 0.55 + rnd() * 0.45;
    const tint = rnd();
    const col: [number, number, number] = tint < 0.82 ? [0.78 * v, 0.84 * v, 0.98 * v] : hsv(0.55 + rnd() * 0.3, 0.45, v);
    pts.push({ p: [x, y, z], c: col, s: 0.7 + rnd() * 0.9, r: 0, k: CLUSTERS.body, b: 0, br: 0.42 + rnd() * 0.35 });
    made++;
  }
  // Silhouette edge: particles along the profile outline make the face read clearly.
  const edgeTarget = n(6000);
  const segLens = PROFILE.map((p, i) => Math.hypot(PROFILE[(i + 1) % PROFILE.length][0] - p[0], PROFILE[(i + 1) % PROFILE.length][1] - p[1]));
  const totalLen = segLens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < edgeTarget; i++) {
    let t = rnd() * totalLen, s = 0;
    while (t > segLens[s]) t -= segLens[s++];
    const [x0, y0] = PROFILE[s], [x1, y1] = PROFILE[(s + 1) % PROFILE.length];
    const f = t / segLens[s];
    const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
    if (y < -1.9) continue; // no line along the bottom crop
    const fade = y > -0.75 ? 1 : 0.35 + 0.65 * smooth(-1.9, -0.75, y);
    if (rnd() > fade) continue;
    const z = (rnd() - 0.5) * 0.16;
    const v = 0.7 + rnd() * 0.3;
    pts.push({ p: [x + (rnd() - 0.5) * 0.012, y + (rnd() - 0.5) * 0.012, z], c: [0.82 * v, 0.88 * v, 1 * v], s: 0.8 + rnd() * 1.0, r: 0, k: CLUSTERS.body, b: 0, br: 0.6 + rnd() * 0.35 });
  }
  // Ear and eye rings: small anatomical landmarks on both sides.
  const ring = (cx: number, cy: number, rx: number, ry: number, count: number, fill: number) => {
    for (let i = 0; i < n(count); i++) {
      const a = rnd() * Math.PI * 2, rr = rnd() < fill ? Math.sqrt(rnd()) : 0.92 + rnd() * 0.08;
      const x = cx + Math.cos(a) * rx * rr, y = cy + Math.sin(a) * ry * rr;
      const side = rnd() < 0.5 ? -1 : 1;
      const z = side * (zExtent(x, y) + 0.015);
      const v = 0.65 + rnd() * 0.35;
      pts.push({ p: [x, y, z], c: [0.8 * v, 0.86 * v, v], s: 0.8 + rnd() * 0.8, r: 0, k: CLUSTERS.body, b: 0, br: 0.65 + rnd() * 0.3 });
    }
  };
  ring(-0.12, -0.02, 0.09, 0.17, 1100, 0.3);
  ring(-0.12, -0.03, 0.05, 0.1, 400, 0.0);
  ring(0.63, 0.12, 0.075, 0.032, 420, 0.15);
  ring(0.645, 0.12, 0.022, 0.022, 160, 0.6);

  // Sparse volume inside head/neck for depth.
  for (let i = 0, made = 0; made < n(1800) && i < 40000; i++) {
    const x = -1.2 + rnd() * 2.2, y = -1.9 + rnd() * 2.9;
    if (!insidePolygon(x, y)) continue;
    const z = (rnd() * 2 - 1) * zExtent(x, y) * 0.9;
    pts.push({ p: [x, y, z], c: [0.5, 0.56, 0.72], s: 0.6 + rnd() * 0.6, r: 0, k: CLUSTERS.body, b: 0, br: 0.18 + rnd() * 0.15 });
    made++;
  }

  // ── Brain ───────────────────────────────────────────────────────────────────
  const [bcx, bcy] = BRAIN_CENTER;
  const R = [0.66, 0.46, 0.57];
  const pushBrain = (x: number, y: number, z: number, region: number, k: number, birth: number, interior = false) => {
    const big = rnd() < 0.025;
    pts.push({
      p: [x, y, z], c: brainColor(k, x, y, z, interior), s: big ? 2.2 + rnd() * 1.6 : 0.75 + rnd() * 1.05, r: region, k, b: birth,
      br: interior ? 0.32 + rnd() * 0.25 : 0.5 + rnd() * 0.42,
    });
  };

  /** Cortex surface sample with gyri: density concentrates on noise ridges, radial offset follows them. */
  const cortexSample = (birth: number) => {
    for (;;) {
      const temporal = rnd() < 0.12;
      let cx = bcx, cy = bcy, cz = 0, rx = R[0], ry = R[1], rz = R[2];
      if (temporal) { cx = 0.04; cy = 0.16; cz = (rnd() < 0.5 ? -1 : 1) * 0.36; rx = 0.38; ry = 0.17; rz = 0.17; }
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
      const d = [sq * Math.cos(th), u, sq * Math.sin(th)];
      if (!temporal && d[1] < -0.55) continue; // flattened base of the cerebrum
      const g = fbm(d[0] * 6.5 + cx * 3, d[1] * 6.5 + cy * 3, d[2] * 6.5 + cz * 3);
      const ridge = 1 - Math.abs(g); // sulci are the zero-crossings: thin dark grooves
      if (rnd() > 0.08 + 0.92 * smooth(0.55, 0.95, ridge)) continue;
      const depth = 1 + (ridge - 0.75) * 0.08 - rnd() * 0.025;
      const x = cx + d[0] * rx * depth, y = cy + d[1] * ry * depth, z = cz + d[2] * rz * depth;
      if (!temporal && Math.abs(z) < 0.028 && y > bcy - 0.05) continue; // longitudinal fissure
      if (!insidePolygon(x, y)) continue;
      pushBrain(x, y, z, 1, brainCluster(x, y, z, temporal), birth);
      return;
    }
  };

  const cortexBase = n(30000);
  for (let i = 0; i < cortexBase; i++) cortexSample(0);

  // Interior (white matter): dimmer volume.
  for (let i = 0, made = 0; made < n(7000) && i < 200000; i++) {
    const x = (rnd() * 2 - 1), y = (rnd() * 2 - 1), z = (rnd() * 2 - 1);
    if (x * x + y * y + z * z > 1) continue;
    const px = bcx + x * R[0] * 0.9, py = bcy + y * R[1] * 0.88, pz = z * R[2] * 0.9;
    if (y < -0.6) continue;
    pushBrain(px, py, pz, 2, rnd() < 0.5 ? CLUSTERS.deep : brainCluster(px, py, pz, false), 0, true);
    made++;
  }

  // Cerebellum: finely striated (folia) density.
  for (let i = 0, made = 0; made < n(5500) && i < 200000; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u);
    const d = [sq * Math.cos(th), u, sq * Math.sin(th)];
    const r = rnd() < 0.55 ? 0.88 + rnd() * 0.12 : Math.cbrt(rnd()) * 0.9;
    const x = -0.43 + d[0] * 0.23 * r, y = 0.1 + d[1] * 0.13 * r, z = d[2] * 0.36 * r;
    if (Math.sin((y - 0.1) * 150 + d[0] * 9 + d[2] * 4) < -0.55) continue;
    pushBrain(x, y, z, 3, CLUSTERS.cerebellum, 0, r < 0.85);
    made++;
  }
  // Brainstem.
  for (let i = 0; i < n(1500); i++) {
    const t = rnd(), a = rnd() * Math.PI * 2, rr = 0.085 * Math.sqrt(rnd());
    const x = -0.16 - t * 0.13 + Math.cos(a) * rr, y = 0.16 - t * 0.68, z = Math.sin(a) * rr;
    pushBrain(x, y, z, 3, CLUSTERS.deep, 0, true);
  }

  // Ambient dust around the figure: barely-visible depth cue.
  for (let i = 0; i < n(1600); i++) {
    const x = -2.4 + rnd() * 4.8, y = -2 + rnd() * 3.6, z = -1.8 + rnd() * 3.6;
    if (insidePolygon(x, y) && Math.abs(z) < zExtent(x, y) + 0.1) continue;
    const c = rnd() < 0.7 ? [0.6, 0.65, 0.8] as [number, number, number] : hsv(rnd(), 0.6, 0.9);
    pts.push({ p: [x, y, z], c, s: 0.5 + rnd() * 0.7, r: 4, k: CLUSTERS.body, b: 0, br: 0.08 + rnd() * 0.12 });
  }

  // Cluster hubs: one bright main hub per cluster plus satellites — the white stars of the graph.
  GRAPH_CLUSTERS.forEach((cl, k) => {
    const [sx, sy, sz] = cl.seed;
    for (let h = 0; h < 4; h++) {
      const side = h % 2 ? -1 : 1, j = h === 0 ? 0 : 0.1;
      pts.push({ p: [sx + (rnd() - 0.5) * j, sy + (rnd() - 0.5) * j, side * sz + (rnd() - 0.5) * j], c: [1, 1, 1], s: h === 0 ? 5 : 3.2, r: 1, k: brainCluster(sx, sy, sz, false), b: 0, br: 1, ci: k, hub: h === 0 ? 2 : 1 });
    }
  });

  const baseCount = pts.length;
  // Growth reserve: cortex particles revealed as knowledge accumulates (aBirth ∈ (0,1] = reveal order).
  const reserve = n(16000);
  for (let i = 0; i < reserve; i++) cortexSample(0.0001 + rnd());

  // ── Knowledge-graph colouring and intro layout ─────────────────────────────
  const nearestCluster = (x: number, y: number, z: number) => {
    let best = 0, bd = Infinity;
    const warp = fbm(x * 3.1 + 7, y * 3.1, z * 3.1) * 0.1;
    GRAPH_CLUSTERS.forEach((c, k) => {
      if (k === CEREBELLUM_CLUSTER) return;
      const d = Math.hypot(x - c.seed[0], y - c.seed[1], Math.abs(z) - c.seed[2]) + warp * ((k % 3) - 1);
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const GR = 1.15;
  const toGraph = (gx: number, gy: number, gz: number): [number, number, number] => [bcx + gx * GR, bcy + gy * GR, gz * GR];
  const coreMembers: number[] = [];
  pts.forEach((q, i) => {
    const isBrain = q.r >= 1 && q.r <= 3;
    if (isBrain && q.hub === undefined) {
      const ci = q.r === 3 && q.k === CLUSTERS.cerebellum ? CEREBELLUM_CLUSTER : nearestCluster(q.p[0], q.p[1], q.p[2]);
      q.ci = ci;
      const roll = rnd();
      const base = roll < 0.05 ? [1, 1, 1] : roll < 0.12 ? PALETTE[Math.floor(rnd() * PALETTE.length)] : PALETTE[ci];
      const v = q.r === 2 ? 0.6 + rnd() * 0.3 : 0.78 + rnd() * 0.22;
      q.c = [base[0] * v, base[1] * v, base[2] * v];
    }
    // Where this particle sits in the intro graph.
    if (isBrain) {
      const ci = q.ci!;
      const [cx, cy] = GRAPH_CLUSTERS[ci].graph;
      if (q.hub === 2) q.g = toGraph(cx, cy, 0);
      else if (q.hub === 1) q.g = toGraph(cx + gauss() * 0.06, cy + gauss() * 0.06, gauss() * 0.06);
      else if (rnd() < 0.09) { q.g = toGraph(gauss() * 0.15, gauss() * 0.15, gauss() * 0.18); if (q.b === 0) coreMembers.push(i); }
      else q.g = toGraph(cx + gauss() * 0.13, cy + gauss() * 0.13, gauss() * 0.2);
    } else if (q.r === 0) {
      if (rnd() < 0.55) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u), rr = 1.02 + rnd() * 0.22;
        q.g = toGraph(sq * Math.cos(th) * rr, u * rr, sq * Math.sin(th) * rr * 0.6);
      } else {
        const c = GRAPH_CLUSTERS[Math.floor(rnd() * GRAPH_CLUSTERS.length)].graph;
        q.g = toGraph(c[0] + gauss() * 0.3, c[1] + gauss() * 0.3, gauss() * 0.3);
      }
    } else {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, sq = Math.sqrt(1 - u * u), rr = 1.4 + rnd() * 0.9;
      q.g = toGraph(sq * Math.cos(th) * rr, u * rr, sq * Math.sin(th) * rr);
    }
  });

  // Connections (pre-shuffle indices): hub spokes, local nearest-neighbour links, hub web, core web.
  const members: number[][] = GRAPH_CLUSTERS.map(() => []);
  const hubs: { i: number; ci: number; main: boolean }[] = [];
  pts.forEach((q, i) => {
    if (q.hub !== undefined) hubs.push({ i, ci: q.ci!, main: q.hub === 2 });
    else if (q.ci !== undefined && q.b === 0 && q.r !== 2) members[q.ci].push(i);
  });
  const segs: number[] = [];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  for (const h of hubs) {
    const pool = members[h.ci];
    if (!pool.length) continue;
    for (let s2 = 0, n2 = n(h.main ? 80 : 26); s2 < n2; s2++) segs.push(h.i, pick(pool));
  }
  for (const pool of members) {
    if (pool.length < 3) continue;
    const sample = Array.from({ length: Math.min(pool.length, n(380)) }, () => pick(pool));
    for (const a of sample) {
      let b1 = -1, b2 = -1, d1 = Infinity, d2 = Infinity;
      const pa = pts[a].p;
      for (const b of sample) {
        if (b === a) continue;
        const pb = pts[b].p;
        const d = (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2;
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = b; } else if (d < d2) { d2 = d; b2 = b; }
      }
      if (b1 >= 0) segs.push(a, b1);
      if (b2 >= 0 && rnd() < 0.6) segs.push(a, b2);
    }
  }
  const mains = hubs.filter((h) => h.main);
  for (let a = 0; a < mains.length; a++) for (let b = a + 1; b < mains.length; b++) segs.push(mains[a].i, mains[b].i);
  for (let c = 0; c < n(260) && coreMembers.length > 1; c++) segs.push(pick(coreMembers), pick(mains).i);

  const count = pts.length;
  const out: PointCloud = {
    count, baseCount,
    position: new Float32Array(count * 3), color: new Float32Array(count * 3), size: new Float32Array(count),
    seed: new Float32Array(count), region: new Float32Array(count), cluster: new Float32Array(count),
    birth: new Float32Array(count), bright: new Float32Array(count),
    graph: new Float32Array(count * 3), lines: new Uint32Array(0),
    orb: new Float32Array(count * 3), orbColor: new Float32Array(count * 3),
  };
  // Shuffle so any prefix (adaptive draw range) is a uniform subsample of the base set.
  const order = shuffled(baseCount, rnd).concat(Array.from({ length: count - baseCount }, (_, i) => baseCount + i));
  order.forEach((src, i) => {
    const q = pts[src];
    out.position.set(q.p, i * 3);
    out.color.set(q.c, i * 3);
    out.size[i] = q.s;
    out.seed[i] = rnd();
    out.region[i] = q.r;
    out.cluster[i] = q.k;
    out.birth[i] = q.b;
    out.bright[i] = q.br;
    out.graph.set(q.g ?? q.p, i * 3);
    const o = orbPoint(q.r, rnd);
    out.orb.set([o[0], o[1], o[2]], i * 3);
    out.orbColor.set([o[3], o[4], o[5]], i * 3);
  });
  const newIndex = new Uint32Array(count);
  order.forEach((src, i) => { newIndex[src] = i; });
  out.lines = Uint32Array.from(segs, (src) => newIndex[src]);
  return out;
}

function shuffled(n: number, rnd: () => number) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
