// Main menu, multiplayer lobby UI, customization, settings, credits, wrist menu, job board, banners, mirror.
import * as THREE from 'three';
import { G } from './state.js';
import { Save } from './save.js';
import { Panel, PAL, keyboardScreen } from './ui.js';
import { HATS, ACCS, SKINS, COLORS, JOBS, UPGRADES, AREAS, ACHIEVEMENTS, NAME_A, NAME_B, GEAR } from './config.js';
import { rebuildNpcAvatars } from './npc.js';
import { makeAvatar } from './avatar.js';
import { L, teleportTo, refreshHandSkin } from './player.js';
import { hostLobby, joinLobby, quickJoinPublic, leaveLobby, startVoice, stopVoice, Net } from './net.js';
import { applyVolumes, sfx } from './audio.js';
import { Z } from './world.js';
import { pick, textTexture, toast } from './util.js';

export const Menus = {};
G.menus = Menus;

let menuRoot, main, mannequin, wrist, jobBoard, style, supply, watch, bannerSprite, bannerT = 0, mirrorAv;
let wristTab = 'status';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export function initMenus(scene) {
  menuRoot = new THREE.Group(); scene.add(menuRoot);
  main = new Panel(1.5, 1.1, { ppm: 700 }); menuRoot.add(main.mesh);
  mannequin = makeAvatar(Save.data.look, { legs: true, scale: 0.8 });
  mannequin.root.position.set(-1.05, -1.35, 0.35); mannequin.root.visible = false; menuRoot.add(mannequin.root);
  main.setScreen(mainScreen);
  Menus.main = main;

  wrist = new Panel(0.34, 0.26, { ppm: 2400 });
  wrist.mesh.visible = false;
  Menus.wrist = wrist;

  jobBoard = new Panel(2.0, 1.45, { ppm: 450 });
  jobBoard.mesh.position.set(...Z.jobBoard); scene.add(jobBoard.mesh);
  jobBoard.setScreen((p) => { p.title('JOB BOARD', 70, PAL.yellow, 64); jobsList(p, 130, false); });

  // Employee Supply kiosk (equipment shop) next to the job board
  supply = new Panel(2.0, 1.45, { ppm: 450 });
  supply.mesh.position.set(...Z.supplyKiosk); scene.add(supply.mesh);
  supply.setScreen((p) => { p.title('EMPLOYEE SUPPLY', 55, PAL.yellow, 52); gearList(p, 95, false); });

  style = new Panel(1.5, 1.2, { ppm: 500 });
  style.mesh.position.set(...Z.styleStation); style.mesh.rotation.y = Math.PI; scene.add(style.mesh);
  style.setScreen(customizeScreen(false));

  mirrorAv = makeAvatar(Save.data.look, { legs: true }); mirrorAv.root.visible = false; scene.add(mirrorAv.root);
  mirrorAv.root.position.set(...Z.mannequin);

  // Mall Directory kiosks: fast travel around the giant mall
  for (const [x, y, z, ry] of Z.directories) {
    const d = new Panel(0.9, 1.1, { ppm: 650 });
    d.mesh.position.set(x, y, z); d.mesh.rotation.y = ry; scene.add(d.mesh);
    d.setScreen(directoryScreen);
  }

  // money watch on left hand (VR)
  watch = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.03), new THREE.MeshBasicMaterial({ transparent: true }));
  watch.position.set(-0.045, 0.02, 0.07); watch.rotation.y = -Math.PI / 2; // back of the left wrist (grip -X side)
  L.hands[0].grip.add(watch);
  refreshWatch();

  bannerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  bannerSprite.position.set(0, 0.32, -1.5); bannerSprite.scale.set(1.2, 0.15, 1); bannerSprite.visible = false; bannerSprite.renderOrder = 1000;
  G.camera.add(bannerSprite);

  Save.onChange(() => { refreshWatch(); Menus.refreshWrist(); if (main.visible()) main.refresh(); jobBoard.refresh(); supply.refresh(); updateHud(); });
  Save.onAchieve = (a) => { sfx('achieve'); Menus.banner('🏆 ' + a.name + (a.reward ? ' · Unlocked ' + a.reward : ''), '#ffd23f', 4); };
  updateHud();
}

