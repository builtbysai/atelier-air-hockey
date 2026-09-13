/* ============================================================
   ATELIER AIR HOCKEY — engine v2
   Rebuilt from research: Brunswick 1969 roots, near-zero-friction
   puck glide, velocity-transfer striking, human-like AI, and the
   full juice canon (hit-stop, trauma shake + rotation, particles,
   squash, trails, scuff permanence, slow-mo goal ceremony).
   Single file. Mobile-first. No external assets but fonts.
   ============================================================ */
'use strict';

// ---------- dimensions (2:1 rink, USAA-style proportions) ----------
const VW = 1440, VH = 1040;          // view space
const PX = 200, PY = 200, PW = 1040, PH = 640;  // playfield
const CX = PX + PW / 2, CY = PY + PH / 2;
const PUCK_R = 26, MALLET_R = 46, GOAL_W = 230, RAIL = 26;
const TX0 = PX - RAIL, TY0 = PY - RAIL;
const TAU = Math.PI * 2;

// ---------- user settings (persisted) ----------
const Settings = {
  shake: 'full',      // 'off' | 'subtle' | 'full'
  sound: true,
  haptics: true,
  firstTo: 7,         // 5 | 7 | 11
  pace: 'classic',     // 'casual' | 'classic' | 'lightning'
  effects: 'full',     // 'full' | 'subtle' | 'minimal' — spectacle scaler, never touches physics
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
}
// Effects scalers — one place to look up how much spectacle is allowed.
// Physics, pacing, and AI never consult these.
const fxParticles = () => Settings.effects === 'minimal' ? 0.35 : Settings.effects === 'subtle' ? 0.65 : 1;
const fxTrail = () => Settings.effects === 'minimal' ? 0.5 : Settings.effects === 'subtle' ? 0.75 : 1;
const fxRoom = () => Settings.effects === 'full' && !PRM.reduce;   // room reactivity
const fxFlash = () => Settings.effects !== 'minimal' && !PRM.reduce; // flashes & glows
function saveSettings() {
  try { localStorage.setItem('atelier-ah-settings', JSON.stringify(Settings)); } catch (e) {}
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
// Real tables: puck floats on air jets — near-zero friction. A good shove
// crosses an 8ft table several times. Damping here is exponential /s.
const PUCK_DAMP = 0.09;              // default damping; pace setting overrides at runtime
const WALL_REST = 0.95;              // default rail restitution; pace setting overrides at runtime
const PUCK_MAX = 3100;               // fastest pro smash, in units/s
const STRIKE_XFER = 1.45;            // mallet->puck velocity transfer
const SMACK_BONUS = 0.55;            // extra punch on fast flicks
const SUB_HZ = 240;                  // physics substeps (anti-tunnel)
const STALL_V = 130, STALL_T = 1.4;  // anti-dead-puck trigger

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rand = (a, b) => a + Math.random() * (b - a); // themes.js uses rand(a,b)
const hyp = Math.hypot;
// '#rrggbb' + alpha -> 'rgba(...)' — theme hexes need alpha for glow overlays
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'rgba(216,169,63,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
let interacted = false; // set on first real pointer input (gates vibrate)

// ---------- procedural audio ----------
const AudioSys = {
  ctx: null, master: null, muted: false,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* silent */ }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; },
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
    src.connect(hp); hp.connect(g1); g1.connect(this.master);
    src.start(t);
    // body
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = (170 + p * 460) * vr;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.55 * p + 0.06, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o.connect(g2); g2.connect(this.master);
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
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  },
  // save thud: a soft low knock for goal-line blocks — felt, not announced
  thud() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.master);
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
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.24);
    });
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
    o.connect(lp); lp.connect(g); g.connect(this.master);
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
      o.connect(g); g.connect(this.master);
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
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0);
  },
  blip(f, dur = 0.09, vol = 0.3) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  ui() { this.blip(1150, 0.05, 0.18); },
  count(final) { this.blip(final ? 990 : 620, final ? 0.28 : 0.12, 0.32); },
};
function buzz(pat) { try { if (interacted && Settings.haptics && navigator.vibrate) navigator.vibrate(pat); } catch (e) {} }

// ---------- game state ----------
// whiff: per-strike chance the AI swings clean through (a human error, never a
// superhuman stat — it only ever makes rivals weaker). windup: telegraph time.
const DIFFS = [
  { name: 'Rookie',   maxSpeed: 780,  react: 0.30, aimErr: 100, strike: 0.62, aggro: 0.50, tick: 0.14, whiff: 0.12, windup: 0.11 },
  { name: 'Club Pro', maxSpeed: 1180, react: 0.13, aimErr: 45,  strike: 1.00, aggro: 0.70, tick: 0.09, whiff: 0.03, windup: 0.11 },
  { name: 'Champion', maxSpeed: 1520, react: 0.10, aimErr: 34,  strike: 1.25, aggro: 0.95, tick: 0.06, whiff: 0.01, windup: 0.14 },
];
const PLAYER_CAP = 4200; // mallet tracking cap — 1:1 feel, no teleporting

const G = {
  state: 'menu',            // menu | count | play | goal | win | pause
  mode: 'ai', difficulty: 1,
  score: [0, 0], winSide: 0,
  m1: null, m2: null, puck: null,
  timeScale: 1, freezeT: 0,
  trauma: 0,
  countT: 0, countN: 3, goalT: 0, goalSlowT: 0, goalSide: 0,
  stallT: 0, stallX: CX, stallY: CY, anchorT: 0, lastTouch: -1,
  idleT: 0, demo: false,
  serveDir: 1,
  pausedFrom: 'play',
  scuffs: [], parts: [], trail: [], texts: [], pulses: [],
  puckSq: 1, puckSqA: 0,    // squash amount / angle
  letterT: 0, flashA: 0,
  hitFlash: 0, hitFlashX: 0, hitFlashY: 0, // SMASH-tier impact flash
  roomPulse: 0,             // room reactivity: decays, feeds the lamp-glow overlay
  saveT: 0,                 // save-moment puck glow timer
  nearCd: 0, dipT: 0,       // near-miss cooldown + time-dip timer
  missGlow: null,           // { side, t } post glow after a near miss
  goalFrameT: 0,            // goal-frame flash timer
  board: freshBoard(),      // scoreboard animation state
  ai: null,                 // per-ai brain state
  stats: null,              // per-match stats (top speed, rally, time)
  onlineFlip: false,        // ONLINE: guest view is mirrored — they play from their own side
};
function freshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, t0: 0 }; }
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
  };
}
function resetPositions() {
  const m1 = G.m1, m2 = G.m2;
  m1.x = m1.tx = PX + 170; m1.y = m1.ty = CY;
  m2.x = m2.tx = PX + PW - 170; m2.y = m2.ty = CY;
  m1.vx = m1.vy = m2.vx = m2.vy = 0;
  for (const m of [m1, m2]) { m.glueT = 0; m.ghostT = 0; m.touching = false; m.trail.length = 0; }
  G.puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R, w: 0, ang: 0 };
  G.trail.length = 0; G.stallT = 0; G.lastTouch = -1;
  G.stallX = CX; G.stallY = CY; G.anchorT = 0;
  G.puckSq = 1;
}
G.m1 = mkMallet(0); G.m2 = mkMallet(1);

