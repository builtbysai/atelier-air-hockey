import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('rally count advances only when possession alternates sides', () => {
  assert.match(game, /rallyLastSide: -1/);
  const start = game.indexOf('function noteRallyTouch');
  const end = game.indexOf('function onMalletHit', start);
  const block = game.slice(start, end);
  assert.match(block, /side === G\.stats\.rallyLastSide/);
  assert.match(block, /G\.stats\.rallyLastSide = side;[\s\S]*G\.stats\.rally\+\+/);
  assert.match(block, /Practice\.onRally\(rallyN\)/);
});

test('all mallet collision feedback paths identify the touching side', () => {
  assert.match(game, /noteRallyTouch\(m\.side\);[\s\S]{0,80}onMalletHit\(p\.x, p\.y, 500, nx, ny\)/);
  assert.match(game, /noteRallyTouch\(m\.side\);[\s\S]{0,80}onMalletHit\(p\.x, p\.y, 750, rx, ry\)/);
  assert.match(game, /noteRallyTouch\(m\.side\);[\s\S]{0,80}onMalletHit\(p\.x, p\.y, impact, nx, ny, savedThisHit\)/);
});

test('rally HUD starts early, reads clearly, and reserves stronger feedback for milestones', () => {
  assert.match(game, /rallyN >= 3/);
  assert.match(game, /if \(rallyN >= 5 && rallyN % 5 === 0\)/);
  assert.match(game, /G\.rallyHudN = rallyN; G\.rallyHudT = 0\.95/);
  assert.match(game, /else if \(rallyN >= 3\)/);
  assert.match(game, /G\.rallyHudN = rallyN; G\.rallyHudT = 0\.46/);
  assert.match(game, /addText\(CX, CY - 72, 'RALLY ' \+ rallyN/);
  assert.match(game, /return 'RALLY · ' \+ G\.rallyHudN/);
  assert.match(game, /G\.stats\.rally = 0; G\.stats\.rallyLastSide = -1/);
});

test('Workshop stage and point resets begin a fresh exchange', () => {
  const start = game.indexOf('  resetPoint(note) {');
  const end = game.indexOf('  complete() {', start);
  const reset = game.slice(start, end);
  assert.match(reset, /G\.stats\.rally = 0; G\.stats\.rallyLastSide = -1/);
});

test('dribbles stay on one rally count and the next stage counts its first return', () => {
  const start = game.indexOf('function noteRallyTouch(side) {');
  const end = game.indexOf('function onMalletHit', start);
  const events = [];
  const state = {
    G: { state:'play', demo:false, mode:'workshop', stats:{ rally:0, bestRally:0, rallyLastSide:-1 }, rallyHudN:0, rallyHudT:0 },
    Practice: { onRally: n => events.push(n) },
    addText() {}, CX:720, CY:520, THEME:{ gold:'#fff' },
  };
  vm.runInNewContext(game.slice(start, end) + '\nthis.touch = noteRallyTouch;', state);
  for (const side of [0, 0, 0, 1, 1, 0]) state.touch(side);
  assert.deepEqual(events, [1, 2, 3]);
  assert.equal(state.G.stats.bestRally, 3);
  state.G.stats.rally = 0;
  state.G.stats.rallyLastSide = -1;
  state.touch(0);
  assert.deepEqual(events, [1, 2, 3, 1]);
});
