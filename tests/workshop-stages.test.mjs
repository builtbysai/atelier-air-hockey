import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');

test('Workshop drills use the planned three-stage difficulty curve', () => {
  assert.match(game, /power:\s+\{ name:'Power',\s+stages:\[20,22,24\]/);
  assert.match(game, /control: \{ name:'Control',\s+stages:\[10,15,20\]/);
  assert.match(game, /keeper:\s+\{ name:'Keeper',\s+stages:\[3,5,7\]/);
  assert.match(game, /free:\s+\{ name:'Free Hit',[\s\S]*free:true/);
});

test('legacy cleared saves remain Stage 1 and Stage 1 still drives unlock gates', () => {
  const start = game.indexOf('const Workshop = {');
  const end = game.indexOf('// The first four rooms', start);
  const block = game.slice(start, end);
  assert.match(block, /stage\(id\)[\s\S]*Number\(this\.data\[id\]\)/);
  assert.match(block, /done\(id\) \{ return this\.stage\(id\) >= 1; \}/);
  assert.match(block, /complete\(id\) \{ return this\.completeStage\(id, 1\); \}/);
  assert.match(game, /if \(g\.drill && Workshop\.done\(g\.drill\)\) return true;/);
});

test('clearing a stage persists it and advances the same session until mastery', () => {
  const start = game.indexOf('maybeClear() {');
  const end = game.indexOf('onFreeTarget', start);
  const block = game.slice(start, end);
  assert.match(block, /Workshop\.completeStage\(this\.id, clearedStage\)/);
  assert.match(block, /if \(clearedStage < d\.stages\.length\)/);
  assert.match(block, /this\.stage = clearedStage \+ 1/);
  assert.match(block, /this\.resetPoint\('Stage '/);
  assert.match(block, /this\.complete\(\)/);
});

test('Workshop surfaces stage progress instead of a one-and-done clear', () => {
  assert.match(ui, /stage >= 3\) state\.textContent = 'MASTERED'/);
  assert.match(ui, /stage \+ '\/3 CLEARED'/);
  assert.match(ui, /Workshop\.masteredCount\(\) \+ '\/3 drills mastered'/);
});
