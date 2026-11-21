// =====================================================================
//  THE MALL (Update 3): ~150 x 100 m, 3 walkable levels + roof.
//   L1 (y=0)  : giant supermarket, food court (4 restaurants), toy store, clothing, furniture,
//               arcade, electronics, cinema, bathrooms, staff/storage, atrium, corridors,
//               parking garage (east) and outdoor entrance plaza (south).
//   L2 (y=5)  : atrium balcony ring, corridors, Bounce Zone trampolines, bookstore,
//               secret manager's office, Sky Cafe, garage top deck.
//   Roof (10) : rooftop with skylight hatch (drops into the fountain).
//  Static geometry is merged per color *per 24m chunk* so far-away chunks get frustum-culled.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from './state.js';
import { ITEMS, PRODUCT_POOL } from './config.js';
import { addStaticBody, addAABB, addWalk, addRamp, movers, world, M, CANNON } from './physics.js';
import { signMesh, textTexture, mat, pick, rand } from './util.js';

export const L2Y = 5, ROOFY = 10;
const CHUNK = 32;
const buckets = new Map();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const _col = new THREE.Color();

// Everything static in a 32m chunk merges into ONE mesh per kind (lit / unlit / glass) using vertex colors,
// so the whole mall costs ~100 draw calls instead of thousands, and far chunks still get frustum-culled.
function addGeo(geo, color, x, y, z, sx, sy, sz, rotY = 0, kind = 'l') {
  const key = kind + '|' + Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK) + (y > 7.5 ? 'r' : '');
  if (!buckets.has(key)) buckets.set(key, { kind, geos: [] });
  _q.setFromEuler(_e.set(0, rotY, 0)); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  const g = geo.clone().applyMatrix4(_m);
  _col.setHex(color);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (g.index) { const ng = g.toNonIndexed(); g.dispose(); buckets.get(key).geos.push(ng); }
  else buckets.get(key).geos.push(g);
}
// Static box: visual + physics body + optional player/NPC collider
export function sbox(x, y, z, w, h, d, color, { collide = true, aabb = false, rotY = 0, basic = false, glass = false, thick = 0 } = {}) {
  addGeo(unitBox, color, x, y, z, w, h, d, rotY, glass ? 'g' : basic ? 'b' : 'l');
  if (collide) addStaticBody(x, y - thick / 2, z, w, h + thick, d, { rotY });
  if (aabb) addAABB(x, z, w, d, y - h / 2, y + h / 2);
}
function cyl(x, y, z, r, h, color, seg = 10) { addGeo(new THREE.CylinderGeometry(r, r, h, seg), color, x, y, z, 1, 1, 1); }
const glassMat = new THREE.MeshLambertMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.22, depthWrite: false });
const vcLit = new THREE.MeshLambertMaterial({ vertexColors: true });
const vcBasic = new THREE.MeshBasicMaterial({ vertexColors: true });
function finalizeStatic(scene) {
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    const m = new THREE.Mesh(merged, b.kind === 'g' ? glassMat : b.kind === 'b' ? vcBasic : vcLit);
    m.matrixAutoUpdate = false; m.updateMatrix();
    if (b.kind === 'g') m.renderOrder = 1;
    scene.add(m);
    b.geos.forEach((g) => g.dispose());
  }
  buckets.clear();
}

// ---------- layout helpers ----------
const T = 0.3; // wall thickness
const BASE = 0x3a3150;
// Axis-aligned wall from (x0,z0) to (x1,z1) with door openings [[a0, a1, openingHeight]] along its length.
function wall(x0, z0, x1, z1, y0, h, color, openings = [], { glass = false, trim = true } = {}) {
  const alongX = z0 === z1;
  const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1), b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const fixed = alongX ? z0 : x0;
  const ops = openings.slice().sort((p, q) => p[0] - q[0]);
  const seg = (s0, s1, yb, hh) => {
    if (s1 - s0 < 0.01 || hh < 0.01) return;
    const c = (s0 + s1) / 2, len = s1 - s0, yc = yb + hh / 2;
    if (alongX) sbox(c, yc, fixed, len, hh, T, color, { aabb: true, glass });
    else sbox(fixed, yc, c, T, hh, len, color, { aabb: true, glass });
    if (trim && !glass && yb === y0) { // baseboard trim
      if (alongX) sbox(c, y0 + 0.08, fixed, len, 0.16, T + 0.04, BASE, { collide: false });
      else sbox(fixed, y0 + 0.08, c, T + 0.04, 0.16, len, BASE, { collide: false });
    }
  };
  let cur = a;
  for (const [o0, o1, oh] of ops) {
    seg(cur, o0, y0, h);
    seg(o0, o1, y0 + oh, h - oh); // lintel
    cur = o1;
  }
  seg(cur, b, y0, h);
}
const R = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
function subtract(r, h) {
  if (h.x1 <= r.x0 || h.x0 >= r.x1 || h.z1 <= r.z0 || h.z0 >= r.z1) return [r];
  const out = [];
  if (h.z0 > r.z0) out.push(R(r.x0, r.x1, r.z0, h.z0));
  if (h.z1 < r.z1) out.push(R(r.x0, r.x1, h.z1, r.z1));
  const za = Math.max(r.z0, h.z0), zb = Math.min(r.z1, h.z1);
  if (h.x0 > r.x0) out.push(R(r.x0, h.x0, za, zb));
  if (h.x1 < r.x1) out.push(R(h.x1, r.x1, za, zb));
  return out;
}
// Floor slab at height y (top surface). Holes are cut out (atrium, escalators, stairs).
function slab(rects, holes, y, color, { walk = true, extra = {} } = {}) {
  let list = rects.slice();
  for (const h of holes) list = list.flatMap((r) => subtract(r, h));
  for (const r of list) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0; if (w < 0.05 || d < 0.05) continue;
    sbox((r.x0 + r.x1) / 2, y - 0.15, (r.z0 + r.z1) / 2, w, 0.3, d, color, { thick: 0.3 });
    if (walk) addWalk(r.x0, r.x1, r.z0, r.z1, y, extra);
  }
}
function railing(x0, z0, x1, z1, y) { // glass balustrade with a handrail: blocks players + objects
  const alongX = z0 === z1, len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (alongX) { sbox(cx, y + 0.55, cz, len, 1.1, 0.06, 0xa8d8ff, { aabb: true, glass: true }); sbox(cx, y + 1.12, cz, len, 0.06, 0.1, 0x37474f, { collide: false }); }
  else { sbox(cx, y + 0.55, cz, 0.06, 1.1, len, 0xa8d8ff, { aabb: true, glass: true }); sbox(cx, y + 1.12, cz, 0.1, 0.06, len, 0x37474f, { collide: false }); }
}
function addSign(scene, text, x, y, z, rotY, w = 5, h = 1, opts = {}) {
  const s = signMesh(text, w, h, opts); s.position.set(x, y, z); s.rotation.y = rotY; scene.add(s); return s;
}
// textured floor patch (not merged: each has its own repeating texture)
const floorTex = {};
function patternTex(kind) {
  if (floorTex[kind]) return floorTex[kind];
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const P = {
    marble: () => { x.fillStyle = '#f2eee6'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#e4ddcf'; x.fillRect(0, 0, 64, 64); x.fillRect(64, 64, 64, 64); x.strokeStyle = '#cfc6b4'; x.lineWidth = 2; x.strokeRect(0, 0, 128, 128); x.strokeRect(0, 0, 64, 64); x.strokeRect(64, 64, 64, 64); },
    vinyl: () => { x.fillStyle = '#f7f7f4'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#d6d6d0'; x.lineWidth = 3; x.strokeRect(1, 1, 126, 126); x.fillStyle = '#e9ecef'; x.fillRect(64, 0, 64, 64); },
    terracotta: () => { x.fillStyle = '#e8a87c'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#c47f55'; x.lineWidth = 4; for (let i = 0; i <= 128; i += 42) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); } },
    wood: () => { x.fillStyle = '#b07d4f'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#a06e42' : '#bc8a5c'; x.fillRect(0, i * 16, 128, 15); } },
    carpetToy: () => { x.fillStyle = '#5e35b1'; x.fillRect(0, 0, 128, 128); const cs = ['#ffd23f', '#ff4f9a', '#3ddc84', '#3fa7ff']; for (let i = 0; i < 18; i++) { x.fillStyle = cs[i % 4]; x.beginPath(); x.arc((i * 37) % 128, (i * 53) % 128, 6, 0, 7); x.fill(); } },
    carpetArcade: () => { x.fillStyle = '#120a2b'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#00e5ff'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 30); x.lineTo(60, 90); x.lineTo(128, 20); x.stroke(); x.strokeStyle = '#ff4f9a'; x.beginPath(); x.arc(90, 90, 20, 0, 5); x.stroke(); },
    concrete: () => { x.fillStyle = '#9e9e9e'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 300; i++) { x.fillStyle = Math.random() < 0.5 ? '#8e8e8e' : '#acacac'; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); } },
    asphalt: () => { x.fillStyle = '#4a4a4a'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 400; i++) { x.fillStyle = Math.random() < 0.5 ? '#3c3c3c' : '#575757'; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); } x.fillStyle = '#f5f5f5'; x.fillRect(0, 0, 4, 128); },
    sidewalk: () => { x.fillStyle = '#cfcfcf'; x.fillRect(0, 0, 128, 128); x.strokeStyle = '#a8a8a8'; x.lineWidth = 3; x.strokeRect(0, 0, 128, 128); },
    bathroom: () => { x.fillStyle = '#e0f7fa'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#80deea'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) x.fillRect(i * 32, j * 32, 32, 32); },
    backrooms: () => { x.fillStyle = '#c9b458'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 200; i++) { x.fillStyle = '#b8a24a'; x.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); } },
    bounce: () => { x.fillStyle = '#1565c0'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#ff6d00'; x.fillRect(0, 0, 128, 10); x.fillRect(0, 0, 10, 128); },
  };
  (P[kind] || P.marble)();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  floorTex[kind] = t; return t;
}
function floorPatch(scene, x0, x1, z0, z1, y, kind, tile = 2) {
  const t = patternTex(kind).clone(); t.needsUpdate = true; t.repeat.set((x1 - x0) / tile, (z1 - z0) / tile);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshLambertMaterial({ map: t }));
  m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y + 0.012, (z0 + z1) / 2); m.matrixAutoUpdate = false; m.updateMatrix();
  scene.add(m);
}
function ceilLights(x0, x1, z0, z1, y, step = 6) {
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) sbox(x, y, z, 2.2, 0.05, 0.5, 0xfffbe6, { collide: false, basic: true });
}
function poster(scene, text, x, y, z, rotY, bg = '#ff4f9a', fg = '#fff', w = 1.6, h = 2.2) {
  const s = signMesh(text, w, h, { size: 70, bg, fg, radius: 10 }); s.position.set(x, y, z); s.rotation.y = rotY; scene.add(s);
}

