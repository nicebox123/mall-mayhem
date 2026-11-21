// Cartoon ragdolls. Host simulates articulated cannon-es bodies; everyone renders synced part poses.
//  - Blocky characters (players + blocky NPCs) get a 6-part ragdoll joined with ball joints.
//    Big hits can POP parts off (head, arms, legs): clean cartoon blocks, no gore. They snap back on recovery.
//  - GLB model NPCs get a single rigid "tumble" body that the skinned model rides (rigs can't be split).
import * as THREE from 'three';
import { G, newId } from './state.js';
import { world, CANNON, V3 } from './physics.js';
import { SKINS, COLORS } from './config.js';
import { Save } from './save.js';
import { smokePuff, confetti } from './particles.js';
import { pick, damp } from './util.js';

export const ragdolls = new Map();
const PARTS = [
  { n: 'torso', size: [0.42, 0.5, 0.24], pos: [0, 1.15, 0], mass: 8, col: 'shirt' },
  { n: 'head', size: [0.32, 0.32, 0.32], pos: [0, 1.58, 0], mass: 3, col: 'skin', face: true },
  { n: 'armL', size: [0.12, 0.5, 0.12], pos: [-0.28, 1.13, 0], mass: 1.6, col: 'shirt' },
  { n: 'armR', size: [0.12, 0.5, 0.12], pos: [0.28, 1.13, 0], mass: 1.6, col: 'shirt' },
  { n: 'legL', size: [0.16, 0.85, 0.18], pos: [-0.11, 0.45, 0], mass: 3, col: 'pants' },
  { n: 'legR', size: [0.16, 0.85, 0.18], pos: [0.11, 0.45, 0], mass: 3, col: 'pants' },
];
// joint: [childIndex, pivot on torso, pivot on child]
const JOINTS = [[1, [0, 0.27, 0], [0, -0.17, 0]], [2, [-0.25, 0.22, 0], [0, 0.22, 0]], [3, [0.25, 0.22, 0], [0, 0.22, 0]],
  [4, [-0.11, -0.26, 0], [0, 0.4, 0]], [5, [0.11, -0.26, 0], [0, 0.4, 0]]];
const ZONE_PART = { head: 1, body: 0, legs: 4 };

const faceTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.font = 'bold 22px sans-serif'; x.fillStyle = '#000'; x.textAlign = 'center';
  x.fillText('X', 20, 30); x.fillText('X', 44, 30); x.beginPath(); x.arc(32, 50, 8, 0, Math.PI, true); x.lineWidth = 3; x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function buildVisual(rd) {
  if (rd.kind !== 'blocky') return;
  const look = rd.look || {};
  const cols = { skin: SKINS[look.skin] ?? SKINS[0], shirt: COLORS[look.shirt] ?? COLORS[0], pants: COLORS[look.pants] ?? COLORS[7] };
  rd.parts.forEach((p, i) => {
    const def = PARTS[i];
    const m = new THREE.MeshLambertMaterial({ color: cols[def.col] });
    const mats = def.face ? [m, m, m, m, m, new THREE.MeshLambertMaterial({ map: faceTex, color: cols.skin })] : m;
    const mesh = new THREE.Mesh(boxGeo, mats); mesh.scale.set(def.size[0] * rd.scale, def.size[1] * rd.scale, def.size[2] * rd.scale);
    mesh.position.copy(p.tp); mesh.quaternion.copy(p.tq);
    G.scene.add(mesh); p.mesh = mesh;
  });
}

// Initial part transforms from a standing pose at (x, y, z) facing rot
function initialParts(kind, x, y, z, rot, s) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  if (kind === 'model') return [{ n: 'body', tp: new THREE.Vector3(x, y + 0.85 * s, z), tq: q.clone() }];
  return PARTS.map((d) => ({ n: d.n, tp: new THREE.Vector3(d.pos[0] * s, d.pos[1] * s, d.pos[2] * s).applyQuaternion(q).add(new THREE.Vector3(x, y, z)), tq: q.clone() }));
}

