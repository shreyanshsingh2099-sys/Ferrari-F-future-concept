// Real-time vehicle dynamics for the drive workspace.
//
// Planar two-track-in-one ("bicycle") model with longitudinal load transfer, a Pacejka-style
// tyre curve with a friction ellipse, aerodynamic drag and downforce (with an active wing state),
// a seven-speed sequential gearbox, rear-wheel drive with traction control, ABS and a yaw
// stability assist. Integrated at a fixed 240 Hz.
//
// IMPORTANT: every number in DEFAULTS is a SIMULATION PARAMETER chosen to give believable
// behaviour. None of them is an official or claimed F-Future specification. The geometric values
// (wheelbase, tracks, tyre radii) come from the design sheets via dims.js.
import { DIMS } from '../car/dims.js';

export const DEFAULTS = {
  mass: 1450,              // kg (simulation value)
  frontWeight: 0.42,       // static front axle share
  cgHeight: 0.40,          // m
  yawInertiaK: 1.05,       // Iz = k * m * a * b
  output: 1.0,             // engine output scale (1 = simulation baseline)
  peakTorque: 700,         // N m at the crank, baseline (simulation value)
  idle: 950, limiter: 9000, upshift: 8650, downshift: 4200,
  ratios: [3.15, 2.25, 1.75, 1.42, 1.19, 1.02, 0.87], final: 4.4, driveEff: 0.9,
  mu: 1.35,                // tyre peak friction (dry)
  tyreB: 9.5, tyreC: 1.85, // Pacejka shape
  brakeBias: 0.6, brakeGain: 0.95,
  cdA: 0.78, clA: 2.4, aeroBalance: 0.44, wingCl: 0.9, wingCd: 0.18,
  steerMax: 0.5,           // rad at the road wheel, low speed
  crr: 0.015,
  rearGrip: 1.1,           // wider rear tyres (325 vs 255 mm): more rear grip, stable at the limit
};

// normalised full-load torque curve (simulation shape for a naturally aspirated V12)
const TQ = [[0, 0.35], [1000, 0.55], [2000, 0.68], [3000, 0.79], [4000, 0.87], [5000, 0.93], [6000, 0.98], [7000, 1.0], [8000, 0.97], [8600, 0.93], [9200, 0.86]];
export function torqueShape(rpm) {
  if (rpm <= TQ[0][0]) return TQ[0][1];
  for (let i = 1; i < TQ.length; i++) if (rpm <= TQ[i][0]) { const [a, va] = TQ[i - 1], [b, vb] = TQ[i]; return va + ((rpm - a) / (b - a)) * (vb - va); }
  return TQ[TQ.length - 1][1];
}

const G = 9.81, RHO = 1.225;
const AIDS = { // manettino: [tc slip allowance, esc gain, mu scale]
  WET: { tc: 0.04, esc: 1.0, mu: 0.72 }, SPORT: { tc: 0.08, esc: 0.55, mu: 1 }, RACE: { tc: 0.16, esc: 0.2, mu: 1 }, 'CT OFF': { tc: Infinity, esc: 0, mu: 1 },
};

export class Vehicle {
  constructor(params = {}) {
    this.p = { ...DEFAULTS, ...params };
    this.L = DIMS.wheelbase;
    this.rF = DIMS.front.r; this.rR = DIMS.rear.r;
    this.reset(0, 0, 0);
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.mode = 'SPORT';
    this.auto = true;
    this.surface = { mu: 1, drag: 0, rumble: 0 };
    this.wing = false;
  }
  reset(x, z, psi) {
    this.x = x; this.z = z; this.psi = psi;
    this.u = 0; this.v = 0; this.r = 0;
    this.gear = 1; this.rpm = DEFAULTS.idle; this.shiftT = 0; this.clutch = 0;
    this.ax = 0; this.ay = 0; this.delta = 0;
    this.spinF = 0; this.spinR = 0; // wheel angles (rad)
    this.wheelSlip = 0; this.lockF = false; this.tcAct = 0; this.absAct = 0; this.escAct = 0;
    this.slipF = 0; this.slipR = 0;
    this.limiterHit = false; this.lift = 0;
  }
  get speed() { return Math.hypot(this.u, this.v); }
  get kmh() { return this.u * 3.6; }
  shift(d) {
    const g = Math.max(1, Math.min(this.p.ratios.length, this.gear + d));
    if (g !== this.gear) { this.gear = g; this.shiftT = 0.09; return true; }
    return false;
  }

  step(dt) {
    const sub = Math.max(1, Math.ceil(dt * 240)), h = dt / sub;
    for (let k = 0; k < sub; k++) this._step(h);
  }