// ---------- Zones shared by host logic & client visuals ----------
export const Z = {
  spawn: new THREE.Vector3(0, 0, 14),
  registers: [{ id: 'reg0', x: -44, z: -14 }, { id: 'reg1', x: -40, z: -14 }],
  grill: { x: 10, y: 0.95, z: -38.6, w: 1.4, d: 0.7 },
  prep: { x: 13.5, y: 0.95, z: -38.6 },
  serve: { x: 12.5, y: 1.0, z: -34, w: 0.8, d: 0.6 },
  foodCustomer: { x: 12.5, z: -32.4 },
  hoop: { x: 14, y: 2.4, z: 39.4, r: 0.24 },
  stockSpawn: { x: -54, y: 1.0, z: -38.6 },
  mopSpawn: { x: 50, y: 0.2, z: -38 },
  slots: [],
  checkpoints: [[-40, 0], [-20, -3], [0, 10], [20, 3], [40, -2], [0, 30], [0, -30], [25, -20], [-30, -20], [-20, 20], [30, 20], [52, -14]],
  exits: [[0, 47], [66, 0]],
  pois: [], pois2: [],
  noNav: [
    { minX: 8, maxX: 46, minZ: -40.5, maxZ: -34.4 },     // kitchens
    { minX: 46, maxX: 60, minZ: -40, maxZ: -23 },        // staff/storage
    { minX: 8, maxX: 30, minZ: 8, maxZ: 40 },            // arcade (until unlocked)
    { minX: 60, maxX: 73, minZ: 30, maxZ: 40.5 },        // backrooms secret
    { minX: -60, maxX: -48, minZ: -40, maxZ: -27 },      // stockroom
  ],
  saleSpot: [-30, -27],
  display: { x: -27, z: -18 },
  directories: [],
};
export const shutters = [];
export const lights = {};
export const arcadeScreens = [];
export const emergencyLights = [];
export const shelfBounds = [];
export const autoDoors = [];
export const escalators = [];    // { walk, dirX, dirZ, speed, tex }
export const conveyors = [];     // supermarket checkout belts { minX,maxX,minZ,maxZ,y, vx, vz, tex }
export const tvScreens = [];
export const elevator = { x0: -6, x1: -3.6, z0: -6, z1: -3.6, y: 0, from: 0, to: 0, t0: 0, dur: 1, mesh: null, body: null };
let fountainWater = null, gateMesh = null, gateBody = null, gateAABB = null, outOfOrder = [], secretShelf = null;

