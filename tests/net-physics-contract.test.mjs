import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NET_TEST_PHYSICS } from './helpers/net-test-physics.mjs';

function numericAssignment(source, name) {
  const match = source.match(new RegExp('\\b' + name + '\\s*=\\s*([0-9.]+)'));
  assert.ok(match, 'could not find numeric game.js assignment for ' + name);
  return Number(match[1]);
}

test('Online VM physics fixture stays aligned with production collision constants', async () => {
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

  for (const [name, expected] of Object.entries(NET_TEST_PHYSICS)) {
    assert.equal(
      numericAssignment(source, name),
      expected,
      name + ' changed in production; update the shared Online VM fixture intentionally'
    );
  }
});

// The dedicated server's headless table (infra/cloudflare/air-hockey-server/src/sim.js)
// is a port of game.js physics. Its constants must equal production exactly.
test('server sim constants and pace table equal game.js', async () => {
  const [game, sim] = await Promise.all([
    readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
    readFile(new URL('../infra/cloudflare/air-hockey-server/src/sim.js', import.meta.url), 'utf8'),
  ]);
  for (const name of ['PUCK_R', 'MALLET_R', 'PUCK_MAX', 'SMACK_BONUS', 'PLAYER_CAP', 'SUB_HZ', 'STALL_T', 'GLUE_HARD_CUTOFF',
                      'PX', 'PY', 'PW', 'PH', 'STALL_V']) {
    const g = game.match(new RegExp('\\b' + name + '\\s*=\\s*([0-9.]+)'));
    const s = sim.match(new RegExp('\\b' + name + '\\s*=\\s*([0-9.]+)'));
    assert.ok(g && s, name + ' must be declared in both game.js and sim.js');
    assert.equal(Number(s[1]), Number(g[1]), name + ' drifted between game.js and the server sim');
  }
  const pacesOf = (src) => JSON.stringify([...src.match(/PACES\s*=\s*\{([\s\S]*?)\n\};/)[1].matchAll(/(casual|classic|lightning):\s*\{\s*damp:\s*([0-9.]+),\s*wall:\s*([0-9.]+),\s*serve:\s*([0-9.]+)/g)].map(m => m.slice(1)));
  assert.equal(pacesOf(sim), pacesOf(game), 'pace table drifted');
  assert.match(game, /GOAL_PRESETS = \{ narrow: 170, standard: 200, wide: 230 \}/);
  assert.match(sim, /GOAL_WIDTHS = \[170, 200, 230\]/);
});
