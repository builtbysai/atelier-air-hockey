import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [game, share, template, css] = await Promise.all([
  readFile(new URL('../src/game.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/share.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('local goals retain reusable highlight clips independently from replay prompt setting', () => {
  assert.match(game, /record\(dt\) \{[\s\S]*?G\.mode === 'online'/);
  const record = game.slice(game.indexOf('record(dt)'), game.indexOf('capture(scorer)'));
  assert.doesNotMatch(record, /Settings\.instantReplay/);
  assert.match(game, /const goalClip = Replay\.capture\(scorer\);\s*Highlights\.recordGoal\(scorer, goalClip\)/);
});

test('match moments select winning, fastest, and longest-rally goals with deduplication', () => {
  assert.match(game, /kind:'winning', title:'Winning goal'/);
  assert.match(game, /kind:'speed', title:'Fastest goal'/);
  assert.match(game, /kind:'rally', title:'Longest rally'/);
  assert.match(game, /const seen = new Set\(\), out = \[\]/);
});

test('highlight UI supports replay and GIF export', () => {
  assert.match(template, /id="winHighlights"/);
  assert.match(template, /id="winHighlightList"/);
  assert.match(share, /dataset\.highlightPlay/);
  assert.match(share, /dataset\.highlightGif/);
  assert.match(share, /Highlights\.play/);
  assert.match(share, /GifExport\.start/);
});

test('replay has a distinct visual treatment without a letterbox', () => {
  assert.match(game, /document\.body\.classList\.add\('replay-mode'\)/);
  assert.match(game, /document\.body\.classList\.remove\('replay-mode'\)/);
  assert.match(css, /body\.replay-mode #game/);
  assert.match(css, /saturate\(\.72\)/);
  assert.doesNotMatch(css, /body\.replay-mode[^}]*background:\s*black/);
});

test('result sharing creates a themed PNG and uses file sharing when available', () => {
  assert.match(share, /c\.width = 1200; c\.height = 630/);
  assert.match(share, /atelier-air-hockey-result\.png/);
  assert.match(share, /navigator\.canShare\(\{ files:\[file\] \}\)/);
  assert.match(share, /navigator\.share\(\{ files:\[file\]/);
  assert.match(share, /shareDownload\(blob, file\.name\)/);
});

test('GIF export captures real replay frames and burns in a replay marker', () => {
  assert.match(game, /GifExport\.active\) GifExport\.capture\(t\)/);
  assert.match(share, /x\.drawImage\(canvas, 0, 0, w, h\)/);
  assert.match(share, /x\.fillText\('REPLAY',51,22\)/);
  assert.match(share, /10 fps keeps mobile export light/);
  assert.match(template, /id="gifPreview"/);
  assert.match(template, /id="btnGifShare"/);
});

test('built-in encoder emits a GIF89a stream with trailer', async () => {
  const context = vm.createContext({
    Blob, Uint8Array, Map, Math, console,
    setTimeout(){}, clearTimeout(){},
  });
  vm.runInContext(share + '\nthis.__gif = { encodeGif332 };', context, { filename:'src/share.js' });
  const f1 = new Uint8Array([
    255,0,0,255, 0,255,0,255,
    0,0,255,255, 255,255,255,255,
  ]);
  const f2 = new Uint8Array([
    0,0,0,255, 255,255,0,255,
    0,255,255,255, 255,0,255,255,
  ]);
  const blob = context.__gif.encodeGif332([f1,f2], 2, 2, 100);
  assert.equal(blob.type, 'image/gif');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0,6)), 'GIF89a');
  assert.equal(bytes[bytes.length - 1], 0x3b);
  assert.ok(bytes.length > 800, 'global palette + animated frames should be present');
});

test('GIF share uses native file sharing with download fallback', () => {
  assert.match(share, /atelier-air-hockey-replay\.gif/);
  assert.match(share, /navigator\.canShare\(\{ files:\[file\] \}\)/);
  assert.match(share, /shareDownload\(this\.blob, file\.name\)/);
});
