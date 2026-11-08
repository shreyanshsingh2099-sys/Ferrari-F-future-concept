// Carbon-fibre aerodynamics: front splitter with fences and dive planes, intake
// blades and honeycomb grille, Fontana venturi diffuser with fins and rain light,
// side skirts, Testarossa-inspired side strakes and the F40-type active rear wing.
// Parts that move with a panel (bonnet fins, engine-cover slats) are returned
// separately so car.js can parent them to the right pivot.
import * as THREE from 'three';
import { sweep, plate, grid, mesh, naca, mergeGeometries, fan, rod } from '../core/geo.js';
import { boxUV } from './materials.js';
import { PROFILES, surfaceZ, surfaceY, surfaceX, surfaceYBottom } from './bodyShape.js';
import { smoothstep, clamp } from '../core/math.js';
import { sdPolygon, smoothPolygon } from '../core/sdf2d.js';

const UV = (g, s = 1) => boxUV(g, s);

function splitter(M) {
  const g = new THREE.Group(); g.name = 'FrontSplitter';
  const front = [];
  let lastX = 2.2;
  for (let z = -0.9; z <= 0.9001; z += 0.03) {
    let x = surfaceX(0.16, z, 1);
    if (x == null || x < 1.9) x = lastX - 0.03; else lastX = x;
    front.push([x + 0.035 - 0.02 * Math.pow(Math.abs(z) / 0.9, 4), z]);
  }
  const back = [[1.80, 0.88], [1.92, 0.5], [1.96, 0.0], [1.92, -0.5], [1.80, -0.88]];
  const poly = front.concat(back);
  const geo = plate(poly.map(([x, z]) => [x, z]), 0.014, 'xz');
  geo.translate(0, 0.098, 0);
  g.add(mesh(UV(geo, 1), M.carbonMatte, 'Splitter_Blade'));
  // corner dive planes (canards), two per side
  const dive = [];
  for (const s of [-1, 1]) {
    for (const [y, dx] of [[0.22, 0], [0.30, -0.03]]) {
      const zc = 0.86 * s;
      const x0 = (surfaceX(y, zc, 1) ?? 2.1);
      const shape = [[0.02, 0], [-0.12 + dx, 0], [-0.1 + dx, 0.075 * s], [0.03, 0.03 * s]];
      const gg = plate(shape, 0.006, 'xz');
      gg.rotateZ(-0.12); // raise the trailing edge (about the canard's own root)
      gg.translate(x0, y, zc);
      dive.push(gg);
    }
  }
  g.add(mesh(UV(mergeGeometries(dive)), M.carbon, 'DivePlanes'));
  return g;
}

function intake(M) {
  const g = new THREE.Group(); g.name = 'FrontIntake';
  // honeycomb grille surface, set back inside the opening
  const set = 0.13;
  const geo = grid((u, v) => {
    const z = -0.9 + 1.8 * u, y = 0.125 + 0.27 * v;
    let x = surfaceX(y, clamp(z, -0.86, 0.86), 1) ?? 2.1;
    const k = smoothstep(0.6, 0.9, Math.abs(z));
    return [x - set - 0.06 * k, y, z * (1 - 0.02 * k)];
  }, 90, 14);
  g.add(mesh(geo, M.grille, 'Intake_Honeycomb', { cast: false }));
  const back = grid((u, v) => {
    const z = -0.9 + 1.8 * u, y = 0.12 + 0.28 * v;
    let x = surfaceX(y, clamp(z, -0.86, 0.86), 1) ?? 2.1;
    return [x - set - 0.1, y, z * 0.98];
  }, 40, 6);
  g.add(mesh(back, M.cavity, 'Intake_Radiators', { cast: false }));
  // carbon blades dividing the intake (centre / sides)
  const blades = [];
  for (const zc of [-0.82, -0.30, 0.30, 0.82]) {
    const pts = [];
    for (let y = 0.125; y <= 0.4; y += 0.025) pts.push(y);
    const outline = [];
    for (const y of pts) outline.push([(surfaceX(y, zc, 1) ?? 2.1) + 0.012, y]);
    for (const y of pts.slice().reverse()) outline.push([(surfaceX(y, zc, 1) ?? 2.1) - 0.2, y]);
    const b = plate(outline, 0.014, 'xy', zc);
    // angle the blades outward slightly
    blades.push(b);
  }
  g.add(mesh(UV(mergeGeometries(blades)), M.carbon, 'Intake_Blades'));
  // centre strake and badge plinth
  const cs = [];
  const csOutline = [];
  for (let y = 0.125; y <= 0.37; y += 0.03) csOutline.push([(surfaceX(y, 0, 1) ?? 2.4) - 0.005, y]);
  for (let y = 0.37; y >= 0.125; y -= 0.03) csOutline.push([(surfaceX(y, 0, 1) ?? 2.4) - 0.16, y]);
  cs.push(plate(csOutline, 0.01, 'xy', 0));
  g.add(mesh(UV(mergeGeometries(cs)), M.carbon, 'Intake_CentreStrake'));
  return g;
}

