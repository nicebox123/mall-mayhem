// Physics world (cannon-es). Only the host simulates; clients render snapshots.
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

// ---- Custom broadphase for a huge, mostly-static world ----
// SAP sorts along one axis, so in a wide mall every body overlaps hundreds of others on that axis (10ms/step).
// Here static bodies go into a 2D spatial hash ONCE; each step only awake moving bodies look up their cell
// neighbours. Sleeping objects cost nothing until something awake comes near them.
class HashBroadphase extends CANNON.Broadphase {
  constructor() { super(); this.C = 3; this.statics = new Map(); this.planes = []; this.dirty = true; this.dyn = new Map(); this.stamp = 0; }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  rebuild(world) {
    this.statics.clear(); this.planes = [];
    for (const b of world.bodies) {
      if (b.type !== CANNON.Body.STATIC || !b.shapes.length) continue;
      if (b.shapes[0].type === CANNON.Shape.types.PLANE) { this.planes.push(b); continue; }
      b.updateAABB();
      this.cells(b.aabb, (k) => { let l = this.statics.get(k); if (!l) this.statics.set(k, l = []); l.push(b); });
    }
    this.dirty = false;
  }
  cells(aabb, fn) {
    const C = this.C;
    const i0 = Math.floor(aabb.lowerBound.x / C), i1 = Math.floor(aabb.upperBound.x / C);
    const j0 = Math.floor(aabb.lowerBound.z / C), j1 = Math.floor(aabb.upperBound.z / C);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return; // runaway body (falling out of the world): ignore
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(this.key(i, j));
  }
  collisionPairs(world, p1, p2) {
    if (this.dirty) this.rebuild(world);
    const dyn = this.dyn; dyn.clear();
    const movers = [];
    for (const b of world.bodies) {
      if (b.type === CANNON.Body.STATIC || !b.shapes.length) continue;
      if (b.aabbNeedsUpdate) b.updateAABB();
      movers.push(b);
      this.cells(b.aabb, (k) => { let l = dyn.get(k); if (!l) dyn.set(k, l = []); l.push(b); });
    }
    const SLEEP = CANNON.Body.SLEEPING;
    for (const b of movers) {
      if (b.type === CANNON.Body.DYNAMIC && b.sleepState === SLEEP) continue; // paired from the awake side
      const s = ++this.stamp;
      this.cells(b.aabb, (k) => {
        const st = this.statics.get(k);
        if (st) for (const o of st) { if (o._bp === s || o.world !== world) continue; o._bp = s; if (this.needBroadphaseCollision(b, o)) this.intersectionTest(b, o, p1, p2); }
        const dl = dyn.get(k);
        if (dl) for (const o of dl) {
          if (o === b || o._bp === s) continue;
          o._bp = s;
          const oAwake = !(o.type === CANNON.Body.DYNAMIC && o.sleepState === SLEEP);
          if (oAwake && o.id < b.id) continue; // both awake: pair once
          if (this.needBroadphaseCollision(b, o)) this.intersectionTest(b, o, p1, p2);
        }
      });
      for (const pl of this.planes) if (b.aabb.lowerBound.y < pl.position.y + 0.3 && this.needBroadphaseCollision(b, pl)) { p1.push(b); p2.push(pl); }
    }
  }
}
export const broadphase = new HashBroadphase();
world.broadphase = broadphase;
broadphase.setWorld(world);
// The default collision matrix is a dense N² array copied every step (~5ms with 1600 bodies). Sparse = ~0.
world.collisionMatrix = new CANNON.ObjectCollisionMatrix();
world.collisionMatrixPrevious = new CANNON.ObjectCollisionMatrix();
world.addEventListener('addBody', (e) => { if (e.body.type === CANNON.Body.STATIC) broadphase.dirty = true; });
world.addEventListener('removeBody', (e) => { if (e.body.type === CANNON.Body.STATIC) broadphase.dirty = true; });
world.allowSleep = true;
world.solver.iterations = 8;
// NOTE: cannon-es friction is extremely strong in practice. Measured: 0.001 ≈ real-world μ 0.23,
// and anything above ~0.003 makes sliding objects stop dead (no fun carts). Values below are tuned by test.
// So: object<->object and object<->shelf contacts keep "sticky" friction (stable stacks and displays),
// while the FLOOR gets its own material with low friction so carts roll and thrown junk skids.
const FR = (mu) => mu / 230; // convert "real-feeling" friction to cannon-es units (only valid below ~0.003)
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.15;

