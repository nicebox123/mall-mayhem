// Player state shared by host simulation and remote rendering.
import * as THREE from 'three';
import { G } from './state.js';
import { world, CANNON, V3, driveBody } from './physics.js';
import { makeAvatar, nameTag } from './avatar.js';
import { box, damp } from './util.js';
import { SKINS } from './config.js';
import { buildHandModel } from './hands.js';

export function makePlayerState(id, name, look, isLocal) {
  const p = {
    id, name, look, isLocal, job: null, jobData: {},
    head: { p: new THREE.Vector3(0, 1.6, 0), q: new THREE.Quaternion() },
    hands: [0, 1].map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), prev: new THREE.Vector3(), held: null,
      offPos: new THREE.Vector3(), offQuat: new THREE.Quaternion(), body: null, active: false, fist: false, speed: 0 })),
    avatar: null, tag: null, handMeshes: [],
  };
  if (G.isHost) {
    for (const h of p.hands) {
      h.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Sphere(0.06) });
      h.body.position.set(0, -10, 0);
      h.body.collisionResponse = false;
      h.body.allowSleep = false;
      h.body.userData = { hand: true, pid: id };
      world.addBody(h.body);
    }
  }
  if (!isLocal) buildRemoteVisual(p);
  G.players.set(id, p);
  return p;
}

function buildRemoteVisual(p) {
  p.avatar = makeAvatar(p.look, { legs: false });
  G.scene.add(p.avatar.root);
  p.tag = nameTag(p.name); G.scene.add(p.tag);
  p.handModels = [];
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Group();
    const hm = buildHandModel(i === 0 ? 'left' : 'right');   // same grip-space alignment as the local hands
    if (hm) { m.add(hm.group); p.handModels.push(hm); }
    else { m.add(box(0.09, 0.04, 0.11, SKINS[p.look.skin] ?? SKINS[0])); p.handModels.push(null); }
    G.scene.add(m); p.handMeshes.push(m);
  }
}

export function setPlayerLook(p, look, name) {
  p.look = look; if (name) p.name = name;
  if (p.avatar) {
    p.avatar.setLook(look);
    G.scene.remove(p.tag); p.tag = nameTag(p.name); G.scene.add(p.tag);
    p.handMeshes.forEach((m, i) => { if (!p.handModels[i]) m.children[0].material = new THREE.MeshLambertMaterial({ color: SKINS[look.skin] ?? SKINS[0] }); });
  }
}

export function removePlayer(id) {
  const p = G.players.get(id); if (!p) return;
  if (p.avatar) G.scene.remove(p.avatar.root);
  if (p.tag) G.scene.remove(p.tag);
  p.handMeshes.forEach((m) => G.scene.remove(m));
  for (const h of p.hands) {
    if (h.body) world.removeBody(h.body);
    if (h.held) { const o = G.objects.get(h.held); if (o) o.holder = null; }
  }
  G.players.delete(id);
}

export function clearRemotePlayers() { for (const [id, p] of [...G.players]) if (!p.isLocal) removePlayer(id); }

// Host: hand bodies + held-object drive, called every physics step
const _t = new THREE.Vector3(), _tq = new THREE.Quaternion();
export function stepPlayersPhysics(dt) {
  for (const p of G.players.values()) {
    for (const h of p.hands) {
      if (!h.body) continue;
      const b = h.body;
      if (!h.active) { b.position.set(0, -10, 0); b.velocity.set(0, 0, 0); h.lastP = null; continue; }
      // velocity from the hand's own motion (not from the body, which the integrator moves): no feedback loop
      if (!h.lastP || h.lastP.distanceToSquared(h.p) > 0.64) h.lastP = h.p.clone(); // teleport/respawn: no fake punch
      b.velocity.set((h.p.x - h.lastP.x) / dt, (h.p.y - h.lastP.y) / dt, (h.p.z - h.lastP.z) / dt);
      h.lastP.copy(h.p);
      b.position.set(h.p.x, h.p.y, h.p.z);
      b.aabbNeedsUpdate = true;
      const speed = b.velocity.length();
      h.speed = speed;
      b.collisionResponse = !h.held && (speed > 1.3 || h.fist);
      if (h.held) {
        const o = G.objects.get(h.held);
        if (!o || !o.body) { h.held = null; continue; }
        _t.copy(h.offPos).applyQuaternion(h.q).add(h.p);
        _tq.copy(h.q).multiply(h.offQuat);
        driveBody(o.body, _t, _tq, dt, o.def.grip ?? 1);
      }
    }
  }
}

// Render remote players (host and clients)
const _e = new THREE.Euler(), _fwd = new THREE.Vector3();
export function updateRemoteVisuals(dt) {
  const k = damp(dt, 14);
  for (const p of G.players.values()) {
    if (p.isLocal || !p.avatar) continue;
    if (!p.vis) p.vis = { hp: p.head.p.clone(), hq: p.head.q.clone(), h: [p.hands[0].p.clone(), p.hands[1].p.clone()], q: [p.hands[0].q.clone(), p.hands[1].q.clone()] };
    p.vis.hp.lerp(p.head.p, k); p.vis.hq.slerp(p.head.q, k);
    const av = p.avatar;
    // knocked out: their ragdoll is shown instead
    av.root.visible = !p.ko; p.tag.visible = !p.ko;
    if (p.ko) { p.handMeshes.forEach((m) => (m.visible = false)); continue; }
    // head rotation, body yaw follows head
    _e.setFromQuaternion(p.vis.hq, 'YXZ');
    av.root.position.set(p.vis.hp.x, p.vis.hp.y - 1.58, p.vis.hp.z);
    av.root.rotation.y = _e.y;
    av.head.rotation.set(_e.x, 0, _e.z);
    p.tag.position.set(p.vis.hp.x, p.vis.hp.y + 0.45, p.vis.hp.z);
    for (let i = 0; i < 2; i++) {
      p.vis.h[i].lerp(p.hands[i].p, k); p.vis.q[i].slerp(p.hands[i].q, k);
      p.handMeshes[i].position.copy(p.vis.h[i]); p.handMeshes[i].quaternion.copy(p.vis.q[i]);
      p.handMeshes[i].visible = p.hands[i].active;
      const hm = p.handModels[i];
      if (hm) { const c = p.hands[i].closed || p.hands[i].held ? 1 : p.hands[i].fist ? 1 : 0; hm.setPose(c, c); }
    }
    if (p.voiceEl) {
      const cam = G.camera.getWorldPosition(_fwd);
      const d = cam.distanceTo(p.vis.hp);
      p.voiceEl.volume = Math.max(0, Math.min(1, 1.2 - d / 15));
    }
  }
}