function diffuser(M) {
  const g = new THREE.Group(); g.name = 'Diffuser';
  const x0 = -1.70, x1 = -2.13;
  const h = (az) => {
    // tunnel roof heights: centre 0.33, outer tunnels 0.395
    const c = 0.33, o = 0.395;
    if (az < 0.24) return c;
    if (az < 0.30) return c + (o - c) * smoothstep(0.24, 0.30, az);
    if (az < 0.74) return o;
    return o - 0.05 * smoothstep(0.74, 0.82, az);
  };
  const ramp = (x, z) => { const t = smoothstep(x0, x1 + 0.03, x); return 0.098 + (h(Math.abs(z)) - 0.098) * Math.pow(t, 1.35); };
  const geo = grid((u, v) => { const x = x0 + (x1 - x0) * u, z = -0.81 + 1.62 * v; return [x, ramp(x, z), z]; }, 36, 120);
  geo.computeVertexNormals();
  const mat = M.carbonMatte.clone(); mat.side = THREE.DoubleSide;
  g.add(mesh(UV(geo), mat, 'Diffuser_Ramp'));
  // fins
  const fins = [];
  for (const zc of [-0.79, -0.63, -0.47, -0.27, 0.27, 0.47, 0.63, 0.79]) {
    const outline = [];
    const xs = [];
    for (let i = 0; i <= 16; i++) xs.push(x0 - 0.02 + (x1 - x0 + 0.02) * (i / 16));
    const curve = Math.abs(zc) > 0.4 && Math.abs(zc) < 0.7 ? 0.035 * Math.sign(zc) : 0;
    for (const x of xs) outline.push([x, ramp(x, zc) + 0.004]);
    for (const x of xs.slice().reverse()) outline.push([x, 0.105 + 0.03 * smoothstep(x0, x1, x)]);
    const f = plate(outline, 0.008, 'xy', zc);
    if (curve) { // curved inner fins (bend outward toward the trailing edge)
      const p = f.attributes.position;
      for (let i = 0; i < p.count; i++) { const t = smoothstep(x0, x1, p.getX(i)); p.setZ(i, p.getZ(i) + curve * t * t); }
      f.computeVertexNormals();
    }
    fins.push(f);
  }
  g.add(mesh(UV(mergeGeometries(fins)), M.carbon, 'Diffuser_Fins'));
  // rain / fog light in the centre section
  const lampX = (surfaceX(0.25, 0, -1) ?? -2.12) + 0.05;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.07), M.blackGloss);
  housing.position.set(lampX - 0.04, 0.245, 0);
  const lens = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.07, 0.055), M.ledRedDim);
  lens.position.set(lampX - 0.057, 0.245, 0); lens.name = 'RainLight';
  g.add(housing, lens);
  // trailing lip
  return g;
}

function sideSkirts(M) {
  const g = new THREE.Group(); g.name = 'SideSkirts';
  for (const s of [-1, 1]) {
    const xA = 0.92, xB = -0.93;
    const sec = (t) => {
      const x = xA + (xB - xA) * t;
      const zs = surfaceZ(x, 0.14) ?? 0.9;
      const taper = Math.min(1, Math.min(t, 1 - t) / 0.06);
      const out = 0.03 + 0.012 * taper;
      return [
        [x, 0.142, s * (zs - 0.02)], [x, 0.135, s * (zs + out * 0.6)], [x, 0.118, s * (zs + out)],
        [x, 0.104, s * (zs + out * 0.85)], [x, 0.098, s * (zs - 0.03)],
      ];
    };
    const geo = sweep(sec, 80, { closed: true, caps: true });
    if (s < 0) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; } geo.computeVertexNormals(); }
    g.add(mesh(UV(geo), M.carbon, s > 0 ? 'SideSkirt_R' : 'SideSkirt_L'));
  }
  return g;
}

