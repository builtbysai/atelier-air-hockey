import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    ArrayBuffer, DataView, setTimeout, clearTimeout, performance,
  });
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  return { Net: context.__Net, context };
}

test('realtime sequence comparison handles duplicates, stale packets, and wraparound', async () => {
  const { Net } = await loadNet();
  assert.equal(Net.seqNewer(10, null), true);
  assert.equal(Net.seqNewer(11, 10), true);
  assert.equal(Net.seqNewer(10, 10), false);
  assert.equal(Net.seqNewer(9, 10), false);
  assert.equal(Net.seqNewer(0, 65535), true);
  assert.equal(Net.seqNewer(65535, 0), false);
});

test('realtime lane is negotiated, unordered, and never retransmits stale physics', async () => {
  const { Net } = await loadNet();
  let label, options;
  const channel = {
    readyState: 'connecting',
    bufferedAmount: 0,
    binaryType: '',
    close() { this.readyState = 'closed'; },
    send() {},
  };
  const pc = {
    createDataChannel(l, o) { label = l; options = o; return channel; },
  };
  Net.room = { getPeers: () => ({ rival: pc }) };
  Net.peerId = 'rival';

  const got = Net.ensureRealtimeChannel();
  assert.equal(got, channel);
  assert.equal(label, 'atelier-realtime');
  assert.equal(options.negotiated, true);
  assert.equal(options.ordered, false);
  assert.equal(options.maxRetransmits, 0);
  assert.equal(options.id, 61000);
  assert.equal(channel.binaryType, 'arraybuffer');

  channel.readyState = 'open';
  channel.onopen();
  assert.equal(Net.rtReady, true);
});

test('binary realtime state round-trips and rejects an out-of-order duplicate', async () => {
  const { Net } = await loadNet();
  Net.encodeSnapshot = () => [
    401.5, 302.25, 900.5, -121.25,
    123.5, 250.25, 678.75, 315.5,
    4, 3, 34, 29, 17, 2, 5,
    512.25, -88.5, -1,
  ];
  const packet = Net.encodeRealtimeState();
  assert.equal(packet.byteLength, 56);

  const first = Net.decodeRealtimeState(new DataView(packet));
  assert.ok(first);
  assert.equal(first[8], 4);
  assert.equal(first[9], 3);
  assert.equal(first[10], 34);
  assert.equal(first[17], -1);
  assert.ok(Math.abs(first[0] - 401.5) < 0.01);

  const duplicate = Net.decodeRealtimeState(new DataView(packet));
  assert.equal(duplicate, null);
});

test('binary realtime input round-trips and rejects stale input', async () => {
  const { Net } = await loadNet();
  const packet = Net.encodeRealtimeInput(612.5, 301.25);
  const first = Net.decodeRealtimeInput(new DataView(packet));
  assert.ok(first);
  assert.ok(Math.abs(first[0] - 612.5) < 0.01);
  assert.ok(Math.abs(first[1] - 301.25) < 0.01);
  assert.equal(Net.decodeRealtimeInput(new DataView(packet)), null);
});

test('unknown additive realtime message types are backward-compatible no-ops', async () => {
  for (const role of ['host', 'guest']) {
    const { Net } = await loadNet();
    Net.role = role;
    Net.rtLastStateSeq = 41;
    Net.rtLastInputSeq = 42;
    Net.rtAckInputSeq = 43;

    const futurePacket = new ArrayBuffer(22);
    const v = new DataView(futurePacket);
    v.setUint8(0, 4); // reserved by the lag-comp contract, unknown to current production
    v.setUint8(1, 1);
    v.setUint16(2, 44, true);
    v.setUint16(4, 45, true);

    assert.doesNotThrow(() => Net.onRealtimeMessage(futurePacket));
    assert.equal(Net.rtLastStateSeq, 41);
    assert.equal(Net.rtLastInputSeq, 42);
    assert.equal(Net.rtAckInputSeq, 43);
  }
});

test('realtime backpressure drops replaceable state instead of queueing it', async () => {
  const { Net } = await loadNet();
  let sends = 0;
  Net.rtReady = true;
  Net.rtChannel = {
    readyState: 'open',
    bufferedAmount: 40000,
    send() { sends++; },
  };
  const dropped = Net.sendRealtime(new ArrayBuffer(12));
  // A drop must report honestly: the caller falls back to the reliable lane.
  assert.equal(dropped, false);
  assert.equal(sends, 0);
  assert.equal(Net.rtDropped, 1);
});

test('snapshot flags carry sim-time dilation for guest dead reckoning', async () => {
  const { Net, context } = await loadNet();
  context.G = {
    puck: { x: 400, y: 300, vx: 900, vy: 0 },
    m1: { x: 100, y: 300 }, m2: { x: 700, y: 300 },
    state: 'play', score: [0, 0], stats: null,
    serveVX: 0, serveVY: 0, serveDir: 0,
    freezeT: 0, dipT: 0,
  };
  context.Settings = { firstTo: 7 };
  // Realtime: full speed.
  assert.equal(Net.decodeSnapshot(Net.encodeSnapshot()).ts, 1);
  // Smash / near-miss slow-mo beat.
  context.G.dipT = 0.2;
  assert.equal(Net.decodeSnapshot(Net.encodeSnapshot()).ts, 0.55);
  // Hit-stop freeze wins while both are armed.
  context.G.freezeT = 0.03;
  assert.equal(Net.decodeSnapshot(Net.encodeSnapshot()).ts, 0);
  // The dilation survives the binary fast-lane codec untouched.
  context.G.freezeT = 0; context.G.dipT = 0.15;
  const wire = Net.decodeRealtimeState(new DataView(Net.encodeRealtimeState()));
  assert.equal(Net.decodeSnapshot(wire).ts, 0.55);
});

test('realtime channel failure preserves the reliable fallback path', async () => {
  const { Net } = await loadNet();
  Net.room = { getPeers: () => ({ rival: { createDataChannel() { throw new Error('unsupported'); } } }) };
  Net.peerId = 'rival';
  assert.equal(Net.ensureRealtimeChannel(), null);
  assert.equal(Net.rtReady, false);
});
