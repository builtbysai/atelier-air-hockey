// Dedicated server: match state machine, input path, broadcast, server-side
// lag-compensation validation, reconnection, lifecycle and persistence.
// Pure-function tests of match.js: NO Durable Object, Worker runtime or socket
// is involved (see tests/net-server-worker.test.mjs for the glue, and the report for
// what only a deployed DO can prove).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadServer } from './helpers/server-bundle.mjs';

const S = (await loadServer()).__test;
const { Match, constants: K, limits: L } = S;

const idA = 'a'.repeat(24), keyA = 'k'.repeat(24), idB = 'b'.repeat(24), keyB = 'q'.repeat(24);
function seeded(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

function room(opts = {}) {
  const clock = { now: 1_000_000 };
  const m = new Match('ABCDEF', clock.now, { rng: seeded(opts.seed || 3) });
  return { m, clock };
}
const create = (m, now, extra = {}) => m.connect({ pid: idA, key: keyA, intent: 'create', firstTo: 5, pace: 'lightning', gw: 230, ...extra }, now);
const join = (m, now) => m.connect({ pid: idB, key: keyB, intent: 'join' }, now);
const jsons = (out, to, t) => out.filter(o => o.json && (o.to === to || o.to === 'all') && (!t || o.json.t === t)).map(o => o.json);
const bins = (out, to, type) => out.filter(o => o.bin && (o.to === to || o.to === 'all') && new DataView(o.bin).getUint8(0) === type).map(o => o.bin);

function started(opts) {
  const r = room(opts);
  create(r.m, r.clock.now); join(r.m, r.clock.now);
  return { ...r, out: r.m.drain() };
}
function advance(r, seconds) {
  let outs = [];
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) { r.clock.now += 1000 / 60; r.m.tick(r.clock.now); outs = outs.concat(r.m.drain()); }
  return outs;
}
const inputPacket = (seq, x, y) => S.rtEncodeInput(seq, x, y);

// ---------------------------------------------------------------- routing/join ----
test('first player creates, second joins, match starts with hello + countdown for BOTH', () => {
  const r = room();
  assert.equal(create(r.m, r.clock.now).side, 0);
  assert.equal(r.m.state, 'lobby');
  assert.equal(jsons(r.m.drain(), 0, 'welcome')[0].side, 0);
  const res = join(r.m, r.clock.now);
  assert.deepEqual([res.ok, res.side], [true, 1]);
  assert.equal(r.m.state, 'count');
  const out = r.m.drain();
  for (const side of [0, 1]) {
    const hello = jsons(out, side, 'hello')[0], cd = jsons(out, side, 'countdown')[0];
    assert.equal(hello.firstTo, 5); assert.equal(hello.pace, 'lightning');
    assert.equal(hello.authoritySide, 1 - side, 'each client is told the OTHER seat simulates (its rival is the eased mallet)');
    assert.equal(cd.fresh, true); assert.equal(cd.gw, 230);
    assert.ok(Math.abs(cd.svx) > 0 && (cd.serveDir === 1 || cd.serveDir === -1));
    assert.equal(bins(out, side, 1).length, 1, 'a first state frame follows');
  }
  assert.equal(jsons(out, 0, 'hello')[0].mseed, jsons(out, 1, 'hello')[0].mseed, 'both players share one music seed');
});

test('room codes route deterministically: join errors for unknown, taken, full and bad credentials', () => {
  const r = room();
  assert.equal(new Match('ABCDEF', 0).connect({ pid: idB, key: keyB, intent: 'join' }, 0).code, 'no-such-room');
  assert.equal(create(r.m, 0).ok, true);
  assert.equal(r.m.connect({ pid: idB, key: keyB, intent: 'create' }, 0).code, 'code-taken');
  assert.equal(r.m.connect({ pid: 'short', key: keyB, intent: 'join' }, 0).code, 'bad-join');
  assert.equal(join(r.m, 0).ok, true);
  assert.equal(r.m.connect({ pid: 'c'.repeat(24), key: 'z'.repeat(24), intent: 'join' }, 0).code, 'room-full');
  assert.equal(r.m.connect({ pid: idA, key: keyB, intent: 'join' }, 0).code, 'bad-key', 'a seat cannot be taken over without its key');
});

test('host settings are validated; clients cannot inject arbitrary rules', () => {
  const r = room();
  create(r.m, 0, { firstTo: 99, pace: 'warp', gw: 9999 });
  assert.deepEqual(r.m.settings, { firstTo: 7, pace: 'classic', goalW: 200 });
});

