/* world.js -- the ground the car drives on: a two-lane road that scrolls at the car's
 * real speed (the car stays centred), roadside posts, a compass rose that turns with the
 * GPS heading, a soft contact shadow, the lights, and the theme colours. */
import * as THREE from "../vendor/three/three.module.min.js";
import { RoomEnvironment } from "../vendor/three/addons/RoomEnvironment.js";

export const LANE = 3.5;
const ROAD_LEN = 140, PERIOD = 9;          // texture period: 3 m dash + 6 m gap (Indian two-lane road)
const POSTS = 12, POST_GAP = 15;

/** Colours for the scene, from the page's own tokens so the canvas sits in the same world. */
export function palette(css, dark) {
  const v = (n, f) => css(n) || f;
  return dark ? {
    bg: v("--ground", "#0e1317"), ground: "#121a1f", road: "#222c32", line: "#c7d0d6", dash: "#d9b24a",
    kerbA: "#c7d0d6", kerbB: "#1a2227", rose: v("--ink-3", "#8d9aa4"), roseN: v("--critical-ink", "#f07474"),
    hemiSky: 0xbfd0dc, hemiGround: 0x0e1317, hemi: 0.55, sun: 2.2, env: 0.55, shadow: 0.6, post: "#c9d1d7",
  } : {
    bg: v("--ground", "#eceff1"), ground: "#e3e8eb", road: "#8a959d", line: "#ffffff", dash: "#ffffff",
    kerbA: "#ffffff", kerbB: "#2c353b", rose: v("--ink-3", "#56636e"), roseN: v("--critical-ink", "#b02626"),
    hemiSky: 0xffffff, hemiGround: 0xaab4bb, hemi: 0.7, sun: 2.1, env: 0.55, shadow: 0.34, post: "#f3f5f6",
  };
}

function roadTexture(p) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;               // u = along the road (one PERIOD), v = across it
  const g = c.getContext("2d");
  const W = 2 * LANE + 1.4;                     // two lanes + 0.7 m shoulder each side
  const y = (m) => (m / W) * c.height;          // metres across -> pixels
  g.fillStyle = p.road; g.fillRect(0, 0, c.width, c.height);
  // kerb stones outside the edge lines, alternating, 8 per period
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? p.kerbA : p.kerbB;
    g.fillRect((i / 8) * c.width, 0, c.width / 8 + 1, y(0.32));
    g.fillRect((i / 8) * c.width, c.height - y(0.32), c.width / 8 + 1, y(0.32));
  }
  g.fillStyle = p.line;                         // solid edge lines
  g.fillRect(0, y(0.6), c.width, y(0.14));
  g.fillRect(0, c.height - y(0.74), c.width, y(0.14));
  g.fillStyle = p.dash;                         // centre dash, 3 m of every 9 m
  g.fillRect(0, y(W / 2 - 0.07), c.width / 3, y(0.14));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(ROAD_LEN / PERIOD, 1);
  return { tex: t, width: W };
}

