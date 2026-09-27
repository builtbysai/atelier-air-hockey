import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [game, css, template] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
]);

test('full-time screen is a composed result hierarchy, not a plain stats paragraph', () => {
  for (const id of [
    'winKicker','winTitle','winSub','winScoreLeft','winScoreRight','winResultLine',
    'winTopSpeed','winLongestRally','winSaves','winTime','winFeats'
  ]) assert.match(template, new RegExp('id="' + id + '"'), id + ' missing');
  assert.match(template, /class="win-statgrid"/);
  assert.match(template, /Run it back/);
});

test('victory celebration stays theme-native', () => {
  assert.match(css, /var\(--btnbg\)/);
  assert.match(css, /var\(--pline\)/);
  assert.match(css, /var\(--display\)/);
  assert.match(game, /THEME\.goalChord/);
  assert.match(game, /G\.themeId === 'mid'/);
  assert.doesNotMatch(game, /className = 'confetti'/);
});

test('only actual human wins get the full burst', () => {
  assert.match(game, /function resultIsHumanWin\(\)/);
  assert.match(game, /G\.mode === 'watch'\) return false/);
  assert.match(game, /buildWinBurst\(humanWin\)/);
  assert.match(game, /G\.roomPulse = humanWin \? 1 : 0\.35/);
});

test('earned records and feats become visible awards', () => {
  assert.match(game, /recs\.forEach\(label => addWinAward\('record', label\)\)/);
  assert.match(game, /addWinAward\('feat', 'TABLE CONQUERED'\)/);
  assert.match(game, /fresh\.forEach\(label => addWinAward\('feat', label\)\)/);
  assert.match(css, /\.win-award\.record::before/);
  assert.match(css, /\.win-award\.feat::before/);
});

test('result card uses real match highlights', () => {
  assert.match(game, /winTopSpeed/);
  assert.match(game, /winLongestRally/);
  assert.match(game, /winSaves/);
  assert.match(game, /winTime/);
  assert.match(game, /winSaveLabel/);
});

test('reduced motion disables celebration animation', () => {
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.win-burst i, \.win-score, \.win-stat, \.win-award/);
});

test('the result action row adapts to replay, reel, and share availability', () => {
  assert.match(template, /id="winMomentActions"/);
  assert.match(template, /id="btnMatchReel"/);
  assert.match(game, /momentActions\.classList\.remove\('solo'\)/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(96px,1fr\)\)/);
});