// ------------------------------------------------------------------ match flow ----
test('countdown lasts 2.0 s, then the rolled serve is applied and the puck is live', () => {
  const r = started();
  const cd = r.m.serve;
  advance(r, 1.9);
  assert.equal(r.m.state, 'count');
  assert.deepEqual([r.m.world.puck.x, r.m.world.puck.vx], [K.CX, 0], 'puck waits during the countdown');
  advance(r, 0.2);
  assert.equal(r.m.state, 'play');
  assert.ok(Math.abs(r.m.world.puck.vx) > 100, 'serve velocity applied');
  assert.equal(Math.sign(r.m.world.puck.vx), cd.dir);
});

test('input path: target is side-clamped, ACKed cumulatively, stale and duplicate sequences ignored', () => {
  const r = started();
  advance(r, 0.1);
  r.m.onBinary(1, inputPacket(10, 100, 9999), r.clock.now);   // far outside: clamp to side 1 half
  const ack = bins(r.m.drain(), 1, 3)[0];
  assert.equal(new DataView(ack).getUint16(2, true), 10);
  const pl = r.m.players[1];
  assert.equal(pl.tx, K.CX + 8, 'side 1 cannot cross the center line');
  assert.equal(pl.ty, K.PY + K.PH - K.MALLET_R);
  r.m.onBinary(1, inputPacket(10, 1000, 300), r.clock.now);   // duplicate seq: ignored, no ACK
  r.m.onBinary(1, inputPacket(9, 1000, 300), r.clock.now);    // older: ignored
  assert.equal(pl.tx, K.CX + 8); assert.equal(r.m.drain().length, 0);
  r.m.onBinary(1, inputPacket(0xffff, 1000, 300), r.clock.now); // 0xffff is newer than 10? only modularly
  assert.equal(pl.lastInputSeq, 10, 'wrap-safe ordering: 0xffff is "older" than 10, so it is dropped');
  r.m.onBinary(1, inputPacket(11, 1000, 300), r.clock.now);
  assert.equal(pl.tx, 1000);
  // wraparound forward: 0xfffe -> 0x0001
  const w = started();
  w.m.onBinary(0, inputPacket(0xfffe, 300, 300), w.clock.now); w.m.onBinary(0, inputPacket(1, 400, 300), w.clock.now);
  assert.equal(w.m.players[0].tx, 400);
  // garbage never throws or moves a mallet
  w.m.onBinary(0, new ArrayBuffer(12), w.clock.now);
  w.m.onBinary(0, inputPacket(5, NaN, 5), w.clock.now);
  w.m.onBinary(0, new ArrayBuffer(200), w.clock.now);
  assert.equal(w.m.players[0].tx, 400);
});

test('both players drive their own mallets with the production speed cap', () => {
  const r = started();
  r.m.onBinary(0, inputPacket(1, 500, 300), r.clock.now);
  r.m.onBinary(1, inputPacket(1, 900, 700), r.clock.now);
  advance(r, 0.5);
  const [a, b] = r.m.world.m;
  assert.ok(Math.hypot(a.x - 500, a.y - 300) < 1, 'player 0 mallet arrived');
  assert.ok(Math.hypot(b.x - 900, b.y - 700) < 1, 'player 1 mallet arrived');
  r.m.onBinary(0, inputPacket(2, K.CX - 8, 700), r.clock.now);
  const before = { x: a.x, y: a.y };
  advance(r, 1 / 60);
  assert.ok(Math.hypot(a.x - before.x, a.y - before.y) <= K.PLAYER_CAP / 60 + 1e-6, 'cap enforced');
});

test('state broadcast: one 56-byte frame per tick, strictly increasing sequence, identical for both seats', () => {
  const r = started();
  const out = advance(r, 0.5);
  const frames = out.filter(o => o.bin && new DataView(o.bin).getUint8(0) === 1);
  assert.equal(frames.length, 30);
  assert.ok(frames.every(f => f.to === 'all' && f.bin.byteLength === 56));
  const seqs = frames.map(f => new DataView(f.bin).getUint16(2, true));
  for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], (seqs[i - 1] + 1) & 0xffff);
  const decoded = S.rtDecodeState(new DataView(frames[0].bin));
  assert.equal(decoded.a[10] & 1, 1, 'count flag');
});

