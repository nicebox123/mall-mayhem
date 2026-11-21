// Cartoon fire system, spray tools, sprinklers, hose tethers, and the BABY ASH moment.
// Host simulates; every peer renders flames/sprays from synced state.
import * as THREE from 'three';
import { G, newId } from './state.js';
import { FIRE } from './config.js';
import { Z } from './world.js';
import { A } from './assets.js';
import { Save } from './save.js';
import { sprayBurst, flameLick, smokePuff, rain, confetti } from './particles.js';
import { pick, rand } from './util.js';

G.fires = new Map();
G.spraying = new Set();
const flameGeo = new THREE.ConeGeometry(0.16, 0.5, 7);
const flameMats = [0xff3d00, 0xff9100, 0xffd600].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));

// ================= shared visuals =================
export function addFireVisual(f) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(flameGeo, flameMats[i]);
    m.position.set((i - 1) * 0.08, 0.25 - i * 0.04, (i % 2) * 0.05); m.scale.setScalar(1 - i * 0.25);
    g.add(m);
  }
  G.scene.add(g); f.mesh = g; f.flick = Math.random() * 10;
  G.fires.set(f.id, f);
}
export function removeFireVisual(id) {
  const f = G.fires.get(id); if (!f) return;
  G.scene.remove(f.mesh); G.fires.delete(id);
  smokePuff(f.mesh.position, 10, 0x9e9e9e);
}
export function clearFires() { for (const id of [...G.fires.keys()]) removeFireVisual(id); G.spraying.clear(); }

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
export function nozzleOf(o, outPos, outDir) {
  const n = o.def.spray.nozzle;
  outPos.set(n[0], n[1], n[2]); o.mesh.localToWorld(outPos);
  o.mesh.getWorldQuaternion(_q); outDir.set(0, 0, -1).applyQuaternion(_q);
}

let smokeT = 0, rainT = 0;
const hoseLines = new Map();
export function updateFireVisuals(dt, t) {
  smokeT -= dt;
  for (const f of G.fires.values()) {
    const o = f.o && G.objects.get(f.o);
    if (o) { f.x = o.mesh.position.x; f.y = o.mesh.position.y; f.z = o.mesh.position.z; }
    const s = Math.max(0.15, f.s);
    f.mesh.position.set(f.x, f.y, f.z);
    f.flick += dt * 14;
    f.mesh.children.forEach((m, i) => { m.scale.set(s * (1 - i * 0.2), s * (1 + Math.sin(f.flick + i * 2) * 0.25), s * (1 - i * 0.2)); m.rotation.y += dt * (2 + i); });
    if (Math.random() < 0.5) flameLick(f.mesh.position, s);
    if (smokeT < 0) smokePuff({ x: f.x, y: f.y + 0.6 * s, z: f.z }, 1, 0x424242);
  }
  if (smokeT < 0) smokeT = 0.25;
  // sprays from tools (visual + local sound)
  for (const id of G.spraying) {
    const o = G.objects.get(id); if (!o || !o.def.spray) continue;
    nozzleOf(o, _p, _d);
    sprayBurst(o.def.spray.kind, _p, _d, o.def.spray.kind === 'water' && o.type === 'hose' ? 8 : 5);
    G.sound.play(o.def.spray.sound || 'spray', _p, 0.8);
  }
  // sprinklers: rain around the local player
  if (G.events.sprinkler) {
    rainT -= dt; if (rainT < 0) { rainT = 0.05; G.camera.getWorldPosition(_p); rain(_p, 7, 14); }
  }
  // hose tether lines
  for (const o of G.objects.values()) {
    if (o.type !== 'hose') continue;
    const st = Z.hoseStations[o.opts.station ?? 0];
    let line = hoseLines.get(o.id);
    if (!line) {
      line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xc62828 }));
      line.frustumCulled = false; G.scene.add(line); hoseLines.set(o.id, line);
    }
    const a = line.geometry.attributes.position;
    a.setXYZ(0, st[0], st[1] - 0.2, st[2]);
    a.setXYZ(1, (st[0] + o.mesh.position.x) / 2, Math.min(st[1], o.mesh.position.y) - 0.6, (st[2] + o.mesh.position.z) / 2);
    a.setXYZ(2, o.mesh.position.x, o.mesh.position.y, o.mesh.position.z);
    a.needsUpdate = true;
  }
  for (const [id, line] of hoseLines) if (!G.objects.has(id)) { G.scene.remove(line); hoseLines.delete(id); }
  updateBabyAsh(dt);
}

