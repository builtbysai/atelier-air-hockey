import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    ArrayBuffer, DataView, setTimeout, clearTimeout,
    performance: { now: () => 1234 },
  });
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  return context.__Net;
}

function fakePeer() {
  const listeners = new Map();
  return {
    connectionState: 'connected',
    iceConnectionState: 'connected',
    configs: [],
    restarts: 0,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    emit(type) { listeners.get(type)?.(); },
    setConfiguration(config) { this.configs.push(config); },
    restartIce() { this.restarts++; },
    listeners,
  };
}

test('recovery credential refresh has a strict time budget', async () => {
  const Net = await loadNet();
  Net.fetchIceServers = () => new Promise(() => {});

  const started = Date.now();
  const fresh = await Net.fetchRecoveryIceServers(5);
  const elapsed = Date.now() - started;

  assert.equal(fresh, null);
  assert.ok(elapsed < 1000, 'hung credential refresh must resolve well inside Trystero\'s 5s peer window');
});

test('recovery credential refresh uses fresh ICE servers when they arrive inside the budget', async () => {
  const Net = await loadNet();
  const expected = [{ urls:['turn:turn.cloudflare.com:3478'], username:'u', credential:'p' }];
  Net.fetchIceServers = async () => expected;

  const fresh = await Net.fetchRecoveryIceServers(50);
  assert.equal(fresh, expected);
});

test('ICE recovery refreshes credentials before restarting ICE', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'disconnected';
  Net.iceRecoveryPc = pc;

  let forced = null;
  const fresh = [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'p' },
  ];
  Net.fetchIceServers = async force => { forced = force; return fresh; };

  assert.equal(await Net.recoverIce(pc), true);
  assert.equal(forced, true);
  assert.deepEqual(JSON.parse(JSON.stringify(pc.configs)), [{ iceServers: fresh }]);
  assert.equal(pc.restarts, 1);
  assert.equal(Net.iceRecoveryAttempts, 1);

  Net.detachIceRecovery();
});

test('ICE refresh preserves the peer existing RTC configuration', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'disconnected';
  pc.getConfiguration = () => ({
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all',
    iceCandidatePoolSize: 4,
    iceServers: [{ urls: ['turn:old.example:3478'], username:'old', credential:'old' }],
  });
  Net.iceRecoveryPc = pc;

  const fresh = [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username:'u', credential:'p' },
  ];
  Net.fetchIceServers = async () => fresh;

  assert.equal(await Net.recoverIce(pc), true);
  assert.equal(pc.configs.length, 1);
  assert.equal(pc.configs[0].bundlePolicy, 'max-bundle');
  assert.equal(pc.configs[0].rtcpMuxPolicy, 'require');
  assert.equal(pc.configs[0].iceTransportPolicy, 'all');
  assert.equal(pc.configs[0].iceCandidatePoolSize, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(pc.configs[0].iceServers)), fresh);
  assert.equal(pc.restarts, 1);

  Net.detachIceRecovery();
});

test('credential refresh outage preserves existing ICE config but still restarts', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'disconnected';
  Net.iceRecoveryPc = pc;

  let args = null;
  Net.fetchIceServers = async (...a) => { args = a; return null; };

  assert.equal(await Net.recoverIce(pc), true);
  assert.deepEqual(args, [true, false]);
  assert.equal(pc.configs.length, 0, 'failed refresh must not replace existing TURN servers with STUN fallback');
  assert.equal(pc.restarts, 1, 'restart should still reuse the peer existing configuration');

  Net.detachIceRecovery();
});

test('forced TURN recovery remains relay-only after credential refresh', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'disconnected';
  Net.iceRecoveryPc = pc;
  Net.forceTurnEnabled = () => true;
  Net.fetchIceServers = async () => [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u',
      credential: 'p',
    },
  ];

  assert.equal(await Net.recoverIce(pc), true);
  assert.equal(pc.configs.length, 1);
  assert.equal(pc.configs[0].iceTransportPolicy, 'relay');
  assert.deepEqual(JSON.parse(JSON.stringify(pc.configs[0].iceServers)), [
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'u',
      credential: 'p',
    },
  ]);
  assert.equal(pc.restarts, 1);

  Net.detachIceRecovery();
});