// ---------- view / input mapping ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let view = { w: 0, h: 0, s: 1, ox: 0, oy: 0, portrait: false };

function resize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  view.w = w; view.h = h;
  view.portrait = h > w * 1.05;
  if (!view.portrait) {
    view.s = Math.min(w / VW, h / VH);
    view.ox = (w - VW * view.s) / 2; view.oy = (h - VH * view.s) / 2;
  } else {
    view.s = Math.min(w / VH, h / VW);
    view.ox = (w - VH * view.s) / 2; view.oy = (h - VW * view.s) / 2;
  }
  view.dpr = dpr;
  paintRoom();
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
  const { s, ox, oy, portrait } = view;
  const u = (cx - ox) / s, v = (cy - oy) / s;
  let x, y;
  if (!portrait) { x = u; y = v; }
  else { x = VW - v; y = VH - u; }
  if (G.onlineFlip) x = VW - x; // ONLINE: invert the guest view mirror
  return { x, y };
}
// ONLINE: scoreboard / win / ribbon labels by side (0 = left/host, 1 = right/guest)
function onlineSideLabel(side) {
  const amGuest = typeof Net !== 'undefined' && Net.role === 'guest';
  if (side === 0) return amGuest ? 'RIVAL' : 'YOU';
  return amGuest ? 'YOU' : 'RIVAL';
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
// move mallet toward target with a speed cap — 1:1 feel, never teleports
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
    // flood it — ~8 points of ~26u reads as a streak, not a smear
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

function onPointerDown(e) {
  AudioSys.init(); AudioSys.resume();
  interacted = true;
  if (G.state === 'menu' || G.state === 'win') return; // buttons own the UI
  const touch = e.pointerType === 'touch';
  const r = screenToRink(e.clientX, e.clientY - (touch ? 70 : 0));
  if (G.mode === 'online' && !pointers.has(e.pointerId)) {
    // ONLINE: exactly one local mallet — host plays m1, guest plays m2. No AI.
    if (pointers.size > 0) return;
    pointers.set(e.pointerId, Net.role === 'guest' ? 1 : 0);
  } else if (G.mode === '2p' && !pointers.has(e.pointerId)) {
    const side = r.x > CX ? 1 : 0;
    const taken = [...pointers.values()];
    if (!taken.includes(side)) pointers.set(e.pointerId, side);
    else return;
  } else if (!pointers.has(e.pointerId)) {
    if (pointers.size > 0 && G.mode !== '2p') return;
    pointers.set(e.pointerId, 0);
  }
  const m = pointers.get(e.pointerId) === 0 ? G.m1 : G.m2;
  m.tx = r.x; m.ty = r.y;
  G.idleT = 0;
}
function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  if (G.state === 'menu' || G.state === 'win') return;
  const touch = e.pointerType === 'touch';
  const r = screenToRink(e.clientX, e.clientY - (touch ? 70 : 0));
  const m = pointers.get(e.pointerId) === 0 ? G.m1 : G.m2;
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
      onRailHit(p.x, PY, imp);
    }
  } else if (p.y > PY + PH - r) {
    p.y = PY + PH - r;
    if (p.vy > 0) {
      const imp = p.vy;
      p.vy = -p.vy * paceWall(); p.vx *= 0.995;
      onRailHit(p.x, PY + PH, imp);
    }
  }
  // end walls with goal mouths
  const inMouth = Math.abs(p.y - CY) < GOAL_W / 2 - 6;
  // the goal frame rings: contact just outside the mouth is a post hit
  const nearPost = !inMouth && Math.abs(p.y - CY) < GOAL_W / 2 + 42;
  if (p.x < PX + r && !inMouth) {
    p.x = PX + r;
    if (p.vx < 0) { const imp = -p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX, p.y, imp, nearPost); }
  } else if (p.x > PX + PW - r && !inMouth) {
    p.x = PX + PW - r;
    if (p.vx > 0) { const imp = p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX + PW, p.y, imp, nearPost); }
  }
}

// mallet is kinematic (infinite mass): positional separation + impulse
// with full mallet-velocity transfer, so flicks become rockets.
//
// Possession clock (stuck-puck fix): a mallet pressing the puck into a rail
// pocket defeats both anti-stall systems — constant contact keeps resetting
// G.stallT, and the displacement nudge gets smothered. So each mallet tracks
// glueT: sustained gentle contact time. Hard hits reset it; 2.5s of pressing
// (legit contact is ~0.18s) forcibly releases the puck. Rail pins squirt
// along the rail; open-ice presses pop off the mallet face. The pressing
// mallet goes ghost for 0.30s so it can't instantly re-trap.
function collideMallet(p, m, dt) {
  const dx = p.x - m.x, dy = p.y - m.y;
  const minD = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (m.ghostT > 0) { m.glueT = 0; return; } // ghostT ticks in stepPhysics
  if (d2 >= minD * minD || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  m.touching = true;
  // --- possession clock ---
  const vn0 = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  const mvn0 = m.vx * nx + m.vy * ny;
  if (-vn0 + Math.max(0, mvn0) > 650) m.glueT = 0;
  else m.glueT += dt;
  if (m.glueT > 2.5) {
    const nearT = p.y < PY + 70, nearB = p.y > PY + PH - 70;
    const nearL = p.x < PX + 70, nearR = p.x > PX + PW - 70;
    const inMouthY = Math.abs(p.y - CY) < GOAL_W / 2;
    let rx = nx, ry = ny, railed = false;
    if (nearT && ry < 0) { ry = 0; railed = true; }
    if (nearB && ry > 0) { ry = 0; railed = true; }
    if (nearL && rx < 0 && !inMouthY) { rx = 0; railed = true; }
    if (nearR && rx > 0 && !inMouthY) { rx = 0; railed = true; }
    if (!railed) {
      p.x = m.x + nx * minD; p.y = m.y + ny * minD;
      p.vx = nx * 560; p.vy = ny * 560;
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
      onMalletHit(p.x, p.y, 750, rx, ry);
    }
    m.glueT = 0; G.lastTouch = m.side;
    return;
  }
  // --- normal contact ---
  p.x = m.x + nx * minD; p.y = m.y + ny * minD;
  const rvx = p.vx - m.vx, rvy = p.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return; // separating
  // Speed-dependent restitution: a still/slow mallet SMOTHERS the puck
  // (real goalie play — the puck drops dead for possession), a driven
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
  // english: tangential mallet velocity at contact becomes puck spin —
  // the Magnus curve is applied in stepPhysics
  const tx = -ny, ty = nx;
  const tang = (m.vx - p.vx) * tx + (m.vy - p.vy) * ty;
  p.w = clamp((p.w || 0) + tang / 260, -12, 12);
  G.lastTouch = m.side;
  G.stallT = 0;
  const impact = -vn + Math.max(0, mvn);
  // SAVE: a fast lateral block of a puck bound for your own goal gets the
  // soft treatment — thud, ring pulse, brief puck glow. High drama, low noise.
  if (m.saveCd <= 0 && impact > 220 && (m.side === 0 ? pvx0 < -450 : pvx0 > 450) && msp0 > 650) {
    m.saveCd = 0.9;
    G.saveT = 0.55;
    G.pulses.push({ x: p.x, y: p.y, t: 0 });
    AudioSys.thud();
  }
  // fast flicks whoosh on the way through (cooled down so rallies don't hiss)
  if (msp0 > 1300 && m.whooshT <= 0) {
    m.whooshT = 0.3;
    AudioSys.whoosh(msp0 / 3000);
  }
  onMalletHit(p.x, p.y, impact, nx, ny);
}

function stepPhysics(dt) {
  const p = G.puck;
  // glide: near-zero friction, like air jets (pace setting tunes the table)
  const damp = Math.exp(-paceDamp() * dt);
  p.vx *= damp; p.vy *= damp;
  // Magnus: puck spin (english from tangential mallet contact) curves flight.
  // |a| = K·|w|·|v| — at w=10, v=2000 that's ~600 u/s², a visible bend
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
    const m = mi === 0 ? G.m1 : G.m2; // indexed, not [G.m1, G.m2] — no alloc at 240 Hz
    if (m.ghostT > 0) m.ghostT -= dt;
    if (m.whooshT > 0) m.whooshT -= dt;
    if (m.saveCd > 0) m.saveCd -= dt;
    if (!m.touching) m.glueT = Math.max(0, m.glueT - dt * 2);
    m.touching = false;
  }
  collideMallet(p, G.m1, dt);
  collideMallet(p, G.m2, dt);
  collideWalls(p);
  // goals: full crossing of the line inside the mouth
  if (p.x > PX + PW + p.r * 0.35 && Math.abs(p.y - CY) < GOAL_W / 2) onGoal(0);
  else if (p.x < PX - p.r * 0.35 && Math.abs(p.y - CY) < GOAL_W / 2) onGoal(1);
  // near-miss drama: a fast puck kissing the goal frame without scoring —
  // a tiny time dip, a glowing post, a soft tick. Once per 1.5s max.
  if (G.state === 'play' && !G.demo && G.nearCd <= 0) {
    const dy = Math.abs(p.y - CY);
    const nearL = p.x > PX - 30 && p.x < PX + 80;
    const nearR = p.x > PX + PW - 80 && p.x < PX + PW + 30;
    if ((nearL || nearR) && dy > GOAL_W / 2 - 30 && dy < GOAL_W / 2 + PUCK_R + 26 && hyp(p.vx, p.vy) > 500) {
      G.nearCd = 1.5;
      if (fxFlash()) {
        G.dipT = 0.22;
        G.missGlow = { side: nearL ? 0 : 1, t: 0.7 };
      }
      AudioSys.blip(1500, 0.05, 0.10);
    }
  }
  // anti-stall: a real table never lets the puck die mid-rink — a whisper
  // of air from the jets keeps the game alive
  if (G.state === 'play') stallWatch(dt);
  // trail
  G.trail.push({ x: p.x, y: p.y });
  if (G.trail.length > Math.round(16 * fxTrail())) G.trail.shift();
  // squash recovery
  G.puckSq += (1 - G.puckSq) * Math.min(1, dt * 9);
}

