// Carbon-fibre aerodynamics: front splitter with fences and dive planes, intake
// blades and honeycomb grille, Fontana venturi diffuser with fins and rain light,
// side skirts, Testarossa-inspired side strakes and the F40-type active rear wing.
// Parts that move with a panel (bonnet fins, engine-cover slats) are returned
// separately so car.js can parent them to the right pivot.
import * as THREE from 'three';
import { sweep, plate, grid, mesh, naca, mergeGeometries, fan, rod } from '../core/geo.js';
import { boxUV } from './materials.js';
import { PROFILES, SCOOP, COVER_SIDE, coverBump, sweepDepth, surfaceZ, surfaceY, surfaceX, surfaceYBottom } from './bodyShape.js';
import { smoothstep, clamp } from '../core/math.js';
import { sdPolygon, smoothPolygon } from '../core/sdf2d.js';

const UV = (g, s = 1) => boxUV(g, s);

function splitter(M) {
  const g = new THREE.Group(); g.name = 'FrontSplitter';
  const front = [];
  let lastX = 2.2;
  for (let z = -0.9; z <= 0.9001; z += 0.03) {
    let x = surfaceX(0.375, z, 1);
    if (x == null || x < 1.9) x = lastX - 0.03; else lastX = x;
    front.push([x + 0.005 - 0.03 * Math.pow(Math.abs(z) / 0.9, 4), z]);
  }
  const back = [[1.80, 0.88], [1.92, 0.5], [1.96, 0.0], [1.92, -0.5], [1.80, -0.88]];
  const poly = front.concat(back);
  const geo = plate(poly.map(([x, z]) => [x, z]), 0.014, 'xz');
  geo.translate(0, 0.098, 0);
  g.add(mesh(UV(geo, 1), M.carbonMatte, 'Splitter_Blade'));
  // corner dive planes (canards), two per side
  const dive = [];
  for (const s of [-1, 1]) {
    // a single canard on the bumper corner, below the corner duct (hero render)
    for (const [y, dx] of [[0.13, 0]]) {
      const zc = 0.90 * s;
      const x0 = (surfaceX(0.2, 0.84 * s, 1) ?? 2.1);
      const shape = [[0.015, 0], [-0.10 + dx, 0], [-0.085 + dx, 0.045 * s], [0.02, 0.018 * s]];
      const gg = plate(shape, 0.006, 'xz');
      gg.rotateZ(-0.12); // raise the trailing edge (about the canard's own root)
      gg.translate(x0, y, zc);
      dive.push(gg);
    }
  }
  g.add(mesh(UV(mergeGeometries(dive)), M.carbonMatte, 'DivePlanes'));
  return g;
}

function intake(M) {
  const g = new THREE.Group(); g.name = 'FrontIntake';
  // honeycomb grille surface, set back inside the opening
  const set = 0.07; // honeycomb close behind the openings so the mesh reads, as on the reference
  const geo = grid((u, v) => {
    const z = -0.9 + 1.8 * u, y = 0.125 + 0.27 * v;
    let x = surfaceX(y, clamp(z, -0.86, 0.86), 1) ?? 2.1;
    const k = smoothstep(0.6, 0.9, Math.abs(z));
    return [x - set - 0.06 * k, y, z * (1 - 0.02 * k)];
  }, 90, 14);
  g.add(mesh(geo, M.grilleFront, 'Intake_Honeycomb', { cast: false }));
  const back = grid((u, v) => {
    const z = -0.9 + 1.8 * u, y = 0.12 + 0.28 * v;
    let x = surfaceX(y, clamp(z, -0.86, 0.86), 1) ?? 2.1;
    return [x - set - 0.1, y, z * 0.98];
  }, 40, 6);
  g.add(mesh(back, M.cavity, 'Intake_Radiators', { cast: false }));
  // thin dark vertical slats in the centre intake + one carbon vane across each side intake
  const slats = [];
  // two bold carbon blades in the centre opening (front splitter/duct detail)
  for (const zc of [-0.11, 0.11]) {
    const outline = [];
    const ys = []; for (let y = 0.185; y <= 0.336; y += 0.025) ys.push(y);
    for (const y of ys) outline.push([(surfaceX(y, zc, 1) ?? 2.4) - 0.03, y]);
    for (const y of ys.slice().reverse()) outline.push([(surfaceX(y, zc, 1) ?? 2.4) - 0.14, y]);
    slats.push(plate(outline, 0.016, 'xy', zc, 0.002));
  }
  g.add(mesh(UV(mergeGeometries(slats)), M.carbon, 'Intake_CentreBlades'));
  return g;
}

