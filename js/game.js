// Game rules. Host-authoritative: jobs, events, triggers, awards. Shared: marker visuals + event visuals.
import * as THREE from 'three';
import { G, newId } from './state.js';
import { JOBS, ANNOUNCEMENTS, ITEMS, GEAR, PERSONALITIES } from './config.js';
import { Save } from './save.js';
import { Z, makeButton, setButtonLit, setPower, setShutters, setEscalator, setGate, shelfBounds, elevator, setElevator, setSecretDoor, conveyors, L2Y } from './world.js';
import { spawnRagdoll, endRagdoll, updateRagdollsHost } from './ragdoll.js';
import { hostFire, updateProjectiles } from './combat.js';
import { spawnObject, despawnObject, setObjColor } from './objects.js';
import { npcGoTo, npcSay, knockNpc, stumbleNpc, scareNearby, spawnNpc, removeNpc, addIncident, noteBonk, npcHit } from './npc.js';
import { igniteObject, igniteSpot, updateFireHost, setSpraying, resetFireHost, hostFireSnapshot } from './fire.js';
import { confetti } from './particles.js';
import { pointBlocked } from './physics.js';
import { sfx, speak } from './audio.js';
import { Panel, PAL } from './ui.js';
import { pick, rand, randi, mat, toast } from './util.js';

const _v = new THREE.Vector3();
export const Game = {};
G.game = Game;

// ================= shared visuals =================
const markerVis = new Map();
const spillMat = new THREE.MeshBasicMaterial({ color: 0x8d6e1f, transparent: true, opacity: 0.85 });
const puddleMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.55 });
const ashMat = new THREE.MeshBasicMaterial({ color: 0x424242, transparent: true, opacity: 0.9 });
const slotMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.35, depthWrite: false });
const cpMat = new THREE.MeshBasicMaterial({ color: 0x3fa7ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
export function addMarkerVisual(m) {
  let mesh;
  if (m.kind === 'spill') { mesh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), m.v === 'ash' ? ashMat : m.v === 'water' ? puddleMat : spillMat); mesh.rotation.x = -Math.PI / 2; mesh.position.set(m.x, 0.015, m.z); mesh.scale.setScalar(m.s || 1); }
  if (m.kind === 'slot') { mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.26), slotMat); mesh.position.set(m.x, m.y + 0.12, m.z); }
  if (m.kind === 'cp') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 3, 16, 1, true), cpMat); mesh.position.set(m.x, 1.5, m.z); }
  if (!mesh) return;
  mesh.userData.marker = m;
  G.scene.add(mesh); markerVis.set(m.id, mesh); G.markers.set(m.id, m);
}
export function removeMarkerVisual(id) { const v = markerVis.get(id); if (v) G.scene.remove(v); markerVis.delete(id); G.markers.delete(id); }
export function updateMarkerVisual(id, s) { const m = G.markers.get(id), v = markerVis.get(id); if (m) m.s = s; if (v) v.scale.setScalar(s); }
export function clearMarkers() { for (const id of [...markerVis.keys()]) removeMarkerVisual(id); }
export function animateMarkers(t) {
  for (const v of markerVis.values()) {
    const m = v.userData.marker;
    if (m.kind === 'slot') v.material.opacity = 0.25 + Math.sin(t * 4) * 0.12;
    if (m.kind === 'cp') { v.rotation.y = t; v.visible = m.owner === G.myId; }
  }
}
function addMarker(m) { m.id = m.id || newId('m'); addMarkerVisual(m); G.net.broadcast({ t: 'mk', m }); return m; }
function removeMarker(id) { removeMarkerVisual(id); G.net.broadcast({ t: 'mkDel', id }); }

// Event visuals on every peer
export function applyEvent(name, on, quiet = false) {
  if (on) G.events[name] = true; else delete G.events[name];
  const B = G.menus && G.menus.banner;
  switch (name) {
    case 'outage': setPower(!on); if (on) { sfx('powerdown'); B && B('POWER OUTAGE! (flashlight on)', '#ffd23f'); } break;
    case 'fire': G.sound.loop('fireAlarm', on); G.alarmOn = on; if (on) { B && B('FIRE ALARM! Grab an extinguisher or a hose!', '#ff5252'); speak('Attention shoppers. There is a fire. Please panic in an orderly fashion.'); } break;
    case 'sprinkler': if (on) { G.sound.play('sprinklers'); B && B('SPRINKLERS ACTIVATED!', '#4fc3f7'); } break;
    case 'investigation': if (on) B && B('Security investigation in progress!', '#3fa7ff'); break;
    case 'confusion': if (on) B && B('...Everyone is confused.', '#ffd23f'); break;
    case 'conga': if (on) B && B('CONGA LINE!', '#ff4f9a'); break;
    case 'melonrain': if (on) B && B('Melon delivery! Look up!', '#3ddc84'); break;
    case 'sale': if (on) { sfx('chime'); B && B('MEGA SALE! Jobs pay DOUBLE!', '#3ddc84'); speak('Attention shoppers! Mega sale! Everything must go!'); } break;
    case 'stampede': if (on) { sfx('alarm'); B && B('NPC STAMPEDE!', '#ff4f9a'); } break;
    case 'lockdown': setShutters(on); if (on) { sfx('alarm'); B && B('SECURITY LOCKDOWN! Stores sealed!', '#3fa7ff'); } break;
    case 'escalator': setEscalator(on); if (on) B && B('The escalator broke. Again.', '#ffd23f'); break;
  }
  if (on && !quiet) Save.stat('events');
}
export function announce(text) {
  G.sound.play('announcement');
  G.menus && G.menus.banner(text, '#ffffff', 6);
  setTimeout(() => speak(text), 1500);
}

// ---------- order board (food court) ----------
let orderPanel = null;
export function setOrderBoard(items, remaining) {
  if (!orderPanel) return;
  orderPanel.setScreen((p) => {
    p.title('ORDER UP!', 70, PAL.yellow, 64);
    if (!items || !items.length) { p.text('No orders. Take the Food Worker job!', 500, 200, { size: 36, align: 'center', maxW: 900 }); return; }
    items.forEach((it, i) => {
      const done = remaining && !remaining.includes(i);
      const label = { burger: 'Burger (cooked patty)', fries: 'Fries', soda: 'Soda' }[it];
      p.text((done ? '✔ ' : '• ') + label, 120, 160 + i * 64, { size: 46, color: done ? PAL.green : PAL.white, bold: true });
    });
  });
}

// ================= setup (all peers build the same buttons) =================
export function initGame(scene) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
  makeButton(scene, 'disp_patty', V(12.5, 1.45, -39.83), V(0, 0, 1), 0xf48fb1, 'PATTY');
  makeButton(scene, 'disp_fries', V(13.5, 1.45, -39.83), V(0, 0, 1), 0xffd54f, 'FRIES');
  makeButton(scene, 'disp_soda', V(14.5, 1.45, -39.83), V(0, 0, 1), 0x1e88e5, 'SODA');
  makeButton(scene, 'secret', V(Z.office[0] - 2.5, Z.office[1] + 0.82, Z.office[2] + 1), UP, 0x424242, null);
  makeButton(scene, 'chaos', V(55.6, 1.02, -38.75), UP, 0xff1744, 'CHAOS');
  makeButton(scene, 'whack_start', V(Z.whack.x, 0.92, Z.whack.z + 0.5), UP, 0x3ddc84, 'START');
  for (let i = 0; i < 6; i++) makeButton(scene, 'whack_' + i, V(Z.whack.x - 0.7 + (i % 3) * 0.7, 0.92, Z.whack.z - 0.35 + Math.floor(i / 3) * 0.42), UP, 0x7c4dff, null);
  // Update 3 buttons
  makeButton(scene, 'elev', V(-3.85, 1.0, -3.85), UP, 0xffd23f, 'LIFT');            // reachable from the platform + atrium floor
  makeButton(scene, 'elev2', V(-6.5, 6.05, -6.5), UP, 0xffd23f, 'LIFT');            // L2 corner
  makeButton(scene, 'secret_book', V(Z.secretBook[0], Z.secretBook[1], Z.secretBook[2]), V(0, 0, -1), 0xc62828, null);
  Z.stalls.forEach((s, i) => makeButton(scene, 'flush_' + i, V(s.x, 1.05, -21.72), V(0, 0, 1), 0xe0e0e0, null));
  makeButton(scene, 'dryer_0', V(51, 1.3, -8.17), V(0, 0, -1), 0x90a4ae, 'DRY'); makeButton(scene, 'dryer_1', V(55, 1.3, -8.17), V(0, 0, -1), 0x90a4ae, 'DRY');
  makeButton(scene, 'popcorn', V(36, 1.85, 37.95), V(0, 0, -1), 0xd32f2f, 'POP');
  makeButton(scene, 'coffee', V(Z.coffee[0] + 1.6, Z.coffee[1] + 0.02, Z.coffee[2]), UP, 0x6d4c41, 'COFFEE');
  ['pizza', 'taco', 'noodles'].forEach((f, i) => { const r = Z.restaurants[i + 1]; makeButton(scene, 'food_' + f, V(r.x + 1.8, 1.06, r.z), UP, 0xffd23f, f.toUpperCase()); });
  orderPanel = new Panel(2.2, 1.0, { ppm: 300 });
  orderPanel.mesh.position.set(12.5, 2.4, -33.4);
  scene.add(orderPanel.mesh);
  setOrderBoard(null);
  // fire alarm pull stations (pressing one triggers alarm + sprinklers)
  Z.alarms.forEach(([x, y, z, ry], i) => makeButton(scene, 'alarm_' + i, new THREE.Vector3(x + Math.sin(ry) * 0.01, y - 0.04, z + Math.cos(ry) * 0.01), new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)), 0xffffff, null));
  G.onImpact = onImpact;
}

