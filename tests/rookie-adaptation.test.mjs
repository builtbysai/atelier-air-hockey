import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('Rookie keeps its existing physical limits', () => {
  assert.match(game, /name:'Rookie',[\s\S]*?maxSpeed:1080, react:0\.22, aimErr:68, strike:0\.88/);
  assert.match(game, /maxSpeed:1080[\s\S]*?whiff:0\.06/);
});

test('Rookie has the strongest explicit repeated-lane memory', () => {
  assert.match(game, /blockOffset:82, laneMemory:0\.42/);
  assert.match(game, /blockOffset:72, laneMemory:0\.16/);
  assert.match(game, /blockOffset:62, laneMemory:0\.08/);
});

test('lane learning only reacts to real conceded goals', () => {
  const start = game.indexOf('function aiRememberGoalLane');
  const end = game.indexOf('function aiHome', start);
  const block = game.slice(start, end);
  assert.match(block, /G\.mode === 'ai'/);
  assert.match(block, /if \(scorer !== 0\) return/);
  assert.match(block, /G\.mode === 'watch'/);
  assert.match(block, /lane === defender\.concededLane/);
  assert.match(block, /concededLaneRepeat = Math\.min\(3, defender\.concededLaneRepeat \+ 1\)/);
  assert.match(block, /defender\.concededLaneRepeat = 1/);
});

test('guard bias appears only after a repeated lane and stays modest', () => {
  const start = game.indexOf('function aiHome');
  const end = game.indexOf('function aiThink', start);
  const block = game.slice(start, end);
  assert.match(block, /const repeats = Math\.max\(0, \(b\.concededLaneRepeat \|\| 0\) - 1\)/);
  assert.match(block, /D\.laneMemory \|\| 0/);
  assert.match(block, /Math\.min\(1, repeats \/ 2\)/);
  assert.match(block, /\+ learned \+ Math\.sin/);
});

test('normal matches and Rival Lab exercise the same lane-memory path', () => {
  const hits = game.match(/aiRememberGoalLane\(scorer\)/g) || [];
  assert.ok(hits.length >= 2, 'goal-lane memory should run in live goals and Rival Lab goals');
  assert.match(game, /RivalLab\.active && G\.mode === 'watch'/);
});
