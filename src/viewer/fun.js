// Interactive extras for the studio viewer:
//  - engine start / rev with a physically modelled V12 (AudioWorklet), live rev counter, exhaust flames
//  - rolling road (spinning wheels, scrolling floor), wind-tunnel streamlines, exploded view
//  - paint swatches, and a handful of easter eggs with a "secrets" counter
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makeFieldCache } from '../car/bodyShape.js';
import { EngineAudio, starterRPM, STARTER_TIME } from './audio/engine.js';

export const PAINTS = [
  { id: 'rosso', name: 'Rosso F-Future', color: 0x96101a, metalness: 0.42, roughness: 0.24 },
  { id: 'giallo', name: 'Giallo Modena', color: 0xf0b400, metalness: 0.22, roughness: 0.28 },
  { id: 'blu', name: 'Blu Tour de France', color: 0x0c2356, metalness: 0.5, roughness: 0.24 },
  { id: 'verde', name: 'Verde Abetone', color: 0x0f3f2b, metalness: 0.5, roughness: 0.25 },
  { id: 'argento', name: 'Argento Nürburgring', color: 0xa3a8ae, metalness: 0.75, roughness: 0.26 },
  { id: 'bianco', name: 'Bianco Avus', color: 0xe8e8e4, metalness: 0.08, roughness: 0.3 },
  { id: 'nero', name: 'Nero Daytona', color: 0x0b0b0d, metalness: 0.55, roughness: 0.22 },
];
const ORO = { id: 'oro', name: 'Oro Segreto', color: 0xc9a227, metalness: 1.0, roughness: 0.16 };

export const SECRETS = [
  { id: 'konami', hint: 'An old cheat code still works here.', found: 'Konami code: the secret gold paint, Oro Segreto.' },
  { id: 'motto', hint: 'Knock five times on the shield at the nose.', found: 'Five knocks on the nose badge: horn, flash and the motto.' },
  { id: 'duck', hint: 'Something yellow is hiding under the bonnet.', found: 'The frunk duck. Click it again for another quack.' },
  { id: 'v12', hint: 'Spell the engine out on your keyboard.', found: 'Typing V12 sends it to the red line.' },
  { id: 'manettino', hint: 'In the cockpit, the little red dial turns.', found: 'The manettino cycles WET, SPORT, RACE and CT OFF.' },
  { id: 'start', hint: 'The red button on the steering wheel does what you hope.', found: 'The steering-wheel button starts and stops the V12.' },
];
const MODES = [
  { name: 'WET', color: 0x2f8cff }, { name: 'SPORT', color: 0xf2c200 }, { name: 'RACE', color: 0xff2a2a }, { name: 'CT OFF', color: 0xff6a1f },
];
const MOTTO = '“Il mito è l’unico sogno che non invecchia mai”';
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

// ---------------------------------------------------------------------------
// Wind tunnel: streamlines integrated around the implicit body surface.
// ---------------------------------------------------------------------------
function buildStreamlines() {
  const F = makeFieldCache(0.004);
  const group = new THREE.Group(); group.name = 'WindTunnel_Streamlines';
  const material = new LineMaterial({ linewidth: 2.2, vertexColors: true, dashed: true, dashScale: 1, dashSize: 0.2, gapSize: 0.26, transparent: true, opacity: 0.9, depthWrite: false });
  const far = new THREE.Color(0x9fd4ff), near = new THREE.Color(0xff5a2a), c = new THREE.Color();
  const M = 0.17, e = 0.004;
  const ys = [0.16, 0.34, 0.52, 0.7, 0.88, 1.06, 1.22];
  const zs = [0.08, 0.26, 0.44, 0.62, 0.8, 0.98];
  for (const y0 of ys) for (const z0 of zs) for (const sg of [-1, 1]) {
    let x = 3.3, y = y0, z = sg * z0;
    const pos = [], col = [];
    for (let i = 0; i < 190 && x > -3.6; i++) {
      const inRange = x < 2.75 && x > -2.4 && Math.abs(z) < 1.3 && y < 1.5;
      let d = inRange ? F.field(x, y, z) : 1;
      let ux = -1, uy = 0, uz = 0;
      if (d < M) {
        let gx = F.field(x + e, y, z) - F.field(x - e, y, z), gy = F.field(x, y + e, z) - F.field(x, y - e, z), gz = F.field(x, y, z + e) - F.field(x, y, z - e);
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        const w = 1 - THREE.MathUtils.smoothstep(d, 0.03, M);
        const un = ux * gx + uy * gy + uz * gz;
        if (un < 0) { ux -= gx * un * w; uy -= gy * un * w; uz -= gz * un * w; }
        if (d < 0.035) { const k = (0.035 - d) / 0.035; ux += gx * 0.9 * k; uy += gy * 0.9 * k; uz += gz * 0.9 * k; }
      }
      // settle back towards the free stream behind the car
      if (x < -2.2) { uy += (y0 - y) * 0.25; uz += (sg * z0 - z) * 0.2; }
      const ul = Math.hypot(ux, uy, uz) || 1;
      pos.push(x, y, z);
      c.copy(far).lerp(near, THREE.MathUtils.clamp(1 - d / M, 0, 1)); col.push(c.r, c.g, c.b);
      x += (ux / ul) * 0.04; y = Math.max(0.035, y + (uy / ul) * 0.04); z += (uz / ul) * 0.04;
    }
    const geo = new LineGeometry(); geo.setPositions(pos); geo.setColors(col);
    const line = new Line2(geo, material); line.computeLineDistances(); line.frustumCulled = false; line.renderOrder = 5;
    group.add(line);
  }
  return { group, material };
}

