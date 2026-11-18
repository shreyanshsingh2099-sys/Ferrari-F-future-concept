// Physically motivated V12 engine sound (AudioWorklet).
//
// Model, per sample:
//  - crank angle over the 720° four-stroke cycle; a 65° V12 fires each bank every 120°, the
//    second bank 65° after the first, so firing intervals alternate 65° / 55° (uneven, as on
//    real 65° V12s). Each event excites its bank's exhaust with a blow-down pulse
//    (critically damped "t·e^-t" pressure pulse + a short noise burst).
//  - each bank's exhaust is a chain of damped waveguides: primary header, collector pipe and
//    silencer chamber (delay lines with reflection + loss). Small length differences between
//    banks give the beat that makes V12s sound smooth but complex.
//  - intake roar (band-passed noise modulated by the firing pulses), cam-drive whine,
//    valvetrain ticks, starter motor, overrun pops/bangs on lift-off.
//  - listener perspective: exterior (exhaust-dominant, bright) or cabin (low-passed exhaust,
//    more intake and boom).
// Parameters are k-rate and smoothed internally to avoid zipper noise.

const FIRING = (() => {
  // [crank angle (deg), bank, cylinder index]
  const f = [];
  for (let j = 0; j < 6; j++) { f.push([120 * j, 0, j]); f.push([120 * j + 65, 1, 6 + j]); }
  return f.sort((a, b) => a[0] - b[0]);
})();
const CYL_VAR = [1.0, 0.93, 1.05, 0.97, 1.08, 0.95, 1.02, 0.96, 1.06, 0.92, 1.0, 1.04];

class Waveguide {
  constructor(len, g, damp, drive = 0) { this.buf = new Float32Array(Math.max(2, len | 0)); this.i = 0; this.g = g; this.damp = damp; this.lp = 0; this.drive = drive; }
  process(x) {
    const d = this.buf[this.i];
    this.lp += (d - this.lp) * this.damp;
    let y = x + this.g * this.lp;
    if (this.drive) y = Math.tanh(y * this.drive) / this.drive; // mild non-linearity in the pipe
    this.buf[this.i] = y;
    if (++this.i >= this.buf.length) this.i = 0;
    return y;
  }
}

class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  bandpass(f, q, sr) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
    this.b0 = a / a0; this.b1 = 0; this.b2 = -a / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  }
  lowpass(f, q, sr) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = (1 - c) / 2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

class Bank {
  constructor(sr, k) {
    const ms = (m) => Math.round((m / 1000) * sr * k);
    this.header = new Waveguide(ms(0.92), -0.42, 0.55);
    this.pipe = new Waveguide(ms(3.7), 0.5, 0.42, 1.4);
    this.box = new Waveguide(ms(10.6), 0.32, 0.22);
    this.y1 = 0; this.y2 = 0; this.noiseEnv = 0; this.nlp = 0; this.nlp2 = 0; this.imp = 0; this.dc = 0; this.dcx = 0;
  }
}

