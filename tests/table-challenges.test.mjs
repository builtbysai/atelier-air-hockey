import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, ui, css] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('every table has one persisted House challenge', () => {
  for (const id of ['deco','mid','brut','bil','mem','sashi','bau','zel','swi','neon'])
    assert.match(game, new RegExp('\\b' + id + ':\\s*\\{'), id + ' challenge missing');
  assert.match(game, /key:'atelier-ah-table-challenges'/);
  assert.match(game, /const TableChallenges = \{/);
  assert.match(game, /load\(\) \{[\s\S]*?atelier-ah-table-challenges/);
  assert.match(ui, /TableChallenges\.load\(\)/);
});

test('challenge checks are grounded in real match stats', () => {
  for (const field of [
    'oppScore','bestRally','topSpeedKmh','bankGoals','worstDef',
    'saves','margin','bestGoalRally','bestStreak'
  ]) assert.match(game, new RegExp('ctx\\.' + field), field + ' challenge input missing');

  assert.match(game, /bestGoalRally:\s*0, bankGoals:\s*\[0, 0\]/);
  assert.match(game, /G\.stats\.bestGoalRally = Math\.max/);
  assert.match(game, /G\.stats\.bankGoals\[scorer\]\+\+/);
});

test('House challenges only clear from a human House win', () => {
  assert.match(game, /G\.mode === 'ai' && G\.winSide === 0/);
  assert.match(game, /TableChallenges\.check\(G\.themeId, challengeContext\)/);
  assert.match(game, /CHALLENGE CLEARED ·/);
});

test('late rooms accept challenge clears as alternate skill gates', () => {
  assert.match(game, /zel:\s*\{[^\n]*challenge:'bau'/);
  assert.match(game, /swi:\s*\{[^\n]*challenge:'zel'/);
  assert.match(game, /neon:\s*\{[^\n]*challenge:'swi'/);
  assert.match(game, /g\.challenge && TableChallenges\.done\(g\.challenge\)/);
});

test('Progress and carousel surface challenge state without adding a new overlay', () => {
  assert.match(ui, /HOUSE CHALLENGES/);
  assert.ok(ui.includes("TableChallenges.count() + '/10 challenges · '"));
  assert.match(game, /el\.classList\.toggle\('challenged', TableChallenges\.done\(id\)\)/);
  assert.match(css, /\.tslide\.challenged \.tname::before/);
  assert.match(css, /\.challenge-row\.done/);
});

test('reset progress includes the House challenge store', () => {
  assert.match(ui, /Mastery\.key, TableChallenges\.key, Workshop\.key/);
  assert.match(ui, /House challenges/);
});
