import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// PNG structural validation: signature, IHDR dimensions, chunk bounds, terminal IEND
function checkPNG(buf, name, w, h) {
  assert.equal(buf[0], 0x89, name + ': bad PNG signature'); assert.equal(buf[1], 0x50, name + ': bad PNG signature');
  assert.equal(buf[2], 0x4E, name + ': bad PNG signature'); assert.equal(buf[3], 0x47, name + ': bad PNG signature');
  assert.equal(buf.readUInt32BE(16), w, name + ': width mismatch'); assert.equal(buf.readUInt32BE(20), h, name + ': height mismatch');
  let pos = 8, sawIEND = false;
  while (pos < buf.length) {
    assert.ok(pos + 8 <= buf.length, name + ': truncated chunk header');
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    assert.ok(pos + 12 + len <= buf.length, name + ': chunk ' + type + ' overruns file');
    if (type === 'IEND') { sawIEND = true; assert.equal(len, 0, name + ': IEND must be empty'); break; }
    pos += 12 + len;
  }
  assert.ok(sawIEND, name + ': missing terminal IEND chunk');
}
const [icon180, icon192, icon512] = await Promise.all([readFile('assets/icon-180.png'), readFile('assets/icon-192.png'), readFile('assets/icon-512.png')]);
checkPNG(icon180, 'icon-180.png', 180, 180); checkPNG(icon192, 'icon-192.png', 192, 192); checkPNG(icon512, 'icon-512.png', 512, 512);
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
assert.match(net, /disconnectTimer/); assert.match(net, /validGoalEvent/); assert.match(net, /opToken/); assert.match(net, /handshakePeerId/);
assert.match(game, /bestStreak: \[0, 0\]/); assert.match(game, /function togglePause/);
assert.match(boards, /Math\.max\(11, target \+ 1\)/); assert.match(boards, /chars\.split/);
assert.match(ui, /installDialogA11y/); assert.match(ui, /\[role="option"\]/); assert.match(ui, /guestOwnsRight/); assert.match(ui, /'progress'/);
assert.match(ui, /btnWatch/); assert.match(ui, /watchSel/); assert.match(ui, /G\.watch/); assert.match(ui, /selectWatch/);
assert.match(game, /mode === 'watch'/); assert.match(game, /G\.watch\s*=\s*\{ a:/);
assert.match(template, />1 \/ 9</); assert.match(template, /id="settingsTitle"/); assert.match(template, /id="pauseTitle"/);
assert.match(themes, /THEMES\.deco/); assert.match(css, /focus-visible/);
const manifest = await readFile('manifest.webmanifest','utf8');
assert.match(manifest, /icon-192\.png/); assert.match(manifest, /icon-512\.png/); assert.match(manifest, /\"id\"\s*:\s*\"\.\/\"/);
assert.match(template, /apple-touch-icon/);
console.log('Static stabilization checks passed');
