// Multiplayer over WebRTC (PeerJS). Host-authoritative star topology, up to 8 players.
// Voice chat: optional mesh of PeerJS media calls.
import * as THREE from 'three';
import { G } from './state.js';
import { Save } from './save.js';
import { createObject, removeObject, clearObjects, serializeObj, spawnInitialObjects, setObjColor } from './objects.js';
import { createNpcVisual, removeNpc, clearNpcs, initNpcsHost, npcData, showBubble } from './npc.js';
import { makePlayerState, removePlayer, clearRemotePlayers, setPlayerLook } from './players.js';
import { Game, applyEvent, announce, addMarkerVisual, removeMarkerVisual, updateMarkerVisual, clearMarkers, setOrderBoard, applyAward, resetHost, hostSnapshotExtras } from './game.js';
import { setGate, setButtonLit } from './world.js';
import { forceDrop } from './player.js';
import { sfx } from './audio.js';
import { addFireVisual, removeFireVisual, clearFires, showBabyAsh } from './fire.js';
import { smokePuff, confetti } from './particles.js';
import { showFlash } from './npc.js';
import { clientAddRag, clientDetach, applyRagSnap, endRagdoll, clearRagdolls, ragSnapshot, serializeRag, ragdolls } from './ragdoll.js';
import { hostHit, clientAddProj, clientEndProj, clientProjBounce, clearProjectiles } from './combat.js';
import { setElevator, setSecretDoor, L2Y } from './world.js';
import { toast, r3 } from './util.js';

const PREFIX = 'mallmayhem-v1-';
const MAX = 8;
const SEND_HZ = 20;

let peer = null, hostConn = null;
const conns = new Map();       // host: playerId -> DataConnection
let nextPid = 1, sendT = 0, fullT = 0, localStream = null;

const N = {
  lobby: null, isPublic: false, status: 'Offline',
  // ---------- generic API used by gameplay code ----------
  broadcast(msg) { if (!G.isHost || !conns.size) return; for (const c of conns.values()) if (c.open) c.send(msg); },
  broadcastExcept(pid, msg) { if (!G.isHost || !conns.size) return; for (const [id, c] of conns) if (id !== pid && c.open) c.send(msg); },
  sendHit(msg) { send({ ...msg, tt: msg.t, t: 'hit' }); },
  sendTo(pid, msg) { const c = conns.get(pid); if (c && c.open) c.send(msg); },
  requestGrab(id, h, op, oq) {
    if (G.isHost) hostGrab(G.myId, id, h, op, oq);
    else send({ t: 'grab', id, h, op: op.toArray(), oq: oq.toArray() });
  },
  requestRelease(id, h, vel) {
    if (G.isHost) hostRelease(G.myId, id, h, vel);
    else send({ t: 'rel', id, h, v: vel.toArray() });
  },
  sendAction(msg) { if (G.isHost) handleAction(G.myId, msg); else send({ t: 'act', ...msg }); },
  players() { return [...G.players.values()].map((p) => p.name); },
};
G.net = N;
export const Net = N;
function send(msg) { if (hostConn && hostConn.open) hostConn.send(msg); }

// ---------- local player state ----------
export function makeLocalPlayer(id) {
  G.myId = id;
  const me = makePlayerState(id, Save.data.name, { ...Save.data.look }, true);
  me.areas = [...Save.data.areas];
  G.me = me;
  if (!G.isHost) G.players.delete(id); // clients only keep remote players in the map
  return me;
}

// ---------- offline / host world ----------
export function startOfflineWorld() {
  for (const e of Object.keys(G.events)) applyEvent(e, false, true);
  G.isHost = true; G.online = false;
  clearRagdolls(); clearProjectiles();
  clearFires(); clearObjects(); clearNpcs(); clearMarkers(); clearRemotePlayers();
  for (const id of [...G.players.keys()]) removePlayer(id);
  makeLocalPlayer('h');
  resetHost();
  spawnInitialObjects();
  initNpcsHost();
  G.localHeld.clear();
  setOrderBoard(null);
  N.status = 'Offline'; N.lobby = null;
}