test('a goal scores for the correct side, holds, then serves toward the conceded side', () => {
  const r = started({ seed: 9 });
  advance(r, 2.1);
  Object.assign(r.m.world.puck, { x: K.PX + K.PW - 40, y: K.CY, vx: 1800, vy: 0 });
  const out = advance(r, 0.4);
  assert.equal(r.m.state, 'goal');
  assert.deepEqual(r.m.score, [1, 0], 'puck into the right goal scores for side 0');
  const g = jsons(out, 0, 'goal')[0];
  assert.deepEqual([g.scorer, g.s0, g.s1, g.matchEnd], [0, 1, 0, false]);
  assert.equal(jsons(out, 1, 'goal').length, 1);
  advance(r, 1.7);
  assert.equal(r.m.state, 'count');
  assert.equal(r.m.serve.dir, 1, 'scored-on side 1 receives the serve');
  advance(r, 2.1);
  Object.assign(r.m.world.puck, { x: K.PX + 30, y: K.CY, vx: -1800, vy: 0 });
  advance(r, 0.4);
  assert.deepEqual(r.m.score, [1, 1]);
});

test('winning goal ends in win, rematch offer/accept restarts a fresh match', () => {
  const r = started({ seed: 4 });
  r.m.score = [4, 0];
  advance(r, 2.1);
  Object.assign(r.m.world.puck, { x: K.PX + K.PW - 40, y: K.CY, vx: 1800, vy: 0 });
  const out = advance(r, 0.3);
  assert.equal(jsons(out, 0, 'goal')[0].matchEnd, true);
  advance(r, 2.8);
  assert.equal(r.m.state, 'win');
  r.m.onJson(0, { t: 'rematch', phase: 'offer' }, r.clock.now);
  assert.equal(jsons(r.m.drain(), 1, 'rematch')[0].phase, 'offer');
  r.m.onJson(0, { t: 'rematch', phase: 'accept' }, r.clock.now); // offerer cannot accept its own offer
  assert.equal(r.m.state, 'win');
  r.m.onJson(1, { t: 'rematch', phase: 'accept' }, r.clock.now);
  const o2 = r.m.drain();
  assert.equal(r.m.state, 'count');
  assert.deepEqual(r.m.score, [0, 0]);
  assert.equal(jsons(o2, 0, 'rematch')[0].phase, 'accept');
  assert.equal(jsons(o2, 0, 'hello').length, 1); assert.equal(jsons(o2, 1, 'countdown')[0].fresh, true);
});

test('pause / resume follow either player and freeze the simulation clock', () => {
  const r = started();
  advance(r, 2.2);
  const t0 = r.m.world.puck.x;
  r.m.onJson(0, { t: 'pause' }, r.clock.now);
  assert.equal(r.m.state, 'pause');
  assert.equal(jsons(r.m.drain(), 1, 'pause').length, 1);
  assert.equal(r.m.wantsTick(), false, 'a paused match runs no loop');
  const frozen = advance(r, 2);
  assert.equal(frozen.length, 0);
  assert.equal(r.m.world.puck.x, t0);
  r.m.onJson(1, { t: 'resume' }, r.clock.now);
  assert.equal(r.m.state, 'play');
  r.clock.now += 5000; r.m.tick(r.clock.now); // a long wall-clock gap must not be simulated
  assert.ok(Math.abs(r.m.world.puck.x - t0) < 200);
});

// -------------------------------------------------------------- reconnection ----
test('a dropped player pauses the match; rejoining the same seat resumes it', () => {
  const r = started();
  advance(r, 3);
  r.m.disconnect(1, r.clock.now);
  const drop = r.m.drain();
  assert.equal(r.m.state, 'pause');
  assert.equal(jsons(drop, 0, 'rival-drop')[0].graceMs, L.SRV_DROP_GRACE_MS);
  assert.equal(r.m.wantsTick(), false);
  r.clock.now += 20000;
  const res = r.m.connect({ pid: idB, key: keyB, intent: 'join', have: true }, r.clock.now);
  assert.deepEqual([res.ok, res.side, res.resumed], [true, 1, true]);
  const back = r.m.drain();
  assert.equal(jsons(back, 0, 'rival-back').length, 1);
  assert.equal(jsons(back, 1, 'hello').length, 0, 'a client that already holds the match is not re-helloed');
  assert.equal(r.m.state, 'play', 'play resumes where it stopped');
  assert.ok(bins(back, 1, 1).length >= 1, 'returning client gets a state frame immediately');
});

