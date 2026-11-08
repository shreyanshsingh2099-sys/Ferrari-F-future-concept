// Driver-focused cockpit: carbon tub, sculpted leather dashboard with carbon
// inserts and an Alcantara anti-glare top, driver binnacle with a curved digital
// cluster, central and passenger displays, F1-derived steering wheel with
// manettino, shift lights and paddles, carbon-shell sports seats on adjustment
// rails with three-point belts, gated gear selector, aluminium pedals, door cards
// (on the door pivots), headliner and ambient lighting.
import * as THREE from 'three';
import { sweep, mesh, mergeGeometries, rod, tube, grid, plate, lathe, rbox } from '../core/geo.js';
import { boxUV } from './materials.js';
import { surfaceY, surfaceZ } from './bodyShape.js';
import { smoothstep, clamp } from '../core/math.js';

const DRV = -0.37; // driver centreline (left-hand drive)
const HAS_DOM = typeof document !== 'undefined';

function displayTexture(kind) {
  if (!HAS_DOM) return null;
  const c = document.createElement('canvas');
  const W = kind === 'cluster' ? 1024 : kind === 'passenger' ? 1024 : 768;
  const H = kind === 'cluster' ? 384 : kind === 'passenger' ? 192 : 448;
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#07080a'); bg.addColorStop(1, '#0d0f12');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (kind === 'cluster') {
    // central rev counter (yellow face, classic), side panels
    const cx = W / 2, cy = H * 0.56, r = H * 0.42;
    const g = x.createRadialGradient(cx, cy, r * 0.1, cx, cy, r); g.addColorStop(0, '#f6cf2a'); g.addColorStop(1, '#d9a900');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#111'; x.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78); x.lineTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93); x.stroke();
      x.fillStyle = i >= 9 ? '#c8102e' : '#111'; x.font = 'bold 22px Arial';
      x.fillText(String(i), cx + Math.cos(a) * r * 0.64, cy + Math.sin(a) * r * 0.64);
    }
    x.strokeStyle = '#c8102e'; x.lineWidth = 7; x.beginPath(); x.arc(cx, cy, r * 0.86, Math.PI * 0.75 + 1.5 * Math.PI * 0.9, Math.PI * 2.25); x.stroke();
    x.fillStyle = '#111'; x.font = 'bold 60px Arial'; x.fillText('7', cx, cy - 6);
    x.font = '16px Arial'; x.fillText('x1000 rpm', cx, cy + 46);
    const na = Math.PI * 0.75 + 0.12 * Math.PI * 1.5;
    x.strokeStyle = '#c8102e'; x.lineWidth = 5; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(na) * r * 0.8, cy + Math.sin(na) * r * 0.8); x.stroke();
    // side panels
    x.fillStyle = '#e8ecf1'; x.font = '300 64px Arial'; x.fillText('0', W * 0.18, H * 0.48);
    x.font = '18px Arial'; x.fillStyle = '#8a929c'; x.fillText('km/h', W * 0.18, H * 0.66);
    x.fillText('RACE', W * 0.82, H * 0.38); x.fillStyle = '#c8102e'; x.font = 'bold 30px Arial'; x.fillText('CT OFF', W * 0.82, H * 0.52);
    x.fillStyle = '#8a929c'; x.font = '18px Arial'; x.fillText('OIL 92°  H2O 88°', W * 0.82, H * 0.68);
    for (let i = 0; i < 12; i++) { x.fillStyle = i < 8 ? '#3ad16b' : i < 10 ? '#f2c200' : '#c8102e'; x.fillRect(W * 0.08 + i * 18, H * 0.82, 14, 8); }
  } else if (kind === 'centre') {
    x.fillStyle = '#c8102e'; x.fillRect(0, 0, W, 6);
    x.fillStyle = '#e8ecf1'; x.font = '300 34px Arial'; x.textAlign = 'left'; x.fillText('F-FUTURE', 28, 44);
    x.font = '18px Arial'; x.fillStyle = '#8a929c'; x.fillText('Telemetry · Fiorano', 28, 78);
    // track map
    x.strokeStyle = '#e8ecf1'; x.lineWidth = 4; x.beginPath();
    const pts = [[120, 300], [200, 180], [330, 160], [420, 230], [520, 200], [640, 260], [600, 360], [430, 380], [300, 340], [180, 380]];
    pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.stroke();
    x.fillStyle = '#f2c200'; x.beginPath(); x.arc(420, 230, 9, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8ecf1'; x.font = '22px Arial'; x.fillText('LAP 1:19.8', 520, 420);
  } else {
    x.fillStyle = '#e8ecf1'; x.font = '300 42px Arial'; x.fillText('0 km/h', W * 0.25, H / 2);
    x.fillStyle = '#c8102e'; x.fillText('V12', W * 0.62, H / 2);
    x.fillStyle = '#8a929c'; x.font = '22px Arial'; x.fillText('GEAR N', W * 0.86, H / 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function screen(M, w, h, kind, name) {
  const g = new THREE.Group(); g.name = name;
  const tex = displayTexture(kind);
  const mat = M.screen.clone(); mat.name = 'Display_' + kind;
  if (tex) { mat.emissiveMap = tex; mat.map = tex; mat.emissiveIntensity = 1.1; }
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); s.name = name + '_Panel';
  const bezel = new THREE.Mesh(rbox(w + 0.012, h + 0.012, 0.012, 0.006), M.blackGloss); bezel.position.z = -0.0065;
  g.add(bezel, s);
  return g;
}

function tub(M) {
  const g = new THREE.Group(); g.name = 'CockpitTub';
  // floor with carpets
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.02, 1.44), M.carbonMatte); floor.position.set(0.24, 0.12, 0); floor.name = 'Tub_Floor';
  const matL = new THREE.Mesh(rbox(0.44, 0.012, 0.4, 0.04), M.alcantara); matL.position.set(0.66, 0.135, DRV); matL.rotation.z = 0.12; matL.name = 'FloorMat_Driver';
  const matR = matL.clone(); matR.position.z = -DRV; matR.name = 'FloorMat_Passenger';
  // centre tunnel
  const tunnel = new THREE.Mesh(rbox(1.25, 0.24, 0.2, 0.05), M.carbon); tunnel.position.set(0.26, 0.24, 0); tunnel.name = 'Tub_Tunnel';
  g.add(floor, matL, matR, tunnel);
  // sills
  for (const s of [-1, 1]) {
    const sill = new THREE.Mesh(rbox(1.25, 0.26, 0.13, 0.03), M.carbon); sill.position.set(0.3, 0.24, s * 0.775); sill.name = 'Tub_Sill';
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.004, 0.06), M.alu); tread.position.set(0.33, 0.373, s * 0.79); tread.name = 'SillPlate';
    g.add(sill, tread);
  }
  // footwell / front bulkhead
  const fw = grid((u, v) => { const z = -0.72 + 1.44 * u, y = 0.13 + 0.55 * v; return [1.02 - 0.12 * v * v, y, z]; }, 12, 6);
  g.add(mesh(fw, M.alcantara, 'Footwell_Bulkhead', { cast: false }));
  // rear bulkhead with window into the engine bay
  const rb = grid((u, v) => {
    const z = -0.7 + 1.4 * u, y = 0.13 + 0.92 * v;
    return [-0.47 - 0.05 * v, y, z * (1 - 0.32 * v * v)];
  }, 16, 10);
  g.add(mesh(rb, M.alcantara, 'Rear_Bulkhead', { cast: false }));
  return g;
}

