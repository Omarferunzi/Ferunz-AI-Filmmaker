/**
 * creature-studio.js  —  Creature & Character Tools (drop-in ES module)
 * ---------------------------------------------------------------------------
 * Builds creatures and characters from shapes + anatomy rules + materials, then
 * renders them locally in the browser (Canvas 2D, no WebGL, no dependencies).
 *
 * HOW IT WORKS
 *  1. A JSON "spec" (anatomy, skin, palette, lighting) is validated by a rules
 *     engine (proportions, neck/head support, wing/mass sanity, symmetry).
 *  2. The spec is built into a skeleton of tapered capsules + membranes, solved
 *     with 2-bone IK for limbs, and auto-framed.
 *  3. A software rasteriser writes depth / normal / part-ID buffers with smooth
 *     (organic) unions between shapes.
 *  4. A shader lights it: procedural skin, scales, fur, feathers, chitin, cloth,
 *     horn, membrane + AO, cast shadows, spec, rim light, linear-light blending.
 *  5. The same buffers export as depth / normal / part-mask / line-art passes —
 *     exactly what ControlNet-style diffusion models want as conditioning, so
 *     you can hand off to a local AI model for photoreal finishing (see refine()).
 *
 * QUICK START
 *   import { CreatureStudio, mountCreatureUI } from './creature-studio.js';
 *   const studio = new CreatureStudio(document.querySelector('#cv'));
 *   studio.loadPreset('drake');
 *   mountCreatureUI(document.querySelector('#panel'), studio);   // optional UI
 *   const passes = await studio.renderPasses();   // {beauty,depth,normal,mask,lineart}
 *   const png    = await studio.toBlob();
 *
 * HONEST NOTE: this is a procedural, fully controllable renderer. It will not
 * out-paint a diffusion model on photoreal texture detail — it gives you exact
 * anatomy control, consistency and conditioning maps; use refine() to add the
 * generative finish.
 */

// ============================ helpers =======================================
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rad = d => (d * Math.PI) / 180;
const dirv = d => [Math.cos(rad(d)), -Math.sin(rad(d))]; // screen space, 90° = up
const add = (p, v, s = 1) => [p[0] + v[0] * s, p[1] + v[1] * s];
const clone = o => JSON.parse(JSON.stringify(o));
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[l] = v; };
const deepMerge = (t, s) => {
  for (const k in s) {
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) t[k] = deepMerge(t[k] && typeof t[k] === 'object' ? t[k] : {}, s[k]);
    else t[k] = s[k];
  }
  return t;
};
const hex = h => {
  h = String(h).replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgbCss = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const r = mulberry32(seed * 2654435761 + 17), P = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) P[i] = r();
  const at = (x, y) => P[((y & 255) << 8) | (x & 255)];
  const n = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
  n.fbm = (x, y, o = 4) => { let a = 0.5, f = 1, s = 0; for (let i = 0; i < o; i++) { s += a * n(x * f, y * f); f *= 2; a *= 0.5; } return s / (1 - Math.pow(0.5, o)) * 0.5 + 0; };
  return n;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
const rgbHex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// ============================ spec + rules ==================================
export const DEFAULT_SPEC = {
  name: 'Untitled', seed: 7, kind: 'quadruped', // quadruped | biped | serpent | humanoid
  frame: { width: 960, height: 720, fit: true },
  body: { length: 44, thickness: 11, arch: 3, tilt: 0, sway: 0 },
  neck: { length: 15, thickness: 5.2, angle: 55, curve: 25 },
  head: { size: 7, snout: 9, jaw: 0.6, teeth: 0, ears: 'none', earSize: 5, horns: 2, hornLength: 11, hornCurve: 0.6, eyes: 1, eyeSize: 1.5, pupil: 'slit' },
  limbs: { pairs: 2, arms: 0, length: 24, thickness: 4, foot: 6, claws: 3, clawSize: 1.6, digitigrade: 0.6, stride: 0.5 },
  tail: { length: 36, curve: 8, tip: 'none' }, // tip: none | club | spade
  wings: { span: 0, angle: 100, fingers: 4, bone: 1.1, pair: true },
  crest: { count: 6, size: 3.2 },
  human: { height: 80, heads: 7.5, shoulder: 1, hips: 1, muscle: 0.4, jaw: 1, neck: 1, stance: 3, armAngle: 22, elbowBend: 10, hair: 'short', outfit: true },
  skin: { type: 'scales', base: '#4f7a4a', secondary: '#c8b45a', belly: '#d9c98e', horn: '#d8cfb8', membrane: '#7a3b4a', pattern: 'stripes', patternScale: 1, patternStrength: 0.8, scale: 1, roughness: 0.45, bump: 1 },
  palette: { cloth: '#33415c', hair: '#3a2a20', accent: '#6b4a2f' },
  eye: { color: '#e8b020', sclera: false, glow: 0 },
  grade: { exposure: 1, contrast: 1.06, saturation: 1.05, warmth: 0, bloom: 0.35, grain: 0.03, ca: 0.6, reflection: 0.3 },
  light: { azimuth: 125, elevation: 48, intensity: 1.1, color: '#fff1de', sky: '#8fb2ff', ground: '#4a3f35', ambient: 0.55, rim: 0.8, rimColor: '#9fc4ff', specular: 0.5 },
  background: { top: '#2b3445', bottom: '#8f9ba8', ground: '#3d3a38', shadow: 0.55, vignette: 0.35 },
  rules: { enforce: true, symmetry: true, proportions: 'custom' }, // custom|natural|heroic|stylized|chibi
};

const RANGES = {
  'body.length': [10, 90], 'body.thickness': [3, 26], 'body.arch': [-10, 14], 'body.tilt': [0, 70], 'body.sway': [0, 14],
  'neck.length': [0, 50], 'neck.thickness': [1.5, 14], 'neck.angle': [-20, 100], 'neck.curve': [-40, 70],
  'head.size': [3, 16], 'head.snout': [0, 24], 'head.jaw': [0, 1], 'head.teeth': [0, 14], 'eye.glow': [0, 2.5], 'grade.exposure': [0.4, 2.2], 'grade.contrast': [0.7, 1.5], 'grade.saturation': [0.3, 1.8], 'grade.warmth': [-1, 1], 'grade.bloom': [0, 1.5], 'grade.grain': [0, 0.12], 'grade.ca': [0, 3], 'grade.reflection': [0, 0.8], 'head.horns': [0, 4], 'head.hornLength': [0, 26],
  'head.hornCurve': [-1, 1.2], 'head.eyes': [1, 4], 'head.eyeSize': [0.5, 3.5], 'head.earSize': [1, 14],
  'limbs.pairs': [0, 4], 'limbs.arms': [0, 1], 'limbs.length': [6, 46], 'limbs.thickness': [1.5, 9], 'limbs.foot': [2, 14],
  'limbs.claws': [0, 4], 'limbs.clawSize': [0.5, 4], 'limbs.digitigrade': [0, 1], 'limbs.stride': [0, 1],
  'tail.length': [0, 80], 'tail.curve': [-50, 60], 'wings.span': [0, 80], 'wings.fingers': [2, 6], 'wings.angle': [60, 140],
  'crest.count': [0, 24], 'crest.size': [0, 9],
  'human.height': [40, 92], 'human.heads': [3, 9], 'human.shoulder': [0.7, 1.5], 'human.hips': [0.7, 1.5], 'human.muscle': [0, 1],
  'human.jaw': [0.7, 1.3], 'human.neck': [0.4, 2], 'human.stance': [0, 12], 'human.armAngle': [0, 80], 'human.elbowBend': [-10, 60],
  'skin.scale': [0.4, 3], 'skin.roughness': [0, 1], 'skin.bump': [0, 2.5], 'skin.patternScale': [0.3, 4], 'skin.patternStrength': [0, 1],
  'light.azimuth': [0, 360], 'light.elevation': [5, 85], 'light.intensity': [0, 2.5], 'light.ambient': [0, 1.5], 'light.rim': [0, 2], 'light.specular': [0, 1.5],
};
const INTS = ['head.horns', 'head.eyes', 'head.teeth', 'limbs.pairs', 'limbs.arms', 'limbs.claws', 'wings.fingers', 'crest.count', 'seed'];
const CANON_HEADS = { natural: 7.5, heroic: 8.2, stylized: 5.5, chibi: 3.4 };

/** Rules engine: clamps values, enforces anatomical plausibility, returns warnings. */
export function validateSpec(input) {
  const spec = deepMerge(clone(DEFAULT_SPEC), clone(input || {}));
  const w = [];
  for (const [k, [a, b]] of Object.entries(RANGES)) { const v = getPath(spec, k); if (typeof v === 'number') setPath(spec, k, clamp(v, a, b)); }
  for (const k of INTS) setPath(spec, k, Math.round(getPath(spec, k)));
  if (!spec.rules.enforce) return { spec, warnings: w };
  if (spec.kind === 'humanoid') {
    if (CANON_HEADS[spec.rules.proportions]) spec.human.heads = CANON_HEADS[spec.rules.proportions];
  } else {
    const minNeck = spec.head.size * 0.45;
    if (spec.neck.length > 0 && spec.neck.thickness < minNeck) { spec.neck.thickness = +minNeck.toFixed(2); w.push('Neck thickened so it can carry the head.'); }
    if (spec.head.size > spec.body.thickness * 1.35) w.push('Head is very large relative to the torso.');
    const minLeg = spec.body.thickness * 0.22;
    if (spec.kind !== 'serpent' && spec.limbs.pairs > 0 && spec.limbs.thickness < minLeg) { spec.limbs.thickness = +minLeg.toFixed(2); w.push('Limbs thickened to support body mass.'); }
    if (spec.wings.span > 0 && spec.wings.span < spec.body.length * 0.9) w.push('Wing span is small for this body mass — it would not plausibly fly.');
    if (spec.tail.length > spec.body.length * 2.2) w.push('Tail is unusually long.');
    if (spec.kind !== 'serpent' && spec.limbs.pairs > 0 && spec.limbs.length < spec.body.thickness * 0.8) w.push('Legs are short — belly will drag.');
  }
  return { spec, warnings: w };
}

// ============================ presets =======================================
export const PRESETS = {
  drake: { name: 'Drake', kind: 'quadruped', body: { length: 46, thickness: 11, arch: 4 }, neck: { length: 22, angle: 66, curve: 36, thickness: 5.8 },
    head: { size: 7.5, snout: 10, teeth: 8, horns: 3, hornLength: 12, hornCurve: 0.7, pupil: 'slit' }, limbs: { pairs: 2, length: 24, thickness: 4.2, claws: 3, digitigrade: 0.6 },
    tail: { length: 40, curve: 6 }, wings: { span: 56, fingers: 4 }, crest: { count: 9, size: 3.4 },
    skin: { type: 'scales', base: '#4f7a4a', secondary: '#c8b45a', belly: '#d9c98e', pattern: 'stripes' }, eye: { color: '#e8b020', sclera: false, glow: 0.4 } },
  wolf: { name: 'Dire wolf', kind: 'quadruped', body: { length: 40, thickness: 9.5, arch: 1 }, neck: { length: 12, angle: 42, curve: 12, thickness: 5 },
    head: { size: 6.5, snout: 10, jaw: 0.7, teeth: 6, ears: 'pointed', earSize: 5, horns: 0, pupil: 'round', eyeSize: 1.2 }, limbs: { pairs: 2, length: 25, thickness: 3.4, claws: 2, clawSize: 1, digitigrade: 0.75, stride: 0.6 },
    tail: { length: 28, curve: -6 }, wings: { span: 0 }, crest: { count: 0 },
    skin: { type: 'fur', base: '#6e6a65', secondary: '#2e2c2a', belly: '#cfc8bb', pattern: 'gradient', patternStrength: 0.7, scale: 1 }, eye: { color: '#d89a2a', sclera: false } },
  raptor: { name: 'Raptor', kind: 'biped', body: { length: 34, thickness: 8, arch: 1, tilt: 28 }, neck: { length: 15, angle: 70, curve: 40, thickness: 4 },
    head: { size: 5.2, snout: 9, jaw: 0.8, teeth: 8, horns: 0, ears: 'none', pupil: 'slit' }, limbs: { pairs: 1, arms: 1, length: 30, thickness: 3.6, claws: 3, clawSize: 1.8, digitigrade: 1, foot: 8 },
    tail: { length: 46, curve: 4 }, wings: { span: 0 }, crest: { count: 5, size: 1.8 },
    skin: { type: 'feather', base: '#8a5a2e', secondary: '#1d1a18', belly: '#e7d9b8', pattern: 'stripes' }, eye: { color: '#f0c020', sclera: false } },
  serpent: { name: 'Sea serpent', kind: 'serpent', body: { length: 60, thickness: 6.2, sway: 6, arch: 0 }, neck: { length: 16, angle: 70, curve: 40, thickness: 5.2 },
    head: { size: 5.5, snout: 5, jaw: 0.5, teeth: 4, horns: 0, ears: 'fin', earSize: 5 }, limbs: { pairs: 0 }, tail: { length: 38, curve: 0 }, wings: { span: 0 }, crest: { count: 14, size: 1.8 },
    skin: { type: 'scales', base: '#2f6b52', secondary: '#d8c25a', belly: '#e6dfb0', pattern: 'stripes', scale: 0.8 }, eye: { color: '#d8f040', sclera: false } },
  insectoid: { name: 'Chitin stalker', kind: 'quadruped', body: { length: 38, thickness: 8, arch: 2 }, neck: { length: 4, angle: 30, curve: 0, thickness: 5 },
    head: { size: 5, snout: 3, jaw: 0.9, horns: 2, hornLength: 8, hornCurve: -0.3, eyes: 3, eyeSize: 1.1, pupil: 'round' }, limbs: { pairs: 3, length: 24, thickness: 2.2, claws: 1, clawSize: 1.2, digitigrade: 0.3, stride: 0.7 },
    tail: { length: 14, curve: 10 }, wings: { span: 0 }, crest: { count: 0 },
    skin: { type: 'chitin', base: '#3b2a40', secondary: '#c0476a', belly: '#6a4a70', pattern: 'mottle', scale: 1 }, eye: { color: '#ff4060', sclera: false } },
  hero: { name: 'Hero', kind: 'humanoid', human: { height: 80, heads: 7.5, muscle: 0.5, hair: 'short', outfit: true }, head: { horns: 0, ears: 'none', eyeSize: 1.5 },
    skin: { type: 'skin', base: '#d9a888', secondary: '#d9a888', pattern: 'none', scale: 1 }, palette: { cloth: '#33415c', hair: '#3a2a20', accent: '#6b4a2f' }, eye: { color: '#4a7aa8', sclera: true }, rules: { proportions: 'heroic' } },
  elf: { name: 'Elf ranger', kind: 'humanoid', human: { height: 82, heads: 8.2, muscle: 0.15, shoulder: 0.9, hips: 0.9, hair: 'long', outfit: true }, head: { horns: 0, ears: 'pointed', earSize: 6 },
    skin: { type: 'skin', base: '#ecd0b4', secondary: '#ecd0b4', pattern: 'none' }, palette: { cloth: '#3f5a3a', hair: '#d8c27a', accent: '#6d4c2a' }, eye: { color: '#3aa07a', sclera: true }, rules: { proportions: 'custom' } },
  brute: { name: 'Orc brute', kind: 'humanoid', human: { height: 84, heads: 6.5, muscle: 0.95, shoulder: 1.3, hips: 1.1, hair: 'mohawk', outfit: true, armAngle: 30 }, head: { horns: 0, ears: 'pointed', earSize: 4 },
    skin: { type: 'skin', base: '#6f9a58', secondary: '#6f9a58', pattern: 'none' }, palette: { cloth: '#5a3a2a', hair: '#1c1c1c', accent: '#2f2a26' }, eye: { color: '#d8a020', sclera: true }, rules: { proportions: 'custom' } },
  tiefling: { name: 'Tiefling', kind: 'humanoid', human: { height: 80, heads: 7.5, muscle: 0.35, hair: 'long', outfit: true }, head: { horns: 2, hornLength: 9, hornCurve: 0.8, ears: 'pointed', earSize: 4 },
    skin: { type: 'skin', base: '#a85a6a', secondary: '#a85a6a', horn: '#2a2024', pattern: 'none' }, palette: { cloth: '#2a2438', hair: '#1a1220', accent: '#b8883a' }, eye: { color: '#ffb020', sclera: false }, rules: { proportions: 'natural' } },
};

