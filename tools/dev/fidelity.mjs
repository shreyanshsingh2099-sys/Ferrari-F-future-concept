// Quantitative fidelity check: generated side silhouette & plan outline vs. the
// points measured off the orthographic reference sheet (src/car/dims.js).
import { meshBody } from '../../src/car/bodyMesher.js';
import { REF_SIDE_TOP, REF_PLAN, DIMS } from '../../src/car/dims.js';
const m = meshBody({});
const P = m.pos;
const top = new Map(), half = new Map();
for (let i = 0; i < P.length; i += 3) {
  const k = Math.round(P[i] * 200) / 200; // 5 mm buckets
  top.set(k, Math.max(top.get(k) ?? -9, P[i + 1]));
  half.set(k, Math.max(half.get(k) ?? 0, Math.abs(P[i + 2])));
}
const near = (map, x) => { let best = null, bd = 1; for (const [k, v] of map) { const d = Math.abs(k - x); if (d < bd) { bd = d; best = v; } } return best; };
const stats = (pairs) => { const d = pairs.map(([a, b]) => Math.abs(a - b)); d.sort((a, b) => a - b); return { n: d.length, mean: (d.reduce((s, v) => s + v, 0) / d.length * 1000).toFixed(1) + ' mm', p90: (d[Math.floor(d.length * 0.9)] * 1000).toFixed(1) + ' mm', max: (d[d.length - 1] * 1000).toFixed(1) + ' mm' }; };
const side = REF_SIDE_TOP.map(([x, y]) => [near(top, x), y]);
const plan = REF_PLAN.map(([x, w]) => [near(half, x), w]);
const b = m.computeBounds();
console.log(JSON.stringify({
  sideSilhouette: stats(side), planOutline: stats(plan),
  length: (b.max[0] - b.min[0]).toFixed(3), width: (2 * b.max[2]).toFixed(3), height: b.max[1].toFixed(3),
  wheelbase: (DIMS.XF - DIMS.XR).toFixed(2),
}, null, 1));
if (process.env.DETAIL) {
  side.forEach(([a, r], i) => { if (Math.abs(a - r) > 0.015) console.log('side x', REF_SIDE_TOP[i][0], 'model', a.toFixed(3), 'ref', r); });
  plan.forEach(([a, r], i) => { if (Math.abs(a - r) > 0.025) console.log('plan x', REF_PLAN[i][0], 'model', a.toFixed(3), 'ref', r); });
}
