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
    Net: { role: 'host', playerSide: () => 0, isAuthority: () => true, isPlayer: () => true, localMallet: () => null },
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
  vm.runInContext(`${sb}\n${source}\nthis.__t = { screenToRink, touchOffsetScreen, touchTargetRink, resize, loadSettings, Settings, G, win: window, get view() { return view; }, set view(v) { view = v; }, get VW() { return VW; }, get VH() { return VH; } };`,
    context, { filename: 'src/game.js' });
  return context.__t;
}

// forward map: rink -> screen, mirroring the canvas transform in render()
// the documented render transform: portrait is a TRUE 90° rotation
// (ctx.transform(0,-s,s,0,ox,oy+s*VW)), never a reflection
function rinkToScreen(t, x, y, portrait) {
  const v = t.view;
  if (!portrait) return { x: v.ox + v.s * x, y: v.oy + v.s * y };
  return { x: v.ox + v.s * y, y: v.oy + v.s * (t.VW - x) };
}

test('orientation setting defaults to auto and validates', async () => {
  const t = await loadGame();
  t.loadSettings();
  // no saved value -> tested via the Settings literal default in source
  const src = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(src, /orientation: 'auto'/, 'default must follow the display automatically');
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

test('touch offset follows the player axis in top-down landscape and portrait', async () => {
  const t = await loadGame();
  t.G.mode = 'ai';

  t.view = { w: 844, h: 390, s: 0.5, ox: 0, oy: 0, portrait: false, dpr: 1, camera: 'top', cam: null };
  const landscape = t.touchOffsetScreen(0, 220, 180);
  assert.ok(landscape.x > 0, 'left-side player should place the mallet ahead of the finger toward center');
  assert.equal(landscape.y, 0, 'landscape offset must not drift vertically');
  const l0 = t.screenToRink(220, 180);
  const l1 = t.screenToRink(220 + landscape.x, 180 + landscape.y);
  assert.ok(l1.x > l0.x && Math.abs(l1.y - l0.y) < 1e-6, 'landscape touch should advance along rink X only');

  t.view = { w: 390, h: 844, s: 0.5, ox: 0, oy: 0, portrait: true, dpr: 1, camera: 'top', cam: null };
  const portrait = t.touchOffsetScreen(0, 180, 500);
  assert.equal(portrait.x, 0, 'portrait offset stays on screen Y');
  assert.ok(portrait.y < 0, 'bottom player should place the mallet above the finger');
  const p0 = t.screenToRink(180, 500);
  const p1 = t.screenToRink(180 + portrait.x, 500 + portrait.y);
  assert.ok(p1.x > p0.x && Math.abs(p1.y - p0.y) < 1e-6, 'portrait touch should advance along the same physical rink X axis');
});

test('local 2P far-side touch offset reverses toward center in both orientations', async () => {
  const t = await loadGame();
  t.G.mode = '2p';

  t.view = { w: 844, h: 390, s: 0.5, ox: 0, oy: 0, portrait: false, dpr: 1, camera: 'top', cam: null };
  const landscape = t.touchOffsetScreen(1, 650, 180);
  assert.ok(landscape.x < 0 && landscape.y === 0, 'right-side player should advance leftward toward center');

  t.view = { w: 390, h: 844, s: 0.5, ox: 0, oy: 0, portrait: true, dpr: 1, camera: 'top', cam: null };
  const portrait = t.touchOffsetScreen(1, 180, 220);
  assert.ok(portrait.x === 0 && portrait.y > 0, 'top player should advance downward toward center');
});

test('mirrored online guest touch still advances toward center in landscape', async () => {
  const t = await loadGame();
  t.G.mode = 'online';
  t.G.onlineFlip = true;
  t.view = { w: 844, h: 390, s: 0.5, ox: 0, oy: 0, portrait: false, dpr: 1, camera: 'top', cam: null };

  const off = t.touchOffsetScreen(1, 220, 180);
  assert.ok(off.x > 0 && off.y === 0, 'guest forward screen direction should remain rightward after mirroring');
  const before = t.screenToRink(220, 180);
  const after = t.screenToRink(220 + off.x, 180 + off.y);
  assert.ok(after.x < before.x, 'mirrored guest physical rink X should move leftward toward center');
});

test('touch target tapers near center so the mallet never develops a sticky dead zone', async () => {
  const t = await loadGame();
  t.G.mode = 'ai';
  t.G.onlineFlip = false;
  t.view = { w: 844, h: 390, s: 0.5, ox: 0, oy: 0, portrait: false, dpr: 1, camera: 'top', cam: null };

  const targetAt = x => {
    const sc = rinkToScreen(t, x, 520, false);
    return t.touchTargetRink(0, sc.x, sc.y);
  };

  // Far from center there is room for the full one-diameter visual offset.
  const far = targetAt(500);
  assert.ok(Math.abs(far.x - 592) < 1e-6, 'open-space touch should keep the full offset');

  // Inside the taper zone, moving the finger toward center must still move the
  // mallet toward center. A fixed offset would clamp both targets to the same X.
  const nearA = targetAt(650);
  const nearB = targetAt(670);
  assert.ok(nearB.x > nearA.x, 'mallet target must keep responding near center');
  assert.ok(nearA.x < 712 && nearB.x < 712, 'taper should avoid slamming the target into the center clamp');
  assert.ok((nearB.x - 670) < (nearA.x - 650), 'finger-to-mallet offset should shrink as boundary room disappears');
});

test('mirrored online guest gets the same no-stick taper toward center', async () => {
  const t = await loadGame();
  t.G.mode = 'online';
  t.G.onlineFlip = true;
  t.view = { w: 844, h: 390, s: 0.5, ox: 0, oy: 0, portrait: false, dpr: 1, camera: 'top', cam: null };

  const targetAt = x => {
    // Online guest rendering mirrors rink X before screenToRink flips it back.
    const sc = rinkToScreen(t, t.VW - x, 520, false);
    return t.touchTargetRink(1, sc.x, sc.y);
  };
  const a = targetAt(790);
  const b = targetAt(770);
  assert.ok(b.x < a.x, 'guest mallet target must keep moving toward center near its mirrored boundary');
  assert.ok(a.x > 728 && b.x > 728, 'guest taper should stay inside the side-1 center clamp');
});

test('preferences UI offers automatic and explicit orientation controls', async () => {
  const template = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  assert.match(template, /data-set="orientation" data-val="auto"/, 'auto button missing');
  assert.match(template, /data-set="orientation" data-val="landscape"/, 'landscape button missing');
  assert.match(template, /data-set="orientation" data-val="portrait"/, 'portrait button missing');
  const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /key === 'orientation'/, 'setSetting must re-fit the view on orientation change');
});

// The orientation setting is authoritative on every screen shape: portrait
// forces the rotated presentation anywhere, landscape keeps the rink
// unrotated anywhere. (Sam: the setting must actually work on all devices.)
const SHAPES = [
  ['desktop wide', 1280, 800],
  ['phone portrait', 390, 844],
  ['phone landscape', 844, 390],
  ['tablet portrait', 1024, 1366],
  ['square-ish', 800, 800],
];

for (const want of ['landscape', 'portrait']) {
  for (const [label, w, h] of SHAPES) {
    test(`orientation='${want}' ${want === 'portrait' ? 'rotates' : 'stays unrotated'} on ${label} ${w}x${h}`, async () => {
      const t = await loadGame();
      t.win.innerWidth = w; t.win.innerHeight = h;
      t.Settings.orientation = want;
      t.resize();
      assert.equal(t.view.portrait, want === 'portrait',
        `${label}: orientation='${want}' must give view.portrait=${want === 'portrait'}`);
    });
  }
}

test('a tall phone screen can no longer force rotation when landscape is chosen', async () => {
  const t = await loadGame();
  t.win.innerWidth = 390; t.win.innerHeight = 844;
  t.Settings.orientation = 'landscape';
  t.resize();
  assert.equal(t.view.portrait, false);
  // touch mapping still round-trips through the unrotated fit
  const v = t.view, s = Math.min(390 / t.VW, 844 / t.VH);
  t.view = { w: 390, h: 844, s, ox: (390 - t.VW * s) / 2, oy: (844 - t.VH * s) / 2, portrait: false, dpr: 1 };
  for (const [x, y] of [[100, 100], [720, 520], [1340, 710]]) {
    const sc = rinkToScreen(t, x, y, false);
    const back = t.screenToRink(sc.x, sc.y);
    assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.y - y) < 1e-6, 'unrotated round-trip');
  }
});

