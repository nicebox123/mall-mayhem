// NPC shoppers: grid navigation, personalities, comedy behaviors. AI runs on host; clients interpolate.
import * as THREE from 'three';
import { G, newId } from './state.js';
import { PERSONALITIES, SKINS, NPC_ROSTER, ITEMS } from './config.js';
import { world, CANNON, V3, pointBlocked, groundAt } from './physics.js';
import { spawnRagdoll, ragFor } from './ragdoll.js';
import { makeAvatar } from './avatar.js';
import { makeModelAvatar } from './characters.js';
import { buildObjectMesh } from './objects.js';
import { A } from './assets.js';
import { Save } from './save.js';
import { Z } from './world.js';
import { pick, rand, randi, damp, textTexture, wrapText } from './util.js';

// ---------- navigation: one grid per floor (L1 y=0, L2 y=5), A* with a binary heap ----------
const STEP = 1.5, X0 = -59, Z0 = -39, NX = 102, NZ = 65, FLOOR_Y = [0, 5];
const grids = [null, null];
const blockedAt = (x, z, r, f) => pointBlocked(x, z, r, FLOOR_Y[f], 'gate');
function zoneOf(x, z, f) { if (f) return -1; for (let i = 0; i < Z.noNav.length; i++) { const n = Z.noNav[i]; if (x > n.minX && x < n.maxX && z > n.minZ && z < n.maxZ) return i; } return -1; }
export function buildNav() {
  for (const f of [0, 1]) {
    const nodes = new Array(NX * NZ).fill(null);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const x = X0 + i * STEP, z = Z0 + j * STEP;
      if (Math.abs(groundAt(x, z, FLOOR_Y[f] + 0.3, 0.3).y - FLOOR_Y[f]) > 0.15) continue; // must stand on this floor
      if (!blockedAt(x, z, 0.38, f)) nodes[i * NZ + j] = { i, j, x, z, zone: zoneOf(x, z, f), nb: [], f };
    }
    const clear = (a, b) => { for (let t = 0; t <= 4; t++) { const k = t / 4; if (blockedAt(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, 0.3, f)) return false; } return true; };
    for (const n of nodes) if (n) for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const ii = n.i + di, jj = n.j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
      const m = nodes[ii * NZ + jj]; if (m && clear(n, m)) { n.nb.push(m); m.nb.push(n); }
    }
    grids[f] = nodes;
  }
}
const zoneBlocked = (n) => n.zone >= 0 && Z.noNav[n.zone].active !== false;
export function nearestNode(x, z, f = 0, allowZone = false) {
  const nodes = grids[f]; let best = null, bd = 1e9;
  const ci = Math.round((x - X0) / STEP), cj = Math.round((z - Z0) / STEP);
  for (let r = 0; r < 8 && !best; r++) for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
    const n = nodes[i * NZ + j]; if (!n || (!allowZone && zoneBlocked(n))) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function findPath(x, z, tx, tz, f = 0) {
  const s = nearestNode(x, z, f, true), t = nearestNode(tx, tz, f);
  if (!s || !t) return [];
  // binary heap keyed by f-score
  const heap = [], g = new Map([[s, 0]]), came = new Map(), closed = new Set();
  const push = (n, fs) => { heap.push([fs, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top[1]; };
  push(s, 0); let guard = 0;
  while (heap.length && guard++ < 6000) {
    const c = pop();
    if (closed.has(c)) continue;
    if (c === t) { const out = [[tx, tz]]; let k = c; while (k) { out.unshift([k.x, k.z]); k = came.get(k); } return smooth(out, f); }
    closed.add(c);
    for (const n of c.nb) {
      if (closed.has(n) || (zoneBlocked(n) && n !== t)) continue;
      const ng = g.get(c) + Math.hypot(n.x - c.x, n.z - c.z);
      if (ng < (g.get(n) ?? 1e9)) { came.set(n, c); g.set(n, ng); push(n, ng + Math.hypot(n.x - t.x, n.z - t.z)); }
    }
  }
  return [[tx, tz]];
}
function smooth(path, f) {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i + 1];
    let ok = true; for (let t = 0; t <= 6; t++) { const k = t / 6; if (blockedAt(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 0.3, f)) { ok = false; break; } }
    if (!ok) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

// ---------- NPC objects ----------
const persKeys = Object.keys(PERSONALITIES);
// pose codes shared with avatar.js / characters.js
const STATE_CODE = { walk: 0, browse: 0, idle: 0, wait: 0, react: 0, chase: 0, follow: 0, flee: 2, fallen: 1, selfie: 3, dance: 4, confused: 5,
  stumble: 6, stare: 7, dramatic: 8, blocked: 9, investigate: 10, sleep: 11 };

// shared blob shadow (cheap fake shadow under characters)
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
const shadowGeo = new THREE.CircleGeometry(0.35, 14); shadowGeo.rotateX(-Math.PI / 2);

export function createNpcVisual(data) {
  const P = PERSONALITIES[data.pers];
  let av = null;
  if (data.model && Save.data.settings.npcModels !== false && A.models[data.model]) av = makeModelAvatar(data.model, data.scale);
  if (!av) av = makeAvatar(data.look, { legs: true, scale: data.scale });
  G.scene.add(av.root);
  if (P.behavior === 'cart') { const c = buildObjectMesh('cart'); c.position.set(0, 0, -0.72); av.root.add(c); }
  const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.02; av.root.add(shadow);
  const fy = FLOOR_Y[data.floor || 0];
  const npc = { ...data, P, avatar: av, x: data.x, z: data.z, fy, rot: 0, code: 0, bubble: null, bubbleT: 0, lastX: data.x, lastZ: data.z, fallT: 0, flash: null };
  av.root.position.set(data.x, fy, data.z);
  G.npcs.set(data.id, npc);
  return npc;
}

const AREA = { market: [-30, -26, 14], electronics: [45, 17, 6], cafe: [0, -32, 5], lane3: [-36.9, -14, 0], lane4: [-32.9, -14, 0] };
export function spawnNpc(pers = pick(persKeys), x, z, extra = {}) {
  const P = PERSONALITIES[pers];
  const look = { skin: randi(0, SKINS.length - 1), shirt: Math.random() < 0.6 ? P.colors[0] : randi(0, 9), pants: P.colors[1], hat: Math.random() < 0.7 ? P.hat : 'none', acc: Math.random() < 0.7 ? P.acc : 'none' };
  if (pers === 'grandma') { look.skin = 0; look.hat = 'beanie'; look.acc = 'none'; }
  const floor = extra.floor || 0;
  if (x === undefined) {
    const a = extra.area && AREA[extra.area];
    if (a) { x = a[0] + rand(-a[2], a[2]); z = a[1] + rand(-a[2] * 0.5, a[2] * 0.5); const n = nearestNode(x, z, floor, true); if (n && a[2]) { x = n.x; z = n.z; } }
    else { const p = pick(floor ? Z.pois2 : Z.pois); x = p[0]; z = p[1]; }
  }
  const data = { id: newId('n'), pers, look, scale: P.small ? 0.62 : rand(0.94, 1.06), x, z, model: P.model || null, floor, ...extra };
  if (extra.nomodel) data.model = null;
  delete data.area; delete data.nomodel;
  const npc = createNpcVisual(data);
  Object.assign(npc, { state: 'idle', timer: rand(0, 2), path: [], task: null, sayCD: rand(3, 10), nearCD: rand(0, 5), confusedCD: 10, busy: false,
    behCD: rand(5, 15), bumpCD: 0, complainN: 0, complainT: 0, home: [x, z] });
  if (P.behavior === 'cashier') { npc.busy = true; npc.state = 'wait'; npc.rot = npc.rotTarget = -Math.PI / 2; }
  if (P.behavior === 'lazy') { npc.state = 'sleep'; npc.timer = 999; }
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(V3(0.25 * data.scale, 0.85 * data.scale, 0.18)) });
  body.position.set(x, npc.fy + 0.85 * data.scale, z); body.userData = { npc }; body.allowSleep = false;
  world.addBody(body); npc.body = body;
  G.net && G.net.broadcast({ t: 'npcSpawn', n: npcData(npc) });
  return npc;
}
export const npcData = (n) => ({ id: n.id, pers: n.pers, look: n.look, scale: n.scale, x: n.x, z: n.z, thief: n.thief || false, model: n.model || null, floor: n.floor || 0 });

export function removeNpc(id) {
  const n = G.npcs.get(id); if (!n) return;
  G.scene.remove(n.avatar.root);
  if (n.bubble) G.scene.remove(n.bubble);
  if (n.flash) G.scene.remove(n.flash);
  if (n.body) world.removeBody(n.body);
  G.npcs.delete(id);
  if (G.isHost) G.net && G.net.broadcast({ t: 'npcDel', id });
}
export function clearNpcs() { for (const id of [...G.npcs.keys()]) removeNpc(id); }

// ---------- speech + camera flash ----------
export function showBubble(npc, text) {
  if (npc.bubble) { G.scene.remove(npc.bubble); npc.bubble.material.map.dispose(); }
  const c = document.createElement('canvas'); const ctx = c.getContext('2d'); ctx.font = 'bold 36px "Trebuchet MS", sans-serif';
  const lines = wrapText(ctx, text, 460).slice(0, 3);
  const tex = textTexture(lines.join('\n'), { w: 512, h: 160, bg: '#ffffff', fg: '#1b1340', font: 'bold 36px "Trebuchet MS", sans-serif', radius: 40, border: '#1b1340' });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  s.scale.set(1.0, 0.31, 1);
  G.scene.add(s); npc.bubble = s; npc.bubbleT = 3.2;
}
export function npcSay(npc, text) { showBubble(npc, text); G.net && G.net.broadcast({ t: 'say', id: npc.id, x: text }); }
const flashMat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
export function showFlash(npc) {
  if (!npc.flash) { npc.flash = new THREE.Sprite(flashMat.clone()); npc.flash.scale.set(0.9, 0.9, 1); G.scene.add(npc.flash); }
  npc.flash.visible = true; npc.flash.material.opacity = 1; npc.flashT = 0.25;
  G.sound.play('photoFlash', { x: npc.x, y: 1.6, z: npc.z });
}
const line = (npc, kind, item) => pick(npc.P[kind] || npc.P.idle).replace('{item}', item || 'thing');

// ---------- host AI ----------
const incidents = [];
const bonkTimes = {};
export function addIncident(x, z, kind) { incidents.push({ x, z, kind, t: G.time }); if (incidents.length > 10) incidents.shift(); }
export function noteBonk(pid) { bonkTimes[pid] = G.time; }

export function npcGoTo(npc, x, z, then, run = false) {
  npc.path = findPath(npc.x, npc.z, x, z, npc.floor || 0); npc.state = run ? 'flee' : 'walk'; npc.onArrive = then || null;
  npc.task = { x, z, then, run };
}
function setState(npc, state, timer) { npc.state = state; npc.timer = timer; }

function pickActivity(npc) {
  const fl = npc.floor || 0;
  if (!fl && G.events.sale && Math.random() < 0.7) { npcGoTo(npc, Z.saleSpot[0] + rand(-3, 3), Z.saleSpot[1] + rand(-3, 3), (n) => setState(n, 'browse', rand(3, 6))); return; }
  const r = Math.random();
  if (npc.pers === 'influencer' && r < 0.25) { setState(npc, 'selfie', rand(3, 5)); npcSay(npc, line(npc, 'idle')); return; }
  if (npc.P.behavior === 'lost' && r < 0.3) { setState(npc, 'confused', rand(2, 4)); npcSay(npc, line(npc, 'idle')); return; }
  if (npc.P.behavior === 'weird' && r < 0.25) { setState(npc, 'dance', rand(3, 5)); npcSay(npc, line(npc, 'idle')); return; }
  // stay roughly in your home area most of the time (supermarket shoppers keep shopping)
  const list = fl ? Z.pois2 : Z.pois;
  let p = pick(list);
  if (Math.random() < 0.6) { const near = list.filter((q) => Math.hypot(q[0] - npc.home[0], q[1] - npc.home[1]) < 28); if (near.length) p = pick(near); }
  npcGoTo(npc, p[0] + rand(-0.4, 0.4), p[1] + rand(-0.4, 0.4), (n) => { setState(n, 'browse', rand(2.5, 6)); n.rotTarget = rand(0, Math.PI * 2); });
}

// Every knockdown is now a physics ragdoll. dir = push direction, strength 0..1, zone = head/body/legs
export function npcHit(npc, dir, strength, zone = 'body', byPid = null, kind = 'object') {
  if (npc.rag || npc.code === 1) return false;
  if (npc.thief) { G.game && G.game.catchThief(npc, byPid); }
  if (strength < 0.18 && kind !== 'boing') { stumbleNpc(npc, null); return false; }
  const extreme = Save.data.settings.ragdollStyle === 'extreme';
  const rd = spawnRagdoll({ owner: { type: 'npc', id: npc.id }, kind: npc.avatar.isModel ? 'model' : 'blocky', look: npc.look, scale: npc.scale, model: npc.model,
    x: npc.x, y: npc.fy, z: npc.z, rot: npc.rot, dir, strength, zone, life: (extreme ? 5 : 3) + strength * 1.5 });
  npc.rag = rd.id;
  setState(npc, 'fallen', 99);
  npc.onArrive = null;
  const p = { x: npc.x, y: npc.fy + 1, z: npc.z };
  setTimeout(() => G.npcs.has(npc.id) && npcSay(npc, zone === 'head' ? pick([line(npc, 'hit'), 'I see STARS!', 'Who turned the lights off?']) : line(npc, 'hit')), 250);
  setTimeout(() => G.sound.playAll('npcFall', p), 150);
  addIncident(npc.x, npc.z, 'hit');
  if (byPid) { noteBonk(byPid); G.game && G.game.bonk(byPid); }
  if (npc.P.behavior === 'complain') { npc.complainN = 4; npc.complainT = 4; }
  if (npc.P.behavior === 'brat') { npc.cryT = 6; }
  return true;
}
G.npcHit = npcHit;
// the ragdoll got back up: NPC stands where the torso landed
G.onRagdollEnd = (npc, rd) => {
  const t = rd.parts[0].tp;
  const n = nearestNode(t.x, t.z, npc.floor || 0, true);
  if (n && Math.hypot(n.x - t.x, n.z - t.z) < 3) { npc.x = t.x; npc.z = t.z; } else if (n) { npc.x = n.x; npc.z = n.z; }
  npc.rag = null; setState(npc, 'idle', 0.8);
  npcSay(npc, pick(['I\'m okay!', 'I meant to do that.', 'Ow. Rude.', 'Nobody saw that.', '*dizzy noises*']));
  if (npc.busy && npc.task) npcGoTo(npc, npc.task.x, npc.task.z, npc.task.then, npc.task.run);
  if (npc.P.behavior === 'cashier') { npc.x = npc.home[0]; npc.z = npc.home[1]; npc.state = 'wait'; npc.rotTarget = -Math.PI / 2; }
};

export function knockNpc(npc, fromX, fromZ, byPid, sound = 'npcHit') {
  if (npc.rag || npc.code === 1) return false;
  const dx = npc.x - fromX, dz = npc.z - fromZ, d = Math.hypot(dx, dz) || 1;
  G.sound.playAll(sound, { x: npc.x, y: npc.fy + 1, z: npc.z });
  return npcHit(npc, { x: dx / d, y: 0.3, z: dz / d }, 0.5, 'body', byPid, 'object');
}
export function stumbleNpc(npc, text) {
  if (npc.state === 'fallen' || npc.state === 'stumble') return false;
  const prev = npc.state === 'walk' || npc.state === 'flee' ? null : npc.state;
  setState(npc, 'stumble', 1.0); npc.resume = !prev;
  npcSay(npc, text || pick(['Whoa!', 'Hey!', 'Watch it!', 'Excuse YOU!']));
  G.sound.playAll('npcStumble', { x: npc.x, y: 1, z: npc.z });
  return true;
}

export function scareNearby(x, z, radius, msg) {
  for (const n of G.npcs.values()) {
    if (n.state === 'fallen' || n.busy) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d > radius) continue;
    if (n.P.dramatic && Math.random() < 0.5) { setState(n, 'dramatic', 3); n.rotTarget = Math.atan2(-(x - n.x), -(z - n.z)); npcSay(n, pick(['NOOOOO! WHY?!', 'THE HUMANITY!', 'I CAN\'T LOOK!'])); G.sound.playAll('npcGasp', { x: n.x, y: 1.5, z: n.z }); continue; }
    if (n.pers === 'nervous' || n.pers === 'kid' || n.pers === 'grandma' || msg) {
      const a = Math.atan2(n.x - x, n.z - z), fx = n.x + Math.sin(a) * 7, fz = n.z + Math.cos(a) * 7;
      npcGoTo(n, fx, fz, (k) => setState(k, 'idle', 1), true);
      if (Math.random() < 0.6) npcSay(n, msg || line(n, 'hit'));
    } else if (Math.random() < 0.35) { setState(n, 'react', 1.5); n.rotTarget = Math.atan2(-(x - n.x), -(z - n.z)); if (Math.random() < 0.5) npcSay(n, pick(['Whoa!', 'What was THAT?', 'Did you hear that?', 'Yikes!'])); }
  }
}

