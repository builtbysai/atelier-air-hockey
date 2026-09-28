import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('rivals use floating-triangle depth instead of one fixed defensive line', () => {
  const start=game.indexOf('function aiHome');
  const end=game.indexOf('function aiThink',start);
  const block=game.slice(start,end);
  assert.match(block,/const fromOwnGoal = clamp/);
  assert.match(block,/const floatDepth = \(D\.triangleFloat \|\| 0\) \* 95 \* fromOwnGoal/);
  assert.match(block,/baseTrack \* \(1 - fromOwnGoal \* 0\.14\)/);
  assert.match(game,/triangleFloat:0\.18/);
  assert.match(game,/triangleFloat:0\.38/);
  assert.match(game,/triangleFloat:0\.56/);
});

test('single-bank geometry mirrors the goal target across the rail', () => {
  const start=game.indexOf('function aiBankPoint');
  const end=game.indexOf('function aiPlanShot',start);
  const block=game.slice(start,end);
  assert.match(block,/const mirroredY = railY \* 2 - targetY/);
  assert.match(block,/\(railY - py\) \/ den/);
  assert.match(block,/px \+ \(goalX - px\) \* t/);
});

test('shot planner mixes cut, cross, under, and over families with shared-release deception', () => {
  const start=game.indexOf('function aiPlanShot');
  const end=game.indexOf('function aiMatchPressure',start);
  const block=game.slice(start,end);
  for(const family of ["'under'","'over'","'cut'","'cross'"]) assert.ok(block.includes(family));
  assert.match(block,/D\.sameRelease/);
  assert.match(block,/D\.delayChance/);
  assert.match(block,/aiBankPoint/);
  const wind=game.slice(game.indexOf("case 'windup':"),game.indexOf("case 'strike':"));
  assert.match(wind,/if \(b\.deceptive\)/);
  assert.match(wind,/b\.windGoal \|\| D\.windup/);
});

test('personality skill grows without secretly changing the existing speed/reaction ladder', () => {
  assert.match(game,/sameRelease:0\.18/);
  assert.match(game,/sameRelease:0\.55/);
  assert.match(game,/sameRelease:0\.82/);
  assert.match(game,/delayChance:0\.10/);
  assert.match(game,/delayChance:0\.28/);
  assert.match(game,/delayChance:0\.42/);
});
