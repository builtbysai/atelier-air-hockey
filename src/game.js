/* ============================================================
   ATELIER AIR HOCKEY - engine v2
   Rebuilt from research: Brunswick 1969 roots, near-zero-friction
   puck glide, velocity-transfer striking, human-like AI, and the
   full juice canon (hit-stop, trauma shake + rotation, particles,
   squash, trails, scuff permanence, slow-mo goal ceremony).
   Modular source. Mobile-first. No image/audio asset dependencies.
   ============================================================ */
'use strict';

// ---------- dimensions (2:1 rink, USAA-style proportions) ----------
const VW = 1440, VH = 1040;          // view space
const PX = 200, PY = 200, PW = 1040, PH = 640;  // playfield
const CX = PX + PW / 2, CY = PY + PH / 2;
const PUCK_R = 26, MALLET_R = 46, RAIL = 26;
// Goal-mouth presets (v20): adjustable in Settings → Goal mouth. Standard is
// the new default - narrower than the old fixed 230 (36% of the wall was
// swallowing deflections). The host's choice rides the countdown event
// online; guests apply it as a match-scoped override (G.gwNet).
const GOAL_W = 230; // the Wide preset; legacy fixed width - use goalW() below
const GOAL_PRESETS = { narrow: 170, standard: 200, wide: 230 };
function goalW() {
  if (G.gwNet > 0) return G.gwNet; // online guest: the host's width for this match
  return GOAL_PRESETS[Settings.goalW] || GOAL_PRESETS.standard;
}
const TX0 = PX - RAIL, TY0 = PY - RAIL;
const TAU = Math.PI * 2;

// ---------- user settings (persisted) ----------
const Settings = {
  shake: 'full',      // 'off' | 'subtle' | 'full'
  sound: true,
  masterMuted: false, // HUD audio icon: mutes BOTH buses at once; Settings keeps separate Sound/Music toggles
  music: true,        // generative per-table music (MusicSys) - separate from SFX
  musicVolume: 70,    // 0-100 - music bus level; 70 is the calibrated unity point
  haptics: true,
  firstTo: 7,         // 5 | 7 | 11
  pace: 'classic',     // 'casual' | 'classic' | 'lightning'
  effects: 'full',     // 'full' | 'subtle' | 'minimal' - spectacle scaler, never touches physics
  goalW: 'standard',   // 'narrow' | 'standard' | 'wide' - goal-mouth width (v20)
  orientation: 'landscape', // 'landscape' | 'portrait' - board presentation (v24.2)
  camera: 'top', // 'top' | 'elevated' | 'surface' - 2.5D camera (v25)
};
// prefers-reduced-motion: detected at boot; userShake remembers whether the
// player explicitly chose a shake level (their choice always wins).
const PRM = { reduce: false, userShake: false };
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('atelier-ah-settings') || '{}');
    PRM.userShake = Object.prototype.hasOwnProperty.call(s, 'shake');
    for (const k of Object.keys(Settings)) if (s[k] !== undefined) Settings[k] = s[k];
  } catch (e) {}
  if (![5, 7, 11].includes(Settings.firstTo)) Settings.firstTo = 7;
  if (!['off', 'subtle', 'full'].includes(Settings.shake)) Settings.shake = 'full';
  if (!['casual', 'classic', 'lightning'].includes(Settings.pace)) Settings.pace = 'classic';
  if (!['full', 'subtle', 'minimal'].includes(Settings.effects)) Settings.effects = 'full';
  if (!['narrow', 'standard', 'wide'].includes(Settings.goalW)) Settings.goalW = 'standard';
  if (!['landscape', 'portrait'].includes(Settings.orientation)) Settings.orientation = 'landscape';
  if (!['top', 'elevated', 'surface'].includes(Settings.camera)) Settings.camera = 'top';
  // music volume: persisted 0-100, 70 = unity. Clamp strays, fall back on garbage.
  if (!Number.isFinite(Settings.musicVolume)) Settings.musicVolume = 70;
  else Settings.musicVolume = clamp(Math.round(Settings.musicVolume), 0, 100);
}
// Effects scalers - one place to look up how much spectacle is allowed.
// Physics, pacing, and AI never consult these.
const fxParticles = () => Settings.effects === 'minimal' ? 0.35 : Settings.effects === 'subtle' ? 0.65 : 1;
const fxTrail = () => Settings.effects === 'minimal' ? 0.5 : Settings.effects === 'subtle' ? 0.75 : 1;
const fxRoom = () => Settings.effects === 'full' && !PRM.reduce;   // room reactivity
const fxFlash = () => Settings.effects !== 'minimal' && !PRM.reduce; // flashes & glows
function saveSettings() {
  try { localStorage.setItem('atelier-ah-settings', JSON.stringify(Settings)); } catch (e) {}
}

// ---------- local rival record ----------
// W/L per AI rival plus P1/P2 for same-screen 2P, stored in localStorage so it
// survives reloads. Deliberately local-only: online matches are live sessions,
// not a stored record, and netcode never touches this module.
const Record = {
  key: 'atelier-ah-record',
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  // key: 'ai0' | 'ai1' | 'ai2' | 'p1' | 'p2'. won: did this key's side win?
  bump(key, won) {
    let r = this.data[key];
    if (!r || typeof r.w !== 'number' || typeof r.l !== 'number') r = this.data[key] = { w: 0, l: 0 };
    if (won) r.w++; else r.l++;
    this.save();
  },
  // one rival's line, e.g. '3W–1L', or '' when no games are recorded yet
  line(key) {
    const r = this.data[key];
    return (r && (r.w || r.l)) ? r.w + 'W–' + r.l + 'L' : '';
  },
};
// combined line for the Two Players menu button: 'P1 3W–1L · P2 1W–3L'
function recordLine2p() {
  const a = Record.line('p1'), b = Record.line('p2');
  if (!a && !b) return '';
  return 'P1 ' + (a || '0W–0L') + ' · P2 ' + (b || '0W–0L');
}
// repaint every menu record line - call after results are stored and whenever
// the menu is shown (Record.line returns '' so unplayed rivals stay clean)
function refreshRecordLines() {
  document.querySelectorAll('[data-rec]').forEach(el => {
    el.textContent = el.dataset.rec === 'p2p' ? recordLine2p() : Record.line(el.dataset.rec);
  });
}

// ---------- personal bests ----------
// Per matchup ('ai0' | 'ai1' | 'ai2' | 'p2p'): fastest win, top puck speed,
// longest rally, biggest margin. Checked in showWin(); beaten records earn a
// ★ line on the win card. Same local-only rule as Record - online matches
// are session-only, netcode never touches this module.
const Best = {
  key: 'atelier-ah-best',
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
};
function fmtTime(secs) {
  return Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
}
// returns the display labels of any records just beaten (possibly empty)
function checkBest(key, secs, kmh, rally, margin) {
  let b = Best.data[key];
  if (!b || typeof b !== 'object') b = Best.data[key] = {};
  const out = [];
  const consider = (field, v, lower, label) => {
    if (typeof b[field] !== 'number') { b[field] = v; out.push(label); }
    else if (lower ? v < b[field] : v > b[field]) { b[field] = v; out.push(label); }
  };
  consider('win', secs, true, 'fastest win ' + fmtTime(secs));
  consider('speed', kmh, false, 'top speed ' + kmh + ' km/h');
  consider('rally', rally, false, 'longest rally ' + rally);
  consider('margin', margin, false, 'biggest margin ' + margin);
  if (out.length) Best.save();
  return out;
}

// ---------- achievements ----------
// One-time named feats, unlocked for the human winner of a local match and
// announced on the win card. Persisted per device; local-only like Record.
const FEATS = [
  { id: 'shutout',   name: 'SHUTOUT',   desc: 'a clean sheet' },
  { id: 'comeback',  name: 'COMEBACK',  desc: 'won from three down' },
  { id: 'hattrick',  name: 'HAT-TRICK', desc: 'three goals on the spin' },
  { id: 'speedster', name: 'SPEEDSTER', desc: 'puck past 60 km/h' },
  { id: 'grandtour', name: 'GRAND TOUR', desc: 'all ten tables conquered' },
];
const Feats = {
  key: 'atelier-ah-feats',
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  // returns true only on a fresh unlock
  unlock(id) {
    if (this.data[id]) return false;
    this.data[id] = 1; this.save();
    return true;
  },
};

// ---------- table tour ----------
// Wins per table (theme id) for the human side, local matches only. Feeds the
// menu's tour counter, the gold pip on conquered carousel slides, and the
// GRAND TOUR feat.
const Tour = {
  key: 'atelier-ah-tour',
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  bump(id) {
    if (THEME_ORDER.indexOf(id) < 0) return;
    this.data[id] = (this.data[id] || 0) + 1;
    this.save();
  },
  won(id) { return (this.data[id] || 0) > 0; },
  count() { return THEME_ORDER.filter(id => this.won(id)).length; },
};
// repaint the tour counter + conquered pips - call on boot and whenever the
// menu is shown (Tour data only changes at match end)
function refreshTour() {
  document.querySelectorAll('.tslide').forEach(el =>
    el.classList.toggle('won', Tour.won(el.dataset.theme)));
  const tc = $('tourCount');
  if (tc) tc.textContent = 'TOUR ' + Tour.count() + '/' + THEME_ORDER.length;
}
// puck pace: how lively the table plays
const PACES = {
  casual:    { damp: 0.22,  wall: 0.88, serve: 560, label: 'Casual' },
  classic:   { damp: 0.09,  wall: 0.95, serve: 780, label: 'Classic' },
  lightning: { damp: 0.045, wall: 0.99, serve: 980, label: 'Lightning' },
};
const paceDamp = () => PACES[Settings.pace].damp;
const paceWall = () => PACES[Settings.pace].wall;
const paceServe = () => PACES[Settings.pace].serve;

// ---------- physics tuning (from research) ----------
// Real tables: puck floats on air jets - near-zero friction. A good shove
// crosses an 8ft table several times. Damping here is exponential /s.
const PUCK_DAMP = 0.09;              // default damping; pace setting overrides at runtime
const WALL_REST = 0.95;              // default rail restitution; pace setting overrides at runtime
const PUCK_MAX = 3100;               // fastest pro smash, in units/s
const STRIKE_XFER = 1.45;            // mallet->puck velocity transfer
const SMACK_BONUS = 0.55;            // extra punch on fast flicks
const SUB_HZ = 240;                  // physics substeps (anti-tunnel)
const STALL_V = 130, STALL_T = 1.4;  // anti-dead-puck trigger
const GLUE_HARD_CUTOFF = 1.2;        // corner-pin release timing (see collideMallet); was 2.5

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rand = (a, b) => a + Math.random() * (b - a); // themes.js uses rand(a,b)
const hyp = Math.hypot;
// '#rrggbb' + alpha -> 'rgba(...)' - theme hexes need alpha for glow overlays
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'rgba(216,169,63,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
let interacted = false; // set on first real pointer input (gates vibrate)

// ---------- procedural audio ----------
const AudioSys = {
  ctx: null, sfxBus: null, musicBus: null, muted: false,
  init() {
    if (this.ctx) { this._ensureAmbience(); MusicSys.prime(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // Three gain stages: sfxBus (the Sound toggle), musicBus (the Music
      // toggle), and masterBus (the HUD icon) in front of both. Sound off
      // never silences music, Music off never silences SFX, and the HUD
      // icon's master mute silences everything at once without disturbing
      // either toggle's own setting underneath.
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.masterBus = this.ctx.createGain();
      this.sfxBus.connect(this.masterBus);
      this.musicBus.connect(this.masterBus);
      this.masterBus.connect(this.ctx.destination);
      this.syncMute(); // honor the persisted sound setting (boot w/ sound off)
      this.syncMusic(); // and the persisted music setting (boot w/ music off)
      this.syncMaster(); // and the persisted master mute (boot w/ all muted)
    } catch (e) { /* silent */ }
    this._ensureAmbience();
    MusicSys.prime(); // generative music also waits for the first user gesture
  },
  // starts the pending room's bed once a ctx exists (autoplay-safe: only
  // called from init(), which only runs on real user input)
  _ensureAmbience() { if (this.ctx && this.ambKey) this.ambience(this.ambKey); },
  // suspend()/resume() back the focus-loss pause: every voice routes through
  // this context, so suspending it silences music, SFX, and ambience at once.
  // Promises are caught - resume() without a user gesture stays suspended
  // (browser policy) instead of throwing an unhandled rejection.
  suspend() { try { if (this.ctx && this.ctx.state === 'running') { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} },
  resume() { try { if (this.ctx && this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} },
  toggle() { this.muted = !this.muted; if (this.sfxBus) this.sfxBus.gain.value = this.muted ? 0 : 0.5; return this.muted; },
  // layered clack: noise transient + tonal body, pitch mapped to impact, ±5% variance.
  // pitchMul climbs ~3% per rally hit so long rallies audibly tighten.
  hit(power, pitchMul = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, vr = (1 + rnd(-0.05, 0.05)) * pitchMul;
    const p = clamp(power, 0, 1);
    // transient
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g1 = this.ctx.createGain(); g1.gain.value = 0.5 * p + 0.08;
    src.connect(hp); hp.connect(g1); g1.connect(this.sfxBus);
    src.start(t);
    // body
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = (170 + p * 460) * vr;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.55 * p + 0.06, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o.connect(g2); g2.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
  },
  // mallet whoosh: fast flicks get an airy sweep before the clack lands
  whoosh(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = clamp(power, 0, 1);
    const len = Math.floor(this.ctx.sampleRate * 0.16);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.14);
    const g = this.ctx.createGain(); g.gain.value = 0.10 + p * 0.14;
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t);
  },
  // save thud: a soft low knock for goal-line blocks - felt, not announced
  thud() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.2);
  },
  // post ping: the goal frame rings when the puck kisses it
  ping() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [622, 933].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * (1 + rnd(-0.01, 0.01));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(i ? 0.10 : 0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.24);
    });
  },
  // goal-frame clank: a heavier metallic knock than the post ping - the
  // whole frame takes the hit, so it answers low and long instead of bright
  clank(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = clamp(power, 0.15, 1);
    // hollow low partials: inharmonic so it reads as bent metal, not a bell
    [208, 311, 517].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * (1 + rnd(-0.015, 0.015));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime((i ? 0.08 : 0.20) * p, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.30 + i * 0.05);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.5);
    });
    // the metal-on-metal knock: a short burst of filtered noise up front
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.22 * p, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
    src.start(t, rnd(1.2)); src.stop(t + 0.1);
  },
  rail(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = clamp(power, 0, 1);
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.value = 130 * (1 + rnd(-0.05, 0.05));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22 * p + 0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.1);
  },
  goalChord(notes) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.75);
    });
    // air swell
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0.25;
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t0);
  },
  blip(f, dur = 0.09, vol = 0.3) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  },
  ui() { this.blip(1150, 0.05, 0.18); },
  count(final) { this.blip(final ? 990 : 620, final ? 0.28 : 0.12, 0.32); },
  // ---------- room ambience (generated, no assets) ----------
  // Subtle per-room bed (looped shaped noise) plus sparse random events:
  // jazz-room bass plucks, poolside laps, a concrete-hall wash, felt hush,
  // loft murmur swells with the odd glass clink, machiya rain and wood
  // creaks. Levels sit well under SFX. The bed rides the music bus, so it
  // follows the Music toggle - Sound off leaves it playing. The bed only
  // ever exists after init(), which runs solely on real user input
  // (autoplay-safe). Switching rooms crossfades the bed instead of clicking.
  ambKey: null, amb: null, ambTimer: null,
  ambience(id) { // public: called from setTheme()
    if (!ROOM_AMB[id]) id = 'deco';
    this.ambKey = id;
    if (this.ctx && (!this.amb || this.amb.key !== id)) this._startAmbience();
  },
  syncMute() { if (this.sfxBus) this.sfxBus.gain.value = this.muted ? 0 : 0.5; }, // SFX/UI only - the music bus is untouched
  syncMusic() { if (this.musicBus) this.musicBus.gain.value = Settings.music ? 1 : 0; }, // hard gate: Music off silences the whole music bus, never SFX
  syncMaster() { if (this.masterBus) this.masterBus.gain.value = Settings.masterMuted ? 0 : 1; }, // HUD icon: both buses at once, toggles underneath untouched
  setMasterMuted(m) { Settings.masterMuted = !!m; try { saveSettings(); } catch (e) {} this.syncMaster(); return Settings.masterMuted; },
  _noiseBuf() { // cached 2s loopable noise, pink-ish so beds stay smooth
    if (this._nb) return this._nb;
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08;
    }
    this._nb = buf; return buf;
  },
  _startAmbience() {
    const cfg = ROOM_AMB[this.ambKey || 'deco'];
    const t = this.ctx.currentTime;
    this._killAmbience(); // fade out whatever was playing
    // bed: looped noise -> per-room filter -> gain -> master
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(); src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2; // no two rooms identical
    const flt = this.ctx.createBiquadFilter();
    flt.type = cfg.bed.type; flt.frequency.value = cfg.bed.f; flt.Q.value = cfg.bed.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(cfg.bed.g, t + 0.1, 0.9); // gentle 2s swell-in
    src.connect(flt); flt.connect(g); g.connect(this.musicBus);
    const nodes = { key: this.ambKey, src, flt, g, cfg, wet: [] };
    // brut hall: a short feedback delay as a cheap room wash on the bed
    if (cfg.bed.hall) {
      const dly = this.ctx.createDelay(1); dly.delayTime.value = 0.31;
      const fb = this.ctx.createGain(); fb.gain.value = 0.35;
      const wet = this.ctx.createGain(); wet.gain.value = 0.5;
      g.connect(dly); dly.connect(fb); fb.connect(dly);
      dly.connect(wet); wet.connect(this.musicBus);
      nodes.wet = [dly, fb, wet];
    }
    // poolside air breathes: slow LFO on the bed gain
    if (cfg.bed.lfo) {
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = cfg.bed.lfo;
      const lg = this.ctx.createGain(); lg.gain.value = cfg.bed.g * 0.35;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
      nodes.lfo = lfo;
    }
    src.start(t);
    this.amb = nodes;
    if (!this.ambTimer) this.ambTimer = setInterval(() => this._ambTick(), 1100);
  },
  _killAmbience() {
    if (!this.amb) return;
    const a = this.amb; this.amb = null;
    const t = this.ctx.currentTime;
    a.g.gain.cancelScheduledValues(t);
    a.g.gain.setTargetAtTime(0.0001, t, 0.35); // fade fast, disconnect late
    setTimeout(() => {
      try { a.src.stop(); } catch (e) {}
      [a.src, a.flt, a.g, a.lfo].concat(a.wet).forEach(n => { if (n) try { n.disconnect(); } catch (e) {} });
    }, 1500);
  },
  _ambTick() { // every ~1.1s: roll the room's sparse events
    if (!this.amb || !this.ctx || this.muted || this.ctx.state !== 'running') return;
    const a = this.amb, cfg = a.cfg, t = this.ctx.currentTime;
    // the loft murmurs: slow random swells on the bed
    if (cfg.bed.swell) a.g.gain.setTargetAtTime(cfg.bed.g * rnd(0.7, 1.3), t, 1.2);
    for (const ev of cfg.events) if (Math.random() < ev.p) this[ev.f]();
  },
  // --- sparse one-shot events (all check muted via _ambTick) ---
  _bass() { // distant upright pluck in the jazz room
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = [55, 65.41, 73.42, 82.41, 98][Math.floor(rnd(5))];
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.6);
  },
  _mote() { // faint piano-ish mote, A-minor colour
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = [110, 130.81, 146.83, 164.81, 220][Math.floor(rnd(5))];
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.028, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 1.05);
  },
  _splash() { // soft poolside lap
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf();
    src.playbackRate.value = 1.4;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    src.start(t, rnd(1.5)); src.stop(t + 0.35);
  },
  _clink() { // distant glass in the loft
    const t = this.ctx.currentTime;
    [2490, 3160].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = f * (1 + rnd(-0.01, 0.01));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(i ? 0.014 : 0.02, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.45);
    });
  },
  _creak() { // old wood settling in the machiya
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(105, t + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.032, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.85);
  },
};
// Per-room ambience character, keyed by theme id.
const ROOM_AMB = {
  deco:  { bed: { type: 'lowpass',  f: 400,  q: 0.6, g: 0.022 },
           events: [ { p: 0.26, f: '_bass' }, { p: 0.16, f: '_mote' } ] },
  mid:   { bed: { type: 'bandpass', f: 850,  q: 0.7, g: 0.026, lfo: 0.12 },
           events: [ { p: 0.10, f: '_splash' } ] },
  brut:  { bed: { type: 'lowpass',  f: 170,  q: 0.5, g: 0.020, hall: true },
           events: [] },
  bil:   { bed: { type: 'lowpass',  f: 240,  q: 0.5, g: 0.012 },
           events: [] },
  mem:   { bed: { type: 'bandpass', f: 520,  q: 1.0, g: 0.028, swell: true },
           events: [ { p: 0.07, f: '_clink' } ] },
  sashi: { bed: { type: 'highpass', f: 2600, q: 0.5, g: 0.024 },
           events: [ { p: 0.05, f: '_creak' } ] },
  bau:   { bed: { type: 'bandpass', f: 640,  q: 0.8, g: 0.024 },
           events: [ { p: 0.06, f: '_clink' } ] },   // the workshop: airy room tone, distant tool clinks
  zel:   { bed: { type: 'bandpass', f: 1200, q: 0.6, g: 0.020 },
           events: [ { p: 0.09, f: '_splash' } ] }, // the courtyard fountain
  swi:   { bed: { type: 'highpass', f: 3000, q: 0.5, g: 0.014 },
           events: [ { p: 0.04, f: '_mote' } ] },    // the gallery hush
  neon:  { bed: { type: 'bandpass', f: 300,  q: 0.9, g: 0.018, hall: true },
           events: [ { p: 0.05, f: '_mote' } ] },    // the arcade after hours: electric hum, faint neon buzz
};

