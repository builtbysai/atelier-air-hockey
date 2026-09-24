// Structural tests for the generative music system (MusicSys).
// Runs in node without a DOM: parses source text, never executes it.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const game = await readFile('src/game.js', 'utf8');
const ui = await readFile('src/ui.js', 'utf8');
const template = await readFile('src/template.html', 'utf8');

// the 9 table ids, from the theme carousel order in ui.js
const order = ui.match(/const THEME_ORDER = \[([^\]]+)\]/)[1]
  .split(',').map(s => s.trim().replace(/['"]/g, ''));
assert.equal(order.length, 9, 'expected 9 tables in THEME_ORDER');

// isolate the MUSIC literal (closing "};" at column 0)
const mStart = game.indexOf('const MUSIC = {');
assert.ok(mStart > 0, 'MUSIC config missing from game.js');
const mEnd = game.indexOf('\n};', mStart);
assert.ok(mEnd > mStart, 'MUSIC literal terminator not found');
const musicBlock = game.slice(mStart, mEnd);

const seeds = new Set();
for (const id of order) {
  const re = new RegExp(id + ':\\s*\\{([\\s\\S]*?)\\},?\\s*(?://.*)?$');
  // simpler: grab from "id:" to the first "\n  },"-style close; entries have no nested objects
  const start = musicBlock.indexOf(id + ':');
  assert.ok(start > 0, `MUSIC entry missing for table '${id}'`);
  const close = musicBlock.indexOf('},', start);
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
  const chordsM = entry.match(/chords:\s*(\[[\s\d,\[\]]+\])/);
  assert.ok(chordsM, `${id}: chords missing`);
  for (const b of ['pulse', 'drum', 'shimmer', 'melWave', 'melDens', 'bassDens', 'padCut'])
    assert.ok(entry.includes(b + ':'), `${id}: voice field '${b}' missing`);
  // 'drone' is opt-in (brut); when present it must be a boolean
  const droneM = entry.match(/drone:\s*(true|false)/);
  assert.ok(!droneM || droneM[1] === 'true', `${id}: drone must be true when present`);
}

// wiring
assert.match(game, /const MusicSys = \{/, 'MusicSys object missing');
assert.match(game, /MusicSys\.prime\(\)/, 'music must prime on first user gesture (AudioSys.init)');
assert.match(game, /MusicSys\.goalSwell\(\)/, 'goal ceremony should swell the music');
assert.match(game, /MusicSys\.setIntensity\(/, 'match-point intensity hook missing');
assert.match(game, /music: true,/, 'Settings.music default missing');
assert.match(ui, /MusicSys\.setTable\(id\)/, 'setTheme must switch the music table');
assert.match(ui, /MusicSys\.syncEnabled\(\)/, 'settings apply must sync the music toggle');
assert.match(ui, /key === 'music'/, 'setSetting must parse the music boolean');
assert.match(template, /data-set="music"/, 'settings UI needs a Music toggle');
console.log(`music-config: ${order.length} tables, ${seeds.size} unique seeds — ok`);
