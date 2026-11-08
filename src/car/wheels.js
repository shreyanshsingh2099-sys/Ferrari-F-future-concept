// Wheels: twisted five-spoke forged rims (21" front / 22" rear), low-profile tyres
// with tread grooves and sidewall lettering, cross-drilled carbon-ceramic discs,
// aluminium bells, monobloc calipers, centre-lock hubs with yellow caps.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS } from './dims.js';

/** Revolve a (radius, axial) profile around the local Z axis. */
function lathe(profile, segments = 96, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, h]) => new THREE.Vector2(r, h));
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z
  return g;
}

/** Sweep a set of face strips: section(s) returns an array of [x,y,z] points across. */
function sweepStrips(section, steps, closed = true, sharp = true) {
  const pos = [], idx = [];
  const secs = [];
  for (let i = 0; i <= steps; i++) secs.push(section(i / steps));
  const n = secs[0].length;
  const edges = closed ? n : n - 1;
  for (let e = 0; e < edges; e++) {
    const a = e, b = (e + 1) % n;
    const base = pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      pos.push(...secs[i][a], ...secs[i][b]);
    }
    for (let i = 0; i < steps; i++) {
      const p = base + i * 2;
      idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function capPolygon(points3, flip = false) {
  // fan triangulation of a convex polygon
  const pos = [], idx = [];
  for (const p of points3) pos.push(...p);
  for (let i = 1; i < points3.length - 1; i++) flip ? idx.push(0, i + 1, i) : idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function discHoleTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024);
  x.fillStyle = '#000';
  const cx = 512, cy = 512;
  for (let ring = 0; ring < 3; ring++) {
    const r = 330 + ring * 52;
    const n = 36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.09 + (ring * ring) * 0.02;
      x.beginPath(); x.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 9, 0, Math.PI * 2); x.fill();
    }
  }
  // curved vent slots
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 4;
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; x.beginPath(); x.arc(cx, cy, 470, a, a + 0.12); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeRim(spec, M) {
  const g = new THREE.Group();
  const W = spec.width, R = spec.rimR;
  const face = W / 2 - 0.012; // axial position of the rim lip (outboard)
  // barrel + lip profile (r, h): from inboard flange to outboard lip, then the inside of the barrel back
  const barrel = lathe([
    [R + 0.012, -W / 2 + 0.004], [R + 0.016, -W / 2 + 0.012], [R - 0.004, -W / 2 + 0.018], [R - 0.012, -W / 2 + 0.06],
    [R - 0.016, 0.0], [R - 0.012, face - 0.05], [R - 0.004, face - 0.02], [R + 0.006, face - 0.004], [R + 0.018, face + 0.002],
    [R + 0.02, face + 0.008], [R + 0.012, face + 0.012], [R - 0.008, face + 0.006], [R - 0.022, face - 0.012], [R - 0.03, face - 0.05],
    [R - 0.034, 0.0], [R - 0.03, -W / 2 + 0.05], [R - 0.022, -W / 2 + 0.012],
  ], 120);
  const barrelMesh = new THREE.Mesh(barrel, M.rim); barrelMesh.name = 'RimBarrel';
  g.add(barrelMesh);
  // machined lip highlight ring
  const lip = new THREE.Mesh(lathe([[R + 0.019, face + 0.004], [R + 0.021, face + 0.008], [R + 0.013, face + 0.0125], [R + 0.004, face + 0.011]], 120), M.rimMachined);
  lip.name = 'RimLipMachined';
  g.add(lip);

  // twisted spokes
  const nSp = 5;
  const rHub = 0.072, rOut = R - 0.018;
  const twist = 0.46; // radians of sweep from hub to rim
  const spokeGeo = [];
  const edgeGeo = [];
  for (let k = 0; k < nSp; k++) {
    const th0 = (k / nSp) * Math.PI * 2;
    const section = (s) => {
      const r = rHub + (rOut - rHub) * s;
      const th = th0 + twist * Math.pow(s, 1.35);
      const w = 0.042 + 0.078 * Math.pow(s, 1.1); // tangential width: broad turbine blades
      const hf = (face - 0.055) + 0.05 * Math.pow(s, 1.6); // concave face
      const t = 0.032 + 0.01 * s; // depth
      const ridgeOff = -0.25 * w; // asymmetric ridge for the turbine look
      const ct = Math.cos(th), st = Math.sin(th);
      const tx = -st, ty = ct; // tangential direction
      const P = (off, h, rr = r) => [ct * rr + tx * off, st * rr + ty * off, h];
      return [
        P(-w / 2, hf - t), P(-w / 2, hf - 0.004), P(ridgeOff, hf + 0.006), P(w / 2, hf - 0.008), P(w / 2, hf - t),
      ];
    };
    const sg = sweepStrips(section, 32, true);
    spokeGeo.push(sg);
    // machined ridge edge (thin bright strip on the ridge line)
    const ridge = (s) => {
      const r = rHub + (rOut - rHub) * s;
      const th = th0 + twist * Math.pow(s, 1.35);
      const w = 0.042 + 0.078 * Math.pow(s, 1.1);
      const hf = (face - 0.055) + 0.05 * Math.pow(s, 1.6);
      const ct = Math.cos(th), st = Math.sin(th), tx = -st, ty = ct;
      const o = -0.25 * w;
      return [[ct * r + tx * (o - 0.0025), st * r + ty * (o - 0.0025), hf + 0.0063], [ct * r + tx * (o + 0.0025), st * r + ty * (o + 0.0025), hf + 0.0063]];
    };
    edgeGeo.push(sweepStrips(ridge, 32, false));
  }
  const spokes = new THREE.Mesh(mergeGeometries(spokeGeo), M.rim); spokes.name = 'Spokes';
  const edges = new THREE.Mesh(mergeGeometries(edgeGeo), M.rimMachined); edges.name = 'SpokeEdges';
  g.add(spokes, edges);
  // hub disc and centre lock
  const hub = new THREE.Mesh(lathe([[0.0, face - 0.03], [0.05, face - 0.03], [0.078, face - 0.05], [0.082, face - 0.09], [0.06, face - 0.1], [0.0, face - 0.1]], 48), M.rim);
  hub.name = 'Hub';
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.03, 12), M.darkChrome);
  nut.rotation.x = Math.PI / 2; nut.position.z = face - 0.015; nut.name = 'CentreLockNut';
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.006, 40), M.yellow);
  cap.rotation.x = Math.PI / 2; cap.position.z = face + 0.001; cap.name = 'CentreCap';
  // black shield emblem on the cap
  const shield = new THREE.Shape();
  shield.moveTo(-0.012, 0.014); shield.lineTo(0.012, 0.014); shield.lineTo(0.012, -0.004); shield.quadraticCurveTo(0.012, -0.012, 0, -0.016); shield.quadraticCurveTo(-0.012, -0.012, -0.012, -0.004); shield.closePath();
  const emb = new THREE.Mesh(new THREE.ShapeGeometry(shield), M.badgeBlack);
  emb.position.z = face + 0.0045; emb.scale.setScalar(0.7);
  g.add(hub, nut, cap, emb);
  // valve stem
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 8), M.darkChrome);
  valve.position.set(R - 0.02, 0, face - 0.03); valve.rotation.x = Math.PI / 2;
  g.add(valve);
  return g;
}

