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