export function buildWorld(scene) {
  // ---- lighting (no realtime shadows: VR perf; blob shadows under characters instead) ----
  lights.hemi = new THREE.HemisphereLight(0xfff6e8, 0xc9c2dd, 1.45);
  scene.add(lights.hemi);
  lights.sun = new THREE.DirectionalLight(0xffffff, 0.9); lights.sun.position.set(10, 20, 8); scene.add(lights.sun);
  scene.background = new THREE.Color(0x8fd3ff);
  scene.fog = new THREE.Fog(0xcfe8ff, 45, 150);

  // ---------- walkable ground (everything at y=0: mall, garage, plaza, backrooms) ----------
  addWalk(-80, 110, -60, 75, 0);

  // ---------- floors ----------
  floorPatch(scene, -60, 60, -8, 8, 0, 'marble', 3);            // E-W corridor
  floorPatch(scene, -8, 8, -40, -8, 0, 'marble', 3);            // N corridor
  floorPatch(scene, -8, 8, 8, 40, 0, 'marble', 3);              // S corridor
  floorPatch(scene, -60, -8, -40, -8, 0, 'vinyl', 1.2);         // supermarket
  floorPatch(scene, 8, 46, -40, -8, 0, 'terracotta', 2);        // food court
  floorPatch(scene, 46, 60, -22, -8, 0, 'bathroom', 1);         // bathrooms
  floorPatch(scene, 46, 60, -40, -23, 0, 'concrete', 3);        // staff
  floorPatch(scene, -60, -34, 8, 40, 0, 'carpetToy', 3);        // toy store
  floorPatch(scene, -33, -8, 8, 23, 0, 'wood', 2);              // clothing
  floorPatch(scene, -33, -8, 23, 40, 0, 'wood', 2.5);           // furniture
  floorPatch(scene, 8, 31, 8, 40, 0, 'carpetArcade', 3);        // arcade
  floorPatch(scene, 31, 60, 8, 25, 0, 'vinyl', 1.5);            // electronics
  floorPatch(scene, 31, 60, 25, 40, 0, 'carpetArcade', 4);      // cinema
  floorPatch(scene, 60, 93, -31, 31, 0, 'concrete', 4);         // garage
  floorPatch(scene, -31, 31, 40, 57, 0, 'sidewalk', 2);         // plaza
  floorPatch(scene, 60, 73, 30, 41, 0, 'backrooms', 2);         // backrooms
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x6d9c4f }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; scene.add(ground);

  // ---------- outer shell ----------
  const OW = 0xe8e0f0, OUT = 0xb39ddb;
  wall(-60, -40, 60, -40, 0, ROOFY, OW);
  wall(-60, 40, 60, 40, 0, ROOFY, OW, [[-4, 4, 4.2]]);                      // south entrance
  wall(-60, -40, -60, 40, 0, ROOFY, OW);
  wall(60, -40, 60, 40, 0, L2Y, OW, [[-3, 3, 3.6], [32, 39, 3.2]]);         // garage door + secret backrooms gap
  wall(60, -40, 60, 40, L2Y, 5, OW, [[-3, 3, 3.2]]);                         // L2 door to the garage roof deck
  // facade outside
  addSign(scene, 'MALL MAYHEM', 0, 7.2, 40.2, 0, 16, 3, { bg: '#ff4f9a', fg: '#ffd23f', size: 170 });
  sbox(0, 4.6, 41.5, 10, 0.2, 3, 0xffffff); sbox(-4.8, 2.3, 42.8, 0.2, 4.6, 0.2, 0xb0bec5); sbox(4.8, 2.3, 42.8, 0.2, 4.6, 0.2, 0xb0bec5); // entrance canopy

  // ---------- L2 floor (y=5) ----------
  const holes = [R(-6, 6, -6, 6), R(8, 17, -5.4, -3.2), R(8, 17, 3.2, 5.4), R(-17, -8, -5.4, -3.2), R(83, 91, 5, 26)];
  slab([R(-60, 60, -8, 8), R(-8, 8, -40, -8), R(-33, -8, 8, 23), R(8, 31, 8, 26), R(31, 60, 8, 25), R(46, 60, -40, -8), R(60, 93, -31, 31)], holes, L2Y, 0xd7ccc8);
  { // L2 corridor floor texture, cut around the atrium + escalator/stair openings
    let parts = [R(-60, 60, -8, 8)];
    for (const h of holes) parts = parts.flatMap((r) => subtract(r, h));
    for (const r of parts) if (r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05) floorPatch(scene, r.x0, r.x1, r.z0, r.z1, L2Y, 'marble', 3);
  }
  floorPatch(scene, -8, 8, -40, -8, L2Y, 'wood', 2);
  floorPatch(scene, -33, -8, 8, 23, L2Y, 'wood', 2);
  floorPatch(scene, 8, 31, 8, 26, L2Y, 'bounce', 2);
  for (const r of subtract(R(60, 93, -31, 31), R(83, 91, 5, 26))) floorPatch(scene, r.x0, r.x1, r.z0, r.z1, L2Y, 'concrete', 4);
  // ---------- roof (y=10): skylight hatch over the atrium fountain ----------
  slab([R(-60, 60, -40, 40)], [R(-6, 6, -6, 6), R(44, 54, -7.8, -5.4)], ROOFY, 0xbdbdbd);
  // skylight glass (walkable) with an open hatch in the middle
  slab([R(-6, 6, -6, 6)], [R(-1.5, 1.5, -1.5, 1.5)], ROOFY, 0xa8d8ff);
  railing(-1.5, -1.5, 1.5, -1.5, ROOFY); railing(-1.5, 1.5, 1.5, 1.5, ROOFY); railing(-1.5, -1.5, -1.5, 1.5, ROOFY);
  addSign(scene, 'DO NOT JUMP (please jump)', 0, ROOFY + 1.6, -1.6, 0, 2.4, 0.4, { size: 80, bg: '#ffd23f', fg: '#d32f2f' });
  // roof parapet + rooftop stuff
  for (const [x0, z0, x1, z1] of [[-60, -40, 60, -40], [-60, 40, 60, 40], [-60, -40, -60, 40], [60, -40, 60, 40]]) wall(x0, z0, x1, z1, ROOFY, 1.1, 0xbdbdbd, [], { trim: false });
  for (const [x, z] of [[-40, -20], [-30, 25], [25, -25], [40, 20], [-15, 30]]) { sbox(x, ROOFY + 0.9, z, 3, 1.8, 2.2, 0x90a4ae, { aabb: true }); sbox(x, ROOFY + 1.85, z, 2.6, 0.1, 1.8, 0x546e7a, { collide: false }); }
  cyl(30, ROOFY + 2.2, 30, 0.08, 4.4, 0x9e9e9e); sbox(30, ROOFY + 4.4, 30, 1.6, 1.6, 0.1, 0xeeeeee, { collide: false });
  sbox(-30, ROOFY + 0.02, -10, 8, 0.04, 8, 0xffd23f, { collide: false }); addSign(scene, 'H', -30, ROOFY + 0.05, -10, 0, 4, 4, { bg: null, fg: '#1b1340', size: 230, transparent: true }).rotation.x = -Math.PI / 2;
  addSign(scene, 'ROOFTOP · great view, no refunds', 40, ROOFY + 2.3, -5.2, Math.PI, 3.4, 0.5, { size: 80, bg: '#311b92', fg: '#ffd23f' });

  // ---------- ATRIUM ----------
  railing(-3.6, -6, 6, -6, L2Y); railing(-6, 6, 6, 6, L2Y);
  railing(6, -6, 6, 1.0, L2Y); railing(6, 2.6, 6, 6, L2Y);          // gap = slide entrance
  railing(-6, -3.6, -6, 6, L2Y);                                     // (elevator opens on the x=-6 / z=-6 corner)
  // railings around the escalator + stair openings on L2 (top ends stay open)
  for (const [z0, z1] of [[-5.4, -3.2], [3.2, 5.4]]) railing(8, z0, 8, z1, L2Y);
  railing(-8, -5.4, -8, -3.2, L2Y);
  // fountain (x0,z-3)
  for (const [x, z, w, d] of [[0, -4.6, 4, 0.3], [0, -1.4, 4, 0.3], [-1.85, -3, 0.3, 3.2], [1.85, -3, 0.3, 3.2]]) sbox(x, 0.3, z, w, 0.6, d, 0x90a4ae);
  addAABB(0, -3, 4, 3.5, 0, 0.6);
  fountainWater = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.9), new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
  fountainWater.rotation.x = -Math.PI / 2; fountainWater.position.set(0, 0.45, -3); scene.add(fountainWater);
  cyl(0, 1.1, -3, 0.18, 1.4, 0xb0bec5);
  // palms
  for (const [x, z] of [[-4.5, 4.5], [4.5, 4.5], [-4.5, -0.5]]) {
    sbox(x, 0.35, z, 1.2, 0.7, 1.2, 0x6d4c41, { aabb: true });
    cyl(x, 2.4, z, 0.12, 3.4, 0x795548, 6);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; sbox(x + Math.cos(a) * 0.9, 4.1, z + Math.sin(a) * 0.9, 1.8, 0.1, 0.5, 0x43a047, { collide: false, rotY: -a }); }
  }
  // giant hanging banner
  addSign(scene, 'WELCOME TO MALL MAYHEM · 3 FLOORS OF NONSENSE', 0, 8.3, 5.95, Math.PI, 11, 1.2, { size: 80, bg: '#3fa7ff', fg: '#fff' });
  addSign(scene, 'WELCOME TO MALL MAYHEM · 3 FLOORS OF NONSENSE', 0, 8.3, 6.05, 0, 11, 1.2, { size: 80, bg: '#3fa7ff', fg: '#fff' });
  // escalators (up: z -5..-3.4, down: z 3.4..5) x 8..17, and the west staircase x -17..-8
  for (const [z0, z1, up] of [[-5.3, -3.3, true], [3.3, 5.3, false]]) {
    const w = addRamp(8, 17, z0, z1, 'x', 0, L2Y, { escalator: true, dirX: up ? 1 : -1 });
    const tex = stepTex();
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(9, 5), 0.12, z1 - z0 - 0.3), new THREE.MeshLambertMaterial({ map: tex }));
    ramp.position.set(12.5, 2.5, (z0 + z1) / 2); ramp.rotation.z = Math.atan2(5, 9); scene.add(ramp);
    for (const zz of [z0 + 0.08, z1 - 0.08]) { const side = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(9, 5), 1.0, 0.06), glassMat); side.position.set(12.5, 3.0, zz); side.rotation.z = Math.atan2(5, 9); scene.add(side); }
    addAABB(12.5, z0, 9, 0.2, 0, 7); addAABB(12.5, z1, 9, 0.2, 0, 7);
    addAABB(15.3, (z0 + z1) / 2, 3.4, z1 - z0, 0, 2.2);          // can't walk underneath the high end
    escalators.push({ walk: w, dirX: up ? 1 : -1, dirZ: 0, speed: 0.9, tex, up });
    addSign(scene, up ? 'UP ▲' : 'DOWN ▼', 7.6, 2.4, (z0 + z1) / 2, -Math.PI / 2, 1, 0.35, { size: 110, bg: '#1b1340', fg: '#ffd23f' });
    const oo = signMesh('OUT OF ORDER', 1.4, 0.4, { size: 110, bg: '#ffeb3b', fg: '#d32f2f' }); oo.position.set(7.5, 1.3, (z0 + z1) / 2); oo.rotation.y = -Math.PI / 2; oo.visible = false; scene.add(oo); outOfOrder.push(oo);
  }
  { // staircase
    const w = addRamp(-17, -8, -5.3, -3.3, 'x', L2Y, 0);
    for (let i = 0; i < 18; i++) { const x = -8.25 - i * 0.5, y = (i + 1) * (L2Y / 18); sbox(x, y / 2, -4.3, 0.5, y, 2, 0xbcaaa4, { collide: false }); }
    addAABB(-12.5, -5.35, 9, 0.2, 0, 7); addAABB(-12.5, -3.25, 9, 0.2, 0, 7); addAABB(-15.3, -4.3, 3.4, 2, 0, 2.2);
    railing(-17, -5.3, -8, -5.3, 0); railing(-17, -3.3, -8, -3.3, 0);
    addSign(scene, 'STAIRS', -7.7, 2.4, -4.3, Math.PI / 2, 1, 0.35, { size: 110, bg: '#1b1340', fg: '#fff' });
  }
  // roof staircase from the L2 corridor (x 44..54)
  addRamp(44, 54, -7.7, -5.5, 'x', L2Y, ROOFY);
  for (let i = 0; i < 20; i++) { const x = 44.25 + i * 0.5, y = (i + 1) * 0.25; sbox(x, L2Y + y / 2, -6.6, 0.5, y, 2.1, 0x9e9e9e, { collide: false }); }
  addAABB(49, -5.4, 10, 0.2, L2Y, L2Y + 6); addAABB(51.5, -6.6, 5, 2.2, L2Y, L2Y + 2.2);
  addSign(scene, 'ROOF ACCESS', 43.7, L2Y + 2.3, -6.6, -Math.PI / 2, 1.6, 0.4, { size: 100, bg: '#d32f2f', fg: '#fff' });
  // glass elevator in the atrium corner
  elevator.mesh = new THREE.Group();
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 2.4), mat(0x546e7a)); plat.position.y = -0.1; elevator.mesh.add(plat);
  for (const [x, z, w, d] of [[1.2, 0, 0.06, 2.4], [0, 1.2, 2.4, 0.06]]) { const g = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), glassMat); g.position.set(x, 1.2, z); elevator.mesh.add(g); }
  const roofE = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.4), mat(0x37474f)); roofE.position.y = 2.45; elevator.mesh.add(roofE);
  elevator.mesh.position.set(-4.8, 0, -4.8); scene.add(elevator.mesh);
  movers.push({ minX: elevator.x0, maxX: elevator.x1, minZ: elevator.z0, maxZ: elevator.z1, get y() { return elevator.y; } });
  elevator.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(1.2, 0.1, 1.2)) });
  elevator.body.position.set(-4.8, -0.1, -4.8); elevator.body.allowSleep = false; world.addBody(elevator.body);
  sbox(-6.2, 5, -4.8, 0.2, 10, 2.6, 0x37474f, { collide: false }); // rail column
  addAABB(-3.5, -4.8, 0.1, 2.4, 0, 1.2); // the open sides only block at the bottom so you can step on

  // ---------- SUPERMARKET (x -60..-8, z -40..-8), full height ----------
  const SW = 0x43a047;
  wall(-60, -8, -8, -8, 0, L2Y, SW, [[-30, -24, 3.6]]);
  wall(-60, -8, -8, -8, L2Y, 5, 0xa8d8ff, [], { glass: true });                     // look into the market from L2
  wall(-8, -40, -8, -8, 0, L2Y, SW);
  wall(-8, -40, -8, -8, L2Y, 5, 0xa8d8ff, [], { glass: true });
  addSign(scene, 'MEGA MART', -27, 4.1, -7.82, 0, 10, 1.6, { bg: '#2e7d32', fg: '#fff', size: 170 });
  addSign(scene, 'FRESH · CHEAP · SLIGHTLY CURSED', -45, 4.1, -7.82, 0, 8, 0.9, { bg: '#ffd23f', fg: '#2e7d32', size: 100 });
  ceilLights(-60, -8, -40, -8, 8.6, 6);
  autoDoor(scene, -27, -8, 'x', 6);
  // aisles: 9 long shelves
  const shelfXs = [-46, -42, -38, -34, -30, -26, -22, -18, -14];
  const cats = ['CEREAL', 'SNACKS', 'DRINKS', 'CANNED', 'PAPER', 'MYSTERY', 'BREAD', 'CANDY', 'PET FOOD'];
  const decoColors = PRODUCT_POOL.filter((p) => ITEMS[p].shape === 'box').map((p) => ITEMS[p].color).concat([0xff7043, 0x26a69a, 0x7e57c2, 0xffca28]);
  const productSpawns = [];
  shelfXs.forEach((sx, si) => {
    const z0 = -35, L = 14, zc = z0 + L / 2;
    sbox(sx, 0.05, zc, 0.7, 0.1, L, 0xeeeeee);
    for (const y of [0.62, 1.22, 1.8]) sbox(sx, y, zc, 0.7, 0.04, L, 0xeeeeee, { thick: 0.14 });
    sbox(sx, 1.0, zc, 0.04, 2.0, L, 0xbdbdbd);
    sbox(sx, 1.0, z0, 0.7, 2.0, 0.06, 0x9e9e9e); sbox(sx, 1.0, z0 + L, 0.7, 2.0, 0.06, 0x9e9e9e);
    sbox(sx, 2.1, z0 + L + 0.05, 0.75, 0.25, 0.1, 0xd32f2f, { collide: false });
    addAABB(sx, zc, 0.7, L, 0, 2);
    shelfBounds.push({ minX: sx - 0.45, maxX: sx + 0.45, minZ: z0 - 0.1, maxZ: z0 + L + 0.1 });
    addSign(scene, `AISLE ${si + 1}: ${cats[si]}`, sx + 2, 4.2, zc, Math.PI / 2, 3.4, 0.6, { size: 90, bg: '#2e7d32', fg: '#fff' });
    addSign(scene, `AISLE ${si + 1}: ${cats[si]}`, sx + 2, 4.2, zc + 0.02, -Math.PI / 2, 3.4, 0.6, { size: 90, bg: '#2e7d32', fg: '#fff' });
    for (const side of [-1, 1]) for (let lv = 0; lv < 3; lv++) {
      const y = [0.1, 0.64, 1.24][lv];
      for (let k = 0; k < 25; k++) {
        const z = z0 + 0.35 + k * 0.54, x = sx + side * 0.18;
        const r = Math.random();
        if (lv === 2 || r < 0.62) { const h = rand(0.2, 0.32); sbox(x, y + h / 2, z, 0.22, h, 0.42, pick(decoColors), { collide: false }); }
        else if (r < 0.78) productSpawns.push([x, y + 0.2, z]);
        else Z.slots.push({ x, y, z, id: `s${Z.slots.length}` });
      }
    }
    Z.pois.push([sx + 2, zc + rand(-5, 5)], [sx - 2, zc + rand(-5, 5)]);
  });
  // checkout lanes (conveyor belts) — lanes 1-2 are the Cashier job, 3-4 run on their own
  [-44, -40, -36, -32].forEach((lx, i) => {
    sbox(lx, 0.45, -14, 0.8, 0.9, 3, 0x37474f, { aabb: true });
    const tex = beltTex();
    const belt = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.6), new THREE.MeshLambertMaterial({ map: tex }));
    belt.rotation.x = -Math.PI / 2; belt.position.set(lx, 0.912, -14.7); scene.add(belt);
    conveyors.push({ minX: lx - 0.32, maxX: lx + 0.32, minZ: -15.5, maxZ: -13.95, y: 0.91, vx: 0, vz: 0.45, tex });
    sbox(lx, 0.94, -13.6, 0.5, 0.02, 0.35, 0xff1744, { collide: false, basic: true });
    sbox(lx - 0.35, 1.3, -12.8, 0.08, 0.8, 0.08, 0x90a4ae); const n = signMesh(String(i + 1), 0.35, 0.35, { bg: '#ffd23f', size: 200 }); n.position.set(lx - 0.35, 1.85, -12.8); scene.add(n);
    const n2 = n.clone(); n2.rotation.y = Math.PI; scene.add(n2);
  });
  for (const r of Z.registers) {
    r.scan = { x: r.x, y: 1.0, z: -13.6 };
    r.itemSpawn = { x: r.x, y: 1.05, z: -15.2 };
    r.customer = { x: r.x + 0.9, z: -14 };
    r.cashier = { x: r.x - 0.9, z: -14 };
  }
  // self-checkout machines
  Z.selfCheckouts = [];
  for (const sx of [-20, -17, -14]) {
    sbox(sx, 0.5, -13, 0.9, 1.0, 0.7, 0xeceff1, { aabb: true });
    sbox(sx, 1.02, -13, 0.4, 0.02, 0.3, 0x00e676, { collide: false, basic: true });
    sbox(sx, 1.45, -13.3, 0.6, 0.45, 0.06, 0x263238, { collide: false });
    Z.selfCheckouts.push({ x: sx, y: 1.02, z: -13 });
  }
  addSign(scene, 'SELF CHECKOUT · we trust you (we don\'t)', -17, 2.4, -13.6, 0, 4.4, 0.4, { size: 80, bg: '#00897b', fg: '#fff' });
  // wall fridges (north wall) + chest freezers (east wall)
  for (let x = -45; x < -10; x += 2) {
    sbox(x, 1.1, -39.4, 1.9, 2.2, 0.8, 0xe0e0e0);
    sbox(x, 1.1, -39.02, 1.8, 2.0, 0.04, 0xa8d8ff, { glass: true, collide: false });
    for (const y of [0.5, 1.1, 1.7]) for (let k = 0; k < 5; k++) sbox(x - 0.7 + k * 0.35, y, -39.4, 0.2, 0.3, 0.2, pick([0xe53935, 0x1e88e5, 0xffffff, 0xffd23f, 0x43a047]), { collide: false });
    sbox(x, 2.3, -39.0, 1.9, 0.1, 0.1, 0x81d4fa, { collide: false, basic: true });
  }
  addAABB(-27.5, -39.4, 35, 0.9, 0, 2.3);
  addSign(scene, 'FROZEN · COLD · BRRR', -27, 3.2, -38.95, 0, 6, 0.6, { size: 110, bg: '#0277bd', fg: '#fff' });
  Z.freezers = [];
  for (const fz of [-34, -29, -24]) {
    for (const [x, z, w, d] of [[-10.3, fz, 0.1, 3.6], [-9.3, fz, 0.1, 3.6], [-9.8, fz - 1.8, 1, 0.1], [-9.8, fz + 1.8, 1, 0.1]]) sbox(x, 0.45, z, w, 0.9, d, 0xeceff1);
    sbox(-9.8, 0.2, fz, 1, 0.4, 3.6, 0x4fc3f7);
    addAABB(-9.8, fz, 1.1, 3.7, 0, 0.9);
    Z.freezers.push({ x: -9.8, z: fz });
  }
  // produce + bakery (west)
  for (const [x, z] of [[-56, -22], [-52, -22], [-56, -16], [-52, -16]]) { sbox(x, 0.45, z, 2.4, 0.9, 1.6, 0x8d6e63, { aabb: true }); sbox(x, 0.9, z, 2.2, 0.02, 1.4, 0x5d4037, { collide: false }); }
  Z.produce = [[-56, -22], [-52, -22], [-56, -16], [-52, -16]];
  addSign(scene, 'PRODUCE', -54, 3.4, -24.5, 0, 3, 0.6, { size: 110, bg: '#7cb342', fg: '#fff' });
  sbox(-54, 0.5, -11, 6, 1.0, 1, 0xffe0b2, { aabb: true }); addSign(scene, 'BAKERY · fresh-ish', -54, 2.6, -10.45, 0, 3, 0.5, { size: 90, bg: '#a1887f', fg: '#fff' });
  // stockroom
  wall(-48, -40, -48, -27, 0, L2Y, 0x9e9e9e, [[-31, -29, 2.8]]); wall(-60, -27, -48, -27, 0, L2Y, 0x9e9e9e);
  sbox(-48, 3.6, -30, T, 0.4, 2.4, 0x9e9e9e, { collide: false });
  addSign(scene, 'STOCKROOM · EMPLOYEES ONLY', -47.82, 3.2, -30, Math.PI / 2, 3, 0.4, { size: 80, bg: '#d32f2f', fg: '#fff' });
  sbox(-54, 0.5, -39, 5, 1, 1.4, 0x6d4c41, { aabb: true });
  for (const [x, z] of [[-57, -34], [-53, -34], [-57, -30], [-53, -30]]) sbox(x, 0.08, z, 1.4, 0.16, 1.2, 0xa1887f);  // pallets
  sbox(-59.8, 1.8, -33, 0.1, 3.4, 4, 0x78909c, { collide: false }); addSign(scene, 'LOADING DOCK', -59.7, 3.8, -33, Math.PI / 2, 2, 0.35, { size: 90, bg: '#37474f', fg: '#ffd23f' });
  // cart corral
  sbox(-10.5, 0.5, -10, 0.1, 1, 3, 0x9e9e9e); sbox(-8.9, 0.5, -10, 0.1, 1, 3, 0x9e9e9e);
  addSign(scene, 'CARTS', -9.7, 1.4, -8.4, 0, 1.2, 0.3, { size: 100, bg: '#d32f2f', fg: '#fff' });
  for (const [x, z] of [[-54, -29], [-50, -20], [-30, -27], [-22, -17], [-40, -17], [-14, -24]]) Z.pois.push([x, z]);

  // ---------- FOOD COURT (x 8..46, z -40..-8), double height, open to the corridor ----------
  ceilLights(8, 46, -40, -8, 8.6, 7);
  const rests = [['CHOW TOWN', 8, 17.5, '#ff7043'], ['PIZZA PLAZA', 17.5, 27.5, '#e53935'], ['TACO TORNADO', 27.5, 37.5, '#ffb300'], ['NOODLE NOOK', 37.5, 46, '#00897b']];
  Z.restaurants = [];
  rests.forEach(([name, x0, x1, col], i) => {
    const cx = (x0 + x1) / 2;
    wall(x0, -40, x0, -33.5, 0, 4.2, 0xffccbc);
    sbox(cx, 0.5, -34, x1 - x0 - 2, 1, 0.8, parseInt(col.slice(1), 16), { aabb: true });
    sbox(cx, 1.02, -34, x1 - x0 - 1.9, 0.04, 0.85, 0xfafafa);
    sbox(cx, 3.8, -33.6, x1 - x0, 1.2, 0.3, 0xffffff, { collide: false });
    addSign(scene, name, cx, 3.8, -33.44, 0, x1 - x0 - 1, 1.0, { bg: col, fg: '#fff', size: 140 });
    Z.restaurants.push({ name, x: cx, z: -34 });
    if (i > 0) { // decorative kitchen kit
      sbox(cx - 2, 0.5, -38.8, 1.6, 1, 0.9, 0x616161, { aabb: true });
      sbox(cx + 1.5, 0.5, -38.8, 2, 1, 0.9, 0xbdbdbd, { aabb: true });
    }
  });
  wall(46, -40, 46, -33.5, 0, 4.2, 0xffccbc);
  // Chow Town kitchen (food job)
  sbox(Z.grill.x, 0.47, Z.grill.z, 1.4, 0.94, 0.8, 0x424242, { aabb: true });
  sbox(Z.grill.x, 0.95, Z.grill.z, 1.3, 0.02, 0.7, 0xff3d00, { collide: false, basic: true });
  sbox(Z.prep.x, 0.47, Z.prep.z, 3, 0.94, 0.8, 0xbdbdbd, { aabb: true });
  sbox(Z.serve.x, 1.045, Z.serve.z, Z.serve.w, 0.01, Z.serve.d, 0x26c6da, { collide: false, basic: true });
  addSign(scene, 'SERVE', Z.serve.x, 1.25, Z.serve.z + 0.43, 0, 0.6, 0.18, { size: 120, bg: '#26c6da', fg: '#fff' });
  // seating
  Z.tables = [];
  for (let tx = 12; tx <= 42; tx += 6) for (let tz = -29; tz <= -13; tz += 5.5) {
    sbox(tx, 0.74, tz, 1.2, 0.06, 1.2, 0xffffff, { thick: 0.14 }); sbox(tx, 0.37, tz, 0.12, 0.72, 0.12, 0x9e9e9e);
    addAABB(tx, tz, 0.5, 0.5, 0, 0.8);
    Z.tables.push([tx, tz]); Z.pois.push([tx + 1, tz]);
  }
  // ---------- BATHROOMS (x 46..60, z -22..-8) ----------
  wall(46, -8, 60, -8, 0, 4, 0x80deea, [[47.5, 49.5, 2.5], [56.5, 58.5, 2.5]]);
  wall(46, -22, 46, -8, 0, 4, 0x80deea); wall(53, -22, 53, -8, 0, 4, 0x80deea); wall(46, -22, 60, -22, 0, 4, 0x80deea);
  slab([R(46, 60, -22, -8)], [], 4, 0xe0f7fa, { walk: false });
  addSign(scene, 'BOYS 🚹', 48.5, 2.9, -7.82, 0, 1.6, 0.4, { size: 100, bg: '#1e88e5', fg: '#fff' });
  addSign(scene, 'GIRLS 🚺', 57.5, 2.9, -7.82, 0, 1.6, 0.4, { size: 100, bg: '#d81b60', fg: '#fff' });
  Z.stalls = [];
  for (const [x0] of [[46], [53]]) for (let s = 0; s < 3; s++) {
    const sx = x0 + 0.6 + s * 2.1;
    sbox(sx + 1.0, 1.0, -20.5, 0.06, 2.0, 3, 0xb0bec5, { aabb: true });          // partition
    sbox(sx + 0.5, 0.25, -21.4, 0.5, 0.5, 0.7, 0xffffff, { aabb: true });           // toilet
    sbox(sx + 0.5, 0.75, -21.85, 0.5, 0.6, 0.2, 0xffffff);
    Z.stalls.push({ x: sx + 0.5, z: -21.75, door: [sx, -19, sx + 0.95] });
  }
  for (const x0 of [46, 53]) { sbox(x0 + 5.5, 0.85, -9.2, 1.6, 0.15, 0.6, 0xffffff); sbox(x0 + 5.5, 1.8, -8.25, 1.8, 1.0, 0.04, 0xcfd8dc, { collide: false }); }
  // ---------- STAFF / STORAGE (x 46..60, z -40..-23) ----------
  wall(46, -40, 46, -23, 0, 4, 0x9e9e9e, [[-30, -28, 2.6]]); wall(46, -23, 60, -23, 0, 4, 0x9e9e9e);
  wall(53, -40, 53, -32, 0, 3, 0x546e7a, [[-35, -33.5, 2.4]]); wall(53, -32, 60, -32, 0, 3, 0x546e7a);
  slab([R(46, 60, -40, -23)], [], 4, 0x9e9e9e, { walk: false });
  addSign(scene, 'STAFF ONLY', 45.82, 3.0, -29, -Math.PI / 2, 1.8, 0.4, { size: 110, bg: '#d32f2f', fg: '#fff' });
  addSign(scene, 'SECURITY', 53.2, 2.6, -34.2, Math.PI / 2, 1.4, 0.35, { size: 110, bg: '#1565c0', fg: '#fff' });
  sbox(56.5, 0.5, -39, 5, 1, 1, 0x37474f, { aabb: true });
  for (let i = 0; i < 4; i++) { const tv = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.6), new THREE.MeshBasicMaterial({ color: 0x00e676 })); tv.position.set(54.8 + i * 1.2, 1.7, -39.45); scene.add(tv); tvScreens.push(tv); }
  sbox(48, 1.0, -39, 2.8, 2, 0.8, 0x6d4c41, { aabb: true }); sbox(50.5, 0.25, -38.8, 0.6, 0.5, 1.6, 0x455a64, { aabb: true });
  addSign(scene, 'JANITOR', 50.5, 1.6, -39.6, 0, 1.4, 0.35, { size: 110, bg: '#1565c0', fg: '#fff' });

  // ---------- SOUTH-WEST: TOY TORNADO (double height), DRIP DEPOT, COMFY KINGDOM ----------
  wall(-60, 8, -34, 8, 0, L2Y, 0x7e57c2, [[-50, -42, 4]]);
  wall(-34, 8, -34, 40, 0, ROOFY, 0x7e57c2);
  addSign(scene, 'TOY TORNADO', -46, 5.6, 7.82, Math.PI, 9, 1.6, { bg: '#7e57c2', fg: '#ffd23f', size: 170 });
  ceilLights(-60, -34, 8, 40, 9.5, 7);
  for (const [x, z, w, d] of [[-52, 22, 8, 0.25], [-52, 30, 8, 0.25], [-56, 26, 0.25, 8], [-48, 26, 0.25, 8]]) sbox(x, 0.35, z, w, 0.7, d, 0xff4081, { aabb: true });
  addSign(scene, 'MEGA BALL PIT', -52, 1.2, 21.86, Math.PI, 2.6, 0.45, { size: 110, bg: '#ff4081', fg: '#fff' });
  sbox(-40, 0.4, 16, 3, 0.8, 1.6, 0xffca28, { aabb: true });
  sbox(-37, 0.7, 38.5, 5, 1.4, 1, 0x8e24aa, { aabb: true });
  sbox(-58.5, 1.5, 18, 1, 3, 6, 0x37474f, { aabb: true }); addSign(scene, 'FOAM BLASTERS (free!)', -57.9, 3.3, 18, Math.PI / 2, 3, 0.5, { size: 90, bg: '#ff6d00', fg: '#fff' });
  // giant teddy statue
  sbox(-44, 1.6, 33, 2.2, 3.2, 1.6, 0x8d6e63, { aabb: true }); sbox(-44, 3.8, 33, 1.6, 1.4, 1.4, 0x8d6e63, { collide: false });
  sbox(-44.7, 4.6, 33, 0.5, 0.5, 0.3, 0x6d4c41, { collide: false }); sbox(-43.3, 4.6, 33, 0.5, 0.5, 0.3, 0x6d4c41, { collide: false });
  Z.toyTables = [-40, 16]; Z.blasterRack = [-58, 1.2, 18];
  for (const [x, z] of [[-45, 14], [-40, 22], [-52, 35], [-38, 30]]) Z.pois.push([x, z]);
  // Drip Depot (x -33..-8, z 8..23), L2 above
  wall(-34, 8, -8, 8, 0, L2Y, 0xec407a, [[-24, -18, 3.4]]);
  wall(-8, 8, -8, 23, 0, L2Y, 0xec407a); wall(-34, 23, -8, 23, 0, L2Y, 0xec407a);
  addSign(scene, 'DRIP DEPOT', -21, 4.1, 7.82, Math.PI, 7, 1.3, { bg: '#ec407a', fg: '#fff', size: 160 });
  ceilLights(-33, -8, 8, 23, 4.6, 6);
  for (const rx of [-30, -26, -14, -11]) for (const rz of [12, 16, 20]) {
    sbox(rx, 1.3, rz, 0.06, 0.06, 1.6, 0x9e9e9e); sbox(rx, 0.65, rz - 0.75, 0.06, 1.3, 0.06, 0x9e9e9e); sbox(rx, 0.65, rz + 0.75, 0.06, 1.3, 0.06, 0x9e9e9e);
    for (let i = 0; i < 5; i++) sbox(rx, 0.95, rz - 0.6 + i * 0.3, 0.4, 0.6, 0.06, pick([0xe53935, 0x1e88e5, 0xffd23f, 0x43a047, 0x8e24aa, 0xff4f9a]), { collide: false });
    addAABB(rx, rz, 0.5, 1.7, 0, 1.6);
  }
  sbox(-21, 1.5, 22.7, 2.4, 3, 0.15, 0xffc107, { aabb: true });
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.7), new THREE.MeshBasicMaterial({ color: 0x9ec9e8 }));
  mirror.position.set(-21, 1.5, 22.6); mirror.rotation.y = Math.PI; scene.add(mirror);
  addSign(scene, 'STYLE STATION', -24.4, 2.6, 22.6, Math.PI, 1.6, 0.35, { size: 100, bg: '#ff4f9a', fg: '#fff' });
  Z.styleStation = [-24.4, 1.4, 22.55]; Z.mannequin = [-21, 0, 21.3];
  for (const [x, z] of [[-28, 14], [-18, 18], [-12, 12]]) Z.pois.push([x, z]);
  // Comfy Kingdom furniture (x -33..-8, z 23..40), double height
  wall(-8, 23, -8, 40, 0, ROOFY, 0x8d6e63, [[28, 34, 3.6]]);
  addSign(scene, 'COMFY KINGDOM', -7.82, 5.2, 31, Math.PI / 2, 8, 1.3, { bg: '#8d6e63', fg: '#fff', size: 150 });
  ceilLights(-33, -8, 23, 40, 9.5, 7);
  Z.beds = [];
  for (const [x, z, c] of [[-30, 27, 0xe57373], [-24, 27, 0x64b5f6], [-18, 27, 0xffd54f]]) {
    sbox(x, 0.3, z, 2.0, 0.6, 2.4, 0x6d4c41); sbox(x, 0.62, z + 0.2, 1.9, 0.08, 1.9, c, { collide: false }); sbox(x, 0.9, z - 1.1, 2.0, 1.2, 0.15, 0x5d4037, { aabb: true });
    addAABB(x, z, 2.0, 2.4, 0, 0.6); addWalk(x - 1, x + 1, z - 1, z + 1.2, 0.62, { bounce: 6.5 });
    Z.beds.push([x, z]);
  }
  for (const [x, z, c] of [[-28, 34, 0x7986cb], [-20, 34, 0xa1887f], [-13, 30, 0x4db6ac]]) {
    sbox(x, 0.25, z, 2.6, 0.5, 1.0, c, { aabb: true }); sbox(x, 0.7, z + 0.4, 2.6, 0.9, 0.2, c, { aabb: true });
    sbox(x - 1.2, 0.5, z, 0.2, 0.5, 1.0, c); sbox(x + 1.2, 0.5, z, 0.2, 0.5, 1.0, c);
  }
  for (const [x, z, c] of [[-24, 31, 0xffab91], [-14, 37, 0xce93d8]]) sbox(x, 0.012, z, 3, 0.01, 2, c, { collide: false });
  for (const [x, z] of [[-25, 30], [-15, 33]]) Z.pois.push([x, z]);

  // ---------- SOUTH-EAST: PIXEL PALACE ARCADE, VOLT CITY, CINEMA ----------
  wall(8, 8, 31, 8, 0, L2Y, 0x283593, [[16, 22, 3.6]]);
  wall(8, 8, 8, 40, 0, ROOFY, 0x283593); wall(31, 8, 31, 40, 0, ROOFY, 0x283593);
  addSign(scene, 'PIXEL PALACE', 19, 4.1, 7.82, Math.PI, 8, 1.3, { bg: '#1a237e', fg: '#00e5ff', size: 160 });
  ceilLights(8, 31, 26, 40, 9.5, 6); ceilLights(8, 31, 8, 26, 4.6, 6);
  for (let i = 0; i < 6; i++) {
    const cz = 12 + i * 2.6;
    sbox(30.2, 0.9, cz, 0.9, 1.8, 0.9, 0x1a1a2e, { aabb: true });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
    scr.position.set(29.73, 1.35, cz); scr.rotation.y = -Math.PI / 2; scene.add(scr); arcadeScreens.push(scr);
    sbox(8.8, 0.9, cz, 0.9, 1.8, 0.9, 0x1a1a2e, { aabb: true });
    const scr2 = scr.clone(); scr2.material = scr.material.clone(); scr2.position.set(9.27, 1.35, cz); scr2.rotation.y = Math.PI / 2; scene.add(scr2); arcadeScreens.push(scr2);
  }
  sbox(Z.hoop.x, 2.75, 39.55, 1.2, 0.8, 0.06, 0xffffff);
  sbox(Z.hoop.x, 1.4, 39.75, 0.15, 2.8, 0.15, 0x616161);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(Z.hoop.r, 0.018, 6, 16), mat(0xff3d00));
  ring.rotation.x = Math.PI / 2; ring.position.set(Z.hoop.x, Z.hoop.y, Z.hoop.z); scene.add(ring);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; addStaticBody(Z.hoop.x + Math.cos(a) * Z.hoop.r, Z.hoop.y, Z.hoop.z + Math.sin(a) * Z.hoop.r, 0.04, 0.04, 0.04); }
  addSign(scene, 'HOOP SHOT  $3/basket', Z.hoop.x, 3.5, 39.6, Math.PI, 2.4, 0.4, { size: 110, bg: '#ff3d00', fg: '#fff' });
  sbox(14, 0.5, 35.5, 1.2, 1, 0.5, 0x37474f, { aabb: true });
  Z.whack = { x: 24, z: 34 };
  sbox(Z.whack.x, 0.45, Z.whack.z, 2.2, 0.9, 1.2, 0x311b92, { aabb: true });
  addSign(scene, 'WHACK-A-BUTTON', Z.whack.x, 1.9, Z.whack.z + 0.62, Math.PI, 2.2, 0.4, { size: 110, bg: '#00e5ff', fg: '#1a237e' });
  sbox(19, 0.6, 38.8, 6, 1.2, 1, 0xffd23f, { aabb: true }); addSign(scene, 'PRIZES · tickets not accepted', 19, 2.0, 38.25, Math.PI, 4, 0.5, { size: 90, bg: '#ff4f9a', fg: '#fff' });
  gateMesh = new THREE.Group();
  for (let i = 0; i < 13; i++) { const b = new THREE.Mesh(unitBox, mat(0xb0bec5)); b.scale.set(0.06, 3.4, 0.06); b.position.set(16.25 + i * 0.47, 1.7, 8); gateMesh.add(b); }
  const lockS = signMesh('LOCKED · unlock in wrist menu', 3, 0.4, { size: 90, bg: '#d32f2f', fg: '#fff' });
  lockS.position.set(19, 1.5, 7.8); lockS.rotation.y = Math.PI; gateMesh.add(lockS);
  scene.add(gateMesh);
  gateBody = addStaticBody(19, 1.7, 8, 6, 3.4, 0.2);
  gateAABB = addAABB(19, 8, 6, 0.2, 0, 3.4, 'gate');
  // Volt City electronics (x 31..60, z 8..25)
  wall(31, 8, 60, 8, 0, L2Y, 0x0d47a1, [[42, 48, 3.6]]); wall(31, 25, 60, 25, 0, L2Y, 0x0d47a1, [[50, 54, 3.2]]);
  addSign(scene, 'CINEMA ▶', 52, 3.6, 24.8, Math.PI, 2, 0.45, { size: 100, bg: '#4a148c', fg: '#ffd23f' });
  addSign(scene, 'VOLT CITY', 45, 4.1, 7.82, Math.PI, 7, 1.3, { bg: '#0d47a1', fg: '#ffd23f', size: 160 });
  ceilLights(31, 60, 8, 25, 4.6, 6);
  for (let i = 0; i < 8; i++) {
    const x = 33.5 + i * 3.2;
    sbox(x, 1.9, 24.75, 2.9, 1.7, 0.1, 0x111111, { collide: false });
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.5), new THREE.MeshBasicMaterial({ color: 0x3fa7ff }));
    tv.position.set(x, 1.9, 24.68); tv.rotation.y = Math.PI; scene.add(tv); tvScreens.push(tv);
  }
  for (const [x, z] of [[37, 14], [45, 14], [53, 14], [41, 19], [49, 19]]) { sbox(x, 0.45, z, 2.6, 0.9, 1.2, 0xeceff1, { aabb: true }); Z.pois.push([x, z - 1.5]); }
  Z.gadgetTables = [[37, 14], [45, 14], [53, 14], [41, 19], [49, 19]];
  // Cinema (x 31..60, z 25..40), double height. A suspicious poster hides the BACKROOMS.
  wall(31, 25, 60, 25, L2Y, 5, 0x4a148c);
  addSign(scene, 'CINEMA 12', 45, 6.5, 25.2, 0, 7, 1.3, { bg: '#4a148c', fg: '#ffd23f', size: 160 });
  sbox(45, 0.6, 30, 6, 1.2, 1, 0xb71c1c, { aabb: true }); addSign(scene, 'TICKETS', 45, 2.0, 29.45, 0, 2, 0.4, { size: 110, bg: '#ffd23f', fg: '#b71c1c' });
  sbox(36, 0.9, 38.5, 1.4, 1.8, 1, 0xffeb3b, { aabb: true }); addSign(scene, 'POPCORN', 36, 2.1, 37.95, Math.PI, 1.4, 0.35, { size: 110, bg: '#d32f2f', fg: '#fff' });
  const films = ['ATTACK OF THE\nSHOPPING CARTS', 'MALL COP 7:\nCARDIO', 'THE GRANDMA\nWHO KNEW TOO MUCH', 'FROZEN AISLE\n(not that one)', 'BABY ASH:\nTHE MOVIE'];
  films.forEach((f, i) => poster(scene, f, 33 + i * 5, 2.2, 39.8, Math.PI, ['#311b92', '#b71c1c', '#004d40', '#0277bd', '#212121'][i], '#ffd23f'));
  for (const [x0, x1] of [[33, 39], [42, 48], [51, 57]]) sbox((x0 + x1) / 2, 1.6, 25.2, x1 - x0 - 2, 3.0, 0.1, 0x7b1fa2, { collide: false });
  // the fake wall: a poster on the east wall you can walk straight through (x=60, z 32..39)
  poster(scene, 'STAFF ONLY\n(definitely a wall)', 59.8, 1.7, 35.5, -Math.PI / 2, '#9e9e9e', '#212121', 3.2, 3.0);
  for (const [x, z] of [[40, 34], [52, 33]]) Z.pois.push([x, z]);
  // BACKROOMS secret (x 60..73, z 30..40)
  wall(60, 30, 73, 30, 0, 3, 0xd4c25f); wall(60, 40, 73, 40, 0, 3, 0xd4c25f); wall(73, 30, 73, 40, 0, 3, 0xd4c25f);
  wall(64, 30, 64, 36, 0, 3, 0xd4c25f); wall(68, 34, 68, 40, 0, 3, 0xd4c25f);
  slab([R(60, 73, 30, 40)], [], 3, 0xe6d97a, { walk: false });
  ceilLights(60, 73, 30, 40, 2.95, 3.5);
  addSign(scene, 'EXIT', 72.8, 2.4, 32, -Math.PI / 2, 1, 0.35, { size: 120, bg: '#2e7d32', fg: '#fff' });
  addSign(scene, 'you are not supposed to be here', 66, 1.5, 39.8, Math.PI, 2.8, 0.35, { size: 70, bg: null, fg: '#5d4b0f', transparent: true });
  Z.backrooms = [70, 37];

  // ---------- CORRIDOR DRESSING (L1) ----------
  for (const x of [-52, -38, -14, 14, 26, 38, 52]) for (const z of [-7.2, 7.2]) sbox(x, 2.35, z, 0.6, 4.7, 0.6, 0xfafafa, { aabb: true });
  for (const x of [-48, -24, 24, 36]) { sbox(x, 0.42, 0, 2.2, 0.08, 0.6, 0x8d6e63, { aabb: true }); sbox(x, 0.2, 0, 2, 0.4, 0.4, 0x5d4037); }
  for (const x of [-42, -18, 30, 50]) { sbox(x, 0.35, -2.5, 1.2, 0.7, 1.2, 0x6d4c41, { aabb: true }); cyl(x, 1.4, -2.5, 0.08, 1.6, 0x795548, 6); sbox(x, 2.4, -2.5, 1.4, 0.8, 1.4, 0x43a047, { collide: false }); }
  // kiosk carts
  sbox(-36, 0.55, 3, 2.4, 1.1, 1.2, 0xff8a65, { aabb: true }); sbox(-36, 2.2, 3, 2.6, 0.1, 1.4, 0xffffff, { collide: false }); addSign(scene, 'PRETZELS', -36, 2.5, 3.72, 0, 2, 0.4, { size: 110, bg: '#ff8a65', fg: '#fff' });
  sbox(42, 0.55, 3, 2.4, 1.1, 1.2, 0x4dd0e1, { aabb: true }); sbox(42, 2.2, 3, 2.6, 0.1, 1.4, 0xffffff, { collide: false }); addSign(scene, 'PHONE CASES 4 U', 42, 2.5, 3.72, 0, 2.2, 0.4, { size: 90, bg: '#4dd0e1', fg: '#fff' });
  // ads
  const ads = [['BUY MORE\nSTUFF!', '#ff4f9a'], ['NEW!\nAIR (canned)', '#3fa7ff'], ['GRANDMA\nAPPROVED', '#7cb342'], ['WIN A\nSHOPPING CART', '#ffb300'], ['SALE!\n0% OFF', '#e53935'], ['PRETZELS:\nTHE MOVIE', '#8e24aa']];
  ads.forEach(([t, c], i) => { const x = -50 + i * 18; if (Math.abs(x) < 9) return; poster(scene, t, x + 3, 2.4, -7.8, 0, c); poster(scene, t, x - 3, 2.4, 7.8, Math.PI, c); });
  ceilLights(-60, 60, -8, 8, 4.62, 8); ceilLights(-8, 8, -40, -8, 4.62, 8); ceilLights(-8, 8, 8, 40, 9.5, 8);
  // south corridor (double height, glass doors to the plaza) + north corridor end vending wall
  autoDoor(scene, 0, 40, 'x', 8);
  for (const x of [-6.5, -5.2, 5.2, 6.5]) { sbox(x, 0.9, -39.4, 1.0, 1.8, 0.8, pick([0xd32f2f, 0x1565c0, 0x2e7d32]), { aabb: true }); }
  addSign(scene, 'VENDING ZONE · snacks of questionable age', 0, 2.8, -39.8, 0, 6, 0.5, { size: 80, bg: '#263238', fg: '#ffd23f' });
  for (const [x, z] of [[-40, 2], [-20, -4], [20, 4], [40, -3], [0, 25], [0, -25], [-50, -4], [50, 4], [3, 20], [-3, -20]]) Z.pois.push([x, z]);

  // ---------- L2 (y=5) ----------
  // corridor edges: glass looking into the market & toy store, railings over the food court + south corridor
  railing(8, -8, 46, -8, L2Y); railing(8, -40, 8, -8, L2Y); railing(-8, 8, -8, 23, L2Y);
  wall(46, -8, 60, -8, L2Y, 5, 0xd7ccc8);
  wall(-60, 8, -34, 8, L2Y, 5, 0xa8d8ff, [], { glass: true });
  wall(31, 8, 60, 8, L2Y, 5, 0xd7ccc8);
  ceilLights(-60, 60, -8, 8, 9.6, 8);
  // Bounce Zone trampolines (x 8..31, z 8..26)
  wall(8, 8, 31, 8, L2Y, 5, 0xff6d00, [[12, 18, 3.4]]); wall(8, 26, 31, 26, L2Y, 5, 0xa8d8ff, [], { glass: true });
  addSign(scene, 'BOUNCE ZONE', 15, L2Y + 3.9, 7.82, Math.PI, 6, 1.2, { bg: '#ff6d00', fg: '#fff', size: 160 });
  ceilLights(8, 31, 8, 26, 9.6, 6);
  Z.trampolines = [];
  for (let tx = 12; tx <= 28; tx += 4) for (let tz = 12; tz <= 22; tz += 5) {
    sbox(tx, L2Y + 0.15, tz, 3, 0.3, 3, 0x212121); sbox(tx, L2Y + 0.31, tz, 2.6, 0.02, 2.6, 0x1e88e5, { collide: false });
    addWalk(tx - 1.3, tx + 1.3, tz - 1.3, tz + 1.3, L2Y + 0.32, { bounce: 9 });
    Z.trampolines.push([tx, tz]);
  }
  Z.foamPit = [28, 24];
  // bookstore + manager's office on top of Drip Depot (x -33..-8, z 8..23)
  wall(-34, 8, -21, 8, L2Y, 5, 0x6d4c41, [[-29, -25, 3]]);
  wall(-34, 23, -8, 23, L2Y, 5, 0xa8d8ff, [], { glass: true });
  wall(-21, 8, -21, 23, L2Y, 5, 0x6d4c41, [[18, 21, 3]]);
  addSign(scene, 'PAGE TURNER BOOKS', -27, L2Y + 3.8, 7.82, Math.PI, 6, 1, { bg: '#6d4c41', fg: '#fff', size: 120 });
  ceilLights(-33, -8, 8, 23, 9.6, 6);
  for (let i = 0; i < 4; i++) { const z = 11 + i * 3; sbox(-33.3, L2Y + 1.2, z, 0.5, 2.4, 2.4, 0x5d4037, { aabb: true }); for (let k = 0; k < 4; k++) sbox(-33.05, L2Y + 0.4 + k * 0.55, z, 0.05, 0.4, 2.2, pick([0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825]), { collide: false }); }
  // manager's office (x -21..-8, z 8..15): only reachable through the bookshelf door from the corridor
  wall(-21, 15, -8, 15, L2Y, 5, 0x37474f);
  wall(-21, 8, -8, 8, L2Y, 5, 0x37474f, [[-17, -15, 2.6]]);
  secretShelf = new THREE.Group();
  const shelfMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, 0.4), mat(0x5d4037)); shelfMesh.position.y = 1.3; secretShelf.add(shelfMesh);
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.05), mat(pick([0xc62828, 0x1565c0, 0x2e7d32]))); b.position.set(0, 0.4 + k * 0.6, -0.22); secretShelf.add(b); }
  secretShelf.position.set(-16, L2Y, 7.75); scene.add(secretShelf);
  secretShelf.userData.aabb = addAABB(-16, 7.75, 2, 0.4, L2Y, L2Y + 2.6);
  secretShelf.userData.body = addStaticBody(-16, L2Y + 1.3, 7.75, 2, 2.6, 0.4);
  Z.secretBook = [-15.3, L2Y + 1.0, 7.52];
  sbox(-14.5, L2Y + 0.4, 12, 3, 0.8, 1.2, 0x4e342e, { aabb: true });
  sbox(-14.5, L2Y + 0.6, 13.5, 0.9, 1.2, 0.9, 0xffc107, { aabb: true });
  poster(scene, 'EMPLOYEE\nOF THE MONTH:\nTHE MOP', -10, L2Y + 2, 14.8, Math.PI, '#ffd23f', '#1b1340', 1.4, 1.8);
  Z.office = [-12, L2Y, 11];
  // Sky Cafe (x -8..8, z -40..-24) + north walkway
  railing(-8, -24, -8, -8, L2Y);
  addSign(scene, 'SKY CAFE', 0, L2Y + 3.5, -23.8, 0, 5, 1, { bg: '#795548', fg: '#fff', size: 150 });
  sbox(0, L2Y + 0.5, -38.6, 8, 1, 1, 0x8d6e63, { aabb: true }); Z.coffee = [2, L2Y + 1.0, -38.6];
  for (const [x, z] of [[-4, -33], [3, -33], [-4, -28], [3, -28]]) { sbox(x, L2Y + 0.74, z, 1.1, 0.06, 1.1, 0xffffff, { thick: 0.14 }); sbox(x, L2Y + 0.37, z, 0.12, 0.72, 0.12, 0x9e9e9e); addAABB(x, z, 0.5, 0.5, L2Y, L2Y + 0.8); Z.pois2.push([x + 1, z]); }
  ceilLights(-8, 8, -40, -8, 9.6, 6);
  // the SUPER SLIDE: L2 balcony -> atrium floor (fast!)
  addRamp(-5, 6, 1.0, 2.6, 'x', 0.35, L2Y, { slide: true });
  { const len = Math.hypot(11, L2Y - 0.35); const sl = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 1.6), mat(0xffd23f)); sl.position.set(0.5, (L2Y + 0.35) / 2, 1.8); sl.rotation.z = Math.atan2(L2Y - 0.35, 11); scene.add(sl);
    for (const zz of [1.0, 2.6]) { const s2 = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.08), mat(0xff4f9a)); s2.position.set(0.5, (L2Y + 0.35) / 2 + 0.25, zz); s2.rotation.z = sl.rotation.z; scene.add(s2); } }
  addAABB(0.5, 0.95, 11, 0.1, 0, 7); addAABB(0.5, 2.65, 11, 0.1, 0, 7); addAABB(3.5, 1.8, 5, 1.6, 0, 2.0);
  addSign(scene, 'SUPER SLIDE ▶', 6.4, L2Y + 2.0, 1.8, -Math.PI / 2, 1.8, 0.4, { size: 100, bg: '#ff4f9a', fg: '#fff' });
  for (const [x, z] of [[-30, 0], [-10, 3], [10, -2], [25, 3], [40, -3], [-45, -3], [0, -15], [-25, 15], [20, 15], [70, 0], [75, -15], [78, 15]]) Z.pois2.push([x, z]);

  // ---------- PARKING GARAGE (x 60..93, z -31..31) ----------
  const GW = 0x9e9e9e;
  wall(60, -31, 93, -31, 0, L2Y + 1.2, GW); wall(60, 31, 93, 31, 0, L2Y + 1.2, GW); wall(93, -31, 93, 31, 0, L2Y + 1.2, GW);
  autoDoor(scene, 60, 0, 'z', 6);
  for (let x = 66; x <= 90; x += 8) for (let z = -26; z <= 26; z += 8) { if (x > 82 && z > 2 && z < 28) continue; sbox(x, 2.35, z, 0.6, 4.7, 0.6, 0xbdbdbd, { aabb: true }); }
  addRamp(83.5, 90.5, 6, 26, 'z', 0, L2Y);
  { const rm = new THREE.Mesh(new THREE.BoxGeometry(7, 0.2, Math.hypot(20, L2Y)), mat(0x8d8d8d)); rm.position.set(87, L2Y / 2, 16); rm.rotation.x = -Math.atan2(L2Y, 20); scene.add(rm); }
  addAABB(83.3, 16, 0.2, 20, 0, 7); addAABB(90.7, 16, 0.2, 20, 0, 7); addAABB(87, 23, 7, 6, 0, 1.5);
  railing(83, 5, 83, 26, L2Y); railing(91, 5, 91, 26, L2Y); railing(83, 5, 91, 5, L2Y);
  addSign(scene, 'PARKING · LEVEL P1', 60.2, 3.2, -8, Math.PI / 2, 3, 0.6, { size: 100, bg: '#37474f', fg: '#ffd23f' });
  addSign(scene, 'RAMP TO ROOF DECK ▲', 87, 2.8, 5.8, Math.PI, 3, 0.5, { size: 90, bg: '#37474f', fg: '#fff' });
  addSign(scene, 'MALL L2 ▶', 60.2, L2Y + 2.2, 0, Math.PI / 2, 2, 0.5, { size: 100, bg: '#ff4f9a', fg: '#fff' });
  // parking lines + parked cars on both levels
  Z.cars = [];
  for (const yl of [0, L2Y]) for (let x = 66; x <= 80; x += 3.2) for (const z of [-22, -12, 12, 22]) {
    sbox(x - 1.6, yl + 0.02, z, 0.1, 0.01, 5, 0xffffff, { collide: false });
    if (Math.random() < 0.55) {
      const c = pick([0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0x212121, 0xff7043]);
      sbox(x, yl + 0.55, z, 1.8, 0.7, 4.2, c, { aabb: true }); sbox(x, yl + 1.15, z + 0.2, 1.6, 0.55, 2.2, 0x90caf9);
      for (const [wx, wz] of [[-0.9, -1.3], [0.9, -1.3], [-0.9, 1.3], [0.9, 1.3]]) sbox(x + wx, yl + 0.25, z + wz, 0.25, 0.5, 0.6, 0x212121, { collide: false });
      Z.cars.push([x, yl, z]);
    }
  }
  ceilLights(60, 93, -31, 31, 4.6, 8);

  // ---------- OUTDOOR PLAZA (z 40..57) ----------
  for (const [x0, z0, x1, z1] of [[-31, 57, 31, 57], [-31, 40, -31, 57], [31, 40, 31, 57]]) wall(x0, z0, x1, z1, 0, 1.1, 0x78909c, [], { trim: false });
  for (const x of [-20, -12, 12, 20]) { sbox(x, 0.35, 48, 1.4, 0.7, 1.4, 0x8d6e63, { aabb: true }); cyl(x, 2, 48, 0.1, 2.8, 0x6d4c41, 6); sbox(x, 3.6, 48, 2.2, 1.6, 2.2, 0x66bb6a, { collide: false }); }
  for (const x of [-16, 16]) { sbox(x, 0.42, 52, 2.2, 0.08, 0.6, 0x8d6e63, { aabb: true }); sbox(x, 0.2, 52, 2, 0.4, 0.4, 0x5d4037); }
  for (const x of [-26, 26]) { cyl(x, 4, 44, 0.06, 8, 0xbdbdbd, 6); sbox(x + 0.8, 7.2, 44, 1.6, 1, 0.04, x < 0 ? 0xff4f9a : 0x3fa7ff, { collide: false }); }
  for (const x of [-8, 8]) { cyl(x, 2.5, 55, 0.06, 5, 0x424242, 6); sbox(x, 5, 55, 0.8, 0.2, 0.3, 0xfff8e1, { collide: false, basic: true }); }
  sbox(24, 1.3, 54, 4, 2.6, 0.1, 0x90caf9, { glass: true, aabb: true }); sbox(24, 2.65, 53.2, 4.4, 0.1, 1.8, 0x546e7a, { collide: false });
  addSign(scene, 'BUS STOP · next bus: never', 24, 2.0, 53.9, Math.PI, 3, 0.5, { size: 80, bg: '#1565c0', fg: '#fff' });
  for (const [x, z] of [[-18, 45], [18, 50], [0, 52]]) Z.pois.push([x, z]);

  // ---------- fire safety: extinguishers, hoses, alarms, sprinklers ----------
  Z.extShelves = [[-20, 1.0, -8.38, 0], [-50, 1.0, -26.62, 0], [20, 1.0, -39.6, 0], [45.6, 1.0, -19, 0], [-20, 1.0, 8.38, 0], [12, 1.0, 8.38, 0], [59.6, 1.0, -6, 0], [-59.6, 1.0, 4, 0], [50, L2Y + 1.0, -7.62, 0], [-30, L2Y + 1.0, 7.62, 0]];
  for (const [x, y, z] of Z.extShelves) sbox(x, y, z, 0.3, 0.04, 0.26, 0x9e9e9e, { thick: 0.14 });
  Z.hoseStations = [[-7.62, 1.2, -20, Math.PI / 2], [45.62, 1.2, -12, -Math.PI / 2], [-40, 1.2, 7.62, Math.PI]];
  for (const [x, y, z, ry] of Z.hoseStations) {
    const nx = Math.sin(ry), nz = Math.cos(ry);
    sbox(x - nx * 0.05, y, z - nz * 0.05, Math.abs(nz) > 0.5 ? 0.6 : 0.12, 0.8, Math.abs(nz) > 0.5 ? 0.12 : 0.6, 0xc62828, { collide: false });
    sbox(x + nx * 0.15, y - 0.24, z + nz * 0.15, Math.abs(nz) > 0.5 ? 0.4 : 0.22, 0.04, Math.abs(nz) > 0.5 ? 0.22 : 0.4, 0x9e9e9e, { thick: 0.14 });
    addSign(scene, 'FIRE HOSE', x + nx * 0.02, y + 0.55, z + nz * 0.02, ry, 0.6, 0.15, { size: 110, bg: '#c62828', fg: '#fff' });
  }
  Z.alarms = [[-35, 1.4, -8.18, Math.PI], [-7.82, 1.4, -24, Math.PI / 2], [-12, 1.4, 7.82, Math.PI], [45.82, 1.4, -16, -Math.PI / 2], [25, 1.4, 7.82, Math.PI], [-54, 1.4, 7.82, Math.PI]];
  for (const [x, y, z, ry] of Z.alarms) {
    const nx = Math.sin(ry), nz = Math.cos(ry);
    sbox(x - nx * 0.03, y, z - nz * 0.03, 0.24, 0.32, 0.06, 0xd50000, { collide: false, rotY: ry });
    addSign(scene, 'PULL', x + nx * 0.005, y + 0.26, z + nz * 0.005, ry, 0.24, 0.08, { size: 120, bg: '#d50000', fg: '#fff' });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0x550000 }));
    lamp.position.set(x + nx * 0.05, 2.6, z + nz * 0.05); scene.add(lamp); emergencyLights.push(lamp);
  }
  for (let x = -54; x <= 54; x += 12) for (const z of [-2, 2]) sbox(x, 4.62, z, 0.08, 0.1, 0.08, 0xb0bec5, { collide: false });

  // ---------- lockdown shutters (store entrances) ----------
  for (const [x0, x1, z, h] of [[-30, -24, -8, 3.6], [-50, -42, 8, 4], [-24, -18, 8, 3.4], [42, 48, 8, 3.6]]) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    const sh = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ map: stripeTex(), color: 0xb0bec5 }));
    sh.scale.set(w, h, 0.08); sh.position.set(cx, h + 1.5, z); sh.visible = false; scene.add(sh);
    const aabb = addAABB(cx, z, w, 0.3, 0, h); aabb.active = false;
    shutters.push({ mesh: sh, aabb, cx, z, w, h, body: null, down: false });
  }
  // ---------- job board, supply kiosk + directory (south of the atrium, facing the spawn) ----------
  sbox(-4.2, 1.55, 9.0, 2.1, 1.7, 0.1, 0xffd23f, { collide: false }); addSign(scene, 'HELP WANTED!', -4.2, 2.6, 9.06, 0, 2, 0.35, { size: 120, bg: '#ff4f9a', fg: '#fff' });
  sbox(-4.2, 0.7, 9.0, 0.15, 1.4, 0.15, 0x37474f); sbox(4.2, 0.7, 9.0, 0.15, 1.4, 0.15, 0x37474f);
  addAABB(-4.2, 9, 2.2, 0.3, 0, 2.6); addAABB(4.2, 9, 2.2, 0.3, 0, 2.6);
  Z.jobBoard = [-4.2, 1.55, 9.07]; Z.supplyKiosk = [4.2, 1.55, 9.07];
  Z.directories = [[0, 1.5, 9.4, 0, 0], [-20, 1.5, -9.6, Math.PI, 0], [30, 1.5, -9.6, Math.PI, 0], [5.9, L2Y + 1.5, 7.6, Math.PI, 1], [62, 1.5, 4, Math.PI / 2, 0], [6.5, 1.5, 37.5, Math.PI, 0]];
  for (const [x, y, z, ry] of Z.directories) { sbox(x - Math.sin(ry) * 0.06, y - 0.7, z - Math.cos(ry) * 0.06, 0.15, 1.6, 0.15, 0x37474f); }
  // display pyramid sign
  addSign(scene, 'DISPLAY · DO NOT TOUCH', Z.display.x, 1.9, Z.display.z + 0.6, Math.PI, 1.6, 0.3, { size: 90, bg: '#ffd23f', fg: '#d32f2f' });

  finalizeStatic(scene);
  Z.productSpawns = productSpawns;
}