// ================= BABY ASH =================
let ba = null; // { t, mesh, back, played }
function ensureBabyMeshes() {
  if (ba) return ba;
  const img = A.images.babyAsh;
  const aspect = img && img.image ? img.image.width / img.image.height : 1.04;
  const h = 1.05, w = h * aspect;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: img || null, color: img ? 0xffffff : 0x333333, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  mesh.renderOrder = 2001; back.renderOrder = 2000;
  mesh.position.z = -1.0; back.position.z = -1.05;
  mesh.visible = back.visible = false;
  G.camera.add(back); G.camera.add(mesh);
  ba = { t: -1, mesh, back, played: false };
  return ba;
}
// Timeline (seconds): 0 snap-fade in -> 0.18 fully visible + SOUND (3.85s clip) -> hold -> 3.5 fade out -> 4.1 done
const FADE_IN = 0.18, HOLD_END = 3.5, FADE_OUT = 0.6;
export function showBabyAsh() {
  const b = ensureBabyMeshes();
  b.t = 0; b.played = false; b.mesh.visible = b.back.visible = true;
  Save.stat('babyash');
}
function updateBabyAsh(dt) {
  if (!ba || ba.t < 0) return;
  ba.t += dt;
  const t = ba.t;
  let a;
  if (t < FADE_IN) a = t / FADE_IN;
  else if (t < HOLD_END) a = 1;
  else a = Math.max(0, 1 - (t - HOLD_END) / FADE_OUT);
  if (t >= FADE_IN && !ba.played) { ba.played = true; G.sound.play('babyAsh'); }
  ba.mesh.material.opacity = a; ba.back.material.opacity = a * 0.75;
  // comedic punch-in + tremble while screaming
  const punch = t < FADE_IN ? 0.75 + 0.25 * (t / FADE_IN) : 1 + Math.min(0.08, (t - FADE_IN) * 0.03);
  ba.mesh.scale.setScalar(punch);
  ba.mesh.position.x = t < HOLD_END ? Math.sin(t * 60) * 0.006 : 0;
  ba.mesh.position.y = t < HOLD_END ? Math.cos(t * 53) * 0.006 : 0;
  if (t > HOLD_END + FADE_OUT) { ba.t = -1; ba.mesh.visible = ba.back.visible = false; }
}

// ================= HOST =================
const H = { babyReadyAt: 0, sendT: 0, spreadT: 0, fireEventStart: 0, autoSprinkled: false, puddleT: 0 };
export function resetFireHost() { H.babyReadyAt = 0; H.spreadT = 0; H.autoSprinkled = false; }

function broadcastFire(f) { G.net.broadcast({ t: 'fire', f: { id: f.id, o: f.o, x: f.x, y: f.y, z: f.z, s: f.s } }); }

export function igniteObject(o, byPid = null) {
  if (!o || o.def.noBurn || o.type === 'door' || o.flags.burning || G.fires.size >= FIRE.maxFires) return null;
  const p = o.mesh.position;
  const f = { id: newId('f'), o: o.id, x: p.x, y: p.y, z: p.z, s: 0.45, age: 0 };
  o.flags.burning = f.id; o.burn = 0;
  addFireVisual(f); broadcastFire(f);
  G.sound.playAll('fireIgnite', p);
  G.game.incident(p.x, p.z, 'fire');
  return f;
}
export function igniteSpot(x, z) {
  if (G.fires.size >= FIRE.maxFires) return null;
  const f = { id: newId('f'), o: null, x, y: 0.05, z, s: 0.6, age: 0 };
  addFireVisual(f); broadcastFire(f);
  G.sound.playAll('fireIgnite', { x, y: 0.5, z });
  return f;
}
function extinguish(f, pid) {
  const o = f.o && G.objects.get(f.o);
  if (o) { o.flags.burning = null; o.burn = 0; }
  removeFireVisual(f.id); G.net.broadcast({ t: 'fireDel', id: f.id });
  G.sound.playAll('fireOut', { x: f.x, y: f.y, z: f.z });
  if (pid) G.game.award(pid, 8, 'Fire out!', null, 'extinguished');
  G.game.npcCheer(f.x, f.z);
}
function crumble(f) {
  const o = G.objects.get(f.o); if (!o) return;
  const p = o.mesh.position.clone();
  removeFireVisual(f.id); G.net.broadcast({ t: 'fireDel', id: f.id });
  G.game.despawn(o.id);
  G.game.addAsh(p.x, p.z);
  G.sound.playAll('ashPoof', p);
  G.net.broadcast({ t: 'puff', p: [p.x, p.y, p.z] }); smokePuff(p, 18, 0x616161);
  // The signature moment: a beat of silence, then BABY.
  if (G.time >= H.babyReadyAt) {
    H.babyReadyAt = G.time + FIRE.babyCooldown;
    setTimeout(() => { if (!G.isHost) return; G.net.broadcast({ t: 'babyash' }); showBabyAsh(); }, rand(600, 1300));
  }
}