export const M = {
  default: new CANNON.Material('default'),
  ground: new CANNON.Material('ground'),   // static furniture, shelves, walls
  floor: new CANNON.Material('floor'),     // the mall floor
  bouncy: new CANNON.Material('bouncy'),
  slippery: new CANNON.Material('slippery'),
};
const CM = (a, b, friction, restitution) => world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
CM(M.default, M.ground, 0.4, 0.1);
CM(M.default, M.floor, FR(0.6), 0.1);
CM(M.bouncy, M.floor, FR(0.3), 0.85);
CM(M.bouncy, M.ground, 0.05, 0.8);
CM(M.bouncy, M.default, 0.05, 0.7);
CM(M.bouncy, M.bouncy, 0.05, 0.9);
CM(M.slippery, M.floor, FR(0.07), 0.05);   // shopping carts roll
CM(M.slippery, M.ground, 0.05, 0.1);
CM(M.slippery, M.default, 0.2, 0.1);

// floor
const floor = new CANNON.Body({ mass: 0, material: M.floor, shape: new CANNON.Plane() });
floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floor);

// Static collider list used for player + NPC collision (2D AABBs with a height range).
// The mall is huge now, so AABBs live in a spatial hash (4m cells) and queries only touch nearby ones.
export const aabbs = [];
const CELL = 4, hash = new Map();
const cellKey = (i, j) => i * 100003 + j;
function hashInsert(a) {
  for (let i = Math.floor(a.minX / CELL); i <= Math.floor(a.maxX / CELL); i++)
    for (let j = Math.floor(a.minZ / CELL); j <= Math.floor(a.maxZ / CELL); j++) {
      const k = cellKey(i, j); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(a);
    }
}
let queryStamp = 0;
function nearby(x, z, r, out) {
  out.length = 0; queryStamp++;
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
      const list = hash.get(cellKey(i, j)); if (!list) continue;
      for (const a of list) if (a._q !== queryStamp) { a._q = queryStamp; out.push(a); }
    }
  return out;
}
const _near = [];

// ---- Walkable surfaces: multiple floors, ramps (stairs/escalators), moving platforms (elevators) ----
export const walkables = [];   // { minX,maxX,minZ,maxZ, y } flat  |  { ..., ramp:'x'|'z', y0, y1 } sloped (y0 at min edge)
export const movers = [];      // { minX,maxX,minZ,maxZ, get y() } elevator platforms
export function addWalk(minX, maxX, minZ, maxZ, y, extra = {}) { const w = { minX, maxX, minZ, maxZ, y, ...extra }; walkables.push(w); return w; }
export function addRamp(minX, maxX, minZ, maxZ, axis, y0, y1, extra = {}) { const w = { minX, maxX, minZ, maxZ, ramp: axis, y0, y1, ...extra }; walkables.push(w); return w; }
export function surfaceY(w, x, z) {
  if (!w.ramp) return w.y;
  const t = w.ramp === 'x' ? (x - w.minX) / (w.maxX - w.minX) : (z - w.minZ) / (w.maxZ - w.minZ);
  return w.y0 + (w.y1 - w.y0) * Math.max(0, Math.min(1, t));
}
// Highest walkable surface under (x,z) that is not more than `step` above `fromY`. Returns {y, w}.
const _gh = { y: 0, w: null };
export function groundAt(x, z, fromY = 100, step = 0.6) {
  let best = -100, bw = null;
  for (const w of walkables) {
    if (x < w.minX || x > w.maxX || z < w.minZ || z > w.maxZ) continue;
    const y = surfaceY(w, x, z);
    if (y <= fromY + step && y > best) { best = y; bw = w; }
  }
  for (const m of movers) {
    if (x < m.minX || x > m.maxX || z < m.minZ || z > m.maxZ) continue;
    const y = m.y;
    if (y <= fromY + step && y > best) { best = y; bw = m; }
  }
  _gh.y = best; _gh.w = bw;
  return _gh;
}