// ================= HOST =================
const H = {
  nextEvent: 0, regs: [],
  food: { order: null, cd: 3, items: [], remaining: [], npc: null, timer: 0, foodObjs: [] },
  cook: new Map(), whack: null, thiefCD: 40, spillCD: 30, chaosCD: 0, mkSendT: 0, eventEnds: {},
  lastEvent: {}, gear: new Map(), gearCD: {}, displayDown: false, displayT: 0, megaCD: {}, weirdCD: 0, cheerCD: 0,
};
Game.H = H;

export function resetHost() {
  H.regs = Z.registers.map((r) => ({ ...r, cashier: null, npc: null, items: [], cd: 2, timer: 0 }));
  Object.assign(H.food, { order: null, cd: 3, items: [], remaining: [], npc: null });
  H.cook.clear(); H.whack = null; H.nextEvent = G.time + rand(50, 90); H.eventEnds = {}; H.lastEvent = {};
  H.gear.clear(); H.displayDown = false;
  resetFireHost();
}

// ---------- API used by fire.js / npc.js ----------
Game.award = (...a) => award(...a);
Game.despawn = (id) => despawnObject(id);
Game.spawn = (type, pos, opts) => spawnObject(type, pos, null, opts);
Game.scareNearby = scareNearby;
Game.incident = (x, z, kind) => addIncident(x, z, kind);
Game.addAsh = (x, z) => addMarker({ kind: 'spill', v: 'ash', x, z, s: 0.8 });
Game.addPuddle = (x, z) => {
  if (Math.abs(x) > 23 || Math.abs(z) > 17) return;
  const n = [...G.markers.values()].filter((m) => m.kind === 'spill' && m.v === 'water');
  if (n.length >= 8) removeMarker(n[0].id);
  addMarker({ kind: 'spill', v: 'water', x, z, s: rand(0.6, 0.9) });
};
Game.npcCheer = (x, z) => {
  if (H.cheerCD > G.time) return; H.cheerCD = G.time + 6;
  for (const n of G.npcs.values()) if (n.state !== 'fallen' && Math.hypot(n.x - x, n.z - z) < 6 && Math.random() < 0.5) { npcSay(n, pick(['My hero!', 'Bravo!', 'Finally, competence!', 'Was that... part of the show?'])); }
};
// confused shoppers comment on employees doing ridiculous things
Game.weirdEmployee = (x, z) => {
  if (H.weirdCD > G.time) return;
  for (const n of G.npcs.values()) {
    if (n.state === 'fallen' || n.busy || Math.hypot(n.x - x, n.z - z) > 6) continue;
    if (n.P.employee || Math.random() < 0.15) { H.weirdCD = G.time + 10; n.state = 'confused'; n.timer = 2.5; n.rotTarget = Math.atan2(-(x - n.x), -(z - n.z)); npcSay(n, pick(n.P.employee || ['Is that... part of your job?', 'Why is it WET?!', 'Should you be doing that?'])); return; }
  }
};
const _tv = new THREE.Vector3();
Game.torchNpcs = (pos, dir, range) => {
  for (const n of G.npcs.values()) {
    if (n.state === 'fallen' || n.state === 'flee') continue;
    _tv.set(n.x - pos.x, 1.2 - pos.y, n.z - pos.z); const d = _tv.length();
    if (d < range + 0.4 && _tv.normalize().dot(dir) > 0.75) {
      const a = Math.atan2(n.x - pos.x, n.z - pos.z);
      npcGoTo(n, n.x + Math.sin(a) * 8, n.z + Math.cos(a) * 8, (k) => { k.state = 'idle'; k.timer = 1; }, true);
      npcSay(n, pick(['MY EYEBROWS!', 'HOT HOT HOT!', 'WHY DO YOU HAVE A BLOWTORCH?!', 'Is this a fire drill?!']));
      G.sound.playAll('npcGasp', { x: n.x, y: 1.5, z: n.z });
    }
  }
};
Game.blowNpcs = (pos, dir, range, pid) => {
  for (const n of G.npcs.values()) {
    if (n.state === 'fallen') continue;
    _tv.set(n.x - pos.x, 1.0 - pos.y, n.z - pos.z); const d = _tv.length();
    if (d < range && _tv.normalize().dot(dir) > 0.8 && Math.random() < 0.08) {
      if (d < 1.6 && knockNpc(n, pos.x, pos.z, pid, 'npcStumble')) { npcSay(n, pick(['MY TOUPEE!', 'WHOOOOAAA!', 'I\'M FLYIIING!'])); }
      else stumbleNpc(n, pick(['So windy!', 'My hair!', 'Is there a hurricane?!']));
    }
  }
};
Game.forceRelease = (o) => {
  const h = o.holder; if (!h) return;
  const p = G.players.get(h.pid); if (p) p.hands[h.h].held = null;
  o.holder = null; setSpraying(o.id, false);
  if (h.pid === G.myId) G.forceDropLocal && G.forceDropLocal(o.id); else G.net.sendTo(h.pid, { t: 'drop', id: o.id });
};
Game.startEvent = (name, dur, quiet) => startEvent(name, dur, quiet);
Game.endEvent = (name) => endEvent(name);

function award(pid, amt, reason, job = null, stat = null, n = 1) {
  if (G.events.sale && job) amt *= 2;
  amt = Math.round(amt);
  if (pid === G.myId) applyAward({ amt, reason, job, stat, n });
  else G.net.sendTo(pid, { t: 'award', amt, reason, job, stat, n });
}
export function applyAward({ amt, reason, job, stat, n }) {
  if (job) { amt = Math.round(amt * Save.payMult(job)); Save.stat('jobsDone', 1, true); }
  if (amt) { Save.addMoney(amt, reason); sfx('cash'); }
  if (stat) Save.stat(stat, n);
}
function jobText(pid, text) {
  const p = G.players.get(pid); if (!p) return;
  p.jobText = text;
  if (pid === G.myId) { G.jobInfo = { job: p.job, text }; G.menus && G.menus.refreshWrist(); }
  else G.net.sendTo(pid, { t: 'job', job: p.job, text });
}
function fxAll(s, pos, k = 1) { sfx(s, pos, k); G.net.broadcast({ t: 'fx', s, p: [pos.x, pos.y, pos.z], k }); }
function sayAll(text) { G.net.broadcast({ t: 'ann', x: text }); announce(text); }

