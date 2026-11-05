// The dedicated server's physics (infra/cloudflare/air-hockey-server/src/sim.js)
// is an effect-free port of the table physics in src/game.js. This test pins the
// two together: it extracts the REAL game.js functions, runs them in a sandbox
// with effects stubbed out, and runs the server port through the same scripted
// matches. Every substep must agree on puck, mallets, touches, saves and goals.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { loadServer, extractFunction } from './helpers/server-bundle.mjs';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
const net = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
const server = (await loadServer()).__test;
const K = server.constants;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PROD_FUNCS = ['driveMallet', 'clampMallet', 'collideWalls', 'glueEscapeDir', 'contactWrapReleaseNormal',
  'collideMallet', 'stepPhysics', 'stallWatch', 'noteRallyTouch', 'aiBrainForSide', 'aiControlledBlock'];

function gameWorld(rng, pace, goalWidth) {
  const rand = Object.create(Math); rand.random = rng;
  const log = { touches: 0, goals: [], rails: 0 };
  const mk = (side) => ({ side, x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, r: K.MALLET_R, glueT: 0, ghostT: 0,
    touching: false, whooshT: 0, saveCd: 0, trail: [], hitSq: 1, hitSqA: 0, contactActive: false, contactStartedGoalward: false });
  const G = {
    state: 'play', mode: 'online', demo: false, puck: { x: 720, y: 520, vx: 0, vy: 0, r: K.PUCK_R, w: 0, ang: 0 },
    m1: mk(0), m2: mk(1), stats: { topSpeed: 0, rally: 0, bestRally: 0, rallyLastSide: -1, saves: [0, 0] },
    trail: [], nearCd: 1e9, stallT: 0, stallX: 720, stallY: 520, anchorT: 0, lastTouch: -1, saveT: 0, pulses: [],
    puckSq: 1, puckSqV: 0, ai1: null, ai2: null,
  };
  const PACES = server.PACES;
  const ctx = vm.createContext({
    Math: rand, G, PX: K.PX, PY: K.PY, PW: K.PW, PH: K.PH, CX: K.CX, CY: K.CY, PUCK_R: K.PUCK_R, MALLET_R: K.MALLET_R,
    PUCK_MAX: K.PUCK_MAX, SMACK_BONUS: K.SMACK_BONUS, PLAYER_CAP: K.PLAYER_CAP, SUB_HZ: K.SUB_HZ, STALL_V: K.STALL_V,
    STALL_T: K.STALL_T, GLUE_HARD_CUTOFF: K.GLUE_HARD_CUTOFF,
    Settings: { pace }, paceDamp: () => PACES[pace].damp, paceWall: () => PACES[pace].wall, goalW: () => goalWidth,
    hyp: Math.hypot, clamp: (v, a, b) => v < a ? a : v > b ? b : v, rnd: (a, b) => a + rand.random() * (b - a),
    Net: { noteTouch: () => { log.touches++; } }, Highlights: { noteTouch() {}, noteSave() {}, noteNearMiss() {} },
    RivalLab: { active: false }, AudioSys: { thud() {}, whoosh() {}, blip() {} }, Haptics: { fire() {} },
    Practice: { active: false, onSave() {}, onRally() {} }, fxFlash: () => false, fxTrail: () => 1,
    onRailHit() { log.rails++; }, onMalletHit() {}, airPuff() {}, onGoal: (s) => { log.goals.push(s); G.state = 'goal'; },
    addText() {}, THEME: {}, G_stub: 0,
  });
  vm.runInContext(net.slice(net.indexOf('// <<SHARED-SIM:BEGIN>>'), net.indexOf('// <<SHARED-SIM:END>>')), ctx);
  vm.runInContext(PROD_FUNCS.map(n => extractFunction(game, n)).join('\n'), ctx);
  return { G, ctx, log };
}

function serverWorld(rng, pace, goalWidth) {
  const w = server.simWorld({ pace, goalW: goalWidth, rng });
  const log = { touches: 0, goals: [], saves: [0, 0], rally: 0 };
  const stats = { topSpeed: 0 };
  const hooks = { touch: () => { log.touches++; }, save: (s) => { log.saves[s]++; } };
  return { w, log, stats, hooks };
}

function placeBoth(g, s, puck, m1, m2) {
  const P = g.G.puck; Object.assign(P, puck, { w: 0, ang: 0 }); Object.assign(s.w.puck, puck, { w: 0, ang: 0 });
  for (const [gm, sm, src] of [[g.G.m1, s.w.m[0], m1], [g.G.m2, s.w.m[1], m2]]) {
    for (const m of [gm, sm]) { m.x = m.tx = src.x; m.y = m.ty = src.y; m.vx = m.vy = 0; }
  }
  g.G.stallX = s.w.stallX = puck.x; g.G.stallY = s.w.stallY = puck.y;
}