// Anti-stall: air jets. A dead puck never sits — shared by live play and the
// attract demo so neither can freeze mid-rink.
function stallWatch(dt) {
  const p = G.puck;
  // displacement anchor: a pinned puck (constant mallet contact keeps
  // resetting stallT below) still counts as stalled if it goes nowhere.
  // The nudge aims at open ice, not random — it reads as the table
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
    whiff: false, // this strike will swing clean through (a human miss)
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
  // home: goal-side, slightly favoring puck's vertical zone — with idle sway
  b.swayT += 1 / 60;
  const hx = b.side === 0 ? PX + 190 : PX + PW - 190;
  const hy = CY + (b.seen.y - CY) * 0.35 + Math.sin(b.swayT * 1.7) * 14;
  return { x: hx, y: clamp(hy, PY + 90, PY + PH - 90) };
}
function aiThink(b, dt, m) {
  const D = b.diff;
  b.tState += dt; b.tickT += dt;
  if (b.tickT < D.tick) return; // decisions at 7–16 Hz, like a human
  b.tickT = 0;
  const s = b.seen, p = G.puck;
  const myGoalX = b.side === 0 ? PX : PX + PW;
  const foeGoalX = b.side === 0 ? PX + PW : PX;
  const puckOnMySide = b.side === 0 ? s.x < CX : s.x > CX;
  const puckSpeed = hyp(s.vx, s.vy);
  const threat = (b.side === 0 ? s.vx < -500 : s.vx > 500) && puckOnMySide;

  const setTx = (x, y) => {
    m.tx = b.side === 0 ? clamp(x, PX + MALLET_R, CX - 8) : clamp(x, CX + 8, PX + PW - MALLET_R);
    m.ty = clamp(y, PY + MALLET_R, PY + PH - MALLET_R);
  };
  const goHome = () => { const h = aiHome(b); setTx(h.x, h.y); };

  // pin rescue: if I'm smothering the puck into my corner and it hasn't gone
  // anywhere, I'm the trap — back off and dig it out. Speed-based checks
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
      goHome();
      if (threat) { b.state = 'defend'; b.tState = 0; }
      else if (puckOnMySide && puckSpeed < 1200 && Math.random() < D.aggro) { b.state = 'engage'; b.tState = 0; }
      break;
    }
    case 'defend': {
      // intercept the predicted trajectory in front of goal
      const tHit = clamp(Math.abs((s.x - (b.side === 0 ? PX + 150 : PX + PW - 150)) / (s.vx || 1)), 0, 1.1);
      const pr = predictPuck(s.x, s.y, s.vx, s.vy, tHit * 0.85);
      const gx = b.side === 0 ? PX + 130 : PX + PW - 130;
      setTx(gx + (pr.x - gx) * 0.35, pr.y);
      if (!threat) { b.state = 'guard'; b.tState = 0; }
      // if the puck sits in reach (smothered block, loose puck), take it
      if (puckSpeed < 900 && hyp(s.x - m.x, s.y - m.y) < 220) { b.state = 'engage'; b.tState = 0; }
      break;
    }
    case 'engage': {
      // skate to the puck, then set up the strike
      setTx(s.x, s.y);
      const d = hyp(s.x - m.x, s.y - m.y);
      // possession clock: herding the puck at close range counts as control
      if (d < MALLET_R + PUCK_R + 44) b.possessT += D.tick; else b.possessT = Math.max(0, b.possessT - D.tick);
      if (d < MALLET_R + PUCK_R + 26 && (puckSpeed < 700 || b.possessT > 0.35)) {
        b.state = 'windup'; b.tState = 0; b.windT = 0; b.possessT = 0;
        // pick aim: usually straight at the goal mouth, sometimes a bank
        const bank = Math.random() < (b.diff === DIFFS[2] ? 0.35 : 0.12);
        if (bank) {
          b.bankY = Math.random() < 0.5 ? PY + 40 : PY + PH - 40;
          b.aimX = foeGoalX; b.aimY = CY + rnd(-1, 1) * D.aimErr;
        } else {
          b.bankY = null;
          b.aimX = foeGoalX; b.aimY = CY + rnd(-1, 1) * D.aimErr;
        }
      }
      if (!puckOnMySide || puckSpeed > 1700) { b.state = 'guard'; b.tState = 0; b.possessT = 0; }
      break;
    }
    case 'windup': {
      // ANTICIPATION: pull back away from the aim point — telegraphs the smash
      b.windT += D.tick;
      let ax = b.aimX, ay = b.aimY;
      if (b.bankY !== null) { ax = s.x; ay = b.bankY; } // aim at the rail first
      const dx = ax - s.x, dy = ay - s.y, dl = hyp(dx, dy) || 1;
      const back = 95;
      setTx(s.x - dx / dl * back, s.y - dy / dl * back);
      if (b.windT > D.windup) {
        b.state = 'strike'; b.tState = 0;
        // the whiff: a human misread, rolled per difficulty — the lunge
        // below will be offset clean past the puck
        b.whiff = Math.random() < (D.whiff || 0);
      }
      break;
    }
    case 'strike': {
      // drive THROUGH the puck toward the aim point — this is where
      // mallet velocity becomes puck velocity. Lead the puck slightly
      // so the lunge connects on a moving target.
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
      // a whiffed swing takes longer to gather — the embarrassment tax
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
}
function aiDrive(b, dt, m) {
  aiPerceive(b, dt);
  aiThink(b, dt, m);
  // the strike param finally does something: lunges scale with the
  // difficulty's strike rating, so Rookie pokes and Champion detonates
  driveMallet(m, dt, b.diff.maxSpeed * (b.state === 'strike' ? 1.5 * b.diff.strike : 1));
}

