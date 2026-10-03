import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { appCacheName } from './app-version.mjs';
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
assert.ok(index.indexOf('src/feel-events.js') < index.indexOf('src/game.js'), 'Feel classifier must load before game runtime');
const sw = await readFile('sw.js', 'utf8');
assert.match(sw, new RegExp("^const CACHE = '" + await appCacheName() + "';"),
  'sw.js cache identity must match the built app');
for (const f of ['styles.css','themes.js','scoreboards.js','net.js','feel-events.js','game.js','ui.js']) assert.match(index, new RegExp('src/' + f.replace('.', '\\.')));
assert.doesNotMatch(index, /src\/app\.js/); assert.doesNotMatch(index, /<style>/); assert.doesNotMatch(index, /<script>\s/);
assert.match(net, /\.onMessage\s*=/); assert.match(net, /\{ target: Net\.peerId \}/); assert.match(net, /onPeerJoin\s*=/);
assert.doesNotMatch(net, /const \[sendSt/); assert.doesNotMatch(net, /createStubPair|netstub/);
assert.match(net, /disconnectTimer/); assert.match(net, /validGoalEvent/); assert.match(net, /opToken/); assert.match(net, /handshakePeerId/);
assert.match(game, /bestStreak: \[0, 0\]/); assert.match(game, /function togglePause/);
assert.match(game, /function loadSavedObject\(key\)/);
assert.match(game, /querySelectorAll\('\.overlay:not\(\[data-persistent-overlay\]\)'\)/,
  'hideAll must structurally dismiss non-persistent overlays');
assert.match(game, /querySelectorAll\('\[data-game-chrome\]'\)/,
  'hideAll must structurally dismiss gameplay chrome');
assert.doesNotMatch(template, /id="controls"/, 'controls must stay inside the single Preferences dialog');
assert.match(template, /data-pref-tab="controls"/, 'Preferences must expose the Controls tab');
assert.match(template, /id="focusov" data-persistent-overlay/, 'focus-loss veil must survive normal overlay cleanup');
assert.match(template, /data-set="touchOffset" data-val="medium"/,
  'direct touch offset must remain configurable');
assert.match(game, /touchOffset: 'medium'/, 'Medium must remain the direct-touch offset default');
assert.match(game, /low:\s+\{ finger:50, mallet:1\.7 \}/);
assert.match(game, /medium: \{ finger:72, mallet:2\.5 \}/);
assert.match(game, /high:\s+\{ finger:94, mallet:3\.3 \}/);
assert.match(game, /roomRatio \/ 2/,
  'touch offset must continue fading near playable boundaries');
assert.doesNotMatch(template, /touchStick|Floating stick|stickReturn/,
  'retired floating-stick UI must not return');
assert.doesNotMatch(ui, /touchStick|touchReturn|stickReturn/,
  'retired floating-stick runtime must not return');
assert.doesNotMatch(game, /stored\.touchControl|Settings\.(?:sound|music|masterMuted)\b|G\.kbDriveT|function buzz\(/,
  'v0 migrations and compatibility shims must stay removed');
assert.doesNotMatch(game, /typeof Net\.(?:playerSide|isAuthority|isPlayer)|Net\.role === 'guest' \? 1/,
  'gameplay must use the current online side and authority API directly');
assert.doesNotMatch(ui, /Settings\.(?:sound|music|masterMuted)\b|syncPreferenceState|syncMaster/,
  'Preferences must use the current slider-only audio state');
const ambience = game.slice(game.indexOf('// ---------- room ambience'), game.indexOf('// ---------- generative music'));
assert.match(ambience, /Settings\.musicVolume <= 0/, 'room ambience must follow the Music control');
assert.doesNotMatch(ambience, /connect\(this\.sfxBus\)/, 'room ambience one-shots must not leak onto the Sound bus');
assert.match(boards, /Math\.max\(11, target \+ 1\)/); assert.match(boards, /chars\.split/);
assert.match(ui, /installDialogA11y/); assert.match(ui, /dialogs\[dialogs\.length - 1\]/,
  'dialog focus management must follow the topmost visible layer');
assert.match(ui, /\[role="option"\]/); assert.match(ui, /const ownsRight = G\.mode === 'online' && onlinePlayerSide\(\) === 1/); assert.match(ui, /'progress'/);
assert.match(ui, /btnWatch/); assert.match(ui, /btnHouse/); assert.match(ui, /btnOnline/); assert.match(ui, /watchSel/); assert.match(ui, /G\.watch/); assert.match(ui, /selectWatch/);
assert.match(game, /mode === 'watch'/); assert.match(game, /G\.watch\s*=\s*\{ a:/);
assert.match(template, />1 \/ 10</); assert.match(template, /id="settingsTitle"/); assert.match(template, /id="rulesTitle"/); assert.match(template, /id="pauseTitle"/);
assert.match(themes, /THEMES\.deco/); assert.match(css, /focus-visible/);
const manifest = await readFile('manifest.webmanifest','utf8');
assert.match(manifest, /icon-192\.png/); assert.match(manifest, /icon-512\.png/); assert.match(manifest, /\"id\"\s*:\s*\"\.\/\"/);
assert.match(template, /apple-touch-icon/);
console.log('Static stabilization checks passed');
