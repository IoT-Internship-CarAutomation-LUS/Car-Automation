/* view3d.js -- a live 3D view of one fleet car, driven only by its telemetry.
 *
 *   const view = await createView(container, { carId: "corolla", compact: false });
 *   view.setCar("veyron"); view.preset("side"); view.setXray(true); view.dispose();
 *
 * Used full-window by /3d/ and embedded in the fleet car view ("3D view"). It reads the
 * same state as the fleet dashboard (window.FT.state, filled by ../fleet/js/app.js from the
 * backend WebSocket), so it sees every car, including console cars that join later.
 */
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/addons/OrbitControls.js";
import { SPECS, bodyFor, buildCar, disposeCar } from "./bodies.js";
import { buildWorld, palette } from "./world.js";
import { buildXray, HW_ITEMS } from "./xray.js";
import { Track, Derivs, Spring, damp, clamp, wheelOmega, steerDeg, pitchTarget, rollTarget, tyreState, brakeState, wrap360 } from "./motion.js";

const FT = window.FT;
const STALE_MS = 3000, OFFLINE_MS = 10000;
const TAIL = { on: 2.6, dim: 0.32, unlit: 0 };
const POS = ["fl", "fr", "rl", "rr"];
const registry = { created: 0, disposed: 0, live: 0 };
Object.defineProperty(window, "__view3dRegistry", { configurable: true, get: () => ({ ...registry }) });

/** WebGL 2 is what three.js r186 needs. */
export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    const ok = !!gl;
    if (gl) { const l = gl.getExtension("WEBGL_lose_context"); l && l.loseContext(); }
    return ok;
  } catch (e) { return false; }
}

const esc = (s) => FT.esc(s);
const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#v3-${id.replace(/^i-/, "")}"/></svg>`;

/* The module brings its own icons, so it renders the same inside /3d/ and the fleet car view. */
const SPRITE = `<svg id="v3d-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <symbol id="v3-warn" viewBox="0 0 24 24"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2v.3"/></symbol>
  <symbol id="v3-crit" viewBox="0 0 24 24"><path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z"/><path d="M12 7.5v5.5M12 16.2v.3"/></symbol>
  <symbol id="v3-unknown" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.6v.4M12 16.8v.3"/></symbol>
  <symbol id="v3-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.3"/></symbol>
  <symbol id="v3-chip" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/></symbol>
  <symbol id="v3-car" viewBox="0 0 22 36"><rect x="1.5" y="1.5" width="19" height="33" rx="7" style="fill:var(--car, #5f6d79);stroke:var(--car-edge, #fff)" stroke-width="1.6"/><rect x="4.5" y="9" width="13" height="6.5" rx="2.2" style="fill:rgba(255,255,255,0.8)"/><rect x="5" y="25" width="12" height="4.5" rx="1.8" style="fill:rgba(255,255,255,0.8)"/></symbol>
</defs></svg>`;
function ensureSprite() { if (!document.getElementById("v3d-sprite")) document.body.insertAdjacentHTML("afterbegin", SPRITE); }
const compass = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(wrap360(d) / 45) % 8];

/* ---------------- camera presets (positions for a 4.2 m car, scaled by length) ---------------- */
const PRESETS = {
  hero: [5.6, 2.35, 6.6], chase: [-8.4, 2.9, 1.7], side: [0.25, 1.3, 9.0], top: [0.0, 12.5, 0.02],
};