test('a wide desktop screen can no longer undo a forced portrait', async () => {
  const t = await loadGame();
  t.win.innerWidth = 1920; t.win.innerHeight = 1080;
  t.Settings.orientation = 'portrait';
  t.resize();
  assert.equal(t.view.portrait, true);
});


test('auto orientation follows viewport shape for top-down', async () => {
  const t = await loadGame();
  t.Settings.orientation = 'auto';
  t.win.innerWidth = 390; t.win.innerHeight = 844;
  t.resize();
  assert.equal(t.view.portrait, true, 'auto should rotate top-down on a tall phone');
  t.win.innerWidth = 1280; t.win.innerHeight = 800;
  t.resize();
  assert.equal(t.view.portrait, false, 'auto should remain landscape on a wide display');
});

test('2.5D orientation controls are only shown when they can work', async () => {
  const src = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(src, /view\.portrait = view\.camera === 'top' && wantsPortrait/,
    '2.5D should fit the physical viewport rather than pretending to rotate internally');
  const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /function canLockOrientation\(\)/);
  assert.match(ui, /orientationLockRejected/);
  assert.match(ui, /boardRow\.classList\.toggle\('hidden', !topDown && !lockable25\)/);
  assert.match(ui, /Rotate your device to change orientation in this camera view/);
});
