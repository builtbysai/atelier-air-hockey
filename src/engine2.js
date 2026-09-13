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
};
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('atelier-ah-settings') || '{}');
    for (const k of Object.keys(Settings)) if (s[k] !== undefined) Settings[k] = s[k];
  } catch (e) {}
  if (![5, 7, 11].includes(Settings.firstTo)) Settings.firstTo = 7;
  if (!['off', 'subtle', 'full'].includes(Settings.shake)) Settings.shake = 'full';
  if (!['casual', 'classic', 'lightning'].includes(Settings.pace)) Settings.pace = 'classic';
}
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
  // layered clack: noise transient + tonal body, pitch mapped to impact, ±5% variance
  hit(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, vr = 1 + rnd(-0.05, 0.05);
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
const DIFFS = [
  { name: 'Rookie',   maxSpeed: 780,  react: 0.30, aimErr: 120, strike: 0.62, aggro: 0.35, tick: 0.14 },
  { name: 'Club Pro', maxSpeed: 1180, react: 0.15, aimErr: 55,  strike: 1.00, aggro: 0.70, tick: 0.09 },
  { name: 'Champion', maxSpeed: 1520, react: 0.06, aimErr: 22,  strike: 1.32, aggro: 0.95, tick: 0.06 },
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
  stallT: 0, lastTouch: -1,
  idleT: 0, demo: false,
  serveDir: 1,
  pausedFrom: 'play',
  scuffs: [], parts: [], trail: [], texts: [],
  puckSq: 1, puckSqA: 0,    // squash amount / angle
  letterT: 0, flashA: 0,
  ai: null,                 // per-ai brain state
  stats: null,              // per-match stats (top speed, rally, time)
};
function freshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, t0: 0 }; }
G.stats = freshStats();
const pointers = new Map(); // pointerId -> side (0 left/player, 1 right)

function mkMallet(side) {
  return {
    side, x: 0, y: 0, tx: 0, ty: 0,
    vx: 0, vy: 0,             // smoothed velocity (for strike transfer)
    r: MALLET_R,
  };
}
function resetPositions() {
  const m1 = G.m1, m2 = G.m2;
  m1.x = m1.tx = PX + 170; m1.y = m1.ty = CY;
  m2.x = m2.tx = PX + PW - 170; m2.y = m2.ty = CY;
  m1.vx = m1.vy = m2.vx = m2.vy = 0;
  G.puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R };
  G.trail.length = 0; G.stallT = 0; G.lastTouch = -1;
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
}
// client px -> rink coords (inverse of render transform)
function screenToRink(cx, cy) {
  const { s, ox, oy, portrait } = view;
  const u = (cx - ox) / s, v = (cy - oy) / s;
  if (!portrait) return { x: u, y: v };
  return { x: VW - v, y: VH - u };
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
  if (G.mode === '2p' && !pointers.has(e.pointerId)) {
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
  if (p.x < PX + r && !inMouth) {
    p.x = PX + r;
    if (p.vx < 0) { const imp = -p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX, p.y, imp); }
  } else if (p.x > PX + PW - r && !inMouth) {
    p.x = PX + PW - r;
    if (p.vx > 0) { const imp = p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX + PW, p.y, imp); }
  }
}

// mallet is kinematic (infinite mass): positional separation + impulse
// with full mallet-velocity transfer, so flicks become rockets.
function collideMallet(p, m) {
  const dx = p.x - m.x, dy = p.y - m.y;
  const minD = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= minD * minD || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
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
  G.lastTouch = m.side;
  G.stallT = 0;
  onMalletHit(p.x, p.y, -vn + Math.max(0, mvn), nx, ny);
}