export async function createView(container, opts = {}) {
  const compact = !!opts.compact;
  ensureSprite();
  const flowBase = opts.flowBase || "../flow/";
  const root = document.createElement("div");
  root.className = "v3d" + (compact ? " v3d-compact" : "");
  root.innerHTML = shellHtml(compact);
  container.appendChild(root);
  const q = (s) => root.querySelector(s);

  if (!webglAvailable()) {
    showMsg(q, "no-webgl", "3D needs WebGL, which is turned off or unsupported in this browser.",
      compact ? "The gauges stay in this panel. Everything else in the car view still works." : "The fleet dashboard and the car view still work: open them from the header.");
    return { ok: false, el: root, dispose() { root.remove(); } };
  }

  // the plate is lettered in the dashboard's mono face; wait briefly for it, never block
  try { await Promise.race([document.fonts.load('600 64px "Red Hat Mono"'), new Promise((r) => setTimeout(r, 800))]); } catch (e) { /* fallback face */ }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.preserve });
  } catch (e) {
    showMsg(q, "no-webgl", "3D could not start: the browser refused a WebGL context.", "The 2D views still work.");
    return { ok: false, el: root, dispose() { root.remove(); } };
  }
  registry.created++; registry.live++;
  const canvas = renderer.domElement;
  canvas.className = "v3d-canvas";
  canvas.setAttribute("role", "img");
  q(".v3d-stage").prepend(canvas);
  let maxDpr = 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(compact ? 30 : 32, 1, 0.1, 200);
  const world = buildWorld(renderer, scene);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 3.2; controls.maxDistance = 24;
  controls.minPolarAngle = 0.02; controls.maxPolarAngle = Math.PI / 2 - 0.05;   // never under the road
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, 0.62, 0);

  /* ---------------- state ---------------- */
  const st = {
    id: null, car: null, xray: null, built: null, seenRx: null, msg: null,
    speed: new Track(), heading: new Track(true), der: new Derivs(),
    pitch: new Spring(5.2, 0.6), roll: new Spring(4.6, 0.65),
    vDisp: 0, headDisp: 0, spinAngle: 0, dist: 0, steer: 0, grey: 0, tail: 0, omega: 0,
    brake: "unlit", rings: { fl: "none", fr: "none", rl: "none", rr: "none" },
    xrayOn: false, fps: 0, frames: 0, fpsFrames: 0, fpsT: performance.now(), slow: 0, quality: 2,
    lastInteract: -1e9, tween: null, statusWord: "waiting", stale: false, offline: false,
    lastDom: 0, tip: null, packets: 0, hover: false,
  };
  let colors = null;

  /* ---------------- theme ---------------- */
  function themeColors() {
    const css = (n) => FT.cssVar(n);
    return {
      pal: palette(css, FT.isDark()),
      good: css("--good") || "#0ca30c", warning: css("--warning") || "#fab219", critical: css("--critical") || "#d03b3b",
      muted: css("--muted-state") || "#8a96a0", kit: css("--accent") || "#0c6b4f", pulse: css("--focus") || "#1a8c69",
    };
  }
  function retheme() {
    colors = themeColors();
    world.retheme(colors.pal);
    if (st.car) applyPaint(true);
    if (st.xray) st.xray.recolor(colors);
    for (const p of POS) setRing(p, st.rings[p], true);
  }
  const mo = new MutationObserver(retheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  mq && mq.addEventListener && mq.addEventListener("change", retheme);

  /* ---------------- car ---------------- */
  function baseColor() { return new THREE.Color(FT.cssVar(`--s${FT.slotFor(st.id)}`) || "#5f6d79"); }
  function applyPaint(force) {
    const c = st.car; if (!c) return;
    const grey = new THREE.Color(colors.muted);
    c.materials.paint.color.copy(baseColor()).lerp(grey, st.grey * 0.85);
    c.materials.head.emissiveIntensity = 0.55 * (1 - st.grey);
  }
  function setRing(p, state, force) {
    if (!st.car) return;
    if (!force && st.rings[p] === state) return;
    st.rings[p] = state;
    const w = st.car.wheels.find((x) => x.id === p);
    w.ring.material.color.set({ green: colors.good, amber: colors.warning, red: colors.critical, none: colors.muted }[state]);
  }

  function build(msg) {
    teardownCar();
    const id = st.id, type = bodyFor(id);
    const c = buildCar(type, baseColor(), { reg: msg.source.reg_no, ev: msg.source.powertrain === "ev", font: '"Red Hat Mono", ui-monospace, monospace' });
    scene.add(c.group);
    c.group.traverse((o) => { if (o.isMesh && o.castShadow) o.receiveShadow = false; });
    st.car = c; st.built = id + ":" + type;
    world.fitCar(c.dims);
    st.xray = buildXray(c, colors);
    st.xray.setVisible(st.xrayOn);
    applyXrayMaterials();
    const k = Math.max(1, c.dims.L / 4.2);
    controls.minDistance = 3.2 * k; controls.maxDistance = 24 * k;
    for (const p of POS) setRing(p, "none", true);
    applyPaint(true);
    canvas.setAttribute("aria-label", `3D view of the ${msg.source.name}, a ${SPECS[type].label.toLowerCase()}, driven by its live telemetry`);
  }
  function teardownCar() {
    if (!st.car) return;
    if (st.xray) { st.xray.dispose(); st.xray = null; }
    scene.remove(st.car.group);
    disposeCar(st.car);
    st.car = null;
  }
  function resetMotion() {
    st.speed.reset(); st.heading.reset(); st.der.reset(); st.pitch.reset(); st.roll.reset();
    st.vDisp = 0; st.steer = 0; st.grey = 0; st.seenRx = null; st.msg = null; st.packets = 0;
  }

  function setCar(id) {
    if (!id || id === st.id) return;
    st.id = id;
    teardownCar(); resetMotion();
    st.tween = null;
    flyTo("hero", 0);
    const car = FT.state.cars[id];
    if (car && car.msg) onPacket(car, performance.now());
    renderReadout(true);
  }

  /* ---------------- packets ---------------- */
  function onPacket(car, now) {
    const msg = car.msg;
    st.seenRx = car.lastRx; st.msg = msg; st.packets++;
    if (!st.car || st.built !== st.id + ":" + bodyFor(st.id)) build(msg);
    const v = msg.vehicle || {}, g = msg.gps || {};
    if (st.stale) { st.speed.from = st.speed.to = st.vDisp; st.speed.t0 = now; }   // resume from the coasted value
    const spd = v.speed_kmh == null ? 0 : v.speed_kmh;
    st.speed.push(spd, now);
    if (g.heading_deg != null) st.heading.push(g.heading_deg, now);
    st.der.push(v.speed_kmh, g.heading_deg, now);
    st.brake = brakeState(v.brake);
    const ty = msg.tyres || {};
    for (const p of POS) setRing(p, tyreState(ty[p]));
    if (st.xray) st.xray.packet();
    renderReadout(true);
  }

  /* ---------------- X-ray materials ---------------- */
  function applyXrayMaterials() {
    const c = st.car; if (!c) return;
    const m = c.materials, on = st.xrayOn;
    for (const [k, op] of [["paint", 0.14], ["glass", 0.08], ["trim", 0.18], ["chassis", 0.1], ["seat", 0.25], ["plate", 0.35], ["head", 0.4], ["tail", 0.5]]) {
      const mat = m[k]; if (!mat) continue;
      mat.transparent = on; mat.opacity = on ? op : 1; mat.depthWrite = !on; mat.needsUpdate = true;
    }
    for (const mesh of c.meshes) mesh.castShadow = on ? false : mesh.userData.part !== "glass" && mesh.userData.part !== "lamp" && mesh.userData.part !== "plate";
  }
  function setXray(on) {
    st.xrayOn = !!on;
    if (st.xray) st.xray.setVisible(st.xrayOn);
    applyXrayMaterials();
    const b = q(".v3d-xray");
    b.setAttribute("aria-pressed", String(st.xrayOn));
    b.querySelector("span").textContent = st.xrayOn ? "Hide our hardware" : "Show our hardware";
    q(".v3d-hwlayer").hidden = !st.xrayOn;
    q(".v3d-hwnote").hidden = !st.xrayOn;
    root.classList.toggle("is-xray", st.xrayOn);
    if (st.xrayOn && (st.statusWord === "moving")) { /* keep the camera where the presenter put it */ }
  }

  /* ---------------- camera ---------------- */
  const sph = new THREE.Spherical(), sphB = new THREE.Spherical(), tmp = new THREE.Vector3();
  function presetPos(name) {
    const k = st.car ? Math.max(0.92, st.car.dims.L / 4.2) : 1;
    const p = PRESETS[name] || PRESETS.hero;
    const out = new THREE.Vector3(p[0] * k, p[1] * (name === "top" ? k : Math.min(k, 1.1)), p[2] * k);
    if (compact) out.multiplyScalar(name === "top" ? 1.0 : 1.04);
    return out.add(controls.target);
  }
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  function flyTo(name, ms = 750) {
    if (reduceMotion && reduceMotion.matches) ms = 0;     // camera jumps instead of flying
    const to = presetPos(name);
    st.lastInteract = performance.now();
    controls.autoRotate = false;
    st.view = name;
    if (!ms) { camera.position.copy(to); controls.update(); return; }
    sph.setFromVector3(tmp.copy(camera.position).sub(controls.target));
    sphB.setFromVector3(tmp.copy(to).sub(controls.target));
    let dTheta = sphB.theta - sph.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    st.tween = { t0: performance.now(), ms, a: sph.clone(), dTheta, b: sphB.clone() };
  }
  function stepTween(now) {
    const tw = st.tween; if (!tw) return;
    const k = clamp((now - tw.t0) / tw.ms, 0, 1), e = 1 - Math.pow(1 - k, 4);   // ease-out quart
    const s = new THREE.Spherical(tw.a.radius + (tw.b.radius - tw.a.radius) * e, tw.a.phi + (tw.b.phi - tw.a.phi) * e, tw.a.theta + tw.dTheta * e);
    camera.position.setFromSpherical(s).add(controls.target);
    if (k >= 1) st.tween = null;
  }
  controls.addEventListener("start", () => { st.lastInteract = performance.now(); st.tween = null; controls.autoRotate = false; st.view = "free"; });
  controls.addEventListener("end", () => { st.lastInteract = performance.now(); });

  /* ---------------- resize ---------------- */
  const stage = q(".v3d-stage");
  function resize() {
    const w = Math.max(2, stage.clientWidth), h = Math.max(2, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole car in frame on narrow canvases
    camera.fov = (compact ? 30 : 32) * clamp(1.55 / camera.aspect, 1, 1.6);
    // nudge the picture right (and down when embedded) so the readout card never sits on the car
    if (camera.aspect > 1.2) camera.setViewOffset(w, h, -w * (compact ? 0.09 : 0.06), compact ? -h * 0.06 : 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(stage);

  /* ---------------- hover: tyre pressures ---------------- */
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  function onMove(e) {
    if (!st.car) return;
    const r = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const targets = st.car.wheels.flatMap((w) => [w.tyre, w.ring]);
    const hit = ray.intersectObjects(targets, false)[0];
    const tip = q(".v3d-tip");
    if (!hit) { tip.hidden = true; st.tip = null; canvas.style.cursor = ""; return; }
    const p = hit.object.userData.tyre;
    st.tip = p;
    canvas.style.cursor = "help";
    tip.innerHTML = tyreTip(p);
    tip.hidden = false;
    const sr = stage.getBoundingClientRect();
    let x = e.clientX - sr.left + 14, y = e.clientY - sr.top + 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > sr.width - 8) x = e.clientX - sr.left - tw - 12;
    if (y + th > sr.height - 8) y = e.clientY - sr.top - th - 12;
    tip.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
  }
  function tyreTip(p) {
    const msg = st.msg, t = (msg && msg.tyres && msg.tyres[p]) || {};
    const name = FT.POS_NAME[p] + " tyre";
    const s = st.rings[p];
    if (s === "none") return `<div class="tt-title">${name}</div><div>TPMS not fitted</div>`;
    const word = { green: "Normal", amber: "Watch: below 200 kPa or above 80 °C", red: "Alert: below 180 kPa or above 90 °C" }[s];
    return `<div class="tt-title">${s === "red" ? icon("i-crit") : s === "amber" ? icon("i-warn") : ""}${name}</div>
      <div class="tt-row"><span>Pressure</span><span class="num">${t.pressure_kpa == null ? "No reading" : t.pressure_kpa.toFixed(1) + " kPa"}</span></div>
      <div class="tt-row"><span>Temperature</span><span class="num">${t.temp_c == null ? "No reading" : t.temp_c + " °C"}</span></div>
      <div class="tt-state" data-s="${s}">${word}</div>`;
  }
  canvas.addEventListener("pointermove", onMove);
  const onLeave = () => { q(".v3d-tip").hidden = true; st.tip = null; };
  canvas.addEventListener("pointerleave", onLeave);
  // the auto-orbit holds still while the pointer is over the view, so labels and buttons can be clicked
  const stageEl = q(".v3d-stage");
  const onEnter = () => { st.hover = true; }, onExit = () => { st.hover = false; st.lastInteract = performance.now(); };
  stageEl.addEventListener("pointerenter", onEnter);
  stageEl.addEventListener("pointerleave", onExit);

  /* ---------------- controls (buttons + keys) ---------------- */
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) { flyTo(b.dataset.preset); markPreset(b.dataset.preset); }
    if (e.target.closest(".v3d-xray")) setXray(!st.xrayOn);
  });
  function markPreset(name) {
    root.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === name)));
  }
  function onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    if (!root.isConnected || root.offsetParent === null) return;
    const k = e.key.toLowerCase();
    const map = { c: "chase", s: "side", t: "top", r: "hero" };
    if (map[k]) { flyTo(map[k]); markPreset(map[k] === "hero" ? null : map[k]); if (k === "r") controls.autoRotate = false; e.preventDefault(); }
    else if (k === "x") { setXray(!st.xrayOn); e.preventDefault(); }
  }
  window.addEventListener("keydown", onKey);

  /* ---------------- readout ---------------- */
  function renderReadout(force) {
    const now = performance.now();
    if (!force && now - st.lastDom < 200) return;
    st.lastDom = now;
    const car = FT.state.cars[st.id];
    const msg = st.msg;
    const waiting = q(".v3d-wait");
    if (!msg) {
      waiting.hidden = false;
      waiting.querySelector("strong").textContent = st.id ? `Waiting for packets from ${st.id}` : "Pick a car";
      waiting.querySelector("span").textContent = "The car appears as soon as its first packet arrives.";
      q(".v3d-readout").hidden = true;
      return;
    }
    q(".v3d-readout").hidden = false;
    const gone = !car;
    waiting.hidden = !gone;
    if (gone) {
      waiting.querySelector("strong").textContent = `${msg.source.name} left the fleet`;
      waiting.querySelector("span").textContent = "Its Control Console disconnected. Pick another car.";
    }
    const src = msg.source, v = msg.vehicle || {}, ev = src.powertrain === "ev";
    const R = (sel) => q(".v3d-readout " + sel);
    set(R(".r-name"), src.name);
    R(".car-glyph").style.setProperty("--car", FT.carColor(st.id));
    set(R(".plate"), src.reg_no || "No plate");
    R(".plate").dataset.ev = String(ev);
    const tag = FT.modeTag(src.data_mode);
    if (R(".r-mode").innerHTML !== tag) R(".r-mode").innerHTML = tag;
    set(R(".r-body"), SPECS[bodyFor(st.id)].label);
    const sw = gone ? "offline" : FT.statusOf(car);
    st.statusWord = sw;
    R(".status").dataset.s = sw;
    set(R(".status"), gone ? "Left" : FT.STATUS_WORD[sw]);

    const prov = (k) => FT.prov(msg, "vehicle", k);
    const sv = v.speed_kmh;
    set(R(".r-speed-v"), sv == null ? FT.nullText(prov("speed_kmh"), msg) : sv >= 254 ? "254+" : String(Math.round(sv)));
    R(".r-speed-v").classList.toggle("is-null", sv == null);
    cell(R("[data-k=rpm]"), v.rpm == null ? null : Math.round(v.rpm).toLocaleString("en-IN"), prov("rpm"), msg);
    R("[data-k=rpm] dt").textContent = ev ? "Motor rpm" : "RPM";
    cell(R("[data-k=gear]"), v.gear == null ? null : v.gear === 0 ? "N" : v.gear === 14 ? "R" : String(v.gear), prov("gear"), msg);
    cell(R("[data-k=throttle]"), v.throttle_pct == null ? null : v.throttle_pct.toFixed(1) + " %", prov("throttle_pct"), msg);
    R("[data-k=throttle] dt").textContent = ev ? "Accelerator" : "Throttle";
    const hd = msg.gps && msg.gps.heading_deg;
    cell(R("[data-k=heading]"), hd == null ? null : `${Math.round(hd)}° ${compass(hd)}`, FT.prov(msg, "gps"), msg);

    // brake: three states, null is UNKNOWN (never OFF)
    const bst = prov("brake");
    const pill = R(".r-brake .pill"), note = R(".r-brake-note");
    if (v.brake == null) {
      pill.dataset.v = "unknown"; pill.innerHTML = icon("i-unknown") + "Unknown";
      note.textContent = bst === "not_supported" ? "(not found on CAN bus)" : "(no reading)";
    } else { pill.dataset.v = v.brake ? "on" : "off"; pill.textContent = v.brake ? "ON" : "OFF"; note.textContent = v.brake ? "brake lights lit" : ""; }

    // driver pedals (console cars only)
    const ped = R(".r-pedals");
    const live = FT.isLiveCar(msg) && msg.driver;
    ped.hidden = !live;
    if (live) for (const [k, key] of [["throttle", "throttle_pedal_pct"], ["brake", "brake_pedal_pct"], ["clutch", "clutch_pedal_pct"]]) {
      const val = msg.driver[key], el = ped.querySelector(`[data-k=${k}]`);
      el.querySelector("i").style.width = clamp(val || 0, 0, 100) + "%";
      set(el.querySelector(".num"), val == null ? "--" : Math.round(val) + "%");
    }

    // tyres
    const ty = R(".r-tyres");
    if (ty) {
      const none = POS.every((p) => st.rings[p] === "none");
      const html = none ? `<span class="r-k">Tyres</span><span class="r-null">TPMS not fitted</span>`
        : `<span class="r-k">Tyres, kPa</span>` + POS.map((p) => {
          const t = msg.tyres[p] || {}, s = st.rings[p];
          return `<span class="r-tyre" data-s="${s}" title="${esc(FT.POS_NAME[p])}">${s === "red" ? icon("i-crit") : s === "amber" ? icon("i-warn") : ""}<b>${p.toUpperCase()}</b><span class="num">${t.pressure_kpa == null ? "--" : Math.round(t.pressure_kpa)}</span></span>`;
        }).join("");
      if (ty.innerHTML !== html) ty.innerHTML = html;
    }

    const age = car ? Date.now() - car.lastRx : null;
    set(R(".r-age"), age == null ? "--" : FT.ageStr(age) + " ago");
    const pv = FT.provTag(FT.prov(msg, "vehicle"), msg);
    if (R(".r-prov").innerHTML !== pv) R(".r-prov").innerHTML = pv;
  }
  const set = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  function cell(el, val, state, msg) {
    const dd = el.querySelector("dd");
    const isNull = val == null;
    dd.classList.toggle("is-null", isNull);
    dd.classList.toggle("num", !isNull);
    set(dd, isNull ? FT.nullText(state, msg) : val);
  }

  /* ---------------- hardware labels ---------------- */
  const hwLayer = q(".v3d-hwlayer");
  hwLayer.innerHTML = `<svg class="v3d-leaders" aria-hidden="true"></svg>` + HW_ITEMS.map((it) =>
    `<a class="v3d-hw" data-k="${it.key}" href="${flowBase}#car=${encodeURIComponent(opts.carId || "fronx")}&stage=${it.stage}" title="Open ${it.n === "GPS" ? "the GPS branch" : "stage " + it.n} on How data flows">
      <span class="hw-name">${esc(it.name)}</span><span class="hw-sub">${esc(it.sub)}</span><span class="hw-stage">${it.n === "GPS" ? "GPS branch" : "Stage " + it.n}<span class="hw-long"> on How data flows</span></span></a>`).join("");
  const proj = new THREE.Vector3();
  function placeLabels() {
    if (!st.xrayOn || !st.xray || !st.car) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    const svg = hwLayer.querySelector("svg");
    let lines = "";
    st.car.inner.updateWorldMatrix(true, true);
    for (const it of HW_ITEMS) {
      const a = st.xray.anchors[it.key];
      proj.copy(a).applyMatrix4(st.car.inner.matrixWorld).project(camera);
      const x = ((proj.x + 1) / 2) * w, y = ((1 - proj.y) / 2) * h;
      const el = hwLayer.querySelector(`[data-k=${it.key}]`);
      const off = compact ? 40 : 78;
      const bottom = compact ? 52 : 8;   // keep clear of the camera buttons
      const ew = el.offsetWidth || 160, eh = el.offsetHeight || 60;
      const lx = clamp(x + it.dir[0] * off, it.dir[0] > 0 ? 8 : ew + 8, it.dir[0] > 0 ? w - ew - 8 : w - 8);
      const ly = clamp(y + it.dir[1] * off * 0.8, it.dir[1] > 0 ? 8 : eh + 8, it.dir[1] > 0 ? h - eh - bottom : h - bottom);
      el.style.transform = `translate(${lx}px, ${ly}px) translate(${it.dir[0] > 0 ? "0" : "-100%"}, ${it.dir[1] > 0 ? "0" : "-100%"})`;
      el.hidden = proj.z > 1;
      el.href = `${flowBase}#car=${encodeURIComponent(st.id || "fronx")}&stage=${it.stage}`;
      lines += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`;
    }
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = lines;
  }

  /* ---------------- frame loop ---------------- */
  const timer = new THREE.Timer();
  timer.connect(document);
  function frame() {
    timer.update();
    const dt = Math.min(0.1, timer.getDelta());
    const now = performance.now();
    st.frames++; st.fpsFrames++;
    if (now - st.fpsT >= 1000) {
      st.fps = (st.fpsFrames * 1000) / (now - st.fpsT); st.fpsFrames = 0; st.fpsT = now;
      adapt();
    }
    const car = FT.state.cars[st.id];
    if (car && car.msg && car.lastRx !== st.seenRx) onPacket(car, now);

    const age = car && car.lastRx ? Date.now() - car.lastRx : Infinity;
    st.offline = !car || age > OFFLINE_MS;
    st.stale = st.offline || age > STALE_MS;

    if (st.car) {
      // speed: interpolated while fresh, coasting to a stop when stale or offline
      st.vDisp = st.stale ? damp(st.vDisp, 0, 0.7, dt) : Math.max(0, st.speed.value(now) || 0);
      if (st.vDisp < 0.05) st.vDisp = st.stale ? 0 : st.vDisp;
      const R = st.car.dims.R;
      st.omega = wheelOmega(st.vDisp, R);
      st.spinAngle = (st.spinAngle + st.omega * dt) % (Math.PI * 2000);
      st.dist += (st.vDisp / 3.6) * dt;
      world.scroll(st.dist);
      const blurOp = clamp((st.omega - 16) / 42, 0, 0.9);
      const yaw = st.stale ? 0 : st.der.yawRate;
      st.steer = damp(st.steer, st.stale ? 0 : steerDeg(st.vDisp, yaw, st.car.dims.wheelbase), 0.28, dt);
      for (const w of st.car.wheels) {
        w.spin.rotation.z = w.right ? -st.spinAngle : st.spinAngle;
        w.blur.material.opacity = blurOp;
        if (w.front) w.steer.rotation.y = -(st.steer * Math.PI) / 180;
      }
      const pt = st.stale ? 0 : pitchTarget(st.der.accel);
      const rt = st.stale ? 0 : rollTarget(st.vDisp, yaw);
      st.car.body.rotation.z = (st.pitch.step(pt, dt) * Math.PI) / 180;
      st.car.body.rotation.x = (st.roll.step(rt, dt) * Math.PI) / 180;
      const hdg = st.heading.value(now);
      if (hdg != null) { st.headDisp = hdg; world.setHeading(hdg); }

      // brake lights and the stale/offline grey-out
      const tailTarget = TAIL[st.brake] * (1 - st.grey * 0.8);
      st.tail = damp(st.tail, tailTarget, 0.06, dt);
      st.car.materials.tail.emissiveIntensity = st.tail;
      world.spillMat.opacity = clamp((st.tail - 0.5) / 2, 0, 1) * (FT.isDark() ? 0.6 : 0.45);
      const gTarget = st.offline ? 1 : st.stale ? 0.7 : 0;
      const g0 = st.grey;
      st.grey = damp(st.grey, gTarget, 0.35, dt);
      if (Math.abs(g0 - st.grey) > 0.002) applyPaint();
      if (st.xray) st.xray.update(dt);
    }

    // idle cars get a slow orbit after a few seconds without input
    const idle = st.vDisp < 0.5 && !st.tween && !st.hover && now - st.lastInteract > 6000 && !(reduceMotion && reduceMotion.matches);
    controls.autoRotate = idle;
    stepTween(now);
    controls.update(dt);
    renderer.render(scene, camera);
    placeLabels();
    renderReadout(false);
  }
  function adapt() {
    if (document.hidden) return;
    st.slow = st.fps < 40 ? st.slow + 1 : 0;
    if (st.slow >= 3 && st.quality > 0) {
      st.quality--; st.slow = 0;
      if (st.quality === 1) { maxDpr = 1; renderer.setPixelRatio(1); resize(); }
      if (st.quality === 0) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
    }
  }
  const onVis = () => {
    if (document.hidden) renderer.setAnimationLoop(null);
    else { st.fpsT = performance.now(); st.fpsFrames = 0; renderer.setAnimationLoop(frame); }
  };
  document.addEventListener("visibilitychange", onVis);

  /* ---------------- debug (read-only, for tests) ---------------- */
  const debug = Object.freeze({
    get car() { return st.id; }, get body() { return st.car ? st.car.type : null; },
    get speedKmh() { return st.vDisp; }, get packetSpeedKmh() { return st.msg && st.msg.vehicle ? st.msg.vehicle.speed_kmh : null; },
    get wheelOmega() { return st.omega; }, get tyreRadius() { return st.car ? st.car.dims.R : null; },
    get brakeLight() { return st.brake; }, get tailEmissive() { return st.tail; },
    get brakeValue() { return st.msg && st.msg.vehicle ? st.msg.vehicle.brake : undefined; },
    get rings() { return { ...st.rings }; }, get pitchDeg() { return st.pitch.x; }, get rollDeg() { return st.roll.x; },
    get steerDeg() { return st.steer; }, get headingDeg() { return st.headDisp; }, get fps() { return st.fps; },
    get frames() { return st.frames; }, get xray() { return st.xrayOn; }, get grey() { return st.grey; },
    get stale() { return st.stale; }, get quality() { return st.quality; }, get packets() { return st.packets; },
    get pulses() { return st.xray ? st.xray.count || 0 : 0; }, get view() { return st.view; },
    get autoRotate() { return controls.autoRotate; }, get compact() { return compact; },
    get background() { return scene.background ? "#" + scene.background.getHexString() : null; },
    get drawCalls() { return renderer.info.render.calls; }, get triangles() { return renderer.info.render.triangles; },
    get memory() { return { ...renderer.info.memory }; }, get pixelRatio() { return renderer.getPixelRatio(); },
    get camera() { return camera.position.toArray().map((n) => +n.toFixed(2)); },
    get canvasSize() { return [canvas.width, canvas.height]; },
  });
  window.__view3d = debug;

  /* ---------------- start ---------------- */
  retheme();
  resize();
  flyTo("hero", 0);
  setCar(opts.carId || "fronx");
  renderer.setAnimationLoop(frame);

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    mo.disconnect(); ro.disconnect();
    mq && mq.removeEventListener && mq.removeEventListener("change", retheme);
    timer.dispose();
    controls.dispose();
    teardownCar();
    world.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.remove();
    registry.disposed++; registry.live--;
    if (window.__view3d === debug) window.__view3d = null;
  }

  return {
    ok: true, el: root, setCar, setXray, preset: (n) => { flyTo(n); markPreset(n); }, dispose,
    get id() { return st.id; }, retheme, debug,
  };
}

/* ---------------- markup ---------------- */
function shellHtml(compact) {
  const presets = [["chase", "Chase", "C"], ["side", "Side", "S"], ["top", "Top", "T"]];
  return `
  <div class="v3d-stage">
    <section class="v3d-readout" aria-label="Live readout" hidden>
      <div class="r-id">
        <svg class="car-glyph" viewBox="0 0 22 36" aria-hidden="true"><use href="#v3-car"/></svg>
        <div class="r-names"><h2 class="r-name"></h2>
          <div class="r-sub"><span class="plate"></span><span class="r-mode"></span><span class="r-body"></span></div></div>
        <span class="status" data-s="waiting"></span>
      </div>
      <div class="r-main">
        <div class="r-speed"><span class="num r-speed-v">--</span><span class="r-unit">km/h</span></div>
        <dl class="r-grid">
          <div data-k="rpm"><dt>RPM</dt><dd>--</dd></div>
          <div data-k="gear"><dt>Gear</dt><dd>--</dd></div>
          <div data-k="throttle"><dt>Throttle</dt><dd>--</dd></div>
          <div data-k="heading"><dt>Heading</dt><dd>--</dd></div>
        </dl>
      </div>
      <div class="r-brake"><span class="r-k">Brake:</span> <span class="pill" data-v="unknown">--</span> <span class="r-brake-note"></span></div>
      <div class="r-pedals" hidden>
        <div class="r-ped" data-k="throttle"><span>Throttle</span><span class="r-bar"><i></i></span><span class="num">--</span></div>
        <div class="r-ped" data-k="brake"><span>Brake</span><span class="r-bar"><i></i></span><span class="num">--</span></div>
        <div class="r-ped" data-k="clutch"><span>Clutch</span><span class="r-bar"><i></i></span><span class="num">--</span></div>
      </div>
      ${compact ? "" : `<div class="r-tyres"></div>`}
      <div class="r-foot"><span>Last packet <span class="num r-age">--</span></span><span class="r-prov"></span></div>
    </section>
    <div class="v3d-wait" hidden><strong>Waiting for packets</strong><span>The car appears as soon as its first packet arrives.</span></div>
    <div class="v3d-msg" hidden></div>
    <div class="v3d-hwlayer" hidden></div>
    <p class="v3d-hwnote" hidden>${icon("i-info")}${compact ? "Illustrative placement. Labels open How data flows." : "Illustrative placement, kit drawn larger than life. Click a label to open that stage on How data flows."}</p>
    <div class="v3d-tip" role="tooltip" hidden></div>
    <div class="v3d-dock">
      <div class="v3d-presets" role="group" aria-label="Camera">
        ${presets.map(([k, l, key]) => `<button class="v3d-btn" type="button" data-preset="${k}" aria-pressed="false" title="${l} camera (${key})">${l}<span class="kbd">${key}</span></button>`).join("")}
      </div>
      <button class="v3d-btn v3d-xray" type="button" aria-pressed="false" title="Show where our kit sits (X)">${icon("i-chip")}<span>Show our hardware</span><span class="kbd">X</span></button>
    </div>
    ${compact ? "" : `<p class="v3d-keys">Drag to orbit, scroll to zoom. <span class="kbd">R</span> resets the camera.</p>`}
  </div>`;
}

function showMsg(q, kind, title, body) {
  const m = q(".v3d-msg");
  m.dataset.kind = kind;
  m.innerHTML = `${icon("i-warn")}<div><strong>${title}</strong><span>${body}</span></div>`;
  m.hidden = false;
  q(".v3d-dock").hidden = true;
}
