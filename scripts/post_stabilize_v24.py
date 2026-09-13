#!/usr/bin/env python3
"""Final v24 hardening pass after the initial source extraction.

Updates Trystero to its 0.25 API, hardens reconnect/validation, fixes remaining
accessibility/UI issues, splits app.js into net/game/ui modules, and refreshes
the build/test contract. Assertion-heavy by design: source drift fails loudly.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'
APP = SRC / 'app.js'
TEMPLATE = SRC / 'template.html'
INDEX = ROOT / 'index.html'


def once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f'{label}: expected 1 match, found {n}')
    return text.replace(old, new, 1)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + '\n', encoding='utf-8')


app = APP.read_text(encoding='utf-8')
html = TEMPLATE.read_text(encoding='utf-8')

# ---------------------------------------------------------------------------
# Trystero 0.25 API + networking hardening
# ---------------------------------------------------------------------------
app = once(app,
""" * Room interface (what joinRoom returns; the stub implements the same shape):
 *   { selfId, getPeers(), onPeerJoin(cb), onPeerLeave(cb),
 *     makeAction(name) -> [send(data), receive(cb), progress(cb)], leave() }
 * Trystero's receive callback gets (data, peerId).
""",
""" * Trystero 0.25 room shape: peer listeners are callback properties and
 * makeAction() returns an action object. Messages expose sender metadata via
 * action.onMessage(data, {peerId}); outbound traffic is targeted to the one
 * accepted rival instead of broadcast to every peer in the signaling room.
""", 'net protocol comment')

app = once(app,
"""  peerId: null,        // the one accepted rival; all other peers are ignored
  opToken: 0,          // invalidates async create/join work after Cancel
""",
"""  peerId: null,        // the one accepted rival; all other peers are ignored
  opToken: 0,          // invalidates async create/join work after Cancel
  disconnectTimer: 0,
  reconnecting: false,
  reconnectState: null,
""", 'reconnect state')

app = once(app,
"""Net.makeRoom = async function (joinRoom, code) {
  const turn = await Net.turnCredential();
  return joinRoom(
    {
      appId: 'atelier-air-hockey',
      relayConfig: { urls: NET_RELAYS, redundancy: 5 },
      turnConfig: [{ urls: NET_TURN_URLS, username: turn.username, credential: turn.password }],
    },
    'atelier-ah-' + code
  );
};
""",
"""Net.makeRoom = async function (joinRoom, code) {
  const turn = await Net.turnCredential();
  return joinRoom(
    {
      appId: 'atelier-air-hockey',
      relayConfig: { urls: NET_RELAYS, redundancy: 5 },
      turnConfig: [{ urls: NET_TURN_URLS, username: turn.username, credential: turn.password }],
    },
    'atelier-ah-' + code,
    {
      onPeerHandshake: async (peerId) => {
        if (Net.peerId && Net.peerId !== peerId) throw new Error('Table is full');
      },
      onJoinError: (details) => Net.logErr(details && (details.error || details)),
    }
  );
};
""", 'joinRoom callbacks')

app = once(app,
"""/* Wire a Room's three actions to handler callbacks. Shared by the real game
 * and the headless test guest — one place, one shape. */
