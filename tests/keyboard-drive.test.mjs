// Keyboard/gamepad drive in 1p mode: playStep must not wipe a freshly-driven
// mallet target. Regression test for the bug where the "pin target when no
// pointer is down" branch in playStep reset m1.tx/m1.ty every substep, making
// keyboard (and gamepad) input do nothing in AI matches unless a pointer was
// also touching the screen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadWorld() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const audioStub = new Proxy({}, { get: () => () => {} });
  const elStub = () => ({ getContext: () => ({}), addEventListener() {}, style: {}, classList: { add() {}, remove() {} }, width: 0, height: 0 });
  const context = vm.createContext({
    console, Math, JSON,
    Net: { role: 'host' },
    Settings: { firstTo: 7, camera: 'top', orientation: 'landscape' },
    THEME: { gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff', scoreboard: 'solari', board: {} },
    THEMES: {}, PACES: { classic: {} }, DIFFS: [{ name: 'Rookie' }, { name: 'Club Pro' }, { name: 'Champion' }],
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    TAU: Math.PI * 2,
    AudioSys: audioStub, MusicSys: audioStub,
    document: {
      getElementById: elStub,
      createElement: elStub,
      addEventListener() {}, hidden: false, title: '',
      querySelectorAll: () => [],
    },
    window: { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1440, innerHeight: 900 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    requestAnimationFrame() {}, cancelAnimationFrame() {},
    setTimeout() {}, clearTimeout() {},
    performance: { now: () => 10000 },
  });
  // NOTE: game.js declares its own const G; the harness G below would be
  // shadowed, so the tests drive the REAL internal G exposed here.
  vm.runInContext(`${sb}\n${source}\nthis.__t = { playStep, mkBrain, G, get pointers() { return pointers; } };`,
    context, { filename: 'src/game.js' });
  const t = context.__t;
  // minimal 1p play world (mirrors what startGame builds, without DOM)
  t.G.mode = 'ai'; t.G.state = 'play'; t.G.demo = false;
  t.G.m1 = { side: 0, x: 370, y: 520, tx: 370, ty: 520, vx: 0, vy: 0, trail: [], r: 46 };
  t.G.m2 = { side: 1, x: 1070, y: 520, tx: 1070, ty: 520, vx: 0, vy: 0, trail: [], r: 46 };
  t.G.puck = { x: 720, y: 520, vx: 0, vy: 0, r: 26, trail: [] };
  t.G.ai2 = t.mkBrain(1, 1);
  return t;
}

test('playStep preserves a keyboard-driven target (fresh kbDriveT)', async () => {
  const t = await loadWorld();
  // simulate what keyboardGamepadDrive does when KeyD is held: push the
  // target away from the mallet and stamp the drive time
  t.G.m1.tx = 500; t.G.m1.ty = 480;
  t.G.kbDriveT = 10000; // == performance.now() in this sandbox
  t.playStep(1 / 60);
  assert.equal(t.G.state, 'play', 'world should still be in play');
  // the pin branch must NOT have fired: the driven target survives…
  assert.ok(Math.abs(t.G.m1.tx - 500) < 1e-9 && Math.abs(t.G.m1.ty - 480) < 1e-9,
    `keyboard target must survive playStep (tx=${t.G.m1.tx}, ty=${t.G.m1.ty})`);
  // …and the mallet actually moves toward it
  assert.ok(t.G.m1.x > 370, `mallet should advance toward the driven target (x=${t.G.m1.x})`);
});

test('playStep still pins the target when no input is active (stale kbDriveT)', async () => {
  const t = await loadWorld();
  // stale drive timestamp, no pointers: the anti-drift pin must run
  t.G.m1.tx = 500; t.G.m1.ty = 480;
  t.G.kbDriveT = 0;
  assert.equal(t.pointers.size, 0, 'no pointers down in this test');
  t.playStep(1 / 60);
  assert.ok(Math.abs(t.G.m1.tx - t.G.m1.x) < 1e-9 && Math.abs(t.G.m1.ty - t.G.m1.y) < 1e-9,
    `idle target must be pinned to the mallet (tx=${t.G.m1.tx}, ty=${t.G.m1.ty})`);
});

test('ui.js stamps kbDriveT when keyboard/gamepad drives', async () => {
  const ui = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /G\.kbDriveT = now/, 'keyboard/gamepad drive must stamp G.kbDriveT');
  const game = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  assert.match(game, /kbFresh/, 'playStep must consult the keyboard-drive freshness before pinning');
});
