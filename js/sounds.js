// =====================================================================
//  SOUND EVENT MANAGER
//  Edit SOUND_FILES to add audio files, then point any event in
//  SOUND_EVENTS at them. Each event can play a file, a built-in synth
//  sound, or both.
//
//  file:       key from SOUND_FILES (or an array of keys = random pick)
//  synth:      built-in generated sound name (see audio.js sfx())
//  vol:        0..1 loudness for this event
//  cooldown:   seconds before this event can play again (anti-spam)
//  positional: true = 3D sound that comes from where it happened
//  pitch:      [min, max] random playback rate, so repeats sound less samey
//  loop:       true = keeps playing until stopped (alarms, music)
// =====================================================================
import * as THREE from 'three';
import { G } from './state.js';
import { AC, onAudioReady, sfx } from './audio.js';

export const SOUND_FILES = {
  babyAsh: 'assets/sounds/baby_ash.mp3',   // luigi-burning.mp3
  siren: 'assets/sounds/siren.mp3',        // danger-siren-alarm.mp3
  slap: 'assets/sounds/slap.mp3',          // slap-soundmaster13.mp3
  // (Update 3: background music removed on request. Ambience below is generated, not music.)
};

export const SOUND_EVENTS = {
  // --- signature ---
  babyAsh:      { file: 'babyAsh', vol: 1.0, cooldown: 5, positional: false },
  // --- emergencies ---
  fireAlarm:    { file: 'siren', vol: 0.45, loop: true, positional: false },
  fireIgnite:   { synth: 'whoosh', vol: 0.9, cooldown: 0.5, positional: true },
  fireOut:      { synth: 'sizzle', vol: 1.0, cooldown: 0.3, positional: true },
  ashPoof:      { synth: 'poof', vol: 1.0, cooldown: 0.5, positional: true },
  emergency:    { synth: 'alarm', vol: 0.8, cooldown: 2, positional: false },
  sprinklers:   { synth: 'rain', vol: 0.7, cooldown: 3, positional: false },
  // --- NPC comedy ---
  npcHit:       { file: 'slap', vol: 0.9, cooldown: 0.12, positional: true, pitch: [0.85, 1.2] },
  npcFall:      { synth: 'oof', vol: 0.9, cooldown: 0.2, positional: true },
  npcBump:      { file: 'slap', vol: 0.35, cooldown: 0.5, positional: true, pitch: [1.3, 1.6] },
  npcStumble:   { synth: 'boing', vol: 0.5, cooldown: 0.3, positional: true },
  npcSlip:      { file: 'slap', synth: 'boing', vol: 0.8, cooldown: 0.3, positional: true, pitch: [0.7, 0.8] },
  npcGasp:      { synth: 'gasp', vol: 0.6, cooldown: 1, positional: true },
  chickenSlap:  { file: 'slap', synth: 'squeak', vol: 1.0, cooldown: 0.15, positional: true, pitch: [1.4, 1.8] },
  photoFlash:   { synth: 'shutter', vol: 0.7, cooldown: 0.5, positional: true },
  guardWhistle: { synth: 'whistle', vol: 0.8, cooldown: 2, positional: true },
  // --- physics ---
  cartCrash:    { synth: 'crash', vol: 1.0, cooldown: 0.25, positional: true },
  objectDrop:   { synth: 'thud', vol: 0.8, cooldown: 0.05, positional: true },
  shelfShake:   { synth: 'crash', vol: 0.8, cooldown: 0.6, positional: true },
  displayFall:  { synth: 'crash', vol: 1.0, cooldown: 2, positional: true },
  // --- player / economy ---
  purchase:     { synth: 'cash', vol: 0.9, cooldown: 0.1, positional: false },
  gearBuy:      { synth: 'achieve', vol: 0.8, cooldown: 0.3, positional: false },
  megaphone:    { synth: 'megaphone', vol: 1.0, cooldown: 1.5, positional: true },
  spray:        { synth: 'spray', vol: 0.5, cooldown: 0.22, positional: true },
  leafBlower:   { synth: 'blower', vol: 0.6, cooldown: 0.25, positional: true },
  // --- mall ---
  announcement: { synth: 'chime', vol: 1.0, cooldown: 1, positional: false },
  randomEvent:  { synth: 'chime', vol: 0.8, cooldown: 1, positional: false },
  // --- Update 3: combat + world ---
  slapHit:      { file: 'slap', vol: 1.0, cooldown: 0.05, positional: true, pitch: [0.9, 1.25] },
  punch:        { synth: 'punch', vol: 1.0, cooldown: 0.05, positional: true },
  pew:          { synth: 'pew', vol: 0.7, cooldown: 0.05, positional: true },
  thwomp:       { synth: 'thwomp', vol: 0.9, cooldown: 0.1, positional: true },
  ko:           { synth: 'ko', vol: 1.0, cooldown: 1, positional: false },
  respawn:      { synth: 'achieve', vol: 0.7, cooldown: 1, positional: false },
  pop:          { synth: 'pop', vol: 0.9, cooldown: 0.05, positional: true },
  beepScan:     { synth: 'beep', vol: 0.8, cooldown: 0.1, positional: true },
  carAlarm:     { synth: 'carAlarm', vol: 0.8, cooldown: 4, positional: true },
  flush:        { synth: 'flush', vol: 1.0, cooldown: 1, positional: true },
  dryer:        { synth: 'blower', vol: 0.8, cooldown: 0.3, positional: true },
  elevatorDing: { synth: 'ding', vol: 0.9, cooldown: 0.5, positional: true },
  // ambience (gentle, positional; uses the "Ambience" volume slider)
  ambFountain:  { synth: 'rain', vol: 0.18, cooldown: 1.0, positional: true, bus: 'amb' },
  ambArcade:    { synth: 'arcadeBlip', vol: 0.3, cooldown: 0.5, positional: true, bus: 'amb' },
};

