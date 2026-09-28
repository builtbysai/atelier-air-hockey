import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

test('only played local modes are eligible for persistent match progress', () => {
  const start = game.indexOf('function matchPersistsProgress');
  const end = game.indexOf('function resultIsHumanWin', start);
  const helper = game.slice(start, end);
  assert.match(helper, /return mode === 'ai' \|\| mode === '2p';/);
  assert.doesNotMatch(helper, /watch|online/,
    'Exhibition and online sessions must remain outside local persistent progression');
});

test('showWin gates records and progression behind the persistence contract', () => {
  const start = game.indexOf('function showWin()');
  const end = game.indexOf('function togglePause', start);
  const block = game.slice(start, end);
  assert.match(block, /const canPersist = matchPersistsProgress\(\);/);
  assert.match(block, /if \(canPersist && G\.mode === 'ai'\) Record\.bump/);
  assert.match(block, /else if \(canPersist && G\.mode === '2p'\)/);
  assert.match(block, /if \(canPersist && \(G\.mode === '2p' \|\| G\.winSide === 0\)\)/);

  const persistentWrites = [
    'checkBest(', 'Feats.unlock(', 'TableChallenges.check(', 'Mastery.award(',
    'Tour.bump(', 'newlyUnlockedTables('
  ];
  const gate = block.indexOf("if (canPersist && (G.mode === '2p' || G.winSide === 0))");
  assert.ok(gate >= 0);
  for (const call of persistentWrites) {
    const pos = block.indexOf(call);
    assert.ok(pos > gate, call + ' must stay inside the eligible-progression branch');
  }
});