// ---------- jobs ----------
Game.takeJob = (pid, job) => {
  const p = G.players.get(pid); if (!p) return;
  quitJob(p);
  if (!job || !JOBS[job]) { jobText(pid, 'No job. Pure chaos mode.'); return; }
  p.job = job; p.jobData = {};
  if (job === 'cashier') {
    const reg = H.regs.find((r) => !r.cashier);
    if (!reg) { p.job = null; jobText(pid, 'All registers are taken!'); return; }
    reg.cashier = pid; reg.cd = 2; p.jobData.reg = reg.id;
    jobText(pid, `Go to Register ${reg.id === 'reg0' ? 1 : 2} in Mega Mart. Wave items over the red scanner.`);
  }
  if (job === 'stocker') newStockBatch(p);
  if (job === 'janitor') { ensureSpills(3); jobText(pid, 'Grab a mop from Storage. Scrub the brown spills!'); }
  if (job === 'food') jobText(pid, 'Chow Town kitchen: press dispenser buttons, cook patties on the grill, put food on SERVE.');
  if (job === 'security') newPatrol(p);
};
function quitJob(p) {
  if (!p.job) return;
  if (p.job === 'cashier') { const r = H.regs.find((x) => x.cashier === p.id); if (r) { r.cashier = null; endCustomer(r, false); } }
  if (p.job === 'stocker') for (const id of p.jobData.slots || []) if (G.markers.has(id)) removeMarker(id);
  if (p.job === 'security' && p.jobData.mk && G.markers.has(p.jobData.mk)) removeMarker(p.jobData.mk);
  p.job = null; p.jobData = {};
}
Game.playerLeft = (pid) => { const p = G.players.get(pid); if (p) quitJob(p); };

// Cashier
function endCustomer(r, happy) {
  if (r.npc) {
    const n = r.npc; n.busy = false; n.task = null; n.state = 'idle'; n.timer = 0.5;
    npcSay(n, happy ? (n.pers === 'karen' ? 'I expected a discount.' : pick(['Thanks!', 'Have a mall-tastic day!', 'Beep boop, bye!'])) : pick(['Forget it!', 'Worst. Service. Ever.', 'I\'m going to Amazon.']));
  }
  for (const id of r.items) if (G.objects.has(id)) despawnObject(id);
  r.npc = null; r.items = []; r.cd = rand(3, 6);
}
function updateRegisters(dt) {
  for (const r of H.regs) {
    if (!r.cashier) { if (r.npc) endCustomer(r, false); continue; }
    if (!r.npc) {
      r.cd -= dt; if (r.cd > 0) continue;
      const cands = [...G.npcs.values()].filter((n) => !n.busy && !n.thief && n.state !== 'fallen');
      if (!cands.length) continue;
      const n = pick(cands); n.busy = true; r.npc = n; r.timer = 75; r.arrived = false;
      npcGoTo(n, r.customer.x, r.customer.z, (k) => {
        k.state = 'wait'; k.rotTarget = Math.PI / 2; r.arrived = true;
        const cnt = randi(2, 4);
        for (let i = 0; i < cnt; i++) {
          const o = spawnObject(pick(['cereal', 'milk', 'soda', 'chips', 'tp', 'banana']), [r.itemSpawn.x + rand(-0.15, 0.15), r.itemSpawn.y + i * 0.12, r.itemSpawn.z + rand(-0.15, 0.1)], null);
          o.flags.sale = r.id; r.items.push(o.id);
        }
        npcSay(k, pick(['Just these, please.', 'Can I pay in exposure?', 'Paper or plastic? Neither.', 'Make it snappy!']));
      });
      continue;
    }
    r.timer -= dt;
    if (r.timer < 0) { endCustomer(r, false); continue; }
    if (!r.arrived) continue;
    for (const id of [...r.items]) {
      const o = G.objects.get(id); if (!o) { r.items.splice(r.items.indexOf(id), 1); continue; }
      const p = o.mesh.position;
      if (Math.abs(p.x - r.scan.x) < 0.3 && Math.abs(p.z - r.scan.z) < 0.22 && p.y < 1.4 && p.y > 0.9) {
        fxAll('beep', p);
        r.items.splice(r.items.indexOf(id), 1); despawnObject(id);
        award(r.cashier, 3, 'Scanned!', 'cashier', 'scanned');
      } else if (Math.hypot(p.x - r.x, p.z - r.z) > 3) {
        r.items.splice(r.items.indexOf(id), 1); o.flags.sale = null;
        npcSay(r.npc, 'HEY! That was MINE!');
      }
    }
    if (!r.items.length) { award(r.cashier, JOBS.cashier.pay, 'Customer served!', 'cashier'); fxAll('cash', r.scan); endCustomer(r, true); }
  }
}

// Stocker
function newStockBatch(p) {
  const free = Z.slots.filter((s) => ![...G.markers.values()].some((m) => m.slot === s.id) && !slotOccupied(s));
  const chosen = []; while (chosen.length < 3 && free.length) chosen.push(free.splice(randi(0, free.length - 1), 1)[0]);
  p.jobData.slots = chosen.map((s) => addMarker({ kind: 'slot', x: s.x, y: s.y, z: s.z, owner: p.id, slot: s.id }).id);
  for (let i = 0; i < chosen.length; i++) spawnObject('stock', [Z.stockSpawn.x - 0.6 + i * 0.6, Z.stockSpawn.y + 0.2, Z.stockSpawn.z], null);
  jobText(p.id, `Take STOCK boxes from Storage to the ${chosen.length} glowing green shelf slots in Mega Mart.`);
}
function slotOccupied(s) {
  for (const o of G.objects.values()) { const q = o.mesh.position; if (Math.abs(q.x - s.x) < 0.14 && Math.abs(q.z - s.z) < 0.2 && q.y > s.y && q.y < s.y + 0.35) return o; }
  return null;
}
function updateStock() {
  for (const p of G.players.values()) {
    if (p.job !== 'stocker' || !p.jobData.slots) continue;
    for (const id of [...p.jobData.slots]) {
      const m = G.markers.get(id); if (!m) continue;
      const o = slotOccupied(m);
      if (o && !o.holder && o.type !== 'door' && o.def.size[1] < 0.4) {
        removeMarker(id); p.jobData.slots.splice(p.jobData.slots.indexOf(id), 1);
        fxAll('pop', o.mesh.position);
        award(p.id, JOBS.stocker.pay, 'Shelf stocked!', 'stocker', 'stocked');
      }
    }
    if (!p.jobData.slots.length) newStockBatch(p);
  }
}

// Janitor / spills
function randomFloorPoint() {
  for (let i = 0; i < 40; i++) {
    const p = pick(Z.pois);
    const x = p[0] + rand(-2, 2), z = p[1] + rand(-2, 2);
    if (!pointBlocked(x, z, 0.6) && Math.abs(x) < 59 && Math.abs(z) < 39) return [x, z];
  }
  return [0, 10];
}
function ensureSpills(n) {
  let c = 0; for (const m of G.markers.values()) if (m.kind === 'spill') c++;
  for (; c < n; c++) { const [x, z] = randomFloorPoint(); addMarker({ kind: 'spill', x, z, s: rand(0.9, 1.4) }); }
}
const _mh = new THREE.Vector3();
function updateSpills(dt) {
  const spills = [...G.markers.values()].filter((m) => m.kind === 'spill');
  if (!spills.length) return;
  H.mkSendT -= dt;
  for (const o of G.objects.values()) {
    if (o.type !== 'mop' || !o.body) continue;
    _mh.set(0, -0.69, 0); o.mesh.localToWorld(_mh);
    if (_mh.y > 0.3 || o.body.velocity.length() < 0.25) continue;
    for (const s of spills) {
      if (Math.hypot(_mh.x - s.x, _mh.z - s.z) < s.s * 0.5 + 0.15) {
        s.s -= dt * 0.4;
        if (Math.random() < dt * 3) fxAll('squeak', _mh, 0.6);
        if (s.s < 0.2) {
          removeMarker(s.id);
          const holder = o.holder && o.holder.pid;
          if (holder) {
            const p = G.players.get(holder);
            if (p && p.job === 'janitor') award(holder, JOBS.janitor.pay, 'Spill cleaned!', 'janitor', 'cleaned');
            else award(holder, 2, 'Good citizen!', null, 'cleaned');
          }
        } else if (H.mkSendT < 0) { updateMarkerVisual(s.id, s.s); G.net.broadcast({ t: 'mkUp', id: s.id, s: s.s }); }
        else updateMarkerVisual(s.id, s.s);
      }
    }
  }
  if (H.mkSendT < 0) H.mkSendT = 0.25;
  // NPCs slip on spills
  for (const n of G.npcs.values()) {
    if (n.state !== 'walk' || n.slipCD > G.time) continue;
    for (const s of spills) if (Math.hypot(n.x - s.x, n.z - s.z) < s.s * 0.45 && Math.random() < 0.4) {
      n.slipCD = G.time + 8; knockNpc(n, n.x - Math.sin(n.rot), n.z - Math.cos(n.rot)); npcSay(n, pick(['WHOA-', 'Who mopped this?! Oh. Nobody.', 'My dignity!']));
    }
  }
}

