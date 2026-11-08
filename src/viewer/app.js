// F-Future interactive studio viewer.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Studio } from './studio.js';
import { buildCar } from '../car/car.js';

const params = new URLSearchParams(location.search);
const QA = params.has('qa');
if (QA && !params.has('ui')) document.body.classList.add('qa');

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QA ? 1 : 2));
renderer.toneMapping = THREE.NeutralToneMapping;
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

const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const studio = new Studio(renderer, scene, { theme });
if (theme === 'dark') document.body.classList.add('dark');

// ---------- post processing ----------
let composer, gtao;
let quality = params.get('quality') || (QA ? 'balanced' : matchMedia('(max-width: 720px)').matches ? 'balanced' : 'high');
function setupComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtao = null;
  if (quality === 'high') {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, rings: 2, samples: 16 });
    composer.addPass(gtao);
  }
  composer.addPass(new OutputPass());
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const qw = params.get('w'), qh = params.get('h');
  const W = qw ? +qw : w, H = qh ? +qh : h;
  renderer.setSize(W, H, !qw);
  camera.aspect = W / H;
  if (camera.userData.ortho) updateOrtho();
  camera.updateProjectionMatrix();
  setupComposer();
  composer.setSize(W, H);
}

// ---------- loader ----------
const loaderFill = document.getElementById('loaderFill');
const loaderStep = document.getElementById('loaderStep');
const progress = (p, label) => { loaderFill.style.width = `${Math.round(p * 100)}%`; if (label) loaderStep.textContent = label; };

let car;
const timer = new THREE.Timer();

// ---------- camera presets ----------
const VIEWS = {
  threeQuarter: { pos: [5.6, 1.55, -4.6], target: [0.1, 0.5, 0] },
  front: { pos: [8.5, 0.62, 0], target: [0, 0.55, 0] },
  side: { pos: [0.15, 0.62, -8.0], target: [0.15, 0.55, 0] },
  rear: { pos: [-8.5, 0.75, 0], target: [0, 0.55, 0] },
  top: { pos: [0.15, 10.5, 0.0001], target: [0.15, 0, 0] },
  rearQuarter: { pos: [-5.4, 1.7, -4.7], target: [-0.2, 0.55, 0] },
  hero: { pos: [4.75, 1.75, -3.55], target: [0.35, 0.45, 0], fov: 32 },
};

let tween = null;
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function flyTo(pos, target, dur = 1.3, opts = {}) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const p1 = new THREE.Vector3(...pos), t1 = new THREE.Vector3(...target);
  const fov0 = camera.fov, fov1 = opts.fov ?? 30;
  if (dur <= 0) { camera.position.copy(p1); controls.target.copy(t1); camera.fov = fov1; camera.updateProjectionMatrix(); controls.update(); return; }
  // arc the path around the car (avoid flying through the body)
  const c0 = new THREE.Vector3(p0.x, 0, p0.z), c1 = new THREE.Vector3(p1.x, 0, p1.z);
  const r0 = c0.length(), r1 = c1.length();
  const a0 = Math.atan2(p0.z, p0.x); let a1 = Math.atan2(p1.z, p1.x);
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
function fitScale() { return Math.max(1, Math.pow(1.4 / camera.aspect, 0.95)); }
function fitPos(pos, target) {
  const k = fitScale();
  return pos.map((p, i) => target[i] + (p - target[i]) * k);
}
function setView(name, dur = 1.3) {
  const v = VIEWS[name];
  if (!v) return;
  flyTo(fitPos(v.pos, v.target), v.target, dur, { fov: v.fov ?? 30 });
}

// orthographic QA camera (for comparison against the orthographic reference sheet)
let orthoCam = null;
function updateOrtho() {}
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