// ---------- generative music ----------
// MusicSys: a seeded generative ambient engine - one musical identity per
// table, 100% synthesized (no assets, so the PWA offline story stays
// intact). Layers follow the shipped-game hybrid pattern:
//   * vertical: a pad bed always; at match point a pulse layer joins plus
//     denser melody and a slightly lifted bed; goals get a soft swell while
//     the bed ducks under the goal ceremony.
//   * horizontal: table changes crossfade to the new room's music.
//   * stingers: none - the goal ceremony owns that moment; music stays back.
// Scheduling: a 150ms interval schedules against audioContext.currentTime
// with 0.4s lookahead; musical time is an accumulated ideal clock, never
// the timer's own firing time, so tab jank can't drift the beat. The RNG is
// seeded per table (mulberry32), so each room's music is a stable identity
// across sessions, not a shuffle. Music rides AudioSys.musicBus - the Sound
// toggle (sfxBus) never touches it, and Music off never touches SFX.
// Euclidean onset pattern: k hits spread as evenly as possible over n steps,
// rotated by rot. Bjorklund's algorithm, the same math behind the tresillo
// E(3,8) = [x..x..x.] and the cinquillo E(5,8). Used for bass lines and percussion.
function euclid(k, n, rot) {
  const seq = [];
  if (k <= 0 || n <= 0) return new Array(Math.max(0, n)).fill(false);
  if (k >= n) return new Array(n).fill(true);
  const counts = [], remainders = [];
  let divisor = n - k, level = 0;
  remainders.push(k);
  for (;;) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level++;
    if (remainders[level] <= 1) break;
  }
  counts.push(divisor);
  (function build(l) {
    if (l === -1) seq.push(false);
    else if (l === -2) seq.push(true);
    else {
      for (let i = 0; i < counts[l]; i++) build(l - 1);
      if (remainders[l] !== 0) build(l - 2);
    }
  })(level);
  // start on a hit, then apply the rotation
  const first = seq.indexOf(true);
  const lined = first > 0 ? seq.slice(first).concat(seq.slice(0, first)) : seq;
  const r = ((rot || 0) % n + n) % n;
  return r ? lined.map((_, i) => lined[(i - r + n) % n]) : lined;
}
// Generative music, composed: every table gets its own harmonic progression,
// its own motivic material, and its own rhythmic grammar. The engine walks
// each progression in composed order (not random), develops a short motif
// through repetition, sequence, inversion and fragmentation, and arranges
// itself across 2-phrase sections (enter, settle, full, break) so the room
// breathes. Percussion uses Euclidean onset patterns with velocity accents,
// restrained swing and ghost notes; rooms that should be still get none.
// Fields per room:
//   seed/root/mode/bpm: identity. padCut: lowpass on the pad. melWave: motif voice.
//   prog: the progression, one chord per 4-bar phrase. Each chord is {r, t}:
//     r = root offset in semitones from the table root, t = chord tones voiced
//     compactly above that root (common tones shared with neighbors wherever
//     the harmony allows, so the pad glides instead of jumping).
//   bridge: alternate chords for every 4th cycle (a turnaround keeps long
//     matches from looping identically forever).
//   bass: Euclidean pattern over a 16-step bar; k hits, n steps, rot offset;
//     alt = interval (semitones) the pattern alternates to on odd hits.
//   motif: q = the question phrase, a = the answer phrase, as [mode-degree, beats].
//     Degrees wrap octaves diatonically, so sequences and inversions stay in key.
//   drums: null where the room should be still; otherwise per-layer Euclidean
//     patterns {k, n, rot, vol}. swing = off-8th delay as a fraction of a
//     16th; ghost = probability of a barely-there extra 16th.
//   form: per-section voice densities [enter, settle, full, break]; match point
//     forces the full section.
const MUSIC = {
  deco:  { seed: 1929, root: 45, mode: [0, 2, 3, 5, 7, 9, 10], bpm: 56, padCut: 800,  melWave: 'triangle', swing: 0.12, level: 1.100,
           prog: [ {r:0,t:[0,3,7,10,14]}, {r:8,t:[8,12,15,19,22]}, {r:5,t:[5,8,12,17,19]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,8,12,17,19]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:2, n:16, rot:0, vol: 0.225, wave: 'sine', cut: 500, alt: 7 },
           motif: { q: [[4,1],[5,1],[6,2]], a: [[5,1],[4,1],[3,1],[2,2]] },
           drums: null,
           form: [ {bass:0,mel:.5,drums:0}, {bass:.6,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.3,mel:.4,drums:0} ],
           pulse: false, drone: false, shimmer: false },   // noir lounge: A melodic-minor ballad, Am9 Fmaj9 Dm9 E7, motif in thirds
  mid:   { seed: 1977, root: 43, mode: [0, 2, 3, 5, 7, 8, 10], bpm: 96, padCut: 1400, melWave: 'sawtooth', swing: 0.04, level: 1.000,
           prog: [ {r:0,t:[0,3,7,14]}, {r:8,t:[8,12,15,19]}, {r:3,t:[3,7,10,14]}, {r:10,t:[10,14,17,21]} ],
           bridge: [ {r:8,t:[8,12,15,19]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:4, n:16, rot:0, vol: 0.250, wave: 'sawtooth', cut: 700, alt: 12 },
           motif: { q: [[4,1],[5,1],[4,1],[2,1]], a: [[5,2],[4,1],[3,1]] },
           drums: { kick: {k:4,n:16,rot:0,vol:.32}, snare: {k:2,n:16,rot:4,vol:.28}, hat: {k:8,n:16,rot:0,vol:.10}, ghost: 0 },
           form: [ {bass:.5,mel:.5,drums:.5}, {bass:.8,mel:.7,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.4,mel:.5,drums:0} ],
           pulse: true, drone: false, shimmer: true },     // synthwave: four-on-the-floor, driving octave bass, neon motif
  brut:  { seed: 1963, root: 41, mode: [0, 1, 3, 5, 7, 8, 10], bpm: 66, padCut: 500,  melWave: 'sine',     swing: 0,    level: 1.100,
           prog: [ {r:0,t:[0,3,7,12]}, {r:8,t:[8,12,15]}, {r:0,t:[0,3,7]}, {r:7,t:[7,11,14]} ],
           bridge: [ {r:8,t:[8,12,15]}, {r:7,t:[7,11,14]} ],
           bass: { k:1, n:16, rot:0, vol: 0.300, wave: 'sine', cut: 300, alt: 0 },
           motif: { q: [[0,2],[1,2]], a: [[0,4]] },
           drums: null,
           form: [ {bass:.5,mel:.5,drums:0}, {bass:1,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.5,mel:.5,drums:0} ],
           pulse: false, drone: true, shimmer: false },     // brutalist drone: phrygian concrete, one massive bass hit per bar
  bil:   { seed: 1955, root: 48, mode: [0, 2, 3, 5, 7, 9, 10], bpm: 72, padCut: 1100, melWave: 'triangle', swing: 0.30, level: 1.100,
           prog: [ {r:0,t:[0,3,7,10,14]}, {r:5,t:[5,9,12,15,19]}, {r:0,t:[0,3,7,10]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,9,12,15,19]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:3, n:16, rot:2, vol: 0.220, wave: 'sine', cut: 600, alt: 7 },
           motif: { q: [[4,1],[3,1],[2,2]], a: [[2,1],[1,1],[0,2]] },
           drums: null,
           form: [ {bass:.5,mel:.6,drums:0}, {bass:.8,mel:.8,drums:0}, {bass:1,mel:1,drums:0}, {bass:.4,mel:.5,drums:0} ],
           pulse: false, drone: false, shimmer: false },    // billiard room: C dorian jazz, Cm9 F9 G7, heavy swing, blue-note descent
  mem:   { seed: 1968, root: 45, mode: [0, 2, 4, 5, 7, 9, 10], bpm: 112, padCut: 1600, melWave: 'square', swing: 0.08, level: 1.000,
           prog: [ {r:0,t:[0,4,7,10]}, {r:5,t:[5,9,12,15]}, {r:0,t:[0,4,7,10]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,9,12,15]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:4, n:16, rot:0, vol: 0.260, wave: 'triangle', cut: 800, alt: 12 },
           motif: { q: [[0,1],[2,1],[4,1],[5,1]], a: [[4,1],[2,1],[0,2]] },
           drums: { kick: {k:2,n:16,rot:0,vol:.32}, snare: {k:2,n:16,rot:4,vol:.28}, hat: {k:8,n:16,rot:2,vol:.11}, ghost: .6 },
           form: [ {bass:.6,mel:.6,drums:.6}, {bass:.8,mel:.8,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.5,mel:.6,drums:.4} ],
           pulse: true, drone: false, shimmer: false },     // memphis juke joint: mixolydian I7 IV7 V7, offbeat hats, walking fire
  sashi: { seed: 1988, root: 50, mode: [0, 2, 5, 7, 8],       bpm: 60, padCut: 2400, melWave: 'sine',     swing: 0,    level: 0.900,
           prog: [ {r:0,t:[0,5,7,12]}, {r:5,t:[5,8,12]}, {r:0,t:[0,5,7]}, {r:7,t:[7,12,14]} ],
           bridge: [ {r:5,t:[5,8,12]}, {r:7,t:[7,12,14]} ],
           bass: { k:1, n:16, rot:8, vol: 0.200, wave: 'sine', cut: 500, alt: 0 },
           motif: { q: [[3,2],[2,2]], a: [[2,3],[1,1]] },
           drums: null,
           form: [ {bass:.5,mel:.5,drums:0}, {bass:.7,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.3,mel:.4,drums:0} ],
           pulse: false, drone: false, shimmer: true },      // kaiseki: hirajoshi stillness, two-note motifs, space as an instrument
  bau:   { seed: 1972, root: 40, mode: [0, 2, 3, 5, 7, 8, 10], bpm: 120, padCut: 2000, melWave: 'sawtooth', swing: 0,   level: 1.000,
           prog: [ {r:0,t:[0,3,7,12]}, {r:8,t:[8,12,15]}, {r:3,t:[3,7,10]}, {r:10,t:[10,14,17]} ],
           bridge: [ {r:8,t:[8,12,15]}, {r:11,t:[11,15,18]} ],
           bass: { k:8, n:16, rot:0, vol: 0.240, wave: 'sawtooth', cut: 900, alt: 12 },
           motif: { q: [[4,1],[4,1],[5,1],[4,1]], a: [[3,1],[2,1],[1,1],[0,1]] },
           drums: { kick: {k:4,n:16,rot:0,vol:.30}, snare: {k:2,n:16,rot:4,vol:.26}, hat: {k:16,n:16,rot:0,vol:.09}, ghost: .3 },
           form: [ {bass:.7,mel:.5,drums:.6}, {bass:1,mel:.7,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.6,mel:.5,drums:.5} ],
           pulse: true, drone: false, shimmer: false },     // bauhaus motorik: 16th hats, root-octave bass engine, relentless
  zel:   { seed: 1994, root: 40, mode: [0, 1, 4, 5, 7, 8, 10], bpm: 104, padCut: 1200, melWave: 'sawtooth', swing: 0.06, level: 1.000,
           prog: [ {r:0,t:[0,4,7,12]}, {r:1,t:[1,5,8]}, {r:0,t:[0,4,7]}, {r:10,t:[10,14,17]} ],
           bridge: [ {r:1,t:[1,5,8]}, {r:0,t:[0,4,7]} ],
           bass: { k:6, n:16, rot:0, vol: 0.270, wave: 'sawtooth', cut: 800, alt: 0 },
           motif: { q: [[0,1],[1,1],[0,1],[3,1]], a: [[3,1],[2,1],[1,1],[0,1]] },
           drums: { kick: {k:3,n:16,rot:0,vol:.32}, snare: {k:1,n:16,rot:8,vol:.26}, hat: {k:6,n:16,rot:0,vol:.10}, ghost: .5 },
           form: [ {bass:.6,mel:.6,drums:.6}, {bass:.8,mel:.8,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.5,mel:.5,drums:.4} ],
           pulse: false, drone: false, shimmer: false },    // zellige: phrygian-dominant gnawa trance, tresillo kick, pedal bass
  swi:   { seed: 1957, root: 41, mode: [0, 2, 4, 5, 7, 9, 11], bpm: 76, padCut: 2200, melWave: 'sine',     swing: 0.10, level: 0.900,
           prog: [ {r:0,t:[0,4,7,12]}, {r:5,t:[5,9,12]}, {r:0,t:[0,4,7]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,9,12]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:2, n:16, rot:4, vol: 0.200, wave: 'sine', cut: 500, alt: 7 },
           motif: { q: [[4,1],[5,1],[7,2]], a: [[5,1],[4,1],[2,2]] },
           drums: null,
           form: [ {bass:.5,mel:.5,drums:0}, {bass:.7,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.4,mel:.5,drums:0} ],
           pulse: false, drone: false, shimmer: true },     // alpine music box: F major I IV V, gentle ascent, snow-light
  neon:  { seed: 1983, root: 33, mode: [0, 2, 3, 5, 7, 8, 10], bpm: 118, padCut: 900,  melWave: 'sawtooth', swing: 0.05, level: 1.000,
           prog: [ {r:0,t:[0,3,7,12]}, {r:3,t:[3,7,10,14]}, {r:5,t:[5,8,12,16]}, {r:7,t:[7,10,14,17]} ],
           bridge: [ {r:3,t:[3,7,10,14]}, {r:7,t:[7,10,14,17]} ],
           bass: { k:8, n:16, rot:0, vol: 0.260, wave: 'sawtooth', cut: 1000, alt: 12 },
           motif: { q: [[4,1],[2,1],[0,1],[2,1]], a: [[3,1],[2,1],[0,2]] },
           drums: { kick: {k:4,n:16,rot:0,vol:.32}, snare: {k:2,n:16,rot:4,vol:.28}, hat: {k:16,n:16,rot:0,vol:.09}, ghost: .4 },
           form: [ {bass:.6,mel:.5,drums:.6}, {bass:.8,mel:.7,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.5,mel:.5,drums:.5} ],
           pulse: true, drone: false, shimmer: false },      // neon midnight: i III iv v synthwave, 16th hats, night-drive
};

const MusicSys = {
  key: 'deco', pendingKey: 'deco', intensity: 0,
  timer: 0, nodes: null, nextT: 0, beat: 0,
  rng: null, progIdx: 0, curChord: null, xfade: 0, sessionSeed: 0,
  bassHit: 0, bassPat: null, kickPat: null, snarePat: null, hatPat: null, prevPad: null,
  voices: [], // live voice gains - killed on room switch so the old room's long pad tail can't bleed into the new room
  mf(m) { return 440 * Math.pow(2, (m - 69) / 12); }, // midi -> hz
  cfg() { return MUSIC[this.key] || MUSIC.deco; },
  ac() { return AudioSys.ctx; },
  // --- user volume (Settings.musicVolume 0-100, default 70) ---
  // Perceptual-ish curve with unity at the 70 default: 100 gives a +4.6 dB
  // lift, 0 is fully silent. Applied as a multiplier on the per-room bus
  // target, so it composes with table levels, the goal duck, and intensity.
  volGain() {
    const v = clamp(Settings.musicVolume, 0, 100) / 70;
    return v <= 0 ? 0 : Math.min(2, Math.pow(v, 1.5));
  },
  targetLevel() { return this.cfg().level * this.volGain() * (this.intensity ? 1.3 : 1); },
  applyVolume() { // slider path: re-aim the live bus, no restart needed
    const n = this.nodes, ac = this.ac();
    if (!n || !ac) return;
    n.musicG.gain.setTargetAtTime(Math.max(0.0001, this.targetLevel()), ac.currentTime, 0.15);
  },
  // --- lifecycle ---
  prime() { // first-user-gesture path, via AudioSys.init()
    if (!Settings.music || !this.ac()) return;
    this.key = this.pendingKey = (MUSIC[G.themeId] ? G.themeId : 'deco');
    this.start();
  },
  syncEnabled() { // the settings toggle calls here
    if (Settings.music) { if (this.ac() && !this.timer) this.start(); }
    else this.stop();
  },
  setTable(id) { // from setTheme: always records; crossfades when audible
    if (!MUSIC[id]) id = 'deco';
    this.pendingKey = id;
    if (!this.timer || id === this.key || !this.nodes) return;
    const token = ++this.xfade, self = this;
    const t = this.ac().currentTime, g = this.nodes.musicG.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.0001, t, 0.25);
    // silence the old room's voices at once (the bus dip masks the cut) so
    // a 16-beat pad tail can't wash over the new room's entrance
    this.killVoices();
    setTimeout(() => {
      if (token !== self.xfade || !self.timer || !self.nodes) return;
      self.key = id; self.reseed();
      self.nodes.musicG.gain.setTargetAtTime(self.targetLevel(), self.ac().currentTime, 0.8);
    }, 750);
  },
  killVoices() { // disconnect every live generative voice; the bus dip hides the seam
    for (const v of this.voices) { try { v.disconnect(); } catch (e) {} }
    this.voices = [];
  },
  reseed() {
    const c = this.cfg();
    // The session seed lets two online peers derive the same generative
    // sequence (see the Net hello handshake); offline it is 0 and each room
    // uses its composed seed. Either way the music is deterministic.
    this.rng = mulberry32((c.seed ^ (this.sessionSeed | 0)) >>> 0);
    this.progIdx = 0; this.curChord = c.prog[0];
    this.beat = 0; this.bassHit = 0; this.prevPad = null;
    this.bassPat = c.bass ? euclid(c.bass.k, 16, c.bass.rot || 0) : null;
    if (c.drums) {
      this.kickPat = euclid(c.drums.kick.k, 16, c.drums.kick.rot || 0);
      this.snarePat = euclid(c.drums.snare.k, 16, c.drums.snare.rot || 0);
      this.hatPat = euclid(c.drums.hat.k, 16, c.drums.hat.rot || 0);
    } else this.kickPat = this.snarePat = this.hatPat = null;
  },
  // Online sync: the host deals one session seed in the hello handshake so
  // both peers seed the same generative sequence. Sample-phase alignment
  // is NOT guaranteed (separate AudioContexts, separate clocks); the shared
  // seed only guarantees the same notes in the same order.
  setSessionSeed(s) {
    this.sessionSeed = s | 0;
    if (this.timer) this.reseed(); // already playing: restart the sequence on the new seed
  },
  // Countdown start: restart the phrase on the shared downbeat. Host and
  // guest each anchor to their own countdown, so network jitter keeps them
  // from being sample-aligned - but both start the same phrase of the same
  // sequence at the same musical moment.
  alignBeat() {
    if (!this.timer || !this.ac()) return;
    this.beat = 0;
    this.nextT = this.ac().currentTime + 0.15;
  },
  start() {
    const ac = this.ac();
    if (!ac || this.timer || !Settings.music) return;
    try { ac.resume(); } catch (e) {}
    this.key = this.pendingKey;
    this.buildBus();
    this.reseed();
    const t = ac.currentTime;
    this.nextT = t + 0.2;
    this.nodes.musicG.gain.setValueAtTime(0.0001, t);
    this.nodes.musicG.gain.setTargetAtTime(this.targetLevel(), t + 0.1, 1.4);
    this.timer = setInterval(() => this.tick(), 150);
  },
  stop() { // full stop: timer cleared, bus fades out, nodes disconnected late
    this.xfade++; // invalidate any in-flight crossfade
    this.killVoices();
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    const n = this.nodes, ac = this.ac();
    this.nodes = null;
    if (n && ac) {
      const t = ac.currentTime;
      try {
        n.musicG.gain.cancelScheduledValues(t);
        n.musicG.gain.setTargetAtTime(0.0001, t, 0.18);
      } catch (e) {}
      setTimeout(() => {
        [n.musicG, n.duckG, n.dly, n.fb, n.wet].forEach(x => { try { x.disconnect(); } catch (e) {} });
      }, 1400);
    }
  },
  buildBus() {
    const ac = this.ac();
    const musicG = ac.createGain(); musicG.gain.value = 0.0001; // per-room level
    const duckG = ac.createGain(); duckG.gain.value = 1;         // goal-ceremony dip
    musicG.connect(duckG); duckG.connect(AudioSys.musicBus);      // music rides its own bus - the Sound toggle never touches it
    // one shared feedback delay as cheap space for plucks and shimmer
    const dly = ac.createDelay(1); dly.delayTime.value = 0.34;
    const fb = ac.createGain(); fb.gain.value = 0.32;
    const wet = ac.createGain(); wet.gain.value = 0.4;
    dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(musicG);
    this.nodes = { musicG, duckG, dly, fb, wet };
  },
  // --- scheduler ---
  tick() {
    if (!this.timer) return;
    const ac = this.ac();
    if (!ac || !this.nodes) return;
    if (ac.state !== 'running') { this.nextT = ac.currentTime + 0.2; return; } // re-anchor, never burst
    const spb = 60 / this.cfg().bpm, ahead = ac.currentTime + 0.4;
    let guard = 0;
    while (this.nextT < ahead && guard++ < 32) {
      this.scheduleBeat(this.nextT, this.beat, spb);
      this.nextT += spb; this.beat++;
    }
  },
  // One beat of composed music. Harmony turns over every 16-beat phrase;
  // bass and drums live on a 16-step grid inside each bar; the motif is laid
  // down whole-phrase at the phrase start so it always lands intact.
  scheduleBeat(t, n, spb) {
    const c = this.cfg(), pn = n % 16;
    const phraseN = (n - pn) / 16;
    const form = c.form[Math.floor(phraseN / 2) % 4]; // 2-phrase sections: enter, settle, full, break
    const dens = this.intensity ? { bass: 1, mel: 1, drums: 1 } : form; // match point: the room goes full
    if (pn === 0) this.startPhrase(t, spb, phraseN);
    if (c.bass) this.bass16(t, n, spb, dens.bass);
    if (c.drums && dens.drums > 0) this.drums16(t, n, spb, dens);
    if (this.intensity && c.pulse && pn % 2 === 0) this.pulseTok(t); // match-point motorik
    if (c.shimmer && this.rng() < 0.10 * dens.mel) this.shimmerTone(t);
  },
  // Phrase start: advance the composed progression (the bridge chords every
  // 4th cycle), bloom the pad, lay the drone, and develop the motif.
  startPhrase(t, spb, phraseN) {
    const c = this.cfg();
    const cyc = Math.floor(this.progIdx / c.prog.length);
    const chord = (c.bridge && cyc % 4 === 3)
      ? c.bridge[this.progIdx % c.bridge.length]
      : c.prog[this.progIdx % c.prog.length];
    this.progIdx++;
    this.curChord = chord;
    this.padChord(chord.t.map(s => this.mf(c.root + s)), t, spb * 16);
    if (c.drone) this.tone({ f: this.mf(c.root - 12), t, a: 2.5, d: spb * 16, vol: 0.105, wave: 'sine', cut: 200 });
    this.scheduleMotif(t, spb, phraseN);
  },
  // Motivic development across the 8-phrase form cycle. The motif is stated
  // twice before anything develops it (no development without identity),
  // then moves through diatonic sequence, fragmentation with the answer
  // phrase, inversion, and a closing echo. Degrees wrap octaves diatonically,
  // so development can never play a wrong note.
  scheduleMotif(t, spb, phraseN) {
    const c = this.cfg(), m = c.motif;
    if (!m) return;
    const pc = phraseN % 8;
    const seq = (notes, steps) => notes.map(nb => [nb[0] + steps, nb[1]]);
    const inv = (notes) => { const p = notes[0][0]; return notes.map(nb => [2 * p - nb[0], nb[1]]); };
    const frag = (notes) => notes.slice(0, Math.max(1, Math.ceil(notes.length / 2)));
    let line;
    if (pc === 0 || pc === 1) line = m.q;
    else if (pc === 2) line = seq(m.q, 1);
    else if (pc === 3) line = frag(m.q).concat(m.a);
    else if (pc === 4) line = m.q;
    else if (pc === 5) line = inv(m.q);
    else if (pc === 6) line = seq(m.q, -1);
    else line = m.a.concat(frag(m.q));
    const form = c.form[Math.floor(phraseN / 2) % 4];
    const gate = (pc === 0 || pc === 1) ? 1 : (this.intensity ? 1 : form.mel);
    let bt = 0;
    const sq = c.melWave === 'square';
    for (const nb of line) {
      if (bt >= 16) break;
      if (this.rng() < gate)
        this.tone({ f: this.mf(c.root + 12 + this.degToSemi(c.mode, nb[0])), t: t + bt * spb,
                    a: 0.008, d: Math.min(nb[1] * spb * 0.92, 2.4), vol: sq ? 0.060 : 0.102,
                    wave: c.melWave, cut: sq ? 1800 : 2600, send: 0.5 });
      bt += nb[1];
    }
  },
  degToSemi(mode, deg) {
    const L = mode.length, o = Math.floor(deg / L);
    return mode[((deg % L) + L) % L] + 12 * o;
  },
  // Bass on the 16-step grid: the room's Euclidean pattern, roots from the
  // current chord, alternate hits stepping up to `alt` for line movement.
  bass16(t, n, spb, density) {
    const c = this.cfg(), b = c.bass, s16 = spb / 4;
    const step0 = (n % 4) * 4;
    for (let s = 0; s < 4; s++) {
      if (!this.bassPat[(step0 + s) % 16]) continue;
      if (this.rng() > density) continue;
      const alt = b.alt && ((this.bassHit++ % 2) === 1);
      const f = this.mf(c.root - 12 + this.curChord.r + (alt ? b.alt : 0));
      this.tone({ f, t: t + s * s16, a: 0.02, d: 1.6, vol: b.vol, wave: b.wave || 'sine', cut: b.cut || 500 });
    }
  },
  // Drums on the 16-step grid: Euclidean layers, velocity accents by grid
  // position (downbeat strongest), a couple ms of human lateness, restrained
  // swing on the off-8ths, and barely-there ghost 16ths.
  drums16(t, n, spb, dens) {
    const c = this.cfg(), d = c.drums, s16 = spb / 4;
    const step0 = (n % 4) * 4;
    const layers = [
      [this.kickPat, d.kick, (tt, v) => this.kickHit(tt, v)],
      [this.snarePat, d.snare, (tt, v) => this.snareHit(tt, v)],
      [this.hatPat, d.hat, (tt, v, st) => this.hatHit(tt, v, st)],
    ];
    for (const layer of layers) {
      const pat = layer[0], cfg = layer[1], play = layer[2];
      for (let s = 0; s < 4; s++) {
        const step = (step0 + s) % 16;
        if (!pat[step]) continue;
        if (step !== 0 && this.rng() > dens.drums) continue; // the downbeat anchor never drops
        const accent = step % 4 === 0 ? 1 : (step % 2 === 0 ? 0.8 : 0.55);
        const v = Math.max(0.012, cfg.vol * accent * (0.85 + this.rng() * 0.3));
        let tt = t + s * s16;
        if (c.swing && step % 4 === 2) tt += c.swing * spb / 6; // the swung off-8th sits late
        tt += 0.0015 + this.rng() * 0.003; // human: a couple ms late, never early
        play(tt, v, step);
      }
    }
    if (d.ghost && this.rng() < d.ghost * dens.drums)
      this.hatHit(t + (1 + 2 * Math.floor(this.rng() * 2)) * s16, 0.16 * d.hat.vol, -1);
  },
  kickHit(t, v) { // synthesized kick: 120 Hz dropping to 45, short and round
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const osc = ac.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.10);
    const g = ac.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g); g.connect(n.musicG);
    osc.start(t); osc.stop(t + 0.2);
    this.voices.push(g);
  },
  snareHit(t, v) { // noise burst through a bandpass plus body
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const src = ac.createBufferSource(); src.buffer = AudioSys._noiseBuf();
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(bp); bp.connect(g); g.connect(n.musicG);
    src.start(t); src.stop(t + 0.16);
    this.voices.push(g);
  },
  hatHit(t, v, step) { // highpassed noise tick; ghosts get the shortest tail
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const src = ac.createBufferSource(); src.buffer = AudioSys._noiseBuf();
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ac.createGain();
    const dur = step === -1 ? 0.03 : 0.045;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(g); g.connect(n.musicG);
    src.start(t); src.stop(t + dur + 0.02);
    this.voices.push(g);
  },
  shimmerTone(t) {
    const c = this.cfg();
    this.tone({ f: this.mf(c.root + 24 + [0, 7, 12][Math.floor(this.rng() * 3)]),
                t, a: 0.6, d: 3.6, vol: 0.048, wave: 'sine', cut: 4000, send: 0.7 });
  },
  // --- voices (all cheap: an osc or two, a filter, an envelope) ---
  tone(o) { // { f, t, a, d, vol, wave, cut, send }
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const osc = ac.createOscillator(); osc.type = o.wave || 'triangle'; osc.frequency.value = o.f;
    const flt = ac.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = o.cut || 2400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), o.t + (o.a || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + (o.a || 0.01) + o.d);
    osc.connect(flt); flt.connect(g); g.connect(n.musicG);
    let send = null;
    if (o.send) { send = ac.createGain(); send.gain.value = o.send; g.connect(send); send.connect(n.dly); }
    osc.start(o.t); osc.stop(o.t + (o.a || 0.01) + o.d + 0.1);
    this.voices.push(g); // room switches kill live voices (see killVoices)
    osc.onended = () => { try { osc.disconnect(); flt.disconnect(); g.disconnect(); if (send) send.disconnect(); } catch (e) {} };
  },
  padChord(freqs, t, dur) {
    const ac = this.ac(), n = this.nodes, c = this.cfg();
    if (!n) return;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = c.padCut * (this.intensity ? 1.2 : 1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(0.090, t + 0.05, Math.min(2.5, dur / 6)); // slow bloom
    g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 1.0);              // melt out before the next chord
    lp.connect(g); g.connect(n.musicG);
    this.voices.push(g); // the long pad tail is the main room-switch bleeder
    freqs.forEach((f, i) => {
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.value = f; o.detune.value = i % 2 ? 6 : -6;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.4);
      o.onended = () => { try { o.disconnect(); } catch (e) {} };
    });
    setTimeout(() => { try { lp.disconnect(); g.disconnect(); } catch (e) {} },
      Math.max(0, (t + dur + 0.6 - ac.currentTime) * 1000) + 400);
  },
  pulseTok(t) { // soft motorik tick for the match-point lift
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(105, t + 0.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.090, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(n.musicG);
    o.start(t); o.stop(t + 0.1);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  },
  // --- adaptive events ---
  goalSwell() { // soft lift under the goal ceremony - never a jingle
    if (!this.timer || !this.ac() || !this.nodes) return;
    const ac = this.ac(), n = this.nodes, t = ac.currentTime, c = this.cfg();
    n.duckG.gain.cancelScheduledValues(t);
    n.duckG.gain.setTargetAtTime(0.5, t, 0.09);    // bed dips under the ceremony
    n.duckG.gain.setTargetAtTime(1.0, t + 1.1, 0.7);
    const src = ac.createBufferSource(); src.buffer = AudioSys._noiseBuf(); src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.135, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(bp); bp.connect(g); g.connect(n.musicG);
    src.start(t); src.stop(t + 1.6);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} };
    this.padChord((this.curChord ? this.curChord.t : c.prog[0].t).map(s => this.mf(c.root + s)), t + 0.05, 2.4);
  },
  setIntensity(i) {
    i = i ? 1 : 0;
    if (i === this.intensity) return;
    this.intensity = i;
    const n = this.nodes, ac = this.ac();
    if (n && ac) n.musicG.gain.setTargetAtTime(this.targetLevel(), ac.currentTime, 0.8);
  },
  // --- structural introspection (headless verification) ---
  state() { return { key: this.key, pendingKey: this.pendingKey, intensity: this.intensity, running: !!this.timer }; },
};
function buzz(pat) { try { if (interacted && Settings.haptics && navigator.vibrate) navigator.vibrate(pat); } catch (e) {} }

