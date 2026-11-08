// Naturally aspirated 65° V12, mid-mounted longitudinally behind the cockpit.
// Block & sump, two cylinder banks with ribbed red crackle cam covers, 12 coil
// packs, an open carbon airbox in the vee carrying 12 polished velocity stacks
// on individual runners, 6-into-1 exhaust headers per bank, titanium silencer
// feeding the twin outlets, transaxle gearbox, dry-sump tank, alternator and
// belt drive, coolant pipes to the side radiators, engine mounts.
// (No power/displacement figures are implied by this geometry.)
import * as THREE from 'three';
import { mesh, mergeGeometries, rod, tube, lathe, rbox, sweep } from '../core/geo.js';
import { boxUV } from './materials.js';

const BANK = THREE.MathUtils.degToRad(32.5); // half of the 65° vee
const X0 = -0.67, PITCH = 0.104; // first cylinder & bore pitch
const CRANK_Y = 0.30;

export function buildEngine(M) {
  const group = new THREE.Group(); group.name = 'Powertrain';
  const v12 = new THREE.Group(); v12.name = 'V12_Engine';
  group.add(v12);
  const len = 6 * PITCH + 0.08; // block length
  const xc = X0 - 2.5 * PITCH; // block centre x

  // block & sump
  const block = new THREE.Mesh(rbox(len, 0.28, 0.36, 0.04), M.engineBlock); block.position.set(xc, CRANK_Y, 0); block.name = 'EngineBlock';
  const sump = new THREE.Mesh(rbox(len - 0.06, 0.1, 0.3, 0.03), M.aluDark); sump.position.set(xc, CRANK_Y - 0.17, 0); sump.name = 'DrySump';
  v12.add(block, sump);
  // block ribs
  const ribs = [];
  for (let i = 0; i <= 6; i++) { const b = new THREE.BoxGeometry(0.012, 0.22, 0.38); b.translate(X0 + PITCH * 0.5 - i * PITCH, CRANK_Y - 0.02, 0); ribs.push(b); }
  v12.add(mesh(mergeGeometries(ribs), M.engineBlock, 'Block_Ribs'));

  // cylinder banks
  for (const side of [-1, 1]) {
    const bank = new THREE.Group(); bank.name = side > 0 ? 'Bank_R' : 'Bank_L';
    bank.position.set(0, CRANK_Y, 0);
    bank.rotation.x = side * BANK; // tilt outward
    // cylinder barrel section
    const barrel = new THREE.Mesh(rbox(len, 0.22, 0.2, 0.03), M.engineBlock); barrel.position.set(xc, 0.2, 0); barrel.name = 'CylinderBank';
    // cylinder head
    const head = new THREE.Mesh(rbox(len + 0.02, 0.1, 0.24, 0.025), M.aluDark); head.position.set(xc, 0.35, 0); head.name = 'CylinderHead';
    // cam cover (red crackle) with longitudinal ribs and lettering plate
    const cover = new THREE.Mesh(rbox(len, 0.07, 0.21, 0.03), M.engineRed); cover.position.set(xc, 0.43, 0); cover.name = 'CamCover';
    const fins = [];
    for (let k = -2; k <= 2; k++) { const f = new THREE.BoxGeometry(len - 0.08, 0.012, 0.008); f.translate(xc, 0.47, k * 0.035); fins.push(f); }
    const finMesh = mesh(mergeGeometries(fins), M.engineRed, 'CamCover_Ribs');
    const plateM = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.06), M.alu); plateM.position.set(xc - 0.05, 0.472, side * 0.0); plateM.name = 'CamCover_V12Plate';
    // coil packs (6 per bank)
    const coils = [];
    for (let i = 0; i < 6; i++) { const c = new THREE.BoxGeometry(0.05, 0.03, 0.045); c.translate(X0 - i * PITCH, 0.478, side * -0.06); coils.push(c); }
    const coilM = mesh(mergeGeometries(coils), M.engineBlack, 'CoilPacks');
    // cam drive covers at the front of each head
    const camEnd = new THREE.Mesh(rbox(0.05, 0.16, 0.22, 0.03), M.aluDark); camEnd.position.set(X0 + 0.09, 0.36, 0); camEnd.name = 'CamDriveCover';
    bank.add(barrel, head, cover, finMesh, plateM, coilM, camEnd);
    v12.add(bank);

    // exhaust headers: from the outer side of each head, sweeping down and back to a 6-into-1 collector
    const hdr = [];
    const c = Math.cos(BANK), s = Math.sin(BANK);
    for (let i = 0; i < 6; i++) {
      const px = X0 - i * PITCH;
      // port location on the outer face of the head (bank-local: h=0.33, w=0.12 outboard)
      const h = 0.32, w = 0.13;
      const wy = CRANK_Y + h * c - w * s, wz = side * (h * s + w * c);
      const coll = [-1.40, 0.24, side * 0.30];
      const pts = [[px, wy, wz], [px - 0.02, wy - 0.06, wz + side * 0.07], [px - 0.08, wy - 0.18, wz + side * 0.09], [(px + coll[0]) / 2 - 0.05, 0.27, side * 0.33], coll];
      hdr.push(tube(pts, 0.019, 10, 48));
    }
    v12.add(mesh(mergeGeometries(hdr), M.titanium, 'ExhaustHeaders_' + (side > 0 ? 'R' : 'L')));
    // collector & downpipe to the silencer
    v12.add(mesh(tube([[-1.40, 0.24, side * 0.30], [-1.6, 0.26, side * 0.30], [-1.8, 0.36, side * 0.26], [-1.9, 0.46, side * 0.2]], 0.035, 14, 40), M.titanium, 'ExhaustCollector'));
  }

  // airbox in the vee with 12 velocity stacks on individual runners
  const ab = new THREE.Group(); ab.name = 'Intake';
  const tray = new THREE.Mesh(rbox(len + 0.02, 0.05, 0.3, 0.02), M.carbon); tray.position.set(xc, 0.66, 0); tray.name = 'Airbox_Tray';
  boxUV(tray.geometry, 6);
  ab.add(tray);
  const stacks = [], runners = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = X0 - i * PITCH;
      // inner intake port (bank-local h=0.33, w=-0.11 i.e. inboard)
      const c = Math.cos(BANK), s = Math.sin(BANK);
      const h = 0.33, w = -0.10;
      const py = CRANK_Y + h * c - w * s, pz = side * (h * s + w * c);
      const top = [x, 0.70, side * 0.07];
      runners.push(tube([[x, py, pz], [x, py + 0.05, pz - side * 0.02], [x, 0.66, side * 0.07], top], 0.022, 12, 24));
      const st = lathe([[0.022, 0], [0.024, 0.04], [0.03, 0.07], [0.042, 0.088], [0.046, 0.094], [0.04, 0.094]], 28);
      st.rotateX(-Math.PI / 2); // axis Z -> Y
      st.translate(...top);
      stacks.push(st);
    }
  }
  ab.add(mesh(mergeGeometries(runners), M.engineBlack, 'Intake_Runners'));
  ab.add(mesh(mergeGeometries(stacks), M.chrome, 'VelocityStacks'));
  // throttle bodies (ring at the base of each stack)
  const tb = [];
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) { const r = new THREE.TorusGeometry(0.026, 0.006, 8, 20); r.rotateX(Math.PI / 2); r.translate(X0 - i * PITCH, 0.705, side * 0.07); tb.push(r); }
  ab.add(mesh(mergeGeometries(tb), M.alu, 'ThrottleBodies'));
  // fuel rails
  for (const side of [-1, 1]) ab.add(mesh(rod([X0 + 0.04, 0.62, side * 0.13], [X0 - 5 * PITCH - 0.04, 0.62, side * 0.13], 0.008), M.alu, 'FuelRail'));
  v12.add(ab);

  // front accessory drive (faces the cockpit bulkhead)
  const fx = X0 + 0.11;
  const pulleys = [[fx, 0.2, 0, 0.08], [fx, 0.38, 0.16, 0.05], [fx, 0.38, -0.16, 0.05], [fx, 0.52, 0.0, 0.04]];
  const pg = [];
  for (const [x, y, z, r] of pulleys) { const p = new THREE.CylinderGeometry(r, r, 0.03, 32); p.rotateZ(Math.PI / 2); p.translate(x, y, z); pg.push(p); }
  v12.add(mesh(mergeGeometries(pg), M.alu, 'Pulleys'));
  const belt = [];
  for (let i = 0; i <= pulleys.length; i++) { const p = pulleys[i % pulleys.length]; belt.push([fx + 0.0, p[1], p[2]]); }
  v12.add(mesh(tube(belt, 0.008, 6, 60, true), M.engineBlack, 'AccessoryBelt'));
  const alt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 24), M.aluDark); alt.rotation.z = Math.PI / 2; alt.position.set(fx - 0.08, 0.38, 0.16); alt.name = 'Alternator';
  v12.add(alt);

  // transaxle gearbox
  const gb = new THREE.Group(); gb.name = 'Transaxle';
  const case1 = new THREE.Mesh(rbox(0.62, 0.26, 0.32, 0.06), M.aluDark); case1.position.set(-1.62, 0.33, 0); case1.name = 'GearboxCase';
  const diff = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), M.aluDark); diff.position.set(-1.35, 0.33, 0); diff.scale.set(1, 1, 1.3); diff.name = 'Differential';
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.1, 32), M.aluDark); bell.rotation.z = Math.PI / 2; bell.position.set(xc - len / 2 - 0.05, CRANK_Y, 0); bell.name = 'Bellhousing';
  gb.add(case1, diff, bell);
  group.add(gb);

  // silencer and tail pipes to the twin outlets
  const sil = new THREE.Mesh(rbox(0.22, 0.16, 0.6, 0.06), M.titanium); sil.position.set(-1.96, 0.55, 0); sil.name = 'Silencer';
  group.add(sil);
  for (const side of [-1, 1]) {
    group.add(mesh(tube([[-1.9, 0.46, side * 0.2], [-1.95, 0.52, side * 0.18]], 0.035, 12, 10), M.titanium, 'ExhaustPipe'));
    group.add(mesh(tube([[-2.0, 0.62, side * 0.1], [-2.06, 0.72, side * 0.1], [-2.09, 0.737, side * 0.1]], 0.026, 12, 20), M.titanium, 'TailPipe'));
  }
  // dry-sump oil tank & coolant pipes to the side radiators
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 24), M.alu); tank.position.set(-0.62, 0.35, 0.38); tank.name = 'OilTank';
  group.add(tank);
  for (const side of [-1, 1]) {
    group.add(mesh(tube([[-0.5, 0.5, side * 0.12], [-0.55, 0.62, side * 0.4], [-0.78, 0.64, side * 0.6]], 0.02, 10, 30), M.hose, 'CoolantHose'));
  }
  // engine mounts
  for (const side of [-1, 1]) group.add(mesh(rod([xc, 0.22, side * 0.17], [xc, 0.14, side * 0.36], 0.018), M.aluDark, 'EngineMount'));

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group };
}