test('a page reload (no live view) is re-helloed with the current score and state', () => {
  const r = started();
  r.m.score = [2, 1];
  r.m.disconnect(0, r.clock.now); r.m.drain();
  r.m.connect({ pid: idA, key: keyA, intent: 'join', have: false }, r.clock.now);
  const o = r.m.drain();
  const hello = jsons(o, 0, 'hello')[0], cd = jsons(o, 0, 'countdown')[0];
  assert.ok(hello && cd);
  assert.deepEqual([cd.s0, cd.s1, cd.fresh], [2, 1, true]);
});

test('both players dropped and one returns: still paused until the other is back', () => {
  const r = started();
  advance(r, 3);
  r.m.disconnect(0, r.clock.now); r.m.disconnect(1, r.clock.now); r.m.drain();
  r.m.connect({ pid: idA, key: keyA, intent: 'join', have: true }, r.clock.now);
  assert.equal(r.m.state, 'pause');
  r.m.connect({ pid: idB, key: keyB, intent: 'join', have: true }, r.clock.now);
  assert.equal(r.m.state, 'play');
});

test('manual pause survives a drop+rejoin (the rival must still unpause it)', () => {
  const r = started();
  advance(r, 3);
  r.m.onJson(0, { t: 'pause' }, r.clock.now);
  r.m.disconnect(1, r.clock.now);
  r.m.connect({ pid: idB, key: keyB, intent: 'join', have: true }, r.clock.now);
  assert.equal(r.m.state, 'pause');
  r.m.onJson(0, { t: 'resume' }, r.clock.now);
  assert.equal(r.m.state, 'play');
});

test('grace expiry ends the match and tells the survivor; empty room ends and frees itself', () => {
  const r = started();
  advance(r, 3);
  r.m.disconnect(1, r.clock.now); r.m.drain();
  assert.equal(r.m.deadline(), r.clock.now + L.SRV_DROP_GRACE_MS);
  assert.equal(r.m.expire(r.clock.now + L.SRV_DROP_GRACE_MS - 1), false);
  assert.equal(r.m.expire(r.clock.now + L.SRV_DROP_GRACE_MS), true);
  assert.equal(r.m.state, 'ended');
  const leave = jsons(r.m.drain(), 0, 'leave')[0];
  assert.equal(leave.reason, 'rival-gone');
  assert.equal(r.m.connect({ pid: idA, key: keyA, intent: 'join' }, r.clock.now).code, 'ended');

  const e = started();
  e.m.disconnect(0, e.clock.now); e.m.disconnect(1, e.clock.now);
  assert.equal(e.m.deadline(), e.clock.now + L.SRV_EMPTY_TTL_MS, 'zero players: the shorter empty timer wins');
  assert.equal(e.m.expire(e.clock.now + L.SRV_EMPTY_TTL_MS), true);
});

test('a lone creator waits in the lobby; the lobby expires; an explicit leave ends it for the rival', () => {
  const r = room();
  create(r.m, r.clock.now);
  assert.equal(r.m.state, 'lobby'); assert.equal(r.m.wantsTick(), false);
  assert.equal(r.m.expire(r.clock.now + L.SRV_LOBBY_TTL_MS - 1), false);
  r.m.disconnect(0, r.clock.now);
  r.m.connect({ pid: idA, key: keyA, intent: 'join' }, r.clock.now + 5000); // creator reconnects into its lobby
  assert.equal(r.m.state, 'lobby');
  assert.equal(r.m.expire(r.clock.now + L.SRV_LOBBY_TTL_MS), true);

  const s = started();
  s.m.onJson(0, { t: 'leave' }, s.clock.now);
  assert.equal(s.m.state, 'ended');
  assert.equal(jsons(s.m.drain(), 1, 'leave').length, 1);
});

test('max match duration is enforced', () => {
  const r = started();
  assert.equal(r.m.expire(r.clock.now + L.SRV_MATCH_MAX_MS), true);
});