// ============================ scene builder =================================
const FAR = 1, BODY = 2, NEAR = 3, TOP = 4; // depth layers (each is far apart in height)

class Scene {
  constructor() { this.prims = []; this.contacts = []; this.lines = []; this.dots = []; this.parts = [null]; this.map = new Map(); }
  part(name, mat) {
    let id = this.map.get(name);
    if (!id) { id = this.parts.length; this.parts.push({ name, mat, color: hslToRgb((id * 137.508) % 360, 0.7, 0.55) }); this.map.set(name, id); }
    return id;
  }
  cap(a, b, ra, rb, layer, name, mat) { this.prims.push({ t: 'cap', a: [...a], b: [...b], ra: Math.max(ra, 0.2), rb: Math.max(rb, 0.2), layer, id: this.part(name, mat) }); }
  chain(pts, radii, layer, name, mat) { for (let i = 0; i < pts.length - 1; i++) this.cap(pts[i], pts[i + 1], radii[i], radii[i + 1], layer, name, mat); }
  eye(x, y, r, look) { const n = this.prims.filter(p => p.eye).length; this.prims.push({ t: 'cap', a: [x, y], b: [x, y], ra: r, rb: r, layer: NEAR, id: this.part('eye' + n, 'eye'), eye: true, look }); }
  poly(pts, layer, name, mat, thick = 1) { this.prims.push({ t: 'poly', pts: pts.map(p => [...p]), layer, thick, id: this.part(name, mat) }); }
}
const curvePts = (p0, a0, len, bend, n) => { const pts = [p0]; let p = p0; for (let i = 0; i < n; i++) { p = add(p, dirv(a0 + bend * ((i + 0.5) / n)), len / n); pts.push(p); } return pts; };
const ramp = (n, a, b, pw = 1) => Array.from({ length: n + 1 }, (_, i) => lerp(a, b, Math.pow(i / n, pw)));
function ik(a, t, l1, l2, bend) {
  let dx = t[0] - a[0], dy = t[1] - a[1], d = Math.hypot(dx, dy) || 1e-6;
  const mx = l1 + l2 - 0.01; if (d > mx) { dx *= mx / d; dy *= mx / d; d = mx; }
  const mn = Math.abs(l1 - l2) + 0.01; if (d < mn) { dx *= mn / d; dy *= mn / d; d = mn; }
  const aa = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - aa * aa)), ux = dx / d, uy = dy / d;
  return { mid: [a[0] + ux * aa - bend * uy * h, a[1] + uy * aa + bend * ux * h], end: [a[0] + dx, a[1] + dy] };
}
const spAt = (sp, t) => { const f = clamp(t) * (sp.length - 1), i = Math.min(sp.length - 2, Math.floor(f)), k = f - i; return { x: lerp(sp[i].x, sp[i + 1].x, k), y: lerp(sp[i].y, sp[i + 1].y, k), r: lerp(sp[i].r, sp[i + 1].r, k) }; };
const prof = (t, keys) => { for (let i = 0; i < keys.length - 1; i++) { const [t0, v0] = keys[i], [t1, v1] = keys[i + 1]; if (t <= t1) return lerp(v0, v1, sstep(t0, t1, t)); } return keys[keys.length - 1][1]; };

function addClaws(S, tip, n, size, u, layer, base = 0) {
  for (let c = 0; c < n; c++) {
    const a0 = -5 - c * 24 + base, pts = curvePts(tip, a0, size * u * 1.8, -22, 3);
    S.chain(pts, ramp(3, size * u * 0.32, size * u * 0.04), layer, 'claw', 'claw');
  }
}

function buildSide(S, spec, u, W, H) {
  const b = spec.body, nk = spec.neck, hd = spec.head, lg = spec.limbs, tl = spec.tail, wg = spec.wings, cr = spec.crest;
  const ground = H * 0.84, cx = W / 2, serp = spec.kind === 'serpent', biped = spec.kind === 'biped';
  const pairs = serp ? 0 : lg.pairs, legLen = pairs ? lg.length * u : 0, R = b.thickness * u;
  const tilt = biped ? Math.max(b.tilt, 28) : b.tilt, T = rad(tilt), len = b.length * u;
  const centerY = serp ? ground - R * 0.95 : ground - legLen * 0.92 - R * 0.2;
  const x0 = cx - (len * Math.cos(T)) / 2, y0 = centerY + (len * Math.sin(T)) / 2, N = 16, ph = (spec.seed % 7) * 0.9;
  const sp = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    sp.push({
      x: x0 + t * len * Math.cos(T),
      y: y0 - t * len * Math.sin(T) - b.arch * u * Math.sin(Math.PI * t) + (serp ? b.sway * u * Math.sin(t * Math.PI * 3 + ph) : 0),
      r: serp ? R * (0.85 + 0.15 * Math.sin(Math.PI * t)) : R * (0.68 + 0.32 * Math.sin(Math.PI * clamp(0.1 + 0.8 * t))),
    });
  }
  const spPts = sp.map(p => [p.x, p.y]);
  S.chain(spPts, sp.map(p => p.r), BODY, 'torso', 'skin');
  const last = sp[N], prev = sp[N - 1];
  // --- neck
  const nAng = nk.angle, nPts = curvePts([last.x, last.y], nAng, nk.length * u, -nk.curve, 8);
  const nRad = ramp(8, last.r * 0.85, nk.thickness * u);
  if (nk.length > 0) S.chain(nPts, nRad, BODY, 'neck', 'skin');
  const nEnd = nPts[nPts.length - 1], ha = nAng - nk.curve - (serp ? 20 : 25), dH = dirv(ha);
  const dn = [Math.sin(rad(ha)), Math.cos(rad(ha))], upv = [-dn[0], -dn[1]], sk = hd.size * u;
  // --- head
  const hc = add(nEnd, dH, sk * 0.5), tip = add(hc, dH, hd.snout * u);
  S.cap(hc, hc, sk, sk, BODY, 'head', 'skin');
  if (hd.snout > 0) S.cap(add(hc, dH, sk * 0.2), tip, sk * 0.64, sk * 0.4, BODY, 'snout', 'skin');
  const jA = add(add(hc, dn, sk * 0.34), dH, sk * 0.1), jB = add(add(tip, dn, sk * 0.2), dH, -sk * 0.05);
  S.cap(jA, jB, sk * (0.26 + 0.12 * hd.jaw), sk * (0.2 + 0.1 * hd.jaw), BODY, 'jaw', 'skin');
  S.lines.push({ pts: [add(add(tip, dn, sk * 0.06), dH, sk * 0.08), add(add(hc, dn, sk * 0.2), dH, sk * 0.1), add(add(hc, dn, sk * 0.12), dH, -sk * 0.35)], w: sk * 0.06, mat: 'mouth' });
  S.dots.push({ p: add(add(tip, upv, sk * 0.16), dH, -sk * 0.15), r: sk * 0.07 });
  // ears
  if (hd.ears !== 'none') {
    for (const far of [true, false]) {
      const base = add(add(hc, upv, sk * 0.62), dH, -sk * 0.35 - (far ? sk * 0.3 : 0)), es = hd.earSize * u, ly = far ? FAR : BODY;
      if (hd.ears === 'pointed') S.chain(curvePts(base, ha + 78, es, 22, 3), ramp(3, es * 0.32, es * 0.03), ly, 'ear', 'skin');
      else if (hd.ears === 'round') S.chain(curvePts(base, ha + 80, es * 0.6, 10, 2), ramp(2, es * 0.3, es * 0.2), ly, 'ear', 'skin');
      else S.chain(curvePts(add(hc, dH, -sk * 0.4), ha + 160, es * 1.8, -25, 4), ramp(4, es * 0.2, es * 0.03), ly, 'ear', 'skin');
    }
  }
  // horns
  for (let k = 0; k < hd.horns; k++) {
    const far = k % 2 === 1, base = add(add(hc, upv, sk * 0.7), dH, -sk * (0.1 + 0.32 * k)), hl = hd.hornLength * u * (1 - 0.12 * k);
    S.chain(curvePts(base, ha + 62 + k * 8, hl, hd.hornCurve * 80, 6), ramp(6, sk * 0.22, u * 0.08, 0.8), far ? FAR : BODY, 'horn', 'horn');
  }
  // eyes
  for (let k = 0; k < hd.eyes; k++) {
    const p = add(add(add(hc, dH, sk * 0.35), upv, sk * 0.38), dH, -sk * 0.32 * k);
    S.eye(p[0], p[1] - sk * 0.07 * k, hd.eyeSize * u * (k ? 0.72 : 1), ha);
  }
  { // brow ridge + cheek mass give the skull a believable structure
    const eb = add(add(hc, dH, sk * 0.35), upv, sk * 0.56);
    S.cap(add(eb, dH, -sk * 0.45), add(eb, dH, sk * 0.5), sk * 0.17, sk * 0.13, BODY, 'brow', 'skin');
    S.cap(add(add(hc, dn, sk * 0.1), dH, -sk * 0.1), add(add(hc, dn, sk * 0.12), dH, sk * 0.3), sk * 0.55, sk * 0.5, BODY, 'cheek', 'skin');
  }
  if (hd.teeth > 0 && hd.snout > 0) {
    const P0 = add(add(tip, dn, sk * 0.06), dH, sk * 0.08), P1 = add(add(hc, dn, sk * 0.2), dH, sk * 0.1);
    for (let k = 0; k < hd.teeth; k++) {
      const t = (k + 0.5) / hd.teeth, b0 = [lerp(P0[0], P1[0], t), lerp(P0[1], P1[1], t)], big = k % 4 === 1 ? 1.4 : 1;
      S.cap(b0, add(add(b0, dn, sk * 0.2 * big), dH, sk * 0.03), sk * 0.05, sk * 0.008, NEAR, 'tooth', 'claw');
    }
  }
  // --- tail
  const tA = 180 + tilt * 0.6, tPts = curvePts([sp[0].x, sp[0].y], tA, tl.length * u, -tl.curve, 18);
  const tRad = tPts.map((_, i) => Math.max(0.15 * u, sp[0].r * 0.9 * Math.pow(1 - i / 18, 0.85)));
  if (tl.length > 0) {
    S.chain(tPts, tRad, BODY, 'tail', 'skin');
    const te = tPts[18], ea = tA - tl.curve, dd = dirv(ea), nn = [dd[1], -dd[0]];
    if (tl.tip === 'club') S.cap(te, add(te, dd, u * 3), R * 0.45, R * 0.5, BODY, 'tailtip', 'horn');
    if (tl.tip === 'spade') S.poly([te, add(add(te, dd, 3 * u), nn, 3.5 * u), add(te, dd, 9 * u), add(add(te, dd, 3 * u), nn, -3.5 * u)], BODY, 'tailtip', 'membrane', 1.2 * u);
  }
  // --- limbs
  const contacts = [];
  const limbPair = (root, foot, l1, l2, rr, bend, layer, name, mat, footLen, toeR, claws, cSize, dig) => {
    const ankle = [foot[0] - dig * footLen * 0.4, foot[1] - dig * footLen * 0.8 - toeR * 0.2];
    const D = Math.hypot(ankle[0] - root[0], ankle[1] - root[1]);
    const s = ik(root, ankle, D * l1, D * l2, bend);
    S.chain([root, s.mid, s.end], rr, layer, name, mat);
    const toe = [foot[0] + footLen * 0.55, foot[1] - toeR * 0.5];
    S.cap(s.end, toe, rr[2], toeR, layer, name + 'foot', mat);
    addClaws(S, add(toe, [1, 0], toeR * 0.4), claws, cSize, u, layer);
    return toe;
  };
  for (let k = 0; k < pairs; k++) {
    const t = pairs === 1 ? 0.5 : lerp(0.14, 0.86, k / (pairs - 1)), p = spAt(sp, t), front = t > 0.5 || (pairs === 1 && !biped);
    const Tk = lg.thickness * u * (front ? 1 : 1.2);
    S.cap([p.x, p.y + p.r * 0.2], [p.x, p.y + p.r * 0.2], p.r * (front ? 0.78 : 0.88), p.r * (front ? 0.78 : 0.88), BODY, 'torso', 'skin');
    for (const side of [-1, 1]) {
      const near = side === 1, dx = (k % 2 ? -1 : 1) * side * lg.stride * legLen * 0.28;
      const root = [p.x, p.y + p.r * 0.35], foot = [p.x + dx, ground - 0.4 * u];
      const dig = front && !biped ? 0.25 * lg.digitigrade : lg.digitigrade;
      limbPair(root, foot, 0.6, 0.56, [Tk * 1.15, Tk * 0.7, Tk * 0.5], front ? 1 : -1, near ? NEAR : FAR, `leg${k}${near ? 'n' : 'f'}`, 'skin', lg.foot * u, Tk * 0.42, lg.claws, lg.clawSize, dig);
      contacts.push([foot[0] + lg.foot * u * 0.2, ground, lg.foot * u * 1.3]);
    }
  }
  if (biped && lg.arms > 0) {
    const p = spAt(sp, 0.86);
    for (const side of [-1, 1]) {
      const root = [p.x + 1.2 * u, p.y + p.r * 0.35], tgt = [root[0] + 7 * u + side * 1.5 * u, root[1] + 8 * u], D = Math.hypot(tgt[0] - root[0], tgt[1] - root[1]);
      const s = ik(root, tgt, D * 0.6, D * 0.6, 1), th = lg.thickness * u * 0.5;
      S.chain([root, s.mid, s.end], [th * 1.2, th * 0.8, th * 0.6], side === 1 ? NEAR : FAR, 'arm' + side, 'skin');
      addClaws(S, add(s.end, [1, 0], th * 0.5), lg.claws, lg.clawSize * 0.8, u, side === 1 ? NEAR : FAR, 20);
    }
  }
  // --- wings
  if (wg.span > 0) {
    const sh = spAt(sp, 0.7), sp0 = spAt(sp, 0.28), F = wg.fingers, bone = wg.bone * u, span = wg.span * u;
    for (const near of wg.pair ? [false, true] : [true]) {
      const adj = near ? 0 : -16, root = [sh.x - u, sh.y - sh.r * 0.7 + (near ? 0 : 1.5 * u)], a0 = wg.angle + adj, wa = a0 - 30;
      const el = add(root, dirv(a0), span * 0.3), wr = add(el, dirv(wa), span * 0.3);
      const fingers = [];
      for (let i = 0; i < F; i++) fingers.push(add(wr, dirv(lerp(wa + 62, wa + 150, i / Math.max(1, F - 1))), span * (0.58 - 0.05 * i)));
      const outline = [root, el, wr];
      for (let i = 0; i < F; i++) {
        outline.push(fingers[i]);
        if (i < F - 1) { const m = [(fingers[i][0] + fingers[i + 1][0]) / 2, (fingers[i][1] + fingers[i + 1][1]) / 2]; outline.push([lerp(m[0], wr[0], 0.2), lerp(m[1], wr[1], 0.2)]); }
      }
      outline.push([sp0.x, sp0.y - sp0.r * 0.2]);
      S.poly(outline, near ? NEAR : FAR, near ? 'wingMem' : 'wingMemF', 'membrane', 1.4 * u);
      const ly = near ? TOP : FAR;
      S.chain([root, el, wr], [bone * 1.4, bone * 1.1, bone * 0.9], ly, 'wingBone', 'skin');
      fingers.forEach(f => S.cap(wr, f, bone * 0.8, bone * 0.12, ly, 'wingBone', 'skin'));
    }
  }
  // --- crest along the dorsal line (tail tip → tail base → spine → neck)
  if (cr.count > 0 && cr.size > 0) {
    const dorsal = [];
    for (let i = (tl.length > 0 ? 18 : 0); i > 0 && tl.length > 0; i--) dorsal.push({ p: tPts[i], r: tRad[i] });
    sp.forEach((s, i) => dorsal.push({ p: [s.x, s.y], r: s.r }));
    if (nk.length > 0) nPts.forEach((p, i) => i > 0 && dorsal.push({ p, r: nRad[i] }));
    for (let c = 0; c < cr.count; c++) {
      const i = Math.round(lerp(2, dorsal.length - 2, (c + 0.5) / cr.count)), d0 = dorsal[i - 1].p, d1 = dorsal[i + 1].p;
      let tx = d1[0] - d0[0], ty = d1[1] - d0[1]; const tn = Math.hypot(tx, ty) || 1; tx /= tn; ty /= tn;
      const nrm = [ty, -tx], sd = [nrm[0] - tx * 0.55, nrm[1] - ty * 0.55], sl = Math.hypot(sd[0], sd[1]);
      const base = add(dorsal[i].p, nrm, dorsal[i].r * 0.85), size = cr.size * u * (0.6 + 0.4 * Math.sin(Math.PI * (c + 0.5) / cr.count));
      S.cap(base, add(base, sd, size / sl * 2.2), size * 0.3, size * 0.03, BODY, 'crest', 'horn');
    }
  }
  S.contacts.push([cx, ground, len * 0.42, 1], ...contacts.map(c => [...c, 0.6]));
  if (serp) S.contacts.push([cx, ground, len * 0.5, 1]);
}