let lastWatch = '';
function refreshWatch() {
  if (!watch) return;
  const hp = Math.ceil(G.combat ? G.combat.hp : 100);
  const txt = `$${Save.data.money}\n❤ ${hp}`;
  if (txt === lastWatch) return; lastWatch = txt;
  if (watch.material.map) watch.material.map.dispose();
  watch.material.map = textTexture(txt, { w: 256, h: 160, bg: '#1b1340', fg: hp < 35 ? '#ff5252' : '#3ddc84', font: 'bold 56px "Trebuchet MS", sans-serif', radius: 20 });
  watch.material.needsUpdate = true;
}
Menus.refreshWatch = refreshWatch;

// ---------- Mall Directory (fast travel) ----------
const DEST = [
  ['MEGA MART', -27, -11, 0, Math.PI], ['FOOD COURT', 27, -12, 0, Math.PI], ['ATRIUM', 0, 14, 0, 0], ['TOY TORNADO', -46, 12, 0, 0],
  ['DRIP DEPOT', -21, 12, 0, 0], ['COMFY KINGDOM', -14, 31, 0, Math.PI / 2], ['PIXEL PALACE', 19, 12, 0, 0], ['VOLT CITY', 45, 12, 0, 0],
  ['CINEMA', 45, 33, 0, 0], ['BATHROOMS', 52, -6, 0, Math.PI], ['PARKING', 70, 0, 0, -Math.PI / 2], ['OUTSIDE', 0, 46, 0, Math.PI],
  ['L2: BOUNCE ZONE', 15, 5.5, 5, 0], ['L2: BOOKS', -27, 5.5, 5, 0], ['L2: SKY CAFE', 0, -26, 5, Math.PI], ['L2: GARAGE ROOF', 70, -3, 5, -Math.PI / 2],
];
function directoryScreen(p) {
  p.title('MALL DIRECTORY', 60, PAL.yellow, 64);
  p.text('Tap a place to go there', 500, 115, { size: 30, align: 'center', color: PAL.dim });
  DEST.forEach(([name, x, z, y, yaw], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    p.button(name, 30 + col * 480, 150 + row * 115, 460, 100, () => {
      teleportTo(x, z, yaw, y); sfx('whoosh');
    }, { color: y ? PAL.blue : [PAL.green, PAL.pink, PAL.yellow, PAL.card][row % 4], fg: y || row % 4 === 3 ? '#fff' : PAL.bg, size: 34 });
  });
}

function updateHud() {
  const el = document.getElementById('hud');
  if (!G.desktop) { el.style.display = 'none'; return; }
  el.style.display = G.mode === 'play' ? 'block' : 'none';
  const job = G.jobInfo && G.jobInfo.job ? JOBS[G.jobInfo.job].name : 'None';
  el.innerHTML = `<b style="color:#3ddc84">$${Save.data.money}</b> · ❤ ${Math.ceil(G.combat ? G.combat.hp : 100)} · Job: ${job}<br><span style="opacity:.85">${(G.jobInfo && G.jobInfo.text) || 'Tab: wrist menu (jobs, shop, trophies)'}</span><br><span style="opacity:.6">${Net.status}</span>`;
}
Menus.updateHud = updateHud;

// ---------- placement ----------
function placeInFront(obj, dist = 1.6, dy = -0.1) {
  G.camera.getWorldPosition(_v); G.camera.getWorldQuaternion(_q);
  _e.setFromQuaternion(_q, 'YXZ');
  obj.position.set(_v.x - Math.sin(_e.y) * dist, _v.y + dy, _v.z - Math.cos(_e.y) * dist);
  obj.rotation.set(0, _e.y, 0);
}

Menus.openMain = (screen = mainScreen) => {
  G.mode = 'menu';
  menuRoot.visible = true; placeInFront(menuRoot);
  main.setScreen(screen);
  if (wrist.mesh.visible) Menus.toggleWrist(false);
  if (document.pointerLockElement) document.exitPointerLock();
  updateHud();
};
Menus.closeMain = () => {
  menuRoot.visible = false; mannequin.root.visible = false;
  G.mode = 'play';
  if (G.desktop && !G.vr) { const c = G.renderer.domElement; c.requestPointerLock && c.requestPointerLock(); }
  updateHud();
};
Menus.onNetChange = () => { if (menuRoot.visible) main.refresh(); Menus.refreshWrist(); updateHud(); };

