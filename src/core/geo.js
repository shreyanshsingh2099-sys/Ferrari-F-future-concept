// Geometry helpers for hard-surface components.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/** Revolve a (radius, axial) profile around the local Z axis. */
export function lathe(profile, segments = 64, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, h]) => new THREE.Vector2(Math.max(r, 0), h));
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  g.rotateX(Math.PI / 2);
  return g;
}

/**
 * Sweep a cross-section along a parameter. section(s) -> array of [x,y,z].
 * Each edge of the section becomes its own strip (sharp creases across, smooth along).
 */
export function sweep(section, steps, { closed = true, caps = false, smoothAcross = false } = {}) {
  const secs = [];
  for (let i = 0; i <= steps; i++) secs.push(section(i / steps));
  const n = secs[0].length;
  const pos = [], idx = [];
  if (smoothAcross) {
    for (let i = 0; i <= steps; i++) for (let k = 0; k < n; k++) pos.push(...secs[i][k]);
    const edges = closed ? n : n - 1;
    for (let i = 0; i < steps; i++) for (let k = 0; k < edges; k++) {
      const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + k, d = (i + 1) * n + ((k + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  } else {
    const edges = closed ? n : n - 1;
    for (let e = 0; e < edges; e++) {
      const a = e, b = (e + 1) % n;
      const base = pos.length / 3;
      for (let i = 0; i <= steps; i++) pos.push(...secs[i][a], ...secs[i][b]);
      for (let i = 0; i < steps; i++) { const p = base + i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (caps) g = mergeGeometries([g, fan(secs[0], true), fan(secs[steps], false)]);
  return g;
}

/** Fan-triangulate a (roughly convex, planar) polygon of 3D points. */
export function fan(points, flip = false) {
  const pos = [], idx = [];
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const n = points.length;
  pos.push(cx / n, cy / n, cz / n);
  for (const p of points) pos.push(...p);
  for (let i = 0; i < n; i++) { const a = 1 + i, b = 1 + ((i + 1) % n); flip ? idx.push(0, b, a) : idx.push(0, a, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat plate from a 2D outline in a plane: plane 'xy' (extrude along z), 'xz' (along y), 'zy' (along x). */
export function plate(outline, thickness, plane = 'xy', offset = 0, bevel = 0) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
  });
  g.translate(0, 0, -thickness / 2 + offset);
  if (plane === 'xz') g.rotateX(Math.PI / 2); // (a,b,d) -> (a, -d, b)
  if (plane === 'zy') g.rotateY(-Math.PI / 2); // (a,b,d) -> (d?, b, a)
  return g;
}

/** Cylinder between two points. */
export function rod(a, b, r = 0.01, seg = 10, r2 = null) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate(A.x, A.y, A.z);
  return g;
}

/** Tube along a list of points. */
export function tube(points, r = 0.01, seg = 8, tubular = null, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, tubular ?? Math.max(8, points.length * 6), r, seg, closed);
}

/** Rounded box. */
export function rbox(w, h, d, r = 0.01, seg = 3) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * Math.min(r, d / 2 - 1e-4) * 0.5, bevelEnabled: true, bevelSize: Math.min(r, d / 2) * 0.5, bevelThickness: Math.min(r, d / 2) * 0.5, bevelSegments: seg, curveSegments: seg });
  g.center();
  return g;
}

/** Parametric grid surface f(u,v) -> [x,y,z]. */
export function grid(f, nu, nv, { doubleSide = false } = {}) {
  const pos = [], idx = [], uv = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = f(i / nu, j / nv); pos.push(...p); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Make a mesh with shadows and a name. */
export function mesh(geo, mat, name, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name; m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

/** NACA 4-digit cambered airfoil, returns [x,y] around the contour (TE upper -> LE -> TE lower). */
export function naca(m, p, t, n = 28) {
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const b = (i / n) * Math.PI, x = (1 - Math.cos(b)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
    const dyc = x < p ? (2 * m / (p * p)) * (p - x) : (2 * m / ((1 - p) ** 2)) * (p - x);
    const th = Math.atan(dyc);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  return up.reverse().concat(lo.slice(1));
}
