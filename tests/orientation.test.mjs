// Board orientation: the portrait transform must be the exact inverse of the
// landscape one, so pointer input maps back onto the same rink coordinates
// the physics and AI use. Loads src/game.js in a vm sandbox (no DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadGame() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', difficulty: 1, watch: null, onlineFlip: false };
  const view = { w: 1280, h: 800, s: 1, ox: 0, oy: 0, portrait: false, dpr: 1 };
  const context = vm.createContext({
    console, Math, JSON, G,
    DIFFS: [{ name: 'Rookie' }, { name: 'Club Pro' }, { name: 'Champion' }],
    Net: { role: 'host' },
    Settings: { firstTo: 7, orientation: 'landscape' },
    THEME: { scoreboard: 'solari', board: {}, gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff' },
    CX: 720, CY: 520, TAU: Math.PI * 2,
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    rr: () => {},
    window: { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener() {} },
    document: {
      getElementById: () => ({ getContext: () => ({}), addEventListener() {}, style: {}, classList: { add() {}, remove() {} } }),
      createElement: () => ({
        getContext: () => new Proxy({}, {
          get(t, p) {
            if (p === 'measureText') return () => ({ width: 10 });
            if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
            if (p === 'getImageData') return () => ({ data: [] });
            if (p === 'canvas') return {};
            return () => {};
          },
          set() { return true; },
        }),
        width: 0, height: 0, style: {},
      }),
      addEventListener() {}, hidden: false, title: '',
      querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    performance: { now: () => 0 },
  });
  vm.runInContext(`${sb}\n${source}\nthis.__t = { screenToRink, resize, loadSettings, Settings, get view() { return view; }, set view(v) { view = v; }, get VW() { return VW; }, get VH() { return VH; } };`,
    context, { filename: 'src/game.js' });
  return context.__t;
}

// forward map: rink -> screen, mirroring the canvas transform in render()
function rinkToScreen(t, x, y, portrait) {
  const v = t.view;
  if (!portrait) return { x: v.ox + v.s * x, y: v.oy + v.s * y };
  return { x: v.ox + v.s * (t.VH - y), y: v.oy + v.s * (t.VW - x) };
}

test('orientation setting defaults to landscape and validates', async () => {
  const t = await loadGame();
  t.loadSettings();
  // no saved value -> tested via the Settings literal default in source
  const src = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(src, /orientation: 'landscape'/, 'default must be landscape');
});

test('resize honors a forced portrait on a wide screen', async () => {
  const t = await loadGame();
  t.view = { w: 1280, h: 800, s: 1, ox: 0, oy: 0, portrait: false, dpr: 1 };
  // landscape setting on a wide screen -> unrotated
  t.resize();
  assert.equal(t.view.portrait, false, 'landscape on wide screen stays unrotated');
});

test('resize forces portrait when the setting says so', async () => {
  const t = await loadGame();
  t.Settings.orientation = 'portrait';
  t.view = { w: 1280, h: 800, s: 1, ox: 0, oy: 0, portrait: false, dpr: 1 };
  t.resize();
  assert.equal(t.view.portrait, true, 'portrait setting must force rotation on a wide screen');
  // and the rotated view must still invert input exactly
  const s = Math.min(1280 / t.VH, 800 / t.VW);
  t.view = { w: 1280, h: 800, s, ox: (1280 - t.VH * s) / 2, oy: (800 - t.VW * s) / 2, portrait: true, dpr: 1 };
  const sc = rinkToScreen(t, 720, 520, true);
  const back = t.screenToRink(sc.x, sc.y);
  assert.ok(Math.abs(back.x - 720) < 1e-6 && Math.abs(back.y - 520) < 1e-6, 'forced-portrait round-trip');
});

test('screenToRink inverts the render transform in both orientations', async () => {
  const t = await loadGame();
  for (const portrait of [false, true]) {
    // fit a 1280x800 screen the way resize() does
    const s = portrait
      ? Math.min(1280 / t.VH, 800 / t.VW)
      : Math.min(1280 / t.VW, 800 / t.VH);
    const ox = portrait ? (1280 - t.VH * s) / 2 : (1280 - t.VW * s) / 2;
    const oy = portrait ? (800 - t.VW * s) / 2 : (800 - t.VH * s) / 2;
    t.view = { w: 1280, h: 800, s, ox, oy, portrait, dpr: 1 };
    for (const [x, y] of [[100, 100], [720, 520], [1340, 710], [360, 260], [1080, 780]]) {
      const sc = rinkToScreen(t, x, y, portrait);
      const back = t.screenToRink(sc.x, sc.y);
      assert.ok(Math.abs(back.x - x) < 1e-6, `portrait=${portrait} round-trip x (${x} -> ${back.x})`);
      assert.ok(Math.abs(back.y - y) < 1e-6, `portrait=${portrait} round-trip y (${y} -> ${back.y})`);
    }
  }
});

test('settings UI offers the board orientation control', async () => {
  const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  assert.match(template, /data-set="orientation" data-val="landscape"/, 'landscape button missing');
  assert.match(template, /data-set="orientation" data-val="portrait"/, 'portrait button missing');
  const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /key === 'orientation'/, 'setSetting must re-fit the view on orientation change');
});
