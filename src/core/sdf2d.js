// 2D signed distance functions (negative inside). Used as trim curves for
// clipping the body surface along exact panel lines in a given projection.
import { smin, smax } from './math.js';

export function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

export function sdBox(px, py, cx, cy, hx, hy, r = 0) {
  const dx = Math.abs(px - cx) - hx + r, dy = Math.abs(py - cy) - hy + r;
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

export function sdEllipseApprox(px, py, cx, cy, rx, ry) {
  const x = (px - cx) / rx, y = (py - cy) / ry;
  const k = Math.hypot(x, y);
  // first-order distance approximation
  const g = Math.hypot(x / rx, y / ry) || 1e-9;
  return (k * (k - 1)) / g;
}

export function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** Exact signed distance to a simple polygon [[x,y],...]. */
export function sdPolygon(px, py, poly) {
  const n = poly.length;
  let d = Infinity, s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const vi = poly[i], vj = poly[j];
    const ex = vj[0] - vi[0], ey = vj[1] - vi[1];
    const wx = px - vi[0], wy = py - vi[1];
    const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * h, by = wy - ey * h;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= vi[1], c2 = py < vj[1], c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** Polygon with rounded corners: build the polygon, then offset. */
export function makeRoundedPolygon(poly, r) {
  // Shrink by r then inflate by r gives rounded convex corners. We approximate by
  // using the exact polygon SDF minus r on an inset polygon.
  const inset = insetPolygon(poly, r);
  return (px, py) => sdPolygon(px, py, inset) - r;
}

export function insetPolygon(poly, r) {
  // signed area to know orientation
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i++) area += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  const sgn = area > 0 ? 1 : -1; // >0 => clockwise in y-up
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e0 = norm2(p1[0] - p0[0], p1[1] - p0[1]), e1 = norm2(p2[0] - p1[0], p2[1] - p1[1]);
    // inward normals (for CCW polygon inward is left)
    const n0 = [-e0[1] * -sgn, e0[0] * -sgn], n1 = [-e1[1] * -sgn, e1[0] * -sgn];
    let bx = n0[0] + n1[0], by = n0[1] + n1[1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const cosHalf = Math.max(0.2, bx * n0[0] + by * n0[1]);
    out.push([p1[0] + (bx * r) / cosHalf, p1[1] + (by * r) / cosHalf]);
  }
  return out;
}
function norm2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

export const opUnion = Math.min;
export const opIntersect = Math.max;
export const opSubtract = (a, b) => Math.max(a, -b);
export { smin as opSmoothUnion, smax as opSmoothIntersect };

/** Build a closed smooth polygon from control points via Catmull-Rom. */
export function smoothPolygon(ctrl, samples = 10) {
  const out = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return out;
}

/** Accelerated polygon SDF: precomputes a bbox; outside bbox+margin returns cheap bound. */
export function polygonSDF(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const fn = (px, py) => {
    const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1);
    const bd = Math.hypot(dx, dy);
    if (bd > 0.05) return bd; // lower bound is enough far away
    return sdPolygon(px, py, poly);
  };
  fn.poly = poly;
  return fn;
}
