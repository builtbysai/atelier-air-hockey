// Worker router + Durable Object glue, run against in-memory fakes of the
// Workers runtime (ctx.storage, hibernatable WebSockets, alarms, timers).
// NOT a real Durable Object: see the report for what only a deployed DO proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServer } from './helpers/server-bundle.mjs';

globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.request = a; this.response = b; } };
const mod = await loadServer();
const { AirHockeyMatch } = mod, worker = mod.default;
const S = mod.__test;

const idA = 'a'.repeat(24), keyA = 'k'.repeat(24), idB = 'b'.repeat(24), keyB = 'q'.repeat(24);

function fakeWs() {
  const ws = { att: null, sent: [], closed: null,
    serializeAttachment(v) { ws.att = v; }, deserializeAttachment() { return ws.att; },
    send(d) { ws.sent.push(d); }, close(code, reason) { ws.closed = { code, reason }; } };
  return ws;
}
const jsonOf = (ws) => ws.sent.filter(d => typeof d === 'string').map(JSON.parse);
const binOf = (ws, type) => ws.sent.filter(d => typeof d !== 'string' && new DataView(d).getUint8(0) === type);

function harness(storage = new Map()) {
  const h = { storage, sockets: [], alarm: null, auto: null, timers: [], now: 5_000_000 };
  h.ctx = {
    storage: {
      get: async (k) => storage.get(k), put: async (k, v) => { storage.set(k, v); },
      deleteAll: async () => storage.clear(), setAlarm: async (t) => { h.alarm = t; }, deleteAlarm: async () => { h.alarm = null; },
    },
    getWebSockets: () => h.sockets.filter(w => !w.dead),
    acceptWebSocket: (ws) => { h.sockets.push(ws); },
    setWebSocketAutoResponse: (p) => { h.auto = p; },
    blockConcurrencyWhile: (fn) => { h.ready = fn(); return h.ready; },
  };
  return h;
}

async function boot(opts = {}) {
  const h = opts.h || harness();
  const realNow = Date.now, realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  Date.now = () => h.now;
  globalThis.setInterval = (fn) => { const t = { fn, live: true }; h.timers.push(t); return t; };
  globalThis.clearInterval = (t) => { if (t) t.live = false; };
  h.restore = () => { Date.now = realNow; globalThis.setInterval = realSet; globalThis.clearInterval = realClear; };
  h.do = new AirHockeyMatch(h.ctx, {});
  await h.ready;
  h.loopLive = () => h.timers.some(t => t.live);
  h.tick = (n = 1) => { for (let i = 0; i < n; i++) { h.now += 1000 / 60; for (const t of h.timers) if (t.live) t.fn(); } };
  h.connect = async (id, key, intent, extra = {}) => {
    const ws = fakeWs(); h.sockets.push(ws); ws.att = { side: -1, code: 'ABCDEF' };
    await h.do.webSocketMessage(ws, JSON.stringify({ t: 'join', pid: id, key, intent, ...extra }));
    return ws;
  };
  return h;
}

test('router: health, 404, upgrade required, origin policy, and room code -> Durable Object id', async () => {
  const names = [];
  const env = { MATCH: { idFromName: (n) => { names.push(n); return 'id:' + n; }, get: (id) => ({ fetch: async (r) => new Response('routed:' + id) }) } };
  const req = (path, headers = {}) => new Request('https://srv.example' + path, { headers });
  const health = await worker.fetch(req('/health'), env);
  assert.deepEqual(await health.json(), { ok: true, service: 'atelier-air-hockey-server', v: 1 });
  assert.equal((await worker.fetch(req('/nope'), env)).status, 404);
  assert.equal((await worker.fetch(req('/ws/abcdef', { Upgrade: 'websocket' }), env)).status, 404, 'lowercase / bad alphabet codes never reach a DO');
  assert.equal((await worker.fetch(req('/ws/ABCDE', { Upgrade: 'websocket' }), env)).status, 404);
  assert.equal((await worker.fetch(req('/ws/ABCDEF'), env)).status, 426);
  assert.equal((await worker.fetch(req('/ws/ABCDEF', { Upgrade: 'websocket', Origin: 'https://evil.example' }), env)).status, 403);
  for (const origin of ['https://builtbysai.com', 'http://localhost:8080', 'http://127.0.0.1:3000']) {
    const r = await worker.fetch(req('/ws/ABCDEF', { Upgrade: 'websocket', Origin: origin }), env);
    assert.equal(await r.text(), 'routed:id:ABCDEF', origin);
  }
  assert.ok(names.every(n => n === 'ABCDEF'), 'the room code is the object name: both players land on one DO');
});

