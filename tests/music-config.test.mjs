// Structural tests for the generative music system (MusicSys).
// Runs in node without a DOM: parses source text, never executes it.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const game = await readFile('src/game.js', 'utf8');
const ui = await readFile('src/ui.js', 'utf8');
const template = await readFile('src/template.html', 'utf8');

// the 10 table ids, from the theme carousel order in ui.js
const order = ui.match(/const THEME_ORDER = \[([^\]]+)\]/)[1]
  .split(',').map(s => s.trim().replace(/['"]/g, ''));
assert.equal(order.length, 10, 'expected 10 tables in THEME_ORDER');

// isolate the MUSIC literal (closing "};" at column 0)
const mStart = game.indexOf('const MUSIC = {');
assert.ok(mStart > 0, 'MUSIC config missing from game.js');
const mEnd = game.indexOf('\n};', mStart);
assert.ok(mEnd > mStart, 'MUSIC literal terminator not found');
const musicBlock = game.slice(mStart, mEnd);

const seeds = new Set();
for (const id of order) {
  const re = new RegExp(id + ':\\s*\\{([\\s\\S]*?)\\},?\\s*(?://.*)?$');
  // rooms nest objects (prog chords, bass, drums, form), so find the entry's
  // close by brace-depth scanning from its opening brace
  const start = musicBlock.indexOf(id + ':');
  assert.ok(start > 0, `MUSIC entry missing for table '${id}'`);
  const open = musicBlock.indexOf('{', start);
  let depth = 0, close = -1;
  for (let i = open; i < musicBlock.length; i++) {
    if (musicBlock[i] === '{') depth++;
    else if (musicBlock[i] === '}') { depth--; if (depth === 0) { close = i; break; } }
  }
  assert.ok(close > start, `MUSIC entry for '${id}' is malformed`);
  const entry = musicBlock.slice(start, close);
  const num = (k) => { const m = entry.match(new RegExp(k + ':\\s*([\\d.]+)')); assert.ok(m, `${id}: ${k} missing`); return parseFloat(m[1]); };
  const seed = num('seed'), root = num('root'), bpm = num('bpm'), level = num('level');
  assert.ok(Number.isInteger(seed), `${id}: seed must be an integer`);
  assert.ok(!seeds.has(seed), `${id}: duplicate seed ${seed}`);
  seeds.add(seed);
  assert.ok(root >= 20 && root <= 80, `${id}: root midi ${root} out of range`);
  assert.ok(bpm >= 40 && bpm <= 120, `${id}: bpm ${bpm} out of range`);
  // v24.2: the bed was inaudible at <=0.1 (measured -52 dBFS at the master
  // vs -11 dBFS SFX peaks on 2026-09-24). Levels ~1.0 put the bed at
  // ~-26 dBFS: clearly audible, still ~15 dB under the SFX.
  assert.ok(level >= 0.5 && level <= 1.5, `${id}: level ${level} out of range (bed must be audible but under SFX)`);
  const modeM = entry.match(/mode:\s*\[([\d,\s]+)\]/);
  assert.ok(modeM, `${id}: mode missing`);
  const mode = modeM[1].split(',').map(s => parseInt(s.trim(), 10));
  assert.ok(mode.length >= 3, `${id}: mode needs at least 3 degrees`);
  assert.ok(mode.every(s => s >= 0 && s <= 24), `${id}: mode degrees out of range`);
  const progM = entry.match(/prog:\s*\[/);
  assert.ok(progM, `${id}: prog (composed progression) missing`);
  const progCount = (entry.match(/\{r:\d+,t:\[/g) || []).length;
  assert.ok(progCount >= 4, `${id}: prog needs at least 4 chords, found ${progCount}`);
  // every chord tone must sit in a compact voicing (0..26 semitones above the root)
  for (const tm of entry.matchAll(/t:\[([\d, ]+)\]/g)) {
    for (const st of tm[1].split(',').map(x => parseInt(x.trim(), 10)))
      assert.ok(st >= 0 && st <= 26, `${id}: chord tone ${st} out of voicing range`);
  }
  // bridge: the turnaround for every 4th cycle
  assert.ok(entry.match(/bridge:\s*\[/), `${id}: bridge (turnaround) missing`);
  // motif: question + answer phrases of [mode-degree, beats]
  assert.ok(entry.match(/motif:\s*\{\s*q:\s*\[/), `${id}: motif.q missing`);
  assert.ok(entry.match(/a:\s*\[/), `${id}: motif.a missing`);
  // motif phrases must fit inside one 16-beat phrase
  for (const pm of entry.matchAll(/(q|a):\s*(\[(\[\d+,\d+\],?)+\])/g)) {
    const beats = [...pm[2].matchAll(/\[(\d+),(\d+)\]/g)].reduce((s, x) => s + parseInt(x[2], 10), 0);
    assert.ok(beats > 0 && beats <= 16, `${id}: motif.${pm[1]} spans ${beats} beats, must fit one phrase`);
  }
  // bass: a Euclidean pattern over the 16-step bar
  const bassM = entry.match(/bass:\s*\{\s*k:\s*(\d+),\s*n:\s*(\d+)/);
  assert.ok(bassM, `${id}: bass euclidean pattern missing`);
  assert.ok(parseInt(bassM[1], 10) >= 1 && parseInt(bassM[2], 10) === 16, `${id}: bass must be k hits over 16 steps`);
  assert.ok(entry.match(/alt:\s*\d+/), `${id}: bass alt interval missing`);
  // drums: null (still rooms) or per-layer euclidean patterns
  assert.ok(entry.includes('drums:'), `${id}: drums field missing`);
  const hasLayers = entry.includes('kick:');
  if (entry.includes('drums: null')) assert.ok(!hasLayers, `${id}: drums null but layers present`);
  else {
    assert.ok(hasLayers && entry.includes('snare:') && entry.includes('hat:'), `${id}: drums needs kick/snare/hat layers`);
    assert.ok(entry.match(/swing:\s*[\d.]+/), `${id}: swing field missing`);
  }
  // form: the 4-section arrangement arc (enter, settle, full, break)
  assert.ok(entry.match(/form:\s*\[/), `${id}: form (arrangement arc) missing`);
  for (const b of ['pulse', 'shimmer', 'melWave', 'padCut'])
    assert.ok(entry.includes(b + ':'), `${id}: voice field '${b}' missing`);
  // 'drone' is a plain boolean on every room (only brut sets it true)
  const droneM = entry.match(/drone:\s*(true|false)/);
  assert.ok(droneM, `${id}: drone boolean missing`);
}

// wiring
assert.match(game, /const MusicSys = \{/, 'MusicSys object missing');
assert.match(game, /MusicSys\.prime\(\)/, 'music must prime on first user gesture (AudioSys.init)');
assert.match(game, /MusicSys\.goalSwell\(\)/, 'goal ceremony should swell the music');
assert.match(game, /MusicSys\.setIntensity\(/, 'match-point intensity hook missing');
assert.match(game, /setSessionSeed\(s\)/, 'MusicSys.setSessionSeed missing');
const net = await readFile('src/net.js', 'utf8');
assert.match(net, /mseed/, 'hello handshake must carry the music session seed');
assert.match(net, /MusicSys\.setSessionSeed\(/, 'guest must apply the host music seed');
assert.match(game, /music: true,/, 'Settings.music default missing');
assert.match(ui, /MusicSys\.setTable\(id\)/, 'setTheme must switch the music table');
assert.match(ui, /MusicSys\.syncEnabled\(\)/, 'settings apply must sync the music toggle');
assert.match(ui, /key === 'music'/, 'setSetting must parse the music boolean');
assert.match(template, /data-set="music"/, 'settings UI needs a Music toggle');
console.log(`music-config: ${order.length} tables, ${seeds.size} unique seeds - ok`);
