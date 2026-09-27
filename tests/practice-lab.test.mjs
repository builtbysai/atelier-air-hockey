import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, ui, template, css] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('Practice Lab exposes three focused drills', () => {
  assert.match(template, /id="btnPractice"/);
  assert.match(template, /data-practice="free">Free Hit/);
  assert.match(template, /data-practice="power">Power Shot/);
  assert.match(template, /data-practice="keeper">Goalkeeper/);
  assert.match(game, /power:[\s\S]*target:60/);
  assert.match(game, /keeper:[\s\S]*target:5/);
});

test('Practice uses the normal game engine without an opponent', () => {
  assert.match(game, /if \(mode === 'practice'\) \{ Practice\.start/);
  assert.match(game, /if \(G\.mode !== 'practice'\) collideMallet\(p, G\.m2/);
  assert.match(game, /if \(G\.mode !== 'practice'\) drawMallet\(ctx, G\.m2\)/);
  assert.match(game, /if \(G\.mode !== 'practice'\) items\.push/);
});

test('Practice goals never change match score or start replay', () => {
  const start = game.indexOf('function onGoal(scorer)');
  const end = game.indexOf('// ONLINE: start the goal ceremony', start);
  const block = game.slice(start, end);
  assert.match(block, /G\.mode === 'practice' && Practice\.active\) \{ Practice\.onGoal\(scorer\); return; \}/);
  assert.ok(block.indexOf('Practice.onGoal') < block.indexOf('G.score[scorer]++'));
  assert.match(game, /G\.mode === 'practice' \|\| G\.demo/);
});

test('Power Shot and Goalkeeper teach measurable real mechanics', () => {
  assert.match(game, /Score at 60 km\/h or faster/);
  assert.match(game, /puckKmh/);
  assert.match(game, /Make 5 saves in a row/);
  assert.match(game, /Practice\.registerSave\(\)/);
  assert.match(game, /Math\.min\(1850, 1050 \+ this\.saveStreak \* 110\)/);
});

test('Practice bests persist locally and reset with progress', () => {
  assert.match(game, /PRACTICE_KEY = 'atelier-ah-practice'/);
  assert.match(game, /localStorage\.setItem\(PRACTICE_KEY/);
  assert.match(game, /localStorage\.getItem\(PRACTICE_KEY/);
  assert.match(ui, /Tour\.key, PRACTICE_KEY/);
});

test('Practice menu hides irrelevant Match Rules', () => {
  assert.match(ui, /practiceSel'\)\.classList\.toggle\('hidden', mode !== 'practice'\)/);
  assert.match(ui, /matchRulesBlock'\)\.classList\.toggle\('hidden', mode === 'practice'\)/);
  assert.match(ui, /ENTER PRACTICE/);
});

test('Practice has a compact theme-native in-game HUD and exit', () => {
  assert.match(template, /id="practiceHud"/);
  assert.match(template, /id="practiceExit"/);
  assert.match(css, /\.practice-hud/);
  assert.match(ui, /practiceExit'\)\.addEventListener\('click', quitToMenu\)/);
});

test('Practice HUD updates are throttled below physics frequency', () => {
  assert.match(game, /this\.hudT >= 0\.10/);
});
