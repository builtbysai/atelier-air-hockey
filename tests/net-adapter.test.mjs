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
  return { Net: context.__Net, netGenCode: context.__netGenCode, context };
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

test('peer binding honors the pending handshake lock and rejects extras', async () => {
  const { Net } = await loadNet();
  Net.peerId = null;
  Net.handshakePeerId = 'peer-a';
  assert.equal(Net.acceptPeer('peer-b'), false);
  assert.equal(Net.peerId, null);
  assert.equal(Net.acceptPeer('peer-a'), true);
  assert.equal(Net.peerId, 'peer-a');
  assert.equal(Net.handshakePeerId, null);
  assert.equal(Net.acceptPeer('peer-b'), false);
});

test('handshake gate reserves one rival and releases a failed reservation', async () => {
  const { Net } = await loadNet();
  Net.turnCredential = async () => ({ username: 'u', password: 'p' });
  let callbacks;
  const fakeRoom = {};
  await Net.makeRoom((config, roomId, cb) => { callbacks = cb; return fakeRoom; }, 'ABCDEF');
  await callbacks.onPeerHandshake('peer-a');
  assert.equal(Net.handshakePeerId, 'peer-a');
  await assert.rejects(() => callbacks.onPeerHandshake('peer-b'), /Table is full/);
  callbacks.onJoinError({ peerId: 'peer-a', error: 'failed' });
  assert.equal(Net.handshakePeerId, null);
});

test('reconnecting guest resumes retained play state instead of remaining paused', async () => {
  const { Net, context } = await loadNet();
  const sent = [];
  let resumes = 0;
  context.G = { state: 'pause', pausedFrom: 'play', mode: 'online' };
  context.$ = () => null;
  context.togglePause = (force, silent) => {
    assert.equal(force, false);
    assert.equal(silent, true);
    context.G.state = 'play';
    resumes++;
  };
  Net.role = 'guest';
  Net.active = true;
  Net.reconnecting = true;
  Net.reconnectState = 'play';
  Net.peerId = null;
  Net.handshakePeerId = null;
  Net.wire = { sendEv: ev => { sent.push(ev); return Promise.resolve(); } };
  Net.onPeerJoin('peer-a');
  assert.equal(resumes, 1);
  assert.equal(context.G.state, 'play');
  assert.equal(Net.reconnecting, false);
  assert.equal(Net.reconnectState, null);
  assert.equal(sent.at(-1).t, 'resume');
});
