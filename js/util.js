import * as THREE from 'three';

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (dt, k) => 1 - Math.exp(-k * dt);
export const r3 = (n) => Math.round(n * 1000) / 1000;

// Material cache: Lambert is cheap and looks good with flat-shaded blocky models.
const mats = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) {
    const m = opts.basic ? new THREE.MeshBasicMaterial({ color, ...opts.extra })
                         : new THREE.MeshLambertMaterial({ color, ...opts.extra });
    mats.set(key, m);
  }
  return mats.get(key);
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function box(w, h, d, color, opts) {
  const m = new THREE.Mesh(boxGeo, mat(color, opts));
  m.scale.set(w, h, d);
  return m;
}

// Text drawn onto a canvas texture (signs, labels, speech bubbles)
export function textTexture(text, { w = 512, h = 128, bg = '#ffd23f', fg = '#1b1340', font = 'bold 72px "Trebuchet MS", sans-serif', radius = 24, border = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (bg) { ctx.fillStyle = bg; roundRect(ctx, 0, 0, w, h, radius); ctx.fill(); }
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 8; roundRect(ctx, 4, 4, w - 8, h - 8, radius); ctx.stroke(); }
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = String(text).split('\n');
  const lh = h / (lines.length + 0.3);
  lines.forEach((l, i) => ctx.fillText(l, w / 2, lh * (i + 0.65) + lh * 0.0));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function wrapText(ctx, text, maxW) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function signMesh(text, w, h, opts = {}) {
  const tex = textTexture(text, { w: Math.round(256 * w / h) * 2, h: 256, font: `bold ${opts.size || 150}px "Trebuchet MS", sans-serif`, ...opts });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !!opts.transparent }));
  return m;
}

let toastTimer = 0;
export function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = 'none'), ms);
}

// Seeded RNG for daily challenges
export function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
