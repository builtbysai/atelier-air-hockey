import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

function number(pattern, label) {
  const m = game.match(pattern);
  assert.ok(m, label + ' not found');
  return Number(m[1]);
}
function challengeValue(id) {
  return number(new RegExp('\\b' + id + ':\\s*\\{[^\\n]*?value:(\\d+)'), id + ' challenge');
}
function workshopBaseline(id) {
  return number(new RegExp('\\b' + id + ':\\s*\\{[^\\n]*?stages:\\[(\\d+)'), id + ' Workshop baseline');
}

test('speed challenges stay inside the real puck-speed envelope', () => {
  const puckMax = number(/const PUCK_MAX = (\d+)/, 'PUCK_MAX');
  const playfieldWidth = number(/PW = (\d+)/, 'PW');
  const maxKmh = puckMax * (2.4384 / playfieldWidth) * 3.6;

  assert.ok(challengeValue('brut') <= maxKmh, 'Beton speed challenge exceeds physical puck cap');
  assert.ok(challengeValue('neon') <= maxKmh, 'Neon speed challenge exceeds physical puck cap');
  assert.ok(challengeValue('neon') > challengeValue('brut'), 'final speed challenge should be stricter than Beton');
});

test('House challenges build on Workshop skill targets instead of undercutting them', () => {
  assert.ok(challengeValue('mid') >= workshopBaseline('control'),
    'Mid-Century rally challenge should meet or exceed the Control drill');
  assert.ok(challengeValue('brut') >= workshopBaseline('power'),
    'Beton power challenge should meet or exceed the Power drill');
  assert.ok(challengeValue('sashi') > workshopBaseline('keeper'),
    'Sashiko save challenge should exceed the Keeper drill baseline');
  assert.ok(challengeValue('zel') > workshopBaseline('control'),
    'Zellige scoring-rally challenge should exceed the Control drill');
  assert.ok(challengeValue('neon') > workshopBaseline('power'),
    'Neon speed challenge should exceed the Power drill');
});

test('score-state challenges remain achievable in the shortest first-to-five format', () => {
  const shortestMatch = 5;
  assert.ok(challengeValue('deco') < shortestMatch, 'clean-finish allowance must fit first-to-five');
  assert.ok(challengeValue('mem') < shortestMatch, 'comeback deficit must fit first-to-five');
  assert.ok(challengeValue('bau') < shortestMatch, 'win margin must fit first-to-five');
  assert.ok(challengeValue('swi') < shortestMatch, 'scoring streak must fit first-to-five');
});

test('current challenge ladder preserves a readable difficulty climb', () => {
  assert.equal(challengeValue('mid'), 10);
  assert.equal(challengeValue('sashi'), 5);
  assert.equal(challengeValue('zel'), 12);
  assert.equal(challengeValue('neon'), 24);
  assert.match(game, /Win with a 10-hit rally/);
  assert.match(game, /Make 5 saves and win/);
});
