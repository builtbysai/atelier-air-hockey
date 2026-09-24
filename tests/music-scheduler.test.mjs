// Music scheduler contract: when the user starts a match, the generative
// music engine must actually schedule audible notes - not just build a bus
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
  assert.equal(t.MusicSys.timer, 0, 'no AudioContext means no scheduler - autoplay policy');
});

async function loadEuclid() {
  const src = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const m = src.match(/function euclid\(k, n, rot\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'euclid helper missing from src/game.js');
  return new Function(`${m[0]}; return euclid;`)();
}

function quietSys(t) {
  // patch every voice so scheduleBeat/startPhrase run silent and recordable
  const M = t.MusicSys;
  M.nodes = {};
  const calls = [];
  M.tone = (o) => calls.push(o);
  M.padChord = () => {};
  M.kickHit = (tt, v) => calls.push({ drum: 'kick', t: tt, vol: v });
  M.snareHit = (tt, v) => calls.push({ drum: 'snare', t: tt, vol: v });
  M.hatHit = (tt, v) => calls.push({ drum: 'hat', t: tt, vol: v });
  M.pulseTok = () => {};
  M.shimmerTone = () => {};
  return calls;
}

test('euclid spreads onsets evenly (tresillo, cinquillo, four-on-floor)', async () => {
  const euclid = await loadEuclid();
  const bits = (p) => p.map(b => (b ? 1 : 0)).join('');
  assert.equal(bits(euclid(3, 8)), '10010010', 'E(3,8) is the tresillo');
  // E(5,8) is the cinquillo up to rotation: 5 hits, starts on a hit, gaps maximally even
  const c5 = euclid(5, 8);
  assert.equal(c5[0], true, 'E(5,8) starts on a hit');
  const gaps = [];
  let last = 0;
  c5.forEach((b, i) => { if (b && i > 0) { gaps.push(i - last); last = i; } });
  gaps.push(8 - last);
  assert.deepEqual(gaps.slice().sort(), [1, 1, 2, 2, 2], 'E(5,8) gaps are maximally even');
  assert.equal(bits(euclid(4, 16)), '1000100010001000', 'E(4,16) is four-on-the-floor');
  assert.equal(bits(euclid(2, 16, 4)), '0000100000001000', 'E(2,16,4) is the backbeat');
  assert.equal(bits(euclid(0, 16)).length, 16, 'E(0,16) is empty but full-length');
});

test('the progression walks in composed order, bridge every 4th cycle', async () => {
  const { t } = await loadGame();
  quietSys(t);
  t.MusicSys.key = 'deco'; t.MusicSys.pendingKey = 'deco';
  t.MusicSys.setSessionSeed(0);
  t.MusicSys.reseed();
  const roots = [];
  for (let p = 0; p < 18; p++) {
    t.MusicSys.startPhrase(100 + p * 10, 60 / 56, p);
    roots.push(t.MusicSys.curChord.r);
  }
  // deco prog: Am9 Fmaj9 Dm9 E7 (roots 0,8,5,7); bridge: Dm9 E7 (5,7)
  assert.deepEqual(roots.slice(0, 12), [0, 8, 5, 7, 0, 8, 5, 7, 0, 8, 5, 7],
    'three straight cycles of the composed progression');
  assert.deepEqual(roots.slice(12, 16), [5, 7, 5, 7], 'the 4th cycle vamps the 2-chord bridge turnaround');
  assert.deepEqual(roots.slice(16, 18), [0, 8], 'then the progression returns');
});

test('the motif is established twice before any development', async () => {
  const { t } = await loadGame();
  const calls = quietSys(t);
  t.MusicSys.key = 'deco'; t.MusicSys.pendingKey = 'deco';
  t.MusicSys.setSessionSeed(0);
  t.MusicSys.reseed();
  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // deco motif q = [[4,1],[5,1],[6,2]] over A melodic minor [0,2,3,5,7,9,10]
  // -> degrees 7,9,10 semitones -> midi 64, 66, 67 an octave above root 45
  const want = [64, 66, 67].map(mf);
  t.MusicSys.scheduleMotif(100, 60 / 56, 0);
  const first = calls.splice(0).map(o => o.f);
  t.MusicSys.scheduleMotif(200, 60 / 56, 1);
  const second = calls.splice(0).map(o => o.f);
  assert.deepEqual(first, want, 'phrase 0 states the motif exactly');
  assert.deepEqual(second, want, 'phrase 1 repeats it: identity before development');
  // phrase 2 sequences it up a diatonic step -> 66, 67, 69
  t.MusicSys.scheduleMotif(300, 60 / 56, 2);
  const seq = calls.splice(0).map(o => o.f);
  assert.deepEqual(seq, [66, 67, 69].map(mf), 'phrase 2 is the diatonic sequence up');
});

test('the same session seed schedules the same sequence on two instances', async () => {
  const run = async (seed) => {
    const { t } = await loadGame();
    const calls = quietSys(t);
    t.MusicSys.key = 'bau'; t.MusicSys.pendingKey = 'bau';
    t.MusicSys.setSessionSeed(seed);
    t.MusicSys.reseed();
    const spb = 60 / 120;
    for (let n = 0; n < 64; n++) t.MusicSys.scheduleBeat(100 + n * spb, n, spb);
    return calls.map(o => [Math.round(o.f || 0), Math.round((o.t || 0) * 1000), Math.round((o.vol || 0) * 1000)]);
  };
  const a = await run(987654321), b = await run(987654321), c = await run(111111111);
  assert.ok(a.length > 40, `expected a busy 4-phrase run, got ${a.length} voices`);
  assert.deepEqual(a, b, 'same session seed must schedule identical notes (the online sync contract)');
  assert.notDeepEqual(a, c, 'different session seeds must diverge');
});

test('setSessionSeed reseeds a running scheduler without rebuilding the bus', async () => {
  const { t } = await loadGame();
  quietSys(t);
  t.MusicSys.key = 'deco'; t.MusicSys.pendingKey = 'deco';
  t.MusicSys.timer = 123; // pretend the scheduler is running
  const bus = (t.MusicSys.nodes = { tag: 'bus' });
  t.MusicSys.setSessionSeed(4242);
  assert.equal(t.MusicSys.sessionSeed, 4242, 'seed recorded');
  assert.equal(t.MusicSys.beat, 0, 'the running sequence restarts on the new seed');
  assert.equal(t.MusicSys.nodes.tag, 'bus', 'the bus is not rebuilt');
  t.MusicSys.timer = 0;
});
