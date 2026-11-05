// The deploy manifest, the bundle and the client must agree: Bug uploads these bytes as-is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bundle } from '../infra/cloudflare/air-hockey-server/build.mjs';

const dir = new URL('../infra/cloudflare/air-hockey-server/', import.meta.url);
const [meta, worker, deploy, client] = await Promise.all([
  readFile(new URL('metadata.json', dir), 'utf8').then(JSON.parse),
  readFile(new URL('worker.js', dir), 'utf8'),
  readFile(new URL('DEPLOY.md', dir), 'utf8'),
  readFile(new URL('../../../src/net-server.js', dir), 'utf8'),
]);

test('committed worker.js is exactly what the build produces (never stale)', async () => {
  assert.equal(worker, await bundle());
});

test('migration is SQLite-backed (new_sqlite_classes), never new_classes', () => {
  assert.deepEqual(meta.migrations, { new_tag: 'v1', new_sqlite_classes: ['AirHockeyMatch'] });
  assert.equal('new_classes' in meta.migrations, false);
  assert.match(deploy, /new_sqlite_classes: \["AirHockeyMatch"\]/);
  assert.doesNotMatch(JSON.stringify(meta), /"new_classes"/);
});

test('binding, class and entry module line up between metadata, bundle and docs', () => {
  assert.equal(meta.main_module, 'worker.js');
  assert.deepEqual(meta.bindings, [{ type: 'durable_object_namespace', name: 'MATCH', class_name: 'AirHockeyMatch' }]);
  assert.match(worker, /^export \{ AirHockeyMatch \};$/m);
  assert.match(worker, /^export default srvWorker;$/m);
  assert.match(worker, /env\.MATCH\.idFromName\(route\[1\]\)/);
  assert.match(deploy, /name `MATCH`/); assert.match(deploy, /`AirHockeyMatch`/); assert.match(deploy, /atelier-air-hockey-server/);
});

test('the Worker is self-contained: no imports, no wrangler/npm at deploy time, no test exports', () => {
  assert.doesNotMatch(worker, /^\s*import\s/m);
  assert.doesNotMatch(worker, /cloudflare:workers|__test/);
  assert.doesNotMatch(worker, /require\(/);
});

test('client points at the Worker name documented for Bug', () => {
  assert.match(client, /NET_SERVER_URL = 'wss:\/\/atelier-air-hockey-server\.saihanswissle\.workers\.dev'/);
});

test('the Worker requests no secrets and ships no credentials', () => {
  assert.doesNotMatch(worker, /CF_API_TOKEN|CF_TURN|Bearer /);
});
