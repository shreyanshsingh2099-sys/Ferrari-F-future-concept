// Exterior details: door mirrors (parented to the doors), shield badges, headlight
// internals (LED signature + projector), quad ring tail-lights with the
// full-width LED bar, exhaust tips, single-arm wiper.
import * as THREE from 'three';
import { sweep, plate, mesh, mergeGeometries, tube, rod, lathe } from '../core/geo.js';
import { boxUV } from './materials.js';
import { surfaceZ, surfaceY, surfaceX, surfaceNormal, SCOOP } from './bodyShape.js';
import { MeshData } from '../core/mesh.js';
import { polygonSDF } from '../core/sdf2d.js';
import { smoothPolygon } from '../core/sdf2d.js';

function orientToNormal(obj, n) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...n));
  obj.quaternion.copy(q);
}

function shieldShape(w = 0.05, h = 0.065) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, h / 2); s.lineTo(w / 2, h / 2); s.lineTo(w / 2, -h * 0.05);
  s.quadraticCurveTo(w / 2, -h * 0.38, 0, -h / 2); s.quadraticCurveTo(-w / 2, -h * 0.38, -w / 2, -h * 0.05); s.closePath();
  return s;
}

/** Yellow heraldic shield with tricolore and a stylised "F" mark (no third-party logo artwork). */
function shieldBadge(M, scale = 1) {
  const g = new THREE.Group(); g.name = 'Badge_Shield';
  const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shieldShape(0.05 * scale, 0.065 * scale), { depth: 0.002, bevelEnabled: true, bevelSize: 0.0012, bevelThickness: 0.001, bevelSegments: 2 }), M.yellow);
  g.add(base);
  const stripeW = 0.05 * scale / 3, sy = 0.065 * scale / 2 - 0.004 * scale;
  [M.tricolorG, M.tricolorW, M.tricolorR].forEach((m, i) => {
    const st = new THREE.Mesh(new THREE.PlaneGeometry(stripeW, 0.006 * scale), m);
    st.position.set(-0.05 * scale / 2 + stripeW * (i + 0.5), sy, 0.0032);
    g.add(st);
  });
  // stylised F monogram
  const f = new THREE.Shape();
  const u = 0.0045 * scale;
  f.moveTo(-2 * u, -4 * u); f.lineTo(-0.6 * u, -4 * u); f.lineTo(-0.6 * u, -0.6 * u); f.lineTo(1.6 * u, -0.6 * u); f.lineTo(1.6 * u, 0.7 * u);
  f.lineTo(-0.6 * u, 0.7 * u); f.lineTo(-0.6 * u, 2.4 * u); f.lineTo(2.4 * u, 2.4 * u); f.lineTo(2.4 * u, 3.7 * u); f.lineTo(-2 * u, 3.7 * u); f.closePath();
  const fm = new THREE.Mesh(new THREE.ShapeGeometry(f), M.badgeBlack);
  fm.position.set(0, -0.006 * scale, 0.0033);
  g.add(fm);
  return g;
}

function placeOnSurface(obj, x, y, z, lift = 0.0015) {
  const n = surfaceNormal(x, y, z);
  obj.position.set(x + n[0] * lift, y + n[1] * lift, z + n[2] * lift);
  // keep the badge upright: build basis with normal as +Z and world up projected as +Y
  const N = new THREE.Vector3(...n);
  const up = new THREE.Vector3(0, 1, 0).sub(N.clone().multiplyScalar(N.y)).normalize();
  const X = new THREE.Vector3().crossVectors(up, N).normalize();
  const m = new THREE.Matrix4().makeBasis(X, up, N);
  obj.quaternion.setFromRotationMatrix(m);
  return obj;
}

