// Export the assembled car as a binary glTF (GLB) with named hierarchy and
// articulation animations (butterfly doors, bonnet, engine cover, active wing).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

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
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(car.root, { binary: true, animations: clips, onlyVisible: true, maxTextureSize: 2048 });
  return result; // ArrayBuffer
}