function runScript({ seed, pace, goalWidth, seconds }) {
  const script = mulberry32(seed ^ 0xabcdef);
  const g = gameWorld(mulberry32(seed), pace, goalWidth);
  const s = serverWorld(mulberry32(seed), pace, goalWidth);
  const ctx = g.ctx;
  const serve = () => ({ x: K.CX, y: K.CY, vx: (script() - 0.5) * 2200, vy: (script() - 0.5) * 1400 });
  const reset = () => placeBoth(g, s, serve(), { x: K.PX + 170, y: K.CY }, { x: K.PX + K.PW - 170, y: K.CY });
  reset();
  let steps = 0, maxErr = 0, goals = 0;
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) {
    if (f % 6 === 0) { // both players re-aim: targets chase the puck half the time, wander the rest
      for (const [gm, sm, side] of [[g.G.m1, s.w.m[0], 0], [g.G.m2, s.w.m[1], 1]]) {
        const chase = script() < 0.55;
        const tx = chase ? g.G.puck.x + (script() - 0.5) * 80 : K.PX + script() * K.PW;
        const ty = chase ? g.G.puck.y + (script() - 0.5) * 80 : K.PY + script() * K.PH;
        const t = server.simClampTarget(side, tx, ty);
        gm.tx = sm.tx = t.x; gm.ty = sm.ty = t.y;
      }
    }
    const rdt = 1 / 60;
    const sub = Math.max(1, Math.ceil(rdt / (1 / K.SUB_HZ))), sdt = rdt / sub;
    for (let i = 0; i < sub; i++) {
      vm.runInContext('driveMallet(G.m1, ' + sdt + ', PLAYER_CAP); driveMallet(G.m2, ' + sdt + ', PLAYER_CAP); stepPhysics(' + sdt + ');', ctx);
      server.simDriveMallet(s.w.m[0], sdt, K.PLAYER_CAP); server.simDriveMallet(s.w.m[1], sdt, K.PLAYER_CAP);
      const scorer = server.simStepPhysics(s.w, sdt, s.hooks, s.stats);
      steps++;
      const gp = g.G.puck, sp = s.w.puck;
      for (const k of ['x', 'y', 'vx', 'vy', 'w']) maxErr = Math.max(maxErr, Math.abs(gp[k] - sp[k]));
      for (const [gm, sm] of [[g.G.m1, s.w.m[0]], [g.G.m2, s.w.m[1]]])
        for (const k of ['x', 'y', 'vx', 'vy', 'glueT', 'ghostT']) maxErr = Math.max(maxErr, Math.abs(gm[k] - sm[k]));
      assert.ok(maxErr < 1e-9, `diverged at step ${steps} (frame ${f}): maxErr=${maxErr}`);
      assert.equal(s.log.touches, g.log.touches, 'touch count at step ' + steps);
      assert.equal(g.log.goals.length, goals + (scorer >= 0 ? 1 : 0), 'goal detection at step ' + steps);
      if (scorer >= 0) { assert.equal(scorer, g.log.goals[g.log.goals.length - 1]); goals++; g.G.state = 'play'; reset(); }
    }
  }
  assert.deepEqual(s.log.saves, g.G.stats.saves, 'save stats');
  assert.equal(Math.round(s.stats.topSpeed * 1e6), Math.round(g.G.stats.topSpeed * 1e6), 'top speed');
  return { steps, goals, touches: g.log.touches, maxErr, rails: g.log.rails };
}

for (const pace of ['casual', 'classic', 'lightning']) {
  test(`server physics matches game.js step for step (${pace})`, () => {
    const r = runScript({ seed: 7 + pace.length, pace, goalWidth: 200, seconds: 150 });
    assert.ok(r.touches > 40, `scenario must exercise mallet contact (${r.touches})`);
    assert.ok(r.rails > 40, 'scenario must exercise rails');
    assert.ok(r.goals >= 1, 'scenario must score at least once');
  });
}

test('server physics matches game.js with wide and narrow goal mouths and many seeds', () => {
  let touches = 0, goals = 0;
  for (const [seed, goalWidth] of [[1, 170], [2, 230], [3, 170], [4, 230], [5, 200], [6, 200]]) {
    const r = runScript({ seed, pace: 'classic', goalWidth, seconds: 60 });
    touches += r.touches; goals += r.goals;
  }
  assert.ok(touches > 100 && goals > 3, `touches=${touches} goals=${goals}`);
});

test('server physics matches game.js through glue release and wrap release paths', () => {
  // Setup 1: a mallet pins the puck against the top rail past GLUE_HARD_CUTOFF (rail-squirt release).
  // Setup 2: a slow mallet presses the puck in open ice (pop-off release).
  // Setup 3: the puck sits goal-side of a mallet that keeps pushing (wrap-release geometry).
  let released = 0;
  for (const setup of [
    { puck: { x: 500, y: K.PY + K.PUCK_R, vx: 0, vy: 0 }, m1: { x: 500, y: 330 }, aim: { x: 500, y: K.PY + 46 } },
    { puck: { x: 700, y: 520, vx: 0, vy: 0 }, m1: { x: 560, y: 520 }, aim: { x: 640, y: 520 } },
    { puck: { x: 330, y: 520, vx: 0, vy: 0 }, m1: { x: 400, y: 520 }, aim: { x: 300, y: 520 } },
  ]) {
    const g = gameWorld(mulberry32(5), 'classic', 200), s = serverWorld(mulberry32(5), 'classic', 200);
    placeBoth(g, s, setup.puck, setup.m1, { x: 1100, y: 520 });
    g.G.m1.tx = s.w.m[0].tx = setup.aim.x; g.G.m1.ty = s.w.m[0].ty = setup.aim.y;
    for (let i = 0; i < 240 * 5; i++) {
      const sdt = 1 / 240;
      vm.runInContext('driveMallet(G.m1, ' + sdt + ', PLAYER_CAP); driveMallet(G.m2, ' + sdt + ', PLAYER_CAP); stepPhysics(' + sdt + ');', g.ctx);
      server.simDriveMallet(s.w.m[0], sdt, K.PLAYER_CAP); server.simDriveMallet(s.w.m[1], sdt, K.PLAYER_CAP);
      server.simStepPhysics(s.w, sdt, s.hooks, s.stats);
      for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Math.abs(g.G.puck[k] - s.w.puck[k]) < 1e-9, `puck.${k} at ${i}`);
      assert.equal(s.log.touches, g.log.touches);
      if (g.G.m1.ghostT > 0.05) released++;
    }
    assert.ok(g.log.touches >= 1, 'a contact fired in this setup');
  }
  assert.ok(released > 0, 'at least one glue/wrap release (ghostT) path ran');
});
