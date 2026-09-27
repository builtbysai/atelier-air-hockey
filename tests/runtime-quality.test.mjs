import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, ui, template] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
]);

test('Wake Lock is wanted only during active match and replay states', () => {
  assert.match(ui, /const WakeSys =/);
  assert.match(ui, /G\.state === 'count'/);
  assert.match(ui, /G\.state === 'play'/);
  assert.match(ui, /G\.state === 'goal'/);
  assert.match(ui, /G\.state === 'replay'/);
  assert.match(ui, /!document\.hidden/);
  assert.match(ui, /!G\.focusLost/);
  assert.match(ui, /navigator\.wakeLock\.request\('screen'\)/);
  assert.match(game, /WakeSys !== 'undefined'\) WakeSys\.sync\(\)/);
});

test('Wake Lock releases on hidden/pagehide and can reacquire on return', () => {
  assert.match(ui, /if \(document\.hidden\) \{[\s\S]*?WakeSys\.release\(\);[\s\S]*?pauseForFocusLoss\(\)/);
  assert.match(ui, /else \{[\s\S]*?WakeSys\.sync\(\)/);
  assert.match(ui, /pagehide[^\n]*WakeSys\.release/);
});

test('haptics have a named event vocabulary', () => {
  for (const name of ['strike','smash','rail','post','save','serve','goal','concede','win','loss'])
    assert.match(game, new RegExp(name + ':'));
  assert.match(game, /const Haptics =/);
  assert.match(game, /HAPTIC_COOLDOWN/);
  assert.match(game, /Settings\.haptics/);
  assert.match(game, /navigator\.vibrate/);
});

test('gameplay routes meaningful events into semantic haptics', () => {
  for (const name of ['save','smash','strike','post','rail','serve'])
    assert.match(game, new RegExp("Haptics\\.fire\\('" + name + "'\\)"));
  assert.match(game, /Haptics\.fire\(yours \? 'goal' : 'concede'\)/);
  assert.match(game, /Haptics\.fire\(humanWin \? 'win' : 'loss'\)/);
});

test('save haptic is not overwritten by the generic strike from the same contact', () => {
  assert.match(game, /let savedThisHit = false/);
  assert.match(game, /Haptics\.fire\('save'\);\s*savedThisHit = true/);
  assert.match(game, /onMalletHit\(p\.x, p\.y, impact, nx, ny, savedThisHit\)/);
  assert.match(game, /if \(!suppressHaptic\) Haptics\.fire\('smash'\)/);
  assert.match(game, /if \(!suppressHaptic && tier < 2 && v > 0\.55\) Haptics\.fire\('strike'\)/);
});

test('raw vibration calls are no longer scattered through gameplay', () => {
  const calls = game.match(/\bbuzz\(/g) || [];
  assert.equal(calls.length, 1, 'only the compatibility buzz helper should remain');
});

test('update banner exists but is not a modal overlay', () => {
  assert.match(template, /id="updateReady" class="update-ready hidden"/);
  assert.match(template, /id="btnApplyUpdate"/);
  assert.match(template, /id="btnDismissUpdate"/);
  const banner = template.match(/<div id="updateReady"[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(banner, /class="overlay/);
});

test('controller changes in other tabs do not force an immediate mid-match reload', () => {
  const handlerStart = ui.indexOf("navigator.serviceWorker.addEventListener('controllerchange'");
  const handlerEnd = ui.indexOf('});', handlerStart) + 3;
  const handler = ui.slice(handlerStart, handlerEnd);
  assert.match(handler, /controllerChanged = true/);
  assert.doesNotMatch(handler, /location\.reload\(\)/);
  assert.match(ui, /controllerChanged && this\.applying && this\.safeSurface\(\)/);
});
