// Portrait orientation: the render transform must be a TRUE rotation
// (positive determinant), never a reflection - the old matrix mirrored
// the table and reversed every world-space glyph (scoreboards, countdown,
// GOAL!, floating text). screenToRink must be its exact inverse so input
// stays glued to the fingertip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const VW = 1440, VH = 1040; // must match src/game.js

function makeStorage() {
  const store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

async function loadGame() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, onlineFlip: false, themeId: 'deco', score: [0, 0] };
  const context = vm.createContext({
    console, Math, JSON, G,
    DIFFS: [{ name: 'Rookie' }, { name: 'Club Pro' }, { name: 'Champion' }],
    Net: { role: 'host' },
    THEME: {
      scoreboard: 'solari', board: {}, gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff',
      drawRails() {}, drawSurface() {}, drawMarkings() {},
    },
    CX: 720, CY: 520, TAU: Math.PI * 2,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    mulberry32: (s) => () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
    rnd: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
    rr: () => {},
    window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {} },
    document: {
      getElementById: () => ({ getContext: () => ({}), addEventListener() {}, style: {}, classList: { add() {}, remove() {}, contains: () => false } }),
      createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
      addEventListener() {}, hidden: false, title: '',
      querySelectorAll: () => [],
    },
    localStorage: makeStorage(),
    navigator: {},
    requestAnimationFrame() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${source}\nthis.__t = { screenToRink, view };`,
    context, { filename: 'src/game.js' });
  return context.__t;
}

// The documented render transform: portrait => ctx.transform(0,-s,s,0,ox,oy+s*VW).
// Forward mapping of a rink point to client pixels:
const fwd = (x, y, v) => ({ cx: v.s * y + v.ox, cy: -v.s * x + v.oy + v.s * VW });

test('portrait transform is a true rotation (no reflection)', () => {
  const v = { s: 0.5, ox: 10, oy: 20, portrait: true };
  // orientation: the signed area of the mapped unit triangle must stay positive
  const o = fwd(0, 0, v), ax = fwd(1, 0, v), ay = fwd(0, 1, v);
  const det = (ax.cx - o.cx) * (ay.cy - o.cy) - (ax.cy - o.cy) * (ay.cx - o.cx);
  assert.ok(det > 0, `portrait matrix must not reflect (det=${det})`);
});

test('screenToRink inverts the portrait render transform exactly', async () => {
  const { screenToRink, view } = await loadGame();
  view.s = 0.5; view.ox = 10; view.oy = 20; view.portrait = true;
  for (const [x, y] of [[0, 0], [VW, 0], [0, VH], [VW, VH], [720, 520], [123.4, 987.6]]) {
    const { cx, cy } = fwd(x, y, view);
    const p = screenToRink(cx, cy);
    assert.ok(Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6,
      `round-trip failed for rink (${x},${y}): got (${p.x},${p.y})`);
  }
});

test('screenToRink inverts the landscape transform exactly', async () => {
  const { screenToRink, view } = await loadGame();
  view.s = 0.75; view.ox = 40; view.oy = 12; view.portrait = false;
  for (const [x, y] of [[0, 0], [VW, VH], [720, 520], [99.9, 11.1]]) {
    const p = screenToRink(x * view.s + view.ox, y * view.s + view.oy);
    assert.ok(Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6,
      `round-trip failed for rink (${x},${y})`);
  }
});

test('portrait keeps P1 goal at the bottom of the screen', async () => {
  const { screenToRink, view } = await loadGame();
  view.s = 0.5; view.ox = 0; view.oy = 0; view.portrait = true;
  // P1 defends x=0; a touch near the bottom of the screen must land near x=0
  const { cx, cy } = fwd(0, VH / 2, view);
  const p = screenToRink(cx, cy);
  assert.ok(Math.abs(p.x) < 1e-6, 'bottom-of-screen touch must map to the P1 goal line');
});
