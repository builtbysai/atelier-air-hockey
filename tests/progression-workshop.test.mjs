import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, ui, template, css] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('Workshop is a real playable practice surface', () => {
  assert.match(template, /id="btnWorkshop">Workshop/);
  for (const id of ['power','control','keeper'])
    assert.match(template, new RegExp('data-workshop="' + id + '"'));
  assert.match(game, /function startWorkshop(id)/);
  assert.match(game, /G.mode = 'workshop'/);
  assert.ok(game.includes('const WORKSHOP_DRILLS ='));
  assert.ok(game.includes("Score at 55 km/h"));
  assert.ok(game.includes("Build a 10-hit rally"));
  assert.ok(game.includes("Make 3 clean saves"));
});

test('Workshop drills use live match events without awarding normal match progression', () => {
  assert.match(game, /Practice.onRally(rallyN)/);
  assert.match(game, /Practice.onSave(m.side)/);
  assert.match(game, /Practice.onGoal(scorer, kmh)/);
  const onGoal = game.slice(game.indexOf('function onGoal(scorer)'), game.indexOf('function goalIsYours'));
  assert.match(onGoal, /if (G.mode === 'workshop')[sS]*?return;/);
  assert.match(game, /G.mode === 'workshop' || G.demo/);
});

test('mastery is persisted independently from raw win counts', () => {
  assert.ok(game.includes('const Mastery ='));
  assert.ok(game.includes('atelier-ah-mastery'));
  assert.match(game, /Mastery.award(G.themeId, G.difficulty)/);
  assert.ok(game.includes('TABLE MASTERED'));
  assert.match(ui, /Mastery.load()/);
});

test('first four rooms are open and later rooms use explicit skill gates', () => {
  assert.match(game, /['deco','mid','brut','bil'].includes(id)/);
  for (const id of ['mem','sashi','bau','zel','swi','neon'])
    assert.match(game, new RegExp(id + ':'));
  assert.ok(game.includes("drill:'power'"));
  assert.ok(game.includes("drill:'control'"));
  assert.ok(game.includes("drill:'keeper'"));
  assert.match(game, /Mastery.masteredCount()/);
  assert.match(game, /if (Tour.won(id)) return true/);
});

test('locked rooms remain visible but cannot start a match', () => {
  assert.ok(ui.includes('class="tlock hidden"'));
  assert.match(css, /.tslide.locked/);
  assert.match(ui, /label.textContent = 'TABLE LOCKED'/);
  assert.match(ui, /start.disabled = true/);
  assert.match(game, /tableLockReason(id)/);
});

test('stronger House wins grant table mastery and can unlock new rooms', () => {
  assert.match(game, /Math.max(before, clamp(Number(diffIdx) + 1, 1, 3))/);
  assert.match(game, /newlyUnlockedTables(unlockBefore)/);
  assert.ok(game.includes('UNLOCKED ·'));
});

test('House rivals expose distinct behavioral profiles', () => {
  assert.match(game, /style:'COUNTER PUNCHER'/);
  assert.match(game, /style:'PLACEMENT PLAYER'/);
  assert.match(game, /style:'PRESSURE PLAYER'/);
  assert.match(game, /homeDepth:155/);
  assert.match(game, /homeDepth:230/);
  assert.match(game, /bankChance:0.04/);
  assert.match(game, /bankChance:0.38/);
  assert.match(template, /COUNTER PUNCHER/);
  assert.match(template, /PLACEMENT PLAYER/);
  assert.match(template, /PRESSURE PLAYER/);
});

test('reset progress includes Workshop and mastery stores', () => {
  assert.match(ui, /Mastery.key, Workshop.key/);
  assert.match(ui, /Mastery.load(); Workshop.load()/);
});

test('Workshop HUD is separate from the match scoreboard', () => {
  assert.ok(template.includes('id="workshopHud"'));
  assert.match(game, /if (G.demo || G.mode === 'workshop') return;/);
  assert.match(css, /.workshop-hud/);
});
