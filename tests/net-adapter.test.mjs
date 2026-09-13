import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadNet() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    console,
    Math,
    Date,
    Promise,
    URL,
    TextEncoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(`${source}\nthis.__Net = Net; this.__netGenCode = netGenCode;`, context, {
    filename: 'src/net.js',
  });
  return { Net: context.__Net, netGenCode: context.__netGenCode };
}

test('room codes are six unambiguous characters', async () => {
  const { netGenCode } = await loadNet();
  for (let i = 0; i < 100; i++) {
    const code = netGenCode();
    assert.equal(code.length, 6);
    assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  }
});

test('Trystero 0.25 adapter targets only the accepted rival', async () => {
  const { Net } = await loadNet();
  const actions = new Map();
  const room = {
    makeAction(name) {
      const action = {
        sent: [],
        onMessage: null,
        send(data, options) {
          this.sent.push({ data, options });
          return Promise.resolve();
        },
      };
      actions.set(name, action);
      return action;
    },
    onPeerJoin: null,
    onPeerLeave: null,
  };

  const received = [];
  const joined = [];
  const left = [];
  const wire = Net.wireRoom(room, {
    onSt: (data, peerId) => received.push(['st', data, peerId]),
    onIn: (data, peerId) => received.push(['in', data, peerId]),
    onEv: (data, peerId) => received.push(['ev', data, peerId]),
    onPeerJoin: id => joined.push(id),
    onPeerLeave: id => left.push(id),
  });

  Net.peerId = 'peer-a';
  await wire.sendEv({ t: 'ping' });
  assert.equal(actions.get('ev').sent[0].options.target, 'peer-a');

  actions.get('st').onMessage([1, 2, 3], { peerId: 'peer-a' });
  actions.get('in').onMessage([4, 5], { peerId: 'peer-a' });
  actions.get('ev').onMessage({ t: 'pause' }, { peerId: 'peer-a' });
  assert.deepEqual(received.map(x => [x[0], x[2]]), [
    ['st', 'peer-a'],
    ['in', 'peer-a'],
    ['ev', 'peer-a'],
  ]);

  room.onPeerJoin('peer-a');
  room.onPeerLeave('peer-a');
  assert.deepEqual(joined, ['peer-a']);
  assert.deepEqual(left, ['peer-a']);
});

test('peer binding accepts one rival and rejects extras', async () => {
  const { Net } = await loadNet();
  Net.peerId = null;
  assert.equal(Net.acceptPeer('peer-a'), true);
  assert.equal(Net.peerId, 'peer-a');
  assert.equal(Net.acceptPeer('peer-a'), true);
  assert.equal(Net.acceptPeer('peer-b'), false);
  assert.equal(Net.peerId, 'peer-a');
});
