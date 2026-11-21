// =====================================================================
//  ARCADE COMBAT (cartoon, non-graphic)
//  Why hits used to feel random: the host guessed "hits" from 2D distance + laggy 20Hz hand poses.
//  Now YOUR headset checks contact every frame: the swept path of your hand (last frame -> this frame)
//  is tested against capsules for each target's head / body / legs. If they touch while your hand is
//  swinging into them, it's a hit: instant sound + haptics + comic text locally, then the host applies
//  the ragdoll/knockback and everyone else sees it.
// =====================================================================
import * as THREE from 'three';
import { G, newId } from './state.js';
import { Save } from './save.js';
import { L, teleportTo } from './player.js';
import { haptic } from './audio.js';
import { Z } from './world.js';
import { world, CANNON } from './physics.js';
import { confetti, smokePuff, P as Particles } from './particles.js';
import { textTexture, pick, rand } from './util.js';

export const C = { hp: 100, lastHurt: -99, koUntil: 0 };
G.combat = C;
const HAND_R = 0.07, MIN_SPEED = 1.5;

// ---------- geometry helpers ----------
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();
// closest distance between segments p1-q1 and p2-q2 (also returns closest point on first segment in out)
function segSeg(p1, q1, p2, q2, out) {
  const d1 = _a.subVectors(q1, p1), d2 = _b.subVectors(q2, p2), r = _c.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a < 1e-9 && e < 1e-9) { s = t = 0; }
  else if (a < 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1.dot(r);
    if (e < 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = _d.copy(p1).addScaledVector(d1, s), c2 = _t.copy(p2).addScaledVector(d2, t);
  if (out) out.copy(c1);
  return c1.distanceTo(c2);
}

// Hit volumes for everything punchable: [{type, id, zones:[{zone, a, b, r}]}]
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function targets() {
  const out = [];
  for (const n of G.npcs.values()) {
    if (n.code === 1 || n.rag) continue;
    const s = n.scale, y = n.fy || 0;
    out.push({ type: 'npc', id: n.id, x: n.x, y: y + 1, z: n.z, zones: [
      { zone: 'head', a: V(n.x, y + 1.52 * s, n.z), b: V(n.x, y + 1.66 * s, n.z), r: 0.17 * s },
      { zone: 'body', a: V(n.x, y + 0.85 * s, n.z), b: V(n.x, y + 1.38 * s, n.z), r: 0.27 * s },
      { zone: 'legs', a: V(n.x, y + 0.1, n.z), b: V(n.x, y + 0.8 * s, n.z), r: 0.2 * s }] });
  }
  for (const p of G.players.values()) {
    if (p.isLocal || p.ko || !p.vis) continue;
    const h = p.vis.hp;
    out.push({ type: 'p', id: p.id, x: h.x, y: h.y - 0.6, z: h.z, zones: [
      { zone: 'head', a: V(h.x, h.y - 0.08, h.z), b: V(h.x, h.y + 0.08, h.z), r: 0.17 },
      { zone: 'body', a: V(h.x, h.y - 0.85, h.z), b: V(h.x, h.y - 0.3, h.z), r: 0.25 },
      { zone: 'legs', a: V(h.x, h.y - 1.55, h.z), b: V(h.x, h.y - 0.9, h.z), r: 0.2 }] });
  }
  return out;
}

// ---------- local hit detection (VR hands) ----------
const lastPos = [new THREE.Vector3(), new THREE.Vector3()], hasLast = [false, false];
const cooldown = new Map();
const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _fwd = new THREE.Vector3(), _smp = new THREE.Vector3();
C.updateLocal = (dt) => {
  // health regen + KO timer
  if (!L.ko && C.hp < 100 && G.time - C.lastHurt > 4) C.hp = Math.min(100, C.hp + 6 * dt);
  if (L.ko && G.time > C.koUntil) respawn();
  updateFx(dt);
  updateKoOverlay(dt);
  if (!G.vr || G.mode !== 'play' || L.ko) { hasLast[0] = hasLast[1] = false; return; }
  const list = targets();
  L.hands.forEach((h, i) => {
    if (!h.active) { hasLast[i] = false; return; }
    h.getWorldPose(_hp, _hq);
    // the striking point sits a little in front of the palm, where knuckles / fingers are
    _hp.add(_fwd.set(0, -0.04, -0.05).applyQuaternion(_hq));
    if (!hasLast[i]) { lastPos[i].copy(_hp); hasLast[i] = true; return; }
    const v = h.relVel || h.vel, speed = v.length();
    if (speed > MIN_SPEED && !h.held) {
      for (const t of list) {
        if (Math.abs(t.x - _hp.x) > 1.5 || Math.abs(t.z - _hp.z) > 1.5) continue;
        for (const zn of t.zones) {
          const d = segSeg(lastPos[i], _hp, zn.a, zn.b, _cp);
          if (d > zn.r + HAND_R) continue;
          // must be swinging INTO them (judged from where the hand was before contact), not pulling away
          const lp = lastPos[i];
          _c.set(t.x - lp.x, 0, t.z - lp.z).normalize();
          if (_c.x * v.x + _c.z * v.z < 0.15 * speed) continue;
          // contact point = first touch along the swing, so effects appear where the hand landed
          for (let k = 0; k <= 8; k++) { _smp.copy(lp).lerp(_hp, k / 8); if (segSeg(_smp, _smp, zn.a, zn.b) <= zn.r + HAND_R) { _cp.copy(_smp); break; } }
          const key = t.type + t.id + i;
          if ((cooldown.get(key) || 0) > G.time) break;
          cooldown.set(key, G.time + 0.35);
          const kind = h.gripDown || h.curl > 0.6 ? 'punch' : 'slap';
          registerHit(t, zn.zone, _cp.clone(), v.clone().normalize(), Math.min(1, Math.max(0.12, (speed - MIN_SPEED) / 5)), kind, h);
          break;
        }
      }
    }
    lastPos[i].copy(_hp);
  });
};

// Desktop: left click on empty air (or F) throws a punch straight ahead
C.desktopPunch = () => {
  if (L.ko || G.mode !== 'play') return;
  L.punchT = 0.25;
  G.camera.getWorldPosition(_hp); G.camera.getWorldDirection(_fwd);
  const list = targets();
  for (let s = 0.2; s <= 1.3; s += 0.1) {
    _cp.copy(_hp).addScaledVector(_fwd, s);
    for (const t of list) for (const zn of t.zones) {
      if (segSeg(_cp, _cp, zn.a, zn.b) < zn.r + 0.08) { registerHit(t, zn.zone, _cp.clone(), _fwd.clone(), 0.55, 'punch', null); return; }
    }
  }
  G.sound.play('leafBlower', _hp, 0.3); // whiff
};

function registerHit(t, zone, point, dir, strength, kind, hand) {
  // instant local feedback (no waiting for the network)
  const head = zone === 'head';
  G.sound.play(kind === 'slap' ? 'slapHit' : 'punch', point, 0.6 + strength * 0.4);
  if (hand) haptic(hand, 0.4 + strength * 0.6, 60 + strength * 60);
  popText(kind === 'slap' ? pick(['SLAP!', 'THWACK!', 'SMACK!']) : head ? pick(['BONK!', 'POW!', 'KAPOW!']) : pick(['POW!', 'WHAM!', 'OOF!']), point, kind === 'slap' ? '#ff4f9a' : '#ffd23f');
  starBurst(point, 6 + strength * 10);
  Save.stat(kind === 'slap' ? 'slaps' : 'punches', 1, true);
  const msg = { t: t.type, id: t.id, zone, d: [dir.x, Math.max(0.15, dir.y), dir.z], s: strength, k: kind, p: [point.x, point.y, point.z] };
  if (G.isHost) hostHit(G.myId, msg); else G.net.sendHit(msg);
}

// ---------- HOST: apply hits ----------
export function hostHit(from, m) {
  const dir = { x: m.d[0], y: m.d[1], z: m.d[2] };
  if (m.t === 'npc') {
    const n = G.npcs.get(m.id); if (!n) return;
    G.npcHit && G.npcHit(n, dir, m.s, m.zone, from, m.k);
  } else if (m.t === 'p') {
    const dmg = Math.round((m.k === 'slap' ? 7 : 10) + 22 * m.s * (m.zone === 'head' ? 1.4 : m.zone === 'legs' ? 0.8 : 1));
    const hurt = { t: 'hurt', from, zone: m.zone, d: m.d, s: m.s, dmg, k: m.k };
    if (m.id === G.myId) C.onHurt(hurt); else G.net.sendTo(m.id, hurt);
  }
  // everyone else hears/sees it (the attacker already did)
  G.net.broadcastExcept(from, { t: 'hitfx', p: m.p, k: m.k, zone: m.zone, s: m.s });
}
C.hitFx = (m) => {
  const p = new THREE.Vector3(m.p[0], m.p[1], m.p[2]);
  G.sound.play(m.k === 'slap' ? 'slapHit' : 'punch', p, 0.6 + m.s * 0.4);
  popText(m.k === 'slap' ? 'SLAP!' : m.zone === 'head' ? 'BONK!' : 'POW!', p, m.k === 'slap' ? '#ff4f9a' : '#ffd23f');
  starBurst(p, 8);
};

// ---------- getting hit (runs on the victim's machine) ----------
C.onHurt = (m) => {
  if (L.ko) return;
  const pvp = Save.data.settings.pvp !== false || m.k === 'fall';
  const s = m.s ?? 0.5;
  // knockback is always on (it's funny); damage only with PvP enabled
  L.kb.x += m.d[0] * (2.5 + 7 * s); L.kb.z += m.d[2] * (2.5 + 7 * s);
  if (s > 0.5) L.vy = Math.max(L.vy, 2 + 3 * s);
  if (pvp) { C.hp -= m.dmg; C.lastHurt = G.time; }
  flash(m.k === 'fall' ? '#ffffff' : '#ff1744', 0.35 + s * 0.3);
  G.camera.getWorldPosition(_hp);
  G.sound.play(m.k === 'slap' ? 'slapHit' : 'punch', _hp, 1);
  for (const h of L.hands) if (h.active) haptic(h, 1, 120);
  if (C.hp <= 0) knockOut(m);
};
C.fallDamage = (impact) => C.onHurt({ k: 'fall', d: [0, 0, 0], s: 0.3, dmg: Math.round((impact - 6) * 7) });

function knockOut(m) {
  L.ko = true; C.hp = 0; C.koUntil = G.time + 5;
  G.sound.play('ko'); Save.stat('kos', 1, true);
  for (const h of L.hands) if (h.held) G.forceDropLocal(h.held);
  G.net.sendAction({ a: 'ko', d: m.d, s: m.s ?? 0.6, zone: m.zone || 'body' });
  G.menus && G.menus.banner('KNOCKED OUT! 💫', '#ffd23f', 3);
}
const RESPAWNS = [[0, 14, 0], [-20, 2, 0], [20, -2, 0], [0, -20, 0], [0, 30, 0]];
function respawn() {
  L.ko = false; C.hp = 100;
  const r = pick(RESPAWNS);
  teleportTo(r[0], r[1], 0, r[2]);
  G.sound.play('respawn');
  G.net.sendAction({ a: 'respawn' });
}
C.respawnNow = () => { if (L.ko) C.koUntil = G.time; };

// ---------- blasters (fire requests) ----------
const lastShot = new Map();
C.tryFire = (h) => {
  const o = h.held && G.objects.get(h.held);
  if (!o || !o.def.blast || L.ko) return false;
  const now = performance.now() / 1000;
  if (now - (lastShot.get(o.id) || 0) < o.def.blast.rate) return true;
  lastShot.set(o.id, now);
  if (h.inputSource || h.active) haptic(h, 0.5, 40);
  G.net.sendAction({ a: 'fire', id: o.id });
  return true;
};

// ---------- projectiles (host simulates hits; everyone flies the same ballistic path) ----------
const projs = new Map();
const dartGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6); dartGeo.rotateX(Math.PI / 2);
const ballGeo = new THREE.SphereGeometry(0.14, 12, 8);
function addProjVisual(pr) {
  const m = pr.k === 'dart' ? new THREE.Mesh(dartGeo, new THREE.MeshLambertMaterial({ color: pick([0xff6d00, 0x2196f3, 0x76ff03]) }))
    : new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ color: pick([0xff4f9a, 0xffd23f, 0x3ddc84, 0x7c4dff]) }));
  m.position.copy(pr.p); G.scene.add(m); pr.mesh = m;
  projs.set(pr.id, pr);
}
function removeProj(id, fx = true) {
  const pr = projs.get(id); if (!pr) return;
  G.scene.remove(pr.mesh); projs.delete(id);
  if (fx) { confetti(pr.p, pr.k === 'dart' ? 5 : 16); }
}
export function hostFire(pid, id) {
  const o = G.objects.get(id); if (!o || !o.def.blast || !o.holder || o.holder.pid !== pid) return;
  const b = o.def.blast;
  const p = new THREE.Vector3(b.nozzle[0], b.nozzle[1], b.nozzle[2]); o.mesh.localToWorld(p);
  const q = new THREE.Quaternion(); o.mesh.getWorldQuaternion(q);
  const dir = new THREE.Vector3(rand(-b.spread, b.spread), rand(-b.spread, b.spread), -1).normalize().applyQuaternion(q);
  const pr = { id: newId('p'), k: b.proj, p, v: dir.multiplyScalar(b.speed), life: 4, bounces: b.proj === 'boing' ? 3 : 0, from: pid, age: 0 };
  addProjVisual(pr);
  G.net.broadcast({ t: 'proj', id: pr.id, k: pr.k, p: p.toArray(), v: pr.v.toArray(), from: pid });
  G.sound.playAll(b.sound, p);
}
export function clientAddProj(m) {
  addProjVisual({ id: m.id, k: m.k, p: new THREE.Vector3().fromArray(m.p), v: new THREE.Vector3().fromArray(m.v), life: 4, bounces: 0, from: m.from, age: 0 });
}
export function clientEndProj(m) { const pr = projs.get(m.id); if (pr && m.p) pr.p.fromArray(m.p); removeProj(m.id); }