const sameFloor = (p, n) => Math.abs(p.head.p.y - 1.5 - n.fy) < 2.2;
function nearestPlayer(n, maxD) {
  let best = null, bd = maxD;
  for (const p of G.players.values()) { if (!sameFloor(p, n) || p.ko) continue; const d = Math.hypot(p.head.p.x - n.x, p.head.p.z - n.z); if (d < bd) { bd = d; best = p; } }
  return best ? { p: best, d: bd } : null;
}
const faceTo = (n, x, z) => { n.rotTarget = Math.atan2(-(x - n.x), -(z - n.z)); };

// per-personality special behaviors
function behave(n, dt) {
  const B = n.P.behavior;
  n.behCD -= dt;
  if (n.state === 'fallen') return;
  if (B === 'cashier') { // NPC cashiers stand at lanes 3-4 and "scan" (eat) whatever reaches them on the belt
    if (n.state !== 'wait' && n.state !== 'react' && n.state !== 'stumble') { n.state = 'wait'; }
    n.x += (n.home[0] - n.x) * Math.min(1, dt * 3); n.z += (n.home[1] - n.z) * Math.min(1, dt * 3); n.rotTarget = -Math.PI / 2;
    if (n.behCD < 0) {
      n.behCD = 0.8;
      for (const o of G.objects.values()) {
        const q = o.mesh.position;
        if (!o.holder && Math.abs(q.x - (n.home[0] + 0.9)) < 0.35 && q.z > -14.3 && q.z < -13.3 && q.y > 0.85 && q.y < 1.3) {
          G.sound.playAll('beepScan', q); G.game.despawn(o.id);
          if (Math.random() < 0.4) npcSay(n, pick(['That\'ll be $' + (Math.random() * 40 + 3).toFixed(2) + '.', 'Beep.', 'Unexpected item in MY area.', 'Do you have a rewards card? No? Cool.']));
          break;
        }
      }
    }
    return;
  }
  if (B === 'lazy') { // lazy employee: asleep standing up; wakes briefly when someone comes close
    if (n.state === 'sleep') {
      if (n.sayCD < 0) { n.sayCD = rand(6, 10); npcSay(n, pick(['Zzz...', 'ZZzzz...', '*snore*', 'Mmm... pretzels...'])); }
      const np = nearestPlayer(n, 1.8);
      if (np && n.behCD < 0) { n.behCD = 12; setState(n, 'react', 2.5); faceTo(n, np.p.head.p.x, np.p.head.p.z); npcSay(n, pick(['I\'M AWAKE! I\'m awake.', 'Welcome to... whatever this is.', 'Not my department.'])); }
    } else if ((n.state === 'idle' || n.state === 'browse') && n.timer < 0.5) setState(n, 'sleep', 999);
    return;
  }
  if (n.busy && B !== 'investigate') return;
  if (B === 'manager' && n.behCD < 0 && (n.state === 'browse' || n.state === 'idle' || n.state === 'walk')) { // follows you around, lecturing
    const np = nearestPlayer(n, 9);
    if (np) { n.behCD = rand(20, 35); setState(n, 'follow', 7); n.follow = np.p.id; n.lectureT = 0; npcSay(n, line(n, 'near')); }
  }
  if (B === 'brat' && n.behCD < 0 && n.state !== 'follow' && !(n.cryT > 0)) { // annoying kid tags along
    const np = nearestPlayer(n, 8);
    if (np) { n.behCD = rand(25, 40); setState(n, 'follow', 12); n.follow = np.p.id; n.lectureT = 0; }
  }
  if (n.cryT > 0) { n.cryT -= dt; if (n.state !== 'flee' && n.sayCD < 0) { n.sayCD = 2; npcSay(n, pick(['WAAAAH!', 'MOOOOM!', '*sniff* MEANIE!'])); } }
  if (n.state === 'follow') {
    const p = G.players.get(n.follow);
    if (!p || p.ko) { setState(n, 'idle', 1); }
    else {
      const dx = p.head.p.x - n.x, dz = p.head.p.z - n.z, d = Math.hypot(dx, dz);
      faceTo(n, p.head.p.x, p.head.p.z);
      if (d > 1.4) { const sp = (B === 'brat' ? 2.0 : 1.3) * dt; n.x += dx / d * Math.min(sp, d - 1.3); n.z += dz / d * Math.min(sp, d - 1.3); n.speed = 1.5; }
      if (d > 14) setState(n, 'idle', 1);
      n.lectureT -= dt;
      if (n.lectureT < 0) { n.lectureT = B === 'brat' ? 2.6 : 3.2; npcSay(n, B === 'brat' ? line(n, 'near') : pick(n.P.lecture)); }
      if (n.timer < 0.1) { npcSay(n, B === 'brat' ? 'BYE WEIRDO!' : 'I\'ll be watching you.'); setState(n, 'idle', 1); }
    }
  }
  if (B === 'weird' && n.state === 'walk') n.walkBackwards = true; // walks backwards everywhere. Why? Nobody knows.
  // angry customer: stomps off while listing complaints
  if (n.complainN > 0) {
    n.complainT -= dt;
    if (n.complainT < 0) {
      n.complainT = 2.4; n.complainN--;
      npcSay(n, pick(n.P.complain || n.P.hit));
      if (n.state !== 'walk') { const p = pick(Z.pois); npcGoTo(n, p[0], p[1], (k) => setState(k, 'blocked', 2)); }
    }
  }
  if (B === 'cart' && n.state === 'walk') { // grandma: furious when someone blocks her cart
    const np = nearestPlayer(n, 1.5);
    if (np) {
      const fx = -Math.sin(n.rot), fz = -Math.cos(n.rot);
      const dx = (np.p.head.p.x - n.x) / np.d, dz = (np.p.head.p.z - n.z) / np.d;
      if (fx * dx + fz * dz > 0.6 && n.behCD < 0) {
        n.behCD = 6; n.blockN = (n.blockN || 0) + 1;
        const resume = n.task;
        setState(n, 'blocked', 2.2); n.resumeTask = resume;
        npcSay(n, n.blockN > 1 ? pick(['I SAID MOVE!', 'Do you want the cane?!', 'BEEP BEEP, SWEETIE!']) : line(n, 'near'));
        if (n.blockN > 1) G.sound.playAll('npcHit', { x: n.x, y: 1, z: n.z }, 0.6);
      }
    } else n.blockN = 0;
  }
  if (B === 'stare' && (n.state === 'browse' || n.state === 'idle') && n.behCD < 0) { // the old man who stares too long
    const np = nearestPlayer(n, 7);
    if (np) { n.behCD = rand(25, 40); setState(n, 'stare', rand(5, 8)); n.stareAt = np.p.id; n.saidHm = false; npcSay(n, '...'); }
  }
  if (n.state === 'stare') {
    const p = G.players.get(n.stareAt); if (p) faceTo(n, p.head.p.x, p.head.p.z);
    if (n.timer < 0.3 && !n.saidHm) { n.saidHm = true; npcSay(n, pick(['Hm.', '...Nice shoes.', 'I knew your grandfather.', '...Carry on.'])); }
  }
  if (B === 'photos' && (n.state === 'browse' || n.state === 'walk') && n.behCD < 0) { // tourist photographing the "locals"
    const np = nearestPlayer(n, 6);
    if (np) {
      n.behCD = rand(15, 25); setState(n, 'selfie', 2.2); faceTo(n, np.p.head.p.x, np.p.head.p.z); npcSay(n, line(n, 'near'));
      setTimeout(() => { if (G.npcs.has(n.id)) { G.net.broadcast({ t: 'flash', id: n.id }); showFlash(n); } }, 900);
    }
  }
  if (B === 'trainee' && n.behCD < 0 && n.state === 'walk') { // drops merchandise constantly
    n.behCD = rand(25, 45);
    const type = pick(['cereal', 'soda', 'tp', 'chips', 'banana', 'milk']);
    G.game.spawn(type, [n.x, 1.0, n.z]);
    npcSay(n, pick(['Oops!', 'That\'s fine. That\'s fine.', 'Nobody saw that.', 'My manager is going to kill me.']));
  }
  if (B === 'lost' && n.behCD < 0 && n.state === 'walk' && Math.random() < 0.3) { // walks the wrong way, spins around
    n.behCD = rand(12, 20); setState(n, 'confused', 2.5); npcSay(n, line(n, 'idle'));
  }
  if (B === 'investigate') guardAI(n, dt);
}

