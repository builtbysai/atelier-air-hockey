// Focus-loss pause: visibilitychange->hidden and window blur must freeze the
// sim, suspend the AudioContext, and wait for an explicit user gesture to
// resume (browser autoplay policy). Runs the real game.js in a vm sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function makeEl() {
  const classes = new Set(['hidden']); // every overlay starts hidden
  return {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener() {}, style: {}, textContent: '', innerHTML: '',
  };
}

// a canvas 2d context that swallows everything and chains (gradients,
// measureText, transforms) so render() runs without a real canvas
function chainCtx() {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      return chainCtx();
    },
    apply: () => chainCtx(),
    set: () => true,
  });
}

async function loadGame() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const els = {};
  const audioCalls = [];
  const ac = {
    state: 'running',
    currentTime: 100,
    sampleRate: 44100,
    suspend() { audioCalls.push('suspend'); this.state = 'suspended'; return Promise.resolve(); },
    resume() { audioCalls.push('resume'); this.state = 'running'; return Promise.resolve(); },
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    createOscillator: () => ({ frequency: { value: 0 }, detune: { value: 0 }, connect() {}, disconnect() {}, start() {}, stop() {} }),
    createBiquadFilter: () => ({ frequency: { value: 0 }, Q: { value: 0 }, connect() {}, disconnect() {} }),
    createDelay: () => ({ delayTime: { value: 0 }, connect() {}, disconnect() {} }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {} }),
    destination: {},
  };
  const baseTheme = {
    mallet: { base: '#111', dish: '#222', dishHi: '#333', edge: '#444', hi: '#555', knob: '#666', knobHi: '#777', ring: '#888' },
    puck: { hi: '#fff', body: '#ddd', edge: '#999', ring: '#333' },
    trail: '#fff', gold: '#c9a227', ink: '#fff', board: {},
    font: { body: 'sans-serif', display: 'sans-serif' },
    drawRails() {}, drawSurface() {}, drawMarkings() {}, drawGoalTrim() {},
  };
  const getEl = (id) => {
    if (!els[id]) {
      els[id] = id === 'game'
        ? { ...makeEl(), getContext: () => chainCtx(), width: 1280, height: 800 }
        : makeEl();
    }
    return els[id];
  };
  const context = vm.createContext({
    console, Math, JSON,
    DIFFS: [{ name: 'Rookie' }],
    Net: { role: 'host', sendPause() {}, pump() {} },
    THEME: baseTheme,
    CX: 720, CY: 520, TAU: Math.PI * 2,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    mulberry32: (s) => () => 0.5,
    rnd: () => 0.5,
    rr: () => {},
    window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {} },
    document: {
      getElementById: getEl,
      createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
      addEventListener() {}, hidden: false, title: '',
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    requestAnimationFrame() {}, setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 123, clearInterval() {},
    performance: { now: () => 1000 },
  });
  vm.runInContext(
    `${sb}\n${source}\nthis.__t = { G, Net, AudioSys, MusicSys, Settings, togglePause, pauseForFocusLoss, resumeFromFocusLoss, frame, mkBrain };`,
    context, { filename: 'src/game.js' });
  const t = context.__t;
  t.AudioSys.ctx = ac;
  t.AudioSys.sfxBus = { gain: { value: 0.5 }, connect() {} };
  t.AudioSys.musicBus = { gain: { value: 1 }, connect() {} };
  // a live match's worth of state for the freeze assertions
  t.G.puck = { x: 500, y: 520, vx: 900, vy: 120, sq: 0, rot: 0, rotV: 0, w: 0, ang: 0 };
  t.G.m1 = { x: 200, y: 520, tx: 200, ty: 520, vx: 0, vy: 0, r: 42, trail: [], hitSq: 0 };
  t.G.m2 = { x: 1240, y: 520, tx: 1240, ty: 520, vx: 0, vy: 0, r: 42, trail: [], hitSq: 0 };
  t.G.ai2 = t.mkBrain(1, 1);
  const vis = (id) => !getEl(id).classList.contains('hidden');
  return { t, ac, audioCalls, vis };
}

test('focus loss mid-match pauses, suspends audio, and uses the pause card', async () => {
  const { t, ac, audioCalls, vis } = await loadGame();
  t.G.state = 'play'; t.G.mode = 'ai';
  t.pauseForFocusLoss();
  assert.equal(t.G.focusLost, true, 'the freeze flag must latch');
  assert.equal(ac.state, 'suspended', 'the AudioContext must suspend');
  assert.deepEqual(audioCalls, ['suspend'], 'suspend exactly once');
  assert.equal(t.G.state, 'pause', 'a live match takes the regular pause path');
  assert.ok(vis('pauseov'), 'the pause card is the tap-to-resume surface');
  assert.ok(!vis('focusov'), 'no veil needed when the pause card is up');
});