test('DO: hibernation keep-alive pair, join flow, 60 Hz loop, state frames to both sockets', async () => {
  const h = await boot();
  try {
    assert.deepEqual([h.auto.request, h.auto.response], ['ping', 'pong']);
    const a = await h.connect(idA, keyA, 'create', { firstTo: 5 });
    assert.equal(jsonOf(a)[0].t, 'welcome'); assert.equal(a.att.side, 0);
    assert.equal(h.loopLive(), false, 'a lobby costs nothing: no loop');
    assert.ok(h.alarm > h.now, 'lobby expiry alarm armed');
    const b = await h.connect(idB, keyB, 'join');
    assert.equal(b.att.side, 1);
    assert.equal(h.loopLive(), true, 'the loop starts when the countdown starts');
    assert.ok(jsonOf(a).some(e => e.t === 'hello') && jsonOf(b).some(e => e.t === 'countdown'));
    h.tick(30);
    assert.ok(binOf(a, 1).length >= 30 && binOf(b, 1).length >= 30, 'every tick reaches both players');
    await h.do.webSocketMessage(b, S.rtEncodeInput(1, 900, 400));
    assert.equal(new DataView(binOf(b, 3).pop()).getUint16(2, true), 1, 'the input is ACKed to its sender only');
    assert.equal(binOf(a, 3).length, 0);
    assert.ok(h.storage.has('m'), 'match state is checkpointed');
  } finally { h.restore(); }
});

test('DO: pausing stops the loop (idle matches hibernate); resuming restarts it', async () => {
  const h = await boot();
  try {
    const a = await h.connect(idA, keyA, 'create'); const b = await h.connect(idB, keyB, 'join');
    h.tick(5);
    await h.do.webSocketMessage(a, JSON.stringify({ t: 'pause' }));
    assert.equal(h.loopLive(), false);
    assert.ok(jsonOf(b).some(e => e.t === 'pause'));
    await h.do.webSocketMessage(b, JSON.stringify({ t: 'resume' }));
    assert.equal(h.loopLive(), true);
  } finally { h.restore(); }
});

test('DO: socket drop pauses and arms the grace alarm; the seat can be reclaimed; replaced sockets do not count as drops', async () => {
  const h = await boot();
  try {
    const a = await h.connect(idA, keyA, 'create'); const b = await h.connect(idB, keyB, 'join');
    h.tick(10);
    h.sockets.splice(h.sockets.indexOf(b), 1);
    await h.do.webSocketClose(b);
    assert.ok(jsonOf(a).some(e => e.t === 'rival-drop'));
    assert.equal(h.loopLive(), false);
    assert.equal(h.alarm, h.now + S.limits.SRV_DROP_GRACE_MS);
    h.now += 30_000;
    const b2 = await h.connect(idB, keyB, 'join', { have: true });
    assert.equal(b2.att.side, 1);
    assert.ok(jsonOf(a).some(e => e.t === 'rival-back'));
    assert.equal(h.loopLive(), true, 'play resumes');
    // a second socket for the same seat replaces the first without being treated as a drop
    const b3 = await h.connect(idB, keyB, 'join', { have: true });
    assert.deepEqual(b2.closed, { code: 4000, reason: 'replaced' });
    await h.do.webSocketClose(b2);
    assert.equal(h.loopLive(), true, 'closing the replaced socket must not pause the match');
    assert.ok(b3.att.side === 1 && !b3.closed);
  } finally { h.restore(); }
});

