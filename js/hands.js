// VR hand models aligned to the WebXR *grip space*.
//
// WebXR grip space (per spec): origin in the middle of the grip, -Z runs along the controller
// handle (the "rod" you hold), +X is perpendicular to the palm: pointing AWAY from the palm on the
// right hand and INTO the palm on the left hand. The fingers wrap around the -Z axis.
//
// Instead of guessing rotation offsets, we measure the hand rig itself (wrist -> middle fingertip,
// index knuckle -> pinky knuckle) and build an exact rotation that maps those directions onto the
// grip-space directions below. The left hand is the right hand mirrored across grip X.
import * as THREE from 'three';
import { cloneModel, A } from './assets.js';

// Grip-space targets for the RIGHT hand with fingers relaxed/open.
// Fingers point down-forward around the handle (handle tilts ~50° from horizontal on Quest).
export const GRIP_FINGER_DIR = new THREE.Vector3(0, -0.77, -0.64).normalize();
export const GRIP_PALM_NORMAL = new THREE.Vector3(-1, 0, 0);       // palm faces the handle
const PALM_OFFSET = new THREE.Vector3(0.028, 0.0, 0.01);            // palm surface sits beside the handle
const HAND_LENGTH = 0.18;                                            // wrist -> middle fingertip (m)

const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

// Rotate+scale+translate `pivot` so the measured hand frame lands on the grip-space frame.
export function alignToGrip(pivot, fingerDir, knuckleDir, palmPoint, length) {
  const F = fingerDir.clone().normalize();
  let K = knuckleDir.clone().normalize();
  const P = new THREE.Vector3().crossVectors(F, K).normalize();       // palm normal of a right hand
  K = new THREE.Vector3().crossVectors(P, F).normalize();             // re-orthogonalize
  const Ft = GRIP_FINGER_DIR, Pt = GRIP_PALM_NORMAL;
  const Kt = new THREE.Vector3().crossVectors(Pt, Ft).normalize();
  _m1.makeBasis(F, K, P);                 // model -> basis
  _m2.makeBasis(Ft, Kt, Pt);              // basis -> grip
  const R = _m2.clone().multiply(_m1.clone().transpose());
  const q = new THREE.Quaternion().setFromRotationMatrix(R);
  const s = HAND_LENGTH / length;
  pivot.quaternion.copy(q);
  pivot.scale.setScalar(s);
  pivot.position.copy(palmPoint).multiplyScalar(s).applyQuaternion(q).negate().add(PALM_OFFSET);
}

function findBone(root, key) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && o.name.toLowerCase().includes(key)) found = o; });
  return found;
}

// Returns { group, setPose(grip, trigger), tip } or null if the model isn't loaded.
export function buildHandModel(side) {
  const model = cloneModel('hand');
  if (!model) return null;
  const group = new THREE.Group();               // goes straight into the grip space
  const pivot = new THREE.Group(); group.add(pivot); pivot.add(model);
  model.updateMatrixWorld(true);
  const wrist = findBone(model, 'handr'), midBase = findBone(model, 'f_middle01'), midTip = findBone(model, 'f_middle03r_end');
  const idx = findBone(model, 'f_index01'), pinky = findBone(model, 'f_pinky01'), tip = findBone(model, 'f_index03r_end');
  if (!wrist || !midTip || !idx || !pinky) { console.warn('hand bones not found'); return null; }
  const w = wrist.getWorldPosition(new THREE.Vector3()), mt = midTip.getWorldPosition(new THREE.Vector3());
  const mb = midBase.getWorldPosition(new THREE.Vector3());
  const ib = idx.getWorldPosition(new THREE.Vector3()), pb = pinky.getWorldPosition(new THREE.Vector3());
  const palm = w.clone().lerp(mb, 0.55);
  alignToGrip(pivot, mt.clone().sub(w), pb.clone().sub(ib), palm, mt.distanceTo(w));
  if (side === 'left') group.scale.x = -1;       // mirror across grip X => correct left-hand palm direction

  // Finger animation: the "ClosedHand" clip is a single-frame fist pose. We blend each finger bone between
  // its bind (open) rotation and the fist rotation: trigger drives the index finger, grip drives the rest.
  const clip = A.models.hand.animations[0];
  const joints = []; // { bone, open, closed, index }
  if (clip) {
    const byName = {}; model.traverse((o) => { if (o.isBone) byName[o.name] = o; });
    for (const t of clip.tracks) {
      if (!t.name.endsWith('.quaternion')) continue;
      const bone = byName[t.name.slice(0, -'.quaternion'.length)];
      if (!bone) continue;
      const v = t.values;
      joints.push({ bone, open: bone.quaternion.clone(), closed: new THREE.Quaternion(v[0], v[1], v[2], v[3]), index: t.name.toLowerCase().includes('f_index') });
    }
  }
  let lastG = -1, lastT = -1;
  return {
    group, tip,
    setPose(grip, trig) {
      grip = Math.round(grip * 50) / 50; trig = Math.round(trig * 50) / 50;
      if (grip === lastG && trig === lastT) return;
      lastG = grip; lastT = trig;
      for (const j of joints) j.bone.quaternion.slerpQuaternions(j.open, j.closed, j.index ? trig : grip);
    },
  };
}

// Fallback blocky hand built along -Z with palm facing -Y: align it the same way.
export function alignBlockyHand(container, side) {
  const pivot = new THREE.Group();
  while (container.children.length) pivot.add(container.children[0]);
  container.add(pivot);
  alignToGrip(pivot, new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -0.01, -0.01), 0.12);
  pivot.scale.setScalar(1.3);
  if (side === 'left') container.scale.x = -1;
}