function mirror(M, s) {
  const g = new THREE.Group(); g.name = s > 0 ? 'Mirror_R' : 'Mirror_L';
  // base on the door shoulder, stalk sweeping up/out/back, head housing
  const yb = 0.80;
  const zb = (surfaceZ(0.74, yb) ?? 0.82) - 0.004;
  const pts = [[0.74, yb, zb], [0.70, 0.825, zb + 0.05], [0.64, 0.842, zb + 0.10], [0.585, 0.848, zb + 0.13]];
  const stalk = tube(pts.map(([x, y, z]) => [x, y, s * z]), 0.011, 10, 40);
  g.add(mesh(boxUV(stalk), M.carbon, 'Mirror_Stalk'));
  // head: a rounded wedge (teardrop in plan), carbon cap, glass facing rearward
  const hx = 0.555, hy = 0.848, hz = zb + 0.17;
  const head = new THREE.Group(); head.name = 'Mirror_Head';
  const sec = (t) => {
    // t along local z (inboard -> outboard)
    const w = 0.21 * (1 - 0.25 * t * t), h = 0.085 * (1 - 0.35 * t * t);
    const pts2 = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // teardrop: blunt rear (+x local = rear), rounded nose
      const cx = Math.cos(a), cy = Math.sin(a);
      const px = cx > 0 ? cx * w * 0.32 : cx * w * 0.68;
      pts2.push([px, cy * h / 2, (t - 0.5) * 0.15]);
    }
    return pts2;
  };
  const shell = sweep(sec, 10, { closed: true, caps: true, smoothAcross: true });
  head.add(mesh(boxUV(shell), M.carbon, 'Mirror_Cap'));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.06), M.chrome);
  glass.position.set(0.069, 0, 0); glass.rotation.y = Math.PI / 2; glass.name = 'Mirror_Glass';
  head.add(glass);
  // head local: +x rearward (toward -world x)
  head.rotation.y = Math.PI;
  head.position.set(hx, hy, s * hz);
  if (s < 0) head.scale.z = -1;
  g.add(head);
  return g;
}

function headlights(M) {
  const g = new THREE.Group(); g.name = 'Headlights';
  // polyline along the upper edge of the lamp (front-view coords |z|, y)
  // LED brow along the upper edge of the sabre: front part (front-view |z|, y), then the
  // tail running back along the fender (side-view x, y)
  const upper = [[0.655, 0.474], [0.73, 0.536], [0.80, 0.585], [0.86, 0.628], [0.905, 0.652]];
  const tailUpper = [[1.97, 0.633], [1.88, 0.645], [1.78, 0.655], [1.68, 0.663]];
  for (const s of [-1, 1]) {
    const drl = [];
    for (const [z, y] of upper) {
      const x = surfaceX(y, s * z, 1);
      if (x == null) continue;
      drl.push([x - 0.02, y - 0.006, s * (z - 0.004)]);
    }
    for (const [x, y] of tailUpper) {
      const z = surfaceZ(x, y);
      if (z == null) continue;
      drl.push([x, y - 0.006, s * (z - 0.02)]);
    }
    if (drl.length > 2) g.add(mesh(tube(drl, 0.0065, 8, 40), M.ledWhite, 'DRL_' + (s > 0 ? 'R' : 'L'), { cast: false }));
    // projector module at the inner end
    const px = (surfaceX(0.49, s * 0.72, 1) ?? 2.25) - 0.03;
    const proj = new THREE.Group(); proj.name = 'Projector';
    const bezel = new THREE.Mesh(lathe([[0.0, 0.0], [0.024, 0.0], [0.03, 0.01], [0.032, 0.025], [0.0, 0.025]], 24), M.lampChrome);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.019, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glassClear);
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.02;
    proj.add(bezel, lens);
    proj.rotation.y = Math.PI / 2; // face +x
    proj.position.set(px, 0.49, s * 0.72); proj.scale.setScalar(0.8);
    g.add(proj);
    const proj2 = proj.clone(); proj2.position.set((surfaceX(0.552, s * 0.81, 1) ?? 2.2) - 0.03, 0.552, s * 0.81); proj2.scale.setScalar(0.72);
    g.add(proj2);
  }
  return g;
}

