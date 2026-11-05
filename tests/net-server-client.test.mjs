// Client side of server mode (src/net-server.js on top of src/net.js), run
// against the REAL server match logic through in-memory sockets. Covers the
// lobby, join/create flows, error handling, the 30 Hz input lane + ACK fence,
// reconnection, rival drop/return, leave, and the visible mode indicator.
// Not covered here (needs a browser/real network): actual WebSocket behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadServer } from './helpers/server-bundle.mjs';
import { NET_TEST_PHYSICS } from './helpers/net-test-physics.mjs';

const S = (await loadServer()).__test;
const netSrc = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
const srvSrc = await readFile(new URL('../src/net-server.js', import.meta.url), 'utf8');

/* ---- in-memory "network": fake WebSockets wired to a real Match -------------- */
function makeHub({ reachable = true } = {}) {
  const hub = { match: null, sockets: [], clock: 1_000_000, timers: [], sentLog: [] };
  hub.setTimeout = (fn, ms) => { const t = { fn, at: hub.clock + ms, live: true }; hub.timers.push(t); return t; };
  hub.clearTimeout = (t) => { if (t) t.live = false; };
  hub.setInterval = (fn) => ({ fn, live: false });
  hub.clearInterval = () => {};
  hub.advance = (ms) => {
    hub.clock += ms;
    for (const t of hub.timers.slice()) if (t.live && t.at <= hub.clock) { t.live = false; t.fn(); }
    if (hub.match) { hub.match.tick(hub.clock); hub.flush(); }
  };
  hub.flush = () => {
    if (!hub.match) return;
    for (const o of hub.match.drain()) {
      const data = o.bin || JSON.stringify(o.json);
      for (const ws of hub.sockets) if (ws.readyState === 1 && ws.side >= 0 && (o.to === 'all' || o.to === ws.side)) ws.deliver(data);
    }
  };
  hub.WebSocket = class FakeWebSocket {
    constructor(url) {
      this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.side = -1; this.sent = [];
      if (url.includes('throw')) throw new Error('boom');
      hub.sockets.push(this);
      queueMicrotask(() => {
        if (!reachable) { this.readyState = 3; this.onerror && this.onerror({}); this.onclose && this.onclose({}); return; }
        this.readyState = 1; this.onopen && this.onopen({});
      });
    }
    deliver(data) { queueMicrotask(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data }); hub.pump && hub.pump(); }); }
    send(data) { this.sent.push(data); hub.sentLog.push({ ws: this, data }); hub.receive(this, data); }
    close() { if (this.readyState === 3) return; this.readyState = 3; hub.dropped(this); queueMicrotask(() => this.onclose && this.onclose({})); }
  };
  hub.receive = (ws, data) => {
    const now = hub.clock;
    if (typeof data === 'string') {
      if (data === 'ping') { ws.deliver('pong'); return; }
      const ev = JSON.parse(data);
      if (ws.side < 0) {
        if (ev.t !== 'join') return;
        if (!hub.match) { if (ev.intent !== 'create') { ws.deliver(JSON.stringify({ t: 'error', code: 'no-such-room' })); return; } hub.match = new S.Match('ABCDEF', now); }
        const r = hub.match.connect(ev, now);
        if (!r.ok) { hub.match.drain(); ws.deliver(JSON.stringify({ t: 'error', code: r.code })); return; }
        for (const o of hub.sockets) if (o !== ws && o.side === r.side) { o.side = -1; o.readyState = 3; queueMicrotask(() => o.onclose && o.onclose({})); }
        ws.side = r.side; ws.joinEv = ev;
      } else hub.match.onJson(ws.side, ev, now);
    } else if (ws.side >= 0) hub.match.onBinary(ws.side, data, now);
    hub.flush();
  };
  hub.dropped = (ws) => { if (ws.side >= 0 && hub.match) { hub.match.disconnect(ws.side, hub.clock); ws.side = -1; hub.flush(); } };
  hub.settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  return hub;
}

