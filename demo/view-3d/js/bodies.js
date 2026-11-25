/* bodies.js -- six generic, stylised car bodies built in code from simple shapes.
 *
 * No model files, no real designs, no logos. Each body is:
 *   - a side profile (rounded polygon with wheel-arch cut-outs) extruded to the car's width,
 *   - a narrower greenhouse extruded on top, with flat glass panels set just proud of it,
 *   - lamps, number plates and a dark chassis tub that shows through the arches,
 *   - four wheels (lathe tyre, five-spoke disc, caliper, TPMS ring, speed-blur disc).
 *
 * Axes: +x forward, +y up, +z to the car's right (the driver's side: Indian cars are
 * right-hand drive). Units are metres; the ground is y = 0.
 */
import * as THREE from "../vendor/three/three.module.min.js";
import { RoundedBoxGeometry } from "../vendor/three/addons/RoundedBoxGeometry.js";

const BEVEL = 0.045;
const ARCH = 0.088;         // arch radius over the tyre radius (the bevel eats 0.045 of it)

/* Body types. Numbers are plausible for the class (length, width, wheel size), not copied
 * from any real car. `lower` is the side profile above the sill, front to back:
 * [x, y, cornerRadius]. `glass` is the greenhouse: front base, roof front, roof rear, rear base. */
export const SPECS = {
  crossover: {
    label: "Compact crossover", L: 4.0, W: 1.76, R: 0.33, tyreW: 0.215, xF: 1.27, xR: -1.24, sill: 0.31,
    lower: [[2.0, 0.31, 0.14], [1.98, 0.76, 0.16], [1.12, 0.93, 0.1], [-1.74, 0.99, 0.12], [-2.0, 0.92, 0.1], [-2.0, 0.31, 0.14]],
    glass: [[1.12, 0.92], [0.22, 1.5], [-1.42, 1.49], [-1.84, 0.97]], Wc: 1.5, pillars: [-0.42],
    cladding: true, rails: true, rearSpoiler: false, doors: [1.06, -0.42, -1.16],
  },
  sedan: {
    label: "Sedan", L: 4.63, W: 1.78, R: 0.32, tyreW: 0.215, xF: 1.42, xR: -1.28, sill: 0.24,
    lower: [[2.31, 0.24, 0.12], [2.28, 0.67, 0.14], [1.05, 0.86, 0.08], [-1.32, 0.92, 0.05], [-2.2, 0.95, 0.12], [-2.32, 0.88, 0.08], [-2.32, 0.24, 0.12]],
    glass: [[1.05, 0.85], [0.12, 1.44], [-0.82, 1.44], [-1.42, 0.91]], Wc: 1.5, pillars: [-0.3], doors: [1.0, -0.3, -1.22],
  },
  supercar: {
    label: "Low two-door supercar", L: 4.46, W: 1.99, R: 0.36, tyreW: 0.3, xF: 1.4, xR: -1.31, sill: 0.13,
    lower: [[2.23, 0.13, 0.1], [2.2, 0.5, 0.16], [1.42, 0.87, 0.5], [0.62, 0.79, 0.12], [-1.95, 0.87, 0.14], [-2.23, 0.8, 0.08], [-2.23, 0.15, 0.1]],
    glass: [[0.62, 0.78], [-0.12, 1.16], [-0.98, 1.14], [-1.78, 0.85]], Wc: 1.38, pillars: [],
    wing: true, doors: [0.56, -0.78],
  },
  van: {
    label: "Tall boxy van", L: 3.37, W: 1.4, R: 0.27, tyreW: 0.155, xF: 1.06, xR: -0.8, sill: 0.21,
    lower: [[1.685, 0.21, 0.08], [1.665, 0.83, 0.07], [1.56, 0.9, 0.04], [-1.66, 0.93, 0.06], [-1.685, 0.21, 0.08]],
    glass: [[1.58, 0.88], [1.3, 1.63], [-1.62, 1.63], [-1.67, 0.91]], Wc: 1.34, pillars: [0.86, -0.5],
    tallRoof: true, doors: [1.5, 0.84, -0.48],
  },
  roadster: {
    label: "Small open-top two-seater", L: 3.95, W: 1.85, R: 0.31, tyreW: 0.2, xF: 1.25, xR: -1.1, sill: 0.13,
    lower: [[1.97, 0.13, 0.1], [1.94, 0.55, 0.16], [1.26, 0.79, 0.4], [0.45, 0.8, 0.08], [-1.8, 0.87, 0.14], [-1.97, 0.8, 0.08], [-1.97, 0.14, 0.1]],
    glass: null, open: { screenBase: [0.45, 0.8], screenTop: [0.02, 1.13], cockpit: [-0.78, 0.42] }, doors: [0.38, -0.66],
  },
  hatchback: {
    label: "Hatchback", L: 3.85, W: 1.73, R: 0.31, tyreW: 0.195, xF: 1.25, xR: -1.2, sill: 0.22,
    lower: [[1.925, 0.22, 0.12], [1.9, 0.71, 0.14], [1.0, 0.9, 0.08], [-1.8, 0.96, 0.1], [-1.925, 0.93, 0.08], [-1.925, 0.22, 0.12]],
    glass: [[1.0, 0.89], [0.2, 1.48], [-1.6, 1.48], [-1.86, 0.95]], Wc: 1.48, pillars: [-0.45], rearSpoiler: true, doors: [0.96, -0.45, -1.18],
  },
};