// ---------------------------------------------------------------------
const raw = {};       // fetched ArrayBuffers
const buffers = {};   // decoded AudioBuffers
const lastPlay = {};
const loops = {};
let voices = 0;
const MAX_VOICES = 14;

export function preloadSounds() {
  for (const [k, url] of Object.entries(SOUND_FILES)) {
    raw[k] = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  }
  onAudioReady(async () => {
    for (const k of Object.keys(SOUND_FILES)) {
      const ab = await raw[k];
      if (!ab) continue;
      try { buffers[k] = await AC.ctx.decodeAudioData(ab); } catch (e) { console.warn('sound decode failed', k); }
    }
    startCrowdMurmur(); // no music: just a soft mall crowd bed on the Ambience bus
  });
}

// Soft, endless crowd murmur: band-passed noise with a slow wobble (not music)
function startCrowdMurmur() {
  const ctx = AC.ctx;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0.07;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 0.025; lfo.connect(lg); lg.connect(g.gain);
  src.connect(bp); bp.connect(g); g.connect(AC.music); src.start(); lfo.start();
}
let ambT = 0;
const _ap = new THREE.Vector3();
export function updateAmbience(dt) {
  ambT -= dt; if (ambT > 0 || !AC.ctx || !G.camera) return;
  ambT = 0.8;
  G.camera.getWorldPosition(_ap);
  if (Math.hypot(_ap.x, _ap.z + 3) < 14) play('ambFountain', { x: 0, y: 0.5, z: -3 });
  if (_ap.x > 6 && _ap.x < 33 && _ap.z > 6 && _ap.z < 42 && Math.random() < 0.7) play('ambArcade', { x: 9 + Math.random() * 21, y: 1.4, z: 12 + Math.random() * 15 });
}

const _cam = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _q = new THREE.Quaternion();
export function updateListener() {
  const ctx = AC.ctx; if (!ctx || !G.camera) return;
  G.camera.getWorldPosition(_cam); G.camera.getWorldQuaternion(_q);
  _fwd.set(0, 0, -1).applyQuaternion(_q); _up.set(0, 1, 0).applyQuaternion(_q);
  const L = ctx.listener;
  if (L.positionX) {
    L.positionX.value = _cam.x; L.positionY.value = _cam.y; L.positionZ.value = _cam.z;
    L.forwardX.value = _fwd.x; L.forwardY.value = _fwd.y; L.forwardZ.value = _fwd.z;
    L.upX.value = _up.x; L.upY.value = _up.y; L.upZ.value = _up.z;
  } else { L.setPosition(_cam.x, _cam.y, _cam.z); L.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z); }
}

function playBuffer(key, def, pos, k) {
  const ctx = AC.ctx, buf = buffers[Array.isArray(key) ? key[Math.floor(Math.random() * key.length)] : key];
  if (!ctx || !buf || voices >= MAX_VOICES) return null;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = !!def.loop;
  if (def.pitch) src.playbackRate.value = def.pitch[0] + Math.random() * (def.pitch[1] - def.pitch[0]);
  const g = ctx.createGain(); g.gain.value = (def.vol ?? 1) * k;
  let node = g;
  if (def.positional && pos) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 2; p.maxDistance = 40; p.rolloffFactor = 1.3;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    g.connect(p); node = p;
  }
  src.connect(g); node.connect(AC.sfx);
  voices++; src.onended = () => voices--;
  src.start();
  return src;
}

// Play a sound event locally. Returns true if it played.
export function play(event, pos = null, k = 1) {
  const def = SOUND_EVENTS[event];
  if (!def || !AC.ctx) return false;
  const now = performance.now() / 1000;
  if (def.cooldown && now - (lastPlay[event] || 0) < def.cooldown) return false;
  lastPlay[event] = now;
  if (def.file) playBuffer(def.file, def, pos, k);
  if (def.synth) sfx(def.synth, def.positional ? pos : null, (def.vol ?? 1) * k, def.bus);
  return true;
}

// Host: play for everyone. Clients receive {t:'snd'} and call play().
export function playAll(event, pos = null, k = 1) {
  play(event, pos, k);
  if (G.isHost && G.net) G.net.broadcast({ t: 'snd', e: event, p: pos ? [pos.x, pos.y, pos.z] : null, k });
}

export function loop(event, on) {
  const def = SOUND_EVENTS[event];
  if (!def || !AC.ctx) return;
  if (on && !loops[event]) {
    const src = playBuffer(def.file, { ...def, loop: true }, null, 1);
    if (src) loops[event] = src;
    else if (event === 'fireAlarm') loops[event] = 'synth'; // file missing: no loop, but remember state
  } else if (!on && loops[event]) {
    if (loops[event] !== 'synth') try { loops[event].stop(); } catch (e) {}
    delete loops[event];
  }
}

export const Sound = { play, playAll, loop, updateListener, preloadSounds, updateAmbience, EVENTS: SOUND_EVENTS, FILES: SOUND_FILES };
G.sound = Sound;