// ---------- game state ----------
// whiff: per-strike chance the AI swings clean through (a human error, never a
// superhuman stat - it only ever makes rivals weaker). windup: telegraph time.
const DIFFS = [
  { name: 'Rookie',   maxSpeed: 780,  react: 0.30, aimErr: 100, strike: 0.62, aggro: 0.50, tick: 0.14, whiff: 0.12, windup: 0.11 },
  { name: 'Club Pro', maxSpeed: 1180, react: 0.13, aimErr: 45,  strike: 1.00, aggro: 0.70, tick: 0.09, whiff: 0.03, windup: 0.11 },
  { name: 'Champion', maxSpeed: 1520, react: 0.10, aimErr: 34,  strike: 1.25, aggro: 0.95, tick: 0.06, whiff: 0.01, windup: 0.14 },
];
const PLAYER_CAP = 4200; // mallet tracking cap - 1:1 feel, no teleporting

const G = {
  state: 'menu',            // menu | count | play | goal | win | pause
  mode: 'ai', difficulty: 1,
  score: [0, 0], winSide: 0,
  m1: null, m2: null, puck: null,
  timeScale: 1, freezeT: 0,
  trauma: 0,
  countT: 0, countN: 3, goalT: 0, goalSlowT: 0, goalSide: 0,
  stallT: 0, stallX: CX, stallY: CY, anchorT: 0, lastTouch: -1,
  idleT: 0, demo: false, gwNet: 0, // gwNet: online guest's match-scoped goal-width override (v20)
  serveDir: 1,
  pausedFrom: 'play',
  focusLost: false,     // focus-loss freeze: sim+net hold, audio suspended, veil up
  scuffs: [], parts: [], trail: [], texts: [], pulses: [],
  puckSq: 1, puckSqA: 0,    // squash amount / angle
  puckSqV: 0,              // squash spring velocity (damped-spring recovery)
  letterT: 0, flashA: 0,
  hitFlash: 0, hitFlashX: 0, hitFlashY: 0, // SMASH-tier impact flash
  roomPulse: 0,             // room reactivity: decays, feeds the lamp-glow overlay
  saveT: 0,                 // save-moment puck glow timer
  nearCd: 0, dipT: 0,       // near-miss cooldown + shared time-dip timer
                              // (near-miss dip and SMASH slow-mo beat)
  missGlow: null,           // { side, t } post glow after a near miss
  rattle: null,             // { side, t } goal-frame rattle after a hard frame hit
  goalFrameT: 0,            // goal-frame flash timer
  board: freshBoard(),      // scoreboard animation state
  ai: null,                 // per-ai brain state
  stats: null,              // per-match stats (top speed, rally, time)
  onlineFlip: false,        // ONLINE: guest view is mirrored - they play from their own side
  hintLive: false,          // first-time hint currently showing on the table
  themeId: 'deco',          // current table id (setTheme) - feeds the tour tracker
};
function freshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, saves: [0, 0], t0: 0, streak: [0, 0], bestStreak: [0, 0], worstDef: [0, 0] }; }
G.stats = freshStats();
const pointers = new Map(); // pointerId -> side (0 left/player, 1 right)

function mkMallet(side) {
  return {
    side, x: 0, y: 0, tx: 0, ty: 0,
    vx: 0, vy: 0,             // smoothed velocity (for strike transfer)
    r: MALLET_R,
    glueT: 0,                 // possession clock: sustained gentle contact time
    ghostT: 0,                // post-release grace: this mallet can't touch the puck
    touching: false,          // set per substep by collideMallet
    whooshT: 0, saveCd: 0,    // juice cooldowns
    trail: [],                // recent positions on fast flicks
    hitSq: 1, hitSqA: 0,      // impact squash amount / angle (mirrors G.puckSq)
    contactActive: false,     // hit-effects edge latch - see collideMallet
  };
}
function resetPositions() {
  const m1 = G.m1, m2 = G.m2;
  m1.x = m1.tx = PX + 170; m1.y = m1.ty = CY;
  m2.x = m2.tx = PX + PW - 170; m2.y = m2.ty = CY;
  m1.vx = m1.vy = m2.vx = m2.vy = 0;
  for (const m of [m1, m2]) { m.glueT = 0; m.ghostT = 0; m.touching = false; m.trail.length = 0; m.hitSq = 1; m.hitSqA = 0; m.contactActive = false; }
  G.puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R, w: 0, ang: 0 };
  G.trail.length = 0; G.stallT = 0; G.lastTouch = -1;
  G.stallX = CX; G.stallY = CY; G.anchorT = 0;
  G.puckSq = 1; G.puckSqV = 0;
  // v24.2: park the AI brains in guard with latches cleared, so a point never
  // starts with a stale windup/strike/threat carried over from the last one
  for (const b of [G.ai1, G.ai2]) {
    if (!b) continue;
    b.state = 'guard'; b.tState = 0; b.tickT = 0;
    b.behindH = false; b.sideH = false; b.threatH = false; b.abortCd = 0;
    b.possessT = 0; b.pinT = 0; b.whiff = false;
    b.hist.length = 0;
    b.seen.x = CX; b.seen.y = CY; b.seen.vx = 0; b.seen.vy = 0;
  }
}
G.m1 = mkMallet(0); G.m2 = mkMallet(1);

// ---------- view / input mapping ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let view = { w: 0, h: 0, s: 1, ox: 0, oy: 0, portrait: false, camera: 'top', cam: null };
// flat playfield staging canvas for the 2.5D warp (rink resolution).
// Created lazily on first 2.5D frame so minimal-DOM test sandboxes that load
// game.js never pay for it.
let pfCanvas = null, pfCtx = null;
function pfStage() {
  if (!pfCanvas) {
    pfCanvas = document.createElement('canvas');
    pfCanvas.width = VW; pfCanvas.height = VH;
    pfCtx = pfCanvas.getContext('2d');
  }
  return pfCtx;
}

function resize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  view.w = w; view.h = h;
  // 2.5D camera: the camera IS the presentation when active.
  view.camera = ['top', 'elevated', 'surface'].includes(Settings.camera) ? Settings.camera : 'top';
  // Board orientation is a persisted setting and the single source of truth
  // for the top-down view: 'portrait' forces the rotated presentation on any
  // screen, 'landscape' (default) keeps the rink unrotated on any screen. No
  // auto-override by screen shape - the toggle must do what it says on every
  // device. In 2.5D the camera is the whole presentation, so the orientation
  // toggle is parked (the settings UI disables it there) and the affine fit
  // stays landscape - the game space itself stays landscape either way and
  // physics and AI never see the rotation (screenToRink inverts it for input).
  view.portrait = view.camera === 'top' && Settings.orientation === 'portrait';
  if (!view.portrait) {
    view.s = Math.min(w / VW, h / VH);
    view.ox = (w - VW * view.s) / 2; view.oy = (h - VH * view.s) / 2;
  } else {
    view.s = Math.min(w / VH, h / VW);
    view.ox = (w - VH * view.s) / 2; view.oy = (h - VW * view.s) / 2;
  }
  view.dpr = dpr;
  fitCamera();
  paintRoom();
  paintTableWarp(); // 2.5D: re-warp the static table for the new fit
}

// ---------- 2.5D camera ----------
// Optional faux-2.5D views (elevated / surface) alongside the top-down view.
// The simulation never leaves flat table space: the camera is a pure view
// layer. camProject maps table coords (x, y, z = height above the surface)
// to screen CSS px; camUnproject inverts a screen point through a
// ray/plane intersection so pointer control keeps tracking the mallet.
// All ten tables share the same geometry, so every theme gets both views
// for free. Pure functions of (preset, w, h, flip) - unit-testable.
const CAM_PRESETS = {
  elevated: { c: [-650, CY, 720], look: [760, CY, 0] },
  surface: { c: [-60, CY, 170], look: [950, CY, 0] },
};
const TX1 = TX0 + PW + RAIL * 2, TY1 = TY0 + PH + RAIL * 2; // table footprint
function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
// Build a fitted camera. flip mirrors it behind the other end so the online
// guest plays from their own side, exactly like the top-down mirror.
function makeCamera(presetName, w, h, flip) {
  const pr = CAM_PRESETS[presetName];
  if (!pr || !w || !h) return null;
  const mx = flip ? VW : 0, ms = flip ? -1 : 1;
  const C = [mx + ms * pr.c[0], pr.c[1], pr.c[2]];
  const L = [mx + ms * pr.look[0], pr.look[1], pr.look[2]];
  const fwd = v3norm(v3sub(L, C));
  const right = v3norm(v3cross(fwd, [0, 0, 1]));
  const up = v3cross(right, fwd);
  // project with f=1, fit the footprint (+ mallet-handle clearance) to the viewport
  const p1 = (x, y, z) => {
    const dx = x - C[0], dy = y - C[1], dz = z - C[2];
    const Xc = dx * right[0] + dy * right[1] + dz * right[2];
    const Yc = dx * up[0] + dy * up[1] + dz * up[2];
    const Zc = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
    return [Xc / Zc, Yc / Zc];
  };
  const pts = [[TX0, TY0, 0], [TX1, TY0, 0], [TX0, TY1, 0], [TX1, TY1, 0], [CX, CY, 130]]
    .map(([x, y, z]) => p1(x, y, z));
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [px, py] of pts) {
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  // The scoreboard, chips and hint bar live in unwarped screen space, so the
  // footprint is fitted into the clear band below them, not the raw viewport.
  const bL = 0.03 * w, bT = 0.175 * h, bR = 0.97 * w, bB = 0.955 * h;
  const f = Math.min((bR - bL) / (x1 - x0), (bB - bT) / (y1 - y0));
  return { C, fwd, right, up, f, cx: (bL + bR) / 2 - f * (x0 + x1) / 2, cy: (bT + bB) / 2 + f * (y0 + y1) / 2 };
}
function fitCamera() {
  view.cam = view.camera === 'top' ? null
    : makeCamera(view.camera, view.w, view.h, !!G.onlineFlip);
}
// table (x, y, z) -> screen CSS px. s = screen px per rink unit at that depth.
function camProject(cam, x, y, z) {
  if (!cam) return null;
  const dx = x - cam.C[0], dy = y - cam.C[1], dz = z - cam.C[2];
  const Xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const Yc = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const Zc = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (Zc < 1) return null; // behind the near plane
  const s = cam.f / Zc;
  return { x: cam.cx + Xc * s, y: cam.cy - Yc * s, s, zc: Zc };
}
// screen CSS px -> table (x, y) via ray/plane (z=0) intersection.
// This is the exact inverse of camProject for z=0 points.
function camUnproject(cam, sx, sy) {
  const nx = (sx - cam.cx) / cam.f, ny = -(sy - cam.cy) / cam.f;
  const rx = cam.fwd[0] + nx * cam.right[0] + ny * cam.up[0];
  const ry = cam.fwd[1] + nx * cam.right[1] + ny * cam.up[1];
  const rz = cam.fwd[2] + nx * cam.right[2] + ny * cam.up[2];
  const t = -cam.C[2] / rz;
  return { x: cam.C[0] + rx * t, y: cam.C[1] + ry * t };
}
// pre-render the theme's room to an offscreen canvas (screen space)
function paintRoom() {
  const w = view.w, h = view.h, dpr = view.dpr || 1;
  if (!w || !h) return;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * dpr));
  c.height = Math.max(2, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  if (THEME.paintRoom) THEME.paintRoom(g, w, h);
  else {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#141414'); bg.addColorStop(1, '#080808');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
  }
  G.roomCanvas = c;
}
// client px -> rink coords (inverse of render transform)
function screenToRink(cx, cy) {
  // 2.5D: the camera is the transform - invert through the ray/plane hit.
  // The camera already sits behind the viewer's own end (mirrored for the
  // online guest), so the result is true rink coords, no extra flip.
  if (view.camera !== 'top' && view.cam) return camUnproject(view.cam, cx, cy);
  const { s, ox, oy, portrait } = view;
  const u = (cx - ox) / s, v = (cy - oy) / s;
  let x, y;
  if (!portrait) { x = u; y = v; }
  else { x = VW - v; y = u; } // inverse of the true-rotation portrait matrix
  if (G.onlineFlip) x = VW - x; // ONLINE: invert the guest view mirror
  return { x, y };
}
// ONLINE: scoreboard / win / ribbon labels by side (0 = left/host, 1 = right/guest)
function onlineSideLabel(side) {
  const amGuest = typeof Net !== 'undefined' && Net.role === 'guest';
  if (side === 0) return amGuest ? 'RIVAL' : 'YOU';
  return amGuest ? 'YOU' : 'RIVAL';
}
// Scoreboard + match-point ribbon side labels, by mode. Exhibition (watch)
// names both AIs - the left board is never "YOU" when no human is playing.
function sideLabel(side) {
  // While the lobby overlay sits over a paused match, openLobby flips G.mode
  // to 'online' (to keep the attract demo off). The scoreboard behind the
  // overlay must keep showing the paused match's real labels, so use the
  // mode recorded at pause time instead of the flipped one.
  const mode = (G._lobbyPaused && G._lobbyPausedMode) ? G._lobbyPausedMode : G.mode;
  if (mode === '2p') return side === 0 ? 'P1' : 'P2';
  if (mode === 'online') return onlineSideLabel(side);
  if (mode === 'watch' && G.watch) return DIFFS[G.watch[side === 0 ? 'a' : 'b']].name.toUpperCase();
  return side === 0 ? 'YOU' : DIFFS[G.difficulty].name.toUpperCase();
}
function rinkText(c, str, x, y) {
  // ONLINE: rink-space text that stays upright when the guest view is mirrored.
  // Use ONLY inside the flipped playfield block: the mirror in the current
  // transform would flip glyphs, so this counter-flips them back. Screen-space
  // type (countdown, GOAL! letterbox) lives outside the flip and must keep
  // using plain fillText.
  if (!G.onlineFlip) { c.fillText(str, x, y); return; }
  c.save(); c.translate(x, y); c.scale(-1, 1);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(str, 0, 0); c.restore();
}
function clampMallet(m) {
  const r = m.r;
  if (m.side === 0) m.x = clamp(m.x, PX + r, CX - 8);
  else m.x = clamp(m.x, CX + 8, PX + PW - r);
  m.y = clamp(m.y, PY + r, PY + PH - r);
  m.tx = clamp(m.tx, m.side === 0 ? PX + r : CX + 8, m.side === 0 ? CX - 8 : PX + PW - r);
  m.ty = clamp(m.ty, PY + r, PY + PH - r);
}
// move mallet toward target with a speed cap - 1:1 feel, never teleports
function driveMallet(m, dt, cap) {
  const dx = m.tx - m.x, dy = m.ty - m.y;
  const d = hyp(dx, dy), maxD = cap * dt;
  if (d > 0.5) {
    const step = Math.min(d, maxD);
    const nx = m.x + dx / d * step, ny = m.y + dy / d * step;
    const ivx = (nx - m.x) / dt, ivy = (ny - m.y) / dt;
    const k = 1 - Math.exp(-22 * dt);
    m.vx += (ivx - m.vx) * k; m.vy += (ivy - m.vy) * k;
    m.x = nx; m.y = ny;
    // motion trail on fast flicks: distance-based so 240 Hz substeps don't
    // flood it - ~8 points of ~26u reads as a streak, not a smear
    const tr = m.trail, last = tr[tr.length - 1];
    if (hyp(m.vx, m.vy) > 1200) {
      if (!last || hyp(m.x - last.x, m.y - last.y) > 26) {
        tr.push({ x: m.x, y: m.y });
        if (tr.length > 8) tr.shift();
      }
    } else if (tr.length) tr.shift();
  } else {
    const k = 1 - Math.exp(-14 * dt);
    m.vx += (0 - m.vx) * k; m.vy += (0 - m.vy) * k;
  }
  clampMallet(m);
}

// Touch finger-offset (v8): the mallet floats away from the fingertip so the
// finger never covers it - the convention top mobile air hockey games use.
// Size-aware: roughly one mallet diameter of screen-space offset, scaled by
// the current view transform, so it feels right on phones and tablets.
// Direction is away from the player's own body: in portrait 2P the top
// player (side 1) gets the offset flipped so the mallet sits below the
// fingertip. Online guests are mirror-flipped to play from their own side,
// so they always keep the standard upward offset. Mouse/pen are untouched.
function touchOffsetY(side, cx, cy) {
  let px;
  if (view.camera !== 'top' && view.cam && cx !== undefined) {
    // size-aware in 2.5D too: measure the mallet's on-screen size at the
    // touch point through the camera, so the offset feels right at any depth
    const r = camUnproject(view.cam, cx, cy);
    const pr = camProject(view.cam, r.x, r.y, 0);
    px = pr ? MALLET_R * pr.s : 40;
  } else {
    px = MALLET_R * (view.s || 1); // rink units -> CSS px
  }
  const off = clamp(px * 2.0, 40, 96); // ~one mallet diameter
  // In 2.5D the far player (side 1) sits at the top of the screen, like the
  // portrait top player - their offset flips the same way.
  const topPlayer = side === 1 && G.mode === '2p' && (view.portrait || view.camera !== 'top');
  return topPlayer ? off : -off;
}

