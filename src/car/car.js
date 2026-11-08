// Assembles the complete F-Future: body panels, glass, lights, aero, wheels,
// suspension, chassis, cockpit and the V12, organised in a named hierarchy:
//
// F-Future
// ├─ Body            (shell, glass, lights, intakes, badges)
// ├─ Door_L / Door_R (butterfly pivots → door skin, glass, card, hinges)
// ├─ Bonnet          (pivot → lid, Fluxus vent, underside)
// ├─ EngineCover     (pivot → carbon cover, louvres, V12 window)
// ├─ Aero            (splitter, diffuser, skirts, side blades, active wing)
// ├─ Wheels          (Wheel_FL … each: rim, tyre, disc, caliper, hub)
// ├─ Suspension
// ├─ Chassis         (tub, floor, arch liners, frunk, bulkheads, radiators)
// ├─ Interior        (seats, dashboard, steering wheel, displays, console …)
// └─ Powertrain      (V12, intake, exhausts, gearbox)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createMaterials } from './materials.js';
import { buildBodyPieces } from './body.js';
import { DIMS } from './dims.js';
import { buildWheels } from './wheels.js';
import { buildAero } from './aero.js';
import { buildDetails } from './details.js';
import { buildChassis } from './chassis.js';
import { buildInterior } from './interior.js';
import { buildEngine } from './engine.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const MAT_KEYS = {
  paint: 'paint', carbonRed: 'carbonRed', carbon: 'carbon', carbonMatte: 'carbonMatte', glass: 'glass', glassEngine: 'glass',
  blackGloss: 'blackGloss', blackSatin: 'blackSatin', cavity: 'cavity', lens: 'glassClear', lampBack: 'darkChrome',
  tailInner: 'blackGloss', paintInner: 'paintInner', doorShell: 'blackSatin',
};

export const HINGES = {
  // butterfly door hinge axis: lower point near the A-pillar base, upper point at the top of the A-pillar
  doorR: { a: new THREE.Vector3(0.948, 0.835, 0.72), b: new THREE.Vector3(0.47, 1.075, 0.445), angle: 1.15 },
  hood: { p: new THREE.Vector3(1.405, 0.705, 0), angle: 0.72 },
  engineCover: { p: new THREE.Vector3(-0.52, 1.105, 0), angle: -0.95 },
};

function pivotGroup(name, origin) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.copy(origin);
  const inner = new THREE.Group();
  inner.name = name + '_Geometry';
  inner.position.copy(origin).multiplyScalar(-1);
  pivot.add(inner);
  return { pivot, inner };
}

