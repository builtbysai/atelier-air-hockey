import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, template] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
]);

test('all cameras share one screen-space score and status HUD', () => {
  assert.match(game, /function renderScreenTail\(w, h\)/);
  assert.match(game, /function renderTail\(w, h\) \{ renderScreenTail\(w, h\); \}/);
  assert.match(game, /function renderTail25\(w, h\) \{ renderScreenTail\(w, h\); \}/);
  assert.match(game, /function drawHudCore\(c, w, h\)/);
  assert.match(game, /const controlLane = w <= 600 \? 112 : 150/);
});

test('top-down restores world transforms before drawing HUD', () => {
  const start = game.indexOf('function renderTop(w, h)');
  const end = game.indexOf('function hudStatusText()', start);
  const block = game.slice(start, end);
  assert.match(block, /ctx\.save\(\)/);
  assert.match(block, /ctx\.restore\(\); \/\/ rink transform/);
  assert.match(block, /renderScreenTail\(w, h\)/);
});

test('countdown and goal celebration are screen-space for every camera', () => {
  assert.match(game, /function drawCountdownScreen\(c, w, h\)/);
  assert.match(game, /function drawGoalTextScreen\(c, w, h\)/);
  assert.doesNotMatch(game, /drawCountdown25\(cam\);/);
});

test('mode labels remain explicit in the shared scoreboard', () => {
  assert.match(game, /mode === '2p'\) return side === 0 \? 'P1' : 'P2'/);
  assert.match(game, /mode === 'online'\) return onlineSideLabel\(side\)/);
  assert.match(game, /mode === 'watch' && G\.watch/);
  assert.match(game, /return side === 0 \? 'YOU' : DIFFS\[G\.difficulty\]\.name\.toUpperCase\(\)/);
});

test('goal feedback avoids redundant +1 world text', () => {
  const start = game.indexOf('function beginGoalCeremony');
  const end = game.indexOf('function updateGoal', start);
  const block = game.slice(start, end);
  assert.doesNotMatch(block, /addText\([^\n]*'\+1'/);
  assert.match(game, /G\.goalStreakLabel/);
});

test('gameplay topbar contains only Pause and Audio controls', () => {
  const topbar = template.match(/<div id="topbar"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(topbar, /id="btnPause"/);
  assert.match(topbar, /id="btnSound"/);
  assert.doesNotMatch(topbar, /btnMenu/);
});
