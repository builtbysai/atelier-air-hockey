// Room QR: the host lobby QR must encode the exact join URL and genuinely
// scan. This renders the QR the same way Net.paintQr does (vendored
// qrcode-generator, EC level M) and decodes the pixels with jsQR
// (tests/vendor, MIT) - a real decode, not a structural guess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function loadJsQr() {
  // jsqr ships a UMD bundle that trips node's ESM/CJS interop; run it in a
  // tiny sandbox with module/exports provided instead.
  return readFile(new URL('./vendor/jsqr.js', import.meta.url), 'utf8').then((src) => {
    const mod = { exports: {} };
    vm.runInNewContext(src, { module: mod, exports: mod.exports }, { filename: 'jsqr.js' });
    return mod.exports;
  });
}

function loadQrEncoder() {
  const ctx = vm.createContext({});
  return readFile(new URL('../src/vendor/qrcode.js', import.meta.url), 'utf8')
    .then((src) => { vm.runInContext(src, ctx, { filename: 'qrcode.js' }); return ctx.qrcode; });
}

// Net.inviteUrl, extracted from src/net.js and run standalone: it only needs
// `location`, so a tiny stub is enough. (The full lobby DOM is covered by QA.)
async function inviteUrl(code) {
  const src = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const m = src.match(/Net\.inviteUrl = function \(code\) \{[\s\S]*?\n\};/);
  assert.ok(m, 'Net.inviteUrl must exist in src/net.js');
  const ctx = vm.createContext({
    location: { href: 'https://builtbysai.com/atelier-air-hockey/' },
    URL,
  });
  vm.runInContext('var Net = {};\n' + m[0], ctx, { filename: 'net-inviteUrl.js' });
  return vm.runInContext('Net.inviteUrl', ctx)(code);
}

function qrPixels(qrcode, text, scale = 6, quiet = 4) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.isDark(my, mx);
      const v = dark ? 0 : 255, o = (y * size + x) * 4;
      data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
    }
  }
  return { data, size, modules: n };
}

test('inviteUrl builds the canonical join URL', async () => {
  const url = await inviteUrl('ABC123');
  assert.equal(url, 'https://builtbysai.com/atelier-air-hockey/?join=ABC123');
});

test('lobby QR decodes to the exact join URL', async () => {
  const qrcode = await loadQrEncoder();
  const jsQR = await loadJsQr();
  const expected = await inviteUrl('KX7Q2D');
  const { data, size, modules } = qrPixels(qrcode, expected);
  assert.ok(modules <= 41, `QR should stay small enough to scan (got ${modules}x${modules})`);
  const found = jsQR(data, size, size);
  assert.ok(found, 'jsQR could not decode the rendered QR');
  assert.equal(found.data, expected, 'decoded payload must equal the join URL');
});

test('QR payload survives the 6-character code alphabet', async () => {
  const qrcode = await loadQrEncoder();
  const jsQR = await loadJsQr();
  for (const code of ['AAAAAA', 'ZZ9999', '2B8X4Q']) {
    const expected = await inviteUrl(code);
    const { data, size } = qrPixels(qrcode, expected);
    const found = jsQR(data, size, size);
    assert.ok(found && found.data === expected, `QR for ${code} must decode to its join URL`);
  }
});
