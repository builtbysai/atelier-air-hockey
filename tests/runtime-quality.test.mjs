import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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

test('a delayed Wake Lock grant is released after pagehide or visibility loss', async () => {
  for (const mode of ['pagehide', 'hidden']) {
    let grant;
    let releases = 0;
    const document = { hidden:false };
    const context = vm.createContext({
      document,
      navigator:{ wakeLock:{ request:() => new Promise(resolve => { grant = resolve; }) } },
      G:{ focusLost:false, demo:false, state:'play' },
      performance:{ now:() => 1000 },
    });
    vm.runInContext(ui.slice(0, ui.indexOf('const UpdateSys =')) + '\nthis.WakeSys = WakeSys;', context);
    const wake = context.WakeSys;
    const pending = wake.sync();
    if (mode === 'pagehide') wake.release();
    else document.hidden = true;
    grant({ release:() => { releases++; return Promise.resolve(); }, addEventListener() {} });
    await pending;
    assert.equal(releases, 1, mode);
    assert.equal(wake.sentinel, null, mode);
  }
});

test('a stale Wake Lock request cannot block or replace a new grant', async () => {
  const grants = [];
  let staleReleases = 0;
  const context = vm.createContext({
    document:{ hidden:false },
    navigator:{ wakeLock:{ request:() => new Promise(resolve => grants.push(resolve)) } },
    G:{ focusLost:false, demo:false, state:'play' },
    performance:{ now:() => 1000 },
  });
  vm.runInContext(ui.slice(0, ui.indexOf('const UpdateSys =')) + '\nthis.WakeSys = WakeSys;', context);
  const wake = context.WakeSys;
  const oldRequest = wake.sync();
  wake.release();
  const newRequest = wake.sync();
  assert.equal(grants.length, 2);
  grants[0]({ release:() => { staleReleases++; return Promise.resolve(); }, addEventListener() {} });
  await oldRequest;
  assert.equal(staleReleases, 1);
  assert.equal(wake.requesting, true);
  const current = { release:() => Promise.resolve(), addEventListener() {} };
  grants[1](current);
  await newRequest;
  assert.equal(wake.sentinel, current);
  assert.equal(wake.requesting, false);
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

test('raw vibration calls are centralized in semantic haptics', () => {
  assert.doesNotMatch(game, /\bbuzz\(/, 'retired raw vibration helper must stay removed');
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


test('reduced-motion preference stays live without overriding explicit shake', () => {
  assert.match(ui, /function installReducedMotionPreference\(\)/);
  assert.match(ui, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(ui, /addEventListener\('change', onChange\)/);
  assert.match(ui, /syncReducedMotionPreference\(e\.matches\)/);
  assert.match(ui, /if \(!PRM\.userShake\) Settings\.shake = PRM\.reduce \? 'subtle' : 'full'/);
  assert.match(ui, /if \(key === 'shake'\) PRM\.userShake = true/);
  assert.match(ui, /installReducedMotionPreference\(\);[\s\S]*?resize\(\); wireUI\(\); applySettingsToUI\(\)/);
});
