import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('rally count advances only when possession alternates sides', () => {
  assert.match(game, /rallyLastSide: -1/);
  const start = game.indexOf('function onMalletHit');
  const end = game.indexOf('function onRailHit', start);
  const block = game.slice(start, end);
  assert.match(block, /side !== G\.stats\.rallyLastSide/);
  assert.match(block, /G\.stats\.rallyLastSide = side;[\s\S]*G\.stats\.rally\+\+/);
  assert.match(block, /Practice\.onRally\(rallyN\)/);
});

test('all mallet collision feedback paths identify the touching side', () => {
  assert.match(game, /onMalletHit\(p\.x, p\.y, 500, nx, ny, m\.side, false\)/);
  assert.match(game, /onMalletHit\(p\.x, p\.y, 750, rx, ry, m\.side, false\)/);
  assert.match(game, /onMalletHit\(p\.x, p\.y, impact, nx, ny, m\.side, savedThisHit\)/);
});

test('rally HUD starts early, reads clearly, and reserves stronger feedback for milestones', () => {
  assert.match(game, /rallyN >= 3/);
  assert.match(game, /rallyN % 5 === 0 \? 0\.95 : 0\.46/);
  assert.match(game, /addText\(CX, CY - 72, 'RALLY ' \+ rallyN/);
  assert.match(game, /return 'RALLY · ' \+ G\.rallyHudN/);
  assert.match(game, /G\.stats\.rally = 0; G\.stats\.rallyLastSide = -1/);
});