function cleanupPeer() {
  for (const c of conns.values()) try { c.close(); } catch (e) {}
  conns.clear();
  if (hostConn) try { hostConn.close(); } catch (e) {}
  hostConn = null;
  if (peer) try { peer.destroy(); } catch (e) {}
  peer = null;
}

function randomCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

// ---------- HOST ----------
export function hostLobby(code, isPublic) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') return reject(new Error('Networking library failed to load'));
    cleanupPeer();
    if (!G.isHost) startOfflineWorld();
    code = code || randomCode();
    N.status = 'Opening lobby...';
    peer = new Peer(PREFIX + code);
    let settled = false;
    peer.on('open', () => {
      settled = true; G.online = true; N.lobby = code; N.isPublic = isPublic;
      N.status = (isPublic ? 'Public lobby ' : 'Private lobby ') + code;
      resolve(code);
    });
    peer.on('error', (err) => {
      if (!settled) { settled = true; cleanupPeer(); reject(err); }
      else console.warn('peer error', err);
    });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (G.players.size >= MAX) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
        conn.on('data', (m) => onHostData(conn, m));
      });
      conn.on('close', () => {
        if (conn.pid) {
          const p = G.players.get(conn.pid);
          Game.playerLeft(conn.pid);
          removePlayer(conn.pid); conns.delete(conn.pid);
          N.broadcast({ t: 'pleave', id: conn.pid });
          if (p) toast(`${p.name} left the mall`);
        }
      });
    });
    peer.on('call', answerCall);
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  });
}

function onHostData(conn, m) {
  const pid = conn.pid;
  switch (m.t) {
    case 'hello': {
      const id = 'p' + nextPid++;
      conn.pid = id; conns.set(id, conn);
      const p = makePlayerState(id, String(m.name || 'Shopper').slice(0, 18), sanitizeLook(m.look), false);
      p.areas = Array.isArray(m.areas) ? m.areas : []; p.peer = conn.peer;
      // WebRTC data channels silently drop big messages, so the world snapshot goes out in chunks
      conn.send({
        t: 'welcome', you: id,
        npcs: [...G.npcs.values()].map(npcData),
        markers: [...G.markers.values()],
        players: [...G.players.values()].filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name, look: x.look, peer: x.isLocal ? peer.id : x.peer })),
        extras: hostSnapshotExtras(),
      });
      const all = [...G.objects.values()].map(serializeObj);
      for (let i = 0; i < all.length; i += 25) conn.send({ t: 'wobj', objs: all.slice(i, i + 25) });
      for (const rd of ragdolls.values()) conn.send({ t: 'rag', r: serializeRag(rd) });
      conn.send({ t: 'wready' });
      for (const [oid, c] of conns) if (oid !== id && c.open) c.send({ t: 'pjoin', id, name: p.name, look: p.look, peer: conn.peer });
      toast(`${p.name} joined the mall!`); sfx('chime');
      break;
    }
    case 'pose': { const p = G.players.get(pid); if (p) applyPose(p, m); break; }
    case 'grab': hostGrab(pid, m.id, m.h, new THREE.Vector3().fromArray(m.op), new THREE.Quaternion().fromArray(m.oq)); break;
    case 'rel': hostRelease(pid, m.id, m.h, new THREE.Vector3().fromArray(m.v)); break;
    case 'act': handleAction(pid, m); break;
    case 'hit': hostHit(pid, { t: m.tt, id: m.id, zone: m.zone, d: m.d, s: Math.min(1, +m.s || 0), k: m.k, p: m.p }); break;
  }
}
function sanitizeLook(l) { l = l || {}; return { skin: +l.skin || 0, shirt: +l.shirt || 0, pants: +l.pants || 0, hat: String(l.hat || 'none'), acc: String(l.acc || 'none') }; }
function applyPose(p, m) {
  p.head.p.set(m.h[0], m.h[1], m.h[2]); p.head.q.set(m.h[3], m.h[4], m.h[5], m.h[6]);
  [m.l, m.r].forEach((a, i) => {
    const h = p.hands[i];
    h.active = !!a;
    if (a) { h.p.set(a[0], a[1], a[2]); h.q.set(a[3], a[4], a[5], a[6]); }
  });
  if (m.f) { p.hands[0].fist = m.f[0] === 1; p.hands[1].fist = m.f[1] === 1; p.hands[0].closed = m.f[0] > 0; p.hands[1].closed = m.f[1] > 0; }
}