// ---------- main screens ----------
function header(p, sub) {
  p.title('MALL MAYHEM', 85, PAL.yellow, 86);
  if (sub) p.text(sub, 500, 150, { size: 34, align: 'center', color: PAL.pink, bold: true });
}
function mainScreen(p) {
  mannequin.root.visible = false;
  header(p, `${Save.data.name} · $${Save.data.money} · ${Net.status}`);
  const bw = 520, x = 240; let y = 200;
  const playLabel = G.started ? 'RESUME' : 'PLAY';
  p.button(playLabel, x, y, bw, 92, () => { G.started = true; Menus.closeMain(); }, { color: PAL.green }); y += 112;
  p.button('MULTIPLAYER', x, y, bw, 82, () => p.setScreen(mpScreen), { color: PAL.blue, fg: '#fff' }); y += 100;
  p.button('CHARACTER', x, y, bw, 82, () => p.setScreen(customizeScreen(true)), { color: PAL.pink, fg: '#fff' }); y += 100;
  p.button('SETTINGS', x, y, bw, 82, () => p.setScreen(settingsScreen), { color: PAL.yellow }); y += 100;
  p.button('CREDITS', x, y, bw, 70, () => p.setScreen(creditsScreen), { color: PAL.card, fg: '#fff' });
}

let mpMsg = '';
function mpScreen(p) {
  mannequin.root.visible = false;
  header(p, 'MULTIPLAYER · up to 8 players');
  const x = 220, w = 560; let y = 190;
  if (G.online) {
    p.box(120, y, 760, 170, PAL.card);
    p.text(Net.isPublic || !G.isHost ? `Lobby: ${Net.lobby}` : `Private lobby code: ${Net.lobby}`, 500, y + 45, { size: 44, align: 'center', bold: true, color: PAL.yellow });
    const names = [Save.data.name, ...[...G.players.values()].filter((q) => !q.isLocal).map((q) => q.name)];
    p.text(`${names.length}/8: ${names.join(', ')}`, 500, y + 110, { size: 30, align: 'center', maxW: 700 });
    y += 200;
    p.button('PLAY', x, y, w, 80, () => { G.started = true; Menus.closeMain(); }, { color: PAL.green }); y += 100;
    p.button('VOICE CHAT: ' + (Save.data.settings.voice ? 'ON' : 'OFF'), x, y, w, 70, () => { toggleVoice(); p.refresh(); }, { color: PAL.blue, fg: '#fff' }); y += 90;
    p.button('LEAVE LOBBY', x, y, w, 70, () => { leaveLobby(); mpMsg = 'Left lobby.'; p.refresh(); updateHud(); }, { color: PAL.red, fg: '#fff' }); y += 90;
  } else {
    p.button('QUICK JOIN PUBLIC', x, y, w, 85, () => doNet(p, () => quickJoinPublic((s) => { mpMsg = s; p.refresh(); }).then((r) => r.joined ? `Joined public lobby ${r.joined}!` : `No one around, you're hosting public lobby ${r.hosting}. Friends can Quick Join.`)), { color: PAL.green }); y += 105;
    p.button('HOST PRIVATE LOBBY', x, y, w, 85, () => doNet(p, () => hostLobby(null, false).then((c) => `Hosting! Give friends code ${c}`)), { color: PAL.blue, fg: '#fff' }); y += 105;
    p.button('JOIN WITH CODE', x, y, w, 85, () => p.setScreen(keyboardScreen({ title: 'ENTER LOBBY CODE', maxLen: 4, letters: false,
      onDone: (code) => { p.setScreen(mpScreen); if (code.length === 4) doNet(p, () => joinLobby(code).then(() => `Joined lobby ${code}!`)); else { mpMsg = 'Codes are 4 letters.'; p.refresh(); } },
      onCancel: () => p.setScreen(mpScreen) })), { color: PAL.pink, fg: '#fff' }); y += 105;
  }
  if (mpMsg) p.text(mpMsg, 500, Math.max(y + 10, 650), { size: 30, align: 'center', color: PAL.dim, maxW: 880 });
  p.button('BACK', 40, 660, 180, 70, () => p.setScreen(mainScreen), { color: '#5a5280', fg: '#fff', size: 34 });
}
function niceError(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return 'No lobby with that code.';
  if (t === 'unavailable-id') return 'That lobby already exists, try joining it.';
  if (t === 'full') return 'That lobby is full (8/8).';
  if (t === 'timeout') return 'Connection timed out. Check your internet.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Could not reach the matchmaking server.';
  return 'Error: ' + (e && e.message || e);
}
function doNet(p, fn) {
  mpMsg = 'Connecting...'; p.refresh();
  fn().then((msg) => { mpMsg = msg; sfx('chime'); p.setScreen(mpScreen); updateHud(); Menus.refreshWrist(); })
    .catch((e) => { mpMsg = niceError(e); sfx('error'); p.setScreen(mpScreen); });
}
function toggleVoice() {
  Save.data.settings.voice = !Save.data.settings.voice; Save.changed();
  if (Save.data.settings.voice) startVoice(); else stopVoice();
}