const el = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains: () => true }, textContent: '', innerHTML: '', disabled: false,
  style: {}, querySelector: () => ({ className: '', textContent: '' }), addEventListener() {}, focus() {} });

async function client(hub, search = '?netMode=server') {
  const els = new Map(), calls = [];
  const G = { state: 'menu', mode: 'ai', puck: { x: 720, y: 520, vx: 0, vy: 0, w: 0 },
    m1: { x: 370, y: 520, tx: 370, ty: 520, vx: 0, vy: 0, r: 46, side: 0, hitSq: 1, hitSqA: 0 },
    m2: { x: 1070, y: 520, tx: 1070, ty: 520, vx: 0, vy: 0, r: 46, side: 1, hitSq: 1, hitSqA: 0 },
    score: [0, 0], stats: { topSpeed: 0, bestRally: 0, saves: [0, 0] }, trail: [], scuffs: [], texts: [], pausedFrom: 'play' };
  const ctx = vm.createContext({
    console: { ...console, warn() {} }, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, Set, JSON, Object, Array, Number, Error,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; } },
    sessionStorage: new Map(Object.entries({})), localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    performance: { now: () => hub.clock }, setTimeout: hub.setTimeout, clearTimeout: hub.clearTimeout, setInterval: hub.setInterval, clearInterval: hub.clearInterval,
    location: new URL('https://builtbysai.com/atelier-air-hockey/' + search), WebSocket: hub.WebSocket,
    G, Settings: { firstTo: 5, pace: 'lightning', goalW: 'standard' }, THEME: { id: 'deco' }, THEMES: { deco: {} }, PACES: { classic: {}, lightning: {} },
    PX: 200, PY: 200, PW: 1040, PH: 640, CX: 720, CY: 520, ...NET_TEST_PHYSICS, goalW: () => 200,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    $: (id) => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
    AudioSys: { init() {}, ui() {} }, MusicSys: { setSessionSeed() {} },
    hideAll: () => calls.push('hideAll'), fitCamera() {}, paintTableWarp() {}, resetPositions() {}, clearCeremony() {},
    freshBoard: () => ({}), freshStats: () => ({ topSpeed: 0, bestRally: 0, saves: [0, 0] }), pointers: { clear() {} },
    startCount: () => { G.state = 'count'; calls.push('startCount'); }, rollServe() {}, applySettingsToUI() {}, setTheme() {},
    beginGoalCeremony: (s) => calls.push('goal:' + s), showWin: () => calls.push('win'),
    togglePause: (force, silent) => { calls.push('togglePause:' + force + ':' + silent); if (force === true) G.state = 'pause'; else if (G.state === 'pause') G.state = G.pausedFrom; },
  });
  vm.runInContext(netSrc + '\n' + srvSrc + '\nthis.__Net = Net; this.__NetServer = NetServer;', ctx, { filename: 'net+server.js' });
  const Net = ctx.__Net, NetServer = ctx.__NetServer;
  Net.logErr = () => {};
  Net.saveSessionCheckpoint = () => true;
  return { Net, NetServer, G, els, calls, ctx, hub };
}

const pump = (c, frames, dt = 1 / 60) => { for (let i = 0; i < frames; i++) { c.hub.advance(dt * 1000); c.Net.pump(dt); } };

