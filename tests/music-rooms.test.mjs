// Every table gets its own generative room: the table -> MUSIC mapping,
// pairwise room distinctness, the setTable crossfade actually switching
// rooms, and old-room voices being killed so pad tails can't bleed over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const TABLES = ['deco', 'mid', 'brut', 'bil', 'mem', 'sashi', 'bau', 'zel', 'swi', 'neon'];

function makeStorage(seed = {}) {
  const store = { ...seed };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

function mockAudioContext() {
  const param = () => ({
    value: 0,
    setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  const node = () => ({
    gain: param(), frequency: param(), Q: param(), delayTime: param(), playbackRate: param(),
    type: '', buffer: null, loop: false, detune: param(),
    connect() {}, disconnect() {}, start() {}, stop() {},
  });
  return {
    state: 'running', currentTime: 100, sampleRate: 44100,
    createGain: () => node(), createDelay: () => node(),
    createOscillator: () => node(), createBiquadFilter: () => node(),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), sampleRate: 44100 }),
    createBufferSource: () => node(),
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
    destination: {},
  };
}

async function loadGame() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, onlineFlip: false, themeId: 'deco', score: [0, 0] };
  const ac = mockAudioContext();
  const timers = [];
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
    localStorage: makeStorage(),
    navigator: {},
    requestAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval: () => 123, clearInterval() {},
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${source}\nthis.__t = { MusicSys, MUSIC, AudioSys, Settings, loadSettings, ROOM_AMB, G };`,
    context, { filename: 'src/game.js' });
  const t = context.__t;
  t.AudioSys.ctx = ac;
  t.AudioSys.sfxBus = { gain: { value: 0.5 }, connect() {} };
  t.AudioSys.musicBus = { gain: { value: 1 }, connect() {} };
  t.loadSettings();
  return { t, ac, timers };
}

const sig = (c) => [
  c.root % 12, c.bpm, c.melWave, (c.bass && c.bass.wave) || 'sine',
  c.mode.join(','), c.padCut, c.swing,
  c.prog.map(ch => ch.r + ':' + ch.t.join(',')).join(';'),
  [c.pulse, !!c.drums, c.shimmer, c.drone].map(Boolean).join(''),
].join('|');

test('every table has a music room and an ambience bed', async () => {
  const { t } = await loadGame();
  for (const id of TABLES) {
    assert.ok(t.MUSIC[id], `MUSIC room missing for table ${id}`);
    assert.ok(t.ROOM_AMB[id], `ROOM_AMB bed missing for table ${id}`);
    assert.ok(Array.isArray(t.MUSIC[id].prog) && t.MUSIC[id].prog.length >= 4, `${id} needs a composed progression`);
  }
});

test('rooms are pairwise distinct across character dimensions', async () => {
  const { t } = await loadGame();
  for (let i = 0; i < TABLES.length; i++) {
    for (let j = i + 1; j < TABLES.length; j++) {
      const a = sig(t.MUSIC[TABLES[i]]).split('|'), b = sig(t.MUSIC[TABLES[j]]).split('|');
      const diffs = a.filter((v, k) => v !== b[k]).length;
      assert.ok(diffs >= 3, `${TABLES[i]} vs ${TABLES[j]} differ in only ${diffs} dimensions`);
    }
  }
});

test('prime() maps each table to its own room once a match starts', async () => {
  const { t, timers } = await loadGame();
  t.G.state = 'play'; // on the menu, prime() intentionally stays put
  for (const id of TABLES) {
    t.G.themeId = id;
    t.MusicSys.prime();
    assert.equal(t.MusicSys.pendingKey, id, `table ${id} must be recorded as the pending room`);
    while (timers.length) timers.shift()(); // fire the crossfade completions
    assert.equal(t.MusicSys.key, id, `table ${id} must prime room ${id}, got ${t.MusicSys.key}`);
    t.MusicSys.stop();
    while (timers.length) timers.shift()();
  }
  t.G.state = 'menu';
});

test('setTable crossfades to the new room and kills the old voices', async () => {
  const { t, timers } = await loadGame();
  t.MusicSys.key = 'deco'; t.MusicSys.pendingKey = 'deco';
  t.MusicSys.start();
  // schedule a long pad so there is a live voice to kill
  t.MusicSys.padChord([220, 277, 330], 100, 20);
  assert.ok(t.MusicSys.voices.length > 0, 'pad should register a live voice');
  const nTimers = timers.length;
  t.MusicSys.setTable('neon');
  assert.equal(t.MusicSys.pendingKey, 'neon', 'pendingKey records the target immediately');
  assert.equal(t.MusicSys.voices.length, 0, 'old-room voices must die at the crossfade start');
  assert.ok(timers.length > nTimers, 'crossfade completion must be scheduled');
  timers[timers.length - 1](); // fire the 750ms completion
  assert.equal(t.MusicSys.key, 'neon', 'key must switch to the new room after the crossfade');
  t.MusicSys.stop();
});

test('setTable is a no-op record when the scheduler is idle', async () => {
  const { t } = await loadGame();
  t.MusicSys.key = 'deco';
  t.MusicSys.setTable('zel');
  assert.equal(t.MusicSys.pendingKey, 'zel', 'records the target for the next start()');
  assert.equal(t.MusicSys.key, 'deco', 'does not switch while idle');
});