function onPointerDown(e) {
  AudioSys.init(); AudioSys.resume();
  interacted = true;
  if (G.state === 'menu' || G.state === 'win') return; // buttons own the UI
  if (G.mode === 'watch') return; // EXHIBITION: no human input - both mallets are AI-driven
  const touch = e.pointerType === 'touch';
  // Side assignment uses the raw (unshifted) touch point so the vertical
  // offset can never drag a touch across the center line in portrait 2P.
  const raw = screenToRink(e.clientX, e.clientY);
  if (G.mode === 'online' && !pointers.has(e.pointerId)) {
    // ONLINE: exactly one local mallet - host plays m1, guest plays m2. No AI.
    if (pointers.size > 0) return;
    pointers.set(e.pointerId, Net.role === 'guest' ? 1 : 0);
  } else if (G.mode === '2p' && !pointers.has(e.pointerId)) {
    const side = raw.x > CX ? 1 : 0;
    const taken = [...pointers.values()];
    if (!taken.includes(side)) pointers.set(e.pointerId, side);
    else return;
  } else if (!pointers.has(e.pointerId)) {
    if (pointers.size > 0 && G.mode !== '2p') return;
    pointers.set(e.pointerId, 0);
  }
  const side = pointers.get(e.pointerId);
  const m = side === 0 ? G.m1 : G.m2;
  const r = screenToRink(e.clientX, e.clientY + (touch ? touchOffsetY(side, e.clientX, e.clientY) : 0));
  m.tx = r.x; m.ty = r.y;
  G.idleT = 0;
}
function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  if (G.state === 'menu' || G.state === 'win') return;
  const side = pointers.get(e.pointerId);
  const touch = e.pointerType === 'touch';
  const r = screenToRink(e.clientX, e.clientY + (touch ? touchOffsetY(side, e.clientX, e.clientY) : 0));
  const m = side === 0 ? G.m1 : G.m2;
  m.tx = r.x; m.ty = r.y;
  G.idleT = 0;
}
function onPointerUp(e) { pointers.delete(e.pointerId); }

// ---------- physics ----------
function puckSpeed() { return hyp(G.puck.vx, G.puck.vy); }

function collideWalls(p) {
  const r = p.r;
  // top / bottom rails
  if (p.y < PY + r) {
    p.y = PY + r;
    if (p.vy < 0) {
      const imp = -p.vy;
      p.vy = -p.vy * paceWall(); p.vx *= 0.995;
      onRailHit(p.x, PY, imp, false, 0, 1);
    }
  } else if (p.y > PY + PH - r) {
    p.y = PY + PH - r;
    if (p.vy > 0) {
      const imp = p.vy;
      p.vy = -p.vy * paceWall(); p.vx *= 0.995;
      onRailHit(p.x, PY + PH, imp, false, 0, -1);
    }
  }
  // end walls with goal mouths
  const inMouth = Math.abs(p.y - CY) < goalW() / 2 - 6;
  // the goal frame rings: contact just outside the mouth is a post hit
  const nearPost = !inMouth && Math.abs(p.y - CY) < goalW() / 2 + 42;
  if (p.x < PX + r && !inMouth) {
    p.x = PX + r;
    if (p.vx < 0) { const imp = -p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX, p.y, imp, nearPost, 1, 0); }
  } else if (p.x > PX + PW - r && !inMouth) {
    p.x = PX + PW - r;
    if (p.vx > 0) { const imp = p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX + PW, p.y, imp, nearPost, -1, 0); }
  }
}

// mallet is kinematic (infinite mass): positional separation + impulse
// with full mallet-velocity transfer, so flicks become rockets.
//
// Possession clock (stuck-puck fix): a mallet pressing the puck into a rail
// pocket defeats both anti-stall systems - constant contact keeps resetting
// G.stallT, and the displacement nudge gets smothered. So each mallet tracks
// glueT: sustained gentle contact time. Hard hits reset it; past
// GLUE_HARD_CUTOFF (1.2s - legit contact is ~0.18s, so this never touches
// normal play; lowered from the original 2.5s) an unconditional release
// fires. Rail pins squirt along the rail; open-ice presses pop off the
// mallet face. The pressing mallet goes ghost for 0.30s so it can't
// instantly re-trap.
//
// A gentler progressive nudge (easing the puck out over the whole glue
// window rather than one release at the end) was tried and measured here
// and didn't hold up: once the mallet and puck velocities both settle near
// zero the two are just resting in contact, not colliding, so nothing in
// the per-substep collision response ever runs to apply a nudge to - the
// puck is asleep, not being repeatedly struck. Fixing that properly needs
// a position-based (not impulse-based) escape, which is a bigger change
// than this pass - the hard cutoff alone still cuts the worst case from
// 2.5s to 1.2s, and the separate contactActive fix below removes the
// hundreds-of-events-per-second effects spam that made the wait feel far
// worse than the raw duration.
// shared escape-direction logic for a puck pinned in a rail/corner pocket -
// used by both the progressive relief nudge and the hard release below, so
// they always agree on which way is "out." A true double-corner (near two
// rails at once) can't just zero both blocked axes - that leaves a zero
// vector - so once anything is railed we commit to a single clean axis:
// along the top/bottom rail toward whichever side exit is nearer.
function glueEscapeDir(p, nx, ny) {
  const nearT = p.y < PY + 70, nearB = p.y > PY + PH - 70;
  const nearL = p.x < PX + 70, nearR = p.x > PX + PW - 70;
  const inMouthY = Math.abs(p.y - CY) < goalW() / 2;
  let rx = nx, ry = ny, railed = false;
  if (nearT && ry < 0) { ry = 0; railed = true; }
  if (nearB && ry > 0) { ry = 0; railed = true; }
  if (nearL && rx < 0 && !inMouthY) { rx = 0; railed = true; }
  if (nearR && rx > 0 && !inMouthY) { rx = 0; railed = true; }
  if (railed) {
    if (nearT || nearB) { rx = (p.x - PX) < (PX + PW - p.x) ? 1 : -1; ry = 0; }
    else { rx = 0; ry = (p.y - PY) < (PY + PH - p.y) ? 1 : -1; }
  }
  return { rx, ry, railed, nearT, nearB };
}
function collideMallet(p, m, dt) {
  const dx = p.x - m.x, dy = p.y - m.y;
  const minD = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (m.ghostT > 0) { m.glueT = 0; m.contactActive = false; return; } // ghostT ticks in stepPhysics
  if (d2 >= minD * minD || d2 === 0) { m.contactActive = false; return; }
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  m.touching = true;
  // --- possession clock ---
  const vn0 = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  const mvn0 = m.vx * nx + m.vy * ny;
  if (-vn0 + Math.max(0, mvn0) > 650) m.glueT = 0;
  else m.glueT += dt;
  if (m.glueT > GLUE_HARD_CUTOFF) {
    const { rx: rx0, ry: ry0, railed, nearT, nearB } = glueEscapeDir(p, nx, ny);
    let rx = rx0, ry = ry0;
    if (!railed) {
      p.x = m.x + nx * minD; p.y = m.y + ny * minD;
      p.vx = nx * 560; p.vy = ny * 560;
      m.hitSq = 0.8; m.hitSqA = Math.atan2(ny, nx);
      onMalletHit(p.x, p.y, 500, nx, ny);
    } else {
      if (nearT || nearB) {
        p.y = nearT ? PY + p.r : PY + PH - p.r;
        p.x = clamp(p.x, PX + p.r, PX + PW - p.r);
        rx = (p.x - PX) < (PX + PW - p.x) ? 1 : -1; ry = 0;
      } else {
        p.x = nearL ? PX + p.r : PX + PW - p.r;
        p.y = clamp(p.y, PY + p.r, PY + PH - p.r);
        rx = 0; ry = (p.y - PY) < (PY + PH - p.y) ? 1 : -1;
      }
      p.vx = rx * 950; p.vy = ry * 950;
      m.ghostT = 0.30;
      m.hitSq = 0.72; m.hitSqA = Math.atan2(ry, rx);
      onMalletHit(p.x, p.y, 750, rx, ry);
    }
    m.glueT = 0; m.contactActive = false; G.lastTouch = m.side;
    return;
  }
  // --- normal contact ---
  p.x = m.x + nx * minD; p.y = m.y + ny * minD;
  const rvx = p.vx - m.vx, rvy = p.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) { m.contactActive = false; return; } // separating
  // Speed-dependent restitution: a still/slow mallet SMOTHERS the puck
  // (real goalie play - the puck drops dead for possession), a driven
  // mallet bounces it lively. This is what makes traps, dribbles and
  // possession possible instead of endless pinball.
  const msp0 = hyp(m.vx, m.vy);
  const e = lerp(0.35, 0.92, clamp(msp0 / 1200, 0, 1));
  let j = -(1 + e) * vn;
  // smack bonus: mallet driving into the puck adds extra punch
  const mvn = m.vx * nx + m.vy * ny; // >0 means mallet moving toward puck
  const pvx0 = p.vx; // pre-impulse: save detection reads the puck's intent, not its rebound
  if (mvn > 0) j += mvn * SMACK_BONUS;
  p.vx += nx * j; p.vy += ny * j;
  // safety: a genuinely driven hit never dies
  const sp = hyp(p.vx, p.vy);
  const msp = hyp(m.vx, m.vy);
  if (sp < 250 && msp > 800) {
    p.vx = nx * 250; p.vy = ny * 250;
  }
  const nsp = hyp(p.vx, p.vy);
  if (nsp > PUCK_MAX) { p.vx *= PUCK_MAX / nsp; p.vy *= PUCK_MAX / nsp; }
  // english: tangential mallet velocity at contact becomes puck spin -
  // the Magnus curve is applied in stepPhysics
  const tx = -ny, ty = nx;
  const tang = (m.vx - p.vx) * tx + (m.vy - p.vy) * ty;
  p.w = clamp((p.w || 0) + tang / 260, -12, 12);
  G.lastTouch = m.side;
  G.stallT = 0;
  // hit-effects cascade (sound, particles, shake, save/whoosh, mallet recoil):
  // only on the leading edge of a contact episode. Continuous smothering
  // contact re-enters this branch every substep (up to 240/sec) while the
  // puck is pinned against the mallet - without this gate that's hundreds
  // of hit-sounds + camera shakes + particle bursts a second for a puck
  // that isn't going anywhere (the "stuck buzzing" / rapid-fire feel).
  // A genuinely separate touch (vn>=0 above, or losing contact entirely)
  // always clears the latch first, so a real fast dribble still gets a
  // distinct hit registered for each bounce.
  if (!m.contactActive) {
    const impact = -vn + Math.max(0, mvn);
    // SAVE: a fast lateral block of a puck bound for your own goal gets the
    // soft treatment - thud, ring pulse, brief puck glow. High drama, low noise.
    if (m.saveCd <= 0 && impact > 220 && (m.side === 0 ? pvx0 < -450 : pvx0 > 450) && msp0 > 650) {
      m.saveCd = 0.9;
      G.saveT = 0.55;
      G.pulses.push({ x: p.x, y: p.y, t: 0 });
      AudioSys.thud();
      // match stat: bank a save for the defender's side (real play only - never demo)
      if (G.state === 'play' && !G.demo && G.stats) G.stats.saves[m.side]++;
    }
    // fast flicks whoosh on the way through (cooled down so rallies don't hiss)
    if (msp0 > 1300 && m.whooshT <= 0) {
      m.whooshT = 0.3;
      AudioSys.whoosh(msp0 / 3000);
    }
    // the mallet takes a bit of the recoil too - a driven strike compresses
    // it along the contact normal for a couple frames before it springs back
    m.hitSq = 1 - clamp(impact / 2600, 0, 0.34);
    m.hitSqA = Math.atan2(ny, nx);
    onMalletHit(p.x, p.y, impact, nx, ny);
  }
  m.contactActive = true;
}

function stepPhysics(dt) {
  const p = G.puck;
  // glide: near-zero friction, like air jets (pace setting tunes the table)
  const damp = Math.exp(-paceDamp() * dt);
  p.vx *= damp; p.vy *= damp;
  // Magnus: puck spin (english from tangential mallet contact) curves flight.
  // |a| = K·|w|·|v| - at w=10, v=2000 that's ~600 u/s², a visible bend
  // across the table; negligible at low speed. Spin decays in ~1s.
  if (p.w) {
    const spm = hyp(p.vx, p.vy);
    if (spm > 60) {
      const mx = -p.vy * 0.03 * p.w * dt, my = p.vx * 0.03 * p.w * dt;
      p.vx += mx; p.vy += my;
    }
    p.w *= Math.exp(-1.1 * dt);
    if (Math.abs(p.w) < 0.05) p.w = 0;
    p.ang = (p.ang || 0) + p.w * dt;
  }
  // match stats: fastest the puck ever flies (table-scale km/h later)
  if (G.state === 'play' && !G.demo) {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > G.stats.topSpeed) G.stats.topSpeed = sp;
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  // per-mallet per-substep bookkeeping: ghost/whoosh/save cooldowns tick
  // here (not in collideMallet) so they decay even without contact; glueT
  // decays when the mallet isn't touching so the possession ring never
  // lingers after a clean separation.
  for (let mi = 0; mi < 2; mi++) {
    const m = mi === 0 ? G.m1 : G.m2; // indexed, not [G.m1, G.m2] - no alloc at 240 Hz
    if (m.ghostT > 0) m.ghostT -= dt;
    if (m.whooshT > 0) m.whooshT -= dt;
    if (m.saveCd > 0) m.saveCd -= dt;
    if (!m.touching) m.glueT = Math.max(0, m.glueT - dt * 2);
    m.touching = false;
    m.hitSq += (1 - m.hitSq) * Math.min(1, dt * 10); // recoil recovery
  }
  collideMallet(p, G.m1, dt);
  collideMallet(p, G.m2, dt);
  collideWalls(p);
  // goals: full crossing of the line inside the mouth
  if (p.x > PX + PW + p.r * 0.35 && Math.abs(p.y - CY) < goalW() / 2) onGoal(0);
  else if (p.x < PX - p.r * 0.35 && Math.abs(p.y - CY) < goalW() / 2) onGoal(1);
  // near-miss drama: a fast puck kissing the goal frame without scoring -
  // a tiny time dip, a glowing post, a soft tick. Once per 1.5s max.
  if (G.state === 'play' && !G.demo && G.nearCd <= 0) {
    const dy = Math.abs(p.y - CY);
    const nearL = p.x > PX - 30 && p.x < PX + 80;
    const nearR = p.x > PX + PW - 80 && p.x < PX + PW + 30;
    if ((nearL || nearR) && dy > goalW() / 2 - 30 && dy < goalW() / 2 + PUCK_R + 26 && hyp(p.vx, p.vy) > 500) {
      G.nearCd = 1.5;
      if (fxFlash()) {
        G.dipT = 0.22;
        G.missGlow = { side: nearL ? 0 : 1, t: 0.7 };
      }
      AudioSys.blip(1500, 0.05, 0.10);
    }
  }
  // anti-stall: a real table never lets the puck die mid-rink - a whisper
  // of air from the jets keeps the game alive
  if (G.state === 'play') stallWatch(dt);
  // trail
  G.trail.push({ x: p.x, y: p.y });
  if (G.trail.length > Math.round(16 * fxTrail())) G.trail.shift();
  // squash recovery: a damped spring, not an exponential fade - the puck
  // pops back with a faint overshoot, the way real rubber does. k=200/d=16
  // recovers in ~0.15s with a ~2% overshoot, settled by ~0.4s: snappy and
  // physical, never cartoonish.
  G.puckSqV += (-(G.puckSq - 1) * 200 - G.puckSqV * 16) * dt;
  G.puckSq += G.puckSqV * dt;
}

// Anti-stall: air jets. A dead puck never sits - shared by live play and the
// attract demo so neither can freeze mid-rink.
function stallWatch(dt) {
  const p = G.puck;
  // displacement anchor: a pinned puck (constant mallet contact keeps
  // resetting stallT below) still counts as stalled if it goes nowhere.
  // The nudge aims at open ice, not random - it reads as the table
  // breathing, not a glitch.
  if (hyp(p.x - G.stallX, p.y - G.stallY) > 90) {
    G.stallX = p.x; G.stallY = p.y; G.anchorT = 0;
  } else {
    G.anchorT += dt;
    if (G.anchorT > 2.6) {
      G.anchorT = 0; G.stallX = p.x; G.stallY = p.y;
      const dx = CX - p.x, dy = CY - p.y, dl = hyp(dx, dy) || 1;
      p.vx = dx / dl * 430; p.vy = dy / dl * 430;
      airPuff(p.x, p.y);
    }
  }
  const sp = hyp(p.vx, p.vy);
  if (sp < STALL_V) {
    G.stallT += dt;
    if (G.stallT > STALL_T) {
      G.stallT = 0;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const ang = (Math.random() < 0.75 ? 0 : Math.PI) + rnd(-0.5, 0.5) + (dir > 0 ? 0 : Math.PI);
      const push = 380;
      p.vx += Math.cos(ang) * push; p.vy += Math.sin(ang) * push * 0.6;
      airPuff(p.x, p.y);
    }
  } else G.stallT = 0;
}

// ---------- AI: plays like a real person ----------
// States: guard -> track -> engage -> windup -> strike -> recover,
// plus defend (intercept) and cornerEscape. One brain drives m2 in
// solo play; in demo mode a second brain drives m1.
function mkBrain(side, diffIdx) {
  return {
    side, diff: DIFFS[diffIdx],
    state: 'guard', tState: 0, tickT: 0,
    aimX: 0, aimY: 0, windT: 0,
    pinT: 0, pinX: 0, pinY: 0, swayT: rnd(10), possessT: 0,
    arPhase: 0, // 'around' detour phase: 0 = sidestep clear, 1 = cross goal-side
    whiff: false, // this strike will swing clean through (a human miss)
    // commitment hysteresis (v24): sticky latches with deadbands so the AI
    // can't dither between strike/defend/reposition when the puck sits on a
    // decision boundary - the feint-loop fix. behindH: mallet truly behind
    // the puck on LIVE geometry (not delayed perception). sideH: puck
    // possession latched across the center line. threatH: threat on/off
    // band. abortCd: cooldown after a cancelled windup before it may wind
    // up again.
    behindH: false, sideH: false, threatH: false, abortCd: 0,
    seen: { x: CX, y: CY, vx: 0, vy: 0 }, // delayed perception
    hist: [], // puck history for reaction delay
  };
}
function aiPerceive(b, dt) {
  b.hist.push({ x: G.puck.x, y: G.puck.y, vx: G.puck.vx, vy: G.puck.vy, t: perfNow() });
  const cutoff = perfNow() - b.diff.react;
  while (b.hist.length > 2 && b.hist[0].t < cutoff) b.hist.shift();
  const s = b.hist[0];
  b.seen.x = s.x; b.seen.y = s.y; b.seen.vx = s.vx; b.seen.vy = s.vy;
}
function perfNow() { return performance.now() / 1000; }

