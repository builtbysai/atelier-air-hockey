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
  assert.match(sw, /atelier-air-hockey-v26/);
  assert.doesNotMatch(sw, /atelier-air-hockey-v24\.2/);
  assert.match(sw, /src\/vendor\/qrcode\.js/);
  assert.match(sw, /assets\/icon-maskable\.svg/);
  assert.match(sw, /staleWhileRevalidate/);
  assert.match(sw, /networkFirstNavigation/);
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