// ---------------- HOST ----------------
// opts: { owner:{type:'npc'|'p', id}, kind, look, scale, x, y, z, rot, dir:{x,y,z}, strength 0..1, zone, life }
export function spawnRagdoll(opts) {
  const s = opts.scale || 1;
  const rd = { id: newId('r'), kind: opts.kind || 'blocky', owner: opts.owner, look: opts.look, scale: s, model: opts.model || null,
    parts: initialParts(opts.kind || 'blocky', opts.x, opts.y, opts.z, opts.rot || 0, s), constraints: [], detached: new Set(),
    t: 0, life: opts.life ?? 3.5 };
  const dir = opts.dir || { x: 0, y: 0, z: -1 };
  const str = Math.max(0.15, Math.min(1, opts.strength ?? 0.5));
  const extreme = Save.data.settings.ragdollStyle === 'extreme';
  const push = (extreme ? 1.8 : 1) * (3 + str * 9);
  rd.parts.forEach((p, i) => {
    const def = rd.kind === 'model' ? { size: [0.5, 1.7, 0.35], mass: 20 } : PARTS[i];
    const b = new CANNON.Body({ mass: def.mass, linearDamping: 0.05, angularDamping: 0.2 });
    b.addShape(new CANNON.Box(V3(def.size[0] * s / 2, def.size[1] * s / 2, def.size[2] * s / 2)));
    b.position.set(p.tp.x, p.tp.y, p.tp.z); b.quaternion.set(p.tq.x, p.tq.y, p.tq.z, p.tq.w);
    b.collisionFilterGroup = 4; b.collisionFilterMask = 1;  // collide with the world, not with each other
    b.allowSleep = false; b.userData = { ragdoll: rd };
    b.aabbNeedsUpdate = true;
    world.addBody(b); p.body = b;
    // knockback: everything flies, the part that got hit flies more
    const k = (i === (ZONE_PART[opts.zone] ?? 0) ? 1.4 : 1) * push;
    b.velocity.set(dir.x * k, Math.max(1.5, dir.y * k + 2.5 * str + (extreme ? 2 : 0)), dir.z * k);
    b.angularVelocity.set((Math.random() - 0.5) * 12 * str, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 12 * str);
  });
  if (rd.kind === 'blocky') {
    for (const [ci, pa, pb] of JOINTS) {
      const c = new CANNON.PointToPointConstraint(rd.parts[0].body, V3(pa[0] * s, pa[1] * s, pa[2] * s), rd.parts[ci].body, V3(pb[0] * s, pb[1] * s, pb[2] * s));
      world.addConstraint(c); rd.constraints[ci] = c;
    }
  }
  ragdolls.set(rd.id, rd);
  buildVisual(rd);
  G.net.broadcast({ t: 'rag', r: serializeRag(rd) });
  // cartoon detaching parts
  if (rd.kind === 'blocky' && Save.data.settings.detach !== false && (str > 0.6 || extreme)) {
    const chance = extreme ? 0.9 : 0.5;
    if (Math.random() < chance) detachPart(rd, opts.zone === 'head' ? 1 : opts.zone === 'legs' ? pick([4, 5]) : pick([1, 2, 3]));
    if (extreme && Math.random() < 0.5) detachPart(rd, pick([2, 3, 4, 5]));
  }
  return rd;
}

