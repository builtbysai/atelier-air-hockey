#!/usr/bin/env python3
from pathlib import Path


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {text.count(old)}')
    return text.replace(old, new, 1)

net_path = Path('src/net.js')
net = net_path.read_text()
net = replace_once(net,
"  peerId: null,        // the one accepted rival; all other peers are ignored\n  opToken: 0,          // invalidates async create/join work after Cancel\n",
"  peerId: null,        // the one accepted rival; all other peers are ignored\n  handshakePeerId: null, // reserves the first peer while its handshake is still pending\n  opToken: 0,          // invalidates async create/join work after Cancel\n",
'net lifecycle handshake lock')

net = replace_once(net,
"      onPeerHandshake: async (peerId) => {\n        if (Net.peerId && Net.peerId !== peerId) throw new Error('Table is full');\n      },\n      onJoinError: (details) => Net.logErr(details && (details.error || details)),\n",
"      onPeerHandshake: async (peerId) => {\n        const locked = Net.peerId || Net.handshakePeerId;\n        if (locked && locked !== peerId) throw new Error('Table is full');\n        if (!Net.handshakePeerId) Net.handshakePeerId = peerId;\n      },\n      onJoinError: (details) => {\n        if (details && details.peerId === Net.handshakePeerId && !Net.peerId) Net.handshakePeerId = null;\n        Net.logErr(details && (details.error || details));\n      },\n",
'handshake callbacks')

net = replace_once(net,
"  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null;\n",
"  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null; Net.handshakePeerId = null;\n",
'dropRoom handshake cleanup')

net = replace_once(net,
"Net.acceptPeer = function (id) {\n  if (!id) return false;\n  if (!Net.peerId) Net.peerId = id;\n  return id === Net.peerId;\n};\n",
"Net.acceptPeer = function (id) {\n  if (!id) return false;\n  if (Net.handshakePeerId && id !== Net.handshakePeerId) return false;\n  if (!Net.peerId) Net.peerId = id;\n  if (id === Net.peerId) Net.handshakePeerId = null;\n  return id === Net.peerId;\n};\n",
'acceptPeer handshake enforcement')

net = replace_once(net,
"  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();\n  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });\n  else if (wasReconnecting && Net.active && Net.role === 'host') {\n    if (G.state === 'pause' && Net.reconnectState && Net.reconnectState !== 'pause') togglePause(false, true);\n    Net.reconnectState = null;\n    if (Net.wire) Net.wire.sendEv({ t: 'resume' });\n  }\n",
"  if (wasReconnecting && Net.active) {\n    // Both roles resume their own retained state. Previously only the host\n    // resumed here, leaving a reconnecting guest stuck on the pause overlay.\n    if (G.state === 'pause' && Net.reconnectState && Net.reconnectState !== 'pause') togglePause(false, true);\n    Net.reconnectState = null;\n    if (Net.wire) Net.wire.sendEv({ t: 'resume' });\n    return;\n  }\n  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();\n  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });\n",
'role-symmetric reconnect resume')

net = replace_once(net,
"  Net.peerId = null;\n  if (!Net.active && !Net.waitingForRival) return;\n",
"  Net.peerId = null; Net.handshakePeerId = null;\n  if (!Net.active && !Net.waitingForRival) return;\n",
'peer leave handshake cleanup')
net_path.write_text(net)

package_path = Path('package.json')
package = package_path.read_text()
package = replace_once(package,
'    "test": "npm run build && npm run check && npm run syntax && npm run unit"',
'    "test": "npm run check && npm run syntax && npm run unit && npm run build && npm run check"',
'CI source-of-truth order')
package_path.write_text(package)

check_path = Path('scripts/check.mjs')
check = check_path.read_text()
check = replace_once(check,
"assert.match(net, /disconnectTimer/); assert.match(net, /validGoalEvent/); assert.match(net, /opToken/);\n",
"assert.match(net, /disconnectTimer/); assert.match(net, /validGoalEvent/); assert.match(net, /opToken/); assert.match(net, /handshakePeerId/);\n",
'check handshake lock')
check_path.write_text(check)

test_path = Path('tests/net-adapter.test.mjs')
test = test_path.read_text()
test = replace_once(test,
"  return { Net: context.__Net, netGenCode: context.__netGenCode };\n",
"  return { Net: context.__Net, netGenCode: context.__netGenCode, context };\n",
'expose VM context')

test = replace_once(test,
"test('peer binding accepts one rival and rejects extras', async () => {\n  const { Net } = await loadNet();\n  Net.peerId = null;\n  assert.equal(Net.acceptPeer('peer-a'), true);\n  assert.equal(Net.peerId, 'peer-a');\n  assert.equal(Net.acceptPeer('peer-a'), true);\n  assert.equal(Net.acceptPeer('peer-b'), false);\n  assert.equal(Net.peerId, 'peer-a');\n});\n",
"test('peer binding honors the pending handshake lock and rejects extras', async () => {\n  const { Net } = await loadNet();\n  Net.peerId = null;\n  Net.handshakePeerId = 'peer-a';\n  assert.equal(Net.acceptPeer('peer-b'), false);\n  assert.equal(Net.peerId, null);\n  assert.equal(Net.acceptPeer('peer-a'), true);\n  assert.equal(Net.peerId, 'peer-a');\n  assert.equal(Net.handshakePeerId, null);\n  assert.equal(Net.acceptPeer('peer-b'), false);\n});\n\ntest('handshake gate reserves one rival and releases a failed reservation', async () => {\n  const { Net } = await loadNet();\n  Net.turnCredential = async () => ({ username: 'u', password: 'p' });\n  let callbacks;\n  const fakeRoom = {};\n  await Net.makeRoom((config, roomId, cb) => { callbacks = cb; return fakeRoom; }, 'ABCDEF');\n  await callbacks.onPeerHandshake('peer-a');\n  assert.equal(Net.handshakePeerId, 'peer-a');\n  await assert.rejects(() => callbacks.onPeerHandshake('peer-b'), /Table is full/);\n  callbacks.onJoinError({ peerId: 'peer-a', error: 'failed' });\n  assert.equal(Net.handshakePeerId, null);\n});\n\ntest('reconnecting guest resumes retained play state instead of remaining paused', async () => {\n  const { Net, context } = await loadNet();\n  const sent = [];\n  let resumes = 0;\n  context.G = { state: 'pause', pausedFrom: 'play', mode: 'online' };\n  context.$ = () => null;\n  context.togglePause = (force, silent) => {\n    assert.equal(force, false);\n    assert.equal(silent, true);\n    context.G.state = 'play';\n    resumes++;\n  };\n  Net.role = 'guest';\n  Net.active = true;\n  Net.reconnecting = true;\n  Net.reconnectState = 'play';\n  Net.peerId = null;\n  Net.handshakePeerId = null;\n  Net.wire = { sendEv: ev => { sent.push(ev); return Promise.resolve(); } };\n  Net.onPeerJoin('peer-a');\n  assert.equal(resumes, 1);\n  assert.equal(context.G.state, 'play');\n  assert.equal(Net.reconnecting, false);\n  assert.equal(Net.reconnectState, null);\n  assert.equal(sent.at(-1).t, 'resume');\n});\n",
'expand peer/reconnect tests')
test_path.write_text(test)

print('Final v24 hardening applied')
