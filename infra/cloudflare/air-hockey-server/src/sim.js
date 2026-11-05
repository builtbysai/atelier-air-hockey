/* ============================================================================
 * sim.js - headless authoritative table physics for the dedicated server.
 *
 * SOURCE OF TRUTH: src/game.js (driveMallet, clampMallet, collideWalls,
 * collideMallet, glueEscapeDir, contactWrapReleaseNormal, stepPhysics,
 * stallWatch, resetPositions). game.js interleaves this math with sound,
 * particles, highlights and AI, so the browser keeps its copy and this file is
 * the effect-free port. The two are pinned together by
 * tests/net-server-parity.test.mjs, which runs the REAL game.js functions
 * and these through identical scripted matches and fails on any divergence.
 * Any change to those game.js functions MUST be mirrored here.
 *
 * What is NOT duplicated: the mallet/puck impulse solver, the contact-hint
 * validator, the history ring and the wire codecs. Those live once, in the
 * SHARED-SIM region of src/net.js, which build.mjs splices into the bundle
 * directly (so every call below to solveMalletImpulse-family functions is the
 * client's own code).
 *
 * Pure: no timers, no I/O, no globals except the physics constants below.
 * Constants are asserted equal to game.js by tests/net-physics-contract.test.mjs.
 * ==========================================================================*/

const PX = 200, PY = 200, PW = 1040, PH = 640;
const CX = PX + PW / 2, CY = PY + PH / 2;
const PUCK_R = 26, MALLET_R = 46;
const PUCK_MAX = 3100;
const SMACK_BONUS = 0.55;
const PLAYER_CAP = 4200;
const SUB_HZ = 240;
const STALL_V = 130, STALL_T = 1.4;
const GLUE_HARD_CUTOFF = 1.2;
const PACES = {
  casual:    { damp: 0.22,  wall: 0.88, serve: 560 },
  classic:   { damp: 0.09,  wall: 0.95, serve: 780 },
  lightning: { damp: 0.045, wall: 0.99, serve: 980 },
};
const GOAL_WIDTHS = [170, 200, 230]; // narrow | standard | wide
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const hyp = Math.hypot;

function simMallet(side) {
  return {
    side, x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, r: MALLET_R,
    glueT: 0, ghostT: 0, touching: false, saveCd: 0,
    contactActive: false, contactStartedGoalward: false,
  };
}

function simWorld(opts = {}) {
  const pace = PACES[opts.pace] || PACES.classic;
  const w = {
    damp: pace.damp, wall: pace.wall, serve: pace.serve,
    goalW: GOAL_WIDTHS.includes(opts.goalW) ? opts.goalW : 200,
    rng: typeof opts.rng === 'function' ? opts.rng : Math.random,
    m: [simMallet(0), simMallet(1)],
    puck: null,
    stallT: 0, stallX: CX, stallY: CY, anchorT: 0, lastTouch: -1,
  };
  simResetPositions(w);
  return w;
}

function simResetPositions(w) {
  const [m1, m2] = w.m;
  m1.x = m1.tx = PX + 170; m1.y = m1.ty = CY;
  m2.x = m2.tx = PX + PW - 170; m2.y = m2.ty = CY;
  m1.vx = m1.vy = m2.vx = m2.vy = 0;
  for (const m of w.m) { m.glueT = 0; m.ghostT = 0; m.touching = false; m.contactActive = false; m.contactStartedGoalward = false; }
  w.puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R, w: 0, ang: 0 };
  w.stallT = 0; w.lastTouch = -1;
  w.stallX = CX; w.stallY = CY; w.anchorT = 0;
}

/* Serve roll, same flavors and odds as game.js rollServe(); returns the vector. */
function simRollServe(w, dir) {
  const sp = w.serve, rnd = w.rng, roll = rnd();
  let ang, speed;
  if (roll < 0.10) { ang = (60 + rnd() * 16) * (rnd() < 0.5 ? 1 : -1); speed = sp * (0.92 + rnd() * 0.16); }
  else if (roll < 0.22) { ang = (rnd() - 0.5) * 50; speed = sp * (0.52 + rnd() * 0.14); }
  else if (roll < 0.50) { ang = (rnd() - 0.5) * 64; speed = sp * (0.90 + rnd() * 0.20); }
  else { ang = (rnd() - 0.5) * 16; speed = sp * (0.95 + rnd() * 0.22); }
  const a = ang * Math.PI / 180;
  return { dir, vx: Math.cos(a) * speed * dir, vy: Math.sin(a) * speed };
}

function simClampMallet(m) {
  const r = m.r;
  if (m.side === 0) m.x = clamp(m.x, PX + r, CX - 8);
  else m.x = clamp(m.x, CX + 8, PX + PW - r);
  m.y = clamp(m.y, PY + r, PY + PH - r);
  m.tx = clamp(m.tx, m.side === 0 ? PX + r : CX + 8, m.side === 0 ? CX - 8 : PX + PW - r);
  m.ty = clamp(m.ty, PY + r, PY + PH - r);
}

