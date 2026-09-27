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
  assert.ok(template.includes('id="btnWorkshop">Workshop'));
  for (const id of ['power','control','keeper'])
    assert.ok(template.includes(`data-workshop="${id}"`), id + ' drill missing');
  assert.ok(game.includes('function startWorkshop(id)'));
  assert.ok(game.includes("G.mode = 'workshop'"));
  assert.ok(game.includes('const WORKSHOP_DRILLS ='));
  assert.ok(game.includes('Score at 22 km/h'));
  assert.ok(game.includes('Build a 10-hit rally'));
  assert.ok(game.includes('Make 3 clean saves'));
});

test('Workshop drills use live match events without awarding normal match progression', () => {
  assert.ok(game.includes('Practice.onRally(rallyN)'));
  assert.ok(game.includes('Practice.onSave(m.side)'));
  assert.ok(game.includes('Practice.onGoal(scorer, kmh)'));
  assert.ok(game.includes("if (G.mode === 'workshop')"));
  assert.ok(game.includes("G.mode === 'workshop' || G.demo"));
  assert.ok(game.includes("G.mode === 'workshop' || G.demo || G.state !== 'play'"));
});

test('mastery is persisted independently from raw win counts', () => {
  assert.ok(game.includes('const Mastery ='));
  assert.ok(game.includes('atelier-ah-mastery'));
  assert.ok(game.includes('Mastery.award(G.themeId, G.difficulty)'));
  assert.ok(game.includes('TABLE MASTERED'));
  assert.ok(ui.includes('Mastery.load()'));
});

test('first four rooms are open and later rooms use explicit skill gates', () => {
  assert.ok(game.includes("['deco','mid','brut','bil'].includes(id)"));
  for (const id of ['mem','sashi','bau','zel','swi','neon'])
    assert.ok(game.includes(`${id}:`), id + ' gate missing');
  assert.ok(game.includes("drill:'power'"));
  assert.ok(game.includes("drill:'control'"));
  assert.ok(game.includes("drill:'keeper'"));
  assert.ok(game.includes('Mastery.masteredCount()'));
  assert.ok(game.includes('if (Tour.won(id)) return true'));
});

test('locked rooms remain visible but cannot start a match', () => {
  assert.ok(ui.includes('class="tlock hidden"'));
  assert.ok(css.includes('.tslide.locked'));
  assert.ok(ui.includes("label.textContent = 'TABLE LOCKED'"));
  assert.ok(ui.includes('start.disabled = true'));
  assert.ok(game.includes('tableLockReason(id)'));
});

test('stronger House wins grant table mastery and can unlock new rooms', () => {
  assert.ok(game.includes('Math.max(before, clamp(Number(diffIdx) + 1, 1, 3))'));
  assert.ok(game.includes('newlyUnlockedTables(unlockBefore)'));
  assert.ok(game.includes('UNLOCKED ·'));
});

test('House rivals expose distinct behavioral profiles', () => {
  for (const x of ['COUNTER PUNCHER','PLACEMENT PLAYER','PRESSURE PLAYER']) {
    assert.ok(game.includes(x), x + ' profile missing in engine');
    assert.ok(template.includes(x), x + ' profile missing in menu');
  }
  assert.ok(game.includes('homeDepth:175'));
  assert.ok(game.includes('homeDepth:240'));
  assert.ok(game.includes('bankChance:0.08'));
  assert.ok(game.includes('bankChance:0.44'));
  assert.ok(game.includes('readKeeper:0.30'));
  assert.ok(game.includes('readKeeper:0.92'));
  assert.ok(game.includes('rebound:0.12'));
  assert.ok(game.includes('rebound:0.62'));
  assert.ok(game.includes('function aiMatchPressure(b)'));
  assert.ok(game.includes('const readsKeeper = Math.random() < (D.readKeeper || 0)'));
  assert.ok(game.includes('b.reboundTried'));
});

test('reset progress includes Workshop and mastery stores', () => {
  assert.ok(ui.includes('Mastery.key, Workshop.key'));
  assert.ok(ui.includes('Mastery.load(); Workshop.load()'));
});

test('Workshop HUD is separate from the match scoreboard', () => {
  assert.ok(template.includes('id="workshopHud"'));
  assert.ok(game.includes("G.demo || G.mode === 'workshop'"));
  assert.ok(css.includes('.workshop-hud'));
});
