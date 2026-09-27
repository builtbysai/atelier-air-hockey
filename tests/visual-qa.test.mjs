import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui, game, css, workflow, runner] = await Promise.all([
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/visual-qa.yml', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/visual-qa.mjs', import.meta.url), 'utf8'),
]);

test('visual QA routes are localhost only', () => {
  assert.match(ui, /\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\)/);
  assert.match(ui, /q\.get\('qa'\)/);
});

test('visual QA covers the critical UI and gameplay states', () => {
  for (const state of ['menu','rules','preferences','practice-menu','practice','top','elevated','surface','goal','replay','pause','win'])
    assert.match(ui, new RegExp("case '" + state + "'"), state + ' QA state missing');
});

test('visual QA freezes simulation and animation noise', () => {
  assert.match(game, /window\.__atelierVisualQA[\s\S]*?render\(\);[\s\S]*?return;/);
  assert.match(css, /\.visual-qa \*, \.visual-qa \*::before, \.visual-qa \*::after/);
});

test('visual QA workflow captures phone, landscape, and desktop artifacts', () => {
  assert.match(runner, /width: 390, height: 844/);
  assert.match(runner, /width: 844, height: 390/);
  assert.match(runner, /width: 1440, height: 900/);
  assert.match(runner, /practice-menu/);
  assert.match(runner, /page\.on\('pageerror'/);
  assert.match(runner, /window\.__atelierVisualQA/);
  assert.match(runner, /scrollHeight > card\.clientHeight \+ 2/);
  assert.match(runner, /vertical card overflow/);
  assert.match(workflow, /playwright@1\.55\.0/);
  assert.match(workflow, /node scripts\/visual-qa\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /atelier-visual-qa/);
});