// ---------- juice ----------
function addTrauma(x) {
  let k = Settings.shake === 'off' ? 0 : Settings.shake === 'subtle' ? 0.45 : 1;
  if (Settings.effects === 'minimal') k = Math.min(k, 0.45); // Minimal caps Shake at Subtle
  G.trauma = clamp(G.trauma + x * k, 0, 1);
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
// pooled particles — no allocation in the hot loop
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

// impact events — the layered hit stack.
// Tiers around the 650 hit-stop threshold: tap (<650), drive (650–1400),
// SMASH (>1400). Each tier buys more shake, a bigger flash, and a deeper
// pitch; SMASH also startles the room itself (see G.roomPulse).
function hitTier(impact) { return impact > 1400 ? 2 : impact > 650 ? 1 : 0; }
function onMalletHit(x, y, impact, nx, ny) {
  // rally bookkeeping first — the clack pitches up ~3% per hit so long
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
  // hit-stop: 1–2 frames, scaled — the brain reads it as weight
  if (tier >= 1) G.freezeT = Math.max(G.freezeT, Math.min(tier === 2 ? 0.045 : 0.032, 0.010 + v * 0.022));
  addTrauma(tier === 2 ? 0.55 + v * 0.45 : 0.18 + v * 0.5);
  if (tier === 2) {
    if (fxFlash()) { G.hitFlash = 0.8; G.hitFlashX = x; G.hitFlashY = y; }
    if (fxRoom()) G.roomPulse = 1;
    buzz([15, 30, 25]);
  }
  // puck squash along the impact normal, 10–20%
  G.puckSq = 1 - (0.10 + v * 0.10);
  G.puckSqA = Math.atan2(ny, nx);
  burst(x, y, Math.max(1, Math.round((5 + v * 12) * fxp)), THEME.particle, 200 + v * 480);
  if (tier === 2) burst(x, y, Math.max(1, Math.round(10 * fxp)), '#ffffff', 500 + v * 500, 3);
  // permanence: hard hits leave a fading scuff on the cloth
  if (impact > 900 && G.scuffs.length < 48) {
    G.scuffs.push({ x, y, a: 0.20, ang: Math.atan2(ny, nx) + Math.PI / 2, len: 26 + v * 40 });
  }
  AudioSys.hit(v, 1 + Math.min(rallyN, 12) * 0.03);
  if (v > 0.55) buzz(12);
}
function onRailHit(x, y, impact, isPost) {
  const v = clamp(impact / 2200, 0, 1);
  if (impact > 1100) { G.freezeT = Math.max(G.freezeT, 0.012); addTrauma(0.12 + v * 0.2); }
  if (impact > 300) burst(x, y, Math.max(1, Math.round((3 + v * 6) * fxParticles())), THEME.particle, 140 + v * 260, 2.5);
  if (isPost && impact > 200) {
    // the goal frame rings — a distinct metallic ping plus a bright kiss
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
  G.mode = mode; G.difficulty = diff == null ? G.difficulty : diff;
  G.score = [0, 0]; G.winSide = 0;
  G.demo = false; G.idleT = 0;
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  G.scuffs.length = 0; G.texts.length = 0;
  resetPositions();
  G.ai2 = mkBrain(1, G.difficulty);
  G.ai1 = (mode === '2p') ? null : mkBrain(0, G.difficulty); // demo brain, unused in 1p
  G.stats = freshStats(); G.stats.t0 = performance.now();
  pointers.clear();
  hideAll();
  $('menu').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  startCount();
  G.serveDir = Math.random() < 0.5 ? 1 : -1;
  // ONLINE: the host's countdown mirrors to the guest so both start even
  if (mode === 'online' && Net.role === 'host') Net.sendCountdown();
}
function startCount() {
  G.state = 'count'; G.countT = 0; G.countN = 3; G.goPlayed = false;
  G.puck.x = CX; G.puck.y = CY; G.puck.vx = 0; G.puck.vy = 0;
  G.trail.length = 0;
}
function updateCount(rdt) {
  G.countT += rdt;
  const n = 3 - Math.floor(G.countT / 0.55);
  if (n !== G.countN && n >= 1) { G.countN = n; AudioSys.count(false); }
  if (G.countT >= 1.65 && !G.goPlayed) { G.goPlayed = true; AudioSys.count(true); }
  if (G.countT >= 2.0) {
    G.goPlayed = false;
    G.state = 'play';
    // serve toward the player who was scored on — the classic face-off courtesy
    G.puck.vx = paceServe() * G.serveDir; G.puck.vy = rnd(-160, 160);
  }
}
function onGoal(scorer) {
  if (G.demo) { // attract mode: no ceremony, just play on
    burst(G.puck.x, G.puck.y, 24, THEME.particle, 420);
    AudioSys.hit(0.8);
    resetPositions();
    G.puck.vx = paceServe() * (Math.random() < 0.5 ? 1 : -1);
    return;
  }
  if (G.state !== 'play') return;
  // ONLINE: the host owns the simulation; a guest never scores locally.
  if (G.mode === 'online' && Net.role !== 'host') return;
  G.score[scorer]++; // the single place a goal changes the score
  beginGoalCeremony(scorer); // visuals only — never scores, never sends
  if (G.mode === 'online') Net.sendGoal(scorer); // ONLINE: tell the guest to play it
}
// ONLINE: start the goal ceremony visuals only — no scoring, no sending.
// The host scores first in onGoal; the guest's scores arrive final in the
// goal event. Splitting it this way makes double-counting impossible.
// Goal hierarchy: YOUR goals get the full treatment (confetti storm, frame
// flash, deeper chord); conceded goals are a smaller, dimmer affair.
function goalIsYours(scorer) {
  if (G.mode === '2p') return true; // both ends are players — both celebrate
  if (G.mode === 'online') return (Net.role === 'host') === (scorer === 0);
  return scorer === 0;
}
function confettiColors() {
  return [THEME.gold || '#d8a93f', THEME.particle, '#ffffff', THEME.ink].filter(Boolean);
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
  $('topbar').classList.add('hidden'); // ceremony is cinematic — no mis-taps
  const gx = scorer === 0 ? PX + PW : PX;
  const fxp = fxParticles();
  burst(gx, CY, Math.max(4, Math.round(46 * fxp)), THEME.particle, 620, 4.5);
  burst(gx, CY, Math.max(2, Math.round(20 * fxp)), '#ffffff', 380, 3);
  if (!PRM.reduce) {
    // theme-colored confetti storm — bigger when YOU score
    const cols = confettiColors();
    const n = Math.round((yours ? 90 : 36) * fxp);
    for (let c = 0; c < 3; c++) burst(gx, CY, Math.max(1, Math.round(n / 3)), cols[c % cols.length], 380 + c * 160, 4 + c);
  }
  addTrauma(0.85);
  addText(gx + (scorer === 0 ? -130 : 130), CY - 120, '+1', THEME.gold || '#d8a93f', 52);
  AudioSys.goalChord(THEME.goalChord || [523.25, 659.25, 783.99, 1046.5]);
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
      G.serveDir = G.goalSide === 0 ? 1 : -1;
      $('topbar').classList.remove('hidden');
      startCount();
      // ONLINE: the host's countdown mirrors to the guest so both start even
      if (G.mode === 'online' && Net.role === 'host') Net.sendCountdown();
    }
  }
}
function showWin() {
  clearCeremony(); // defensive: no ceremony visuals leak under the overlay
  $('topbar').classList.add('hidden');
  const you = G.winSide === 0;
  $('winTitle').textContent = G.mode === '2p'
    ? (you ? 'Player One wins' : 'Player Two wins')
    : G.mode === 'online' // ONLINE: labels by role, not by side
    ? (onlineSideLabel(G.winSide) === 'YOU' ? 'You win' : 'Rival wins')
    : (you ? 'You win' : DIFFS[G.difficulty].name + ' wins');
  $('winSub').textContent = G.score[0] + ' — ' + G.score[1];
  // match stats: top puck speed (table-scale km/h), longest rally, duration
  try {
    const st = G.stats || freshStats();
    const kmh = st.topSpeed * (2.4384 / PW) * 3.6; // 8ft table mapping
    const secs = Math.max(1, Math.round((performance.now() - st.t0) / 1000));
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    $('winStats').textContent = 'Top puck ' + Math.round(kmh) + ' km/h · Longest rally ' +
      st.bestRally + ' · ' + mm + ':' + ss;
  } catch (e) {}
  hideAll(); $('winov').classList.remove('hidden');
  AudioSys.goalChord([392, 523.25, 659.25, 783.99, 1046.5]);
  // slow theme-colored confetti rain over the win card (DOM — the card
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
  // ONLINE: silent=true applies a pause that arrived over the wire — it must
  // not echo back, or the two clients would ping-pong pause events forever.
  if (G.state === 'play' || G.state === 'count') {
    G.pausedFrom = G.state; G.state = 'pause';
    hideAll(); $('pauseov').classList.remove('hidden');
    AudioSys.ui();
    if (G.mode === 'online' && !silent) Net.sendPause(true);
  } else if (G.state === 'pause' && force !== true) {
    G.state = G.pausedFrom;
    hideAll();
    if (G.state === 'play' || G.state === 'count') $('topbar').classList.remove('hidden');
    if (G.mode === 'online' && !silent) Net.sendPause(false);
  }
}
function quitToMenu() {
  if (G.mode === 'online') Net.leave(); // ONLINE: leave the room first — leave() resets mode
  G.state = 'menu'; G.idleT = 0; G.demo = false;
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  pointers.clear();
  resetPositions();
  hideAll(); $('menu').classList.remove('hidden');
  $('topbar').classList.add('hidden');
  AudioSys.ui();
}
function hideAll() {
  // ONLINE: online overlays are part of the overlay stack too
  for (const id of ['menu', 'help', 'settings', 'pauseov', 'winov', 'onlineov', 'onlinedropov']) $(id).classList.add('hidden');
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
      // ONLINE: host-only branch — the guest never reaches playStep (see
      // frame). The host drives m1; m2's target arrives over the wire.
      driveMallet(G.m1, sdt, PLAYER_CAP);
    } else {
      if (pointers.size > 0) driveMallet(G.m1, sdt, PLAYER_CAP);
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
  if (G.freezeT > 0) { G.freezeT -= rdt; render(); return; } // hit-stop
  G.trauma = Math.max(0, G.trauma - rdt * 1.7);
  // juice timers decay every frame, whatever the state
  G.hitFlash = Math.max(0, G.hitFlash - rdt * 3);
  G.roomPulse = Math.max(0, G.roomPulse - rdt * 1.4);
  G.saveT = Math.max(0, G.saveT - rdt);
  G.nearCd = Math.max(0, G.nearCd - rdt);
  G.dipT = Math.max(0, G.dipT - rdt);
  if (G.missGlow) { G.missGlow.t -= rdt; if (G.missGlow.t <= 0) G.missGlow = null; }
  tickBoard(rdt); // scoreboard flip/reel/peg/bulb animation
  switch (G.state) {
    case 'menu':
      // ONLINE: no attract demo while the online lobby is up — mode is
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
      // ONLINE: each side drives only their own mallet during the countdown
      else if (G.mode === 'online') { driveMallet(Net.role === 'host' ? G.m1 : G.m2, rdt, PLAYER_CAP); }
      else { if (pointers.size > 0) driveMallet(G.m1, rdt, PLAYER_CAP); aiDrive(G.ai2, rdt, G.m2); }
      updateParts(rdt);
      break;
    case 'play':
      // ONLINE: the guest does not simulate — the host owns the physics.
      // The guest only drives their own mallet; puck and rival mallet arrive
      // over the wire (dead-reckoned in Net.pump).
      // Near-miss dip: the reserved channel is goals' slow-mo, but a 0.22s
      // 0.55x dip on a post kiss is a different, smaller beat — never overlaps
      // the ceremony (state leaves 'play' first).
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

function render() {
  const dpr = view.dpr || 1, w = view.w, h = view.h, s = view.s;
  // the room: pre-rendered on theme change / resize — one drawImage, no shake
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (G.roomCanvas) ctx.drawImage(G.roomCanvas, 0, 0, w, h);
  else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  // room reactivity: a SMASH startles the room — a warm lamp-glow swells and
  // sways gently overhead, always in the theme's own gold
  if (G.roomPulse > 0.01 && fxRoom()) {
    const lx = w / 2 + Math.sin(perfNow() * 2.1) * w * 0.06 * G.roomPulse;
    const rg = ctx.createRadialGradient(lx, h * 0.04, 10, lx, h * 0.04, h * 0.55);
    rg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.20 * G.roomPulse));
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  // trauma shake: slight rotation + translation (rotation reads as force)
  const sh = shakeOffset();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (!view.portrait) { ctx.translate(view.ox, view.oy); ctx.scale(s, s); }
  else ctx.transform(0, -s, -s, 0, view.ox + s * VH, view.oy + s * VW);

  // goal zoom: ease toward the mouth during the ceremony (playfield only)
  ctx.save();
  if (G.letterT > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const z = 1 + 0.10 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.translate(gx, CY); ctx.scale(z, z); ctx.translate(-gx, -CY);
  }

  // ONLINE: the guest plays from their own side, so the playfield mirrors —
  // their mallet and goal sit where the host's do. Everything above the
  // playfield (scoreboard, ceremony type, ribbon) stays unflipped.
  ctx.save();
  if (G.onlineFlip) { ctx.translate(VW, 0); ctx.scale(-1, 1); }

  // table shadow + rails + surface
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 22;
  ctx.fillStyle = '#000';
  rr(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); ctx.fill();
  ctx.restore();
  THEME.drawRails(ctx);
  THEME.drawSurface(ctx);
  THEME.drawMarkings(ctx);

  // scuffs (permanence)
  for (const sc of G.scuffs) {
    ctx.save(); ctx.translate(sc.x, sc.y); ctx.rotate(sc.ang);
    ctx.fillStyle = 'rgba(10,8,6,' + sc.a.toFixed(3) + ')';
    ctx.fillRect(-sc.len / 2, -1.6, sc.len, 3.2);
    ctx.restore();
  }

  // puck trail
  const tr = G.trail;
  if (tr.length > 1) {
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = (i / tr.length) * 0.35;
      ctx.strokeStyle = THEME.trail;
      ctx.globalAlpha = a;
      ctx.lineWidth = 2 + (i / tr.length) * 8;
      ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
    }
    ctx.restore();
  }

  // speed lines: above 1500 the trail alone undersells it — theme-colored
  // streaks stretch back along the velocity vector
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
      ctx.globalAlpha = Math.max(0.06, 0.28 - i * 0.04);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(G.puck.x - cvx * (PUCK_R + 6) + ox, G.puck.y - svx * (PUCK_R + 6) + oy);
      ctx.lineTo(G.puck.x - cvx * (PUCK_R + 6 + len) + ox, G.puck.y - svx * (PUCK_R + 6 + len) + oy);
      ctx.stroke();
    }
    ctx.restore();
  }

  THEME.drawGoalTrim(ctx, 0, PX, CY, GOAL_W);
  THEME.drawGoalTrim(ctx, 1, PX + PW, CY, GOAL_W);

  // goal-frame flash: the scored-on frame lights up in theme gold
  if (G.goalFrameT > 0 && fxFlash()) {
    const fgx = G.goalSide === 0 ? PX + PW : PX;
    ctx.save();
    ctx.globalAlpha = G.goalFrameT * 0.9;
    ctx.strokeStyle = THEME.gold || '#d8a93f'; ctx.lineWidth = 5;
    rr(ctx, fgx - 16, CY - GOAL_W / 2 - 16, 32, GOAL_W + 32, 16); ctx.stroke();
    ctx.restore();
  }
  // near-miss post glow: the kissed posts smolder briefly
  if (G.missGlow && fxFlash()) {
    const mgx = G.missGlow.side === 0 ? PX : PX + PW;
    ctx.save();
    ctx.globalAlpha = clamp(G.missGlow.t / 0.7, 0, 1) * 0.8;
    ctx.fillStyle = THEME.gold || '#d8a93f';
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.arc(mgx, CY + sgn * GOAL_W / 2, 10, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawPuck(ctx);
  drawMallet(ctx, G.m1);
  drawMallet(ctx, G.m2);

  // mallet motion trails on fast flicks (recorded in driveMallet)
  for (const m of [G.m1, G.m2]) {
    const tr = m.trail;
    for (let i = 0; i < tr.length; i++) {
      const a = (i / tr.length) * 0.30 * fxTrail();
      if (a <= 0.01) continue;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = THEME.trail;
      ctx.beginPath(); ctx.arc(tr[i].x, tr[i].y, m.r * (0.35 + 0.55 * i / tr.length), 0, TAU); ctx.fill();
      ctx.restore();
    }
    // possession readability: sustained gentle contact (>0.4s) draws a soft
    // ring under the puck — it reads as control, never as a stuck puck
    if (m.glueT > 0.4) {
      const pr = PUCK_R + 12 + Math.sin(perfNow() * 6) * 3;
      ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = THEME.gold || '#d8a93f';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(G.puck.x, G.puck.y, pr, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  // particles as motion streaks
  ctx.save(); ctx.lineCap = 'round';
  for (const q of PPOOL) {
    if (!q.on) continue;
    const a = clamp(q.life / q.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.strokeStyle = q.color;
    ctx.lineWidth = q.size * a + 0.5;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
    ctx.stroke();
  }
  ctx.restore();

  // save-moment ring pulses: a soft expanding ring where the block happened
  for (const q of G.pulses) {
    const k = q.t / 0.6;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.7;
    ctx.strokeStyle = THEME.gold || '#d8a93f';
    ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(q.x, q.y, 30 + k * 90, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // goal flash
  if (G.flashA > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const g = ctx.createRadialGradient(gx, CY, 10, gx, CY, 420);
    const fc = THEME.flash || 'rgba(216,169,63,1)';
    g.addColorStop(0, fc); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.globalAlpha = G.flashA * 0.55; ctx.fillStyle = g;
    ctx.fillRect(gx - 430, CY - 430, 860, 860);
    ctx.restore();
  }

  // SMASH-tier impact flash: a hard white-gold pop exactly where it landed
  if (G.hitFlash > 0 && fxFlash()) {
    const hg = ctx.createRadialGradient(G.hitFlashX, G.hitFlashY, 8, G.hitFlashX, G.hitFlashY, 260);
    hg.addColorStop(0, 'rgba(255,255,255,' + (0.55 * G.hitFlash).toFixed(3) + ')');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.fillStyle = hg;
    ctx.fillRect(G.hitFlashX - 270, G.hitFlashY - 270, 540, 540);
    ctx.restore();
  }

  // floating texts (positions flip with the playfield; glyphs stay upright)
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = '800 ' + t.size + 'px ' + THEME.font.display;
    ctx.fillStyle = t.color;
    rinkText(ctx, t.str, t.x, t.y); // ONLINE: upright type in the mirrored view
    ctx.restore();
  }
  ctx.restore(); // ONLINE flip

  // countdown — anticipation with a pop
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
    ctx.fillText(label, 0, 0); // screen space — never flipped
    ctx.restore();
  }

  // letterbox + GOAL! — the reserved channel (stable screen space, above the zoom)
  ctx.restore();
  if (G.letterT > 0) {
    const bh = 120 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, VW, bh); ctx.fillRect(0, VH - bh, VW, bh);
    ctx.globalAlpha = clamp((G.letterT - 0.25) * 2.4, 0, 1);
    const zp = easeOutBack(clamp((G.letterT - 0.2) * 1.6, 0, 1));
    ctx.translate(CX, CY); ctx.scale(zp, zp);
    ctx.font = '800 92px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.gold || '#d8a93f';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 30;
    ctx.fillText('GOAL!', 0, -6); // screen space — never flipped
    ctx.restore();
  }

  drawScoreboard(ctx);

  // rally counter: consecutive hits without a goal — shown once it matters,
  // tucked under the match-point ribbon's slot so the two never collide
  if ((G.state === 'play' || G.state === 'count') && !G.demo && G.stats && G.stats.rally >= 4) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px ' + THEME.font.body;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = THEME.gold || '#e9d9a6';
    ctx.fillText('RALLY ×' + G.stats.rally, CX, 108);
    ctx.restore();
  }

  // match-point ribbon — theme-agnostic, sits under the scoreboard
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const t = Settings.firstTo;
    const m0 = G.score[0] === t - 1, m1 = G.score[1] === t - 1;
    if (m0 || m1) {
      const who = (m0 && m1) ? 'NEXT GOAL WINS'
        : G.mode === '2p' ? ((m0 ? 'PLAYER ONE' : 'PLAYER TWO') + ' — MATCH POINT')
        : G.mode === 'online' ? ((m0 ? onlineSideLabel(0) : onlineSideLabel(1)) + ' — MATCH POINT') // ONLINE
        : ((m0 ? 'YOU' : DIFFS[G.difficulty].name.toUpperCase()) + ' — MATCH POINT');
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 12px ' + THEME.font.body;
      const tw = ctx.measureText(who).width;
      const pw = tw + 30, ph = 24, px = CX - pw / 2, py = 66;
      ctx.globalAlpha = 0.92;
      rr(ctx, px, py, pw, ph, 12);
      ctx.fillStyle = 'rgba(10,8,5,0.78)'; ctx.fill();
      ctx.strokeStyle = THEME.gold || '#c9a227'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = THEME.gold || '#e9d9a6';
      ctx.fillText(who, CX, py + ph / 2 + 1);
      ctx.restore();
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
  // velocity stretch above 1500: elongate along travel — but only once the
  // impact squash has recovered, so the two deformations never fight
  const psp = hyp(p.vx, p.vy);
  if (psp > 1500 && G.puckSq > 0.96) {
    const va = Math.atan2(p.vy, p.vx), st = clamp((psp - 1500) / 2800, 0, 1) * 0.30;
    c.rotate(va); c.scale(1 + st, 1 - 0.45 * st); c.rotate(-va);
  }
  c.rotate(G.puckSqA);
  const sq = G.puckSq;
  c.scale(sq, 1 + (1 - sq) * 0.7); // squash along the impact normal
  const g = c.createRadialGradient(-5, -6, 2, 0, 0, PUCK_R);
  g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, PUCK_R, 0, TAU); c.fill();
  c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.ellipse(-5, -7, 4.5, 3, -0.5, 0, TAU); c.fill();
  c.restore();
  // spin cue: a small theme-gold dot rides the puck's rotation when it
  // carries english — the Magnus curve becomes readable before it bends
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
  // shadow
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(m.x + 6, m.y + 10, r, r * 0.9, 0, 0, TAU); c.fill();
  // body
  const g = c.createRadialGradient(m.x - r * 0.3, m.y - r * 0.35, r * 0.1, m.x, m.y, r);
  g.addColorStop(0, S.hi); g.addColorStop(0.6, S.base); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(m.x, m.y, r, 0, TAU); c.fill();
  c.lineWidth = 3; c.strokeStyle = S.ring; c.stroke();
  // dish
  const dg = c.createRadialGradient(m.x - 6, m.y - 8, 2, m.x, m.y, r * 0.62);
  dg.addColorStop(0, S.dishHi); dg.addColorStop(1, S.dish);
  c.fillStyle = dg;
  c.beginPath(); c.arc(m.x, m.y, r * 0.62, 0, TAU); c.fill();
  // knob
  const kg = c.createRadialGradient(m.x - 4, m.y - 5, 1, m.x, m.y, r * 0.30);
  kg.addColorStop(0, S.knobHi); kg.addColorStop(1, S.knob);
  c.fillStyle = kg;
  c.beginPath(); c.arc(m.x, m.y, r * 0.30, 0, TAU); c.fill();
  c.restore();
}

// ---------- themes ----------
const THEME_ORDER = ['deco', 'mid', 'brut', 'bil', 'mem', 'sashi'];
function setTheme(id, silent) {
  if (!THEMES[id]) id = 'deco';
  THEME = THEMES[id];
  document.querySelectorAll('.tslide').forEach(el => {
    el.classList.toggle('sel', el.dataset.theme === id);
    el.setAttribute('aria-selected', el.dataset.theme === id ? 'true' : 'false');
  });
  carSync(id);
  const css = THEME.css, root = document.documentElement.style;
  root.setProperty('--pagebg', css.pageBg);
  root.setProperty('--panel', css.panelBg);
  root.setProperty('--pline', css.panelBorder);
  root.setProperty('--btnbg', css.btnBg);
  root.setProperty('--btnink', css.btnInk);
  root.setProperty('--title', css.title);
  root.setProperty('--sub', css.sub);
  root.setProperty('--ghost', css.ghost);
  root.setProperty('--display', THEME.font.display);
  root.setProperty('--body', THEME.font.body);
  document.title = THEME.name + ' — Atelier Air Hockey';
  paintRoom();
  if (!silent) AudioSys.ui();
}
function paintThumbnails() {
  document.querySelectorAll('canvas[data-thumb]').forEach(cv => {
    const id = cv.dataset.thumb, T = THEMES[id];
    if (!T) return;
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const k = Math.min(W / VW, H / VH);
    c.save();
    c.scale(k, k);
    c.translate((W / k - VW) / 2, (H / k - VH) / 2);
    T.drawRoom(c);
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
    c.fillStyle = '#000'; rr(c, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); c.fill();
    c.restore();
    T.drawRails(c); T.drawSurface(c); T.drawMarkings(c);
    T.drawGoalTrim(c, 0, PX, CY, GOAL_W); T.drawGoalTrim(c, 1, PX + PW, CY, GOAL_W);
    // a mid-rally vignette: puck streaking, mallets poised
    c.save();
    c.strokeStyle = T.trail; c.globalAlpha = 0.5; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(CX - 190, CY + 60); c.quadraticCurveTo(CX, CY - 40, CX + 150, CY + 20); c.stroke();
    c.restore();
    const S = T.puck;
    const g = c.createRadialGradient(CX + 145, CY + 14, 2, CX + 150, CY + 20, PUCK_R);
    g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
    c.fillStyle = g;
    c.beginPath(); c.arc(CX + 150, CY + 20, PUCK_R, 0, TAU); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
    const M = T.mallet;
    const mg = c.createRadialGradient(CX - 285, CY + 108, 4, CX - 290, CY + 114, MALLET_R);
    mg.addColorStop(0, M.hi); mg.addColorStop(0.6, M.base); mg.addColorStop(1, M.edge);
    c.fillStyle = mg;
    c.beginPath(); c.arc(CX - 290, CY + 114, MALLET_R, 0, TAU); c.fill();
    c.lineWidth = 3; c.strokeStyle = M.ring; c.stroke();
    c.fillStyle = M.knob;
    c.beginPath(); c.arc(CX - 290, CY + 114, MALLET_R * 0.3, 0, TAU); c.fill();
    c.restore();
  });
}

// ---------- settings ----------
function setSetting(key, val) {
  if (key === 'sound' || key === 'haptics') val = (val === 'true');
  if (key === 'firstTo') val = parseInt(val, 10);
  Settings[key] = val; saveSettings(); applySettingsToUI();
}
function applySettingsToUI() {
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.classList.toggle('sel', String(Settings[btn.dataset.set]) === btn.dataset.val);
  });
  AudioSys.muted = !Settings.sound;
  const sb = $('btnSound');
  if (sb) {
    sb.classList.toggle('off', !Settings.sound);
    sb.innerHTML = Settings.sound ? '&#9834;' : '&#215;';
  }
  const ff = $('footFirst');
  if (ff) ff.innerHTML = 'First to <b>' + Settings.firstTo + '</b> takes the table';
  const hf = $('helpFirst');
  if (hf) hf.textContent = Settings.firstTo;
}

// ---------- UI wiring ----------
/* table carousel: slides are built from THEME_ORDER so markup stays
   a single source of truth; scroll position <-> selected theme. */
let carGuard = false; // true while we scroll programmatically
function buildCarousel() {
  const track = $('carTrack'), dots = $('carDots');
  if (!track || track.children.length) return;
  THEME_ORDER.forEach((id, i) => {
    const T = THEMES[id];
    const d = document.createElement('div');
    d.className = 'tslide'; d.dataset.theme = id;
    d.setAttribute('role', 'option'); d.tabIndex = 0;
    d.setAttribute('aria-label', T.name + ' table');
    d.innerHTML = '<canvas data-thumb="' + id + '" width="640" height="400"></canvas>' +
      '<div class="tmeta"><div class="tname">' + T.name + '</div>' +
      '<div class="tsub">' + T.tagline + '</div></div>';
    const pick = () => { AudioSys.init(); setTheme(id); };
    d.addEventListener('click', pick);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      if (e.key === 'ArrowRight') carStep(1);
      if (e.key === 'ArrowLeft') carStep(-1);
    });
    track.appendChild(d);
    const dot = document.createElement('i');
    dot.addEventListener('click', () => carGo(i));
    dots.appendChild(dot);
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (carGuard) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(carFromScroll);
  }, { passive: true });
}
function carIndex() {
  const track = $('carTrack');
  if (!track || !track.children.length) return 0;
  const w = track.children[0].offsetWidth + 12;
  return Math.round(track.scrollLeft / w);
}
function carFromScroll() {
  const i = Math.max(0, Math.min(THEME_ORDER.length - 1, carIndex()));
  if (THEMES[THEME_ORDER[i]] !== THEME) setTheme(THEME_ORDER[i]);
  else carPaint(i);
}
function carPaint(i) {
  const dots = $('carDots');
  if (dots) [...dots.children].forEach((d, j) => d.classList.toggle('sel', j === i));
  const cc = $('carCount');
  if (cc) cc.textContent = (i + 1) + ' / ' + THEME_ORDER.length;
}
function carGo(i) {
  const track = $('carTrack');
  if (!track || !track.children.length) return;
  i = (i + THEME_ORDER.length) % THEME_ORDER.length;
  const w = track.children[0].offsetWidth + 12;
  carGuard = true;
  track.scrollTo({ left: i * w, behavior: 'smooth' });
  setTimeout(() => { carGuard = false; }, 450);
  setTheme(THEME_ORDER[i]);
}
function carStep(d) { carGo(carIndex() + d); }
/* called by setTheme — scrolls the track when the theme changed
   from anywhere else (deep link, settings restore). */