test('focus loss in the menu veils without disturbing state', async () => {
  const { t, ac, vis } = await loadGame();
  t.G.state = 'menu'; t.G.mode = 'ai';
  t.pauseForFocusLoss();
  assert.equal(t.G.focusLost, true);
  assert.equal(ac.state, 'suspended');
  assert.equal(t.G.state, 'menu', 'menu state must survive untouched');
  assert.ok(!vis('pauseov'), 'the pause card must not appear over a menu');
  assert.ok(vis('focusov'), 'the tap-to-resume veil must cover the menu');
});

test('focus pause is idempotent', async () => {
  const { t, audioCalls } = await loadGame();
  t.G.state = 'menu';
  t.pauseForFocusLoss();
  t.pauseForFocusLoss();
  assert.deepEqual(audioCalls, ['suspend'], 'double blur must not double-suspend');
});

test('the veil resumes only on a user gesture, restarting audio', async () => {
  const { t, ac, vis } = await loadGame();
  t.G.state = 'menu';
  t.pauseForFocusLoss();
  t.resumeFromFocusLoss(); // the veil's tap handler
  assert.equal(t.G.focusLost, false, 'the freeze flag must clear');
  assert.equal(ac.state, 'running', 'audio restarts on the gesture');
  assert.ok(!vis('focusov'), 'the veil must hide');
  assert.equal(t.G.state, 'menu', 'menu state still untouched');
});

test('resuming when not frozen is a no-op', async () => {
  const { t, ac, audioCalls } = await loadGame();
  t.resumeFromFocusLoss();
  assert.deepEqual(audioCalls, [], 'no audio calls when nothing was frozen');
  assert.equal(ac.state, 'running');
});

test('the pause card Resume button clears the freeze and restarts audio', async () => {
  const { t, ac, vis } = await loadGame();
  t.G.state = 'play'; t.G.mode = 'ai';
  t.pauseForFocusLoss();
  t.togglePause(); // btnResume path
  assert.equal(t.G.state, 'play', 'the match resumes');
  assert.equal(t.G.focusLost, false, 'the freeze flag clears on local resume');
  assert.equal(ac.state, 'running', 'audio restarts on the gesture');
  assert.ok(!vis('pauseov'), 'the card hides');
});

test('a remote (silent) resume while the tab is away keeps the veil', async () => {
  const { t, ac, vis } = await loadGame();
  t.G.state = 'play'; t.G.mode = 'ai';
  t.pauseForFocusLoss();
  t.togglePause(false, true); // the rival's resume arriving over the wire
  assert.equal(t.G.state, 'play', 'the protocol still resumes the shared match');
  assert.equal(t.G.focusLost, true, 'the local tab must stay frozen');
  assert.equal(ac.state, 'suspended', 'audio must not auto-resume without a gesture');
  assert.ok(vis('focusov'), 'the veil stays up until the user taps');
});

test('suspend/resume are null-safe before audio ever starts', async () => {
  const { t } = await loadGame();
  t.AudioSys.ctx = null;
  assert.doesNotThrow(() => { t.G.state = 'menu'; t.pauseForFocusLoss(); }, 'suspend with no ctx must not throw');
  assert.doesNotThrow(() => t.resumeFromFocusLoss(), 'resume with no ctx must not throw');
});

test('frame() holds the sim and the net pump while frozen', async () => {
  const { t } = await loadGame();
  t.G.state = 'play'; t.G.mode = 'ai';
  t.G.puck.x = 500; t.G.puck.y = 520; t.G.puck.vx = 900; t.G.puck.vy = 120;
  t.G.focusLost = true;
  let pumped = 0;
  t.Net.pump = () => { pumped++; };
  t.frame(1016);
  assert.equal(t.G.puck.x, 500, 'puck x must not advance');
  assert.equal(t.G.puck.y, 520, 'puck y must not advance');
  assert.equal(pumped, 0, 'the net pump must not run while frozen');
  // and unfrozen, the same frame advances the sim again
  t.G.focusLost = false;
  t.frame(1032);
  assert.notEqual(t.G.puck.x, 500, 'the sim must advance again after resume');
});