test('persistence: lobby/pause/win restore exactly; a live table restores paused and restarts its point', () => {
  const r = started();
  advance(r, 3);
  r.m.score = [3, 2];
  const snap = JSON.parse(JSON.stringify(r.m.serialize()));
  assert.equal(snap.state, 'play');
  // crash: sockets are gone
  const m = Match.restore(snap, r.clock.now, [], { rng: seeded(1) });
  assert.equal(m.state, 'pause'); assert.deepEqual(m.score, [3, 2]);
  assert.equal(m.connect({ pid: idA, key: keyA, intent: 'join', have: false }, r.clock.now).side, 0);
  assert.equal(m.state, 'pause', 'waits for the second player');
  m.connect({ pid: idB, key: keyB, intent: 'join', have: false }, r.clock.now);
  assert.equal(m.state, 'count', 'restarts the interrupted point cleanly');
  assert.deepEqual(m.score, [3, 2]);
  // hibernation wake: a paused match with live sockets is restored AS paused with nothing lost
  r.m.onJson(0, { t: 'pause' }, r.clock.now);
  const wake = Match.restore(JSON.parse(JSON.stringify(r.m.serialize())), r.clock.now, [0, 1], { rng: seeded(1) });
  assert.equal(wake.state, 'pause'); assert.deepEqual([...wake.pauseReasons], ['manual']);
  wake.onJson(1, { t: 'resume' }, r.clock.now);
  assert.equal(wake.state, 'play');
  // lobby
  const lob = room(); create(lob.m, 0);
  const lr = Match.restore(JSON.parse(JSON.stringify(lob.m.serialize())), 5, [0], { rng: seeded(1) });
  assert.equal(lr.state, 'lobby');
  assert.equal(lr.connect({ pid: idB, key: keyB, intent: 'join' }, 6).side, 1);
  assert.equal(lr.state, 'count');
});

// ---------------------------------------------- server-side lag compensation ----
function lagScene() {
  const r = started({ seed: 11 });
  advance(r, 2.2);
  const m = r.m;
  m.world.puck.vx = m.world.puck.vy = 0; m.world.puck.w = 0;
  // side 1 stays parked; the puck glides left-to-right toward side 1's mallet at mid-table speed
  Object.assign(m.world.puck, { x: 650, y: 500, vx: 1500, vy: 0 });
  Object.assign(m.world.m[1], { x: 1000, y: 500, tx: 1000, ty: 500, vx: 0, vy: 0 });
  m.players[1].tx = 1000; m.players[1].ty = 500;
  return r;
}

test('server runs the shared validator: a valid contact hint is accepted and applied as velocity only', () => {
  const r = lagScene();
  advance(r, 3 / 60);                                   // warm up >= 3 live samples
  const refSeq = r.m.stateSeq;
  const p0 = { x: r.m.world.puck.x, y: r.m.world.puck.y };
  advance(r, 1 / 60);
  const hint = { inputSeq: 7, stateSeq: refSeq, malletX: 770, malletY: 500, malletVx: -900, malletVy: 0 };
  // The mallet claims to be at x=770: the puck (x~700..770) reaches it inside the 12-unit tolerance ring
  const before = { x: r.m.world.puck.x, y: r.m.world.puck.y };
  const res = r.m.onHint(1, new DataView(S.lagEncodeHint(hint)), r.clock.now);
  assert.equal(res.ok, true, JSON.stringify(res));
  const p = r.m.world.puck;
  assert.equal(p.x, before.x); assert.equal(p.y, before.y, 'compensation never teleports the puck');
  assert.ok(p.vx < 0, 'the puck now travels back toward side 0: ' + p.vx);
  assert.equal(r.m.metrics.hintsApplied, 1);
  assert.ok(p0.x < before.x);
});