function carSync(id) {
  const i = THEME_ORDER.indexOf(id);
  carPaint(Math.max(0, i));
  const track = $('carTrack');
  if (!track || !track.children.length || i < 0) return;
  const w = track.children[0].offsetWidth + 12;
  if (Math.abs(track.scrollLeft - i * w) > 4) {
    carGuard = true;
    track.scrollTo({ left: i * w });
    setTimeout(() => { carGuard = false; }, 120);
  }
}
function wireUI() {
  buildCarousel();
  $('carPrev').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(-1); });
  $('carNext').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(1); });
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => startGame('ai', +btn.dataset.diff));
  });
  $('btn2p').addEventListener('click', () => startGame('2p'));
  // ONLINE: the only entry point that touches the network — the Trystero
  // import happens inside, on the tap, never before.
  $('btnOnline').addEventListener('click', () => Net.openLobby());
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); setSetting(btn.dataset.set, btn.dataset.val); });
  });
  $('btnSettings').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('settings').classList.remove('hidden'); });
  $('settingsClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnHelp').addEventListener('click', () => { AudioSys.ui(); applySettingsToUI(); hideAll(); $('help').classList.remove('hidden'); });
  $('helpClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnPause').addEventListener('click', () => togglePause());
  $('btnResume').addEventListener('click', () => togglePause());
  $('btnQuit').addEventListener('click', quitToMenu);
  // ONLINE: rival-left overlay — back to the menu (leave() runs inside quitToMenu)
  $('dropMenu').addEventListener('click', quitToMenu);
  $('btnRematch').addEventListener('click', () => {
    AudioSys.ui();
    // ONLINE: a rematch needs the rival's accept — the host restarts on accept
    if (G.mode === 'online') Net.offerRematch();
    else startGame(G.mode, G.difficulty);
  });
  $('btnWinMenu').addEventListener('click', quitToMenu);
  $('btnMenu2').addEventListener('click', quitToMenu);
  $('btnSound').addEventListener('click', () => {
    AudioSys.init();
    setSetting('sound', String(!Settings.sound)); // persists; button UI syncs via applySettingsToUI
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'p' || e.key === 'P') togglePause();
    else if (e.key === 'm' || e.key === 'M') $('btnSound').click();
    else if (e.key === 'Escape') {
      if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count') togglePause(true);
      else if (!$('help').classList.contains('hidden')) $('helpClose').click();
      else if (!$('settings').classList.contains('hidden')) $('settingsClose').click();
    }
  });
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let rzT = 0;
  const onResize = () => {
    clearTimeout(rzT);
    rzT = setTimeout(resize, 60);
    resize();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  document.addEventListener('gesturestart', e => e.preventDefault());
}