/* Side-bounded target, the same clamp Net.onInput applies to a remote target. */
function simClampTarget(side, x, y) {
  const lo = side === 0 ? PX + MALLET_R : CX + 8;
  const hi = side === 0 ? CX - 8 : PX + PW - MALLET_R;
  return { x: clamp(x, lo, hi), y: clamp(y, PY + MALLET_R, PY + PH - MALLET_R) };
}

function simDriveMallet(m, dt, cap) {
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
  simClampMallet(m);
}

function simCollideWalls(w) {
  const p = w.puck, r = p.r;
  if (p.y < PY + r) {
    p.y = PY + r;
    if (p.vy < 0) { p.vy = -p.vy * w.wall; p.vx *= 0.995; }
  } else if (p.y > PY + PH - r) {
    p.y = PY + PH - r;
    if (p.vy > 0) { p.vy = -p.vy * w.wall; p.vx *= 0.995; }
  }
  const inMouth = Math.abs(p.y - CY) < w.goalW / 2 - 6;
  if (p.x < PX + r && !inMouth) {
    p.x = PX + r;
    if (p.vx < 0) { p.vx = -p.vx * w.wall; p.vy *= 0.995; }
  } else if (p.x > PX + PW - r && !inMouth) {
    p.x = PX + PW - r;
    if (p.vx > 0) { p.vx = -p.vx * w.wall; p.vy *= 0.995; }
  }
}

function simGlueEscapeDir(w, p, nx, ny) {
  const nearT = p.y < PY + 70, nearB = p.y > PY + PH - 70;
  const nearL = p.x < PX + 70, nearR = p.x > PX + PW - 70;
  const inMouthY = Math.abs(p.y - CY) < w.goalW / 2;
  let rx = nx, ry = ny, railed = false;
  if (nearT && ry < 0) { ry = 0; railed = true; }
  if (nearB && ry > 0) { ry = 0; railed = true; }
  if (nearL && rx < 0 && !inMouthY) { rx = 0; railed = true; }
  if (nearR && rx > 0 && !inMouthY) { rx = 0; railed = true; }
  if (railed) {
    if (nearT || nearB) { rx = (p.x - PX) < (PX + PW - p.x) ? 1 : -1; ry = 0; }
    else { rx = 0; ry = (p.y - PY) < (PY + PH - p.y) ? 1 : -1; }
  }
  return { rx, ry, railed, nearT, nearB, nearL, nearR };
}

function simWrapReleaseNormal(m, p, nx, ny) {
  const goalSign = m.side === 0 ? -1 : 1;
  const goalward = goalSign * (p.x - m.x);
  if (!m.contactActive) { m.contactStartedGoalward = goalward > 6; return null; }
  if (m.contactStartedGoalward || goalward <= 4) return null;
  const sx = -goalSign * 0.18;
  const sySign = Math.abs(ny) > 0.08 ? Math.sign(ny) : 1;
  return { nx: sx, ny: sySign * Math.sqrt(1 - sx * sx) };
}

/* hooks: {touch(side), rally(side), save(side)} - all optional. `touch` fires
 * once per leading-edge contact episode (and for glue / wrap releases), which is
 * exactly where game.js calls Net.noteTouch(). */