test('DO: grace expiry and empty room wipe all storage and close sockets (the DO is freed)', async () => {
  const h = await boot();
  try {
    const a = await h.connect(idA, keyA, 'create'); const b = await h.connect(idB, keyB, 'join');
    h.tick(10);
    h.sockets.splice(h.sockets.indexOf(b), 1); await h.do.webSocketClose(b);
    h.now += S.limits.SRV_DROP_GRACE_MS;
    await h.do.alarm();
    assert.ok(jsonOf(a).some(e => e.t === 'leave' && e.reason === 'rival-gone'));
    assert.equal(h.storage.size, 0, 'no stored bytes remain'); assert.equal(h.alarm, null);
    assert.equal(a.closed.reason, 'match-ended');
    // zero players
    const h2 = await boot();
    const a2 = await h2.connect(idA, keyA, 'create'); const b2 = await h2.connect(idB, keyB, 'join');
    h2.sockets.splice(0, 2); await h2.do.webSocketClose(a2); await h2.do.webSocketClose(b2);
    assert.equal(h2.alarm, h2.now + S.limits.SRV_EMPTY_TTL_MS);
    h2.now += S.limits.SRV_EMPTY_TTL_MS; await h2.do.alarm();
    assert.equal(h2.storage.size, 0);
    h2.restore();
  } finally { h.restore(); }
});

test('DO: join errors are reported and leave no state behind', async () => {
  const h = await boot();
  try {
    const ghost = await h.connect(idB, keyB, 'join');
    assert.equal(jsonOf(ghost)[0].code, 'no-such-room'); assert.ok(ghost.closed);
    assert.equal(h.storage.size, 0);
    const bad = await h.connect('short', keyA, 'create');
    assert.equal(jsonOf(bad)[0].code, 'bad-join');
    assert.equal(h.storage.size, 0, 'a failed create leaves nothing to bill or clean up');
    await h.connect(idA, keyA, 'create');
    const dup = await h.connect(idB, keyB, 'create');
    assert.equal(jsonOf(dup)[0].code, 'code-taken');
  } finally { h.restore(); }
});

test('DO: abuse guards - oversize JSON ignored, rate limit closes the socket, pre-join binary ignored', async () => {
  const h = await boot();
  try {
    const a = await h.connect(idA, keyA, 'create'); const b = await h.connect(idB, keyB, 'join');
    await h.do.webSocketMessage(a, JSON.stringify({ t: 'pause', pad: 'x'.repeat(600) }));
    assert.equal(h.loopLive(), true, 'oversize message ignored');
    const stranger = fakeWs(); h.sockets.push(stranger); stranger.att = { side: -1, code: 'ABCDEF' };
    await h.do.webSocketMessage(stranger, S.rtEncodeInput(1, 500, 500));
    assert.equal(stranger.sent.length, 0, 'binary before join is ignored, no reply');
    assert.equal(h.do.match.metrics.inputs, 0);
    for (let i = 0; i < 300; i++) await h.do.webSocketMessage(b, S.rtEncodeInput(i & 0xffff, 900, 400));
    assert.equal(b.closed.code, 1008, 'a flooding socket is dropped');
  } finally { h.restore(); }
});

test('DO: hibernation wake restores a paused match from storage with sockets still attached', async () => {
  const h = await boot();
  let h2;
  try {
    const a = await h.connect(idA, keyA, 'create'); const b = await h.connect(idB, keyB, 'join');
    h.tick(20);
    await h.do.webSocketMessage(a, JSON.stringify({ t: 'pause' }));
    // the runtime evicts the object while the sockets stay open; a new instance is built over the same storage
    h2 = harness(h.storage); h2.sockets = h.sockets; h2.now = h.now;
    h.restore();
    h2 = await boot({ h: h2 });
    await h2.do.webSocketMessage(b, JSON.stringify({ t: 'resume' }));
    assert.equal(h2.loopLive(), true, 'woken object resumes play from its stored state');
    assert.ok(jsonOf(a).some(e => e.t === 'resume'));
  } finally { (h2 || h).restore(); }
});

test('DO: a crashed live table restores paused and restarts its point once both players are back', async () => {
  const h = await boot();
  let h2;
  try {
    await h.connect(idA, keyA, 'create'); await h.connect(idB, keyB, 'join');
    h.tick(200);
    h2 = harness(h.storage); h2.now = h.now + 4000; // all sockets died with the crash
    h.restore();
    h2 = await boot({ h: h2 });
    assert.equal(h2.loopLive(), false);
    assert.ok(h2.alarm, 'grace / empty alarm re-armed after restore');
    await h2.connect(idA, keyA, 'join'); const b = await h2.connect(idB, keyB, 'join');
    assert.equal(h2.loopLive(), true);
    assert.ok(jsonOf(b).some(e => e.t === 'countdown'));
  } finally { (h2 || h).restore(); }
});
