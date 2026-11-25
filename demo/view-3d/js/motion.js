/* motion.js -- the pure maths behind the 3D view: no three.js, no DOM.
 *
 * Everything the car does on screen comes from its telemetry packets:
 *   speed_kmh       -> wheel spin, road scroll, body pitch (from the change in speed)
 *   gps.heading_deg -> compass rose, front-wheel steer and body roll (from the rate of turn)
 *   vehicle.brake   -> brake lights (three states: true / false / null = unknown)
 *   tyres.*         -> TPMS ring colours
 * Packets arrive at 1 Hz (simulated cars) or 5 Hz (console cars), so values are
 * interpolated across the measured packet interval instead of jumping.
 */

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
export const wrap360 = (d) => ((d % 360) + 360) % 360;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

/** Linear interpolation from the value on screen to each new packet value, over the
 *  car's own packet interval. Continuous, never a jump; at most one interval behind. */
export class Track {
  constructor(angle = false) {
    this.angle = angle; this.from = null; this.to = null; this.t0 = 0; this.dur = 1000;
    this.lastT = null; this.intervals = [];
  }
  push(value, now) {
    if (value == null) return;
    if (this.lastT != null) {
      const dt = now - this.lastT;
      if (dt > 40 && dt < 4000) { this.intervals.push(dt); if (this.intervals.length > 7) this.intervals.shift(); }
    }
    this.lastT = now;
    if (this.to == null) { this.from = this.to = value; this.t0 = now; return; }
    this.from = this.value(now);
    this.to = this.angle ? this.from + wrap180(value - this.from) : value;
    this.t0 = now;
    this.dur = clamp(median(this.intervals) || 1000, 120, 1600);
  }
  value(now) {
    if (this.to == null) return null;
    const k = clamp((now - this.t0) / this.dur, 0, 1);
    return this.from + (this.to - this.from) * k;
  }
  reset() { this.from = this.to = null; this.lastT = null; this.intervals = []; }
}

/** Per-packet derivatives: longitudinal acceleration (m/s^2) and yaw rate (deg/s). */
export class Derivs {
  constructor() { this.prev = null; this.accel = 0; this.yawRate = 0; }
  push(speedKmh, headingDeg, now) {
    const cur = { v: speedKmh == null ? null : speedKmh / 3.6, h: headingDeg, t: now };
    const p = this.prev;
    if (p) {
      const dt = (now - p.t) / 1000;
      if (dt > 0.04 && dt < 4) {
        this.accel = cur.v != null && p.v != null ? clamp((cur.v - p.v) / dt, -12, 12) : 0;
        this.yawRate = cur.h != null && p.h != null ? clamp(wrap180(cur.h - p.h) / dt, -90, 90) : 0;
      } else { this.accel = 0; this.yawRate = 0; }
    }
    this.prev = cur;
  }
  reset() { this.prev = null; this.accel = 0; this.yawRate = 0; }
}

/** Wheel angular speed (rad/s) for a road speed and tyre radius. */
export const wheelOmega = (speedKmh, radiusM) => (speedKmh || 0) / 3.6 / radiusM;

/** Front-wheel steer angle (deg) from a bicycle model: tan(delta) = wheelbase * yawRate / v.
 *  Below 1.5 m/s the yaw rate says nothing about the steering wheel, so it returns 0. */
export function steerDeg(speedKmh, yawRateDeg, wheelbaseM) {
  const v = (speedKmh || 0) / 3.6;
  if (v < 1.5) return 0;
  const r = (yawRateDeg * Math.PI) / 180;
  return clamp((Math.atan((wheelbaseM * r) / v) * 180) / Math.PI, -30, 30);
}

/** Target body pitch (deg, + = nose up): squat under acceleration, dive under braking. */
export const pitchTarget = (accel) => clamp(accel * 0.42, -2.2, 1.5);
/** Target body roll (deg, + = roof toward the car's right): rolls away from the turn. */
export function rollTarget(speedKmh, yawRateDeg) {
  const aLat = ((speedKmh || 0) / 3.6) * ((yawRateDeg * Math.PI) / 180);   // + = turning right
  return clamp(-aLat * 0.45, -2.2, 2.2);
}

/** A small spring-damper so the body settles with one soft overshoot, like a suspension. */
export class Spring {
  constructor(freq = 5.5, damping = 0.62) { this.x = 0; this.v = 0; this.w = freq; this.z = damping; }
  step(target, dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.w * this.w * (target - this.x) - 2 * this.z * this.w * this.v;
      this.v += a * h; this.x += this.v * h;
    }
    return this.x;
  }
  reset() { this.x = 0; this.v = 0; }
}

/** Exponential approach, frame-rate independent. */
export const damp = (cur, target, tau, dt) => target + (cur - target) * Math.exp(-dt / Math.max(1e-4, tau));

/** TPMS ring state, matching the fleet thresholds:
 *  red below 180 kPa or above 90 C (the fleet's critical alerts), amber below 200 kPa or
 *  above 80 C, green otherwise; grey when the car has no TPMS reading. */
export function tyreState(t) {
  const p = t && t.pressure_kpa, c = t && t.temp_c;
  if (p == null && c == null) return "none";
  if ((p != null && p < 180) || (c != null && c > 90)) return "red";
  if ((p != null && p < 200) || (c != null && c > 80)) return "amber";
  return "green";
}

/** Brake light state: "on" (brake true), "dim" (false: tail lamps only), "unlit" (null: unknown). */
export const brakeState = (brake) => (brake === true ? "on" : brake === false ? "dim" : "unlit");
