/* ============================================================
   Atelier sharing + highlight export
   - themed result-card PNG sharing
   - match-moment UI
   - replay-to-GIF capture with a small built-in GIF89a encoder
   No third-party runtime dependency is required.
   ============================================================ */

function shareDataUrlBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = (parts[0].match(/data:([^;]+)/) || [,'application/octet-stream'])[1];
  const raw = atob(parts[1]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function shareDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function shareUrl() {
  return location.origin + location.pathname + '?table=' + encodeURIComponent(G.themeId);
}
function resultShareText() {
  return 'Atelier Air Hockey · ' + THEME.name + ' · ' + G.score[0] + '–' + G.score[1];
}

const ShareSys = {
  cardCanvas() {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--pagebg').trim() || '#070606';
    const panel = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#15110d';
    const ink = THEME.ink || '#e9d9a6';
    const gold = THEME.gold || '#d8a93f';
    const sub = getComputedStyle(document.documentElement).getPropertyValue('--sub').trim() || '#9a8a68';
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);

    // Quiet room-native frame.
    x.strokeStyle = gold; x.globalAlpha = 0.72; x.lineWidth = 2;
    x.strokeRect(34, 34, c.width - 68, c.height - 68);
    x.globalAlpha = 1;
    x.strokeStyle = 'rgba(255,255,255,0.08)';
    x.strokeRect(46, 46, c.width - 92, c.height - 92);

    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = sub;
    x.font = '600 22px ' + THEME.font.body;
    x.fillText('ATELIER AIR HOCKEY', 600, 88);

    x.fillStyle = ink;
    x.font = '800 52px ' + THEME.font.display;
    x.fillText(THEME.name, 600, 150);

    x.font = '800 146px ' + THEME.font.display;
    x.fillText(G.score[0] + ' : ' + G.score[1], 600, 286);

    const winner = $('winTitle') ? $('winTitle').textContent : 'Full time';
    x.fillStyle = gold;
    x.font = '700 30px ' + THEME.font.display;
    x.fillText(winner.toUpperCase(), 600, 390);

    const st = G.stats || freshStats();
    const kmh = Math.round(st.topSpeed * (2.4384 / PW) * 3.6);
    const secs = Math.max(1, Math.round((performance.now() - st.t0) / 1000));
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    const labels = [
      ['TOP SPEED', kmh + ' KM/H'],
      ['LONGEST RALLY', (st.bestRally || 0) + ' HITS'],
      ['SAVES', (st.saves || [0,0])[0] + '–' + (st.saves || [0,0])[1]],
      ['MATCH TIME', mm + ':' + ss],
    ];
    const startX = 214, gap = 258;
    for (let i = 0; i < labels.length; i++) {
      const px = startX + gap * i;
      x.fillStyle = sub; x.font = '600 15px ' + THEME.font.body;
      x.fillText(labels[i][0], px, 478);
      x.fillStyle = ink; x.font = '800 27px ' + THEME.font.display;
      x.fillText(labels[i][1], px, 514);
    }

    x.fillStyle = panel; x.globalAlpha = 0.8;
    x.fillRect(360, 560, 480, 1); x.globalAlpha = 1;
    x.fillStyle = sub; x.font = '500 16px ' + THEME.font.body;
    x.fillText('builtbysai.com/atelier-air-hockey', 600, 590);
    return c;
  },
  async shareResult() {
    const btn = $('btnShareResult');
    const old = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Preparing…';
    try {
      const c = this.cardCanvas();
      const blob = shareDataUrlBlob(c.toDataURL('image/png'));
      const file = new File([blob], 'atelier-air-hockey-result.png', { type:'image/png' });
      const text = resultShareText(), url = shareUrl();

      if (navigator.share && navigator.canShare && navigator.canShare({ files:[file] })) {
        await navigator.share({ files:[file], title:'Atelier Air Hockey', text, url });
      } else if (navigator.share) {
        await navigator.share({ title:'Atelier Air Hockey', text, url });
      } else {
        shareDownload(blob, file.name);
        if (navigator.clipboard) navigator.clipboard.writeText(text + ' · ' + url).catch(() => {});
        if (btn) btn.textContent = 'Saved image';
        setTimeout(() => { if (btn) btn.textContent = old || 'Share result'; }, 1400);
        return;
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') console.warn('Result share failed', e);
    }
    if (btn) btn.textContent = old || 'Share result';
  }
};

function renderWinHighlights() {
  const section = $('winHighlights'), list = $('winHighlightList');
  if (!section || !list) return;
  const moments = Highlights.moments();
  list.innerHTML = '';
  section.classList.toggle('hidden', !moments.length);
  for (const item of moments) {
    const row = document.createElement('div');
    row.className = 'win-highlight';
    const copy = document.createElement('div');
    copy.className = 'win-highlight-copy';
    const title = document.createElement('strong'); title.textContent = item.title;
    const detail = document.createElement('span'); detail.textContent = item.detail;
    copy.append(title, detail);

    const actions = document.createElement('div');
    actions.className = 'win-highlight-actions';
    const watch = document.createElement('button');
    watch.type = 'button'; watch.textContent = 'Watch';
    watch.dataset.highlightPlay = item.goal.id;
    const gif = document.createElement('button');
    gif.type = 'button'; gif.textContent = 'GIF';
    gif.dataset.highlightGif = item.goal.id;
    actions.append(watch, gif);
    row.append(copy, actions);
    list.appendChild(row);
  }
}

// ---- compact GIF89a encoder + adaptive global palette ---------------------
// GIF still caps every animation at 256 colors, but a fixed RGB332 palette
// throws away exactly the muted darks, warm golds, and table accents Atelier
// uses most. Live export stores frames as RGB555 (2 bytes/pixel), builds one
// palette from the whole clip with weighted median cut, then indexes each
// frame against that shared palette. A shared palette avoids frame-to-frame
// shimmer while staying much lighter than retaining 4-byte RGBA frames.
function gifPushU16(out, n) { out.push(n & 255, (n >> 8) & 255); }
function gifPalette332() {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const r = (i >> 5) & 7, g = (i >> 2) & 7, b = i & 3;
    p[i*3] = Math.round(r * 255 / 7);
    p[i*3+1] = Math.round(g * 255 / 7);
    p[i*3+2] = Math.round(b * 255 / 3);
  }
  return p;
}
function gifIndex332(rgba) {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    out[i] = (rgba[j] & 0xe0) | ((rgba[j+1] >> 3) & 0x1c) | (rgba[j+2] >> 6);
  return out;
}
function gifPack555(rgba) {
  const n = rgba.length >> 2;
  const out = new Uint16Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4)
    out[i] = ((rgba[j] >> 3) << 10) | ((rgba[j+1] >> 3) << 5) | (rgba[j+2] >> 3);
  return out;
}
function gifHistogram555(frames) {
  const counts = new Uint32Array(32768);
  for (const frame of frames) for (let i = 0; i < frame.length; i++) counts[frame[i]]++;
  return counts;
}
function gifAdaptivePalette555(counts) {
  const colors = [];
  for (let key = 0; key < counts.length; key++) {
    const count = counts[key];
    if (!count) continue;
    colors.push({
      key, count,
      r:(key >> 10) & 31,
      g:(key >> 5) & 31,
      b:key & 31,
    });
  }

  const palette = new Uint8Array(256 * 3);
  const lookup = new Uint8Array(32768);
  if (!colors.length) return { palette, lookup, size:1 };

  const makeBox = list => {
    let r0=31, r1=0, g0=31, g1=0, b0=31, b1=0, weight=0;
    for (const c of list) {
      if (c.r < r0) r0=c.r; if (c.r > r1) r1=c.r;
      if (c.g < g0) g0=c.g; if (c.g > g1) g1=c.g;
      if (c.b < b0) b0=c.b; if (c.b > b1) b1=c.b;
      weight += c.count;
    }
    const rr=r1-r0, gr=g1-g0, br=b1-b0;
    return { colors:list, weight, r0,r1,g0,g1,b0,b1, range:Math.max(rr,gr,br), rr,gr,br };
  };
  const boxes = [makeBox(colors)];

  while (boxes.length < 256) {
    let bi=-1, best=-1;
    for (let i=0;i<boxes.length;i++) {
      const b=boxes[i];
      if (b.colors.length < 2 || b.range <= 0) continue;
      const score=b.range * Math.sqrt(b.weight);
      if (score > best) { best=score; bi=i; }
    }
    if (bi < 0) break;
    const box=boxes.splice(bi,1)[0];
    const channel = box.gr >= box.rr && box.gr >= box.br ? 'g' : box.rr >= box.br ? 'r' : 'b';
    box.colors.sort((a,b) => a[channel]-b[channel]);
    const half=box.weight/2;
    let acc=0, cut=1;
    for (let i=0;i<box.colors.length-1;i++) {
      acc += box.colors[i].count;
      if (acc >= half) { cut=i+1; break; }
    }
    boxes.push(makeBox(box.colors.slice(0,cut)), makeBox(box.colors.slice(cut)));
  }

  for (let pi=0; pi<boxes.length; pi++) {
    const box=boxes[pi];
    let sr=0,sg=0,sb=0,sw=0;
    for (const c of box.colors) {
      sr += c.r*c.count; sg += c.g*c.count; sb += c.b*c.count; sw += c.count;
      lookup[c.key]=pi;
    }
    const scale=255/31;
    palette[pi*3]=Math.round((sr/sw)*scale);
    palette[pi*3+1]=Math.round((sg/sw)*scale);
    palette[pi*3+2]=Math.round((sb/sw)*scale);
  }
  // The GIF header advertises a 256-entry table. Fill unused entries with the
  // final real color instead of introducing unrelated black palette noise.
  const last=Math.max(0,boxes.length-1);
  for (let pi=boxes.length;pi<256;pi++) {
    palette[pi*3]=palette[last*3];
    palette[pi*3+1]=palette[last*3+1];
    palette[pi*3+2]=palette[last*3+2];
  }
  return { palette, lookup, size:boxes.length };
}
function gifBuildAdaptivePalette555(frames) {
  return gifAdaptivePalette555(gifHistogram555(frames));
}
function gifIndexPacked555(packed, lookup) {
  const out=new Uint8Array(packed.length);
  for (let i=0;i<packed.length;i++) out[i]=lookup[packed[i]];
  return out;
}
function gifLzw(indices) {
  const clear = 256, end = 257;
  let codeSize = 9, nextCode = 258;
  let dict = new Map();
  const bytes = [];
  let bitBuf = 0, bitCount = 0;
  const emit = code => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuf & 255);
      bitBuf >>>= 8; bitCount -= 8;
    }
  };
  const reset = () => { dict = new Map(); codeSize = 9; nextCode = 258; };
  emit(clear);
  if (!indices.length) { emit(end); return bytes; }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (nextCode < 4096) {
      dict.set(key, nextCode++);
      if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear); reset();
    }
    prefix = k;
  }
  emit(prefix); emit(end);
  if (bitCount > 0) bytes.push(bitBuf & 255);
  return bytes;
}
function gifStartPalette(width, height, palette) {
  const out = [];
  const ascii = str => { for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i)); };
  ascii('GIF89a');
  gifPushU16(out, width); gifPushU16(out, height);
  out.push(0xf7, 0, 0);
  out.push(...palette);
  out.push(0x21,0xff,0x0b); ascii('NETSCAPE2.0');
  out.push(0x03,0x01,0x00,0x00,0x00);
  return out;
}
function gifStart332(width, height) { return gifStartPalette(width, height, gifPalette332()); }
function gifAppendIndexedFrame(out, indexed, width, height, delayMs) {
  const delay = Math.max(2, Math.round(delayMs / 10));
  out.push(0x21,0xf9,0x04,0x00,delay & 255,(delay >> 8) & 255,0x00,0x00);
  out.push(0x2c,0,0,0,0); gifPushU16(out,width); gifPushU16(out,height); out.push(0x00);
  const compressed = gifLzw(indexed);
  out.push(0x08);
  for (let i = 0; i < compressed.length; i += 255) {
    const n = Math.min(255, compressed.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(compressed[i+j]);
  }
  out.push(0x00);
}
function gifBlob(out) {
  out.push(0x3b);
  return new Blob([new Uint8Array(out)], { type:'image/gif' });
}
function encodeGifIndexed(frames, width, height, delayMs) {
  const out = gifStart332(width, height);
  for (const indexed of frames) gifAppendIndexedFrame(out, indexed, width, height, delayMs);
  return gifBlob(out);
}
// Public test/backward-compatibility seam for the original fixed-palette path.
function encodeGif332(frames, width, height, delayMs) {
  return encodeGifIndexed(frames.map(gifIndex332), width, height, delayMs);
}
function gifYield() { return new Promise(resolve => setTimeout(resolve, 0)); }
async function encodeGifPackedAdaptiveAsync(frames, width, height, delayMs, onProgress) {
  const counts=new Uint32Array(32768);
  for (let fi=0;fi<frames.length;fi++) {
    const frame=frames[fi];
    for (let i=0;i<frame.length;i++) counts[frame[i]]++;
    if (onProgress) onProgress('palette',fi+1,frames.length);
    if ((fi & 1)===1) await gifYield();
  }
  const adaptive=gifAdaptivePalette555(counts);
  await gifYield();
  const out=gifStartPalette(width,height,adaptive.palette);
  for (let i=0;i<frames.length;i++) {
    const indexed=gifIndexPacked555(frames[i],adaptive.lookup);
    gifAppendIndexedFrame(out,indexed,width,height,delayMs);
    if (onProgress) onProgress('encode',i+1,frames.length);
    if ((i & 1)===1) await gifYield();
  }
  return gifBlob(out);
}

const GifExport = {
  active:false, frames:[], nextCapture:0, width:0, height:0,
  canvas:null, ctx:null, blob:null, url:null, highlightId:null, job:0,
  start(id) {
    const goal = Highlights.get(id);
    if (!goal || this.active) return false;
    this.job++;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.blob = null;
    const aspect = Math.max(0.35, Math.min(2.2, (view.w || 16) / (view.h || 9)));
    const longSide = 640;
    if (aspect >= 1) { this.width = longSide; this.height = Math.max(280, Math.round(longSide / aspect)); }
    else { this.height = longSide; this.width = Math.max(280, Math.round(longSide * aspect)); }
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width; this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently:true });
    this.frames = []; this.nextCapture = 0; this.highlightId = goal.id; this.active = true;
    document.body.classList.add('gif-capture');
    if (!Replay.startClip(goal.clip, goal.scorer, 'win')) { this.cancel(); return false; }
    const word = document.querySelector('#replayHud .replay-word');
    if (word) word.textContent = 'CAPTURING GIF';
    return true;
  },
  capture(t) {
    if (!this.active || G.state !== 'replay' || !this.ctx) return;
    if (t < this.nextCapture) return;
    this.nextCapture = t + 80; // 12.5 fps keeps fast puck motion readable without runaway payloads.
    const x = this.ctx, w = this.width, h = this.height;
    x.drawImage(canvas, 0, 0, w, h);
    // Keep the captured table faithful to live play. The old full-frame dark
    // wash made exports visibly muddier than the game; only a small replay
    // marker and hairline frame are burned into the shared asset.
    x.strokeStyle = THEME.gold || '#d8a93f'; x.globalAlpha = 0.42; x.lineWidth = 1;
    x.strokeRect(4.5,4.5,w-9,h-9); x.globalAlpha = 1;
    x.fillStyle = 'rgba(10,8,7,0.72)'; x.fillRect(10,10,82,24);
    x.fillStyle = THEME.gold || '#d8a93f'; x.font = '700 11px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('REPLAY',51,22);
    // RGB555 keeps twice the source color precision of the old indexed
    // capture while using half the memory of retained RGBA frames.
    this.frames.push(gifPack555(x.getImageData(0,0,w,h).data));
  },
  finish() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('gif-capture');
    const word = document.querySelector('#replayHud .replay-word');
    if (word) word.textContent = 'REPLAY';
    const frames = this.frames.slice(), w=this.width, h=this.height;
    this.frames.length = 0;
    const job = ++this.job;
    hideAll(); $('gifov').classList.remove('hidden');
    $('gifStatus').textContent = frames.length ? 'Encoding 0 / ' + frames.length + ' frames…' : 'No replay frames captured.';
    $('gifPreviewWrap').classList.add('hidden');
    $('btnGifShare').disabled = true; $('btnGifDownload').disabled = true;
    if (!frames.length) return;
    this.encode(frames, w, h, job);
  },
  async encode(frames, w, h, job) {
    try {
      const blob = await encodeGifPackedAdaptiveAsync(frames, w, h, 80, (phase, done, total) => {
        if (job !== this.job) return;
        $('gifStatus').textContent = phase === 'palette'
          ? 'Building color palette ' + done + ' / ' + total + '…'
          : 'Encoding ' + done + ' / ' + total + ' frames…';
      });
      if (job !== this.job) return;
      if (this.url) URL.revokeObjectURL(this.url);
      this.blob = blob;
      this.url = URL.createObjectURL(blob);
      const preview = $('gifPreview');
      preview.src = this.url;
      // Do not claim success until the browser itself can decode the file.
      if (typeof preview.decode === 'function') await preview.decode();
      if (job !== this.job) return;
      $('gifPreviewWrap').classList.remove('hidden');
      const kb = Math.max(1, Math.round(blob.size / 1024));
      $('gifStatus').textContent = 'Ready · ' + w + '×' + h + ' · ' + frames.length + ' frames · ' + kb + ' KB';
      $('btnGifShare').disabled = false; $('btnGifDownload').disabled = false;
    } catch (e) {
      if (job !== this.job) return;
      console.warn('GIF export failed', e);
      this.blob = null;
      $('gifStatus').textContent = 'Could not build this GIF. Try another highlight.';
    }
  },
  cancel() {
    this.job++; this.active=false; this.frames.length=0; document.body.classList.remove('gif-capture');
  },
  async share() {
    if (!this.blob) return;
    const file = new File([this.blob], 'atelier-air-hockey-replay.gif', { type:'image/gif' });
    try {
      // File sharing is not universal even where navigator.share exists, so
      // validate the exact file payload first and fall back to a save.
      if (navigator.share && navigator.canShare && navigator.canShare({ files:[file] }))
        await navigator.share({ files:[file], title:'Atelier Air Hockey replay', text:'Match highlight · ' + THEME.name });
      else shareDownload(this.blob, file.name);
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        console.warn('GIF share failed', e);
        shareDownload(this.blob, file.name);
      }
    }
  },
  download() { if (this.blob) shareDownload(this.blob, 'atelier-air-hockey-replay.gif'); },
  close() {
    this.job++;
    if (this.url) { URL.revokeObjectURL(this.url); this.url=null; }
    this.blob=null; hideAll(); $('winov').classList.remove('hidden');
  }
};

function wireShareUI() {
  const list = $('winHighlightList');
  if (list) list.addEventListener('click', e => {
    const play = e.target.closest('[data-highlight-play]');
    const gif = e.target.closest('[data-highlight-gif]');
    if (play) Highlights.play(play.dataset.highlightPlay, 'win');
    else if (gif) GifExport.start(gif.dataset.highlightGif);
  });
  const reel = $('btnMatchReel');
  if (reel) reel.addEventListener('click', () => Highlights.playReel('win'));
  $('btnGifShare').addEventListener('click', () => GifExport.share());
  $('btnGifDownload').addEventListener('click', () => GifExport.download());
  $('btnGifClose').addEventListener('click', () => GifExport.close());
}
