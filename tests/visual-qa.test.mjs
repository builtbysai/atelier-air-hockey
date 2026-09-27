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

test('visual QA route is localhost only', () => {
  assert.match(ui, /\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\)/);
  assert.match(ui, /q\.get\('qa'\)/);
});

test('visual QA covers current critical surfaces', () => {
  for (const state of ['menu','rules','preferences','workshop-menu','workshop','progress','top','elevated','surface','goal','replay','pause','win','update'])
    assert.match(ui, new RegExp("case '" + state + "'"), state + ' QA state missing');
});

test('visual QA freezes simulation and animation noise', () => {
  assert.match(game, /window\.__atelierVisualQA\?\.freeze[\s\S]*?render\(\); return;/);
  assert.match(css, /\.visual-qa \*, \.visual-qa \*::before, \.visual-qa \*::after/);
});

test('visual QA validates three viewport classes and no-scroll cards', () => {
  assert.match(runner, /width: 390, height: 844/);
  assert.match(runner, /width: 844, height: 390/);
  assert.match(runner, /width: 1440, height: 900/);
  assert.match(runner, /workshop-menu/);
  assert.match(runner, /page\.on\('pageerror'/);
  assert.match(runner, /#btnMatchReel/);
  assert.match(runner, /MATCH REEL 1\/3/);
  assert.match(runner, /MATCH REEL 2\/3/);
  assert.match(runner, /match-reel\.png/);
  assert.match(runner, /\[data-highlight-gif\]/);
  assert.match(runner, /status\.startsWith\('Ready'\)/);
  assert.match(runner, /preview\?\.naturalWidth > 0/);
  assert.match(runner, /gif-export\.png/);
  assert.match(runner, /closest\('\.overlay'\)\?\.id !== 'progress'/);
  assert.match(runner, /scrollHeight > card\.clientHeight \+ 2/);
  assert.match(runner, /vertical card overflow/);
  assert.match(workflow, /playwright@1\.55\.0/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /atelier-visual-qa/);
});