// Food
function updateFood(dt) {
  const f = H.food;
  const workers = [...G.players.values()].filter((p) => p.job === 'food');
  // grill cooking (always works, job or not)
  for (const o of G.objects.values()) {
    if (o.type !== 'patty' || o.flags.burnt) continue;
    const q = o.mesh.position, gz = Z.grill;
    if (Math.abs(q.x - gz.x) < gz.w / 2 && Math.abs(q.z - gz.z) < gz.d / 2 && q.y < gz.y + 0.12) {
      const t = (H.cook.get(o.id) || 0) + dt; H.cook.set(o.id, t);
      if (Math.random() < dt * 2) fxAll('sizzle', q, 0.6);
      if (t > 4 && !o.flags.cooked) { o.flags.cooked = true; setObjColor(o, 0x6d4c41); G.net.broadcast({ t: 'ocol', id: o.id, c: 0x6d4c41 }); fxAll('pop', q); }
      if (t > 14) { o.flags.burnt = true; setObjColor(o, 0x212121); G.net.broadcast({ t: 'ocol', id: o.id, c: 0x212121 }); }
    }
  }
  if (!workers.length) { if (f.order) endOrder(false); return; }
  if (!f.order) {
    f.cd -= dt; if (f.cd > 0) return;
    const cands = [...G.npcs.values()].filter((n) => !n.busy && !n.thief && n.state !== 'fallen');
    if (!cands.length) return;
    const items = []; const cnt = randi(1, 3);
    for (let i = 0; i < cnt; i++) items.push(pick(['burger', 'burger', 'fries', 'soda']));
    f.order = items; f.remaining = items.map((_, i) => i); f.timer = 100;
    const n = pick(cands); n.busy = true; f.npc = n;
    npcGoTo(n, Z.foodCustomer.x, Z.foodCustomer.z, (k) => { k.state = 'wait'; k.rotTarget = 0; npcSay(k, 'I\'ll have ' + items.join(', ') + '. Chop chop!'); });
    G.net.broadcast({ t: 'order', items, rem: f.remaining }); setOrderBoard(items, f.remaining);
    return;
  }
  f.timer -= dt;
  if (f.timer < 0) { endOrder(false); return; }
  const s = Z.serve;
  for (const o of G.objects.values()) {
    if (o.holder) continue;
    const q = o.mesh.position;
    if (Math.abs(q.x - s.x) > s.w / 2 || Math.abs(q.z - s.z) > s.d / 2 || q.y > 1.35 || q.y < 0.95) continue;
    let kind = null;
    if (o.type === 'patty') kind = o.flags.cooked && !o.flags.burnt ? 'burger' : 'bad';
    if (o.type === 'fries') kind = 'fries';
    if (o.type === 'cup') kind = 'soda';
    if (!kind) continue;
    const pid = o.lastHolder;
    despawnObject(o.id);
    if (kind === 'bad') { f.npc && npcSay(f.npc, o.flags.burnt ? 'This is CHARCOAL.' : 'Is this... RAW?!'); fxAll('error', q); continue; }
    const idx = f.remaining.find((i) => f.order[i] === kind);
    if (idx === undefined) { f.npc && npcSay(f.npc, 'I didn\'t order that!'); continue; }
    f.remaining.splice(f.remaining.indexOf(idx), 1); fxAll('pop', q);
    G.net.broadcast({ t: 'order', items: f.order, rem: f.remaining }); setOrderBoard(f.order, f.remaining);
    if (!f.remaining.length) {
      const who = (pid && G.players.get(pid)?.job === 'food') ? pid : workers[0].id;
      award(who, JOBS.food.pay + f.order.length * 4, 'Order served!', 'food', 'served');
      fxAll('cash', q); endOrder(true);
    }
  }
}
function endOrder(happy) {
  const f = H.food;
  if (f.npc) { const n = f.npc; n.busy = false; n.task = null; n.state = 'idle'; n.timer = 0.5; npcSay(n, happy ? pick(['Yum!', 'Delicious-ish!', '5 stars. Maybe 3.']) : pick(['Too slow!', 'I\'m eating at the fountain.'])); }
  f.order = null; f.npc = null; f.cd = rand(3, 6); f.remaining = [];
  G.net.broadcast({ t: 'order', items: null }); setOrderBoard(null);
}
function dispense(type, pos) {
  H.food.foodObjs = H.food.foodObjs.filter((id) => G.objects.has(id));
  if (H.food.foodObjs.length > 14) despawnObject(H.food.foodObjs.shift());
  const o = spawnObject(type, pos, null); H.food.foodObjs.push(o.id);
  fxAll('pop', { x: pos[0], y: pos[1], z: pos[2] });
}

// Security
function newPatrol(p) {
  const pts = [...Z.checkpoints].sort(() => Math.random() - 0.5).slice(0, 4);
  p.jobData.cps = pts; p.jobData.i = 0;
  setCheckpoint(p);
}
function setCheckpoint(p) {
  if (p.jobData.mk && G.markers.has(p.jobData.mk)) removeMarker(p.jobData.mk);
  const [x, z] = p.jobData.cps[p.jobData.i];
  p.jobData.mk = addMarker({ kind: 'cp', x, z, owner: p.id }).id;
  jobText(p.id, `Patrol: walk into the blue beam (${p.jobData.i + 1}/4). Tag shoplifters (black masks)!`);
}
function updateSecurity(dt) {
  const guards = [...G.players.values()].filter((p) => p.job === 'security');
  for (const p of guards) {
    const [x, z] = p.jobData.cps[p.jobData.i];
    if (Math.hypot(p.head.p.x - x, p.head.p.z - z) < 1.0) {
      p.jobData.i++;
      if (p.jobData.i >= 4) { award(p.id, JOBS.security.pay, 'Patrol complete!', 'security', 'patrols'); newPatrol(p); }
      else { award(p.id, 3, 'Checkpoint', 'security'); setCheckpoint(p); }
    }
  }
  if (guards.length) {
    H.thiefCD -= dt;
    if (H.thiefCD < 0 && ![...G.npcs.values()].some((n) => n.thief)) {
      H.thiefCD = rand(45, 80);
      const n = spawnNpc('nervous', -15 + rand(-2, 2), -12, { thief: true });
      n.thief = true; n.busy = true;
      npcSay(n, 'Nothing to see here...');
      const ex = pick(Z.exits);
      npcGoTo(n, ex[0], ex[1], (k) => { removeNpc(k.id); sayAll('A shoplifter escaped with a rotisserie chicken. Security, please try harder.'); });
      G.net.broadcast({ t: 'ann', x: 'Security alert: shoplifter in Mega Mart!' }); announce('Security alert: shoplifter in Mega Mart!');
    }
  }
}
Game.catchThief = (n, pid) => {
  if (n.caught) return;
  n.caught = true; n.busy = true; n.onArrive = null; n.path = [];
  knockNpc(n, n.x + 0.5, n.z); npcSay(n, pick(['Curses!', 'I would have gotten away with it!', 'Fine, take your chicken!']));
  if (pid) award(pid, 25, 'Shoplifter caught!', 'security', 'caught');
  setTimeout(() => removeNpc(n.id), 3000);
};
Game.bonk = (pid) => { noteBonk(pid); award(pid, 0, null, null, 'bonks'); };