function hostGrab(pid, id, h, op, oq) {
  const p = G.players.get(pid), o = G.objects.get(id);
  if (!p || !o) { if (pid !== G.myId) N.sendTo(pid, { t: 'drop', id }); else forceDrop(id); return; }
  if (o.holder && (o.holder.pid !== pid || o.holder.h !== h)) { // steal from someone else / swap hands
    const prev = G.players.get(o.holder.pid);
    if (prev) prev.hands[o.holder.h].held = null;
    if (o.holder.pid !== pid) { if (o.holder.pid === G.myId) forceDrop(id); else N.sendTo(o.holder.pid, { t: 'drop', id }); }
  }
  const hand = p.hands[h];
  hand.held = id; hand.offPos.copy(op); hand.offQuat.copy(oq);
  o.holder = { pid, h }; o.lastHolder = pid;
}
function hostRelease(pid, id, h, vel) {
  const p = G.players.get(pid), o = G.objects.get(id);
  if (p && p.hands[h].held === id) p.hands[h].held = null;
  if (!o || !o.holder || o.holder.pid !== pid) return;
  o.holder = null;
  if (o.body) {
    const grip = o.def.grip ?? 1;
    if (grip >= 0.6) o.body.velocity.set(vel.x, vel.y, vel.z);   // light things fly at hand speed
    o.body.wakeUp();
  }
}

function handleAction(pid, m) {
  switch (m.a) {
    case 'btn': Game.onButton(m.id, pid); if (pid !== G.myId) N.broadcast({ t: 'press', id: m.id }); break;
    case 'use': Game.onUse(m.id, pid); break;
    case 'job': Game.takeJob(pid, m.job); break;
    case 'gear': Game.giveGear(pid, m.id); break;
    case 'spray': Game.onSpray(m.id, !!m.on, pid); break;
    case 'fire': Game.fire(pid, m.id); break;
    case 'ko': Game.playerKO(pid, m); break;
    case 'respawn': Game.playerRespawn(pid); break;
    case 'look': {
      const p = G.players.get(pid); if (!p) return;
      p.areas = Array.isArray(m.areas) ? m.areas : p.areas;
      if (pid !== G.myId) setPlayerLook(p, sanitizeLook(m.look), String(m.name || p.name).slice(0, 18));
      else { p.look = m.look; p.name = m.name; }
      N.broadcast({ t: 'plook', id: pid, name: p.name, look: p.look });
      break;
    }
  }
}