function dashboard(M) {
  const g = new THREE.Group(); g.name = 'Dashboard';
  // dashboard section as a function of z: (x,y) contour from windscreen base to the knee area
  const sec = (t) => {
    const z = -0.7 + 1.4 * t;
    const az = Math.abs(z);
    const wsx = 1.0 + 0.2 * (1 - (az / 0.7) ** 2); // windscreen base moves forward at centre
    const wsy = (surfaceY(Math.min(wsx, 1.15), z) ?? 0.8) - 0.03;
    const binn = Math.exp(-(((z - DRV) / 0.13) ** 2)); // driver binnacle bump
    const cons = Math.exp(-((z / 0.12) ** 2));
    const faceX = 0.62 - 0.08 * binn + 0.02 * cons;
    const topY = 0.765 + 0.05 * binn;
    const pts = [
      [wsx - 0.02, wsy - 0.01], [0.88, topY + 0.005], [0.74, topY + 0.01], [faceX + 0.02, topY], [faceX - 0.01, topY - 0.03],
      [faceX, 0.69], [faceX + 0.05, 0.6], [0.72, 0.5], [0.84, 0.44], [0.95, 0.42],
    ];
    return pts.map(([x, y]) => [x, y, z]);
  };
  const dash = sweep(sec, 56, { closed: false, smoothAcross: true });
  g.add(mesh(boxUV(dash, 4), M.leather, 'Dash_Leather'));
  // Alcantara anti-glare top band
  const topSec = (t) => sec(t).slice(0, 4).map((p) => [p[0], p[1] + 0.003, p[2]]);
  g.add(mesh(sweep(topSec, 56, { closed: false, smoothAcross: true }), M.alcantara, 'Dash_Alcantara'));
  // carbon insert band across the dash face with ambient LED line
  const band = (t) => { const s = sec(t); const a = s[5], b = s[6]; return [[a[0] - 0.004, a[1] - 0.005, a[2]], [b[0] - 0.004, b[1] + 0.02, b[2]]]; };
  g.add(mesh(boxUV(sweep(band, 56, { closed: false, smoothAcross: true }), 4), M.carbon, 'Dash_CarbonInsert'));
  const led = [];
  for (let i = 0; i <= 40; i++) { const s = sec(i / 40); const a = s[6]; led.push([a[0] - 0.008, a[1] + 0.024, a[2]]); }
  g.add(mesh(tube(led, 0.002, 5, 120), M.ambient, 'Ambient_DashLED', { cast: false }));
  // binnacle hood and cluster
  const cl = screen(M, 0.29, 0.11, 'cluster', 'InstrumentCluster');
  cl.position.set(0.585, 0.775, DRV); cl.rotation.y = -Math.PI / 2; cl.rotateX(-0.25);
  g.add(cl);
  const hood = sweep((t) => {
    const a = Math.PI * (0.1 + 0.8 * t);
    return [[0.62, 0.79 + Math.sin(a) * 0.035, DRV + Math.cos(a) * 0.17], [0.53, 0.83 + Math.sin(a) * 0.045, DRV + Math.cos(a) * 0.185], [0.535, 0.835 + Math.sin(a) * 0.045, DRV + Math.cos(a) * 0.19]];
  }, 24, { closed: false });
  g.add(mesh(hood, M.carbon, 'Binnacle_Hood'));
  // central display, passenger display
  const cd = screen(M, 0.22, 0.13, 'centre', 'CentreDisplay');
  cd.position.set(0.66, 0.66, 0); cd.rotation.y = -Math.PI / 2; cd.rotateX(-0.35);
  const pd = screen(M, 0.26, 0.05, 'passenger', 'PassengerDisplay');
  pd.position.set(0.635, 0.735, -DRV); pd.rotation.y = -Math.PI / 2; pd.rotateX(-0.2);
  g.add(cd, pd);
  // air vents (round, aluminium) at the outer ends and centre
  for (const z of [-0.6, -0.12, 0.12, 0.6]) {
    const v = new THREE.Group(); v.name = 'AirVent';
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 10, 32), M.alu);
    const fins = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.01, 24), M.blackSatin); fins.rotation.x = Math.PI / 2;
    v.add(ring, fins);
    v.position.set(0.61, 0.70, z); v.rotation.y = -Math.PI / 2;
    g.add(v);
  }
  // interior rear-view mirror
  const rv = new THREE.Mesh(rbox(0.2, 0.05, 0.02, 0.012), M.blackGloss); rv.position.set(0.48, 1.04, 0); rv.rotation.z = 0.2; rv.name = 'RearViewMirror';
  g.add(rv, mesh(rod([0.49, 1.06, 0], [0.52, 1.1, 0], 0.006), M.blackSatin, 'RearViewMirror_Stem'));
  return g;
}

