// Persistent progression: money, cosmetics, stats, achievements, daily challenges, settings.
import { ACHIEVEMENTS, DAILY_POOL, DEFAULT_LOOK, HATS, ACCS, NAME_A, NAME_B } from './config.js';
import { pick, seeded, toast } from './util.js';

const KEY = 'mallmayhem_save_v1';
const listeners = [];

function fresh() {
  return {
    name: pick(NAME_A) + ' ' + pick(NAME_B),
    money: 50,
    look: { ...DEFAULT_LOOK },
    owned: ['none', 'cap', 'shades'],
    upgrades: [],
    areas: [],
    gear: [],
    stats: {},
    achievements: [],
    day: '', dayStats: {}, dailyDone: [],
    settings: { move: 'both', turn: 'snap', snapAngle: 45, smoothTurnSpeed: 120, music: 0.5, sfx: 0.8,
      tts: true, voice: false, events: true, height: 0, vignette: true, npcModels: true, pvp: true, detach: true, ragdollStyle: 'normal' },
  };
}

export const Save = {
  data: fresh(),
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const f = fresh();
        this.data = { ...f, ...d, settings: { ...f.settings, ...(d.settings || {}) }, look: { ...f.look, ...(d.look || {}) } };
      }
    } catch (e) { /* storage blocked: play without saving */ }
    this.checkDay();
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) {} },
  onChange(fn) { listeners.push(fn); },
  changed() { this.save(); listeners.forEach((f) => f()); },

  checkDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.day !== today) { this.data.day = today; this.data.dayStats = {}; this.data.dailyDone = []; }
  },
  dailies() {
    const seed = parseInt(this.data.day.replace(/-/g, ''), 10);
    const rng = seeded(seed);
    const pool = [...DAILY_POOL]; const out = [];
    while (out.length < 3) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  },

  addMoney(n, reason) {
    this.data.money += n;
    if (n > 0) this.stat('earned', n, true);
    if (reason) toast(`${n >= 0 ? '+' : ''}$${n}  ${reason}`);
    this.changed();
  },
  spend(n) {
    if (this.data.money < n) { toast('Not enough money!'); return false; }
    this.data.money -= n; this.changed(); return true;
  },

  stat(key, n = 1, silent = false) {
    this.checkDay();
    this.data.stats[key] = (this.data.stats[key] || 0) + n;
    this.data.dayStats[key] = (this.data.dayStats[key] || 0) + n;
    // achievements
    for (const a of ACHIEVEMENTS) {
      if (a.stat === key && !this.data.achievements.includes(a.id) && this.data.stats[key] >= a.goal) {
        this.data.achievements.push(a.id);
        Save.onAchieve && Save.onAchieve(a);
      }
    }
    // dailies
    for (const d of this.dailies()) {
      if (d.stat === key && !this.data.dailyDone.includes(d.id) && this.data.dayStats[key] >= d.goal) {
        this.data.dailyDone.push(d.id);
        this.data.money += d.reward;
        toast(`DAILY DONE: ${d.text}  +$${d.reward}`, 3500);
      }
    }
    if (!silent) this.changed();
  },

  hasItem(id) {
    const def = [...HATS, ...ACCS].find((x) => x.id === id);
    if (!def) return false;
    if (def.ach) return this.data.achievements.includes(def.ach);
    return def.price === 0 || this.data.owned.includes(id);
  },
  buyItem(id) {
    const def = [...HATS, ...ACCS].find((x) => x.id === id);
    if (!def || this.hasItem(id) || def.ach) return false;
    if (!this.spend(def.price)) return false;
    this.data.owned.push(id); this.changed(); return true;
  },
  payMult(job) {
    const map = { cashier: 'scanner', janitor: 'turbomop', food: 'tipjar', stocker: 'forklift', security: 'whistle' };
    return this.data.upgrades.includes(map[job]) ? 1.5 : 1;
  },
};
