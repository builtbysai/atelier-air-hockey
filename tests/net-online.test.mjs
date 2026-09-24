// Online netcode robustness: ping correctness, disconnect/reconnect,
// guest state reconciliation, and the host-side remote mallet drive.
// Loads the real src/net.js in a vm sandbox twice (host + guest) and links
// the two instances with a delayed loopback transport (75ms each way =
// ~150ms RTT, Sam's reported ballpark) to prove the game stays coherent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDom() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      const startsHidden = ['focusov', 'pauseov', 'onlinedropov', 'onlineov'].includes(id);
      const classes = new Set(startsHidden ? ['hidden'] : []);
      const e = {
        id,
        classList: {
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
          toggle: (c, force) => {
            if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
            else if (force) classes.add(c); else classes.delete(c);
          },
          contains: (c) => classes.has(c),
        },
        _i: { className: '', textContent: '' },
        _em: { textContent: '' },
        querySelector(sel) { return sel === 'i' ? this._i : this._em; },
        textContent: '', innerHTML: '', disabled: false, value: '',
      };
      els.set(id, e);
    }
    return els.get(id);
  };
  return { $: el, els };
}

async function loadNetWorld() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const dom = makeDom();
  const G = {
    mode: 'online', state: 'play', onlineFlip: false,
    puck: { x: 0, y: 0, vx: 0, vy: 0 },
    m1: { x: 100, y: 300, tx: 100, ty: 300, vx: 0, vy: 0, side: 0, r: 46, trail: [] },
    m2: { x: 700, y: 300, tx: 700, ty: 300, vx: 0, vy: 0, side: 1, r: 46, trail: [] },
    score: [0, 0], winSide: 0, pausedFrom: 'play', focusLost: false,
    serveVX: 0, serveVY: 0, serveDir: 1,
    stats: { topSpeed: 0, bestRally: 0, saves: [0, 0], t0: 0 },
    trail: [], scuffs: [], texts: [],
    hintLive: false, demo: false, idleT: 0, freezeT: 0, trauma: 0,
  };
  const calls = [];
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    setTimeout, clearTimeout, performance,
    G,
    Settings: { firstTo: 7, pace: 'classic', sound: true, music: true, musicVolume: 70 },
    THEME: { id: 'deco' }, THEMES: { deco: {} }, PACES: { classic: {} },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    $: dom.$,
    hideAll() { calls.push('hideAll'); },
    clearCeremony() { calls.push('clearCeremony'); },
    togglePause(f, s) { calls.push(['togglePause', f, s]); G.state = f === true ? 'pause' : (G.pausedFrom || 'play'); },
    AudioSys: { ui() { calls.push('AudioSys.ui'); } },
    driveMallet(m, dt, cap) {
      calls.push(['driveMallet', m === G.m1 ? 'm1' : 'm2', Math.round(m.tx), Math.round(m.ty)]);
      m.x = m.tx; m.y = m.ty;
    },
    PLAYER_CAP: 920,
    startCount() { calls.push('startCount'); G.state = 'count'; G.puck.x = 400; G.puck.y = 300; G.puck.vx = 0; G.puck.vy = 0; },
    showWin() { calls.push('showWin'); },
    beginGoalCeremony(scorer) { calls.push(['beginGoalCeremony', scorer]); G.state = 'goal'; },
    setTheme() {}, applySettingsToUI() {}, rollServe() {},
    freshBoard() { calls.push('freshBoard'); return {}; },
    resetPositions() { calls.push('resetPositions'); },
    freshStats() { return { topSpeed: 0, bestRally: 0, saves: [0, 0], t0: 0 }; },
    pointers: { clear() {} },
    goalW: () => 200,
    CX: 400, PX: 60, PW: 680, PY: 80, PH: 440, CY: 300,
    PUCK_R: 26, MALLET_R: 46, PUCK_MAX: 2000,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  return { Net: context.__Net, G, calls, dom, context };
}

/* Two Net instances linked by a delayed loopback: every message crosses the
 * "wire" after delayMs, JSON-serialized like a real data channel. */
