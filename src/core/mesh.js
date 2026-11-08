// Lightweight indexed triangle mesh used during procedural generation.
// Supports exact trimming of a surface along an implicit curve (split), boundary
// extraction, "hem" extrusion of cut edges (panel thickness / jambs / duct walls),
// offset shells and conversion to THREE.BufferGeometry.
import * as THREE from 'three';

export class MeshData {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
  }
  get vertexCount() { return this.pos.length / 3; }
  get triCount() { return this.idx.length / 3; }

  addVertex(x, y, z, nx = 0, ny = 1, nz = 0, u = 0, v = 0) {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, v);
    return i;
  }
  addTri(a, b, c) { this.idx.push(a, b, c); }

  clone() {
    const m = new MeshData();
    m.pos = this.pos.slice(); m.nrm = this.nrm.slice(); m.uv = this.uv.slice(); m.idx = this.idx.slice();
    return m;
  }

  append(other) {
    const off = this.vertexCount;
    for (let i = 0; i < other.pos.length; i++) this.pos.push(other.pos[i]);
    for (let i = 0; i < other.nrm.length; i++) this.nrm.push(other.nrm[i]);
    for (let i = 0; i < other.uv.length; i++) this.uv.push(other.uv[i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + off);
    return this;
  }

  flip() {
    for (let i = 0; i < this.idx.length; i += 3) { const t = this.idx[i + 1]; this.idx[i + 1] = this.idx[i + 2]; this.idx[i + 2] = t; }
    for (let i = 0; i < this.nrm.length; i++) this.nrm[i] = -this.nrm[i];
    return this;
  }

  /** Move every vertex along its normal by d (negative = inward). */
  offset(d) {
    const m = this.clone();
    for (let i = 0; i < m.pos.length; i += 3) {
      m.pos[i] += m.nrm[i] * d; m.pos[i + 1] += m.nrm[i + 1] * d; m.pos[i + 2] += m.nrm[i + 2] * d;
    }
    return m;
  }

  /** Apply a function (x,y,z,nx,ny,nz) => [x,y,z] (normals unchanged). */
  mapPositions(fn) {
    for (let i = 0; i < this.pos.length; i += 3) {
      const r = fn(this.pos[i], this.pos[i + 1], this.pos[i + 2], this.nrm[i], this.nrm[i + 1], this.nrm[i + 2], i / 3);
      if (r) { this.pos[i] = r[0]; this.pos[i + 1] = r[1]; this.pos[i + 2] = r[2]; }
    }
    return this;
  }

  /** Mirror across z (left/right) producing a new mesh with corrected winding. */
  mirrorZ() {
    const m = this.clone();
    for (let i = 2; i < m.pos.length; i += 3) { m.pos[i] = -m.pos[i]; m.nrm[i] = -m.nrm[i]; }
    for (let i = 0; i < m.idx.length; i += 3) { const t = m.idx[i + 1]; m.idx[i + 1] = m.idx[i + 2]; m.idx[i + 2] = t; }
    return m;
  }

  /**
   * Split along the zero set of fn(x,y,z). Returns { inside (fn<0), outside (fn>=0) }.
   * New vertices on cut edges are interpolated linearly (position, normal, uv) and
   * shared between the two halves so the cut is watertight and exact.
   */
  split(fn) {
    const nv = this.vertexCount;
    const P = this.pos, N = this.nrm, U = this.uv;
    const f = new Float64Array(nv);
    for (let i = 0; i < nv; i++) f[i] = fn(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    // avoid exact zeros (degenerate splits)
    for (let i = 0; i < nv; i++) if (f[i] === 0) f[i] = 1e-12;

    const pos = P.slice(), nrm = N.slice(), uv = U.slice();
    const edgeCache = new Map();
    const fx = []; // f values for new vertices are 0
    const cut = (a, b) => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let v = edgeCache.get(key);
      if (v !== undefined) return v;
      const t = f[a] / (f[a] - f[b]);
      v = pos.length / 3;
      for (let k = 0; k < 3; k++) pos.push(P[3 * a + k] + (P[3 * b + k] - P[3 * a + k]) * t);
      let nx = N[3 * a] + (N[3 * b] - N[3 * a]) * t, ny = N[3 * a + 1] + (N[3 * b + 1] - N[3 * a + 1]) * t, nz = N[3 * a + 2] + (N[3 * b + 2] - N[3 * a + 2]) * t;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / l, ny / l, nz / l);
      uv.push(U[2 * a] + (U[2 * b] - U[2 * a]) * t, U[2 * a + 1] + (U[2 * b + 1] - U[2 * a + 1]) * t);
      edgeCache.set(key, v);
      fx.push(v);
      return v;
    };
    const inIdx = [], outIdx = [];
    const I = this.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ia = f[a] < 0, ib = f[b] < 0, ic = f[c] < 0;
      if (ia === ib && ib === ic) { (ia ? inIdx : outIdx).push(a, b, c); continue; }
      // rotate so that p is the odd one out
      let p, q, r, pin;
      if (ia !== ib && ia !== ic) { p = a; q = b; r = c; pin = ia; }
      else if (ib !== ia && ib !== ic) { p = b; q = c; r = a; pin = ib; }
      else { p = c; q = a; r = b; pin = ic; }
      const pq = cut(p, q), pr = cut(p, r);
      const solo = pin ? inIdx : outIdx, pair = pin ? outIdx : inIdx;
      solo.push(p, pq, pr);
      pair.push(pq, q, r, pq, r, pr);
    }
    return { inside: compact(pos, nrm, uv, inIdx), outside: compact(pos, nrm, uv, outIdx) };
  }

  /** Keep only the part where fn < 0 (convenience). */
  keep(fn) { return this.split(fn).inside; }

  /**
   * Split with a gap: returns { inside: fn < -gap/2, outside: fn > gap/2 }.
   */
  splitGap(fn, gap) {
    const g = gap / 2;
    const a = this.split((x, y, z) => fn(x, y, z) - g);
    const b = a.inside.split((x, y, z) => fn(x, y, z) + g);
    return { inside: b.inside, outside: a.outside, strip: b.outside };
  }

  /** Ordered boundary loops (arrays of vertex indices following triangle winding). */
  boundaryLoops() {
    const I = this.idx;
    const edges = new Map();
    const key = (a, b) => a * 4194304 + b;
    for (let t = 0; t < I.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = I[t + k], b = I[t + ((k + 1) % 3)];
        edges.set(key(a, b), [a, b]);
      }
    }
    const next = new Map();
    for (const [k, [a, b]] of edges) {
      if (!edges.has(key(b, a))) {
        if (!next.has(a)) next.set(a, []);
        next.get(a).push(b);
      }
    }
    const loops = [];
    const used = new Set();
    for (const start of next.keys()) {
      for (const firstB of next.get(start)) {
        const ek = key(start, firstB);
        if (used.has(ek)) continue;
        const loop = [start];
        used.add(ek);
        let cur = firstB, prev = start, guard = 0;
        while (cur !== start && guard++ < 1e6) {
          loop.push(cur);
          const cands = next.get(cur);
          if (!cands) break;
          let nb = cands[0];
          if (cands.length > 1) {
            for (const c of cands) if (!used.has(key(cur, c))) { nb = c; break; }
          }
          used.add(key(cur, nb));
          prev = cur; cur = nb;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    return loops;
  }

  /**
   * Extrude boundary loops into a wall ("hem").
   * opts.depth: distance; opts.dir: optional fixed [x,y,z] direction (else -normal);
   * opts.inset: move bottom ring sideways (positive = away from the piece);
   * opts.steps: segments along the wall; opts.round: small roll radius at the lip.
   * Returns a new MeshData (the wall), and attaches .bottomLoops (positions) for capping.
   */
  hem(opts = {}) {
    const loops = opts.loops || this.boundaryLoops();
    const depth = opts.depth ?? 0.03;
    const steps = opts.steps ?? 2;
    const inset = opts.inset ?? 0;
    const round = opts.round ?? 0.0;
    const out = new MeshData();
    const P = this.pos, N = this.nrm;
    out.bottomLoops = [];
    for (const loop of loops) {
      const n = loop.length;
      if (n < 3) continue;
      // per-vertex outward (away from piece) tangent directions
      const outward = [];
      for (let i = 0; i < n; i++) {
        const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
        const ex = P[3 * c] - P[3 * a], ey = P[3 * c + 1] - P[3 * a + 1], ez = P[3 * c + 2] - P[3 * a + 2];
        const nx = N[3 * b], ny = N[3 * b + 1], nz = N[3 * b + 2];
        // outward = edgeDir x normal
        let ox = ey * nz - ez * ny, oy = ez * nx - ex * nz, oz = ex * ny - ey * nx;
        const l = Math.hypot(ox, oy, oz) || 1;
        outward.push([ox / l, oy / l, oz / l]);
      }
      const rings = [];
      const bottom = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const ring = [];
        for (let i = 0; i < n; i++) {
          const v = loop[i];
          const px = P[3 * v], py = P[3 * v + 1], pz = P[3 * v + 2];
          let dx, dy, dz;
          if (opts.dir) { [dx, dy, dz] = typeof opts.dir === 'function' ? opts.dir(px, py, pz) : opts.dir; }
          else { dx = -N[3 * v]; dy = -N[3 * v + 1]; dz = -N[3 * v + 2]; }
          const o = outward[i];
          // rounded lip: first part of the wall bends from tangent to down
          const dd = depth * t;
          const lip = round > 0 ? round * Math.sin(Math.min(t * depth / Math.max(round, 1e-6), 1) * Math.PI / 2) : 0;
          const ins = inset * t - lip * 0;
          const x = px + dx * dd + o[0] * ins;
          const y = py + dy * dd + o[1] * ins;
          const z = pz + dz * dd + o[2] * ins;
          // wall normal: outward tangent (faces away from the piece)
          let wx = o[0], wy = o[1], wz = o[2];
          if (s === 0 && round > 0) {
            // blend toward surface normal at the lip for a rolled edge look
            wx = o[0] * 0.6 + N[3 * v] * 0.8; wy = o[1] * 0.6 + N[3 * v + 1] * 0.8; wz = o[2] * 0.6 + N[3 * v + 2] * 0.8;
            const l = Math.hypot(wx, wy, wz) || 1; wx /= l; wy /= l; wz /= l;
          }
          ring.push(out.addVertex(x, y, z, wx, wy, wz, i / n, t * depth));
          if (s === steps) bottom.push([x, y, z]);
        }
        rings.push(ring);
      }
      for (let s = 0; s < steps; s++) {
        const r0 = rings[s], r1 = rings[s + 1];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          out.addTri(r0[i], r1[i], r1[j]);
          out.addTri(r0[i], r1[j], r0[j]);
        }
      }
      out.bottomLoops.push(bottom);
    }
    return out;
  }

  computeBounds() {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < this.pos.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = this.pos[i + k]; if (v < b.min[k]) b.min[k] = v; if (v > b.max[k]) b.max[k] = v;
    }
    return b;
  }

  /** Recompute normals from faces (area weighted). Use for non-analytic parts. */
  computeFaceNormals() {
    const n = new Float64Array(this.pos.length);
    const P = this.pos, I = this.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      this.nrm[i] = n[i] / l; this.nrm[i + 1] = n[i + 1] / l; this.nrm[i + 2] = n[i + 2] / l;
    }
    return this;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const vc = this.vertexCount;
    g.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function compact(pos, nrm, uv, idx) {
  const m = new MeshData();
  const remap = new Map();
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    let r = remap.get(v);
    if (r === undefined) {
      r = m.pos.length / 3;
      m.pos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]);
      m.nrm.push(nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]);
      m.uv.push(uv[2 * v], uv[2 * v + 1]);
      remap.set(v, r);
    }
    m.idx.push(r);
  }
  return m;
}

/** Triangulate a planar-ish closed loop of 3D points by fan from centroid (convex-ish). */
export function capLoop(points, normal, mesh = new MeshData()) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= points.length; cy /= points.length; cz /= points.length;
  const c = mesh.addVertex(cx, cy, cz, ...normal);
  const ids = points.map((p) => mesh.addVertex(p[0], p[1], p[2], ...normal));
  for (let i = 0; i < ids.length; i++) mesh.addTri(c, ids[i], ids[(i + 1) % ids.length]);
  // orient toward normal
  const a = points[0], b = points[1 % points.length];
  const ux = a[0] - cx, uy = a[1] - cy, uz = a[2] - cz, vx = b[0] - cx, vy = b[1] - cy, vz = b[2] - cz;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * normal[0] + ny * normal[1] + nz * normal[2] < 0) {
    const start = mesh.idx.length - ids.length * 3;
    for (let i = start; i < mesh.idx.length; i += 3) { const t = mesh.idx[i + 1]; mesh.idx[i + 1] = mesh.idx[i + 2]; mesh.idx[i + 2] = t; }
  }
  return mesh;
}