function makeTyre(spec, M) {
  const g = new THREE.Group();
  const W = spec.width, R = spec.r, rr = spec.rimR + 0.012;
  const sh = 0.03; // shoulder radius
  const side = [];
  const sideH = R - rr;
  // outer sidewall (r from rim to shoulder), slight bulge
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const r = rr + (R - sh - rr) * t;
    const bulge = Math.sin(t * Math.PI) * 0.012;
    side.push([r, W / 2 - 0.006 + bulge]);
  }
  const outer = new THREE.Mesh(lathe(side.slice().reverse(), 128), M.tyreSide);
  outer.name = 'TyreSidewall_Out';
  // tread with grooves + shoulders
  const prof = [];
  // shoulder (outboard)
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); prof.push([R - sh + Math.sin(a) * sh, W / 2 - 0.006 - sh + Math.cos(a) * sh]); }
  // tread surface with 4 circumferential grooves
  const grooves = [-0.3, -0.1, 0.1, 0.3].map((f) => f * W);
  const half = W / 2 - 0.006 - sh;
  const gw = 0.009, gd = 0.007;
  for (const gz of grooves.slice().reverse()) {
    prof.push([R, gz + gw / 2]); prof.push([R - gd, gz + gw / 2 - 0.001]); prof.push([R - gd, gz - gw / 2 + 0.001]); prof.push([R, gz - gw / 2]);
  }
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 + (i / 6) * (Math.PI / 2); prof.push([R - sh + Math.sin(a) * sh, -half + Math.cos(a) * sh]); }
  // inner sidewall back to the rim
  for (let i = 1; i <= 8; i++) { const t = i / 8; prof.push([R - sh - (R - sh - rr) * t, -W / 2 + 0.006 - Math.sin(t * Math.PI) * 0.01]); }
  const treadMesh = new THREE.Mesh(lathe(prof.reverse(), 160), M.tyre);
  treadMesh.name = 'TyreTread';
  g.add(outer, treadMesh);
  // tread pattern: shallow lateral sipes as a ring of thin dark quads on the shoulders
  return g;
}