function steeringWheel(M) {
  const g = new THREE.Group(); g.name = 'SteeringWheel';
  // rim: flat-bottomed, flat-topped racing shape in the local XY plane (wheel faces +z local)
  const rim = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    let x = Math.cos(a) * 0.175, y = Math.sin(a) * 0.165;
    if (y < -0.12) y = -0.12 + (y + 0.12) * 0.25;
    if (y > 0.135) y = 0.135 + (y - 0.135) * 0.4;
    rim.push([x, y, 0]);
  }
  const rimGeo = tube(rim, 0.016, 12, 160, true);
  g.add(mesh(rimGeo, M.alcantara, 'Wheel_Rim'));
  // leather grips at 9 and 3 o'clock
  for (const s of [-1, 1]) {
    const grip = [];
    for (let i = 0; i <= 14; i++) { const a = (s > 0 ? 0 : Math.PI) + (i / 14 - 0.5) * 1.1; grip.push([Math.cos(a) * 0.175, Math.sin(a) * 0.165, 0]); }
    g.add(mesh(tube(grip, 0.0175, 12, 40), M.leather, 'Wheel_Grip'));
  }
  // carbon hub
  const hubShape = new THREE.Shape();
  hubShape.moveTo(-0.16, 0.02); hubShape.quadraticCurveTo(-0.17, 0.07, -0.1, 0.08); hubShape.lineTo(0.1, 0.08); hubShape.quadraticCurveTo(0.17, 0.07, 0.16, 0.02);
  hubShape.lineTo(0.08, -0.06); hubShape.quadraticCurveTo(0, -0.12, -0.08, -0.06); hubShape.closePath();
  const hub = new THREE.ExtrudeGeometry(hubShape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 3 });
  hub.translate(0, 0, -0.02);
  g.add(mesh(boxUV(hub, 6), M.carbon, 'Wheel_Hub'));
  // centre badge, manettino, buttons
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 24), M.yellow); badge.rotation.x = Math.PI / 2; badge.position.set(0, 0.035, 0.018);
  const man = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.016, 20), M.leatherRed); man.rotation.x = Math.PI / 2; man.position.set(0.07, -0.04, 0.02); man.name = 'Manettino';
  const manRing = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 8, 24), M.alu); manRing.position.set(0.07, -0.04, 0.017);
  const start = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.01, 20), M.tricolorR); start.rotation.x = Math.PI / 2; start.position.set(-0.07, -0.04, 0.02); start.name = 'EngineStart';
  g.add(badge, man, manRing, start);
  for (const [x, y] of [[-0.11, 0.045], [0.11, 0.045], [-0.12, 0.0], [0.12, 0.0]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.008, 14), M.blackGloss); b.rotation.x = Math.PI / 2; b.position.set(x, y, 0.016); g.add(b);
  }
  // LED shift lights on the top of the rim
  for (let i = 0; i < 9; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.005, 0.004), i < 3 ? M.tricolorG : i < 6 ? M.yellow : M.ledRed);
    led.position.set(-0.045 + i * 0.0112, 0.118, 0.006); g.add(led);
  }
  // carbon shift paddles (fixed to the column, behind the wheel)
  for (const s of [-1, 1]) {
    const pad = plate([[0, 0.06], [0.12, 0.08], [0.15, 0.02], [0.13, -0.08], [0.02, -0.03]], 0.006, 'xy');
    pad.translate(0, 0, -0.045);
    const pm = mesh(boxUV(pad, 6), M.carbon, 'ShiftPaddle_' + (s > 0 ? 'Up' : 'Down'));
    pm.scale.x = s; pm.position.x = s * 0.06;
    g.add(pm);
  }
  // column shroud
  g.add(mesh(rod([0, 0, -0.03], [0, 0, -0.3], 0.035, 16, 0.045), M.leather, 'SteeringColumn'));
  return g;
}

