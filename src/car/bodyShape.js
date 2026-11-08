// Implicit (signed-field) definition of the F-Future body shell.
//
// The body is composed from "heightfield" fields authored directly from the
// reference views, combined with smooth max/min so that every transition
// (shoulders, beltline, windscreen base, nose and tail) gets a controlled fillet:
//
//   lower body  = side wall |z| < Wside(x,y)   (plan + section, side-view sculpting)
//               ∩ top surface y < Ytop(x,z)    (hood valley, fender peaks, haunches)
//               ∩ floor y > Ybot(x)
//   canopy      = glass-house sides (tumblehome) ∩ roof / windscreen / fastback
//   body        = (lower ∪ canopy) ∩ nose plane ∩ tail plane
//
// All x-dependent quantities are evaluated once per cross-section (params(x)),
// and field(P, y, z) is evaluated many times inside that section by the mesher.
import { pchip, smax, smin, smoothstep, clamp } from '../core/math.js';
import { DIMS } from './dims.js';

const P_ = (pts) => pchip(pts);

export const PROFILES = {
  // plan half width (widest point of each section)
  W: P_([[2.455, 0.20], [2.445, 0.30], [2.43, 0.385], [2.40, 0.47], [2.36, 0.548], [2.31, 0.622], [2.26, 0.69], [2.21, 0.752], [2.16, 0.808], [2.11, 0.853], [2.06, 0.887], [2.0, 0.913], [1.90, 0.940], [1.75, 0.962], [1.55, 0.974], [1.35, 0.977], [1.15, 0.972], [1.0, 0.962], [0.85, 0.952], [0.6, 0.944], [0.3, 0.940], [0.0, 0.940], [-0.3, 0.946], [-0.55, 0.962], [-0.8, 0.982], [-1.05, 0.995], [-1.3, 1.0], [-1.55, 0.998], [-1.75, 0.990], [-1.9, 0.976], [-2.0, 0.956], [-2.06, 0.93], [-2.10, 0.89], [-2.125, 0.83]]),
  // fender-peak / beltline / haunch crest height
  hf: P_([[2.455, 0.392], [2.40, 0.425], [2.30, 0.468], [2.22, 0.505], [2.16, 0.543], [2.10, 0.585], [2.03, 0.62], [1.97, 0.643], [1.90, 0.667], [1.84, 0.689], [1.78, 0.711], [1.72, 0.73], [1.65, 0.751], [1.59, 0.767], [1.52, 0.782], [1.46, 0.792], [1.40, 0.800], [1.33, 0.808], [1.27, 0.812], [1.18, 0.813], [1.08, 0.816], [0.95, 0.832], [0.75, 0.862], [0.40, 0.878], [0.0, 0.893], [-0.30, 0.905], [-0.48, 0.908], [-0.68, 0.893], [-0.90, 0.876], [-1.10, 0.867], [-1.40, 0.862], [-1.70, 0.862], [-1.95, 0.860], [-2.05, 0.855], [-2.125, 0.845]]),
  // hood valley / deck centre height (below the canopy)
  hc: P_([[2.455, 0.385], [2.40, 0.412], [2.30, 0.455], [2.20, 0.50], [2.10, 0.545], [2.00, 0.585], [1.90, 0.62], [1.80, 0.645], [1.70, 0.664], [1.60, 0.679], [1.50, 0.691], [1.40, 0.701], [1.30, 0.709], [1.10, 0.72], [0.5, 0.74], [-0.5, 0.76], [-1.0, 0.775], [-1.5, 0.80], [-1.85, 0.825], [-2.05, 0.835], [-2.125, 0.83]]),
  // lateral position of the crest
  zf: P_([[2.455, 0.30], [2.38, 0.45], [2.30, 0.555], [2.20, 0.635], [2.10, 0.69], [1.95, 0.73], [1.80, 0.752], [1.55, 0.77], [1.35, 0.775], [1.20, 0.765], [1.05, 0.742], [0.92, 0.716], [0.75, 0.702], [0.3, 0.697], [-0.2, 0.697], [-0.45, 0.70], [-0.65, 0.74], [-0.9, 0.79], [-1.2, 0.81], [-1.6, 0.812], [-1.9, 0.80], [-2.05, 0.78], [-2.125, 0.74]]),
  // curvature of the fall-off outboard of the crest (towards the side wall)
  kout: P_([[2.455, 3.0], [2.2, 2.6], [1.9, 2.2], [1.5, 2.0], [1.2, 2.2], [1.0, 3.0], [0.8, 4.0], [0.0, 4.5], [-0.45, 4.2], [-0.7, 3.2], [-1.0, 2.4], [-1.5, 2.2], [-2.0, 2.4], [-2.125, 2.6]]),
  // height of maximum width and the section tuck above/below it
  ym: P_([[2.455, 0.28], [2.2, 0.33], [1.8, 0.42], [1.35, 0.47], [0.9, 0.48], [0.0, 0.46], [-0.9, 0.50], [-1.35, 0.52], [-2.0, 0.48], [-2.125, 0.45]]),
  aUp: P_([[2.4, 0.25], [0, 0.30], [-2.1, 0.25]]),
  aDn: P_([[2.4, 0.35], [1.0, 0.45], [-1.0, 0.45], [-2.1, 0.35]]),
  ybot: P_([[2.455, 0.15], [2.3, 0.135], [2.0, 0.118], [1.7, 0.108], [1.0, 0.098], [-1.0, 0.098], [-1.6, 0.11], [-1.9, 0.13], [-2.125, 0.16]]),
  kSh: P_([[2.4, 0.05], [1.8, 0.06], [1.3, 0.065], [1.0, 0.05], [0.6, 0.04], [0.0, 0.04], [-0.5, 0.05], [-1.0, 0.07], [-1.6, 0.07], [-2.1, 0.06]]),

  // ---- canopy ----
  roof: P_([[2.0, 0.30], [1.6, 0.565], [1.40, 0.672], [1.31, 0.715], [1.20, 0.766], [1.08, 0.822], [0.95, 0.880], [0.83, 0.934], [0.70, 0.990], [0.57, 1.047], [0.47, 1.090], [0.38, 1.118], [0.27, 1.137], [0.15, 1.150], [0.05, 1.156], [-0.07, 1.153], [-0.20, 1.143], [-0.32, 1.129], [-0.45, 1.113], [-0.57, 1.100], [-0.70, 1.084], [-0.82, 1.062], [-0.95, 1.033], [-1.07, 1.003], [-1.20, 0.976], [-1.33, 0.947], [-1.45, 0.923], [-1.55, 0.907], [-1.70, 0.887], [-1.85, 0.868], [-1.95, 0.845], [-2.10, 0.72]]),
  crown: P_([[1.6, 0.06], [1.0, 0.056], [0.5, 0.05], [0.3, 0.042], [-0.4, 0.04], [-1.0, 0.036], [-1.8, 0.03]]),
  wb: P_([[1.6, 0.58], [1.3, 0.64], [1.1, 0.672], [0.9, 0.69], [0.5, 0.70], [0.0, 0.70], [-0.35, 0.695], [-0.6, 0.665], [-0.85, 0.605], [-1.1, 0.552], [-1.4, 0.50], [-1.7, 0.465], [-2.0, 0.44]]),
  tanT: P_([[1.5, 0.75], [0.9, 0.72], [0.3, 0.72], [-0.3, 0.70], [-0.7, 0.55], [-1.2, 0.45], [-2.0, 0.40]]),
  ybRef: P_([[1.6, 0.80], [1.27, 0.812], [1.0, 0.82], [0.75, 0.862], [0.4, 0.878], [0.0, 0.893], [-0.3, 0.905], [-0.5, 0.903], [-0.75, 0.87], [-1.0, 0.845], [-1.5, 0.835], [-2.0, 0.84]]),
  kBelt: P_([[1.6, 0.05], [1.3, 0.04], [1.05, 0.03], [0.9, 0.012], [0.3, 0.008], [-0.3, 0.008], [-0.5, 0.02], [-0.8, 0.05], [-1.2, 0.06], [-2.0, 0.05]]),
  kRoof: P_([[1.3, 0.06], [0.5, 0.06], [0.0, 0.06], [-0.6, 0.07], [-1.5, 0.08]]),

  // ---- side sculpture: "Testarossa" scoop behind the door ----
  scTop: P_([[0.78, 0.772], [0.4, 0.803], [0.0, 0.842], [-0.4, 0.884], [-0.74, 0.912], [-0.9, 0.92]]),
  scBot: P_([[0.78, 0.772], [0.5, 0.705], [0.2, 0.66], [-0.2, 0.643], [-0.74, 0.64], [-0.9, 0.64]]),
  scDepth: P_([[0.78, 0.0], [0.5, 0.022], [0.2, 0.048], [-0.2, 0.072], [-0.5, 0.092], [-0.72, 0.105], [-0.80, 0.06], [-0.86, 0.0]]),

  // ---- lower side intake ahead of the rear wheel ----
  liTop: P_([[-0.42, 0.20], [-0.6, 0.31], [-0.8, 0.38], [-0.98, 0.42]]),
  liDepth: P_([[-0.40, 0.0], [-0.6, 0.035], [-0.85, 0.075], [-0.93, 0.085], [-0.985, 0.0]]),
};