const _np = new THREE.Vector3(), _nd = new THREE.Vector3(), _tv = new THREE.Vector3();
export function updateFireHost(dt) {
  H.sendT -= dt; H.spreadT -= dt; H.puddleT -= dt;
  const send = H.sendT < 0; if (send) H.sendT = 0.5;
  const spread = H.spreadT < 0; if (spread) H.spreadT = FIRE.spreadEvery;
  for (const f of [...G.fires.values()]) {
    f.age += dt;
    const o = f.o && G.objects.get(f.o);
    if (f.o && !o) { removeFireVisual(f.id); G.net.broadcast({ t: 'fireDel', id: f.id }); continue; }
    if (o) { f.x = o.mesh.position.x; f.y = o.mesh.position.y; f.z = o.mesh.position.z; o.burn = (o.burn || 0) + dt; }
    f.s = Math.min(1.5, f.s + dt * 0.05);
    if (G.events.sprinkler) f.s -= dt * 0.45;
    if (f.s <= 0.1) { extinguish(f, null); continue; }
    if (o && o.burn > FIRE.ashTime) { crumble(f); continue; }
    if (send) G.net.broadcast({ t: 'fireUp', id: f.id, s: +f.s.toFixed(2), x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2) });
    if (spread && Math.random() < 0.5) {
      let best = null, bd = FIRE.spreadRadius;
      for (const c of G.objects.values()) {
        if (c.flags.burning || c.def.noBurn || c.type === 'door') continue;
        const d = c.mesh.position.distanceTo(_tv.set(f.x, f.y, f.z)); if (d < bd) { bd = d; best = c; }
      }
      if (best) igniteObject(best);
    }
    if (Math.random() < dt * 0.5) G.game.scareNearby(f.x, f.z, 3, pick(['FIRE!!', 'IT\'S HOT! IT\'S HOT!', 'Somebody call 911!', 'Save the pretzels!']));
  }
  // fire alarm state follows fires
  const anyFire = G.fires.size > 0;
  if (anyFire && !G.events.fire) { G.game.startEvent('fire', 999, true); H.fireEventStart = G.time; H.autoSprinkled = false; }
  if (!anyFire && G.events.fire && !(G.game.H.alarmOnly > G.time)) G.game.endEvent('fire');
  if (anyFire && !H.autoSprinkled && G.time - H.fireEventStart > FIRE.autoSprinklerAfter) { H.autoSprinkled = true; G.game.startEvent('sprinkler', 12); }

  // sprays
  for (const id of [...G.spraying]) {
    const o = G.objects.get(id);
    if (!o || !o.holder || !o.def.spray) { setSpraying(id, false); continue; }
    const sp = o.def.spray, pid = o.holder.pid;
    nozzleOf(o, _np, _nd);
    if (sp.kind === 'foam' || sp.kind === 'water') {
      for (const f of [...G.fires.values()]) {
        _tv.set(f.x, f.y + 0.2, f.z).sub(_np); const d = _tv.length();
        if (d < sp.range && _tv.normalize().dot(_nd) > 0.88) { f.s -= sp.rate * dt * 1.6; if (f.s <= 0.1) extinguish(f, pid); }
      }
      if (sp.puddles && H.puddleT < 0) { // where the water lands, make a puddle (job security for janitors)
        H.puddleT = 1.2;
        const tHit = _nd.y < -0.05 ? Math.min(sp.range, _np.y / -_nd.y) : sp.range * 0.8;
        G.game.addPuddle(_np.x + _nd.x * tHit, _np.z + _nd.z * tHit);
      }
      G.game.weirdEmployee(_np.x, _np.z);
    }
    if (sp.kind === 'flame') {
      for (const c of G.objects.values()) {
        if (c.flags.burning || c.def.noBurn || c.holder) continue;
        _tv.copy(c.mesh.position).sub(_np); const d = _tv.length();
        if (d < sp.range && _tv.normalize().dot(_nd) > 0.85 && Math.random() < dt * 3) igniteObject(c, pid);
      }
      G.game.torchNpcs(_np, _nd, sp.range);
    }
    if (sp.kind === 'air') {
      for (const c of G.objects.values()) {
        if (!c.body || c.holder) continue;
        _tv.copy(c.mesh.position).sub(_np); const d = _tv.length();
        if (d < sp.range && d > 0.05 && _tv.normalize().dot(_nd) > 0.8) {
          const k = (1 - d / sp.range) * 14 * dt * Math.min(c.def.mass, 4);
          c.body.wakeUp(); c.body.applyImpulse({ x: _nd.x * k, y: (_nd.y + 0.25) * k, z: _nd.z * k }, c.body.position);
          c.lastHolder = pid;
        }
      }
      G.game.blowNpcs(_np, _nd, sp.range, pid);
    }
  }
  // hoses stay tethered to their cabinets
  for (const o of G.objects.values()) {
    if (o.type !== 'hose' || !o.body) continue;
    const st = Z.hoseStations[o.opts.station ?? 0];
    if (Math.hypot(o.body.position.x - st[0], o.body.position.z - st[2]) > 7.5) {
      if (o.holder) G.game.forceRelease(o);
      o.body.position.set(st[0] + Math.sin(st[3]) * 0.15, st[1] - 0.12, st[2] + Math.cos(st[3]) * 0.15); o.body.velocity.set(0, 0, 0); o.body.angularVelocity.set(0, 0, 0);
      o.body.quaternion.setFromEuler(0, st[3], 0);
      G.sound.playAll('npcStumble', o.body.position);
    }
  }
}

export function setSpraying(id, on) {
  if (on) G.spraying.add(id); else G.spraying.delete(id);
  if (G.isHost) G.net.broadcast({ t: 'spray', id, on });
}

export function hostFireSnapshot() {
  return [...G.fires.values()].map((f) => ({ id: f.id, o: f.o, x: f.x, y: f.y, z: f.z, s: f.s }));
}
export { confetti };