const _p0 = new THREE.Vector3(), _ray = new CANNON.RaycastResult(), _from = new CANNON.Vec3(), _to = new CANNON.Vec3();
export function updateProjectiles(dt) {
  for (const pr of [...projs.values()]) {
    pr.age += dt; pr.life -= dt;
    _p0.copy(pr.p);
    pr.v.y -= 9.8 * dt * (pr.k === 'dart' ? 0.35 : 0.9);
    pr.p.addScaledVector(pr.v, dt);
    pr.mesh.position.copy(pr.p);
    if (pr.k === 'dart') pr.mesh.lookAt(_c.copy(pr.p).add(pr.v));
    if (!G.isHost) { if (pr.life < -1) removeProj(pr.id, false); continue; }
    if (pr.life <= 0) { endProj(pr); continue; }
    // players + NPCs (capsules)
    let hit = false;
    for (const t of targets().concat(localTarget())) {
      if (t.id === pr.from && pr.age < 0.3) continue;
      if (Math.abs(t.x - pr.p.x) > 2 || Math.abs(t.z - pr.p.z) > 2) continue;
      for (const zn of t.zones) {
        if (segSeg(_p0, pr.p, zn.a, zn.b, _cp) < zn.r + (pr.k === 'dart' ? 0.03 : 0.14)) {
          const dir = pr.v.clone().normalize();
          const s = pr.k === 'dart' ? 0.35 : 0.85;
          const msg = { t: t.type, id: t.id, zone: zn.zone, d: [dir.x, Math.max(0.2, dir.y), dir.z], s, k: pr.k === 'dart' ? 'dart' : 'boing', p: _cp.toArray() };
          hostHit(pr.from, msg); hitFxAll(msg);
          hit = true; break;
        }
      }
      if (hit) break;
    }
    if (hit) { endProj(pr); continue; }
    // world (walls, shelves, objects)
    _from.set(_p0.x, _p0.y, _p0.z); _to.set(pr.p.x, pr.p.y, pr.p.z);
    _ray.reset();
    world.raycastClosest(_from, _to, { collisionFilterMask: 1 | 4, skipBackfaces: true }, _ray);
    if (_ray.hasHit) {
      const b = _ray.body;
      if (b.mass > 0 && b.type === CANNON.Body.DYNAMIC) { // knock stuff over
        b.wakeUp(); const k = pr.k === 'dart' ? 0.4 : 3;
        b.applyImpulse(new CANNON.Vec3(pr.v.x * k * 0.1, pr.v.y * k * 0.1 + k * 0.3, pr.v.z * k * 0.1), _ray.hitPointWorld);
        if (b.userData && b.userData.obj) b.userData.obj.lastHolder = pr.from;
      }
      if (pr.bounces > 0) { // boing balls bounce off walls
        pr.bounces--; const n = _ray.hitNormalWorld;
        const vn = pr.v.x * n.x + pr.v.y * n.y + pr.v.z * n.z;
        pr.v.set(pr.v.x - 2 * vn * n.x, pr.v.y - 2 * vn * n.y, pr.v.z - 2 * vn * n.z).multiplyScalar(0.75);
        pr.p.set(_ray.hitPointWorld.x + n.x * 0.15, _ray.hitPointWorld.y + n.y * 0.15, _ray.hitPointWorld.z + n.z * 0.15);
        G.sound.playAll('npcStumble', pr.p, 0.7);
        G.net.broadcast({ t: 'projB', id: pr.id, p: pr.p.toArray(), v: pr.v.toArray() });
      } else { pr.p.set(_ray.hitPointWorld.x, _ray.hitPointWorld.y, _ray.hitPointWorld.z); endProj(pr); }
    }
  }
}
export function clientProjBounce(m) { const pr = projs.get(m.id); if (pr) { pr.p.fromArray(m.p); pr.v.fromArray(m.v); } }
function endProj(pr) { G.net.broadcast({ t: 'projEnd', id: pr.id, p: pr.p.toArray() }); removeProj(pr.id); }
function hitFxAll(msg) { C.hitFx(msg); G.net.broadcast({ t: 'hitfx', p: msg.p, k: msg.k, zone: msg.zone, s: msg.s }); }
// the host player is a target for other players' darts too
function localTarget() {
  if (!G.isHost || L.ko || !G.me) return [];
  const h = G.me.head.p;
  return [{ type: 'p', id: G.myId, x: h.x, y: h.y - 0.6, z: h.z, zones: [
    { zone: 'head', a: V(h.x, h.y - 0.08, h.z), b: V(h.x, h.y + 0.08, h.z), r: 0.17 },
    { zone: 'body', a: V(h.x, h.y - 0.85, h.z), b: V(h.x, h.y - 0.3, h.z), r: 0.25 }] }];
}
export function clearProjectiles() { for (const id of [...projs.keys()]) removeProj(id, false); }