function makeBrake(spec, M, front) {
  const g = new THREE.Group();
  const rOut = front ? 0.199 : 0.180, rIn = front ? 0.118 : 0.110, th = front ? 0.038 : 0.034;
  const hz = -0.02; // disc plane (axial)
  const holes = discHoleTexture();
  const discMat = M.brakeDisc.clone();
  if (holes) { discMat.alphaMap = holes; discMat.alphaTest = 0.5; discMat.side = THREE.DoubleSide; }
  const faceGeo = new THREE.RingGeometry(rIn, rOut, 96, 1);
  // ring UVs: planar mapping that matches the hole texture (centred)
  const uv = faceGeo.attributes.uv, p = faceGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * 0.2), 0.5 + p.getY(i) / (2 * 0.2));
  const f1 = new THREE.Mesh(faceGeo, discMat); f1.position.z = hz + th / 2;
  const f2 = new THREE.Mesh(faceGeo, discMat); f2.position.z = hz - th / 2; f2.rotation.y = Math.PI;
  const rimEdge = new THREE.Mesh(new THREE.CylinderGeometry(rOut, rOut, th, 96, 1, true), M.brakeDisc);
  rimEdge.rotation.x = Math.PI / 2; rimEdge.position.z = hz;
  // internal vanes visible between faces
  const vanes = new THREE.Mesh(new THREE.CylinderGeometry(rOut - 0.004, rOut - 0.004, th * 0.6, 48, 1, true), M.blackMatte);
  vanes.rotation.x = Math.PI / 2; vanes.position.z = hz;
  // aluminium bell
  const bell = new THREE.Mesh(lathe([[0.0, hz + 0.03], [rIn + 0.005, hz + 0.03], [rIn + 0.008, hz + 0.018], [rIn - 0.002, hz + 0.012], [0.085, hz + 0.05], [0.07, hz + 0.075], [0.0, hz + 0.075]], 48), M.alu);
  bell.name = 'DiscBell';
  // bobbins
  const bobGeo = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = new THREE.CylinderGeometry(0.007, 0.007, th + 0.01, 10);
    b.rotateX(Math.PI / 2); b.translate(Math.cos(a) * (rIn + 0.006), Math.sin(a) * (rIn + 0.006), hz);
    bobGeo.push(b);
  }
  const bob = new THREE.Mesh(mergeGeometries(bobGeo), M.alu);
  g.add(f1, f2, rimEdge, vanes, bell, bob);
  g.children.forEach((c) => (c.name ||= 'BrakeDisc'));

  // caliper: monobloc, wrapping the disc edge over ~70 degrees
  const cal = new THREE.Group(); cal.name = 'Caliper';
  const a0 = -0.62, a1 = 0.62; // angular span around local +x (later rotated into place)
  const rC0 = rOut - 0.052, rC1 = rOut + 0.022;
  const sec = (s) => {
    const a = a0 + (a1 - a0) * s;
    const taper = 1 - 0.25 * Math.pow(Math.abs(s - 0.5) * 2, 3);
    const c = Math.cos(a), si = Math.sin(a);
    const r0 = rC0 + (1 - taper) * 0.02, r1 = rC1;
    const zo = hz + th / 2 + 0.03 * taper, zi = hz - th / 2 - 0.028 * taper;
    return [[c * r0, si * r0, zo], [c * r1, si * r1, zo - 0.008], [c * (r1 + 0.004), si * (r1 + 0.004), hz], [c * r1, si * r1, zi + 0.006], [c * r0, si * r0, zi], [c * (r0 - 0.004), si * (r0 - 0.004), hz]];
  };
  const body = sweepStrips(sec, 24, true);
  const calBody = new THREE.Mesh(body, M.caliper);
  const endA = capPolygon(sec(0)), endB = capPolygon(sec(1), true);
  cal.add(calBody, new THREE.Mesh(endA, M.caliper), new THREE.Mesh(endB, M.caliper));
  // yellow logo plate on the outboard face
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.014), M.yellow);
  plate.position.set(rOut - 0.016, 0, hz + th / 2 + 0.0305); plate.rotation.z = Math.PI / 2;
  cal.add(plate);
  // place caliper at ~ the 1–2 o'clock trailing position (seen from the left side)
  cal.rotation.z = front ? 2.1 : 2.0;
  g.add(cal);
  // hub carrier / upright stub
  const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 24), M.aluDark);
  upright.rotation.x = Math.PI / 2; upright.position.z = hz - 0.07; upright.name = 'Upright';
  g.add(upright);
  return g;
}