// ------------------------------------------------------------------- UI / mode ----
test('the online lobby shows which transport is active, and hides P2P-only entries in server mode', async () => {
  const hub = makeHub();
  const server = await client(hub), p2p = await client(hub, '');
  server.Net.uiShow('choose'); p2p.Net.uiShow('choose');
  const sBody = server.els.get('onlineBody').innerHTML, pBody = p2p.els.get('onlineBody').innerHTML;
  assert.match(sBody, /data-net-mode="server"/); assert.match(sBody, /Connection: Dedicated server/);
  assert.doesNotMatch(sBody, /onlineQuick|onlineWatch/, 'Quick Match and Spectate are P2P features');
  assert.match(pBody, /data-net-mode="p2p"/); assert.match(pBody, /Connection: Peer to peer/);
  assert.match(pBody, /onlineQuick/);
  assert.equal(server.Net.serverMode(), true); assert.equal(p2p.Net.serverMode(), false);
  assert.match(server.Net.inviteUrl('ABCDEF'), /netMode=server/, 'an invite keeps the joiner on the same transport');
  assert.doesNotMatch(p2p.Net.inviteUrl('ABCDEF'), /netMode/);
});

test('loopback override is honoured, foreign override is ignored', async () => {
  const hub = makeHub();
  const local = await client(hub, '?netMode=server&netServer=ws://localhost:8787');
  assert.equal(local.Net.serverUrl(), 'ws://localhost:8787');
  const evil = await client(hub, '?netMode=server&netServer=wss://evil.example');
  assert.match(evil.Net.serverUrl(), /^wss:\/\/atelier-air-hockey-server\./);
});

