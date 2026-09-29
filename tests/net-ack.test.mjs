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
  return context.__Net;
}

test('realtime ACK is cumulative and wrap-safe', async () => {
  const Net = await loadNet();
  assert.equal(Net.onRealtimeAck(new DataView(Net.encodeRealtimeAck(100))), true);
  assert.equal(Net.rtAckInputSeq, 100);
  assert.equal(Net.inputAcked(100), true);
  assert.equal(Net.inputAcked(99), true);
  assert.equal(Net.inputAcked(101), false);

  Net.rtAckInputSeq = 65535;
  assert.equal(Net.onRealtimeAck(new DataView(Net.encodeRealtimeAck(0))), true);
  assert.equal(Net.inputAcked(65535), true);
  assert.equal(Net.inputAcked(0), true);
  assert.equal(Net.inputAcked(1), false);
});

test('host ACKs only a newly accepted realtime input', async () => {
  const Net = await loadNet();
  Net.role = 'host';
  Net.active = true;
  Net.peerId = 'rival';

  const received = [];
  Net.onInput = (a, peerId) => received.push({ a: [...a], peerId });

  const sent = [];
  Net.rtReady = true;
  Net.rtChannel = {
    readyState: 'open',
    bufferedAmount: 0,
    send(data) { sent.push(data); },
  };

  const packet = Net.encodeRealtimeInput(612.5, 301.25);
  // Host owns an independent receive sequence in reality. Reset because this
  // test builds the packet with the same Net instance.
  Net.rtLastInputSeq = null;
  Net.onRealtimeMessage(packet);

  assert.equal(received.length, 1);
  assert.deepEqual(received[0].a, [612.5, 301.25]);
  assert.equal(sent.length, 1);
  const ack = new DataView(sent[0]);
  assert.equal(ack.getUint8(0), 3);
  assert.equal(ack.getUint16(2, true), 1);

  Net.onRealtimeMessage(packet);
  assert.equal(received.length, 1, 'duplicate input is rejected');
  assert.equal(sent.length, 1, 'duplicate input is not ACKed again');
});

test('guest accepts ACK packets without touching gameplay state', async () => {
  const Net = await loadNet();
  Net.role = 'guest';
  Net.active = true;
  Net.peerId = 'rival';
  Net.onRealtimeMessage(Net.encodeRealtimeAck(42));
  assert.equal(Net.rtAckInputSeq, 42);
});