// ---------------------------------------------------------------------------
export function createFun({ car, scene, studio, toast, onSecrets = () => {}, onState = () => {}, sound = new EngineAudio() }) {
  const F = car.fun, M = car.materials;
  const S = { crank: -1, engine: false, rev: false, rolling: false, wind: false, explode: false, rpm: 0, speed: 0, mode: 2, paint: 'rosso', burst: 0 };
  const paint0 = { color: M.paint.color.clone(), metalness: M.paint.metalness, roughness: M.paint.roughness };

  // ---- secrets ----
  let found = new Set();
  try { found = new Set(JSON.parse(localStorage.getItem('ffuture-secrets') || '[]')); } catch { /* storage unavailable */ }
  const reveal = (id) => {
    if (found.has(id)) return false;
    found.add(id);
    try { localStorage.setItem('ffuture-secrets', JSON.stringify([...found])); } catch { /* ignore */ }
    sound.chime();
    onSecrets(found);
    toast(`Secret found · ${found.size} / ${SECRETS.length}`, 2600);
    return true;
  };

  // ---- exhaust flames ----
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x9fc8ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const flames = F.exhaustTips.map((p) => {
    const g = new THREE.Group(); g.position.copy(p); g.rotation.z = Math.PI / 2; // cone axis (+y) -> -x (rearward)
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.34, 14, 1, true), flameMat); outer.position.y = 0.17;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.2, 10, 1, true), coreMat); core.position.y = 0.1;
    g.add(outer, core); g.visible = false; g.name = 'ExhaustFlame';
    car.root.add(g);
    return g;
  });

  // ---- exploded view ----
  const EXPLODE = { Body: [0, 0.62, 0], Door_L: [0, 0.62, -0.55], Door_R: [0, 0.62, 0.55], Bonnet: [0.45, 1.0, 0], EngineCover: [-0.42, 1.1, 0], Interior: [0, 0.27, 0], Powertrain: [0, 0, 0], Aero: [0, 0, 0], Chassis: [0, 0, 0] };
  const homes = {}; for (const k in F.groups) homes[k] = F.groups[k].position.clone();
  let explodeT = 0;
  const applyExplode = (t) => {
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    for (const k in F.groups) { const o = EXPLODE[k] || [0, 0, 0]; F.groups[k].position.set(homes[k].x + o[0] * e, homes[k].y + o[1] * e, homes[k].z + o[2] * e); }
    for (const w of F.wheels) w.group.position.set(w.home.x, w.home.y, w.home.z + w.side * 0.5 * e);
  };

  // ---- wind tunnel ----
  let wind = null;

  // ---- instrument cluster ----
  let clusterTimer = 0, clusterDirty = true;
  const redraw = () => {
    clusterDirty = false;
    const kmh = S.speed * 3.6;
    F.redrawCluster?.({ rpm: S.rpm, mode: MODES[S.mode].name, gear: kmh < 2 ? 'N' : kmh < 30 ? '2' : '3', speed: kmh, on: S.engine });
  };
  const applyMode = () => {
    const m = MODES[S.mode];
    M.ambient.color.setHex(m.color); M.ambient.emissive.setHex(m.color);
    if (F.ambientLight) F.ambientLight.color.setHex(m.color);
    clusterDirty = true;
  };

  // ---- light flashes ----
  let flash = 0;
  const head0 = F.headlightMat.emissiveIntensity || 3;

  // ---- badge knocks / duck hop ----
  let knocks = 0, knockTimer = 0, duckHop = 0;
  const duck = F.eggs.find((o) => o.userData.egg === 'duck');
  const duckY = duck ? duck.position.y : 0;

  // ---- key sequences ----
  let konamiAt = 0, typed = '';

  const api = {
    state: S, sound,
    secrets: () => found,
    get(name) { return !!S[name]; },
    set(name, on, instant = false) {
      on = !!on;
      switch (name) {
        case 'engine':
          if (S.engine === on) break;
          S.engine = on;
          if (on) { sound.startEngine(); S.crank = 0; S.burst = 0; toast('Engine started · hold Rev or Space'); }
          else { sound.stopEngine(); S.rev = false; S.crank = -1; toast('Engine off'); }
          clusterDirty = true;
          break;
        case 'rev': S.rev = on && S.engine; break;
        case 'rolling':
          S.rolling = on;
          if (on && S.explode) api.set('explode', false);
          toast(on ? 'Rolling road on' : 'Rolling road off');
          break;
        case 'wind':
          S.wind = on;
          if (on && !wind) { wind = buildStreamlines(); scene.add(wind.group); }
          if (wind) wind.group.visible = on;
          toast(on ? 'Wind tunnel on' : 'Wind tunnel off');
          break;
        case 'explode':
          S.explode = on;
          if (on) { S.rolling = false; }
          if (instant) { explodeT = on ? 1 : 0; applyExplode(explodeT); }
          toast(on ? 'Exploded view' : 'Assembled');
          break;
      }
      onState(S);
    },
    toggle(name) { api.set(name, !S[name]); },
    setPaint(id, quiet = false) {
      const p = [...PAINTS, ORO].find((q) => q.id === id); if (!p) return;
      S.paint = id;
      M.paint.color.setHex(p.color); M.paint.metalness = p.metalness; M.paint.roughness = p.roughness;
      if (!quiet) toast(p.name);
      onState(S);
    },
    paintName() { return [...PAINTS, ORO].find((q) => q.id === S.paint)?.name ?? ''; },
    resetPaint() { M.paint.color.copy(paint0.color); M.paint.metalness = paint0.metalness; M.paint.roughness = paint0.roughness; S.paint = 'rosso'; onState(S); },

    /** Redline burst (easter egg / button). */
    redline() {
      if (!S.engine) api.set('engine', true);
      S.burst = 2.6;
    },

    /** Keyboard hook. Returns true when the key was consumed by a secret sequence. */
    onKey(key) {
      let consumed = false;
      // Konami code
      if (key === KONAMI[konamiAt]) {
        konamiAt++;
        if (konamiAt > 8) consumed = true; // swallow the final B and A
        if (konamiAt === KONAMI.length) {
          konamiAt = 0;
          const fresh = reveal('konami');
          if (S.paint === 'oro') { api.resetPaint(); toast('Rosso F-Future'); } else { api.setPaint('oro', true); if (!fresh) toast('Oro Segreto'); }
        }
      } else konamiAt = key === KONAMI[0] ? 1 : 0;
      // typing V 1 2
      if (key.length === 1) {
        typed = (typed + key).slice(-3);
        if (typed === 'v12') { typed = ''; reveal('v12'); api.redline(); return true; }
        if (typed.endsWith('v1') || (typed.endsWith('v') && key === 'v')) consumed = consumed || key === '1';
      }
      return consumed;
    },

    /** Called on a click with the object that was hit (already checked for occlusion). */
    onEgg(obj) {
      let o = obj; while (o && !o.userData.egg) o = o.parent;
      if (!o) return false;
      switch (o.userData.egg) {
        case 'motto':
          knocks++; knockTimer = 2.5; sound.tone([180 + knocks * 25], { type: 'sine', dur: 0.08, gain: 0.1 });
          if (knocks >= 5) {
            knocks = 0; sound.horn(); flash = 1.6;
            const fresh = reveal('motto');
            setTimeout(() => toast(MOTTO, 4200), fresh ? 2700 : 0);
          }
          return true;
        case 'duck':
          sound.quack(); duckHop = 1; reveal('duck');
          return true;
        case 'manettino':
          S.mode = (S.mode + 1) % MODES.length; applyMode(); sound.tone([1200], { type: 'sine', dur: 0.05, gain: 0.08 });
          if (!reveal('manettino')) toast('Manettino · ' + MODES[S.mode].name);
          return true;
        case 'start':
          api.toggle('engine'); reveal('start');
          return true;
      }
      return false;
    },

    update(dt) {
      // --- engine speed ---
      if (S.engine && S.crank >= 0 && S.crank < 1.6) {
        // key turned: starter cranks, the V12 catches, flares and settles to idle
        S.crank += dt;
        S.rpm = starterRPM(S.crank);
        sound.setRPM(S.rpm, S.crank < STARTER_TIME ? 0 : 0.35);
        car.root.position.y = (Math.random() - 0.5) * (S.crank < STARTER_TIME ? 0.0025 : 0.0012);
        car.root.rotation.x = S.crank > STARTER_TIME && S.crank < STARTER_TIME + 0.3 ? 0.004 : 0;
        if (S.crank >= 1.6) S.crank = -1;
        clusterDirty = true;
      } else if (S.engine) {
        if (S.burst > 0) S.burst -= dt;
        const revving = S.rev || S.burst > 0.9;
        const target = revving ? 9100 : S.rolling ? 3400 : 950;
        // free-revving engine: fast to rise under full throttle, slower to fall (inertia, pumping losses)
        const k = target > S.rpm ? 2.6 : 1.5;
        const prev = S.rpm;
        S.rpm += (target - S.rpm) * Math.min(1, k * dt);
        S.rpm += (Math.random() - 0.5) * (S.rpm < 1500 ? 14 : 30);
        sound.setRPM(S.rpm, revving ? 1 : S.rolling ? 0.25 : 0.06);
        // flames: at the top of the range, and on a lift-off (the worklet makes the pops itself)
        const hot = S.rpm > 7800 || (prev - S.rpm > 40 && S.rpm > 4200 && Math.random() < 0.3);
        const a = hot ? 0.55 + Math.random() * 0.4 : 0;
        flameMat.opacity += (a - flameMat.opacity) * Math.min(1, 14 * dt); coreMat.opacity = flameMat.opacity * 0.9;
        for (const f of flames) { f.visible = flameMat.opacity > 0.03; f.scale.set(0.8 + Math.random() * 0.5, 0.6 + Math.random() * 0.9, 0.8 + Math.random() * 0.5); }
        // idle shake and torque rock
        car.root.position.y = (Math.random() - 0.5) * (S.rpm < 1500 ? 0.0012 : 0.0006);
        car.root.rotation.x = THREE.MathUtils.clamp((S.rpm - prev) * 0.00002, -0.004, 0.006);
      } else if (S.rpm > 0 || flameMat.opacity > 0) {
        S.rpm = Math.max(0, S.rpm - 2600 * dt);
        sound.setRPM(S.rpm, 0);
        flameMat.opacity = 0; coreMat.opacity = 0; for (const f of flames) f.visible = false;
        car.root.position.y = 0; car.root.rotation.x = 0;
        clusterDirty = true;
      }
      // --- rolling road ---
      const vTarget = S.rolling ? 12 : 0;
      S.speed += (vTarget - S.speed) * Math.min(1, 1.6 * dt);
      if (S.speed > 0.01) {
        for (const w of F.wheels) w.spin.rotation.z -= (S.speed / w.radius) * dt;
        const off = studio.gridOffset; if (off) off.x = (off.x + S.speed * dt) % 1;
        clusterDirty = true;
      } else S.speed = 0;
      // --- exploded view ---
      const et = S.explode ? 1 : 0;
      if (explodeT !== et) { explodeT = et > explodeT ? Math.min(1, explodeT + dt * 0.8) : Math.max(0, explodeT - dt * 0.9); applyExplode(explodeT); }
      // --- wind tunnel ---
      if (wind && S.wind) wind.material.dashOffset -= dt * 2.4;
      // --- flashes, knocks, duck ---
      if (flash > 0) {
        flash -= dt;
        const on = flash > 0 && Math.floor(flash * 5) % 2 === 0;
        F.headlightMat.emissiveIntensity = flash > 0 ? (on ? head0 * 2.2 : 0.2) : (car.lightsOn ? head0 : 0);
      }
      if (knockTimer > 0) { knockTimer -= dt; if (knockTimer <= 0) knocks = 0; }
      if (duck && duckHop > 0) { duckHop = Math.max(0, duckHop - dt * 1.8); duck.position.y = duckY + Math.sin((1 - duckHop) * Math.PI) * 0.09; duck.rotation.y = 0.5 + (1 - duckHop) * Math.PI * 2; }
      // --- cluster ---
      clusterTimer -= dt;
      if ((S.engine || clusterDirty) && clusterTimer <= 0) { clusterTimer = 0.06; redraw(); }
    },
  };
  applyMode();
  return api;
}
