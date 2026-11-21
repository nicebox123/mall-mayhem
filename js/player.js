// Local player: VR rig, tracked hands, locomotion (smooth/teleport/snap), grabbing, lasers, pokes, desktop fallback.
import * as THREE from 'three';
import { G } from './state.js';
import { Save } from './save.js';
import { collideCircle, pointBlocked, groundAt } from './physics.js';
import { raycastPanels } from './ui.js';
import { sfx, haptic } from './audio.js';
import { box, mat, clamp } from './util.js';
import { SKINS } from './config.js';
import { Z } from './world.js';
import { buildHandModel, alignBlockyHand } from './hands.js';

export const L = { hands: [], keys: {}, yaw: 0, pitch: 0, holdDist: 1.0, wristOpen: false, flashlight: null, mouse: new THREE.Vector2(), locked: false,
  feet: 0, vy: 0, kb: new THREE.Vector3(), lastRig: new THREE.Vector3(), ko: false, sliding: false };

function land(gy, gw) {
  const impact = -L.vy;
  L.feet = gy; L.vy = 0;
  if (gw && gw.bounce) { L.vy = gw.bounce; return; }
  if (impact > 6.5) { // cartoon splat after a big fall (e.g. jumping off the balcony)
    G.camera.getWorldPosition(_v);
    G.sound.play('npcFall', _v); G.sound.play('npcHit', _v, 0.7);
    G.combat && G.combat.fallDamage(impact);
  }
}
G.localHeld = new Map();

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _box = new THREE.Box3();
const _ray = new THREE.Raycaster();

// ---------- hand visuals ----------
function makeHandMesh(side) {
  const g = new THREE.Group();
  const skin = SKINS[Save.data.look.skin] ?? SKINS[0];
  const m = mat(skin);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.035, 0.1), m); palm.position.set(0, -0.01, 0.03); g.add(palm);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const piv = new THREE.Group(); piv.position.set(-0.03 + i * 0.02, -0.01, -0.02); g.add(piv);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.02, 0.07), m); f.position.z = -0.035; piv.add(f); fingers.push(piv);
  }
  const th = new THREE.Group(); th.position.set(side === 'left' ? 0.045 : -0.045, -0.005, 0.02); g.add(th);
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.06), m); t.position.z = -0.03; th.add(t);
  th.rotation.y = side === 'left' ? -0.6 : 0.6;
  g.userData = { fingers, thumb: th, palm };
  return g;
}
export function refreshHandSkin() {
  const m = mat(SKINS[Save.data.look.skin] ?? SKINS[0]);
  for (const h of L.hands) if (!h.model) h.mesh.traverse((o) => { if (o.isMesh) o.material = m; });
}

function makeHand(side, idx) {
  const h = {
    side, idx, grip: new THREE.Group(), ray: new THREE.Group(), inputSource: null, gp: null, mesh: makeHandMesh('right'),
    held: null, prev: new THREE.Vector3(), vel: new THREE.Vector3(), vhist: [], gripDown: false, trigDown: false,
    btnA: false, btnB: false, stickTurnReady: true, teleporting: false, pokeLast: new Map(), active: false, curl: 0, spraying: null, model: null,
    getWorldPose(p, q) { this.grip.getWorldPosition(p); this.grip.getWorldQuaternion(q); },
    // where tools should point: the controller's pointing ray in VR, the camera on desktop
    getAimQuat(q) { if (G.vr && this.active) this.ray.getWorldQuaternion(q); else G.camera.getWorldQuaternion(q); },
  };
  // fallback blocky hand, aligned to grip space the same way as the real model
  h.handRoot = new THREE.Group(); h.handRoot.add(h.mesh); alignBlockyHand(h.handRoot, side);
  h.grip.add(h.handRoot);
  // laser
  const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  h.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffd23f }));
  h.laser.visible = false; h.ray.add(h.laser);
  h.cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat(0xffffff, { basic: true }));
  h.cursor.visible = false;
  return h;
}

