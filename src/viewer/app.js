// F-Future interactive concept: application shell.
// Core viewer (renderer, photographic post-processing, studio, car, camera presets, modes,
// picking) plus three workspaces: Showroom, Engineering (engineering.js) and Drive (../drive).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Studio } from './studio.js';
import { buildCar } from '../car/car.js';
import { createFun, PAINTS, SECRETS } from './fun.js';
import { EngineAudio } from './audio/engine.js';

const params = new URLSearchParams(location.search);
const QA = params.has('qa');
if (QA && !params.has('ui')) document.body.classList.add('qa');
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
const $ = (id) => document.getElementById(id);

const canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QA ? 1 : 1.75));
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
camera.position.set(6.2, 2.2, 6.0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.55, 0);
controls.minDistance = 1.2;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;

const studio = new Studio(renderer, scene, { theme: params.get('theme') || 'showroom' });
const sound = new EngineAudio();

// ---------- post processing ----------
// photographic finish: lens vignette and fine film grain (display-referred, after tone mapping)
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.32 }, grain: { value: 0.022 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, vignette, grain; uniform vec2 res; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
      c.rgb *= 1.0 - vignette * smoothstep(0.35, 1.25, length(d));
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += (h(vUv * res) - 0.5) * grain * (1.0 - lum * 0.6);
      gl_FragColor = c;
    }`,
};
let composer, gtao, bloom, film;
let quality = params.get('quality') || (QA ? 'balanced' : matchMedia('(max-width: 720px)').matches ? 'balanced' : 'high');
let look = params.get('look') || 'neutral';
function applyLook() { renderer.toneMapping = look === 'filmic' ? THREE.AgXToneMapping : THREE.NeutralToneMapping; }
applyLook();
function setupComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  composer?.dispose();
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  studio.setReflections(quality !== 'low');
  studio.resize(size.x, size.y);
  gtao = null;
  if (quality === 'high') {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, rings: 2, samples: 16 });
    composer.addPass(gtao);
  }
  // bloom only on genuinely bright sources (LEDs, displays, specular glints): linear HDR threshold
  bloom = null;
  if (quality !== 'low') {
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.4, 3.2);
    // guard the bloom chain: one NaN/Inf pixel (e.g. a tiny clear-coat glint under a point light)
    // would otherwise be blurred across the whole frame
    const hp = bloom.materialHighPassFilter;
    hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv );\n float sum_ = texel.r + texel.g + texel.b;\n if (!(sum_ < 1e30 && sum_ > -1e30)) texel = vec4(0.0);\n texel.rgb = clamp(texel.rgb, 0.0, 48.0);');
    hp.needsUpdate = true;
    composer.addPass(bloom);
  }
  const out = new OutputPass();
  out.material.fragmentShader = out.material.fragmentShader.replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\n float sum_ = gl_FragColor.r + gl_FragColor.g + gl_FragColor.b;\n if (!(sum_ < 1e30 && sum_ > -1e30)) gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);');
  composer.addPass(out);
  film = new ShaderPass(FilmShader);
  film.uniforms.res.value.set(size.x, size.y);
  if (QA) film.uniforms.grain.value = 0;
  composer.addPass(film);
}

// Lens shift: centre the car in the space the panels leave free (desktop layouts only).
let viewW = 1, viewH = 1;
function applyViewOffset() {
  const narrow = viewW <= 720;
  let shift = 0;
  if (!narrow && !(QA && !params.has('ui'))) {
    if (ws === 'showroom') shift = (300 + 12) / 2;
    else if (ws === 'engineering') shift = (300 - 264) / 2;
  }
  if (shift) camera.setViewOffset(viewW, viewH, shift, 0, viewW, viewH); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const qw = params.get('w'), qh = params.get('h');
  const W = qw ? +qw : w, H = qh ? +qh : h;
  renderer.setSize(W, H, !qw);
  camera.aspect = W / H;
  viewW = W; viewH = H;
  applyViewOffset();
  setupComposer();
  composer.setSize(W, H);
}

// ---------- loader ----------
const progress = (p, label) => { $('loaderFill').style.width = `${Math.round(p * 100)}%`; $('loaderPct').textContent = `${Math.round(p * 100)}%`; if (label) $('loaderStep').textContent = label; };

let car, fun = null, eng = null, drive = null;
const timer = new THREE.Timer();

// ---------- camera presets ----------
const VIEWS = {
  // exact camera of the reference hero render (recovered by tools/fit_camera.py)
  threeQuarter: { pos: [7.037, 1.174, -4.61], target: [-0.08, 0.052, -0.249], fov: 25 },
  front: { pos: [8.5, 0.62, 0], target: [0, 0.55, 0] },
  side: { pos: [0.15, 0.62, -8.0], target: [0.15, 0.55, 0] },
  rear: { pos: [-8.5, 0.75, 0], target: [0, 0.55, 0] },
  top: { pos: [0.15, 10.5, 0.0001], target: [0.15, 0, 0] },
  rearQuarter: { pos: [-5.4, 1.7, -4.7], target: [-0.2, 0.55, 0] },
  hero: { pos: [4.75, 1.75, -3.55], target: [0.35, 0.45, 0], fov: 32 },
  reference: { pos: [3.2, 1.08, -2.55], target: [0.05, 0.5, 0], fov: 38 },
  engineering: { pos: [4.4, 2.6, -5.0], target: [0, 0.45, 0], fov: 32 },
};

let tween = null;
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function flyTo(pos, target, dur = 1.3, opts = {}) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const p1 = new THREE.Vector3(...pos), t1 = new THREE.Vector3(...target);
  const fov0 = camera.fov, fov1 = opts.fov ?? 30;
  if (dur <= 0) { camera.position.copy(p1); controls.target.copy(t1); camera.fov = fov1; camera.updateProjectionMatrix(); controls.update(); tween = null; return; }
  // arc the path around the car (avoid flying through the body)
  const c0 = new THREE.Vector3(p0.x, 0, p0.z), c1 = new THREE.Vector3(p1.x, 0, p1.z);
  const r0 = c0.length(), r1 = c1.length();
  const a0 = Math.atan2(p0.z, p0.x); const a1 = Math.atan2(p1.z, p1.x);
  let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const useArc = !opts.direct && r0 > 2.5 && r1 > 2.5;
  tween = { t: 0, dur, update(k) {
    const e = easeInOut(k);
    if (useArc) {
      const a = a0 + da * e, r = r0 + (r1 - r0) * e;
      camera.position.set(Math.cos(a) * r, p0.y + (p1.y - p0.y) * e, Math.sin(a) * r);
    } else camera.position.lerpVectors(p0, p1, e);
    controls.target.lerpVectors(t0, t1, e);
    camera.fov = fov0 + (fov1 - fov0) * e; camera.updateProjectionMatrix();
  } };
}
// keep the whole car framed on portrait / narrow screens
function fitScale() {
  const panel = viewW > 720 && ws !== 'drive' ? 1.12 : 1;
  return panel * Math.max(1, Math.pow(1.4 / camera.aspect, 0.95), 1 + 0.5 * (1.75 - camera.aspect));
}
function fitPos(pos, target) { const k = fitScale(); return pos.map((p, i) => target[i] + (p - target[i]) * k); }
function setView(name, dur = 1.3) {
  const v = VIEWS[name];
  if (!v) return;
  flyTo(fitPos(v.pos, v.target), v.target, dur, { fov: v.fov ?? 30 });
}

// orthographic QA camera (for comparison against the orthographic reference sheet)
let orthoCam = null;
function makeOrtho(view) {
  const aspect = camera.aspect;
  const half = view === 'top' ? 2.6 : view === 'side' ? 2.6 : 1.25;
  const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 100);
  const T = { side: [[0.17, 0.58, -20], [0.17, 0.58, 0]], front: [[20, 0.58, 0], [0, 0.58, 0]], rear: [[-20, 0.58, 0], [0, 0.58, 0]], top: [[0.17, 20, 0], [0.17, 0, 0]] }[view];
  if (view === 'top') cam.up.set(0, 0, 1);
  cam.position.set(...T[0]);
  cam.lookAt(...T[1]);
  return cam;
}

// ---------- workspaces and modes ----------
let ws = 'showroom';
const MODES = { exterior: 'Exterior', interior: 'Cockpit', engine: 'V12 engine', engineering: 'Engineering' };
let mode = 'exterior';
let setBeforeEng = null;

async function setWorkspace(next, { silent = false } = {}) {
  if (!car || next === ws) return;
  const prev = ws;
  ws = next;
  document.body.dataset.ws = next;
  document.querySelectorAll('#workspaces button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ws === next)));
  $('stWs').textContent = next.toUpperCase();
  applyViewOffset();
  // leave
  if (prev === 'engineering') { eng.exit(); showLabels(labelsOn); if (setBeforeEng) { studio.setTheme(setBeforeEng); syncSets(); } }
  if (prev === 'drive') { drive.exit(); }
  // enter
  if (next === 'showroom') {
    if (prev !== 'showroom') { mode = 'exterior'; setView('hero', silent ? 0 : 1.4); }
    syncModes();
  } else if (next === 'engineering') {
    if (fun?.state.explode) fun.set('explode', false, true);
    setBeforeEng = studio.theme;
    if (studio.theme === 'showroom') { studio.setTheme('blueprint'); syncSets(); }
    for (const k of ['doorL', 'doorR', 'hood', 'engineCover']) car.set(k, false);
    controls.minDistance = 0.3; controls.maxDistance = 30; controls.enablePan = true;
    mode = 'engineering';
    eng.enter();
    setView('engineering', silent ? 0 : 1.3);
  } else if (next === 'drive') {
    if (!drive) {
      const { createDrive } = await import('../drive/drive.js');
      drive = createDrive({ renderer, scene, camera, controls, car, studio, sound, toast });
    }
    if (fun) { for (const k of ['engine', 'rolling', 'wind', 'explode']) if (fun.state[k]) fun.set(k, false, true); }
    showLabels(false);
    autorotate = false; controls.autoRotate = false;
    await drive.enter();
  }
  syncAllToggles();
}

function setMode(m) {
  if (!car) return;
  if (m === 'engineering') {
    // legacy engineering view: engineering workspace with every panel open, X-ray and design notes
    setWorkspace('engineering').then(() => {
      for (const k of ['engineCover', 'hood', 'doorL', 'doorR']) car.set(k, true);
      eng.setShading('xray'); labelsOn = true; showLabels(true); syncAllToggles();
    });
    return;
  }
  if (ws !== 'showroom') setWorkspace('showroom', { silent: true });
  mode = m;
  syncModes();
  controls.minDistance = 1.2; controls.maxDistance = 30;
  controls.enablePan = true;
  if (car.xray) car.setXray(false);
  if (m === 'exterior') {
    car.set('doorL', false); car.set('doorR', false); car.set('engineCover', false); car.set('hood', false);
    setView('hero', 1.6);
  } else if (m === 'interior') {
    car.set('doorL', true); car.set('doorR', false);
    const eye = car.anchors.driverEye.clone().applyMatrix4(car.root.matrixWorld);
    const lookAt = car.anchors.driverLook.clone().applyMatrix4(car.root.matrixWorld);
    const dir = lookAt.clone().sub(eye).normalize();
    const target = eye.clone().add(dir.multiplyScalar(0.06));
    flyTo(eye.toArray(), target.toArray(), 1.8, { direct: true, fov: 68 });
    controls.minDistance = 0.02; controls.maxDistance = 0.9;
    controls.enablePan = false;
  } else if (m === 'engine') {
    car.set('engineCover', true);
    const f = car.anchors.engine.clone().applyMatrix4(car.root.matrixWorld);
    flyTo(fitPos([f.x - 2.3, f.y + 1.9, f.z - 1.7], f.toArray()), f.toArray(), 1.6, { fov: 34 });
  }
  sound.setPerspective(m === 'interior' ? 1 : 0);
  syncAllToggles();
}
function syncModes() {
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('modeSubtitle').textContent = MODES[mode] || '';
}

// ---------- toggles ----------
let labelsOn = false;
let autorotate = false;
function syncToggle(name, on) { document.querySelectorAll(`[data-toggle="${name}"]`).forEach((b) => b.classList.toggle('on', !!on)); }
function syncAllToggles() {
  if (!car) return;
  syncToggle('doorL', car.get('doorL')); syncToggle('doorR', car.get('doorR'));
  syncToggle('hood', car.get('hood')); syncToggle('engineCover', car.get('engineCover'));
  syncToggle('wing', car.get('wing')); syncToggle('lights', car.lightsOn);
  syncToggle('autorotate', autorotate); syncToggle('labels', labelsOn);
  syncFun();
}
function syncSets() { document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('active', b.dataset.set === studio.theme)); }
function toggle(name) {
  if (!car) return;
  switch (name) {
    case 'doorL': case 'doorR': case 'hood': case 'engineCover': case 'wing':
      car.toggle(name); toast(`${car.labelOf(name)} ${car.get(name) ? 'opening' : 'closing'}`); break;
    case 'doorsBoth': { const open = !(car.get('doorL') && car.get('doorR')); car.set('doorL', open); car.set('doorR', open); break; }
    case 'lights': car.setLights(!car.lightsOn); break;
    case 'autorotate': autorotate = !autorotate; controls.autoRotate = autorotate; controls.autoRotateSpeed = 0.6; break;
    case 'xray': if (ws === 'engineering') eng.setShading(eng.shading === 'xray' ? 'shaded' : 'xray'); else car.setXray(!car.xray); break;
    case 'labels': labelsOn = !labelsOn; showLabels(labelsOn); break;
  }
  syncAllToggles();
}

let toastTimer;
function toast(msg, ms = 1800) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- design-note labels (annotations from the design sheet) ----------
const labelsEl = $('labels');
let notes = [];
function buildLabels() {
  labelsEl.innerHTML = '';
  notes = car.hotspots.map((h) => {
    const el = document.createElement('div');
    el.className = 'hotspot hidden' + (h.left ? ' left' : '');
    el.innerHTML = `<div class="dot" title="${h.title}"></div><div class="card"><b>${h.title}</b><i>${h.subtitle}</i></div>`;
    el.querySelector('.dot').addEventListener('click', () => focusOn(h));
    labelsEl.appendChild(el);
    return { h, el };
  });
}
function showLabels(on) { notes.forEach((n) => n.el.classList.toggle('hidden', !on)); labelsEl.dataset.on = on ? '1' : ''; }
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
function updateLabels() {
  if (!labelsEl.dataset.on) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  camera.getWorldDirection(_d);
  for (const n of notes) {
    _v.copy(n.h.position).applyMatrix4(car.root.matrixWorld);
    const front = _v.clone().sub(camera.position).dot(_d) > 0;
    _v.project(camera);
    n.el.style.display = front && _v.z < 1 ? '' : 'none';
    n.el.style.left = `${(_v.x * 0.5 + 0.5) * w}px`;
    n.el.style.top = `${(-_v.y * 0.5 + 0.5) * h}px`;
  }
}
function focusOn(h) {
  const p = h.position.clone().applyMatrix4(car.root.matrixWorld);
  const off = new THREE.Vector3(...(h.view || [1.6, 0.8, 1.6]));
  flyTo(p.clone().add(off).toArray(), p.toArray(), 1.2, { direct: true, fov: 30 });
  if (h.action) car.set(h.action, true);
  syncAllToggles();
}

// ---------- picking ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY, performance.now()]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || !car) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  if (moved > 6 || performance.now() - downAt[2] > 450) return;
  if (ws === 'drive') return;
  if (ws === 'engineering') { eng.onClick(e); return; }
  if (pickEgg(e)) return;
  const hit = pick(e);
  if (hit && hit.action) toggle(hit.action);
});
// hidden interactive bits (nose badge, frunk duck, manettino, start button): only when not occluded
function pickEgg(e) {
  if (!fun) return false;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const eggHit = ray.intersectObjects(car.fun.eggs, true)[0];
  if (!eggHit) return false;
  const first = ray.intersectObjects(car.pickables, true)[0];
  if (first && first.distance < eggHit.distance - 0.03) return false;
  return fun.onEgg(eggHit.object);
}
canvas.addEventListener('dblclick', (e) => {
  if (ws === 'drive') return;
  if (ws === 'engineering') { eng.onDblClick(e); return; }
  const hit = pick(e);
  if (!hit) return;
  const p = hit.point;
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(p.clone().add(dir.multiplyScalar(1.4)).toArray(), p.toArray(), 0.9, { direct: true, fov: camera.fov });
});
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(car.pickables, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !o.userData.action) o = o.parent;
  return { point: hits[0].point, action: o?.userData.action };
}
canvas.addEventListener('pointermove', (e) => {
  if (!car || e.buttons || ws !== 'showroom') return;
  const hit = pick(e);
  canvas.style.cursor = hit?.action ? 'pointer' : 'grab';
});

// ---------- UI wiring ----------
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { if (mode === 'interior') setMode('exterior'); setView(b.dataset.view); }));
$('resetCam').addEventListener('click', () => setMode(mode === 'interior' ? 'exterior' : mode));
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle)));
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('#workspaces button').forEach((b) => b.addEventListener('click', () => setWorkspace(b.dataset.ws)));
document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => { studio.setTheme(b.dataset.set); if (ws === 'engineering') setBeforeEng = b.dataset.set; syncSets(); }));
$('panelBtn').addEventListener('click', () => {
  const b = document.body;
  if (ws === 'engineering') { if (b.classList.contains('sheet')) { b.classList.remove('sheet'); b.classList.add('sheet-left'); } else if (b.classList.contains('sheet-left')) b.classList.remove('sheet-left'); else b.classList.add('sheet'); }
  else b.classList.toggle('sheet');
});
const qSel = $('quality'); qSel.value = quality;
qSel.addEventListener('change', () => { quality = qSel.value; resize(); });
const lSel = $('look'); lSel.value = look;
lSel.addEventListener('change', () => { look = lSel.value; applyLook(); });
$('fsBtn').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); });
const help = $('help');
$('helpBtn').addEventListener('click', () => help.showModal());
$('helpClose').addEventListener('click', () => help.close());
// sound
const vol = $('volume'); vol.value = sound.volume;
function syncSound() { $('soundBtn').innerHTML = `<svg><use href="#i-${sound.muted ? 'mute' : 'sound'}"/></svg>`; $('soundBtn').classList.toggle('off', sound.muted); }
$('soundBtn').addEventListener('click', () => { sound.ensure(); sound.toggleMute(); syncSound(); toast(sound.muted ? 'Sound off' : 'Sound on'); });
vol.addEventListener('input', () => { sound.ensure(); sound.setVolume(+vol.value); if (sound.muted && +vol.value > 0) { sound.setMuted(false); syncSound(); } });
syncSound();
// unlock audio on the first gesture (browsers require it)
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.ensure(), { once: true, passive: true });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || help.open) return;
  const k = e.key.toLowerCase();
  noteInteraction();
  if (k === '?' || (k === '/' && e.shiftKey)) { help.showModal(); return; }
  if (ws === 'drive' && drive?.onKeyDown(e)) return;
  // showroom secret sequences (Konami, typing V12) take precedence over shortcuts
  if (ws === 'showroom' && fun && k !== ' ' && fun.onKey(k)) return;
  if (k === '1') { setMode('exterior'); return; }
  if (k === '2') { setMode('interior'); return; }
  if (k === '3') { setMode('engine'); return; }
  if (k === '4') { setWorkspace('engineering'); return; }
  if (k === '5') { setWorkspace('drive'); return; }
  if (k === 'p') { savePhoto(); return; }
  if (ws === 'engineering') { if (eng.onKey(e)) return; if (k === 'm') $('soundBtn').click(); return; }
  if (ws === 'drive') { if (k === 'm') $('soundBtn').click(); return; }
  // showroom
  if (k === ' ') { e.preventDefault(); if (fun && !e.repeat) fun.set('rev', true); return; }
  if (k === 'm') { $('soundBtn').click(); return; }
  if (k === 'i') { fun?.toggle('engine'); return; }
  const map = { l: () => toggle('doorL'), r: () => toggle('doorR'), h: () => toggle('hood'), e: () => toggle('engineCover'), w: () => toggle('wing'), t: () => toggle('autorotate'), x: () => toggle('xray'), n: () => toggle('labels'), f: () => setView('front'), s: () => setView('side'), b: () => setView('rear'), u: () => setView('top'), q: () => setView('threeQuarter') };
  if (map[k]) map[k]();
});
window.addEventListener('keyup', (e) => {
  if (ws === 'drive') { drive?.onKeyUp(e); return; }
  if (e.key === ' ' && fun) fun.set('rev', false);
});

// ---------- experience: engine, rolling road, wind tunnel, exploded view, paint, photo, secrets ----------
function syncFun() {
  if (!fun) return;
  document.querySelectorAll('[data-fun]').forEach((b) => {
    const n = b.dataset.fun;
    if (n === 'rev') { b.disabled = !fun.get('engine'); return; }
    b.classList.toggle('on', fun.get(n));
    if (n === 'engine') b.textContent = fun.get('engine') ? 'Stop engine' : 'Start engine';
  });
  document.querySelectorAll('#paints button').forEach((b) => b.classList.toggle('on', b.dataset.paint === fun.state.paint));
  $('paintName').textContent = fun.paintName();
}
function syncSecrets(found) {
  $('secretCount').textContent = `${found.size} / ${SECRETS.length}`;
  const ul = $('secretList'); ul.innerHTML = '';
  for (const s of SECRETS) { const li = document.createElement('li'); const ok = found.has(s.id); li.className = ok ? 'found' : ''; li.textContent = ok ? s.found : s.hint; ul.appendChild(li); }
}
function initFunUI() {
  const paints = $('paints');
  for (const p of PAINTS) {
    const b = document.createElement('button');
    b.dataset.paint = p.id; b.title = p.name; b.setAttribute('aria-label', p.name);
    b.style.setProperty('--sw', '#' + p.color.toString(16).padStart(6, '0'));
    b.addEventListener('click', () => fun.setPaint(p.id));
    paints.appendChild(b);
  }
  document.querySelectorAll('[data-fun]').forEach((b) => {
    const n = b.dataset.fun;
    if (n === 'rev') {
      const on = (e) => { e.preventDefault(); fun.set('rev', true); b.classList.add('on'); };
      const off = () => { fun.set('rev', false); b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    } else b.addEventListener('click', () => { if (n === 'explode' && mode === 'interior') setMode('exterior'); fun.toggle(n); syncFun(); });
  });
  $('photoBtn').addEventListener('click', savePhoto);
  syncSecrets(fun.secrets());
  syncFun();
}
function savePhoto() {
  // render one clean frame and download it (the drawing buffer is valid within this task)
  renderOnce();
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'f-future.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Photo saved');
  }, 'image/png');
}

// ---------- showroom idle: a slow turntable after a while without input ----------
let lastInput = performance.now(), idleSpin = false;
function noteInteraction() {
  lastInput = performance.now();
  if (idleSpin) { idleSpin = false; if (!autorotate) controls.autoRotate = false; }
}
for (const ev of ['pointerdown', 'wheel', 'touchstart']) window.addEventListener(ev, noteInteraction, { passive: true });

// ---------- status bar ----------
let stT = 0, frames = 0, fpsAcc = 0;
function updateStatus(dt) {
  frames++; fpsAcc += dt; stT -= dt;
  if (stT > 0) return;
  stT = 0.5;
  const fps = frames / Math.max(0.001, fpsAcc); frames = 0; fpsAcc = 0;
  $('stFps').textContent = `${fps.toFixed(0)} fps`;
  $('stTris').textContent = `${(renderer.info.render.triangles / 1e6).toFixed(2)} M tris`;
  const p = camera.position;
  $('stCam').textContent = ws === 'drive' ? '' : `cam ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)} · fov ${camera.fov.toFixed(0)}°`;
  const set = { showroom: 'Showroom set', daylight: 'Daylight set', blueprint: 'Studio grid' }[studio.theme];
  $('stInfo').textContent = ws === 'showroom' ? `${MODES[mode] || ''} · ${set} · ${quality}${fun?.state.engine ? ` · ${Math.round(fun.state.rpm)} rpm` : ''}` : ws === 'engineering' ? `${eng.shading} · ${set} · ${quality}` : '';
}

// ---------- main ----------
async function main() {
  resize();
  window.addEventListener('resize', resize);
  progress(0.02, 'Loading studio lighting…');
  await studio.init();
  syncSets();
  await new Promise((r) => requestAnimationFrame(r));
  // lighter body mesh on phones / low-memory devices (same shape and trim lines, about half the triangles)
  const lowPower = matchMedia('(max-width: 720px)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  car = await buildCar({ onProgress: (p, l) => progress(0.04 + p * 0.92, l), detail: params.get('detail') || (lowPower && !QA ? 'draft' : 'full') });
  scene.add(car.root);
  car.root.updateMatrixWorld(true);
  studio.bakeContactShadow(car.root);
  buildLabels();
  fun = createFun({ car, scene, studio, toast, sound, onSecrets: syncSecrets, onState: syncFun });
  initFunUI();
  progress(0.98, 'Preparing workspaces…');
  const { createEngineering } = await import('./engineering.js');
  eng = createEngineering({ car, scene, camera, controls, canvas, flyTo, toast, renderer });
  syncAllToggles();
  for (const key of (params.get('fun') || '').split(',').filter(Boolean)) fun.set(key, true, true);
  if (params.get('paint')) fun.setPaint(params.get('paint'), true);
  progress(1, 'Ready');
  if (QA) $('loader').remove();
  else setTimeout(() => $('loader').classList.add('done'), 250);
  const v = params.get('view') || 'hero';
  const wsParam = params.get('ws');
  if (params.get('mode')) setMode(params.get('mode'));
  else setView(v, 0);
  if (wsParam && wsParam !== 'showroom') await setWorkspace(wsParam, { silent: true });
  for (const key of (params.get('open') || '').split(',').filter(Boolean)) car.set(key, true, true);
  if (params.has('labels')) { labelsOn = true; showLabels(true); }
  if (params.get('xray')) car.setXray(true);
  if (params.get('shade') && eng) eng.setShading(params.get('shade'));
  if (params.get('ortho')) orthoCam = makeOrtho(params.get('ortho'));
  if (params.get('cam')) {
    const c = params.get('cam').split(',').map(Number), t = (params.get('target') || '0,0.5,0').split(',').map(Number);
    flyTo(c, t, 0, { fov: +(params.get('fov') || 30) });
  }
  window.__qa = {
    ready: true, car, camera, controls, setView, setMode, setWorkspace, flyTo, scene, renderer, studio, fun, sound,
    get eng() { return eng; }, get drive() { return drive; },
    render: () => renderOnce(),
    exportGLB: async () => {
      const { exportGLB } = await import('./exporter.js');
      const buf = await exportGLB(car);
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    pickAt: (px, py) => {
      const r = canvas.getBoundingClientRect();
      ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObject(car.root, true).slice(0, 3).map((h) => `${h.object.name} [${h.object.parent?.name}] @ ${h.point.toArray().map((x) => x.toFixed(3)).join(',')}`);
    },
    // advance animations/tweens deterministically (used by the QA screenshot tool)
    step: (seconds = 3, fps = 30) => { for (let i = 0; i < seconds * fps; i++) advance(1 / fps); },
  };
  if (!QA) renderer.setAnimationLoop(loop);
  else { window.__qa.step(0.1); renderOnce(); }
}

function renderOnce() {
  if (orthoCam) { renderer.render(scene, orthoCam); return; }
  composer.render();
}

function loop() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  if (film) film.uniforms.time.value = (film.uniforms.time.value + 0.37) % 100;
  advance(dt);
  renderOnce();
  updateStatus(dt);
}

function advance(dt) {
  if (tween && ws !== 'drive') {
    tween.t += dt / tween.dur;
    tween.update(Math.min(tween.t, 1));
    if (tween.t >= 1) tween = null;
  }
  if (ws === 'drive') {
    drive?.update(dt);
    if (car) car.update(dt, camera);
    return;
  }
  if (!QA && !idleSpin && !autorotate && !tween && ws === 'showroom' && mode === 'exterior' && performance.now() - lastInput > 45000) {
    idleSpin = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.35;
  }
  controls.update(dt);
  if (car) car.update(dt, camera);
  if (fun) fun.update(dt);
  if (eng) eng.update(dt);
  updateLabels();
}

console.log('%c F-FUTURE %c  Il mito è l’unico sogno che non invecchia mai.', 'background:#c8102e;color:#fff;font-weight:700;letter-spacing:.3em;padding:4px 8px;border-radius:3px', 'color:#888;font-style:italic');
console.log('There are six secrets hidden in this studio. The hints are in the Configure panel under “Secrets”.');

main().catch((err) => {
  console.error(err);
  window.__qaError = String(err && err.stack || err);
  $('loaderStep').textContent = 'Error: ' + err.message;
});
