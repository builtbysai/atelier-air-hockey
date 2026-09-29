import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function storage() {
  const data = new Map();
  return {
    getItem:key => data.has(key) ? data.get(key) : null,
    setItem:(key,value) => data.set(key, String(value)),
    removeItem:key => data.delete(key),
  };
}

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const localStorage = storage();
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView,
    setTimeout, clearTimeout, performance, localStorage,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename:'src/net.js' });
  return { Net:context.__Net, localStorage };
}

test('local Online identity is stable without an account server', async () => {
  const { Net, localStorage } = await loadNet();
  const first = Net.localPlayer();
  Net._localPlayer = null;
  const second = Net.localPlayer();
  assert.equal(second.id, first.id);
  assert.equal(second.name, first.name);
  assert.ok(first.id.length >= 16);
  assert.match(first.name, /^PLAYER /);
  assert.ok(localStorage.getItem('atelier-ah-player-v1'));
});

test('remote identity is sanitized before display or persistence', async () => {
  const { Net } = await loadNet();
  assert.deepEqual(
    JSON.parse(JSON.stringify(Net.cleanPlayer({ id:'abc<>123', name:'  Sai<script>  ' }))),
    { id:'abc123', name:'Saiscript' }
  );
  assert.equal(Net.cleanPlayer({ id:'<>' }), null);
});

test('Quick Match rendezvous overlaps the current and previous slot', async () => {
  const { Net } = await loadNet();
  const slots = Net.quickSlots(90000);
  assert.deepEqual(Array.from(slots), ['3','2']);
});

test('lower Quick Match nonce reserves exactly one rival and higher nonce rejects contention', async () => {
  const a = await loadNet();
  a.Net.quickNonce = 10;
  const sentA = [];
  a.Net.quickSend = async (_action, data, peerId) => { sentA.push({data,peerId}); };
  a.Net.quickHandleMessage({}, { t:'hello', v:1, nonce:20, player:{id:'b',name:'B'} }, 'peer-b');
  assert.equal(a.Net.quickPeer, 'peer-b');
  assert.equal(sentA.length, 1);
  assert.equal(sentA[0].data.t, 'reserve');
  assert.equal(sentA[0].peerId, 'peer-b');

  a.Net.quickHandleMessage({}, { t:'hello', v:1, nonce:30, player:{id:'c',name:'C'} }, 'peer-c');
  assert.equal(a.Net.quickPeer, 'peer-b');
  assert.equal(sentA.length, 1, 'a proposer cannot fan out reservations to multiple rivals');

  const b = await loadNet();
  b.Net.quickNonce = 20;
  const sentB = [];
  b.Net.quickSend = async (_action, data, peerId) => { sentB.push({data,peerId}); };
  b.Net.quickHandleMessage({}, { t:'reserve', v:1, nonce:10, player:{id:'a',name:'A'} }, 'peer-a');
  assert.equal(b.Net.quickPeer, 'peer-a');
  assert.equal(sentB.length, 1);
  assert.equal(sentB[0].data.t, 'accept');

  b.Net.quickHandleMessage({}, { t:'reserve', v:1, nonce:5, player:{id:'c',name:'C'} }, 'peer-c');
  assert.equal(b.Net.quickPeer, 'peer-a', 'a second reservation cannot steal an accepted pairing');
  assert.equal(sentB.length, 2);
  assert.equal(sentB[1].data.t, 'busy');
  assert.equal(sentB[1].peerId, 'peer-c');

  a.Net.stopQuick();
  b.Net.stopQuick();
});

test('Quick Match busy rejection releases the candidate and probes another visible peer', async () => {
  const { Net } = await loadNet();
  Net.quickNonce = 10;
  Net.quickPeer = 'peer-b';
  const sent = [];
  Net.quickSend = async (_action, data, peerId) => { sent.push({data,peerId}); };
  Net.quickEntries = [{
    action:{},
    room:{ getPeers:() => ({'peer-b':{}, 'peer-c':{}}) },
  }];

  Net.quickHandleMessage({}, { t:'busy', v:1, nonce:20 }, 'peer-b');

  assert.equal(Net.quickPeer, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].data.t, 'hello');
  assert.equal(sent[0].peerId, 'peer-c');
  Net.stopQuick();
});

test('stale Quick Match callbacks are ignored after matchmaking stops', async () => {
  const { Net } = await loadNet();
  Net.quickNonce = 10;
  const sent = [];
  Net.quickSend = async (_action, data, peerId) => { sent.push({data,peerId}); };

  Net.stopQuick();
  Net.quickHandleMessage({}, { t:'hello', v:1, nonce:20, player:{id:'b',name:'B'} }, 'peer-b');

  assert.equal(Net.quickPeer, null);
  assert.equal(sent.length, 0);
});

test('recent rivals stay local, dedupe, and keep newest first', async () => {
  const { Net } = await loadNet();
  Net.rivalIdentity = { id:'rival-1', name:'Jordan' };
  Net.rememberRival([7,5]);
  Net.rememberRival([7,6]);
  Net.rivalIdentity = { id:'rival-2', name:'Mina' };
  Net.rememberRival([4,7]);
  const rows = Net.recentRivals();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].player.id, 'rival-2');
  assert.equal(rows[1].player.id, 'rival-1');
  assert.deepEqual(Array.from(rows[1].score), [7,6]);
});