const PR = PROFILES;
const KNOSE = 0.05, KTAIL = 0.05;

/** Evaluate all x-dependent parameters of a cross-section. */
export function params(x) {
  const P = {
    x,
    W: PR.W(x), Wp: PR.W.deriv(x),
    hf: PR.hf(x), hc: PR.hc(x), zf: PR.zf(x), kout: PR.kout(x),
    hfp: PR.hf.deriv(x),
    ym: PR.ym(x), aUp: PR.aUp(x), aDn: PR.aDn(x), ybot: PR.ybot(x), kSh: PR.kSh(x),
    roof: PR.roof(x), roofP: PR.roof.deriv(x), crown: PR.crown(x), wb: PR.wb(x), tanT: PR.tanT(x),
    yb: PR.ybRef(x), kBelt: PR.kBelt(x), kRoof: PR.kRoof(x),
    scTop: PR.scTop(x), scBot: PR.scBot(x), scD: x < 0.78 && x > -0.86 ? PR.scDepth(x) : 0,
    liTop: PR.liTop(x), liD: x < -0.40 && x > -0.985 ? PR.liDepth(x) : 0,
    fFront: x - DIMS.XTIP,
    fRear: DIMS.XTAIL - x,
  };
  P.wNorm = Math.sqrt(1 + P.Wp * P.Wp);
  P.tNorm = Math.sqrt(1 + P.tanT * P.tanT);
  return P;
}