// ---------- modes ----------
const MODES = {
  exterior: { label: 'Exterior showcase' },
  interior: { label: 'Interior cockpit showcase' },
  engine: { label: 'V12 engine inspection' },
  engineering: { label: 'Detailed engineering view' },
};
let mode = 'exterior';
function setMode(m) {
  if (!car) return;
  mode = m;
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  document.getElementById('modeSubtitle').textContent = MODES[m].label;
  controls.minDistance = 1.2; controls.maxDistance = 30;
  controls.enablePan = true;
  car.setXray(m === 'engineering');
  syncToggle('xray', m === 'engineering');
  showLabels(m === 'engineering' || labelsOn);
  if (m === 'exterior') {
    car.set('doorL', false); car.set('doorR', false); car.set('engineCover', false); car.set('hood', false);
    setView('hero', 1.6);
  } else if (m === 'interior') {
    car.set('doorL', true); car.set('doorR', false);
    const eye = car.anchors.driverEye.clone().applyMatrix4(car.root.matrixWorld);
    const look = car.anchors.driverLook.clone().applyMatrix4(car.root.matrixWorld);
    const dir = look.clone().sub(eye).normalize();
    const target = eye.clone().add(dir.multiplyScalar(0.06));
    flyTo(eye.toArray(), target.toArray(), 1.8, { direct: true, fov: 62 });
    controls.minDistance = 0.02; controls.maxDistance = 0.9;
    controls.enablePan = false;
  } else if (m === 'engine') {
    car.set('engineCover', true);
    const f = car.anchors.engine.clone().applyMatrix4(car.root.matrixWorld);
    flyTo(fitPos([f.x - 2.3, f.y + 1.9, f.z - 1.7], f.toArray()), f.toArray(), 1.6, { fov: 34 });
  } else if (m === 'engineering') {
    car.set('engineCover', true); car.set('hood', true); car.set('doorL', true); car.set('doorR', true);
    flyTo(fitPos([4.4, 3.1, -5.0], [0, 0.45, 0]), [0, 0.45, 0], 1.6, { fov: 32 });
  }
  syncAllToggles();
}

// ---------- toggles ----------
let labelsOn = false;
let autorotate = false;
function syncToggle(name, on) { document.querySelectorAll(`[data-toggle="${name}"]`).forEach((b) => b.classList.toggle('on', !!on)); }
function syncAllToggles() {
  if (!car) return;
  syncToggle('doorL', car.get('doorL')); syncToggle('doorR', car.get('doorR'));
  syncToggle('doorsBoth', car.get('doorL') && car.get('doorR'));
  syncToggle('hood', car.get('hood')); syncToggle('engineCover', car.get('engineCover'));
  syncToggle('wing', car.get('wing')); syncToggle('lights', car.lightsOn);
  syncToggle('autorotate', autorotate); syncToggle('labels', labelsOn);
  syncToggle('theme', studio.theme === 'dark'); syncToggle('xray', car.xray);
}
function toggle(name) {
  if (!car) return;
  switch (name) {
    case 'doorL': case 'doorR': case 'hood': case 'engineCover': case 'wing':
      car.toggle(name); toast(`${car.labelOf(name)} ${car.get(name) ? 'opening' : 'closing'}`); break;
    case 'doorsBoth': { const open = !(car.get('doorL') && car.get('doorR')); car.set('doorL', open); car.set('doorR', open); break; }
    case 'lights': car.setLights(!car.lightsOn); break;
    case 'autorotate': autorotate = !autorotate; controls.autoRotate = autorotate; controls.autoRotateSpeed = 0.6; break;
    case 'theme': {
      const t = studio.theme === 'dark' ? 'light' : 'dark';
      studio.setTheme(t); document.body.classList.toggle('dark', t === 'dark');
      studio.bakeContactShadow(car.root);
      break;
    }
    case 'xray': car.setXray(!car.xray); break;
    case 'labels': labelsOn = !labelsOn; showLabels(labelsOn || mode === 'engineering'); break;
  }
  syncAllToggles();
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- design-note labels (annotations from the design sheet) ----------
const labelsEl = document.getElementById('labels');
let notes = [];
function buildLabels() {
  labelsEl.innerHTML = '';
  notes = car.hotspots.map((h) => {
    const el = document.createElement('div');
    el.className = 'note hidden' + (h.left ? ' left' : '');
    el.innerHTML = `<div class="dot" title="${h.title}"></div><div class="card"><b>${h.title}</b><i>${h.subtitle}</i></div>`;
    el.querySelector('.dot').addEventListener('click', () => focusOn(h));
    labelsEl.appendChild(el);
    return { h, el };
  });
}
function showLabels(on) { notes.forEach((n) => n.el.classList.toggle('hidden', !on)); labelsEl.dataset.on = on ? '1' : ''; }
const _v = new THREE.Vector3();
function updateLabels() {
  if (!labelsEl.dataset.on) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const n of notes) {
    _v.copy(n.h.position).applyMatrix4(car.root.matrixWorld);
    const camToP = _v.clone().sub(camera.position);
    _v.project(camera);
    const vis = _v.z < 1 && camToP.dot(camera.getWorldDirection(new THREE.Vector3())) > 0;
    n.el.style.display = vis ? '' : 'none';
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
  if (moved > 6 || performance.now() - downAt[2] > 400) return;
  const hit = pick(e);
  if (hit && hit.action) toggle(hit.action);
});
canvas.addEventListener('dblclick', (e) => {
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
  if (!car || e.buttons) return;
  const hit = pick(e);
  canvas.style.cursor = hit?.action ? 'pointer' : 'grab';
});