// predict puck position t seconds ahead, with top/bottom wall bounces
function predictPuck(x, y, vx, vy, t) {
  let px = x, py = y;
  const step = 1 / 60;
  let rem = t;
  while (rem > 0) {
    const dt = Math.min(step, rem);
    px += vx * dt; py += vy * dt;
    if (py < PY + PUCK_R) { py = PY + PUCK_R; vy = Math.abs(vy) * paceWall(); }
    else if (py > PY + PH - PUCK_R) { py = PY + PH - PUCK_R; vy = -Math.abs(vy) * paceWall(); }
    rem -= dt;
  }
  return { x: px, y: py };
}
function aiHome(b) {
  // home: goal-side, slightly favoring puck's vertical zone - with idle sway
  b.swayT += 1 / 60;
  const hx = b.side === 0 ? PX + 190 : PX + PW - 190;
  const hy = CY + (b.seen.y - CY) * 0.35 + Math.sin(b.swayT * 1.7) * 14;
  return { x: hx, y: clamp(hy, PY + 90, PY + PH - 90) };
}
function aiThink(b, dt, m) {
  const D = b.diff;
  b.tState += dt; b.tickT += dt;
  if (b.abortCd > 0) b.abortCd -= dt;
  if (b.tickT < D.tick) return; // decisions at 7–16 Hz, like a human
  b.tickT = 0;
  const s = b.seen, p = G.puck;
  const myGoalX = b.side === 0 ? PX : PX + PW;
  const foeGoalX = b.side === 0 ? PX + PW : PX;
  const puckOnMySide = b.side === 0 ? s.x < CX : s.x > CX;
  const puckSpeed = hyp(s.vx, s.vy);
  // HYSTERESIS LATCHES (v24) - see mkBrain. The raw signals flicker when
  // the puck sits on a boundary (center line, threat speed, behind margin);
  // a latch only flips once the puck is clearly across its band, so the
  // brain can't shuttle guard<->engage<->defend every few ticks.
  const dirS0 = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
  // threat: on at 500 u/s inbound (delayed perception - a human needs a beat
  // to notice), off at 350 or once it leaves my side. v24.2: the OFF edge
  // reads the LIVE puck, not the delayed ghost. The old code kept defend
  // latched on a stale inbound read after the puck bounced off the rail or
  // was deflected away - the AI would then lunge at a puck that was moving
  // away from its net, meet it from the wrong side, and shank it home.
  // That stale-threat lunge was the #1 measured own-goal mechanism.
  if (!b.threatH && (b.side === 0 ? s.vx < -500 : s.vx > 500) && puckOnMySide) b.threatH = true;
  else if (b.threatH && ((b.side === 0 ? p.vx > -350 : p.vx < 350) || !puckOnMySide)) b.threatH = false;
  const threat = b.threatH;
  // side possession: latch across the center line with a 40u deadband - the
  // puck jittering on the line can't bounce guard<->engage anymore
  if (b.side === 0 ? s.x < CX - 40 : s.x > CX + 40) b.sideH = true;
  else if (b.side === 0 ? s.x > CX + 40 : s.x < CX - 40) b.sideH = false;
  // behind: sticky on LIVE geometry, not delayed perception - committing to
  // a strike on a ghost puck is exactly the feint loop (windup on stale
  // `seen`, abort on live `p`, repeat). Latch at >50, release at <0.
  const liveBehind = dirS0 * (m.x - p.x);
  if (!b.behindH && liveBehind > 50) b.behindH = true;
  else if (b.behindH && liveBehind < 0) b.behindH = false;

  const setTx = (x, y) => {
    m.tx = b.side === 0 ? clamp(x, PX + MALLET_R, CX - 8) : clamp(x, CX + 8, PX + PW - MALLET_R);
    m.ty = clamp(y, PY + MALLET_R, PY + PH - MALLET_R);
  };
  const goHome = () => { const h = aiHome(b); setTx(h.x, h.y); };

  // Own-goal guard (v19): never plow through a slow puck that sits between
  // the mallet and your own net - that shove is the #1 measured own-goal
  // mechanism (AI own-goal rate was ~22% before this fix). Detour around it
  // to the goal side first. Skipped for live threats (defend handles those)
  // and for the strike sequence itself. Capped at 450 u/s: chasing a fast
  // puck with a sidestep causes its own wrong-side collisions (measured).
  if (b.state === 'guard' || b.state === 'defend') {
    const dirS = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
    const pSpd = hyp(p.vx, p.vy);
    const towardMe = dirS * p.vx > 150;      // live dribble - defend it, don't dodge
    const between = dirS * (p.x - m.x) > 0;  // puck sits between me and my net
    const close = hyp(p.x - m.x, p.y - m.y) < MALLET_R + PUCK_R + 80;
    if (!towardMe && pSpd < 450 && between && close) {
      b.state = 'around'; b.tState = 0; b.arPhase = 0;
    }
  }

  // pin rescue: if I'm smothering the puck into my corner and it hasn't gone
  // anywhere, I'm the trap - back off and dig it out. Speed-based checks
  // fail here because a pinned puck jitters fast between mallet and rail.
  if (b.state !== 'windup' && b.state !== 'strike') {
    const myCorner = b.side === 0
      ? (p.x < PX + 210 && (p.y < PY + 210 || p.y > PY + PH - 210))
      : (p.x > PX + PW - 210 && (p.y < PY + 210 || p.y > PY + PH - 210));
    const smothering = hyp(p.x - m.x, p.y - m.y) < MALLET_R + PUCK_R + 46;
    if (myCorner && smothering) {
      if (hyp(p.x - b.pinX, p.y - b.pinY) > 120) { b.pinX = p.x; b.pinY = p.y; b.pinT = 0; }
      b.pinT += D.tick;
      if (b.pinT > 0.8 && b.state !== 'escape') { b.state = 'escape'; b.tState = 0; b.pinT = 0; }
    } else { b.pinT = 0; b.pinX = p.x; b.pinY = p.y; }
  }

  switch (b.state) {
    case 'guard': {
      // v24.2: don't skate home through a live puck. If the puck blocks the
      // path and isn't coming at my net, hold until it clears - driving
      // through from the wrong side shoves it home (measured own-goal
      // mechanism; the stale-threat defend fix funnels these here). Slow
      // pucks are handled by the 'around' detour above; this is for ones
      // moving too fast to detour around.
      const h = aiHome(b);
      const dirSg = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
      const towardMe = dirSg * p.vx > 150;
      const pSpd = hyp(p.vx, p.vy);
      let blocked = false;
      if (!towardMe && pSpd > 120) {
        const dxh = h.x - m.x, dyh = h.y - m.y;
        const segLen2 = dxh * dxh + dyh * dyh;
        if (segLen2 > 1) {
          const t = clamp(((p.x - m.x) * dxh + (p.y - m.y) * dyh) / segLen2, 0, 1);
          blocked = hyp(p.x - (m.x + dxh * t), p.y - (m.y + dyh * t)) < MALLET_R + PUCK_R + 30;
        }
      }
      if (blocked) setTx(m.x, m.y); // hold - the puck will clear
      else goHome();
      if (threat) { b.state = 'defend'; b.tState = 0; }
      else if (b.sideH && puckSpeed < 1200 && Math.random() < D.aggro) { b.state = 'engage'; b.tState = 0; }
      break;
    }
    case 'around': {
      // OWN-GOAL DETOUR (v19): a slow puck sits between the mallet and my
      // net - driving through it shoves it in. Two beats: sidestep clear
      // (backing away can never touch it), then cross to its goal side so
      // the next touch clears it AWAY from the net.
      const dirS = b.side === 1 ? 1 : -1;
      if (b.arPhase === 0) {
        const wy = clamp(p.y + (m.y <= p.y ? -200 : 200), PY + MALLET_R, PY + PH - MALLET_R);
        setTx(m.x - dirS * 30, wy);
        if (Math.abs(m.y - wy) < 50 || b.tState > 0.55) { b.arPhase = 1; b.tState = 0; }
      } else {
        setTx(p.x + dirS * 120, p.y);
        if (dirS * (m.x - p.x) > 60 || b.tState > 1.1) { b.state = 'engage'; b.tState = 0; }
      }
      // a live threat cancels the detour - go block it
      if (threat) { b.state = 'defend'; b.tState = 0; }
      break;
    }
    case 'defend': {
      // intercept the predicted trajectory in front of goal
      const tHit = clamp(Math.abs((s.x - (b.side === 0 ? PX + 150 : PX + PW - 150)) / (s.vx || 1)), 0, 1.1);
      const pr = predictPuck(s.x, s.y, s.vx, s.vy, tHit * 0.85);
      const gx = b.side === 0 ? PX + 130 : PX + PW - 130;
      // deflection steering (v19): meet the puck slightly toward the mouth
      // CENTER from its lane, so the contact normal kicks deflections toward
      // the walls instead of into your own mouth. Only near the mouth - far
      // from it the lane coverage matters more than the deflection angle.
      const nearMouth = Math.abs(pr.y - CY) < goalW() / 2 + 60;
      const steerY = nearMouth ? (CY - pr.y) * 0.25 : 0;
      setTx(gx + (pr.x - gx) * 0.35, pr.y + steerY);
      // if the puck sits in reach (smothered block, loose puck), take it.
      // v24.2: this reads LIVE geometry and is checked BEFORE the guard
      // fallback. The old order fell through to guard on the delayed `seen`
      // read, so after a block the AI would skate home for a beat and then
      // come back - the visible "backing away from a hittable puck".
      const liveSpd = hyp(p.vx, p.vy);
      if (liveSpd < 900 && hyp(p.x - m.x, p.y - m.y) < 220) { b.state = 'engage'; b.tState = 0; }
      else if (!threat) { b.state = 'guard'; b.tState = 0; }
      break;
    }
    case 'engage': {
      // skate to the puck - always from the GOAL side. Driving straight at
      // a puck from the far side shoves it toward your own net (the classic
      // goalie own goal), so when the mallet isn't behind the puck yet it
      // swings wide around it first, then commits.
      const dirS = b.side === 1 ? 1 : -1; // +1 = toward my own goal (right)
      // desperate block: it's coming at my net fast and I'm on the wrong
      // side - forget the footwork, go meet it (defend steers the deflection)
      if (threat && dirS * (m.x - s.x) < 40) { b.state = 'defend'; b.tState = 0; break; }
      // b.behindH is the sticky live-geometry latch from the top of aiThink:
      // swing wide until truly behind the puck, then drive at it. The
      // deadband stops the sidestep<->drive target shuttle that read as
      // dithering from the stands.
      if (!b.behindH) {
        const wy = clamp(s.y + (m.y <= s.y ? -180 : 180), PY + MALLET_R, PY + PH - MALLET_R);
        const wx = s.x + dirS * 70;
        // v24.2: swing wide WITHOUT crossing the puck. Driving straight at
        // (wx, wy) can cut through a puck sitting between the mallet and the
        // waypoint - a wrong-side touch that shoves it toward your own net
        // (measured own-goal mechanism). If the live puck blocks the straight
        // path, hold x and clear laterally first; the x-approach runs once
        // we're on the wide line, 180u off the puck's lane.
        const clearR = MALLET_R + PUCK_R + 24;
        const dxw = wx - m.x, dyw = wy - m.y;
        const segLen2 = dxw * dxw + dyw * dyw;
        let blocked = false;
        if (segLen2 > 1) {
          const t = clamp(((p.x - m.x) * dxw + (p.y - m.y) * dyw) / segLen2, 0, 1);
          blocked = hyp(p.x - (m.x + dxw * t), p.y - (m.y + dyw * t)) < clearR;
        }
        if (blocked) setTx(m.x, wy);
        else setTx(wx, wy);
      } else {
        setTx(s.x, s.y);
      }
      const liveD = hyp(p.x - m.x, p.y - m.y);
      const liveSpd = hyp(p.vx, p.vy);
      // possession clock: herding the puck at close range counts as control
      if (liveD < MALLET_R + PUCK_R + 44) b.possessT += D.tick; else b.possessT = Math.max(0, b.possessT - D.tick);
      // windup ONLY from behind the puck on LIVE geometry. The old code
      // committed on delayed perception and the live-puck own-goal guard
      // then cancelled the strike: pull back, retreat, repeat - the visible
      // feint loop. abortCd spaces out attempts after a cancelled windup so
      // one bad read can't strobe the telegraph.
      if (b.abortCd <= 0 && b.behindH && liveD < MALLET_R + PUCK_R + 26 && (liveSpd < 700 || b.possessT > 0.35)) {
        b.state = 'windup'; b.tState = 0; b.windT = 0; b.possessT = 0;
        // pick aim: the FAR post, not the middle - the mouth corner farthest
        // from the puck's lane forces the keeper to travel across. aimErr
        // scatters the shot per difficulty, so Rookie sprays it (missing
        // often) while Champion pins the post.
        const bank = Math.random() < (b.diff === DIFFS[2] ? 0.35 : 0.12);
        b.bankY = bank ? (Math.random() < 0.5 ? PY + 40 : PY + PH - 40) : null;
        const farSide = s.y < CY ? 1 : -1;
        b.aimX = foeGoalX;
        b.aimY = CY + farSide * (goalW() / 2 - 12) + rnd(-1, 1) * D.aimErr;
      }
      // give up the chase only once the puck is clearly gone: the latched
      // side plus a higher speed bar than the engage-entry bar (hysteresis)
      if (!b.sideH || puckSpeed > 1900) { b.state = 'guard'; b.tState = 0; b.possessT = 0; }
      break;
    }
    case 'windup': {
      // ANTICIPATION: pull back away from the aim point - telegraphs the smash
      b.windT += D.tick;
      let ax = b.aimX, ay = b.aimY;
      if (b.bankY !== null) { ax = s.x; ay = b.bankY; } // aim at the rail first
      const dx = ax - s.x, dy = ay - s.y, dl = hyp(dx, dy) || 1;
      const back = 95;
      setTx(s.x - dx / dl * back, s.y - dy / dl * back);
      if (b.windT > D.windup) {
        // commit to the strike only if the mallet is still behind the LIVE
        // puck - it can drift during the windup, and lunging from the wrong
        // side blasts it into your own net
        const dirS = b.side === 1 ? 1 : -1;
        if (dirS * (m.x - p.x) < 30) { b.state = 'recover'; b.tState = 0; b.abortCd = 0.6; break; }
        b.state = 'strike'; b.tState = 0;
        // the whiff: a human misread, rolled per difficulty - the lunge
        // below will be offset clean past the puck
        b.whiff = Math.random() < (D.whiff || 0);
      }
      break;
    }
    case 'strike': {
      // drive THROUGH the puck toward the aim point - this is where
      // mallet velocity becomes puck velocity. Lead the puck slightly
      // so the lunge connects on a moving target.
      const dirS = b.side === 1 ? 1 : -1;
      // last-instant sanity: if the mallet somehow isn't behind the puck
      // at strike time, abort - lunging from the wrong side blasts it
      // into your own net
      if (b.tState <= D.tick * 1.5 && dirS * (m.x - p.x) < 20) {
        b.state = 'recover'; b.tState = 0; b.abortCd = 0.6; break;
      }
      const px = s.x + s.vx * 0.1, py = s.y + s.vy * 0.1;
      let ax = b.aimX, ay = b.aimY;
      if (b.bankY !== null) { ax = s.x; ay = b.bankY; }
      const dx = ax - px, dy = ay - py, dl = hyp(dx, dy) || 1;
      const through = 150;
      let tx = px + dx / dl * through, ty = py + dy / dl * through;
      if (b.whiff) {
        // swing clean through: offset perpendicular past the puck's edge
        // (130u > mallet + puck radius, so it genuinely misses)
        const side = Math.random() < 0.5 ? 1 : -1;
        tx += (-dy / dl) * 130 * side;
        ty += (dx / dl) * 130 * side;
      }
      setTx(tx, ty);
      if (b.tState > 0.34) { b.state = 'recover'; b.tState = 0; }
      break;
    }
    case 'recover': {
      goHome();
      // a whiffed swing takes longer to gather - the embarrassment tax
      if (b.tState > (b.whiff ? 0.75 : 0.4)) { b.state = 'guard'; b.tState = 0; b.whiff = false; }
      break;
    }
    case 'escape': {
      // two-beat dig-out: first back off to release the pin, then drive
      // through the puck toward open ice
      if (b.tState < 0.32) {
        const h = aiHome(b);
        setTx(m.x + (h.x - m.x) * 0.85, m.y + (h.y - m.y) * 0.85);
      } else {
        const dx = CX - p.x, dy = CY - p.y, dl = hyp(dx, dy) || 1;
        setTx(p.x + dx / dl * 160, p.y + dy / dl * 160);
      }
      if (b.tState > 0.9) { b.state = 'guard'; b.tState = 0; }
      break;
    }
  }
  // Crease caution (v19): on the wrong side of the puck while positioning,
  // the mallet is capped to a soft speed - a fast wrong-side touch is
  // exactly how own goals happen; a soft touch never is. aiDrive applies it.
  // Defend/strike stay uncapped: blocks and lunges need full speed.
  const dirS = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
  b.careful = dirS * (m.x - p.x) < 40 &&
    (b.state === 'engage' || b.state === 'around' || b.state === 'guard');
}
function aiDrive(b, dt, m) {
  aiPerceive(b, dt);
  aiThink(b, dt, m);
  // the strike param finally does something: lunges scale with the
  // difficulty's strike rating, so Rookie pokes and Champion detonates
  let cap = b.diff.maxSpeed * (b.state === 'strike' ? 1.5 * b.diff.strike : 1);
  if (b.careful) cap *= 0.45; // wrong side of the puck: soft touches only
  driveMallet(m, dt, cap);
}