/** depth of the side sculpture at height y for section P */
function sideCut(P, y) {
  let d = 0;
  if (P.scD > 0) {
    const h = P.scTop - P.scBot;
    if (h > 1e-4) {
      const v = (y - P.scBot) / h;
      if (v > -0.05 && v < 1.0) {
        const s = smoothstep(-0.05, 0.72, v) * (1 - smoothstep(0.86, 1.0, v));
        d += P.scD * s;
      }
    }
  }
  if (P.liD > 0) {
    const v = (y - 0.06) / (P.liTop - 0.06);
    if (v < 1.0) {
      const s = smoothstep(-0.2, 0.5, v) * (1 - smoothstep(0.82, 1.0, v));
      d += P.liD * s;
    }
  }
  return d;
}

/** Top surface height of the lower body at |z| (and slope dY/d|z|). */
function lowerTop(P, az) {
  const t = az / P.zf;
  if (t <= 1) {
    const s = t * t * (3 - 2 * t);
    return [P.hc + (P.hf - P.hc) * s, ((P.hf - P.hc) * 6 * t * (1 - t)) / P.zf];
  }
  const d = az - P.zf;
  return [P.hf - P.kout * d * d, -2 * P.kout * d];
}

export function fieldLower(P, y, z) {
  const az = Math.abs(z);
  const [yt, dyt] = lowerTop(P, az);
  const fTop = (y - yt) / Math.sqrt(1 + dyt * dyt + P.hfp * P.hfp * 0.25);
  const dy = y - P.ym;
  let ws = P.W - (dy > 0 ? P.aUp * dy * dy : P.aDn * dy * dy);
  ws -= sideCut(P, y);
  const fSide = (az - ws) / P.wNorm;
  const fBot = P.ybot - y;
  let f = smax(fSide, fTop, P.kSh);
  f = smax(f, fBot, 0.035);
  return f;
}

export function fieldCanopy(P, y, z) {
  const az = Math.abs(z);
  const wcs = P.wb + P.tanT * (P.yb - y);
  const fcs = (az - wcs) / P.tNorm;
  const zz = az / 0.5;
  const ycab = P.roof - P.crown * zz * zz;
  const dz = (2 * P.crown * az) / 0.25;
  const fct = (y - ycab) / Math.sqrt(1 + P.roofP * P.roofP + dz * dz);
  let f = smax(fcs, fct, P.kRoof);
  f = smax(f, P.yb - 0.30 - y, 0.05);
  return f;
}

export function field(P, y, z) {
  const lo = fieldLower(P, y, z);
  const ca = fieldCanopy(P, y, z);
  let f = smin(lo, ca, P.kBelt);
  f = smax(f, P.fFront, KNOSE);
  f = smax(f, P.fRear, KTAIL);
  return f;
}

/** Convenience 3D evaluation (slow path; caches nothing). */
export function field3(x, y, z) { return field(params(x), y, z); }
export function fieldLower3(x, y, z) { return fieldLower(params(x), y, z); }
export function fieldCanopy3(x, y, z) { return fieldCanopy(params(x), y, z); }

/** Simple per-x parameter cache for repeated 3D queries (e.g. classification). */
export function makeFieldCache(step = 0.002) {
  const cache = new Map();
  const get = (x) => {
    const k = Math.round(x / step);
    let p = cache.get(k);
    if (!p) { p = params(k * step); cache.set(k, p); }
    return p;
  };
  return {
    field: (x, y, z) => field(get(x), y, z),
    lower: (x, y, z) => fieldLower(get(x), y, z),
    canopy: (x, y, z) => fieldCanopy(get(x), y, z),
    params: get,
  };
}
