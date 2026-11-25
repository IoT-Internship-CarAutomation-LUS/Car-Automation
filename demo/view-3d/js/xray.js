/* xray.js -- "Show our hardware": where our real kit sits in the car, drawn schematically.
 *
 * OBD-II port under the dashboard on the driver's (right) side with the ELM327 plugged in,
 * a Bluetooth link from the ELM327 to the Raspberry Pi 4 on the dashboard, the NEO-6M GPS
 * antenna under the windscreen, and the packet leaving the car for the backend. Placement is
 * illustrative, not measured, and the kit is drawn 1.6x size so it can be seen on a projector.
 * A pulse runs ELM327 -> Pi -> out of the car for every packet the page receives.
 */
import * as THREE from "../vendor/three/three.module.min.js";
import { RoundedBoxGeometry } from "../vendor/three/addons/RoundedBoxGeometry.js";

const K = 1.6;   // drawing scale for the kit

/* Each label opens the matching stage on /flow/ (stage ids from demo/obd-flow/js/flow.js). */
export const HW_ITEMS = [
  { key: "obd", name: "OBD-II port", sub: "Under the dashboard, driver's side", stage: "port", n: 2, dir: [-1, 1] },
  { key: "elm", name: "ELM327 adapter", sub: "Plugged into the port, Bluetooth", stage: "elm", n: 3, dir: [1, 1] },
  { key: "pi", name: "Raspberry Pi 4", sub: "On the dashboard, decodes and packs", stage: "decode", n: 4, dir: [-1, -1] },
  { key: "gps", name: "NEO-6M GPS antenna", sub: "Under the windscreen", stage: "gps", n: "GPS", dir: [1, -1] },
  { key: "out", name: "To the backend", sub: "32-byte packet over WebSocket", stage: "backend", n: 7, dir: [1, -1] },
];

export function buildXray(car, colors) {
  const x = { group: new THREE.Group(), disposables: [], pulses: [], visible: false };
  const keep = (o) => { x.disposables.push(o); return o; };
  const hw = car.hw, sp = car.spec;
  x.group.visible = false;
  car.inner.add(x.group);   // moves with the body

  x.kitMat = keep(new THREE.MeshStandardMaterial({ color: colors.kit, emissive: colors.kit, emissiveIntensity: 0.45, roughness: 0.4 }));
  x.darkMat = keep(new THREE.MeshStandardMaterial({ color: 0x20272c, roughness: 0.6 }));
  x.dashMat = keep(new THREE.MeshStandardMaterial({ color: 0x56636e, roughness: 0.8, transparent: true, opacity: 0.32, depthWrite: false }));
  const box = (w, h, d, mat, pos) => {
    const m = new THREE.Mesh(keep(new RoundedBoxGeometry(w * K, h * K, d * K, 2, Math.min(w, h, d) * 0.25 * K)), mat);
    m.position.copy(pos); m.renderOrder = 5; x.group.add(m); return m;
  };

  // a schematic dashboard and steering wheel so the placement reads (right-hand drive)
  const cabinW = (sp.Wc || sp.W * 0.8) - 0.12;
  const dash = new THREE.Mesh(keep(new RoundedBoxGeometry(0.26, 0.15, cabinW, 2, 0.04)), x.dashMat);
  dash.position.set(hw.dashX + 0.08, hw.beltY - 0.07, 0); dash.renderOrder = 4;
  x.group.add(dash);
  const wheel = new THREE.Mesh(keep(new THREE.TorusGeometry(0.17, 0.016, 10, 40)), x.darkMat);
  wheel.position.set(hw.dashX - 0.24, hw.beltY - 0.06, sp.W * 0.21);
  wheel.rotation.set(0, Math.PI / 2, 0.45, "ZYX");   // axis forward and up, toward the driver
  wheel.renderOrder = 5;
  x.group.add(wheel);

  // the kit
  const obd = box(0.03, 0.03, 0.05, x.darkMat, hw.obd);
  const elmPos = hw.obd.clone().add(new THREE.Vector3(-0.05 * K, 0, 0));
  const elm = box(0.05, 0.035, 0.04, x.kitMat, elmPos);
  const pi = box(0.088, 0.022, 0.058, x.kitMat, hw.pi);
  const gps = box(0.035, 0.012, 0.035, x.kitMat, hw.gps);
  x.anchors = { obd: obd.position, elm: elm.position, pi: pi.position, gps: gps.position, out: hw.roof };

  // Bluetooth link (dashed) and the network path out of the car (dashed)
  const lineMat = keep(new THREE.LineDashedMaterial({ color: colors.kit, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.95, depthTest: false }));
  const curve1 = new THREE.QuadraticBezierCurve3(elm.position.clone(), new THREE.Vector3((elm.position.x + pi.position.x) / 2 - 0.05, pi.position.y + 0.12, (elm.position.z + pi.position.z) / 2), pi.position.clone());
  const outStart = pi.position.clone().add(new THREE.Vector3(0, 0.03, 0));
  const curve2 = new THREE.QuadraticBezierCurve3(outStart, new THREE.Vector3(hw.roof.x + 0.2, (outStart.y + hw.roof.y) / 2 + 0.1, 0), hw.roof.clone());
  for (const c of [curve1, curve2]) {
    const g = keep(new THREE.BufferGeometry().setFromPoints(c.getPoints(40)));
    const l = new THREE.Line(g, lineMat); l.computeLineDistances(); l.renderOrder = 6;
    x.group.add(l);
  }
  x.path = [curve1, curve2];

  // packet pulses
  x.pulseGeo = keep(new THREE.SphereGeometry(0.028, 16, 12));
  x.pulseMat = keep(new THREE.MeshBasicMaterial({ color: colors.pulse, depthTest: false, transparent: true }));
  x.packet = () => {
    if (!x.visible) return;
    if (x.pulses.length >= 4) { const old = x.pulses.shift(); x.group.remove(old.mesh); }
    const mesh = new THREE.Mesh(x.pulseGeo, x.pulseMat);
    mesh.renderOrder = 7; x.group.add(mesh);
    x.pulses.push({ mesh, t: 0 });
    x.count = (x.count || 0) + 1;
  };
  x.update = (dt) => {
    const DUR = 0.95;
    for (const p of x.pulses) {
      p.t += dt / DUR;
      const k = Math.min(1, p.t);
      // first 40 % of the trip is the Bluetooth hop, the rest is the way out
      const pos = k < 0.4 ? x.path[0].getPoint(k / 0.4) : x.path[1].getPoint((k - 0.4) / 0.6);
      p.mesh.position.copy(pos);
      p.mesh.scale.setScalar(k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1);
    }
    while (x.pulses.length && x.pulses[0].t >= 1) { const p = x.pulses.shift(); x.group.remove(p.mesh); }
  };
  x.setVisible = (on) => {
    x.visible = on; x.group.visible = on;
    if (!on) { for (const p of x.pulses) x.group.remove(p.mesh); x.pulses = []; }
  };
  x.recolor = (colors2) => {
    x.kitMat.color.set(colors2.kit); x.kitMat.emissive.set(colors2.kit);
    lineMat.color.set(colors2.kit); x.pulseMat.color.set(colors2.pulse);
  };
  x.dispose = () => { car.inner.remove(x.group); for (const d of x.disposables) d.dispose(); };
  return x;
}
