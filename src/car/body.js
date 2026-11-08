// Body panels for the F-Future. The continuous implicit body shell is meshed once,
// then trimmed along exact panel lines (2D signed-distance curves in the side,
// top, front or rear projection) into separate panels with real panel gaps.
// Every cut edge receives a "hem": a return flange that gives the panel its
// thickness, forms door jambs, vent walls, intake ducts and light housings.
import { meshBody } from './bodyMesher.js';
import { makeFieldCache, surfaceNormal } from './bodyShape.js';
import { sdCircle, sdBox, sdPolygon, smoothPolygon, polygonSDF } from '../core/sdf2d.js';
import { pchip } from '../core/math.js';
import { DIMS } from './dims.js';

class Pieces {
  constructor() { this.list = []; }
  add(mesh, mat, part, tag = null) { if (mesh && mesh.triCount) this.list.push({ mesh, mat, part, tag }); return mesh; }
  skin(part, mats) { return this.list.filter((p) => p.part === part && !p.tag && (!mats || mats.includes(p.mat))); }
  /**
   * Split all pieces of `parts` (optionally only of materials `mats`) along fn.
   * The inside goes to { toPart, toMat } or is removed. Returns the touched pieces.
   */
  carve(fn, { parts = ['body'], mats = null, gap = 0, toPart = null, toMat = null, remove = false } = {}) {
    const res = { inside: [], outside: [] };
    const keep = [];
    for (const p of this.list) {
      if (!parts.includes(p.part) || (mats && !mats.includes(p.mat))) { keep.push(p); continue; }
      const s = gap > 0 ? p.mesh.splitGap(fn, gap) : p.mesh.split(fn);
      if (s.outside.triCount) { const np = { mesh: s.outside, mat: p.mat, part: p.part, tag: p.tag }; keep.push(np); res.outside.push(np); }
      if (s.inside.triCount) {
        const np = { mesh: s.inside, mat: toMat ?? p.mat, part: toPart ?? p.part, tag: p.tag };
        if (!remove) keep.push(np);
        res.inside.push(np);
      }
    }
    this.list = keep;
    return res;
  }
  /** Hem the cut edges of the given pieces. */
  hem(pieces, opts) {
    const out = [];
    for (const p of pieces) {
      const chains = p.mesh.boundaryChains(p.mesh.cut);
      if (!chains.length) continue;
      const h = p.mesh.hem({ ...opts, chains });
      this.add(h, opts.mat ?? p.mat, opts.part ?? p.part, 'hem');
      out.push(h);
    }
    return out;
  }
  /** Add offset copies (e.g. floors of recesses, inner panels). */
  offsetCopies(pieces, d, mat, part, flip = false) {
    for (const p of pieces) {
      const m = p.mesh.offset(d);
      if (flip) m.flip();
      this.add(m, mat, part ?? p.part, 'offset');
    }
  }
}

export const OUTLINES = {
  hood: [[2.27, 0.0], [2.25, 0.30], [2.18, 0.46], [2.0, 0.53], [1.70, 0.565], [1.43, 0.585], [1.402, 0.40], [1.40, 0.0], [1.402, -0.40], [1.43, -0.585], [1.70, -0.565], [2.0, -0.53], [2.18, -0.46], [2.25, -0.30]],
  engineCover: [[-0.53, 0.0], [-0.535, 0.40], [-0.60, 0.445], [-1.0, 0.44], [-1.5, 0.415], [-1.80, 0.395], [-1.862, 0.33], [-1.865, 0.0], [-1.862, -0.33], [-1.80, -0.395], [-1.5, -0.415], [-1.0, -0.44], [-0.60, -0.445], [-0.535, -0.40]],
};

const SYM = (half) => {
  // mirror a half outline given for z >= 0 (ordered from z=0 bottom ... to z=0 top) into a full polygon
  const left = half.slice(1, -1).reverse().map(([z, y]) => [-z, y]);
  return half.concat(left);
};