test('natural recovery during credential refresh cancels the pending ICE restart', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  pc.connectionState = pc.iceConnectionState = 'disconnected';
  Net.iceRecoveryPc = pc;

  let resolveRefresh;
  const refresh = new Promise(resolve => { resolveRefresh = resolve; });
  Net.fetchRecoveryIceServers = () => refresh;

  const run = Net.recoverIce(pc);
  await Promise.resolve();
  assert.equal(Net.iceRecoveryBusy, true);

  // The browser reconnects on its own while the credential request is still
  // pending. Recovery must not disturb the healthy connection afterward.
  pc.connectionState = 'connected';
  pc.iceConnectionState = 'connected';
  Net.cancelIceRecovery(true);
  resolveRefresh([{ urls:['turn:turn.cloudflare.com:3478'], username:'u', credential:'p' }]);

  assert.equal(await run, false);
  assert.equal(pc.configs.length, 0);
  assert.equal(pc.restarts, 0);
  assert.equal(Net.iceRecoveryBusy, false);
  assert.equal(Net.iceRecoveryAttempts, 0);

  Net.detachIceRecovery();
});

test('stale recovery completion cannot clear a replacement peer busy state', async () => {
  const Net = await loadNet();
  const oldPc = fakePeer();
  const newPc = fakePeer();
  oldPc.connectionState = oldPc.iceConnectionState = 'disconnected';
  newPc.connectionState = newPc.iceConnectionState = 'disconnected';

  let resolveOld;
  const oldRefresh = new Promise(resolve => { resolveOld = resolve; });
  Net.iceRecoveryPc = oldPc;
  Net.fetchRecoveryIceServers = () => oldRefresh;
  const oldRun = Net.recoverIce(oldPc);
  await Promise.resolve();
  assert.equal(Net.iceRecoveryBusy, true);

  // The old peer disappears and a replacement peer attaches before its async
  // credential refresh completes.
  Net.detachIceRecovery();
  Net.iceRecoveryPc = newPc;

  let resolveNew;
  const newRefresh = new Promise(resolve => { resolveNew = resolve; });
  Net.fetchRecoveryIceServers = () => newRefresh;
  const newRun = Net.recoverIce(newPc);
  await Promise.resolve();
  assert.equal(Net.iceRecoveryBusy, true);

  resolveOld(null);
  await oldRun;
  assert.equal(Net.iceRecoveryBusy, true,
    'old peer completion must not clear recovery state owned by replacement peer');

  resolveNew(null);
  await newRun;
  assert.equal(newPc.restarts, 1);
  assert.equal(Net.iceRecoveryBusy, false);

  Net.detachIceRecovery();
});

test('ICE recovery is a no-op after the connection has already recovered', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  Net.iceRecoveryPc = pc;
  Net.fetchIceServers = async () => { throw new Error('should not fetch'); };

  assert.equal(await Net.recoverIce(pc), false);
  assert.equal(pc.restarts, 0);
  assert.equal(Net.iceRecoveryAttempts, 0);
});

test('closed ICE state is terminal and never schedules recovery', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'closed';
  Net.iceRecoveryPc = pc;

  assert.equal(Net.rtcClosed(pc), true);
  assert.equal(Net.rtcDisconnected(pc), false);
  assert.equal(Net.scheduleIceRecovery(pc), false);
  assert.equal(await Net.recoverIce(pc), false);
  assert.equal(pc.restarts, 0);

  Net.detachIceRecovery();
});

