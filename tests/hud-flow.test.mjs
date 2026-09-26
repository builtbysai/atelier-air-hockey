import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, template, css] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('all cameras share one screen-space score/status HUD', () => {
  assert.match(game, /function renderScreenTail\(w, h\)/);
  assert.match(game, /function renderTail\(w, h\) \{ renderScreenTail\(w, h\); \}/);
  assert.match(game, /function renderTail25\(w, h\) \{ renderScreenTail\(w, h\); \}/);
  assert.match(game, /function drawHudCore\(c, w, h\)/);
  assert.match(game, /leave a clean lane for Pause\/Audio/);
});

test('countdown and goal text are screen-space across views', () => {
  assert.match(game, /function drawCountdownScreen\(c, w, h\)/);
  assert.match(game, /function drawGoalTextScreen\(c, w, h\)/);
  assert.doesNotMatch(game, /drawCountdown25\(cam\);/);
});

test('rally messaging is milestone-based rather than persistent', () => {
  assert.match(game, /rallyN >= 5 && rallyN % 5 === 0/);
  assert.match(game, /G\.rallyHudT = 0\.9/);
  assert.match(game, /G\.rallyHudN \+ ' HIT RALLY'/);
  assert.doesNotMatch(game, /RALLY ×/);
});

test('mode labels remain explicit for local, online, and exhibition play', () => {
  assert.match(game, /mode === '2p'\) return side === 0 \? 'P1' : 'P2'/);
  assert.match(game, /mode === 'online'\) return onlineSideLabel\(side\)/);
  assert.match(game, /mode === 'watch' && G\.watch/);
  assert.match(game, /return side === 0 \? 'YOU' : DIFFS\[G\.difficulty\]\.name\.toUpperCase\(\)/);
});

test('Pause and Audio are the only persistent gameplay controls', () => {
  const topbar = template.match(/<div id="topbar"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(topbar, /id="btnPause"/);
  assert.match(topbar, /id="btnSound"/);
  assert.doesNotMatch(topbar, /btnMenu/);
  assert.match(css, /#topbar/);
});