// ---------- juice ----------
function addTrauma(x) {
  let k = Settings.shake === 'off' ? 0 : Settings.shake === 'subtle' ? 0.45 : 1;
  if (Settings.effects === 'minimal') k = Math.min(k, 0.45); // Minimal caps Shake at Subtle
  G.trauma = clamp(G.trauma + x * k, 0, 1);
}
// shared shake-intensity scale: mirrors addTrauma's gating so every new
// shake flavor respects the Shake setting + Minimal cap identically
function shakeK() {
  let k = Settings.shake === 'off' ? 0 : Settings.shake === 'subtle' ? 0.45 : 1;
  if (Settings.effects === 'minimal') k = Math.min(k, 0.45);
  return k;
}
function shakeOffset() {
  // Nijman's rule: a touch of ROTATION reads as force; pure translation reads as a glitch
  const t2 = G.trauma * G.trauma;
  return {
    x: rnd(-1, 1) * 13 * t2,
    y: rnd(-1, 1) * 13 * t2,
    r: rnd(-1, 1) * 0.011 * t2,
  };
}
// pooled particles - no allocation in the hot loop
const PPOOL = [];
for (let i = 0; i < 260; i++) PPOOL.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, color: '#fff' });
function burst(x, y, n, color, speed, size = 3.5) {
  let c = 0;
  for (const q of PPOOL) {
    if (q.on) continue;
    q.on = true;
    const a = rnd(TAU), sp = rnd(0.25, 1) * speed;
    q.x = x; q.y = y; q.vx = Math.cos(a) * sp; q.vy = Math.sin(a) * sp;
    q.life = q.max = rnd(0.25, 0.6); q.size = size * rnd(0.6, 1.3); q.color = color;
    if (++c >= n) break;
  }
}
function airPuff(x, y) {
  // the table's air jets whisper the dead puck back to life
  for (let i = 0; i < 10; i++) {
    for (const q of PPOOL) {
      if (q.on) continue;
      q.on = true;
      q.x = x + rnd(-30, 30); q.y = y + rnd(-30, 30);
      q.vx = rnd(-40, 40); q.vy = rnd(-90, -20);
      q.life = q.max = rnd(0.4, 0.8); q.size = rnd(2, 5); q.color = 'rgba(200,220,235,0.5)';
      break;
    }
  }
}
function updateParts(dt) {
  for (const q of PPOOL) {
    if (!q.on) continue;
    q.life -= dt;
    if (q.life <= 0) { q.on = false; continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    const d = Math.exp(-3.2 * dt);
    q.vx *= d; q.vy *= d;
  }
  for (let i = G.scuffs.length - 1; i >= 0; i--) {
    G.scuffs[i].a -= dt * 0.10;
    if (G.scuffs[i].a <= 0) G.scuffs.splice(i, 1);
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.t += dt; t.y -= dt * 46;
    if (t.t > 1.1) G.texts.splice(i, 1);
  }
  // save-moment ring pulses: expand and fade over 0.6s
  for (let i = G.pulses.length - 1; i >= 0; i--) {
    G.pulses[i].t += dt;
    if (G.pulses[i].t > 0.6) G.pulses.splice(i, 1);
  }
}
function addText(x, y, str, color, size = 44) {
  G.texts.push({ x, y, str, color, size, t: 0 });
  if (G.texts.length > 8) G.texts.shift();
}

// impact events - the layered hit stack.
// Tiers around the 650 hit-stop threshold: tap (<650), drive (650–1400),
// SMASH (>1400). Each tier buys more shake, a bigger flash, and a deeper
// pitch; SMASH also startles the room itself (see G.roomPulse).
function hitTier(impact) { return impact > 1400 ? 2 : impact > 650 ? 1 : 0; }
function onMalletHit(x, y, impact, nx, ny) {
  // rally bookkeeping first - the clack pitches up ~3% per hit so long
  // rallies audibly tighten (capped at +36%)
  let rallyN = 0;
  if (G.state === 'play' && !G.demo && G.stats) {
    G.stats.rally++;
    if (G.stats.rally > G.stats.bestRally) G.stats.bestRally = G.stats.rally;
    rallyN = G.stats.rally;
  }
  const v = clamp(impact / 2200, 0, 1);
  const tier = hitTier(impact);
  const fxp = fxParticles();
  // hit-stop: 1–2 frames, scaled - the brain reads it as weight
  if (tier >= 1) G.freezeT = Math.max(G.freezeT, Math.min(tier === 2 ? 0.045 : 0.032, 0.010 + v * 0.022));
  addTrauma(tier === 2 ? 0.55 + v * 0.45 : 0.18 + v * 0.5);
  if (tier === 2) {
    if (fxFlash()) {
      G.hitFlash = 0.8; G.hitFlashX = x; G.hitFlashY = y;
      // SMASH slow-mo beat: ~90ms at the dip scale right after the 45ms
      // hit-stop - the Holedown blend (freeze, then a near-halt beat, then
      // full speed). Rides the shared dipT channel with the near-miss dip
      // (Math.max: the two never stack or extend each other); play-state
      // only, so it can never touch the goal ceremony's reserved slow-mo.
      G.dipT = Math.max(G.dipT, 0.09);
    }
    if (fxRoom()) G.roomPulse = 1;
    buzz([15, 30, 25]);
  }
  // puck squash along the impact normal, 10–20%. Restarts the recovery
  // spring from rest at the deformed shape.
  G.puckSq = 1 - (0.10 + v * 0.10);
  G.puckSqA = Math.atan2(ny, nx);
  G.puckSqV = 0;
  burst(x, y, Math.max(1, Math.round((5 + v * 12) * fxp)), THEME.particle, 200 + v * 480);
  if (tier === 2) burst(x, y, Math.max(1, Math.round(10 * fxp)), '#ffffff', 500 + v * 500, 3);
  // permanence: hard hits leave a fading scuff on the cloth
  if (impact > 900 && G.scuffs.length < 48) {
    G.scuffs.push({ x, y, a: 0.20, ang: Math.atan2(ny, nx) + Math.PI / 2, len: 26 + v * 40 });
  }
  AudioSys.hit(v, 1 + Math.min(rallyN, 12) * 0.03);
  if (v > 0.55) buzz(12);
}
function onRailHit(x, y, impact, isPost, nx, ny) {
  const v = clamp(impact / 2200, 0, 1);
  // puck squash on rails and the goal frame, 8–20% along the impact normal -
  // shared with the mallet-hit squash. Keeps the deeper of overlapping
  // deformations and restarts the spring from the new shape.
  if (nx !== undefined) {
    G.puckSq = Math.min(G.puckSq, 1 - (0.08 + v * 0.12));
    G.puckSqA = Math.atan2(ny, nx);
    G.puckSqV = 0;
  }
  if (impact > 1100) { G.freezeT = Math.max(G.freezeT, 0.012); addTrauma(0.12 + v * 0.2); }
  if (impact > 300) burst(x, y, Math.max(1, Math.round((3 + v * 6) * fxParticles())), THEME.particle, 140 + v * 260, 2.5);
  if (isPost && impact > 900) {
    // the goal frame rattles: a hard frame hit earns a low clank and a
    // visible shake of the trim - deliberately heavier than the post ping
    AudioSys.clank(v);
    if (fxFlash()) G.rattle = { side: x < PX + PW / 2 ? 0 : 1, t: 0.42 };
    burst(x, y, Math.max(1, Math.round(10 * fxParticles())), '#ffffff', 380, 2.5);
  } else if (isPost && impact > 200) {
    // the goal frame rings - a distinct metallic ping plus a bright kiss
    AudioSys.ping();
    burst(x, y, Math.max(1, Math.round(8 * fxParticles())), '#ffffff', 320, 2.5);
  } else {
    AudioSys.rail(v);
  }
}

// ---------- state management ----------
// Ceremony flags (letterbox, flash, slow-mo) belong to the 'goal' state.
// Every exit path funnels through clearCeremony so a mid-ceremony quit,
// restart, or win can never leave GOAL! / slow-mo stuck on screen.
function clearCeremony() {
  G.letterT = 0; G.flashA = 0; G.goalT = 0; G.goalSlowT = 0;
  G.timeScale = 1;
}
// ---------- game flow ----------
function startGame(mode, diff) {
  AudioSys.init(); AudioSys.resume();
  G.mode = mode;
  // EXHIBITION: diff is {a, b} - independent difficulty for left/right AI.
  if (mode === 'watch') { G.watch = { a: diff.a, b: diff.b }; G.difficulty = diff.b; }
  else { G.watch = null; G.difficulty = diff == null ? G.difficulty : diff; }
  G.score = [0, 0]; G.winSide = 0;
  G.demo = false; G.idleT = 0; G.gwNet = 0; // local/host: goal width from Settings (guests get the host's via countdown)
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  G.scuffs.length = 0; G.texts.length = 0;
  resetPositions();
  if (mode === 'watch') {
    G.ai1 = mkBrain(0, G.watch.a);
    G.ai2 = mkBrain(1, G.watch.b);
  } else {
    G.ai2 = mkBrain(1, G.difficulty);
    G.ai1 = (mode === '2p') ? null : mkBrain(0, G.difficulty); // demo brain, unused in 1p
  }
  G.stats = freshStats(); G.stats.t0 = performance.now();
  pointers.clear();
  hideAll();
  $('menu').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  maybeShowHint();
  startCount();
  // first serve: face-off decides who gets the puck (random side), then roll
  // the serve flavor once so local and online both use the same point
  rollServe(Math.random() < 0.5 ? 1 : -1);
  // ONLINE: the host's countdown mirrors to the guest so both start even
  if (mode === 'online' && Net.role === 'host') Net.sendCountdown();
}
// First-time hint: one line on the first local match ("Drag to move your
// mallet"), dismissed forever after the first goal. Persisted in
// localStorage so it never returns. Online/demo never get the hint - it's a
// local-match affordance only, and netcode stays untouched.
const HINT_KEY = 'atelier-ah-hintseen';
function hintSeen() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; }
}
function maybeShowHint() {
  if ((G.mode !== 'ai' && G.mode !== '2p') || hintSeen()) { G.hintLive = false; return; }
  G.hintLive = true;
  $('hint').classList.remove('hidden');
}
function dismissHint(markSeen) {
  G.hintLive = false;
  $('hint').classList.add('hidden');
  if (markSeen) { try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {} }
}
function startCount() {
  G.state = 'count'; G.countT = 0; G.countN = 3; G.goPlayed = false;
  if (G.score[0] === 0 && G.score[1] === 0) MusicSys.setIntensity(0); // fresh match: the bed at rest
  MusicSys.alignBeat(); // both peers start the same phrase on the countdown downbeat
  G.puck.x = CX; G.puck.y = CY; G.puck.vx = 0; G.puck.vy = 0;
  G.trail.length = 0;
}
// Serve variety: the player who was scored on (or a random side on the first
// serve, per the face-off rule) strikes the puck from center. A real struck
// serve isn't the same shot every time, so roll a flavor:
//   banker  ~10%: shallow drive that kisses the side rail first
//   dink    ~12%: a slow teasing feed
//   wide    ~28%: driven through at a real angle, ±32°
//   drive   ~50%: the classic straight serve with a touch of wobble
// Rolled once per point and stored on G so host and guest play the identical
// serve - the host rolls, the guest receives (see Net.sendCountdown).
function rollServe(dir) {
  const sp = paceServe(), roll = Math.random();
  let ang, speed;
  if (roll < 0.10) {          // banker - kiss the side rail first
    ang = (60 + Math.random() * 16) * (Math.random() < 0.5 ? 1 : -1);
    speed = sp * (0.92 + Math.random() * 0.16);
  } else if (roll < 0.22) {   // dink - a slow teasing feed
    ang = (Math.random() - 0.5) * 50;
    speed = sp * (0.52 + Math.random() * 0.14);
  } else if (roll < 0.50) {   // wide angle
    ang = (Math.random() - 0.5) * 64;
    speed = sp * (0.90 + Math.random() * 0.20);
  } else {                    // straight drive with a little wobble
    ang = (Math.random() - 0.5) * 16;
    speed = sp * (0.95 + Math.random() * 0.22);
  }
  G.serveDir = dir;
  const a = ang * Math.PI / 180;
  G.serveVX = Math.cos(a) * speed * dir;
  G.serveVY = Math.sin(a) * speed;
}
function updateCount(rdt) {
  G.countT += rdt;
  const n = 3 - Math.floor(G.countT / 0.55);
  if (n !== G.countN && n >= 1) { G.countN = n; AudioSys.count(false); }
  if (G.countT >= 1.65 && !G.goPlayed) { G.goPlayed = true; AudioSys.count(true); }
  if (G.countT >= 2.0) {
    G.goPlayed = false;
    G.state = 'play';
    // serve the rolled point - the player who was scored on gets the puck
    // (USAA basic rules §4: "the player scored upon receives possession of
    // the puck for the next serve")
    G.puck.vx = G.serveVX; G.puck.vy = G.serveVY;
  }
}
function onGoal(scorer) {
  if (G.demo) { // attract mode: no ceremony, just play on
    burst(G.puck.x, G.puck.y, 24, THEME.particle, 420);
    AudioSys.hit(0.8);
    resetPositions();
    rollServe(Math.random() < 0.5 ? 1 : -1);
    G.puck.vx = G.serveVX; G.puck.vy = G.serveVY;
    return;
  }
  if (G.state !== 'play') return;
  // ONLINE: the host owns the simulation; a guest never scores locally.
  if (G.mode === 'online' && Net.role !== 'host') return;
  G.score[scorer]++; // the single place a goal changes the score
  // match-point lift: the music gains its pulse layer when someone is one away
  MusicSys.setIntensity(G.score[0] >= Settings.firstTo - 1 || G.score[1] >= Settings.firstTo - 1 ? 1 : 0);
  if (G.mode !== 'online' && G.stats) {
    // streaks + worst-deficit tracking for the v23 fun pass (host-owned in
    // online play would desync the guest's view, so guests never track)
    const st = G.stats;
    st.streak[scorer]++; st.streak[1 - scorer] = 0;
    if (st.streak[scorer] > st.bestStreak[scorer]) st.bestStreak[scorer] = st.streak[scorer];
    st.worstDef[0] = Math.min(st.worstDef[0], G.score[0] - G.score[1]);
    st.worstDef[1] = Math.min(st.worstDef[1], G.score[1] - G.score[0]);
  }
  if (G.hintLive) dismissHint(true); // first goal dismisses the hint forever
  beginGoalCeremony(scorer); // visuals only - never scores, never sends
  if (G.mode === 'online') Net.sendGoal(scorer); // ONLINE: tell the guest to play it
}
// ONLINE: start the goal ceremony visuals only - no scoring, no sending.
// The host scores first in onGoal; the guest's scores arrive final in the
// goal event. Splitting it this way makes double-counting impossible.
// Goal hierarchy: YOUR goals get the full treatment (confetti storm, frame
// flash, deeper chord); conceded goals are a smaller, dimmer affair.
function goalIsYours(scorer) {
  if (G.mode === '2p') return true; // both ends are players - both celebrate
  if (G.mode === 'online') return (Net.role === 'host') === (scorer === 0);
  return scorer === 0;
}
function confettiColors() {
  return [THEME.gold || '#d8a93f', THEME.particle, '#ffffff', THEME.ink].filter(Boolean);
}
// goal-streak announcements - the little combo rush that makes scoring feel
// addictive. Local matches only (online guests never own the sim, and the
// streak state isn't in the snapshot), gated on fxFlash() like the rest of
// the ceremony juice.
function announceStreak(scorer) {
  if (G.mode === 'online' || G.demo) return;
  const st = G.stats;
  if (!st || !goalIsYours(scorer) || !fxFlash()) return;
  const n = st.streak[scorer];
  if (n < 2) return;
  const label = n === 2 ? 'TWO IN A ROW'
    : n === 3 ? 'HAT-TRICK!'
    : n + ' IN A ROW: UNSTOPPABLE!';
  addText(CX, CY - 200, label, THEME.gold || '#d8a93f', 56);
}
function beginGoalCeremony(scorer) {
  boardKick(scorer);
  G.goalSide = scorer;
  if (G.stats) G.stats.rally = 0; // new rally after each goal
  G.state = 'goal';
  G.goalT = 0; G.goalSlowT = 0; G.letterT = 0;
  G.timeScale = 0.22; // the reserved channel: slow-mo belongs to goals
  const yours = goalIsYours(scorer);
  G.flashA = yours ? 1 : 0.65;
  G.goalFrameT = yours ? 1 : 0.5;
  $('topbar').classList.add('hidden'); // ceremony is cinematic - no mis-taps
  const gx = scorer === 0 ? PX + PW : PX;
  const fxp = fxParticles();
  burst(gx, CY, Math.max(4, Math.round(46 * fxp)), THEME.particle, 620, 4.5);
  burst(gx, CY, Math.max(2, Math.round(20 * fxp)), '#ffffff', 380, 3);
  if (!PRM.reduce) {
    // theme-colored confetti storm - bigger when YOU score
    const cols = confettiColors();
    const n = Math.round((yours ? 90 : 36) * fxp);
    for (let c = 0; c < 3; c++) burst(gx, CY, Math.max(1, Math.round(n / 3)), cols[c % cols.length], 380 + c * 160, 4 + c);
  }
  addTrauma(0.85);
  addText(gx + (scorer === 0 ? -130 : 130), CY - 120, '+1', THEME.gold || '#d8a93f', 52);
  announceStreak(scorer); // TWO IN A ROW / HAT-TRICK / N IN A ROW - UNSTOPPABLE!
  AudioSys.goalChord(THEME.goalChord || [523.25, 659.25, 783.99, 1046.5]);
  MusicSys.goalSwell(); // soft lift while the bed ducks under the ceremony
  buzz([25, 40, 40]);
}
function updateGoal(rdt) {
  G.goalT += rdt; G.goalSlowT += rdt;
  G.letterT = clamp(G.letterT + rdt * 3.2, 0, 1);
  G.flashA = Math.max(0, G.flashA - rdt * 2.4);
  G.goalFrameT = Math.max(0, G.goalFrameT - rdt * 1.8);
  if (G.goalSlowT > 1.0) G.timeScale = lerp(G.timeScale, 1, clamp(rdt * 5, 0, 1));
  // ease the puck into the net
  const p = G.puck;
  const gx = G.goalSide === 0 ? PX + PW + 70 : PX - 70;
  p.x = lerp(p.x, gx, clamp(rdt * 5, 0, 1));
  p.y = lerp(p.y, CY, clamp(rdt * 5, 0, 1));
  p.vx *= 0.9; p.vy *= 0.9;
  // the winning goal gets ~30% more ceremony
  const matchPoint = G.score[G.goalSide] >= Settings.firstTo;
  if (G.goalT > (matchPoint ? 2.86 : 2.2)) {
    clearCeremony();
    if (G.score[0] >= Settings.firstTo || G.score[1] >= Settings.firstTo) {
      G.winSide = G.score[0] > G.score[1] ? 0 : 1;
      G.state = 'win';
      showWin();
    } else {
      resetPositions();
      rollServe(G.goalSide === 0 ? 1 : -1); // scored-on player gets the puck
      $('topbar').classList.remove('hidden');
      startCount();
      // ONLINE: the host's countdown mirrors to the guest so both start even
      if (G.mode === 'online' && Net.role === 'host') Net.sendCountdown();
    }
  }
}
function showWin() {
  clearCeremony(); // defensive: no ceremony visuals leak under the overlay
  MusicSys.setIntensity(0); // the room exhales - bed back to rest
  $('topbar').classList.add('hidden');
  const you = G.winSide === 0;
  // local rival record - AI rivals per difficulty, P1/P2 for same-screen 2P
  // (online matches are session-only: no stored record)
  if (G.mode === 'ai') Record.bump('ai' + G.difficulty, G.winSide === 0);
  else if (G.mode === '2p') { Record.bump('p1', G.winSide === 0); Record.bump('p2', G.winSide === 1); }
  $('winTitle').textContent = G.mode === '2p'
    ? (you ? 'Player One wins' : 'Player Two wins')
    : G.mode === 'online' // ONLINE: labels by role, not by side
    ? (onlineSideLabel(G.winSide) === 'YOU' ? 'You win' : 'Rival wins')
    : G.mode === 'watch' // EXHIBITION: name the winning AI
    ? DIFFS[G.watch[G.winSide === 0 ? 'a' : 'b']].name + ' wins'
    : (you ? 'You win' : DIFFS[G.difficulty].name + ' wins');
  $('winSub').textContent = G.score[0] + ':' + G.score[1];
  // match stats: top puck speed (table-scale km/h), longest rally, saves
  // per side (same side order as the score), and match duration. Two lines
  // so the line never overflows a phone card; innerHTML is safe here -
  // every value is numeric.
  const st = G.stats || freshStats();
  const kmh = st.topSpeed * (2.4384 / PW) * 3.6; // 8ft table mapping
  const secs = Math.max(1, Math.round((performance.now() - st.t0) / 1000));
  try {
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    const sv = st.saves || [0, 0];
    $('winStats').innerHTML = 'Top puck ' + Math.round(kmh) + ' km/h · Longest rally ' + st.bestRally +
      '<br>Saves ' + sv[0] + '–' + sv[1] + ' · ' + mm + ':' + ss;
    // v23 fun pass - personal bests, achievements, table tour. Local matches
    // only: online stays session-only (no stored records, no feats, and the
    // guest's snapshot is display-only).
    if (G.mode === 'ai' || G.mode === '2p') {
      const feats = $('winFeats');
      if (G.mode === '2p' || G.winSide === 0) { // records + feats belong to a human winner
        const margin = Math.abs(G.score[0] - G.score[1]);
        const recs = checkBest(G.mode === 'ai' ? 'ai' + G.difficulty : 'p2p',
          secs, Math.round(kmh), st.bestRally || 0, margin);
        if (recs.length) $('winStats').innerHTML += '<br>★ New record: ' + recs.join(' · ');
        const fresh = [];
        if (G.score[1 - G.winSide] === 0 && Feats.unlock('shutout')) fresh.push('SHUTOUT');
        if ((st.worstDef || [0, 0])[G.winSide] <= -3 && Feats.unlock('comeback')) fresh.push('COMEBACK');
        if (((st.bestStreak || [0, 0])[G.winSide] || 0) >= 3 && Feats.unlock('hattrick')) fresh.push('HAT-TRICK');
        if (Math.round(kmh) >= 60 && Feats.unlock('speedster')) fresh.push('SPEEDSTER');
        Tour.bump(G.themeId);
        if (Tour.count() >= THEME_ORDER.length && Feats.unlock('grandtour')) fresh.push('GRAND TOUR');
        feats.textContent = fresh.length ? '🏆 UNLOCKED: ' + fresh.join(' · ') : '';
      } else {
        feats.textContent = '';
      }
    } else {
      $('winFeats').textContent = '';
    }
  } catch (e) {}
  hideAll(); $('winov').classList.remove('hidden');
  G.hintLive = false; // match over - the hint never survives a match end
  AudioSys.goalChord([392, 523.25, 659.25, 783.99, 1046.5]);
  // slow theme-colored confetti rain over the win card (DOM - the card
  // is a positioned container; pieces clean themselves up)
  if (!PRM.reduce && Settings.effects !== 'minimal') {
    const card = $('winov').querySelector('.card');
    const cols = confettiColors();
    const n = Settings.effects === 'subtle' ? 22 : 46;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'confetti';
      s.style.left = rnd(2, 96) + '%';
      s.style.background = cols[i % cols.length];
      s.style.animationDuration = rnd(1.8, 3.4) + 's';
      s.style.animationDelay = rnd(0, 0.9) + 's';
      s.style.width = rnd(6, 10) + 'px';
      card.appendChild(s);
      setTimeout(() => s.remove(), 4600);
    }
  }
}
function togglePause(force, silent) {
  // ONLINE: silent=true applies a pause that arrived over the wire - it must
  // not echo back, or the two clients would ping-pong pause events forever.
  // Pausing is allowed from 'goal' too: the ceremony is cleared so a frozen
  // GOAL! banner / slow-mo can't sit under the pause card, and resume replays
  // the ceremony from its start (goalT=0) rather than a stale timeScale.
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') {
    G.pausedFrom = G.state;
    if (G.state === 'goal') clearCeremony();
    G.state = 'pause';
    hideAll(); $('pauseov').classList.remove('hidden');
    AudioSys.ui();
    if (G.mode === 'online' && !silent) Net.sendPause(true);
  } else if (G.state === 'pause' && force !== true) {
    G.state = G.pausedFrom;
    hideAll();
    if (G.state === 'play' || G.state === 'count' || G.state === 'goal') $('topbar').classList.remove('hidden');
    if (G.hintLive) $('hint').classList.remove('hidden'); // hint survives pause/resume
    if (!silent) {
      // a local resume is always a user gesture, so the context may restart
      AudioSys.resume();
      G.focusLost = false;
    } else if (G.focusLost) {
      // the rival resumed while our tab is still away: stay frozen behind
      // the tap-to-resume veil instead of silently coming back to life
      $('focusov').classList.remove('hidden');
    }
    if (G.mode === 'online' && !silent) Net.sendPause(false);
  }
}
// ---------- focus-loss pause ----------
// visibilitychange -> hidden and window blur both land here (wired in ui.js).
// Everything freezes: the sim, the attract demo, particles, and the net pump
// all hold via the frame() guard; the AudioContext suspends so music, SFX,
// and ambience stop at once. Mid-match this also takes the regular pause path
// (pause card + pause event to the rival, so an online rival pauses too
// instead of drifting on a stale sim). Anywhere else a lightweight
// tap-to-resume veil covers the screen without disturbing the state below.
// Audio never auto-resumes: the veil (or the pause card's Resume button)
// only clears on a real user gesture, which is what the autoplay policy
// needs for ctx.resume() to take effect.
function pauseForFocusLoss() {
  if (G.focusLost) return;
  G.focusLost = true;
  AudioSys.suspend();
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
  // the pause card is already a tap-to-resume surface; only veil when it
  // isn't up (menus, win card, an already-manual pause, confirm dialogs)
  if ($('pauseov').classList.contains('hidden')) $('focusov').classList.remove('hidden');
}
function resumeFromFocusLoss() { // the veil's tap handler - a user gesture
  if (!G.focusLost) return;
  AudioSys.resume();
  G.focusLost = false;
  $('focusov').classList.add('hidden');
}
// Restart the current match from the pause menu.
// LOCAL (ai/2p): immediate - startGame resets score, board, stats, and counts
// down. ONLINE: host authority - the host restarts directly (the countdown
// event pulls the guest along via Net.onCountdown); the guest sends a
// restart request and the host performs it, so both sides stay in sync.
// Never changes net snapshot/input behavior - restart flows through the
// existing countdown handshake.
function restartMatch() {
  AudioSys.ui();
  if (G.mode === 'online') {
    if (Net.role === 'host') Net.restartMatchAsHost();
    else if (Net.wire) Net.wire.sendEv({ t: 'restart-req' });
    return;
  }
  if (G.mode === 'watch') startGame('watch', G.watch); // EXHIBITION: preserve the AI matchup
  else startGame(G.mode, G.difficulty);
}
function quitToMenu() {
  if (G.mode === 'online') Net.leave(); // ONLINE: leave the room first - leave() resets mode
  G.state = 'menu'; G.idleT = 0; G.demo = false; G.gwNet = 0; // drop any guest goal-width override
  G.watch = null; // EXHIBITION: clear the AI matchup on quit
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  pointers.clear();
  resetPositions();
  hideAll(); $('menu').classList.remove('hidden');
  $('topbar').classList.add('hidden');
  G.hintLive = false; // match over - the hint never survives a match end
  refreshRecordLines(); // menu record lines reflect the just-finished match
  refreshTour(); // tour counter + conquered pips reflect the just-finished match
  AudioSys.ui();
}
function hideAll() {
  // ONLINE: online overlays are part of the overlay stack too
  for (const id of ['menu', 'progress', 'help', 'settings', 'pauseov', 'winov', 'onlineov', 'onlinedropov', 'confirmov', 'hint']) $(id).classList.add('hidden');
}
function $(id) { return document.getElementById(id); }

// demo / attract mode: two club-pro brains rally behind the menu
function demoStep(rdt) {
  if (!G.ai1 || !G.ai2) { G.ai1 = mkBrain(0, 1); G.ai2 = mkBrain(1, 1); }
  const sub = 3, sdt = rdt / sub;
  for (let i = 0; i < sub; i++) {
    aiDrive(G.ai1, sdt, G.m1);
    aiDrive(G.ai2, sdt, G.m2);
    stepPhysics(sdt);
    if (G.state !== 'menu') break;
  }
}
function playStep(rdt) {
  const sub = Math.max(1, Math.ceil(rdt / (1 / SUB_HZ)));
  const sdt = rdt / sub;
  for (let i = 0; i < sub; i++) {
    // player mallets
    if (G.mode === '2p') {
      driveMallet(G.m1, sdt, PLAYER_CAP);
      driveMallet(G.m2, sdt, PLAYER_CAP);
    } else if (G.mode === 'online') {
      // ONLINE: host-only branch - the guest never reaches playStep (see
      // frame). The host drives m1; m2 follows the guest's input target over
      // the wire - without this the remote mallet is a statue on the
      // authoritative sim and the guest can never touch the puck.
      driveMallet(G.m1, sdt, PLAYER_CAP);
      Net.driveRemoteMallet(sdt);
    } else if (G.mode === 'watch') {
      // EXHIBITION: both mallets are AI-driven.
      aiDrive(G.ai1, sdt, G.m1);
      aiDrive(G.ai2, sdt, G.m2);
    } else {
      // 1p: keyboard/gamepad also drive through tx/ty, so only pin the target
      // to the current position when no input source is active. Pinning
      // unconditionally wipes keyboard/gamepad targets every substep and
      // makes keys appear dead unless a pointer is also down.
      const kbFresh = performance.now() - (G.kbDriveT || 0) < 120;
      if (pointers.size > 0 || kbFresh) driveMallet(G.m1, sdt, PLAYER_CAP);
      else { G.m1.tx = G.m1.x; G.m1.ty = G.m1.y; driveMallet(G.m1, sdt, PLAYER_CAP); }
      aiDrive(G.ai2, sdt, G.m2);
    }
    stepPhysics(sdt);
    if (G.state !== 'play') break;
  }
}

let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  // focus-loss freeze: sim, demo, particles, and the net pump all hold; the
  // frozen frame keeps rendering under the veil. lastT keeps updating so
  // resume can't time-jump.
  if (G.focusLost) { render(); return; }
  if (G.freezeT > 0) { G.freezeT -= rdt; render(); return; } // hit-stop
  G.trauma = Math.max(0, G.trauma - rdt * 1.7);
  // juice timers decay every frame, whatever the state
  G.hitFlash = Math.max(0, G.hitFlash - rdt * 3);
  G.roomPulse = Math.max(0, G.roomPulse - rdt * 1.4);
  G.saveT = Math.max(0, G.saveT - rdt);
  G.nearCd = Math.max(0, G.nearCd - rdt);
  G.dipT = Math.max(0, G.dipT - rdt);
  if (G.missGlow) { G.missGlow.t -= rdt; if (G.missGlow.t <= 0) G.missGlow = null; }
  if (G.rattle) { G.rattle.t -= rdt; if (G.rattle.t <= 0) G.rattle = null; }
  tickBoard(rdt); // scoreboard flip/reel/peg/bulb animation
  switch (G.state) {
    case 'menu':
      // ONLINE: no attract demo while the online lobby is up - mode is
      // 'online' from the moment the lobby opens until the session ends.
      G.idleT += rdt; G.demo = G.idleT > 5 && G.mode !== 'online';
      if (G.demo) {
        if (!G._demoKick) { // serve the demo so the attract screen actually rallies
          G._demoKick = true;
          G.puck.vx = paceServe() * (Math.random() < 0.5 ? 1 : -1); G.puck.vy = rnd(-200, 200);
        }
        demoStep(rdt);
        stallWatch(rdt);
      } else { G._demoKick = false; G.stallT = 0; }
      updateParts(rdt);
      break;
    case 'count':
      updateCount(rdt);
      if (G.mode === '2p') { driveMallet(G.m1, rdt, PLAYER_CAP); driveMallet(G.m2, rdt, PLAYER_CAP); }
      // ONLINE: each side drives only their own mallet during the countdown;
      // the host also folds the guest's input target into m2 so it never
      // snaps when the serve goes live
      else if (G.mode === 'online') {
        if (Net.role === 'host') { driveMallet(G.m1, rdt, PLAYER_CAP); Net.driveRemoteMallet(rdt); }
        else driveMallet(G.m2, rdt, PLAYER_CAP);
      }
      // EXHIBITION / SINGLE-PLAYER: AI mallets hold their reset spots during
      // the countdown - no perceiving, no thinking, no skating. (v24.2: the
      // old code ran aiDrive here, so the AI would drift, pre-aim, and even
      // start its attack decision before the puck was live.)
      else if (G.mode === 'watch') { /* both AI mallets hold */ }
      else { if (pointers.size > 0) driveMallet(G.m1, rdt, PLAYER_CAP); }
      updateParts(rdt);
      break;
    case 'play':
      // ONLINE: the guest does not simulate - the host owns the physics.
      // The guest only drives their own mallet; puck and rival mallet arrive
      // over the wire (dead-reckoned in Net.pump).
      // Near-miss dip: the reserved channel is goals' slow-mo, but a 0.22s
      // 0.55x dip on a post kiss - and the ~90ms SMASH slow-mo beat on
      // SMASH-tier mallet hits - are smaller beats that share this channel
      // (Math.max, never stacking). Never overlaps the ceremony (state
      // leaves 'play' first).
      if (G.mode === 'online' && Net.role === 'guest') driveMallet(G.m2, rdt, PLAYER_CAP);
      else playStep(rdt * G.timeScale * (G.dipT > 0 ? 0.55 : 1));
      updateParts(rdt);
      break;
    case 'goal':
      updateGoal(rdt);
      updateParts(rdt);
      break;
    case 'win':
    case 'pause':
      updateParts(rdt * 0.25);
      break;
  }
  Net.pump(rdt); // ONLINE: snapshots out (host), inputs out (guest), dead reckoning
  render();
}