function seat(M, z, name) {
  const g = new THREE.Group(); g.name = name;
  // local frame: x forward, y up; seat reference point at the cushion rear
  const backAngle = 0.42; // recline
  const shell = (t) => {
    // backrest section across the width at height t (0 bottom .. 1 top with integrated headrest)
    const h = t * 0.78;
    const w = 0.25 - 0.06 * smoothstep(0.5, 0.75, t) + 0.025 * smoothstep(0.85, 1, t) - 0.03 * smoothstep(0.0, 0.2, 1 - t);
    const bol = 0.08 * (1 - smoothstep(0.55, 0.8, t)) + 0.03;
    const yy = h * Math.cos(backAngle), xx = -h * Math.sin(backAngle);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = -1 + (2 * i) / 12;
      const depth = bol * Math.pow(Math.abs(u), 4); // bolsters come forward at the edges
      pts.push([xx + depth * Math.cos(backAngle) + 0.0, yy + depth * Math.sin(backAngle), u * w]);
    }
    return pts;
  };
  const back = sweep(shell, 28, { closed: false, smoothAcross: true });
  const backMesh = mesh(back, M.alcantara, 'Seat_BackCentre');
  g.add(backMesh);
  // carbon shell behind (offset rearward)
  const shellBack = sweep((t) => shell(t).map(([x, y, zz]) => [x - 0.045 * Math.cos(backAngle), y + 0.045 * Math.sin(backAngle) * -1 + 0.0, zz * 1.06]), 28, { closed: false, smoothAcross: true });
  const sb = mesh(boxUV(shellBack, 4), M.carbon, 'Seat_CarbonShell');
  g.add(sb);
  // leather bolster rolls along both sides
  for (const s of [-1, 1]) {
    const roll = [];
    for (let i = 0; i <= 20; i++) { const t = i / 20; const p = shell(t)[s > 0 ? 12 : 0]; roll.push([p[0] + 0.01, p[1], p[2] - s * 0.015]); }
    g.add(mesh(tube(roll, 0.035, 12, 60), M.leather, 'Seat_Bolster'));
    const st = roll.map(([x, y, zz]) => [x + 0.03, y, zz - s * 0.02]);
    g.add(mesh(tube(st, 0.0025, 5, 60), M.stitch, 'Seat_Stitching'));
  }
  // headrest aperture trim (belt guide)
  const hole = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 8, 24), M.leatherRed);
  const hp = shell(0.83)[6]; hole.position.set(hp[0] + 0.012, hp[1], 0); hole.rotation.y = Math.PI / 2; hole.rotation.x = backAngle;
  g.add(hole);
  // cushion
  const cushion = sweep((t) => {
    const x = 0.03 + 0.46 * t;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const u = -1 + (2 * i) / 12;
      const bol = (0.06 + 0.03 * (1 - t)) * Math.pow(Math.abs(u), 4);
      pts.push([x, 0.06 + bol + 0.02 * Math.sin(t * Math.PI), u * 0.24]);
    }
    return pts;
  }, 16, { closed: false, smoothAcross: true });
  g.add(mesh(cushion, M.alcantara, 'Seat_Cushion'));
  const cushionShell = new THREE.Mesh(rbox(0.5, 0.08, 0.5, 0.03), M.carbon); cushionShell.position.set(0.26, 0.02, 0); cushionShell.name = 'Seat_Pan';
  g.add(cushionShell);
  // adjustment rails and sliders
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.03), M.alu); rail.position.set(0.25, -0.04, s * 0.17); rail.name = 'Seat_Rail';
    const slider = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.035), M.aluDark); slider.position.set(0.22, -0.018, s * 0.17);
    g.add(rail, slider);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 10), M.alu); bar.rotation.x = Math.PI / 2; bar.position.set(0.5, -0.03, 0); bar.name = 'Seat_AdjustBar';
  g.add(bar);
  g.position.set(-0.22, 0.155, z);
  return g;
}

