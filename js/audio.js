// Procedural Web Audio: zero asset downloads, tiny and fast.
import { G } from './state.js';
import { Save } from './save.js';
import * as THREE from 'three';

let ctx = null, master, sfxBus, musicBus, sirenNode = null, musicTimer = null;
const readyHooks = [];
export const AC = { get ctx() { return ctx; }, get sfx() { return sfxBus; }, get music() { return musicBus; } };
export function onAudioReady(fn) { if (ctx) fn(); else readyHooks.push(fn); }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.connect(master);
  applyVolumes();
  readyHooks.splice(0).forEach((f) => f());
}

export function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.value = Save.data.settings.sfx;
  musicBus.gain.value = Save.data.settings.music * 0.6;
}

function distGain(pos) {
  if (!pos || !G.camera) return 1;
  const cp = G.camera.getWorldPosition(_v);
  const d = Math.hypot(cp.x - pos.x, cp.y - pos.y, cp.z - pos.z);
  return Math.max(0, 1 - d / 25) ** 1.5;
}
const _v = new THREE.Vector3();

let outBus = null; // which bus the current sfx() call plays on (sfx or ambience)
function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0, bus = outBus || sfxBus) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(dur, vol, freq = 800, delay = 0) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(outBus || sfxBus); s.start(t); s.stop(t + dur);
}

let lastThud = 0;
export function sfx(name, pos, k = 1, bus = null) {
  if (!ctx) return;
  const v = distGain(pos) * k;
  if (v < 0.02) return;
  outBus = bus === 'amb' ? musicBus : sfxBus;
  sfxInner(name, v, k);
  outBus = null;
}
function sfxInner(name, v, k) {
  switch (name) {
    case 'thud': {
      const now = performance.now(); if (now - lastThud < 40) return; lastThud = now;
      noise(0.12, 0.5 * v, 300 + 500 * k); tone(90 + Math.random() * 40, 0.12, 'sine', 0.35 * v, -40); break;
    }
    case 'boing': tone(220, 0.25, 'sine', 0.25 * v, 500); break;
    case 'grab': tone(500, 0.05, 'square', 0.06 * v, 200); break;
    case 'click': tone(1200, 0.04, 'square', 0.08 * v); break;
    case 'beep': tone(1760, 0.09, 'square', 0.12 * v); break;
    case 'cash': tone(1318, 0.08, 'triangle', 0.25 * v); tone(1760, 0.25, 'triangle', 0.25 * v, 0, 0.08); noise(0.15, 0.15 * v, 4000, 0.05); break;
    case 'chime': [784, 659, 523].forEach((f, i) => tone(f, 0.6, 'sine', 0.3, 0, i * 0.35)); break;
    case 'error': tone(180, 0.25, 'sawtooth', 0.12 * v); break;
    case 'swish': noise(0.35, 0.35 * v, 2500); tone(880, 0.3, 'triangle', 0.2 * v, 400, 0.05); break;
    case 'pop': tone(600, 0.08, 'sine', 0.3 * v, 600); break;
    case 'sizzle': noise(0.5, 0.12 * v, 6000); break;
    case 'oof': tone(300, 0.2, 'sawtooth', 0.15 * v, -150); break;
    case 'whoosh': noise(0.25, 0.2 * v, 1200); break;
    case 'achieve': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.25, 0, i * 0.1)); break;
    case 'squeak': tone(1500, 0.08, 'sine', 0.12 * v, 600); break;
    case 'alarm': tone(440, 0.4, 'square', 0.12, 0); tone(330, 0.4, 'square', 0.12, 0, 0.4); break;
    case 'powerdown': tone(400, 1.2, 'sawtooth', 0.15, -350); break;
    case 'poof': noise(0.5, 0.6 * v, 900); tone(160, 0.35, 'sine', 0.3 * v, -100); break;
    case 'rain': noise(1.2, 0.25 * v, 5000); noise(1.2, 0.2 * v, 2500, 0.4); break;
    case 'gasp': tone(700, 0.25, 'triangle', 0.15 * v, 500); noise(0.2, 0.08 * v, 3000); break;
    case 'shutter': noise(0.05, 0.4 * v, 6000); noise(0.05, 0.3 * v, 6000, 0.08); break;
    case 'whistle': tone(2200, 0.15, 'sine', 0.2 * v, 300); tone(2500, 0.35, 'sine', 0.2 * v, -200, 0.17); break;
    case 'crash': noise(0.35, 0.7 * v, 1500); tone(110, 0.25, 'sawtooth', 0.2 * v, -60); noise(0.2, 0.3 * v, 5000, 0.08); break;
    case 'megaphone': tone(330, 0.5, 'square', 0.14 * v, 0); tone(332, 0.5, 'sawtooth', 0.1 * v, 0); noise(0.5, 0.05 * v, 2000); break;
    case 'spray': noise(0.25, 0.25 * v, 7000); break;
    case 'blower': noise(0.3, 0.3 * v, 900); tone(90, 0.3, 'sawtooth', 0.05 * v); break;
    case 'punch': noise(0.09, 0.8 * v, 900); tone(140, 0.16, 'sine', 0.6 * v, -90); tone(70, 0.2, 'triangle', 0.4 * v, -30); break;
    case 'pew': tone(1400, 0.14, 'square', 0.12 * v, -1100); noise(0.05, 0.1 * v, 4000); break;
    case 'thwomp': tone(90, 0.35, 'sine', 0.6 * v, -50); noise(0.2, 0.4 * v, 600); tone(300, 0.2, 'triangle', 0.2 * v, 400, 0.05); break;
    case 'ko': [880, 660, 440, 330].forEach((f, i) => tone(f, 0.25, 'triangle', 0.25, -40, i * 0.12)); tone(1760, 0.8, 'sine', 0.15, 0, 0.55); break;
    case 'carAlarm': for (let i = 0; i < 6; i++) tone(i % 2 ? 900 : 1300, 0.18, 'square', 0.08 * v, 0, i * 0.2); break;
    case 'flush': noise(1.4, 0.45 * v, 1200); noise(1.0, 0.3 * v, 400, 0.3); tone(200, 1.2, 'sine', 0.1 * v, -120, 0.2); break;
    case 'ding': tone(1046, 0.6, 'sine', 0.3 * v); tone(1318, 0.8, 'sine', 0.25 * v, 0, 0.18); break;
    case 'arcadeBlip': { const f = [523, 659, 784, 1046, 880][Math.floor(Math.random() * 5)]; tone(f, 0.07, 'square', 0.06 * v); tone(f * 1.5, 0.07, 'square', 0.05 * v, 0, 0.08); break; }
  }
}

