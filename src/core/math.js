// Small numeric toolkit shared by the procedural generators.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Polynomial smooth max / min (C1). k is the blend radius in field units.
export function smax(a, b, k) {
  if (k <= 0) return a > b ? a : b;
  const h = clamp(0.5 - (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h + k * h * (1 - h);
}
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

/**
 * Monotone piecewise-cubic Hermite interpolation (Fritsch–Carlson).
 * pts: [[x, y], ...] in any order. Values are clamped outside the range.
 * Returns f(x). f.deriv(x) gives the derivative.
 */
export function pchip(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]);
  const n = p.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = p[i][0]; ys[i] = p[i][1]; }
  const h = new Float64Array(n - 1), d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Float64Array(n);
  if (n === 2) { m[0] = m[1] = d[0]; }
  else {
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
  }
  function seg(x) {
    let lo = 0, hi = n - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid - 1; }
    return lo;
  }
  const f = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    const i = seg(x);
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
  f.deriv = (x) => {
    if (x <= xs[0] || x >= xs[n - 1]) return 0;
    const i = seg(x);
    const t = (x - xs[i]) / h[i], t2 = t * t;
    return ((6 * t2 - 6 * t) * ys[i] + (3 * t2 - 4 * t + 1) * h[i] * m[i] + (-6 * t2 + 6 * t) * ys[i + 1] + (3 * t2 - 2 * t) * h[i] * m[i + 1]) / h[i];
  };
  f.xmin = xs[0]; f.xmax = xs[n - 1];
  return f;
}

/** Catmull-Rom (centripetal-free, uniform) sampling of a 2D/3D polyline into a smooth curve. */
export function catmullRom(points, samplesPerSeg = 8, closed = false) {
  const out = [];
  const n = points.length;
  const get = (i) => {
    if (closed) return points[(i + n) % n];
    return points[clamp(i, 0, n - 1)];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const pt = [];
      for (let k = 0; k < p1.length; k++) {
        pt.push(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      }
      out.push(pt);
    }
  }
  if (!closed) out.push(points[n - 1].slice());
  return out;
}

export const deg = (d) => (d * Math.PI) / 180;