function taillights(M) {
  const g = new THREE.Group(); g.name = 'TailLights';
  const rings = [];
  const inner = [];
  for (const s of [-1, 1]) for (const zc of [0.548, 0.738]) {
    const z = s * zc, y = 0.688;
    const x = (surfaceX(y, z, -1) ?? -2.1) + 0.012;
    const n = surfaceNormal(x - 0.012, y, z);
    const t = new THREE.TorusGeometry(0.064, 0.007, 10, 64);
    const o = new THREE.Object3D();
    o.position.set(x - 0.004, y, z);
    orientToNormal(o, n);
    o.updateMatrix();
    t.applyMatrix4(o.matrix);
    rings.push(t);
    const d = new THREE.CircleGeometry(0.056, 40);
    const o2 = o.clone(); o2.position.set(x + 0.008, y, z); o2.updateMatrix();
    d.applyMatrix4(o2.matrix);
    inner.push(d);
  }
  g.add(mesh(mergeGeometries(rings), M.ledRed, 'TailLight_Rings', { cast: false }));
  g.add(mesh(mergeGeometries(inner), M.ledRedDim, 'TailLight_Inner', { cast: false }));
  // full-width LED bar
  const bar = [];
  for (let z = -0.77; z <= 0.7701; z += 0.035) {
    const y = 0.688;
    const near = Math.min(Math.abs(Math.abs(z) - 0.548), Math.abs(Math.abs(z) - 0.738));
    const x = surfaceX(y, z, -1) ?? -2.1;
    // inside the goggles it sits behind the ring faces, between them it lies on the paint
    bar.push([x - (near < 0.065 ? 0.012 : Math.abs(z) < 0.47 ? -0.0015 : 0.002), y, z]);
  }
  g.add(mesh(tube(bar, 0.0032, 6, 120), M.ledRed, 'TailLight_Bar', { cast: false }));
  return g;
}

function exhaust(M) {
  const g = new THREE.Group(); g.name = 'ExhaustTips';
  for (const sg of [-1, 1]) {
    // round titanium tips low in the centre section of the diffuser (rear diffuser detail)
    const zc = sg * 0.16, y = 0.215;
    const x = -2.075;
    // oval titanium sleeve (open lathe scaled to an ellipse), dark core
    const sleeve = new THREE.Mesh(lathe([[0.03, -0.05], [0.031, -0.004], [0.033, 0.0], [0.03, 0.003], [0.027, -0.002], [0.026, -0.05]], 40), M.titanium);
    sleeve.scale.set(1, 1, 1);
    const holder = new THREE.Group();
    holder.add(sleeve);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.026, 32), M.cavity); core.position.z = -0.03;
    holder.add(core);
    holder.rotation.y = -Math.PI / 2; // local +z -> world -x (rearward)
    holder.scale.set(1.35, 1.35, 1);
    holder.position.set(x, y, zc);
    holder.name = 'ExhaustTip_' + (sg > 0 ? 'R' : 'L');
    g.add(holder);
  }
  return g;
}

/**
 * Dark inlay that follows the body side exactly: a fine grid over a side-view (x, y) region,
 * projected onto the outer surface along z, lifted 1.5 mm and clipped exactly to the region.
 */
function sideInlay(region, bounds, step = 0.006) {
  const [x0, x1, y0, y1] = bounds;
  const nx = Math.ceil((x1 - x0) / step), ny = Math.ceil((y1 - y0) / step);
  const m = new MeshData();
  const ids = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / ny;
      const z = surfaceZ(x, y);
      if (z == null) { row.push(-1); continue; }
      const n = surfaceNormal(x, y, z);
      row.push(m.addVertex(x + n[0] * 0.0015, y + n[1] * 0.0015, z + n[2] * 0.0015, n[0], n[1], n[2], x * 4, y * 4));
    }
    ids.push(row);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    const zs = [a, b, c, d].map((v) => m.pos[3 * v + 2]);
    if (Math.max(...zs) - Math.min(...zs) > 0.05) continue; // projection jumped between surfaces
    m.addTri(a, b, c); m.addTri(b, d, c); // outward (+z) facing for the right side
  }
  // exact clip: inside the side-view region and only on side-facing surface (smooth boundary)
  const clipped = m.keep((x, y, z) => Math.max(region(x, y), (0.12 - Math.abs(surfaceNormal(x, y, z)[2])) * 0.2));
  return [clipped, clipped.mirrorZ()];
}

