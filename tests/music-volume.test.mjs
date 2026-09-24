// Music volume: the Settings.musicVolume slider (0-100, default 70) and its
// perceptual mapping onto the live music bus, plus the raised voice gains
// behind Sam's "barely audible" report. Runs the real MusicSys in a vm
// sandbox with a recording mock AudioContext.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function makeStorage(seed = {}) {
  const store = { ...seed };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _dump: () => ({ ...store }),
  };
}

// Mock AudioContext that records every gain automation call so the tests can
// assert the actual envelope peaks the scheduler programs.
function mockAudioContext() {
  const calls = [];
  const param = () => ({
    value: 0,
    setValueAtTime(v) { calls.push(['setValue', v]); },
    setTargetAtTime(v, t, tc) { calls.push(['setTarget', v]); },
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime(v) { calls.push(['expRamp', v]); },
  });
  const node = () => ({ gain: param(), connect() {}, disconnect() {} });
  const bufSrc = () => ({
    buffer: null, loop: false, playbackRate: param(),
    connect() {}, disconnect() {}, start() {}, stop() {}, onended: null,
  });
  return {
    calls,
    state: 'running',
    currentTime: 100,
    sampleRate: 44100,
    createGain: () => node(),
    createDelay: () => ({ delayTime: param(), connect() {}, disconnect() {} }),
    createOscillator: () => {
      const o = { frequency: param(), detune: param(), type: 'sine', connect() {}, disconnect() {}, start() {}, stop() {}, onended: null };
      return o;
    },
    createBiquadFilter: () => ({ frequency: param(), Q: param(), type: 'lowpass', connect() {}, disconnect() {} }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), sampleRate: 44100 }),
    createBufferSource: () => bufSrc(),
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    destination: {},
  };
}