// Physics comedy: thrown objects, cart crashes, shelf hits, display collapses
let shelfCD = 0;
function onImpact(obj, v, other) {
  if (!G.isHost || !other) return;
  const ud = other.userData || {};
  const n = ud.npc;
  const sp = obj.body.velocity.length();
  const p = obj.body.position;
  if (n) {
    if (n.thief && (sp > 2 || obj.holder)) { const by = obj.lastHolder; Game.catchThief(n, by); return; }
    const cart = obj.type === 'cart';
    if ((cart && sp > 1.3) || sp > 2.2 || v > 3) {
      // heavier + faster = bigger ragdoll launch
      const strength = Math.min(1, (sp / 8) * Math.min(2, 0.5 + obj.def.mass / 4));
      const d = obj.body.velocity, dl = Math.hypot(d.x, d.z) || 1;
      G.sound.playAll(cart ? 'cartCrash' : obj.type === 'chicken' ? 'chickenSlap' : 'npcHit', { x: n.x, y: n.fy + 1, z: n.z });
      npcHit(n, { x: d.x / dl, y: 0.3, z: d.z / dl }, Math.max(0.3, strength), p.y - n.fy > 1.45 * n.scale ? 'head' : 'body', obj.lastHolder, 'object');
      if (cart) setTimeout(() => G.npcs.has(n.id) && npcSay(n, pick(['RUN OVER BY A CART!', 'Get a LICENSE!', 'Beep beep, my FOOT!'])), 400);
      if (obj.type === 'chicken') setTimeout(() => G.npcs.has(n.id) && npcSay(n, pick(['Did you just... CHICKEN me?!', 'BAWK?!', 'Assault with a poultry weapon!'])), 400);
    } else if (sp > 1.0) stumbleNpc(n, cart ? pick(['Watch the cart!', 'My toes!', 'Excuse YOU, cart person!']) : null);
    return;
  }
  // parked cars have very sensitive alarms
  if (v > 3.5 && Z.cars) for (const [cx, cy, cz] of Z.cars) if (Math.abs(p.x - cx) < 1.3 && Math.abs(p.z - cz) < 2.4 && Math.abs(p.y - cy - 0.6) < 1.2) { G.sound.playAll('carAlarm', { x: cx, y: cy + 1, z: cz }); break; }
  // smashing into a shelf: products rain down
  if ((obj.type === 'cart' ? sp > 2.0 : v > 4.5) && G.time > shelfCD) {
    const sb = shelfBounds.find((b) => p.x > b.minX - 0.6 && p.x < b.maxX + 0.6 && p.z > b.minZ && p.z < b.maxZ);
    if (sb) {
      shelfCD = G.time + 1.5;
      let k = 0;
      for (const o of G.objects.values()) {
        const q = o.mesh.position;
        if (o.holder || !o.body || q.x < sb.minX || q.x > sb.maxX || q.z < p.z - 1.2 || q.z > p.z + 1.2 || q.y < 0.3) continue;
        o.body.wakeUp(); o.body.applyImpulse({ x: (Math.random() - 0.5) * o.def.mass * 3, y: o.def.mass * 1.5, z: (Math.random() - 0.5) * o.def.mass * 3 }, o.body.position);
        if (++k > 8) break;
      }
      G.sound.playAll('shelfShake', p);
      addIncident(p.x, p.z, 'shelf');
      scareNearby(p.x, p.z, 4);
    }
  }
  if (v > 5) { scareNearby(p.x, p.z, 4); addIncident(p.x, p.z, 'crash'); }
}

// banana peels + the cereal display
function updateSlapstick(dt) {
  for (const o of G.objects.values()) {
    if (o.type !== 'peel' || o.holder || o.mesh.position.y > 0.15) continue;
    for (const n of G.npcs.values()) {
      if ((n.state !== 'walk' && n.state !== 'flee' && n.state !== 'chase') || (n.slipCD || 0) > G.time) continue;
      if (Math.hypot(n.x - o.mesh.position.x, n.z - o.mesh.position.z) < 0.4) {
        n.slipCD = G.time + 6;
        if (knockNpc(n, n.x - Math.sin(n.rot), n.z - Math.cos(n.rot), null, 'npcSlip')) {
          npcSay(n, pick(['A BANANA?! In THIS mall?!', 'WHOOOOA-', 'Classic. Just classic.', 'My one weakness!']));
          if (o.lastHolder) award(o.lastHolder, 3, 'Slapstick!', null, 'slips');
          o.body && (o.body.wakeUp(), o.body.applyImpulse({ x: (Math.random() - 0.5) * 0.3, y: 0.2, z: (Math.random() - 0.5) * 0.3 }, o.body.position));
        }
      }
    }
  }
  // display: if knocked over, everyone gasps; a trainee eventually rebuilds it
  const disp = [...G.objects.values()].filter((o) => o.flags.display);
  const moved = disp.filter((o) => Math.hypot(o.mesh.position.x - o.home[0], o.mesh.position.y - o.home[1], o.mesh.position.z - o.home[2]) > 0.3).length;
  if (!H.displayDown && moved >= 3) {
    H.displayDown = true; H.displayT = G.time + 50;
    G.sound.playAll('displayFall', { x: Z.display.x, y: 0.5, z: Z.display.z });
    for (const n of G.npcs.values()) if (Math.hypot(n.x - Z.display.x, n.z - Z.display.z) < 10 && n.state !== 'fallen' && !n.busy) {
      if (n.P.dramatic) { n.state = 'dramatic'; n.timer = 3; npcSay(n, pick(['THE DISPLAY! NOOOO!', 'WHY WOULD YOU DO THAT?!'])); }
      else if (Math.random() < 0.5) { n.state = 'react'; n.timer = 2; n.rotTarget = Math.atan2(-(Z.display.x - n.x), -(Z.display.z - n.z)); npcSay(n, pick(['The display!', 'Ohhh, somebody\'s in trouble.', 'That took them HOURS!'])); }
    }
    G.sound.playAll('npcGasp', { x: Z.display.x, y: 1.5, z: Z.display.z });
    addIncident(Z.display.x, Z.display.z, 'display');
  }
  if (H.displayDown && G.time > H.displayT && !disp.some((o) => o.holder)) {
    H.displayDown = false;
    for (const o of disp) { o.body.position.set(o.home[0], o.home[1], o.home[2]); o.body.velocity.set(0, 0, 0); o.body.angularVelocity.set(0, 0, 0); o.body.quaternion.set(0, 0, 0, 1); }
    const t = [...G.npcs.values()].find((n) => n.P.behavior === 'trainee');
    if (t) npcSay(t, pick(['Display rebuilt! Please. PLEASE leave it alone.', 'Fixed it! Again! Ninth time today!']));
  }
}

// ---------- equipment ----------
function giveGear(pid, id) {
  const p = G.players.get(pid); const def = GEAR.find((g) => g.id === id);
  if (!p || !def) return;
  if ((H.gearCD[pid] || 0) > G.time) { notify(pid, 'Gear dispenser cooling down...'); return; }
  H.gearCD[pid] = G.time + 2;
  const list = H.gear.get(pid) || []; H.gear.set(pid, list);
  // spawn in front of the player at chest height
  const hp = p.head.p, q = p.head.q;
  const fwd = _tv.set(0, 0, -1).applyQuaternion(q); fwd.y = 0; fwd.normalize();
  const n = id === 'peel' ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const o = spawnObject(id, [hp.x + fwd.x * 0.6 + i * 0.15, hp.y - 0.3 + i * 0.05, hp.z + fwd.z * 0.6], null);
    list.push(o.id);
  }
  while (list.length > 6) { const old = list.shift(); const ob = G.objects.get(old); if (ob && !ob.holder) despawnObject(old); }
  G.sound.playAll('gearBuy', hp);
  confettiAll(hp.x + fwd.x * 0.6, hp.y - 0.2, hp.z + fwd.z * 0.6);
}
function notify(pid, text) { if (pid === G.myId) toast(text); else G.net.sendTo(pid, { t: 'toast', x: text }); }
function confettiAll(x, y, z) { confetti({ x, y, z }, 30); G.net.broadcast({ t: 'confetti', p: [x, y, z] }); }

Game.onSpray = (id, on, pid) => {
  const o = G.objects.get(id);
  if (!o || !o.def.spray) return;
  if (on && (!o.holder || o.holder.pid !== pid)) return;
  setSpraying(id, on);
};