function stepPhysics(dt) {
  const p = G.puck;
  // glide: near-zero friction, like air jets (pace setting tunes the table)
  const damp = Math.exp(-paceDamp() * dt);
  p.vx *= damp; p.vy *= damp;
  // match stats: fastest the puck ever flies (table-scale km/h later)
  if (G.state === 'play' && !G.demo) {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > G.stats.topSpeed) G.stats.topSpeed = sp;
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  collideMallet(p, G.m1);
  collideMallet(p, G.m2);
  collideWalls(p);
  // goals: full crossing of the line inside the mouth
  if (p.x > PX + PW + p.r * 0.35 && Math.abs(p.y - CY) < GOAL_W / 2) onGoal(0);
  else if (p.x < PX - p.r * 0.35 && Math.abs(p.y - CY) < GOAL_W / 2) onGoal(1);
  // anti-stall: a real table never lets the puck die mid-rink — a whisper
  // of air from the jets keeps the game alive
  if (G.state === 'play') stallWatch(dt);
  // trail
  G.trail.push({ x: p.x, y: p.y });
  if (G.trail.length > 16) G.trail.shift();
  // squash recovery
  G.puckSq += (1 - G.puckSq) * Math.min(1, dt * 9);
}

// Anti-stall: air jets. A dead puck never sits — shared by live play and the
// attract demo so neither can freeze mid-rink.
function stallWatch(dt) {
  const p = G.puck;
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
    cornerT: 0, swayT: rnd(10), possessT: 0,
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
      // corner rescue: puck wedged in my corner
      const inCorner = b.side === 0
        ? (s.x < PX + 150 && (s.y < PY + 150 || s.y > PY + PH - 150))
        : (s.x > PX + PW - 150 && (s.y < PY + 150 || s.y > PY + PH - 150));
      if (inCorner && puckSpeed < 260) { b.cornerT += D.tick; if (b.cornerT > 0.9) { b.state = 'escape'; b.tState = 0; b.cornerT = 0; } }
      else b.cornerT = 0;
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
      if (b.windT > 0.11) { b.state = 'strike'; b.tState = 0; }
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
      setTx(px + dx / dl * through, py + dy / dl * through);
      if (b.tState > 0.34) { b.state = 'recover'; b.tState = 0; }
      break;
    }
    case 'recover': {
      goHome();
      if (b.tState > 0.4) { b.state = 'guard'; b.tState = 0; }
      break;
    }
    case 'escape': {
      // swipe along the rail to dig the puck out of the corner
      const dir = s.y < CY ? 1 : -1;
      setTx(s.x + (b.side === 0 ? 60 : -60), s.y + dir * 170);
      if (b.tState > 0.5) { b.state = 'guard'; b.tState = 0; }
      break;
    }
  }
}
function aiDrive(b, dt, m) {
  aiPerceive(b, dt);
  aiThink(b, dt, m);
  driveMallet(m, dt, b.diff.maxSpeed * (b.state === 'strike' ? 1.5 : 1));
}

// ---------- juice ----------
function addTrauma(x) {
  const k = Settings.shake === 'off' ? 0 : Settings.shake === 'subtle' ? 0.45 : 1;
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
}
function addText(x, y, str, color, size = 44) {
  G.texts.push({ x, y, str, color, size, t: 0 });
  if (G.texts.length > 8) G.texts.shift();
}

// impact events — the layered hit stack
function onMalletHit(x, y, impact, nx, ny) {
  const v = clamp(impact / 2200, 0, 1);
  // hit-stop: 1–2 frames, scaled — the brain reads it as weight
  if (impact > 650) G.freezeT = Math.max(G.freezeT, Math.min(0.032, 0.010 + v * 0.022));
  addTrauma(0.18 + v * 0.5);
  // puck squash along the impact normal, 10–20%
  G.puckSq = 1 - (0.10 + v * 0.10);
  G.puckSqA = Math.atan2(ny, nx);
  burst(x, y, 5 + Math.round(v * 12), THEME.particle, 200 + v * 480);
  // permanence: hard hits leave a fading scuff on the cloth
  if (impact > 900 && G.scuffs.length < 48) {
    G.scuffs.push({ x, y, a: 0.20, ang: Math.atan2(ny, nx) + Math.PI / 2, len: 26 + v * 40 });
  }
  AudioSys.hit(v);
  if (v > 0.55) buzz(12);
  // rally stat: count mallet strikes while a real match is live
  if (G.state === 'play' && !G.demo && G.stats) {
    G.stats.rally++;
    if (G.stats.rally > G.stats.bestRally) G.stats.bestRally = G.stats.rally;
  }
}
function onRailHit(x, y, impact) {
  const v = clamp(impact / 2200, 0, 1);
  if (impact > 1100) { G.freezeT = Math.max(G.freezeT, 0.012); addTrauma(0.12 + v * 0.2); }
  if (impact > 300) burst(x, y, 3 + Math.round(v * 6), THEME.particle, 140 + v * 260, 2.5);
  AudioSys.rail(v);
}