function seatBelt(M, z, outboard) {
  // three-point belt: B-pillar anchor -> across chest -> buckle on tunnel side, lap section
  const s = Math.sign(z);
  const top = [-0.47, 0.98, s * 0.62];
  const shoulder = [-0.3, 0.86, z + s * 0.14];
  const chest = [-0.12, 0.62, z];
  const buckle = [-0.15, 0.3, z - s * 0.2];
  const lapOut = [-0.22, 0.3, s * 0.66];
  const pts1 = [top, shoulder, [-0.2, 0.74, z + s * 0.06], chest, [-0.14, 0.44, z - s * 0.12], buckle];
  const pts2 = [buckle, [-0.08, 0.31, z], [-0.14, 0.33, z + s * 0.16], lapOut];
  const strip = (pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    return sweep((t) => {
      const p = curve.getPoint(t), d = curve.getTangent(t);
      const side = new THREE.Vector3(1, 0.2, 0).cross(d).normalize().multiplyScalar(0.024);
      return [[p.x - side.x, p.y - side.y, p.z - side.z], [p.x + side.x, p.y + side.y, p.z + side.z]];
    }, 40, { closed: false });
  };
  const g = new THREE.Group(); g.name = 'SeatBelt';
  const mat = M.beltRed;
  g.add(mesh(mergeGeometries([strip(pts1), strip(pts2)]), mat, 'Belt_Webbing'));
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.012), M.alu); latch.position.set(...buckle); latch.name = 'Belt_Buckle';
  g.add(latch);
  return g;
}