// ---------- CLIENT ----------
export function joinLobby(code) {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') return reject(new Error('Networking library failed to load'));
    cleanupPeer();
    N.status = 'Connecting...';
    peer = new Peer();
    let settled = false;
    const fail = (e) => { if (settled) return; settled = true; cleanupPeer(); N.status = 'Offline'; reject(e); };
    const timer = setTimeout(() => fail(Object.assign(new Error('Timed out'), { type: 'timeout' })), 12000);
    peer.on('error', (err) => { if (!settled) { clearTimeout(timer); fail(err); } else console.warn(err); });
    peer.on('call', answerCall);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', () => {
        hostConn = conn;
        conn.send({ t: 'hello', name: Save.data.name, look: Save.data.look, areas: Save.data.areas });
      });
      conn.on('data', (m) => {
        if (m.t === 'full') { clearTimeout(timer); fail(Object.assign(new Error('Lobby is full'), { type: 'full' })); return; }
        if (m.t === 'welcome') { applyWelcome(m, code); return; }
        if (m.t === 'wobj') { for (const o of m.objs) if (!G.objects.has(o.id)) createObject(o.type, o.id, o.p, o.q, { ...(o.opts || {}), color: o.c || (o.opts && o.opts.color) }); return; }
        if (m.t === 'wready') { clearTimeout(timer); settled = true; N.status = 'In lobby ' + code; if (Save.data.settings.voice) startVoice(); resolve(code); return; }
        onClientData(m);
      });
      conn.on('close', () => {
        if (!settled) { clearTimeout(timer); fail(new Error('Connection closed')); return; }
        if (hostConn === conn) { toast('Host left the mall. Back to solo play.', 3500); hostConn = null; cleanupPeer(); startOfflineWorld(); G.menus && G.menus.onNetChange(); }
      });
    });
  });
}

function applyWelcome(m, code) {
  for (const e of Object.keys(G.events)) applyEvent(e, false, true);
  G.isHost = false; G.online = true; N.lobby = code;
  clearRagdolls(); clearProjectiles();
  clearFires(); clearObjects(); clearNpcs(); clearMarkers();
  for (const id of [...G.players.keys()]) removePlayer(id);
  G.localHeld.clear();
  makeLocalPlayer(m.you);
  for (const n of m.npcs) { const v = createNpcVisual(n); v.tx = n.x; v.tz = n.z; v.thief = n.thief; }
  for (const mk of m.markers) addMarkerVisual(mk);
  for (const p of m.players) { const s = makePlayerState(p.id, p.name, p.look, false); s.peer = p.peer; }
  const x = m.extras || {};
  (x.events || []).forEach((e) => applyEvent(e, true, true));
  setGate(!!x.gate);
  if (x.order) setOrderBoard(x.order.items, x.order.rem); else setOrderBoard(null);
  (x.lit || []).forEach((id) => { const b = G.buttons.find((k) => k.id === id); b && setButtonLit(b, true); });
  (x.fires || []).forEach((f) => addFireVisual({ ...f }));
  (x.spraying || []).forEach((id) => G.spraying.add(id));
  if (x.elev) setElevator(x.elev.left > 0 ? x.elev.from : x.elev.to, x.elev.to, Math.max(0.01, x.elev.left));
  setSecretDoor(!!x.secret);
  N.status = 'Loading lobby ' + code + '...';
}