function diffuser(M) {
  const g = new THREE.Group(); g.name = 'Diffuser';
  const x0 = -1.70, x1 = -2.06;
  const h = (az) => {
    // flat centre section, arched outer venturi tunnels
    if (az < 0.30) return 0.29;
    const q = clamp((az - 0.565) / 0.265, -1, 1);
    return 0.29 + 0.125 * (1 - q * q * q * q); // squarer "∩" tunnels
  };
  const ramp = (x, z) => { const t = smoothstep(x0, x1 + 0.03, x); return 0.098 + (h(Math.abs(z)) - 0.098) * Math.pow(t, 1.35); };
  const geo = grid((u, v) => { const x = x0 + (x1 - x0) * u, z = -0.81 + 1.62 * v; return [x, ramp(x, z), z]; }, 36, 120);
  geo.computeVertexNormals();
  const mat = M.carbonMatte.clone(); mat.side = THREE.DoubleSide;
  g.add(mesh(UV(geo), mat, 'Diffuser_Ramp'));
  // frame plates at the arch edges + two thin fins inside each tunnel (rear views, diffuser detail)
  const fins = [];
  for (const [azc, th] of [[0.815, 0.014], [0.655, 0.007], [0.49, 0.007], [0.315, 0.014]]) for (const sg of [-1, 1]) {
    const zc = sg * azc;
    const outline = [];
    const xs = [];
    for (let i = 0; i <= 16; i++) xs.push(x0 - 0.02 + (x1 - x0 + 0.02) * (i / 16));
    for (const x of xs) outline.push([x, ramp(x, zc) + 0.004]);
    for (const x of xs.slice().reverse()) outline.push([x, 0.105 + 0.03 * smoothstep(x0, x1, x)]);
    fins.push(plate(outline, th, 'xy', zc));
  }
  g.add(mesh(UV(mergeGeometries(fins)), M.carbon, 'Diffuser_Fins'));
  // carbon arch frames on the bumper face, tracing the tunnel exits
  const frames = [];
  for (const sg of [-1, 1]) {
    const sec = (u) => {
      const az = 0.315 + 0.5 * u, z = sg * az;
      const y = h(az) + 0.012;
      const x = (surfaceX(Math.min(y + 0.03, 0.46), z, -1) ?? -2.05) - 0.004;
      return [[x + 0.03, y - 0.03, z], [x - 0.012, y - 0.03, z], [x - 0.012, y + 0.012, z], [x + 0.03, y + 0.012, z]];
    };
    frames.push(sweep(sec, 40, { closed: true, caps: true }));
  }
  g.add(mesh(UV(mergeGeometries(frames)), M.carbon, 'Diffuser_ArchFrames'));
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
  // Testarossa blades: three body-coloured louvres across the dark scoop recess, converging
  // to the recess's pointed front tip and rising back to the unsculpted surface.
  const g = new THREE.Group(); g.name = 'SideStrakes';
  const offs = [-0.62, 0, 0.62];
  for (const s of [-1, 1]) {
    const geos = [];
    for (const o of offs) {
      const x0 = SCOOP.tip - 0.005, x1 = SCOOP.end + 0.012;
      const sec = (u) => {
        const x = x0 + (x1 - x0) * u;
        const t = clamp((x - SCOOP.tip) / (SCOOP.end - SCOOP.tip), 0, 1);
        const y = SCOOP.y(t) + o * SCOOP.h(t);
        const zf = surfaceZ(x, y) ?? 0.85;
        const k = smoothstep(0, 0.35, t);
        const zo = zf + sweepDepth(x, y) * 0.9 * k;
        const zi = zf - 0.035 * smoothstep(0, 0.2, t);
        const th = 0.010 + 0.012 * t;
        return [[x, y - th / 2, s * zi], [x, y - th / 2 + 0.003, s * zo], [x, y + th / 2, s * zo], [x, y + th / 2, s * zi]];
      };
      const geo = sweep(sec, 60, { closed: true, caps: true });
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
      // gull-wing: the outer thirds droop down to the end plates (reference rear views)
      return [xr * ca + yr * sa - sweepBack, -xr * sa + yr * ca + 0.01 * az * az - 0.06 * smoothstep(0.45, 1.0, az), z];
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
    const top = [[-1.66, 0.935], [-1.75, 0.95], [-1.90, 0.98], [-2.04, 1.005], [-2.115, 1.008], [-2.13, 0.99]];
    const base = [];
    for (let i = 0; i <= 8; i++) { const x = -2.10 + 0.22 * (i / 8); base.push([x, Math.max(0.82, (surfaceY(x, Math.abs(zc) - 0.01) ?? 0.84) - 0.02)]); }
    const outline = top.concat(base).concat([[-1.84, 0.93], [-1.70, 0.94]]);
    plates.push(plate(outline, 0.012, 'xy', zc, 0.002));
  }
  assembly.add(mesh(UV(mergeGeometries(plates)), M.carbon, 'Wing_EndPlates'));
  // swan-neck pylons
  const pyl = [];
  for (const s of [-1, 1]) {
    const zc = s * 0.30;
    const outline = [];
    const xs = [-1.79, -1.84, -1.90, -1.96, -2.0];
    for (const x of xs) outline.push([x, (surfaceY(x, 0.30) ?? 0.85) - 0.02]);
    outline.push([-1.99, 0.94], [-1.93, 1.0], [-1.86, 1.0], [-1.83, 0.96]);
    pyl.push(plate(outline, 0.016, 'xy', zc, 0.002));
  }
  assembly.add(mesh(UV(mergeGeometries(pyl)), M.carbon, 'Wing_Pylons'));
  return { assembly, pivot };
}

/** Bonnet Fluxus duct fins (parented to the bonnet). */
function hoodFins(M) {
  // Bold "fang" blades (Ducti Fluxus): flush with the bonnet at the rear, the top edge drops in a
  // concave sweep to a sharp point at the front of the opening; wedge section, knife-edged top.
  const geos = [];
  const fins = [[0.085, 1.928], [0.225, 1.905]]; // |z|, tip x
  for (const [az, xTip] of fins) for (const s of [-1, 1]) {
    const zc = s * az, x0 = 1.47, xs = 1.56, depth = 0.08;
    const sec = (u) => {
      const x = x0 + (xTip - x0) * u;
      const ys = (surfaceY(x, zc) ?? 0.7);
      const t = clamp((x - xs) / (xTip - xs), 0, 1);
      const yTop = ys + 0.004 - (depth - 0.002) * Math.pow(t, 1.25); // proud of the panel at the rear
      const yBot = ys - depth;
      const k = 1 - 0.85 * Math.pow(t, 3); // blade thins towards the point
      const wb = 0.03 * k, wt = 0.004 * k;
      return [[x, yBot, zc - wb], [x, yBot, zc + wb], [x, yTop - 0.004, zc + wt], [x, yTop, zc], [x, yTop - 0.004, zc - wt]];
    };
    geos.push(sweep(sec, 40, { closed: true, caps: true }));
  }
  return mesh(UV(mergeGeometries(geos), 6), M.ventFin, 'Fluxus_DuctFins');
}

/** Engine cover louvre slats (parented to the engine cover). */
function coverSlats(M) {
  const geos = [];
  const C = COVER_SIDE;
  const Y = (x, z) => (surfaceY(x, z) ?? 1.0) + coverBump(x, z);
  // two longitudinal slats across each side channel
  for (const sg of [-1, 1]) for (const f of [0.34, 0.68]) {
    const sec = (u) => {
      const x = C.x0 + 0.02 + (C.x1 - C.x0 - 0.04) * u;
      const z = sg * (C.zi(x) + (C.zo(x) - C.zi(x)) * f);
      const y = Y(x, z) - 0.01;
      return [[x, y - 0.004, z - 0.009], [x, y + 0.003, z - 0.004], [x, y + 0.003, z + 0.004], [x, y - 0.004, z + 0.009]];
    };
    geos.push(sweep(sec, 24, { closed: true, caps: true }));
  }
  // a thin raised lip along the rear edge of each tier (catches the light above the vent slot)
  for (const [xc, hw] of [[-1.123, 0.2], [-1.548, 0.17]]) {
    const sec = (u) => {
      const z = -hw + 2 * hw * u, y = Y(xc, z);
      return [[xc + 0.012, y - 0.002, z], [xc - 0.002, y - 0.004, z], [xc - 0.002, y + 0.004, z], [xc + 0.012, y + 0.002, z]];
    };
    geos.push(sweep(sec, 20, { closed: true, caps: true }));
  }
  return mesh(UV(mergeGeometries(geos)), M.carbonMatte, 'EngineCover_Slats');
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
