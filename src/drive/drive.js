// Drive workspace: the F-Future on an original test circuit.
// World (sky, sun, HDRI reflections, track), vehicle simulation, chase / bonnet / cockpit / TV
// cameras, keyboard + gamepad + touch input, HUD (speed, gear, rev bar, lap timing with live
// delta, minimap, g-meter), telemetry traces with CSV export, and three challenges.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTrack, ROAD_HALF } from './track.js';
import { Vehicle, DEFAULTS } from './vehicle.js';
import { loadHDRI, buildEnvironment } from '../viewer/studio.js';
import { starterRPM, STARTER_TIME } from '../viewer/audio/engine.js';

const MODES = ['WET', 'SPORT', 'RACE', 'CT OFF'];
const WALL = 26;
const fmt = (t) => { if (!isFinite(t) || t <= 0) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; };
const store = { get(k, d) { try { const v = localStorage.getItem('ffuture-drive-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ffuture-drive-' + k, JSON.stringify(v)); } catch { /* ignore */ } } };

export function createDrive({ renderer, scene, camera, controls, car, studio, sound, toast, onExitRequest }) {
  const $ = (id) => document.getElementById(id);
  let world = null, active = false, running = false, paused = true;
  const veh = new Vehicle(store.get('setup', {}));
  veh.mode = store.get('mode', 'SPORT');
  veh.auto = store.get('auto', true);
  let camMode = 'chase', challenge = 'free';
  const saved = {};

  // ------------------------------------------------------------------ world
  async function buildWorld() {
    const track = buildTrack({ anisotropy: renderer.capabilities.getMaxAnisotropy() });
    const group = new THREE.Group(); group.name = 'DriveWorld';
    group.add(track.group);
    // sky + sun (late-afternoon light, the sun matched to the HDRI used for reflections)
    const sky = new Sky(); sky.scale.setScalar(4500);
    const elev = THREE.MathUtils.degToRad(34), azim = THREE.MathUtils.degToRad(-128);
    const sunDir = new THREE.Vector3(Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim));
    const u = sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.2; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(sunDir);
    group.add(sky);
    const sun = new THREE.DirectionalLight(0xfff3e4, 3.3);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    group.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a5a32, 0.35); group.add(hemi);
    // environment: real outdoor HDRI (CC0) rotated so its sun agrees with ours
    let envRT = null;
    try {
      const hdr = await loadHDRI('park');
      const hdriSunAz = 0.6 * 2 * Math.PI - Math.PI; // u = 0.6 in the equirect
      envRT = buildEnvironment(renderer, { hdr, rotation: hdriSunAz - azim, gain: 1.0, lowMix: 0.0, size: 256 });
    } catch (e) { console.warn('[drive] HDRI unavailable', e); }
    // soft contact shadow under the car (ambient occlusion blob)
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const blobTex = new THREE.CanvasTexture(c);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.5), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.75 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; blob.renderOrder = 1; blob.name = 'ContactShadow';
    // TV camera positions
    const tv = [];
    for (let s = 60; s < track.tr.length; s += 150) {
      const i = Math.floor(s / 2) % track.tr.n, side = track.tr.K[i] > 0 ? -1 : 1; // outside of the bend
      tv.push({ s, pos: new THREE.Vector3(track.tr.P[2 * i] + track.tr.R[2 * i] * side * (WALL + 4), 8.5, track.tr.P[2 * i + 1] + track.tr.R[2 * i + 1] * side * (WALL + 4)) });
    }
    return { group, track, sky, sun, sunDir, hemi, envRT, blob, tv };
  }

  // ------------------------------------------------------------------ input
  const keys = new Set();
  const touch = { left: false, right: false, throttle: false, brake: false };
  let steer = 0, padPrev = {};
  function readInput(dt) {
    let thr = 0, brk = 0, target = 0, hb = 0, usingPad = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && [...pads].find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] || 0, rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      if (Math.abs(ax) > 0.08 || rt > 0.05 || lt > 0.05) usingPad = true;
      if (usingPad) { target = Math.sign(ax) * Math.pow(Math.max(0, Math.abs(ax) - 0.08) / 0.92, 1.4); thr = rt; brk = lt; }
      const edge = (i) => { const on = !!pad.buttons[i]?.pressed; const was = padPrev[i]; padPrev[i] = on; return on && !was; };
      if (edge(5)) { veh.auto = false; veh.shift(1); }
      if (edge(4)) { veh.auto = false; veh.shift(-1); }
      if (edge(3)) cycleCam();
      if (edge(2)) resetCar();
      if (edge(9)) setPaused(!paused);
      if (pad.buttons[0]?.pressed) hb = 1;
    }
    if (!usingPad) {
      thr = keys.has('w') || keys.has('arrowup') || touch.throttle ? 1 : 0;
      brk = keys.has('s') || keys.has('arrowdown') || touch.brake ? 1 : 0;
      target = (keys.has('d') || keys.has('arrowright') || touch.right ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') || touch.left ? 1 : 0);
      hb = keys.has(' ') ? 1 : 0;
      // digital steering: rate limited, quicker to centre, gentler at speed
      const v = Math.abs(veh.u), rate = target === 0 ? 4.5 : 2.4 / (1 + v / 40);
      steer += Math.max(-rate * dt, Math.min(rate * dt, target - steer));
    } else steer = target;
    veh.input.throttle = thr; veh.input.brake = brk; veh.input.steer = steer; veh.input.handbrake = hb;
  }

  // ------------------------------------------------------------------ autopilot (demo lap / QA)
  // pure-pursuit steering on the centre line plus a speed plan from the curvature ahead
  function autopilot() {
    const tr = world.track.tr, Q = world.track.query, q = Q.query(veh.x, veh.z), L = tr.length;
    const V = Math.max(1, veh.u);
    const tg = Q.pose(q.s + 10 + V * 0.35, 0);
    Q.last = q.i;
    const c = Math.cos(veh.psi), sn = Math.sin(veh.psi);
    const dx = tg.x - veh.x, dz = tg.z - veh.z;
    const fwd = dx * c - dz * sn, right = dx * sn + dz * c;
    const alpha = Math.atan2(right, fwd);
    // pure pursuit + yaw-rate damping against the path's own yaw rate
    const delta = Math.atan((2 * veh.L * Math.sin(alpha)) / Math.max(1, Math.hypot(dx, dz))) - 0.12 * (veh.r - V * tr.K[q.i]);
    const range = veh.p.steerMax / (1 + (V / 26) ** 2 * 0.9);
    const st = THREE.MathUtils.clamp(delta / range, -1, 1);
    const muG = veh.p.mu * (veh.mode === 'WET' ? 0.72 : 1) * 9.81 * 0.72;
    let vAllow = 95;
    for (let d = 0; d < 420; d += 4) {
      const i = Math.floor((((q.s + d) % L) + L) % L / 2) % tr.n;
      const k = Math.abs(tr.K[i]) + 1e-4;
      const vc = Math.sqrt((muG * (1 + 0.00025 * V * V)) / k);
      vAllow = Math.min(vAllow, Math.sqrt(vc * vc + 2 * 0.8 * muG * d));
    }
    const err = vAllow - V;
    return { steer: st, throttle: THREE.MathUtils.clamp(err * 0.35, 0, 1) * (1 - 0.55 * Math.abs(st)), brake: THREE.MathUtils.clamp(-err * 0.22, 0, 1), handbrake: 0 };
  }

  // ------------------------------------------------------------------ session state
  const lap = { t: 0, armed: false, best: store.get('best', 0), last: 0, bestTrace: store.get('bestTrace', null), trace: [], lastS: 0, valid: true, count: 0 };
  const launch = { state: 'idle', t: 0, best: store.get('best0100', 0), t200: 0 };
  let crank = -1, collideT = 0, offTrack = false;
  const tele = { rows: [], ring: { speed: new Float32Array(900), thr: new Float32Array(900), brk: new Float32Array(900), steer: new Float32Array(900), rpm: new Float32Array(900) }, head: 0, acc: 0, t: 0 };

  function placeAt(s, speed = 0, offset = 0) {
    const p = world.track.query.pose(s, offset);
    veh.reset(p.x, p.z, p.psi);
    veh.u = speed; veh.gear = speed > 20 ? 3 : speed > 8 ? 2 : 1;
    world.track.query.last = p.i;
    lap.t = 0; lap.armed = false; lap.trace = []; lap.valid = true; lap.lastS = s;
    steer = 0;
  }
  function resetCar() {
    if (!world) return;
    if (challenge === 'launch') { placeAt(110); launch.state = 'ready'; launch.t = 0; return; }
    const q = world.track.query.query(veh.x, veh.z);
    const p = world.track.query.pose(q.s, 0);
    veh.reset(p.x, p.z, p.psi); steer = 0; lap.valid = false;
    toast('Car reset to the track · lap invalidated');
  }
  function startChallenge(c) {
    challenge = c;
    if (c === 'hotlap') { placeAt(world.track.tr.length - 270, 80 / 3.6); lap.armed = false; toast('Hot lap · flying start, cross the line to begin'); }
    else if (c === 'demo') { placeAt(world.track.tr.length - 270, 80 / 3.6); lap.armed = false; veh.mode = 'SPORT'; api.syncSetup?.(); $('telemetry').hidden = false; toast('Demo lap · autopilot in SPORT, telemetry on'); }
    else if (c === 'launch') { placeAt(110); launch.state = 'ready'; toast('0–100 km/h · hold the brake, then floor it'); }
    else { placeAt(20); toast('Free run'); }
    $('hudChallenge').textContent = c === 'demo' ? 'DEMO · autopilot' : c === 'hotlap' ? `HOT LAP · best ${fmt(lap.best)}` : c === 'launch' ? `0–100 km/h · best ${launch.best ? launch.best.toFixed(2) + ' s' : '–'} (simulation)` : '';
  }

  // ------------------------------------------------------------------ cameras
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let camInit = false, tvCam = null;
  function cycleCam() { const order = ['chase', 'hood', 'cockpit', 'tv']; setCam(order[(order.indexOf(camMode) + 1) % order.length]); }
  function setCam(m) {
    camMode = m; camInit = false;
    document.body.dataset.cam = active ? m : '';
    document.querySelectorAll('#driveCam button').forEach((b) => b.classList.toggle('active', b.dataset.cam === m));
    sound.setPerspective(m === 'cockpit' || m === 'hood' ? 1 : 0);
  }
  function updateCamera(dt) {
    const c = Math.cos(veh.psi), s = Math.sin(veh.psi);
    const fwd = tmp.set(c, 0, -s);
    const P = car.root.position;
    let fov = 60;
    if (camMode === 'chase') {
      const back = 6.4 + Math.min(1.5, veh.speed / 40), up = 1.85;
      const want = new THREE.Vector3(P.x - fwd.x * back, up, P.z - fwd.z * back);
      const look = new THREE.Vector3(P.x + fwd.x * 4, 0.75, P.z + fwd.z * 4);
      if (!camInit) { camPos.copy(want); camLook.copy(look); camInit = true; }
      const k = 1 - Math.exp(-dt * 7);
      camPos.lerp(want, k); camLook.lerp(look, 1 - Math.exp(-dt * 12));
      camera.position.copy(camPos); camera.lookAt(camLook);
      fov = 58 + Math.min(10, veh.speed * 0.12);
    } else if (camMode === 'hood' || camMode === 'cockpit') {
      const local = camMode === 'hood' ? new THREE.Vector3(0.55, 1.08, 0) : car.anchors.driverEye.clone();
      const ahead = camMode === 'hood' ? new THREE.Vector3(12, 0.7, 0) : car.anchors.driverLook.clone().add(new THREE.Vector3(6, 0.25, 0.09));
      car.root.updateMatrixWorld();
      camera.position.copy(local.applyMatrix4(car.root.matrixWorld));
      camera.lookAt(ahead.applyMatrix4(car.root.matrixWorld));
      fov = camMode === 'hood' ? 66 : 70;
    } else {
      // TV: nearest trackside camera ahead of the car, zoomed to keep the car a constant size
      // the closest trackside camera, with a little hysteresis so it does not flicker
      let best = world.tv[0], bd = 1e9;
      for (const t of world.tv) { const d = t.pos.distanceTo(P) * (t === tvCam ? 0.8 : 1); if (d < bd) { bd = d; best = t; } }
      if (best !== tvCam) { tvCam = best; camInit = false; }
      camera.position.copy(best.pos);
      camLook.lerp(new THREE.Vector3(P.x, 0.6, P.z), camInit ? 1 - Math.exp(-dt * 10) : 1); camInit = true;
      camera.lookAt(camLook);
      const dist = camera.position.distanceTo(P);
      fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(4.2 / dist)), 6, 55);
    }
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  }

  // ------------------------------------------------------------------ car visuals
  const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qRoll = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1), Xax = new THREE.Vector3(1, 0, 0);
  let pitch = 0, roll = 0;
  const tail0 = car.fun.tailMat.emissiveIntensity;
  function poseCar(dt) {
    pitch += (THREE.MathUtils.clamp(veh.ax * 0.0024, -0.035, 0.02) - pitch) * Math.min(1, dt * 8);
    roll += (THREE.MathUtils.clamp(-veh.ay * 0.0022, -0.035, 0.035) - roll) * Math.min(1, dt * 8);
    qYaw.setFromAxisAngle(Y, veh.psi); qPitch.setFromAxisAngle(Zax, pitch); qRoll.setFromAxisAngle(Xax, roll);
    car.root.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
    car.root.position.set(veh.x, collideT > 0 ? Math.random() * 0.01 : (offTrack ? (Math.random() - 0.5) * 0.008 * Math.min(1, veh.speed / 10) : 0), veh.z);
    for (const w of car.fun.wheels) {
      const front = w.home.x > 0;
      w.spin.rotation.z = -(front ? veh.spinF : veh.spinR);
      w.group.rotation.y = front ? -veh.delta : 0;
    }
    car.fun.tailMat.emissiveIntensity = veh.input.brake > 0.05 ? tail0 * 2.6 : tail0;
    const wantWing = veh.speed > 22 && (veh.input.brake > 0.2 || Math.abs(veh.ay) > 9);
    if (wantWing !== veh.wing) { veh.wing = wantWing; car.set('wing', wantWing); }
  }

  // ------------------------------------------------------------------ HUD
  const mm = $('minimap').getContext('2d'), gm = $('gmeter').getContext('2d'), tc = $('teleCanvas').getContext('2d');
  let mapBg = null, mapTf = null, hudT = 0;
  function drawMapBg() {
    const tr = world.track.tr, W = 220, H = 220;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < tr.n; i++) { x0 = Math.min(x0, tr.P[2 * i]); x1 = Math.max(x1, tr.P[2 * i]); z0 = Math.min(z0, tr.P[2 * i + 1]); z1 = Math.max(z1, tr.P[2 * i + 1]); }
    const sc = (W - 24) / Math.max(x1 - x0, z1 - z0);
    mapTf = (x, z) => [12 + (x - x0) * sc + ((W - 24) - (x1 - x0) * sc) / 2, 12 + (z - z0) * sc + ((H - 24) - (z1 - z0) * sc) / 2];
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 9; g.beginPath();
    for (let i = 0; i <= tr.n; i++) { const [x, y] = mapTf(tr.P[2 * (i % tr.n)], tr.P[2 * (i % tr.n) + 1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.strokeStyle = 'rgba(235,236,238,0.85)'; g.lineWidth = 3.2; g.stroke();
    const [sx, sy] = mapTf(tr.P[0], tr.P[1]); g.fillStyle = '#d5222e'; g.fillRect(sx - 1.5, sy - 6, 3, 12);
    mapBg = c;
  }
  function drawHUD() {
    const kmh = Math.max(0, veh.kmh);
    $('hudSpeed').textContent = Math.round(kmh);
    $('hudGear').textContent = kmh < 1 && veh.input.throttle < 0.05 ? 'N' : String(veh.gear);
    $('hudRpm').textContent = Math.round(veh.rpm / 10) * 10;
    $('hudRpmFill').style.width = `${Math.min(100, (veh.rpm / 9800) * 100)}%`;
    $('hudThr').style.height = `${veh.input.throttle * 100}%`;
    $('hudBrk').style.height = `${veh.input.brake * 100}%`;
    $('hudMode').textContent = `${veh.mode}${veh.auto ? ' · AUTO' : ' · MAN'}`;
    $('hudTC').className = veh.tcAct || veh.escAct ? 'act' : veh.mode === 'CT OFF' ? '' : 'on';
    $('hudABS').className = veh.absAct ? 'act' : 'on';
    $('hudDRS').className = veh.wing ? 'act' : 'on';
    const lt = $('hudLapTime');
    lt.textContent = lap.armed ? fmt(lap.t) : challenge === 'launch' ? (launch.state === 'run' || launch.state === 'done' ? launch.t.toFixed(2) + ' s' : '0.00 s') : '-:--.---';
    lt.classList.toggle('idle', !lap.armed && !(challenge === 'launch' && launch.state !== 'ready'));
    $('hudBest').textContent = challenge === 'launch' ? (launch.best ? launch.best.toFixed(2) + ' s' : '–') : fmt(lap.best);
    $('hudLast').textContent = fmt(lap.last);
    const dEl = $('hudDelta');
    if (lap.armed && lap.bestTrace && lap.valid) {
      const k = Math.min(lap.bestTrace.length - 1, Math.floor(lapS() / 10));
      const d = lap.t - lap.bestTrace[k];
      dEl.textContent = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`; dEl.className = 'delta ' + (d < 0 ? 'neg' : 'pos');
    } else { dEl.textContent = lap.armed && !lap.valid ? 'INVALID' : ''; dEl.className = 'delta'; }
    // minimap
    if (!mapBg) drawMapBg();
    mm.clearRect(0, 0, 220, 220); mm.drawImage(mapBg, 0, 0);
    const [cx, cy] = mapTf(veh.x, veh.z);
    mm.fillStyle = '#f2c200'; mm.beginPath(); mm.arc(cx, cy, 5, 0, Math.PI * 2); mm.fill();
    mm.strokeStyle = '#000'; mm.lineWidth = 1.5; mm.stroke();
    // g-meter
    gm.clearRect(0, 0, 120, 120);
    gm.strokeStyle = 'rgba(255,255,255,0.18)'; gm.lineWidth = 1;
    for (const r of [25, 50]) { gm.beginPath(); gm.arc(60, 60, r, 0, Math.PI * 2); gm.stroke(); }
    gm.beginPath(); gm.moveTo(60, 6); gm.lineTo(60, 114); gm.moveTo(6, 60); gm.lineTo(114, 60); gm.stroke();
    const gx = THREE.MathUtils.clamp(veh.ay / 9.81, -2.2, 2.2) * 25, gy = THREE.MathUtils.clamp(-veh.ax / 9.81, -2.2, 2.2) * 25;
    gm.fillStyle = '#f2c200'; gm.beginPath(); gm.arc(60 + gx, 60 + gy, 4.5, 0, Math.PI * 2); gm.fill();
    gm.fillStyle = 'rgba(255,255,255,0.5)'; gm.font = '9px JetBrains Mono, monospace'; gm.fillText('1g', 64, 37); gm.fillText('2g', 64, 12);
    gm.fillText(`${(Math.hypot(veh.ax, veh.ay) / 9.81).toFixed(2)}g`, 4, 116);
  }
  function lapS() { return world.track.query.query(veh.x, veh.z).s; }

  function drawTelemetry() {
    const el = $('telemetry'); if (el.hidden) return;
    const W = 760, H = 190, R = tele.ring, n = 900;
    tc.clearRect(0, 0, W, H);
    tc.strokeStyle = 'rgba(255,255,255,0.08)'; tc.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = 10 + (k * (H - 20)) / 4; tc.beginPath(); tc.moveTo(0, y); tc.lineTo(W, y); tc.stroke(); }
    const plot = (arr, max, color, min = 0) => {
      tc.strokeStyle = color; tc.lineWidth = 1.4; tc.beginPath();
      for (let k = 0; k < n; k++) { const v = arr[(tele.head + k) % n]; const x = (k / (n - 1)) * W, y = H - 10 - ((v - min) / (max - min)) * (H - 20); k ? tc.lineTo(x, y) : tc.moveTo(x, y); }
      tc.stroke();
    };
    plot(R.speed, 330, '#e9eaec'); plot(R.rpm, 9800, 'rgba(242,194,0,0.8)'); plot(R.thr, 1, '#3fbf7f'); plot(R.brk, 1, '#d5222e'); plot(R.steer, 1, 'rgba(120,170,255,0.9)', -1);
    tc.font = '10px JetBrains Mono, monospace';
    [['speed', '#e9eaec'], ['rpm', '#f2c200'], ['throttle', '#3fbf7f'], ['brake', '#d5222e'], ['steer', '#78aaff']].forEach(([t, c], k) => { tc.fillStyle = c; tc.fillText(t, 8 + k * 78, 14); });
    $('teleInfo').textContent = `last 30 s · ${tele.rows.length} samples logged`;
  }
  function logTelemetry(dt) {
    tele.acc += dt; tele.t += dt;
    if (tele.acc < 1 / 30) return;
    tele.acc = 0;
    const R = tele.ring, h = tele.head;
    R.speed[h] = Math.max(0, veh.kmh); R.thr[h] = veh.input.throttle; R.brk[h] = veh.input.brake; R.steer[h] = veh.input.steer; R.rpm[h] = veh.rpm;
    tele.head = (h + 1) % 900;
    if (tele.rows.length < 36000) tele.rows.push([tele.t.toFixed(3), lapS().toFixed(1), veh.kmh.toFixed(2), Math.round(veh.rpm), veh.gear, veh.input.throttle.toFixed(2), veh.input.brake.toFixed(2), veh.input.steer.toFixed(3), (veh.ax / 9.81).toFixed(3), (veh.ay / 9.81).toFixed(3), veh.x.toFixed(2), veh.z.toFixed(2)]);
  }
  function exportCSV() {
    const head = 'time_s,distance_m,speed_kmh,rpm,gear,throttle,brake,steer,ax_g,ay_g,x_m,z_m\n';
    const blob = new Blob([head + tele.rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'f-future-telemetry.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Telemetry exported (simulation data)');
  }

  // ------------------------------------------------------------------ timing
  function timing(dt) {
    const q = world.track.query.query(veh.x, veh.z), L = world.track.tr.length;
    // crossing the line forwards
    const crossed = lap.lastS > L - 60 && q.s < 60 && veh.u > 1;
    if (crossed) {
      if (lap.armed) {
        lap.last = lap.t; lap.count++;
        if (lap.valid && (!lap.best || lap.t < lap.best)) {
          lap.best = lap.t; lap.bestTrace = lap.trace.slice(); store.set('best', lap.best); store.set('bestTrace', lap.bestTrace);
          toast(`New best lap ${fmt(lap.t)} (simulation)`, 3200);
        } else toast(`Lap ${fmt(lap.t)}${lap.valid ? '' : ' · invalid'}`, 2400);
      }
      lap.armed = true; lap.t = 0; lap.trace = []; lap.valid = true;
      if (challenge === 'hotlap') $('hudChallenge').textContent = `HOT LAP · best ${fmt(lap.best)}`;
    }
    lap.lastS = q.s;
    if (lap.armed) {
      lap.t += dt;
      const k = Math.floor(q.s / 10); while (lap.trace.length <= k) lap.trace.push(lap.t);
    }
    // surface
    const ad = Math.abs(q.d), side = q.d > 0 ? 1 : -1;
    offTrack = false;
    if (ad <= ROAD_HALF) veh.surface = { mu: 1, drag: 0 };
    else if (ad <= ROAD_HALF + 1.3 && world.track.kerbAt(q.i, side)) veh.surface = { mu: 0.95, drag: 0.01 };
    else if (ad <= ROAD_HALF + 9) veh.surface = { mu: 0.9, drag: 0.01 };
    else { veh.surface = { mu: 0.55, drag: 0.22 }; offTrack = true; }
    if (ad > ROAD_HALF + 3.5 && lap.armed) lap.valid = false;
    // barriers
    if (ad > WALL - 1.1) {
      const tr = world.track.tr, i = q.i, nx = tr.R[2 * i] * side, nz = tr.R[2 * i + 1] * side;
      const push = ad - (WALL - 1.1);
      veh.x -= nx * push; veh.z -= nz * push;
      // remove velocity into the wall (world), damp the rest
      const c = Math.cos(veh.psi), s = Math.sin(veh.psi);
      const vx = veh.u * c + veh.v * s, vz = -veh.u * s + veh.v * c;
      const into = vx * nx + vz * nz;
      if (into > 0) {
        const wx = (vx - nx * into * 1.3) * 0.75, wz = (vz - nz * into * 1.3) * 0.75;
        veh.u = wx * c - wz * s; veh.v = wx * s + wz * c; veh.r *= 0.5;
        if (into > 3 && collideT <= 0) { collideT = 0.25; sound.tone([70, 52], { type: 'sawtooth', dur: 0.22, gain: Math.min(0.25, into * 0.02) }); }
      }
      lap.valid = false;
    }
    if (collideT > 0) collideT -= dt;
    // launch challenge
    if (challenge === 'launch') {
      if (launch.state === 'ready' && veh.input.throttle > 0.1 && veh.u > 0.05) { launch.state = 'run'; launch.t = 0; launch.t200 = 0; }
      if (launch.state === 'run') {
        launch.t += dt;
        if (veh.kmh >= 100) {
          launch.state = 'done';
          const prev = launch.best;
          if (!launch.best || launch.t < launch.best) { launch.best = launch.t; store.set('best0100', launch.best); }
          toast(`0–100 km/h in ${launch.t.toFixed(2)} s${prev && launch.t < prev ? ' · new best' : ''} (simulation) · R to retry`, 3800);
          $('hudChallenge').textContent = `0–100 km/h · best ${launch.best.toFixed(2)} s (simulation)`;
        }
      }
    }
  }

  // ------------------------------------------------------------------ setup sheet
  const FIELDS = [
    ['output', 'Engine output', 0.6, 1.3, 0.01, (v) => `${Math.round(v * 100)} %`],
    ['mass', 'Mass', 1200, 1800, 10, (v) => `${v} kg`],
    ['frontWeight', 'Front weight share', 0.36, 0.48, 0.005, (v) => `${(v * 100).toFixed(1)} %`],
    ['mu', 'Tyre grip (μ)', 0.9, 1.6, 0.01, (v) => v.toFixed(2)],
    ['rearGrip', 'Rear / front grip', 0.95, 1.25, 0.01, (v) => v.toFixed(2)],
    ['clA', 'Downforce (ClA)', 0, 4, 0.05, (v) => v.toFixed(2)],
    ['cdA', 'Drag (CdA)', 0.5, 1.1, 0.01, (v) => v.toFixed(2)],
    ['aeroBalance', 'Aero balance front', 0.3, 0.55, 0.01, (v) => `${Math.round(v * 100)} %`],
    ['brakeBias', 'Brake bias front', 0.5, 0.72, 0.01, (v) => `${Math.round(v * 100)} %`],
    ['final', 'Final drive', 3.6, 5.2, 0.05, (v) => v.toFixed(2)],
  ];
  function buildSetup() {
    const body = $('setupBody');
    body.innerHTML = `<p class="note" style="margin-top:12px">All values below are <b>simulation parameters</b> for this game, not official or claimed F-Future specifications.</p>
      <section><h2>Assists · manettino</h2><div class="seg" id="setMode">${MODES.map((m) => `<button data-m="${m}">${m}</button>`).join('')}</div>
      <div class="seg" id="setGear" style="margin-top:8px"><button data-g="auto">Automatic</button><button data-g="man">Manual (Q / E)</button></div></section>
      <section><h2>Vehicle</h2>${FIELDS.map(([k, label, min, max, step]) => `<label class="field">${label}<output id="out-${k}"></output><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"></label>`).join('')}
      <button id="setupReset" class="wide">Restore defaults</button></section>`;
    const sync = () => {
      for (const [k, , , , , f] of FIELDS) { const inp = body.querySelector(`[data-k="${k}"]`); inp.value = veh.p[k]; $(`out-${k}`).textContent = f(+veh.p[k]); }
      body.querySelectorAll('#setMode button').forEach((b) => b.classList.toggle('active', b.dataset.m === veh.mode));
      body.querySelectorAll('#setGear button').forEach((b) => b.classList.toggle('active', (b.dataset.g === 'auto') === veh.auto));
    };
    body.querySelectorAll('input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
      veh.p[inp.dataset.k] = +inp.value; sync();
      const o = {}; for (const [k] of FIELDS) if (veh.p[k] !== DEFAULTS[k]) o[k] = veh.p[k]; store.set('setup', o);
    }));
    body.querySelectorAll('#setMode button').forEach((b) => b.addEventListener('click', () => { veh.mode = b.dataset.m; store.set('mode', veh.mode); sync(); }));
    body.querySelectorAll('#setGear button').forEach((b) => b.addEventListener('click', () => { veh.auto = b.dataset.g === 'auto'; store.set('auto', veh.auto); sync(); }));
    $('setupReset').addEventListener('click', () => { for (const [k] of FIELDS) veh.p[k] = DEFAULTS[k]; store.set('setup', {}); sync(); });
    sync();
    api.syncSetup = sync;
  }

  // ------------------------------------------------------------------ UI wiring
  function setPaused(p) {
    paused = p;
    $('driveIntro').classList.toggle('gone', !p);
    $('driveGo').lastChild.textContent = running ? 'Resume' : 'Start';
    if (p) sound.setRPM(veh.rpm * 0.6, 0);
  }
  $('driveGo').addEventListener('click', () => {
    const want = document.querySelector('#challengeSel .active')?.dataset.challenge || 'free';
    if (!running || want !== challenge) { startChallenge(want); if (!running) { running = true; crank = 0; sound.startEngine(); } }
    setPaused(false);
    renderer.domElement.focus();
  });
  document.querySelectorAll('#challengeSel button').forEach((b) => b.addEventListener('click', () => { document.querySelectorAll('#challengeSel button').forEach((x) => x.classList.toggle('active', x === b)); }));
  document.querySelectorAll('#driveCam button').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
  $('setupToggle').addEventListener('click', () => $('setup').classList.toggle('collapsed'));
  $('teleCsv').addEventListener('click', exportCSV);
  document.querySelectorAll('[data-touch]').forEach((b) => {
    const k = b.dataset.touch;
    const on = (e) => { e.preventDefault(); touch[k] = true; b.classList.add('on'); };
    const off = () => { touch[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  });

  // ------------------------------------------------------------------ public API
  const api = {
    get active() { return active; },
    vehicle: veh,
    async enter() {
      active = true;
      if (!world) { toast('Building the test circuit…', 1200); world = await buildWorld(); scene.add(world.group); buildSetup(); }
      world.group.visible = true;
      saved.fov = camera.fov; saved.near = camera.near; saved.far = camera.far; saved.pos = camera.position.clone(); saved.target = controls.target.clone();
      saved.env = scene.environment; saved.envI = scene.environmentIntensity; saved.bg = scene.background; saved.exposure = renderer.toneMappingExposure;
      studio.setActive(false);
      scene.environment = world.envRT?.texture ?? saved.env; scene.environmentIntensity = 0.8;
      scene.background = null; scene.fog = new THREE.Fog(0xb9c6d3, 500, 3200);
      renderer.toneMappingExposure = 1.0;
      camera.near = 0.06; camera.far = 5000; camera.updateProjectionMatrix();
      controls.enabled = false;
      for (const k of ['doorL', 'doorR', 'hood', 'engineCover', 'wing']) car.set(k, false, true);
      car.setXray(false);
      car.root.add(world.blob);
      sound.setOutdoor(true);
      setCam(camMode);
      if (!running) { placeAt(20); setPaused(true); }
      else setPaused(true);
      camInit = false;
    },
    exit() {
      if (!active) return;
      active = false; paused = true;
      world.group.visible = false;
      car.root.remove(world.blob);
      car.root.position.set(0, 0, 0); car.root.quaternion.identity();
      for (const w of car.fun.wheels) { w.group.rotation.y = 0; }
      car.fun.tailMat.emissiveIntensity = tail0;
      car.set('wing', false, true); veh.wing = false;
      scene.fog = null; scene.environment = saved.env; scene.environmentIntensity = saved.envI; scene.background = saved.bg;
      studio.setActive(true); renderer.toneMappingExposure = saved.exposure;
      camera.near = saved.near; camera.far = saved.far; camera.fov = saved.fov; camera.updateProjectionMatrix();
      camera.position.copy(saved.pos); controls.target.copy(saved.target);
      controls.enabled = true;
      if (running) { sound.stopEngine(); running = false; crank = -1; }
      sound.stopDrive(); sound.setOutdoor(false); sound.setPerspective(0);
      document.body.dataset.cam = '';
      $('driveIntro').classList.remove('gone');
    },
    update(dt) {
      if (!active || !world) return;
      if (!paused) {
        readInput(dt);
        if (challenge === 'demo') { const a = autopilot(); Object.assign(veh.input, a); steer = a.steer; }
        if (crank >= 0 && crank < 1.6) { crank += dt; veh.input.throttle = 0; }
        veh.step(dt);
        if (crank >= 0 && crank < 1.6) veh.rpm = starterRPM(crank);
        timing(dt);
        logTelemetry(dt);
      }
      poseCar(dt);
      updateCamera(dt);
      // sun and its shadow camera follow the car
      const P = car.root.position;
      world.sun.position.set(P.x + world.sunDir.x * 60, world.sunDir.y * 60, P.z + world.sunDir.z * 60);
      world.sun.target.position.copy(P); world.sun.target.updateMatrixWorld();
      // audio
      if (running) {
        const thr = crank >= 0 && crank < STARTER_TIME ? 0 : veh.input.throttle;
        sound.setRPM(veh.rpm, Math.max(thr, veh.limiterHit ? 1 : 0));
        const slip = Math.max(0, veh.slipR - 0.07, veh.slipF - 0.08) * 6 + veh.wheelSlip + (veh.absAct ? 0.35 : 0);
        sound.setDrive(paused ? 0 : veh.speed, paused ? 0 : slip);
      }
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 1 / 30; drawHUD(); drawTelemetry();
        if (camMode === 'cockpit') car.fun.redrawCluster?.({ rpm: veh.rpm, mode: veh.mode, gear: String(veh.gear), speed: Math.max(0, veh.kmh), on: running });
      }
    },
    onKeyDown(e) {
      if (!active) return false;
      const k = e.key.toLowerCase();
      if (k === 'escape') { setPaused(!paused); return true; }
      if (paused) { if (k === 'enter') $('driveGo').click(); return k !== '1' && k !== '2' && k !== '3' && k !== '4' && k !== '5' && k !== 'm' && k !== 'p' && k !== '?'; }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) { keys.add(k); e.preventDefault(); return true; }
      if (k === 'e' && !e.repeat) { veh.auto = false; veh.shift(1); return true; }
      if (k === 'q' && !e.repeat) { veh.auto = false; veh.shift(-1); return true; }
      if (k === 'x') { veh.auto = !veh.auto; toast(veh.auto ? 'Automatic gearbox' : 'Manual gearbox · Q / E'); return true; }
      if (k === 'c') { cycleCam(); return true; }
      if (k === 'r') { resetCar(); return true; }
      if (k === 't') { $('telemetry').hidden = !$('telemetry').hidden; return true; }
      if (k === 'g') { const i = (MODES.indexOf(veh.mode) + 1) % MODES.length; veh.mode = MODES[i]; store.set('mode', veh.mode); api.syncSetup?.(); toast(`Manettino · ${veh.mode}`); return true; }
      return !['1', '2', '3', '4', '5', 'm', 'p', '?'].includes(k);
    },
    onKeyUp(e) { if (!active) return false; keys.delete(e.key.toLowerCase()); return true; },
    /** Deterministic drive for QA: place the car and run the simulation for some seconds with fixed input. */
    qaRun(seconds = 3, input = { throttle: 1 }, s = 20, speed = 0) {
      if (!world) return;
      if (s !== null) placeAt(s, speed);
      running = true; paused = false;
      for (let t = 0; t < seconds; t += 1 / 60) { Object.assign(veh.input, input === 'auto' ? autopilot() : { steer: 0, brake: 0, throttle: 0, handbrake: 0, ...input }); veh.step(1 / 60); timing(1 / 60); poseCar(1 / 60); updateCamera(1 / 60); }
      drawHUD();
    },
    setCam, startChallenge: (c) => world && startChallenge(c),
  };
  void onExitRequest;
  return api;
}
