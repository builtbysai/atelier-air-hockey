// Sound vs music independence under synchronized audio preferences. Sound
// Effects controls sfxBus, Music controls musicBus (including ambience), and
// the HUD mute moves both visible sliders to zero then restores the prior mix.
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

// Mock AudioContext whose connect() records the destination node, so the
// tests can assert which BUS each voice lands on.
function mockAudioContext() {
  const connectedTo = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
  });
  const node = (tag) => ({
    tag, gain: param(), frequency: param(), Q: param(), delayTime: param(), playbackRate: param(),
    type: '', buffer: null, loop: false,
    connect(dst) { connectedTo.push([tag, dst && dst.tag]); },
    disconnect() {},
    start() {}, stop() {},
  });
  return {
    connectedTo,
    state: 'running', currentTime: 100, sampleRate: 44100,
    createGain: () => node('gain'),
    createDelay: () => node('delay'),
    createOscillator: () => node('osc'),
    createBiquadFilter: () => node('filter'),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), sampleRate: 44100 }),
    createBufferSource: () => node('src'),
    resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
    destination: { tag: 'destination' },
  };
}

async function loadGame(storageSeed) {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, onlineFlip: false, themeId: 'deco', score: [0, 0] };
  const ac = mockAudioContext();
  const storage = makeStorage(storageSeed);
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
    localStorage: storage,
    navigator: {},
    requestAnimationFrame() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {}, setInterval: () => 123, clearInterval() {},
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${source}\nthis.__t = { MusicSys, MUSIC, AudioSys, Settings, loadSettings, saveSettings, ROOM_AMB };`,
    context, { filename: 'src/game.js' });
  const t = context.__t;
  // wire the two visible channel buses the way init() does
  t.AudioSys.ctx = ac;
  t.AudioSys.sfxBus = ac.createGain(); t.AudioSys.sfxBus.tag = 'sfxBus';
  t.AudioSys.musicBus = ac.createGain(); t.AudioSys.musicBus.tag = 'musicBus';
  t.AudioSys.sfxBus.connect(ac.destination);
  t.AudioSys.musicBus.connect(ac.destination);
  return { t, ac, storage, timers };
}

// the lines applySettingsToUI runs for audio on every settings change
function applyAudio(t) {
  t.AudioSys.syncMute();
  t.AudioSys.syncMusic();
}

test('sound volume 0 silences SFX but leaves the music bus at unity', async () => {
  const { t } = await loadGame({ 'atelier-ah-settings': JSON.stringify({ soundVolume: 0, musicVolume: 70 }) });
  t.loadSettings();
  applyAudio(t);
  assert.equal(t.Settings.soundVolume, 0, 'Sound Effects stays at the saved slider value');
  assert.equal(t.AudioSys.sfxBus.gain.value, 0, 'sfx bus must be muted');
  assert.equal(t.AudioSys.musicBus.gain.value, 1, 'music bus must stay live at the 70 unity point');
});

test('music volume 0 silences music but leaves SFX at full', async () => {
  const { t } = await loadGame({ 'atelier-ah-settings': JSON.stringify({ soundVolume: 100, musicVolume: 0 }) });
  t.loadSettings();
  applyAudio(t);
  assert.equal(t.Settings.musicVolume, 0, 'Music stays at the saved slider value');
  assert.equal(t.AudioSys.sfxBus.gain.value, 0.5, 'sfx bus must stay live at Sound 100');
  assert.equal(t.AudioSys.musicBus.gain.value, 0, 'music bus must be muted at slider 0');
});

test('muted SFX voices stay silent while the music scheduler keeps targeting levels', async () => {
  const { t, ac } = await loadGame();
  t.loadSettings();
  t.Settings.soundVolume = 0; t.AudioSys.syncMute();
  const before = ac.connectedTo.length;
  t.AudioSys.hit(1); // SFX voice: must early-return on muted
  assert.equal(ac.connectedTo.length, before, 'muted hit() must not build any voice');
  // music scheduling ignores the SFX mute entirely
  t.MusicSys.start();
  assert.ok(t.MusicSys.timer, 'scheduler must run while SFX are muted');
  assert.ok(t.MusicSys.voices.length >= 0, 'voice tracking present');
  t.MusicSys.stop();
});

test('music duck bus and ambience bed ride the music bus, never sfx', async () => {
  const { t, ac } = await loadGame();
  t.loadSettings();
  t.MusicSys.start();
  const duckLinks = ac.connectedTo.filter(([from]) => from === 'gain').map(([, to]) => to);
  assert.ok(duckLinks.includes('musicBus'), 'music chain must terminate at musicBus, got: ' + duckLinks.join(','));
  assert.ok(!duckLinks.includes('sfxBus'), 'music chain must never touch sfxBus');
  t.MusicSys.stop();
  // ambience bed
  t.AudioSys.ambKey = 'deco';
  t.AudioSys._startAmbience();
  const bedLinks = ac.connectedTo.map(([, to]) => to);
  assert.ok(bedLinks.includes('musicBus'), 'ambience bed must ride the music bus');
  assert.ok(!bedLinks.includes('sfxBus'), 'ambience bed must never ride the sfx bus');
});

test('both volume sliders persist independently', async () => {
  const { t, storage } = await loadGame();
  t.loadSettings();
  t.Settings.soundVolume = 25;
  t.Settings.musicVolume = 80;
  t.saveSettings();
  const { t: t2 } = await loadGame({ 'atelier-ah-settings': storage._dump()['atelier-ah-settings'] });
  t2.loadSettings();
  assert.equal(t2.Settings.soundVolume, 25, 'sound volume persists');
  assert.equal(t2.Settings.musicVolume, 80, 'music volume persists independently');
});

test('HUD mute zeroes both sliders and persists the restore mix', async () => {
  const { t, storage } = await loadGame();
  t.loadSettings();
  t.Settings.soundVolume = 45;
  t.Settings.musicVolume = 82;
  t.AudioSys.setMasterMuted(true);
  assert.equal(t.Settings.soundVolume, 0, 'Sound Effects slider moves to zero');
  assert.equal(t.Settings.musicVolume, 0, 'Music slider moves to zero');
  assert.equal(t.Settings.soundBeforeMute, 45, 'Sound restore mix is remembered');
  assert.equal(t.Settings.musicBeforeMute, 82, 'Music restore mix is remembered');
  assert.equal(t.AudioSys.isMasterMuted(), true, 'both sliders at zero is the global mute state');
  const saved = JSON.parse(storage._dump()['atelier-ah-settings']);
  assert.equal(saved.soundVolume, 0, 'zeroed Sound slider persists');
  assert.equal(saved.musicVolume, 0, 'zeroed Music slider persists');
  assert.equal(saved.soundBeforeMute, 45, 'Sound restore level persists');
  assert.equal(saved.musicBeforeMute, 82, 'Music restore level persists');
});

test('HUD unmute restores the exact pre-mute channel mix', async () => {
  const { t } = await loadGame();
  t.loadSettings();
  t.Settings.soundVolume = 0;
  t.Settings.musicVolume = 64;
  t.AudioSys.setMasterMuted(true);
  assert.equal(t.Settings.soundVolume, 0);
  assert.equal(t.Settings.musicVolume, 0);
  t.AudioSys.setMasterMuted(false);
  assert.equal(t.Settings.soundVolume, 0, 'intentionally silent Sound Effects remains silent');
  assert.equal(t.Settings.musicVolume, 64, 'Music returns to its pre-mute value');
  assert.equal(t.AudioSys.isMasterMuted(), false, 'restoring one audible channel clears global mute');
  assert.equal(t.AudioSys.sfxBus.gain.value, 0, 'Sound bus follows restored slider');
  assert.ok(t.AudioSys.musicBus.gain.value > 0, 'Music bus follows restored slider');
});

test('global mute is derived directly from the two visible slider values', async () => {
  const { t } = await loadGame();
  t.loadSettings();
  t.Settings.soundVolume = 0;
  t.Settings.musicVolume = 0;
  assert.equal(t.AudioSys.isMasterMuted(), true, 'both zero means globally muted');
  t.Settings.musicVolume = 25;
  assert.equal(t.AudioSys.isMasterMuted(), false, 'raising either slider clears global mute');
});