test('connecting/checking states suppress unnecessary ICE restart', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  const scheduled = [];
  Net.scheduleIceRecovery = (peer, immediate) => {
    scheduled.push({ peer, immediate });
    return true;
  };
  Net.sampleRtcStats = async () => {};

  Net.attachIceRecovery(pc);

  pc.connectionState = 'connecting';
  pc.iceConnectionState = 'disconnected';
  pc.emit('connectionstatechange');
  assert.equal(Net.rtcDisconnected(pc), false);
  assert.equal(scheduled.length, 0);

  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'checking';
  pc.emit('iceconnectionstatechange');
  assert.equal(Net.rtcDisconnected(pc), false);
  assert.equal(scheduled.length, 0);

  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'disconnected';
  pc.emit('connectionstatechange');
  assert.equal(Net.rtcDisconnected(pc), true);
  assert.equal(scheduled.length, 1);

  Net.detachIceRecovery();
});

test('attaching recovery monitors both connection state signals', async () => {
  const Net = await loadNet();
  const pc = fakePeer();

  let scheduled = [];
  Net.scheduleIceRecovery = (peer, immediate) => {
    scheduled.push({ peer, immediate });
    return true;
  };
  Net.sampleRtcStats = async () => {};

  assert.equal(Net.attachIceRecovery(pc), true);
  assert.ok(pc.listeners.has('connectionstatechange'));
  assert.ok(pc.listeners.has('iceconnectionstatechange'));

  pc.connectionState = 'disconnected';
  pc.iceConnectionState = 'disconnected';
  pc.emit('connectionstatechange');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].peer, pc);
  assert.equal(scheduled[0].immediate, false);

  pc.connectionState = 'failed';
  pc.emit('iceconnectionstatechange');
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].immediate, true);

  Net.detachIceRecovery();
  assert.equal(pc.listeners.size, 0);
});

test('match connection-metric reset does not cancel peer ICE recovery', async () => {
  const Net = await loadNet();
  Net.paintConn = () => {};

  const timer = setTimeout(() => {}, 10000);
  Net.iceRecoveryTimer = timer;
  Net.iceRecoveryAttempts = 2;
  Net.iceRecoveryStartedAt = 100;

  Net.resetConn();

  assert.equal(Net.iceRecoveryTimer, timer,
    'fresh match/rematch metric reset must not own peer recovery timers');
  assert.equal(Net.iceRecoveryAttempts, 2);
  assert.equal(Net.iceRecoveryStartedAt, 100);

  clearTimeout(timer);
  Net.iceRecoveryTimer = 0;
});

test('connected state cancels pending recovery and resets attempt budget', async () => {
  const Net = await loadNet();
  const pc = fakePeer();
  Net.sampleRtcStats = async () => {};
  Net.attachIceRecovery(pc);

  Net.iceRecoveryAttempts = 2;
  Net.iceRecoveryStartedAt = 100;
  Net.iceRecoveryTimer = setTimeout(() => {}, 10000);

  pc.emit('connectionstatechange');
  assert.equal(Net.iceRecoveryAttempts, 0);
  assert.equal(Net.iceRecoveryStartedAt, 0);
  assert.equal(Net.iceRecoveryTimer, 0);

  Net.detachIceRecovery();
});

test('forced ICE fetch bypasses an otherwise fresh cached credential set', async () => {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  let calls = 0;
  const context = vm.createContext({
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    ArrayBuffer, DataView, setTimeout, clearTimeout,
    performance: { now: () => 1234 },
    fetch: async () => {
      calls++;
      return {
        ok: true,
        status: 201,
        json: async () => ({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }),
      };
    },
  });
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  const Net = context.__Net;

  Net._iceServers = [{ urls: ['stun:cached.example:3478'] }];
  Net._iceFetchedAt = Date.now();

  const cached = await Net.fetchIceServers();
  assert.equal(calls, 0);
  assert.equal(cached[0].urls[0], 'stun:cached.example:3478');

  const fresh = await Net.fetchIceServers(true);
  assert.equal(calls, 1);
  assert.equal(fresh[0].urls[0], 'stun:stun.cloudflare.com:3478');
});
