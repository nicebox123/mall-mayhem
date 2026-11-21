// Canvas-texture UI panels usable by VR lasers, finger pokes, and the mouse.
import * as THREE from 'three';
import { G } from './state.js';
import { roundRect, wrapText } from './util.js';
import { sfx } from './audio.js';

const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
export const PAL = { bg: '#1b1340', card: '#2b2160', yellow: '#ffd23f', pink: '#ff4f9a', blue: '#3fa7ff', green: '#3ddc84', red: '#ff5252', white: '#ffffff', dim: '#9d93c9' };

export class Panel {
  constructor(wM, hM, { ppm = 900, bg = true } = {}) {
    this.wM = wM; this.hM = hM; this.bgOn = bg;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(wM * ppm); this.canvas.height = Math.round(hM * ppm);
    this.ctx = this.canvas.getContext('2d');
    this.W = 1000; this.H = 1000 * hM / wM; this.s = this.canvas.width / 1000;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true }));
    this.mesh.userData.panel = this;
    this.mesh.renderOrder = 2;
    this.widgets = []; this.hoverIdx = -1; this.screenFn = null; this.state = {};
    G.panels.push(this);
  }
  setScreen(fn) { this.screenFn = fn; this.hoverIdx = -1; this.refresh(); }
  refresh() {
    const { ctx, s } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (this.bgOn) {
      ctx.fillStyle = 'rgba(27,19,64,0.94)'; roundRect(ctx, 4, 4, this.W - 8, this.H - 8, 40); ctx.fill();
      ctx.strokeStyle = PAL.yellow; ctx.lineWidth = 8; ctx.stroke();
    }
    this.widgets = [];
    if (this.screenFn) this.screenFn(this);
    this.tex.needsUpdate = true;
  }
  visible() {
    let o = this.mesh;
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  }
  _xy(uv) { return [uv.x * this.W, (1 - uv.y) * this.H]; }
  hit(uv) {
    const [x, y] = this._xy(uv);
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return i;
    }
    return -1;
  }
  hover(uv) {
    const i = uv ? this.hit(uv) : -1;
    if (i !== this.hoverIdx) { this.hoverIdx = i; this.refresh(); if (i >= 0 && !this.widgets[i].disabled) sfx('click', null, 0.3); }
  }
  click(uv) {
    const i = this.hit(uv);
    if (i < 0) return false;
    const w = this.widgets[i];
    if (w.disabled) { sfx('error'); return true; }
    sfx('click');
    w.onClick && w.onClick();
    return true;
  }

  // ---- drawing helpers (virtual coords, width 1000) ----
  title(text, y = 90, color = PAL.yellow, size = 72) {
    const c = this.ctx; c.fillStyle = color; c.font = `bold ${size}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, this.W / 2, y);
  }
  text(text, x, y, { size = 36, color = PAL.white, align = 'left', maxW = 0, bold = false, lh = 1.25 } = {}) {
    const c = this.ctx; c.fillStyle = color; c.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'middle';
    const lines = maxW ? wrapText(c, String(text), maxW) : [String(text)];
    lines.forEach((l, i) => c.fillText(l, x, y + i * size * lh));
    return lines.length * size * lh;
  }
  box(x, y, w, h, color = PAL.card, r = 20) { const c = this.ctx; c.fillStyle = color; roundRect(c, x, y, w, h, r); c.fill(); }
  button(label, x, y, w, h, onClick, { color = PAL.yellow, fg = PAL.bg, disabled = false, size = 0, selected = false } = {}) {
    const i = this.widgets.length;
    const hov = i === this.hoverIdx && !disabled;
    const c = this.ctx;
    c.save();
    if (hov) { c.translate(x + w / 2, y + h / 2); c.scale(1.05, 1.05); c.translate(-(x + w / 2), -(y + h / 2)); }
    c.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(c, x, y + 8, w, h, 22); c.fill();
    c.fillStyle = disabled ? '#5a5280' : color; roundRect(c, x, y, w, h, 22); c.fill();
    if (selected || hov) { c.strokeStyle = PAL.white; c.lineWidth = 7; c.stroke(); }
    c.fillStyle = disabled ? '#a59ec9' : fg;
    const fs = size || Math.min(h * 0.45, 46);
    c.font = `bold ${fs}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x + w / 2, y + h / 2 + 2);
    c.restore();
    this.widgets.push({ x, y, w, h, onClick, disabled, label });
  }
  clickLabel(label) { // test/automation helper
    const w = this.widgets.find((k) => k.label === label);
    if (w) this.click({ x: (w.x + w.w / 2) / this.W, y: 1 - (w.y + w.h / 2) / this.H });
    return !!w;
  }
  swatch(color, x, y, size, onClick, selected) {
    const i = this.widgets.length; const c = this.ctx;
    c.fillStyle = '#' + color.toString(16).padStart(6, '0'); roundRect(c, x, y, size, size, 14); c.fill();
    if (selected || i === this.hoverIdx) { c.strokeStyle = selected ? PAL.yellow : PAL.white; c.lineWidth = 8; c.stroke(); }
    this.widgets.push({ x, y, w: size, h: size, onClick });
  }
}

// On-panel keyboard for typing names / lobby codes in VR
export function keyboardScreen({ title, value = '', maxLen = 16, letters = true, onDone, onCancel, upper = true }) {
  let v = value;
  const rows = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  return (p) => {
    p.title(title, 70, PAL.yellow, 56);
    p.box(80, 120, 840, 100, '#0f0a2b');
    p.text(v + '_', 500, 172, { size: 56, align: 'center', bold: true });
    const kw = 82, kh = 82, gap = 8;
    rows.forEach((row, ri) => {
      const total = row.length * (kw + gap) - gap;
      const x0 = (1000 - total) / 2;
      [...row].forEach((ch, ci) => {
        p.button(ch, x0 + ci * (kw + gap), 250 + ri * (kh + gap), kw, kh, () => {
          if (v.length < maxLen) { v += upper ? ch : (v.length === 0 || v.endsWith(' ') ? ch : ch.toLowerCase()); p.refresh(); }
        }, { color: PAL.card, fg: PAL.white, size: 40 });
      });
    });
    const y = 250 + 4 * (kh + gap) + 10;
    if (letters) p.button('SPACE', 230, y, 260, 80, () => { if (v.length < maxLen) { v += ' '; p.refresh(); } }, { color: PAL.blue, fg: PAL.white, size: 36 });
    p.button('⌫', 510, y, 120, 80, () => { v = v.slice(0, -1); p.refresh(); }, { color: PAL.pink, fg: PAL.white });
    p.button('OK', 650, y, 160, 80, () => onDone(v.trim()), { color: PAL.green });
    p.button('BACK', 60, y, 150, 80, onCancel, { color: '#5a5280', fg: PAL.white, size: 34 });
  };
}

// Raycast against visible panels
const _ray = new THREE.Raycaster();
export function raycastPanels(origin, dir, maxDist = 6) {
  _ray.set(origin, dir); _ray.far = maxDist;
  const meshes = G.panels.filter((p) => p.visible()).map((p) => p.mesh);
  const hits = _ray.intersectObjects(meshes, false);
  if (!hits.length) return null;
  return { panel: hits[0].object.userData.panel, uv: hits[0].uv, point: hits[0].point, distance: hits[0].distance };
}