// ---------- render ----------
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function easeOutBack(t) { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

/* ---------- the house plaque ----------
 * One visual language for every canvas announcement: a dark warm pill with a
 * gold hairline and letterspaced small caps. Theme-agnostic by design, so it
 * reads identically on all ten rooms, light or dark. Match-point and the
 * rally counter share one slot through this renderer - only one ever draws. */
function drawPlaque(ctx, cx, y, text, opts) {
  opts = opts || {};
  const size = opts.size || 12;
  const track = opts.track == null ? 2 : opts.track;
  const ph = opts.h || 26;
  ctx.save();
  ctx.font = '600 ' + size + 'px ' + THEME.font.body;
  if ('letterSpacing' in ctx) ctx.letterSpacing = track + 'px';
  const tw = ctx.measureText(text).width + (('letterSpacing' in ctx) ? 0 : track * text.length * 0.6);
  const pw = tw + 34;
  const px = cx - pw / 2, py = y - ph / 2;
  ctx.globalAlpha = opts.alpha || 0.94;
  rr(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = 'rgba(12,9,6,0.86)'; ctx.fill();
  ctx.strokeStyle = THEME.gold || '#c9a227'; ctx.lineWidth = 1.25; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.ink || THEME.gold || '#e9d9a6';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx + track / 2, y + 1);
  ctx.restore();
}

// The flat playfield: table, rails, surface, markings and every effect that
// lives ON the surface (scuffs, trails, flashes, particles). Drawn with an
// affine rink transform - the top-down view draws it straight to the main
// canvas; the 2.5D views stage it on the offscreen canvas and warp it.
function drawTableStaticFlat(c) {
  // table shadow + rails + surface
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 46; c.shadowOffsetY = 22;
  c.fillStyle = '#000';
  rr(c, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); c.fill();
  c.restore();
  THEME.drawRails(c);
  THEME.drawSurface(c);
  THEME.drawMarkings(c);
}

function drawTableFlat(c) {
  drawTableStaticFlat(c);

  // scuffs (permanence)
  for (const sc of G.scuffs) {
    c.save(); c.translate(sc.x, sc.y); c.rotate(sc.ang);
    c.fillStyle = 'rgba(10,8,6,' + sc.a.toFixed(3) + ')';
    c.fillRect(-sc.len / 2, -1.6, sc.len, 3.2);
    c.restore();
  }

  // puck trail
  const tr = G.trail;
  if (tr.length > 1) {
    c.save(); c.lineCap = 'round';
    // neon tables set trailGlow: the streak blooms like a light tube
    if (THEME.trailGlow) { c.shadowColor = THEME.trailGlow; c.shadowBlur = 14; }
    for (let i = 1; i < tr.length; i++) {
      const a = (i / tr.length) * 0.35;
      c.strokeStyle = THEME.trail;
      c.globalAlpha = a;
      c.lineWidth = 2 + (i / tr.length) * 8;
      c.beginPath(); c.moveTo(tr[i - 1].x, tr[i - 1].y); c.lineTo(tr[i].x, tr[i].y); c.stroke();
    }
    c.restore();
  }

  // speed lines: above 1500 the trail alone undersells it - theme-colored
  // streaks stretch back along the velocity vector
  const psp = puckSpeed();
  if (psp > 1500 && Settings.effects !== 'minimal') {
    const nsl = Settings.effects === 'subtle' ? 3 : Math.min(5, 1 + Math.floor((psp - 1500) / 400));
    const va = Math.atan2(G.puck.vy, G.puck.vx);
    const cvx = Math.cos(va), svx = Math.sin(va);
    c.save(); c.lineCap = 'round'; c.strokeStyle = THEME.trail;
    for (let i = 0; i < nsl; i++) {
      const off = (i - (nsl - 1) / 2) * 14;
      const ox = -svx * off, oy = cvx * off;
      const len = psp * (0.05 + i * 0.012);
      c.globalAlpha = Math.max(0.06, 0.28 - i * 0.04);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(G.puck.x - cvx * (PUCK_R + 6) + ox, G.puck.y - svx * (PUCK_R + 6) + oy);
      c.lineTo(G.puck.x - cvx * (PUCK_R + 6 + len) + ox, G.puck.y - svx * (PUCK_R + 6 + len) + oy);
      c.stroke();
    }
    c.restore();
  }

  // goal-frame rattle: a hard frame hit visibly shakes the trim for ~0.4s
  // (fxFlash() gates it for Minimal effects + prefers-reduced-motion; the
  // jitter itself scales with the Shake setting, like trauma shake)
  for (let side = 0; side < 2; side++) {
    const gx = side === 0 ? PX : PX + PW;
    let ox = 0, oy = 0;
    if (G.rattle && G.rattle.side === side && fxFlash()) {
      const j = 4.5 * (G.rattle.t / 0.42) * shakeK();
      ox = rnd(-1, 1) * j; oy = rnd(-1, 1) * j;
    }
    c.save(); c.translate(ox, oy);
    THEME.drawGoalTrim(c, side, gx, CY, goalW());
    c.restore();
  }

  // goal-frame flash: the scored-on frame lights up in theme gold
  if (G.goalFrameT > 0 && fxFlash()) {
    const fgx = G.goalSide === 0 ? PX + PW : PX;
    c.save();
    c.globalAlpha = G.goalFrameT * 0.9;
    c.strokeStyle = THEME.gold || '#d8a93f'; c.lineWidth = 5;
    rr(c, fgx - 16, CY - goalW() / 2 - 16, 32, goalW() + 32, 16); c.stroke();
    c.restore();
  }
  // near-miss post glow: the kissed posts smolder briefly
  if (G.missGlow && fxFlash()) {
    const mgx = G.missGlow.side === 0 ? PX : PX + PW;
    c.save();
    c.globalAlpha = clamp(G.missGlow.t / 0.7, 0, 1) * 0.8;
    c.fillStyle = THEME.gold || '#d8a93f';
    for (const sgn of [-1, 1]) {
      c.beginPath(); c.arc(mgx, CY + sgn * goalW() / 2, 10, 0, TAU); c.fill();
    }
    c.restore();
  }
}

// Surface-bound motion FX: mallet trails, possession ring, particle streaks,
// save pulses, impact flash. Stays with the table in every camera.
function drawFxFlat(c) {
  // mallet motion trails on fast flicks (recorded in driveMallet)
  for (const m of [G.m1, G.m2]) {
    const tr = m.trail;
    for (let i = 0; i < tr.length; i++) {
      const a = (i / tr.length) * 0.30 * fxTrail();
      if (a <= 0.01) continue;
      c.save(); c.globalAlpha = a; c.fillStyle = THEME.trail;
      c.beginPath(); c.arc(tr[i].x, tr[i].y, m.r * (0.35 + 0.55 * i / tr.length), 0, TAU); c.fill();
      c.restore();
    }
    // possession readability: sustained gentle contact (>0.4s) draws a soft
    // ring under the puck - it reads as control, never as a stuck puck
    if (m.glueT > 0.4) {
      const pr = PUCK_R + 12 + Math.sin(perfNow() * 6) * 3;
      c.save(); c.globalAlpha = 0.55; c.strokeStyle = THEME.gold || '#d8a93f';
      c.lineWidth = 3;
      c.beginPath(); c.arc(G.puck.x, G.puck.y, pr, 0, TAU); c.stroke();
      c.restore();
    }
  }

  // particles as motion streaks
  c.save(); c.lineCap = 'round';
  for (const q of PPOOL) {
    if (!q.on) continue;
    const a = clamp(q.life / q.max, 0, 1);
    c.globalAlpha = a;
    c.strokeStyle = q.color;
    c.lineWidth = q.size * a + 0.5;
    c.beginPath();
    c.moveTo(q.x, q.y);
    c.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
    c.stroke();
  }
  c.restore();

  // save-moment ring pulses: a soft expanding ring where the block happened
  for (const q of G.pulses) {
    const k = q.t / 0.6;
    c.save();
    c.globalAlpha = (1 - k) * 0.7;
    c.strokeStyle = THEME.gold || '#d8a93f';
    c.lineWidth = 4 * (1 - k) + 1;
    c.beginPath(); c.arc(q.x, q.y, 30 + k * 90, 0, TAU); c.stroke();
    c.restore();
  }

  // goal flash
  if (G.flashA > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const g = c.createRadialGradient(gx, CY, 10, gx, CY, 420);
    const fc = THEME.flash || 'rgba(216,169,63,1)';
    g.addColorStop(0, fc); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.globalAlpha = G.flashA * 0.55; c.fillStyle = g;
    c.fillRect(gx - 430, CY - 430, 860, 860);
    c.restore();
  }

  // SMASH-tier impact flash: a hard white-gold pop exactly where it landed
  if (G.hitFlash > 0 && fxFlash()) {
    const hg = c.createRadialGradient(G.hitFlashX, G.hitFlashY, 8, G.hitFlashX, G.hitFlashY, 260);
    hg.addColorStop(0, 'rgba(255,255,255,' + (0.55 * G.hitFlash).toFixed(3) + ')');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.fillStyle = hg;
    c.fillRect(G.hitFlashX - 270, G.hitFlashY - 270, 540, 540);
    c.restore();
  }
}

// Floating score texts in flat rink space (top-down only). The 2.5D views
// project these to screen space instead so the type stays readable.
function drawTextsFlat(c) {
  // floating texts (positions flip with the playfield; glyphs stay upright).
  // Two passes: a dark blurred backing for separation on the lightest rooms,
  // then the crisp color face on top - the gold stays gold, no muddy outline.
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    c.font = '800 ' + t.size + 'px ' + THEME.font.display;
    c.fillStyle = 'rgba(15,10,5,0.85)';
    c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 12;
    rinkText(c, t.str, t.x, t.y); // ONLINE: upright type in the mirrored view
    c.shadowBlur = 0;
    c.fillStyle = t.color;
    rinkText(c, t.str, t.x, t.y);
    c.restore();
  }
}

function render() {
  const dpr = view.dpr || 1, w = view.w, h = view.h, s = view.s;
  // the room: pre-rendered on theme change / resize - one drawImage, no shake
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (G.roomCanvas) ctx.drawImage(G.roomCanvas, 0, 0, w, h);
  else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  // room reactivity: a SMASH startles the room - a warm lamp-glow swells and
  // sways gently overhead, always in the theme's own gold
  if (G.roomPulse > 0.01 && fxRoom()) {
    const lx = w / 2 + Math.sin(perfNow() * 2.1) * w * 0.06 * G.roomPulse;
    const rg = ctx.createRadialGradient(lx, h * 0.04, 10, lx, h * 0.04, h * 0.55);
    rg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.20 * G.roomPulse));
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  // Camera branch: top-down keeps the classic affine rink transform; the
  // 2.5D views stage the flat playfield offscreen and warp it through the
  // fitted pinhole camera. Physics, AI and netcode never see the difference.
  if (view.camera !== 'top' && view.cam) render25(w, h);
  else renderTop(w, h);
}

// Classic top-down view: the affine rink transform, byte-identical to the
// pre-2.5D render path.
function renderTop(w, h) {
  const s = view.s;
  // trauma shake: slight rotation + translation (rotation reads as force)
  const sh = shakeOffset();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (!view.portrait) { ctx.translate(view.ox, view.oy); ctx.scale(s, s); }
  // portrait: a TRUE 90° rotation (determinant +s²). The previous matrix
  // (0,-s,-s,0) had determinant -s² - a reflection that mirror-reversed
  // every world-space glyph (scoreboard, countdown, GOAL!, floating text).
  // P1's goal stays at the bottom of the screen, as before.
  else ctx.transform(0, -s, s, 0, view.ox, view.oy + s * VW);
  // goal zoom: ease toward the mouth during the ceremony (playfield only)
  ctx.save();
  if (G.letterT > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const z = 1 + 0.10 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.translate(gx, CY); ctx.scale(z, z); ctx.translate(-gx, -CY);
  }
  // ONLINE: the guest plays from their own side, so the playfield mirrors -
  // their mallet and goal sit where the host's do. Everything above the
  // playfield (scoreboard, ceremony type, ribbon) stays unflipped.
  ctx.save();
  if (G.onlineFlip) { ctx.translate(VW, 0); ctx.scale(-1, 1); }
  drawTableFlat(ctx);
  drawPuck(ctx);
  drawMallet(ctx, G.m1);
  drawMallet(ctx, G.m2);
  drawFxFlat(ctx);
  drawTextsFlat(ctx);
  ctx.restore(); // ONLINE flip

  // countdown - anticipation with a pop
  if (G.state === 'count') {
    const frac = (G.countT % 0.55) / 0.55;
    const label = G.countT < 1.65 ? String(3 - Math.floor(G.countT / 0.55)) : 'GO!';
    const pop = 1 + (1 - frac) * 0.55;
    ctx.save();
    ctx.globalAlpha = clamp(1.4 - frac, 0, 1);
    ctx.translate(CX, CY - 40); ctx.scale(pop, pop);
    ctx.font = '800 120px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.ink;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24;
    ctx.fillText(label, 0, 0); // screen space - never flipped
    ctx.restore();
  }
  ctx.restore();
  renderTail(w, h);
}

// Screen-space tail shared by every camera: letterbox GOAL ceremony,
// scoreboard, rally and match-point chips, vignette, menu dim.
function renderTail(w, h) {
  // letterbox + GOAL! - the reserved channel (stable screen space, above the zoom).
  // Under reduced motion the banner arrives without the spring (bars fade in
  // instead of sliding, GOAL! appears at rest size).
  if (G.letterT > 0) {
    const be = PRM.reduce ? 1 : easeOutBack(clamp(G.letterT, 0, 1));
    const bh = 120 * be;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, VW, bh); ctx.fillRect(0, VH - bh, VW, bh);
    ctx.globalAlpha = clamp((G.letterT - 0.25) * 2.4, 0, 1);
    const zp = PRM.reduce ? 1 : easeOutBack(clamp((G.letterT - 0.2) * 1.6, 0, 1));
    ctx.translate(CX, CY); ctx.scale(zp, zp);
    ctx.font = '800 92px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.gold || '#d8a93f';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 30;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
    ctx.fillText('GOAL!', 3, -6); // screen space - never flipped (+3 recenters the tracked type)
    ctx.restore();
  }

  drawScoreboard(ctx);

  // rally counter: consecutive hits without a goal - shown once it matters.
  // It lives in the top-left margin as its own pill chip, OUTSIDE the
  // scoreboard band: every scoreboard device is centered (~CX±200) and draws
  // labels/plates at its own y, so the old centered slot collided with them
  // (seen on reels/deco once rally >= 4). The margin slot can never collide
  // on any theme, device, orientation, or rally count - the pill sizes
  // itself to the text. Rendered through the shared plaque language so the
  // room speaks with one visual voice.
  if ((G.state === 'play' || G.state === 'count') && !G.demo && G.stats && G.stats.rally >= 4) {
    drawPlaque(ctx, 150, 71, 'RALLY ×' + G.stats.rally);
  }

  // match-point ribbon - theme-agnostic plaque under the scoreboard. It
  // cannot collide with the rally chip (the chip lives in the left margin).
  // Labels via sideLabel so exhibition names both AIs instead of "YOU".
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const t = Settings.firstTo;
    const m0 = G.score[0] === t - 1, m1 = G.score[1] === t - 1;
    if (m0 || m1) {
      const who = (m0 && m1) ? 'NEXT GOAL WINS'
        : G.mode === '2p' ? ((m0 ? 'PLAYER ONE' : 'PLAYER TWO') + ': MATCH POINT')
        : G.mode === 'online' ? ((m0 ? onlineSideLabel(0) : onlineSideLabel(1)) + ': MATCH POINT') // ONLINE
        : (sideLabel(m0 ? 0 : 1) + ': MATCH POINT'); // ai + watch (exhibition names the AI)
      drawPlaque(ctx, CX, 78, who);
    }
  }

  // vignette
  const vg = ctx.createRadialGradient(CX, CY, VH * 0.42, CX, CY, VH * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, THEME.vignette || 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);

  // dim the attract game behind the menu
  if (G.state === 'menu') {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, VW, VH);
  }
}

// ---------- 2.5D view ----------
// The playfield is staged flat on the offscreen canvas (affine only, so all
// ten themes render untouched), then warped through the fitted pinhole
// camera strip by strip. Objects with real height - puck, mallet handles,
// the table body - are drawn in true perspective on top, far to near.
function render25(w, h) {
  const cam = view.cam;
  if (!cam) { renderTop(w, h); return; } // fitted camera missing: safe fallback
  // The table (surface, rails, markings, skirt) is pre-warped once per camera
  // fit into warpCanvas - one drawImage per frame. Only the dynamic FX, puck
  // and mallets are drawn per frame, in true perspective.
  if (!warpCanvas) paintTableWarp();
  // trauma shake in screen space - same language as the top-down view,
  // applied to the whole scene at once
  const sh = shakeOffset();
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (warpCanvas) ctx.drawImage(warpCanvas, 0, 0, w, h);
  drawDynTable25(cam);
  drawFx25(cam);
  drawObjects25(cam);
  drawTexts25(cam);
  drawCountdown25(cam);
  ctx.restore();
  renderTail(w, h);
}

// The table gets a real body: near and side faces extruded below the surface
// so the tabletop reads as a physical object, not a projected poster.
// Baked into the pre-warped table canvas (static per camera fit).
function drawTableSkirt25(g, cam) {
  const T = 46; // body thickness in rink units
  const quad = (pts, fill) => {
    const q = pts.map(([x, y, z]) => camProject(cam, x, y, z));
    if (q.some(p => !p)) return;
    g.beginPath();
    g.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i].x, q[i].y);
    g.closePath();
    g.fillStyle = fill; g.fill();
  };
  // side faces first (darker), near face last (catches the room light)
  quad([[TX0, TY0, 0], [TX1, TY0, 0], [TX1, TY0, -T], [TX0, TY0, -T]], '#0a0a0d');
  quad([[TX0, TY1, 0], [TX1, TY1, 0], [TX1, TY1, -T], [TX0, TY1, -T]], '#0a0a0d');
  quad([[TX0, TY0, 0], [TX0, TY1, 0], [TX0, TY1, -T], [TX0, TY0, -T]], '#121216');
}

// Pre-warped 2.5D table: the surface, rails, markings and skirt are static
// per theme, so the perspective warp runs once per camera fit (resize,
// camera switch, theme change, online flip) into a screen-space canvas.
// Each frame then costs a single drawImage. The trauma shake applies on top
// of the pre-warped image, exactly as it did when the warp ran per frame.
let warpCanvas = null;
function paintTableWarp() {
  if (view.camera === 'top' || !view.cam || !view.w || !view.h) { warpCanvas = null; return; }
  // flat playfield -> offscreen staging (identity transform: the staging
  // canvas is exactly rink resolution, so rink coords map 1:1 to source px)
  const pfx = pfStage();
  pfx.setTransform(1, 0, 0, 1, 0, 0);
  pfx.clearRect(0, 0, VW, VH);
  drawTableStaticFlat(pfx);
  const dpr = view.dpr || 1, w = view.w, h = view.h;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * dpr));
  c.height = Math.max(2, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  drawTableSkirt25(g, view.cam);
  warpPlayfield25(g, view.cam);
  warpCanvas = c;
}

// Warp an arbitrary rink rect [x0,x1]x[y0,y1] from a source canvas through
// the camera. (sx,sy) is the source-canvas px offset of rink (x0,y0): the
// full-table staging canvas is 1:1 with rink coords (offset 0,0); small
// transient canvases (goal trim) carry their own offset.
function warpRect25(g, cam, src, ox, oy, x0, x1, y0, y1) {
  const dy = y1 - y0;
  const bounds = [x0];
  const stack = [[x0, x1]];
  let guard = 0;
  while (stack.length && guard++ < 20000) {
    const [a, b] = stack.pop();
    if (b - a < 0.5 || triErr25(cam, a, b, y0, y1) < 0.5) bounds.push(b);
    else { const m = (a + b) / 2; stack.push([m, b]); stack.push([a, m]); }
  }
  bounds.sort((p, q) => p - q);
  const tops = [], bots = [];
  for (const x of bounds) {
    const t = camProject(cam, x, y0, 0), bo = camProject(cam, x, y1, 0);
    if (!t || !bo) return; // unreachable: the fit keeps every corner in front
    tops.push(t); bots.push(bo);
  }
  for (let i = 0; i + 1 < bounds.length; i++) {
    const sx0 = bounds[i], sx1 = bounds[i + 1], dx = sx1 - sx0;
    const T0 = tops[i], T1 = tops[i + 1], B0 = bots[i], B1 = bots[i + 1];
    triBlit25(g, src, ox, oy, [[sx0, y0], [sx1, y0], [sx1, y1]],
              [[T0.x, T0.y], [T1.x, T1.y], [B1.x, B1.y]], sx0, y0, dx, dy);
    triBlit25(g, src, ox, oy, [[sx0, y0], [sx1, y1], [sx0, y1]],
              [[T0.x, T0.y], [B1.x, B1.y], [B0.x, B0.y]], sx0, y0, dx, dy);
  }
}

function warpPlayfield25(g, cam) {
  warpRect25(g, cam, pfCanvas, 0, 0, TX0, TX1, TY0, TY1);
}

// Draw one source triangle through the affine its three true projected
// corners determine, clipped to the destination triangle. The strip's full
// source rect is drawn (it covers the triangle); the clip cuts the excess.
// Source px = rink coords minus the (ox,oy) canvas offset.
function triBlit25(g, src, ox, oy, sTri, dTri, sx, sy, sw, sh) {
  const A = triAffine25(sTri, dTri);
  if (!A) return;
  const [[d0x, d0y], [d1x, d1y], [d2x, d2y]] = dTri;
  g.save();
  g.beginPath();
  g.moveTo(d0x, d0y); g.lineTo(d1x, d1y); g.lineTo(d2x, d2y);
  g.closePath(); g.clip();
  g.transform(A[0], A[1], A[2], A[3], A[4], A[5]);
  g.drawImage(src, sx - ox, sy - oy, sw, sh, sx, sy, sw, sh);
  g.restore();
}

