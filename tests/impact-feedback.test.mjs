import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('SMASH flash intensity follows strike speed with explicit brightness caps', () => {
  const start = game.indexOf('function impactFlashProfile');
  const end = game.indexOf('function onMalletHit', start);
  const block = game.slice(start, end);
  assert.match(block, /const t = clamp\(\(impact - 1400\) \/ 1300, 0, 1\)/);
  assert.match(block, /const smooth = t \* t \* \(3 - 2 \* t\)/);
  assert.match(block, /Settings\.effects === 'subtle' \? 0\.34 : 0\.48/);
  assert.match(block, /radius: lerp\(125, Settings\.effects === 'subtle' \? 175 : 205, smooth\)/);
  assert.doesNotMatch(game, /G\.hitFlash = 0\.8/);
});

test('impact flash uses a bounded warm local glint in both render paths', () => {
  assert.match(game, /G\.hitFlashR = flash\.radius/);
  assert.match(game, /G\.roomPulse = Math\.max\(G\.roomPulse, flash\.room\)/);
  assert.match(game, /const r = G\.hitFlashR \|\| 160/);
  assert.match(game, /rgba\(255,246,224,/);
  assert.match(game, /flash\(G\.hitFlashX, G\.hitFlashY, G\.hitFlashR \|\| 160/);
});