// Arcade
const prevBall = new Map();
function updateArcade(dt) {
  const hz = Z.hoop;
  for (const o of G.objects.values()) {
    if (o.def.shape !== 'sphere') continue;
    const q = o.mesh.position, py = prevBall.get(o.id);
    prevBall.set(o.id, q.y);
    if (py === undefined) continue;
    if (py > hz.y && q.y <= hz.y && Math.hypot(q.x - hz.x, q.z - hz.z) < hz.r - 0.03) {
      fxAll('swish', q);
      if (o.lastHolder) award(o.lastHolder, 3, 'SWISH!', null, 'swishes');
    }
  }
  const w = H.whack;
  if (w) {
    w.t -= dt; w.next -= dt;
    if (w.next < 0) { setLit(w.lit, false); w.lit = randi(0, 5); setLit(w.lit, true); w.next = Math.max(0.45, 0.9 - (20 - w.t) * 0.02); }
    if (w.t < 0) { setLit(w.lit, false); award(w.pid, w.score, `Whack score: ${w.score}`, null); H.whack = null; }
  }
}
function setLit(i, on) {
  if (i === null || i === undefined) return;
  const b = G.buttons.find((x) => x.id === 'whack_' + i); setButtonLit(b, on);
  G.net.broadcast({ t: 'lit', id: b.id, on });
}

// Buttons
Game.onButton = (id, pid) => {
  const P = Z.prep;
  if (id === 'disp_patty') dispense('patty', [P.x - 1, P.y + 0.15, P.z]);
  if (id === 'disp_fries') dispense('fries', [P.x, P.y + 0.15, P.z]);
  if (id === 'disp_soda') dispense('cup', [P.x + 1, P.y + 0.15, P.z]);
  if (id === 'secret') {
    award(pid, 0, null, null, 'secret');
    sayAll('Whoever just pressed the secret button: you saw nothing. Here is a golden melon. Shh.');
    spawnObject('melon', [Z.office[0] - 1.5, Z.office[1] + 1.2, Z.office[2]], null, { color: 0xffd700 });
    startEvent('outage', 3);
  }
  if (id === 'chaos') {
    if (H.chaosCD > G.time) { G.net.sendTo(pid, { t: 'toast', x: 'Chaos button recharging...' }); if (pid === G.myId) toast('Chaos button recharging...'); return; }
    H.chaosCD = G.time + 30; randomEvent();
  }
  if (id === 'whack_start' && !H.whack) { H.whack = { pid, t: 20, next: 0.5, lit: null, score: 0 }; fxAll('chime', { x: 18, y: 1, z: 14 }); }
  if (id.startsWith('whack_') && id !== 'whack_start' && H.whack) {
    const i = +id.split('_')[1];
    if (i === H.whack.lit) { H.whack.score++; setLit(i, false); H.whack.lit = null; H.whack.next = 0.15; fxAll('pop', { x: 18, y: 1, z: 14 }); }
    else fxAll('error', { x: 18, y: 1, z: 14 });
  }
  if (id === 'elev' || id === 'elev2') {
    if (G.time < elevator.t0 + elevator.dur) return; // already moving
    const to = elevator.to > 2 ? 0 : L2Y;
    const from = elevator.to;
    setTimeout(() => { setElevator(from, to, 4); G.net.broadcast({ t: 'elev', from, to, dur: 4 }); G.sound.playAll('elevatorDing', { x: -4.8, y: from + 1.5, z: -4.8 }); }, 600);
  }
  if (id === 'secret_book' && !G.secretOpen) {
    setSecretDoor(true); G.net.broadcast({ t: 'secret', open: true });
    G.sound.playAll('shelfShake', { x: -16, y: L2Y + 1, z: 7.7 });
    award(pid, 0, null, null, 'secret');
    setTimeout(() => { setSecretDoor(false); G.net.broadcast({ t: 'secret', open: false }); }, 20000);
  }
  if (id.startsWith('flush_')) {
    const s = Z.stalls[+id.split('_')[1]];
    G.sound.playAll('flush', { x: s.x, y: 0.6, z: s.z });
    for (const n of G.npcs.values()) if (n.x > 45 && n.x < 61 && n.z > -23 && n.z < -7 && Math.random() < 0.5) npcSay(n, pick(['Was that a jet engine?', 'Courtesy flush. Respect.', 'MY EARS!']));
  }
  if (id.startsWith('dryer_')) {
    const x = id === 'dryer_0' ? 51 : 55;
    G.sound.playAll('dryer', { x, y: 1.3, z: -8.3 });
    for (const o of G.objects.values()) { if (!o.body || o.holder) continue; const q = o.body.position; if (Math.abs(q.x - x) < 1.2 && q.z > -10 && q.z < -8 && q.y < 2) { o.body.wakeUp(); o.body.applyImpulse({ x: 0, y: o.def.mass * 3, z: -o.def.mass * 1.5 }, o.body.position); } }
  }
  if (id === 'popcorn') dispense('popcorn', [36 + rand(-0.3, 0.3), 2.2, 37.6]);
  if (id === 'coffee') dispense('cup', [Z.coffee[0] + rand(-0.5, 0.5), Z.coffee[1] + 0.3, Z.coffee[2]]);
  if (id.startsWith('food_')) { const f = id.slice(5), r = Z.restaurants[['pizza', 'taco', 'noodles'].indexOf(f) + 1]; dispense(f, [r.x + rand(-0.8, 0.8), 1.25, r.z]); }
  if (id.startsWith('alarm_')) {
    if ((H.alarmCD || 0) > G.time) return;
    H.alarmCD = G.time + 20;
    G.sound.playAll('emergency');
    sayAll(G.fires.size ? 'Fire alarm activated! Sprinklers on!' : 'Someone pulled the fire alarm. There is no fire. Enjoy the shower.');
    startEvent('sprinkler', 12);
    if (!G.fires.size) { H.alarmOnly = G.time + 12; applyEvent('fire', true, true); G.net.broadcast({ t: 'ev', name: 'fire', on: true }); }
    scareNearby(0, 0, 60, pick(['AAAH! WATER!', 'My HAIR!', 'I just got this blouse dry-cleaned!']));
  }
};
Game.onUse = (id, pid) => {
  const o = G.objects.get(id); if (!o) return;
  if (o.type === 'tp' && o.body) { o.body.velocity.y += 3; }
  if (o.type === 'cart') scareNearby(o.mesh.position.x, o.mesh.position.z, 3, 'BEEP BEEP to you too!');
  if (o.type === 'chicken') G.sound.playAll('chickenSlap', o.mesh.position, 0.5);
  if (o.type === 'megaphone' && (H.megaCD[pid] || 0) < G.time) {
    H.megaCD[pid] = G.time + 4;
    const p = o.mesh.position;
    G.sound.playAll('megaphone', p);
    const msg = pick(['ATTENTION SHOPPERS! THE FLOOR IS LAVA!', 'EVERYTHING IS FREE! JUST KIDDING!', 'WOULD GRANDMA PLEASE RETURN TO HER CART!', 'THIS IS NOT A DRILL! IT IS A MOP!', 'PLEASE STOP STARING, SIR!']);
    G.net.broadcast({ t: 'ann', x: msg }); announce(msg);
    for (const n of G.npcs.values()) {
      if (Math.hypot(n.x - p.x, n.z - p.z) > 9 || n.state === 'fallen') continue;
      if (n.P.behavior === 'cart' || n.pers === 'grandma') { n.state = 'blocked'; n.timer = 2; npcSay(n, 'DON\'T YOU YELL AT ME, YOUNG ONE!'); }
      else if (Math.random() < 0.5) stumbleNpc(n, pick(['AAH! My ears!', 'Was that necessary?!', 'WHAT?!']));
    }
  }
};