  _step(dt) {
    const p = this.p, I = this.input, aid = AIDS[this.mode] || AIDS.SPORT;
    const m = p.mass, L = this.L, a = L * (1 - p.frontWeight), b = L * p.frontWeight; // a: CG to front axle
    const Iz = p.yawInertiaK * m * a * b;
    const mu = p.mu * aid.mu * this.surface.mu;
    const u = this.u, v = this.v, r = this.r;
    const V = Math.max(0.1, Math.abs(u));

    // ---- steering: speed-sensitive range, rate limited by the caller ----
    const steerRange = p.steerMax / (1 + (V / 26) ** 2 * 0.9);
    this.delta = I.steer * steerRange;

    // ---- aero ----
    const wingUp = this.wing;
    const q = 0.5 * RHO * u * Math.abs(u);
    const cl = p.clA + (wingUp ? p.wingCl : 0), cd = p.cdA + (wingUp ? p.wingCd : 0);
    const down = q * cl, drag = q * cd;
    const downF = down * p.aeroBalance, downR = down * (1 - p.aeroBalance);

    // ---- vertical loads with longitudinal transfer ----
    const dW = (m * this.ax * p.cgHeight) / L;
    let Fzf = Math.max(200, (m * G * b) / L - dW + downF);
    let Fzr = Math.max(200, (m * G * a) / L + dW + downR);

    // ---- gearbox and engine ----
    const ratio = p.ratios[this.gear - 1] * p.final;
    const wheelRpm = (u / this.rR) * (60 / (2 * Math.PI));
    let rpmWheel = wheelRpm * ratio;
    if (this.shiftT > 0) this.shiftT -= dt;
    // launch: slipping clutch holds the engine up at low speed
    const launchRpm = p.idle + I.throttle * 3600;
    const clutchSlip = this.gear === 1 && rpmWheel < launchRpm;
    let rpm = clutchSlip ? Math.max(rpmWheel, launchRpm * Math.min(1, 0.4 + I.throttle)) : Math.max(rpmWheel, p.idle * 0.9);
    // automatic shifting
    if (this.auto && this.shiftT <= 0) {
      if (rpm > p.upshift && this.gear < p.ratios.length) this.shift(1);
      else if (this.gear > 1) {
        const lower = p.ratios[this.gear - 2] * p.final * wheelRpm;
        if (lower < p.upshift - 900 && (rpm < p.downshift || (I.brake > 0.3 && lower < p.upshift - 1500))) this.shift(-1);
      }
    }
    this.limiterHit = rpm >= p.limiter;
    let torque = p.peakTorque * p.output * torqueShape(rpm) * I.throttle;
    if (this.limiterHit) torque = 0;
    if (this.shiftT > 0) torque *= 0.15;
    // engine braking on overrun
    const engineBrake = I.throttle < 0.05 ? -(28 + rpm * 0.012) * (rpm > p.idle * 1.1 ? 1 : 0) : 0;
    let Fdrive = ((torque + engineBrake) * ratio * p.driveEff) / this.rR;
    if (u < 0.5 && Fdrive < 0) Fdrive = 0;

    // ---- tyres ----
    const cosD = Math.cos(this.delta), sinD = Math.sin(this.delta);
    const alphaF = Math.atan2(v + r * a, V) - this.delta;  // see note below on sign
    const alphaR = Math.atan2(v - r * b, V);
    // Note: body frame here: +x forward, +z right (v > 0 = sliding right), yaw rate r > 0 turns
    // the nose to the right. Front contact lateral speed = v + r*a, rear = v - r*b.
    // tyre load sensitivity: grip grows less than proportionally with load (Fz^0.8), which
    // tempers the effect of load transfer on balance, as with real tyres
    const Fzf0 = (m * G * b) / L, Fzr0 = (m * G * a) / L;
    const eff = (Fz, Fz0) => Fz0 * Math.pow(Fz / Fz0, 0.8);
    const EFf = eff(Fzf, Fzf0), EFr = eff(Fzr, Fzr0);
    const tyre = (alpha, Fz) => -mu * Fz * Math.sin(p.tyreC * Math.atan(p.tyreB * alpha));

    // braking with ABS
    const brakeTotal = I.brake * p.brakeGain * mu * m * G * 1.05;
    let FbF = brakeTotal * p.brakeBias, FbR = brakeTotal * (1 - p.brakeBias) + I.handbrake * mu * Fzr;
    this.absAct = 0; this.lockF = false; this.escAct = 0;
    const sgn = Math.sign(u) || 0;
    const maxR = mu * EFr * p.rearGrip, maxF = mu * EFf;
    // pure lateral demand at each axle
    const FyR0 = tyre(alphaR, EFr) * p.rearGrip, FyF0 = tyre(alphaF, EFf);
    // cornering-aware ABS: braking may only use what the friction circle leaves after the
    // cornering force, so the car keeps steering and the light rear axle stays planted
    const absF = Math.max(0.35 * maxF, Math.sqrt(Math.max(0, maxF * maxF - FyF0 * FyF0))) * 0.97;
    const absR = Math.max(0.15 * maxR, Math.sqrt(Math.max(0, maxR * maxR - FyR0 * FyR0))) * 0.9;
    if (FbF > absF) { FbF = absF; this.absAct = 1; }
    if (FbR > absR + I.handbrake * maxR) { FbR = absR + I.handbrake * maxR * 0.5; this.absAct = I.handbrake ? this.absAct : 1; }
    // friction circle: what is left for longitudinal force at the rear
    const budgetR = Math.sqrt(Math.max(0, maxR * maxR - FyR0 * FyR0));
    let FxR = Fdrive - FbR * sgn;
    this.tcAct = 0; this.wheelSlip = 0;
    if (FxR > budgetR) {
      const allow = budgetR + maxR * (aid.tc === Infinity ? 10 : aid.tc);
      if (FxR > allow) { FxR = allow; this.tcAct = aid.tc === Infinity ? 0 : 1; }
      // anything beyond the circle spins the tyre: lower sliding friction and lost side grip
      const over = (FxR - budgetR) / (maxR + 1);
      this.wheelSlip = Math.min(1, over * 2);
      if (aid.tc === Infinity || over > 0.02) FxR = Math.min(FxR, maxR) * (1 - 0.15 * this.wheelSlip);
    }
    let FxF = -FbF * sgn;
    // stability assist also trims the throttle when the car is sliding
    const beta = Math.atan2(v, V);
    if (aid.esc > 0 && Math.abs(beta) > 0.12 && Fdrive > 0) { FxR *= Math.max(0.2, 1 - aid.esc * (Math.abs(beta) - 0.12) * 6); this.escAct = 1; }
    const latAvailR = Math.max(0.3, Math.sqrt(Math.max(0, 1 - Math.min(1, Math.abs(FxR) / (maxR + 1)) ** 2))) * (1 - 0.35 * this.wheelSlip);
    const latAvailF = this.lockF ? 0.1 : Math.sqrt(Math.max(0, 1 - Math.min(1, Math.abs(FxF) / (maxF + 1)) ** 2));
    let FyF = FyF0 * latAvailF;
    let FyR = Math.sign(FyR0) * Math.min(Math.abs(FyR0), maxR * latAvailR);
    // low-speed fade to avoid jitter at standstill
    const fade = Math.min(1, V / 2.5);
    FyF *= fade; FyR *= fade;
    this.slipF = Math.abs(alphaF); this.slipR = Math.abs(alphaR);

    // ---- stability assist: yaw moment from selective braking when the car slides ----
    // reference yaw rate from steering, capped at what the tyres can actually deliver
    const rMax = (0.9 * mu * G) / V;
    const rRef = Math.max(-rMax, Math.min(rMax, (V * this.delta) / (L + 0.0025 * V * V)));
    let Mesc = 0;
    if (aid.esc > 0 && V > 4) {
      // only ever counter over-rotation (oversteer); never add yaw
      const same = Math.sign(r) === Math.sign(rRef) || Math.abs(rRef) < 0.02;
      const excess = same ? Math.abs(r) - Math.abs(rRef) - 0.05 : Math.abs(r) - 0.05;
      if (excess > 0) { Mesc = -Math.sign(r) * aid.esc * excess * Iz * 5; this.escAct = 1; }
    }

    // ---- equations of motion (body frame) ----
    const Frr = p.crr * m * G * Math.sign(u) * Math.min(1, Math.abs(u));
    const Fx = FxR + FxF * cosD - FyF * sinD - drag * Math.sign(u) - Frr - this.surface.drag * m * G * Math.sign(u) * Math.min(1, Math.abs(u) / 3);
    const Fy = FyR + FyF * cosD + FxF * sinD;
    const Mz = a * (FyF * cosD + FxF * sinD) - b * FyR + Mesc;
    const du = Fx / m + r * v;
    const dv = Fy / m - r * u;
    const dr = Mz / Iz;
    this.u += du * dt; this.v += dv * dt; this.r += dr * dt;
    if (Math.abs(this.u) < 0.05 && I.throttle < 0.02) { this.u = 0; this.v *= 0.9; this.r *= 0.9; }
    if (this.u < 0 && I.throttle > 0) this.u = Math.max(this.u, -0.5);
    // accelerations for load transfer and the g-meter (filtered)
    const ax = Fx / m, ay = Fy / m;
    this.ax += (ax - this.ax) * Math.min(1, dt * 12);
    this.ay += (ay - this.ay) * Math.min(1, dt * 12);

    // ---- world integration: forward = (cos psi, -sin psi), right = (sin psi, cos psi) ----
    this.psi -= this.r * dt;
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    this.x += (this.u * c + this.v * s) * dt;
    this.z += (-this.u * s + this.v * c) * dt;

    // ---- engine speed for audio and HUD (smoothed) ----
    if (this.wheelSlip > 0) rpm = Math.min(p.limiter + 150, rpm + this.wheelSlip * 2500);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 18);
    this.lift = I.throttle < 0.1 ? Math.min(1, this.lift + dt * 4) : 0;
    this.spinF += (this.u / this.rF) * dt * (this.lockF ? 0 : 1);
    this.spinR += (this.u / this.rR) * dt * (1 + this.wheelSlip * 0.6);
  }
}