export function buildWheels(M) {
  const group = new THREE.Group(); group.name = 'Wheels';
  const wheels = {};
  const corners = [
    ['FL', DIMS.XF, -1, DIMS.front, true], ['FR', DIMS.XF, 1, DIMS.front, true],
    ['RL', DIMS.XR, -1, DIMS.rear, false], ['RR', DIMS.XR, 1, DIMS.rear, false],
  ];
  const proto = {};
  for (const [name, x, side, spec, front] of corners) {
    const key = front ? 'F' : 'R';
    if (!proto[key]) proto[key] = { rim: makeRim(spec, M), tyre: makeTyre(spec, M), brake: makeBrake(spec, M, front) };
    const w = new THREE.Group(); w.name = 'Wheel_' + name;
    w.position.set(x, spec.r, side * spec.track / 2);
    // local +z is the outboard face; mirror for the left side so the spokes' sweep is mirrored
    if (side < 0) w.scale.z = -1;
    const spin = new THREE.Group(); spin.name = 'Wheel_' + name + '_Rotating';
    spin.add(proto[key].rim.clone(), proto[key].tyre.clone());
    const brake = proto[key].brake.clone();
    // keep caliper fixed relative to the car, discs rotate with the wheel (static here)
    w.add(spin, brake);
    // calipers trail the axle: mirror orientation on the left side (seen from the outside)
    group.add(w);
    wheels[name] = { group: w, spin };
  }
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group, wheels,
    update() {},
  };
}