// ---------- automatic sliding doors ----------
function autoDoor(scene, x, z, axis, width) {
  const half = width / 2;
  const panels = [-1, 1].map((s) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? half : 0.08, 3.2, axis === 'x' ? 0.08 : half), glassMat);
    m.position.set(x + (axis === 'x' ? s * half / 2 : 0), 1.6, z + (axis === 'z' ? s * half / 2 : 0)); scene.add(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? half : 0.1, 0.08, axis === 'x' ? 0.1 : half), mat(0x37474f)); frame.position.y = 1.6; m.add(frame);
    return { mesh: m, s, home: m.position.clone() };
  });
  const aabb = addAABB(x, z, axis === 'x' ? width : 0.3, axis === 'x' ? 0.3 : width, 0, 3.2);
  const body = addStaticBody(x, 1.6, z, axis === 'x' ? width : 0.2, 3.2, axis === 'x' ? 0.2 : width);
  autoDoors.push({ x, z, axis, half, panels, aabb, body, open: 0 });
}
function stepTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d');
  x.fillStyle = '#9e9e9e'; x.fillRect(0, 0, 64, 16); x.fillStyle = '#424242'; for (let i = 0; i < 8; i++) x.fillRect(i * 8, 0, 2, 16);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(10, 1); return t;
}
function beltTex() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#212121'; x.fillRect(0, 0, 16, 64); x.fillStyle = '#424242'; for (let i = 0; i < 8; i++) x.fillRect(0, i * 8, 16, 2);
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); return t;
}
function stripeTex() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#cfd8dc'; x.fillRect(0, 0, 16, 64); x.fillStyle = '#78909c'; for (let i = 0; i < 8; i++) x.fillRect(0, i * 8, 16, 2);
  const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4); return t;
}