// ---------- UI wiring ----------
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { if (mode === 'interior') setMode('exterior'); setView(b.dataset.view); }));
document.getElementById('resetCam').addEventListener('click', () => setMode(mode === 'interior' ? 'exterior' : mode) || setView('hero'));
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle)));
document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
const panel = document.getElementById('panel');
document.getElementById('panelToggle').addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  document.getElementById('panelToggle').setAttribute('aria-expanded', String(!panel.classList.contains('collapsed')));
});
if (matchMedia('(max-width: 720px)').matches) panel.classList.add('collapsed');
const qSel = document.getElementById('quality');
qSel.value = quality;
qSel.addEventListener('change', () => { quality = qSel.value; resize(); });
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const map = { '1': () => setMode('exterior'), '2': () => setMode('interior'), '3': () => setMode('engine'), '4': () => setMode('engineering'), l: () => toggle('doorL'), r: () => toggle('doorR'), h: () => toggle('hood'), e: () => toggle('engineCover'), w: () => toggle('wing'), t: () => toggle('autorotate'), x: () => toggle('xray'), n: () => toggle('labels'), f: () => setView('front'), s: () => setView('side'), b: () => setView('rear'), u: () => setView('top'), q: () => setView('threeQuarter') };
  if (map[k]) map[k]();
});

// ---------- main ----------
async function main() {
  resize();
  window.addEventListener('resize', resize);
  progress(0.02, 'Preparing studio…');
  await new Promise((r) => requestAnimationFrame(r));
  car = await buildCar({ onProgress: progress, detail: params.get('detail') || 'full' });
  scene.add(car.root);
  car.root.updateMatrixWorld(true);
  studio.bakeContactShadow(car.root);
  buildLabels();
  syncAllToggles();
  progress(1, 'Ready');
  if (QA) document.getElementById('loader').remove();
  else setTimeout(() => document.getElementById('loader').classList.add('done'), 250);
  const v = params.get('view') || 'hero';
  if (params.get('mode')) setMode(params.get('mode'));
  else setView(v, 0);
  for (const key of (params.get('open') || '').split(',').filter(Boolean)) car.set(key, true, true);
  if (params.has('labels')) { labelsOn = true; showLabels(true); }
  if (params.get('xray')) car.setXray(true);
  if (params.get('ortho')) orthoCam = makeOrtho(params.get('ortho'));
  if (params.get('cam')) {
    const c = params.get('cam').split(',').map(Number), t = (params.get('target') || '0,0.5,0').split(',').map(Number);
    flyTo(c, t, 0, { fov: +(params.get('fov') || 30) });
  }
  window.__qa = {
    ready: true, car, camera, controls, setView, setMode, flyTo, scene, renderer, studio,
    render: () => renderOnce(),
    // advance animations/tweens deterministically (used by the QA screenshot tool)
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
      return ray.intersectObject(car.root, true).slice(0, 3).map((h) => `${h.object.name} [${h.object.parent?.name}] @ ${h.point.toArray().map((v) => v.toFixed(3)).join(',')}`);
    },
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
  advance(dt);
  renderOnce();
}

function advance(dt) {
  if (tween) {
    tween.t += dt / tween.dur;
    tween.update(Math.min(tween.t, 1));
    if (tween.t >= 1) tween = null;
  }
  controls.update(dt);
  if (car) car.update(dt, camera);
  updateLabels();
}

main().catch((err) => {
  console.error(err);
  window.__qaError = String(err && err.stack || err);
  loaderStep.textContent = 'Error: ' + err.message;
});