async function loadGame(storageSeed) {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, onlineFlip: false, themeId: 'deco', score: [0, 0] };
  const ac = mockAudioContext();
  const storage = makeStorage(storageSeed);
  const context = vm.createContext({
    console, Math, JSON, G,
    DIFFS: [{ name: 'Rookie' }, { name: 'Club Pro' }, { name: 'Champion' }],
    Net: { role: 'host' },
    THEME: {
      scoreboard: 'solari', board: {}, gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff',
      drawRails() {}, drawSurface() {}, drawMarkings() {},
    },
    CX: 720, CY: 520, TAU: Math.PI * 2,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    mulberry32: (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
    rnd: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
    rr: () => {},
    window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {} },
    document: {
      getElementById: () => ({ getContext: () => ({}), addEventListener() {}, style: {}, classList: { add() {}, remove() {}, contains: () => false } }),
      createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
      addEventListener() {}, hidden: false, title: '',
      querySelectorAll: () => [],
    },
    localStorage: storage,
    navigator: {},
    requestAnimationFrame() {}, setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 123, clearInterval() {},
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${source}\nthis.__t = { MusicSys, MUSIC, AudioSys, Settings, loadSettings, saveSettings };`,
    context, { filename: 'src/game.js' });
  const t = context.__t;
  t.AudioSys.ctx = ac;
  t.AudioSys.master = { gain: { value: 0.5 }, connect() {} };
  return { t, ac, storage };
}

test('musicVolume defaults to 70, persists, and clamps', async () => {
  const { t } = await loadGame();
  t.loadSettings();
  assert.equal(t.Settings.musicVolume, 70, 'default must be 70');
  // persists a chosen value (carry the first sandbox's storage into the second)
  const g1 = await loadGame();
  g1.t.loadSettings();
  g1.t.Settings.musicVolume = 35; g1.t.saveSettings();
  const seed = { 'atelier-ah-settings': g1.storage._dump()['atelier-ah-settings'] };
  const { t: t2 } = await loadGame(seed);
  t2.loadSettings();
  assert.equal(t2.Settings.musicVolume, 35, 'chosen volume must persist');
  // clamps strays, falls back on garbage
  for (const [raw, want] of [[150, 100], [-20, 0], ['loud', 70], [null, 70], [82.6, 83]]) {
    const { t: tx } = await loadGame({ 'atelier-ah-settings': JSON.stringify({ musicVolume: raw }) });
    tx.loadSettings();
    assert.equal(tx.Settings.musicVolume, want, `musicVolume ${JSON.stringify(raw)} -> ${want}`);
  }
});

test('volGain is a perceptual curve with unity at 70 and 0 = silent', async () => {
  const { t } = await loadGame();
  const g = (v) => { t.Settings.musicVolume = v; return t.MusicSys.volGain(); };
  assert.equal(g(0), 0, '0 must be silent');
  assert.ok(Math.abs(g(70) - 1) < 1e-9, '70 is the unity point');
  assert.ok(Math.abs(g(100) - Math.pow(100 / 70, 1.5)) < 1e-9, '100 lifts ~+4.6 dB');
  assert.ok(g(35) < 0.5, 'half slider sits well under half gain (perceptual, not linear)');
  let prev = -1;
  for (const v of [0, 10, 25, 50, 70, 85, 100]) {
    const cur = g(v);
    assert.ok(cur > prev, `volGain must rise monotonically (v=${v})`);
    prev = cur;
  }
});

test('targetLevel composes table level, volume, and intensity', async () => {
  const { t } = await loadGame();
  t.MusicSys.key = 'deco'; // level 1.1
  t.Settings.musicVolume = 70; t.MusicSys.intensity = 0;
  assert.ok(Math.abs(t.MusicSys.targetLevel() - 1.1) < 1e-9, 'default target = table level');
  t.MusicSys.intensity = 1;
  assert.ok(Math.abs(t.MusicSys.targetLevel() - 1.1 * 1.3) < 1e-9, 'intensity lifts 1.3x');
  t.MusicSys.intensity = 0; t.Settings.musicVolume = 0;
  assert.equal(t.MusicSys.targetLevel(), 0, 'volume 0 silences the target');
});

test('applyVolume re-aims the live bus without a restart', async () => {
  const { t, ac } = await loadGame();
  let aimed = null;
  t.MusicSys.nodes = { musicG: { gain: { setTargetAtTime(v) { aimed = v; } } } };
  t.MusicSys.key = 'deco'; t.MusicSys.intensity = 0;
  t.Settings.musicVolume = 50;
  t.MusicSys.applyVolume();
  const want = 1.1 * Math.pow(50 / 70, 1.5);
  assert.ok(Math.abs(aimed - want) < 1e-9, `live bus must aim at ${want}, got ${aimed}`);
  // 0 floors at 0.0001 (exponential ramps can't target true 0)
  t.Settings.musicVolume = 0;
  t.MusicSys.applyVolume();
  assert.equal(aimed, 0.0001, 'volume 0 must floor the bus at 0.0001');
  // no bus yet (pre-prime): must not throw
  t.MusicSys.nodes = null;
  assert.doesNotThrow(() => t.MusicSys.applyVolume(), 'applyVolume with no bus must be a no-op');
});

test('start() aims the bus at the volume-aware target', async () => {
  const { t, ac } = await loadGame();
  t.Settings.musicVolume = 80;
  t.MusicSys.key = 'deco'; t.MusicSys.intensity = 0;
  ac.calls.length = 0;
  t.MusicSys.start();
  t.MusicSys.stop();
  const aimed = Math.max(...ac.calls.filter(c => c[0] === 'setTarget').map(c => c[1]));
  assert.ok(Math.abs(aimed - 1.1 * Math.pow(80 / 70, 1.5)) < 1e-6,
    `start() must aim at the volume-aware target, got ${aimed}`);
});

test('voice gains are raised: the scheduler programs audible peaks', async () => {
  const { t, ac } = await loadGame();
  t.MusicSys.buildBus(); // the real start() path always builds the bus first
  // pad bed: run a phrase of the deco room and read the programmed peaks
  t.MusicSys.key = 'deco'; t.MusicSys.reseed();
  const spb = 60 / t.MUSIC.deco.bpm;
  for (let n = 0; n < 32; n++) t.MusicSys.scheduleBeat(100 + n * spb, n, spb);
  const pads = ac.calls.filter(c => c[0] === 'setTarget').map(c => c[1]);
  assert.ok(pads.some(v => Math.abs(v - 0.090) < 1e-9), `pad bed must bloom to 0.090, saw [${[...new Set(pads)].join(', ')}]`);
  const peaks = ac.calls.filter(c => c[0] === 'expRamp').map(c => c[1]);
  const maxPeak = Math.max(...peaks);
  assert.ok(maxPeak >= 0.225 - 1e-9, `bass plucks must peak at 0.225, max saw ${maxPeak}`);
  assert.ok(peaks.some(v => Math.abs(v - 0.102) < 1e-9), 'triangle melody notes must peak at 0.102');
});

test('raised gains on the conditional voices (drone/pulse/drum/shimmer/swell)', async () => {
  const { t, ac } = await loadGame();
  t.MusicSys.buildBus(); // the real start() path always builds the bus first
  const expRamps = () => ac.calls.filter(c => c[0] === 'expRamp').map(c => c[1]);
  const setValues = () => ac.calls.filter(c => c[0] === 'setValue').map(c => c[1]);
  // brut drone (phrase start programs the low sine)
  t.MusicSys.key = 'brut'; t.MusicSys.reseed();
  t.MusicSys.scheduleBeat(100, 0, 60 / t.MUSIC.brut.bpm);
  assert.ok(expRamps().some(v => Math.abs(v - 0.105) < 1e-9), 'brut drone must peak at 0.105');
  // mem pulse at match-point intensity
  ac.calls.length = 0;
  t.MusicSys.key = 'mem'; t.MusicSys.intensity = 1; t.MusicSys.reseed();
  t.MusicSys.scheduleBeat(100, 0, 60 / t.MUSIC.mem.bpm);
  assert.ok(setValues().some(v => Math.abs(v - 0.090) < 1e-9), 'match-point pulse must peak at 0.090');
  t.MusicSys.intensity = 0;
  // zel frame drum
  ac.calls.length = 0;
  t.MusicSys.key = 'zel'; t.MusicSys.reseed();
  t.MusicSys.scheduleBeat(100, 0, 60 / t.MUSIC.zel.bpm);
  assert.ok(setValues().some(v => Math.abs(v - 0.15) < 1e-9), 'riad drum must peak at 0.15');
  // swi shimmer: sparse, so run several phrases
  ac.calls.length = 0;
  t.MusicSys.key = 'swi'; t.MusicSys.reseed();
  const spb = 60 / t.MUSIC.swi.bpm;
  for (let n = 0; n < 96; n++) t.MusicSys.scheduleBeat(100 + n * spb, n, spb);
  assert.ok(expRamps().some(v => Math.abs(v - 0.048) < 1e-9), 'gallery shimmer must peak at 0.048');
  // goal swell under the ceremony
  ac.calls.length = 0;
  t.MusicSys.key = 'deco'; t.MusicSys.buildBus(); t.MusicSys.timer = 123;
  t.MusicSys.goalSwell();
  assert.ok(expRamps().some(v => Math.abs(v - 0.135) < 1e-9), 'goal swell must peak at 0.135');
});

test('settings UI wires the volume slider', async () => {
  const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  assert.match(template, /id="musicVol"/, 'settings needs the volume slider');
  assert.match(template, /id="musicVolVal"/, 'slider needs a numeric readout');
  const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /key === 'musicVolume'/, 'setSetting must parse musicVolume');
  assert.match(ui, /MusicSys\.applyVolume\(\)/, 'volume changes must hit the live bus');
  assert.match(ui, /\$\('musicVol'\)/, 'wireUI must listen to the slider');
});