function onClientData(m) {
  switch (m.t) {
    case 'snap': applySnap(m); break;
    case 'spawn': if (!G.objects.has(m.o.id)) createObject(m.o.type, m.o.id, m.o.p, m.o.q, { ...(m.o.opts || {}), color: m.o.c }); break;
    case 'despawn': forceDrop(m.id); removeObject(m.id); break;
    case 'drop': forceDrop(m.id); break;
    case 'fx': sfx(m.s, { x: m.p[0], y: m.p[1], z: m.p[2] }, m.k); break;
    case 'say': { const n = G.npcs.get(m.id); if (n) showBubble(n, m.x); break; }
    case 'ann': announce(m.x); break;
    case 'toast': toast(m.x); break;
    case 'ev': applyEvent(m.name, m.on); break;
    case 'mk': addMarkerVisual(m.m); break;
    case 'mkDel': removeMarkerVisual(m.id); break;
    case 'mkUp': updateMarkerVisual(m.id, m.s); break;
    case 'ocol': { const o = G.objects.get(m.id); if (o) setObjColor(o, m.c); break; }
    case 'order': setOrderBoard(m.items, m.rem); break;
    case 'lit': { const b = G.buttons.find((k) => k.id === m.id); b && setButtonLit(b, m.on); break; }
    case 'gate': setGate(m.open); break;
    case 'award': applyAward(m); break;
    case 'job': G.jobInfo = { job: m.job, text: m.text }; G.menus && G.menus.refreshWrist(); break;
    case 'npcSpawn': if (!G.npcs.has(m.n.id)) { const v = createNpcVisual(m.n); v.tx = m.n.x; v.tz = m.n.z; v.thief = m.n.thief; } break;
    case 'npcDel': removeNpc(m.id); break;
    case 'pjoin': { const s = makePlayerState(m.id, m.name, m.look, false); s.peer = m.peer; toast(`${m.name} joined the mall!`); break; }
    case 'pleave': { const p = G.players.get(m.id); if (p) toast(`${p.name} left`); removePlayer(m.id); break; }
    case 'plook': { const p = G.players.get(m.id); if (p) setPlayerLook(p, m.look, m.name); break; }
    case 'press': break;
    case 'snd': G.sound.play(m.e, m.p ? { x: m.p[0], y: m.p[1], z: m.p[2] } : null, m.k ?? 1); break;
    case 'fire': if (!G.fires.has(m.f.id)) addFireVisual({ ...m.f }); break;
    case 'fireUp': { const f = G.fires.get(m.id); if (f) { f.s = m.s; if (!f.o) { f.x = m.x; f.y = m.y; f.z = m.z; } } break; }
    case 'fireDel': removeFireVisual(m.id); break;
    case 'puff': smokePuff({ x: m.p[0], y: m.p[1], z: m.p[2] }, 18, 0x616161); break;
    case 'babyash': showBabyAsh(); break;
    case 'spray': if (m.on) G.spraying.add(m.id); else G.spraying.delete(m.id); break;
    case 'flash': { const n = G.npcs.get(m.id); if (n) showFlash(n); break; }
    case 'confetti': confetti({ x: m.p[0], y: m.p[1], z: m.p[2] }, 30); break;
    case 'hurt': G.combat.onHurt(m); break;
    case 'hitfx': G.combat.hitFx(m); break;
    case 'rag': clientAddRag(m.r); break;
    case 'ragEnd': endRagdoll(m.id); break;
    case 'detach': clientDetach(m.id, m.i); break;
    case 'proj': clientAddProj(m); break;
    case 'projEnd': clientEndProj(m); break;
    case 'projB': clientProjBounce(m); break;
    case 'elev': setElevator(m.from, m.to, m.dur); G.sound.play('elevatorDing', { x: -4.8, y: m.from + 1.5, z: -4.8 }); break;
    case 'secret': setSecretDoor(m.open); break;
  }
}

function applySnap(m) {
  for (const a of m.o) {
    const o = G.objects.get(a[0]); if (!o) continue;
    o.tp.set(a[1], a[2], a[3]); o.tq.set(a[4], a[5], a[6], a[7]);
  }
  for (const a of m.n) { const n = G.npcs.get(a[0]); if (!n) continue; n.tx = a[1]; n.tz = a[2]; n.trot = a[3]; n.code = a[4]; }
  for (const a of m.p) {
    if (a[0] === G.myId) continue;
    const p = G.players.get(a[0]); if (!p) continue;
    applyPose(p, { h: a[1], l: a[2], r: a[3], f: a[4] });
    p.ko = !!a[5];
  }
  if (m.r) applyRagSnap(m.r);
}
const handFlag = (h) => (h.closed ? 2 : h.fist ? 1 : 0);