Net.wireRoom = function (room, h) {
  const [sendSt, recvSt] = room.makeAction('st');
  const [sendIn, recvIn] = room.makeAction('in');
  const [sendEv, recvEv] = room.makeAction('ev');
  recvSt((data, peerId) => { try { h.onSt(data, peerId); } catch (e) { Net.logErr(e); } });
  recvIn((data, peerId) => { try { h.onIn(data, peerId); } catch (e) { Net.logErr(e); } });
  recvEv((data, peerId) => { try { h.onEv(data, peerId); } catch (e) { Net.logErr(e); } });
  room.onPeerJoin((id) => { try { h.onPeerJoin(id); } catch (e) { Net.logErr(e); } });
  room.onPeerLeave((id) => { try { h.onPeerLeave(id); } catch (e) { Net.logErr(e); } });
  return { sendSt, sendIn, sendEv };
};
""",
"""/* Wire Trystero 0.25 action objects to the game-facing Net interface. */
Net.wireRoom = function (room, h) {
  const st = room.makeAction('st');
  const input = room.makeAction('in');
  const ev = room.makeAction('ev');
  st.onMessage = (data, meta = {}) => { try { h.onSt(data, meta.peerId); } catch (e) { Net.logErr(e); } };
  input.onMessage = (data, meta = {}) => { try { h.onIn(data, meta.peerId); } catch (e) { Net.logErr(e); } };
  ev.onMessage = (data, meta = {}) => { try { h.onEv(data, meta.peerId); } catch (e) { Net.logErr(e); } };
  room.onPeerJoin = (id) => { try { h.onPeerJoin(id); } catch (e) { Net.logErr(e); } };
  room.onPeerLeave = (id) => { try { h.onPeerLeave(id); } catch (e) { Net.logErr(e); } };
  const send = (action, data) => {
    if (!Net.peerId) return Promise.resolve();
    return action.send(data, { target: Net.peerId }).catch(Net.logErr);
  };
  return {
    sendSt: (data) => send(st, data),
    sendIn: (data) => send(input, data),
    sendEv: (data) => send(ev, data),
  };
};
""", 'Trystero action API')

app = once(app,
"""Net.logErr = function (e) { console.warn('[Atelier net]', e); };
""",
"""Net.logErr = function (e) { console.warn('[Atelier net]', e); };
Net.connectionError = function (e, fallback) {
  Net.logErr(e);
  const msg = e && typeof e.message === 'string' ? e.message : '';
  return /does not support|secure context/i.test(msg) ? msg : fallback;
};
""", 'connection error helper')

app = once(app, "placeholder=\"····\" aria-label=\"Table code\">';", "placeholder=\"······\" aria-label=\"Table code\">';", 'six-dot placeholder')

app = once(app,
"""  } catch (e) {
    Net.uiShow('choose');
    Net.uiError("Couldn't reach the lobby — check your connection and try again.");
  }
};

Net.join = async function (rawCode) {
""",
"""  } catch (e) {
    Net.uiShow('choose');
    Net.uiError(Net.connectionError(e, "Couldn't reach the lobby — check your connection and try again."));
  }
};