export function buildBodyPieces({ quality = 'full' } = {}) {
  const t0 = performance.now();
  const skin = meshBody(quality === 'draft' ? { rings: 300, half: 96, rays: 260 } : {});
  const F = makeFieldCache(0.002);
  const pcs = new Pieces();
  pcs.add(skin, 'paint', 'body');
  const az = Math.abs;

  // ---------------- wheel arches ----------------
  for (const a of [DIMS.archF, DIMS.archR]) {
    const fn = (x, y, z) => {
      const f = Math.max(sdCircle(x, y, a.x, a.y, a.r), 0.60 - az(z));
      if (f > 0.02) return f;
      // open the side wall only: never cut through the fender top (deep bonnet valley)
      return Math.max(f, (surfaceNormal(x, y, z)[1] - 0.8) * 0.2);
    };
    const r = pcs.carve(fn, { remove: true });
    pcs.hem(r.outside, { depth: 0.035, steps: 2, mat: 'paint' });
  }

  // ---------------- front intake (fascia) ----------------
  // One wide lower intake with a flat top at bumper height, split into a centre and two side
  // openings by angled body-coloured fangs, plus narrow vertical ducts at the outer corners
  // (front views of sheets 03, 04 and 06).
  const grilleC = polygonSDF(smoothPolygon([[-0.25, 0.335], [0.25, 0.335], [0.345, 0.128], [0.0, 0.122], [-0.345, 0.128]], 3));
  const grilleSide = polygonSDF(smoothPolygon([[0.315, 0.335], [0.60, 0.338], [0.795, 0.345], [0.80, 0.24], [0.79, 0.15], [0.60, 0.135], [0.415, 0.135]], 3));
  const grilleCorner = polygonSDF(smoothPolygon([[0.838, 0.40], [0.885, 0.428], [0.93, 0.42], [0.934, 0.20], [0.90, 0.15], [0.845, 0.15]], 3));
  const grilleSDF = (z, y) => Math.min(grilleC(z, y), grilleSide(Math.abs(z), y), grilleCorner(Math.abs(z), y));
  const grilleFn = (x, y, z) => Math.max(grilleSDF(z, y), 1.90 - x, y - 0.47);
  {
    const r = pcs.carve(grilleFn, { remove: true });
    pcs.hem(r.outside, {
      depth: 0.24, steps: 3, mat: 'cavity',
      dir: (x, y, z) => { const s = Math.min(1, Math.max(0, (az(z) - 0.62) / 0.3)); const dz = -Math.sign(z) * 0.9 * s; const l = Math.hypot(1, dz); return [-1 / l, 0, dz / l]; },
    });
  }

  // ---------------- headlights ----------------
  // Steep, slim sabre: pointed inner-lower end, rising to the fender corner, then a thin tail
  // that runs back along the fender towards the A-pillar (front + side views, hero render).
  const headHalf = smoothPolygon([[0.632, 0.428], [0.70, 0.452], [0.80, 0.522], [0.875, 0.585], [0.93, 0.632], [0.92, 0.668], [0.86, 0.652], [0.76, 0.58], [0.68, 0.502], [0.64, 0.462]], 6);
  const headR = polygonSDF(headHalf);
  const headTail = polygonSDF(smoothPolygon([[2.03, 0.585], [1.92, 0.607], [1.78, 0.633], [1.66, 0.655], [1.625, 0.663], [1.66, 0.671], [1.80, 0.66], [1.93, 0.646], [2.03, 0.638]], 4));
  const headFn = (x, y, z) => {
    const front = Math.max(headR(az(z), y), 1.88 - x, 0.38 - y);
    let tail = Math.max(headTail(x, y), 0.70 - az(z));
    if (tail < 0.02) { const n = surfaceNormal(x, y, z); tail = Math.max(tail, (0.72 - Math.abs(n[2])) * 0.2); } // side-facing only, never the fender top
    return Math.min(front, tail);
  };
  {
    const r = pcs.carve(headFn, { toMat: 'lens', toPart: 'body' });
    pcs.hem(r.outside, { depth: 0.045, steps: 2, mat: 'blackGloss' });
    pcs.offsetCopies(r.inside, -0.045, 'lampBack', 'body', false);
    for (const p of r.inside) p.mesh.mapPositions((x, y, z, nx, ny, nz) => [x - nx * 0.003, y - ny * 0.003, z - nz * 0.003]);
  }

  // ---------------- rear diffuser opening ----------------
  // centre section + two arched outer venturi tunnels (rear views / rear diffuser detail)
  const diffSDF = polygonSDF(smoothPolygon(SYM([[0.0, -0.2], [0.83, -0.2], [0.83, 0.20], [0.80, 0.30], [0.72, 0.38], [0.60, 0.415], [0.48, 0.41], [0.38, 0.37], [0.33, 0.31], [0.30, 0.30], [0.0, 0.30]]), 5));
  const diffFn = (x, y, z) => Math.max(diffSDF(z, y), x + 1.72);
  {
    const r = pcs.carve(diffFn, { remove: true });
    pcs.hem(r.outside, { depth: 0.30, steps: 2, mat: 'carbonMatte' });
  }

  // ---------------- tail lights ----------------
  // Two black "goggles", each holding a pair of ring lights; between them the LED line runs
  // over the paint (rear views of sheets 03, 04, 06 and the taillight layer reference).
  const RINGS = [0.548, 0.738];
  const gogFn = (x, y, z) => Math.max(sdBox(az(z), y, 0.643, 0.688, 0.168, 0.086, 0.086), x + 1.93);
  pcs.carve(gogFn, { toMat: 'blackGloss' });
  const ringFn = (x, y, z) => Math.max(Math.min(sdCircle(az(z), y, RINGS[0], 0.688, 0.072), sdCircle(az(z), y, RINGS[1], 0.688, 0.072)), x + 1.93);
  {
    const r = pcs.carve(ringFn, { remove: true });
    pcs.hem(r.outside, { depth: 0.03, steps: 2, mat: 'blackGloss' });
    pcs.offsetCopies(r.inside, -0.03, 'tailInner', 'body');
  }
  // full-width dark vent under the ducktail lip, below the wing
  {
    const ventR = (x, y, z) => Math.max(sdBox(z, y, 0, 0.818, 0.80, 0.02, 0.018), x + 1.95);
    const r = pcs.carve(ventR, { remove: true });
    pcs.hem(r.outside, { depth: 0.05, steps: 1, mat: 'cavity' });
    pcs.offsetCopies(r.inside, -0.05, 'cavity', 'body');
  }

  // (Testarossa scoop recess and flying-buttress void are clean surface inlays: see details.js)
  const liOpenFn = (x, y, z) => {
    const p = F.params(x);
    const fy = Math.max(0.125 - y, y - (p.liTop - 0.03));
    return Math.max(fy, x + 0.90 > 0 ? x + 0.90 : -0.975 - x, 0.6 - az(z));
  };
  {
    const r = pcs.carve(liOpenFn, { remove: true });
    pcs.hem(r.outside, { depth: 0.12, steps: 2, mat: 'carbonMatte' });
    pcs.offsetCopies(r.inside, -0.12, 'cavity', 'body');
  }

  // ---------------- front bonnet (frunk lid) with Fluxus vent ----------------
  const hoodPoly = smoothPolygon(OUTLINES.hood, 4);
  const hoodSDF = polygonSDF(hoodPoly);
  const hoodFn = (x, y, z) => Math.max(hoodSDF(x, z), 0.5 - y);
  {
    const r = pcs.carve(hoodFn, { gap: 0.0045, toPart: 'hood' });
    pcs.hem(r.outside, { depth: 0.07, steps: 2, mat: 'paintInner' });
    pcs.hem(r.inside, { depth: 0.028, steps: 2, mat: 'paint', part: 'hood' });
  }
  const ventPoly = smoothPolygon([[1.935, 0.0], [1.915, 0.20], [1.86, 0.29], [1.70, 0.315], [1.46, 0.33], [1.445, 0.0], [1.46, -0.33], [1.70, -0.315], [1.86, -0.29], [1.915, -0.20]], 5);
  const ventSDF = polygonSDF(ventPoly);
  const ventFn = (x, y, z) => Math.max(ventSDF(x, z), 0.5 - y);
  {
    const r = pcs.carve(ventFn, { parts: ['hood'], remove: true });
    pcs.hem(r.outside, { depth: 0.075, steps: 2, mat: 'carbonMatte', part: 'hood' });
    pcs.offsetCopies(r.inside, -0.075, 'carbonMatte', 'hood');
  }
  // bonnet underside
  pcs.offsetCopies(pcs.skin('hood', ['paint']), -0.028, 'carbonMatte', 'hood', true);

  // ---------------- engine cover with louvres and V12 window ----------------
  const ecPoly = smoothPolygon(OUTLINES.engineCover, 4);
  const ecSDF = polygonSDF(ecPoly);
  const ecFn = (x, y, z) => Math.max(ecSDF(x, z), 0.8 - y);
  {
    const r = pcs.carve(ecFn, { gap: 0.0045, toPart: 'engineCover', toMat: 'carbon' });
    pcs.hem(r.outside, { depth: 0.06, steps: 2, mat: 'blackSatin' });
    pcs.hem(r.inside, { depth: 0.025, steps: 2, mat: 'carbon', part: 'engineCover' });
  }
  const slot = (x0, x1, w) => (x, y, z) => Math.max(sdBox(x, z, (x0 + x1) / 2, 0, (x1 - x0) / 2, w, 0.05), 0.8 - y);
  const louvres = [slot(-0.87, -0.64, 0.30), slot(-1.69, -1.43, 0.26)];
  for (const fn of louvres) {
    const r = pcs.carve(fn, { parts: ['engineCover'], remove: true });
    pcs.hem(r.outside, { depth: 0.022, steps: 1, mat: 'carbon', part: 'engineCover' });
  }
  {
    const r = pcs.carve(slot(-1.31, -0.95, 0.30), { parts: ['engineCover'], toMat: 'glassEngine' });
    pcs.hem(r.outside, { depth: 0.022, steps: 1, mat: 'blackSatin', part: 'engineCover' });
  }
  pcs.offsetCopies(pcs.skin('engineCover', ['carbon']), -0.025, 'carbonMatte', 'engineCover', true);

  // ---------------- butterfly doors ----------------
  const doorSide = polygonSDF(smoothPolygon([[0.938, 0.165], [0.946, 0.60], [0.95, 0.84], [0.96, 1.6], [-0.318, 1.6], [-0.318, 0.92], [-0.30, 0.60], [-0.25, 0.20], [-0.21, 0.165]], 3));
  const zA = pchip([[1.10, 0.74], [0.95, 0.69], [0.80, 0.625], [0.62, 0.535], [0.48, 0.468], [0.40, 0.428], [0.30, 0.418], [0.0, 0.414], [-0.40, 0.414]]);
  const doorFn = (sgn) => (x, y, z) => Math.max(doorSide(x, y), zA(x) - az(z), -sgn * z + 0.05);
  const isGreen = (x, y, z, th = 0.014) => th - F.lower(x, y, z); // < 0 on the canopy (above the beltline)
  for (const [part, sgn] of [['doorR', 1], ['doorL', -1]]) {
    const r = pcs.carve(doorFn(sgn), { gap: 0.004, toPart: part });
    pcs.hem(r.outside, { depth: 0.075, steps: 2, mat: 'paintInner' });
    pcs.hem(r.inside, { depth: 0.055, steps: 2, mat: 'paint', part });
  }
  // door windows (DLO): canopy side glass outboard of the A-pillar trim, below the roof edge
  const dloFn = (x, y, z) => {
    const [fcs, fct] = F.canopyTerms(x, y, z);
    return Math.max(isGreen(x, y, z), zA(x) + 0.05 - az(z), fct - fcs + 0.02, -0.268 - x + 0, x - 0.93);
  };
  for (const part of ['doorR', 'doorL']) {
    const r = pcs.carve(dloFn, { parts: [part], toMat: 'glass' });
    pcs.hem(r.outside, { depth: 0.055, steps: 2, mat: 'blackSatin', part });
  }
  // door inner panels (door cards are added in interior.js on top of this shell)
  for (const part of ['doorR', 'doorL']) {
    pcs.offsetCopies(pcs.skin(part, ['paint']), -0.055, 'doorShell', part, true);
  }

  // ---------------- windscreen and quarter windows ----------------
  const xRF = (z) => 0.468 - 0.11 * (z / 0.45) * (z / 0.45);
  const wsFn = (m) => (x, y, z) => Math.max(isGreen(x, y, z, m > 0 ? 0.006 : 0.014), xRF(az(z)) - m - x, az(z) - (zA(x) - 0.052 + m));
  pcs.carve(wsFn(0.028), { toMat: 'blackGloss' });
  pcs.carve(wsFn(0.0), { mats: ['blackGloss'], toMat: 'glass' });

  // ---------------- material zones ----------------
  // grey carbon lower body between the wheels, rising toward the rear (reference side view)
  const cl = pchip([[0.98, 0.34], [0.6, 0.37], [0.0, 0.395], [-0.4, 0.43], [-0.7, 0.47], [-0.98, 0.50]]);
  const carbonFn = (x, y, z) => Math.max(y - cl(x), az(x) - 0.985, 0.70 - az(z));
  pcs.carve(carbonFn, { parts: ['body', 'doorL', 'doorR'], mats: ['paint'], toMat: 'carbon' });
  // dark carbon lower tail (diffuser side plates) and front corner ducts
  pcs.carve((x, y, z) => Math.max(x + 1.84, y - 0.47, 0.5 - az(z)), { mats: ['paint'], toMat: 'carbonMatte' });
  pcs.carve((x, y, z) => Math.max(1.96 - x, y - 0.40, 0.80 - az(z)), { mats: ['paint'], toMat: 'carbonMatte' });
  // carbon lower lip under the intakes, flowing into the splitter
  pcs.carve((x, y, z) => Math.max(1.9 - x, y - 0.14), { mats: ['paint'], toMat: 'carbonMatte' });
  // dark carbon cowl between the bonnet and the windscreen base (reference top view)
  pcs.carve((x, y, z) => Math.max(x - 1.398, 1.2 - x, az(z) - 0.64, 0.6 - y, F.lower(x, y, z) - 0.008), { parts: ['body'], mats: ['paint'], toMat: 'carbon' });
  // flush door handles
  const handleFn = (x, y, z) => Math.max(sdBox(x, y, -0.16, 0.792, 0.075, 0.011, 0.01), 0.75 - az(z));
  pcs.carve(handleFn, { parts: ['doorL', 'doorR'], mats: ['paint'], toMat: 'blackGloss' });

  const t1 = performance.now();
  return { pieces: pcs.list, timeMs: t1 - t0, functions: { zA, xRF, cl, grilleFn, headFn, hoodSDF, ventSDF, ecSDF } };
}