export function initPlayer(scene, renderer, camera) {
  const rig = new THREE.Group(); rig.add(camera); scene.add(rig); G.rig = rig;
  rig.position.copy(Z.spawn);
  for (let i = 0; i < 2; i++) {
    const ctl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i);
    rig.add(ctl); rig.add(grip);
    const onConn = (e) => {
      const side = e.data.handedness === 'left' ? 0 : 1;
      const h = L.hands[side];
      h.inputSource = e.data; h.gp = e.data.gamepad;
      // re-parent the hand's visual containers onto the real XR spaces
      grip.add(h.grip); ctl.add(h.ray); h.active = true;
      h.ctl = ctl; h.gripSpace = grip;
    };
    const onDisc = () => { for (const h of L.hands) if (h.ctl === ctl) { h.active = false; h.inputSource = null; h.gp = null; ctl.remove(h.ray); grip.remove(h.grip); } };
    ctl.addEventListener('connected', onConn); ctl.addEventListener('disconnected', onDisc);
  }
  L.hands = [makeHand('left', 0), makeHand('right', 1)];
  L.hands.forEach((h) => scene.add(h.cursor));

  // desktop "hand": floats in front of the camera
  L.deskHand = L.hands[1];
  L.deskAnchor = new THREE.Group(); camera.add(L.deskAnchor);

  // flashlight (always present so light count never changes => no shader recompiles)
  L.flashlight = new THREE.SpotLight(0xfff2cc, 0, 18, 0.5, 0.5, 1.2);
  const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -1);
  L.flashlight.add(tgt); L.flashlight.target = tgt;
  L.hands[1].grip.add(L.flashlight);

  // comfort vignette
  const vg = new THREE.RingGeometry(0.11, 0.5, 32);
  L.vignette = new THREE.Mesh(vg, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false }));
  L.vignette.position.z = -0.12; L.vignette.renderOrder = 999; camera.add(L.vignette);

  // teleport arc
  L.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(30).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0x3ddc84 }));
  L.arc.frustumCulled = false; L.arc.visible = false; scene.add(L.arc);
  L.tpRing = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 24), new THREE.MeshBasicMaterial({ color: 0x3ddc84 }));
  L.tpRing.rotation.x = -Math.PI / 2; L.tpRing.visible = false; scene.add(L.tpRing);

  setupDesktopInput(renderer.domElement);
}

// Swap in the uploaded rigged hand once assets are loaded
export function upgradeHands() {
  for (const h of L.hands) {
    const m = buildHandModel(h.side);
    if (!m) continue;
    h.grip.remove(h.handRoot);
    h.handRoot = m.group; h.model = m; h.grip.add(m.group);
  }
}

export function enterDesktopMode() {
  G.desktop = true;
  const cam = G.camera;
  cam.position.set(0, 1.6, 0);
  for (const h of L.hands) h.active = false;
  const h = L.deskHand; h.active = true;
  L.deskAnchor.add(h.grip); h.grip.position.set(0.18, -0.2, -0.55);
  h.grip.rotation.set(0.6, 0, 0); // tilt the grip space so the relaxed fingers point forward on screen
  document.getElementById('crosshair').style.display = 'block';
}

// ---------- input ----------
function setupDesktopInput(dom) {
  addEventListener('keydown', (e) => {
    L.keys[e.code] = true;
    if (!G.desktop) return;
    if (e.code === 'Tab') { e.preventDefault(); G.menus && G.menus.toggleWrist(); }
    if (e.code === 'KeyE' && !e.repeat) { if (!G.combat.tryFire(L.deskHand) && !startSpray(L.deskHand)) useHeld(L.deskHand); }
    if (e.code === 'KeyF' && !e.repeat && G.mode === 'play') G.combat.desktopPunch();
  });
  addEventListener('keyup', (e) => { L.keys[e.code] = false; if (e.code === 'KeyE') stopSpray(L.deskHand); });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('mousemove', (e) => {
    L.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (document.pointerLockElement === dom) {
      L.yaw -= e.movementX * 0.0025; L.pitch = clamp(L.pitch - e.movementY * 0.0025, -1.4, 1.4);
    }
  });
  dom.addEventListener('wheel', (e) => { L.holdDist = clamp(L.holdDist - e.deltaY * 0.001, 0.4, 2.5); });
  dom.addEventListener('mouseup', (e) => { if (e.button === 2) L.mouseFire = false; });
  dom.addEventListener('mousedown', (e) => {
    if (!G.desktop || G.vr) return;
    const locked = document.pointerLockElement === dom;
    // pointer ray: crosshair when locked, mouse position otherwise
    if (locked) _ray.setFromCamera(new THREE.Vector2(0, 0), G.camera); else _ray.setFromCamera(L.mouse, G.camera);
    const hit = raycastPanels(_ray.ray.origin, _ray.ray.direction, 8);
    if (hit) { hit.panel.click(hit.uv); return; }
    if (G.mode !== 'play') return;
    if (!locked) { dom.requestPointerLock && dom.requestPointerLock(); return; }
    const h = L.deskHand;
    if (e.button === 0) {
      if (h.held) release(h, true); else desktopGrab(h);
    } else if (e.button === 2) {
      if (h.held && G.combat.tryFire(h)) { L.mouseFire = true; return; }
      if (h.held) { // power throw
        G.camera.getWorldDirection(_v); h.vel.copy(_v).multiplyScalar(11); h.vel.y += 2; release(h, false, true);
      } else desktopPress();
    }
  });
}