function buildFront(S, spec, u, W, H) {
  const hm = spec.human, hd = spec.head, rnd = mulberry32(spec.seed * 7 + 1), sym = spec.rules.symmetry, m = hm.muscle;
  const ground = H * 0.9, cx = W / 2, hh = hm.height * u, hR = hh / hm.heads / 2.05;
  const top = ground - hh, skY = top + hR, jawR = hR * 0.74 * hm.jaw, jawY = skY + hR * 0.5, chin = jawY + jawR;
  const shY = chin + hR * 0.5 * hm.neck, pelY = ground - hh * 0.5, skinM = 'skin', cloth = hm.outfit ? 'cloth' : 'skin';
  // head
  S.cap([cx, skY], [cx, skY], hR, hR, BODY, 'head', skinM);
  S.cap([cx, jawY], [cx, jawY], jawR, jawR * 0.9, BODY, 'jaw', skinM);
  S.cap([cx, skY + hR * 0.25], [cx, skY + hR * 0.72], hR * 0.13, hR * 0.17, BODY, 'nose', skinM);
  S.cap([cx, jawY - hR * 0.2], [cx, shY + hR * 0.2], hR * (0.5 + 0.15 * m), hR * (0.55 + 0.2 * m), BODY, 'neck', skinM);
  // torso slices
  const sw = hR * 2.3 * hm.shoulder * (0.92 + 0.25 * m), hipH = hR * 1.2 * hm.hips * (0.95 + 0.1 * m);
  const y0 = shY + hR * 0.25, y1 = pelY + hR * 0.25, nS = Math.max(4, Math.ceil((y1 - y0) / (hR * 0.3)));
  for (let i = 0; i <= nS; i++) {
    const t = i / nS, y = lerp(y0, y1, t);
    const Wd = prof(t, [[0, sw * 0.8], [0.1, sw], [0.3, sw * 0.82], [0.65, sw * 0.56], [1, hipH]]);
    const r = prof(t, [[0, hR * 0.7], [0.3, hR * 0.85 * (1 + 0.2 * m)], [0.65, hR * 0.7], [1, hR * 0.8]]);
    const hl = Math.max(0, Wd - r);
    S.cap([cx - hl, y], [cx + hl, y], r, r, BODY, 'torso', t > 0.8 ? cloth : cloth);
    if (hm.outfit && Math.abs(t - 0.72) < 0.5 / nS) S.cap([cx - hl, y], [cx + hl, y], hR * 0.22, hR * 0.22, NEAR, 'belt', 'accent');
  }
  for (const s of [-1, 1]) S.cap([cx + s * sw * 0.36, y0 + hR * 0.95], [cx + s * sw * 0.36, y0 + hR * 0.95], hR * (0.42 + 0.34 * m), hR * (0.42 + 0.34 * m), BODY, 'pec' + s, cloth);
  // legs
  for (const s of [-1, 1]) {
    const hip = [cx + s * hipH * 0.55, pelY], ank = [cx + s * (hipH * 0.55 + hm.stance * u * 0.5), ground - hh * 0.045];
    const D = Math.hypot(ank[0] - hip[0], ank[1] - hip[1]), k = ik(hip, ank, D * 0.505, D * 0.505, -s);
    S.chain([hip, k.mid, k.end], [hR * (0.86 + 0.34 * m), hR * (0.54 + 0.16 * m), hR * 0.36], BODY, 'leg' + s, cloth);
    { const cv = [lerp(k.mid[0], k.end[0], 0.3), lerp(k.mid[1], k.end[1], 0.3)]; S.cap(cv, cv, hR * (0.5 + 0.14 * m), hR * (0.5 + 0.14 * m), BODY, 'calf' + s, cloth); }
    const toe = [ank[0] + s * hR * 0.45, ground - hR * 0.24];
    S.cap([ank[0], ground - hR * 0.3], toe, hR * 0.3, hR * 0.24, BODY, 'boot' + s, hm.outfit ? 'accent' : 'skin');
    S.contacts.push([ank[0] + s * hR * 0.2, ground, hR * 0.9, 0.7]);
  }
  S.contacts.push([cx, ground, hipH * 1.5, 1]);
  // arms
  for (const s of [-1, 1]) {
    const jit = sym ? 0 : (rnd() - 0.5) * 12, a = rad(hm.armAngle + jit), up = hh * 0.155, fo = hh * 0.135;
    const sh = [cx + s * (sw - hR * 0.45), shY + hR * 0.45], el = [sh[0] + s * Math.sin(a) * up, sh[1] + Math.cos(a) * up];
    const a2 = rad(hm.armAngle * 0.55 + hm.elbowBend + jit), wr = [el[0] + s * Math.sin(a2) * fo, el[1] + Math.cos(a2) * fo];
    S.cap(sh, sh, hR * (0.66 + 0.26 * m), hR * (0.66 + 0.26 * m), BODY, 'shoulder' + s, skinM);
    S.chain([sh, el, wr], [hR * (0.55 + 0.26 * m), hR * (0.42 + 0.14 * m), hR * 0.3], NEAR, 'arm' + s, skinM);
    { const fa = [lerp(el[0], wr[0], 0.28), lerp(el[1], wr[1], 0.28)]; S.cap(fa, fa, hR * (0.4 + 0.14 * m), hR * (0.4 + 0.14 * m), NEAR, 'arm' + s, skinM); }
    S.cap(wr, [wr[0] + s * Math.sin(a2) * hh * 0.065, wr[1] + Math.cos(a2) * hh * 0.065], hR * 0.3, hR * 0.22, NEAR, 'hand' + s, skinM);
  }
  // ears
  for (const s of [-1, 1]) {
    const base = [cx + s * hR * 0.98, skY + hR * 0.3], es = hd.earSize * u * 0.9;
    if (hd.ears === 'pointed') S.chain(curvePts(base, s > 0 ? 25 : 155, es, s * -8, 3), ramp(3, hR * 0.19, hR * 0.02), BODY, 'ear', skinM);
    else S.cap(base, add(base, [s, 0], hR * 0.12), hR * 0.2, hR * 0.18, BODY, 'ear', skinM);
  }
  // horns
  for (let k = 0; k < hd.horns; k++) {
    const f = (k + 0.5) / hd.horns, s = f > 0.5 ? 1 : -1, base = [cx + lerp(-0.62, 0.62, f) * hR, skY - hR * 0.78 + Math.abs(f - 0.5) * hR * 0.5];
    S.chain(curvePts(base, lerp(125, 55, f), hd.hornLength * u * (hd.horns > 2 ? 0.85 : 1), -s * hd.hornCurve * 70, 6), ramp(6, hR * 0.2, u * 0.08, 0.8), BODY, 'horn', 'horn');
  }
  // hair
  const hairLen = hm.hair;
  if (hairLen !== 'none') {
    const hy = skY - hR * 0.15;
    if (hairLen === 'long') S.cap([cx, skY], [cx, shY + hR * 1.6], hR * 1.15, hR * 0.95, FAR, 'hairBack', 'hair');
    else S.cap([cx, hy], [cx, hy], hR * 1.08, hR * 1.08, FAR, 'hairBack', 'hair');
    if (hairLen !== 'mohawk') {
      S.chain([[cx - hR * 0.92, skY + hR * 0.05], [cx - hR * 0.7, skY - hR * 0.62], [cx, skY - hR * 0.9], [cx + hR * 0.7, skY - hR * 0.62], [cx + hR * 0.92, skY + hR * 0.05]], [hR * 0.2, hR * 0.28, hR * 0.3, hR * 0.28, hR * 0.2], NEAR, 'fringe', 'hair');
    } else for (let k = -2; k <= 2; k++) { const b = [cx + k * hR * 0.14, skY - hR * 0.88]; S.cap(b, [b[0] + k * hR * 0.05, b[1] - hR * (0.75 - Math.abs(k) * 0.12)], hR * 0.16, hR * 0.03, NEAR, 'mohawk', 'hair'); }
  }
  // face detail
  const er = hR * 0.2 * hd.eyeSize / 1.5;
  for (const s of [-1, 1]) {
    S.eye(cx + s * hR * 0.42, skY + hR * 0.38, er, null);
    S.lines.push({ pts: [[cx + s * hR * 0.16, skY + hR * 0.1], [cx + s * hR * 0.44, skY + hR * 0.07], [cx + s * hR * 0.72, skY + hR * 0.18]], w: hR * 0.1, mat: 'hair' });
  }
  S.lines.push({ pts: [[cx - hR * 0.26, jawY - hR * 0.12], [cx, jawY - hR * 0.02], [cx + hR * 0.26, jawY - hR * 0.12]], w: hR * 0.1, mat: 'lip' });
}

function fitScene(S, spec, W, H) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const ext = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const p of S.prims) { if (p.t === 'cap') { ext(p.a[0], p.a[1], p.ra); ext(p.b[0], p.b[1], p.rb); } else p.pts.forEach(q => ext(q[0], q[1])); }
  const bw = x1 - x0, bh = y1 - y0, s = spec.frame.fit ? Math.min((0.9 * W) / bw, (0.82 * H) / bh) : 1, gy = H * 0.9;
  const f = p => [(p[0] - (x0 + x1) / 2) * s + W / 2, (p[1] - y1) * s + gy];
  for (const p of S.prims) { if (p.t === 'cap') { p.a = f(p.a); p.b = f(p.b); p.ra *= s; p.rb *= s; } else p.pts = p.pts.map(f); }
  S.contacts = S.contacts.map(c => { const q = f([c[0], c[1]]); return [q[0], q[1], c[2] * s, c[3]]; });
  S.bbox = { x: (x0 - (x0 + x1) / 2) * s + W / 2, y: (y0 - y1) * s + gy, w: bw * s, h: bh * s }; S.groundY = gy; S.s = s;
}

export function buildScene(spec, W, H) {
  const S = new Scene(), u = Math.min(W, H) / 100;
  (spec.kind === 'humanoid' ? buildFront : buildSide)(S, spec, u, W, H);
  for (const l of S.lines) { // mouth / brow grooves become thin shaded tubes
    const [p0, p1, p2] = l.pts, q = Array.from({ length: 5 }, (_, i) => { const t = i / 4, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]; });
    S.chain(q, q.map(() => Math.max(0.25 * u, l.w / 2)), NEAR, 'line_' + l.mat, l.mat);
  }
  for (const d of S.dots) S.cap(d.p, d.p, d.r, d.r, NEAR, 'nostril', 'mouth');
  fitScene(S, spec, W, H);
  S.u = u; S.eyeInfo = {};
  for (const p of S.prims) if (p.eye) S.eyeInfo[p.id] = { x: p.a[0], y: p.a[1], r: p.ra, look: p.look };
  return S;
}