/** Companion inlay projected from above (covers the upward-facing part of a side-view region). */
function topInlay(regionXY, bounds, step = 0.006) {
  const [x0, x1, z0, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const m = new MeshData();
  const ids = [];
  for (let j = 0; j <= nz; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      const y = surfaceY(x, z);
      if (y == null) { row.push(-1); continue; }
      const n = surfaceNormal(x, y, z);
      row.push(m.addVertex(x + n[0] * 0.0018, y + n[1] * 0.0018, z + n[2] * 0.0018, n[0], n[1], n[2], x * 4, z * 4));
    }
    ids.push(row);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    const ys = [a, b, c, d].map((v) => m.pos[3 * v + 1]);
    if (Math.max(...ys) - Math.min(...ys) > 0.05) continue;
    m.addTri(a, c, b); m.addTri(b, c, d); // upward facing (x right-handed with +z toward the viewer's bottom)
  }
  const clipped = m.keep((x, y, z) => Math.max(regionXY(x, y), (0.12 - surfaceNormal(x, y, z)[1]) * 0.2));
  return [clipped, clipped.mirrorZ()];
}

function sideInlays(M) {
  const g = new THREE.Group(); g.name = 'SideInlays';
  // Testarossa scoop: dark recess narrowing to a point at the front (blades in aero.js)
  const scoopRegion = (x, y) => {
    const t = Math.min(1, Math.max(0, (x - SCOOP.tip) / (SCOOP.end - SCOOP.tip)));
    return Math.max(Math.abs(y - SCOOP.y(t)) - SCOOP.h(t), x - SCOOP.tip, SCOOP.end - x);
  };
  // flying-buttress void behind the door window
  const voidPoly = polygonSDF(smoothPolygon([[-0.335, 1.05], [-0.36, 0.90], [-0.385, 0.785], [-0.62, 0.785], [-0.84, 0.80], [-0.72, 0.875], [-0.55, 0.965]], 4));
  for (const [name, region, bounds] of [
    ['ScoopRecess', scoopRegion, [SCOOP.end - 0.01, SCOOP.tip + 0.01, 0.56, 0.84]],
    ['ButtressVoid', voidPoly, [-0.88, -0.32, 0.76, 1.08]],
  ]) {
    const [r, l] = sideInlay(region, bounds);
    const both = r.clone().append(l);
    if (name === 'ButtressVoid') {
      const [tr, tl] = topInlay(region, [bounds[0], bounds[1], 0.5, 1.02]);
      both.append(tr).append(tl);
    }
    g.add(mesh(both.toGeometry(), M.cavity, name, { cast: false }));
  }
  return g;
}

function wiper(M) {
  const g = new THREE.Group(); g.name = 'Wiper';
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const z = -0.42 + 0.84 * (i / 10);
    const x = 1.24 - 0.02 * Math.cos((i / 10) * Math.PI);
    const y = (surfaceY(x, z) ?? 0.76) + 0.003;
    pts.push([x, y, z]);
  }
  g.add(mesh(tube(pts, 0.005, 6, 40), M.blackSatin, 'Wiper_Blade'));
  return g;
}

export function buildDetails(M, mk) {
  const group = new THREE.Group(); group.name = 'Details';
  // badges
  for (const s of [-1, 1]) {
    const x = 0.985, y = 0.705;
    const z = s * (surfaceZ(x, y) ?? 0.95);
    const b = placeOnSurface(shieldBadge(M, 1), x, y, z, 0.001);
    b.name = 'Badge_Fender_' + (s > 0 ? 'R' : 'L');
    group.add(b);
  }
  {
    const y = 0.405, z = 0;
    const x = surfaceX(y, z, 1) ?? 2.43;
    const b = placeOnSurface(shieldBadge(M, 0.62), x, y, z, 0.001); b.name = 'Badge_Nose';
    group.add(b);
    const yr = 0.55, xr = surfaceX(yr, 0, -1) ?? -2.12;
    const r = placeOnSurface(shieldBadge(M, 0.55), xr, yr, 0, 0.001); r.name = 'Badge_Tail';
    r.traverse((o) => { if (o.isMesh && o.material === M.yellow) o.material = M.chrome; });
    group.add(r);
  }
  group.add(headlights(M), taillights(M), exhaust(M), wiper(M), sideInlays(M));
  // mirrors ride on the doors
  mk.doorR.inner.add(mirror(M, 1));
  mk.doorL.inner.add(mirror(M, -1));
  group.traverse((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
  return { group };
}