/** Which body a fleet car gets. Live console cars and any unknown car are hatchbacks. */
export function bodyFor(id) {
  return { fronx: "crossover", corolla: "sedan", veyron: "supercar", omni: "van", roadster: "roadster" }[id] || "hatchback";
}

/* ---------------- shape helpers ---------------- */
function roundedPath(shape, pts, start) {
  // pts: [{x, y, r, arc?}] closed; vertex `start` must have r = 0.
  const n = pts.length, P = (i) => pts[((i % n) + n) % n];
  const s0 = P(start);
  shape.moveTo(s0.x, s0.y);
  if (s0.arc) shape.absarc(s0.arc.cx, s0.arc.cy, s0.arc.r, s0.arc.a0, s0.arc.a1, true);
  for (let k = 1; k <= n; k++) {
    const i = start + k, v = P(i);
    if (k === n) { if (!s0.arc) shape.lineTo(s0.x, s0.y); break; }
    if (v.r > 0) {
      const a = P(i - 1), b = P(i + 1);
      const da = Math.hypot(a.x - v.x, a.y - v.y), db = Math.hypot(b.x - v.x, b.y - v.y);
      const r = Math.min(v.r, da * 0.48, db * 0.48);
      shape.lineTo(v.x + ((a.x - v.x) / da) * r, v.y + ((a.y - v.y) / da) * r);
      shape.quadraticCurveTo(v.x, v.y, v.x + ((b.x - v.x) / db) * r, v.y + ((b.y - v.y) / db) * r);
    } else shape.lineTo(v.x, v.y);
    if (v.arc) shape.absarc(v.arc.cx, v.arc.cy, v.arc.r, v.arc.a0, v.arc.a1, true);
  }
  return shape;
}

/** The side profile: sill with two arch cut-outs, then the spec's outline. */
function lowerShape(sp) {
  const ra = sp.R + ARCH, yb = sp.sill;
  const arch = (xc) => {
    const al = Math.asin(clampN((sp.R - yb) / ra, -0.99, 0.99));
    const dx = ra * Math.cos(al);
    return [{ x: xc - dx, y: yb, r: 0, arc: { cx: xc, cy: sp.R, r: ra, a0: Math.PI + al, a1: -al } }, { x: xc + dx, y: yb, r: 0 }];
  };
  const [rs, re] = arch(sp.xR), [fs, fe] = arch(sp.xF);
  const outline = sp.lower.map(([x, y, r]) => ({ x, y, r }));
  // CCW: after the rear arch, forward along the sill, up the nose, back over the top, down the tail.
  const pts = [re, fs, fe, ...outline, rs];
  return roundedPath(new THREE.Shape(), pts, 0);
}
const clampN = (x, a, b) => Math.min(b, Math.max(a, x));