// ============================ rasteriser ====================================
export function rasterize(S, w, h, ss) {
  const n = w * h, H = new Float32Array(n), NX = new Float32Array(n), NY = new Float32Array(n), NZ = new Float32Array(n), ID = new Uint8Array(n);
  const LAY = 40 * S.u * ss, K = 2.2 * S.u * ss;
  const put = (i, hgt, nx, ny, nz, id) => {
    if (!ID[i]) { H[i] = hgt; NX[i] = nx; NY[i] = ny; NZ[i] = nz; ID[i] = id; return; }
    const a = H[i], dd = hgt - a;
    if (dd > K) { H[i] = hgt; NX[i] = nx; NY[i] = ny; NZ[i] = nz; ID[i] = id; }
    else if (dd > -K) {
      const wg = clamp(0.5 + (0.5 * dd) / K); H[i] = lerp(a, hgt, wg) + K * wg * (1 - wg) * 0.5;
      let mx = lerp(NX[i], nx, wg), my = lerp(NY[i], ny, wg), mz = lerp(NZ[i], nz, wg); const l = Math.hypot(mx, my, mz) || 1;
      NX[i] = mx / l; NY[i] = my / l; NZ[i] = mz / l; if (wg > 0.5) ID[i] = id;
    }
  };
  for (const p of S.prims) {
    const base = p.layer * LAY;
    if (p.t === 'cap') {
      const ax = p.a[0] * ss, ay = p.a[1] * ss, bx = p.b[0] * ss, by = p.b[1] * ss, ra = p.ra * ss, rb = p.rb * ss, rm = Math.max(ra, rb);
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
      const xa = Math.max(0, Math.floor(Math.min(ax, bx) - rm)), xb = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rm));
      const ya = Math.max(0, Math.floor(Math.min(ay, by) - rm)), yb = Math.min(h - 1, Math.ceil(Math.max(ay, by) + rm));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const px = x + 0.5, py = y + 0.5, t = clamp(((px - ax) * dx + (py - ay) * dy) / l2);
        const ddx = px - (ax + t * dx), ddy = py - (ay + t * dy), r = ra + (rb - ra) * t, d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r * r) continue;
        const hz = Math.sqrt(r * r - d2);
        put(y * w + x, base + hz, ddx / r, ddy / r, hz / r, p.id);
      }
    } else {
      const pts = p.pts.map(q => [q[0] * ss, q[1] * ss]), hgt = base + p.thick * ss;
      let ya = 1e9, yb = -1e9; pts.forEach(q => { ya = Math.min(ya, q[1]); yb = Math.max(yb, q[1]); });
      for (let y = Math.max(0, Math.floor(ya)); y <= Math.min(h - 1, Math.ceil(yb)); y++) {
        const py = y + 0.5, xs = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          if ((a[1] <= py) !== (b[1] <= py)) xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) put(y * w + x, hgt, 0, 0, 1, p.id);
      }
    }
  }
  return { w, h, ss, H, NX, NY, NZ, ID, LAY };
}

// ============================ materials + shader ============================
function makeMaterials(spec) {
  const s = spec.skin, p = spec.palette, T = s.type, hum = spec.kind === 'humanoid', rg = 1 - s.roughness;
  // [spec, shininess, subsurface, gloss(second lobe), fuzz]
  const P = { scales: [0.6, 46, 0.12, 0.8 * rg, 0], fur: [0.05, 8, 0.2, 0, 0.9], skin: [0.3, 26, 0.55, 0.7 * rg, 0.12], feather: [0.18, 18, 0.2, 0.2, 0.5], chitin: [1.2, 100, 0.08, 1 * rg, 0] }[T] || [0.3, 20, 0.2, 0.3, 0];
  const rf = 1.25 - s.roughness, skinBase = hex(s.base);
  return {
    skin: { tex: T, base: skinBase, second: hex(s.secondary), belly: hum ? null : hex(s.belly), pattern: hum ? 'none' : s.pattern, spec: P[0] * rf, shin: P[1], sss: P[2], gloss: P[3], fuzz: P[4], sc: s.scale },
    horn: { tex: 'horn', base: hex(s.horn), spec: 0.6, shin: 40, sss: 0.1, gloss: 0.6, sc: 1 },
    claw: { tex: 'horn', base: mix3(hex(s.horn), [20, 18, 16], 0.3), spec: 1, shin: 70, sss: 0.05, gloss: 0.8, sc: 1 },
    membrane: { tex: 'membrane', base: hex(s.membrane), spec: 0.12, shin: 14, sss: 0.9, trans: 0.9, gloss: 0.1, sc: 1 },
    cloth: { tex: 'cloth', base: hex(p.cloth), spec: 0.04, shin: 8, sss: 0.15, fuzz: 0.35, gloss: 0, sc: 1 },
    hair: { tex: 'hair', base: hex(p.hair), spec: 0.5, shin: 36, sss: 0.1, gloss: 0.5, fuzz: 0.25, sc: 1 },
    accent: { tex: 'leather', base: hex(p.accent), spec: 0.3, shin: 24, sss: 0.1, gloss: 0.3, sc: 1 },
    mouth: { tex: 'none', base: mix3(skinBase, [30, 8, 10], 0.75), spec: 0.3, shin: 20, sss: 0.3, gloss: 0.5, sc: 1 },
    lip: { tex: 'skin', base: mix3(skinBase, [175, 70, 80], 0.5), spec: 0.4, shin: 30, sss: 0.5, gloss: 0.6, sc: 1 },
    eye: { tex: 'none', base: [235, 232, 226], spec: 2.4, shin: 240, sss: 0, gloss: 0, eye: true, sc: 1 },
  };
}
const TX = { dx: 0, dy: 0, ao: 1, mul: 1, cv: 0.5 };
function surfaceTex(tex, wx, wy, N, sc, ny, o) {
  o.dx = 0; o.dy = 0; o.ao = 1; o.mul = 1; o.cv = 0.5;
  switch (tex) {
    case 'scales': case 'feather': {
      const fe = tex === 'feather', sz = (fe ? 5 : 4) * sc, asp = fe ? 1.5 : 0.85, sy = wy / (sz * asp), row = Math.floor(sy);
      const sx = wx / sz + (row & 1 ? 0.5 : 0), fx = sx - Math.floor(sx) - 0.5, fy = sy - row - 0.5, d = Math.hypot(fx, fy * 0.85);
      o.cv = N(Math.floor(sx) + row * 37, row * 11);
      o.dx = fx * 0.9; o.dy = fy * 0.9;
      o.ao = fe ? 1 - 0.5 * sstep(0.05, 0.55, -fy + fx * fx * 1.2) : 1 - 0.5 * sstep(0.3, 0.62, d);
      o.mul = 0.86 + 0.28 * o.cv + (fe ? 0.1 * (N(wx * 0.35, wy * 0.05) - 0.5) : 0);
      if (!fe && ny > 0.4) { // wide ventral scutes on the belly
        const k = sstep(0.4, 0.7, ny), px = wx / (sz * 3.4) - Math.floor(wx / (sz * 3.4)) - 0.5, seam = sstep(0.38, 0.5, Math.abs(px));
        o.dx = lerp(o.dx, px * 1.3, k); o.dy = lerp(o.dy, 0, k); o.ao = lerp(o.ao, 1 - 0.55 * seam, k); o.mul = lerp(o.mul, 0.95 + 0.1 * N(Math.floor(wx / (sz * 3.4)), 3), k);
      }
      break;
    }
    case 'fur': {
      const sh = wx * 1.15 + wy * 0.45, a = N(sh, wy * 0.18), b = N(sh * 2.7 + 5, wy * 0.5), c = N(wx * 6, wy * 1.2), f = a * 0.45 + b * 0.35 + c * 0.2;
      o.mul = 0.5 + 0.95 * f; o.dx = (b - 0.5) * 1.1 + (c - 0.5) * 0.6; o.dy = (a - 0.5) * 0.4; o.ao = 0.7 + 0.3 * f; o.cv = a;
      break;
    }
    case 'skin': {
      const wr = Math.abs(N.fbm(wx * 0.06, wy * 0.06, 3) - 0.5);
      o.mul = 0.93 + 0.14 * N.fbm(wx * 0.35, wy * 0.35, 3) - 0.05 * (1 - sstep(0, 0.04, wr));
      o.dx = (N(wx * 1.3, wy * 1.3) - 0.5) * 0.25 + (N(wx * 0.08, wy * 0.08) - 0.5) * 0.3; o.dy = (N(wx * 1.3 + 31, wy * 1.3 + 7) - 0.5) * 0.25 + (N(wx * 0.08 + 5, wy * 0.08) - 0.5) * 0.3;
      o.cv = N.fbm(wx * 0.02, wy * 0.02, 2);
      break;
    }
    case 'chitin': { const sz = 16 * sc, wq = wy / sz + 0.9 * N.fbm(wx * 0.018, wy * 0.018, 2), fy = wq - Math.floor(wq), seam = sstep(0.9, 1, fy) + sstep(0.1, 0, fy); o.ao = 1 - 0.35 * seam; o.dy = (fy - 0.5) * 0.5; o.mul = 0.92 + 0.14 * N(wx * 0.08, wy * 0.08); o.dx = (N(wx * 0.9, wy * 0.9) - 0.5) * 0.12; break; }
    case 'cloth': { const w = Math.sin(wx * 2.2) * Math.sin(wy * 2.2); o.mul = 0.94 + 0.06 * w + 0.16 * (N.fbm(wx * 0.06, wy * 0.06, 2) - 0.25); o.dx = w * 0.08 + (N.fbm(wx * 0.05, wy * 0.05, 2) - 0.4) * 0.4; o.dy = (N.fbm(wx * 0.05 + 9, wy * 0.05, 2) - 0.4) * 0.4; break; }
    case 'hair': { const s = N(wx * 0.7, wy * 0.07), s2 = N(wx * 1.9, wy * 0.2); o.mul = 0.5 + 0.85 * s * (0.7 + 0.5 * s2); o.dx = (s - 0.5) * 0.6; o.ao = 0.75 + 0.25 * s; break; }
    case 'horn': { const s = 0.5 + 0.5 * Math.sin((wx + wy) * 0.7 + N(wx * 0.05, wy * 0.05) * 5); o.mul = 0.74 + 0.4 * s; o.dx = (s - 0.5) * 0.3; break; }
    case 'membrane': { const v = Math.abs(N.fbm(wx * 0.045 / sc, wy * 0.045 / sc, 3) - 0.5); o.mul = 0.85 + 0.3 * N.fbm(wx * 0.02, wy * 0.02, 3) - 0.3 * (1 - sstep(0, 0.045, v)); o.dx = (N.fbm(wx * 0.03, wy * 0.03, 2) - 0.45) * 1.6; o.dy = (N.fbm(wx * 0.03 + 9, wy * 0.03, 2) - 0.45) * 1.6; break; }
    case 'leather': o.mul = 0.9 + 0.2 * N.fbm(wx * 0.3, wy * 0.3, 2); o.dx = (N(wx * 0.9, wy * 0.9) - 0.5) * 0.2; break;
  }
}
function patternMask(spec, N, wx, wy, bb, ny) {
  const s = spec.skin, ps = s.patternScale, u0 = (wx - bb.x) / bb.w, v0 = (wy - bb.y) / bb.h;
  let m = 0;
  switch (s.pattern) {
    case 'stripes': m = sstep(0.25, 0.55, Math.sin(u0 * ps * 30 + N.fbm(wx * 0.02, wy * 0.02, 2) * 8)) * (1 - sstep(0.1, 0.8, ny)); break;
    case 'spots': m = sstep(0.62, 0.7, N(wx * 0.09 * ps, wy * 0.09 * ps)); break;
    case 'gradient': m = clamp(v0 * 1.1 - 0.05); break;
    case 'mottle': m = sstep(0.42, 0.62, N.fbm(wx * 0.03 * ps, wy * 0.03 * ps, 4)); break;
  }
  return m * s.patternStrength;
}
const lin = c => (c / 255) * (c / 255);

