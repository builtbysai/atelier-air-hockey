import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('mid-match goal ceremony is a composed screen-space payoff', () => {
  assert.match(game, /function drawGoalTextScreen\(c, w, h\)/);
  assert.match(game, /G\.goalScorerLabel/);
  assert.match(game, /G\.goalMomentLabel/);
  assert.match(game, /G\.goalSpeedKmh/);
  assert.match(game, /G\.score\[0\] \+ '  :  ' \+ G\.score\[1\]/);
  assert.match(game, /createRadialGradient/);
  assert.match(game, /WINNING GOAL/);
  assert.match(game, /NEXT GOAL WINS/);
  assert.match(game, /MATCH POINT/);
  assert.match(game, /LEAD TAKEN/);
});

test('goal ceremony records the shot at the crossing moment', () => {
  const start = game.indexOf('function beginGoalCeremony');
  const end = game.indexOf('function updateGoal', start);
  const block = game.slice(start, end);
  assert.match(block, /G\.goalSpeedKmh = Math\.round\(puckSpeed\(\)/);
  assert.ok(block.indexOf('G.goalSpeedKmh') < block.indexOf('AudioSys.goalChord'),
    'goal speed/copy should be frozen before the ceremony continues');
});

test('goal copy stays concise and avoids redundant +1 text', () => {
  const start = game.indexOf('function drawGoalTextScreen');
  const end = game.indexOf('function renderScreenTail', start);
  const block = game.slice(start, end);
  assert.doesNotMatch(block, /fillText\([^\n]*['"]\+1['"]/);
  assert.match(game, /return who === 'YOU' \? 'YOU SCORE' : who \+ ' SCORES'/);
  assert.match(block, /KM\/H/);
});