const _sph = new THREE.Sphere();
function desktopGrab(h) {
  _ray.setFromCamera(new THREE.Vector2(0, 0), G.camera); _ray.far = 3.5;
  const meshes = []; let best = null, bestD = 3.5, bestP = null;
  for (const o of G.objects.values()) {
    if (o.mesh.position.distanceToSquared(_ray.ray.origin) > 16) continue;
    if (o.inst) { // instanced items have no mesh to raycast: use a bounding sphere
      _sph.set(o.mesh.position, Math.max(0.08, o.radius * 0.8));
      const p = _ray.ray.intersectSphere(_sph, new THREE.Vector3());
      if (p) { const d = p.distanceTo(_ray.ray.origin); if (d < bestD) { bestD = d; best = o; bestP = p; } }
    } else meshes.push(o.mesh);
  }
  const hits = _ray.intersectObjects(meshes, true);
  if (hits.length && hits[0].distance < bestD && hits[0].object.userData.obj) { best = hits[0].object.userData.obj; bestD = hits[0].distance; bestP = hits[0].point; }
  if (!best) { G.combat && G.combat.desktopPunch(); return; }
  L.holdDist = clamp(bestD, 0.6, 1.6);
  h.grip.position.set(0, -0.1, -L.holdDist);
  h.grip.updateMatrixWorld(true);
  // pull the object to the hand point instead of a far offset
  grab(h, best, bestP);
}

function desktopPress() {
  _ray.setFromCamera(new THREE.Vector2(0, 0), G.camera); _ray.far = 3;
  const caps = G.buttons.map((b) => b.cap);
  const hit = _ray.intersectObjects(caps, false)[0];
  if (hit) pressButton(hit.object.userData.button);
}