/** Physically-flavoured shader. Returns linear HDR RGBA (premultiplied; alpha 0 = empty). */
export function shadeHDR(spec, S, B) {
  const { w, h, ss, H, NX, NY, NZ, ID, LAY } = B, out = new Float32Array(w * h * 4), L = spec.light;
  const N = makeNoise(spec.seed | 0), M = makeMaterials(spec), su = S.u * ss, ts = w / ss / 640, bb = S.bbox;
  const az = rad(L.azimuth), el = rad(L.elevation), lx = Math.cos(az) * Math.cos(el), ly = -Math.sin(az) * Math.cos(el), lz = Math.sin(el);
  const hl = Math.hypot(lx, ly, lz + 1), hx = lx / hl, hy = ly / hl, hz = (lz + 1) / hl, l2 = Math.hypot(lx, ly) || 1;
  const key = hex(L.color).map(lin), sky = hex(L.sky).map(lin), gnd = hex(L.ground).map(lin), rim = hex(L.rimColor).map(lin);
  const eyeCol = hex(spec.eye.color).map(lin), glow = spec.eye.glow, kind = spec.kind;
  const ring = []; for (const [r, wt] of [[2.5 * su, 1], [6 * su, 0.8], [12 * su, 0.6]]) for (let k = 0; k < 8; k++) ring.push([Math.round(Math.cos(k * 0.7854 + r) * r), Math.round(Math.sin(k * 0.7854 + r) * r), wt]);
  let wsum = 0; for (const r of ring) wsum += r[2];
  const stepPx = 1.0 * su, slope = lz / l2, sdx = lx / l2, sdy = ly / l2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, id = ID[i]; if (!id) continue;
    const part = S.parts[id], m = M[part.mat] || M.skin, wx = x / ss, wy = y / ss, hc = H[i], isFur = m.tex === 'fur';
    let nx = NX[i], ny = NY[i], nz = NZ[i];
    const snx = nx, sny = ny, snz = nz; // smooth (geometric) normal
    if (!m.eye) {
      surfaceTex(m.tex, wx, wy, N, m.sc * ts, ny, TX);
      if ((isFur || m.tex === 'feather') && nz < 0.5 && N(wx * 3.1, wy * 3.1) > nz * 2.4 + 0.15 * (m.tex === 'feather' ? 1 : 0)) continue; // ragged fuzzy silhouette
      const bump = (m === M.skin ? spec.skin.bump : 1) * 0.55;
      nx += TX.dx * bump; ny += TX.dy * bump; { const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    } else { TX.dx = 0; TX.dy = 0; TX.ao = 1; TX.mul = 1; }
    // ---- albedo
    let alb = m.base, emit0 = 0, emit1 = 0, emit2 = 0;
    if (m === M.skin) {
      const pm = patternMask(spec, N, wx, wy, bb, ny); if (pm > 0) alb = mix3(alb, m.second, pm);
      if (m.belly) alb = mix3(alb, m.belly, sstep(0.15, 0.85, ny));
      if (m.tex === 'scales' || m.tex === 'feather') alb = mix3(alb, m.second, (TX.cv - 0.5) * 0.3 + 0.08);
      else if (m.tex === 'skin' && kind === 'humanoid') alb = mix3(alb, [185, 70, 60], 0.14 * sstep(0.45, 0.8, TX.cv));
      const v = 0.88 + 0.24 * N.fbm(wx * 0.05, wy * 0.05, 3); alb = [alb[0] * v, alb[1] * v, alb[2] * v];
    }
    let a0 = lin(clamp(alb[0] * TX.mul, 0, 255)), a1 = lin(clamp(alb[1] * TX.mul, 0, 255)), a2 = lin(clamp(alb[2] * TX.mul, 0, 255));
    let eyeMul = 1;
    if (m.eye) { // procedural wet eye: iris fibres, limbal ring, pupil, lids
      const ei = S.eyeInfo[id], lxp = (wx - ei.x) / ei.r, lyp = (wy - ei.y) / ei.r, rr = Math.hypot(lxp, lyp);
      const off = ei.look == null ? [0, 0.05] : [Math.cos(rad(ei.look)) * 0.26, -Math.sin(rad(ei.look)) * 0.26];
      const irisR = spec.eye.sclera ? 0.58 : 0.98, ix = lxp - off[0], iy = lyp - off[1], d = Math.hypot(ix, iy) / irisR;
      a0 = 0.8; a1 = 0.78; a2 = 0.74; a0 *= 1; // sclera
      const vein = N(wx * 0.5, wy * 0.5); a1 -= 0.1 * sstep(0.62, 0.85, vein) * sstep(0.5, 1, rr); a2 -= 0.1 * sstep(0.62, 0.85, vein) * sstep(0.5, 1, rr);
      if (d < 1) {
        const ang = Math.atan2(iy, ix), fib = 0.7 + 0.6 * N(ang * 3 + 7, d * 5), t = d, pp = spec.head.pupil;
        const k = Math.pow(sstep(0.15, 1, t), 1.2), dark = mix3(eyeCol.map(c => c * 0.25), eyeCol, 0.5 + 0.5 * k).map(c => c * fib);
        const lim = 1 - 0.65 * sstep(0.76, 1, t);
        const pm = (spec.eye.sclera || pp === 'round') ? sstep(0.46, 0.4, d) : pp === 'slit' ? sstep(1.05, 0.9, Math.hypot(ix / irisR / 0.17, iy / irisR / 0.85)) : sstep(1.05, 0.9, Math.hypot(ix / irisR / 0.8, iy / irisR / 0.27));
        const c = (q) => q * lim * (1 - pm * 0.97); const edge = sstep(1, 0.93, d);
        a0 = lerp(a0, c(dark[0]), edge); a1 = lerp(a1, c(dark[1]), edge); a2 = lerp(a2, c(dark[2]), edge);
        if (glow > 0) { const g = glow * (1 - pm) * edge * (0.5 + 0.8 * (1 - t)); emit0 += eyeCol[0] * g; emit1 += eyeCol[1] * g; emit2 += eyeCol[2] * g; }
      }
      eyeMul = (0.35 + 0.65 * sstep(-1, -0.1, lyp)) * (0.55 + 0.45 * sstep(1, 0.8, rr)) * (0.8 + 0.2 * sstep(1, 0.4, lyp));
    }
    // ---- occlusion + soft cast shadow from the height field
    let occ = 0;
    for (const [ox, oy, wt] of ring) { const xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (ID[j]) occ += wt * clamp((H[j] - hc) / (6 * su)); }
    const ao = (1 - 0.72 * (occ / wsum)) * TX.ao * eyeMul;
    let sh = 0;
    for (let k = 1; k <= 8; k++) {
      const xx = Math.round(x + sdx * stepPx * k), yy = Math.round(y + sdy * stepPx * k); if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
      const j = yy * w + xx; if (ID[j] && H[j] > hc + slope * stepPx * k + 0.5 && H[j] - hc < LAY * 0.9) sh = Math.max(sh, 1 - (k - 1) / 9);
    }
    const shadow = 1 - 0.65 * sh, ndl = nx * lx + ny * ly + nz * lz, sg = m.sss;
    const dR = Math.max(0, (ndl + sg) / (1 + sg)), dG = Math.max(0, (ndl + sg * 0.45) / (1 + sg * 0.45)), dB = Math.max(0, (ndl + sg * 0.25) / (1 + sg * 0.25));
    const hemi = clamp(0.5 - 0.5 * ny), amb = L.ambient * ao, I = L.intensity * shadow;
    // specular: two lobes + sky/ground reflection with Fresnel
    const nh = Math.max(0, nx * hx + ny * hy + nz * hz), lit = ndl > 0 ? 1 : 0;
    const sp = (Math.pow(nh, m.shin) * 0.6 + Math.pow(nh, m.shin * 5) * (m.gloss || 0) * 2) * m.spec * L.specular * shadow * lit * (0.4 + 0.6 * ao);
    const fr = 0.04 + 0.96 * Math.pow(1 - nz, 5), ry = 2 * nz * ny, envK = fr * (m.spec * 0.8 + 0.1) * L.specular * ao * (m.eye ? 6 : 1);
    const rimT = Math.pow(1 - nz, 3) * L.rim * (0.4 + 0.6 * clamp(-(snx * lx + sny * ly) / l2)) * (0.6 + 0.4 * ao);
    const fz = (m.fuzz || 0) * Math.pow(1 - snz, 2);
    const tr = (m.trans || 0) * Math.max(0, -ndl) * L.intensity;
    const far = Math.floor(hc / LAY) <= FAR ? 0.7 : 1;
    const ch = (a, dd, k, g, r, em, ci) => (a * (amb * lerp(gnd[ci], sky[ci], hemi) + I * dd * k + tr * k * 0.8 + fz * (0.35 * lerp(gnd[ci], sky[ci], hemi) + 0.25 * k * Math.max(0, 0.3 + ndl))) + sp * k + envK * lerp(gnd[ci], sky[ci], clamp(0.5 - 0.5 * ry)) + rimT * r + em) * far;
    const o = i * 4; out[o] = ch(a0, dR, key[0], 0, rim[0], emit0, 0); out[o + 1] = ch(a1, dG, key[1], 0, rim[1], emit1, 1); out[o + 2] = ch(a2, dB, key[2], 0, rim[2], emit2, 2); out[o + 3] = 1;
  }
  return out;
}

// ---------- image ops (pure array code: same path in browser, worker and Node) ----------
function resizeF(src, w, h, W, H, ch = 4) {
  if (w === W && h === H) return src;
  const out = new Float32Array(W * H * ch), sx = w / W, sy = h / H;
  if (sx >= 1) { // box (area) filter
    for (let y = 0; y < H; y++) { const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * sy)));
      for (let x = 0; x < W; x++) { const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * sx))), n = (x1 - x0) * (y1 - y0), acc = new Array(ch).fill(0);
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * w + xx) * ch; for (let c = 0; c < ch; c++) acc[c] += src[i + c]; }
        const o = (y * W + x) * ch; for (let c = 0; c < ch; c++) out[o + c] = acc[c] / n; } }
  } else { // bilinear
    for (let y = 0; y < H; y++) { const fy = clamp((y + 0.5) * sy - 0.5, 0, h - 1), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < W; x++) { const fx = clamp((x + 0.5) * sx - 0.5, 0, w - 1), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0, o = (y * W + x) * ch;
        for (let c = 0; c < ch; c++) out[o + c] = lerp(lerp(src[(y0 * w + x0) * ch + c], src[(y0 * w + x1) * ch + c], tx), lerp(src[(y1 * w + x0) * ch + c], src[(y1 * w + x1) * ch + c], tx), ty); } }
  }
  return out;
}
function blurBox(a, w, h, r, ch) { // separable box blur, in place
  const t = new Float32Array(a.length);
  for (let pass = 0; pass < 2; pass++) {
    const [s, d, horiz] = pass === 0 ? [a, t, true] : [t, a, false], len = horiz ? w : h, cnt = horiz ? h : w;
    for (let l = 0; l < cnt; l++) for (let c = 0; c < ch; c++) {
      const idx = k => (horiz ? l * w + k : k * w + l) * ch + c; let acc = 0;
      for (let k = -r; k <= r; k++) acc += s[idx(clamp(k, 0, len - 1))];
      for (let k = 0; k < len; k++) { d[idx(k)] = acc / (2 * r + 1); acc += s[idx(Math.min(len - 1, k + r + 1))] - s[idx(Math.max(0, k - r))]; }
    }
  }
}
const aces = x => { x = Math.max(0, x); return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); };

/** Studio set + reflection + bloom + filmic tone-map + grade + grain → 8-bit RGBA. */
export function composeFrame(spec, S, B, W, H) {
  const cre = resizeF(shadeHDR(spec, S, B), B.w, B.h, W, H), bg = spec.background, g = spec.grade, L = spec.light;
  const top = hex(bg.top).map(lin), bot = hex(bg.bottom).map(lin), flo = hex(bg.ground).map(lin), glowC = mix3(hex(L.color).map(lin), [1, 1, 1], 0.3);
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const gy = S.groundY, hy = gy - H * 0.14, cxs = W / 2, cys = H * 0.5, N = makeNoise((spec.seed | 0) + 99), rf = g.reflection;
  const px = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H, o = (y * W + x) * 3; let c = mix3(top, bot, Math.pow(t, 0.8));
    const gl = Math.exp(-(Math.pow((x - cxs) / (W * 0.45), 2) + Math.pow((y - cys) / (H * 0.5), 2)) * 1.6) * 0.45 * (L.intensity * 0.6 + 0.4);
    c = [c[0] + glowC[0] * gl * lum(bot) * 1.4, c[1] + glowC[1] * gl * lum(bot) * 1.4, c[2] + glowC[2] * gl * lum(bot) * 1.4];
    const fm = sstep(hy, hy + H * 0.12, y);
    if (fm > 0) {
      const tex = 0.85 + 0.3 * N.fbm(x * 0.012, y * 0.05, 3) + 0.08 * N(x * 0.6, y * 0.6), depth = (y - hy) / (H - hy);
      let fc = flo.map((v, i) => v * tex * (0.8 + 0.5 * (1 - depth)) + glowC[i] * gl * 0.12);
      if (rf > 0 && y > gy) { // glossy floor reflection of the subject
        const yy = 2 * gy - y, fade = rf * Math.exp(-(y - gy) / (H * 0.07)), wob = (N(x * 0.05, y * 0.4) - 0.5) * 3;
        if (yy >= 0 && yy < H - 1) { const xi = clamp(Math.round(x + wob), 0, W - 1), i = (Math.round(yy) * W + xi) * 4; fc = [fc[0] + cre[i] * fade, fc[1] + cre[i + 1] * fade, fc[2] + cre[i + 2] * fade]; }
      }
      c = mix3(c, fc, fm);
    }
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
  }
  for (const [cx, cy, rx, k] of S.contacts) { // contact shadows (multiplicative)
    const ox = -Math.cos(rad(L.azimuth)) * rx * 0.25, ry = rx * 0.16, x0 = Math.max(0, Math.floor(cx + ox - rx * 1.6)), x1 = Math.min(W - 1, Math.ceil(cx + ox + rx * 1.6));
    for (let y = Math.max(0, Math.floor(cy - ry * 3)); y <= Math.min(H - 1, Math.ceil(cy + ry * 3)); y++) for (let x = x0; x <= x1; x++) {
      const v = Math.exp(-(Math.pow((x - cx - ox) / rx, 2) + Math.pow((y - cy) / ry, 2)) * 2.2) * bg.shadow * k, o = (y * W + x) * 3, m = 1 - v * 0.9; px[o] *= m; px[o + 1] *= m; px[o + 2] *= m;
    }
  }
  for (let i = 0, n = W * H; i < n; i++) { const a = cre[i * 4 + 3], o = i * 3; px[o] = cre[i * 4] + px[o] * (1 - a); px[o + 1] = cre[i * 4 + 1] + px[o + 1] * (1 - a); px[o + 2] = cre[i * 4 + 2] + px[o + 2] * (1 - a); }
  // bloom (quarter-res bright pass, blurred, added back)
  if (g.bloom > 0) {
    const bw = Math.max(8, W >> 2), bh = Math.max(8, H >> 2), br = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H * 3; i++) br[i] = Math.max(0, px[i] - 0.9);
    const small = resizeF(br, W, H, bw, bh, 3); blurBox(small, bw, bh, Math.max(2, bw >> 5), 3); blurBox(small, bw, bh, Math.max(3, bw >> 4), 3);
    const big = resizeF(small, bw, bh, W, H, 3); for (let i = 0; i < W * H * 3; i++) px[i] += big[i] * g.bloom * 2.2;
  }
  // tone map, grade, vignette, chromatic aberration, grain → 8-bit
  const out = new Uint8ClampedArray(W * H * 4), rnd = mulberry32((spec.seed | 0) + 7), ca = g.ca;
  const tone = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3; let r = aces(px[o] * g.exposure * (1 + g.warmth * 0.08)), gg = aces(px[o + 1] * g.exposure), b = aces(px[o + 2] * g.exposure * (1 - g.warmth * 0.08));
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    r = l + (r - l) * g.saturation; gg = l + (gg - l) * g.saturation; b = l + (b - l) * g.saturation;
    const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2), vg = 1 - bg.vignette * clamp((dx * dx + dy * dy) * 0.55);
    tone[o] = clamp((Math.pow(clamp(r), 1 / 2.2) - 0.5) * g.contrast + 0.5) * vg; tone[o + 1] = clamp((Math.pow(clamp(gg), 1 / 2.2) - 0.5) * g.contrast + 0.5) * vg; tone[o + 2] = clamp((Math.pow(clamp(b), 1 / 2.2) - 0.5) * g.contrast + 0.5) * vg;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2), sh = Math.round(ca * dx * Math.abs(dx) * 2), xr = clamp(x + sh, 0, W - 1), xb = clamp(x - sh, 0, W - 1), o = (y * W + x) * 4, gr = (rnd() - 0.5) * g.grain * 2;
    out[o] = (tone[(y * W + xr) * 3] + gr) * 255; out[o + 1] = (tone[(y * W + x) * 3 + 1] + gr) * 255; out[o + 2] = (tone[(y * W + xb) * 3 + 2] + gr) * 255; out[o + 3] = 255;
  }
  return out;
}

const QUALITY = { draft: 0.55, standard: 1, high: 2, ultra: 3 };
/** Pure, DOM-free render of a validated spec → { rgba, W, H, scene, buf }. Runs in a Worker or in Node. */
export function renderFrame(spec, quality = 'high', cache = null) {
  const W = spec.frame.width, H = spec.frame.height, ss = QUALITY[quality] || 2;
  const S = cache?.scene || buildScene(spec, W, H), B = cache?.buf || rasterize(S, Math.round(W * ss), Math.round(H * ss), ss);
  return { rgba: composeFrame(spec, S, B, W, H), W, H, scene: S, buf: B };
}