// ---------- customization (used by main menu and the in-mall Style Station) ----------
function customizeScreen(fromMenu) {
  return (p) => {
    const look = Save.data.look;
    if (fromMenu) { mannequin.root.visible = true; mannequin.setLook(look); }
    p.title('CHARACTER', 60, PAL.yellow, 58);
    p.text(`$${Save.data.money}`, 960, 60, { size: 40, align: 'right', color: PAL.green, bold: true });
    // name
    p.text('Name:', 50, 135, { size: 34, bold: true });
    p.box(170, 105, 430, 60, '#0f0a2b'); p.text(Save.data.name, 385, 135, { size: 34, align: 'center' });
    p.button('EDIT', 615, 105, 150, 60, () => p.setScreen(keyboardScreen({ title: 'YOUR NAME', value: Save.data.name, maxLen: 16, upper: false,
      onDone: (v) => { if (v) { Save.data.name = v; Save.changed(); sendLook(); } p.setScreen(customizeScreen(fromMenu)); }, onCancel: () => p.setScreen(customizeScreen(fromMenu)) })), { size: 30 });
    p.button('RANDOM', 780, 105, 170, 60, () => { Save.data.name = pick(NAME_A) + ' ' + pick(NAME_B); Save.changed(); sendLook(); p.refresh(); }, { color: PAL.blue, fg: '#fff', size: 30 });
    const row = (label, y, colors, key) => {
      p.text(label, 50, y + 28, { size: 32, bold: true });
      colors.forEach((c, i) => p.swatch(c, 190 + i * 76, y, 62, () => { look[key] = i; Save.changed(); sendLook(); p.refresh(); }, look[key] === i));
    };
    row('Skin', 190, SKINS, 'skin');
    row('Shirt', 270, COLORS, 'shirt');
    row('Pants', 350, COLORS, 'pants');
    const picker = (label, y, list, key) => {
      const i = list.findIndex((h) => h.id === look[key]);
      const cur = list[Math.max(0, i)];
      p.text(label, 50, y + 32, { size: 32, bold: true });
      p.button('◀', 190, y, 80, 64, () => { const n = list[(Math.max(0, i) - 1 + list.length) % list.length]; previewItem(key, n); p.refresh(); }, { color: PAL.card, fg: '#fff' });
      p.box(285, y, 330, 64, '#0f0a2b'); p.text(cur.name, 450, y + 32, { size: 32, align: 'center' });
      p.button('▶', 630, y, 80, 64, () => { const n = list[(Math.max(0, i) + 1) % list.length]; previewItem(key, n); p.refresh(); }, { color: PAL.card, fg: '#fff' });
      if (!Save.hasItem(cur.id)) {
        if (cur.ach) p.text('Unlock: ' + ACHIEVEMENTS.find((a) => a.id === cur.ach).name, 730, y + 32, { size: 26, color: PAL.dim, maxW: 260 });
        else p.button(`BUY $${cur.price}`, 730, y, 220, 64, () => { if (Save.buyItem(cur.id)) { sfx('cash'); look[key] = cur.id; Save.changed(); sendLook(); } p.refresh(); }, { color: PAL.green, size: 30, disabled: Save.data.money < cur.price });
      } else p.text('✔ Owned', 740, y + 32, { size: 30, color: PAL.green, bold: true });
    };
    picker('Hat', 440, HATS, 'hat');
    picker('Extra', 525, ACCS, 'acc');
    p.text('Locked items preview but reset if not bought.', 500, 625, { size: 24, align: 'center', color: PAL.dim });
    if (fromMenu) p.button('DONE', 380, 665, 240, 64, () => { validateLook(); p.setScreen(mainScreen); }, { color: PAL.green, size: 34 });
    else p.button('SAVE LOOK', 380, 665, 240, 64, () => { validateLook(); p.refresh(); toast('Looking fresh!'); }, { color: PAL.green, size: 30 });
  };
}
function previewItem(key, item) {
  Save.data.look[key] = item.id; // preview; validateLook() reverts locked ones
  mannequin.setLook(Save.data.look); mirrorAv.setLook(Save.data.look);
  if (Save.hasItem(item.id)) { Save.changed(); sendLook(); }
}
function validateLook() {
  const l = Save.data.look;
  if (!Save.hasItem(l.hat)) l.hat = 'none';
  if (!Save.hasItem(l.acc)) l.acc = 'none';
  Save.changed(); sendLook();
}
function sendLook() {
  refreshHandSkin(); mirrorAv.setLook(Save.data.look); mannequin.setLook(Save.data.look);
  const look = { ...Save.data.look };
  if (!Save.hasItem(look.hat)) look.hat = 'none';
  if (!Save.hasItem(look.acc)) look.acc = 'none';
  if (G.me) { G.me.look = look; G.me.name = Save.data.name; G.me.areas = [...Save.data.areas]; }
  G.net.sendAction({ a: 'look', look, name: Save.data.name, areas: Save.data.areas });
}
Menus.sendLook = sendLook;

