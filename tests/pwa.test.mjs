import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [manifestRaw, sw, ui, game, css, maskable] = await Promise.all([
  readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/icon-maskable.svg', import.meta.url), 'utf8'),
]);
const manifest = JSON.parse(manifestRaw);

test('manifest describes the current ten-table game', () => {
  assert.match(manifest.description, /ten art-directed tables/);
  assert.equal(manifest.display, 'fullscreen');
  assert.equal(manifest.orientation, 'any');
  assert.deepEqual(manifest.categories, ['games', 'entertainment']);
});

test('installed app exposes shortcuts, screenshots, and a real maskable icon', () => {
  assert.ok(manifest.shortcuts.some(x => x.url === './?play'));
  assert.ok(manifest.shortcuts.some(x => x.url === './?2p'));
  assert.ok(manifest.screenshots.some(x => x.form_factor === 'wide'));
  const mask = manifest.icons.find(x => x.purpose === 'maskable');
  assert.equal(mask.src, './assets/icon-maskable.svg');
  assert.match(maskable, /<rect width="512" height="512" fill="#070606"\/>/);
});

test('service worker caches the complete current app shell', () => {
  assert.match(sw, /atelier-air-hockey-[a-f0-9]{12}/);
  assert.doesNotMatch(sw, /atelier-air-hockey-v24\.2/);
  assert.match(sw, /src\/vendor\/qrcode\.js/);
  assert.match(sw, /src\/share\.js/);
  assert.match(sw, /assets\/icon-maskable\.svg/);
  assert.match(sw, /staleWhileRevalidate/);
  assert.match(sw, /networkFirstNavigation/);
  assert.match(sw, /networkFirstAsset/);
  assert.match(sw, /js\|css\|webmanifest/);
});

test('build ties the worker cache identity to the app content', async () => {
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const check = await readFile(new URL('../scripts/check.mjs', import.meta.url), 'utf8');
  const version = await readFile(new URL('../scripts/app-version.mjs', import.meta.url), 'utf8');
  assert.match(build, /appCacheName\(\)/);
  assert.match(check, /appCacheName\(\)/);
  assert.match(version, /'src\/game\.js'/);
  assert.match(version, /'src\/net\.js'/);
  assert.match(version, /'index\.html'/);
  assert.match(version, /hash\.update\(sw\.replace/);
});

test('service worker update check is non-blocking at boot', () => {
  assert.match(ui, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(ui, /reg\.update\(\)/);
});

test('camera and orientation preferences persist in the existing settings object', () => {
  assert.match(game, /camera: 'top'/);
  assert.match(game, /orientation: 'auto'/);
  assert.match(game, /localStorage\.setItem\('atelier-ah-settings', JSON\.stringify\(Settings\)\)/);
  assert.match(game, /localStorage\.getItem\('atelier-ah-settings'\)/);
});

test('fullscreen UI respects device safe areas', () => {
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /env\(safe-area-inset-right\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-left\)/);
  assert.match(css, /display-mode: fullscreen/);
});


test('new service workers wait for a safe user-approved activation', () => {
  const install = sw.match(/self\.addEventListener\('install'[\s\S]*?\n\}\);/)?.[0] || '';
  assert.ok(install, 'install handler missing');
  assert.doesNotMatch(install, /skipWaiting/);
  assert.match(sw, /event\.data && event\.data\.type === 'SKIP_WAITING'/);
  assert.match(sw, /self\.skipWaiting\(\)/);
});

test('update UX only surfaces at safe game states', () => {
  assert.match(ui, /const UpdateSys =/);
  assert.match(ui, /G\.state === 'menu'/);
  assert.match(ui, /G\.state === 'win'/);
  assert.match(ui, /btnApplyUpdate/);
  assert.match(ui, /btnDismissUpdate/);
  assert.match(ui, /waiting\.postMessage\(\{ type:'SKIP_WAITING' \}\)/);
  assert.match(ui, /controllerChanged = true/);
});