/** Conditioning passes from the same buffers (depth / normal / mask / lineart). */
export function makePass(kind, S, B) {
  const { w, h, H, NX, NY, NZ, ID, LAY } = B, out = new Uint8ClampedArray(w * h * 4);
  let mn = 1e30, mx = -1e30;
  if (kind === 'depth') for (let i = 0; i < w * h; i++) if (ID[i]) { mn = Math.min(mn, H[i]); mx = Math.max(mx, H[i]); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4, id = ID[i]; let r = 0, g = 0, b = 0;
    if (kind === 'normal') { r = 128; g = 128; b = 255; }
    if (kind === 'lineart') r = g = b = 255;
    if (id) {
      if (kind === 'depth') r = g = b = 40 + 215 * ((H[i] - mn) / (mx - mn || 1));
      else if (kind === 'normal') { r = (NX[i] * 0.5 + 0.5) * 255; g = (-NY[i] * 0.5 + 0.5) * 255; b = (NZ[i] * 0.5 + 0.5) * 255; }
      else if (kind === 'mask') [r, g, b] = S.parts[id].color;
    }
    if (kind === 'lineart') {
      let e = false;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const xx = x + dx, yy = y + dy, j = yy * w + xx, ok = xx >= 0 && yy >= 0 && xx < w && yy < h;
        const jid = ok ? ID[j] : 0;
        if (jid !== id && (id || jid)) { if (id) e = true; }
        else if (id && ok && (Math.abs(H[j] - H[i]) > LAY * 0.5 || NX[i] * NX[j] + NY[i] * NY[j] + NZ[i] * NZ[j] < 0.78)) e = true;
      }
      if (e) r = g = b = 0;
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return out;
}

// ============================ prompt text ===================================
export function describeSpec(spec) {
  const s = spec.skin, bits = [];
  if (spec.kind === 'humanoid') bits.push(`${spec.name}, humanoid character, ${spec.human.heads.toFixed(1)}-head proportions, ${spec.human.muscle > 0.7 ? 'heavily muscular' : spec.human.muscle < 0.25 ? 'slender' : 'athletic'} build, ${spec.human.hair} hair`);
  else bits.push(`${spec.name}, ${spec.kind} creature, ${spec.limbs.pairs ? spec.limbs.pairs * 2 + ' legs' : 'limbless'}`);
  bits.push(`${s.type === 'skin' ? 'skin' : s.type} surface, ${s.base} base colour${s.pattern !== 'none' && spec.kind !== 'humanoid' ? ', ' + s.pattern : ''}`);
  if (spec.head.horns) bits.push(`${spec.head.horns} horns`); if (spec.wings.span > 0 && spec.kind !== 'humanoid') bits.push('large membrane wings');
  if (spec.head.ears === 'pointed') bits.push('pointed ears');
  bits.push(`${spec.eye.color} eyes`, 'full body, cinematic lighting, highly detailed, photorealistic');
  return bits.join(', ');
}

// ============================ imagine: prompt -> spec =======================
const COLORS = {
  red: '#a8322d', crimson: '#8f1d2c', scarlet: '#c0261f', maroon: '#5a1a22', orange: '#c8672a', rust: '#8a4a2a', copper: '#a8643a', bronze: '#8a6a3a',
  amber: '#d8962a', gold: '#c9a23a', golden: '#c9a23a', yellow: '#d8c04a', lime: '#8ab83a', green: '#4f7a4a', emerald: '#1f8a5a', olive: '#6b7a3a', moss: '#566b3a',
  teal: '#2a8a8a', turquoise: '#2aa8a0', cyan: '#2ab0c8', blue: '#35609a', azure: '#3a80c8', navy: '#232f5a', indigo: '#3a2f7a', purple: '#6a3a8a', violet: '#7a4ab0',
  magenta: '#b02a7a', pink: '#c86a8a', white: '#e8e6df', ivory: '#d8cfb8', bone: '#d0c8b0', cream: '#e6dcc0', grey: '#76787c', gray: '#76787c', silver: '#a9adb3',
  black: '#1c1c20', obsidian: '#17151c', charcoal: '#34363a', brown: '#6a4a30', tan: '#b8946a', sand: '#c8b080', blonde: '#d8c27a', auburn: '#7a3a22', ginger: '#b8602a',
};
const CW = Object.keys(COLORS).sort((a, b) => b.length - a.length).join('|');
const NUMW = { one: 1, a: 1, single: 1, two: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, many: 4, multiple: 4, '1': 1, '2': 2, '3': 3, '4': 4, '6': 6, '8': 8 };
const hashStr = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 99999; };
const KINDS = [
  [/\b(elf|elven|elves|fae|nymph|archer|ranger)\b/, 'elf'],
  [/\b(orc|ogre|troll|goblin|brute|giant|barbarian|gladiator)\b/, 'brute'],
  [/\b(demon|devil|tiefling|imp|succubus|incubus)\b/, 'tiefling'],
  [/\b(spider|insect|beetle|scorpion|ant|mantis|crab|arachnid|bug|stalker|centipede|crawler)\b/, 'insectoid'],
  [/\b(snake|serpent|eel|worm|naga|basilisk|python|cobra|leviathan|sea monster)\b/, 'serpent'],
  [/\b(raptor|dinosaur|theropod|t-?rex|tyrannosaur|velociraptor|cockatrice|bird|rooster|ostrich)\b/, 'raptor'],
  [/\b(dragon|drake|wyvern|hydra|lizard|gecko|crocodile|alligator|salamander|komodo)\b/, 'drake'],
  [/\b(wolf|dog|hound|fox|jackal|lion|tiger|panther|cat|bear|boar|werewolf|hyena|cougar|lynx|horse|deer|stag)\b/, 'wolf'],
  [/\b(knight|warrior|human|man|woman|girl|boy|hero|heroine|soldier|mage|wizard|witch|pirate|king|queen|person|character|adventurer|samurai|ninja)\b/, 'hero'],
  [/\b(beast|monster|creature|animal)\b/, 'wolf'],
];
const SCENES = [
  [/sunset|golden hour|sunrise|dusk|dawn/, { light: { azimuth: 20, elevation: 14, color: '#ffb070', intensity: 1.5, sky: '#ff9a70', rimColor: '#ffd0a0', ambient: 0.45 }, background: { top: '#4a3550', bottom: '#e89a60', ground: '#3a2a26' } }, 'sunset lighting'],
  [/moonlit|moonlight|night|midnight|nocturnal|starlit/, { light: { azimuth: 60, elevation: 35, color: '#a8c0ff', intensity: 0.9, sky: '#4a6aff', ambient: 0.4, rimColor: '#7aa0ff' }, background: { top: '#080c1c', bottom: '#25324f', ground: '#12161f' } }, 'moonlit night'],
  [/neon|cyberpunk|synthwave|futuristic|sci-?fi/, { light: { azimuth: 150, elevation: 30, color: '#8a6aff', sky: '#2affd8', rimColor: '#ff3ac8', rim: 1.4, intensity: 1.2, ambient: 0.4 }, background: { top: '#0c0620', bottom: '#3a1a5a', ground: '#14081f' } }, 'neon lighting'],
  [/dramatic|moody|cinematic|noir|horror|menacing|sinister/, { light: { intensity: 1.7, ambient: 0.22, rim: 1.3, elevation: 30 } }, 'dramatic lighting'],
  [/studio|clean|neutral|product|concept art|turnaround/, { light: { azimuth: 130, elevation: 50, color: '#ffffff', sky: '#ffffff', intensity: 1.1, ambient: 0.7 }, background: { top: '#c8ccd2', bottom: '#e8eaee', ground: '#d0d3d8' } }, 'clean studio set'],
  [/fog|mist|haze|swamp|bog/, { background: { top: '#8a9a96', bottom: '#c4ccc6', ground: '#4a5248', vignette: 0.2 }, light: { color: '#e6f0ea', intensity: 0.9, ambient: 0.7 } }, 'misty set'],
  [/forest|jungle|woods/, { background: { top: '#1d2a22', bottom: '#4d6a4a', ground: '#2a2a1e' }, light: { color: '#f0ffd8', sky: '#7aa878' } }, 'forest set'],
  [/desert|dune|savanna|arid|canyon/, { background: { top: '#d8a870', bottom: '#f0d8a8', ground: '#b08a58' }, light: { color: '#fff0c8', elevation: 62 } }, 'desert set'],
  [/snow|ice|arctic|glacier|frozen|tundra/, { background: { top: '#9ab0c8', bottom: '#e8f0f8', ground: '#d8e4ee' }, light: { color: '#eaf2ff', sky: '#c8e0ff', ambient: 0.8 } }, 'snow set'],
  [/volcan|lava|fire|infernal|hell|ember/, { background: { top: '#2a0f0a', bottom: '#b04a1a', ground: '#2a1a14' }, light: { color: '#ffb070', rimColor: '#ff6a2a', rim: 1.3 } }, 'volcanic set'],
  [/cave|dungeon|underground|crypt/, { background: { top: '#0a0a0e', bottom: '#2a2a34', ground: '#16161c', vignette: 0.55 }, light: { intensity: 1.3, ambient: 0.3 } }, 'cave set'],
  [/ocean|sea|underwater|reef|lagoon/, { background: { top: '#0a3a5a', bottom: '#4aa8b8', ground: '#2a5a68' }, light: { color: '#c8f0ff', sky: '#3ab0d8' } }, 'ocean set'],
];
const tint = (h, to, k) => rgbHex(mix3(hex(h), to, k));

/**
 * Built-in prompt interpreter: free text -> partial spec. It is a deterministic keyword/lexicon
 * parser (no neural net, fully offline). For free-form creativity plug in an LLM via studio.llm.
 * Returns { patch, notes } — `notes` lists what was understood so the UI can show it.
 */
export function interpretPrompt(prompt, seed = hashStr(prompt)) {
  const t = ' ' + String(prompt).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ') + ' ', notes = [];
  let preset = null;
  for (const [re, k] of KINDS) if (re.test(t)) { preset = k; break; }
  if (!preset) { preset = 'drake'; notes.push('No creature type recognised, so I started from a drake'); } else notes.push(`Body plan: ${PRESETS[preset].name}`);
  const patch = clone(PRESETS[preset]);
  const eff = () => deepMerge(clone(DEFAULT_SPEC), clone(patch));
  const mod = (path, f) => setPath(patch, path, f(getPath(eff(), path)));
  const set = (path, v) => setPath(patch, path, v), has = re => re.test(t), hum = patch.kind === 'humanoid';
  const num = (m, d = 2) => NUMW[m] || d;
  // --- build / anatomy
  if (has(/\b(huge|massive|giant|enormous|colossal|hulking|bulky|brawny|muscular|powerful|stocky)\b/)) { mod('body.thickness', v => v * 1.2); mod('limbs.thickness', v => v * 1.25); mod('human.muscle', v => Math.min(1, v + 0.35)); mod('human.shoulder', v => v * 1.12); notes.push('Heavy, muscular build'); }
  if (has(/\b(slender|lean|skinny|lithe|graceful|sleek|slim|elegant)\b/)) { mod('body.thickness', v => v * 0.82); mod('limbs.thickness', v => v * 0.85); mod('human.muscle', v => Math.max(0, v - 0.3)); mod('human.shoulder', v => v * 0.92); notes.push('Slender build'); }
  if (has(/\b(tiny|small|cute|baby|little|chibi|kawaii)\b/)) { mod('head.size', v => v * 1.3); mod('head.eyeSize', v => v * 1.4); if (hum) set('rules.proportions', 'chibi'); notes.push('Small and cute proportions'); }
  if (has(/\b(long[- ]neck|elongated neck|swan|giraffe|graceful neck)\b/)) { mod('neck.length', v => v * 1.6); notes.push('Long neck'); }
  if (has(/\b(long[- ]tail|whip[- ]tail|serpentine tail)\b/)) { mod('tail.length', v => v * 1.5); notes.push('Long tail'); }
  if (has(/\b(tailless|no tail)\b/)) { set('tail.length', 0); notes.push('No tail'); } else if (has(/\b(short[- ]tail|stub tail|bobtail)\b/)) { mod('tail.length', v => v * 0.4); }
  if (has(/\b(club tail|mace tail)\b/)) set('tail.tip', 'club'); if (has(/\b(spade tail|arrow tail|demon tail)\b/)) set('tail.tip', 'spade');
  if (!hum) {
    if (has(/\b(six|6)[- ]?(legged|legs)\b/)) { set('kind', 'quadruped'); set('limbs.pairs', 3); notes.push('Six legs'); }
    if (has(/\b(eight|8)[- ]?(legged|legs)\b/)) { set('kind', 'quadruped'); set('limbs.pairs', 4); notes.push('Eight legs'); }
    if (has(/\b(biped|bipedal|upright|two[- ]legged)\b/) && patch.kind !== 'serpent') { set('kind', 'biped'); set('limbs.pairs', 1); set('limbs.arms', 1); notes.push('Bipedal stance'); }
    if (has(/\b(four[- ]legged|quadruped)\b/) && patch.kind === 'biped') { set('kind', 'quadruped'); set('limbs.pairs', 2); }
    if (has(/\b(legless|limbless)\b/)) { set('kind', 'serpent'); set('limbs.pairs', 0); }
    if (has(/\b(wingless|no wings)\b/)) set('wings.span', 0);
    else if (has(/\b(wing|wings|winged|bat-?like|angelic|griffin|wyvern|flying)\b/)) { mod('wings.span', v => Math.max(v, mod2(eff().body.length * 1.25))); notes.push('Membrane wings'); }
    if (has(/\b(spike|spikes|spiked|spiny|spines|crest|frill|dorsal|thorny)\b/)) { set('crest.count', 11); set('crest.size', 3.6); notes.push('Dorsal spikes'); }
    if (has(/\b(smooth|sleek)\b/) && !has(/spike/)) set('crest.count', 0);
    if (has(/\b(claw|claws|clawed|talon|talons)\b/)) { set('limbs.claws', 4); set('limbs.clawSize', 2.4); notes.push('Large claws'); }
  }
  if (has(/\b(horn|horns|horned|antler|antlers|unicorn|stag|deer|ram)\b/)) {
    const m = t.match(/\b(one|two|three|four|a single|single|2|3|4)[- ](?:long |curved |large |twisted )?horns?\b/), n = m ? num(m[1].replace('a ', '')) : 2;
    set('head.horns', Math.min(4, n)); if (has(/antler|stag|deer/)) { set('head.horns', 4); set('head.hornCurve', -0.2); set('head.hornLength', 14); }
    if (has(/\b(long|huge|massive|great)\b.*horn/)) mod('head.hornLength', v => v * 1.4); notes.push('Horns');
  } else if (has(/\b(hornless|no horns)\b/)) set('head.horns', 0);
  { const m = t.match(/\b(two|three|four|2|3|4|many|multiple)[- ]eyes?\b|\b(three|four)[- ]eyed\b/); if (m && !hum) { set('head.eyes', Math.min(4, num(m[1] || m[2]))); notes.push('Extra eyes'); } }
  if (has(/\b(fang|fangs|fanged|toothy|snarl|snarling|predator|savage|ferocious|vicious|menacing)\b/)) { set('head.teeth', 12); notes.push('Bared teeth'); } else if (has(/\b(gentle|friendly|herbivore|docile)\b/)) set('head.teeth', 0);
  if (has(/\b(pointed ears|elf ears|big ears)\b/)) set('head.ears', 'pointed'); if (has(/\b(frill ears|fin ears)\b/)) set('head.ears', 'fin');
  // --- materials + pattern
  if (!hum) {
    if (has(/\b(scaly|scales|scaled|reptil\w*)\b/)) set('skin.type', 'scales');
    else if (has(/\b(fur|furry|hairy|fluffy|shaggy|pelt|mane)\b/)) set('skin.type', 'fur');
    else if (has(/\b(feather|feathers|feathered|plumage)\b/)) set('skin.type', 'feather');
    else if (has(/\b(chitin|chitinous|carapace|exoskeleton|shell|armou?red|plated)\b/)) set('skin.type', 'chitin');
    else if (has(/\b(smooth skin|slimy|leathery|rubbery|amphibian|frog)\b/)) set('skin.type', 'skin');
    if (has(/\b(strip\w*|tiger|zebra|banded)\b/)) set('skin.pattern', 'stripes'); else if (has(/\b(spot\w*|leopard|dappled|speckled|polka)\b/)) set('skin.pattern', 'spots');
    else if (has(/\b(camou\w*|mottled|marbled|blotchy)\b/)) set('skin.pattern', 'mottle'); else if (has(/\b(gradient|ombre|two-?tone)\b/)) set('skin.pattern', 'gradient'); else if (has(/\b(plain|solid|uniform)\b/)) set('skin.pattern', 'none');
  }
  // --- colours
  let tc = t; const grab = re => { const m = tc.match(re); if (m) tc = tc.replace(m[0], ' '); return m; };
  const eyeM = grab(new RegExp(`\\b(${CW})(?:\\s|-)(?:glowing\\s)?eyes?\\b|\\b(${CW})-eyed\\b`));
  if (eyeM) { set('eye.color', COLORS[eyeM[1] || eyeM[2]]); notes.push(`${eyeM[1] || eyeM[2]} eyes`); }
  if (has(/\b(glow|glowing|luminous|burning|radiant|bioluminescent|neon)\b/)) { set('eye.glow', 1.2); notes.push('Glowing eyes'); }
  const hairM = grab(new RegExp(`\\b(${CW})\\s+(?:hair|mohawk|ponytail|braids?|locks|beard)\\b`)); if (hairM) set('palette.hair', COLORS[hairM[1]]);
  if (hum) {
    if (has(/\b(bald|shaved)\b/)) set('human.hair', 'none'); else if (has(/\b(mohawk)\b/)) set('human.hair', 'mohawk'); else if (has(/\b(long hair|flowing hair|braid\w*|ponytail)\b/)) set('human.hair', 'long'); else if (has(/\b(short hair|crew cut|cropped)\b/)) set('human.hair', 'short');
    if (has(/\b(armou?r|armou?red|plate|knight|chainmail)\b/)) { set('palette.cloth', '#7c828c'); set('palette.accent', '#3a3a40'); notes.push('Armoured outfit'); }
    if (has(/\b(naked|shirtless|unclothed)\b/)) set('human.outfit', false);
    const clM = grab(new RegExp(`\\b(${CW})\\s+(robes?|cloak|armou?r|clothes|clothing|tunic|dress|suit|outfit|coat|leathers?)\\b`)); if (clM) set('palette.cloth', COLORS[clM[1]]);
    const skM = grab(new RegExp(`\\b(${CW})\\s+skin\\b`)); if (skM) { set('skin.base', COLORS[skM[1]]); set('skin.secondary', COLORS[skM[1]]); }
    else if (has(/\b(dark[- ]skinned|dark skin|ebony)\b/)) { set('skin.base', '#6a4430'); set('skin.secondary', '#6a4430'); } else if (has(/\b(pale|fair)\b/)) { set('skin.base', '#ecd3c2'); set('skin.secondary', '#ecd3c2'); }
    const cs = [...tc.matchAll(new RegExp(`\\b(${CW})\\b`, 'g'))].map(m => COLORS[m[1]]).filter((c, i, a) => a.indexOf(c) === i);
    if (cs[0] && !has(/\b(armou?r|armou?red|knight|chainmail)\b/)) set('palette.cloth', cs[0]); if (cs[1]) set('palette.accent', cs[1]);
  } else {
    const skM = grab(new RegExp(`\\b(${CW})\\s+(?:skin|scales|fur|feathers|hide)\\b`)); const cs = [...tc.matchAll(new RegExp(`\\b(${CW})\\b`, 'g'))].map(m => COLORS[m[1]]).filter((c, i, a) => a.indexOf(c) === i);
    if (skM) cs.unshift(COLORS[skM[1]]);
    if (cs[0]) {
      let base = cs[0]; if (has(/\b(dark|deep|shadow\w*)\b/)) base = tint(base, [0, 0, 0], 0.3); if (has(/\b(pale|light|bright|albino)\b/)) base = tint(base, [255, 255, 255], 0.3);
      set('skin.base', base); set('skin.secondary', cs[1] || tint(base, [255, 245, 220], 0.45)); set('skin.belly', tint(cs[1] || base, [235, 225, 200], 0.6));
      set('skin.membrane', tint(cs[2] || cs[1] || base, [60, 20, 40], 0.35)); notes.push('Colours: ' + cs.slice(0, 3).map(c => Object.keys(COLORS).find(k => COLORS[k] === c)).join(' / '));
    }
  }
  // --- scene
  for (const [re, obj, label] of SCENES) if (re.test(t)) { deepMerge(patch, clone(obj)); notes.push(label[0].toUpperCase() + label.slice(1)); }
  if (hum && has(/\b(wing|wings|winged)\b/)) notes.push('Wings are not supported on humanoids yet (front view)');
  patch.name = String(prompt).trim().slice(0, 36) || 'Imagined'; patch.seed = seed;
  return { patch, notes, preset };
}
const mod2 = v => Math.max(40, Math.min(80, v));

