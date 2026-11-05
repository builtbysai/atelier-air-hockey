// Communication hardening: vendored Trystero, ICE credential timeout/backoff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

const vendorUrl = new URL('../src/vendor/trystero-nostr-0.25.4.mjs', import.meta.url);

async function loadNet(fetchImpl, extra = {}) {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, AbortController,
    // compress the 4 s credential timeout so the suite stays fast
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 25)), clearTimeout, performance,
    location: new URL('https://builtbysai.com/atelier-air-hockey/'),
    fetch: fetchImpl, ...extra,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  return context.__Net;
}

test('Trystero is vendored and pinned: no runtime CDN import remains in the app', async () => {
  const text = await readFile(vendorUrl, 'utf8');
  assert.match(text.slice(0, 600), /Trystero 0\.25\.4/);
  const mod = await import(vendorUrl.href);
  for (const name of ['joinRoom', 'selfId', 'getRelaySockets', 'pauseRelayReconnection', 'resumeRelayReconnection'])
    assert.ok(name in mod, 'vendored build exports ' + name);
  for (const dir of ['../src/', '../']) {
    for (const f of (await readdir(new URL(dir, import.meta.url))).filter(n => /\.(js|html|mjs)$/.test(n))) {
      const body = await readFile(new URL(dir + f, import.meta.url), 'utf8');
      assert.doesNotMatch(body, /esm\.run|cdn\.jsdelivr|unpkg\.com/, f + ' must not load code from a CDN');
    }
  }
  const net = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  assert.match(net, /import\(Net\.trysteroUrl\(\)\)/);
});

test('vendored module URL resolves against the document base, same-origin', async () => {
  const Net = await loadNet(async () => { throw new Error('unused'); }, { document: { baseURI: 'https://builtbysai.com/atelier-air-hockey/' } });
  assert.equal(Net.trysteroUrl(), 'https://builtbysai.com/atelier-air-hockey/src/vendor/trystero-nostr-0.25.4.mjs');
});

test('a hung credential service times out into STUN-only instead of stalling room creation', async () => {
  const Net = await loadNet((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  Net.logErr = () => {};
  const t0 = Date.now();
  const servers = await Net.fetchIceServers();
  assert.ok(Date.now() - t0 < 1000, 'resolved by timeout');
  assert.deepEqual(JSON.parse(JSON.stringify(servers)), [{ urls: ['stun:stun.cloudflare.com:3478'] }]);
});

test('after a credential failure the next room open does not wait on the service again', async () => {
  let calls = 0;
  const Net = await loadNet(async () => { calls++; throw new Error('503'); });
  Net.logErr = () => {};
  await Net.fetchIceServers(); await Net.fetchIceServers(); await Net.fetchIceServers();
  assert.equal(calls, 1, 'negative cache holds for the backoff window');
  await Net.fetchIceServers(true); // explicit refresh (ICE recovery) always retries
  assert.equal(calls, 2);
  const noFallback = await Net.fetchIceServers(true, false);
  assert.equal(noFallback, null, 'recovery path still gets null so it can keep the old config');
});

test('a recent TURN credential set survives a later outage; an expired one does not', async () => {
  const good = { iceServers: [{ urls: ['turn:t.example:3478'], username: 'u', credential: 'c' }] };
  let ok = true;
  const Net = await loadNet(async () => { if (!ok) throw new Error('down'); return { ok: true, json: async () => good }; });
  Net.logErr = () => {};
  const first = await Net.fetchIceServers();
  ok = false; Net._iceFetchedAt -= 2 * 60 * 60 * 1000; // past the 1 h cache, inside the 4 h TTL
  const during = await Net.fetchIceServers();
  assert.equal(during[0].username, first[0].username);
  Net._iceFailedAt = 0; Net._iceFetchedAt -= 2 * 60 * 60 * 1000; // ~4 h old: credentials may be dead
  const after = await Net.fetchIceServers();
  assert.deepEqual(JSON.parse(JSON.stringify(after)), [{ urls: ['stun:stun.cloudflare.com:3478'] }]);
});