// ---------- 3D push buttons ----------
const btnGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16);
export function makeButton(scene, id, pos, normal, color, label) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 16), mat(0x212121));
  const cap = new THREE.Mesh(btnGeo, new THREE.MeshLambertMaterial({ color, emissive: 0x000000 }));
  cap.position.y = 0.03; g.add(base); g.add(cap);
  g.position.copy(pos);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  if (label) {
    const s = signMesh(label, 0.3, 0.08, { size: 120, bg: '#1b1340', fg: '#fff' });
    s.position.set(0, 0.02, 0.13); s.rotation.x = -Math.PI / 2; g.add(s);
  }
  scene.add(g);
  const b = { id, group: g, cap, color, pressedUntil: 0, worldPos: pos.clone(), normal: normal.clone().normalize(), lit: false };
  cap.userData.button = b;
  G.buttons.push(b);
  return b;
}
export function setButtonLit(b, on) { b.lit = on; b.cap.material.emissive.setHex(on ? 0x666600 : 0x000000); b.cap.material.color.setHex(on ? 0xffeb3b : b.color); }

// ---------- event visuals (run on every client) ----------
export function setPower(on) {
  lights.hemi.intensity = on ? 1.5 : 0.07;
  lights.sun.intensity = on ? 0.9 : 0.0;
  G.scene.fog.color.setHex(on ? 0xcfe8ff : 0x05030c);
}
export function setGate(open) {
  G.gateOpen = open;
  gateMesh.visible = !open;
  gateAABB.active = !open;
  if (open && gateBody.world) world.removeBody(gateBody);
  if (!open && !gateBody.world) world.addBody(gateBody);
  Z.noNav[2].active = !open;
}
export function setSecretDoor(open) {
  G.secretOpen = open;
  secretShelf.userData.aabb.active = !open;
  const b = secretShelf.userData.body;
  if (open && b.world) world.removeBody(b);
  if (!open && !b.world) world.addBody(b);
}
export function setShutters(down) {
  for (const s of shutters) {
    s.down = down; s.aabb.active = down; s.mesh.visible = true;
    if (G.isHost) {
      if (down && !s.body) s.body = addStaticBody(s.cx, s.h / 2, s.z, s.w, s.h, 0.15);
      if (!down && s.body) { world.removeBody(s.body); s.body = null; }
    }
  }
}
export function setEscalator(broken) { G.escalatorBroken = broken; outOfOrder.forEach((o) => (o.visible = broken)); }
export function setElevator(from, to, dur) { elevator.from = from; elevator.to = to; elevator.t0 = G.time; elevator.dur = dur; }