// ---------- comic FX ----------
const fx = [];
function popText(text, pos, color = '#ffd23f') {
  const tex = textTexture(text, { w: 256, h: 128, bg: null, fg: color, font: 'bold 84px "Arial Black", "Trebuchet MS", sans-serif' });
  const ctx = tex.image.getContext('2d'); // add an outline so it reads on anything
  ctx.strokeStyle = '#1b1340'; ctx.lineWidth = 6; ctx.font = 'bold 84px "Arial Black", "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeText(text, 128, 70); ctx.fillStyle = color; ctx.fillText(text, 128, 70); tex.needsUpdate = true;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.position.set(pos.x, pos.y + 0.2, pos.z); s.scale.set(0.6, 0.3, 1); s.renderOrder = 999; s.material.rotation = rand(-0.3, 0.3);
  G.scene.add(s); fx.push({ s, t: 0 });
  if (fx.length > 10) { const old = fx.shift(); G.scene.remove(old.s); old.s.material.map.dispose(); }
}
C.popText = popText;
function starBurst(p, n) { for (let i = 0; i < n; i++) Particles.flame.emit(p.x, p.y, p.z, rand(-3, 3), rand(0, 3), rand(-3, 3), pick([0xffd23f, 0xffffff, 0xff4f9a]), 0.4, 0.3, 2); }
function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt;
    const k = f.t / 0.8;
    f.s.position.y += dt * 0.6; f.s.scale.set(0.6 + k * 0.3, 0.3 + k * 0.15, 1); f.s.material.opacity = 1 - k;
    if (f.t > 0.8) { G.scene.remove(f.s); f.s.material.map.dispose(); fx.splice(i, 1); }
  }
}
// screen flash + KO overlay attached to the camera
let flashMesh = null, flashT = 0, koMesh = null;
function flash(color, strength) {
  if (!flashMesh) {
    flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0xff1744, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    flashMesh.position.z = -0.3; flashMesh.renderOrder = 1500; G.camera.add(flashMesh);
  }
  flashMesh.material.color.set(color); flashMesh.material.opacity = strength; flashT = strength;
}
function updateKoOverlay(dt) {
  if (flashMesh) { flashT = Math.max(0, flashT - dt * 1.5); flashMesh.material.opacity = flashT; flashMesh.visible = flashT > 0.01; }
  if (!koMesh) {
    koMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: textTexture('KNOCKED OUT\nrespawning...', { w: 512, h: 256, bg: 'rgba(10,5,30,0.92)', fg: '#ffd23f', font: 'bold 60px "Trebuchet MS", sans-serif', radius: 0 }), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    koMesh.position.z = -0.35; koMesh.scale.set(0.35, 0.35, 1); koMesh.renderOrder = 1600; G.camera.add(koMesh);
  }
  const target = L.ko ? 1 : 0;
  koMesh.material.opacity += (target - koMesh.material.opacity) * Math.min(1, dt * 4);
  koMesh.visible = koMesh.material.opacity > 0.01;
}
