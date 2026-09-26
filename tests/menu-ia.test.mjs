import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [template, ui, css] = await Promise.all([
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('menu groups the four play modes without duplicating How to play', () => {
  assert.match(template, />PLAY MODE</);
  for (const id of ['btnHouse', 'btn2p', 'btnOnline', 'btnWatch'])
    assert.match(template, new RegExp('id="' + id + '"'), id + ' missing');
  assert.match(template, /id="btnHelp">How to play</);
});

test('mode-specific controls are contextual', () => {
  assert.match(template, /id="houseSel"/);
  assert.match(template, /id="watchSel"/);
  assert.match(ui, /houseSel'\)\.classList\.toggle\('hidden', mode !== 'ai'\)/);
  assert.match(ui, /watchSel'\)\.classList\.toggle\('hidden', mode !== 'watch'\)/);
});

test('online selection stays network-silent until the primary action', () => {
  assert.match(ui, /btnOnline'\)\.addEventListener\('click',[\s\S]*?selectRival\('online'\)/);
  const onlineHandler = ui.match(/\$\('btnOnline'\)\.addEventListener\('click',[^\n]+/);
  assert.ok(onlineHandler, 'Online mode handler missing');
  assert.doesNotMatch(onlineHandler[0], /Net\.openLobby/);
  assert.match(ui, /if \(MenuSel\.mode === 'online'\) \{ Net\.openLobby\(\); return; \}/);
});

test('match rules live outside Preferences', () => {
  const rules = template.match(/<div class="overlay hidden" id="rules"[\s\S]*?<div class="overlay hidden" id="settings"/)?.[0] || '';
  for (const key of ['firstTo', 'pace', 'goalW'])
    assert.match(rules, new RegExp('data-set="' + key + '"'), key + ' missing from Match Rules');

  const settings = template.match(/<div class="overlay hidden" id="settings"[\s\S]*?<div class="overlay hidden" id="pauseov"/)?.[0] || '';
  for (const key of ['firstTo', 'pace', 'goalW'])
    assert.doesNotMatch(settings, new RegExp('data-set="' + key + '"'), key + ' should not be in Preferences');
});

test('audio controls are slider-only and progress uses the Tour pill', () => {
  assert.match(template, /id="soundVol"/);
  assert.match(template, /id="musicVol"/);
  assert.doesNotMatch(template, /data-set="sound"/);
  assert.doesNotMatch(template, /data-set="music"/);
  assert.match(ui, /tourCount'\)\.addEventListener\('click'/);
  assert.doesNotMatch(template, /id="btnProgress"/);
});

test('touch instructions are capability-aware', () => {
  assert.match(template, /class="desktop-controls"/);
  assert.match(template, /class="touch-controls"/);
  assert.match(css, /@media \(hover:none\) and \(pointer:coarse\)/);
});

test('keyboard shortcuts share the same menu routing', () => {
  assert.match(ui, /rules'\)\.classList\.contains\('hidden'\)[\s\S]*?rulesClose'\)\.click\(\)/,
    'Escape must close Match Rules');
  assert.match(ui, /e\.key === 'Enter'[\s\S]*?\$\('btnStart'\)\.click\(\)/,
    'Enter must route through the primary action');
});
