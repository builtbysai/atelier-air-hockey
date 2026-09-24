// Sam's house rule: no em dashes (U+2014) in anything the player can see.
// This scans every user-facing string: all code in src/*.js with comments
// stripped, plus template.html with HTML comments stripped. (The conn chip's
// "–ms" placeholder is an EN dash, deliberately left alone.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const EMDASH = '\u2014';

function stripJsComments(s) {
  // block comments first, then // line comments (careful: the file also
  // holds 'https://…' strings - eating the tail of such a line is fine
  // for em-dash detection, the goal is only to ignore comment text)
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  return s.split('\n').map((l) => {
    const t = l.trimStart();
    if (t.startsWith('//')) return '';
    const idx = l.indexOf('//');
    return idx >= 0 ? l.slice(0, idx) : l;
  }).join('\n');
}

function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

for (const f of ['src/game.js', 'src/net.js', 'src/ui.js', 'src/themes.js', 'src/scoreboards.js']) {
  test(`no em dash in ${f} (code + user-facing strings)`, async () => {
    const raw = await readFile(new URL('../' + f, import.meta.url), 'utf8');
    const code = stripJsComments(raw);
    const hits = [];
    code.split('\n').forEach((l, i) => { if (l.includes(EMDASH)) hits.push(`${i + 1}: ${l.trim().slice(0, 80)}`); });
    assert.deepEqual(hits, [], `em dash found in ${f}:\n` + hits.join('\n'));
  });
}

test('no em dash in src/template.html (markup + copy)', async () => {
  const raw = await readFile(new URL('../src/template.html', import.meta.url), 'utf8');
  const markup = stripHtmlComments(raw);
  const hits = [];
  markup.split('\n').forEach((l, i) => { if (l.includes(EMDASH)) hits.push(`${i + 1}: ${l.trim().slice(0, 80)}`); });
  assert.deepEqual(hits, [], 'em dash found in template.html:\n' + hits.join('\n'));
});