class V12Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ignition', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'starter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cabin', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'volume', defaultValue: 0.8, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'limiter', defaultValue: 9000, minValue: 1000, maxValue: 12000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.banks = [new Bank(sr, 1.0), new Bank(sr, 1.065)];
    this.phase = 0; // crank angle in degrees, 0..720
    this.next = 0; // index into FIRING
    this.rpm = 0; this.rpmA = 0; this.thr = 0; this.ign = 0; this.st = 0; this.cab = 0; this.vol = 0.8;
    this.seed = 22222;
    this.intake = new Biquad(); this.intakeEnv = 0;
    this.lpL = 0; this.lpR = 0; this.lp2L = 0; this.lp2R = 0;
    this.whine = 0; this.starterPh = 0; this.stN = 0;
    this.overrun = 0; this.prevThr = 0;
    this.pulseK = 0.05; this.cut = 0; this.lim = 9000;
    this.noiseK = Math.exp(-1 / (0.0011 * sr));
    this.rpmK = 1 - Math.exp(-1 / (0.02 * sr));
    this.noiseLP = 1 - Math.exp((-2 * Math.PI * 2500) / sr);
    this.popK = Math.exp(-1 / (0.012 * sr));
    this.popEnv = 0; this.popLP = 0;
    this.boom = new Biquad(); this.boom.lowpass(140, 0.9, sr);
    this.port.onmessage = (e) => { if (e.data === 'pop') this.popEnv = Math.max(this.popEnv, 1.6); };
  }

  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296 * 2 - 1; }

  fire(bank, cyl, comb) {
    const b = this.banks[bank];
    // rev limiter: ignition cut on two events in three, the classic stutter
    if (comb && this.rpm > this.lim) comb = (this.cut++ % 3) === 0;
    const load = this.thr;
    const compression = 0.12 + 0.03 * Math.min(1, this.rpm / 3000);
    let a = compression;
    if (comb) a += (0.45 + 0.55 * load) * CYL_VAR[cyl] * (1 + 0.06 * this.rand());
    b.imp += a;
    b.noiseEnv = Math.max(b.noiseEnv, a * (0.1 + 0.16 * load));
    this.intakeEnv = Math.max(this.intakeEnv, a);
    // overrun: unburnt mixture lights off in the hot exhaust
    if (comb && this.overrun > 0 && Math.random() < 0.07 * this.overrun) this.popEnv = Math.max(this.popEnv, 0.8 + Math.random() * 1.4);
  }

  process(inputs, outputs, p) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length, sr = this.sr;
    const tRpm = p.rpm[0], tThr = p.throttle[0], tIgn = p.ignition[0], tSt = p.starter[0], tCab = p.cabin[0], tVol = p.volume[0];
    this.lim = p.limiter[0];
    // blow-down pulse width is a roughly constant crank angle (~30 deg), so it shortens with rpm;
    // a wide-open throttle gives a sharper, harder pulse
    const tau = Math.min(0.006, Math.max(0.0005, (30 * (1 - 0.3 * this.thr)) / Math.max(60, this.rpm * 6)));
    this.pulseK = 1 - Math.exp(-1 / (tau * sr));
    // overrun detection (lift-off at speed)
    if (this.prevThr > 0.5 && tThr < 0.08 && this.rpm > 3800) this.overrun = 1;
    this.prevThr = tThr;
    this.overrun *= 0.985;
    // intake band follows rpm
    this.intake.bandpass(220 + this.rpm * 0.075, 0.9, sr);
    const cutoff = 1500 + (1 - this.cab) * 3800 + this.thr * (1600 + 2600 * (1 - this.cab));
    const lpk = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
    for (let i = 0; i < n; i++) {
      // smooth parameters
      // crank inertia: two-stage smoothing (~20 ms each) so control-rate steps (60 fps updates)
      // never frequency-modulate the firing pulses
      this.rpmA += (tRpm - this.rpmA) * this.rpmK;
      this.rpm += (this.rpmA - this.rpm) * this.rpmK;
      this.thr += (tThr - this.thr) * 0.004;
      this.ign += (tIgn - this.ign) * 0.02;
      this.st += (tSt - this.st) * 0.004;
      this.cab += (tCab - this.cab) * 0.001;
      this.vol += (tVol - this.vol) * 0.001;
      // crank
      const dphi = (this.rpm * 6) / sr; // degrees per sample
      const prev = this.phase;
      this.phase += dphi;
      let wrapped = false;
      if (this.phase >= 720) { this.phase -= 720; wrapped = true; }
      // fire every event whose angle we passed
      for (let guard = 0; guard < 2; guard++) {
        const ang = FIRING[this.next][0];
        const passed = wrapped ? (ang > prev || ang <= this.phase) : (ang > prev && ang <= this.phase);
        if (!passed || dphi <= 0) break;
        const [, bank, cyl] = FIRING[this.next];
        this.fire(bank, cyl, this.ign > 0.5 && this.rpm > 150);
        this.next = (this.next + 1) % FIRING.length;
        if (this.next === 0) wrapped = false;
      }
      // exhaust banks
      let sL = 0, sR = 0;
      for (let b = 0; b < 2; b++) {
        const B = this.banks[b];
        // impulse scaled by 1/k so the pulse peak (~a/e) does not depend on its width
        const x = B.imp / this.pulseK; B.imp = 0;
        B.y1 += (x - B.y1) * this.pulseK;
        B.y2 += (B.y1 - B.y2) * this.pulseK;
        B.noiseEnv *= this.noiseK;
        // turbulent blow-down noise, low-passed (~2.5 kHz): gas flow, not hiss
        B.nlp += (this.rand() * B.noiseEnv - B.nlp) * this.noiseLP;
        B.nlp2 += (B.nlp - B.nlp2) * this.noiseLP;
        let e = B.y2 + B.nlp2 * 2.8;
        // DC block
        const hp = e - B.dcx + 0.995 * B.dc; B.dcx = e; B.dc = hp; e = hp;
        const h = B.header.process(e);
        const pp = B.pipe.process(h * 0.8);
        const bx = B.box.process(pp * 0.7);
        const y = 0.55 * pp + 0.45 * bx + 0.12 * h;
        if (b === 0) { sL += y * 0.78; sR += y * 0.42; } else { sL += y * 0.42; sR += y * 0.78; }
      }
      // overrun pops / bangs
      if (this.popEnv > 0.001) {
        this.popEnv *= this.popK;
        this.popLP += (this.rand() * this.popEnv - this.popLP) * 0.25;
        sL += this.popLP * 0.9; sR += this.popLP * 0.9;
      }
      // intake roar (more in the cabin) + cam-drive whine
      this.intakeEnv *= 0.9985;
      const intake = this.intake.process(this.rand()) * this.intakeEnv * (0.15 + 0.85 * this.thr) * Math.min(1, this.rpm / 6000);
      this.whine += (2 * Math.PI * (this.rpm / 60) * 23) / sr;
      if (this.whine > 1e4) this.whine -= 2 * Math.PI * 1000;
      const whine = Math.sin(this.whine) * 0.006 * Math.min(1, this.rpm / 7000) * (0.4 + this.cab);
      // starter motor: buzzy gear-driven whirr
      let starter = 0;
      if (this.st > 0.01) {
        // pinion/ring-gear mesh whine; its pitch follows the cranking speed, which sags on
        // every compression stroke, giving the characteristic rhythmic whirr
        const fm = 380 + 1.4 * (this.rpm - 230);
        this.starterPh += (2 * Math.PI * Math.max(120, fm)) / sr;
        if (this.starterPh > 1e4) this.starterPh -= 2 * Math.PI * 1000;
        this.stN += (this.rand() - this.stN) * 0.08;
        starter = this.st * (0.018 * Math.sin(this.starterPh) + 0.008 * Math.sin(this.starterPh * 2.03) + 0.05 * this.stN);
      }
      const icab = 0.35 + 0.65 * this.cab;
      let l = sL + intake * 0.55 * icab + whine + starter;
      let r = sR + intake * 0.55 * icab + whine + starter;
      // cabin boom (structure-borne low end)
      const boom = this.boom.process((sL + sR) * 0.5) * this.cab * 0.9;
      l += boom; r += boom;
      // tone and output stage
      this.lpL += (l - this.lpL) * lpk; this.lpR += (r - this.lpR) * lpk;
      this.lp2L += (this.lpL - this.lp2L) * lpk; this.lp2R += (this.lpR - this.lp2R) * lpk;
      const g = 1.2 * this.vol;
      L[i] = Math.tanh(this.lp2L * g * 1.3) * 0.82;
      R[i] = Math.tanh(this.lp2R * g * 1.3) * 0.82;
    }
    return true;
  }
}

registerProcessor('v12-engine', V12Processor);