function strakes(M) {
  // Testarossa-inspired blades running inside the side scoop
  const g = new THREE.Group(); g.name = 'SideStrakes';
  const blades = [[0.30, 0.30], [0.52, 0.12], [0.73, -0.08]]; // [height fraction, start x]
  for (const s of [-1, 1]) {
    const geos = [];
    for (const [v, xs] of blades) {
      const xe = -0.735;
      const sec = (t) => {
        const x = xs + (xe - xs) * t;
        const yb = PROFILES.scBot(x), yt = PROFILES.scTop(x);
        const y = yb + v * (yt - yb);
        const zf = surfaceZ(x, y) ?? 0.85;
        const d = (x < 0.78 ? PROFILES.scDepth(x) : 0) * (0.25 + 0.75 * Math.sin(Math.min(1, v * 1.2) * Math.PI / 2));
        const tip = smoothstep(0, 0.18, t);
        const zo = zf + d * 0.92 * tip;
        const th = 0.008 + 0.01 * tip;
        return [[x, y - th / 2, s * (zf - 0.01)], [x, y - th / 2 + 0.006 * tip, s * zo], [x, y + th / 2 + 0.008 * tip, s * zo], [x, y + th / 2, s * (zf - 0.01)]];
      };
      const geo = sweep(sec, 48, { closed: true, caps: true });
      if (s > 0) { const idx = geo.index.array; for (let i = 0; i < idx.length; i += 3) { const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp; } geo.computeVertexNormals(); }
      geos.push(geo);
    }
    g.add(mesh(mergeGeometries(geos), M.paint, s > 0 ? 'Strakes_R' : 'Strakes_L'));
  }
  return g;
}

function scoopGrilles(M) {
  // honeycomb radiator grilles set just inside the scoop mouths and lower intakes
  const g = new THREE.Group(); g.name = 'ScoopGrilles';
  for (const s of [-1, 1]) {
    const geo = grid((u, v) => {
      const x = -0.705 - 0.17 * u;
      const yb = PROFILES.scBot(x) + 0.01, yt = PROFILES.scTop(x) - 0.01;
      const y = yb + (yt - yb) * v;
      const z = (surfaceZ(-0.70, y) ?? 0.85) - 0.05 - 0.12 * u;
      return [x, y, s * z];
    }, 12, 10);
    g.add(mesh(geo, M.grille, 'ScoopGrille_' + (s > 0 ? 'R' : 'L'), { cast: false }));
    const geo2 = grid((u, v) => {
      const x = -0.895 - 0.08 * u;
      const y = 0.13 + (PROFILES.liTop(x) - 0.17) * v;
      const z = (surfaceZ(-0.90, y) ?? 0.9) - 0.04 - 0.08 * u;
      return [x, y, s * z];
    }, 8, 8);
    g.add(mesh(geo2, M.grille, 'LowerIntakeGrille_' + (s > 0 ? 'R' : 'L'), { cast: false }));
  }
  return g;
}