// ---------- boot ----------
function boot() {
  loadSettings();
  // accessibility: prefers-reduced-motion drops Shake to Subtle for the
  // session — unless the player explicitly chose a shake level — and
  // fxFlash() kills flashes, confetti, and room reactivity from then on.
  try {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      PRM.reduce = true;
      if (!PRM.userShake) Settings.shake = 'subtle';
    }
  } catch (e) {}
  resize(); wireUI(); applySettingsToUI();
  setTheme('deco', true);
  try { paintThumbnails(); } catch (e) { /* thumbnails must never break the game */ }
  resetPositions();
  G.ai1 = mkBrain(0, 1); G.ai2 = mkBrain(1, 1);
  // deep links: ?table=mid&play , ?table=bil&2p , ?demo
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('table') && THEMES[q.get('table')]) setTheme(q.get('table'), true);
    if (q.has('play')) startGame('ai', G.difficulty);
    else if (q.has('2p')) startGame('2p');
    else if (q.has('demo')) { G.idleT = 99; }
    // ONLINE: ?netstub forces the loopback room for headless testing — no
    // network is touched, Trystero is never imported.
    if (q.has('netstub')) Net.useLoopback = true;
  } catch (e) {}
  requestAnimationFrame(frame);
}
document.addEventListener('DOMContentLoaded', boot);