function link(a, b, delayMs) {
  const mkWire = (other) => ({
    sendSt: (d) => { setTimeout(() => other.Net.onSnapshot(JSON.parse(JSON.stringify(d)), 'peer'), delayMs); return Promise.resolve(); },
    sendIn: (d) => { setTimeout(() => other.Net.onInput(JSON.parse(JSON.stringify(d)), 'peer'), delayMs); return Promise.resolve(); },
    sendEv: (d) => { setTimeout(() => other.Net.onEvent(JSON.parse(JSON.stringify(d)), 'peer'), delayMs); return Promise.resolve(); },
  });
  a.Net.wire = mkWire(b);
  b.Net.wire = mkWire(a);
  for (const w of [a, b]) { w.Net.peerId = 'peer'; w.Net.active = true; w.Net.conn.salt = 's'; w.Net.conn.pending = {}; }
}

function liveWire(world) {
  const sent = [];
  world.Net.wire = {
    sendSt: (d) => Promise.resolve(),
    sendIn: (d) => Promise.resolve(),
    sendEv: (d) => { sent.push(d); return Promise.resolve(); },
  };
  return sent;
}

// ---------- ping ----------

test('ping RTT converges near the true round trip under 150ms latency', async () => {
  const h = await loadNetWorld(), g = await loadNetWorld();
  link(h, g, 75);
  h.Net.role = 'host'; g.Net.role = 'guest';
  h.Net.sendPing();
  await sleep(450);
  const rtt = h.Net.conn.rtt;
  assert.ok(rtt >= 100 && rtt <= 450, `rtt ${rtt} should sit near the 150ms round trip`);
  assert.equal(h.dom.$('connChip')._em.textContent, rtt + 'ms');
  assert.ok(!['-ms', 'NaNms'].includes(h.dom.$('connChip')._em.textContent));
});

test('pongs for unknown probe ids are ignored', async () => {
  const w = await loadNetWorld();
  w.Net.role = 'host'; w.Net.active = true; w.Net.peerId = 'peer';
  w.Net.onPong({ id: 'nope-99' });
  assert.equal(w.Net.conn.rtt, -1);
  w.Net.paintConn(); // the chip still shows unknown, never a phantom value
  assert.equal(w.dom.$('connChip')._em.textContent, '–ms');
});

test('stale probes fall back to the unknown glyph, never a fossil', async () => {
  const w = await loadNetWorld();
  w.Net.role = 'host'; w.Net.active = true; w.Net.peerId = 'peer';
  w.Net.conn.rtt = 149;
  w.Net.PING_STALE_MS = 1; // shrink the window so the test doesn't wait 10s
  w.Net.conn.lastPongT = performance.now() - 50; // ancient sample
  w.Net.paintConn();
  assert.equal(w.dom.$('connChip')._em.textContent, '–ms');
  assert.equal(w.dom.$('connChip')._i.className, 'unknown');
});

// ---------- RC1: the host drives the guest mallet ----------

test('host folds the guest input target into m2 (guest half only)', async () => {
  const w = await loadNetWorld();
  const { Net, G, calls } = w;
  Net.role = 'host'; Net.active = true; Net.peerId = 'peer';
  Net.onInput([700, 300], 'peer');
  // PX+PW-MALLET_R = 694: clamped to the guest half
  assert.equal(Net.remote.tx, 694);
  assert.equal(Net.remote.ty, 300);
  Net.driveRemoteMallet(1 / 60);
  assert.ok(calls.some((c) => c[0] === 'driveMallet' && c[1] === 'm2' && c[2] === 694 && c[3] === 300),
    'm2 driven toward the guest target: ' + JSON.stringify(calls));
  assert.equal(G.m2.tx, 694);
});

test('guest input can never cross the center line', async () => {
  const w = await loadNetWorld();
  const { Net } = w;
  Net.role = 'host'; Net.active = true; Net.peerId = 'peer';
  Net.onInput([100, 300], 'peer'); // deep in the host half
  assert.ok(Net.remote.tx >= 408, `remote tx ${Net.remote.tx} stays on the guest half`);
});

// ---------- reconciliation under latency ----------

