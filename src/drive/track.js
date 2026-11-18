// "F-Future Test Circuit": an original, fictional 3.4 km handling circuit (not a replica of any
// real track): a long main straight, a fast right, esses, a long sweeper, a chicane, a loop and
// a hairpin back onto the straight. Built as geometry (asphalt ribbon with edge lines, kerbs,
// run-off, barriers, start gantry, pit building, grandstand, braking boards, trees) plus a fast
// spatial query for the vehicle simulation (nearest centre-line point, lateral offset, surface).
import * as THREE from 'three';

export const CONTROL = [[-100, 0], [150, 0], [380, 0], [500, 25], [560, 110], [555, 230], [490, 320], [525, 420], [490, 520], [380, 575], [250, 560], [160, 490], [70, 520], [-30, 600], [-190, 625], [-330, 575], [-420, 480], [-440, 340], [-370, 250], [-250, 235], [-200, 165], [-270, 108], [-405, 102], [-462, 52], [-400, 0]];
export const ROAD_HALF = 6.5;
const KERB_W = 1.3;
const WALL = 26; // barrier offset from the centre line
const STEP = 2; // sampling of the centre line (m)

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Sampled centre line with tangents, normals (to the right), curvature and distance. */
export function sampleTrack() {
  const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const n = Math.round(length / STEP);
  const pts = curve.getSpacedPoints(n).slice(0, n);
  const P = new Float32Array(n * 2), T = new Float32Array(n * 2), R = new Float32Array(n * 2), K = new Float32Array(n), S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    P[2 * i] = pts[i].x; P[2 * i + 1] = pts[i].z;
    T[2 * i] = tx; T[2 * i + 1] = tz;
    // right-hand normal (car frame: +x forward, +z right) -> rotate tangent by -90deg about y
    R[2 * i] = -tz; R[2 * i + 1] = tx;
    S[i] = (i * length) / n;
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, h = (i - 1 + n) % n;
    const a1 = Math.atan2(T[2 * i + 1], T[2 * i]), a0 = Math.atan2(T[2 * h + 1], T[2 * h]), a2 = Math.atan2(T[2 * j + 1], T[2 * j]);
    let d = a2 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    void a1;
    K[i] = d / (2 * STEP); // signed curvature: + turns right
  }
  // smooth curvature
  const K2 = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = -4; k <= 4; k++) s += K[(i + k + n) % n]; K2[i] = s / 9; }
  return { n, length, P, T, R, K: K2, S };
}

/** Spatial hash over the centre line for nearest-point queries. */
export class TrackQuery {
  constructor(tr) {
    this.tr = tr; this.cell = 24; this.map = new Map();
    for (let i = 0; i < tr.n; i++) {
      const k = this.key(tr.P[2 * i], tr.P[2 * i + 1]);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    }
    this.last = 0;
  }
  key(x, z) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  /** {i, s, d (signed lateral offset, + right), heading} for a world position. */
  query(x, z) {
    const tr = this.tr, n = tr.n;
    let best = -1, bd = 1e18;
    // local search around the last index first (fast and avoids jumping between close sections)
    for (let k = -30; k <= 30; k++) {
      const i = (this.last + k + n) % n, dx = x - tr.P[2 * i], dz = z - tr.P[2 * i + 1], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > 40 * 40) {
      const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const list = this.map.get(`${cx + a},${cz + b}`); if (!list) continue;
        for (const i of list) { const dx = x - tr.P[2 * i], dz = z - tr.P[2 * i + 1], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
      }
    }
    if (best < 0) { best = this.last; }
    this.last = best;
    const i = best;
    const dx = x - tr.P[2 * i], dz = z - tr.P[2 * i + 1];
    const d = dx * tr.R[2 * i] + dz * tr.R[2 * i + 1];
    const along = dx * tr.T[2 * i] + dz * tr.T[2 * i + 1];
    let s = tr.S[i] + along; if (s < 0) s += tr.length; if (s >= tr.length) s -= tr.length;
    return { i, s, d, curv: tr.K[i] };
  }
  /** Pose on the centre line at distance s (+ lateral offset). */
  pose(s, offset = 0) {
    const tr = this.tr, i = Math.floor(((s % tr.length) + tr.length) % tr.length / STEP) % tr.n;
    const x = tr.P[2 * i] + tr.R[2 * i] * offset, z = tr.P[2 * i + 1] + tr.R[2 * i + 1] * offset;
    // car heading psi: forward = (cos psi, -sin psi)
    const psi = Math.atan2(-tr.T[2 * i + 1], tr.T[2 * i]);
    return { x, z, psi, i };
  }
}

