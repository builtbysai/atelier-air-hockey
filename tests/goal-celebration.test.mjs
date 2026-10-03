import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, template, css] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('mid-match goal ceremony is a composed screen-space payoff', () => {
  assert.match(game, /function drawGoalTextScreen\(c, w, h\)/);
  assert.match(game, /G\.goalScorerLabel/);
  assert.match(game, /G\.goalMomentLabel/);
  assert.match(game, /G\.goalSpeedKmh/);
  assert.match(game, /side === G\.goalSide/);
  assert.match(game, /const scorerKick/);
  assert.match(game, /G\.goalRewardLabel/);
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
  assert.match(block, /G\.goalSpeedKmh = \(G\.mode === 'online' && !onlineIsAuthority\(\)\)/);
  assert.match(block, /\? G\.goalContext\.speed : Math\.round\(puckSpeed\(\)/);
  assert.match(block, /Feel\.validGoalContext\(remoteGoalContext/);
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


test('short landscape goal composition clears the scoreboard band', () => {
  const start = game.indexOf('function drawGoalTextScreen');
  const end = game.indexOf('function renderScreenTail', start);
  const block = game.slice(start, end);
  assert.match(block, /const compactLandscape = w \/ Math\.max\(1, h\) > 1\.55 && h < 520/);
  assert.match(block, /compactLandscape \? 0\.61 : 0\.50/);
  assert.match(block, /clamp\(h \* 0\.30, 112, 152\)/);
});


test('goal ceremony duration respects the player-facing hierarchy', () => {
  assert.match(game, /const GOAL_HOLD_OWN = 1\.95/);
  assert.match(game, /const GOAL_HOLD_CONCEDE = 1\.60/);
  assert.match(game, /const GOAL_HOLD_WIN = 2\.70/);
  assert.match(game, /winningGoal \? GOAL_HOLD_WIN/);
  assert.match(game, /goalIsYours\(G\.goalSide\) \? GOAL_HOLD_OWN : GOAL_HOLD_CONCEDE/);
  assert.ok(1.60 < 1.95, 'ordinary conceded goals should return to play sooner than player goals');
  assert.ok(1.95 < 2.70, 'winning goals should retain the longest payoff');
});


test('goal and score changes are announced outside the canvas', () => {
  assert.match(template, /id="gameStatus" class="sr-only" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(css, /\.sr-only\{[\s\S]*?clip-path:inset\(50%\)/);
  assert.match(game, /function announceGoalStatus\(scorer\)/);
  assert.match(game, /spokenSideLabel\(scorer\) \+ ' scores\. Score '/);
  const start = game.indexOf('function beginGoalCeremony');
  const end = game.indexOf('function updateGoal', start);
  const block = game.slice(start, end);
  assert.ok(block.indexOf('G.goalMomentLabel = goalMomentContext(scorer)') < block.indexOf('announceGoalStatus(scorer)'),
    'the live announcement should include the final goal context');
});


test('goal payoff rewards shot craft without making every goal equally loud', () => {
  assert.match(game, /skillLabel\(g\)/);
  assert.match(game, /if \(g\.bankShot\) return 'BANK SHOT'/);
  assert.match(game, /return 'SAVE \+ SCORE'/);
  assert.match(game, /return 'RALLY FINISH · ' \+ g\.rally/);
  assert.match(game, /return 'ROCKET · ' \+ g\.speedKmh \+ ' KM\/H'/);
  const start = game.indexOf('function drawGoalTextScreen');
  const end = game.indexOf('function renderScreenTail', start);
  const block = game.slice(start, end);
  assert.match(block, /if \(G\.goalRewardLabel\)/);
  assert.match(block, /rewardW/);
  assert.match(block, /if \(!PRM\.reduce && yours\)/);
});
