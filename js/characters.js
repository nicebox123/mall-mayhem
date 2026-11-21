// Wraps the uploaded GLB characters so NPC code can drive them like the blocky avatars.
// The models ship without animations, so we animate the rig procedurally: we rotate bones around
// character-space axes (converted into each bone's parent space), which works no matter how the
// rig's bone axes were authored.
import * as THREE from 'three';
import { cloneModel } from './assets.js';

const HEIGHTS = { girl: 1.62, man: 1.78, guard: 1.8 };
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

function findBones(root) {
  const want = { lThigh: 'l_thigh_', rThigh: 'r_thigh_', lCalf: 'l_calf_', rCalf: 'r_calf_', lArm: 'l_upperarm_', rArm: 'r_upperarm_',
    lFore: 'l_forearm_', rFore: 'r_forearm_', spine: 'spine02_', head: 'head_', hip: 'hip_' };
  const out = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.toLowerCase();
    if (n.includes('twist') || n.includes('share') || n.includes('scale')) return;
    for (const [k, v] of Object.entries(want)) if (!out[k] && n.includes(v)) out[k] = o;
  });
  return out;
}

export function makeModelAvatar(key, scale = 1) {
  const model = cloneModel(key);
  if (!model) return null;
  const root = new THREE.Group(), body = new THREE.Group(), inner = new THREE.Group();
  root.add(body); body.add(inner); inner.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const s = (HEIGHTS[key] || 1.7) / h;
  inner.scale.setScalar(s);
  inner.rotation.y = Math.PI;                               // Sketchfab models face +Z; NPCs face -Z
  model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // rest pose + each bone's parent orientation in character space
  const bones = findBones(model), rest = {};
  for (const [k, b] of Object.entries(bones)) {
    const pq = new THREE.Quaternion(); b.parent.getWorldQuaternion(pq);
    rest[k] = { q: b.quaternion.clone(), pInv: pq.invert() };
  }
  const rigged = !!(bones.lThigh && bones.rThigh);
  const setRot = (k, axis, ang, axis2, ang2) => {
    const b = bones[k]; if (!b) return;
    const r = rest[k];
    b.quaternion.copy(r.q);
    if (ang) b.quaternion.premultiply(_q.setFromAxisAngle(_v.copy(axis).applyQuaternion(r.pInv), ang));
    if (ang2) b.quaternion.premultiply(_q.setFromAxisAngle(_v.copy(axis2).applyQuaternion(r.pInv), ang2));
  };
  const _v = new THREE.Vector3();
  // A-pose arms hang a little lower so they don't look like a scarecrow
  const ARM_DOWN = 0.75;

  const av = {
    root, body, head: bones.head || inner, isModel: true, phase: Math.random() * 6, curFace: null, key,
    setFace() {}, setLook() {},
    animate(dt, speed) {
      this.phase += dt * (3 + speed * 4.5);
      const sw = Math.min(1, speed) * 0.55, ph = this.phase;
      if (rigged) {
        setRot('lThigh', X, Math.sin(ph) * sw); setRot('rThigh', X, -Math.sin(ph) * sw);
        setRot('lCalf', X, -Math.max(0, -Math.sin(ph)) * sw * 1.2); setRot('rCalf', X, -Math.max(0, Math.sin(ph)) * sw * 1.2);
        setRot('lArm', X, -Math.sin(ph) * sw * 0.7, Zax, ARM_DOWN); setRot('rArm', X, Math.sin(ph) * sw * 0.7, Zax, -ARM_DOWN);
        setRot('lFore', X, 0); setRot('rFore', X, 0); setRot('head', X, 0); setRot('spine', X, 0); setRot('hip', Y, Math.sin(ph) * sw * 0.15);
      } else { // rigid model (security guard): goofy waddle
        inner.rotation.z = Math.sin(ph) * sw * 0.12;
        inner.rotation.x = 0;
      }
      body.position.y = Math.abs(Math.sin(ph)) * 0.04 * Math.min(1, speed);
    },
    // code: 2 flee, 3 photo, 4 dance, 5 confused, 6 stumble, 7 stare, 8 dramatic, 9 angry, 10 investigate
    pose(code, t, dt) {
      if (!rigged) {
        if (code === 2) inner.rotation.z = Math.sin(t * 20) * 0.2;
        else if (code === 4) inner.rotation.z = Math.sin(t * 8) * 0.25;
        else if (code === 6) inner.rotation.x = Math.sin(t * 18) * 0.2;
        else if (code === 8) { body.position.y = -0.35; inner.rotation.x = -0.3; }
        else if (code === 10) inner.rotation.y = Math.PI + Math.sin(t * 2) * 0.6;
        else if (code === 11) inner.rotation.x = -0.12;
        else if (code === 9) body.position.y = Math.abs(Math.sin(t * 12)) * 0.08;
        if (code !== 10) inner.rotation.y = Math.PI;
        return;
      }
      switch (code) {
        // signs: +X rotation swings a limb FORWARD; +Z lowers the left arm / raises the right arm
        case 2: setRot('lArm', X, 2.6 + Math.sin(t * 18) * 0.4); setRot('rArm', X, 2.6 - Math.sin(t * 18) * 0.4); break;
        case 3: setRot('rArm', X, 1.5, Zax, -ARM_DOWN); setRot('rFore', X, 0.6); setRot('head', X, 0.15); break;
        case 4: setRot('lArm', X, 2.8 + Math.sin(t * 8) * 0.6); setRot('rArm', X, 2.8 - Math.sin(t * 8) * 0.6); setRot('hip', Y, Math.sin(t * 8) * 0.5); break;
        case 5: setRot('rArm', X, 2.4, Zax, -0.6); setRot('rFore', X, 1.6); setRot('head', Zax, Math.sin(t * 3) * 0.3); break;
        case 6: setRot('spine', Zax, Math.sin(t * 16) * 0.35); setRot('lArm', Zax, -1.3); setRot('rArm', Zax, 1.3); break;
        case 7: setRot('head', X, -0.1); setRot('lArm', Zax, ARM_DOWN * 1.5); setRot('rArm', Zax, -ARM_DOWN * 1.5); break;
        case 8: body.position.y = -0.4; setRot('lArm', X, 2.9); setRot('rArm', X, 2.9); setRot('head', X, 0.5); setRot('lThigh', X, 1.4); setRot('rThigh', X, 1.4); setRot('lCalf', X, -2.2); setRot('rCalf', X, -2.2); break;
        case 9: setRot('lArm', X, 1.8 + Math.sin(t * 14) * 0.5); setRot('rArm', X, 1.8 - Math.sin(t * 14) * 0.5); setRot('lFore', X, 1.2); setRot('rFore', X, 1.2); break;
        case 10: setRot('rArm', X, 2.3, Zax, -0.4); setRot('rFore', X, 1.9); setRot('head', Y, Math.sin(t * 1.5) * 0.7); break;
        case 11: setRot('head', X, -0.55 + Math.sin(t * 1.2) * 0.05); setRot('spine', X, -0.15); break; // asleep standing
      }
    },
  };
  return av;
}
