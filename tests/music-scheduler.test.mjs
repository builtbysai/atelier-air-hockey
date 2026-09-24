// Music scheduler contract: when the user starts a match, the generative
// music engine must actually schedule audible notes — not just build a bus
// and sit silent. Regression test for the "music is inaudible" report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function mockAudioContext() {
  const oscCount = { n: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  const node = () => ({ gain: param(), connect() {}, disconnect() {} });
  return {
    oscCount,
    state: 'running',
    currentTime: 100,
    sampleRate: 44100,
    createGain: () => node(),
    createDelay: () => ({ delayTime: param(), connect() {}, disconnect() {} }),
    createOscillator: () => {
      oscCount.n++;
      return { frequency: param(), detune: param(), type: 'sine', connect() {}, disconnect() {}, start() {}, stop() {} };
    },
    createStereoPanner: () => ({ pan: param(), connect() {}, disconnect() {} }),
    createBiquadFilter: () => ({ frequency: param(), Q: param(), type: 'lowpass', connect() {}, disconnect() {} }),
    resume: () => Promise.resolve(),
    destination: {},
  };
}

async function loadGame() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, onlineFlip: false, themeId: 'deco', score: [0, 0] };
  const ac = mockAudioContext();
  const context = vm.createContext({
    console, Math, JSON, G,
    DIFFS: [{ name: 'Rookie' }, { name: 'Club Pro' }, { name: 'Champion' }],
    Net: { role: 'host' },
    Settings: { firstTo: 7, orientation: 'landscape', music: true, sfx: true },
    THEME: { scoreboard: 'solari', board: {}, gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff' },
    CX: 720, CY: 520, TAU: Math.PI * 2,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    mulberry32: (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
    rr: () => {},
    window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {} },
    document: {
      getElementById: () => ({ getContext: () => ({}), addEventListener() {}, style: {}, classList: { add() {}, remove() {} } }),
      createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
      addEventListener() {}, hidden: false, title: '',
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    requestAnimationFrame() {}, setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 123, clearInterval() {},
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${source}\nthis.__t = { MusicSys, MUSIC, AudioSys };`,
    context, { filename: 'src/game.js' });
  // inject the mock AudioContext into the source's own AudioSys, and give it
  // a master bus so buildBus() can wire up
  context.__t.AudioSys.ctx = ac;
  context.__t.AudioSys.sfxBus = { gain: { value: 0.5 }, connect() {} };
  context.__t.AudioSys.musicBus = { gain: { value: 1 }, connect() {} };
  return { t: context.__t, ac };
}

test('music levels sit in an audible range', async () => {
  const { t } = await loadGame();
  for (const [id, cfg] of Object.entries(t.MUSIC)) {
    assert.ok(cfg.level >= 0.5 && cfg.level <= 1.5,
      `${id}: level ${cfg.level} outside the audible 0.5–1.5 band`);
  }
});

test('start() builds the bus and tick() schedules notes', async () => {
  const { t, ac } = await loadGame();
  t.MusicSys.prime();
  assert.ok(t.MusicSys.timer, 'prime() with a live AudioContext must start the scheduler');
  assert.ok(t.MusicSys.nodes, 'the music bus must be built');
  const before = ac.oscCount.n;
  // advance the clock past the lookahead window and tick
  ac.currentTime = 101;
  t.MusicSys.nextT = 100.1;
  t.MusicSys.tick();
  assert.ok(ac.oscCount.n > before,
    `tick() must schedule oscillators (before=${before}, after=${ac.oscCount.n})`);
  t.MusicSys.stop();
  assert.equal(t.MusicSys.timer, 0, 'stop() must clear the scheduler');
});

test('prime() stays silent without a user gesture (no AudioContext)', async () => {
  const { t } = await loadGame();
  t.AudioSys.ctx = null;
  t.MusicSys.timer = 0; t.MusicSys.nodes = null;
  t.MusicSys.prime();
  assert.equal(t.MusicSys.timer, 0, 'no AudioContext means no scheduler — autoplay policy');
});
