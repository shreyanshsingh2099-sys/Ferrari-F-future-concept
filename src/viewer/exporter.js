// Export the assembled car as a binary glTF (GLB) with named hierarchy and
// articulation animations (butterfly doors, bonnet, engine cover, active wing).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { boxUV } from '../car/materials.js';

/** Make every primitive glTF-conformant: UVs where textures are bound, tangents for anisotropy. */
function conform(root) {
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, m = o.material;
    if (done.has(g.uuid)) return;
    done.add(g.uuid);
    const textured = m && (m.map || m.normalMap || m.anisotropyMap || m.bumpMap || m.alphaMap || m.emissiveMap);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv && (textured || m?.anisotropy > 0)) boxUV(g, 1);
    if (m?.anisotropy > 0 && !g.attributes.tangent) {
      if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
      try {
        g.computeTangents();
        // sanitise degenerate tangents (must be unit length and orthogonal to the normal)
        const t = g.attributes.tangent, n = g.attributes.normal;
        const T = new THREE.Vector3(), N = new THREE.Vector3();
        for (let i = 0; i < t.count; i++) {
          T.set(t.getX(i), t.getY(i), t.getZ(i)); N.set(n.getX(i), n.getY(i), n.getZ(i)).normalize();
          T.addScaledVector(N, -T.dot(N));
          if (!(T.lengthSq() > 1e-10)) { T.set(1, 0, 0).addScaledVector(N, -N.x); if (T.lengthSq() < 1e-6) T.set(0, 0, 1).addScaledVector(N, -N.z); }
          T.normalize();
          t.setXYZW(i, T.x, T.y, T.z, t.getW(i) < 0 ? -1 : 1);
        }
      } catch (e) { /* degenerate uv: leave without */ }
    }
  });
}

function clipFor(name, pivot, applyAt, frames = 31, duration = 2.0) {
  // sample the car's own articulation function so the clip matches the viewer exactly
  const times = [], quats = [], pos = [];
  const q0 = pivot.quaternion.clone(), p0 = pivot.position.clone();
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    applyAt(t);
    times.push(t * duration);
    quats.push(...pivot.quaternion.toArray());
    pos.push(...pivot.position.toArray());
  }
  applyAt(0);
  pivot.quaternion.copy(q0); pivot.position.copy(p0);
  return new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack(`${pivot.name}.quaternion`, times, quats),
    new THREE.VectorKeyframeTrack(`${pivot.name}.position`, times, pos),
  ]);
}

export async function exportGLB(car) {
  // close everything first
  for (const k of ['doorL', 'doorR', 'hood', 'engineCover', 'wing']) car.set(k, false, true);
  car.setXray(false);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const P = car.parts;
  const clips = [];
  for (const [name, key, pivot] of [
    ['Door_L_Open', 'doorL', P.doorL.pivot], ['Door_R_Open', 'doorR', P.doorR.pivot],
    ['Bonnet_Open', 'hood', P.hood.pivot], ['EngineCover_Open', 'engineCover', P.engineCover.pivot],
  ]) clips.push(clipFor(name, pivot, (t) => car.applyArticulation(key, ease(t))));
  const wingPivot = car.root.getObjectByName('RearWing_Active');
  const plane = car.root.getObjectByName('RearWing_MainPlane');
  if (wingPivot && plane) {
    const c1 = clipFor('Wing_Active', wingPivot, (t) => car.applyArticulation('wing', ease(t)));
    const c2 = clipFor('Wing_Active_Plane', plane, (t) => car.applyArticulation('wing', ease(t)));
    clips.push(new THREE.AnimationClip('Wing_Active', 2.0, [...c1.tracks, ...c2.tracks]));
  }
  car.root.updateMatrixWorld(true);
  conform(car.root);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(car.root, { binary: true, animations: clips, onlyVisible: true, maxTextureSize: 2048 });
  return result; // ArrayBuffer
}