// ---------- per-frame send ----------
const q7 = (p, q) => [r3(p.x), r3(p.y), r3(p.z), +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)];
export function netUpdate(dt) {
  if (!G.online) return;
  sendT -= dt; if (sendT > 0) return;
  sendT = 1 / SEND_HZ;
  const me = G.me;
  if (!G.isHost) {
    send({ t: 'pose', h: q7(me.head.p, me.head.q), l: me.hands[0].active ? q7(me.hands[0].p, me.hands[0].q) : 0, r: me.hands[1].active ? q7(me.hands[1].p, me.hands[1].q) : 0, f: [handFlag(me.hands[0]), handFlag(me.hands[1])] });
    return;
  }
  if (!conns.size) return;
  fullT -= 1 / SEND_HZ;
  const full = fullT <= 0; if (full) fullT = 3;
  const o = [];
  for (const ob of G.objects.values()) {
    if (!ob.body) continue;
    if (full || ob.holder || ob.body.sleepState !== 2) { const p = ob.body.position, q = ob.body.quaternion; o.push([ob.id, r3(p.x), r3(p.y), r3(p.z), +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)]); }
  }
  const n = [...G.npcs.values()].map((k) => [k.id, r3(k.x), r3(k.z), +k.rot.toFixed(3), k.code]);
  const p = [...G.players.values()].map((k) => [k.id, q7(k.head.p, k.head.q), k.hands[0].active ? q7(k.hands[0].p, k.hands[0].q) : 0, k.hands[1].active ? q7(k.hands[1].p, k.hands[1].q) : 0,
    [k.hands[0].held || k.hands[0].closed ? 2 : k.hands[0].fist ? 1 : 0, k.hands[1].held || k.hands[1].closed ? 2 : k.hands[1].fist ? 1 : 0], k.ko ? 1 : 0]);
  const r = ragdolls.size ? ragSnapshot() : undefined;
  N.broadcast({ t: 'snap', o: o.slice(0, 60), n, p, r });
  for (let i = 60; i < o.length; i += 60) N.broadcast({ t: 'snap', o: o.slice(i, i + 60), n: [], p: [] });
}

// ---------- lobby helpers ----------
export async function quickJoinPublic(onStatus) {
  for (let i = 1; i <= 5; i++) {
    const code = 'PUB' + i;
    onStatus && onStatus(`Looking for public lobby ${i}...`);
    try { await joinLobby(code); return { joined: code }; }
    catch (e) {
      if (e.type === 'peer-unavailable') { // nobody there: become the host
        try { await hostLobby(code, true); return { hosting: code }; }
        catch (e2) { if (e2.type === 'unavailable-id') { try { await joinLobby(code); return { joined: code }; } catch (e3) { continue; } } throw e2; }
      }
      if (e.type === 'full') continue;
      throw e;
    }
  }
  throw new Error('All public lobbies are full');
}

export function leaveLobby() {
  const wasClient = !G.isHost;
  stopVoice();
  cleanupPeer();
  G.online = false; N.lobby = null; N.status = 'Offline';
  if (wasClient) startOfflineWorld();
}

// ---------- voice chat (optional) ----------
async function getMic() {
  if (localStream) return localStream;
  try { localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { toast('Microphone unavailable: voice is listen-only'); localStream = null; }
  return localStream;
}
function attachStream(peerId, stream) {
  const p = [...G.players.values()].find((x) => x.peer === peerId);
  const el = new Audio(); el.srcObject = stream; el.autoplay = true; el.play().catch(() => {});
  if (p) { if (p.voiceEl) p.voiceEl.pause(); p.voiceEl = el; }
}
async function answerCall(call) {
  const s = Save.data.settings.voice ? await getMic() : null;
  call.answer(s || undefined);
  call.on('stream', (st) => attachStream(call.peer, st));
}
export async function startVoice() {
  if (!peer || !G.online) return;
  const s = await getMic(); if (!s) return;
  for (const p of G.players.values()) if (!p.isLocal && p.peer) {
    const call = peer.call(p.peer, s);
    call && call.on('stream', (st) => attachStream(p.peer, st));
  }
}
export function stopVoice() {
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  for (const p of G.players.values()) if (p.voiceEl) { p.voiceEl.pause(); p.voiceEl = null; }
}
