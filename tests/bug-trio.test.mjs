import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/* Load src/game.js in a sandbox with stubbed globals. Only the pure logic
   under test (sideLabel) is exercised — no DOM or canvas needed. */
async function loadGame(overrides = {}) {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, stats: null, demo: false };
  const context = vm.createContext(Object.assign({
    console, Math, JSON,
    G,
    DIFFS: [{ name: 'Rookie' }, { name: 'Club Pro' }, { name: 'Champion' }],
    Net: { role: 'host' },
    Settings: { firstTo: 7 },
    THEME: { scoreboard: 'solari', board: {}, gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff' },
    CX: 720, CY: 520, TAU: Math.PI * 2,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    rr: () => {},
    document: {
      getElementById: () => ({ getContext: () => ({}), addEventListener() {}, style: {} }),
      addEventListener() {}, hidden: false, title: '',
    },
  }, overrides));
  vm.runInContext(`${sb}\n${source}\nthis.__sideLabel = sideLabel; this.__drawScoreboard = drawScoreboard; this.__freshBoard = freshBoard; this.__G = G;`,
    context, { filename: 'src/game.js' });
  return { G: context.__G, sideLabel: context.__sideLabel, drawScoreboard: context.__drawScoreboard, freshBoard: context.__freshBoard };
}

/* Canvas 2D stub: absorbs everything, records fillText calls. */
function stubCtx(record) {
  const grad = { addColorStop() {} };
  const noop = () => {};
  return new Proxy({}, {
    get(t, p) {
      if (p === 'fillText') return (s, x, y) => record.push([String(s), Math.round(x), Math.round(y)]);
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
      return noop;
    },
    set() { return true; },
  });
}

/* Load src/net.js with stubbed DOM/engine globals for lobby-flow tests. */
async function loadNetLobby() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'play', pausedFrom: null, idleT: 0, _lobbyPaused: false, _prevMode: null };
  const calls = [];
  const shown = [];
  const fakeEl = (id) => ({
    classList: { add() {}, remove(c) { if (c === 'hidden') shown.push(id); }, toggle() {}, contains: () => false },
    textContent: '', innerHTML: '', disabled: false, onclick: null,
    querySelector: () => fakeEl(), focus() {}, addEventListener() {}, click() {},
  });
  const context = vm.createContext({
    console, Math, JSON, setTimeout, clearTimeout,
    G,
    Net: undefined, // net.js declares Net itself
    togglePause: (force) => {
      calls.push(['togglePause', force]);
      if (G.state === 'play' || G.state === 'count' || G.state === 'goal') {
        G.pausedFrom = G.state; G.state = 'pause';
      } else if (G.state === 'pause' && force !== true) {
        G.state = G.pausedFrom;
      }
    },
    AudioSys: { init() {}, ui() {} },
    hideAll() {},
    $: (id) => fakeEl(id),
    Settings: { firstTo: 7 },
  });
  vm.runInContext(`${source}\nthis.__Net = Net;`, context, { filename: 'src/net.js' });
  return { G, Net: context.__Net, calls, shown };
}

test('bug 1: exhibition scoreboard labels name both AIs, never YOU', async () => {
  const { G, sideLabel } = await loadGame();
  G.mode = 'watch'; G.watch = { a: 1, b: 2 };
  assert.equal(sideLabel(0), 'CLUB PRO');
  assert.equal(sideLabel(1), 'CHAMPION');
  // reversed matchup follows the sides
  G.watch = { a: 2, b: 0 };
  assert.equal(sideLabel(0), 'CHAMPION');
  assert.equal(sideLabel(1), 'ROOKIE');
});

test('bug 1: exhibition scoreboard draws both AI names on the boards', async () => {
  const { G, drawScoreboard, freshBoard } = await loadGame();
  G.mode = 'watch'; G.watch = { a: 1, b: 2 };
  G.score = [0, 0]; G.board = freshBoard();
  const record = [];
  drawScoreboard(stubCtx(record));
  const texts = record.map(r => r[0]);
  assert.ok(texts.includes('CLUB PRO'), 'left board labeled CLUB PRO, got: ' + texts.join(','));
  assert.ok(texts.includes('CHAMPION'), 'right board labeled CHAMPION, got: ' + texts.join(','));
  assert.ok(!texts.includes('YOU'), 'no YOU label in exhibition');
});

test('bug 1: non-watch labels unchanged', async () => {
  const { G, sideLabel } = await loadGame();
  G.mode = 'ai'; G.difficulty = 2;
  assert.equal(sideLabel(0), 'YOU');
  assert.equal(sideLabel(1), 'CHAMPION');
  G.mode = '2p';
  assert.deepEqual([sideLabel(0), sideLabel(1)], ['P1', 'P2']);
  G.mode = 'online'; // host's perspective
  assert.deepEqual([sideLabel(0), sideLabel(1)], ['YOU', 'RIVAL']);
});