// ---------- random events ----------
// weight = how often it's picked, cooldown = min seconds before it can happen again, dur = length
const EVENTS = {
  outage:        { weight: 1.0, cooldown: 120, dur: 25 },
  fire:          { weight: 1.3, cooldown: 100, dur: 999 },   // ends when every flame is out
  sale:          { weight: 1.0, cooldown: 150, dur: 40 },
  stampede:      { weight: 0.8, cooldown: 120, dur: 12 },
  lockdown:      { weight: 0.6, cooldown: 180, dur: 20 },
  escalator:     { weight: 0.6, cooldown: 200, dur: 45 },
  spill:         { weight: 1.0, cooldown: 60, dur: 0 },
  announce:      { weight: 1.5, cooldown: 30, dur: 0 },
  sprinkler:     { weight: 0.6, cooldown: 150, dur: 12 },
  investigation: { weight: 0.8, cooldown: 90, dur: 15 },
  confusion:     { weight: 0.8, cooldown: 120, dur: 7 },
  conga:         { weight: 0.7, cooldown: 150, dur: 16 },
  melonrain:     { weight: 0.6, cooldown: 180, dur: 4 },
  // supermarket specials
  samples:       { weight: 0.9, cooldown: 120, dur: 25 },
  cartAvalanche: { weight: 0.7, cooldown: 150, dur: 3 },
  priceCheck:    { weight: 0.8, cooldown: 100, dur: 12 },
};
function randomEvent() {
  const avail = Object.entries(EVENTS).filter(([n, e]) => !G.events[n] && G.time - (H.lastEvent[n] ?? -1e9) > e.cooldown);
  if (!avail.length) return;
  let r = Math.random() * avail.reduce((s, [, e]) => s + e.weight, 0);
  for (const [n, e] of avail) { r -= e.weight; if (r <= 0) { startEvent(n); return; } }
  startEvent(avail[0][0]);
}
export function startEvent(name, dur, quiet = false) {
  const def = EVENTS[name] || { dur: 10 };
  dur = dur ?? def.dur;
  H.lastEvent[name] = G.time;
  if (name === 'spill') { for (let i = 0; i < 4; i++) { const [x, z] = randomFloorPoint(); addMarker({ kind: 'spill', x, z, s: rand(1, 1.6) }); } sayAll('Cleanup on aisle everywhere. Someone dropped forty smoothies.'); return; }
  if (name === 'announce') { sayAll(pick(ANNOUNCEMENTS)); return; }
  if (name === 'fire' && !quiet) { // a random event fire: light 1-2 things in the food court / mall
    const cands = [...G.objects.values()].filter((o) => !o.def.noBurn && o.type !== 'door' && !o.holder && o.mesh.position.z < 0);
    for (let i = 0; i < 2 && cands.length; i++) igniteObject(cands.splice(randi(0, cands.length - 1), 1)[0]);
    sayAll('Attention: something is on fire. Again. Please use the extinguishers on the walls.');
    return; // fire.js turns the alarm on when it sees flames
  }
  applyEvent(name, true);
  G.net.broadcast({ t: 'ev', name, on: true });
  H.eventEnds[name] = G.time + dur;
  G.sound.playAll('randomEvent');
  const all = [...G.npcs.values()].filter((n) => !n.busy);
  if (name === 'fire') all.forEach((n) => { if (Math.random() > 0.6) return; const e = pick(Z.exits); npcGoTo(n, e[0] - Math.sign(e[0]) * rand(1, 3), e[1] + rand(-2, 2), (k) => { k.state = 'browse'; k.timer = 6; }, true); if (Math.random() < 0.4) npcSay(n, pick(['FIRE! FIRE!', 'Save the pretzels!', 'Women, children, and influencers first!'])); });
  if (name === 'sprinkler') {
    all.forEach((n) => { if (Math.random() < 0.35) { n.state = 'confused'; n.timer = 2.5; npcSay(n, pick(['I\'m WET!', 'Is it raining INDOORS?', 'My phone!', 'Free shower!'])); } });
    for (let i = 0; i < 4; i++) { const [x, z] = randomFloorPoint(); Game.addPuddle(x, z); }
  }
  if (name === 'investigation') {
    const [x, z] = randomFloorPoint();
    sayAll('Security to the concourse. Something suspicious has been reported. Probably a pigeon.');
    for (let i = 0; i < 3; i++) addIncident(x + rand(-1, 1), z + rand(-1, 1), 'investigation');
    all.forEach((n) => { if (n.P.behavior !== 'investigate' && Math.random() < 0.4) npcGoTo(n, x + rand(-3, 3), z + rand(-3, 3), (k) => { k.state = 'react'; k.timer = 4; k.rotTarget = Math.atan2(-(x - k.x), -(z - k.z)); npcSay(k, pick(['What happened?', 'I saw nothing.', 'Was it a ghost?'])); }); });
  }
  if (name === 'confusion') {
    const players = [...G.players.values()];
    const target = pick(players);
    all.forEach((n) => { n.state = 'confused'; n.timer = dur; if (target) n.rotTarget = Math.atan2(-(target.head.p.x - n.x), -(target.head.p.z - n.z)); });
    setTimeout(() => { for (const n of G.npcs.values()) if (Math.random() < 0.4) npcSay(n, pick(['...wait, what?', '...', 'Why am I here?', 'Huh.'])); }, 1500);
    setTimeout(() => { for (const n of G.npcs.values()) if (Math.random() < 0.3) npcSay(n, '...anyway.'); }, dur * 1000 - 500);
  }
  if (name === 'conga') {
    const line = all.slice(0, 8);
    line.forEach((n, i) => { n.state = 'walk'; n.path = []; n.conga = i; });
    H.conga = line.map((n) => n.id);
    if (line[0]) npcSay(line[0], 'CONGA! Everybody follow me!');
  }
  if (name === 'samples') { // free samples table: food appears, shoppers stampede toward it
    sayAll('Free samples at the front of Mega Mart! Limit one. We are not counting.');
    for (let i = 0; i < 8; i++) setTimeout(() => spawnObject(pick(['pizza', 'taco', 'noodles', 'popcorn', 'icecream']), [-23 + rand(-1, 1), 1.2, -17 + rand(-0.5, 0.5)], null), i * 250);
    all.forEach((n) => { if ((n.floor || 0) === 0 && Math.random() < 0.6) npcGoTo(n, -23 + rand(-2.5, 2.5), -17 + rand(-1.5, 1.5), (k) => { k.state = 'dance'; k.timer = 3; npcSay(k, pick(['FREE?!', 'I\'ll take seven.', 'Is this gluten free? Don\'t care.'])); }, true); });
  }
  if (name === 'cartAvalanche') { // a train of runaway carts comes out of the market doors
    sayAll('Attention: the cart return has achieved sentience. Please step aside.');
    for (let i = 0; i < 7; i++) setTimeout(() => { const o = spawnObject('cart', [-27 + rand(-2, 2), 0.05, -11], [0, 0, 0, 1]); o.body.velocity.set(rand(-1, 1), 0, 7 + rand(0, 2)); o.lastHolder = null; }, i * 300);
  }
  if (name === 'priceCheck') {
    sayAll('Price check on aisle five! Everyone. Please gather and look confused.');
    all.forEach((n) => { if ((n.floor || 0) === 0 && Math.random() < 0.5) npcGoTo(n, -28 + rand(-1, 1), -28 + rand(-4, 4), (k) => { k.state = 'confused'; k.timer = 4; npcSay(k, pick(['How much is it?!', 'I have a coupon!', 'Is it free yet?'])); }); });
  }
  if (name === 'melonrain') {
    const c = G.players.values().next().value;
    const cx = c ? c.head.p.x : 0, cz = c ? c.head.p.z : 0;
    for (let i = 0; i < 6; i++) setTimeout(() => {
      const x = cx + rand(-4, 4), z = cz + rand(-4, 4);
      if (!pointBlocked(x, z, 0.3) && Math.abs(x) < 22 && Math.abs(z) < 16) spawnObject('melon', [x, 6.5, z], null);
    }, i * 400);
  }
  if (name === 'stampede') all.forEach((n, i) => { const side = i % 2 ? 1 : -1; npcGoTo(n, side * 20, rand(-3, 4), (k) => { k.state = 'idle'; k.timer = 1; }, true); n.state = 'flee'; if (Math.random() < 0.3) npcSay(n, 'RUUUUN!'); });
  if (name === 'outage') all.forEach((n) => { if (Math.random() < 0.4) npcSay(n, pick(['Who turned off the lights?', 'I\'m scared of the dark!', 'Ooh, spooky.'])); });
  if (name === 'lockdown') all.forEach((n) => { if (Math.random() < 0.3) npcSay(n, pick(['Are we trapped?', 'I live here now.', 'Finally, some peace.'])); });
  if (name === 'sale') all.forEach((n) => { if (Math.random() < 0.5) { n.state = 'dance'; n.timer = 2; npcSay(n, pick(['SALE?!', 'MINE! ALL MINE!', 'Out of my way!'])); } });
}
function endEvent(name) {
  applyEvent(name, false);
  G.net.broadcast({ t: 'ev', name, on: false });
  delete H.eventEnds[name];
  if (name === 'conga') { for (const id of H.conga || []) { const n = G.npcs.get(id); if (n) { n.conga = undefined; n.state = 'idle'; n.timer = 1; } } H.conga = null; }
}