const JIT = ['body.length', 'body.thickness', 'body.arch', 'neck.length', 'neck.angle', 'neck.curve', 'head.size', 'head.snout', 'head.hornLength', 'limbs.length', 'limbs.thickness', 'tail.length', 'tail.curve', 'wings.span', 'crest.size', 'human.height', 'human.muscle', 'human.shoulder', 'human.hips'];
/** Seeded, plausible variation of a patch (anatomy only — keeps palette and kind). */
export function jitterPatch(patch, seed, amt = 0.12) {
  const r = mulberry32(seed * 31 + 5), base = deepMerge(clone(DEFAULT_SPEC), clone(patch));
  if (amt > 0) for (const k of JIT) { const v = getPath(base, k); if (typeof v === 'number' && v !== 0) setPath(patch, k, v * (1 + (r() - 0.5) * 2 * amt)); }
  patch.seed = seed; return patch;
}
async function llmSpec(llm, prompt) {
  const system = `You are a creature and character designer for a procedural renderer. Reply with ONLY one JSON object (no prose, no code fences): a PARTIAL spec containing only keys you want to change. Numeric ranges: ${JSON.stringify(RANGES)}. Enums: kind[quadruped,biped,serpent,humanoid]; head.ears[none,pointed,round,fin]; head.pupil[slit,round,horizontal]; tail.tip[none,club,spade]; skin.type[scales,fur,skin,feather,chitin]; skin.pattern[none,stripes,spots,gradient,mottle]; human.hair[none,short,long,mohawk]; rules.proportions[custom,natural,heroic,stylized,chibi]. Hex colours: skin.base, skin.secondary, skin.belly, skin.horn, skin.membrane, palette.cloth, palette.hair, palette.accent, eye.color, background.top, background.bottom, background.ground, light.color, light.sky. Creatures (quadruped/biped/serpent) are side view; humanoids are front view with no wings. Defaults: ${JSON.stringify(DEFAULT_SPEC)}`;
  const text = await llm(system, `Design: ${prompt}`), a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(a, b + 1));
}
/** Generic LLM adapter for the Anthropic Messages API. Do NOT ship an API key in browser code — point `url` at your own proxy. */
export function createFetchLLM({ url = 'https://api.anthropic.com/v1/messages', headers = {}, model = 'claude-sonnet-4-6', maxTokens = 1500 } = {}) {
  return async (system, user) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(); return (d.content || []).map(c => c.text || '').join('');
  };
}

// ============================ studio class ==================================
export class CreatureStudio {
  constructor(canvas, spec = {}, opts = {}) {
    this.canvas = canvas || document.createElement('canvas'); this.ctx = this.canvas.getContext('2d');
    this.quality = opts.quality || 'high'; this.llm = opts.llm || null; this.lastImagine = null; this.refiner = null; this.warnings = []; this._ls = new Set(); this._key = ''; this.lastRefined = null;
    this._raw = deepMerge(clone(DEFAULT_SPEC), spec); this._revalidate(); this.render();
  }
  get spec() { return this._spec; }
  on(fn) { this._ls.add(fn); return () => this._ls.delete(fn); }
  _emit(t) { this._ls.forEach(f => f(t, this)); }
  _revalidate() { const r = validateSpec(this._raw); this._spec = r.spec; this.warnings = r.warnings; this._raw = clone(r.spec); }
  setSpec(patch, render = true) { deepMerge(this._raw, patch); this._revalidate(); this._emit('change'); if (render) this.render(); return this; }
  set(path, value, opts = {}) { setPath(this._raw, path, value); this._revalidate(); this._emit('change'); this.render(opts); return this; }
  loadPreset(name) { this._raw = deepMerge(clone(DEFAULT_SPEC), clone(PRESETS[name])); this._raw.rules.proportions = PRESETS[name].rules?.proportions || 'custom'; this._revalidate(); this._emit('change'); return this.render(); }
  /** Seeded variation within plausible ranges. Keeps kind, palette and rules. */
  randomize(seed = Date.now() % 100000) {
    const r = mulberry32(seed), v = (a, b) => lerp(a, b, r()), s = this._raw;
    s.seed = seed;
    if (s.kind === 'humanoid') { Object.assign(s.human, { height: v(74, 86), muscle: v(0, 1), shoulder: v(0.85, 1.3), hips: v(0.85, 1.2), jaw: v(0.85, 1.2), armAngle: v(12, 40) }); if (s.rules.proportions === 'custom') s.human.heads = v(5.5, 8.4); s.human.hair = ['short', 'long', 'mohawk', 'none'][Math.floor(r() * 4)]; }
    else {
      Object.assign(s.body, { length: v(34, 56), thickness: v(8, 13), arch: v(0, 6) }); Object.assign(s.neck, { length: v(8, 22), angle: v(40, 70), curve: v(10, 40) });
      Object.assign(s.head, { size: v(5.5, 8.5), snout: v(4, 13), jaw: v(0.3, 0.9), horns: Math.floor(r() * 4), hornLength: v(6, 15) }); Object.assign(s.limbs, { length: v(18, 30), thickness: v(3, 5), digitigrade: v(0.2, 0.9) });
      Object.assign(s.tail, { length: v(20, 50), curve: v(-10, 25) }); s.crest.count = Math.floor(r() * 12);
    }
    s.skin.base = '#' + hslToRgb(r() * 360, v(0.25, 0.55), v(0.28, 0.5)).map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
    s.skin.secondary = '#' + hslToRgb(r() * 360, v(0.3, 0.6), v(0.45, 0.65)).map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
    this._revalidate(); this._emit('change'); return this.render();
  }
  toJSON() { return JSON.stringify(this._spec, null, 2); }
  fromJSON(text) { this._raw = deepMerge(clone(DEFAULT_SPEC), JSON.parse(text)); this._revalidate(); this._emit('change'); return this.render(); }
  describe() { return describeSpec(this._spec); }

  _prepare(quality) {
    const sp = this._spec, W = sp.frame.width, H = sp.frame.height, ss = QUALITY[quality] || 2;
    const geo = JSON.stringify([sp.kind, sp.seed, sp.frame, sp.body, sp.neck, sp.head, sp.limbs, sp.tail, sp.wings, sp.crest, sp.human, sp.rules, ss]);
    if (geo !== this._key) { this._scene = buildScene(sp, W, H); this._buf = rasterize(this._scene, Math.round(W * ss), Math.round(H * ss), ss); this._key = geo; }
    return { sp, W, H, ss };
  }
  _down(rgba, w, h, W, H, smooth = true) {
    const a = document.createElement('canvas'); a.width = w; a.height = h; a.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
    if (w === W && h === H) return a;
    const b = document.createElement('canvas'); b.width = W; b.height = H; const c = b.getContext('2d'); c.imageSmoothingEnabled = smooth; c.imageSmoothingQuality = 'high'; c.drawImage(a, 0, 0, W, H); return b;
  }
  render({ quality = this.quality } = {}) {
    const t0 = performance.now(), { sp, W, H } = this._prepare(quality);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.ctx.putImageData(new ImageData(composeFrame(sp, this._scene, this._buf, W, H), W, H), 0, 0);
    this.lastRenderMs = performance.now() - t0; this._emit('render'); return this;
  }
  /** Returns { beauty, depth, normal, mask, lineart } canvases (conditioning maps for AI models). */
  async renderPasses({ quality = 'high' } = {}) {
    const { W, H, ss } = this._prepare(quality), S = this._scene, B = this._buf, r = { beauty: this._copy() };
    for (const k of ['depth', 'normal', 'mask', 'lineart']) r[k] = this._down(makePass(k, S, B), B.w, B.h, W, H, k !== 'mask');
    return r;
  }
  _copy() { const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height; c.getContext('2d').drawImage(this.canvas, 0, 0); return c; }
  toBlob(type = 'image/png', q = 0.95) { return new Promise(res => this.canvas.toBlob(res, type, q)); }
  // ---- Imagine: text prompt -> creature --------------------------------------
  /** Describe it in words. Uses `llm` (see createFetchLLM) if set, otherwise the built-in offline interpreter. */
  async imagine(prompt, { seed, llm = this.llm } = {}) {
    seed = seed ?? hashStr(prompt); let patch, notes = [], source = 'local';
    if (llm) { try { patch = await llmSpec(llm, prompt); source = 'llm'; notes.push('Design written by the language model'); } catch (e) { notes.push(`LLM unavailable (${e.message}); used the built-in interpreter`); } }
    if (!patch) { const r = interpretPrompt(prompt, seed); patch = r.patch; notes.push(...r.notes); }
    patch.name ??= String(prompt).slice(0, 36); patch.seed ??= seed;
    this.applyPatch(patch); this.lastImagine = { prompt, patch: clone(patch), notes, source }; return this.lastImagine;
  }
  applyPatch(patch) { this._raw = deepMerge(clone(DEFAULT_SPEC), clone(patch)); this._revalidate(); this._emit('change'); return this.render(); }
  /** n variations of a prompt as thumbnail canvases: [{ seed, patch, canvas }]. Click-to-apply with applyPatch(v.patch). */
  async imagineVariants(prompt, n = 4, { llm = this.llm, seed = hashStr(prompt), thumb = 360 } = {}) {
    const base = this.lastImagine?.prompt === prompt ? clone(this.lastImagine.patch) : clone((await this.imagine(prompt, { llm, seed })).patch), out = [];
    for (let i = 0; i < n; i++) {
      const patch = jitterPatch(clone(base), i ? seed + i * 101 : base.seed ?? seed, i ? 0.14 : 0);
      const spec = validateSpec(deepMerge(clone(DEFAULT_SPEC), patch)).spec; spec.frame = { ...spec.frame, width: thumb, height: Math.round(thumb * 0.75) };
      out.push({ seed: patch.seed, patch, canvas: new CreatureStudio(null, spec, { quality: 'standard' }).canvas }); await new Promise(r => setTimeout(r));
    }
    return out;
  }
  /** Run the AI refiner and paint its result over the canvas (any later render() restores the procedural frame). */
  async finish(refiner = this.refiner) {
    let out = await this.refine(refiner); if (typeof Blob !== 'undefined' && out instanceof Blob) out = await createImageBitmap(out);
    this.ctx.drawImage(out, 0, 0, this.canvas.width, this.canvas.height); return out;
  }
  /**
   * Hand off to an AI model for photoreal finishing. `refiner` receives
   * { beauty, depth, normal, mask, lineart, prompt, negative, spec } and returns a canvas/ImageBitmap/Blob.
   */
  async refine(refiner = this.refiner, extra = {}) {
    if (!refiner) throw new Error('No refiner set. See createA1111Refiner() or pass your own async function.');
    const passes = await this.renderPasses();
    const out = await refiner({ ...passes, prompt: this.describe(), negative: 'deformed, extra limbs, blurry, low quality, watermark', spec: this._spec, ...extra });
    this.lastRefined = out; return out;
  }
}