function roseTexture(p) {
  const c = document.createElement("canvas"), S = 1024, R = S / 2;
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.translate(R, R);
  g.strokeStyle = p.rose; g.fillStyle = p.rose;
  g.globalAlpha = 0.55; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, R * 0.86, 0, Math.PI * 2); g.stroke();
  // bearing b sits at canvas angle b: the plane's +x is north, +z (canvas down) is east
  for (let b = 0; b < 360; b += 10) {
    const a = (b * Math.PI) / 180, major = b % 90 === 0, mid = b % 30 === 0;
    const r0 = R * (major ? 0.79 : mid ? 0.815 : 0.835);
    g.lineWidth = major ? 6 : 3;
    g.globalAlpha = major ? 0.8 : 0.5;
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86); g.stroke();
  }
  g.globalAlpha = 0.85;
  g.font = `650 ${Math.round(S * 0.042)}px Archivo, "Segoe UI", sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const [b, label] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]]) {
    const a = (b * Math.PI) / 180, r = R * 0.94;
    g.save(); g.translate(Math.cos(a) * r, Math.sin(a) * r); g.rotate(a - Math.PI / 2);   // letter tops face the centre: upright from outside the ring
    g.fillStyle = b === 0 ? p.roseN : p.rose; g.globalAlpha = b === 0 ? 1 : 0.85;
    g.fillText(label, 0, 0); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function radialTexture(inner, outer) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner); grd.addColorStop(0.55, inner.replace(/[\d.]+\)$/, (m) => (parseFloat(m) * 0.55).toFixed(3) + ")")); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(renderer, scene) {
  const w = { group: new THREE.Group(), disposables: [] };
  const keep = (x) => { w.disposables.push(x); return x; };
  scene.add(w.group);

  // studio reflections for the paint and glass (generated, no files)
  const pm = new THREE.PMREMGenerator(renderer);
  const envRT = pm.fromScene(new RoomEnvironment(), 0.04);
  pm.dispose();
  scene.environment = envRT.texture;
  keep(envRT);

  w.hemi = new THREE.HemisphereLight(0xffffff, 0xb9c3ca, 0.9);
  w.sun = new THREE.DirectionalLight(0xffffff, 2.6);
  w.sun.position.set(4.5, 9, 5.5);
  w.sun.castShadow = true;
  w.sun.shadow.mapSize.set(1024, 1024);
  const sc = w.sun.shadow.camera;
  sc.left = -4.2; sc.right = 4.2; sc.top = 4.2; sc.bottom = -4.2; sc.near = 1; sc.far = 25;
  w.sun.shadow.bias = -0.0004; w.sun.shadow.normalBias = 0.02;
  w.group.add(w.hemi, w.sun, w.sun.target);

  // ground and road
  w.groundMat = keep(new THREE.MeshStandardMaterial({ color: 0xe1e6e9, roughness: 1 }));
  w.ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(400, 400)), w.groundMat);
  w.ground.rotation.x = -Math.PI / 2; w.ground.position.y = -0.002; w.ground.receiveShadow = true;
  w.roadMat = keep(new THREE.MeshStandardMaterial({ roughness: 0.92 }));
  w.road = new THREE.Mesh(keep(new THREE.PlaneGeometry(ROAD_LEN, 2 * LANE + 1.4)), w.roadMat);
  w.road.rotation.x = -Math.PI / 2; w.road.receiveShadow = true;
  // India drives on the left: the car keeps the left lane, the centre line is on its right (+z)
  w.road.position.set(0, 0, LANE / 2);
  w.group.add(w.ground, w.road);

  // delineator posts on the left verge, scrolling with the road
  w.postGeo = keep(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 10));
  w.postMat = keep(new THREE.MeshStandardMaterial({ color: 0xf3f5f6, roughness: 0.6 }));
  w.capMat = keep(new THREE.MeshStandardMaterial({ color: 0xd84a1b, roughness: 0.4, emissive: 0x3a0e04 }));
  w.capGeo = keep(new THREE.CylinderGeometry(0.052, 0.052, 0.14, 10));
  w.posts = new THREE.InstancedMesh(w.postGeo, w.postMat, POSTS);
  w.caps = new THREE.InstancedMesh(w.capGeo, w.capMat, POSTS);
  w.posts.castShadow = true;
  w.group.add(w.posts, w.caps);

  // compass rose around the car; rotation.y = heading (north turns to the car's left as it turns right)
  w.roseMat = keep(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  w.rose = new THREE.Mesh(keep(new THREE.CircleGeometry(3.6, 96)), w.roseMat);
  w.rose.rotation.x = -Math.PI / 2;
  w.roseHolder = new THREE.Group();
  w.roseHolder.position.y = 0.006;
  w.roseHolder.add(w.rose);
  w.group.add(w.roseHolder);

  // soft contact shadow and the red spill of the brake lights on the road behind the car
  w.blobTex = keep(radialTexture("rgba(0,0,0,0.75)", "rgba(0,0,0,0)"));
  w.blobMat = keep(new THREE.MeshBasicMaterial({ map: w.blobTex, transparent: true, depthWrite: false, opacity: 0.5 }));
  w.blob = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), w.blobMat);
  w.blob.rotation.x = -Math.PI / 2; w.blob.position.y = 0.01;
  w.spillTex = keep(radialTexture("rgba(255,40,24,0.9)", "rgba(255,40,24,0)"));
  w.spillMat = keep(new THREE.MeshBasicMaterial({ map: w.spillTex, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending }));
  w.spill = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.4, 2.2)), w.spillMat);
  w.spill.rotation.x = -Math.PI / 2; w.spill.position.y = 0.012;
  w.group.add(w.blob, w.spill);

  w.fitCar = (dims) => {
    w.blob.scale.set(dims.L + 0.7, dims.W + 0.75, 1);
    w.spill.position.x = -dims.L / 2 - 0.85;
    w.sun.target.position.set(0, 0, 0);
  };

  let roadTex = null, roseTex = null;
  w.retheme = (p) => {
    scene.background = new THREE.Color(p.bg);
    scene.fog = new THREE.Fog(p.bg, 16, 46);
    w.groundMat.color.set(p.ground);
    if (roadTex) roadTex.dispose();
    roadTex = roadTexture(p).tex;
    const off = w.roadMat.map ? w.roadMat.map.offset.x : 0;
    roadTex.offset.x = off;
    w.roadMat.map = roadTex; w.roadMat.needsUpdate = true;
    if (roseTex) roseTex.dispose();
    roseTex = roseTexture(p);
    w.roseMat.map = roseTex; w.roseMat.needsUpdate = true;
    w.postMat.color.set(p.post);
    w.hemi.color.set(p.hemiSky); w.hemi.groundColor.set(p.hemiGround); w.hemi.intensity = p.hemi;
    w.sun.intensity = p.sun;
    scene.environmentIntensity = p.env;
    w.blobMat.opacity = p.shadow + 0.15;
  };

  // distance travelled (m) -> road texture offset and post positions
  const m4 = new THREE.Matrix4();
  w.scroll = (dist) => {
    if (w.roadMat.map) w.roadMat.map.offset.x = (dist / PERIOD) % 1;
    const span = POSTS * POST_GAP;
    for (let i = 0; i < POSTS; i++) {
      let x = ((i * POST_GAP - dist) % span + span) % span - span / 2;
      m4.makeTranslation(x, 0.45, -LANE / 2 - 1.35);
      w.posts.setMatrixAt(i, m4);
      m4.makeTranslation(x, 0.82, -LANE / 2 - 1.35);
      w.caps.setMatrixAt(i, m4);
    }
    w.posts.instanceMatrix.needsUpdate = true; w.caps.instanceMatrix.needsUpdate = true;
  };
  w.setHeading = (deg) => { w.roseHolder.rotation.y = (deg * Math.PI) / 180; };

  w.dispose = () => {
    if (roadTex) roadTex.dispose();
    if (roseTex) roseTex.dispose();
    w.posts.dispose(); w.caps.dispose();
    for (const d of w.disposables) d.dispose();
    scene.environment = null;
  };
  w.scroll(0);
  return w;
}
