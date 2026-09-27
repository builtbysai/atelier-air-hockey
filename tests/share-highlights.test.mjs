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

test('match moments score real context instead of only fixed stat buckets', () => {
  assert.match(game, /scoreGoal\(g\)/);
  assert.match(game, /g\.winning/);
  assert.match(game, /g\.erasedDeficit/);
  assert.match(game, /g\.bankShot/);
  assert.match(game, /g\.savesBeforeGoal/);
  assert.match(game, /g\.rally/);
  assert.match(game, /g\.speedKmh/);
  assert.match(game, /Winning goal/);
  assert.match(game, /Comeback equalizer/);
  assert.match(game, /Bank shot/);
  assert.match(game, /Save and score/);
  assert.match(game, /Long rally finish/);
  assert.match(game, /Rocket goal/);
});

test('highlight UI supports individual replay, GIF export, and a queued match reel', () => {
  assert.match(template, /id="winHighlights"/);
  assert.match(template, /id="winHighlightList"/);
  assert.match(template, /id="btnMatchReel"[^>]*>Watch match reel<\/button>/);
  assert.match(template, /id="replayContext"/);
  assert.match(share, /dataset\.highlightPlay/);
  assert.match(share, /dataset\.highlightGif/);
  assert.match(share, /Highlights\.play/);
  assert.match(share, /Highlights\.playReel\('win'\)/);
  assert.match(share, /GifExport\.start/);
  assert.match(game, /startReel\(items, returnMode = 'win'\)/);
  assert.match(game, /MOMENT ' \+ \(this\.reelIndex \+ 1\) \+ '\/'/);
});


test('highlight telemetry understands saves, near misses, posts, and bank shots', () => {
  assert.match(game, /Highlights\.noteTouch\(m\.side\)/);
  assert.match(game, /Highlights\.noteSave\(m\.side\)/);
  assert.match(game, /Highlights\.noteRail\(x, y, isPost\)/);
  assert.match(game, /Highlights\.noteNearMiss\(nearL \? 0 : 1\)/);
  assert.match(game, /point\.bankBy === scorer && point\.bankSerial === this\.touchSerial/);
});

test('Match Reel advances through clips and Escape can exit the whole reel', () => {
  assert.match(game, /ret === 'reel' && !forceExit/);
  assert.match(game, /this\.reelIndex\+\+/);
  assert.match(game, /const finalReturn = ret === 'reel' \? this\.reelReturn : ret/);
  assert.match(game, /skip\.textContent = inReel/);
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
  assert.match(share, /10 fps: enough motion, sane mobile payload/);
  assert.match(share, /this\.frames\.push\(gifIndex332/);
  assert.match(share, /encodeGifIndexedAsync/);
  assert.match(share, /preview\.decode/);
  assert.match(template, /id="gifPreview"/);
  assert.match(template, /id="btnGifShare"/);
});

test('built-in encoder emits a GIF89a stream with trailer', async () => {
  const context = vm.createContext({
    Blob, Uint8Array, Map, Math, console,
    setTimeout(){}, clearTimeout(){},
  });
  vm.runInContext(share + '\nthis.__gif = { encodeGif332, gifLzw, gifIndex332 };', context, { filename:'src/share.js' });
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

test('GIF LZW stays decodable after crossing code-width boundaries', () => {
  const context = vm.createContext({
    Blob, Uint8Array, Map, Math, console,
    setTimeout(){}, clearTimeout(){},
  });
  vm.runInContext(share + '\nthis.__gif = { gifLzw };', context, { filename:'src/share.js' });

  const decode = (bytes, minSize = 8) => {
    const clear = 1 << minSize, end = clear + 1;
    let codeSize, nextCode, table, previous, bit = 0;
    const reset = () => {
      codeSize = minSize + 1; nextCode = end + 1; previous = null;
      table = [];
      for (let i = 0; i < clear; i++) table[i] = [i];
      table.length = end + 1;
    };
    const readCode = () => {
      let value = 0;
      for (let k = 0; k < codeSize; k++, bit++) {
        const byte = bytes[bit >> 3];
        if (byte === undefined) throw new Error('unexpected end of LZW stream');
        value |= ((byte >> (bit & 7)) & 1) << k;
      }
      return value;
    };

    reset();
    const out = [];
    for (;;) {
      const code = readCode();
      if (code === clear) { reset(); continue; }
      if (code === end) break;
      let entry;
      if (code < table.length && table[code]) entry = table[code].slice();
      else if (code === nextCode && previous) entry = previous.concat(previous[0]);
      else throw new Error('invalid GIF LZW code ' + code + ' at table ' + nextCode);
      out.push(...entry);
      if (previous) {
        table[nextCode++] = previous.concat(entry[0]);
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      previous = entry;
    }
    return Uint8Array.from(out);
  };

  // Large enough to cross 9 -> 10 -> 11-bit dictionary widths. The previous
  // encoder passed tiny header tests but produced corrupt real-world GIFs.
  const pixels = new Uint8Array(64 * 64);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37 + (i >> 4)) & 255;
  const compressed = context.__gif.gifLzw(pixels);
  const decoded = decode(compressed);
  assert.deepEqual([...decoded], [...pixels]);
});

test('GIF share uses native file sharing with download fallback', () => {
  assert.match(share, /atelier-air-hockey-replay\.gif/);
  assert.match(share, /navigator\.canShare\(\{ files:\[file\] \}\)/);
  assert.match(share, /shareDownload\(this\.blob, file\.name\)/);
});