// ---------- grab / release ----------
function findGrabTarget(h) {
  h.getWorldPose(_v, _q);
  let best = null, bestD = 0.09;
  for (const o of G.objects.values()) {
    if (o.mesh.position.distanceToSquared(_v) > 4) continue;
    let d;
    if (o.inst) d = o.mesh.position.distanceTo(_v) - o.radius * 0.75;
    else { _box.setFromObject(o.mesh); d = _box.distanceToPoint(_v); }
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

export function grab(h, obj, anchorPoint) {
  h.getWorldPose(_v, _q);
  _q2.copy(_q).invert();
  const offPos = new THREE.Vector3();
  let offQuat;
  if (obj.def.snap) {
    // tools snap into the hand: handle in the palm, nozzle pointing where the controller points
    const aim = new THREE.Quaternion(); h.getAimQuat(aim);
    offQuat = _q2.clone().multiply(aim);
    const hd = obj.def.snap.handle;
    offPos.set(-hd[0], -hd[1], -hd[2]).applyQuaternion(offQuat);
    if (G.desktop && !G.vr) offPos.add(new THREE.Vector3(0, 0.05, 0));
  } else {
    if (anchorPoint) offPos.copy(obj.mesh.position).sub(anchorPoint).applyQuaternion(_q2);
    else offPos.copy(obj.mesh.position).sub(_v).applyQuaternion(_q2);
    offQuat = _q2.clone().multiply(obj.mesh.quaternion);
  }
  h.held = obj.id;
  G.localHeld.set(obj.id, { hand: h, offPos, offQuat });
  sfx('grab', obj.mesh.position); haptic(h, 0.4, 30);
  G.net.requestGrab(obj.id, h.idx, offPos, offQuat);
}

function startSpray(h) {
  const o = h.held && G.objects.get(h.held);
  if (!o || !o.def.spray || h.spraying) return false;
  h.spraying = o.id;
  G.net.sendAction({ a: 'spray', id: o.id, on: true });
  return true;
}
function stopSpray(h) {
  if (!h.spraying) return;
  G.net.sendAction({ a: 'spray', id: h.spraying, on: false });
  h.spraying = null;
}

export function release(h, useVel = true, power = false) {
  if (!h.held) return;
  stopSpray(h);
  const id = h.held;
  h.held = null;
  G.localHeld.delete(id);
  const vel = h.vel.clone();
  if (!G.desktop || power) vel.multiplyScalar(power ? 1 : 1.25); // a little throw boost feels good
  if (vel.length() > 2.5) Save.stat('thrown');
  G.net.requestRelease(id, h.idx, vel);
}

export function forceDrop(id) { // host stole/removed our object
  for (const h of L.hands) if (h.held === id) { h.held = null; h.spraying = null; }
  G.localHeld.delete(id);
}
G.forceDropLocal = forceDrop;

function useHeld(h) {
  const o = h.held && G.objects.get(h.held);
  if (!o) return;
  if (o.type === 'cart') sfx('squeak', o.mesh.position);
  else if (o.type === 'duck') sfx('squeak', o.mesh.position, 1.5);
  else if (o.type === 'tp') sfx('whoosh', o.mesh.position);
  else sfx('pop', o.mesh.position);
  G.net.sendAction({ a: 'use', id: o.id });
}

export function pressButton(b) {
  const now = performance.now();
  if (now < b.pressedUntil) return;
  b.pressedUntil = now + 400;
  b.cap.position.y = 0.01;
  setTimeout(() => (b.cap.position.y = 0.03), 200);
  sfx('click', b.worldPos);
  for (const h of L.hands) if (h.active) haptic(h, 0.5, 40);
  G.net.sendAction({ a: 'btn', id: b.id });
}

// ---------- per-frame ----------
export function updatePlayer(dt) {
  const rig = G.rig, cam = G.camera;
  const s = Save.data.settings;
  let moving = 0;
  const canMove = G.mode === 'play' && !L.ko;

  if (G.desktop && !G.vr) {
    rig.rotation.y = L.yaw; cam.rotation.set(L.pitch, 0, 0, 'YXZ');
    if (canMove) {
      const f = (L.keys.KeyW ? 1 : 0) - (L.keys.KeyS ? 1 : 0), r = (L.keys.KeyD ? 1 : 0) - (L.keys.KeyA ? 1 : 0);
      if (f || r) {
        const sp = (L.keys.ShiftLeft ? 5 : 3) * dt;
        _v.set(r, 0, -f).normalize().applyAxisAngle(_v2.set(0, 1, 0), L.yaw).multiplyScalar(sp);
        rig.position.add(_v);
      }
    }
    L.deskHand.handRoot.visible = G.mode === 'play';
    if (L.deskHand.model) L.deskHand.model.setPose(L.deskHand.held ? 1 : 0.15, L.deskHand.held ? 1 : 0.1);
    if (G.mode === 'play') {
      const h = L.deskHand;
      if ((L.mouseFire || L.keys.KeyE) && h.held) G.combat.tryFire(h);
      if (L.punchT > 0) { L.punchT -= dt; h.grip.position.lerp(_v.set(0.05, -0.12, -0.95), Math.min(1, dt * 30)); h.model && h.model.setPose(1, 1); }
      else if (h.held) h.grip.position.lerp(_v.set(0, -0.1, -L.holdDist), Math.min(1, dt * 10));
      else h.grip.position.lerp(_v.set(0.18, -0.2, -0.55), Math.min(1, dt * 10));
    }
  }

  if (G.vr) {
    const [lh, rh] = L.hands;
    // smooth locomotion (left stick)
    if (canMove && lh.gp && (s.move === 'smooth' || s.move === 'both')) {
      const ax = lh.gp.axes[2] || 0, ay = lh.gp.axes[3] || 0;
      if (Math.hypot(ax, ay) > 0.15) {
        cam.getWorldDirection(_v); _v.y = 0; _v.normalize();
        _v2.crossVectors(_v, new THREE.Vector3(0, 1, 0));
        const sp = 2.6 * dt;
        rig.position.addScaledVector(_v, -ay * sp).addScaledVector(_v2, ax * sp);
        moving = Math.min(1, Math.hypot(ax, ay));
      }
    }
    // turning (right stick x)
    if (rh.gp) {
      const ax = rh.gp.axes[2] || 0, ay = rh.gp.axes[3] || 0;
      if (s.turn === 'snap') {
        if (Math.abs(ax) > 0.7 && rh.stickTurnReady) { turnRig(-Math.sign(ax) * s.snapAngle * Math.PI / 180); rh.stickTurnReady = false; }
        if (Math.abs(ax) < 0.3) rh.stickTurnReady = true;
      } else if (Math.abs(ax) > 0.2) { turnRig(-ax * s.smoothTurnSpeed * Math.PI / 180 * dt); moving = Math.max(moving, Math.abs(ax)); }
      // teleport (right stick forward)
      if (canMove && (s.move === 'teleport' || s.move === 'both')) {
        if (ay < -0.7) { rh.teleporting = true; aimTeleport(rh); }
        else if (rh.teleporting && ay > -0.3) { rh.teleporting = false; doTeleport(); }
      }
    }
    for (const h of L.hands) if (h.active) handInput(h, dt);
  }

  // ---- knockback from hits / blasts (decays quickly, still collides with walls below) ----
  if (L.kb.lengthSq() > 1e-4) {
    rig.position.x += L.kb.x * dt; rig.position.z += L.kb.z * dt;
    L.kb.multiplyScalar(Math.max(0, 1 - dt * 4));
  }

  // ---- floors, stairs, escalators, slide, trampolines, elevator, falling ----
  cam.getWorldPosition(_v);
  const g = groundAt(_v.x, _v.z, L.feet, 0.6);
  const gy = g.y < -50 ? L.feet : g.y, gw = g.w;
  // stick to slopes / stairs / the slide when walking down them (instead of hopping off every frame)
  if (L.vy <= 0 && L.feet > gy && L.feet - gy < (gw && gw.slide ? 0.6 : 0.3)) L.feet = gy;
  const onGround = L.feet <= gy + 0.05 && L.vy <= 0;
  if (onGround && gw) {
    if (gw.escalator && !G.escalatorBroken) rig.position.x += gw.dirX * 0.9 * dt;     // escalators carry you
    if (gw.slide) { rig.position.x -= 6.5 * dt; L.sliding = true; }                    // SUPER SLIDE
  }
  if (L.vy > 0 || L.feet > gy + 0.03) { // airborne
    L.vy -= 9.8 * dt; L.feet += L.vy * dt;
    if (L.feet <= gy) land(gy, gw);
  } else {
    L.feet += (gy - L.feet) * Math.min(1, dt * 14);  // smooth stair steps
    if (gw && gw.bounce) { L.vy = gw.bounce; G.sound.play('npcStumble', _v, 0.6); }  // trampolines + beds bounce you
    if (L.sliding && !gw?.slide) { L.sliding = false; L.kb.x -= 4; }                   // shoot off the end of the slide
  }
  rig.position.y = L.feet + (G.vr ? s.height : 0);

  // hand velocities (smoothed over a few frames for good throws). relVel = swing speed relative to your body.
  const rigDX = (rig.position.x - L.lastRig.x) / Math.max(dt, 1e-3), rigDZ = (rig.position.z - L.lastRig.z) / Math.max(dt, 1e-3);
  L.lastRig.copy(rig.position);
  for (const h of L.hands) {
    h.getWorldPose(_v, _q);
    if (dt > 0) {
      const inst = _v2.copy(_v).sub(h.prev).divideScalar(dt);
      h.vhist.push(inst.clone()); if (h.vhist.length > 4) h.vhist.shift();
      h.vel.set(0, 0, 0); h.vhist.forEach((x) => h.vel.add(x)); h.vel.divideScalar(h.vhist.length);
      h.relVel = h.relVel || new THREE.Vector3(); h.relVel.set(h.vel.x - rigDX, h.vel.y, h.vel.z - rigDZ);
    }
    h.prev.copy(_v);
  }

  // body collision: keep the head out of walls on the current floor (stick movement AND physical walking)
  cam.getWorldPosition(_v);
  const c = collideCircle(_v.x, _v.z, 0.25, L.feet + 0.35, L.feet + 1.7);
  rig.position.x += c.x - _v.x; rig.position.z += c.z - _v.z;
  G.combat && G.combat.updateLocal(dt);

  // comfort vignette
  const vTarget = s.vignette && G.vr ? moving * 0.85 : 0;
  L.vignette.material.opacity += (vTarget - L.vignette.material.opacity) * Math.min(1, dt * 8);
  L.vignette.visible = L.vignette.material.opacity > 0.01;

  // UI lasers / pokes
  updatePointers(dt);
  L.flashlight.intensity = G.events.outage ? 4 : 0;
  if (G.desktop && !G.vr) { // flashlight follows desktop camera
    if (L.flashlight.parent !== cam) cam.add(L.flashlight);
  }
}

function turnRig(angle) {
  G.camera.getWorldPosition(_v);
  G.rig.position.sub(_v).applyAxisAngle(_v2.set(0, 1, 0), angle).add(_v);
  G.rig.rotation.y += angle;
}

function handInput(h, dt) {
  const gp = h.gp; if (!gp) return;
  const grip = gp.buttons[1] ? gp.buttons[1].value : 0;
  const trig = gp.buttons[0] ? gp.buttons[0].value : 0;
  // finger animation: grip curls middle/ring/pinky/thumb, trigger curls the index (point by releasing trigger)
  h.curl += (Math.max(grip, h.held ? 1 : 0) - h.curl) * Math.min(1, dt * 20);
  h.icurl = (h.icurl || 0) + ((h.held ? Math.max(0.85, trig) : trig) - (h.icurl || 0)) * Math.min(1, dt * 20);
  if (h.model) h.model.setPose(h.curl, h.icurl);
  else { h.mesh.userData.fingers.forEach((f) => (f.rotation.x = -h.curl * 1.4)); h.mesh.userData.thumb.rotation.x = -trig * 0.8; }

  const gripNow = grip > 0.55;
  if (gripNow && !h.gripDown && G.mode === 'play') { const t = findGrabTarget(h); if (t) grab(h, t); }
  if (!gripNow && h.gripDown && h.held) release(h);
  h.gripDown = gripNow;

  const trigNow = trig > 0.6;
  if (trigNow && !h.trigDown) {
    if (h.uiHit) h.uiHit.panel.click(h.uiHit.uv);
    else if (h.btnHit) pressButton(h.btnHit);
    else if (h.held && !G.combat.tryFire(h) && !startSpray(h)) useHeld(h);
  }
  if (trigNow && h.held) G.combat.tryFire(h); // blasters are full-auto while you hold the trigger
  if (!trigNow && h.trigDown) stopSpray(h);
  if (h.spraying) haptic(h, 0.15, 20); // gentle rumble while spraying
  h.trigDown = trigNow;

  // X/Y (left) or B (right) open the wrist menu
  const a = gp.buttons[4] && gp.buttons[4].pressed, b = gp.buttons[5] && gp.buttons[5].pressed;
  if (h.side === 'left' && (a || b) && !h.btnA) G.menus && G.menus.toggleWrist();
  if (h.side === 'right' && b && !h.btnB) G.menus && G.menus.toggleWrist();
  h.btnA = h.side === 'left' ? (a || b) : a; if (h.side === 'right') h.btnB = b;
}

const _dir = new THREE.Vector3(), _o = new THREE.Vector3(), _tip = new THREE.Vector3(), _loc = new THREE.Vector3();
function updatePointers(dt) {
  for (const h of L.hands) {
    h.uiHit = null; h.btnHit = null; h.laser.visible = false; h.cursor.visible = false;
    if (!G.vr || !h.active || h.held) { if (h.lastHover) { h.lastHover.hover(null); h.lastHover = null; } continue; }
    h.ray.getWorldPosition(_o); h.ray.getWorldQuaternion(_q); _dir.set(0, 0, -1).applyQuaternion(_q);
    const hit = raycastPanels(_o, _dir, 5);
    // skip the wrist panel for the hand wearing it
    if (hit && !(hit.panel === G.menus?.wrist && h.side === 'left')) {
      h.uiHit = hit;
      h.laser.visible = true; h.laser.scale.z = hit.distance;
      h.cursor.visible = true; h.cursor.position.copy(hit.point);
      if (h.lastHover && h.lastHover !== hit.panel) h.lastHover.hover(null);
      hit.panel.hover(hit.uv); h.lastHover = hit.panel;
    } else {
      if (h.lastHover) { h.lastHover.hover(null); h.lastHover = null; }
      // laser at 3D buttons
      _ray.set(_o, _dir); _ray.far = 3;
      const bh = _ray.intersectObjects(G.buttons.map((b) => b.cap), false)[0];
      if (bh && G.mode === 'play') { h.btnHit = bh.object.userData.button; h.laser.visible = true; h.laser.scale.z = bh.distance; }
    }
    // finger poke: panels + physical buttons (uses the real index fingertip bone when the hand model is loaded)
    if (h.model && h.model.tip) h.model.tip.getWorldPosition(_tip);
    else { h.getWorldPose(_tip, _q); _tip.add(_v.set(0, -0.06, -0.08).applyQuaternion(_q)); }
    for (const p of G.panels) {
      if (!p.visible() || (p === G.menus?.wrist && h.side === 'left')) continue;
      _loc.copy(_tip); p.mesh.worldToLocal(_loc);
      const inside = Math.abs(_loc.x) < p.wM / 2 && Math.abs(_loc.y) < p.hM / 2;
      const was = h.pokeLast.get(p) ?? 1;
      if (inside && _loc.z < 0.012 && was >= 0.012 && _loc.z > -0.05) {
        p.click({ x: _loc.x / p.wM + 0.5, y: _loc.y / p.hM + 0.5 }); haptic(h, 0.6, 30);
      }
      h.pokeLast.set(p, inside ? _loc.z : 1);
    }
    if (G.mode === 'play') for (const b of G.buttons) {
      _loc.copy(_tip).sub(b.worldPos);
      const along = _loc.dot(b.normal);
      const lateral = _loc.addScaledVector(b.normal, -along).length();
      if (lateral < 0.075 && along < 0.05 && along > -0.04) pressButton(b);
    }
  }
}

function aimTeleport(h) {
  h.ray.getWorldPosition(_o); h.ray.getWorldQuaternion(_q); _dir.set(0, 0, -1).applyQuaternion(_q);
  const pts = L.arc.geometry.attributes.position;
  const v = _dir.clone().multiplyScalar(7), p = _o.clone();
  let hit = null; let i = 0;
  for (; i < 30; i++) {
    pts.setXYZ(i, p.x, p.y, p.z);
    if (!hit) {
      const np = p.clone().addScaledVector(v, 0.04); v.y -= 9.8 * 0.04;
      // land on whatever floor is below the arc (L1, L2 balcony, stairs, roof...)
      const g = groundAt(np.x, np.z, p.y, 0);
      if (np.y <= g.y && g.y > -50) { hit = new THREE.Vector3(np.x, g.y, np.z); p.copy(hit); }
      else p.copy(np);
    }
  }
  pts.needsUpdate = true;
  const ok = hit && !pointBlocked(hit.x, hit.z, 0.25, hit.y) && hit.distanceTo(_o) < 14;
  L.arc.visible = true; L.arc.material.color.setHex(ok ? 0x3ddc84 : 0xff5252);
  L.tpRing.visible = !!hit; if (hit) L.tpRing.position.set(hit.x, hit.y + 0.02, hit.z);
  L.tpRing.material.color.setHex(ok ? 0x3ddc84 : 0xff5252);
  L.tpTarget = ok ? hit : null;
}
function doTeleport() {
  L.arc.visible = false; L.tpRing.visible = false;
  if (!L.tpTarget) return;
  G.camera.getWorldPosition(_v);
  G.rig.position.x += L.tpTarget.x - _v.x; G.rig.position.z += L.tpTarget.z - _v.z;
  L.feet = L.tpTarget.y; L.vy = 0;
  sfx('whoosh'); L.tpTarget = null;
}

// y = floor height to arrive on (defaults to the highest floor at that spot that isn't the roof)
export function teleportTo(x, z, faceYaw = null, y = null) {
  G.camera.getWorldPosition(_v);
  G.rig.position.x += x - _v.x; G.rig.position.z += z - _v.z;
  L.feet = y ?? Math.max(0, groundAt(x, z, 0.5, 0).y); L.vy = 0; L.kb.set(0, 0, 0);
  G.rig.position.y = L.feet + (G.vr ? Save.data.settings.height : 0);
  if (faceYaw !== null && G.desktop && !G.vr) L.yaw = faceYaw;
}

// Pose for networking / host simulation
export function getLocalPose(out) {
  G.camera.getWorldPosition(out.head.p); G.camera.getWorldQuaternion(out.head.q);
  for (let i = 0; i < 2; i++) {
    const h = L.hands[i], o = out.hands[i];
    o.active = h.active && (G.vr || (G.desktop && h === L.deskHand));
    if (o.active) h.getWorldPose(o.p, o.q);
    o.fist = h.gripDown && !h.held;
    o.closed = !!h.held || h.gripDown;
  }
}
