// Chassis & running gear: wheel-arch liners, Fontana venturi underfloor, frunk
// tub, engine bay with heat shields, side radiators fed by the scoops, and
// double-wishbone pushrod suspension with inboard coil-over dampers.
import * as THREE from 'three';
import { mesh, mergeGeometries, rod, grid, plate, tube, lathe } from '../core/geo.js';
import { boxUV } from './materials.js';
import { DIMS } from './dims.js';
import { OUTLINES } from './body.js';
import { surfaceZ, surfaceY } from './bodyShape.js';
import { smoothPolygon } from '../core/sdf2d.js';

function archLiner(M, arch, track, width) {
  const g = new THREE.Group();
  const floor = 0.105;
  const R = arch.r + 0.004;
  const th0 = Math.asin(Math.max(-1, Math.min(1, (floor - arch.y) / R)));
  const th1 = Math.PI - th0;
  const zIn = track / 2 - width / 2 - 0.07;
  for (const s of [-1, 1]) {
    const shell = grid((u, v) => {
      const th = th0 + (th1 - th0) * u;
      const x = arch.x + Math.cos(th) * R, y = arch.y + Math.sin(th) * R;
      const zo = (surfaceZ(x, y) ?? 0.95) - 0.012;
      const z = zIn + (zo - zIn) * v;
      // stay under the body skin (the bonnet valley is lower than the arch top inboard)
      const cap = (surfaceY(x, z) ?? 2) - 0.02;
      return [x, Math.min(y, cap), s * z];
    }, 48, 4);
    g.add(mesh(shell, M.liner, 'ArchLiner_Shell', { cast: false }));
    // inner wall (disc sector)
    const wall = grid((u, v) => {
      const th = th0 + (th1 - th0) * u;
      const r = R * v;
      const x = arch.x + Math.cos(th) * r;
      const cap = (surfaceY(x, zIn) ?? 2) - 0.02;
      return [x, Math.min(Math.max(floor, arch.y + Math.sin(th) * r), cap), s * zIn];
    }, 48, 3);
    g.add(mesh(wall, M.liner, 'ArchLiner_Wall', { cast: false }));
  }
  return g;
}

function underfloor(M) {
  const g = new THREE.Group(); g.name = 'Underfloor_Fontana';
  const fins = [];
  for (const z of [-0.62, -0.32, 0.32, 0.62]) {
    const outline = [[0.6, 0.097], [-1.68, 0.097], [-1.68, 0.078], [-1.2, 0.072], [0.4, 0.072], [0.6, 0.09]];
    fins.push(plate(outline, 0.006, 'xy', z));
  }
  g.add(mesh(boxUV(mergeGeometries(fins)), M.carbonMatte, 'Venturi_Strakes'));
  // flat carbon floor panel between the arches (slightly below the body floor)
  const fl = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.006, 1.5), M.underbody);
  fl.position.set(-0.05, 0.093, 0); fl.name = 'Floor_Panel';
  g.add(fl);
  return g;
}

function loftOutline(outline, yTop, yBot, shrinkBot, closeBottom = true) {
  const poly = smoothPolygon(outline, 3);
  // centroid
  let cx = 0, cz = 0; for (const [x, z] of poly) { cx += x; cz += z; } cx /= poly.length; cz /= poly.length;
  const geo = grid((u, v) => {
    const i = Math.min(poly.length - 1, Math.floor(u * poly.length));
    const f = u * poly.length - i;
    const a = poly[i % poly.length], b = poly[(i + 1) % poly.length];
    const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
    const sh = 1 - shrinkBot * v;
    const yt = typeof yTop === 'function' ? yTop(x, z) : yTop;
    return [cx + (x - cx) * sh, yt + (yBot - yt) * v, cz + (z - cz) * sh];
  }, poly.length * 2, 6);
  const parts = [geo];
  if (closeBottom) {
    const pts = poly.map(([x, z]) => [cx + (x - cx) * (1 - shrinkBot), yBot, cz + (z - cz) * (1 - shrinkBot)]);
    const pos = [cx, yBot, cz]; const idx = [];
    for (const p of pts) pos.push(...p);
    for (let i = 0; i < pts.length; i++) idx.push(0, 1 + ((i + 1) % pts.length), 1 + i);
    const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); b.setIndex(idx); b.computeVertexNormals();
    b.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    parts.push(b);
  }
  return mergeGeometries(parts.map((p) => p.index ? p : p));
}

function frunk(M) {
  const g = new THREE.Group(); g.name = 'Frunk';
  const outline = OUTLINES.hood.map(([x, z]) => [x - 0.0, z * 0.94]);
  const geo = loftOutline(outline.map(([x, z]) => [Math.min(x, 2.22), z]), (x, z) => (surfaceY(x, z) ?? 0.7) - 0.075, 0.36, 0.18);
  const mat = M.blackSatin.clone(); mat.side = THREE.DoubleSide; mat.name = 'Frunk_Felt'; mat.roughness = 0.95;
  g.add(mesh(geo, mat, 'Frunk_Tub', { cast: false }));
  // reservoir caps & strut brace visible when open
  const brace = rod([1.98, 0.5, -0.5], [1.98, 0.5, 0.5], 0.018, 12);
  g.add(mesh(brace, M.alu, 'Front_StrutBrace'));
  for (const [x, z, c] of [[1.62, 0.33, M.yellow], [1.62, -0.3, M.blackGloss]]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 24), c);
    cap.position.set(x, 0.4, z); cap.name = 'Reservoir_Cap';
    g.add(cap);
  }
  return g;
}

