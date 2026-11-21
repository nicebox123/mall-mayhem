// Blocky goofy characters for players, NPCs, and the customization mannequin. Forward = -Z.
import * as THREE from 'three';
import { SKINS, COLORS } from './config.js';
import { box, mat, textTexture } from './util.js';

const faces = {};
function faceMat(kind) {
  if (faces[kind]) return faces[kind];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 128, 128); // white base: the material color tints it to skin
  x.fillStyle = '#000'; x.strokeStyle = '#000'; x.lineWidth = 7; x.lineCap = 'round';
  const eye = (cx, cy, r) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.fillStyle = '#111'; x.beginPath(); x.arc(cx, cy + 2, r * 0.5, 0, 7); x.fill(); };
  if (kind === 'happy') { eye(40, 50, 14); eye(88, 50, 14); x.beginPath(); x.arc(64, 78, 22, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke(); }
  if (kind === 'shock') { eye(40, 46, 18); eye(88, 46, 18); x.fillStyle = '#300'; x.beginPath(); x.ellipse(64, 95, 14, 18, 0, 0, 7); x.fill(); }
  if (kind === 'angry') { eye(40, 54, 12); eye(88, 54, 12); x.beginPath(); x.moveTo(22, 30); x.lineTo(56, 42); x.moveTo(106, 30); x.lineTo(72, 42); x.stroke();
    x.beginPath(); x.arc(64, 104, 20, 1.15 * Math.PI, 1.85 * Math.PI); x.stroke(); }
  if (kind === 'dizzy') { x.font = 'bold 40px sans-serif'; x.fillStyle = '#000'; x.textAlign = 'center'; x.fillText('X', 40, 64); x.fillText('X', 88, 64);
    x.beginPath(); x.moveTo(40, 96); x.quadraticCurveTo(64, 80, 88, 96); x.stroke(); }
  if (kind === 'cool') { x.fillStyle = '#111'; x.fillRect(18, 38, 92, 24); x.beginPath(); x.arc(64, 80, 18, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  faces[kind] = t; return t;
}

function buildHat(id) {
  const g = new THREE.Group();
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  switch (id) {
    case 'cap': add(box(0.34, 0.1, 0.34, 0xe53935), 0, 0.05, 0); add(box(0.3, 0.03, 0.16, 0xe53935), 0, 0.01, -0.22); break;
    case 'beanie': add(box(0.35, 0.14, 0.35, 0x00897b), 0, 0.06, 0); add(box(0.1, 0.08, 0.1, 0xffffff), 0, 0.16, 0); break;
    case 'chef': add(box(0.3, 0.08, 0.3, 0xffffff), 0, 0.04, 0); add(box(0.38, 0.2, 0.38, 0xffffff), 0, 0.18, 0); break;
    case 'cone': { const c = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.45, 8), mat(0xff6d00)); add(c, 0, 0.22, 0); add(box(0.2, 0.05, 0.2, 0xffffff), 0, 0.2, 0).scale.set(0.24, 0.05, 0.24); break; }
    case 'tophat': add(box(0.44, 0.03, 0.44, 0x212121), 0, 0.015, 0); add(box(0.28, 0.3, 0.28, 0x212121), 0, 0.17, 0); add(box(0.29, 0.05, 0.29, 0xc62828), 0, 0.06, 0); break;
    case 'propeller': add(box(0.34, 0.1, 0.34, 0x1e88e5), 0, 0.05, 0); add(box(0.04, 0.08, 0.04, 0xffd23f), 0, 0.13, 0);
      { const p = add(box(0.5, 0.02, 0.07, 0xff4f9a), 0, 0.17, 0); p.userData.spin = true; } break;
    case 'crown': for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; add(box(0.12, 0.14, 0.04, 0xffc107), Math.sin(a) * 0.14, 0.07, Math.cos(a) * 0.14).rotation.y = a; }
      add(box(0.32, 0.06, 0.32, 0xffc107), 0, 0.03, 0); break;
  }
  return g;
}

function buildAcc(id) {
  const g = new THREE.Group();
  const add = (m, x, y, z) => { m.position.set(x, y, z); g.add(m); return m; };
  switch (id) {
    case 'shades': add(box(0.34, 0.07, 0.03, 0x111111), 0, 0.03, -0.17); break;
    case 'mustache': add(box(0.2, 0.05, 0.03, 0x4e342e), 0, -0.06, -0.17); break;
    case 'bowtie': add(box(0.16, 0.08, 0.04, 0xd81b60), 0, -0.22, -0.14); break;
    case 'nose': add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0xff1744)), 0, -0.02, -0.18); break;
    case 'headphones': add(box(0.04, 0.12, 0.12, 0x263238), 0.18, 0, 0); add(box(0.04, 0.12, 0.12, 0x263238), -0.18, 0, 0); add(box(0.38, 0.04, 0.06, 0x263238), 0, 0.18, 0); break;
    case 'badge': add(box(0.08, 0.08, 0.02, 0xffc107), 0.1, -0.33, -0.14); break;
  }
  return g;
}