function guardAI(n, dt) {
  // chase recent troublemakers
  if (n.state !== 'chase' && n.behCD < 0) {
    for (const [pid, t] of Object.entries(bonkTimes)) {
      const p = G.players.get(pid);
      if (p && G.time - t < 6 && Math.hypot(p.head.p.x - n.x, p.head.p.z - n.z) < 14) {
        n.behCD = 25; delete bonkTimes[pid];
        setState(n, 'chase', 7); n.chase = pid; n.busy = true;
        npcSay(n, pick(['HEY! STOP RIGHT THERE!', 'FREEZE! MALL POLICE!', 'You\'re coming with me, buddy!']));
        G.sound.playAll('guardWhistle', { x: n.x, y: 1.6, z: n.z });
        return;
      }
    }
    // shoplifters
    const thief = [...G.npcs.values()].find((t) => t.thief && !t.caught);
    if (thief && Math.hypot(thief.x - n.x, thief.z - n.z) < 15) { setState(n, 'chase', 10); n.chase = 'npc:' + thief.id; n.busy = true; npcSay(n, 'STOP, THIEF!'); n.behCD = 20; return; }
    // investigate incidents
    const inc = incidents.find((i) => G.time - i.t < 20 && Math.hypot(i.x - n.x, i.z - n.z) < 25);
    if (inc && (n.state === 'idle' || n.state === 'browse' || n.state === 'walk')) {
      incidents.splice(incidents.indexOf(inc), 1); n.behCD = 12;
      npcSay(n, pick(['What\'s going on over there?', 'I\'m on it!', 'Code red! ...Or yellow.']));
      npcGoTo(n, inc.x + rand(-1, 1), inc.z + rand(-1, 1), (k) => {
        setState(k, 'investigate', 4);
        npcSay(k, pick(['Hmm... suspicious.', 'I\'m writing this down.', 'Nobody touch anything!', 'This is a crime scene now.']));
      });
    }
  }
  if (n.state === 'chase') {
    let tx, tz;
    if (String(n.chase).startsWith('npc:')) {
      const t = G.npcs.get(n.chase.slice(4)); if (!t) { endChase(n, 'Got away... AGAIN.'); return; }
      tx = t.x; tz = t.z;
      if (Math.hypot(tx - n.x, tz - n.z) < 1) { G.game.catchThief(t, null); endChase(n, 'GOTCHA!'); return; }
    } else {
      const p = G.players.get(n.chase); if (!p) { endChase(n, 'Hmph.'); return; }
      tx = p.head.p.x; tz = p.head.p.z;
      if (Math.hypot(tx - n.x, tz - n.z) < 1.1) { endChase(n, pick(['You\'re under... a warning. Carry on.', 'Consider yourself WARNED.', 'I\'m watching you.'])); return; }
    }
    const dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz), sp = 2.3 * dt;
    n.x += dx / d * Math.min(sp, d); n.z += dz / d * Math.min(sp, d); faceTo(n, tx, tz); n.speed = 2.3;
    if (n.timer <= 0) endChase(n, pick(['*wheeze* ...I\'ll let you off... this time.', 'I need... a pretzel...', 'Cardio is not in my job description.']));
  }
}
function endChase(n, text) { n.busy = false; n.chase = null; setState(n, 'idle', 1.5); npcSay(n, text); }