function updateConga(dt) {
  if (!H.conga) return;
  const line = H.conga.map((id) => G.npcs.get(id)).filter(Boolean);
  line.forEach((n, i) => {
    if (n.state === 'fallen') return;
    let tx, tz;
    if (i === 0) { // leader dances around the fountain
      const a = G.time * 0.35; tx = 4 + Math.cos(a) * 5; tz = 1 + Math.sin(a) * 4;
    } else { const f = line[i - 1]; tx = f.x + Math.sin(f.rot) * 0.7; tz = f.z + Math.cos(f.rot) * 0.7; }
    const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz);
    n.state = 'walk'; n.path = []; n.onArrive = null;
    if (d > 0.1) { const s = Math.min(d, 2.2 * dt); n.x += dx / d * s; n.z += dz / d * s; n.rotTarget = Math.atan2(-dx, -dz); }
    if (Math.random() < dt * 0.15) npcSay(n, pick(['DA-DA-DA-DA-DA-DA HEY!', 'CONGA!', 'I don\'t know why I\'m doing this!']));
  });
}

// ---------- supermarket machines ----------
const scanned = new Set();
let selfT = 0;
function updateSupermarket(dt) {
  // conveyor belts carry items toward the scanner
  for (const c of conveyors) for (const o of G.objects.values()) {
    if (!o.body || o.holder) continue;
    const q = o.body.position;
    // carry items along directly (counter friction would cancel a velocity push)
    if (q.x > c.minX && q.x < c.maxX && q.z > c.minZ && q.z < c.maxZ && q.y > c.y && q.y < c.y + 0.4) { o.body.wakeUp(); q.x += c.vx * dt; q.z = Math.min(c.maxZ - 0.05, q.z + c.vz * dt); o.body.aabbNeedsUpdate = true; }
  }
  // self-checkout: beep + a sarcastic machine voice
  selfT -= dt; if (selfT > 0) return; selfT = 0.25;
  for (const s of Z.selfCheckouts) for (const o of G.objects.values()) {
    if (scanned.has(o.id) || o.type === 'cart' || o.type === 'basket') continue;
    const q = o.mesh.position;
    if (Math.abs(q.x - s.x) < 0.3 && Math.abs(q.z - s.z) < 0.25 && q.y > s.y - 0.05 && q.y < s.y + 0.45) {
      scanned.add(o.id); if (scanned.size > 300) scanned.clear();
      G.sound.playAll('beepScan', q);
      const who = o.holder ? o.holder.pid : o.lastHolder;
      const line = pick(['UNEXPECTED ITEM IN BAGGING AREA.', `${o.def.label}: $${(Math.random() * 20 + 1).toFixed(2)}. Please place item in bag.`, 'Please wait for assistance. Assistance is on break.', 'Did you scan your dignity? It is not in our system.']);
      if (who) notify(who, '🛒 SELF CHECKOUT: ' + line);
      if (Math.random() < 0.3) { G.net.broadcast({ t: 'ann', x: line }); announce(line); }
    }
  }
}
// thrown objects hitting other players (cartoon knockback, small damage)
const objHitCD = new Map();
function updateObjectHits() {
  for (const o of G.objects.values()) {
    if (!o.body || o.holder) continue;
    const v = o.body.velocity; const sp = Math.hypot(v.x, v.y, v.z);
    if (sp < 5 || (objHitCD.get(o.id) || 0) > G.time) continue;
    const q = o.body.position;
    for (const p of G.players.values()) {
      if (p.id === o.lastHolder || p.ko) continue;
      const h = p.head.p;
      if (Math.hypot(q.x - h.x, q.z - h.z) < 0.4 && q.y < h.y + 0.2 && q.y > h.y - 1.6) {
        objHitCD.set(o.id, G.time + 1);
        const s = Math.min(1, sp / 12 * Math.min(2, 0.5 + o.def.mass / 3));
        const hurt = { t: 'hurt', from: o.lastHolder, zone: q.y > h.y - 0.25 ? 'head' : 'body', d: [v.x / sp, 0.3, v.z / sp], s, dmg: Math.round(5 + 25 * s), k: 'object' };
        if (p.id === G.myId) G.combat.onHurt(hurt); else G.net.sendTo(p.id, hurt);
        const msg = { p: [q.x, q.y, q.z], k: 'punch', zone: hurt.zone, s };
        G.combat.hitFx(msg); G.net.broadcast({ t: 'hitfx', ...msg });
        o.body.velocity.scale(-0.3, o.body.velocity);
        break;
      }
    }
  }
}
// player knockouts -> ragdolls everyone can see
Game.playerKO = (pid, m) => {
  const p = G.players.get(pid); if (!p || p.ko) return;
  p.ko = true;
  const h = p.head.p;
  const rd = spawnRagdoll({ owner: { type: 'p', id: pid }, kind: 'blocky', look: p.look, scale: 1, x: h.x, y: h.y - 1.62, z: h.z,
    rot: 0, dir: { x: m.d[0], y: m.d[1], z: m.d[2] }, strength: Math.max(0.6, m.s), zone: m.zone, life: 99 });
  p.ragId = rd.id;
  sayAll(`${p.name} has been KNOCKED OUT! 💫`);
};
Game.playerRespawn = (pid) => {
  const p = G.players.get(pid); if (!p) return;
  p.ko = false; if (p.ragId) { endRagdoll(p.ragId); p.ragId = null; }
};
Game.fire = (pid, id) => hostFire(pid, id);

export function hostUpdate(dt) {
  updateRegisters(dt); updateStock(); updateSpills(dt); updateFood(dt); updateSecurity(dt); updateArcade(dt);
  updateFireHost(dt); updateSlapstick(dt); updateConga(dt);
  updateSupermarket(dt); updateObjectHits(); updateRagdollsHost(dt);
  if (H.alarmOnly && G.time > H.alarmOnly) { H.alarmOnly = 0; if (!G.fires.size) { applyEvent('fire', false); G.net.broadcast({ t: 'ev', name: 'fire', on: false }); } }
  for (const [name, end] of Object.entries(H.eventEnds)) if (G.time > end) endEvent(name);
  if (G.mode === 'play' || G.online) {
    if (!H.nextEvent) H.nextEvent = G.time + rand(50, 90);
    if (G.time > H.nextEvent) { H.nextEvent = G.time + rand(70, 140); if (Save.data.settings.events) randomEvent(); }
  }
  // janitors keep getting messes
  if ([...G.players.values()].some((p) => p.job === 'janitor')) {
    H.spillCD -= dt; if (H.spillCD < 0) { H.spillCD = rand(25, 45); ensureSpills(Math.min(6, [...G.markers.values()].filter((m) => m.kind === 'spill').length + 1)); }
  }
  // arcade gate: open if anyone in the session owns the unlock
  const open = [...G.players.values()].some((p) => p.areas && p.areas.includes('arcade'));
  if (open !== G.gateOpen) { setGate(open); G.net.broadcast({ t: 'gate', open }); }
}

// Snapshot of host-only state for players joining mid-game
export function hostSnapshotExtras() {
  return { events: Object.keys(G.events), gate: G.gateOpen, order: H.food.order ? { items: H.food.order, rem: H.food.remaining } : null,
    lit: G.buttons.filter((b) => b.lit).map((b) => b.id), fires: hostFireSnapshot(), spraying: [...G.spraying],
    elev: { from: elevator.from, to: elevator.to, left: Math.max(0, elevator.t0 + elevator.dur - G.time) }, secret: !!G.secretOpen };
}
Game.giveGear = giveGear;
