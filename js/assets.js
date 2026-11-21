// Loads the user's GLB models + images, and optimizes them for Quest at load time.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const MODEL_FILES = {
  hand: 'assets/models/hand_src.glb',
  guard: 'assets/models/guard_src.glb',
  girl: 'assets/models/girl_src.glb',
  man: 'assets/models/man_src.glb',
};
export const IMAGE_FILES = { babyAsh: 'assets/images/baby_ash.webp' };

// Character Creator sub-meshes nobody can see from VR distance (saves draw calls)
const HIDE_MATERIALS = /Tongue|Teeth|Tearline|Occlusion|Cornea/i;
const MAX_TEX = 512;

export const A = { models: {}, images: {}, ready: false, failed: [] };

function shrinkTexture(tex) {
  const img = tex && tex.image;
  if (!img || !img.width || (img.width <= MAX_TEX && img.height <= MAX_TEX)) return;
  const s = MAX_TEX / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  tex.image = c; tex.needsUpdate = true;
}

// PBR + clearcoat is expensive on mobile GPUs. Lambert keeps the textures and colors.
function cheapMaterial(m) {
  shrinkTexture(m.map);
  const out = new THREE.MeshLambertMaterial({
    map: m.map || null, color: m.color ? m.color.clone() : 0xffffff,
    transparent: m.transparent, opacity: m.opacity, alphaTest: m.transparent ? 0.3 : (m.alphaTest || 0),
    side: m.side,
  });
  out.name = m.name;
  if (out.transparent) { out.transparent = false; out.alphaTest = 0.4; } // hair cards: cutout is cheaper + no sorting bugs
  m.dispose();
  return out;
}

function prepare(key, gltf) {
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (key !== 'hand' && mats.some((m) => HIDE_MATERIALS.test(m.name || ''))) { o.visible = false; return; }
    const conv = mats.map(cheapMaterial);
    o.material = Array.isArray(o.material) ? conv : conv[0];
    o.frustumCulled = key !== 'hand';
  });
  return { scene: root, animations: gltf.animations };
}

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  const keys = Object.keys(MODEL_FILES);
  const progress = {}; const total = () => keys.reduce((s, k) => s + (progress[k] || 0), 0) / keys.length;
  await Promise.all([
    ...keys.map((k) => new Promise((res) => {
      loader.load(MODEL_FILES[k], (g) => { A.models[k] = prepare(k, g); progress[k] = 1; onProgress && onProgress(total()); res(); },
        (e) => { if (e.total) { progress[k] = e.loaded / e.total; onProgress && onProgress(total()); } },
        (err) => { console.warn('model failed', k, err); A.failed.push(k); progress[k] = 1; res(); });
    })),
    ...Object.entries(IMAGE_FILES).map(([k, url]) => new Promise((res) => {
      new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; A.images[k] = t; res(); }, undefined, () => { A.failed.push(k); res(); });
    })),
  ]);
  A.ready = true;
  return A;
}

export function cloneModel(key) {
  const m = A.models[key];
  if (!m) return null;
  return SkeletonUtils.clone(m.scene);
}