function extrude(shape, width, bevel = BEVEL, segs = 3) {
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 10,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

/* Convex polygon helpers for the side windows. */
function insetPoly(poly, margins) {
  // poly CCW-agnostic convex [[x,y]...]; margins per edge i (poly[i] -> poly[i+1])
  const n = poly.length;
  const cx = poly.reduce((s, p) => s + p[0], 0) / n, cy = poly.reduce((s, p) => s + p[1], 0) / n;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    let nx = q[1] - p[1], ny = -(q[0] - p[0]);
    const l = Math.hypot(nx, ny); nx /= l; ny /= l;
    if ((cx - p[0]) * nx + (cy - p[1]) * ny < 0) { nx = -nx; ny = -ny; }   // point inward
    return { px: p[0] + nx * margins[i], py: p[1] + ny * margins[i], dx: q[0] - p[0], dy: q[1] - p[1] };
  });
  return lines.map((a, i) => {
    const b = lines[(i + n - 1) % n];
    const den = b.dx * a.dy - b.dy * a.dx;
    const t = ((a.px - b.px) * a.dy - (a.py - b.py) * a.dx) / den;
    return [b.px + b.dx * t, b.py + b.dy * t];
  });
}
function clipX(poly, x, keepGreater) {
  const out = [], n = poly.length;
  const inside = (p) => (keepGreater ? p[0] >= x : p[0] <= x);
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) { const t = (x - a[0]) / (b[0] - a[0]); out.push([x, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/* ---------------- canvas textures ---------------- */
export function plateTexture(text, ev, font) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 112;
  const g = c.getContext("2d");
  // India: white plates with black letters; green plates with white letters for EVs.
  g.fillStyle = ev ? "#0f7a3d" : "#f7f7f5"; g.fillRect(0, 0, 512, 112);
  g.strokeStyle = ev ? "#0b5d2e" : "#1c1c1c"; g.lineWidth = 8; g.strokeRect(6, 6, 500, 100);
  g.fillStyle = ev ? "#ffffff" : "#141414";
  g.font = `600 64px ${font}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text || "NO PLATE", 256, 60, 470);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
let blurTex = null;
function blurTexture() {
  if (blurTex) return blurTex;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 63);
  grd.addColorStop(0, "rgba(70,78,86,1)"); grd.addColorStop(0.18, "rgba(150,160,168,1)");
  grd.addColorStop(0.62, "rgba(120,130,138,0.95)"); grd.addColorStop(0.9, "rgba(60,66,72,0.95)"); grd.addColorStop(1, "rgba(40,44,48,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  blurTex = new THREE.CanvasTexture(c); blurTex.colorSpace = THREE.SRGBColorSpace;
  return blurTex;
}

/* ---------------- materials ---------------- */
function makeMaterials(color) {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.25, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.14 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x10181d, metalness: 0.2, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1a2025, roughness: 0.62, metalness: 0.1 }),
    chassis: new THREE.MeshStandardMaterial({ color: 0x0c1013, roughness: 0.95 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.86 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9d0d5, metalness: 0.85, roughness: 0.28 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x23292e, metalness: 0.5, roughness: 0.5 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x59636b, metalness: 0.4, roughness: 0.45 }),
    head: new THREE.MeshStandardMaterial({ color: 0xe9eef2, emissive: 0xfff4dc, emissiveIntensity: 0.55, roughness: 0.15 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x3a0b0b, emissive: 0xff1e12, emissiveIntensity: 0, roughness: 0.25 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.8 }),
  };
}

/* ---------------- wheel ---------------- */
function tyreGeometry(R, w, rRim) {
  const h = w / 2, sh = Math.min(0.05, w * 0.22);
  const pts = [];
  pts.push(new THREE.Vector2(rRim, -h * 0.92));
  pts.push(new THREE.Vector2(R - sh, -h));
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2); pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, -h + sh + Math.sin(a) * sh)); }
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, h - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(rRim, h * 0.92));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateX(Math.PI / 2);   // lathe axis Y -> axle along Z
  return g;
}
function spokeDisc(rRim) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rRim, 0, Math.PI * 2, false);
  const n = 5, rIn = rRim * 0.3, rOut = rRim * 0.84;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n, half = (Math.PI / n) * 0.62;
    const h = new THREE.Path();
    h.moveTo(Math.cos(a - half * 0.55) * rIn, Math.sin(a - half * 0.55) * rIn);
    h.lineTo(Math.cos(a - half) * rOut, Math.sin(a - half) * rOut);
    h.absarc(0, 0, rOut, a - half, a + half, false);
    h.lineTo(Math.cos(a + half * 0.55) * rIn, Math.sin(a + half * 0.55) * rIn);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2, curveSegments: 18 });
  g.computeVertexNormals();
  return g;
}

function buildWheel(sp, m, pos) {
  const R = sp.R, w = sp.tyreW, rRim = R * 0.66;
  const right = pos[1] === "r";
  const steer = new THREE.Group();                       // turns for steering (front only)
  const side = new THREE.Group();                        // mirrors the left wheels so the face points out
  if (!right) side.rotation.y = Math.PI;
  steer.add(side);
  const spin = new THREE.Group();                        // rolls
  side.add(spin);

  const tyre = new THREE.Mesh(tyreGeometry(R, w, rRim), m.tyre);
  tyre.castShadow = true; tyre.userData.tyre = pos;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rRim, rRim, w * 0.86, 28, 1, true).rotateX(Math.PI / 2), m.barrel);
  const back = new THREE.Mesh(new THREE.CircleGeometry(rRim, 28), m.barrel);
  back.position.z = -w * 0.15;
  const disc = new THREE.Mesh(spokeDisc(rRim * 0.985), m.rim);
  disc.position.z = w * 0.5 - 0.05;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rRim * 0.2, rRim * 0.24, 0.03, 20).rotateX(Math.PI / 2), m.rim);
  hub.position.z = w * 0.5 - 0.012;
  const blurMat = new THREE.MeshBasicMaterial({ map: blurTexture(), transparent: true, opacity: 0, depthWrite: false });
  const blur = new THREE.Mesh(new THREE.CircleGeometry(rRim * 1.01, 32), blurMat);
  blur.position.z = w * 0.5 + 0.004;
  spin.add(tyre, barrel, back, disc, hub, blur);

  // fixed parts (do not roll): brake caliper and the TPMS ring on the outer sidewall
  const caliper = new THREE.Mesh(new RoundedBoxGeometry(0.11, rRim * 0.55, 0.06, 2, 0.015), m.caliper);
  caliper.position.set(-rRim * 0.55, rRim * 0.42, w * 0.08);
  caliper.rotation.z = 0.5;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8a96a0 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry((rRim + R) / 2 + 0.01, 0.0085, 8, 64), ringMat);
  ring.position.z = w * 0.5 + 0.003;
  ring.userData.tyre = pos;
  side.add(caliper, ring);

  const z = (sp.W / 2 - w / 2 - 0.025) * (right ? 1 : -1);
  steer.position.set(pos[0] === "f" ? sp.xF : sp.xR, R, z);
  return { id: pos, steer, spin, side, tyre, ring, blur, right, front: pos[0] === "f" };
}

/* ---------------- car ---------------- */
export function buildCar(type, color, opts = {}) {
  const sp = SPECS[type];
  const m = makeMaterials(color);
  const car = new THREE.Group();
  const body = new THREE.Group();                         // pitches and rolls on the "suspension"
  car.add(body);
  const meshes = [];
  const add = (mesh, parent = body, shadow = true) => { mesh.castShadow = shadow; parent.add(mesh); meshes.push(mesh); return mesh; };

  // pivot the body about a point near the axle line so pitch looks like suspension travel
  body.position.set(0, sp.R, 0);
  const inner = new THREE.Group();
  inner.position.set(0, -sp.R, 0);
  body.add(inner);
  const B = (mesh, shadow = true) => add(mesh, inner, shadow);

  B(new THREE.Mesh(extrude(lowerShape(sp), sp.W), m.paint)).userData.part = "body";

  // chassis tub, seen through the arches
  const ra = sp.R + ARCH;
  const tub = new THREE.Mesh(new THREE.BoxGeometry(sp.xF - sp.xR + ra * 1.7, sp.R + ra - sp.sill * 0.55, sp.W - 2 * sp.tyreW - 0.08), m.chassis);
  tub.position.set((sp.xF + sp.xR) / 2, sp.sill * 0.55 + (sp.R + ra - sp.sill * 0.55) / 2 - 0.01, 0);
  B(tub, false);

  const cowl = sp.glass ? sp.glass[0] : sp.open.screenBase;
  const beltY = cowl[1], cowlX = cowl[0];
  let roofY = null;

  if (sp.glass) {
    const [f0, f1, r1, r0] = sp.glass;
    roofY = f1[1];
    const gh = new THREE.Shape();
    roundedPath(gh, [{ x: f0[0], y: f0[1] - 0.03, r: 0 }, { x: f1[0], y: f1[1], r: 0.14 }, { x: r1[0], y: r1[1], r: 0.12 }, { x: r0[0], y: r0[1] - 0.03, r: 0 }], 0);
    B(new THREE.Mesh(extrude(gh, sp.Wc, 0.05, 3), m.paint)).userData.part = "body";

    // side windows: the greenhouse outline inset by the pillar width, split at the B (and C) pillars
    const poly = [[f0[0], f0[1]], [f1[0], f1[1]], [r1[0], r1[1]], [r0[0], r0[1]]];
    const win = insetPoly(poly, [0.075, 0.06, 0.085, 0.05]);
    const cuts = [Infinity, ...sp.pillars, -Infinity];
    for (let i = 0; i < cuts.length - 1; i++) {
      let p = win;
      if (isFinite(cuts[i])) p = clipX(p, cuts[i] - 0.045, false);
      if (isFinite(cuts[i + 1])) p = clipX(p, cuts[i + 1] + 0.045, true);
      if (p.length < 3) continue;
      const s = new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
      for (const sgn of [1, -1]) {
        const mesh = new THREE.Mesh(g, m.glass);
        mesh.position.z = sgn > 0 ? sp.Wc / 2 + 0.002 : -sp.Wc / 2 - 0.01;
        B(mesh, false).userData.part = "glass";
      }
    }
    // windscreen and rear glass: thin panels lying on the two slopes
    const slab = (a, b, inset) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      let nx = dy / len, ny = -dx / len;
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(len - inset, 0.012, sp.Wc - 0.16, 2, 0.005), m.glass);
      mesh.position.set((a[0] + b[0]) / 2 + nx * 0.056, (a[1] + b[1]) / 2 + ny * 0.056, 0);
      mesh.rotation.z = Math.atan2(dy, dx);
      return B(mesh, false);
    };
    slab([f0[0], f0[1]], [f1[0], f1[1]], 0.2).userData.part = "glass";
    slab([r1[0], r1[1]], [r0[0], r0[1]], 0.16).userData.part = "glass";

    if (sp.rails) for (const s of [1, -1]) {
      const rail = new THREE.Mesh(new RoundedBoxGeometry(f1[0] - r1[0] - 0.2, 0.035, 0.04, 2, 0.012), m.trim);
      rail.position.set((f1[0] + r1[0]) / 2, f1[1] + 0.065, s * (sp.Wc / 2 - 0.1));
      B(rail).userData.part = "trim";
    }
    if (sp.rearSpoiler) {
      const sp2 = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.035, sp.Wc - 0.1, 2, 0.012), m.paint);
      sp2.position.set(r1[0] - 0.06, r1[1] + 0.03, 0); sp2.rotation.z = 0.12;
      B(sp2).userData.part = "body";
    }
  } else if (sp.open) {
    // roadster: dark cockpit opening, two seats with headrests, a framed windscreen
    const [cx0, cx1] = sp.open.cockpit;
    const deckY = 0.83;
    const pit = new THREE.Mesh(new RoundedBoxGeometry(cx1 - cx0, 0.05, sp.W * 0.74, 3, 0.02), m.chassis);
    pit.position.set((cx0 + cx1) / 2, deckY, 0);
    B(pit, false).userData.part = "trim";
    for (const s of [1, -1]) {
      const seat = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.42, 0.46, 3, 0.05), m.seat);
      seat.position.set(cx0 + 0.22, deckY + 0.16, s * 0.34); seat.rotation.z = 0.18;
      B(seat).userData.part = "trim";
      const head = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.17, 0.26, 3, 0.05), m.seat);
      head.position.set(cx0 + 0.15, deckY + 0.45, s * 0.34); head.rotation.z = 0.18;
      B(head).userData.part = "trim";
      const hoop = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.2, 0.32, 3, 0.09), m.paint);
      hoop.position.set(cx0 - 0.12, deckY + 0.06, s * 0.34);
      B(hoop).userData.part = "body";
    }
    const a = sp.open.screenBase, b = sp.open.screenTop;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const scr = new THREE.Mesh(new RoundedBoxGeometry(len, 0.012, sp.W * 0.76, 2, 0.005), m.glass);
    scr.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0); scr.rotation.z = Math.atan2(dy, dx);
    B(scr, false).userData.part = "glass";
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, sp.W * 0.8, 2, 0.02), m.paint);
    frame.position.set(b[0], b[1], 0);
    B(frame).userData.part = "body";
    for (const s of [1, -1]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(len, 0.04, 0.04, 2, 0.015), m.paint);
      post.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, s * sp.W * 0.39); post.rotation.z = Math.atan2(dy, dx);
      B(post).userData.part = "body";
    }
    roofY = b[1];
  }

  if (sp.cladding) {
    // dark wheel-arch flares and sill strip, the crossover cue
    for (const xc of [sp.xF, sp.xR]) {
      const s = new THREE.Shape();
      const r0 = ra - BEVEL + 0.012, r1 = r0 + 0.075, al = Math.asin(clampN((sp.R - sp.sill) / r0, -0.99, 0.99)), al1 = Math.asin(clampN((sp.R - sp.sill) / r1, -0.99, 0.99));
      s.absarc(xc, sp.R, r1, Math.PI + al1, -al1, true);
      s.lineTo(xc + r0 * Math.cos(al), sp.sill);
      s.absarc(xc, sp.R, r0, -al, Math.PI + al, false);
      s.closePath();
      B(new THREE.Mesh(extrude(s, sp.W + 0.02, 0.012, 2), m.trim)).userData.part = "trim";
    }
    const sill = new THREE.Mesh(new RoundedBoxGeometry(sp.xF - sp.xR - 2 * ra - 0.1, 0.09, sp.W + 0.016, 2, 0.02), m.trim);
    sill.position.set((sp.xF + sp.xR) / 2, sp.sill + 0.03, 0);
    B(sill).userData.part = "trim";
  }
  if (sp.wing) {
    const wing = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.03, sp.W * 0.82, 2, 0.012), m.trim);
    wing.position.set(-1.98, 1.0, 0); wing.rotation.z = 0.08;
    B(wing).userData.part = "trim";
    for (const s of [1, -1]) {
      const st = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.13, 0.03, 2, 0.01), m.trim);
      st.position.set(-1.98, 0.92, s * 0.45);
      B(st).userData.part = "trim";
    }
  }

  // door shut lines and handles, mirrors: the small things that make it read as a car
  const archTop = (x) => {
    let y = sp.sill;
    for (const xc of [sp.xF, sp.xR]) if (Math.abs(x - xc) < ra) y = Math.max(y, sp.R + Math.sqrt(ra * ra - (x - xc) ** 2) - BEVEL);
    return y;
  };
  const shutTop = beltY - 0.02;
  for (const s of [1, -1]) {
    (sp.doors || []).forEach((x, i) => {
      const y0 = archTop(x) + 0.03, h = shutTop - y0;
      if (h < 0.1) return;
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.009, h, 0.006), m.chassis);
      line.position.set(x, y0 + h / 2, s * (sp.W / 2 + 0.001));
      B(line, false).userData.part = "trim";
      if (i < (sp.doors.length - 1)) {
        const hd = new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.03, 0.02, 2, 0.008), m.trim);
        hd.position.set(sp.doors[i + 1] + 0.16, beltY - 0.11, s * (sp.W / 2 + 0.004));
        B(hd, false).userData.part = "trim";
      }
    });
    const mx = cowlX - 0.16, my = beltY + 0.07;
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.1, 0.13, 3, 0.035), m.paint);
    mirror.position.set(mx, my + 0.02, s * (sp.W / 2 + 0.07));
    B(mirror).userData.part = "body";
    const glassM = new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.075, 0.1, 1, 0.004), m.glass);
    glassM.position.set(mx - 0.077, my + 0.02, s * (sp.W / 2 + 0.075));
    B(glassM, false).userData.part = "glass";
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.08), m.trim);
    stalk.position.set(mx + 0.02, my - 0.01, s * (sp.W / 2 + 0.005));
    B(stalk, false).userData.part = "trim";
  }

  // lamps: headlights near the top of the nose, tail lamps near the top of the tail
  const nose = sp.lower[1], tailTop = sp.lower[sp.lower.length - 2];
  const xFront = Math.max(sp.lower[0][0], nose[0]) + BEVEL - 0.012;
  const xRear = sp.lower[sp.lower.length - 1][0] - BEVEL + 0.012;
  const headY = nose[1] - Math.max(0.09, nose[2] * 0.9);
  const tailY = tailTop[1] - Math.max(0.1, tailTop[2] + 0.05);
  const lampW = type === "van" ? 0.22 : 0.34;
  const tails = [];
  for (const s of [1, -1]) {
    const hl = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.085, lampW, 2, 0.02), m.head);
    hl.position.set(xFront, headY, s * (sp.W / 2 - lampW / 2 - 0.09));
    B(hl, false).userData.part = "lamp";
    const tl = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.09, lampW + 0.04, 2, 0.02), m.tail);
    tl.position.set(xRear, tailY, s * (sp.W / 2 - lampW / 2 - 0.08));
    B(tl, false).userData.part = "lamp";
    tails.push(tl);
  }
  // grille between the headlights, dark lower bumper lips front and rear
  const grilleW = sp.W - 2 * (lampW + 0.09) - 0.12;
  if (grilleW > 0.25) {
    const gr = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.075, grilleW, 2, 0.015), m.trim);
    gr.position.set(xFront - 0.008, headY - 0.01, 0);
    B(gr, false).userData.part = "trim";
  }
  for (const [x, sgn] of [[xFront - 0.004, 1], [xRear + 0.004, -1]]) {
    const lip = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.085, sp.W - 0.34, 2, 0.02), m.trim);
    lip.position.set(x, sp.sill + 0.05, 0);
    B(lip, false).userData.part = "trim";
  }
  // a centre high-mounted stop lamp on cars with a roof
  if (sp.glass && type !== "supercar") {
    // just inside the top of the rear glass
    const r1 = sp.glass[2], r0 = sp.glass[3], k = 0.12;
    const c = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.03, 0.32, 1, 0.01), m.tail);
    c.position.set(r1[0] + (r0[0] - r1[0]) * k - 0.02, r1[1] + (r0[1] - r1[1]) * k, 0);
    B(c, false).userData.part = "lamp";
  }

  // number plates (the car's fake registration), front and rear
  const plateTex = plateTexture(opts.reg, opts.ev, opts.font || "monospace");
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 });
  m.plate = plateMat;
  const pw = 0.52, ph = 0.115;
  const plateF = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), plateMat);
  plateF.position.set(xFront + 0.008, sp.sill + 0.17, 0); plateF.rotation.y = Math.PI / 2;
  const plateR = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), plateMat);
  plateR.position.set(xRear - 0.008, Math.min(tailY - 0.14, sp.sill + 0.33), 0); plateR.rotation.y = -Math.PI / 2;
  B(plateF, false).userData.part = "plate"; B(plateR, false).userData.part = "plate";

  // wheels: steer and spin groups, outside the pitching body
  const wheels = ["fl", "fr", "rl", "rr"].map((p) => buildWheel(sp, m, p));
  for (const w of wheels) car.add(w.steer);

  // where our kit sits (for the hardware X-ray): dashboard on the driver's (right) side
  const dashX = cowlX - 0.3;
  const hw = {
    obd: new THREE.Vector3(dashX - 0.1, beltY - 0.33, sp.W * 0.24),
    pi: new THREE.Vector3(dashX + 0.02, beltY + 0.035, -sp.W * 0.08),
    gps: new THREE.Vector3(dashX + 0.2, beltY + 0.02, sp.W * 0.08),
    roof: new THREE.Vector3(dashX - 0.5, (roofY || beltY + 0.4) + 0.9, 0),
    dashX, beltY,
  };

  const dims = { L: sp.L, W: sp.W, R: sp.R, wheelbase: sp.xF - sp.xR, height: roofY || beltY };
  return { group: car, body, inner, wheels, materials: m, meshes, tails, dims, spec: sp, type, hw, plateTex };
}

/** Free everything a car allocated. Geometries are per car; shared blur texture is kept. */
export function disposeCar(c) {
  c.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  for (const mat of Object.values(c.materials)) mat.dispose();
  c.wheels.forEach((w) => { w.ring.material.dispose(); w.blur.material.dispose(); });
  c.plateTex.dispose();
}
