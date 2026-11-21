// Shared game state. Every module imports G instead of passing references around.
export const G = {
  scene: null, renderer: null, camera: null, rig: null, clock: null,
  isHost: true,          // offline play = you are the host of a 1-player session
  online: false,
  myId: 'local',
  mode: 'menu',          // 'menu' | 'play'
  vr: false,             // inside an immersive session
  desktop: false,
  objects: new Map(),    // id -> GameObject
  players: new Map(),    // id -> PlayerState (host keeps all; clients keep remotes for rendering)
  npcs: new Map(),
  markers: new Map(),
  panels: [],            // interactable UI panels
  buttons: [],           // physical 3D buttons
  events: {},            // active random events: name -> endsAt
  gateOpen: false,
  time: 0,
};

let _id = 1;
export const newId = (p = 'o') => p + (_id++).toString(36);