function console_(M) {
  const g = new THREE.Group(); g.name = 'CentreConsole';
  // floating bridge from the dash down to the tunnel
  const bridge = sweep((t) => {
    const x = 0.62 - 0.55 * t;
    const y = 0.6 - 0.24 * smoothstep(0, 0.7, t);
    return [[x, y, -0.085], [x, y + 0.025, -0.07], [x, y + 0.03, 0.07], [x, y, 0.085], [x, y - 0.05, 0.085], [x, y - 0.05, -0.085]];
  }, 20, { closed: true, caps: true });
  g.add(mesh(boxUV(bridge, 4), M.carbon, 'Console_Bridge'));
  // gated selector: aluminium plate with three toggles (R / Launch / Auto)
  const plateGeo = new THREE.Mesh(rbox(0.14, 0.008, 0.11, 0.02), M.alu); plateGeo.position.set(0.25, 0.468, 0); plateGeo.rotation.z = -0.25; plateGeo.name = 'GearGate_Plate';
  g.add(plateGeo);
  const gate = [];
  for (const [dx, dz] of [[-0.04, -0.035], [0.0, 0.0], [-0.04, 0.035]]) {
    gate.push(rod([0.25 + dx, 0.472, dz - 0.012], [0.25 + dx, 0.472, dz + 0.012], 0.0035, 8));
  }
  g.add(mesh(mergeGeometries(gate), M.chrome, 'GearGate_Slots'));
  const toggles = [['R', -0.035, M.blackGloss], ['LC', 0.0, M.leatherRed], ['AUTO', 0.035, M.blackGloss]];
  for (const [n, dz, m] of toggles) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.035, 14), m); t.position.set(0.24, 0.49, dz); t.rotation.z = -0.5; t.name = 'GearToggle_' + n;
    g.add(t);
  }
  // window switches, hazard, aluminium rotary for drive modes
  const rot = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.018, 28), M.alu); rot.position.set(0.12, 0.43, 0.0); rot.rotation.z = -0.2; rot.name = 'DriveModeRotary';
  g.add(rot);
  for (const dz of [-0.03, 0.03]) { const sw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.018), M.alu); sw.position.set(0.06, 0.42, dz); g.add(sw); }
  return g;
}

function pedals(M) {
  const g = new THREE.Group(); g.name = 'Pedals';
  const mk = (z, h, w, name, y = 0.25) => {
    const arm = mesh(rod([0.95, 0.5, z], [0.86, y + 0.02, z], 0.008), M.aluDark, name + '_Arm');
    const pad = new THREE.Mesh(rbox(0.018, h, w, 0.008), M.alu); pad.position.set(0.86, y, z); pad.rotation.z = -0.5; pad.name = name;
    g.add(arm, pad);
    for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.006, 8), M.rubberTrim); st.rotation.z = Math.PI / 2 - 0.5; st.position.set(0.86 - 0.008, y - h / 3 + (i % 3) * h / 3, z + (i < 3 ? -w / 4 : w / 4)); g.add(st); }
  };
  mk(DRV + 0.08, 0.12, 0.05, 'Pedal_Throttle', 0.24);
  mk(DRV - 0.04, 0.08, 0.1, 'Pedal_Brake', 0.29);
  const rest = new THREE.Mesh(rbox(0.02, 0.18, 0.08, 0.01), M.alu); rest.position.set(0.86, 0.24, DRV - 0.2); rest.rotation.z = -0.6; rest.name = 'FootRest';
  g.add(rest);
  return g;
}