function ribbon(tr, off0, off1, y, vScale, filter = null) {
  const pos = [], uv = [], idx = [];
  const n = tr.n;
  let vi = 0, prevOk = false;
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const ok = !filter || filter(i);
    const o0 = typeof off0 === 'function' ? off0(i) : off0, o1 = typeof off1 === 'function' ? off1(i) : off1;
    if (ok) {
      const x = tr.P[2 * i], z = tr.P[2 * i + 1], rx = tr.R[2 * i], rz = tr.R[2 * i + 1];
      pos.push(x + rx * o0, y, z + rz * o0, x + rx * o1, y, z + rz * o1);
      const v = (k === n ? tr.length : tr.S[i]) / vScale;
      uv.push(0, v, 1, v);
      // counter-clockwise seen from above, so the surface faces up
      if (prevOk) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
      vi += 2;
    }
    prevOk = ok;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function wall(tr, side, height, filter = null) {
  // vertical strip facing the track
  const pos = [], uv = [], idx = [];
  let vi = 0, prev = false;
  for (let k = 0; k <= tr.n; k++) {
    const i = k % tr.n;
    const ok = !filter || filter(i);
    if (ok) {
      const x = tr.P[2 * i] + tr.R[2 * i] * side * WALL, z = tr.P[2 * i + 1] + tr.R[2 * i + 1] * side * WALL;
      pos.push(x, 0, z, x, height, z);
      const v = (k === tr.n ? tr.length : tr.S[i]) / 4;
      uv.push(v, 0, v, 1);
      if (prev) { if (side > 0) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1); else idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi); }
      vi += 2;
    }
    prev = ok;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildTrack({ anisotropy = 8 } = {}) {
  const tr = sampleTrack();
  const group = new THREE.Group(); group.name = 'TestCircuit';
  const R = rng(42);

  // ---- textures ----
  const asphalt = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3a3b3d'; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (R() - 0.5) * 46 + (R() < 0.03 ? 40 : 0); d[i] += v; d[i + 1] += v; d[i + 2] += v * 1.05; }
    ctx.putImageData(img, 0, 0);
  }, { repeat: [3, 1] });
  // road cross-section: edge lines and a darker rubbered racing band (u across, v along)
  const roadMark = canvasTex(256, 16, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#7d7b78'); g.addColorStop(0.35, '#66645f'); g.addColorStop(0.5, '#5e5c58'); g.addColorStop(0.65, '#66645f'); g.addColorStop(1, '#7d7b78');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(w * 0.025, 0, w * 0.035, h); ctx.fillRect(w * 0.94, 0, w * 0.035, h);
  }, { repeat: [1, 1] });
  roadMark.wrapS = THREE.ClampToEdgeWrapping;
  const grass = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3f5a26'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) { const x = R() * w, y = R() * h, l = 1 + R() * 3; ctx.fillStyle = `hsl(${85 + R() * 25},${35 + R() * 25}%,${16 + R() * 18}%)`; ctx.fillRect(x, y, 1, l); }
  }, { repeat: [900, 900] });
  const kerbTex = canvasTex(64, 16, (ctx, w, h) => { ctx.fillStyle = '#c8102e'; ctx.fillRect(0, 0, w / 2, h); ctx.fillStyle = '#f2f2f2'; ctx.fillRect(w / 2, 0, w / 2, h); });
  kerbTex.wrapT = THREE.RepeatWrapping;
  for (const t of [asphalt, grass, kerbTex]) t.anisotropy = anisotropy;

  // ---- ground ----
  const groundMat = new THREE.MeshStandardMaterial({ name: 'Grass', map: grass, color: 0xe2e8cc, roughness: 0.95, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(50, -0.02, 300); ground.receiveShadow = true; ground.name = 'Ground';
  group.add(ground);

  // ---- run-off (light asphalt apron) ----
  const apronMat = new THREE.MeshStandardMaterial({ name: 'Runoff', map: asphalt, color: 0xd9d5cc, roughness: 0.92 });
  const apron = new THREE.Mesh(ribbon(tr, -ROAD_HALF - 9, ROAD_HALF + 9, 0.0, 6), apronMat);
  apron.receiveShadow = true; group.add(apron);

  // ---- road ----
  const roadMat = new THREE.MeshStandardMaterial({ name: 'Asphalt', map: roadMark, roughness: 0.88, metalness: 0 });
  roadMat.onBeforeCompile = (sh) => {
    sh.uniforms.agg = { value: asphalt };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D agg;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 a = texture2D(agg, vec2(vMapUv.x * 3.0, vMapUv.y * 0.6)).rgb;
        diffuseColor.rgb *= a * 2.6;
        // start / finish line
        float sf = step(abs(vMapUv.y * 8.0 - 0.0), 0.35) + step(abs(vMapUv.y * 8.0 - ${(tr.length / 8).toFixed(2)}), 0.35);
        if (sf > 0.0) { float ch = mod(floor(vMapUv.x * 16.0) + floor(vMapUv.y * 8.0 * 4.0), 2.0); diffuseColor.rgb = mix(vec3(0.05), vec3(0.92), ch); }`);
  };
  const road = new THREE.Mesh(ribbon(tr, -ROAD_HALF, ROAD_HALF, 0.012, 8), roadMat);
  road.receiveShadow = true; road.name = 'Road'; group.add(road);

  // ---- kerbs on the inside and outside of corners ----
  const kerbMat = new THREE.MeshStandardMaterial({ name: 'Kerb', map: kerbTex, roughness: 0.6 });
  const inCorner = (side) => (i) => Math.abs(tr.K[i]) > 1 / 160 && (side > 0 ? tr.K[i] > 0 : tr.K[i] < 0);
  const outCorner = (side) => (i) => Math.abs(tr.K[i]) > 1 / 90 && (side > 0 ? tr.K[i] < 0 : tr.K[i] > 0);
  for (const side of [-1, 1]) for (const f of [inCorner(side), outCorner(side)]) {
    const o0 = side > 0 ? ROAD_HALF : -ROAD_HALF - KERB_W, o1 = side > 0 ? ROAD_HALF + KERB_W : -ROAD_HALF;
    const g = ribbon(tr, o0, o1, 0.03, 4, f);
    // the kerb texture runs along v; rotate uv so stripes cross the kerb
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); uv.setXY(k, v, u); }
    const m = new THREE.Mesh(g, kerbMat); m.receiveShadow = true; group.add(m);
  }
  const kerbAt = (i, side) => inCorner(side)(i) || outCorner(side)(i);

  // ---- barriers: tyre-wall base with armco rails ----
  const armcoMat = new THREE.MeshStandardMaterial({ name: 'Armco', color: 0xb8bcc2, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide });
  const baseMat = new THREE.MeshStandardMaterial({ name: 'Barrier_Base', color: 0x1b1c1e, roughness: 0.9, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const b = new THREE.Mesh(wall(tr, side, 0.45), baseMat); b.castShadow = true; b.receiveShadow = true; group.add(b);
    const a = new THREE.Mesh(wall(tr, side, 0.32), armcoMat); a.position.y = 0.5; a.castShadow = true; group.add(a);
  }

  // ---- start gantry, pit building, grandstand ----
  const concrete = new THREE.MeshStandardMaterial({ name: 'Concrete', color: 0xb9b6ae, roughness: 0.85 });
  const darkGlass = new THREE.MeshStandardMaterial({ name: 'Pit_Glass', color: 0x0e1418, roughness: 0.08, metalness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ name: 'Steel_Dark', color: 0x2a2c30, roughness: 0.45, metalness: 0.8 });
  const red = new THREE.MeshStandardMaterial({ name: 'Livery_Red', color: 0xb00d18, roughness: 0.5 });
  const box = (w, h, d, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
  // pit building along the main straight (outside, -z)
  box(180, 7, 14, concrete, 40, 3.5, -WALL - 14);
  box(180, 2.6, 14.2, darkGlass, 40, 5.0, -WALL - 14);
  box(184, 0.5, 18, steel, 40, 7.25, -WALL - 13);
  box(180, 0.8, 0.4, red, 40, 6.6, -WALL - 6.9);
  // grandstand opposite (+z), stepped
  for (let k = 0; k < 7; k++) box(110, 0.9, 2.2, concrete, 40, 0.45 + k * 0.9, WALL + 8 + k * 2.2);
  box(112, 0.4, 18, steel, 40, 9.2, WALL + 13.5);
  for (const x of [-15, 40, 95]) box(0.4, 9, 0.4, steel, x, 4.5, WALL + 21);
  // start gantry over the line
  const g0 = tr.P[0], gz = tr.P[1];
  box(0.6, 7.5, 0.6, steel, g0 + 0, 3.75, gz - ROAD_HALF - 3);
  box(0.6, 7.5, 0.6, steel, g0 + 0, 3.75, gz + ROAD_HALF + 3);
  box(0.9, 1.2, ROAD_HALF * 2 + 7, steel, g0, 7.6, gz);
  const lights = new THREE.MeshStandardMaterial({ name: 'Gantry_Lights', color: 0x111111, emissive: 0xff1a1a, emissiveIntensity: 0.0 });
  for (let k = -2; k <= 2; k++) box(0.25, 0.5, 0.5, lights, g0 + 0.5, 7.6, gz + k * 1.2);

  // ---- braking boards before the slowest corners ----
  const boardTex = (n) => canvasTex(128, 128, (ctx, w, h) => { ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#111'; ctx.font = 'bold 64px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), w / 2, h / 2 + 4); });
  const boardMats = { 100: new THREE.MeshStandardMaterial({ map: boardTex(100), roughness: 0.6 }), 200: new THREE.MeshStandardMaterial({ map: boardTex(200), roughness: 0.6 }), 300: new THREE.MeshStandardMaterial({ map: boardTex(300), roughness: 0.6 }) };
  // corner entries: where curvature rises above a threshold after a straight
  const entries = [];
  for (let i = 0; i < tr.n; i++) {
    const k = Math.abs(tr.K[i]), kp = Math.abs(tr.K[(i - 1 + tr.n) % tr.n]);
    if (k > 1 / 60 && kp <= 1 / 60) {
      // require a straight-ish approach of 250 m
      let straight = true; for (let j = 20; j < 125; j++) if (Math.abs(tr.K[(i - j + tr.n) % tr.n]) > 1 / 300) { straight = false; break; }
      if (straight) entries.push(i);
    }
  }
  for (const i of entries) for (const dist of [100, 200, 300]) {
    const j = (i - Math.round(dist / STEP) + tr.n) % tr.n, side = tr.K[i] > 0 ? -1 : 1; // outside of the corner
    const x = tr.P[2 * j] + tr.R[2 * j] * side * (ROAD_HALF + 4), z = tr.P[2 * j + 1] + tr.R[2 * j + 1] * side * (ROAD_HALF + 4);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), boardMats[dist]);
    b.position.set(x, 1.4, z); b.rotation.y = Math.atan2(tr.T[2 * j], tr.T[2 * j + 1]) + Math.PI; b.castShadow = true; group.add(b);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), steel); post.position.set(x, 0.7, z); group.add(post);
  }

  // ---- trees (instanced), kept clear of the circuit ----
  const q = new TrackQuery(tr);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3.2, 7); trunkGeo.translate(0, 1.6, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 1); crownGeo.scale(1, 1.25, 1); crownGeo.translate(0, 5.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ name: 'Bark', color: 0x4a3a2c, roughness: 0.95 });
  const crownMat = new THREE.MeshStandardMaterial({ name: 'Foliage', color: 0x2f4a22, roughness: 0.9, flatShading: true });
  const N = 900, trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N), crowns = new THREE.InstancedMesh(crownGeo, crownMat, N);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  let placed = 0;
  for (let k = 0; k < 6000 && placed < N; k++) {
    const x = -900 + R() * 2000, z = -500 + R() * 1600;
    const near = q.query(x, z); q.last = 0;
    if (Math.abs(near.d) < WALL + 12) continue;
    if (x > -60 && x < 140 && z > -70 && z < 70) continue; // keep the paddock open
    const s = 0.7 + R() * 0.8;
    m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, R() * 6.28, 0)), new THREE.Vector3(s, s * (0.85 + R() * 0.4), s));
    trunks.setMatrixAt(placed, m4); crowns.setMatrixAt(placed, m4);
    crowns.setColorAt(placed, c.setHSL(0.24 + R() * 0.07, 0.35 + R() * 0.2, 0.22 + R() * 0.12));
    placed++;
  }
  trunks.count = crowns.count = placed;
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  return { group, tr, query: q, kerbAt, entries, gantryLights: lights };
}