export function makeAvatar(look, { legs = true, scale = 1 } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const skinM = new THREE.MeshLambertMaterial({ color: SKINS[look.skin] || SKINS[0] });
  const shirtM = new THREE.MeshLambertMaterial({ color: COLORS[look.shirt] || COLORS[0] });
  const pantsM = new THREE.MeshLambertMaterial({ color: COLORS[look.pants] || COLORS[7] });
  const faceM = new THREE.MeshLambertMaterial({ map: faceMat('happy'), color: SKINS[look.skin] || SKINS[0] });
  const geo = new THREE.BoxGeometry(1, 1, 1);

  const torso = new THREE.Mesh(geo, shirtM); torso.scale.set(0.42, 0.5, 0.24); torso.position.y = 1.15; body.add(torso);
  const head = new THREE.Group(); head.position.y = 1.58; body.add(head);
  const headMesh = new THREE.Mesh(geo, [skinM, skinM, skinM, skinM, skinM, faceM]); headMesh.scale.setScalar(0.32); head.add(headMesh);
  const mk = (m, w, h, d, x, y, z) => { const piv = new THREE.Group(); piv.position.set(x, y, z); const me = new THREE.Mesh(geo, m); me.scale.set(w, h, d); me.position.y = -h / 2; piv.add(me); body.add(piv); return piv; };
  const armL = mk(shirtM, 0.12, 0.45, 0.12, -0.28, 1.38, 0);
  const armR = mk(shirtM, 0.12, 0.45, 0.12, 0.28, 1.38, 0);
  [armL, armR].forEach((a) => { const h = new THREE.Mesh(geo, skinM); h.scale.setScalar(0.13); h.position.y = -0.5; a.add(h); });
  let legL = null, legR = null;
  if (legs) { legL = mk(pantsM, 0.16, 0.9, 0.18, -0.11, 0.9, 0); legR = mk(pantsM, 0.16, 0.9, 0.18, 0.11, 0.9, 0); }
  else { armL.visible = armR.visible = false; }

  const av = {
    root, body, head, torso, armL, armR, legL, legR, faceM, hat: null, acc: null, look: null, phase: Math.random() * 6,
    setLook(l) {
      this.look = { ...l };
      skinM.color.setHex(SKINS[l.skin] ?? SKINS[0]); faceM.color.setHex(SKINS[l.skin] ?? SKINS[0]);
      shirtM.color.setHex(COLORS[l.shirt] ?? COLORS[0]); pantsM.color.setHex(COLORS[l.pants] ?? COLORS[7]);
      if (this.hat) head.remove(this.hat);
      if (this.acc) head.remove(this.acc);
      this.hat = buildHat(l.hat); this.hat.position.y = 0.16; head.add(this.hat);
      this.acc = buildAcc(l.acc); head.add(this.acc);
    },
    setFace(kind) { faceM.map = faceMat(kind); faceM.needsUpdate = true; },
    // walk animation driven by speed (m/s)
    animate(dt, speed) {
      this.phase += dt * (3 + speed * 5);
      const sw = Math.min(1, speed) * 0.7;
      if (legL) { legL.rotation.x = Math.sin(this.phase) * sw; legR.rotation.x = -Math.sin(this.phase) * sw; }
      if (armL.visible) { armL.rotation.x = -Math.sin(this.phase) * sw * 0.8; armR.rotation.x = Math.sin(this.phase) * sw * 0.8; }
      body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * Math.min(1, speed);
      if (this.hat) this.hat.traverse((o) => { if (o.userData.spin) o.rotation.y += dt * 15; });
      armL.rotation.z = 0; armR.rotation.z = 0; head.rotation.set(0, 0, 0);
    },
    // Same pose codes as character models (see characters.js). +X swings an arm forward.
    pose(code, t) {
      switch (code) {
        case 2: armL.rotation.x = 2.8 + Math.sin(t * 18) * 0.4; armR.rotation.x = 2.8 - Math.sin(t * 18) * 0.4; break;
        case 3: armR.rotation.x = 1.6; head.rotation.x = 0.1; break;
        case 4: armL.rotation.x = 2.8 + Math.sin(t * 8) * 0.5; armR.rotation.x = 2.8 - Math.sin(t * 8) * 0.5; body.position.y = Math.abs(Math.sin(t * 8)) * 0.15; break;
        case 5: armR.rotation.x = 2.4; armR.rotation.z = 0.5; head.rotation.z = Math.sin(t * 3) * 0.25; break;
        case 6: body.rotation.z = Math.sin(t * 16) * 0.3; armL.rotation.z = -1.3; armR.rotation.z = 1.3; break;
        case 7: head.rotation.x = -0.1; break;
        case 8: body.position.y = -0.45; armL.rotation.x = 2.9; armR.rotation.x = 2.9; head.rotation.x = 0.5; break;
        case 9: armL.rotation.x = 1.8 + Math.sin(t * 14) * 0.5; armR.rotation.x = 1.8 - Math.sin(t * 14) * 0.5; body.position.y = Math.abs(Math.sin(t * 12)) * 0.06; break;
        case 10: armR.rotation.x = 2.3; head.rotation.y = Math.sin(t * 1.5) * 0.7; break;
        case 11: head.rotation.x = -0.55 + Math.sin(t * 1.2) * 0.05; armL.rotation.x = 0.15; armR.rotation.x = 0.15; body.position.y = Math.sin(t * 1.2) * 0.02; break; // asleep standing
      }
      if (code !== 6) body.rotation.z = 0;
    },
  };
  av.setLook(look);
  root.scale.setScalar(scale);
  return av;
}

export function nameTag(text, color = '#ffd23f') {
  const tex = textTexture(text, { w: 512, h: 96, bg: 'rgba(27,19,64,0.8)', fg: color, font: 'bold 54px "Trebuchet MS", sans-serif', radius: 40 });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  s.scale.set(0.6, 0.11, 1);
  return s;
}
