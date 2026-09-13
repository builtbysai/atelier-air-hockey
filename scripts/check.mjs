import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
assert.match(template, />1 \/ 9</); assert.match(template, /id="settingsTitle"/); assert.match(template, /id="pauseTitle"/);
assert.match(themes, /THEMES\.deco/); assert.match(css, /focus-visible/);
console.log('Static stabilization checks passed');
