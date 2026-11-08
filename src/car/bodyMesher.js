// Structured mesher for the implicit body: the shell is sampled as a stack of
// cross-section rings. Each ring is found by marching rays from the section
// centre to the zero set of the field, then resampled to uniform arc length.
// Normals come from the analytic field gradient, so shading is perfectly smooth.
import { MeshData } from '../core/mesh.js';
import { params, field } from './bodyShape.js';
import { DIMS } from './dims.js';

function sectionSpan(x) {
  const P = params(x);
  let best = Infinity, by = 0.4;
  for (let y = 0.02; y < 1.4; y += 0.002) {
    const f = field(P, y, 0);
    if (f < best) { best = f; by = y; }
  }
  return { f: best, y: by };
}

function findEnd(inside, outside) {
  let a = inside, b = outside;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2;
    if (sectionSpan(m).f < 0) a = m; else b = m;
  }
  return a;
}

export function meshBody({ rings = 640, half = 196, rays = 480 } = {}) {
  const x0 = findEnd(DIMS.XTAIL + 0.3, DIMS.XTAIL - 0.01);
  const x1 = findEnd(DIMS.XTIP - 0.3, DIMS.XTIP + 0.01);
  const mesh = new MeshData();
  const ringIdx = [];
  const xs = [];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    let x = (x0 + x1) / 2 - ((x1 - x0) / 2) * Math.cos(Math.PI * s);
    if (i === 0) x = x0 + 2e-5;
    if (i === rings) x = x1 - 2e-5;
    xs.push(x);
  }
  const hx = 4e-4;
  let prevHits = null;
  let lastYc = 0.5;
  const ringCenters = [];
  for (let i = 0; i <= rings; i++) {
    const x = xs[i];
    const P = params(x);
    // --- section centre: vertical scan on z = 0
    let ya = -1, yb = -1, best = Infinity, by = lastYc;
    for (let y = 0.02; y < 1.4; y += 0.0025) {
      const f = field(P, y, 0);
      if (f < best) { best = f; by = y; }
      const inside = f < 0;
      if (inside && ya < 0) ya = y;
      if (inside) yb = y;
    }
    let yc = ya >= 0 ? (ya + yb) / 2 : by;
    lastYc = yc;
    ringCenters.push(yc);
    // --- rays over the right half: phi from -90deg (down) to +90deg (up)
    const hits = new Float64Array(rays * 2);
    for (let k = 0; k < rays; k++) {
      const phi = -Math.PI / 2 + (Math.PI * k) / (rays - 1);
      const dz = Math.cos(phi), dy = Math.sin(phi);
      let t = prevHits ? Math.max(0, Math.hypot(prevHits[2 * k], prevHits[2 * k + 1] - yc) * 0.85) : 0;
      // ensure we start inside
      let f = field(P, yc + dy * t, dz * t);
      if (f > 0) { t = 0; f = field(P, yc, 0); }
      let guard = 0, tPrev = t;
      while (f < 0 && guard++ < 600) {
        const step = Math.min(Math.max(-f * 0.6, 0.0015), 0.05);
        tPrev = t;
        t += step;
        f = field(P, yc + dy * t, dz * t);
        if (t > 2.5) break;
      }
      let lo = tPrev, hi = t;
      for (let it = 0; it < 20; it++) {
        const m = (lo + hi) / 2;
        if (field(P, yc + dy * m, dz * m) < 0) lo = m; else hi = m;
      }
      const tt = (lo + hi) / 2;
      hits[2 * k] = dz * tt; hits[2 * k + 1] = yc + dy * tt;
    }
    prevHits = hits;
    // --- arc length resample
    const cum = new Float64Array(rays);
    for (let k = 1; k < rays; k++) cum[k] = cum[k - 1] + Math.hypot(hits[2 * k] - hits[2 * k - 2], hits[2 * k + 1] - hits[2 * k - 1]);
    const total = cum[rays - 1];
    const pts = [];
    let seg = 0;
    for (let j = 0; j <= half; j++) {
      const target = (total * j) / half;
      while (seg < rays - 2 && cum[seg + 1] < target) seg++;
      const a = cum[seg], b = cum[seg + 1];
      const tt = b > a ? (target - a) / (b - a) : 0;
      let z = hits[2 * seg] + (hits[2 * seg + 2] - hits[2 * seg]) * tt;
      let y = hits[2 * seg + 1] + (hits[2 * seg + 3] - hits[2 * seg + 1]) * tt;
      if (j === 0 || j === half) z = 0;
      pts.push([z, y, target]);
    }
    // --- normals by central differences
    const Pp = params(x + hx), Pm = params(x - hx);
    const ids = new Array(2 * half);
    const e = 2e-4;
    for (let j = 0; j <= half; j++) {
      let [z, y, arc] = pts[j];
      // snap onto the surface along the ray from the section centre (radial bisection): unlike a
      // gradient (Newton) step this keeps the vertex order, so sharp crests never fold
      {
        const dz0 = z, dy0 = y - yc, r0 = Math.hypot(dz0, dy0);
        if (r0 > 1e-6) {
          const ux = dz0 / r0, uy = dy0 / r0;
          let lo = r0 - 0.012, hi = r0 + 0.012;
          if (field(P, yc + uy * lo, ux * lo) < 0 && field(P, yc + uy * hi, ux * hi) > 0) {
            for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (field(P, yc + uy * m, ux * m) < 0) lo = m; else hi = m; }
            const r = (lo + hi) / 2;
            y = yc + uy * r; if (j !== 0 && j !== half) z = ux * r;
          }
        }
      }
      const gy = (field(P, y + e, z) - field(P, y - e, z)) / (2 * e);
      let gz = (field(P, y, z + e) - field(P, y, z - e)) / (2 * e);
      const gx = (field(Pp, y, z) - field(Pm, y, z)) / (2 * hx);
      if (j === 0 || j === half) gz = 0;
      const l = Math.hypot(gx, gy, gz) || 1;
      ids[j] = mesh.addVertex(x, y, z, gx / l, gy / l, gz / l, x, arc);
      if (j > 0 && j < half) ids[2 * half - j] = mesh.addVertex(x, y, -z, gx / l, gy / l, -gz / l, x, 2 * total - arc);
    }
    ringIdx.push(ids);
  }
  const M = 2 * half;
  for (let i = 0; i < rings; i++) {
    const A = ringIdx[i], B = ringIdx[i + 1];
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      mesh.addTri(A[j], B[j], B[j1]);
      mesh.addTri(A[j], B[j1], A[j1]);
    }
  }
  // caps
  const capRear = mesh.addVertex(x0, ringCenters[0], 0, -1, 0, 0, x0, 0);
  const capFront = mesh.addVertex(x1, ringCenters[rings], 0, 1, 0, 0, x1, 0);
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    mesh.addTri(capRear, ringIdx[0][j], ringIdx[0][j1]);
    mesh.addTri(capFront, ringIdx[rings][j1], ringIdx[rings][j]);
  }
  // orientation check: the normal at a top vertex should agree with the face winding
  fixOrientation(mesh);
  return mesh;
}

function fixOrientation(mesh) {
  const P = mesh.pos, N = mesh.nrm, I = mesh.idx;
  let agree = 0;
  for (let t = 0; t < I.length; t += 3 * 97) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    agree += Math.sign(nx * N[a] + ny * N[a + 1] + nz * N[a + 2]);
  }
  if (agree < 0) {
    for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
}