// Big static boxes (120m walls, 50m floor slabs) are split into <=8m pieces: the SAP broadphase scans
// bodies that overlap along an axis, and one giant wall overlapping everything would make every step slow.
const MAXP = 8;
export function addStaticBody(x, y, z, w, h, d, opts = {}) {
  if (!opts.rotY && (w > MAXP * 1.25 || d > MAXP * 1.25)) {
    const nx = Math.ceil(w / MAXP), nz = Math.ceil(d / MAXP);
    let first = null;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const b = addStaticBodyRaw(x - w / 2 + (i + 0.5) * w / nx, y, z - d / 2 + (j + 0.5) * d / nz, w / nx, h, d / nz, opts);
      first = first || b;
    }
    return first;
  }
  return addStaticBodyRaw(x, y, z, w, h, d, opts);
}
function addStaticBodyRaw(x, y, z, w, h, d, { rotY = 0, material = M.ground } = {}) {
  const b = new CANNON.Body({ mass: 0, material, shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)) });
  b.position.set(x, y, z);
  if (rotY) b.quaternion.setFromEuler(0, rotY, 0);
  // cannon computes the AABB when the shape is added (at the origin) and never again for static bodies,
  // so without this the broadphase thinks every shelf/counter lives at (0,0,0) and nothing collides with it.
  b.updateAABB();
  world.addBody(b);
  return b;
}

export function addAABB(x, z, w, d, y0 = 0, y1 = 3, tag = null) {
  const a = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0, y1, tag, active: true };
  aabbs.push(a); hashInsert(a);
  return a;
}

// Push a circle (x,z,r) out of all active AABBs overlapping the height band. Returns corrected {x,z}.
export function collideCircle(x, z, r, yLow = 0.2, yHigh = 1.7) {
  for (const a of nearby(x, z, r + 0.5, _near)) {
    if (!a.active || a.y1 < yLow || a.y0 > yHigh) continue;
    const cx = Math.max(a.minX, Math.min(x, a.maxX));
    const cz = Math.max(a.minZ, Math.min(z, a.maxZ));
    let dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2); x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else { // center inside box: push out along smallest axis
        const l = x - a.minX, rr = a.maxX - x, t = z - a.minZ, b = a.maxZ - z;
        const m = Math.min(l, rr, t, b);
        if (m === l) x = a.minX - r; else if (m === rr) x = a.maxX + r; else if (m === t) z = a.minZ - r; else z = a.maxZ + r;
      }
    }
  }
  return { x, z };
}

// Is (x,z) blocked for something standing at height `y`? (ignore = optional tag to skip, e.g. 'gate')
export function pointBlocked(x, z, r = 0.2, y = 0, ignore = null) {
  for (const a of nearby(x, z, r + 0.5, _near)) {
    if (!a.active || a.tag === ignore || a.y0 > y + 1.5 || a.y1 < y + 0.2) continue;
    if (x > a.minX - r && x < a.maxX + r && z > a.minZ - r && z < a.maxZ + r) return true;
  }
  return false;
}

// 2D segment vs inflated AABBs (for NPC nav graph)
export function segmentClear(x1, z1, x2, z2, r, y = 0, ignore = null) {
  const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.25);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (pointBlocked(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, r, y, ignore)) return false;
  }
  return true;
}

// ---- Velocity-driven grabbing: held objects chase the hand but still collide with the world.
const _q = new CANNON.Quaternion(), _qi = new CANNON.Quaternion();
export function driveBody(body, tp, tq, dt, grip = 1) {
  body.wakeUp();
  const k = 0.65 * grip;
  let vx = (tp.x - body.position.x) / dt * k;
  let vy = (tp.y - body.position.y) / dt * k;
  let vz = (tp.z - body.position.z) / dt * k;
  const sp = Math.hypot(vx, vy, vz), max = 25 * grip + 3;
  if (sp > max) { vx *= max / sp; vy *= max / sp; vz *= max / sp; }
  body.velocity.set(vx, vy + (grip < 0.5 ? 0 : 0), vz);

  body.quaternion.conjugate(_qi);
  _q.set(tq.x, tq.y, tq.z, tq.w).mult(_qi, _q);
  if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
  const angle = 2 * Math.acos(Math.min(1, _q.w));
  const s = Math.sqrt(1 - _q.w * _q.w);
  if (s > 1e-4) {
    const ka = (0.5 * grip) / dt * angle / s;
    body.angularVelocity.set(_q.x * ka, _q.y * ka, _q.z * ka);
  } else body.angularVelocity.set(0, 0, 0);
}

export function toThree(body, obj3d) {
  obj3d.position.set(body.position.x, body.position.y, body.position.z);
  obj3d.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
}

export { CANNON };
export const V3 = (x, y, z) => new CANNON.Vec3(x, y, z);
export const tmpV = new THREE.Vector3();