export async function buildCar({ onProgress = () => {}, detail = 'full' } = {}) {
  const M = createMaterials();
  const root = new THREE.Group();
  root.name = 'F-Future';

  onProgress(0.08, 'Sculpting body shell…');
  await tick();
  const { pieces } = buildBodyPieces({ quality: detail === 'draft' ? 'draft' : 'full' });
  onProgress(0.35, 'Fitting panels, glass and lights…');
  await tick();

  // group pieces by part+material and merge
  const groups = new Map();
  for (const p of pieces) {
    const k = p.part + '|' + p.mat;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p.mesh);
  }
  const body = new THREE.Group(); body.name = 'Body';
  root.add(body);
  const parts = { body };
  const doorR = new THREE.Vector3().subVectors(HINGES.doorR.b, HINGES.doorR.a).normalize();
  const mk = {};
  mk.doorR = pivotGroup('Door_R', HINGES.doorR.a);
  const aL = HINGES.doorR.a.clone(); aL.z *= -1;
  mk.doorL = pivotGroup('Door_L', aL);
  mk.hood = pivotGroup('Bonnet', HINGES.hood.p);
  mk.engineCover = pivotGroup('EngineCover', HINGES.engineCover.p);
  for (const k of Object.keys(mk)) root.add(mk[k].pivot);

  for (const [k, meshes] of groups) {
    const [part, mat] = k.split('|');
    let geo = meshes.length === 1 ? meshes[0].toGeometry() : mergeGeometries(meshes.map((m) => m.toGeometry()));
    const material = M[MAT_KEYS[mat] || mat] || M.paint;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = `${part}_${mat}`;
    mesh.castShadow = !/glass|lens/.test(mat);
    mesh.receiveShadow = true;
    if (part === 'body') body.add(mesh); else mk[part].inner.add(mesh);
  }

  onProgress(0.45, 'Machining wheels and brakes…');
  await tick();
  const wheels = buildWheels(M);
  root.add(wheels.group);

  onProgress(0.55, 'Laying up carbon aero…');
  await tick();
  const aero = buildAero(M);
  root.add(aero.group);
  mk.hood.inner.add(aero.hoodFins);
  mk.engineCover.inner.add(aero.coverSlats);

  const details = buildDetails(M, mk);
  body.add(details.group);

  onProgress(0.62, 'Building chassis and suspension…');
  await tick();
  const chassis = buildChassis(M);
  root.add(chassis.group);

  onProgress(0.72, 'Trimming the cockpit…');
  await tick();
  const interior = buildInterior(M, mk);
  root.add(interior.group);

  onProgress(0.86, 'Assembling the V12…');
  await tick();
  const engine = buildEngine(M);
  root.add(engine.group);

  onProgress(0.95, 'Polishing…');
  await tick();

  // ------------- articulation -------------
  const state = {};
  const art = {};
  const addArt = (name, label, apply, speed = 0.9) => { art[name] = { t: 0, target: 0, label, apply, speed }; state[name] = false; };
  const axisL = doorR.clone(); axisL.z *= -1;
  const qTmp = new THREE.Quaternion();
  addArt('doorR', 'Right door', (e) => { mk.doorR.pivot.quaternion.setFromAxisAngle(doorR, HINGES.doorR.angle * e); });
  addArt('doorL', 'Left door', (e) => { mk.doorL.pivot.quaternion.setFromAxisAngle(axisL, -HINGES.doorR.angle * e); });
  addArt('hood', 'Front bonnet', (e) => { mk.hood.pivot.rotation.z = HINGES.hood.angle * e; });
  addArt('engineCover', 'Engine cover', (e) => { mk.engineCover.pivot.rotation.z = HINGES.engineCover.angle * e; });
  addArt('wing', 'Active wing', (e) => aero.setWing(e), 1.2);

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pickables = [];
  const tagPick = (obj, action) => { obj.userData.action = action; pickables.push(obj); };
  tagPick(mk.doorR.pivot, 'doorR'); tagPick(mk.doorL.pivot, 'doorL');
  tagPick(mk.hood.pivot, 'hood'); tagPick(mk.engineCover.pivot, 'engineCover');
  if (aero.wing) tagPick(aero.wing, 'wing');
  pickables.push(body, wheels.group, aero.group);

  // X-ray (engineering view): make the paint, glass and panels translucent
  const xrayTargets = [];
  root.traverse((o) => { if (o.isMesh && /^(body|door|hood|engineCover)/.test(o.name) && !/lens|lampBack/.test(o.name)) xrayTargets.push(o); });
  const xrayMat = new THREE.MeshPhysicalMaterial({ name: 'XRay', color: 0xb8c6d6, transparent: true, opacity: 0.12, roughness: 0.2, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const xrayEdge = new THREE.MeshBasicMaterial({ color: 0x8a0710, wireframe: true, transparent: true, opacity: 0.05, depthWrite: false });

  const anchors = {
    driverEye: new THREE.Vector3(-0.36, 0.89, -0.37),
    driverLook: new THREE.Vector3(0.9, 0.76, -0.37),
    engine: new THREE.Vector3(-1.2, 0.62, 0),
  };

  const hotspots = [
    { title: 'Ducti Fluxus attivi integrati', subtitle: 'Integrated active flux ducts in the bonnet', position: new THREE.Vector3(1.72, 0.74, 0), view: [1.5, 1.2, -1.2], action: null },
    { title: 'Ala attiva leggendaria tipo F40', subtitle: 'F40-type active rear wing', position: new THREE.Vector3(-1.86, 1.03, 0.5), view: [-1.6, 0.9, -1.8], action: 'wing' },
    { title: 'Scultura aerodinamica ispirata al Testarossa', subtitle: 'Testarossa-inspired side strakes', position: new THREE.Vector3(-0.45, 0.78, -0.93), view: [0.6, 0.4, -2.3] },
    { title: 'Effetto suolo Fontana', subtitle: 'Fontana ground-effect venturi floor', position: new THREE.Vector3(0.1, 0.1, -0.85), view: [0.8, 0.25, -2.6], left: true },
    { title: 'Flusso d’aria attivo', subtitle: 'Active front airflow & splitter', position: new THREE.Vector3(2.35, 0.2, -0.5), view: [1.8, 0.6, -1.4], left: true },
    { title: 'Deportanza variabile', subtitle: 'Variable downforce: diffuser + DRS wing', position: new THREE.Vector3(-2.1, 0.3, 0.4), view: [-2.2, 0.6, 1.2] },
    { title: 'Superficie intelligente', subtitle: 'Smart surface: louvred engine cover', position: new THREE.Vector3(-1.1, 0.98, 0), view: [-1.6, 1.6, -1.3], action: 'engineCover', left: true },
    { title: 'V12 aspirato', subtitle: 'Naturally aspirated V12, 65°', position: new THREE.Vector3(-1.2, 0.72, 0.0), view: [-1.6, 1.4, 1.4], action: 'engineCover' },
    { title: 'Porte a farfalla', subtitle: 'Butterfly doors – click to open', position: new THREE.Vector3(0.35, 0.86, -0.86), view: [1.6, 0.9, -2.4], action: 'doorL' },
  ];

  const lightMats = [M.ledWhite, M.ledRed, M.ambient];
  const lightBase = lightMats.map((m) => m.emissiveIntensity);

  const api = {
    root, parts: mk, materials: M, anchors, hotspots, pickables, xray: false, lightsOn: true,
    labelOf: (n) => art[n]?.label ?? n,
    get: (n) => !!state[n],
    set(n, open, instant = false) {
      if (!art[n]) return;
      state[n] = !!open; art[n].target = open ? 1 : 0;
      if (instant) { art[n].t = art[n].target; art[n].apply(ease(art[n].t)); }
    },
    toggle(n) { api.set(n, !state[n]); },
    applyArticulation(n, e) { art[n]?.apply(e); },
    setLights(on) {
      api.lightsOn = on;
      lightMats.forEach((m, i) => { m.emissiveIntensity = on ? lightBase[i] : 0.0; });
      engine.setLights?.(on);
    },
    setXray(on) {
      api.xray = on;
      for (const o of xrayTargets) {
        if (on) { if (!o.userData.mat0) o.userData.mat0 = o.material; o.material = xrayMat; o.castShadow = false; }
        else if (o.userData.mat0) { o.material = o.userData.mat0; o.castShadow = !/glass|lens/.test(o.name); }
      }
    },
    update(dt) {
      for (const n in art) {
        const a = art[n];
        if (a.t !== a.target) {
          const d = dt * a.speed;
          a.t = a.target > a.t ? Math.min(a.target, a.t + d) : Math.max(a.target, a.t - d);
          a.apply(ease(a.t));
        }
      }
      wheels.update?.(dt);
      interior.update?.(dt);
    },
  };
  // mesh / triangle statistics
  let tris = 0, meshes = 0;
  root.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
  api.stats = { tris: Math.round(tris), meshes };
  onProgress(0.99, 'Ready');
  return api;
}
