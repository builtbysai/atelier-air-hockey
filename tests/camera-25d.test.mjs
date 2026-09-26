import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

/* 2.5D camera math: projection/inverse round-trip, viewport fit, and guest
   mirror symmetry. Runs the real game.js in a vm sandbox; only the pure
   camera functions are exercised. */
async function loadCamera() {
  const sb = await readFile(new URL('../src/scoreboards.js', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const G = { mode: 'ai', state: 'menu', demo: false, onlineFlip: false, texts: [] };
  const canvasStub = { getContext: () => ({}), addEventListener() {}, style: {}, width: 0, height: 0 };
  const context = vm.createContext({
    console, Math, JSON,
    G,
    Net: { role: 'host' },
    Settings: { firstTo: 7, camera: 'top' },
    THEME: { gold: '#c9a227', font: { body: 'sans-serif', display: 'sans-serif' }, ink: '#fff' },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    TAU: Math.PI * 2,
    document: {
      getElementById: () => canvasStub,
      createElement: () => ({ getContext: () => ({}), width: 0, height: 0, style: {} }),
      addEventListener() {}, hidden: false, title: '',
    },
    window: { addEventListener() {}, devicePixelRatio: 1, innerWidth: 1440, innerHeight: 900 },
    requestAnimationFrame() {}, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {} },
    navigator: {},
  });
  vm.runInContext(`${sb}\n${source}
this.__cam = { makeCamera, camProject, camUnproject, fitCamera,
  triAffine25, triErr25, tableEll25,
  VW, VH, CX, CY, TX0, TY0, TX1, TY1, PX, PY, PW, PH, RAIL };`,
    context, { filename: 'src/game.js' });
  return context.__cam;
}

const VIEWPORTS = [[1440, 900], [390, 844], [900, 1440], [1920, 1080]];

test('projection round-trips through the inverse (both presets, both flips)', async () => {
  const C = await loadCamera();
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const preset of ['elevated', 'surface']) {
    for (const flip of [false, true]) {
      for (const [w, h] of VIEWPORTS) {
        const cam = C.makeCamera(preset, w, h, flip);
        assert.ok(cam, `${preset} should build a camera`);
        for (let i = 0; i < 60; i++) {
          const x = C.TX0 + rnd() * (C.TX1 - C.TX0);
          const y = C.TY0 + rnd() * (C.TY1 - C.TY0);
          const z = rnd() * 130;
          const p = C.camProject(cam, x, y, z);
          assert.ok(p, 'point should project in front of the camera');
          const q = C.camUnproject(cam, p.x, p.y);
          // inverse is exact only on the table plane (z=0)
          const p0 = C.camProject(cam, x, y, 0);
          const q0 = C.camUnproject(cam, p0.x, p0.y);
          assert.ok(Math.abs(q0.x - x) < 1e-9 && Math.abs(q0.y - y) < 1e-9,
            `${preset} flip=${flip}: round-trip error too large`);
        }
      }
    }
  }
});

test('fitted footprint sits in the clear band below the HUD', async () => {
  const C = await loadCamera();
  for (const preset of ['elevated', 'surface']) {
    for (const flip of [false, true]) {
      for (const [w, h] of VIEWPORTS) {
        const cam = C.makeCamera(preset, w, h, flip);
        for (const [x, y] of [[C.TX0, C.TY0], [C.TX1, C.TY0], [C.TX0, C.TY1], [C.TX1, C.TY1]]) {
          const p = C.camProject(cam, x, y, 0);
          assert.ok(p.zc > 0, 'corner must be in front of the camera');
          // 3%/17.5% side/top and 3%/4.5% right/bottom bands are reserved for
          // the unwarped scoreboard, chips and hint bar; allow a little slack
          assert.ok(p.x > w * 0.02 && p.x < w * 0.98, `${preset} ${w}x${h} corner x=${p.x}`);
          assert.ok(p.y > h * 0.16 && p.y < h * 0.97, `${preset} ${w}x${h} corner y=${p.y}`);
        }
      }
    }
  }
});

test('near edge renders larger than the far edge (real perspective)', async () => {
  const C = await loadCamera();
  for (const preset of ['elevated', 'surface']) {
    const cam = C.makeCamera(preset, 1440, 900, false);
    const near = C.camProject(cam, C.TX0, C.CY, 0);
    const far = C.camProject(cam, C.TX1, C.CY, 0);
    assert.ok(near.zc < far.zc, 'near corner must be closer to the camera');
    assert.ok(near.s > far.s * 1.5, 'near scale must clearly exceed far scale');
    // the near edge sits lower on screen (closer to the viewer at the bottom)
    assert.ok(near.y > far.y, 'near edge should project below the far edge');
  }
});

