import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui, game, css, workflow] = await Promise.all([
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/visual-qa.yml', import.meta.url), 'utf8'),
]);

test('visual QA routes are localhost only', () => {
  assert.match(ui, /\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\)/);
  assert.match(ui, /q\.get\('qa'\)/);
});

test('visual QA covers the critical UI and gameplay states', () => {
  for (const state of ['menu','rules','preferences','practice','top','elevated','surface','goal','replay','pause','win'])
    assert.match(ui, new RegExp("case '" + state + "'"), state + ' QA state missing');
});

test('visual QA freezes simulation and animation noise', () => {
  assert.match(game, /window\.__atelierVisualQA[\s\S]*?render\(\);[\s\S]*?return;/);
  assert.match(css, /\.visual-qa \*, \.visual-qa \*::before, \.visual-qa \*::after/);
});

test('visual QA workflow captures phone, landscape, and desktop artifacts', () => {
  assert.match(workflow, /390,844/);
  assert.match(workflow, /844,390/);
  assert.match(workflow, /1440,900/);
  assert.match(workflow, /playwright@1\.55\.0/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /atelier-visual-qa/);
});
