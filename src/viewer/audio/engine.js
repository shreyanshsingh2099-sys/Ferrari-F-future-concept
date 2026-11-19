// Audio for the studio and the drive game.
//
// The V12 itself runs in an AudioWorklet (engine-worklet.js): a crank-angle model of a 65° V12
// exciting per-bank exhaust waveguides. This module owns the AudioContext, the mixing (engine,
// tyres, wind, UI tones), a small procedural room reverb, the starter sequence, volume and mute,
// and a fallback to a simple oscillator engine when AudioWorklet is unavailable (insecure
// origins, very old browsers).

const WORKLET_URL = new URL('./engine-worklet.js', import.meta.url);
const STORE = 'ffuture-audio';

/** Scripted rpm for the start sequence, t seconds after the key is turned. */
export function starterRPM(t, idle = 950) {
  if (t < 0) return 0;
  if (t < 0.62) return 180 + 70 * Math.min(1, t / 0.15) + 25 * Math.sin(t * 2 * Math.PI * 9); // cranking
  const u = t - 0.62;
  if (u < 0.22) return 250 + (2350 - 250) * (1 - Math.pow(1 - u / 0.22, 2)); // catch + flare
  return idle + (2350 - idle) * Math.exp(-(u - 0.22) / 0.42); // settle to idle
}
export const STARTER_TIME = 0.62;

function roomImpulse(ctx, seconds = 1.1, decay = 3.2, early = true) {
  const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 * 2 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += (rnd() - lp) * (0.55 - 0.4 * Math.min(1, t / seconds)); // darker as it decays
      d[i] = lp * Math.pow(1 - t / seconds, decay) * 0.6;
    }
    if (early) for (const [ms, g] of [[7, 0.5], [13, -0.38], [19, 0.3], [29, 0.22], [41, -0.16]]) {
      const k = Math.floor((ms + ch * 1.3) * sr / 1000); if (k < n) d[k] += g;
    }
  }
  return buf;
}

function noiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(seconds * ctx.sampleRate), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------------------------------------------------------------------------
// Fallback engine (oscillators), used only when AudioWorklet cannot run.
// ---------------------------------------------------------------------------
class OscEngine {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(out);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 0.7;
    const shaper = ctx.createWaveShaper(); const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i / 511) * 2 - 1; curve[i] = Math.tanh(1.8 * x); }
    shaper.curve = curve;
    this.oscs = [['sawtooth', 1, 0.45, -4], ['triangle', 0.5, 0.5, 3], ['sawtooth', 2, 0.12, 7]].map(([type, mult, gain, detune]) => {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
      const g = ctx.createGain(); g.gain.value = gain; o.connect(g); g.connect(shaper); o.start();
      return { o, mult };
    });
    shaper.connect(this.filter); this.filter.connect(this.out);
  }
  set(rpm, load, on, t) {
    const f = Math.max(1, (rpm / 60) * 6);
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(f * mult, t, 0.03);
    this.filter.frequency.setTargetAtTime(380 + rpm * 0.45 + load * 600, t, 0.05);
    this.out.gain.setTargetAtTime(on ? 0.08 + 0.1 * Math.min(1, rpm / 8500) + 0.04 * load : 0, t, 0.06);
  }
}

export class EngineAudio {
  constructor({ context = null } = {}) {
    this.ctx = context; this.node = null; this.osc = null; this.loading = null;
    this.running = false; this.startAt = -1; this.cabin = 0;
    this.volume = 0.8; this.muted = false;
    try { const s = JSON.parse(localStorage.getItem(STORE) || '{}'); if (typeof s.volume === 'number') this.volume = s.volume; this.muted = !!s.muted; } catch { /* storage unavailable */ }
    if (context) this._graph();
  }

  get available() { return !!(window.AudioContext || window.webkitAudioContext || this.ctx); }