function simCollideMallet(w, m, dt, hooks) {
  const p = w.puck;
  const dx = p.x - m.x, dy = p.y - m.y;
  const minD = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (m.ghostT > 0) { m.glueT = 0; m.contactActive = false; m.contactStartedGoalward = false; return; }
  if (d2 >= minD * minD || d2 === 0) { m.contactActive = false; m.contactStartedGoalward = false; return; }
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  const preTouchVx = p.vx, preTouchVy = p.vy;
  m.touching = true;

  const wrapRelease = simWrapReleaseNormal(m, p, nx, ny);
  if (wrapRelease) {
    const goalSign = m.side === 0 ? -1 : 1;
    const clear = clamp(Math.max(420, Math.abs(preTouchVx) * 0.45, hyp(m.vx, m.vy) * 0.22), 420, 900);
    p.x = m.x + wrapRelease.nx * minD;
    p.y = m.y + wrapRelease.ny * minD;
    p.vx = -goalSign * clear;
    p.vy = clamp(preTouchVy + wrapRelease.ny * 160, -1200, 1200);
    p.w *= 0.45;
    m.glueT = 0; m.ghostT = 0.08; m.touching = false;
    m.contactActive = false; m.contactStartedGoalward = false;
    w.lastTouch = m.side; w.stallT = 0;
    if (hooks.touch) hooks.touch(m.side);
    return;
  }
  const vn0 = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  const mvn0 = m.vx * nx + m.vy * ny;
  if (-vn0 + Math.max(0, mvn0) > 650) m.glueT = 0;
  else m.glueT += dt;
  if (m.glueT > GLUE_HARD_CUTOFF) {
    const { rx: rx0, ry: ry0, railed, nearT, nearB, nearL } = simGlueEscapeDir(w, p, nx, ny);
    let rx = rx0, ry = ry0;
    if (!railed) {
      p.x = m.x + nx * minD; p.y = m.y + ny * minD;
      p.vx = nx * 560; p.vy = ny * 560;
      if (hooks.rally) hooks.rally(m.side);
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
      if (hooks.rally) hooks.rally(m.side);
    }
    m.glueT = 0; m.contactActive = false; w.lastTouch = m.side;
    if (hooks.touch) hooks.touch(m.side);
    return;
  }
  // normal contact: positional separation + the SHARED impulse solver
  p.x = m.x + nx * minD; p.y = m.y + ny * minD;
  const pvx0 = p.vx;
  const hit = malletImpulseVelocity({ puckVx: p.vx, puckVy: p.vy, malletVx: m.vx, malletVy: m.vy, nx, ny });
  if (!hit) { m.contactActive = false; m.contactStartedGoalward = false; return; }
  const { vn, mvn, msp: msp0 } = hit;
  p.vx = hit.vx; p.vy = hit.vy;
  const limited = limitMalletRebound(p.vx, p.vy, nx, ny, msp0);
  p.vx = limited.vx; p.vy = limited.vy;
  p.w = clamp((p.w || 0) + malletSpinDelta(m.vx, m.vy, p.vx, p.vy, nx, ny), -12, 12);
  w.lastTouch = m.side;
  w.stallT = 0;
  if (!m.contactActive) {
    if (hooks.touch) hooks.touch(m.side);
    const impact = -vn + Math.max(0, mvn);
    const inboundSave = m.side === 0 ? pvx0 < -450 : pvx0 > 450;
    const onOwnHalf = m.side === 0 ? p.x < CX : p.x > CX;
    if (m.saveCd <= 0 && impact > 320 && inboundSave && onOwnHalf) {
      m.saveCd = 0.9;
      if (hooks.save) hooks.save(m.side);
    }
    if (hooks.rally) hooks.rally(m.side);
  }
  m.contactActive = true;
}

function simStallWatch(w, dt) {
  const p = w.puck;
  if (hyp(p.x - w.stallX, p.y - w.stallY) > 90) {
    w.stallX = p.x; w.stallY = p.y; w.anchorT = 0;
  } else {
    w.anchorT += dt;
    if (w.anchorT > 2.6) {
      w.anchorT = 0; w.stallX = p.x; w.stallY = p.y;
      const dx = CX - p.x, dy = CY - p.y, dl = hyp(dx, dy) || 1;
      p.vx = dx / dl * 430; p.vy = dy / dl * 430;
    }
  }
  const sp = hyp(p.vx, p.vy);
  if (sp < STALL_V) {
    w.stallT += dt;
    if (w.stallT > STALL_T) {
      w.stallT = 0;
      const dir = w.rng() < 0.5 ? 1 : -1;
      const ang = (w.rng() < 0.75 ? 0 : Math.PI) + (w.rng() - 0.5) + (dir > 0 ? 0 : Math.PI);
      const push = 380;
      p.vx += Math.cos(ang) * push; p.vy += Math.sin(ang) * push * 0.6;
    }
  } else w.stallT = 0;
}

/* One physics substep (play only). Returns the scorer (0 = puck into the right
 * goal, 1 = left goal) or -1. `stats` receives topSpeed. */
function simStepPhysics(w, dt, hooks, stats) {
  const p = w.puck;
  const damp = Math.exp(-w.damp * dt);
  p.vx *= damp; p.vy *= damp;
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
  if (stats) { const sp = hyp(p.vx, p.vy); if (sp > stats.topSpeed) stats.topSpeed = sp; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  for (let mi = 0; mi < 2; mi++) {
    const m = w.m[mi];
    if (m.ghostT > 0) m.ghostT -= dt;
    if (m.saveCd > 0) m.saveCd -= dt;
    if (!m.touching) m.glueT = Math.max(0, m.glueT - dt * 2);
    m.touching = false;
  }
  simCollideMallet(w, w.m[0], dt, hooks);
  simCollideMallet(w, w.m[1], dt, hooks);
  simCollideWalls(w);
  let scorer = -1;
  if (p.x > PX + PW + p.r * 0.35 && Math.abs(p.y - CY) < w.goalW / 2) scorer = 0;
  else if (p.x < PX - p.r * 0.35 && Math.abs(p.y - CY) < w.goalW / 2) scorer = 1;
  if (scorer < 0) simStallWatch(w, dt);
  return scorer;
}
