// Tiny pooled particle systems (one draw call each): sprays, water, smoke, flames, confetti.
import * as THREE from 'three';
import { G } from './state.js';

function roundTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Pool {
  constructor(n, size, additive = false) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) this.pos[k * 3 + 1] = -100;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size, map: roundTex(), vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.active = 0;
  }
  emit(x, y, z, vx, vy, vz, color, life = 1, grav = 1, drag = 0) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    const c = _c.set(color);
    this.base[k * 3] = c.r; this.base[k * 3 + 1] = c.g; this.base[k * 3 + 2] = c.b;
    this.life[k] = life; this.grav[k] = grav; this.drag[k] = drag;
    this.active = 2;
  }
  update(dt) {
    if (!this.active) return;
    let any = false;
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      any = true;
      this.life[k] -= dt;
      const j = k * 3;
      if (this.life[k] <= 0) { this.pos[j + 1] = -100; continue; }
      const d = 1 - this.drag[k] * dt;
      this.vel[j] *= d; this.vel[j + 2] *= d; this.vel[j + 1] = this.vel[j + 1] * d - 9.8 * this.grav[k] * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.02 && this.grav[k] > 0) { this.pos[j + 1] = 0.02; this.vel[j + 1] *= -0.2; this.vel[j] *= 0.6; this.vel[j + 2] *= 0.6; }
      const f = Math.min(1, this.life[k] * 2);
      this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    if (!any) this.active = 0;
  }
}
const _c = new THREE.Color();

export const P = {};
export function initParticles(scene) {
  P.small = new Pool(900, 0.085);          // water, foam, confetti
  P.puff = new Pool(260, 0.45);            // smoke
  P.flame = new Pool(300, 0.22, true);     // fire (additive glow)
  scene.add(P.small.points, P.puff.points, P.flame.points);
}
export function updateParticles(dt) { P.small && (P.small.update(dt), P.puff.update(dt), P.flame.update(dt)); }

// helpers
const r = (s) => (Math.random() - 0.5) * s;
export function sprayBurst(kind, origin, dir, n = 6) {
  for (let i = 0; i < n; i++) {
    if (kind === 'foam') P.small.emit(origin.x, origin.y, origin.z, dir.x * 7 + r(1.2), dir.y * 7 + r(1.2), dir.z * 7 + r(1.2), 0xffffff, 0.8, 0.5, 1);
    else if (kind === 'water') P.small.emit(origin.x, origin.y, origin.z, dir.x * 9 + r(0.8), dir.y * 9 + r(0.8) + 1, dir.z * 9 + r(0.8), 0x4fc3f7, 1.0, 1, 0.3);
    else if (kind === 'flame') P.flame.emit(origin.x, origin.y, origin.z, dir.x * 4 + r(0.8), dir.y * 4 + r(0.8), dir.z * 4 + r(0.8), i % 2 ? 0xff9100 : 0xffd23f, 0.35, -0.1, 2);
    else if (kind === 'air') P.small.emit(origin.x, origin.y, origin.z, dir.x * 10 + r(2), dir.y * 10 + r(2), dir.z * 10 + r(2), 0xd7f0ff, 0.35, 0, 2);
  }
}
export function confetti(pos, n = 40) {
  const cols = [0xff4f9a, 0xffd23f, 0x3fa7ff, 0x3ddc84, 0xffffff];
  for (let i = 0; i < n; i++) P.small.emit(pos.x, pos.y, pos.z, r(4), 2 + Math.random() * 4, r(4), cols[i % 5], 2.5, 0.4, 0.8);
}
export function smokePuff(pos, n = 8, color = 0x555555) {
  for (let i = 0; i < n; i++) P.puff.emit(pos.x + r(0.3), pos.y + r(0.2), pos.z + r(0.3), r(0.6), 0.6 + Math.random(), r(0.6), color, 1.6, -0.03, 0.5);
}
export function flameLick(pos, s) {
  for (let i = 0; i < 2; i++) P.flame.emit(pos.x + r(0.25 * s), pos.y + 0.05, pos.z + r(0.25 * s), r(0.3), 1.2 + Math.random() * 1.2 * s, r(0.3), Math.random() < 0.5 ? 0xff6d00 : 0xffc400, 0.45, -0.05, 1);
}
export function rain(center, radius = 6, n = 20) {
  for (let i = 0; i < n; i++) P.small.emit(center.x + r(radius * 2), 6.8, center.z + r(radius * 2), 0, -2, 0, 0x81d4fa, 1.5, 1, 0);
}