// ============================ AI hand-off (optional) ========================
/** Example refiner for a LOCAL Automatic1111 / Forge server with the ControlNet extension. */
export function createA1111Refiner({ url = 'http://127.0.0.1:7860', depthModel = 'control_v11f1p_sd15_depth', lineModel = 'control_v11p_sd15_lineart', denoise = 0.55, steps = 28 } = {}) {
  return async ({ beauty, depth, lineart, prompt, negative }) => {
    const b64 = c => c.toDataURL('image/png').split(',')[1];
    const body = { init_images: [b64(beauty)], prompt, negative_prompt: negative, denoising_strength: denoise, steps, width: beauty.width, height: beauty.height,
      alwayson_scripts: { controlnet: { args: [{ input_image: b64(depth), module: 'none', model: depthModel, weight: 0.9 }, { input_image: b64(lineart), module: 'none', model: lineModel, weight: 0.6 }] } } };
    const res = await fetch(url + '/sdapi/v1/img2img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const js = await res.json(), img = new Image(); img.src = 'data:image/png;base64,' + js.images[0]; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); return c;
  };
}

// ============================ drop-in control panel =========================
const UI = [
  ['Character', [['kind', 'Type', 'select', ['quadruped', 'biped', 'serpent', 'humanoid']], ['seed', 'Seed', 'range', 0, 9999, 1], ['rules.proportions', 'Proportion canon', 'select', ['custom', 'natural', 'heroic', 'stylized', 'chibi']], ['rules.symmetry', 'Symmetry', 'check']]],
  ['Body', [['body.length', 'Length', 'range', 10, 90, 1], ['body.thickness', 'Thickness', 'range', 3, 26, 0.5], ['body.arch', 'Back arch', 'range', -10, 14, 0.5], ['body.tilt', 'Posture tilt', 'range', 0, 70, 1], ['body.sway', 'Serpentine sway', 'range', 0, 14, 0.5]]],
  ['Neck & head', [['neck.length', 'Neck length', 'range', 0, 50, 1], ['neck.thickness', 'Neck thickness', 'range', 1.5, 14, 0.1], ['neck.angle', 'Neck angle', 'range', -20, 100, 1], ['neck.curve', 'Neck curve', 'range', -40, 70, 1], ['head.size', 'Head size', 'range', 3, 16, 0.1], ['head.snout', 'Snout', 'range', 0, 24, 0.5], ['head.jaw', 'Jaw', 'range', 0, 1, 0.05], ['head.teeth', 'Teeth', 'range', 0, 14, 1], ['head.ears', 'Ears', 'select', ['none', 'pointed', 'round', 'fin']], ['head.earSize', 'Ear size', 'range', 1, 14, 0.5], ['head.horns', 'Horns', 'range', 0, 4, 1], ['head.hornLength', 'Horn length', 'range', 0, 26, 0.5], ['head.hornCurve', 'Horn curve', 'range', -1, 1.2, 0.05], ['head.eyes', 'Eye count', 'range', 1, 4, 1], ['head.eyeSize', 'Eye size', 'range', 0.5, 3.5, 0.1], ['head.pupil', 'Pupil', 'select', ['slit', 'round', 'horizontal']]]],
  ['Limbs & tail', [['limbs.pairs', 'Leg pairs', 'range', 0, 4, 1], ['limbs.arms', 'Small arms', 'range', 0, 1, 1], ['limbs.length', 'Leg length', 'range', 6, 46, 1], ['limbs.thickness', 'Leg thickness', 'range', 1.5, 9, 0.1], ['limbs.digitigrade', 'Digitigrade', 'range', 0, 1, 0.05], ['limbs.stride', 'Stride', 'range', 0, 1, 0.05], ['limbs.claws', 'Claws', 'range', 0, 4, 1], ['tail.length', 'Tail length', 'range', 0, 80, 1], ['tail.curve', 'Tail curve', 'range', -50, 60, 1], ['tail.tip', 'Tail tip', 'select', ['none', 'club', 'spade']]]],
  ['Wings & crest', [['wings.span', 'Wing span', 'range', 0, 80, 1], ['wings.angle', 'Wing angle', 'range', 60, 140, 1], ['wings.fingers', 'Wing fingers', 'range', 2, 6, 1], ['crest.count', 'Spikes', 'range', 0, 24, 1], ['crest.size', 'Spike size', 'range', 0, 9, 0.2]]],
  ['Humanoid', [['human.height', 'Height', 'range', 40, 92, 1], ['human.heads', 'Heads tall', 'range', 3, 9, 0.1], ['human.shoulder', 'Shoulders', 'range', 0.7, 1.5, 0.05], ['human.hips', 'Hips', 'range', 0.7, 1.5, 0.05], ['human.muscle', 'Muscle', 'range', 0, 1, 0.05], ['human.armAngle', 'Arm angle', 'range', 0, 80, 1], ['human.hair', 'Hair', 'select', ['none', 'short', 'long', 'mohawk']], ['human.outfit', 'Outfit', 'check']]],
  ['Surface', [['skin.type', 'Material', 'select', ['scales', 'fur', 'skin', 'feather', 'chitin']], ['skin.base', 'Base', 'color'], ['skin.secondary', 'Pattern colour', 'color'], ['skin.belly', 'Belly', 'color'], ['skin.horn', 'Horn / claw', 'color'], ['skin.membrane', 'Membrane', 'color'], ['skin.pattern', 'Pattern', 'select', ['none', 'stripes', 'spots', 'gradient', 'mottle']], ['skin.patternScale', 'Pattern scale', 'range', 0.3, 4, 0.1], ['skin.patternStrength', 'Pattern strength', 'range', 0, 1, 0.05], ['skin.scale', 'Texture scale', 'range', 0.4, 3, 0.05], ['skin.roughness', 'Roughness', 'range', 0, 1, 0.05], ['skin.bump', 'Relief', 'range', 0, 2.5, 0.05], ['eye.color', 'Eye colour', 'color'], ['eye.glow', 'Eye glow', 'range', 0, 2.5, 0.05], ['palette.cloth', 'Cloth', 'color'], ['palette.hair', 'Hair colour', 'color'], ['palette.accent', 'Leather / trim', 'color']]],
  ['Grade & lens', [['grade.exposure', 'Exposure', 'range', 0.4, 2.2, 0.05], ['grade.contrast', 'Contrast', 'range', 0.7, 1.5, 0.01], ['grade.saturation', 'Saturation', 'range', 0.3, 1.8, 0.05], ['grade.warmth', 'Warmth', 'range', -1, 1, 0.05], ['grade.bloom', 'Bloom', 'range', 0, 1.5, 0.05], ['grade.grain', 'Film grain', 'range', 0, 0.12, 0.005], ['grade.ca', 'Chromatic aberration', 'range', 0, 3, 0.1], ['grade.reflection', 'Floor reflection', 'range', 0, 0.8, 0.05]]],
  ['Light & set', [['light.azimuth', 'Light direction', 'range', 0, 360, 1], ['light.elevation', 'Light height', 'range', 5, 85, 1], ['light.intensity', 'Key', 'range', 0, 2.5, 0.05], ['light.ambient', 'Ambient', 'range', 0, 1.5, 0.05], ['light.rim', 'Rim', 'range', 0, 2, 0.05], ['light.specular', 'Specular', 'range', 0, 1.5, 0.05], ['light.color', 'Key colour', 'color'], ['light.rimColor', 'Rim colour', 'color'], ['background.top', 'Backdrop top', 'color'], ['background.bottom', 'Backdrop bottom', 'color'], ['background.ground', 'Floor', 'color']]],
];

/** Mounts a ready-made control panel into `root`. Everything is optional — you can drive the studio from your own UI via studio.set(path, value). */
export function mountCreatureUI(root, studio) {
  if (!document.getElementById('cs-style')) {
    const st = document.createElement('style'); st.id = 'cs-style';
    st.textContent = `.cs{font:13px/1.4 system-ui,sans-serif;color:inherit}.cs details{border-bottom:1px solid rgba(128,128,128,.3);padding:6px 0}.cs summary{cursor:pointer;font-weight:600;padding:4px 0}.cs label{display:grid;grid-template-columns:110px 1fr 44px;gap:8px;align-items:center;margin:4px 0}.cs label.ck{grid-template-columns:110px 1fr}.cs input[type=range]{width:100%}.cs output{text-align:right;opacity:.7;font-variant-numeric:tabular-nums}.cs .bar{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.cs button,.cs select{font:inherit;padding:5px 9px;border-radius:7px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;cursor:pointer}.cs input.pr{flex:1;min-width:150px;font:inherit;padding:6px 8px;border-radius:7px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit}.cs .vg{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin:6px 0}.cs .vg canvas{width:100%;border-radius:8px;cursor:pointer}.cs .note{opacity:.75;font-size:12px;margin:4px 0}.cs .warn{margin:6px 0;padding:6px 8px;border-radius:7px;background:rgba(220,160,0,.18);display:none}`;
    document.head.appendChild(st);
  }
  root.innerHTML = ''; const wrap = document.createElement('div'); wrap.className = 'cs'; root.appendChild(wrap);
  const bar = document.createElement('div'); bar.className = 'bar'; wrap.appendChild(bar);
  const mk = (tag, txt, fn) => { const e = document.createElement(tag); if (txt) e.textContent = txt; if (fn) e.onclick = fn; bar.appendChild(e); return e; };
  const ps = mk('select'); ps.innerHTML = '<option value="">Preset…</option>' + Object.keys(PRESETS).map(k => `<option>${k}</option>`).join(''); ps.onchange = () => ps.value && studio.loadPreset(ps.value);
  const qs = mk('select'); qs.innerHTML = '<option value="draft">Draft</option><option value="standard">Standard</option><option value="high" selected>High</option><option value="ultra">Ultra</option>'; qs.value = studio.quality; qs.onchange = () => { studio.quality = qs.value; studio.render(); };
  mk('button', 'Randomize', () => studio.randomize(Math.floor(Math.random() * 99999)));
  const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  mk('button', 'PNG', async () => dl(await studio.toBlob(), (studio.spec.name || 'creature') + '.png'));
  mk('button', 'AI maps', async () => { const p = await studio.renderPasses(); for (const k in p) p[k].toBlob(b => dl(b, `${studio.spec.name}_${k}.png`)); });
  mk('button', 'Save JSON', () => dl(new Blob([studio.toJSON()], { type: 'application/json' }), (studio.spec.name || 'creature') + '.json'));
  mk('button', 'Load JSON', () => { const f = document.createElement('input'); f.type = 'file'; f.accept = '.json'; f.onchange = async () => studio.fromJSON(await f.files[0].text()); f.click(); });
  // ---- Imagine (prompt -> creature), variants, AI finish
  const row = document.createElement('div'); row.className = 'bar'; wrap.appendChild(row);
  const pr = document.createElement('input'); pr.className = 'pr'; pr.type = 'text'; pr.placeholder = 'Imagine: "huge crimson horned dragon, glowing eyes, sunset"'; row.appendChild(pr);
  const note = document.createElement('div'); note.className = 'note'; const vg = document.createElement('div'); vg.className = 'vg';
  const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = '…'; try { await fn(); } catch (e) { note.textContent = 'Error: ' + e.message; } btn.disabled = false; btn.textContent = t; };
  const show = r => { note.textContent = (r.source === 'llm' ? 'LLM design. ' : 'Understood: ') + r.notes.join(' · '); };
  const goBtn = document.createElement('button'); goBtn.textContent = 'Imagine'; goBtn.onclick = () => pr.value.trim() && busy(goBtn, async () => { vg.innerHTML = ''; show(await studio.imagine(pr.value.trim())); });
  const varBtn = document.createElement('button'); varBtn.textContent = 'Variants'; varBtn.onclick = () => pr.value.trim() && busy(varBtn, async () => {
    const vs = await studio.imagineVariants(pr.value.trim(), 4); vg.innerHTML = ''; show(studio.lastImagine);
    vs.forEach(v => { v.canvas.onclick = () => studio.applyPatch(v.patch); vg.appendChild(v.canvas); });
  });
  pr.addEventListener('keydown', e => e.key === 'Enter' && goBtn.click()); row.append(goBtn, varBtn); wrap.append(note, vg);
  const fin = document.createElement('div'); fin.className = 'bar'; wrap.appendChild(fin);
  const fu = document.createElement('input'); fu.className = 'pr'; fu.type = 'text'; fu.placeholder = 'Local AI server (e.g. http://127.0.0.1:7860)'; fin.appendChild(fu);
  const fb = document.createElement('button'); fb.textContent = 'AI finish'; fb.onclick = () => fu.value.trim() && busy(fb, async () => { studio.refiner = createA1111Refiner({ url: fu.value.trim() }); await studio.finish(); note.textContent = 'AI finish applied — any edit restores the procedural frame.'; }); fin.appendChild(fb);
  const warn = document.createElement('div'); warn.className = 'warn'; wrap.appendChild(warn);
  const inputs = [];
  for (const [title, rows] of UI) {
    const d = document.createElement('details'); d.open = title === 'Character'; d.innerHTML = `<summary>${title}</summary>`; wrap.appendChild(d);
    for (const [path, label, type, a, b, st] of rows) {
      const l = document.createElement('label'); l.append(label); let inp;
      if (type === 'select') { inp = document.createElement('select'); a.forEach(o => inp.add(new Option(o, o))); }
      else { inp = document.createElement('input'); inp.type = type === 'check' ? 'checkbox' : type; if (type === 'range') { inp.min = a; inp.max = b; inp.step = st; } }
      const out = document.createElement('output'); if (type === 'check') l.className = 'ck'; l.append(inp); if (type === 'range') l.append(out); d.appendChild(l);
      const read = () => type === 'check' ? inp.checked : type === 'range' ? +inp.value : inp.value;
      let raf = 0; inp.addEventListener('input', () => { out.textContent = inp.value; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => studio.set(path, read(), { quality: 'draft' })); });
      inp.addEventListener('change', () => { cancelAnimationFrame(raf); studio.set(path, read()); });
      inputs.push({ path, inp, out, type });
    }
  }
  const refresh = () => {
    for (const { path, inp, out, type } of inputs) { const v = getPath(studio.spec, path); if (type === 'check') inp.checked = !!v; else inp.value = v; out.textContent = type === 'range' ? (+v).toFixed(+v % 1 ? 1 : 0) : ''; }
    warn.style.display = studio.warnings.length ? 'block' : 'none'; warn.textContent = studio.warnings.join(' ');
  };
  const off = studio.on(t => t === 'change' && refresh()); refresh();
  return { refresh, destroy() { off(); root.innerHTML = ''; } };
}

export default CreatureStudio;
