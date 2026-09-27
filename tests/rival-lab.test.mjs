import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, runner, workflow] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/rival-soak.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/visual-qa.yml', import.meta.url), 'utf8'),
]);

test('rival lab is public-build safe and deterministic', () => {
  assert.match(game, /const RivalLab = \{/);
  assert.match(game, /\['localhost','127\.0\.0\.1'\]\.includes\(window\.location\?\.hostname\)/);
  assert.match(game, /window\.__atelierRivalLab = RivalLab/);
  assert.match(game, /seeded\(seed\)/);
  assert.match(game, /RivalLab\.active \? RivalLab\.clock : performance\.now\(\) \/ 1000/);
});

test('soak runner exercises real game physics and real brains', () => {
  assert.match(game, /aiDrive\(G\.ai1, dt, G\.m1\); aiDrive\(G\.ai2, dt, G\.m2\)/);
  assert.match(game, /stepPhysics\(dt\)/);
  assert.match(game, /RivalLab\.active && G\.mode === 'watch'/);
  assert.match(game, /RivalLab\.onGoal\(scorer\)/);
});

test('rival telemetry measures behavior rather than only configured stats', () => {
  for (const signal of [
    'strikesPerMinute','bankRate','keeperReadRate','whiffRate',
    'counterShots','defends','rebounds','detours','escapes','ownGoals','stateShare'
  ]) assert.ok(game.includes(signal), signal + ' telemetry missing');
  assert.match(game, /b\.lastReadKeeper = readsKeeper/);
  assert.match(game, /previous === 'recover' && brain\.state === 'engage'/);
  assert.match(game, /counterWindow:1\.05/);
  assert.match(game, /saveBrain\.counterT = saveBrain\.diff\.counterWindow/);
  assert.match(game, /RivalLab\.noteTouch\(m\.side, preTouchVx, preTouchVy, p\.vx, p\.vy\)/);
  assert.match(game, /last\.shank && this\.clock - last\.time < 1\.2/);
  assert.match(game, /const counterShot = b\.counterT > 0/);
  assert.match(game, /b\.counterCommitted = counterShot/);
  assert.match(game, /function aiControlledBlock\(m, p, preVx\)/);
  assert.match(game, /afterGoalward <= beforeGoalward \+ 150/);
  assert.match(game, /brain\.counterT = Math\.max/);
});

test('CI guards rival identity and simulation health', () => {
  assert.match(runner, /deadlocked rival matches/);
  assert.match(runner, /exceeded 240 simulated seconds/);
  assert.match(game, /deadlocked:this\.current\.deadMax > 5/);
  assert.match(game, /maxSeconds\) \|\| 240/);
  assert.match(runner, /ownGoalRate > 0\.18/);
  assert.match(runner, /r\.bankRate < p\.bankRate && p\.bankRate < c\.bankRate/);
  assert.match(runner, /r\.keeperReadRate < p\.keeperReadRate && p\.keeperReadRate < c\.keeperReadRate/);
  assert.match(runner, /c\.rebounds > r\.rebounds/);
  assert.match(workflow, /Run deterministic rival soak/);
  assert.match(workflow, /atelier-rival-soak/);
});