let tvT = 0;
const _cam = new THREE.Vector3();
export function updateWorldVisuals(dt, t) {
  for (const e of escalators) if (!G.escalatorBroken) e.tex.offset.x -= dt * (e.up ? 0.6 : -0.6);
  for (const c of conveyors) c.tex.offset.y += dt * 0.5;
  for (const s of shutters) {
    const target = s.down ? s.h / 2 : s.h + 1.5;
    s.mesh.position.y += (target - s.mesh.position.y) * Math.min(1, dt * 3);
    if (!s.down && s.mesh.position.y > s.h + 1.4) s.mesh.visible = false;
  }
  // elevator (deterministic from synced start time)
  const k = Math.min(1, Math.max(0, (t - elevator.t0) / elevator.dur));
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  elevator.y = elevator.from + (elevator.to - elevator.from) * e;
  elevator.mesh.position.y = elevator.y;
  if (elevator.body) { elevator.body.position.y = elevator.y - 0.1; elevator.body.aabbNeedsUpdate = true; }
  // automatic doors: open when anyone is near (players or shoppers)
  for (const d of autoDoors) {
    let near = false;
    const check = (x, z, y = 0) => { if (y < 2 && Math.abs(x - d.x) < (d.axis === 'x' ? d.half + 1 : 3.2) && Math.abs(z - d.z) < (d.axis === 'x' ? 3.2 : d.half + 1)) near = true; };
    for (const p of G.players.values()) check(p.head.p.x, p.head.p.z, p.head.p.y - 1.6);
    if (G.camera) { G.camera.getWorldPosition(_cam); check(_cam.x, _cam.z, _cam.y - 1.6); }
    for (const n of G.npcs.values()) if (!n.floor) check(n.x, n.z);
    d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 5);
    for (const p of d.panels) {
      const off = d.open * d.half * 0.95 * p.s;
      p.mesh.position.set(p.home.x + (d.axis === 'x' ? off : 0), p.home.y, p.home.z + (d.axis === 'z' ? off : 0));
    }
    const isOpen = d.open > 0.6;
    d.aabb.active = !isOpen;
    if (G.isHost) { if (isOpen && d.body.world) world.removeBody(d.body); if (!isOpen && !d.body.world) world.addBody(d.body); }
  }
  if (secretShelf) { const tx = G.secretOpen ? -18.2 : -16; secretShelf.position.x += (tx - secretShelf.position.x) * Math.min(1, dt * 2); }
  if (fountainWater) fountainWater.material.color.setHSL(0.55, 0.8, 0.6 + Math.sin(t * 2) * 0.05);
  for (let i = 0; i < arcadeScreens.length; i++) arcadeScreens[i].material.color.setHSL((t * 0.2 + i * 0.13) % 1, 1, 0.55);
  tvT -= dt;
  if (tvT < 0) { tvT = 0.4; for (let i = 0; i < tvScreens.length; i++) tvScreens[i].material.color.setHSL(((t * 0.07) + i * 0.17) % 1, 0.8, 0.45 + Math.random() * 0.15); }
  const alarm = G.events.fire || G.events.sprinkler || G.alarmOn;
  if (alarm) {
    const kk = (Math.sin(t * 8) + 1) / 2;
    lights.hemi.color.setRGB(1, 0.55 + 0.45 * (1 - kk), 0.55 + 0.45 * (1 - kk));
  } else lights.hemi.color.setHex(0xfff6e8);
  for (let i = 0; i < emergencyLights.length; i++) emergencyLights[i].material.color.setHex(alarm ? ((Math.floor(t * 4) + i) % 2 ? 0xff1744 : 0x550000) : 0x550000);
}