export function siren(on) {
  if (!ctx) return;
  if (on && !sirenNode) {
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 700; lfo.frequency.value = 1.5; lg.gain.value = 250;
    lfo.connect(lg); lg.connect(o.frequency); g.gain.value = 0.05;
    o.connect(g); g.connect(sfxBus); o.start(); lfo.start();
    sirenNode = { o, lfo };
  } else if (!on && sirenNode) {
    sirenNode.o.stop(); sirenNode.lfo.stop(); sirenNode = null;
  }
}

// Cheesy elevator-music loop (fallback when the music file can't load)
export function startProceduralMusic() {
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const mel = [523, 587, 659, 587, 523, 440, 494, 523, 659, 784, 698, 659, 587, 523, 494, 440];
  let step = 0;
  const beat = 0.42;
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const ch = chords[Math.floor(step / 4) % 4];
    if (step % 4 === 0) ch.forEach((f) => tone(f, beat * 4, 'sine', 0.06, 0, 0, musicBus));
    if (step % 2 === 0) tone(ch[0] / 2, beat * 1.5, 'triangle', 0.08, 0, 0, musicBus);
    if (Math.random() < 0.8) tone(mel[step % 16], beat * 0.9, 'triangle', 0.05, 0, 0, musicBus);
    step++;
  }, beat * 1000);
}

export function speak(text) {
  if (!Save.data.settings.tts || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1.1; u.volume = Save.data.settings.sfx;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { /* not supported */ }
}

export function haptic(hand, strength = 0.5, ms = 40) {
  const src = hand && hand.inputSource;
  const act = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
  if (act && act.pulse) act.pulse(strength, ms);
}