test('guest mirror seats the camera behind the other end', async () => {
  const C = await loadCamera();
  for (const preset of ['elevated', 'surface']) {
    const w = 1440, h = 900;
    const host = C.makeCamera(preset, w, h, false);
    const guest = C.makeCamera(preset, w, h, true);
    // the same world point renders mirrored left-right between the two
    const x = C.PX + 100, y = C.CY - 60;
    const ph = C.camProject(host, x, y, 0);
    const pg = C.camProject(guest, C.VW - x, y, 0);
    assert.ok(Math.abs(ph.x - (w - pg.x)) < 1e-9, 'guest view must mirror the host view');
    assert.ok(Math.abs(ph.y - pg.y) < 1e-9, 'vertical position must match');
    // each camera looks at its own end: the viewer's goal mouth is near
    const ownNear = C.camProject(guest, C.TX1, C.CY, 0);
    const ownFar = C.camProject(guest, C.TX0, C.CY, 0);
    assert.ok(ownNear.zc < ownFar.zc, 'guest camera must sit behind the right end');
  }
});

test('makeCamera rejects unknown presets and empty viewports', async () => {
  const C = await loadCamera();
  assert.equal(C.makeCamera('top', 1440, 900, false), null);
  assert.equal(C.makeCamera('nope', 1440, 900, false), null);
  assert.equal(C.makeCamera('elevated', 0, 0, false), null);
});

test('triAffine25 maps its three source corners exactly', async () => {
  const C = await loadCamera();
  const cam = C.makeCamera('surface', 1440, 900, false);
  const sTri = [[174, 174], [300, 174], [300, 866]];
  const dTri = sTri.map(([x, y]) => { const p = C.camProject(cam, x, y, 0); return [p.x, p.y]; });
  const A = C.triAffine25(sTri, dTri);
  assert.ok(A, 'affine must exist for a non-degenerate triangle');
  for (let i = 0; i < 3; i++) {
    const px = A[0] * sTri[i][0] + A[2] * sTri[i][1] + A[4];
    const py = A[1] * sTri[i][0] + A[3] * sTri[i][1] + A[5];
    assert.ok(Math.abs(px - dTri[i][0]) < 1e-9 && Math.abs(py - dTri[i][1]) < 1e-9,
      `corner ${i} must map exactly`);
  }
  assert.equal(C.triAffine25([[0, 0], [1, 1], [2, 2]], dTri), null, 'degenerate triangle -> null');
});

test('adaptive triangle warp stays sub-pixel on both presets', async () => {
  const C = await loadCamera();
  for (const preset of ['elevated', 'surface']) {
    for (const [w, h] of VIEWPORTS) {
      const cam = C.makeCamera(preset, w, h, false);
      // replicate the warp's adaptive subdivision
      const x0 = C.TX0, x1 = C.TX1, y0 = C.TY0, y1 = C.TY1;
      const bounds = [x0], stack = [[x0, x1]];
      let guard = 0;
      while (stack.length && guard++ < 20000) {
        const [a, b] = stack.pop();
        if (b - a < 0.5 || C.triErr25(cam, a, b, y0, y1) < 0.5) bounds.push(b);
        else { const m = (a + b) / 2; stack.push([m, b]); stack.push([a, m]); }
      }
      assert.ok(guard < 20000, 'subdivision must terminate');
      assert.ok(bounds.length < 1500, `${preset} ${w}x${h}: ${bounds.length} strips is too many`);
      let worst = 0;
      const sorted = bounds.slice().sort((p, q) => p - q);
      for (let i = 0; i + 1 < sorted.length; i++)
        worst = Math.max(worst, C.triErr25(cam, sorted[i], sorted[i + 1], y0, y1));
      assert.ok(worst < 0.75, `${preset} ${w}x${h}: worst warp error ${worst.toFixed(2)}px`);
    }
  }
});

test('tableEll25 gives exact per-axis depth scales', async () => {
  const C = await loadCamera();
  for (const preset of ['elevated', 'surface']) {
    const cam = C.makeCamera(preset, 1440, 900, false);
    for (const [x, y] of [[C.PX + 50, C.CY], [C.CX, C.CY], [C.PX + C.PW - 50, C.CY]]) {
      const e = C.tableEll25(cam, x, y, 0, 30);
      assert.ok(e && e.rx > 0 && e.ry > 0, 'ellipse must be positive');
      // table-y maps unforeshortened to screen-x; table-x is the depth axis
      const py = C.camProject(cam, x, y + 30, 0), p0 = C.camProject(cam, x, y, 0);
      assert.ok(Math.abs(e.rx - Math.abs(py.x - p0.x)) < 1e-9, 'rx must match the y-axis scale');
      assert.ok(e.ry < e.rx, `${preset}: depth axis must foreshorten (ry < rx)`);
    }
  }
});