export function detachPart(rd, i) {
  if (rd.detached.has(i) || !rd.constraints[i]) return;
  rd.detached.add(i);
  world.removeConstraint(rd.constraints[i]); rd.constraints[i] = null;
  const b = rd.parts[i].body;
  b.velocity.y += 4; b.velocity.x += (Math.random() - 0.5) * 4; b.velocity.z += (Math.random() - 0.5) * 4;
  b.angularVelocity.set((Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25, (Math.random() - 0.5) * 25);
  G.net.broadcast({ t: 'detach', id: rd.id, i });
  onDetachFx(rd, i);
}
function onDetachFx(rd, i) {
  const p = rd.parts[i].tp;
  G.sound.play('npcStumble', p, 1); G.sound.play('chickenSlap', p, 0.6);
  G.combat && G.combat.popText(i === 1 ? 'POP!' : 'BOING!', p, '#ffd23f');
  confetti(p, 14);
}

export function endRagdoll(id, fx = true) {
  const rd = ragdolls.get(id); if (!rd) return;
  if (fx) { const tp = rd.parts[0].tp; smokePuff(tp, 10, 0xffffff); G.sound.play('pop', tp, 1); }
  for (const c of rd.constraints) if (c) world.removeConstraint(c);
  for (const p of rd.parts) { if (p.body) world.removeBody(p.body); if (p.mesh) G.scene.remove(p.mesh); }
  ragdolls.delete(id);
  if (G.isHost) G.net.broadcast({ t: 'ragEnd', id });
}
export function clearRagdolls() { for (const id of [...ragdolls.keys()]) endRagdoll(id, false); }

export function serializeRag(rd) {
  return { id: rd.id, kind: rd.kind, owner: rd.owner, look: rd.look, scale: rd.scale, model: rd.model, det: [...rd.detached],
    p: rd.parts.map((p) => [+p.tp.x.toFixed(3), +p.tp.y.toFixed(3), +p.tp.z.toFixed(3), +p.tq.x.toFixed(4), +p.tq.y.toFixed(4), +p.tq.z.toFixed(4), +p.tq.w.toFixed(4)]) };
}
export function ragSnapshot() {
  const out = [];
  for (const rd of ragdolls.values()) out.push([rd.id, rd.parts.map((p) => [+p.tp.x.toFixed(3), +p.tp.y.toFixed(3), +p.tp.z.toFixed(3), +p.tq.x.toFixed(3), +p.tq.y.toFixed(3), +p.tq.z.toFixed(3), +p.tq.w.toFixed(3)])]);
  return out;
}

// Host: lifetime + NPC recovery
export function updateRagdollsHost(dt) {
  for (const rd of [...ragdolls.values()]) {
    rd.t += dt;
    for (const p of rd.parts) if (p.body) { p.tp.set(p.body.position.x, p.body.position.y, p.body.position.z); p.tq.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w); }
    if (rd.owner.type === 'npc' && rd.t > rd.life) {
      const n = G.npcs.get(rd.owner.id);
      if (n) { G.onRagdollEnd && G.onRagdollEnd(n, rd); }
      endRagdoll(rd.id);
    }
    if (rd.t > 30) endRagdoll(rd.id); // safety
  }
}

// ---------------- CLIENT ----------------
export function clientAddRag(r) {
  if (ragdolls.has(r.id)) return;
  const rd = { id: r.id, kind: r.kind, owner: r.owner, look: r.look, scale: r.scale, model: r.model, detached: new Set(r.det || []), constraints: [], t: 0,
    parts: r.p.map((a, i) => ({ n: i, tp: new THREE.Vector3(a[0], a[1], a[2]), tq: new THREE.Quaternion(a[3], a[4], a[5], a[6]) })) };
  ragdolls.set(rd.id, rd); buildVisual(rd);
}
export function clientDetach(id, i) { const rd = ragdolls.get(id); if (rd) { rd.detached.add(i); onDetachFx(rd, i); } }
export function applyRagSnap(list) {
  for (const [id, parts] of list) {
    const rd = ragdolls.get(id); if (!rd) continue;
    parts.forEach((a, i) => { const p = rd.parts[i]; if (!p) return; p.tp.set(a[0], a[1], a[2]); p.tq.set(a[3], a[4], a[5], a[6]).normalize(); });
  }
}

// Everyone: move the meshes (host = exact, clients = smoothed)
export function updateRagdollVisuals(dt) {
  const k = G.isHost ? 1 : damp(dt, 20);
  for (const rd of ragdolls.values()) {
    for (const p of rd.parts) if (p.mesh) { p.mesh.position.lerp(p.tp, k); p.mesh.quaternion.slerp(p.tq, k); }
  }
}
// GLB NPC riding a tumble body: returns transform for the avatar root, or null
export function ragFor(ownerType, id) {
  for (const rd of ragdolls.values()) if (rd.owner.type === ownerType && rd.owner.id === id) return rd;
  return null;
}
