import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('goal ceremony no longer draws opaque black letterbox bars', () => {
  const start = game.indexOf('function renderTail(w, h)');
  const end = game.indexOf('function renderTail25(w, h)', start);
  assert.ok(start > 0 && end > start, 'renderTail block missing');
  const tail = game.slice(start, end);
  assert.doesNotMatch(tail, /rgba\(0,0,0,0\.88\)/);
  assert.doesNotMatch(tail, /VH - bh/);
  assert.match(tail, /drawGoalTextVirtual/);
});

test('2.5D HUD renders directly in screen space', () => {
  const start = game.indexOf('function render25(w, h)');
  const end = game.indexOf('function drawTableSkirt25', start);
  const block = game.slice(start, end);
  assert.match(block, /renderTail25\(w, h\)/);
  assert.doesNotMatch(block, /ctx\.translate\(view\.ox, view\.oy\); ctx\.scale\(view\.s, view\.s\);[\s\S]*renderTail/);
});

test('Surface view enforces readable text floors', () => {
  assert.match(game, /view\.camera === 'surface' \? 46 : 40/);
  assert.match(game, /view\.camera === 'surface' \? 17 : 14/);
  assert.match(game, /ctx\.strokeText\(t\.str, p\.x, p\.y\)/);
});