export function updateNpcsHost(dt) {
  for (const npc of G.npcs.values()) {
    npc.timer -= dt; npc.sayCD -= dt; npc.nearCD -= dt; npc.confusedCD -= dt; npc.bumpCD -= dt;
    let speed = 0;
    switch (npc.state) {
      case 'idle': if (npc.timer <= 0 && !npc.busy) pickActivity(npc); break;
      case 'walk': case 'flee': {
        if (!npc.path.length) { setState(npc, 'idle', 0.5); const cb = npc.onArrive; npc.onArrive = null; cb && cb(npc); break; }
        const [tx, tz] = npc.path[0];
        const dx = tx - npc.x, dz = tz - npc.z, d = Math.hypot(dx, dz);
        const sp = (npc.state === 'flee' ? 3.2 : 1.25) * npc.P.speed * (G.events.stampede ? 2.2 : 1);
        if (d < 0.2) npc.path.shift();
        else { const st = Math.min(d, sp * dt); npc.x += dx / d * st; npc.z += dz / d * st; npc.rotTarget = Math.atan2(-dx, -dz) + (npc.P.behavior === 'weird' ? Math.PI : 0); speed = sp; }
        break;
      }
      case 'browse': case 'react': case 'selfie': case 'confused': case 'dance': case 'stare': case 'dramatic': case 'investigate': case 'blocked': case 'stumble':
        if (npc.timer <= 0) {
          const wasBlocked = npc.state === 'blocked', wasStumble = npc.state === 'stumble';
          setState(npc, 'idle', rand(0.3, 1.2));
          if (npc.task && (npc.busy || wasBlocked || (wasStumble && npc.resume))) npcGoTo(npc, npc.task.x, npc.task.z, npc.task.then, npc.task.run);
        } else if (npc.state === 'browse' && npc.sayCD < 0 && Math.random() < 0.01) { npc.sayCD = rand(10, 25); npcSay(npc, line(npc, 'idle')); }
        break;
      case 'wait': case 'chase': case 'follow': case 'sleep': break;
      case 'fallen': // ragdolls end themselves; this is only a safety net
        if (!npc.rag && npc.timer <= 0) setState(npc, 'idle', 0.5);
        break;
    }
    if (npc.rotTarget !== undefined && npc.state !== 'fallen') {
      let dr = npc.rotTarget - npc.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      npc.rot += dr * Math.min(1, dt * 8);
    }
    npc.speed = speed;
    behave(npc, dt);

    if (npc.state !== 'fallen') {
      // (punches/slaps are detected on the attacker's headset now: see combat.js)
      for (const p of G.players.values()) {
        if (!sameFloor(p, npc) || p.ko) continue;
        const hd = Math.hypot(p.head.p.x - npc.x, p.head.p.z - npc.z);
        if (hd < 1.4 && npc.nearCD < 0 && (npc.state === 'browse' || npc.state === 'walk' || npc.state === 'idle') && !npc.busy && npc.P.behavior !== 'cart') {
          npc.nearCD = rand(12, 20); setState(npc, 'react', 2); faceTo(npc, p.head.p.x, p.head.p.z);
          npcSay(npc, line(npc, 'near'));
        }
        if (npc.thief && hd < 0.6) G.game && G.game.catchThief(npc, p.id); // tag the thief just by touching them
      }
      // confused by junk on the floor
      if (npc.confusedCD < 0 && npc.state === 'walk' && !npc.busy) {
        npc.confusedCD = 3;
        for (const o of G.objects.values()) {
          if (['cart', 'chair', 'cone', 'wetsign', 'door', 'ball', 'block', 'duck', 'bball', 'mop', 'extinguisher', 'hose', 'peel', 'apple', 'basket'].includes(o.type)) continue;
          const op = o.mesh.position;
          if (op.y < npc.fy + 0.35 && op.y > npc.fy - 0.3 && Math.hypot(op.x - npc.x, op.z - npc.z) < 1.5 && Math.random() < 0.5) {
            setState(npc, 'confused', 2.5); npc.confusedCD = rand(15, 30);
            faceTo(npc, op.x, op.z);
            npcSay(npc, line(npc, 'confused', o.def.label.toLowerCase()));
            break;
          }
        }
      }
    }
    const b = npc.body;
    if (npc.rag) { b.position.set(npc.x, -20, npc.z); b.aabbNeedsUpdate = true; npc.code = 1; continue; } // ragdoll replaces the body
    b.velocity.set((npc.x - b.position.x) / Math.max(dt, 1e-3), 0, (npc.z - b.position.z) / Math.max(dt, 1e-3));
    b.position.set(npc.x, npc.fy + 0.85 * npc.scale, npc.z);
    b.quaternion.setFromEuler(0, npc.rot, 0);
    b.aabbNeedsUpdate = true;
    npc.code = STATE_CODE[npc.state] || 0;
  }
  // NPCs bumping into each other
  const list = [...G.npcs.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], c = list[j];
    if (a.state !== 'walk' || c.state !== 'walk' || a.bumpCD > 0 || c.bumpCD > 0 || a.busy || c.busy || a.fy !== c.fy) continue;
    if (Math.hypot(a.x - c.x, a.z - c.z) < 0.55) {
      a.bumpCD = c.bumpCD = rand(12, 20);
      setState(a, 'blocked', 1.8); setState(c, 'react', 1.8);
      faceTo(a, c.x, c.z); faceTo(c, a.x, a.z);
      npcSay(a, pick(['Watch it!', 'Excuse me?!', 'Do you MIND?', 'Ow, my shoulder!']));
      setTimeout(() => { if (G.npcs.has(c.id)) npcSay(c, pick(['YOU watch it!', 'You bumped ME!', 'Rude!', 'Sorry! ...Not sorry.'])); }, 900);
      G.sound.playAll('npcBump', { x: (a.x + c.x) / 2, y: 1.3, z: (a.z + c.z) / 2 });
      if (Math.random() < 0.4) setTimeout(() => G.npcs.has(c.id) && stumbleNpc(c, 'WHOA-'), 300);
    }
  }
}