test('bug 3: opening the lobby pauses a live local match', async () => {
  const { G, Net, calls } = await loadNetLobby();
  G.mode = 'ai'; G.state = 'play';
  Net.openLobby();
  assert.equal(G.state, 'pause');
  assert.equal(G._lobbyPaused, true);
  assert.deepEqual(calls[0], ['togglePause', true]);
  assert.equal(Net.lobbyOpen, true);
});

test('bug 3: cancelling the lobby resumes the paused match', async () => {
  const { G, Net } = await loadNetLobby();
  G.mode = 'ai'; G.state = 'play';
  Net.openLobby();
  Net.closeLobby();
  assert.equal(G._lobbyPaused, false);
  assert.equal(G.mode, 'ai');
  assert.equal(G.state, 'play'); // togglePause() resumed from pausedFrom
  assert.equal(Net.lobbyOpen, false);
});

test('bug 3: scoreboard labels stay on the paused match while the lobby is open', async () => {
  const { G, sideLabel } = await loadGame();
  // openLobby flips G.mode to 'online' over a paused ai match; labels behind
  // the overlay must still name the real matchup.
  G.mode = 'online'; G.difficulty = 1;
  G._lobbyPaused = true; G._lobbyPausedMode = 'ai';
  assert.strictEqual(sideLabel(0), 'YOU');
  assert.strictEqual(sideLabel(1), 'CLUB PRO');
  // a genuine online lobby (no paused match) is untouched
  G._lobbyPaused = false; G._lobbyPausedMode = null;
  assert.strictEqual(sideLabel(0), 'YOU');
  assert.strictEqual(sideLabel(1), 'RIVAL');
});

test('bug 3: cancelling the lobby never drops a live online match', async () => {
  const { G, Net, calls } = await loadNetLobby();
  // lobby opened over a live online match, then cancelled
  G.mode = 'online'; G.state = 'play';
  Net.active = true;
  Net.room = { leave: () => calls.push(['leave']) };
  Net.openLobby();
  assert.equal(G.state, 'pause');
  Net.cancelLobby();
  assert.ok(!calls.some(c => c[0] === 'leave'), 'room.leave must not run while a match is active');
  assert.equal(G.state, 'play'); // closeLobby resumed the paused match
  assert.equal(Net.lobbyOpen, false);
  // the pre-match lobby still cleans up its own room on cancel
  Net.active = false;
  Net.openLobby();
  Net.cancelLobby();
  assert.ok(calls.some(c => c[0] === 'leave'), 'pre-match lobby cancel still drops its room');
});

test('bug 3: closing the lobby never strands a live online match at the menu', async () => {
  const { G, Net, shown } = await loadNetLobby();
  // peer paused first: the lobby opened over an already-paused match, peer still away
  G.mode = 'online'; G.state = 'pause'; G.pausedFrom = 'play';
  Net.active = true; Net.lobbyOpen = true;
  Net.closeLobby();
  assert.equal(Net.lobbyOpen, false);
  assert.ok(shown.includes('pauseov'), 'pause card offered, not the menu');
  assert.ok(!shown.includes('menu'), 'menu must not appear over a live match');
  assert.equal(G.state, 'pause');
  // match running (peer resumed while the lobby was open): the lobby just drops away
  shown.length = 0;
  G.state = 'play';
  Net.lobbyOpen = true;
  Net.closeLobby();
  assert.ok(shown.includes('topbar'));
  assert.ok(!shown.includes('menu'));
  assert.equal(G.state, 'play');
});

test('bug 3: opening the lobby from the menu pauses nothing', async () => {
  const { G, Net, calls } = await loadNetLobby();
  G.mode = 'ai'; G.state = 'menu';
  Net.openLobby();
  assert.equal(calls.length, 0);
  assert.equal(G._lobbyPaused || false, false);
  Net.closeLobby();
  assert.equal(G.state, 'menu');
});

test('bug 2: rally chip lives in the left margin, clear of the scoreboard band', async () => {
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  // the old colliding slot must be gone
  assert.doesNotMatch(source, /fillText\('RALLY ×' \+ G\.stats\.rally, CX, 108\)/);
  // the chip anchors at x=150 — every scoreboard device is centered ~CX±200
  // (CX=720, so devices span 520..920); assert the pill for a long rally
  // label stays inside the margin with room to spare.
  assert.match(source, /const pw = tw \+ 28.*px = 150 - pw \/ 2/s);
  const fakeMeasure = (label) => label.length * 8; // generous over-estimate
  const label = 'RALLY ×' + 1234;
  const pw = fakeMeasure(label) + 28;
  const left = 150 - pw / 2, right = 150 + pw / 2;
  assert.ok(left > 0, 'chip stays on-screen');
  assert.ok(right < 520, `chip right edge ${right} stays clear of the scoreboard band (>= 520)`);
});