  /** Creates or resumes the context. Call from a user gesture. Returns a promise for the worklet. */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve(null);
      this.ctx = new AC({ latencyHint: 'interactive' });
      this._graph();
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
    return this.loading;
  }

  _graph() {
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    // transparent soft limiter (a DynamicsCompressor rides its gain at control rate, which
    // intermodulates with the firing pulses and adds audible mirror tones)
    const lim = ctx.createWaveShaper(), curve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1, ax = Math.abs(x); curve[i] = ax < 0.6 ? x : Math.sign(x) * (0.6 + 0.4 * Math.tanh((ax - 0.6) / 0.4)); }
    lim.curve = curve; lim.oversample = '4x';
    this.master.connect(lim); lim.connect(ctx.destination);
    // room: a short, dark procedural reverb (showroom); drier in the cabin and on the track
    this.room = ctx.createConvolver(); this.room.buffer = roomImpulse(ctx);
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 0.22;
    this.roomSend.connect(this.room); this.room.connect(this.master);
    this.bus = ctx.createGain(); this.bus.connect(this.master); this.bus.connect(this.roomSend);
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 1.6; this.engineGain.connect(this.bus);
    this.loading = (ctx.audioWorklet ? ctx.audioWorklet.addModule(WORKLET_URL.href) : Promise.reject(new Error('no AudioWorklet')))
      .then(() => {
        this.node = new AudioWorkletNode(ctx, 'v12-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        this.node.connect(this.engineGain);
        this.p = (n) => this.node.parameters.get(n);
        this.p('volume').value = 1;
        this.p('cabin').value = this.cabin;
        if (this.running) { this.p('ignition').value = 1; }
        return this.node;
      })
      .catch((err) => {
        console.warn('[audio] AudioWorklet unavailable, using the simple engine:', err?.message || err);
        this.osc = new OscEngine(ctx, this.engineGain);
        return null;
      });
  }

  _t(at) { return at ?? this.ctx.currentTime; }

  /** Turns the key: starter motor, then ignition after STARTER_TIME. The caller drives rpm with starterRPM(). */
  startEngine(at) {
    this.ensure();
    if (!this.ctx) return;
    const t = this._t(at);
    this.running = true; this.startAt = t;
    const go = () => {
      if (this.node) {
        this.p('starter').setValueAtTime(1, t); this.p('starter').setValueAtTime(0, t + STARTER_TIME + 0.05);
        this.p('ignition').setValueAtTime(0, t); this.p('ignition').setValueAtTime(1, t + STARTER_TIME);
      }
    };
    if (this.node) go(); else this.loading?.then(go);
  }

  stopEngine(at) {
    if (!this.ctx) return;
    const t = this._t(at);
    this.running = false;
    if (this.node) { this.p('ignition').setValueAtTime(0, t); this.p('throttle').setTargetAtTime(0, t, 0.05); this.p('starter').setValueAtTime(0, t); }
    if (this.osc) this.osc.set(0, 0, false, t);
  }

  /** rpm and throttle (0..1); call every frame. */
  setRPM(rpm, throttle = 0, at) {
    if (!this.ctx) return;
    const t = this._t(at);
    if (this.node) {
      this.p('rpm').setTargetAtTime(Math.max(0, rpm), t, 0.012);
      this.p('throttle').setTargetAtTime(throttle, t, 0.025);
    } else if (this.osc) this.osc.set(rpm, throttle, this.running, t);
  }

  setLimiter(rpm) { if (this.node) this.p('limiter').value = rpm; }

  /** 0 = outside the car, 1 = in the cockpit. */
  setPerspective(cabin, at) {
    this.cabin = cabin ? 1 : 0;
    if (!this.ctx) return;
    const t = this._t(at);
    if (this.node) this.p('cabin').setTargetAtTime(this.cabin, t, 0.15);
    this.roomSend?.gain.setTargetAtTime(this.cabin ? 0.06 : this.outdoor ? 0.05 : 0.22, t, 0.2);
  }

  /** Outdoor (drive) acoustics: almost no room. */
  setOutdoor(on) { this.outdoor = !!on; this.setPerspective(this.cabin); }

  pop() { this.node?.port.postMessage('pop'); }

  setVolume(v) { this.volume = Math.max(0, Math.min(1.5, v)); this._apply(); }
  setMuted(m) { this.muted = !!m; this._apply(); }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }
  _apply() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch { /* ignore */ }
  }

  // ---- drive sounds: tyres, road and wind --------------------------------------------------
  _drive() {
    if (this.dr || !this.ctx) return this.dr;
    const ctx = this.ctx, nb = noiseBuffer(ctx, 3);
    const src = (rate = 1) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = rate; s.start(); return s; };
    // tyre squeal: narrow resonances in the 0.8 to 1.6 kHz range plus a scrub component
    const sq = src(1), sqA = ctx.createBiquadFilter(), sqB = ctx.createBiquadFilter(), sqG = ctx.createGain();
    sqA.type = 'bandpass'; sqA.Q.value = 18; sqA.frequency.value = 1050;
    sqB.type = 'bandpass'; sqB.Q.value = 12; sqB.frequency.value = 1480;
    sq.connect(sqA); sq.connect(sqB); sqA.connect(sqG); sqB.connect(sqG); sqG.gain.value = 0; sqG.connect(this.bus);
    // road roar: low-passed noise rising with speed
    const rd = src(0.7), rdF = ctx.createBiquadFilter(), rdG = ctx.createGain();
    rdF.type = 'lowpass'; rdF.frequency.value = 260; rdF.Q.value = 0.6; rd.connect(rdF); rdF.connect(rdG); rdG.gain.value = 0; rdG.connect(this.bus);
    // wind: band-passed noise, rises with the square of speed
    const wd = src(1.3), wdF = ctx.createBiquadFilter(), wdG = ctx.createGain();
    wdF.type = 'bandpass'; wdF.frequency.value = 700; wdF.Q.value = 0.5; wd.connect(wdF); wdF.connect(wdG); wdG.gain.value = 0; wdG.connect(this.bus);
    this.dr = { sqA, sqB, sqG, rdG, rdF, wdG, wdF };
    return this.dr;
  }

  /** slip: 0..1 (combined tyre slip beyond the peak), speed in m/s. */
  setDrive(speed, slip, at) {
    const d = this._drive(); if (!d) return;
    const t = this._t(at), v = Math.max(0, speed);
    const s = Math.max(0, Math.min(1, slip)) * Math.min(1, v / 4);
    d.sqG.gain.setTargetAtTime(0.16 * s * s, t, 0.05);
    d.sqA.frequency.setTargetAtTime(950 + 280 * s + v * 2, t, 0.08);
    d.sqB.frequency.setTargetAtTime(1380 + 300 * s, t, 0.08);
    const cabin = this.cabin ? 1.4 : 1;
    d.rdG.gain.setTargetAtTime(Math.min(0.5, v * 0.006) * cabin, t, 0.1);
    d.rdF.frequency.setTargetAtTime(180 + v * 3, t, 0.2);
    d.wdG.gain.setTargetAtTime(Math.min(0.35, v * v * 0.00004), t, 0.1);
    d.wdF.frequency.setTargetAtTime(420 + v * 9, t, 0.2);
  }
  stopDrive() { if (this.dr) { const t = this.ctx.currentTime; for (const g of [this.dr.sqG, this.dr.rdG, this.dr.wdG]) g.gain.setTargetAtTime(0, t, 0.1); } }

  // ---- UI tones ---------------------------------------------------------------------------
  tone(freqs, { type = 'sine', dur = 0.5, gain = 0.1, slideTo = null } = {}) {
    this.ensure(); const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.012); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.14);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    lp.connect(g); g.connect(this.bus);
    for (const f of freqs) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(f * slideTo, t + dur);
      o.connect(lp); o.start(t); o.stop(t + dur + 0.4);
    }
  }
  /** Twin-trumpet horn: two detuned, slightly overdriven tones. */
  horn() { this.tone([415, 523.3], { type: 'sawtooth', dur: 0.55, gain: 0.06 }); }
  quack() { this.tone([620], { type: 'sawtooth', dur: 0.16, gain: 0.1, slideTo: 0.55 }); }
  chime() { this.tone([880, 1318.5], { type: 'sine', dur: 0.6, gain: 0.07 }); }
  click() { this.tone([2200], { type: 'sine', dur: 0.03, gain: 0.04 }); }
}