// ---------- visuals (all peers) ----------
const _camP = new THREE.Vector3(), _rq = new THREE.Quaternion(), _off = new THREE.Vector3();
export function updateNpcVisuals(dt) {
  const k = damp(dt, 12);
  G.camera.getWorldPosition(_camP);
  for (const n of G.npcs.values()) {
    if (!G.isHost) {
      n.x += (n.tx - n.x) * k || 0; n.z += (n.tz - n.z) * k || 0;
      let dr = (n.trot ?? n.rot) - n.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); n.rot += dr * k;
    }
    const sp = Math.hypot(n.x - n.lastX, n.z - n.lastZ) / Math.max(dt, 1e-3);
    n.lastX = n.x; n.lastZ = n.z;
    const av = n.avatar;
    // crowd LOD: don't draw shoppers that are far away or on another floor out of sight
    const dist = Math.hypot(n.x - _camP.x, n.z - _camP.z), dy = Math.abs(_camP.y - 1.5 - n.fy);
    const visible = dist < 38 && (dy < 3 || dist < 22);
    const rd = ragFor('npc', n.id);
    av.root.visible = visible && !(rd && rd.kind === 'blocky');
    if (n.bubble) n.bubble.visible = visible;
    if (!visible) { if (n.bubble) { n.bubbleT -= dt; if (n.bubbleT <= 0) { G.scene.remove(n.bubble); n.bubble.material.map.dispose(); n.bubble = null; } } continue; }
    if (rd && rd.kind === 'model') { // the skinned model rides its tumbling physics body
      const p = rd.parts[0];
      const m = p.mesh ? p.mesh : null;
      const pos = m ? m.position : p.tp, q = m ? m.quaternion : p.tq;
      _off.set(0, -0.85 * n.scale, 0).applyQuaternion(q);
      av.root.position.set(pos.x + _off.x, pos.y + _off.y, pos.z + _off.z);
      av.root.quaternion.copy(q);
      av.animate(dt, 0); av.pose(2, G.time, dt); av.body.rotation.x = 0;
      if (n.bubble) { n.bubbleT -= dt; n.bubble.position.set(pos.x, pos.y + 1.2, pos.z); if (n.bubbleT <= 0) { G.scene.remove(n.bubble); n.bubble.material.map.dispose(); n.bubble = null; } }
      n.wasRag = true;
      continue;
    }
    if (n.wasRag) { av.root.quaternion.identity(); n.wasRag = false; }
    av.root.position.set(n.x, n.fy, n.z);
    av.root.rotation.set(0, n.rot, 0);
    const fallen = n.code === 1 && !rd;
    n.fallT += ((fallen ? 1 : 0) - n.fallT) * Math.min(1, dt * 7);
    const hunch = n.P.hunch || 0;
    if (!fallen) av.animate(dt, n.code === 0 ? Math.min(sp, 4) : 0);
    if (n.code > 1) av.pose(n.code, G.time, dt);
    av.body.rotation.x = -n.fallT * Math.PI / 2 * 0.95 - hunch * (1 - n.fallT);
    av.body.position.z = n.fallT * 0.2;
    if (!av.isModel) {
      const face = fallen ? 'dizzy' : (n.code === 2 || n.code === 5 || n.code === 8) ? 'shock' : (n.code === 9 || n.pers === 'karen' || n.pers === 'angry') ? 'angry' : n.code === 7 ? 'cool' : 'happy';
      if (av.curFace !== face) { av.setFace(face); av.curFace = face; }
    }
    if (n.thief && !n.mask) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.4), new THREE.MeshLambertMaterial({ color: 0x111111 }));
      if (av.isModel) { m.position.set(0, 1.62 * n.scale, 0); av.body.add(m); } else { m.position.y = 0.04; av.head.add(m); }
      n.mask = m;
    }
    if (n.bubble) {
      n.bubbleT -= dt;
      n.bubble.position.set(n.x, n.fy + 2.25 * n.scale + 0.15, n.z);
      if (n.bubbleT <= 0) { G.scene.remove(n.bubble); n.bubble.material.map.dispose(); n.bubble = null; }
    }
    if (n.flash && n.flash.visible) {
      n.flashT -= dt; n.flash.material.opacity = Math.max(0, n.flashT * 4);
      n.flash.position.set(n.x - Math.sin(n.rot) * 0.4, n.fy + 1.55 * n.scale, n.z - Math.cos(n.rot) * 0.4);
      if (n.flashT <= 0) n.flash.visible = false;
    }
  }
}

// swap every NPC between GLB models and blocky avatars (settings: NPC models FULL / LITE)
export function rebuildNpcAvatars() {
  for (const n of G.npcs.values()) {
    G.scene.remove(n.avatar.root);
    let av = null;
    if (n.model && Save.data.settings.npcModels !== false && A.models[n.model]) av = makeModelAvatar(n.model, n.scale);
    if (!av) av = makeAvatar(n.look, { legs: true, scale: n.scale });
    if (n.P.behavior === 'cart') { const c = buildObjectMesh('cart'); c.position.set(0, 0, -0.72); av.root.add(c); }
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.position.y = 0.02; av.root.add(shadow);
    G.scene.add(av.root); n.avatar = av; n.mask = null;
  }
}

export function initNpcsHost() {
  for (const [pers, floor, area, flag] of NPC_ROSTER) spawnNpc(pers, undefined, undefined, { floor, area, nomodel: flag === 'nomodel' });
}
