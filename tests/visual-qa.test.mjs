import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui, game, css, workflow, runner, rivalRunner] = await Promise.all([
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/visual-qa.yml', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/visual-qa.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../scripts/rival-soak.mjs', import.meta.url), 'utf8'),
]);

test('visual QA route is localhost only', () => {
  assert.match(ui, /\['localhost', '127\.0\.0\.1'\]\.includes\(location\.hostname\)/);
  assert.match(ui, /q\.get\('qa'\)/);
});

test('visual QA covers current critical surfaces', () => {
  for (const state of ['menu','rules','preferences','workshop-menu','workshop','workshop-free','progress','top','elevated','surface','goal','replay','pause','win','update'])
    assert.match(ui, new RegExp("case '" + state + "'"), state + ' QA state missing');
});

test('visual QA freezes simulation and animation noise', () => {
  assert.match(game, /window\.__atelierVisualQA\?\.freeze[\s\S]*?render\(\); return;/);
  assert.match(css, /\.visual-qa \*, \.visual-qa \*::before, \.visual-qa \*::after/);
});

test('visual QA validates compact, mobile, landscape, and desktop viewports', () => {
  assert.match(runner, /width: 360, height: 640/);
  assert.match(runner, /dir: 'compact'/);
  assert.match(runner, /width: 390, height: 844/);
  assert.match(runner, /width: 844, height: 390/);
  assert.match(runner, /width: 1440, height: 900/);
  assert.match(runner, /workshop-menu/);
  assert.match(runner, /workshop-free/);
  assert.match(runner, /page\.click\('#btnHelp'\)/);
  assert.match(runner, /helpOverflow/);
  assert.match(runner, /page\.on\('pageerror'/);
  assert.match(runner, /#btnMatchReel/);
  assert.match(runner, /replayContext/);
  assert.match(runner, /mobile\/match-reel/);
  assert.match(runner, /match-reel\.png/);
  assert.match(runner, /\[data-highlight-gif\]/);
  assert.match(runner, /status\.startsWith\('Ready'\)/);
  assert.match(runner, /preview\?\.naturalWidth > 0/);
  assert.match(runner, /gif-export\.png/);
  assert.match(runner, /closest\('\.overlay'\)\?\.id !== 'progress'/);
  assert.match(runner, /scrollHeight > card\.clientHeight \+ 2/);
  assert.match(runner, /vertical card overflow/);
  assert.match(runner, /mobile' \|\| group\.dir === 'landscape'/);
  assert.match(runner, /new PointerEvent\(type/);
  assert.match(runner, /pointerType:'touch'/);
  assert.match(runner, /moving toward center did not advance rink X/);
  assert.match(runner, /pointerup did not release the active touch/);
  assert.match(ui, /window\.__atelierVisualQA\.controlState = \(\) =>/);
  assert.match(ui, /activePointers:pointers\.size/);
  assert.match(ui, /centerLimit:CX - MALLET_R/);
  assert.match(runner, /state === 'update'/);
  assert.match(runner, /update banner is not visible/);
  assert.match(ui, /UpdateSys\.waiting = \{ postMessage\(\) \{\} \}; UpdateSys\.dismissed = false/);
  assert.match(css, /@media \(max-width:380px\) and \(max-height:680px\)/);
  assert.match(css, /#menu \.lobfoot a, #menu \.lobfoot \.ver\{ display:none; \}/);
  assert.match(css, /#settings \.setrow\{[\s\S]*?flex-direction:row/);
  assert.match(css, /\.win-awards\{[\s\S]*?flex-wrap:nowrap/);
  assert.match(workflow, /playwright@1\.55\.0/);
  assert.match(workflow, /google-chrome --version/);
  assert.doesNotMatch(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /ATELIER_QA_BROWSER: chrome/);
  assert.match(runner, /process\.env\.ATELIER_QA_BROWSER === 'chrome'/);
  assert.match(runner, /channel: 'chrome'/);
  assert.match(rivalRunner, /process\.env\.ATELIER_QA_BROWSER === 'chrome'/);
  assert.match(rivalRunner, /channel:'chrome'/);
  assert.match(workflow, /Run deterministic rival soak[\s\S]*?ATELIER_QA_BROWSER: chrome/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /atelier-visual-qa/);
});