function engineBay(M) {
  const g = new THREE.Group(); g.name = 'EngineBay';
  const outline = OUTLINES.engineCover.map(([x, z]) => [x, z * 0.97]);
  const mat = M.blackSatin.clone(); mat.side = THREE.DoubleSide; mat.name = 'EngineBay_Panels';
  const geo = loftOutline(outline, (x, z) => (surfaceY(x, z) ?? 0.9) - 0.07, 0.17, -0.25, false);
  g.add(mesh(geo, mat, 'EngineBay_Walls', { cast: false }));
  // gold heat shields on the bay sides
  for (const s of [-1, 1]) {
    const hs = grid((u, v) => [-0.75 - 1.0 * u, 0.25 + 0.4 * v, s * (0.52 + 0.04 * v)], 12, 4);
    g.add(mesh(hs, M.heatShield, 'HeatShield', { cast: false }));
  }
  // side radiators behind the scoop openings
  for (const s of [-1, 1]) {
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.38), M.coolant);
    core.position.set(-0.86, 0.62, s * 0.66); core.rotation.y = s * 0.55; core.rotation.z = 0.1; core.name = 'SideRadiator';
    g.add(core);
  }
  // rear crash structure / gearbox mount beam
  g.add(mesh(rod([-1.98, 0.36, -0.42], [-1.98, 0.36, 0.42], 0.03, 12), M.aluDark, 'Rear_Crossmember'));
  return g;
}

function corner(M, x, side, front) {
  const g = new THREE.Group(); g.name = (front ? 'Susp_F' : 'Susp_R') + (side > 0 ? 'R' : 'L');
  const spec = front ? DIMS.front : DIMS.rear;
  const wz = side * (spec.track / 2 - 0.1);
  const cy = spec.r;
  const geos = [], springs = [];
  const arm = (outer, inA, inB, r = 0.012) => { geos.push(rod(outer, inA, r, 10), rod(outer, inB, r, 10)); };
  const lo = [x, cy - 0.17, wz - side * 0.02], up = [x - 0.02, cy + 0.17, wz - side * 0.05];
  arm(lo, [x + 0.22, 0.14, side * 0.36], [x - 0.2, 0.14, side * 0.36]);
  arm(up, [x + 0.16, cy + 0.2, side * 0.44], [x - 0.16, cy + 0.2, side * 0.44], 0.01);
  // pushrod to rocker
  const rocker = [x, cy + 0.28, side * 0.36];
  geos.push(rod([x, cy - 0.15, wz - side * 0.08], rocker, 0.009, 8));
  // coil-over lying inboard
  const dEnd = [x + (front ? -0.05 : 0.05), cy + 0.30, side * 0.08];
  const damper = rod(rocker, dEnd, 0.018, 14);
  geos.push(rod(rocker, [x, cy + 0.33, side * 0.4], 0.012, 8));
  const coil = [];
  const A = new THREE.Vector3(...rocker), B = new THREE.Vector3(...dEnd);
  const L = A.distanceTo(B);
  const dir = B.clone().sub(A).normalize();
  const n1 = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), n2 = dir.clone().cross(n1);
  for (let i = 0; i <= 120; i++) {
    const t = 0.15 + 0.7 * (i / 120), a = i * 0.55;
    const p = A.clone().addScaledVector(dir, t * L).addScaledVector(n1, Math.cos(a) * 0.036).addScaledVector(n2, Math.sin(a) * 0.036);
    coil.push(p.toArray());
  }
  springs.push(tube(coil, 0.006, 6, 240));
  g.add(mesh(mergeGeometries(geos), M.blackSatin, 'Wishbones'));
  g.add(mesh(damper, M.damper, 'Damper'));
  g.add(mesh(mergeGeometries(springs), M.spring, 'Spring'));
  if (front) g.add(mesh(rod([x + 0.12, cy - 0.02, wz - side * 0.06], [x + 0.14, cy - 0.04, side * 0.3], 0.008, 8), M.alu, 'TieRod'));
  else g.add(mesh(rod([x, cy, wz - side * 0.06], [x + 0.02, cy - 0.02, side * 0.12], 0.025, 12), M.aluDark, 'Driveshaft'));
  return g;
}

export function buildChassis(M) {
  const group = new THREE.Group(); group.name = 'Chassis';
  const liners = new THREE.Group(); liners.name = 'ArchLiners';
  liners.add(archLiner(M, DIMS.archF, DIMS.front.track, DIMS.front.width));
  liners.add(archLiner(M, DIMS.archR, DIMS.rear.track, DIMS.rear.width));
  group.add(liners, underfloor(M), frunk(M), engineBay(M));
  const susp = new THREE.Group(); susp.name = 'Suspension';
  for (const s of [-1, 1]) { susp.add(corner(M, DIMS.XF, s, true)); susp.add(corner(M, DIMS.XR, s, false)); }
  // steering rack
  susp.add(mesh(rod([DIMS.XF + 0.14, 0.31, -0.32], [DIMS.XF + 0.14, 0.31, 0.32], 0.022, 14), M.aluDark, 'SteeringRack'));
  // front & rear anti-roll bars
  susp.add(mesh(rod([DIMS.XF - 0.05, 0.66, -0.36], [DIMS.XF - 0.05, 0.66, 0.36], 0.011, 10), M.blackSatin, 'AntiRollBar_F'));
  susp.add(mesh(rod([DIMS.XR + 0.05, 0.64, -0.36], [DIMS.XR + 0.05, 0.64, 0.36], 0.011, 10), M.blackSatin, 'AntiRollBar_R'));
  group.add(susp);
  return { group };
}