// Affine from three source points to three screen points, as
// [m11, m12, m21, m22, ex, ey] for ctx.transform. Pure math - unit-testable.
function triAffine25(sTri, dTri) {
  const [[s0x, s0y], [s1x, s1y], [s2x, s2y]] = sTri;
  const [[d0x, d0y], [d1x, d1y], [d2x, d2y]] = dTri;
  const a11 = s1x - s0x, a12 = s1y - s0y, a21 = s2x - s0x, a22 = s2y - s0y;
  const det = a11 * a22 - a12 * a21;
  if (!det) return null;
  const i11 = a22 / det, i12 = -a12 / det, i21 = -a21 / det, i22 = a11 / det;
  const b11 = d1x - d0x, b12 = d1y - d0y, b21 = d2x - d0x, b22 = d2y - d0y;
  const m11 = b11 * i11 + b21 * i12, m21 = b11 * i21 + b21 * i22;
  const m12 = b12 * i11 + b22 * i12, m22 = b12 * i21 + b22 * i22;
  return [m11, m12, m21, m22,
    d0x - (m11 * s0x + m21 * s0y), d0y - (m12 * s0x + m22 * s0y)];
}

// Worst-case screen-space error of the two-triangle warp over a strip:
// sample interior points and compare the affine prediction against the
// true projection. Pure math - unit-testable.
function triErr25(cam, sx0, sx1, y0, y1) {
  const A = camProject(cam, sx0, y0, 0), B = camProject(cam, sx1, y0, 0);
  const C = camProject(cam, sx0, y1, 0), D = camProject(cam, sx1, y1, 0);
  if (!A || !B || !C || !D) return 1e9;
  const f1 = triAffine25([[sx0, y0], [sx1, y0], [sx1, y1]],
                         [[A.x, A.y], [B.x, B.y], [D.x, D.y]]);
  const f2 = triAffine25([[sx0, y0], [sx1, y1], [sx0, y1]],
                         [[A.x, A.y], [D.x, D.y], [C.x, C.y]]);
  if (!f1 || !f2) return 1e9;
  const proj = (f, x, y) => [f[0] * x + f[2] * y + f[4], f[1] * x + f[3] * y + f[5]];
  let worst = 0;
  const dx = sx1 - sx0, dy = y1 - y0;
  const pts = [[0.5, 0.004], [0.5, 0.996], [0.25, 0.5], [0.75, 0.5], [0.5, 0.5]];
  for (const [u, v] of pts) {
    const x = sx0 + dx * u, y = y0 + dy * v;
    const t = camProject(cam, x, y, 0);
    if (!t) return 1e9;
    // triangle 1 covers the region below the (sx0,y0)-(sx1,y1) diagonal
    const f = v < u ? f1 : f2;
    const [px, py] = proj(f, x, y);
    const e = Math.hypot(px - t.x, py - t.y);
    if (e > worst) worst = e;
  }
  return worst;
}

// Screen-space ellipse for a circle of radius r on the table plane at
// (x, y, z). The camera never rolls, so table-y maps (unforeshortened) to
// screen-x and table-x (depth) maps to screen-y: each axis gets its own
// true local scale instead of a fudge factor.
function tableEll25(cam, x, y, z, r) {
  const p0 = camProject(cam, x, y, z);
  if (!p0) return null;
  const px = camProject(cam, x + r, y, z), py = camProject(cam, x, y + r, z);
  if (!px || !py) return null;
  return { x: p0.x, y: p0.y, rx: Math.abs(py.x - p0.x), ry: Math.abs(px.y - p0.y), s: p0.s };
}

function drawShadow25(cam, x, y, r) {
  const e = tableEll25(cam, x, y, 0, r);
  if (!e) return;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU);
  ctx.fill();
}

// Puck and mallets, drawn far-to-near in true perspective.
function drawObjects25(cam) {
  const p = G.puck;
  drawShadow25(cam, p.x + 10, p.y + 14, PUCK_R * 1.05);
  drawShadow25(cam, G.m1.x + 8, G.m1.y + 12, G.m1.r);
  drawShadow25(cam, G.m2.x + 8, G.m2.y + 12, G.m2.r);
  const items = [
    { z: camProject(cam, p.x, p.y, 0), f: () => drawPuck25(cam) },
    { z: camProject(cam, G.m1.x, G.m1.y, 0), f: () => drawMallet25(cam, G.m1) },
    { z: camProject(cam, G.m2.x, G.m2.y, 0), f: () => drawMallet25(cam, G.m2) },
  ];
  // painter's order: far (large zc) first. A missing projection sorts last.
  items.sort((u, v) => (v.z ? v.z.zc : -1) - (u.z ? u.z.zc : -1));
  for (const it of items) it.f();
}

const PUCK_H25 = 20;   // puck thickness in rink units
const HANDLE_H25 = 110; // mallet handle height in rink units

// The puck as a short cylinder: dark wall, theme-dressed top, spin cue.
function drawPuck25(cam) {
  const p = G.puck, S = THEME.puck;
  const base = tableEll25(cam, p.x, p.y, 0, PUCK_R);
  const top = tableEll25(cam, p.x, p.y, PUCK_H25, PUCK_R);
  if (!base || !top) return;
  // wall
  ctx.fillStyle = S.edge;
  ctx.beginPath();
  ctx.ellipse(base.x, base.y, base.rx, base.ry, 0, 0, TAU);
  ctx.fill();
  // top face
  const rx = top.rx, ry = top.ry;
  if (S.glow) { ctx.save(); ctx.shadowColor = S.glow; ctx.shadowBlur = 26; }
  const g = ctx.createRadialGradient(top.x - rx * 0.2, top.y - ry * 0.25, 2, top.x, top.y, rx);
  g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(top.x, top.y, rx, ry, 0, 0, TAU); ctx.fill();
  if (S.glow) ctx.restore();
  ctx.lineWidth = Math.max(1.2, 2.5 * top.s);
  ctx.strokeStyle = S.ring; ctx.stroke();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(top.x - rx * 0.2, top.y - ry * 0.28, rx * 0.18, ry * 0.12, -0.5, 0, TAU);
  ctx.fill();
  // save-moment halo after a goal-line block
  if (G.saveT > 0 && fxFlash()) {
    const sg = ctx.createRadialGradient(top.x, top.y, rx * 0.5, top.x, top.y, rx * 2.2);
    sg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.5 * (G.saveT / 0.55)));
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(top.x, top.y, rx * 2.2, 0, TAU); ctx.fill();
  }
  // spin cue: the theme-gold dot rides the puck's rotation
  if (Math.abs(p.w || 0) > 2.5) {
    const da = p.ang || 0;
    const dp = camProject(cam, p.x + Math.cos(da) * PUCK_R * 0.55, p.y + Math.sin(da) * PUCK_R * 0.55, PUCK_H25);
    if (dp) {
      ctx.save();
      ctx.globalAlpha = 0.85; ctx.fillStyle = THEME.gold || '#d8a93f';
      ctx.beginPath(); ctx.arc(dp.x, dp.y, Math.max(2, 4.5 * top.s), 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

// The mallet as a physical striker: theme-dressed base disc plus a standing
// wooden handle with a knob, like a real air hockey mallet.
function drawMallet25(cam, m) {
  const S = THEME.mallet, r = m.r;
  const b = tableEll25(cam, m.x, m.y, 0, r);
  const t = camProject(cam, m.x, m.y, HANDLE_H25);
  if (!b || !t) return;
  // base disc keeps the theme's full mallet identity
  const brx = b.rx, bry = b.ry;
  const g = ctx.createRadialGradient(b.x - brx * 0.3, b.y - bry * 0.35, brx * 0.1, b.x, b.y, brx);
  g.addColorStop(0, S.hi); g.addColorStop(0.6, S.base); g.addColorStop(1, S.edge);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(b.x, b.y, brx, bry, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1.5, 3 * b.s);
  ctx.strokeStyle = S.ring; ctx.stroke();
  // dish
  const dg = ctx.createRadialGradient(b.x - brx * 0.13, b.y - bry * 0.17, 2, b.x, b.y, brx * 0.62);
  dg.addColorStop(0, S.dishHi); dg.addColorStop(1, S.dish);
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.ellipse(b.x, b.y, brx * 0.62, bry * 0.62, 0, 0, TAU); ctx.fill();
  // handle: a tapered post rising from the disc to the knob
  const w0 = brx * 0.30, w1 = Math.max(2, brx * 0.22 * (t.s / b.s));
  const hg = ctx.createLinearGradient(t.x, t.y, b.x, b.y);
  hg.addColorStop(0, '#7a5638'); hg.addColorStop(1, '#4a3220');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(t.x - w1, t.y); ctx.lineTo(t.x + w1, t.y);
  ctx.lineTo(b.x + w0, b.y); ctx.lineTo(b.x - w0, b.y);
  ctx.closePath(); ctx.fill();
  // knob
  const kg = ctx.createRadialGradient(t.x - w1 * 0.3, t.y - w1 * 0.3, 1, t.x, t.y, w1 * 1.3);
  kg.addColorStop(0, '#8a6544'); kg.addColorStop(1, '#4a3220');
  ctx.fillStyle = kg;
  ctx.beginPath(); ctx.ellipse(t.x, t.y, w1 * 1.3, w1 * 1.15, 0, 0, TAU); ctx.fill();
}

// Table-bound dynamics in the 2.5D view: everything drawTableFlat draws
// per frame on top of the static table (scuffs, trail, speed lines, goal
// trim, frame flash, post glow), projected to true depth. The static table
// itself lives pre-warped in warpCanvas.
function drawDynTable25(cam) {
  // scuffs (permanence): short dark streaks, projected as thick segments
  for (const sc of G.scuffs) {
    const ca = Math.cos(sc.ang), sa = Math.sin(sc.ang);
    const p0 = camProject(cam, sc.x - ca * sc.len / 2, sc.y - sa * sc.len / 2, 0);
    const p1 = camProject(cam, sc.x + ca * sc.len / 2, sc.y + sa * sc.len / 2, 0);
    if (!p0 || !p1) continue;
    ctx.save();
    ctx.globalAlpha = sc.a;
    ctx.strokeStyle = 'rgb(10,8,6)';
    ctx.lineWidth = Math.max(0.6, 3.2 * (p0.s + p1.s) / 2);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.restore();
  }
  // puck trail
  const tr = G.trail;
  if (tr.length > 1) {
    ctx.save(); ctx.lineCap = 'round';
    if (THEME.trailGlow) { ctx.shadowColor = THEME.trailGlow; ctx.shadowBlur = 14; }
    ctx.strokeStyle = THEME.trail;
    for (let i = 1; i < tr.length; i++) {
      const p0 = camProject(cam, tr[i - 1].x, tr[i - 1].y, 0);
      const p1 = camProject(cam, tr[i].x, tr[i].y, 0);
      if (!p0 || !p1) continue;
      ctx.globalAlpha = (i / tr.length) * 0.35;
      ctx.lineWidth = Math.max(0.6, (2 + (i / tr.length) * 8) * (p0.s + p1.s) / 2);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.restore();
  }
  // speed lines above 1500: theme-colored streaks back along the velocity
  if (G.puck) {
    const psp = puckSpeed();
    if (psp > 1500 && Settings.effects !== 'minimal') {
      const nsl = Settings.effects === 'subtle' ? 3 : Math.min(5, 1 + Math.floor((psp - 1500) / 400));
      const va = Math.atan2(G.puck.vy, G.puck.vx);
      const cvx = Math.cos(va), svx = Math.sin(va);
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = THEME.trail;
      for (let i = 0; i < nsl; i++) {
        const off = (i - (nsl - 1) / 2) * 14;
        const ox = -svx * off, oy = cvx * off;
        const len = psp * (0.05 + i * 0.012);
        const p0 = camProject(cam, G.puck.x - cvx * (PUCK_R + 6) + ox, G.puck.y - svx * (PUCK_R + 6) + oy, 0);
        const p1 = camProject(cam, G.puck.x - cvx * (PUCK_R + 6 + len) + ox, G.puck.y - svx * (PUCK_R + 6 + len) + oy, 0);
        if (!p0 || !p1) continue;
        ctx.globalAlpha = Math.max(0.06, 0.28 - i * 0.04);
        ctx.lineWidth = Math.max(0.6, 3 * (p0.s + p1.s) / 2);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // goal trim: theme art staged small and warped per frame (cheap: the mouth
  // region needs only a handful of strips). The rattle jitter bakes into the
  // staging, exactly like the flat view.
  for (let side = 0; side < 2; side++) drawTrim25(cam, side);
  // goal-frame flash: the scored-on frame lights up in theme gold
  if (G.goalFrameT > 0 && fxFlash()) {
    const fgx = G.goalSide === 0 ? PX + PW : PX, gw = goalW();
    const c = [[fgx - 16, CY - gw / 2 - 16], [fgx + 16, CY - gw / 2 - 16],
               [fgx + 16, CY + gw / 2 + 16], [fgx - 16, CY + gw / 2 + 16]]
      .map(([x, y]) => camProject(cam, x, y, 0));
    if (!c.some(p => !p)) {
      ctx.save();
      ctx.globalAlpha = G.goalFrameT * 0.9;
      ctx.strokeStyle = THEME.gold || '#d8a93f';
      ctx.lineWidth = Math.max(1, 5 * (c[0].s + c[2].s) / 2);
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  }
  // near-miss post glow: the kissed posts smolder briefly
  if (G.missGlow && fxFlash()) {
    const mgx = G.missGlow.side === 0 ? PX : PX + PW;
    ctx.save();
    ctx.globalAlpha = clamp(G.missGlow.t / 0.7, 0, 1) * 0.8;
    ctx.fillStyle = THEME.gold || '#d8a93f';
    for (const sgn of [-1, 1]) {
      const e = tableEll25(cam, mgx, CY + sgn * goalW() / 2, 0, 10);
      if (!e) continue;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// One goal mouth's trim in the 2.5D view: the theme draws its trim art into
// a small rink-space canvas (with the rattle jitter when active), which is
// then warped through the camera - the theme's identity survives intact.
let trimCanvas = null;
function drawTrim25(cam, side) {
  const gx = side === 0 ? PX : PX + PW, gw = goalW();
  const pad = 40, rx0 = gx - pad, ry0 = CY - gw / 2 - pad;
  const TW = pad * 2, TH = Math.ceil(gw + pad * 2);
  if (!trimCanvas || trimCanvas.width !== TW || trimCanvas.height !== TH) {
    trimCanvas = document.createElement('canvas');
    trimCanvas.width = TW; trimCanvas.height = TH;
  }
  let ox = 0, oy = 0;
  if (G.rattle && G.rattle.side === side && fxFlash()) {
    const j = 4.5 * (G.rattle.t / 0.42) * shakeK();
    ox = rnd(-1, 1) * j; oy = rnd(-1, 1) * j;
  }
  const tc = trimCanvas.getContext('2d');
  tc.setTransform(1, 0, 0, 1, 0, 0);
  tc.clearRect(0, 0, TW, TH);
  tc.save(); tc.translate(-rx0 + ox, -ry0 + oy);
  THEME.drawGoalTrim(tc, side, gx, CY, gw);
  tc.restore();
  warpRect25(ctx, cam, trimCanvas, rx0, ry0, rx0, rx0 + TW, ry0, ry0 + TH);
}

// Dynamic FX in the 2.5D view: the same elements as the flat FX layer
// (trails, rings, particles, pulses, flashes), each projected to its true
// depth instead of being baked into the warped table. Per-element
// projection is exact for small primitives and costs a few camProjects.
function drawFx25(cam) {
  const ell = (x, y, r, style, alpha, lw) => {
    const e = tableEll25(cam, x, y, 0, r);
    if (!e) return;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, Math.max(0.5, e.rx), Math.max(0.5, e.ry), 0, 0, TAU);
    if (lw) { ctx.strokeStyle = style; ctx.lineWidth = Math.max(0.75, lw * e.s); ctx.stroke(); }
    else { ctx.fillStyle = style; ctx.fill(); }
    ctx.restore();
  };
  // mallet motion trails on fast flicks (recorded in driveMallet)
  for (const m of [G.m1, G.m2]) {
    const tr = m.trail;
    for (let i = 0; i < tr.length; i++) {
      const a = (i / tr.length) * 0.30 * fxTrail();
      if (a <= 0.01) continue;
      ell(tr[i].x, tr[i].y, m.r * (0.35 + 0.55 * i / tr.length), THEME.trail, a);
    }
    // possession readability: sustained gentle contact (>0.4s) draws a soft
    // ring under the puck - it reads as control, never as a stuck puck
    if (m.glueT > 0.4) {
      const pr = PUCK_R + 12 + Math.sin(perfNow() * 6) * 3;
      ell(G.puck.x, G.puck.y, pr, THEME.gold || '#d8a93f', 0.55, 3);
    }
  }
  // particles as motion streaks
  ctx.save(); ctx.lineCap = 'round';
  for (const q of PPOOL) {
    if (!q.on) continue;
    const a = clamp(q.life / q.max, 0, 1);
    const p0 = camProject(cam, q.x, q.y, 0);
    const p1 = camProject(cam, q.x - q.vx * 0.035, q.y - q.vy * 0.035, 0);
    if (!p0 || !p1) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = q.color;
    ctx.lineWidth = Math.max(0.5, (q.size * a + 0.5) * (p0.s + p1.s) / 2);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.restore();
  // save-moment ring pulses: a soft expanding ring where the block happened
  for (const q of G.pulses) {
    const k = q.t / 0.6;
    ell(q.x, q.y, 30 + k * 90, THEME.gold || '#d8a93f', (1 - k) * 0.7, 4 * (1 - k) + 1);
  }
  // goal flash + SMASH impact flash: radial blooms projected onto the table
  const flash = (x, y, r, color, alpha) => {
    const e = tableEll25(cam, x, y, 0, r);
    if (!e || alpha <= 0.01) return;
    const gr = ctx.createRadialGradient(e.x, e.y, e.rx * 0.05, e.x, e.y, e.rx);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = gr;
    ctx.fillRect(e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
    ctx.restore();
  };
  if (G.flashA > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    flash(gx, CY, 420, THEME.flash || 'rgba(216,169,63,1)', G.flashA * 0.55);
  }
  if (G.hitFlash > 0 && fxFlash()) {
    flash(G.hitFlashX, G.hitFlashY, 260,
      'rgba(255,255,255,' + (0.55 * G.hitFlash).toFixed(3) + ')', 1);
  }
}

// Countdown in the 2.5D view: the same pop language as the top-down view,
// placed on the table in true perspective so it sits in the scene.
function drawCountdown25(cam) {
  if (G.state !== 'count') return;
  const frac = (G.countT % 0.55) / 0.55;
  const label = G.countT < 1.65 ? String(3 - Math.floor(G.countT / 0.55)) : 'GO!';
  const pop = 1 + (1 - frac) * 0.55;
  const p = camProject(cam, CX, CY - 40, 120);
  if (!p) return;
  ctx.save();
  ctx.globalAlpha = clamp(1.4 - frac, 0, 1);
  ctx.font = '800 ' + (120 * p.s * pop).toFixed(1) + 'px ' + THEME.font.display;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = THEME.ink;
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24;
  ctx.fillText(label, p.x, p.y);
  ctx.restore();
}

// Floating texts projected to screen space so the type stays upright and
// readable at any camera angle, sized by the local depth scale.
function drawTexts25(cam) {
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    const p = camProject(cam, t.x, t.y, 50);
    if (!p) continue;
    const size = Math.max(8, t.size * p.s);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = '800 ' + size.toFixed(1) + 'px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(15,10,5,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 12;
    ctx.fillText(t.str, p.x, p.y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = t.color;
    ctx.fillText(t.str, p.x, p.y);
    ctx.restore();
  }
}


function drawPuck(c) {
  const p = G.puck, S = THEME.puck;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath(); c.ellipse(p.x + 5, p.y + 8, PUCK_R, PUCK_R * 0.92, 0, 0, TAU); c.fill();
  c.translate(p.x, p.y);
  // save-moment glow: the puck holds a brief halo after a goal-line block
  if (G.saveT > 0 && fxFlash()) {
    const sg = c.createRadialGradient(0, 0, PUCK_R * 0.5, 0, 0, PUCK_R * 2.2);
    sg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.5 * (G.saveT / 0.55)));
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sg;
    c.beginPath(); c.arc(0, 0, PUCK_R * 2.2, 0, TAU); c.fill();
  }
  // velocity stretch: continuous from cruise (~600 u/s), proportional to
  // speed - subtle at a glide, pronounced on a real shot. Elongates along
  // the travel vector with a volume-preserving pinch across it. Pauses while
  // an impact squash is still springing back, so the two never fight.
  const psp = hyp(p.vx, p.vy);
  if (psp > 600 && G.puckSq > 0.96) {
    const va = Math.atan2(p.vy, p.vx), st = clamp((psp - 600) / 3200, 0, 1) * 0.22;
    c.rotate(va); c.scale(1 + st, 1 / (1 + st)); c.rotate(-va);
  }
  c.rotate(G.puckSqA);
  const sq = G.puckSq;
  c.scale(sq, 1 / sq); // volume-preserving: the bulge matches the squash
  // neon tables set puck.glow: a light-tube halo around the puck body
  if (S.glow) { c.shadowColor = S.glow; c.shadowBlur = 26; }
  const g = c.createRadialGradient(-5, -6, 2, 0, 0, PUCK_R);
  g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, PUCK_R, 0, TAU); c.fill();
  c.shadowBlur = 0;
  c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.ellipse(-5, -7, 4.5, 3, -0.5, 0, TAU); c.fill();
  c.restore();
  // spin cue: a small theme-gold dot rides the puck's rotation when it
  // carries english - the Magnus curve becomes readable before it bends
  if (Math.abs(p.w || 0) > 2.5) {
    const da = p.ang || 0;
    c.save();
    c.fillStyle = THEME.gold || '#d8a93f'; c.globalAlpha = 0.85;
    c.beginPath(); c.arc(p.x + Math.cos(da) * PUCK_R * 0.55, p.y + Math.sin(da) * PUCK_R * 0.55, 4.5, 0, TAU); c.fill();
    c.restore();
  }
}

function drawMallet(c, m) {
  const S = THEME.mallet, r = m.r;
  c.save();
  // shadow (drawn in world space, unaffected by squash so it doesn't swim)
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(m.x + 6, m.y + 10, r, r * 0.9, 0, 0, TAU); c.fill();
  c.translate(m.x, m.y);
  // squash/stretch: a fast-driven mallet leans into its own travel
  // (exaggeration/appeal), and a strike compresses it along the contact
  // normal for a couple frames before springing back (recoil) - same
  // visual language as the puck's deformation for a consistent feel.
  const msp = hyp(m.vx, m.vy);
  if (msp > 900 && m.hitSq > 0.97) {
    const ma = Math.atan2(m.vy, m.vx), st = clamp((msp - 900) / 3300, 0, 1) * 0.16;
    c.rotate(ma); c.scale(1 + st, 1 - 0.5 * st); c.rotate(-ma);
  }
  const sq = m.hitSq;
  if (sq < 0.999) {
    c.rotate(m.hitSqA); c.scale(sq, 1 + (1 - sq) * 0.6); c.rotate(-m.hitSqA);
  }
  // body
  const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, S.hi); g.addColorStop(0.6, S.base); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  c.lineWidth = 3; c.strokeStyle = S.ring; c.stroke();
  // dish
  const dg = c.createRadialGradient(-6, -8, 2, 0, 0, r * 0.62);
  dg.addColorStop(0, S.dishHi); dg.addColorStop(1, S.dish);
  c.fillStyle = dg;
  c.beginPath(); c.arc(0, 0, r * 0.62, 0, TAU); c.fill();
  // knob
  const kg = c.createRadialGradient(-4, -5, 1, 0, 0, r * 0.30);
  kg.addColorStop(0, S.knobHi); kg.addColorStop(1, S.knob);
  c.fillStyle = kg;
  c.beginPath(); c.arc(0, 0, r * 0.30, 0, TAU); c.fill();
  c.restore();
}
