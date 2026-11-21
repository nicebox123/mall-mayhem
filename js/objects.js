// Dynamic, grabbable, network-synced objects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, newId } from './state.js';
import { ITEMS, PRODUCT_POOL, INSTANCED } from './config.js';
import { world, M, CANNON, V3, toThree } from './physics.js';
import { mat, box, pick, rand, damp } from './util.js';
import { Z } from './world.js';
import { sfx } from './audio.js';

const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);

function buildMesh(type, def) {
  const g = new THREE.Group();
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
  const [a, b, c] = def.size;
  switch (def.shape) {
    case 'box':
      add(box(a, b, c, def.color));
      if (def.accent) add(box(a * 1.02, b * 0.3, c * 1.02, def.accent), 0, b * 0.15, 0);
      if (type === 'wetsign') add(box(a * 0.8, b * 0.25, c * 1.05, 0x212121), 0, b * 0.15, 0);
      break;
    case 'cyl':
      if (type === 'cone') {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, a, b, 8), mat(def.color)));
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.06, 8), mat(0xffffff)), 0, 0.02, 0);
        add(box(0.36, 0.03, 0.36, 0xff6d00), 0, -b / 2 + 0.015, 0);
      } else {
        const m = add(new THREE.Mesh(cylGeo, mat(def.color))); m.scale.set(a, b, a);
        if (type === 'soda') { const t = add(new THREE.Mesh(cylGeo, mat(0xcfd8dc))); t.scale.set(a * 0.95, 0.01, a * 0.95); t.position.y = b / 2; }
        if (type === 'cup') { const t = add(new THREE.Mesh(cylGeo, mat(0xffffff))); t.scale.set(a * 1.05, 0.02, a * 1.05); t.position.y = b / 2; add(box(0.01, 0.08, 0.01, 0xff4081), 0.01, b / 2 + 0.04, 0); }
      }
      break;
    case 'sphere': {
      const m = add(new THREE.Mesh(sphereGeo, mat(def.color))); m.scale.setScalar(a);
      if (type === 'melon') m.scale.set(a, a * 0.9, a * 1.25);
      if (type === 'duck') { const h = add(new THREE.Mesh(sphereGeo, mat(def.color)), 0, a * 0.8, -a * 0.4); h.scale.setScalar(a * 0.6); add(box(a * 0.5, a * 0.15, a * 0.5, 0xff6d00), 0, a * 0.75, -a * 1.0); }
      if (type === 'bball') { add(box(a * 2.02, 0.01, 0.01, 0x3e2723)); add(box(0.01, a * 2.02, 0.01, 0x3e2723)); }
      break;
    }
    case 'cart': {
      const wire = mat(0x90a4ae);
      add(box(0.55, 0.03, 0.85, 0x78909c), 0, 0.42, 0);
      // wire-basket look: rails instead of see-through panels (keeps the cart one draw call)
      for (const yy of [0.47, 0.65, 0.86]) {
        add(box(0.55, 0.025, 0.025, 0xb0bec5), 0, yy, -0.42); add(box(0.55, 0.025, 0.025, 0xb0bec5), 0, yy, 0.42);
        add(box(0.025, 0.025, 0.85, 0xb0bec5), -0.27, yy, 0); add(box(0.025, 0.025, 0.85, 0xb0bec5), 0.27, yy, 0);
      }
      for (const xx of [-0.27, -0.09, 0.09, 0.27]) { add(box(0.02, 0.42, 0.02, 0xb0bec5), xx, 0.66, -0.42); add(box(0.02, 0.42, 0.02, 0xb0bec5), xx, 0.66, 0.42); }
      add(box(0.6, 0.04, 0.04, 0xe53935), 0, 0.95, 0.5);           // handle
      add(box(0.03, 0.12, 0.03, 0x78909c), -0.27, 0.9, 0.46); add(box(0.03, 0.12, 0.03, 0x78909c), 0.27, 0.9, 0.46);
      for (const [x, z] of [[-0.22, -0.35], [0.22, -0.35], [-0.22, 0.35], [0.22, 0.35]]) {
        add(box(0.03, 0.38, 0.03, 0x78909c), x, 0.24, z);
        add(box(0.04, 0.09, 0.09, 0x212121), x, 0.045, z);
      }
      break;
    }
    case 'mop':
      add(box(0.035, 1.3, 0.035, 0x8d6e63));
      add(box(0.3, 0.05, 0.12, 0x1565c0), 0, -0.65, 0);
      add(box(0.32, 0.06, 0.14, 0xeeeeee), 0, -0.69, 0);
      break;
    case 'chair':
      add(box(0.45, 0.05, 0.45, def.color), 0, 0.45, 0);
      add(box(0.45, 0.42, 0.05, def.color), 0, 0.7, 0.2);
      for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) add(box(0.04, 0.43, 0.04, 0x616161), x, 0.215, z);
      break;
    case 'door':
      if (def.glass) { const gm = new THREE.Mesh(new THREE.BoxGeometry(a - 0.02, b - 0.02, c), new THREE.MeshLambertMaterial({ color: 0xa8d8ff, transparent: true, opacity: 0.35 })); add(gm); add(box(a, 0.06, c * 1.2, 0x9e9e9e), 0, b / 2 - 0.03, 0); add(box(a, 0.06, c * 1.2, 0x9e9e9e), 0, -b / 2 + 0.03, 0); }
      else add(box(a - 0.02, b - 0.02, c, def.color));
      add(box(0.06, 0.04, 0.12, 0xffc107), a * 0.38, 0, 0);
      break;
    case 'ext': { // fire extinguisher: red tank, black handle + nozzle pointing -Z
      const t = add(new THREE.Mesh(cylGeo, mat(def.color))); t.scale.set(a, b * 0.85, a); t.position.y = -0.03;
      add(box(0.05, 0.05, 0.05, 0x212121), 0, b * 0.43, 0);
      add(box(0.03, 0.03, 0.16, 0x212121), 0, b * 0.47, -0.06);
      add(box(0.12, 0.02, 0.03, 0x424242), 0, b * 0.5, 0.03);
      add(box(a * 2.05, 0.06, a * 2.05, 0xffffff), 0, 0.05, 0);
      break;
    }
    case 'hose':
      add(box(0.06, 0.06, 0.18, def.color));
      add(box(0.04, 0.04, 0.08, 0xb0bec5), 0, 0, -0.12);
      add(box(0.05, 0.09, 0.04, 0xd50000), 0, -0.05, 0.05);
      break;
    case 'torch':
      add(new THREE.Mesh(cylGeo, mat(0x78909c))).scale.set(0.05, 0.2, 0.05);
      add(box(0.03, 0.03, 0.2, 0x37474f), 0, 0.06, -0.08);
      add(box(0.05, 0.05, 0.05, 0xff6d00), 0, 0.06, -0.18);
      add(box(0.05, 0.04, 0.04, 0xffd23f), 0, 0.11, 0);
      break;
    case 'blower':
      add(box(0.16, 0.18, 0.2, def.color), 0, 0, 0.05);
      add(box(0.08, 0.08, 0.36, 0x424242), 0, -0.02, -0.22);
      add(box(0.04, 0.1, 0.04, 0x212121), 0, 0.12, 0.06);
      break;
    case 'mega': {
      const c = add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.035, 0.26, 10), mat(def.color)));
      c.rotation.x = Math.PI / 2; c.position.z = -0.05;
      add(box(0.13, 0.02, 0.02, 0xd50000), 0, 0, -0.18);
      add(box(0.03, 0.09, 0.03, 0x212121), 0, -0.06, 0.06);
      break;
    }
    case 'chicken':
      add(box(a, b * 0.7, c, def.color));
      add(box(a * 0.9, a * 0.9, a * 1.3, def.color), 0, b * 0.42, -0.02);
      add(box(0.02, 0.05, 0.05, 0xff1744), 0, b * 0.52, 0);
      add(box(0.03, 0.02, 0.05, 0xff9100), 0, b * 0.42, -0.07);
      break;
    case 'basket':
      add(box(a, 0.02, c, def.color), 0, -b / 2 + 0.01, 0);
      add(box(a, b, 0.015, def.color), 0, 0, c / 2); add(box(a, b, 0.015, def.color), 0, 0, -c / 2);
      add(box(0.015, b, c, def.color), a / 2, 0, 0); add(box(0.015, b, c, def.color), -a / 2, 0, 0);
      add(box(0.02, 0.02, c * 0.8, 0x212121), 0, b / 2 + 0.08, 0);
      add(box(0.02, 0.1, 0.02, 0x212121), 0, b / 2 + 0.03, c * 0.4); add(box(0.02, 0.1, 0.02, 0x212121), 0, b / 2 + 0.03, -c * 0.4);
      break;
    case 'blaster':
      add(box(0.07, 0.08, 0.34, def.color), 0, 0.03, -0.04);
      add(box(0.05, 0.05, 0.12, 0x2196f3), 0, 0.03, -0.26);
      add(box(0.05, 0.13, 0.06, 0x212121), 0, -0.06, 0.08);
      add(box(0.09, 0.05, 0.1, 0xffeb3b), 0, 0.09, 0.0);
      break;
    case 'launcher':
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 10), mat(def.color))).rotation.x = Math.PI / 2;
      add(box(0.06, 0.15, 0.08, 0x212121), 0, -0.08, 0.12);
      add(box(0.16, 0.16, 0.06, 0xffeb3b), 0, 0, -0.27);
      break;
    case 'lamp':
      add(box(0.3, 0.05, 0.3, 0x5d4037), 0, -0.68, 0);
      add(box(0.04, 1.3, 0.04, 0x8d6e63));
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 0.25, 10), mat(def.color)), 0, 0.62, 0);
      break;
  }
  return mergeGroup(g);
}