function headliner(M) {
  const geo = grid((u, v) => {
    const x = 0.5 - 1.0 * u, z = -0.47 + 0.94 * v;
    const y = (surfaceY(x, z) ?? 1.1) - 0.022;
    return [x, y, z];
  }, 30, 20);
  const mat = M.alcantara.clone(); mat.side = THREE.DoubleSide; mat.name = 'Headliner_Alcantara';
  return mesh(geo, mat, 'Headliner', { cast: false });
}

/** Door card attached to a door pivot (sgn = +1 right, -1 left). */
function doorCard(M, sgn) {
  const g = new THREE.Group(); g.name = 'DoorCard_' + (sgn > 0 ? 'R' : 'L');
  // panel following the inner door surface between sill and beltline
  const inner = (x, y) => (surfaceZ(x, y) ?? 0.9) - 0.075;
  const panel = grid((u, v) => {
    const x = 0.86 - 1.08 * u, y = 0.2 + 0.62 * v;
    return [x, y, sgn * inner(x, y)];
  }, 30, 16);
  if (sgn < 0) { const idx = panel.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } panel.computeVertexNormals(); }
  g.add(mesh(panel, M.leather, 'DoorCard_Leather'));
  // carbon lower section
  const low = grid((u, v) => { const x = 0.84 - 1.04 * u, y = 0.21 + 0.2 * v; return [x, y, sgn * (inner(x, y) - 0.012)]; }, 20, 4);
  if (sgn < 0) { const idx = low.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } low.computeVertexNormals(); }
  g.add(mesh(boxUV(low, 4), M.carbon, 'DoorCard_Carbon'));
  // armrest, pull strap, speaker, ambient strip
  const ax = 0.22, ay = 0.52;
  const arm = new THREE.Mesh(rbox(0.42, 0.05, 0.08, 0.02), M.leatherRed); arm.position.set(ax, ay, sgn * (inner(ax, ay) - 0.045)); arm.name = 'DoorCard_Armrest';
  const strap = mesh(tube([[0.42, 0.58, sgn * (inner(0.42, 0.58) - 0.01)], [0.36, 0.61, sgn * (inner(0.36, 0.61) - 0.05)], [0.28, 0.6, sgn * (inner(0.28, 0.6) - 0.01)]], 0.008, 8, 20), M.alu, 'DoorCard_PullStrap');
  const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.008, 40), M.aluDark); sp.rotation.x = Math.PI / 2; sp.position.set(0.6, 0.33, sgn * (inner(0.6, 0.33) - 0.018)); sp.name = 'DoorCard_Speaker';
  const handle = new THREE.Mesh(rbox(0.07, 0.025, 0.02, 0.008), M.alu); handle.position.set(0.55, 0.62, sgn * (inner(0.55, 0.62) - 0.02)); handle.name = 'DoorCard_Release';
  const led = []; for (let i = 0; i <= 20; i++) { const x = 0.8 - 0.9 * (i / 20), y = 0.69; led.push([x, y, sgn * (inner(x, y) - 0.012)]); }
  g.add(arm, strap, sp, handle, mesh(tube(led, 0.0025, 5, 60), M.ambient, 'Ambient_DoorLED', { cast: false }));
  // door seal along the edge (rubber)
  return g;
}

export function buildInterior(M, mk) {
  const group = new THREE.Group(); group.name = 'Interior';
  group.add(tub(M), dashboard(M), console_(M), pedals(M), headliner(M));
  const sw = steeringWheel(M);
  // wheel centre and column direction
  const wc = new THREE.Vector3(0.33, 0.675, DRV);
  sw.position.copy(wc);
  sw.lookAt(wc.x - 0.93, wc.y + 0.36, wc.z); // wheel face toward the driver, column tilted down into the dash
  group.add(sw);
  group.add(seat(M, DRV, 'Seat_Driver'), seat(M, -DRV, 'Seat_Passenger'));
  group.add(seatBelt(M, DRV), seatBelt(M, -DRV));
  if (mk) { mk.doorR.inner.add(doorCard(M, 1)); mk.doorL.inner.add(doorCard(M, -1)); }
  group.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
  return { group };
}
