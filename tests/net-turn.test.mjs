import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadNet(fetchImpl) {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    setTimeout, clearTimeout, performance,
  };
  if (fetchImpl) context.fetch = fetchImpl;
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  return context.__Net;
}

test('Cloudflare ICE response is validated and cached', async () => {
  let calls = 0;
  const payload = {
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'short-lived-user',
        credential: 'short-lived-password',
      },
    ],
  };
  const Net = await loadNet(async (url, init) => {
    calls++;
    assert.equal(url, 'https://atelier-turn-credentials.saihanswissle.workers.dev/ice');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    return { ok: true, status: 201, json: async () => payload };
  });

  const first = await Net.fetchIceServers();
  const second = await Net.fetchIceServers();
  assert.equal(calls, 1, 'a successful short-lived credential is reused within the cache window');
  assert.equal(first.length, 2);
  assert.equal(first[1].username, 'short-lived-user');
  assert.equal(first[1].credential, 'short-lived-password');
  assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
});

test('credential outage keeps direct P2P alive through Cloudflare STUN', async () => {
  const Net = await loadNet(async () => { throw new Error('offline'); });
  const servers = await Net.fetchIceServers();
  assert.deepEqual(JSON.parse(JSON.stringify(servers)), [
    { urls: ['stun:stun.cloudflare.com:3478'] },
  ]);
});

test('malformed ICE entries are discarded before reaching RTCPeerConnection', async () => {
  const Net = await loadNet();
  const servers = Net.validIceServers([
    null,
    {},
    { urls: ['https://not-ice.example', 'turn:turn.cloudflare.com:443?transport=udp'] },
    { urls: 'stun:stun.cloudflare.com:3478', username: 123, credential: null },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(servers)), [
    { urls: ['turn:turn.cloudflare.com:443?transport=udp'] },
    { urls: ['stun:stun.cloudflare.com:3478'] },
  ]);
});

test('room creation passes issued Cloudflare ICE servers into Trystero', async () => {
  const Net = await loadNet();
  const issued = [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'p' },
  ];
  Net.fetchIceServers = async () => issued;
  let config = null;
  const room = {};
  const got = await Net.makeRoom((cfg) => { config = cfg; return room; }, 'ABCDEF');
  assert.equal(got, room);
  assert.equal(config.appId, 'atelier-air-hockey');
  assert.deepEqual(JSON.parse(JSON.stringify(config.turnConfig)), issued);
});

test('Worker source keeps long-lived TURN credentials server-side', async () => {
  const source = await readFile(new URL('../infra/cloudflare/turn-worker.js', import.meta.url), 'utf8');
  assert.match(source, /CF_TURN_KEY_ID/);
  assert.match(source, /CF_TURN_API_TOKEN/);
  assert.match(source, /generate-ice-servers/);
  assert.match(source, /https:\/\/builtbysai\.com/);
  assert.match(source, /Cache-Control/);
  assert.doesNotMatch(source, /openrelayprojectsecret/);
});