// Bake all opaque single-color parts of an object into ONE vertex-colored mesh (a cart was ~20 draw calls)
const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const _c3 = new THREE.Color();
function mergeGroup(g) {
  g.updateMatrixWorld(true);
  const geos = [], keep = [];
  for (const o of [...g.children]) {
    const m = o.material;
    if (!o.isMesh || Array.isArray(m) || m.transparent || m.map || !m.color) { keep.push(o); continue; }
    const geo = o.geometry.clone().applyMatrix4(o.matrix);
    const n = geo.attributes.position.count, c = new Float32Array(n * 3);
    _c3.copy(m.color);
    for (let i = 0; i < n; i++) { c[i * 3] = _c3.r; c[i * 3 + 1] = _c3.g; c[i * 3 + 2] = _c3.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    geos.push(geo.index ? geo.toNonIndexed() : geo);
  }
  if (geos.length < 2) { g.traverse((o) => { if (o.isMesh) o.userData.objMesh = true; }); return g; }
  const out = new THREE.Group();
  const merged = new THREE.Mesh(mergeGeometries(geos, false), vcMat);
  out.add(merged);
  for (const k of keep) out.add(k);
  out.traverse((o) => { if (o.isMesh) o.userData.objMesh = true; });
  return out;
}

function buildBody(type, def, opts) {
  const [a, b, c] = def.size;
  const material = def.mat ? M[def.mat] : M.default;
  const body = new CANNON.Body({ mass: def.mass, material, linearDamping: 0.05, angularDamping: 0.15, allowSleep: true, sleepSpeedLimit: 0.3, sleepTimeLimit: 0.5 });
  switch (def.shape) {
    case 'box': body.addShape(new CANNON.Box(V3(a / 2, b / 2, c / 2))); break;
    // cans/cups/rolls use a box collider: convex-cylinder contacts are ~5x more expensive and there are lots of them
    case 'cyl': body.addShape(type === 'cone' ? new CANNON.Cylinder(0.03, a, b, 8) : new CANNON.Box(V3(a * 0.9, b / 2, a * 0.9))); break;
    case 'sphere': body.addShape(new CANNON.Sphere(type === 'melon' ? a * 1.05 : a)); break;
    case 'cart':
      body.addShape(new CANNON.Box(V3(0.25, 0.1, 0.38)), V3(0, 0.1, 0));          // wheel base (low CoM = hard to tip)
      body.addShape(new CANNON.Box(V3(0.275, 0.02, 0.425)), V3(0, 0.42, 0));      // basket floor
      body.addShape(new CANNON.Box(V3(0.275, 0.23, 0.015)), V3(0, 0.65, -0.42));
      body.addShape(new CANNON.Box(V3(0.275, 0.23, 0.015)), V3(0, 0.65, 0.42));
      body.addShape(new CANNON.Box(V3(0.015, 0.23, 0.425)), V3(-0.27, 0.65, 0));
      body.addShape(new CANNON.Box(V3(0.015, 0.23, 0.425)), V3(0.27, 0.65, 0));
      body.addShape(new CANNON.Box(V3(0.3, 0.03, 0.03)), V3(0, 0.95, 0.5));
      body.linearDamping = 0.25; body.angularDamping = 0.6;
      break;
    case 'mop':
      body.addShape(new CANNON.Box(V3(0.02, 0.65, 0.02)));
      body.addShape(new CANNON.Box(V3(0.16, 0.05, 0.07)), V3(0, -0.67, 0));
      break;
    case 'chair':
      body.addShape(new CANNON.Box(V3(0.22, 0.215, 0.22)), V3(0, 0.235, 0));
      body.addShape(new CANNON.Box(V3(0.225, 0.21, 0.025)), V3(0, 0.7, 0.2));
      break;
    case 'door':
      body.addShape(new CANNON.Box(V3(a / 2 - 0.06, b / 2 - 0.04, 0.03)));
      body.linearDamping = 0.4; body.angularDamping = 0.9;
      break;
    case 'ext': body.addShape(new CANNON.Cylinder(a, a, b, 8)); break;
    case 'hose': body.addShape(new CANNON.Box(V3(0.04, 0.05, 0.12))); break;
    case 'torch': body.addShape(new CANNON.Box(V3(0.04, 0.1, 0.1))); break;
    case 'blower': body.addShape(new CANNON.Box(V3(0.08, 0.1, 0.1)), V3(0, 0, 0.05)); body.addShape(new CANNON.Box(V3(0.04, 0.04, 0.18)), V3(0, -0.02, -0.22)); break;
    case 'mega': body.addShape(new CANNON.Box(V3(0.08, 0.08, 0.15))); break;
    case 'chicken': body.addShape(new CANNON.Box(V3(a / 2, b / 2, c / 2))); break;
    case 'basket': // open-top: you can actually carry stuff in it
      body.addShape(new CANNON.Box(V3(a / 2, 0.015, c / 2)), V3(0, -b / 2 + 0.015, 0));
      body.addShape(new CANNON.Box(V3(a / 2, b / 2, 0.01)), V3(0, 0, c / 2)); body.addShape(new CANNON.Box(V3(a / 2, b / 2, 0.01)), V3(0, 0, -c / 2));
      body.addShape(new CANNON.Box(V3(0.01, b / 2, c / 2)), V3(a / 2, 0, 0)); body.addShape(new CANNON.Box(V3(0.01, b / 2, c / 2)), V3(-a / 2, 0, 0));
      break;
    case 'blaster': body.addShape(new CANNON.Box(V3(0.04, 0.09, 0.19))); break;
    case 'launcher': body.addShape(new CANNON.Box(V3(0.08, 0.1, 0.27))); break;
    case 'lamp': body.addShape(new CANNON.Box(V3(0.15, 0.03, 0.15)), V3(0, -0.68, 0)); body.addShape(new CANNON.Box(V3(0.03, 0.65, 0.03))); body.addShape(new CANNON.Cylinder(0.14, 0.2, 0.25, 8), V3(0, 0.62, 0)); break;
  }
  return body;
}

export function buildObjectMesh(type) { return buildMesh(type, ITEMS[type]); }

const DOOR_DEF ={ shape: 'door', size: [1.2, 2.2, 0.06], mass: 8, color: 0x8d6e63, label: 'Door', grip: 0.6 };

// ---------- instanced rendering pools ----------
const pools = new Map();
const INST = new Set(INSTANCED);
function labelTex(def) { // base color + accent band so instanced boxes still look like packaging
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#' + def.color.toString(16).padStart(6, '0'); x.fillRect(0, 0, 64, 64);
  if (def.accent) { x.fillStyle = '#' + def.accent.toString(16).padStart(6, '0'); x.fillRect(0, 14, 64, 18); x.fillStyle = '#ffffff'; x.beginPath(); x.arc(32, 23, 6, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function getPool(type, def) {
  if (pools.has(type)) return pools.get(type);
  const [a, b, c] = def.size;
  let geo;
  if (def.shape === 'box') geo = new THREE.BoxGeometry(a, b, c);
  else if (def.shape === 'cyl') geo = new THREE.CylinderGeometry(a, a, b, 10);
  else { geo = new THREE.SphereGeometry(a, 12, 8); if (type === 'melon') geo.scale(1, 0.9, 1.25); }
  const m = new THREE.MeshLambertMaterial({ map: def.shape === 'box' ? labelTex(def) : null, color: 0xffffff });
  const cap = 400;
  const im = new THREE.InstancedMesh(geo, m, cap);
  im.count = 0; im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.setColorAt(0, new THREE.Color(1, 1, 1));
  G.scene.add(im);
  const pool = { im, list: [], def };
  pools.set(type, pool);
  return pool;
}
const _col = new THREE.Color();
// boxes carry their color in the label texture (tint white unless recolored); round things are tinted per instance
const instColor = (o) => _col.setHex(o.color || (o.def.shape === 'box' ? 0xffffff : o.def.color));
function poolAdd(obj) {
  const pool = getPool(obj.type, obj.def);
  obj.inst = { pool, idx: pool.list.length };
  pool.list.push(obj);
  pool.im.count = pool.list.length;
  pool.im.setColorAt(obj.inst.idx, instColor(obj));
  pool.im.instanceColor.needsUpdate = true;
}
function poolRemove(obj) {
  const { pool, idx } = obj.inst;
  const last = pool.list.pop();
  if (last !== obj) { pool.list[idx] = last; last.inst.idx = idx; pool.im.setColorAt(idx, instColor(last)); pool.im.instanceColor.needsUpdate = true; }
  pool.im.count = pool.list.length;
  obj.inst = null;
}
export function updateInstances() {
  for (const pool of pools.values()) {
    const im = pool.im;
    for (let i = 0; i < pool.list.length; i++) { const m = pool.list[i].mesh; m.updateMatrix(); im.setMatrixAt(i, m.matrix); }
    im.instanceMatrix.needsUpdate = true;
  }
}

export function createObject(type, id, pos, quat, opts = {}) {
  let def = type === 'door' ? DOOR_DEF : ITEMS[type];
  if (!def) { console.warn('unknown type', type); return null; }
  if (type === 'door' && (opts.w || opts.glass)) def = { ...DOOR_DEF, size: [opts.w || 1.2, opts.h || 2.2, 0.06], glass: !!opts.glass, mass: opts.glass ? 5 : 8 };
  const instanced = INST.has(type);
  const mesh = instanced ? new THREE.Object3D() : buildMesh(type, def);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (quat) mesh.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
  if (!instanced) G.scene.add(mesh);
  const obj = {
    id, type, def, mesh, body: null, holder: null, lastHolder: null, flags: {}, home: [...pos],
    radius: Math.max(...def.size) * (def.shape === 'sphere' ? 1 : 0.6),
    tp: mesh.position.clone(), tq: mesh.quaternion.clone(), color: opts.color || null, opts, inst: null,
  };
  if (instanced) poolAdd(obj);
  mesh.traverse((o) => { o.userData.obj = obj; });
  if (G.isHost) {
    const body = buildBody(type, def, opts);
    body.position.set(pos[0], pos[1], pos[2]);
    if (quat) body.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    body.userData = { obj };
    body.aabbNeedsUpdate = true;
    world.addBody(body);
    obj.body = body;
    if (type === 'door') {
      const anchor = new CANNON.Body({ mass: 0 }); anchor.position.set(opts.hinge[0], opts.hinge[1], opts.hinge[2]); world.addBody(anchor);
      const hc = new CANNON.HingeConstraint(anchor, body, { pivotA: V3(0, 0, 0), axisA: V3(0, 1, 0), pivotB: V3(-def.size[0] / 2, 0, 0), axisB: V3(0, 1, 0) });
      world.addConstraint(hc); obj.anchor = anchor; obj.constraint = hc;
    }
    body.addEventListener('collide', (e) => onCollide(obj, e));
  }
  if (opts.color && !instanced) setObjColor(obj, opts.color);
  G.objects.set(id, obj);
  return obj;
}

let fxCount = 0;
setInterval(() => (fxCount = 0), 250);
function onCollide(obj, e) {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 1.2) return;
  // NPCs / shelves / displays react (game.js decides what's funny)
  G.onImpact && G.onImpact(obj, v, e.body);
  if (v < 1.5 || fxCount > 3) return;
  fxCount++;
  const p = obj.body.position;
  const k = Math.min(1, v / 8) * Math.min(1.5, 0.4 + obj.def.mass / 3);
  if (obj.type === 'cart' && v > 2) G.sound.playAll('cartCrash', p, Math.min(1, v / 5));
  else if (obj.def.mat === 'bouncy') { sfx('boing', p, k); G.net && G.net.broadcast({ t: 'fx', s: 'boing', p: [p.x, p.y, p.z], k }); }
  else G.sound.playAll('objectDrop', p, k);
}

export function setObjColor(obj, hex) {
  obj.color = hex;
  if (obj.inst) { obj.inst.pool.im.setColorAt(obj.inst.idx, instColor(obj)); obj.inst.pool.im.instanceColor.needsUpdate = true; return; }
  obj.mesh.traverse((o) => { if (o.isMesh && o === obj.mesh.children[0]) o.material = mat(hex); });
}

export function removeObject(id) {
  const o = G.objects.get(id); if (!o) return;
  if (o.inst) poolRemove(o); else G.scene.remove(o.mesh);
  if (o.body) world.removeBody(o.body);
  if (o.anchor) { world.removeConstraint(o.constraint); world.removeBody(o.anchor); }
  G.objects.delete(id);
  // release from any hand
  for (const p of G.players.values()) for (const h of p.hands) if (h.held === id) h.held = null;
}

export function clearObjects() { for (const id of [...G.objects.keys()]) removeObject(id); }

export function spawnObject(type, pos, quat, opts) {
  const id = newId('o');
  const o = createObject(type, id, pos, quat, opts);
  if (G.net && G.isHost) G.net.broadcast({ t: 'spawn', o: serializeObj(o) });
  return o;
}
export function despawnObject(id) {
  removeObject(id);
  if (G.net && G.isHost) G.net.broadcast({ t: 'despawn', id });
}

export function serializeObj(o) {
  const p = o.mesh.position, q = o.mesh.quaternion;
  const r = (n, k = 1000) => Math.round(n * k) / k;
  const out = { id: o.id, type: o.type, p: [r(p.x), r(p.y), r(p.z)], q: [r(q.x, 1e4), r(q.y, 1e4), r(q.z, 1e4), r(q.w, 1e4)] };
  if (o.color) out.c = o.color;
  if (o.opts && Object.keys(o.opts).length) out.opts = o.opts;
  return out;
}

const yq = (a) => { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a); return [q.x, q.y, q.z, q.w]; };

export function spawnInitialObjects() {
  const L2 = 5;
  // ---- MEGA MART ----
  for (const s of Z.productSpawns) spawnObject(pick(['cereal', 'cereal', 'milk', 'chips', 'chips', 'soda', 'tp']), s, yq(Math.PI / 2));
  const [b0, b1, b2, b3] = Z.produce;
  for (let i = 0; i < 6; i++) spawnObject('melon', [b0[0] - 0.8 + (i % 3) * 0.6, 1.1 + Math.floor(i / 3) * 0.3, b0[1] - 0.3 + Math.floor(i / 3) * 0.5], null);
  for (let i = 0; i < 8; i++) spawnObject('banana', [b1[0] - 0.7 + (i % 4) * 0.4, 1.0 + Math.floor(i / 4) * 0.06, b1[1] + rand(-0.4, 0.4)], yq(rand(0, 3)));
  for (let i = 0; i < 12; i++) spawnObject('apple', [b2[0] + rand(-0.9, 0.9), 1.0 + rand(0, 0.2), b2[1] + rand(-0.5, 0.5)], null, { color: pick([0xd32f2f, 0x7cb342]) });
  for (let i = 0; i < 12; i++) spawnObject('apple', [b3[0] + rand(-0.9, 0.9), 1.0 + rand(0, 0.2), b3[1] + rand(-0.5, 0.5)], null, { color: 0xff9800 });
  for (let i = 0; i < 4; i++) spawnObject('cart', [-9.7, 0.02, -11.3 + i * 0.95], yq(0));
  for (let i = 0; i < 5; i++) spawnObject('cart', [-23 + i * 0.75, 0.02, -10.5], yq(0));
  for (let i = 0; i < 5; i++) spawnObject('basket', [-25.5, 0.15 + i * 0.12, -10.5], null);
  for (const fz of Z.freezers.map((f) => f.z)) for (let i = 0; i < 5; i++) spawnObject('icecream', [-9.8 + rand(-0.2, 0.2), 0.55 + i * 0.12, fz - 1.3 + i * 0.6], null, { color: pick([0xf8bbd0, 0xffe0b2, 0xb3e5fc, 0xc8e6c9]) });
  // fridge doors (glass, hinged)
  for (const fx of [-41, -35, -29, -23]) spawnObject('door', [fx, 1.1, -38.92], [0, 0, 0, 1], { hinge: [fx - 0.45, 1.1, -38.92], w: 0.9, h: 2.0, glass: true });
  // stockroom: pallets of boxes
  for (const [x, z] of [[-57, -34], [-53, -34], [-57, -30], [-53, -30]]) for (let k = 0; k < 4; k++) spawnObject(k % 2 ? 'box' : 'stock', [x + (k % 2) * 0.1, 0.4 + k * 0.38, z], yq(rand(-0.2, 0.2)));
  // ---- staff / bathrooms ----
  spawnObject('mop', [50.5, 0.62, -38.4], [0, 0, 0.7071, 0.7071]);
  spawnObject('mop', [50.5, 0.62, -39.2], [0, 0, 0.7071, 0.7071]);
  spawnObject('wetsign', [48, 0.31, -36], yq(0));
  spawnObject('wetsign', [48.8, 0.31, -36], yq(0));
  spawnObject('blower', [48, 2.2, -39], yq(0));
  for (const s of Z.stalls) spawnObject('door', [(s.door[0] + s.door[2]) / 2, 0.95, s.door[1]], [0, 0, 0, 1], { hinge: [s.door[0], 0.95, s.door[1]], w: 0.95, h: 1.7 });
  // ---- food court ----
  for (const [x, z] of Z.tables) spawnObject('chair', [x, 0.02, z + 0.9], yq(0));
  // ---- toy store ----
  for (let i = 0; i < 30; i++) spawnObject('ball', [-55.5 + Math.random() * 7, 0.3 + Math.random() * 0.8, 22.5 + Math.random() * 7], null, { color: pick([0xff4081, 0x29b6f6, 0xffd23f, 0x66bb6a, 0xab47bc]) });
  for (let i = 0; i < 12; i++) spawnObject('block', [Z.toyTables[0] - 1.2 + (i % 4) * 0.3, 0.9 + Math.floor(i / 4) * 0.16, Z.toyTables[1] + 0.4], null, { color: pick([0x29b6f6, 0xff5252, 0xffd23f, 0x66bb6a]) });
  for (let i = 0; i < 3; i++) spawnObject('blaster', [Z.toyTables[0] + 0.3 + i * 0.35, 0.95, Z.toyTables[1] - 0.3], yq(Math.PI / 2));
  spawnObject('launcher', [Z.toyTables[0] - 0.5, 0.95, Z.toyTables[1] - 0.4], yq(Math.PI / 2));
  for (let i = 0; i < 5; i++) spawnObject('duck', [-39 + i * 0.4, 1.55, 38.5], yq(Math.PI));
  for (let i = 0; i < 4; i++) spawnObject('teddy', [-36.5 + i * 0.5, 1.6, 38.5], yq(Math.PI));
  spawnObject('chicken', [-35, 1.65, 38.5], yq(Math.PI));
  // ---- arcade / electronics / cinema / furniture ----
  for (let i = 0; i < 3; i++) spawnObject('bball', [13.7 + i * 0.3, 1.15, 35.5], null);
  for (const [x, z] of Z.gadgetTables) for (let i = 0; i < 3; i++) spawnObject('phone', [x - 0.8 + i * 0.8, 0.95, z], null, { color: pick([0x212121, 0xeceff1, 0x1565c0, 0xec407a]) });
  for (let i = 0; i < 4; i++) spawnObject('popcorn', [44 + i * 0.5, 1.3, 30], null);
  for (const [x, z] of Z.beds) for (let i = 0; i < 2; i++) spawnObject('pillow', [x - 0.45 + i * 0.9, 0.8, z - 0.6], null, { color: pick([0xfff9c4, 0xffffff, 0xf8bbd0]) });
  for (const [x, z] of [[-31, 36], [-17, 38], [-11, 25]]) spawnObject('lamp', [x, 0.72, z], null);
  // ---- L2 ----
  for (let i = 0; i < 3; i++) spawnObject('cup', [Z.coffee[0] - 1 + i * 0.5, L2 + 1.1, Z.coffee[2]], null);
  for (let i = 0; i < 6; i++) spawnObject('book', [-30 + (i % 3) * 0.3, L2 + 0.2, 11 + Math.floor(i / 3) * 3], null, { color: pick([0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825]) });
  for (let i = 0; i < 6; i++) spawnObject('ball', [Z.foamPit[0] + rand(-1, 1), L2 + 0.4 + i * 0.2, Z.foamPit[1] + rand(-1, 1)], null, { color: pick([0xff4081, 0xffd23f, 0x29b6f6]) });
  spawnObject('melon', [Z.office[0] - 2.5, L2 + 1.0, Z.office[2] + 1], null, { color: 0xffd700 });
  // ---- corridors, garage, plaza ----
  for (const [x, z] of [[-30, -2], [10, 6.5], [24, -3], [70, -5], [72, 10], [-12, 46]]) spawnObject('cone', [x, 0.26, z], null);
  for (const [x, z] of [[-6, 4], [68, 2], [75, -18], [10, 50], [-10, 50]]) spawnObject('cart', [x, 0.02, z], yq(rand(0, 3)));
  spawnObject('cart', [70, L2 + 0.02, 0], yq(1));
  // ---- safety gear ----
  for (const [x, y, z] of Z.extShelves) spawnObject('extinguisher', [x, y + 0.25, z], null);
  Z.hoseStations.forEach(([x, y, z, ry], i) => spawnObject('hose', [x + Math.sin(ry) * 0.15, y - 0.15, z + Math.cos(ry) * 0.15], yq(ry), { station: i }));
  buildDisplay();
}

// Cereal-box pyramid display. Knocking it over is a whole event.
export function buildDisplay() {
  const s = 0.245; let n = 0;
  for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) {
    const x = Z.display.x + (i - (3 - row) / 2) * s, y = 0.125 + row * s;
    const o = spawnObject('stock', [x, y, Z.display.z], null, { color: [0xf4b400, 0xe53935, 0x8e24aa, 0x43a047][row] });
    o.flags.display = true; o.home = [x, y, Z.display.z]; n++;
  }
  return n;
}

// Host: anything resting and barely moving goes to sleep (thin boxes on shelves otherwise jitter forever)
let sleepT = 0;
function sleepHelper(dt) {
  sleepT -= dt; if (sleepT > 0) return; sleepT = 0.5;
  for (const o of G.objects.values()) {
    const b = o.body; if (!b || o.holder || b.sleepState === CANNON.Body.SLEEPING) continue;
    if (b.velocity.lengthSquared() < 0.09 && b.angularVelocity.lengthSquared() < 0.5) { if ((o.slowT = (o.slowT || 0) + 1) >= 2) { b.sleep(); o.slowT = 0; } }
    else o.slowT = 0;
  }
}

const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion();
export function updateObjects(dt) {
  if (G.isHost) sleepHelper(dt);
  const k = damp(dt, 18);
  for (const o of G.objects.values()) {
    // local player's held objects render exactly at the hand (zero-latency feel)
    const lh = G.localHeld && G.localHeld.get(o.id);
    if (lh) {
      lh.hand.getWorldPose(_hp, _hq);
      o.mesh.position.copy(lh.offPos).applyQuaternion(_hq).add(_hp);
      o.mesh.quaternion.copy(_hq).multiply(lh.offQuat);
      continue;
    }
    if (o.body) {
      toThree(o.body, o.mesh);
      const bp = o.body.position;
      if (bp.y < -3 || bp.x < -75 || bp.x > 108 || bp.z < -55 || bp.z > 72) {
        o.body.position.set(o.home[0], o.home[1] + 0.5, o.home[2]); o.body.velocity.set(0, 0, 0); o.body.angularVelocity.set(0, 0, 0);
      }
    } else {
      o.mesh.position.lerp(o.tp, k);
      o.mesh.quaternion.slerp(o.tq, k);
    }
  }
}
