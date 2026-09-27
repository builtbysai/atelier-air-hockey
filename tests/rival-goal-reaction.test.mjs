import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, ui, visualQa] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/visual-qa.mjs', import.meta.url), 'utf8'),
]);

test('rival goal body language is render-only and personality-scaled', () => {
  const start = game.indexOf('function goalRivalRenderPose');
  const end = game.indexOf('function drawMallet25', start);
  const block = game.slice(start, end);

  assert.match(block, /const base = \{ x:m\.x, y:m\.y \}/);
  assert.match(block, /const retreat = \[48, 28, 14\]/);
  assert.match(block, /Math\.sin\(Math\.PI \* u\)/);
  assert.match(block, /return \{ x:m\.x \+ towardOwnGoal \* retreat, y:m\.y \}/);
  assert.doesNotMatch(block, /m\.x\s*=|m\.y\s*=/);
});

test('only an AI-controlled conceder can react', () => {
  const start = game.indexOf('function goalRivalRenderPose');
  const end = game.indexOf('function drawMallet25', start);
  const block = game.slice(start, end);

  assert.match(block, /G\.state !== 'goal' \|\| G\.goalSide === m\.side/);
  assert.match(block, /G\.mode === 'ai' && m\.side === 1/);
  assert.match(block, /G\.mode === 'watch' && G\.watch/);
  assert.match(block, /if \(diffIdx < 0\) return base/);
  assert.doesNotMatch(block, /G\.mode === 'online'/);
  assert.doesNotMatch(block, /G\.mode === '2p'/);
});

test('goal body language respects motion and effects preferences', () => {
  const start = game.indexOf('function goalRivalRenderPose');
  const end = game.indexOf('function drawMallet25', start);
  const block = game.slice(start, end);

  assert.match(block, /PRM\.reduce/);
  assert.match(block, /Settings\.effects === 'minimal'/);
  assert.match(block, /Settings\.effects === 'subtle' \? 0\.6 : 1/);
});

test('top-down and 2.5D mallet renderers share the same reaction pose', () => {
  assert.match(game, /function drawMallet25\(cam, m\) \{[\s\S]*?pose = goalRivalRenderPose\(m\)/);
  assert.match(game, /tableEll25\(cam, pose\.x, pose\.y, 0, r\)/);
  assert.match(game, /function drawMallet\(c, m\) \{[\s\S]*?pose = goalRivalRenderPose\(m\)/);
  assert.match(game, /c\.translate\(pose\.x, pose\.y\)/);
});


test('visual QA captures the reaction with motion enabled', () => {
  assert.match(ui, /case 'goal-rival'/);
  assert.match(ui, /PRM\.reduce = false; Settings\.effects = 'full'/);
  assert.match(ui, /G\.goalT = 0\.52/);
  const hits = visualQa.match(/'goal-rival'/g) || [];
  assert.ok(hits.length >= 2, 'phone and short-landscape matrices should capture the rival reaction');
});
