import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const [index, template, app, boards, themes, css] = await Promise.all([
  readFile('index.html','utf8'), readFile('src/template.html','utf8'), readFile('src/app.js','utf8'),
  readFile('src/scoreboards.js','utf8'), readFile('src/themes.js','utf8'), readFile('src/styles.css','utf8')
]);
assert.equal(index, template, 'index.html must be generated from src/template.html');
assert.match(index, /src\/styles\.css/); assert.match(index, /src\/app\.js/);
assert.doesNotMatch(index, /<style>/); assert.doesNotMatch(index, /<script>\s/);
assert.match(app, /opToken/); assert.match(app, /peerId/); assert.match(app, /bestStreak: \[0, 0\]/);
assert.match(boards, /Math\.max\(11, target \+ 1\)/);
assert.match(themes, /THEMES\.deco/); assert.match(css, /focus-visible/);
assert.doesNotMatch(app, /createStubPair/); assert.doesNotMatch(app, /netstub/);
console.log('Static stabilization checks passed');
