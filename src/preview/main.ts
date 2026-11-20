// Standalone Neural Core for the public preview page: the same geometry and shaders as the app,
// driven without React. Built with scripts/build-preview.mjs into one script file.
import * as THREE from "three";
import { BRAIN_CENTER, buildPointCloud, CLUSTER_CENTROIDS, type PointCloud } from "../neural/geometry";
import { fragmentShader, lineFragmentShader, lineVertexShader, vertexShader } from "../neural/shaders";

type State = "idle" | "thinking" | "researching" | "learning" | "connecting" | "opportunity";
const STATES: Exclude<State, "idle">[] = ["thinking", "researching", "learning", "connecting", "opportunity"];
const INTRO_HOLD = 1.4, INTRO_MORPH = 3.6;

function lineGeometry(cloud: PointCloud) {
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
  for (let v = 0; v < n; v += 2) { end[v + 1] = 1; lseed[v] = lseed[v + 1] = (v * 0.6180339887) % 1; }
  g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
  g.setAttribute("aLineSeed", new THREE.BufferAttribute(lseed, 1));
  return g;
}

export function mountNeuralCore(container: HTMLElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lowPower = (navigator.hardwareConcurrency || 4) <= 4 || innerWidth < 700;
  const cloud = buildPointCloud(lowPower ? 0.5 : 0.85);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
  } catch {
    container.classList.add("no-webgl");
    return null;
  }
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.25 : 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  const FR = { camZ: 6.9, y: 0.42, scale: 1.25, orb: 1.12 };
  camera.position.set(0, 0, FR.camZ);

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

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 }, uPixelRatio: { value: 1 }, uScale: { value: 9 }, uMotion: { value: reduced ? 0 : 1 },
    uMorph: { value: reduced ? 1 : 0 }, uSpin: { value: 0 }, uLineAlpha: { value: 0.028 },
    uGraphOffset: { value: new THREE.Vector3(0.05, -FR.y - 0.45, 0) }, uGraphScale: { value: FR.scale },
    uOrbMode: { value: 1 }, uLight: { value: 0 }, uOrbRadius: { value: FR.orb }, uOrbSpin: { value: 0 },
    uMouse: { value: new THREE.Vector3(99, 99, 0) }, uMouseStrength: { value: 0 },
    uRipples: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -99)) },
    uActivity: { value: 0 }, uThinking: { value: 0 }, uResearch: { value: 0 }, uLearning: { value: 0 },
    uConnecting: { value: 0 }, uOpportunity: { value: 0 }, uResearchPhase: { value: 0 },
    uConnectA: { value: new THREE.Vector3() }, uConnectB: { value: new THREE.Vector3() }, uPulseX: { value: -2 },
    uLobeGrowth: { value: new Array(8).fill(0.55) }, uHighlight: { value: new Array(8).fill(0) },
  };
  const common = { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms };
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, ...common });
  const lineMaterial = new THREE.ShaderMaterial({ vertexShader: lineVertexShader, fragmentShader: lineFragmentShader, ...common });
  const group = new THREE.Group();
  const lines = new THREE.LineSegments(lineGeometry(cloud), lineMaterial);
  const points = new THREE.Points(g, material);
  lines.frustumCulled = points.frustumCulled = false;
  group.add(lines, points);
  scene.add(group);

  // Interaction
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3(), mouseSmooth = new THREE.Vector3(99, 99, 0), parallax = new THREE.Vector2();
  let hover = false, rippleIdx = 0;
  const el = renderer.domElement;
  const setPointer = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  el.addEventListener("pointermove", (e) => { hover = true; setPointer(e); });
  el.addEventListener("pointerleave", () => { hover = false; });
  el.addEventListener("pointerdown", (e) => {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) {
      const local = group.worldToLocal(hit.clone());
      (uniforms.uRipples.value[rippleIdx++ % 4] as THREE.Vector4).set(local.x, local.y, local.z, uniforms.uTime.value);
    }
  });

  // Effects defined around brain regions land on the orb's surface instead.
  const center = new THREE.Vector3(BRAIN_CENTER[0], BRAIN_CENTER[1], BRAIN_CENTER[2]).add(uniforms.uGraphOffset.value);
  const onOrb = (c: [number, number, number]) => {
    const d = new THREE.Vector3(c[0] - BRAIN_CENTER[0], c[1] - BRAIN_CENTER[1], c[2] - BRAIN_CENTER[2]);
    if (d.lengthSq() < 1e-4) d.set(0, 1, 0);
    return d.normalize().multiplyScalar(FR.orb * 0.9).add(center);
  };

  let state: State = "idle";
  let introStart: number | null = reduced ? null : -1;
  const eased: Record<string, number> = { thinking: 0, researching: 0, learning: 0, connecting: 0, opportunity: 0 };
  const connect = { until: 0, a: 0, b: 1 };
  let pulseStart = -99;

  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole figure in frame on narrow screens.
    camera.position.z = FR.camZ * Math.max(1, 0.95 / camera.aspect);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  const clock = new THREE.Clock();
  let visible = true;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(container);
  const frame = () => {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible || document.hidden) return;
    const t = clock.elapsedTime, u = uniforms;
    u.uTime.value = t;
    u.uPixelRatio.value = renderer.getPixelRatio();
    u.uScale.value = 9.5 * 0.92 * Math.max(0.55, Math.min(1.35, container.clientHeight / 860));
    if (introStart !== null) {
      if (introStart < 0) introStart = t;
      const it = t - introStart;
      u.uMorph.value = Math.min(1, Math.max(0, (it - INTRO_HOLD) / INTRO_MORPH));
      u.uSpin.value = it * 0.45;
      if (it > INTRO_HOLD + INTRO_MORPH + 0.5) { introStart = null; u.uMorph.value = 1; }
    }
    for (const s of STATES) eased[s] += ((state === s ? 1 : 0) - eased[s]) * Math.min(1, dt * (state === s ? 2.2 : 1.1));
    u.uThinking.value = eased.thinking; u.uResearch.value = eased.researching; u.uLearning.value = eased.learning;
    u.uConnecting.value = eased.connecting; u.uOpportunity.value = eased.opportunity;
    u.uActivity.value = Math.min(1, eased.thinking + eased.researching * 0.8 + eased.connecting * 0.6 + eased.learning * 0.5 + eased.opportunity * 0.6);
    u.uResearchPhase.value = (t * 0.9) % 6;
    // Learning: more of the reserve particles emerge.
    const growTarget = state === "learning" ? 0.95 : 0.55;
    for (let i = 0; i < 8; i++) u.uLobeGrowth.value[i] += (growTarget - u.uLobeGrowth.value[i]) * Math.min(1, dt * 0.5);
    if (t > connect.until) {
      const a = Math.floor(Math.random() * 6);
      let b = Math.floor(Math.random() * 6);
      if (b === a) b = (a + 2) % 6;
      Object.assign(connect, { until: t + 2.2, a, b });
      u.uConnectA.value.copy(onOrb(CLUSTER_CENTROIDS[a]));
      u.uConnectB.value.copy(onOrb(CLUSTER_CENTROIDS[b]));
    }
    if (eased.opportunity > 0.05 && t - pulseStart > 2.6) pulseStart = t;
    const pt = (t - pulseStart) / 1.6;
    u.uPulseX.value = pt <= 1 ? (pt * 2 - 1) * FR.orb * 1.05 : -3;
    u.uOrbSpin.value += dt * 0.06 * u.uMotion.value;
    for (let i = 0; i < 8; i++) {
      const hl = (eased.opportunity > 0.05 && i <= 1) || (eased.connecting > 0.05 && (i === connect.a || i === connect.b)) ? 1 : 0;
      u.uHighlight.value[i] += (hl - u.uHighlight.value[i]) * Math.min(1, dt * 3);
    }
    if (hover) {
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const local = group.worldToLocal(hit.clone());
        if (mouseSmooth.x > 50) mouseSmooth.copy(local);
        mouseSmooth.lerp(local, Math.min(1, dt * 8));
      }
    }
    u.uMouse.value.copy(mouseSmooth);
    u.uMouseStrength.value += ((hover ? 1 : 0) - u.uMouseStrength.value) * Math.min(1, dt * 2.5);
    parallax.x += ((hover ? pointer.x : 0) - parallax.x) * Math.min(1, dt * 1.5);
    parallax.y += ((hover ? pointer.y : 0) - parallax.y) * Math.min(1, dt * 1.5);
    group.rotation.y = -0.16 + parallax.x * 0.14 + (reduced ? 0 : Math.sin(t * 0.13) * 0.06);
    group.rotation.x = -parallax.y * 0.05;
    group.position.y = FR.y;
    renderer.render(scene, camera);
  };
  frame();

  return {
    setState(s: State) { state = s; },
    replay() { if (!reduced) { introStart = -1; uniforms.uMorph.value = 0; } },
    /** Dark: particles add light onto black. Light: see-through canvas, particles painted normally. */
    setTheme(light: boolean) {
      renderer.setClearColor(0x000000, light ? 0 : 1);
      uniforms.uLight.value = light ? 1 : 0;
      for (const m of [material, lineMaterial]) { m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true; }
    },
  };
}

(window as any).OrbitalCore = { mountNeuralCore };