Net.join = async function (rawCode) {
""", 'create error detail')

app = once(app,
"""    // fast path: host already waiting
    if (Object.keys(room.getPeers()).length > 0 && Net.wire) Net.wire.sendEv({ t: 'knock' });
  } catch (e) {
    Net.uiShow('choose');
    Net.uiError("Couldn't reach the lobby — check your connection and try again.");
  }
};
""",
"""    // Fast path: bind the first existing peer before targeted knock.
    const peers = Object.keys(room.getPeers());
    if (peers.length > 0 && Net.wire && Net.acceptPeer(peers[0])) Net.wire.sendEv({ t: 'knock' });
  } catch (e) {
    Net.uiShow('choose');
    Net.uiError(Net.connectionError(e, "Couldn't reach the lobby — check your connection and try again."));
  }
};
""", 'join fast path and error detail')

app = once(app,
"""Net.dropRoom = function () {
  try { if (Net.room) Net.room.leave(); } catch (e) {}
  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null;
  Net.active = false; Net.waitingForRival = false;
  Net.resetConn(); // chip hides with the match
};
""",
"""Net.dropRoom = function () {
  clearTimeout(Net.disconnectTimer); Net.disconnectTimer = 0;
  Net.reconnecting = false; Net.reconnectState = null;
  try { if (Net.room) Net.room.leave(); } catch (e) {}
  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null;
  Net.active = false; Net.waitingForRival = false;
  Net.resetConn(); // chip hides with the match
};
""", 'drop room reconnect cleanup')

app = once(app,
"""Net.onPeerJoin = function (id) {
  if (!Net.acceptPeer(id)) return;
  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();
  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });
};
Net.onPeerLeave = function (id) {
  if (id !== Net.peerId) return;
  Net.peerId = null;
  if (Net.active || Net.waitingForRival) Net.onRivalLeft();
};
""",
"""Net.onPeerJoin = function (id) {
  if (!Net.acceptPeer(id)) return;
  const wasReconnecting = Net.reconnecting;
  clearTimeout(Net.disconnectTimer); Net.disconnectTimer = 0;
  Net.reconnecting = false;
  Net.paintConn();
  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();
  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });
  else if (wasReconnecting && Net.active && Net.role === 'host') {
    if (G.state === 'pause' && Net.reconnectState && Net.reconnectState !== 'pause') togglePause(false, true);
    Net.reconnectState = null;
    if (Net.wire) Net.wire.sendEv({ t: 'resume' });
  }
};
Net.onPeerLeave = function (id) {
  if (id !== Net.peerId) return;
  Net.peerId = null;
  if (!Net.active && !Net.waitingForRival) return;
  if (Net.waitingForRival) { Net.onRivalLeft(); return; }
  Net.reconnecting = true;
  Net.reconnectState = G.state === 'pause' ? G.pausedFrom : G.state;
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true, true);
  Net.paintConn();
  clearTimeout(Net.disconnectTimer);
  Net.disconnectTimer = setTimeout(() => {
    if (!Net.peerId && Net.reconnecting) {
      Net.reconnecting = false;
      Net.onRivalLeft();
    }
  }, 5000);
};
""", 'reconnect grace')

app = once(app,
"""Net.onEvent = function (ev, peerId) {
  if (!Net.acceptPeer(peerId) || !ev || typeof ev !== 'object' || typeof ev.t !== 'string') return;
""",
"""Net.validGoalEvent = function (ev) {
  return (ev.scorer === 0 || ev.scorer === 1) && Number.isInteger(ev.s0) && Number.isInteger(ev.s1) &&
    ev.s0 >= 0 && ev.s1 >= 0 && ev.s0 <= Settings.firstTo && ev.s1 <= Settings.firstTo;
};
Net.onEvent = function (ev, peerId) {
  if (!Net.acceptPeer(peerId) || !ev || typeof ev !== 'object' || typeof ev.t !== 'string') return;
""", 'goal validation helper')

app = once(app,
"""    case 'goal':
      if (Net.role === 'guest' && Net.active) Net.guestGoal(ev);
      break;
""",
"""    case 'goal':
      if (Net.role === 'guest' && Net.active && Net.validGoalEvent(ev)) Net.guestGoal(ev);
      break;
""", 'goal validation use')

app = once(app,
"""    case 'rematch':
      Net.onRematch(ev.phase || '');
      break;
""",
"""    case 'rematch':
      if (['offer', 'accept', 'decline'].includes(ev.phase)) Net.onRematch(ev.phase);
      break;
""", 'rematch phase validation')

app = once(app,
"""    case 'ping':
      if (Net.wire && Net.active) { try { Net.wire.sendEv({ t: 'pong', id: ev.id, ts: ev.ts }); } catch (e) {} }
      break;
""",
"""    case 'ping':
      if (Net.wire && Net.active && Number.isInteger(ev.id) && Number.isFinite(ev.ts))
        Net.wire.sendEv({ t: 'pong', id: ev.id, ts: ev.ts });
      break;
""", 'ping validation')
app = once(app, "if (!ev || ev.id !== Net.conn.pingId || typeof ev.ts !== 'number') return;", "if (!ev || ev.id !== Net.conn.pingId || !Number.isFinite(ev.ts)) return;", 'pong finite')

app = once(app,
"""  const live = Net.active && G.mode === 'online';
  chip.classList.toggle('hidden', !live);
  if (!live) return;
  const dot = chip.querySelector('i');
  const label = chip.querySelector('em');
  const rtt = Net.conn.rtt;
""",
"""  const live = Net.active && G.mode === 'online';
  chip.classList.toggle('hidden', !live);
  if (!live) return;
  const dot = chip.querySelector('i');
  const label = chip.querySelector('em');
  if (Net.reconnecting) { dot.className = 'fair'; label.textContent = 'reconnecting'; return; }
  const rtt = Net.conn.rtt;
""", 'reconnect chip')

# ---------------------------------------------------------------------------
# UI/accessibility follow-up fixes
# ---------------------------------------------------------------------------
html = once(html, '<span class="carcount" id="carCount">1 / 6</span>', '<span class="carcount" id="carCount">1 / 9</span>', 'carousel count')
html = once(html, '<button class="btn primary" data-diff="1">Club Pro', '<button class="btn" data-diff="1">Club Pro', 'legacy rival primary')
html = once(html, '<button class="iconbtn" id="btnMenu2" title="Menu" aria-label="Menu">', '<button class="iconbtn" id="btnMenu2" title="Pause menu" aria-label="Pause menu">', 'topbar menu label')
html = once(html, '<h1>Settings</h1>', '<h1 id="settingsTitle">Settings</h1>', 'settings dialog label')
html = once(html, '<h1>Paused</h1>', '<h1 id="pauseTitle">Paused</h1>', 'pause dialog label')
html = once(html, '<button class="btn" id="btnRestart">Restart match</button>', '<button class="btn" id="btnPauseSettings">Settings</button>\n    <button class="btn" id="btnRestart">Restart match</button>', 'pause settings button')
html = once(html, '<div class="overlay hidden" id="onlineov">', '<div class="overlay hidden" id="onlineov" role="dialog" aria-modal="true" aria-labelledby="onlineTitle">', 'online dialog semantics')
html = once(html, '<div class="overlay hidden" id="onlinedropov">', '<div class="overlay hidden" id="onlinedropov" role="dialog" aria-modal="true" aria-labelledby="dropTitle">', 'drop dialog semantics')
html = once(html, '<h1>Rival left</h1>', '<h1 id="dropTitle">Rival left</h1>', 'drop title id')
html = once(html,
'<p><b>Two players:</b> each takes an end — mouse and touch work at once, or two fingers on mobile.</p>',
'<p><b>Two players:</b> each takes an end. Use two touches, WASD + arrow keys, or two gamepads. Mouse/touch can still control either side directly.</p>', 'two-player help')

# Wrong icon MIME from the one-shot migration; SVG is the actual asset.
html = html.replace('<link rel="icon" type="image/png" sizes="192x192" href="./assets/icon.svg">', '<link rel="icon" type="image/svg+xml" sizes="any" href="./assets/icon.svg">', 1)
html = html.replace('<link rel="apple-touch-icon" href="./assets/icon.svg">\n', '', 1)

# Settings can now be opened from pause and return to the right surface.
app = once(app,
"""function renderProgress() {
""",
"""let settingsReturn = 'menu';
function openSettings(from = 'menu') {
  settingsReturn = from;
  AudioSys.ui(); hideAll(); $('settings').classList.remove('hidden');
}
function closeSettings() {
  AudioSys.ui(); hideAll();
  $(settingsReturn === 'pause' ? 'pauseov' : 'menu').classList.remove('hidden');
}

function renderProgress() {
""", 'settings return helpers')

app = once(app,
"""  AudioSys.muted = !Settings.sound;
""",
"""  const canVibrate = typeof navigator.vibrate === 'function';
  document.querySelectorAll('[data-set="haptics"]').forEach(btn => {
    btn.disabled = !canVibrate;
    btn.title = canVibrate ? '' : 'Haptics are not available on this device';
  });
  AudioSys.muted = !Settings.sound;
""", 'haptics capability')

# Online guest owns m2, not m1; never let one gamepad drive both sides.
start = """function keyboardGamepadDrive(now) {
  const dt = Math.min(0.04, Math.max(0, (now - keyLast) / 1000)); keyLast = now;
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const speed = 920;
"""
replacement = """function keyboardGamepadDrive(now) {
  const dt = Math.min(0.04, Math.max(0, (now - keyLast) / 1000)); keyLast = now;
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const speed = 920;
"""
app = once(app, start, replacement, 'keyboard drive anchor')
app = once(app,
"""    move(G.m1, 'KeyA', 'KeyD', 'KeyW', 'KeyS', PX + MALLET_R, CX - MALLET_R);
    if (G.mode === '2p') move(G.m2, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', CX + MALLET_R, PX + PW - MALLET_R);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
""",
"""    const guestOwnsRight = G.mode === 'online' && Net.role === 'guest';
    const p1 = guestOwnsRight ? G.m2 : G.m1;
    const p1Lo = guestOwnsRight ? CX + MALLET_R : PX + MALLET_R;
    const p1Hi = guestOwnsRight ? PX + PW - MALLET_R : CX - MALLET_R;
    move(p1, 'KeyA', 'KeyD', 'KeyW', 'KeyS', p1Lo, p1Hi);
    if (G.mode === '2p') move(G.m2, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', CX + MALLET_R, PX + PW - MALLET_R);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
""", 'online keyboard ownership')
app = once(app,
"""      applyPad(pads[0], G.m1, PX + MALLET_R, CX - MALLET_R);
      if (G.mode === '2p') applyPad(pads[1] || pads[0], G.m2, CX + MALLET_R, PX + PW - MALLET_R);
""",
"""      applyPad(pads[0], p1, p1Lo, p1Hi);
      if (G.mode === '2p' && pads[1]) applyPad(pads[1], G.m2, CX + MALLET_R, PX + PW - MALLET_R);
""", 'gamepad ownership')

# Dialog focus management + focus trap.
app = once(app,
"""function wireUI() {
  buildCarousel();
""",
"""function installDialogA11y() {
  let returnFocus = null;
  const visible = () => document.querySelector('.overlay[role="dialog"]:not(.hidden)');
  const focusables = dlg => [...dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
  const sync = () => {
    const dlg = visible();
    if (dlg) {
      if (!dlg.contains(document.activeElement)) {
        if (!returnFocus || !document.body.contains(returnFocus)) returnFocus = document.activeElement;
        const f = focusables(dlg)[0];
        if (f) requestAnimationFrame(() => f.focus({ preventScroll: true }));
      }
    } else if (returnFocus && document.body.contains(returnFocus)) {
      const f = returnFocus; returnFocus = null;
      requestAnimationFrame(() => f.focus({ preventScroll: true }));
    }
  };
  const obs = new MutationObserver(sync);
  document.querySelectorAll('.overlay[role="dialog"]').forEach(d => obs.observe(d, { attributes: true, attributeFilter: ['class'] }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const dlg = visible(); if (!dlg) return;
    const fs = focusables(dlg); if (!fs.length) { e.preventDefault(); return; }
    const first = fs[0], last = fs[fs.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);
}

function wireUI() {
  installDialogA11y();
  buildCarousel();
""", 'dialog accessibility')

app = once(app,
"""  $('btnSettings').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('settings').classList.remove('hidden'); });
  $('settingsClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
""",
"""  $('btnSettings').addEventListener('click', () => openSettings('menu'));
  $('btnPauseSettings').addEventListener('click', () => openSettings('pause'));
  $('settingsClose').addEventListener('click', closeSettings);
""", 'settings wiring')

app = once(app,
"""  $('btnRestart').addEventListener('click', restartMatch);
  $('btnQuit').addEventListener('click', quitToMenu);
""",
"""  $('btnRestart').addEventListener('click', () => {
    if ((G.score[0] || G.score[1]) && !confirm('Restart this match and reset the score?')) return;
    restartMatch();
  });
  $('btnQuit').addEventListener('click', () => {
    if ((G.score[0] || G.score[1]) && !confirm('Quit this match?')) return;
    quitToMenu();
  });
""", 'destructive confirmations')

app = once(app,
"""    const interactive = e.target && e.target.closest && e.target.closest('input, textarea, select, button, a, [contenteditable="true"]');
""",
"""    const interactive = e.target && e.target.closest && e.target.closest('input, textarea, select, button, a, [role="option"], [contenteditable="true"]');
""", 'keyboard interactive guard')

old_escape = """    else if (e.key === 'Escape') {
      if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
      else if (!$('help').classList.contains('hidden')) $('helpClose').click();
      else if (!$('settings').classList.contains('hidden')) $('settingsClose').click();
    }
"""
new_escape = """    else if (e.key === 'Escape') {
      if (!$('help').classList.contains('hidden')) $('helpClose').click();
      else if (!$('settings').classList.contains('hidden')) $('settingsClose').click();
      else if (!$('progress').classList.contains('hidden')) $('progressClose').click();
      else if (!$('onlineov').classList.contains('hidden') && !Net.active) Net.cancelLobby();
      else if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
    }
"""
app = once(app, old_escape, new_escape, 'escape ordering')

app = once(app,
"""  for (const id of ['menu', 'help', 'settings', 'pauseov', 'winov', 'onlineov', 'onlinedropov', 'hint']) $(id).classList.add('hidden');
""",
"""  for (const id of ['menu', 'progress', 'help', 'settings', 'pauseov', 'winov', 'onlineov', 'onlinedropov', 'hint']) $(id).classList.add('hidden');
""", 'hide progress overlay')

# ---------------------------------------------------------------------------
# Split the final monolith into maintained classic-script modules
# ---------------------------------------------------------------------------
engine_marker = '/* ============================================================\n   ATELIER AIR HOCKEY — engine v2'
ui_marker = '// ---------- themes ----------'
e = app.find(engine_marker)
u = app.find(ui_marker)
if e <= 0 or u <= e:
    raise RuntimeError(f'could not split app.js: engine={e}, ui={u}')
net = app[:e].rstrip() + '\n'
game = app[e:u].rstrip() + '\n'
ui = app[u:].rstrip() + '\n'
net = net.replace('All netcode lives here behind the `Net` interface. The engine (engine2.js)', 'All netcode lives here behind the `Net` interface. The game runtime (game.js)')
game = game.replace('   Single file. Mobile-first. No external assets but fonts.', '   Modular source. Mobile-first. No image/audio asset dependencies.')

html = once(html,
"""<script src="./src/themes.js"></script>
<script src="./src/scoreboards.js"></script>
<script src="./src/app.js"></script>
""",
"""<script src="./src/themes.js"></script>
<script src="./src/scoreboards.js"></script>
<script src="./src/net.js"></script>
<script src="./src/game.js"></script>
<script src="./src/ui.js"></script>
""", 'module script tags')

write(SRC / 'net.js', net)
write(SRC / 'game.js', game)
write(SRC / 'ui.js', ui)
write(TEMPLATE, html)
write(INDEX, html)
APP.unlink()

# ---------------------------------------------------------------------------
# Build/test contract and service worker
# ---------------------------------------------------------------------------
check = r'''import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [index, template, net, game, ui, boards, themes, css] = await Promise.all([
  readFile('index.html','utf8'), readFile('src/template.html','utf8'), readFile('src/net.js','utf8'),
  readFile('src/game.js','utf8'), readFile('src/ui.js','utf8'), readFile('src/scoreboards.js','utf8'),
  readFile('src/themes.js','utf8'), readFile('src/styles.css','utf8')
]);
assert.equal(index, template, 'index.html must be generated from src/template.html');
for (const f of ['styles.css','themes.js','scoreboards.js','net.js','game.js','ui.js']) assert.match(index, new RegExp('src/' + f.replace('.', '\\.')));
assert.doesNotMatch(index, /src\/app\.js/); assert.doesNotMatch(index, /<style>/); assert.doesNotMatch(index, /<script>\s/);
assert.match(net, /\.onMessage\s*=/); assert.match(net, /\{ target: Net\.peerId \}/); assert.match(net, /onPeerJoin\s*=/);
assert.doesNotMatch(net, /const \[sendSt/); assert.doesNotMatch(net, /createStubPair|netstub/);
assert.match(net, /disconnectTimer/); assert.match(net, /validGoalEvent/); assert.match(net, /opToken/);
assert.match(game, /bestStreak: \[0, 0\]/); assert.match(game, /function togglePause/);
assert.match(boards, /Math\.max\(11, target \+ 1\)/); assert.match(boards, /chars\.split/);
assert.match(ui, /installDialogA11y/); assert.match(ui, /\[role="option"\]/); assert.match(ui, /guestOwnsRight/); assert.match(ui, /'progress'/);
assert.match(template, />1 \/ 9</); assert.match(template, /id="settingsTitle"/); assert.match(template, /id="pauseTitle"/);
assert.match(themes, /THEMES\.deco/); assert.match(css, /focus-visible/);
console.log('Static stabilization checks passed');
'''
write(ROOT / 'scripts' / 'check.mjs', check)

package = {
  'name': 'atelier-air-hockey', 'version': '1.0.0', 'private': True, 'type': 'module',
  'scripts': {
    'build': 'node scripts/build.mjs',
    'check': 'node scripts/check.mjs',
    'syntax': 'node --check src/themes.js && node --check src/scoreboards.js && node --check src/net.js && node --check src/game.js && node --check src/ui.js',
    'test': 'npm run build && npm run check && npm run syntax'
  }
}
write(ROOT / 'package.json', json.dumps(package, indent=2))

sw = r'''const CACHE='atelier-air-hockey-v24';
const CORE=['./','./index.html','./manifest.webmanifest','./assets/icon.svg','./src/styles.css','./src/themes.js','./src/scoreboards.js','./src/net.js','./src/game.js','./src/ui.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(async()=>{
    const hit=await caches.match(e.request); if(hit)return hit;
    if(e.request.mode==='navigate')return caches.match('./index.html');
    return Response.error();
  }));
});
'''
write(ROOT / 'sw.js', sw)

readme = '''# Atelier Air Hockey\n\nA handcrafted browser air-hockey game with nine art-directed tables, local AI rivals, same-screen two-player play, and peer-to-peer online matches.\n\n**Play:** https://builtbysai.com/atelier-air-hockey/\n\n## Development\n\n`src/` is the source of truth. The runtime is split into `themes.js`, `scoreboards.js`, `net.js`, `game.js`, and `ui.js`, with `styles.css` and `template.html` as the page shell. Root `index.html` is generated from `src/template.html` for GitHub Pages.\n\n```bash\nnpm run build\nnpm test\n```\n\nCI checks source/build consistency, core stabilization invariants, and JavaScript syntax. Historical release snapshots live in Git history; current releases should use Git tags/releases instead of copied HTML builds.\n\n## Controls\n\n- Mouse/touch: direct mallet control.\n- Keyboard: WASD for player one; arrow keys for player two.\n- Gamepads: pad one controls player one; pad two controls player two.\n- P: pause/resume. M: mute/unmute. Esc: close the current dialog or pause/resume.\n\n## Online play\n\nOnline matches use Trystero 0.25/WebRTC with Nostr signaling. The host is authoritative for physics and match settings. Rooms use a six-character invite/deep link, bind one rival, target all game traffic to that rival, validate inbound state, and provide a short reconnect grace period for transient drops. No account is required.\n\n## Privacy and local data\n\nOffline play makes no game-network request. Online play loads Trystero and uses WebRTC, Nostr signaling relays, and TURN when needed to establish the peer-to-peer session. Settings, records, personal bests, achievements, and table-tour progress stay in this browser via `localStorage` and can be reset from Progress.\n\n## License\n\nSee [LICENSE](./LICENSE).\n'''
write(ROOT / 'README.md', readme)

print('post-stabilization hardening completed')