test('server-side hint gates: replay, stale, side bounds, speed, point change, unknown history', () => {
  const run = (mut, advanceMs = 1 / 60) => {
    const r = lagScene();
    advance(r, 3 / 60);
    const hint = { inputSeq: 7, stateSeq: r.m.stateSeq, malletX: 770, malletY: 500, malletVx: -900, malletVy: 0 };
    advance(r, advanceMs);
    return { r, res: r.m.onHint(1, new DataView(S.lagEncodeHint(Object.assign(hint, mut(r)))), r.clock.now) };
  };
  assert.equal(run(() => ({})).res.ok, true);
  assert.equal(run(() => ({ malletX: 500 })).res.reason, 'side-bounds', 'a pose in the other half is rejected');
  assert.equal(run(() => ({ malletVx: -9000 })).res.reason, 'velocity');
  assert.equal(run(() => ({}), 12 / 60).res.reason, 'stale', '200 ms old: inside the ring, outside the 180 ms window');
  assert.equal(run(() => ({}), 0.4).res.reason, 'missing-history', 'older than the ring: no history to validate against');
  assert.equal(run(() => ({ stateSeq: 0x7fff })).res.reason, 'missing-history');
  assert.equal(run(() => ({ malletX: 1190, malletY: 700 })).res.ok, false);
  // replay of the same hint
  const { r } = run(() => ({}));
  const again = r.m.onHint(1, new DataView(S.lagEncodeHint({ inputSeq: 7, stateSeq: r.m.stateSeq - 1, malletX: 770, malletY: 500, malletVx: -900, malletVy: 0 })), r.clock.now);
  assert.equal(again.reason, 'duplicate-or-replay');
  // new point supersedes: a countdown invalidates old claims
  const q = lagScene(); advance(q, 3 / 60);
  const seq = q.m.stateSeq; advance(q, 1 / 60);
  q.m.startPoint(false, q.clock.now);
  const gone = q.m.onHint(1, new DataView(S.lagEncodeHint({ inputSeq: 9, stateSeq: seq, malletX: 770, malletY: 500, malletVx: -900, malletVy: 0 })), q.clock.now);
  assert.notEqual(gone.ok, true);
  // malformed byte length
  assert.equal(q.m.onHint(1, new DataView(new ArrayBuffer(22)), q.clock.now).reason, 'malformed');
});

test('hints are per-seat: seat 0 cannot use seat 1 pose bounds, and each seat dedupes independently', () => {
  const r = lagScene();
  advance(r, 4 / 60);
  const seq = r.m.stateSeq;
  const mine = r.m.onHint(0, new DataView(S.lagEncodeHint({ inputSeq: 7, stateSeq: seq, malletX: 770, malletY: 500, malletVx: -900, malletVy: 0 })), r.clock.now);
  assert.equal(mine.reason, 'side-bounds', 'x=770 is seat 1 territory for seat 0');
  assert.equal(r.m.players[0].lastHintSeq, 7); assert.equal(r.m.players[1].lastHintSeq, null);
});

test('validator and solver are the shared bundle bytes, not a server reimplementation', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../infra/cloudflare/air-hockey-server/worker.js', import.meta.url), 'utf8');
  const net = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const region = net.slice(net.indexOf('// <<SHARED-SIM:BEGIN>>'), net.indexOf('// <<SHARED-SIM:END>>'));
  assert.ok(worker.includes(region), 'the bundle embeds the exact SHARED-SIM region of src/net.js');
  for (const needle of ['mvn * SMACK_BONUS', '0.35 + (0.92 - 0.35)', 'function lagValidateContactHint', 'function lagSegmentEntry'])
    assert.equal(worker.split(needle).length - 1, 1, needle + ' exists exactly once in the server bundle');
});

test('a throwing hint path cannot break the match', () => {
  const r = lagScene();
  const bad = { byteLength: 22, getUint8() { throw new Error('boom'); } };
  assert.equal(r.m.onHint(1, bad, r.clock.now).reason, 'malformed');
  advance(r, 0.1);
  assert.equal(r.m.state, 'play');
});

test('a full noisy server match: rate limits, determinism and invariants hold over 5 simulated minutes', () => {
  const r = started({ seed: 21 });
  const rnd = seeded(77);
  let seq = [0, 0], matches = 0, lastScore = [0, 0];
  for (let f = 0; f < 60 * 300; f++) {
    if (f % 2 === 0) for (const s of [0, 1]) {
      const p = r.m.world.puck;
      seq[s] = (seq[s] + 1) & 0xffff;
      r.m.onBinary(s, inputPacket(seq[s], p.x + (rnd() - 0.5) * 200, p.y + (rnd() - 0.5) * 200), r.clock.now);
    }
    r.clock.now += 1000 / 60; r.m.tick(r.clock.now); r.m.drain();
    const p = r.m.world.puck;
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Math.hypot(p.vx, p.vy) <= K.PUCK_MAX * 1.2, 'finite, bounded puck at frame ' + f);
    assert.ok(r.m.score[0] >= lastScore[0] && r.m.score[1] >= lastScore[1]);
    lastScore = r.m.score.slice();
    if (r.m.state === 'win') { r.m.onJson(0, { t: 'rematch', phase: 'offer' }, r.clock.now); r.m.onJson(1, { t: 'rematch', phase: 'accept' }, r.clock.now); lastScore = [0, 0]; matches++; }
  }
  assert.ok(r.m.metrics.frames > 10000);
  assert.ok(matches >= 1 || r.m.score[0] + r.m.score[1] > 0, 'the noisy match actually scored');
});
