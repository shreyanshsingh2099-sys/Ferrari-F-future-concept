// Exterior details: door mirrors (parented to the doors), shield badges, headlight
// internals (LED signature + projector), quad ring tail-lights with the
// full-width LED bar, exhaust tips, single-arm wiper.
import * as THREE from 'three';
import { sweep, plate, mesh, mergeGeometries, tube, rod, lathe } from '../core/geo.js';
import { boxUV } from './materials.js';
import { surfaceZ, surfaceY, surfaceX, surfaceNormal } from './bodyShape.js';
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
  const pts = [[0.74, yb, zb], [0.70, 0.835, zb + 0.05], [0.64, 0.858, zb + 0.10], [0.585, 0.866, zb + 0.13]];
  const stalk = tube(pts.map(([x, y, z]) => [x, y, s * z]), 0.011, 10, 40);
  g.add(mesh(boxUV(stalk), M.carbon, 'Mirror_Stalk'));
  // head: a rounded wedge (teardrop in plan), carbon cap, glass facing rearward
  const hx = 0.555, hy = 0.866, hz = zb + 0.17;
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
  const upper = [[0.585, 0.478], [0.66, 0.508], [0.76, 0.548], [0.84, 0.573], [0.895, 0.585]];
  for (const s of [-1, 1]) {
    const drl = [];
    for (const [z, y] of upper) {
      const x = surfaceX(y - 0.012, s * z, 1);
      if (x == null) continue;
      drl.push([x - 0.022, y - 0.014, s * (z - 0.004)]);
    }
    if (drl.length > 2) g.add(mesh(tube(drl, 0.0045, 8, 40), M.ledWhite, 'DRL_' + (s > 0 ? 'R' : 'L'), { cast: false }));
    // projector module at the inner end
    const px = (surfaceX(0.465, s * 0.64, 1) ?? 2.25) - 0.04;
    const proj = new THREE.Group(); proj.name = 'Projector';
    const bezel = new THREE.Mesh(lathe([[0.0, 0.0], [0.024, 0.0], [0.03, 0.01], [0.032, 0.025], [0.0, 0.025]], 24), M.lampChrome);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.019, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glassClear);
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.02;
    proj.add(bezel, lens);
    proj.rotation.y = Math.PI / 2; // face +x
    proj.position.set(px, 0.465, s * 0.645);
    g.add(proj);
    const proj2 = proj.clone(); proj2.position.set((surfaceX(0.50, s * 0.73, 1) ?? 2.2) - 0.04, 0.5, s * 0.735); proj2.scale.setScalar(0.8);
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
    const t = new THREE.TorusGeometry(0.058, 0.0065, 10, 64);
    const o = new THREE.Object3D();
    o.position.set(x - 0.004, y, z);
    orientToNormal(o, n);
    o.updateMatrix();
    t.applyMatrix4(o.matrix);
    rings.push(t);
    const d = new THREE.CircleGeometry(0.05, 40);
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
    bar.push([x - (near < 0.065 ? 0.012 : 0.002), y, z]);
  }
  g.add(mesh(tube(bar, 0.0032, 6, 120), M.ledRed, 'TailLight_Bar', { cast: false }));
  return g;
}

function exhaust(M) {
  const g = new THREE.Group(); g.name = 'ExhaustTips';
  for (const sg of [-1, 1]) {
    const zc = sg * 0.1, y = 0.737;
    const x = (surfaceX(y, zc, -1) ?? -2.11) + 0.055;
    // oval titanium outlet: tube profile scaled to an ellipse
    const shape = new THREE.Shape(); shape.absellipse(0, 0, 0.075, 0.019, 0, Math.PI * 2);
    const hole = new THREE.Path(); hole.absellipse(0, 0, 0.068, 0.0135, 0, Math.PI * 2); shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 32 });
    const tip = new THREE.Mesh(geo, M.titanium);
    tip.rotation.y = -Math.PI / 2; // extrude along -x (rearward)
    tip.position.set(x, y, zc);
    tip.name = 'ExhaustTip';
    const inner = new THREE.Mesh(new THREE.CircleGeometry(1, 24), M.cavity);
    inner.scale.set(0.07, 0.015, 1); inner.rotation.y = -Math.PI / 2; inner.position.set(x - 0.005, y, zc);
    g.add(tip, inner);
  }
  return g;
}

function wiper(M) {
  const g = new THREE.Group(); g.name = 'Wiper';
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const z = -0.42 + 0.84 * (i / 10);
    const x = 1.24 - 0.02 * Math.cos((i / 10) * Math.PI);
    const y = (surfaceY(x, z) ?? 0.76) + 0.008;
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
  group.add(headlights(M), taillights(M), exhaust(M), wiper(M));
  // mirrors ride on the doors
  mk.doorR.inner.add(mirror(M, 1));
  mk.doorL.inner.add(mirror(M, -1));
  group.traverse((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
  return { group };
}