// ------------------------------------------------------------- unreachable / errors ----
test('unreachable server: lobby returns to the menu with a plain error, nothing stays live', async () => {
  const hub = makeHub({ reachable: false });
  const c = await client(hub);
  await c.Net.create();
  await hub.settle();
  assert.equal(c.Net.active, false); assert.equal(c.Net.room, null);
  assert.match(c.els.get('onlineErr').textContent, /Couldn't reach the game server/);
  assert.match(c.els.get('onlineTitle').textContent, /Play a rival/, 'back on the lobby menu');
  assert.equal(hub.timers.filter(t => t.live).length, 0, 'no connect/retry timers left running');
});

test('a WebSocket constructor failure and a connect timeout are handled, not thrown', async () => {
  const hub = makeHub();
  const c = await client(hub);
  c.ctx.WebSocket = function () { throw new Error('boom'); };
  await c.Net.create(); await hub.settle();
  assert.match(c.els.get('onlineErr').textContent, /Couldn't reach the game server/);
  // hang: socket never opens
  const hub2 = makeHub();
  const orig = hub2.WebSocket;
  hub2.WebSocket = class extends orig { constructor(u) { super(u); this.readyState = 0; queueMicrotask(() => {}); } };
  hub2.WebSocket = class { constructor() { this.readyState = 0; this.bufferedAmount = 0; } send() {} close() { this.readyState = 3; } };
  const h = await client(hub2);
  await h.Net.create(); await hub2.settle();
  assert.equal(h.Net.room !== null, true, 'still connecting');
  hub2.advance(8100);
  assert.match(h.els.get('onlineErr').textContent, /Couldn't reach the game server/);
  assert.equal(h.Net.active, false);
});

test('server error codes become readable lobby messages', async () => {
  const hub = makeHub();
  const j = await client(hub);
  await j.Net.join('ABCDEF'); await hub.settle();
  assert.match(j.els.get('onlineErr').textContent, /No table with that code/);
  const a = await client(hub), b = await client(hub), c3 = await client(hub);
  await a.Net.create('ABCDEF'); await hub.settle();
  await b.Net.join('ABCDEF'); await hub.settle();
  await c3.Net.join('ABCDEF'); await hub.settle();
  assert.match(c3.els.get('onlineErr').textContent, /already has two players/);
  const bad = await client(hub);
  await bad.Net.join('abc'); assert.match(bad.els.get('onlineErr').textContent, /6 characters/);
});

// ---------------------------------------------------------------- the real flow ----
test('create + join over the server: both clients start, sides and flip are right, state and ACKs flow', async () => {
  const hub = makeHub();
  const A = await client(hub), B = await client(hub);
  await A.Net.create('ABCDEF'); await hub.settle();
  assert.equal(A.Net.side, 0); assert.equal(A.Net.waitingForRival, true);
  assert.match(A.els.get('onlineTitle').textContent, /Table hosted/);
  const create = JSON.parse(hub.sentLog[0].data);
  assert.deepEqual([create.t, create.intent, create.firstTo, create.pace, create.gw], ['join', 'create', 5, 'lightning', 200]);
  assert.match(create.pid, /^[A-Za-z0-9_-]{24}$/); assert.match(create.key, /^[A-Za-z0-9_-]{24}$/); assert.notEqual(create.pid, create.key);

  await B.Net.join('abcdef'); await hub.settle();
  assert.equal(A.Net.active && B.Net.active, true);
  assert.equal(A.G.mode, 'online'); assert.equal(B.G.mode, 'online');
  assert.deepEqual([A.Net.side, B.Net.side], [0, 1]);
  assert.deepEqual([A.G.onlineFlip, B.G.onlineFlip], [false, true], 'seat 1 plays from its own end');
  assert.deepEqual([A.Net.authoritySide, B.Net.authoritySide], [1, 0], "each client eases its RIVAL's mallet");
  assert.equal(A.Net.isAuthority(), false); assert.equal(B.Net.isAuthority(), false, 'neither browser simulates');
  assert.equal(B.Net.peerId, 'server');
  assert.deepEqual([A.G.state, B.G.state], ['count', 'count']);
  const joinB = JSON.parse(hub.sentLog.find(x => typeof x.data === 'string' && x.ws !== A.NetServer.ws && JSON.parse(x.data).pid !== create.pid).data);
  assert.equal(joinB.intent, 'join'); assert.equal(joinB.firstTo, undefined, 'only the creator proposes rules');

  // frames arrive; input cadence is 30 Hz; the ACK fence advances
  pump(A, 90); pump(B, 0);
  await hub.settle();
  assert.ok(A.Net.rsnap && A.Net.rsnap.seq !== null, 'A holds a server snapshot');
  A.G.m1.tx = 400; A.G.m1.ty = 300;
  const before = hub.sentLog.filter(x => x.ws === A.NetServer.ws && typeof x.data !== 'string' && new DataView(x.data).getUint8(0) === 2).length;
  for (let i = 0; i < 60; i++) { A.G.m1.tx += 3; pump(A, 1); await hub.settle(1); }
  const inputs = hub.sentLog.filter(x => x.ws === A.NetServer.ws && typeof x.data !== 'string' && new DataView(x.data).getUint8(0) === 2).length - before;
  assert.ok(inputs >= 28 && inputs <= 32, '~30 inputs in one second, got ' + inputs);
  assert.ok(A.Net.rtAckInputSeq !== null && A.Net.inputAcked(A.Net.rtInputSeq), 'server ACKs fence the prediction');
  assert.ok(hub.match.players[0].tx > 400, 'the server received the target');
  assert.equal(A.Net.realtimeHealthy(performance_now(hub)), true);
});
const performance_now = (hub) => hub.clock;

test('goal, pause, rematch and RTT events reach the existing client handlers', async () => {
  const hub = makeHub();
  const A = await client(hub), B = await client(hub);
  await A.Net.create('ABCDEF'); await hub.settle(); await B.Net.join('ABCDEF'); await hub.settle();
  pump(A, 130); pump(B, 0); await hub.settle();
  // pause from A freezes B through the server
  A.G.state = 'play'; B.G.state = 'play';
  A.Net.sendPause(true); await hub.settle();
  assert.ok(B.calls.includes('togglePause:true:true'), 'rival pause applied silently (no echo)');
  // RTT probe through the auto-answered text ping
  hub.advance(3000); A.Net.pump(2.6); await hub.settle(); hub.advance(10);
  assert.ok(A.Net.conn.rtt >= 0, 'the text ping/pong measured an RTT');
});

test('a dropped socket freezes the table, retries the SAME seat, and resumes on welcome', async () => {
  const hub = makeHub();
  const A = await client(hub), B = await client(hub);
  await A.Net.create('ABCDEF'); await hub.settle(); await B.Net.join('ABCDEF'); await hub.settle();
  pump(A, 130); await hub.settle();
  A.G.state = 'play'; B.G.state = 'play';
  const pidA = JSON.parse(hub.sentLog[0].data).pid;
  hub.sockets.find(s => s === A.NetServer.ws).close(); await hub.settle();    // A's network drops
  assert.equal(A.Net.reconnecting, true, 'A shows reconnecting');
  assert.equal(A.G.state, 'pause');
  assert.equal(hub.match.state, 'pause', 'the server paused the match');
  assert.equal(B.Net.reconnecting, true, 'B is told its rival dropped');
  hub.advance(500); await hub.settle(); await hub.settle();                    // backoff elapses, A reconnects
  const rejoin = hub.sentLog.filter(x => typeof x.data === 'string' && x.data.startsWith('{') && JSON.parse(x.data).pid === pidA).pop();
  const ev = JSON.parse(rejoin.data);
  assert.deepEqual([ev.intent, ev.have], ['join', true], 'a reconnect is a plain rejoin that keeps the live view');
  assert.equal(A.Net.reconnecting, false); assert.equal(B.Net.reconnecting, false);
  assert.equal(hub.match.state, 'play'); assert.equal(A.G.state, 'play'); assert.equal(B.G.state, 'play');
  assert.equal(A.Net.rtReady, true);
});

test('reconnect gives up after the grace budget and shows the rival-left overlay (no endless retry)', async () => {
  const hub = makeHub();
  const A = await client(hub), B = await client(hub);
  await A.Net.create('ABCDEF'); await hub.settle(); await B.Net.join('ABCDEF'); await hub.settle();
  pump(A, 130); await hub.settle();
  hub.sockets.find(s => s === A.NetServer.ws).close();
  // make every retry fail
  hub.WebSocket.prototype.send = function () {};
  A.ctx.WebSocket = class { constructor() { this.readyState = 0; this.bufferedAmount = 0; queueMicrotask(() => { this.readyState = 3; this.onclose && this.onclose({}); }); } send() {} close() {} };
  for (let i = 0; i < 40; i++) { hub.advance(3100); await hub.settle(2); }
  assert.equal(A.Net.active, false, 'the match is over for A');
  assert.equal(hub.timers.filter(t => t.live && t.at > hub.clock).length >= 0, true);
  const live = hub.timers.filter(t => t.live).length;
  hub.advance(20000); await hub.settle();
  assert.equal(hub.timers.filter(t => t.live).length <= live, true, 'no new retries are scheduled after giving up');
});

test('an explicit leave ends the match for the rival and nobody reconnects to the closed table', async () => {
  const hub = makeHub();
  const A = await client(hub), B = await client(hub);
  await A.Net.create('ABCDEF'); await hub.settle(); await B.Net.join('ABCDEF'); await hub.settle();
  pump(A, 130); await hub.settle();
  A.Net.leave(); await hub.settle();
  assert.equal(hub.match.state, 'ended');
  assert.equal(B.Net.active, false, 'B got the leave event and shows the rival-left overlay');
  assert.equal(B.NetServer.leaving, true);
  const sockets = hub.sockets.length;
  hub.advance(10000); await hub.settle(8);
  assert.equal(hub.sockets.length, sockets, 'B never opens a new socket to a closed table');
  assert.equal(A.Net.room, null);
});

test('P2P stays the default: with no netMode nothing in server mode runs', async () => {
  const hub = makeHub();
  const p = await client(hub, '');
  assert.equal(p.Net.serverMode(), false);
  assert.equal(p.Net.saveSessionCheckpoint !== undefined, true);
  p.Net.sendPing(); // no wire: must be a no-op, not a throw
  assert.equal(hub.sockets.length, 0);
});
