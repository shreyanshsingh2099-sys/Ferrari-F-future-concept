import * as THREE from 'three';
import { buildBodyPieces } from '../../src/car/body.js';
import { field3 } from '../../src/car/bodyShape.js';
const r = buildBodyPieces({ quality: 'draft' });
const door = r.pieces.filter(p => p.part === 'doorR' && !p.tag);
const pts = [];
for (const p of door) for (let i = 0; i < p.mesh.pos.length; i += 3 * 7) pts.push(new THREE.Vector3(p.mesh.pos[i], p.mesh.pos[i+1], p.mesh.pos[i+2]));
console.log('door pts', pts.length);
const zA = r.functions.zA;
function test(a, b, ang) {
  const axis = new THREE.Vector3().subVectors(b, a).normalize();
  let worst = 0, cnt = 0, top = -9, zout = 0;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
  for (const p of pts) {
    const v = p.clone().sub(a).applyQuaternion(q).add(a);
    top = Math.max(top, v.y); zout = Math.max(zout, v.z);
    const f = field3(v.x, v.y, v.z);
    // inside remaining body (exclude the door aperture: |z| > zA and x within door span)
    const inAperture = v.x < 0.96 && v.x > -0.33 && Math.abs(v.z) > zA(v.x) - 0.02 && v.y > 0.15;
    if (f < -0.004 && !inAperture) { cnt++; worst = Math.min(worst, f); if (process.env.SHOW) console.log('  hit', p.toArray().map(v=>v.toFixed(2)).join(','), '->', v.toArray().map(v=>v.toFixed(2)).join(',')); }
  }
  return { worst: worst.toFixed(3), cnt, top: top.toFixed(2), zout: zout.toFixed(2) };
}
const A = new THREE.Vector3(0.948, 0.835, 0.72), B = new THREE.Vector3(0.47, 1.075, 0.445);
for (const ang of [0.2, 0.5, 0.8, 1.0, 1.15, 1.3, 1.45]) console.log('ang', ang, JSON.stringify(test(A, B, ang)));