// ---------- settings ----------
let settingsPage = 0;
function settingsScreen(p) {
  mannequin.root.visible = false;
  const s = Save.data.settings;
  p.title('SETTINGS', 55, PAL.yellow, 54);
  const set = (k, v) => {
    const changedModels = k === 'npcModels' && s[k] !== v;
    s[k] = v; Save.changed(); applyVolumes(); p.refresh();
    if (changedModels) rebuildNpcAvatars();
  };
  ['COMFORT', 'AUDIO & GAME', 'COMBAT'].forEach((t, i) => p.button(t, 95 + i * 280, 92, 260, 56, () => { settingsPage = i; p.refresh(); }, { color: settingsPage === i ? PAL.yellow : PAL.card, fg: settingsPage === i ? PAL.bg : '#fff', size: 28 }));
  let y = 170;
  const opt = (label, key, values, names) => {
    p.text(label, 50, y + 30, { size: 30, bold: true });
    values.forEach((v, i) => p.button(names ? names[i] : String(v).toUpperCase(), 330 + i * 215, y, 200, 60, () => set(key, v), { color: s[key] === v ? PAL.green : PAL.card, fg: s[key] === v ? PAL.bg : '#fff', size: 26 }));
    y += 72;
  };
  const num = (label, key, step, min, max, fmt) => {
    p.text(label, 50, y + 30, { size: 30, bold: true });
    p.button('−', 330, y, 90, 60, () => set(key, Math.max(min, +(s[key] - step).toFixed(2))), { color: PAL.card, fg: '#fff' });
    p.box(430, y, 210, 60, '#0f0a2b'); p.text(fmt(s[key]), 535, y + 30, { size: 30, align: 'center' });
    p.button('+', 650, y, 90, 60, () => set(key, Math.min(max, +(s[key] + step).toFixed(2))), { color: PAL.card, fg: '#fff' });
    y += 72;
  };
  if (settingsPage === 0) {
    opt('Movement', 'move', ['smooth', 'teleport', 'both']);
    opt('Turning', 'turn', ['snap', 'smooth']);
    opt('Snap angle', 'snapAngle', [30, 45, 90], ['30°', '45°', '90°']);
    opt('Comfort vignette', 'vignette', [true, false], ['ON', 'OFF']);
    num('Height (seated)', 'height', 0.1, -0.3, 0.8, (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + 'm');
  } else if (settingsPage === 1) {
    num('Sound FX', 'sfx', 0.1, 0, 1, (v) => Math.round(v * 100) + '%');
    num('Ambience', 'music', 0.1, 0, 1, (v) => Math.round(v * 100) + '%');
    opt('Announcer voice', 'tts', [true, false], ['ON', 'OFF']);
    opt('Random events', 'events', [true, false], ['ON', 'OFF']);
    opt('NPC models', 'npcModels', [true, false], ['FULL', 'LITE']);
    p.text('LITE = blocky shoppers only (faster on Quest)', 500, y + 15, { size: 24, align: 'center', color: PAL.dim });
  } else {
    opt('PvP damage', 'pvp', [true, false], ['ON', 'OFF']);
    opt('Ragdoll parts pop off', 'detach', [true, false], ['ON', 'OFF']);
    opt('Ragdoll style', 'ragdollStyle', ['normal', 'extreme'], ['NORMAL', 'EXTREME']);
    p.text('PvP OFF = other players can still knock you around, but you take no damage.', 500, y + 15, { size: 24, align: 'center', color: PAL.dim, maxW: 900 });
    p.text('Ragdoll options are decided by the lobby host.', 500, y + 80, { size: 24, align: 'center', color: PAL.dim });
  }
  p.button('BACK', 40, 660, 180, 60, () => p.setScreen(mainScreen), { color: '#5a5280', fg: '#fff', size: 32 });
}

// ---------- equipment list (Employee Supply kiosk + wrist GEAR tab) ----------
function gearList(p, y0, compact) {
  const owned = Save.data.gear || [];
  // two columns so the whole catalog fits on the wrist and on the kiosk
  const rows = Math.ceil(GEAR.length / 2);
  const gap = 8, h = Math.min(compact ? 100 : 105, (p.H - y0 - 20) / rows - gap), w = 460;
  GEAR.forEach((g, i) => {
    const x = 30 + (i % 2) * (w + 20), y = y0 + Math.floor(i / 2) * (h + gap);
    const own = owned.includes(g.id);
    p.box(x, y, w, h, own ? '#245c3e' : PAL.card, 14);
    p.text(g.name + (own ? '' : ` $${g.price}`), x + 14, y + h * 0.3, { size: 26, bold: true, color: PAL.yellow });
    p.text(g.desc, x + 14, y + h * 0.7, { size: 18, color: '#ddd', maxW: w - 150 });
    if (own) p.button('GET', x + w - 120, y + 10, 108, h - 20, () => G.net.sendAction({ a: 'gear', id: g.id }), { color: PAL.blue, fg: '#fff', size: 28 });
    else p.button('BUY', x + w - 120, y + 10, 108, h - 20, () => {
      if (!Save.spend(g.price)) return;
      Save.data.gear = [...owned, g.id]; Save.changed();
      G.sound.play('purchase'); toast(`${g.name} unlocked! Press GET any time.`);
      G.net.sendAction({ a: 'gear', id: g.id });
    }, { color: PAL.green, size: compact ? 26 : 32, disabled: Save.data.money < g.price });
  });
}

function creditsScreen(p) {
  header(p, 'CREDITS');
  const lines = ['Game design & code: built with Claude for you', 'Engine: three.js (WebXR) · Physics: cannon-es', 'Multiplayer: PeerJS (WebRTC)', 'Music & sounds: generated live with Web Audio',
    'Shoppers harmed: technically none', 'Thanks for shopping at MALL MAYHEM!'];
  lines.forEach((l, i) => p.text(l, 500, 230 + i * 62, { size: 34, align: 'center' }));
  p.button('BACK', 410, 650, 180, 70, () => p.setScreen(mainScreen), { color: '#5a5280', fg: '#fff', size: 34 });
}

// ---------- jobs list (job board + wrist) ----------
function jobsList(p, y0, compact) {
  const cur = G.jobInfo && G.jobInfo.job;
  const h = compact ? 88 : 100;
  Object.entries(JOBS).forEach(([id, j], i) => {
    const y = y0 + i * (h + 12);
    p.box(40, y, 920, h, cur === id ? '#245c3e' : PAL.card);
    p.text(`${j.name}  ·  $${j.pay}+`, 70, y + (compact ? 30 : 32), { size: compact ? 36 : 40, bold: true, color: PAL.yellow });
    p.text(j.desc, 70, y + (compact ? 66 : 72), { size: compact ? 24 : 26, color: '#ddd' });
    p.button(cur === id ? 'QUIT' : 'TAKE', 760, y + 12, 180, h - 24, () => G.net.sendAction({ a: 'job', job: cur === id ? null : id }), { color: cur === id ? PAL.red : PAL.green, fg: cur === id ? '#fff' : PAL.bg, size: 34 });
  });
  const ty = y0 + 5 * (h + 12) + 10;
  if (G.jobInfo && G.jobInfo.text) p.text(G.jobInfo.text, 500, ty + 10, { size: compact ? 26 : 30, align: 'center', color: PAL.green, maxW: 900 });
}

// ---------- wrist menu ----------
Menus.toggleWrist = (force) => {
  const show = force !== undefined ? force : !wrist.mesh.visible;
  if (show && G.mode === 'menu') return;
  wrist.mesh.visible = show;
  if (show) {
    if (G.vr) { L.hands[0].grip.add(wrist.mesh); wrist.mesh.position.set(0, 0.1, 0.02); wrist.mesh.rotation.set(-0.8, 0, 0); wrist.mesh.scale.setScalar(1); }
    else { G.camera.add(wrist.mesh); wrist.mesh.position.set(0, -0.02, -0.42); wrist.mesh.rotation.set(0, 0, 0); }
    wrist.setScreen(wristScreen);
    sfx('pop');
  }
};
Menus.refreshWrist = () => { if (wrist && wrist.mesh.visible) wrist.refresh(); if (jobBoard) jobBoard.refresh(); updateHud(); };

function wristScreen(p) {
  const tabs = [['status', 'ME'], ['jobs', 'JOBS'], ['gear', 'GEAR'], ['shop', 'SHOP'], ['trophies', 'TROPHY'], ['menu', 'MENU']];
  tabs.forEach(([id, label], i) => p.button(label, 14 + i * 163, 20, 155, 76, () => { wristTab = id; p.refresh(); }, { color: wristTab === id ? PAL.yellow : PAL.card, fg: wristTab === id ? PAL.bg : '#fff', size: 28 }));
  if (wristTab === 'gear') gearList(p, 112, true);
  const y0 = 120;
  if (wristTab === 'status') {
    p.text(`$${Save.data.money}`, 40, y0 + 40, { size: 64, bold: true, color: PAL.green });
    p.text(Save.data.name, 960, y0 + 40, { size: 36, align: 'right', color: PAL.yellow });
    const job = G.jobInfo && G.jobInfo.job ? JOBS[G.jobInfo.job].name : 'No job';
    p.text(`Job: ${job}`, 40, y0 + 110, { size: 34, bold: true });
    if (G.jobInfo && G.jobInfo.text) p.text(G.jobInfo.text, 40, y0 + 155, { size: 28, color: '#ddd', maxW: 920 });
    p.text('DAILY CHALLENGES', 40, y0 + 270, { size: 32, bold: true, color: PAL.pink });
    Save.dailies().forEach((d, i) => {
      const done = Save.data.dailyDone.includes(d.id);
      const prog = Math.min(d.goal, Math.floor(Save.data.dayStats[d.stat] || 0));
      p.text(`${done ? '✔' : '•'} ${d.text}  ${prog}/${d.goal}  ($${d.reward})`, 40, y0 + 320 + i * 46, { size: 30, color: done ? PAL.green : '#fff' });
    });
    p.text(Net.status, 40, y0 + 470, { size: 26, color: PAL.dim });
  }
  if (wristTab === 'jobs') { p.ctx.save(); jobsList(p, y0, true); p.ctx.restore(); }
  if (wristTab === 'shop') {
    let y = y0;
    p.text('NEW AREAS', 40, y + 20, { size: 30, bold: true, color: PAL.pink }); y += 45;
    for (const a of AREAS) {
      const own = Save.data.areas.includes(a.id);
      p.text(`${a.name} — ${a.desc}`, 40, y + 30, { size: 28, maxW: 680 });
      if (own) p.text('✔ OPEN', 820, y + 30, { size: 30, color: PAL.green, bold: true });
      else p.button(`$${a.price}`, 760, y, 200, 60, () => { if (Save.spend(a.price)) { Save.data.areas.push(a.id); Save.changed(); sfx('cash'); sendLook(); toast(a.name + ' unlocked!'); } p.refresh(); }, { color: PAL.green, size: 30, disabled: Save.data.money < a.price });
      y += 75;
    }
    p.text('STORE UPGRADES', 40, y + 20, { size: 30, bold: true, color: PAL.pink }); y += 45;
    for (const u of UPGRADES) {
      const own = Save.data.upgrades.includes(u.id);
      p.text(`${u.name}: ${u.desc}`, 40, y + 28, { size: 27 });
      if (own) p.text('✔', 850, y + 28, { size: 34, color: PAL.green, bold: true });
      else p.button(`$${u.price}`, 760, y, 200, 56, () => { if (Save.spend(u.price)) { Save.data.upgrades.push(u.id); Save.changed(); sfx('cash'); } p.refresh(); }, { color: PAL.green, size: 28, disabled: Save.data.money < u.price });
      y += 66;
    }
  }
  if (wristTab === 'trophies') {
    ACHIEVEMENTS.forEach((a, i) => {
      const got = Save.data.achievements.includes(a.id);
      const x = i % 2 ? 510 : 30, y = y0 + Math.floor(i / 2) * 78;
      p.box(x, y, 460, 68, got ? '#245c3e' : PAL.card, 14);
      p.text((got ? '🏆 ' : '🔒 ') + a.name, x + 14, y + 22, { size: 26, bold: true, color: got ? PAL.yellow : '#bbb' });
      const prog = Math.min(a.goal, Math.floor(Save.data.stats[a.stat] || 0));
      p.text(`${a.desc} (${prog}/${a.goal})`, x + 14, y + 50, { size: 20, color: '#ccc' });
    });
  }
  if (wristTab === 'menu') {
    let y = y0 + 5;
    p.button('MAIN MENU', 40, y, 450, 80, () => Menus.openMain(), { color: PAL.yellow });
    p.button('MULTIPLAYER', 510, y, 450, 80, () => Menus.openMain(mpScreen), { color: PAL.blue, fg: '#fff' }); y += 95;
    p.button('RESPAWN', 40, y, 450, 80, () => { teleportTo(Z.spawn.x, Z.spawn.z, 0); Menus.toggleWrist(false); }, { color: PAL.pink, fg: '#fff' });
    if (G.online) p.button('LEAVE LOBBY', 510, y, 450, 80, () => { leaveLobby(); p.refresh(); updateHud(); }, { color: PAL.red, fg: '#fff' });
    y += 110;
    // quick volume controls
    const s = Save.data.settings;
    const vol = (label, key) => {
      p.text(label, 60, y + 38, { size: 34, bold: true });
      p.button('−', 380, y, 110, 76, () => { s[key] = Math.max(0, +(s[key] - 0.1).toFixed(2)); Save.changed(); applyVolumes(); }, { color: PAL.card, fg: '#fff' });
      p.box(505, y, 190, 76, '#0f0a2b'); p.text(Math.round(s[key] * 100) + '%', 600, y + 38, { size: 36, align: 'center', bold: true });
      p.button('+', 710, y, 110, 76, () => { s[key] = Math.min(1, +(s[key] + 0.1).toFixed(2)); Save.changed(); applyVolumes(); }, { color: PAL.card, fg: '#fff' });
      p.button(s[key] > 0 ? 'MUTE' : 'ON', 835, y, 130, 76, () => { s[key] = s[key] > 0 ? 0 : 0.6; Save.changed(); applyVolumes(); }, { color: s[key] > 0 ? PAL.red : PAL.green, fg: '#fff', size: 28 });
      y += 92;
    };
    vol('Sound FX', 'sfx');
    vol('Ambience', 'music');
  }
}

// ---------- banner ----------
Menus.banner = (text, color = '#ffffff', secs = 3.5) => {
  if (!bannerSprite) return;
  if (bannerSprite.material.map) bannerSprite.material.map.dispose();
  const long = text.length > 46;
  bannerSprite.material.map = textTexture(text, { w: 1600, h: long ? 280 : 200, bg: 'rgba(27,19,64,0.88)', fg: color, font: `bold ${long ? 54 : 72}px "Trebuchet MS", sans-serif`, radius: 50, border: color });
  if (long) { // wrap manually into 2 lines
    const mid = text.lastIndexOf(' ', Math.floor(text.length / 2) + 6);
    bannerSprite.material.map.dispose();
    bannerSprite.material.map = textTexture(text.slice(0, mid) + '\n' + text.slice(mid + 1), { w: 1600, h: 280, bg: 'rgba(27,19,64,0.88)', fg: color, font: 'bold 60px "Trebuchet MS", sans-serif', radius: 50, border: color });
  }
  bannerSprite.scale.set(1.2, long ? 0.21 : 0.15, 1);
  bannerSprite.material.needsUpdate = true; bannerSprite.visible = true; bannerT = secs;
};

// ---------- per frame ----------
export function updateMenus(dt) {
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) bannerSprite.visible = false; }
  if (mannequin.root.visible) mannequin.root.rotation.y += dt * 0.6;
  // style mannequin in Drip Depot shows your current outfit
  G.camera.getWorldPosition(_v);
  const near = _v.x > -8 && _v.x < 6 && _v.z > 7 && _v.z < 18;
  mirrorAv.root.visible = near;
  if (near) { mirrorAv.root.rotation.y += dt * 0.8; mirrorAv.animate(dt, 0); }
}
