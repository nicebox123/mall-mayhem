// MALL MAYHEM — boot + main loop.
import * as THREE from 'three';
import { G } from './state.js';
import { Save } from './save.js';
import { world } from './physics.js';
import { buildWorld, updateWorldVisuals } from './world.js';
import { initGame, hostUpdate, animateMarkers } from './game.js';
import { initPlayer, updatePlayer, getLocalPose, enterDesktopMode, L } from './player.js';
import { stepPlayersPhysics, updateRemoteVisuals } from './players.js';
import { updateObjects } from './objects.js';
import { buildNav, updateNpcsHost, updateNpcVisuals } from './npc.js';
import { initMenus, updateMenus, Menus } from './menus.js';
import { startOfflineWorld, netUpdate } from './net.js';
import { initAudio } from './audio.js';
import { Sound } from './sounds.js';
import { loadAssets } from './assets.js';
import { upgradeHands } from './player.js';
import { initParticles, updateParticles } from './particles.js';
import { updateFireVisuals } from './fire.js';
import { updateProjectiles } from './combat.js';
import { updateRagdollVisuals } from './ragdoll.js';
import { updateInstances } from './objects.js';

const status = document.getElementById('status');
const btnVR = document.getElementById('btnVR'), btnDesk = document.getElementById('btnDesk');

Save.load();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
camera.position.set(0, 1.6, 0);
Object.assign(G, { renderer, scene, camera, clock: new THREE.Clock() });

Sound.preloadSounds();
buildWorld(scene);
initParticles(scene);
initGame(scene);
initPlayer(scene, renderer, camera);
initMenus(scene);
buildNav();
btnDesk.disabled = true;
const deskLabel = btnDesk.textContent;
const assets = await loadAssets((p) => { status.textContent = `Loading shoppers & hands... ${Math.round(p * 100)}%`; btnDesk.textContent = `LOADING ${Math.round(p * 100)}%`; });
upgradeHands();
startOfflineWorld();
Menus.openMain();
btnDesk.disabled = false; btnDesk.textContent = deskLabel;
status.textContent = 'Mall open! ' + (window.isSecureContext ? '' : '(VR needs HTTPS) ') + (assets.failed.length ? `Missing assets: ${assets.failed.join(', ')}` : '');

// ---------- VR session ----------
async function setupVRButton() {
  if (!navigator.xr || !window.isSecureContext) { btnVR.textContent = window.isSecureContext ? 'VR NOT AVAILABLE' : 'VR NEEDS HTTPS'; return; }
  const ok = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!ok) { btnVR.textContent = 'VR NOT AVAILABLE'; return; }
  btnVR.disabled = false; btnVR.textContent = 'ENTER VR';
  btnVR.onclick = async () => {
    initAudio();
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      renderer.xr.setReferenceSpaceType('local-floor');
      await renderer.xr.setSession(session);
      G.vr = true; G.desktop = false;
      document.getElementById('overlay').style.display = 'none';
      document.getElementById('crosshair').style.display = 'none';
      setTimeout(() => Menus.openMain(), 400); // re-place menu once the headset pose is known
      session.addEventListener('end', () => { G.vr = false; document.getElementById('overlay').style.display = 'flex'; });
    } catch (e) { status.textContent = 'Could not start VR: ' + e.message; }
  };
}
setupVRButton();

btnDesk.onclick = () => {
  initAudio();
  enterDesktopMode();
  document.getElementById('overlay').style.display = 'none';
  Menus.openMain();
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.addEventListener('pointerlockchange', () => Menus.updateHud());

// ---------- main loop ----------
const STEP = 1 / 60;
let acc = 0, hudT = 0;
let errCount = 0;
let lastRaf = performance.now();
renderer.setAnimationLoop(() => {
  lastRaf = performance.now();
  try { frame(true); } catch (e) { if (errCount++ < 5) console.error(e); renderer.render(scene, camera); }
});
// Browsers pause or throttle requestAnimationFrame in hidden/minimized windows; keep the simulation +
// network alive so a PC host who alt-tabs doesn't freeze everyone else.
setInterval(() => { if (!G.vr && performance.now() - lastRaf > 150) { try { frame(false); } catch (e) { if (errCount++ < 5) console.error(e); } } }, 50);
function frame(render) {
  const dt = Math.min(G.clock.getDelta(), 0.05);
  G.time += dt;
  updatePlayer(dt);
  if (G.me) getLocalPose(G.me);
  if (G.isHost) {
    acc += dt; let n = 0;
    while (acc >= STEP && n < 3) { stepPlayersPhysics(STEP); world.step(STEP); acc -= STEP; n++; }
    if (n === 3) acc = 0;
    updateNpcsHost(dt);
    hostUpdate(dt);
  }
  updateObjects(dt);
  updateInstances();
  updateProjectiles(dt);
  updateRagdollVisuals(dt);
  updateNpcVisuals(dt);
  updateRemoteVisuals(dt);
  updateWorldVisuals(dt, G.time);
  updateFireVisuals(dt, G.time);
  updateParticles(dt);
  Sound.updateListener();
  Sound.updateAmbience(dt);
  animateMarkers(G.time);
  updateMenus(dt);
  netUpdate(dt);
  hudT -= dt; if (hudT < 0) { hudT = 0.5; if (G.desktop) Menus.updateHud(); Menus.refreshWatch(); }
  if (render) renderer.render(scene, camera);
}

window.__G = G; // debugging handle
