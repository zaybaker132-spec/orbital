const vertexBody = /* glsl */ `
uniform float uTime;
uniform float uMorph;
uniform float uSpin;
uniform vec3 uGraphOffset;
uniform float uGraphScale;
uniform float uPixelRatio;
uniform float uScale;
uniform float uMotion;
uniform vec3 uMouse;
uniform float uMouseStrength;
uniform vec4 uRipples[4];
uniform float uActivity;
uniform float uThinking;
uniform float uResearch;
uniform float uLearning;
uniform float uConnecting;
uniform float uOpportunity;
uniform float uResearchPhase;
uniform vec3 uConnectA;
uniform vec3 uConnectB;
uniform float uPulseX;
uniform float uLobeGrowth[8];
uniform float uHighlight[8];

attribute vec3 color;
attribute float aSize;
attribute float aSeed;
attribute float aRegion;
attribute float aCluster;
attribute float aBirth;
attribute float aBright;
attribute vec3 aGraph;
#ifdef IS_LINE
attribute float aEnd;
attribute float aLineSeed;
varying float vT;
varying float vLineSeed;
#endif

varying vec3 vColor;
varying float vAlpha;
varying float vGraph;

const vec3 BRAIN_CENTER = vec3(-0.05, 0.45, 0.0);

float lobeGrowth(int i) {
  for (int k = 0; k < 8; k++) if (k == i) return uLobeGrowth[k];
  return 0.0;
}
float highlight(int i) {
  for (int k = 0; k < 8; k++) if (k == i) return uHighlight[k];
  return 0.0;
}

void main() {
  float seed = aSeed;
  int ci = int(aCluster + 0.5);
  float isBrain = step(0.5, aRegion) * step(aRegion, 3.5);
  float glow = 0.0;

  // Intro: the knowledge graph (spinning) streams into the head and brain. Brain first, then the body.
  float stagger = seed * 0.45 + (isBrain > 0.5 ? 0.0 : 0.35);
  float mt = clamp(uMorph * 1.8 - stagger, 0.0, 1.0);
  mt = mt * mt * mt * (mt * (mt * 6.0 - 15.0) + 10.0);
  vec3 gp = (aGraph - BRAIN_CENTER) * uGraphScale;
  float cs = cos(uSpin), sn = sin(uSpin);
  gp = vec3(gp.x * cs + gp.z * sn, gp.y, -gp.x * sn + gp.z * cs) + BRAIN_CENTER + uGraphOffset;
  // A gentle arc in flight so particles swirl in rather than sliding straight.
  vec3 arc = vec3(sin(seed * 31.0), cos(seed * 17.0), sin(seed * 23.0)) * 0.35 * sin(mt * 3.14159);
  vec3 p = mix(gp, position, mt) + arc;
  float graphPhase = 1.0 - mt;
  glow += sin(mt * 3.14159) * 0.22;

  // Growth: reserve particles emerge from a loose scatter into their place as knowledge accumulates.
  float reveal = 1.0;
  if (aBirth > 0.0) {
    float g = lobeGrowth(ci);
    reveal = clamp((g - aBirth) * 18.0, 0.0, 1.0);
    vec3 scatter = normalize(vec3(sin(seed * 91.7), cos(seed * 47.3), sin(seed * 13.1)) + 1e-4) * 0.7;
    float inv = 1.0 - reveal;
    p += scatter * inv * inv;
    glow += (1.0 - abs(reveal * 2.0 - 1.0)) * 1.2; // bright while forming
  }

  // Idle drift: slow, per-particle, organic.
  float amp = (0.0055 + 0.009 * uActivity) * uMotion * (aRegion > 3.5 ? 5.0 : 1.0);
  p += vec3(
    sin(uTime * 0.55 + seed * 40.0),
    sin(uTime * 0.47 + seed * 23.0 + 1.3),
    cos(uTime * 0.51 + seed * 31.0)
  ) * amp;

  vec3 radial = normalize(p - BRAIN_CENTER + 1e-4);

  // Thinking: coordinated waves sweep the brain.
  float wave = sin(p.x * 8.0 + p.y * 3.5 - uTime * 4.2);
  glow += uThinking * isBrain * smoothstep(0.5, 1.0, wave) * 1.3;
  p += radial * uThinking * isBrain * wave * 0.007 * uMotion;

  // Researching: activity travels region to region.
  float d = abs(aCluster - uResearchPhase);
  float regionOn = (1.0 - min(1.0, d)) * isBrain;
  glow += uResearch * regionOn * (0.8 + 0.6 * sin(uTime * 7.0 + seed * 20.0));
  glow += uResearch * isBrain * 0.12;
  p += vec3(sin(seed * 100.0 + uTime * 6.0), cos(seed * 80.0 + uTime * 5.0), sin(seed * 60.0 + uTime * 5.5)) * 0.009 * uResearch * regionOn * uMotion;

  // Connecting: beads of activity flow along the path between two clusters.
  vec3 ab = uConnectB - uConnectA;
  float L = max(length(ab), 1e-4);
  vec3 dir = ab / L;
  float tp = clamp(dot(p - uConnectA, dir), 0.0, L);
  float distLine = length(p - (uConnectA + dir * tp));
  float tube = smoothstep(0.3, 0.0, distLine) * isBrain;
  float bead = smoothstep(0.7, 1.0, sin(tp * 13.0 - uTime * 6.5));
  glow += uConnecting * (tube * (0.3 + bead * 1.7) + (highlight(ci) * 0.45 * isBrain));
  p += dir * uConnecting * tube * bead * 0.02 * uMotion;

  // Opportunity: one controlled pulse front crosses the brain; relevant clusters stay lit.
  float front = smoothstep(0.14, 0.0, abs(p.x - uPulseX)) * isBrain;
  glow += uOpportunity * (front * 2.0 + highlight(ci) * isBrain * 0.7);
  p += radial * front * uOpportunity * 0.028 * uMotion;

  // Learning: a soft shimmer, strongest on newly formed particles.
  glow += uLearning * isBrain * (aBirth > 0.0 ? 0.9 : 0.18) * (0.5 + 0.5 * sin(uTime * 5.0 + seed * 50.0));

  // Idle neural firing: individual neurons flash briefly at random moments.
  glow += pow(max(0.0, sin(uTime * 0.8 + seed * 157.0)), 140.0) * 1.6 * isBrain * uMotion;

  // Cursor: repulsion inside the radius, gentle attraction just outside it.
  vec3 toP = p - uMouse;
  toP.z *= 0.35;
  float md = length(toP);
  float R = 0.5;
  vec3 away = normalize(toP + 1e-5);
  float push = smoothstep(R, 0.0, md) * uMouseStrength;
  float pull = smoothstep(R * 2.2, R, md) * smoothstep(R * 0.7, R, md) * uMouseStrength;
  p += away * push * 0.2 * uMotion;
  p -= away * pull * 0.03 * uMotion;
  glow += push * 0.45;

  // Click ripples.
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.w;
    if (age < 0.0 || age > 2.4) continue;
    vec3 rv = p - r.xyz;
    float rd = length(rv);
    float k = exp(-pow((rd - age * 1.5) * 6.0, 2.0)) * (1.0 - age / 2.4);
    p += normalize(rv + 1e-5) * k * 0.055 * uMotion;
    glow += k * 0.9;
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aSize * (1.0 + min(glow, 2.0) * 0.45) * (1.0 + graphPhase * 0.3);
  gl_PointSize = max(1.0, size * uPixelRatio * uScale / -mv.z);
  float depth = smoothstep(-8.0, -4.5, mv.z);
  vColor = color * (aBright * (0.5 + 0.5 * depth) + glow * 0.65) + vec3(glow * 0.1);
  vAlpha = reveal;
  vGraph = graphPhase;
#ifdef IS_LINE
  vT = aEnd;
  vLineSeed = aLineSeed;
#endif
}
`;

export const vertexShader = vertexBody;
export const lineVertexShader = "#define IS_LINE\n" + vertexBody;

/** Connections: faint in the brain, brighter as a graph; signals travel along a few at a time. */
export const lineFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform float uLineAlpha;
varying vec3 vColor;
varying float vAlpha;
varying float vGraph;
varying float vT;
varying float vLineSeed;
void main() {
  float phase = fract(uTime * 0.06 + vLineSeed);
  float pulse = phase < 0.07 ? exp(-pow((vT - phase / 0.07) * 6.0, 2.0)) * uMotion : 0.0;
  float a = (uLineAlpha * mix(1.0, 2.1, vGraph) + pulse * 0.75) * vAlpha;
  gl_FragColor = vec4(mix(vColor * 1.25, vec3(1.0), 0.12 + pulse * 0.55), a);
}
`;

export const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5 || vAlpha < 0.01) discard;
  float a = smoothstep(0.5, 0.2, d);
  gl_FragColor = vec4(vColor, a * vAlpha);
}
`;