// ---------- game flow ----------
function startGame(mode, diff) {
  AudioSys.init(); AudioSys.resume();
  G.mode = mode; G.difficulty = diff == null ? G.difficulty : diff;
  G.score = [0, 0]; G.winSide = 0;
  G.demo = false; G.idleT = 0;
  G.timeScale = 1; G.freezeT = 0; G.trauma = 0;
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
  if (G.state !== 'play') return;
  if (G.demo) { // attract mode: no ceremony, just play on
    burst(G.puck.x, G.puck.y, 24, THEME.particle, 420);
    AudioSys.hit(0.8);
    resetPositions();
    G.puck.vx = paceServe() * (Math.random() < 0.5 ? 1 : -1);
    return;
  }
  G.score[scorer]++;
  G.goalSide = scorer;
  if (G.stats) G.stats.rally = 0; // new rally after each goal
  G.state = 'goal';
  G.goalT = 0; G.goalSlowT = 0; G.letterT = 0;
  G.timeScale = 0.22; // the reserved channel: slow-mo belongs to goals
  G.flashA = 1;
  const gx = scorer === 0 ? PX + PW : PX;
  burst(gx, CY, 46, THEME.particle, 620, 4.5);
  burst(gx, CY, 20, '#ffffff', 380, 3);
  addTrauma(0.85);
  addText(gx + (scorer === 0 ? -130 : 130), CY - 120, '+1', THEME.gold || '#d8a93f', 52);
  AudioSys.goalChord(THEME.goalChord || [523.25, 659.25, 783.99, 1046.5]);
  buzz([25, 40, 40]);
}
function updateGoal(rdt) {
  G.goalT += rdt; G.goalSlowT += rdt;
  G.letterT = clamp(G.letterT + rdt * 3.2, 0, 1);
  G.flashA = Math.max(0, G.flashA - rdt * 2.4);
  if (G.goalSlowT > 1.0) G.timeScale = lerp(G.timeScale, 1, clamp(rdt * 5, 0, 1));
  // ease the puck into the net
  const p = G.puck;
  const gx = G.goalSide === 0 ? PX + PW + 70 : PX - 70;
  p.x = lerp(p.x, gx, clamp(rdt * 5, 0, 1));
  p.y = lerp(p.y, CY, clamp(rdt * 5, 0, 1));
  p.vx *= 0.9; p.vy *= 0.9;
  if (G.goalT > 2.2) {
    G.timeScale = 1; G.letterT = 0; G.flashA = 0;
    if (G.score[0] >= Settings.firstTo || G.score[1] >= Settings.firstTo) {
      G.winSide = G.score[0] > G.score[1] ? 0 : 1;
      G.state = 'win';
      showWin();
    } else {
      resetPositions();
      G.serveDir = G.goalSide === 0 ? 1 : -1;
      startCount();
    }
  }
}
function showWin() {
  const you = G.winSide === 0;
  $('winTitle').textContent = G.mode === '2p'
    ? (you ? 'Player One wins' : 'Player Two wins')
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
}
function togglePause(force) {
  if (G.state === 'play' || G.state === 'count') {
    G.pausedFrom = G.state; G.state = 'pause';
    hideAll(); $('pauseov').classList.remove('hidden');
    AudioSys.ui();
  } else if (G.state === 'pause' && force !== true) {
    G.state = G.pausedFrom;
    hideAll();
    if (G.state === 'play' || G.state === 'count') $('topbar').classList.remove('hidden');
  }
}
function quitToMenu() {
  G.state = 'menu'; G.idleT = 0; G.demo = false;
  G.timeScale = 1; G.trauma = 0;
  pointers.clear();
  resetPositions();
  hideAll(); $('menu').classList.remove('hidden');
  $('topbar').classList.add('hidden');
  AudioSys.ui();
}
function hideAll() {
  for (const id of ['menu', 'help', 'settings', 'pauseov', 'winov']) $(id).classList.add('hidden');
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
  switch (G.state) {
    case 'menu':
      G.idleT += rdt; G.demo = G.idleT > 5;
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
      else { if (pointers.size > 0) driveMallet(G.m1, rdt, PLAYER_CAP); aiDrive(G.ai2, rdt, G.m2); }
      updateParts(rdt);
      break;
    case 'play':
      playStep(rdt * G.timeScale);
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // trauma shake: slight rotation + translation (rotation reads as force)
  const sh = shakeOffset();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (!view.portrait) { ctx.translate(view.ox, view.oy); ctx.scale(s, s); }
  else ctx.transform(0, -s, -s, 0, view.ox + s * VH, view.oy + s * VW);

  THEME.drawRoom(ctx);

  // goal zoom: ease toward the mouth during the ceremony (playfield only)
  ctx.save();
  if (G.letterT > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const z = 1 + 0.10 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.translate(gx, CY); ctx.scale(z, z); ctx.translate(-gx, -CY);
  }

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

  THEME.drawGoalTrim(ctx, 0, PX, CY, GOAL_W);
  THEME.drawGoalTrim(ctx, 1, PX + PW, CY, GOAL_W);

  drawPuck(ctx);
  drawMallet(ctx, G.m1);
  drawMallet(ctx, G.m2);

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

  // floating texts
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = '800 ' + t.size + 'px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = t.color;
    ctx.fillText(t.str, t.x, t.y);
    ctx.restore();
  }

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
    ctx.fillText(label, 0, 0);
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
    ctx.fillText('GOAL!', 0, -6);
    ctx.restore();
  }

  THEME.drawScore(ctx, G.score[0], G.score[1], Settings.firstTo);

  // match-point ribbon — theme-agnostic, sits under the scoreboard
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const t = Settings.firstTo;
    const m0 = G.score[0] === t - 1, m1 = G.score[1] === t - 1;
    if (m0 || m1) {
      const who = (m0 && m1) ? 'NEXT GOAL WINS'
        : G.mode === '2p' ? ((m0 ? 'PLAYER ONE' : 'PLAYER TWO') + ' — MATCH POINT')
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
  c.translate(p.x, p.y); c.rotate(G.puckSqA);
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
function setTheme(id, silent) {
  if (!THEMES[id]) id = 'deco';
  THEME = THEMES[id];
  document.querySelectorAll('.tablecard').forEach(el => {
    el.classList.toggle('sel', el.dataset.theme === id);
  });
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
function wireUI() {
  document.querySelectorAll('.tablecard').forEach(el => {
    const pick = () => { AudioSys.init(); setTheme(el.dataset.theme); };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  });
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => startGame('ai', +btn.dataset.diff));
  });
  $('btn2p').addEventListener('click', () => startGame('2p'));
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
  $('btnRematch').addEventListener('click', () => startGame(G.mode, G.difficulty));
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
  resize(); wireUI(); applySettingsToUI();
  const sel = document.querySelector('.tablecard[data-theme="deco"]');
  if (sel) sel.classList.add('sel');
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
  } catch (e) {}
  requestAnimationFrame(frame);
}
document.addEventListener('DOMContentLoaded', boot);