test('guest dead reckoning stays bounded under 150ms RTT', async () => {
  const h = await loadNetWorld(), g = await loadNetWorld();
  link(h, g, 75);
  h.Net.role = 'host'; g.Net.role = 'guest';
  g.G.state = 'play';
  const T = 1.2;
  const truth = (tt) => 200 + 300 * (tt < T / 2 ? tt : T - tt);
  const vel = (tt) => (tt < T / 2 ? 300 : -300);
  const t0 = Date.now();
  let maxErr = 0, maxJump = 0, lastX = null, done = false;
  const hostTimer = setInterval(() => {
    const tt = (Date.now() - t0) / 1000;
    if (tt > T) { clearInterval(hostTimer); return; }
    h.G.puck.x = truth(tt); h.G.puck.y = 300;
    h.G.puck.vx = vel(tt); h.G.puck.vy = 0;
    h.Net.wire.sendSt(h.Net.encodeSnapshot());
  }, 33);
  await new Promise((resolve) => {
    const guestTimer = setInterval(() => {
      const tt = (Date.now() - t0) / 1000;
      g.Net.guestApply(1 / 60);
      const gx = g.G.puck.x;
      if (lastX !== null) maxJump = Math.max(maxJump, Math.abs(gx - lastX));
      lastX = gx;
      if (tt < T) maxErr = Math.max(maxErr, Math.abs(gx - truth(Math.max(0, tt - 0.075))));
      else { clearInterval(guestTimer); done = true; resolve(); }
    }, 16);
  });
  assert.ok(done);
  await sleep(600); // tail: motion stopped, snapshots keep the guest honest
  g.Net.guestApply(1 / 60);
  const tailErr = Math.abs(g.G.puck.x - truth(T));
  assert.ok(maxErr < 300, `tracking error bounded, got ${maxErr}`);
  assert.ok(maxJump < 320, `no teleports, got ${maxJump}`);
  assert.ok(tailErr < 80, `converges after motion stops, got ${tailErr}`);
});

test('guest recovers a missed goal event from snapshot flags', async () => {
  const w = await loadNetWorld();
  const { Net, G, calls } = w;
  Net.role = 'guest'; Net.active = true; Net.peerId = 'peer';
  G.state = 'play'; G.score = [2, 3];
  Net.onSnapshot([100, 100, 0, 0, 0, 0, 0, 0, 2, 4, 4, 0, 0, 0, 0], 'peer');
  Net.guestApply(1 / 60);
  assert.equal(G.state, 'goal');
  assert.equal(G.score[0], 2); assert.equal(G.score[1], 4); // element-wise: vm-realm array
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'beginGoalCeremony' && c[1] === 1));
});

test('guest rejoins a missed countdown from snapshot serve slots', async () => {
  const w = await loadNetWorld();
  const { Net, G, calls } = w;
  Net.role = 'guest'; Net.active = true; Net.peerId = 'peer';
  G.state = 'play'; G.score = [2, 3];
  Net.onSnapshot([400, 300, 0, 0, 0, 0, 0, 0, 2, 3, 1, 0, 0, 0, 0, 511.5, -203.2, 1], 'peer');
  Net.guestApply(1 / 60);
  assert.equal(G.state, 'count');
  assert.equal(G.serveVX, 511.5);
  assert.equal(G.serveVY, -203.2);
  assert.equal(G.serveDir, 1);
  assert.ok(calls.includes('startCount'));
});

test('guest adopts a missed pause and the following resume', async () => {
  const w = await loadNetWorld();
  const { Net, G } = w;
  Net.role = 'guest'; Net.active = true; Net.peerId = 'peer';
  G.state = 'play'; G.pausedFrom = 'play';
  Net.onSnapshot([400, 300, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0], 'peer');
  Net.guestApply(1 / 60);
  assert.equal(G.state, 'pause');
  Net.onSnapshot([400, 300, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0], 'peer');
  Net.guestApply(1 / 60);
  assert.equal(G.state, 'play');
});

test('guest adopts full time it never saw', async () => {
  const w = await loadNetWorld();
  const { Net, G, calls } = w;
  Net.role = 'guest'; Net.active = true; Net.peerId = 'peer';
  G.state = 'play'; G.score = [6, 3];
  Net.onSnapshot([400, 300, 0, 0, 0, 0, 0, 0, 7, 3, 16, 0, 0, 0, 0], 'peer');
  Net.guestApply(1 / 60);
  assert.equal(G.state, 'win');
  assert.equal(G.score[0], 7); assert.equal(G.score[1], 3); // element-wise: vm-realm array
  assert.ok(calls.includes('showWin'));
});