function wing(M) {
  const assembly = new THREE.Group(); assembly.name = 'RearWing';
  const plane = new THREE.Group(); plane.name = 'RearWing_MainPlane';
  const LE = new THREE.Vector3(-1.70, 0.952, 0);
  const chord = 0.36, aoa = THREE.MathUtils.degToRad(9);
  // inverted (downforce) cambered section, trailing edge raised
  const foil = naca(0.06, 0.4, 0.1, 22).map(([x, y]) => [-x * chord, -y * chord]);
  const span = 0.86;
  const sec = (t) => {
    const z = -span + 2 * span * t;
    const az = Math.abs(z) / span;
    const sweepBack = 0.05 * az * az; // slight sweep at the tips
    const c = 1 - 0.08 * az * az;
    return foil.map(([x, y]) => {
      const xr = x * c, yr = y * c;
      const ca = Math.cos(aoa), sa = Math.sin(aoa);
      return [xr * ca + yr * sa - sweepBack, -xr * sa + yr * ca + 0.01 * az * az, z];
    });
  };
  const wingGeo = sweep(sec, 60, { closed: true, caps: true, smoothAcross: true });
  plane.add(mesh(UV(wingGeo, 1), M.carbon, 'Wing_MainPlane'));
  // gurney flap
  const gurney = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, 2 * span * 0.98), M.carbon);
  gurney.position.set(-chord * Math.cos(aoa) - 0.004, chord * Math.sin(aoa) + 0.012, 0);
  gurney.name = 'Wing_Gurney';
  plane.add(gurney);
  plane.position.copy(LE);
  // pivot for the active mode
  const pivot = new THREE.Group(); pivot.name = 'RearWing_Active';
  pivot.add(plane);
  assembly.add(pivot);
  // end plates (F40-style): slim plates around the wing tips, rooted on the rear haunches
  const plates = [];
  for (const sg of [-1, 1]) {
    const zc = sg * 0.872;
    const top = [[-1.66, 0.985], [-1.75, 1.0], [-1.90, 1.03], [-2.04, 1.058], [-2.115, 1.06], [-2.13, 1.04]];
    const base = [];
    for (let i = 0; i <= 8; i++) { const x = -2.10 + 0.22 * (i / 8); base.push([x, Math.max(0.82, (surfaceY(x, Math.abs(zc) - 0.01) ?? 0.84) - 0.02)]); }
    const outline = top.concat(base).concat([[-1.84, 0.93], [-1.70, 0.94]]);
    plates.push(plate(outline, 0.012, 'xy', zc, 0.002));
  }
  assembly.add(mesh(UV(mergeGeometries(plates)), M.carbon, 'Wing_EndPlates'));
  // swan-neck pylons
  const pyl = [];
  for (const s of [-1, 1]) {
    const zc = s * 0.43;
    const outline = [];
    const xs = [-1.79, -1.84, -1.90, -1.96, -2.0];
    for (const x of xs) outline.push([x, (surfaceY(x, 0.43) ?? 0.85) - 0.02]);
    outline.push([-1.99, 0.94], [-1.93, 1.0], [-1.86, 1.0], [-1.83, 0.96]);
    pyl.push(plate(outline, 0.016, 'xy', zc, 0.002));
  }
  assembly.add(mesh(UV(mergeGeometries(pyl)), M.carbon, 'Wing_Pylons'));
  return { assembly, pivot };
}

/** Bonnet Fluxus duct fins (parented to the bonnet). */
function hoodFins(M) {
  const geos = [];
  for (const zc of [-0.2, -0.07, 0.07, 0.2]) {
    const xs = []; for (let i = 0; i <= 14; i++) xs.push(1.505 + (1.86 - 1.505) * (i / 14));
    const outline = [];
    for (const x of xs) {
      const y = (surfaceY(x, zc) ?? 0.7);
      const t = smoothstep(1.62, 1.86, x); // front part tapers into a fang
      outline.push([x, y - 0.006 - t * 0.06]);
    }
    for (const x of xs.slice().reverse()) outline.push([x, (surfaceY(x, zc) ?? 0.7) - 0.078]);
    geos.push(plate(outline, 0.011, 'xy', zc, 0.0015));
  }
  return mesh(UV(mergeGeometries(geos)), M.carbonMatte, 'Fluxus_DuctFins');
}

/** Engine cover louvre slats (parented to the engine cover). */
function coverSlats(M) {
  const geos = [];
  for (const [x0, x1, w] of [[-0.87, -0.64, 0.30], [-1.69, -1.43, 0.26]]) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) / n) * (x1 - x0);
      const y = (surfaceY(x, 0) ?? 1.0) - 0.016;
      const b = new THREE.BoxGeometry(0.05, 0.005, 2 * w - 0.04);
      b.rotateZ(-0.6);
      b.translate(x, y, 0);
      geos.push(b);
    }
  }
  return mesh(UV(mergeGeometries(geos)), M.carbon, 'EngineCover_Louvres');
}

export function buildAero(M) {
  const group = new THREE.Group(); group.name = 'Aero';
  group.add(splitter(M));
  group.add(intake(M));
  group.add(diffuser(M));
  group.add(sideSkirts(M));
  group.add(strakes(M));
  group.add(scoopGrilles(M));
  const w = wing(M);
  group.add(w.assembly);
  group.traverse((o) => { if (o.isMesh) { o.castShadow ??= true; o.receiveShadow = true; } });
  return {
    group,
    wing: w.assembly,
    hoodFins: hoodFins(M),
    coverSlats: coverSlats(M),
    setWing(e) {
      // active aero: raise and increase incidence ("deportanza variabile")
      w.pivot.position.y = 0.055 * e;
      w.pivot.position.x = -0.02 * e;
      const plane = w.pivot.children[0];
      plane.rotation.z = THREE.MathUtils.degToRad(-14) * e;
    },
  };
}