// ---------- disconnect / reconnect ----------

test('peer flap inside the grace window resumes seamlessly', async () => {
  const w = await loadNetWorld();
  const { Net, G, calls } = w;
  Net.role = 'host'; Net.active = true; Net.peerId = 'peer';
  Net.RECONNECT_GRACE_MS = 60;
  const sent = liveWire(w);
  G.state = 'play';
  Net.onPeerLeave('peer');
  assert.equal(Net.reconnecting, true);
  assert.equal(G.state, 'pause');
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'togglePause' && c[1] === true && c[2] === true));
  Net.onPeerJoin('peer');
  assert.equal(Net.reconnecting, false);
  assert.ok(sent.some((d) => d.t === 'resume'), 'resume sent when resuming from the drop');
  assert.equal(G.state, 'play');
});

test('rejoin never clobbers a manual pause', async () => {
  const w = await loadNetWorld();
  const { Net, G } = w;
  Net.role = 'host'; Net.active = true; Net.peerId = 'peer';
  Net.RECONNECT_GRACE_MS = 60;
  const sent = liveWire(w);
  G.state = 'pause'; G.pausedFrom = 'play'; // user paused before the drop
  Net.onPeerLeave('peer');
  assert.equal(Net.dropPaused, true);
  assert.equal(G.state, 'pause');
  Net.onPeerJoin('peer');
  assert.ok(!sent.some((d) => d.t === 'resume'), 'no resume sent to the rival');
  assert.equal(G.state, 'pause');
});

test('grace expiry declares the rival gone', async () => {
  const w = await loadNetWorld();
  const { Net, G, dom } = w;
  Net.role = 'host'; Net.active = true; Net.peerId = 'peer';
  Net.RECONNECT_GRACE_MS = 40;
  liveWire(w);
  G.state = 'play';
  Net.onPeerLeave('peer');
  await sleep(150);
  assert.equal(Net.active, false);
  assert.equal(dom.$('onlinedropov').classList.contains('hidden'), false);
});

test('a failed knock does not kill the waiting room', async () => {
  const w = await loadNetWorld();
  const { Net, calls, dom } = w;
  Net.role = 'host'; Net.waitingForRival = true; Net.active = false;
  Net.peerId = 'knocker'; Net.code = 'ABCDEF';
  Net.uiShow = (mode, data) => calls.push(['uiShow', mode, data && data.code]);
  Net.onPeerLeave('knocker');
  assert.equal(Net.waitingForRival, true);
  assert.ok(calls.some((c) => c[0] === 'uiShow' && c[1] === 'waiting' && c[2] === 'ABCDEF'));
  assert.equal(dom.$('onlinedropov').classList.contains('hidden'), true);
});

test('a peer rejoining after the drop restarts the match on knock', async () => {
  const w = await loadNetWorld();
  const { Net, calls, dom } = w;
  Net.role = 'host'; Net.active = false; Net.peerId = null;
  Net.waitingForRival = false; Net.code = 'ABCDEF';
  const sent = liveWire(w);
  dom.$('onlinedropov').classList.remove('hidden'); // the dead overlay is up
  Net.onPeerJoin('peerX');
  Net.onEvent({ t: 'knock' }, 'peerX');
  assert.ok(calls.includes('startCount'), 'fresh match started: ' + JSON.stringify(calls.slice(-6)));
  assert.ok(sent.some((d) => d.t === 'hello'), 'settings re-sent');
  assert.ok(sent.some((d) => d.t === 'countdown'), 'countdown re-sent');
});

// ---------- send guards ----------

test('sends no-op safely with no wire or no live match', async () => {
  const w = await loadNetWorld();
  const { Net, G } = w;
  Net.wire = null; Net.active = true;
  Net.sendPause(true); Net.sendInput(); Net.sendHello(); Net.sendCountdown(); Net.sendGoal(0);
  Net.wire = liveWire(w); Net.active = false;
  Net.sendPause(true); Net.sendInput(); Net.sendHello(); Net.sendCountdown(); Net.sendGoal(0);
  G.m2.tx = 500; // untouched world, no throw is the assertion
  assert.equal(G.m2.tx, 500);
});
