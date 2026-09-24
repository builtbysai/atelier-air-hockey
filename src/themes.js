/* ============================================================
   ATELIER AIR HOCKEY, theme renderers
   Each theme paints: room, rails, surface, markings, goal trim,
   scoreboard. Engine draws physics entities from theme palettes.
   Helpers below are shared; every theme function receives ctx.
   ============================================================ */

function noiseTile(base, flecks, n, alpha) {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 160, 160);
  for (let i = 0; i < (n || 900); i++) {
    g.fillStyle = flecks[(Math.random() * flecks.length) | 0];
    g.globalAlpha = Math.random() * (alpha || 0.08);
    const s = Math.random() < 0.9 ? 1 : 2;
    g.fillRect(Math.random() * 160, Math.random() * 160, s, s);
  }
  return c;
}
function tileOver(ctx, tile, x, y, w, h, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let ty = y; ty < y + h; ty += 160)
    for (let tx = x; tx < x + w; tx += 160)
      ctx.drawImage(tile, tx, ty);
  ctx.restore();
}
function woodGrain(ctx, x, y, w, h, dark, light, vertical) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let i = 0; i < 46; i++) {
    ctx.strokeStyle = Math.random() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.05 + Math.random() * 0.09;
    ctx.lineWidth = 0.6 + Math.random() * 1.8;
    ctx.beginPath();
    if (vertical) {
      const gx = x + Math.random() * w;
      ctx.moveTo(gx, y);
      ctx.bezierCurveTo(gx + rand(-14, 14), y + h * 0.33, gx + rand(-14, 14), y + h * 0.66, gx + rand(-8, 8), y + h);
    } else {
      const gy = y + Math.random() * h;
      ctx.moveTo(x, gy);
      ctx.bezierCurveTo(x + w * 0.33, gy + rand(-14, 14), x + w * 0.66, gy + rand(-14, 14), x + w, gy + rand(-8, 8));
    }
    ctx.stroke();
  }
  ctx.restore();
}
function brushedMetal(ctx, x, y, w, h, vertical) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (vertical) { const gx = x + Math.random() * w; ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    else { const gy = y + Math.random() * h; ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
  }
  ctx.restore();
}
function goldLine(ctx, x1, y1, x2, y2, w, color) {
  ctx.save();
  ctx.strokeStyle = color || '#c9a227';
  ctx.lineWidth = w || 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,240,200,0.5)';
  ctx.lineWidth = Math.max(0.6, (w || 2) * 0.3);
  ctx.beginPath(); ctx.moveTo(x1, y1 - (w || 2) * 0.18); ctx.lineTo(x2, y2 - (w || 2) * 0.18); ctx.stroke();
  ctx.restore();
}

/* ================= 1. ART-DECO NOIR ================= */
const THEME_DECO = {
  id: 'deco', name: 'Noir Deco', tagline: 'Black lacquer · brass · walnut, the speakeasy table',
  font: { display: "Georgia, 'Times New Roman', serif", body: "Georgia, 'Times New Roman', serif" },
  ink: '#e9d9a6', accent: '#d8a93f', gold: '#d8a93f', particle: '#e8c86a', trail: '#d8a93f',
  flash: 'rgba(216,169,63,1)', vignette: 'rgba(0,0,0,0.5)',
  goalChord: [523.25, 659.25, 783.99, 1046.5],
  scoreboard: 'solari',
  board: { housing: '#26262b', housingHi: '#3d3a30', flap: '#141311', ink: '#f0e6cc',
           accent: '#c9a227', plate: '#8a6d2f', plateInk: '#241a10' },
  puck: { hi: '#4a4a52', body: '#232328', edge: '#0b0b0d', ring: '#c9a227' },
  mallet: { hi: '#5a5a62', base: '#26262c', edge: '#0c0c0e', ring: '#c9a227', dish: '#17171b', dishHi: '#33333b', knob: '#a8842f', knobHi: '#e8c86a' },
  css: { pageBg: '#070606', panelBg: 'rgba(18,14,10,0.94)', panelBorder: '#8a6d2f', btnBg: '#c9a227', btnInk: '#14100a', title: '#e9d9a6', sub: '#9a8a68', ghost: 'rgba(201,162,39,0.16)' },

  drawRoom(ctx) {
    const g = ctx.createRadialGradient(VW / 2, VH / 2, 120, VW / 2, VH / 2, 760);
    g.addColorStop(0, '#171310'); g.addColorStop(0.6, '#0d0b0a'); g.addColorStop(1, '#060505');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // faint deco fan arcs in corners
    ctx.save(); ctx.strokeStyle = 'rgba(201,162,39,0.05)'; ctx.lineWidth = 1.5;
    for (const [fx, fy] of [[0, 0], [VW, 0], [0, VH], [VW, VH]]) {
      for (let r = 60; r <= 220; r += 40) { ctx.beginPath(); ctx.arc(fx, fy, r, 0, TAU); ctx.stroke(); }
    }
    ctx.restore();
  },
  drawRails(ctx) {
    // walnut body
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#5a3a24'); g.addColorStop(0.5, '#432a19'); g.addColorStop(1, '#2e1d11');
    rr(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 26); ctx.fillStyle = g; ctx.fill();
    woodGrain(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, '#1c1008', '#7a5230');
    // cut out playfield
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 8); ctx.fill();
    ctx.restore();
    // brass inner edge
    ctx.save();
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 8); ctx.clip();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 5;
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 8); ctx.stroke();
    ctx.restore();
    // outer gold pinline
    ctx.save();
    ctx.strokeStyle = 'rgba(201,162,39,0.55)'; ctx.lineWidth = 2;
    rr(ctx, TX0 + 9, TY0 + 9, PW + RAIL * 2 - 18, PH + RAIL * 2 - 18, 20); ctx.stroke();
    ctx.restore();
  },
  drawSurface(ctx) {
    const g = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    g.addColorStop(0, '#191920'); g.addColorStop(0.45, '#101014'); g.addColorStop(1, '#0a0a0d');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
    // lacquer sheen
    const s = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    s.addColorStop(0.18, 'rgba(255,255,255,0)');
    s.addColorStop(0.42, 'rgba(255,255,255,0.055)');
    s.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = s; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    goldLine(ctx, CX, PY + 14, CX, PY + PH - 14, 2.5);
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(CX, CY, 62, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(CX, CY, 52, 0, TAU); ctx.stroke();
    // face-off dots
    ctx.fillStyle = '#c9a227';
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.beginPath(); ctx.arc(fx, fy, 5, 0, TAU); ctx.fill();
      }
    // goal creases
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(PX, CY, 74, -0.72, 0.72); ctx.stroke();
    ctx.beginPath(); ctx.arc(PX + PW, CY, 74, Math.PI - 0.72, Math.PI + 0.72); ctx.stroke();
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 4;
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    ctx.beginPath(); ctx.moveTo(x, cy - w / 2); ctx.lineTo(x, cy + w / 2); ctx.stroke();
    ctx.fillStyle = '#c9a227';
    ctx.beginPath(); ctx.arc(x, cy - w / 2, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy + w / 2, 5, 0, TAU); ctx.fill();
    ctx.restore();
  },
};

/* ================= 2. MID-CENTURY ================= */
const THEME_MID = {
  id: 'mid', name: "Palm Springs '62", tagline: 'Walnut · brass · cream laminate, the Eichler game room',
  font: { display: "Georgia, 'Times New Roman', serif", body: "Georgia, serif" },
  ink: '#4a3826', accent: '#c96a2e', gold: '#b98a2f', particle: '#e0955a', trail: '#c96a2e',
  flash: 'rgba(201,106,46,1)', vignette: 'rgba(60,35,15,0.35)',
  goalChord: [392, 523.25, 659.25, 783.99],
  scoreboard: 'reels',
  board: { frame: '#f5f0e6', frameEdge: '#6b4a2e', drum: '#f7f2e7',
           drumShade: '#d9d2bd', ink: '#2b2118', jewel: '#c0392b' },
  puck: { hi: '#e06a5a', body: '#b03a2e', edge: '#7c231b', ring: '#f0e6d2' },
  mallet: { hi: '#a9764a', base: '#7a4f2c', edge: '#4a2f18', ring: '#f0e6d2', dish: '#5e3c21', dishHi: '#8a5c34', knob: '#b98a2f', knobHi: '#e8c86a' },
  css: { pageBg: '#14100b', panelBg: 'rgba(32,24,16,0.94)', panelBorder: '#b98a2f', btnBg: '#c96a2e', btnInk: '#fff8ec', title: '#f0e6d2', sub: '#b09a78', ghost: 'rgba(201,106,46,0.16)' },

  _tile: null,
  drawRoom(ctx) {
    const g = ctx.createRadialGradient(VW / 2, VH / 2, 100, VW / 2, VH / 2, 780);
    g.addColorStop(0, '#2b2119'); g.addColorStop(1, '#120e09');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // faint atomic starburst
    ctx.save(); ctx.strokeStyle = 'rgba(240,230,210,0.045)'; ctx.lineWidth = 2;
    for (const [sx, sy] of [[120, 90], [VW - 120, VH - 90]]) {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + 0.4;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * 46, sy + Math.sin(a) * 46); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx + Math.cos(a) * 54, sy + Math.sin(a) * 54, 4, 0, TAU); ctx.stroke();
      }
    }
    ctx.restore();
  },
  drawRails(ctx) {
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#7a5230'); g.addColorStop(0.5, '#5e3f24'); g.addColorStop(1, '#402a16');
    rr(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 30); ctx.fillStyle = g; ctx.fill();
    woodGrain(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, '#2c1c0e', '#96703f');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 10); ctx.fill();
    ctx.restore();
    // brass inner edge
    ctx.save();
    ctx.strokeStyle = '#c9a55a'; ctx.lineWidth = 5;
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 10); ctx.stroke();
    ctx.restore();
    // tapered leg hints at corners (mid-century splay)
    ctx.save();
    ctx.fillStyle = '#33220f';
    for (const [lx, ly, dx] of [[TX0 + 26, TY0 + PH + RAIL * 2 - 4, -1], [TX0 + PW + RAIL * 2 - 26, TY0 + PH + RAIL * 2 - 4, 1]]) {
      ctx.beginPath();
      ctx.moveTo(lx - 12, ly); ctx.lineTo(lx + 12, ly);
      ctx.lineTo(lx + 12 + dx * 26, ly + 66); ctx.lineTo(lx - 12 + dx * 26, ly + 66);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#efe4cd', ['#e0d2b4', '#fbf5e6', '#d8c8a8'], 1400, 0.1);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    const g = ctx.createLinearGradient(PX, PY, PX, PY + PH);
    g.addColorStop(0, 'rgba(255,250,235,0.25)'); g.addColorStop(0.5, 'rgba(255,250,235,0)'); g.addColorStop(1, 'rgba(120,90,50,0.14)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    ctx.strokeStyle = '#5a3a26'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(CX, PY + 14); ctx.lineTo(CX, PY + PH - 14); ctx.stroke();
    ctx.strokeStyle = '#c96a2e'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(CX, CY, 58, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#5a3a26'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(CX, CY, 46, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#c96a2e';
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.beginPath(); ctx.arc(fx, fy, 6, 0, TAU); ctx.fill();
      }
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    ctx.fillStyle = '#402a16';
    ctx.fillRect(x - 5, cy - w / 2 - 8, 10, w + 16);
    ctx.fillStyle = '#c9a55a';
    ctx.beginPath(); ctx.arc(x, cy - w / 2 - 4, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy + w / 2 + 4, 6, 0, TAU); ctx.fill();
    ctx.restore();
  },
};

/* ================= 3. BRUTALIST ================= */
const THEME_BRUT = {
  id: 'brut', name: 'Beton', tagline: 'Raw concrete · aluminum · safety orange, the bunker table',
  font: { display: "'Arial Black', 'Helvetica Neue', sans-serif", body: "'Helvetica Neue', Arial, sans-serif" },
  ink: '#f2f2f0', accent: '#ff4d00', gold: '#ff4d00', particle: '#ff7a33', trail: '#ff4d00',
  flash: 'rgba(255,77,0,1)', vignette: 'rgba(0,0,0,0.5)',
  goalChord: [220, 277.18, 329.63, 440],
  scoreboard: 'bulbs',
  board: { cab: '#232527', cabHi: '#3a3d40', bulb: '#ffcf7a',
           bulbDim: '#333638', bolt: '#101112' },
  puck: { hi: '#5a5e63', body: '#2e3134', edge: '#101112', ring: '#ff4d00' },
  mallet: { hi: '#c9ccce', base: '#8f9397', edge: '#4c4f52', ring: '#ff4d00', dish: '#6e7276', dishHi: '#a8acaf', knob: '#1c1d1f', knobHi: '#4c4f52' },
  css: { pageBg: '#0c0d0e', panelBg: 'rgba(16,17,18,0.96)', panelBorder: '#ff4d00', btnBg: '#ff4d00', btnInk: '#101112', title: '#f2f2f0', sub: '#8f9397', ghost: 'rgba(255,77,0,0.14)' },

  _roomTile: null, _surfTile: null,
  drawRoom(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#1b1d1f'); g.addColorStop(1, '#0c0d0e');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    if (!this._roomTile) this._roomTile = noiseTile('#17181a', ['#232527', '#0e0f10'], 700, 0.12);
    tileOver(ctx, this._roomTile, -200, -200, VW + 400, VH + 400, 0.5);
    // hazard tick strip top + bottom, very subtle
    ctx.save();
    ctx.fillStyle = 'rgba(255,77,0,0.16)';
    for (let x = 0; x < VW; x += 44) {
      ctx.fillRect(x, 2, 22, 5);
      ctx.fillRect(x + 22, VH - 7, 22, 5);
    }
    ctx.restore();
  },
  drawRails(ctx) {
    // raw aluminum
    const g = ctx.createLinearGradient(TX0, TY0, TX0 + PW + RAIL * 2, TY0);
    g.addColorStop(0, '#7e8286'); g.addColorStop(0.5, '#a8acaf'); g.addColorStop(1, '#6e7276');
    ctx.fillStyle = g;
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    brushedMetal(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, false);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // black rubber inner edge
    ctx.save();
    ctx.strokeStyle = '#17181a'; ctx.lineWidth = 8;
    ctx.strokeRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // bolt heads
    ctx.save();
    ctx.fillStyle = '#3c3f43';
    const bx = [TX0 + 22, TX0 + (PW + RAIL * 2) / 2, TX0 + PW + RAIL * 2 - 22];
    const by = [TY0 + 22, TY0 + PH + RAIL * 2 - 22];
    for (const x of bx) for (const y of by) {
      if (x > PX - 30 && x < PX + PW + 30 && y > PY - 30 && y < PY + PH + 30) continue;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#222426'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke();
    }
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._surfTile) this._surfTile = noiseTile('#83837e', ['#8f8f89', '#74746f', '#9a9a94'], 2200, 0.14);
    tileOver(ctx, this._surfTile, PX, PY, PW, PH, 1);
    // trowel arcs
    ctx.save();
    ctx.globalAlpha = 0.05; ctx.strokeStyle = '#5c5c58'; ctx.lineWidth = 9;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(PX + Math.random() * PW, PY + Math.random() * PH, 90 + Math.random() * 130, rand(0, TAU), rand(0, TAU) + 1.4);
      ctx.stroke();
    }
    ctx.restore();
  },
  drawMarkings(ctx) {
    ctx.save();
    ctx.strokeStyle = '#f2f2f0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(CX, PY + 12); ctx.lineTo(CX, PY + PH - 12); ctx.stroke();
    ctx.strokeStyle = '#ff4d00'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(CX, CY, 60, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#f2f2f0'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(CX, CY, 44, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#f2f2f0';
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72])
        ctx.fillRect(fx - 5, fy - 5, 10, 10);
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 6 : gx + RAIL - 6;
    ctx.fillStyle = '#ff4d00';
    ctx.fillRect(x - 4, cy - w / 2 - 10, 8, w + 20);
    ctx.fillStyle = '#101112';
    for (let y = cy - w / 2 - 6; y < cy + w / 2 + 6; y += 16) ctx.fillRect(x - 4, y, 8, 8);
    ctx.restore();
  },
};

/* ================= 4. BILLIARD HERITAGE ================= */
const THEME_BIL = {
  id: 'bil', name: 'The Billiard Room', tagline: 'Mahogany · brass · snooker green, the members\u2019 club table',
  font: { display: "Georgia, 'Times New Roman', serif", body: "Georgia, serif" },
  ink: '#ecdfc2', accent: '#c9a227', gold: '#c9a227', particle: '#e8d488', trail: '#c9a227',
  flash: 'rgba(201,162,39,1)', vignette: 'rgba(10,5,2,0.5)',
  goalChord: [329.63, 440, 523.25, 659.25],
  scoreboard: 'cribbage',
  board: { board: '#5a3a22', boardHi: '#7a5230', hole: '#160e06',
           peg: '#d8a93f', pegHi: '#f4dfa0', ring: '#c9a227' },
  puck: { hi: '#fffdf4', body: '#ece5d3', edge: '#b8ac8e', ring: '#1d5c40' },
  mallet: { hi: '#7a4a34', base: '#4a2a1e', edge: '#241209', ring: '#c9a227', dish: '#382015', dishHi: '#5c3a28', knob: '#e8dcc0', knobHi: '#fffdf4' },
  css: { pageBg: '#0d0805', panelBg: 'rgba(24,15,9,0.95)', panelBorder: '#8a6d2f', btnBg: '#c9a227', btnInk: '#1a1008', title: '#ecdfc2', sub: '#a89468', ghost: 'rgba(201,162,39,0.14)' },

  _tile: null,
  drawRoom(ctx) {
    const g = ctx.createRadialGradient(VW / 2, VH * 0.42, 120, VW / 2, VH / 2, 800);
    g.addColorStop(0, '#2a1a10'); g.addColorStop(0.65, '#180e07'); g.addColorStop(1, '#0b0603');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // wainscot rail line
    ctx.save();
    ctx.strokeStyle = 'rgba(201,162,39,0.07)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, VH * 0.72); ctx.lineTo(VW, VH * 0.72); ctx.stroke();
    ctx.restore();
  },
  drawRails(ctx) {
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#5c2f1d'); g.addColorStop(0.5, '#472415'); g.addColorStop(1, '#2e160b');
    rr(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 18); ctx.fillStyle = g; ctx.fill();
    woodGrain(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, '#1c0d05', '#7a4a2e');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 6); ctx.fill();
    ctx.restore();
    // brass corner plates
    ctx.save();
    for (const [cxp, cyp] of [[TX0 + 24, TY0 + 24], [TX0 + PW + RAIL * 2 - 24, TY0 + 24], [TX0 + 24, TY0 + PH + RAIL * 2 - 24], [TX0 + PW + RAIL * 2 - 24, TY0 + PH + RAIL * 2 - 24]]) {
      const bg = ctx.createRadialGradient(cxp - 4, cyp - 5, 2, cxp, cyp, 20);
      bg.addColorStop(0, '#e8c86a'); bg.addColorStop(1, '#8a6d2f');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cxp, cyp, 17, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(cxp, cyp, 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // leather inner cushion edge
    ctx.save();
    ctx.strokeStyle = '#1e3a2a'; ctx.lineWidth = 7;
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 6); ctx.stroke();
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#1d5c40', ['#256e4d', '#174a33', '#2c7a55'], 2600, 0.12);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    // cloth sheen + center wear
    const g = ctx.createRadialGradient(CX, CY, 60, CX, CY, 480);
    g.addColorStop(0, 'rgba(255,255,240,0.06)');
    g.addColorStop(0.7, 'rgba(255,255,240,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    // chalk lines: double-strike for texture
    ctx.save();
    ctx.lineCap = 'round';
    for (const [dy, a] of [[0, 0.85], [1.5, 0.3]]) {
      ctx.strokeStyle = 'rgba(232,224,204,' + a + ')'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(CX + dy, PY + 14); ctx.lineTo(CX + dy, PY + PH - 14); ctx.stroke();
      ctx.beginPath(); ctx.arc(CX + dy, CY, 58, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(232,224,204,0.85)';
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.beginPath(); ctx.arc(fx, fy, 5, 0, TAU); ctx.fill();
      }
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    // brass pocket plate
    const bg = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
    bg.addColorStop(0, '#8a6d2f'); bg.addColorStop(0.5, '#e8c86a'); bg.addColorStop(1, '#8a6d2f');
    ctx.fillStyle = bg;
    rr(ctx, x - 8, cy - w / 2 - 12, 16, w + 24, 6); ctx.fill();
    ctx.fillStyle = '#0a0a0a';
    rr(ctx, x - 4, cy - w / 2 - 4, 8, w + 8, 4); ctx.fill();
    ctx.restore();
  },
};

const THEMES = { deco: THEME_DECO, mid: THEME_MID, brut: THEME_BRUT, bil: THEME_BIL };

/* ============================================================
   ATELIER AIR HOCKEY, theme renderers, second set
   Memphis Milano '81 and Wabi-Sabi Sashiko, plus the shared
   screen-space room painters (pre-rendered offscreen by the
   engine on theme change / resize, one drawImage per frame).
   ============================================================ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Seigaiha (overlapping wave arcs) tile painter */
function seigaiha(g, x, y, w, h, color, r, alpha) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = color; g.globalAlpha = alpha == null ? 1 : alpha;
  g.lineWidth = 2;
  const dx = r, dy = r * 0.5;
  let row = 0;
  for (let yy = y - r; yy < y + h + r; yy += dy, row++) {
    for (let xx = x - r + (row % 2 ? dx / 2 : 0); xx < x + w + r; xx += dx) {
      for (let k = 3; k >= 1; k--) {
        g.beginPath();
        g.arc(xx, yy, (r * k) / 3, Math.PI, 0);
        g.stroke();
      }
    }
  }
  g.restore();
}

/* Bacterio squiggle, the Memphis signature stroke */
function squiggle(g, x, y, w, h, color, lw, seed) {
  const R = mulberry32(seed || 7);
  g.save();
  g.strokeStyle = color; g.lineWidth = lw || 7; g.lineCap = 'round';
  g.beginPath();
  const n = 5, dx = w / n;
  g.moveTo(x, y + h / 2);
  for (let i = 0; i < n; i++) {
    const x0 = x + i * dx, x1 = x0 + dx;
    const up = (i % 2 === 0);
    g.bezierCurveTo(x0 + dx * 0.25, y + (up ? h * 0.08 : h * 0.92),
                    x0 + dx * 0.75, y + (up ? h * 0.08 : h * 0.92),
                    x1, y + h / 2 + (R() - 0.5) * h * 0.1);
  }
  g.stroke();
  g.restore();
}

/* ---- shared screen-space room base: wall / floor / vignette ---- */
function roomBase(g, W, H, wall, floor, horizonY) {
  const hy = horizonY == null ? H * 0.62 : horizonY;
  let wg = g.createLinearGradient(0, 0, 0, hy);
  wg.addColorStop(0, wall[0]); wg.addColorStop(1, wall[1]);
  g.fillStyle = wg; g.fillRect(0, 0, W, hy);
  let fg = g.createLinearGradient(0, hy, 0, H);
  fg.addColorStop(0, floor[0]); fg.addColorStop(1, floor[1]);
  g.fillStyle = fg; g.fillRect(0, hy, W, H - hy);
  // soft horizon shadow + baked vignette
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, hy - 3, W, 6);
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.36, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return hy;
}
function roomGlow(g, x, y, r, color, alpha) {
  const R = g.createRadialGradient(x, y, 4, x, y, r);
  R.addColorStop(0, color); R.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.globalAlpha = alpha == null ? 1 : alpha;
  g.fillStyle = R; g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/* ================= 5. MEMPHIS MILANO '81 ================= */
const THEME_MEMPHIS = {
  id: 'mem', name: 'Memphis Milano', tagline: 'Laminate confetti · squiggles · the loft party, 1981',
  font: { display: "'Futura', 'Century Gothic', 'Trebuchet MS', sans-serif", body: "'Trebuchet MS', Verdana, sans-serif" },
  ink: '#171515', accent: '#D93A2B', gold: '#F5B301', particle: '#E84D8A', trail: '#1F4E9D',
  flash: 'rgba(217,58,43,1)', vignette: 'rgba(60,30,10,0.30)',
  goalChord: [440, 554.37, 659.25, 880],
  scoreboard: 'reels',
  board: { frame: '#F5B301', frameEdge: '#171515', drum: '#FBF6E9',
           drumShade: '#e2d6b8', ink: '#171515', jewel: '#E84D8A' },
  puck: { hi: '#e85446', body: '#c22e20', edge: '#6e140d', ring: '#F2EAD8' },
  mallet: { hi: '#F5B301', base: '#d89a06', edge: '#171515', ring: '#D93A2B', dish: '#b57e05', dishHi: '#ffd94d', knob: '#1F4E9D', knobHi: '#5a86d6' },
  css: { pageBg: '#171310', panelBg: 'rgba(28,21,16,0.96)', panelBorder: '#F5B301', btnBg: '#D93A2B', btnInk: '#FFF6E8', title: '#F5B301', sub: '#c99a5a', ghost: 'rgba(245,179,1,0.16)' },

  _tile: null,
  drawRoom(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#F2EAD8'); g.addColorStop(1, '#E0D0AC');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    ctx.save(); ctx.globalAlpha = 0.5;
    squiggle(ctx, VW * 0.12, VH * 0.16, 260, 60, '#1F4E9D', 9, 11);
    squiggle(ctx, VW * 0.72, VH * 0.72, 300, 70, '#D93A2B', 9, 23);
    ctx.restore();
  },
  paintRoom(g, W, H) {
    // The Loft Party, gallery wall, terrazzo, pendant light
    const R = mulberry32(1981);
    const hy = roomBase(g, W, H, ['#F5EFDD', '#E4D4B0'], ['#D9C9A4', '#B8A37C']);
    // terrazzo speckle
    g.save(); g.beginPath(); g.rect(0, hy, W, H - hy); g.clip();
    for (let i = 0; i < 700; i++) {
      g.fillStyle = ['#1F4E9D', '#D93A2B', '#F5B301', '#35B5AC', '#171515'][(R() * 5) | 0];
      g.globalAlpha = 0.12 + R() * 0.15;
      const s = 2 + R() * 5;
      g.fillRect(R() * W, hy + R() * (H - hy), s, s * (0.6 + R()));
    }
    g.restore(); g.globalAlpha = 1;
    // pendant light + warm pool
    const px = W * 0.5, lampY = H * 0.10;
    g.strokeStyle = '#171515'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, lampY); g.stroke();
    g.fillStyle = '#F5B301';
    g.beginPath(); g.moveTo(px - 46, lampY + 44); g.lineTo(px + 46, lampY + 44);
    g.lineTo(px + 22, lampY); g.lineTo(px - 22, lampY); g.closePath(); g.fill();
    g.strokeStyle = '#171515'; g.lineWidth = 5; g.stroke();
    roomGlow(g, px, lampY + 60, 130, 'rgba(255,220,130,0.85)', 0.8);
    roomGlow(g, px, hy + 40, 190, 'rgba(255,214,120,0.5)', 0.7);
    // gallery frames with Memphis prints
    const frame = (x, y, w, h, paint) => {
      g.fillStyle = '#171515'; g.fillRect(x - 6, y - 6, w + 12, h + 12);
      g.fillStyle = '#FBF6E9'; g.fillRect(x, y, w, h);
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); paint(x, y, w, h); g.restore();
    };
    frame(W * 0.06, H * 0.14, W * 0.13, H * 0.17, (x, y, w, h) => {
      squiggle(g, x + 10, y + h * 0.4, w - 20, h * 0.3, '#1F4E9D', 7, 31);
      g.fillStyle = '#D93A2B'; g.beginPath(); g.arc(x + w * 0.7, y + h * 0.25, w * 0.12, 0, TAU); g.fill();
    });
    frame(W * 0.81, H * 0.10, W * 0.13, H * 0.22, (x, y, w, h) => {
      g.fillStyle = '#F5B301';
      g.beginPath(); g.moveTo(x + w / 2, y + 12); g.lineTo(x + w - 14, y + h - 12); g.lineTo(x + 14, y + h - 12); g.closePath(); g.fill();
      g.fillStyle = '#171515'; g.fillRect(x + 14, y + h - 30, w - 28, 8);
    });
    // low credenza silhouette + squiggle legs
    const cy0 = hy - H * 0.16;
    g.fillStyle = '#171515';
    g.fillRect(W * 0.68, cy0, W * 0.26, H * 0.055);
    g.fillStyle = '#35B5AC'; g.fillRect(W * 0.68, cy0, W * 0.26, 6);
    g.strokeStyle = '#171515'; g.lineWidth = 7;
    for (const lx of [W * 0.71, W * 0.91]) {
      g.beginPath(); g.moveTo(lx, cy0 + H * 0.055); g.lineTo(lx + 14, hy + 6); g.stroke();
    }
    // floating bacterio on the wall
    squiggle(g, W * 0.30, H * 0.20, W * 0.16, 44, '#E84D8A', 8, 47);
    squiggle(g, W * 0.30, H * 0.26, W * 0.16, 44, '#1F4E9D', 8, 53);
  },
  drawRails(ctx) {
    // black laminate rails, confetti inlay
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#2b2724'); g.addColorStop(0.5, '#171515'); g.addColorStop(1, '#0c0b0a');
    ctx.fillStyle = g;
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // confetti inlay strip along rails
    ctx.save();
    ctx.beginPath(); ctx.rect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    ctx.rect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.clip('evenodd');
    const R = mulberry32(81);
    const cols = ['#D93A2B', '#F5B301', '#1F4E9D', '#E84D8A', '#35B5AC', '#F2EAD8'];
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = cols[(R() * cols.length) | 0];
      ctx.globalAlpha = 0.85;
      const x = TX0 + R() * (PW + RAIL * 2), y = TY0 + R() * (PH + RAIL * 2);
      ctx.save(); ctx.translate(x, y); ctx.rotate(R() * TAU);
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    // yellow inner pinstripe
    ctx.save();
    ctx.strokeStyle = '#F5B301'; ctx.lineWidth = 4;
    ctx.strokeRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#F2EAD8', ['#e6d9bd', '#fbf5e6', '#ddcda9'], 1500, 0.10);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    // diagonal laminate blocks along the top + bottom edges
    ctx.save();
    ctx.beginPath(); ctx.rect(PX, PY, PW, PH); ctx.clip();
    const cols = ['#D93A2B', '#F5B301', '#1F4E9D', '#35B5AC'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[i]; ctx.globalAlpha = 0.16;
      const bx = PX + (i * 0.27 + 0.03) * PW;
      ctx.save(); ctx.translate(bx, PY - 20); ctx.rotate(0.5);
      ctx.fillRect(0, 0, 130, 190); ctx.restore();
      ctx.save(); ctx.translate(bx + 90, PY + PH - 170); ctx.rotate(0.5);
      ctx.fillRect(0, 0, 130, 190); ctx.restore();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(PX, PY, PX, PY + PH);
    g.addColorStop(0, 'rgba(255,255,255,0.20)'); g.addColorStop(1, 'rgba(120,80,30,0.10)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    ctx.strokeStyle = '#1F4E9D'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(CX, PY + 16); ctx.lineTo(CX, PY + PH - 16); ctx.stroke();
    ctx.strokeStyle = '#D93A2B'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(CX, CY, 62, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#171515'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(CX, CY, 48, 0, TAU); ctx.stroke();
    // corner triangles, alternating
    const cols = ['#F5B301', '#35B5AC', '#E84D8A', '#1F4E9D'];
    const corners = [[PX + 40, PY + 40, 0], [PX + PW - 40, PY + 40, 1], [PX + 40, PY + PH - 40, 2], [PX + PW - 40, PY + PH - 40, 3]];
    corners.forEach(([x, y], i) => {
      ctx.fillStyle = cols[i];
      ctx.save(); ctx.translate(x, y); ctx.rotate(i * Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(26, 0); ctx.lineTo(0, 26); ctx.closePath(); ctx.fill();
      ctx.restore();
    });
    // squiggle flourishes near the goals
    squiggle(ctx, PX + 60, CY - 130, 120, 26, '#1F4E9D', 6, 61);
    squiggle(ctx, PX + PW - 180, CY + 104, 120, 26, '#D93A2B', 6, 67);
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    ctx.fillStyle = '#F5B301';
    ctx.fillRect(x - 6, cy - w / 2 - 10, 12, w + 20);
    ctx.fillStyle = '#171515';
    for (let y = cy - w / 2 - 10; y < cy + w / 2 + 10; y += 24)
      ctx.fillRect(x - 6, y, 12, 12);
    ctx.restore();
  },
};

/* ================= 6. WABI-SABI SASHIKO ================= */
const THEME_SASHIKO = {
  id: 'sashi', name: 'Wabi-Sabi Sashiko', tagline: 'Indigo thread · pine rails · the machiya',
  font: { display: "'Hiragino Mincho ProN', 'Yu Mincho', Georgia, serif", body: "'Hiragino Kaku Gothic ProN', Georgia, serif" },
  ink: '#EFE9DC', accent: '#B23A2E', gold: '#B89A6B', particle: '#EFE9DC', trail: '#B89A6B',
  flash: 'rgba(178,58,46,1)', vignette: 'rgba(8,12,18,0.45)',
  goalChord: [329.63, 415.30, 493.88, 659.25],
  scoreboard: 'solari',
  board: { housing: '#1a2c40', housingHi: '#2e475e', flap: '#EFE9DC', ink: '#22384F',
           accent: '#B89A6B', plate: '#8a6f45', plateInk: '#1c1410', seam: 'rgba(34,56,79,0.9)' },
  puck: { hi: '#d86a5a', body: '#B23A2E', edge: '#5e1c14', ring: '#EFE9DC' },
  mallet: { hi: '#c8a878', base: '#9a7448', edge: '#4a3a22', ring: '#EFE9DC', dish: '#7a5c36', dishHi: '#a8845a', knob: '#B23A2E', knobHi: '#d86a5a' },
  css: { pageBg: '#0d1420', panelBg: 'rgba(16,24,36,0.95)', panelBorder: '#B89A6B', btnBg: '#B23A2E', btnInk: '#F5EFE0', title: '#EFE9DC', sub: '#8a94a8', ghost: 'rgba(184,154,107,0.15)' },

  _tile: null,
  drawRoom(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#2c3f55'); g.addColorStop(1, '#141d2a');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    seigaiha(ctx, -200, -200, VW + 400, VH + 400, '#EFE9DC', 90, 0.05);
  },
  paintRoom(g, W, H) {
    // The Machiya, timber beams, shoji glow, tatami, lantern light
    const R = mulberry32(1603);
    const hy = roomBase(g, W, H, ['#3a2c20', '#241a12'], ['#6e5f45', '#4a3f2e']);
    // tatami cloth seams + weave
    g.save(); g.beginPath(); g.rect(0, hy, W, H - hy); g.clip();
    g.strokeStyle = 'rgba(30,22,14,0.5)'; g.lineWidth = 3;
    for (let x = 0; x < W; x += W / 4) { g.beginPath(); g.moveTo(x, hy); g.lineTo(x, H); g.stroke(); }
    g.strokeStyle = 'rgba(240,230,200,0.06)'; g.lineWidth = 1;
    for (let y = hy; y < H; y += 9) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.restore();
    // timber beam across the top
    g.fillStyle = '#1c130c';
    g.fillRect(0, H * 0.06, W, H * 0.045);
    g.fillStyle = 'rgba(184,154,107,0.25)';
    g.fillRect(0, H * 0.06, W, 3);
    // shoji screens, warm glowing lattice
    const shoji = (x, y, w, h) => {
      const sg = g.createLinearGradient(x, y, x, y + h);
      sg.addColorStop(0, '#f5e6c4'); sg.addColorStop(1, '#d9bd8a');
      g.fillStyle = sg; g.fillRect(x, y, w, h);
      g.strokeStyle = '#2a1e12'; g.lineWidth = Math.max(3, w * 0.02);
      g.strokeRect(x, y, w, h);
      g.lineWidth = Math.max(2, w * 0.012);
      for (let i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo(x + (w / 4) * i, y); g.lineTo(x + (w / 4) * i, y + h); g.stroke();
      }
      for (let i = 1; i < 3; i++) {
        g.beginPath(); g.moveTo(x, y + (h / 3) * i); g.lineTo(x + w, y + (h / 3) * i); g.stroke();
      }
      roomGlow(g, x + w / 2, y + h / 2, w * 0.9, 'rgba(255,220,160,0.55)', 0.75);
    };
    shoji(W * 0.05, H * 0.16, W * 0.20, H * 0.34);
    shoji(W * 0.75, H * 0.16, W * 0.20, H * 0.34);
    // paper lantern glow, off-center
    roomGlow(g, W * 0.5, H * 0.30, 150, 'rgba(255,214,150,0.5)', 0.8);
    g.fillStyle = 'rgba(245,230,196,0.9)';
    g.beginPath(); g.ellipse(W * 0.5, H * 0.30, 26, 34, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(60,40,20,0.6)'; g.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      g.beginPath(); g.ellipse(W * 0.5, H * 0.30, 26, 34, 0, -0.5 + i * 0.28, 0.5 + i * 0.28); g.stroke();
    }
    // hanging noren suggestion, indigo cloth strips
    g.fillStyle = 'rgba(34,56,79,0.85)';
    for (let i = 0; i < 3; i++) g.fillRect(W * 0.42 + i * W * 0.055, H * 0.105, W * 0.045, H * 0.10);
    // faint seigaiha on the wall
    seigaiha(g, 0, 0, W, hy, '#EFE9DC', 110, 0.045);
  },
  drawRails(ctx) {
    // pine rails, burned dark edge
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#c8a878'); g.addColorStop(0.5, '#a8845a'); g.addColorStop(1, '#7a5c36');
    ctx.fillStyle = g;
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    woodGrain(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, '#4a3a22', '#e0c090', false);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // shou-sugi-ban inner edge
    ctx.save();
    ctx.strokeStyle = '#1c1410'; ctx.lineWidth = 7;
    ctx.strokeRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // stitched dashed inlay on the rail
    ctx.save();
    ctx.strokeStyle = 'rgba(239,233,220,0.75)'; ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 9]);
    ctx.strokeRect(TX0 + 13, TY0 + 13, PW + RAIL * 2 - 26, PH + RAIL * 2 - 26);
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#22384F', ['#1d3045', '#29445e', '#18293c'], 1600, 0.12);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    // seigaiha waves across the indigo field
    seigaiha(ctx, PX, PY, PW, PH, '#EFE9DC', 120, 0.10);
    const g = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    g.addColorStop(0, 'rgba(239,233,220,0.10)'); g.addColorStop(0.5, 'rgba(239,233,220,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    // sashiko running-stitch markings
    ctx.strokeStyle = '#EFE9DC'; ctx.lineWidth = 4;
    ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.moveTo(CX, PY + 18); ctx.lineTo(CX, PY + PH - 18); ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, CY, 64, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // hanko stamp squares at the faceoff dots
    const hanko = (x, y) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.06);
      ctx.fillStyle = '#B23A2E';
      ctx.globalAlpha = 0.88;
      const s = 34;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#EFE9DC'; ctx.lineWidth = 3;
      ctx.strokeRect(-s / 2 + 5, -s / 2 + 5, s - 10, s - 10);
      // seal-script-ish mark
      ctx.beginPath();
      ctx.moveTo(-7, 8); ctx.lineTo(-7, -8); ctx.lineTo(7, -8);
      ctx.moveTo(-7, 0); ctx.lineTo(3, 0);
      ctx.stroke();
      ctx.restore();
    };
    hanko(PX + PW * 0.25, PY + PH * 0.30);
    hanko(PX + PW * 0.75, PY + PH * 0.30);
    hanko(PX + PW * 0.25, PY + PH * 0.70);
    hanko(PX + PW * 0.75, PY + PH * 0.70);
    // asanoha corner accents
    ctx.strokeStyle = 'rgba(239,233,220,0.5)'; ctx.lineWidth = 2.5;
    for (const [x, y] of [[PX + 34, PY + 34], [PX + PW - 34, PY + 34], [PX + 34, PY + PH - 34], [PX + PW - 34, PY + PH - 34]]) {
      ctx.beginPath();
      ctx.moveTo(x - 18, y); ctx.lineTo(x + 18, y);
      ctx.moveTo(x, y - 18); ctx.lineTo(x, y + 18);
      ctx.moveTo(x - 13, y - 13); ctx.lineTo(x + 13, y + 13);
      ctx.moveTo(x - 13, y + 13); ctx.lineTo(x + 13, y - 13);
      ctx.stroke();
    }
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    // pine posts + red cord
    ctx.fillStyle = '#4a3a22';
    ctx.fillRect(x - 7, cy - w / 2 - 12, 14, w + 24);
    ctx.strokeStyle = '#B23A2E'; ctx.lineWidth = 4;
    ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(x, cy - w / 2 - 12); ctx.lineTo(x, cy + w / 2 + 12); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#B89A6B';
    ctx.beginPath(); ctx.arc(x, cy - w / 2 - 12, 7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy + w / 2 + 12, 7, 0, TAU); ctx.fill();
    ctx.restore();
  },
};

THEMES.mem = THEME_MEMPHIS;
THEMES.sashi = THEME_SASHIKO;

/* ---------- rooms for the original four tables ---------- */

THEMES.deco.paintRoom = function (g, W, H) {
  // The Skyline Bar, black lacquer, brass inlay, ziggurat skyline
  const R = mulberry32(1929);
  const hy = roomBase(g, W, H, ['#101014', '#060607'], ['#17171c', '#0a0a0c']);
  // brass wall inlays
  g.strokeStyle = 'rgba(201,162,39,0.5)'; g.lineWidth = 3;
  for (let x = W * 0.08; x < W; x += W * 0.12) {
    g.beginPath(); g.moveTo(x, H * 0.08); g.lineTo(x, hy - 10); g.stroke();
  }
  // ziggurat skyline silhouette with lit windows
  const sky = (x, w, h, tiers) => {
    g.fillStyle = '#050507';
    let tw = w;
    for (let i = 0; i < tiers; i++) {
      const th = h / tiers;
      g.fillRect(x + (w - tw) / 2, hy - h + i * th, tw, th + 1);
      tw *= 0.72;
    }
    g.fillStyle = 'rgba(255,196,110,0.85)';
    for (let i = 0; i < 26; i++) {
      const wx = x + (R() - 0.5) * w * 0.7, wy = hy - R() * h * 0.9;
      if (wy > hy - 6) continue;
      g.fillRect(wx, wy, 3 + R() * 4, 2 + R() * 3);
    }
  };
  sky(W * 0.04, W * 0.20, H * 0.30, 4);
  sky(W * 0.30, W * 0.14, H * 0.22, 3);
  sky(W * 0.72, W * 0.22, H * 0.34, 5);
  sky(W * 0.52, W * 0.10, H * 0.18, 3);
  // marble floor sheen + brass border
  g.fillStyle = 'rgba(201,162,39,0.20)';
  g.fillRect(0, hy + H * 0.10, W, 3);
  roomGlow(g, W * 0.5, hy + 30, 260, 'rgba(255,190,120,0.28)', 0.8);
  // chandelier
  const cxp = W * 0.5, chY = H * 0.07;
  g.strokeStyle = '#c9a227'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cxp, 0); g.lineTo(cxp, chY); g.stroke();
  roomGlow(g, cxp, chY + 26, 120, 'rgba(255,214,140,0.9)', 0.9);
  g.fillStyle = '#c9a227';
  for (let i = -2; i <= 2; i++) {
    g.beginPath(); g.arc(cxp + i * 26, chY + 26 + Math.abs(i) * 8, 7, 0, TAU); g.fill();
  }
  // wall sconces
  for (const sx of [W * 0.12, W * 0.88]) {
    roomGlow(g, sx, H * 0.30, 90, 'rgba(255,200,120,0.55)', 0.8);
    g.fillStyle = '#c9a227'; g.fillRect(sx - 4, H * 0.30 - 26, 8, 30);
  }
};

THEMES.mid.paintRoom = function (g, W, H) {
  // The Cabana, breeze-block, terrazzo, low desert sun, palm
  const R = mulberry32(1962);
  const hy = roomBase(g, W, H, ['#f0e4c8', '#dcc9a0'], ['#d8c49c', '#a98f66']);
  // breeze-block pattern
  g.save(); g.beginPath(); g.rect(0, 0, W, hy); g.clip();
  g.fillStyle = 'rgba(120,90,50,0.30)';
  const bw = 64, bh = 40;
  for (let y = 20; y < hy; y += bh) {
    for (let x = 10 + ((y / bh) % 2) * bw / 2; x < W; x += bw) {
      g.beginPath(); g.arc(x, y, 9, 0, TAU); g.fill();
      g.beginPath(); g.arc(x + 22, y, 9, 0, TAU); g.fill();
    }
  }
  g.restore();
  // low desert sun + long light
  const sx = W * 0.78, sy = hy - H * 0.06;
  roomGlow(g, sx, sy, 220, 'rgba(255,190,110,0.95)', 0.95);
  g.fillStyle = 'rgba(255,214,150,0.9)';
  g.beginPath(); g.arc(sx, sy, 44, 0, TAU); g.fill();
  roomGlow(g, sx, hy + 60, 300, 'rgba(255,190,120,0.35)', 0.7);
  // terrazzo speckle
  g.save(); g.beginPath(); g.rect(0, hy, W, H - hy); g.clip();
  for (let i = 0; i < 500; i++) {
    g.fillStyle = ['#8a6a44', '#f5efdd', '#b98a5a'][(R() * 3) | 0];
    g.globalAlpha = 0.25;
    const s = 2 + R() * 4;
    g.fillRect(R() * W, hy + R() * (H - hy), s, s);
  }
  g.restore(); g.globalAlpha = 1;
  // palm silhouette from the right edge
  g.strokeStyle = '#2c2118'; g.lineCap = 'round';
  g.lineWidth = 16;
  g.beginPath(); g.moveTo(W + 10, H * 0.55); g.quadraticCurveTo(W * 0.92, H * 0.35, W * 0.86, H * 0.12); g.stroke();
  g.lineWidth = 9;
  for (let i = 0; i < 7; i++) {
    const a = -0.4 - i * 0.28, fx = W * 0.86, fy = H * 0.12;
    g.beginPath(); g.moveTo(fx, fy);
    g.quadraticCurveTo(fx + Math.cos(a) * 90, fy + Math.sin(a) * 60 - 20, fx + Math.cos(a) * 150, fy + Math.sin(a) * 110 + 30);
    g.stroke();
  }
  // low credenza silhouette
  g.fillStyle = '#4a3826';
  g.fillRect(W * 0.06, hy - H * 0.13, W * 0.24, H * 0.05);
  g.fillStyle = '#2c2118';
  for (const lx of [W * 0.08, W * 0.28]) g.fillRect(lx, hy - H * 0.08, 8, H * 0.08);
};

THEMES.brut.paintRoom = function (g, W, H) {
  // The Bunker Gallery, board-formed concrete, skylight shaft, rust accent
  const R = mulberry32(1972);
  const hy = roomBase(g, W, H, ['#5c5e60', '#3a3c3e'], ['#4a4c4e', '#26282a']);
  // board-form lines
  g.save(); g.beginPath(); g.rect(0, 0, W, hy); g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
  for (let y = 30; y < hy; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  for (let y = 32; y < hy; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // tie holes
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 57; y < hy; y += 108)
    for (let x = 60; x < W; x += 180) { g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); }
  // concrete speckle
  for (let i = 0; i < 900; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)';
    g.fillRect(R() * W, R() * hy, 2, 2);
  }
  g.restore();
  // cool skylight shaft
  g.save();
  g.globalAlpha = 0.16;
  g.fillStyle = '#cfe4f5';
  g.beginPath();
  g.moveTo(W * 0.42, 0); g.lineTo(W * 0.58, 0);
  g.lineTo(W * 0.78, H); g.lineTo(W * 0.52, H);
  g.closePath(); g.fill();
  g.restore();
  roomGlow(g, W * 0.5, H * 0.02, 200, 'rgba(210,230,245,0.5)', 0.8);
  // rust-orange accent panel + concrete bench
  g.fillStyle = '#b34700';
  g.fillRect(W * 0.78, H * 0.18, W * 0.14, hy - H * 0.18);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(W * 0.78, H * 0.18, 8, hy - H * 0.18);
  g.fillStyle = '#333536';
  g.fillRect(W * 0.10, hy - H * 0.10, W * 0.30, H * 0.035);
  g.fillRect(W * 0.13, hy - H * 0.065, W * 0.03, H * 0.065);
  g.fillRect(W * 0.34, hy - H * 0.065, W * 0.03, H * 0.065);
  // column
  g.fillStyle = '#2e3032';
  g.fillRect(W * 0.60, 0, W * 0.07, hy);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(W * 0.60, 0, 6, hy);
};

THEMES.bil.paintRoom = function (g, W, H) {
  // The Century Club, bottle-green plaster, oak wainscot, billiard lamp
  const R = mulberry32(1911);
  const hy = roomBase(g, W, H, ['#274d38', '#142a1e'], ['#3a2c1c', '#201812']);
  // plaster texture
  g.save(); g.beginPath(); g.rect(0, 0, W, hy); g.clip();
  for (let i = 0; i < 800; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.04)';
    g.fillRect(R() * W, R() * hy, 2, 2);
  }
  g.restore();
  // oak wainscot
  const wy = hy - H * 0.16;
  const wg = g.createLinearGradient(0, wy, 0, hy);
  wg.addColorStop(0, '#6e4e2c'); wg.addColorStop(1, '#3f2c17');
  g.fillStyle = wg; g.fillRect(0, wy, W, hy - wy);
  g.fillStyle = '#c9a227'; g.fillRect(0, wy - 3, W, 4);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 2;
  for (let x = 20; x < W; x += 90) { g.beginPath(); g.moveTo(x, wy + 8); g.lineTo(x, hy - 8); g.stroke(); }
  // framed prints
  for (const [fx, fw] of [[W * 0.08, W * 0.14], [W * 0.78, W * 0.14]]) {
    g.fillStyle = '#2a1c0e'; g.fillRect(fx - 6, H * 0.12 - 6, fw + 12, H * 0.18 + 12);
    g.fillStyle = '#d9cba8'; g.fillRect(fx, H * 0.12, fw, H * 0.18);
    g.fillStyle = '#1e3a2a';
    g.beginPath(); g.arc(fx + fw / 2, H * 0.21, fw * 0.22, 0, TAU); g.fill();
  }
  // cue rack silhouette
  g.fillStyle = '#1c130c';
  g.fillRect(W * 0.30, H * 0.14, W * 0.10, 10);
  g.strokeStyle = '#8a6a3f'; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const qx = W * 0.315 + i * W * 0.024;
    g.beginPath(); g.moveTo(qx, H * 0.15); g.lineTo(qx + 6, hy - 4); g.stroke();
  }
  // the billiard lamp, green shade + amber pool
  const lx = W * 0.55, ly = H * 0.10;
  g.strokeStyle = '#1c130c'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, ly); g.stroke();
  g.fillStyle = '#1e5c38';
  g.beginPath(); g.moveTo(lx - 90, ly + 40); g.lineTo(lx + 90, ly + 40);
  g.lineTo(lx + 60, ly); g.lineTo(lx - 60, ly); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,220,150,0.85)';
  g.fillRect(lx - 88, ly + 38, 176, 5);
  roomGlow(g, lx, ly + 60, 150, 'rgba(255,206,130,0.8)', 0.85);
  roomGlow(g, lx, hy + 60, 260, 'rgba(255,190,110,0.30)', 0.7);
  // leather chair hints
  g.fillStyle = '#241a12';
  for (const [chx, chw] of [[W * 0.06, W * 0.12], [W * 0.84, W * 0.12]]) {
    g.beginPath(); g.ellipse(chx, hy - H * 0.06, chw / 2, H * 0.055, 0, 0, TAU); g.fill();
    g.fillRect(chx - chw / 2, hy - H * 0.11, chw, H * 0.06);
  }
};

/* ============================================================
   ATELIER AIR HOCKEY, theme renderers, third set (v22)
   Bauhaus Dessau '23, Zellige Riad, Swiss Grid.
   Same contract as themes.js / themes2.js: each theme paints
   room, rails, surface, markings, goal trim, and carries the
   scoreboard / puck / mallet / css palettes. Shared helpers
   (noiseTile, tileOver, woodGrain, brushedMetal, roomBase,
   roomGlow, seigaiha, squiggle, mulberry32, rr) come from the
   earlier theme files, which load first.
   ============================================================ */

/* Eight-pointed khatam star path (for the zellige inlay) */
function star8(g, cx, cy, r, rot) {
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (rot || 0) + (i * Math.PI) / 8;
    const rad = i % 2 === 0 ? r : r * 0.52;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

/* ================= 7. BAUHAUS DESSAU '23 ================= */
const THEME_BAUHAUS = {
  id: 'bau', name: "Bauhaus Dessau '23", tagline: 'Tubular steel · primaries · the workshop stage, 1923',
  font: { display: "'Futura', 'Century Gothic', sans-serif", body: "'Helvetica Neue', Arial, sans-serif" },
  ink: '#1a1a1a', accent: '#D03A2B', gold: '#E8A820', particle: '#E8A820', trail: '#2456A6',
  flash: 'rgba(208,58,43,1)', vignette: 'rgba(40,30,18,0.28)',
  goalChord: [392, 493.88, 587.33, 783.99],
  scoreboard: 'reels',
  board: { frame: '#1a1a1a', frameEdge: '#D03A2B', drum: '#F2EBDC',
           drumShade: '#d8cdb2', ink: '#1a1a1a', jewel: '#2456A6' },
  puck: { hi: '#fdf8ec', body: '#EFE6D0', edge: '#b8ab8c', ring: '#1a1a1a' },
  mallet: { hi: '#3a3a3c', base: '#1c1c1e', edge: '#0a0a0a', ring: '#E8A820', dish: '#2a2a2c', dishHi: '#4a4a4e', knob: '#D03A2B', knobHi: '#f06a5a' },
  css: { pageBg: '#161310', panelBg: 'rgba(242,235,220,0.97)', panelBorder: '#1a1a1a', btnBg: '#D03A2B', btnInk: '#FFF6E8', title: '#1a1a1a', sub: '#6a6256', ghost: 'rgba(208,58,43,0.12)' },

  _tile: null,
  drawRoom(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#EFE8D8'); g.addColorStop(1, '#DCD2B8');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // faint curtain-wall grid, Dessau building
    ctx.save(); ctx.strokeStyle = 'rgba(26,26,26,0.06)'; ctx.lineWidth = 2;
    for (let x = -200; x < VW + 200; x += 120) { ctx.beginPath(); ctx.moveTo(x, -200); ctx.lineTo(x, VH + 200); ctx.stroke(); }
    for (let y = -200; y < VH + 200; y += 120) { ctx.beginPath(); ctx.moveTo(-200, y); ctx.lineTo(VW + 200, y); ctx.stroke(); }
    // one big red circle, very faint, the Albers wall
    ctx.strokeStyle = 'rgba(208,58,43,0.07)'; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.arc(VW * 0.85, VH * 0.2, 150, 0, TAU); ctx.stroke();
    ctx.restore();
  },
  paintRoom(g, W, H) {
    // The Workshop, white cubic Dessau blocks, glass grid, red balcony
    const R = mulberry32(1923);
    const hy = roomBase(g, W, H, ['#F4EEE0', '#E0D5BC'], ['#CFC2A4', '#A8977A']);
    // main workshop block
    const bx = W * 0.16, bw = W * 0.42, bh = H * 0.34, by = hy - bh;
    g.fillStyle = '#FBF7EC'; g.fillRect(bx, by, bw, bh);
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(bx, by + bh - 8, bw, 8);
    // glass curtain wall grid
    g.strokeStyle = '#2a2a2c'; g.lineWidth = 3;
    for (let i = 0; i <= 6; i++) {
      const gx = bx + (bw / 6) * i;
      g.beginPath(); g.moveTo(gx, by + 10); g.lineTo(gx, by + bh - 10); g.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const gy = by + 10 + ((bh - 20) / 4) * i;
      g.beginPath(); g.moveTo(bx + 8, gy); g.lineTo(bx + bw - 8, gy); g.stroke();
    }
    g.fillStyle = 'rgba(36,86,166,0.16)'; g.fillRect(bx + 8, by + 10, bw - 16, bh - 20);
    // red balcony bar
    g.fillStyle = '#D03A2B';
    g.fillRect(bx + bw * 0.1, by + bh * 0.42, bw * 0.8, 10);
    // second cubic block + yellow door
    const cx2 = W * 0.66, cw2 = W * 0.20, ch2 = H * 0.24;
    g.fillStyle = '#F7F2E4'; g.fillRect(cx2, hy - ch2, cw2, ch2);
    g.fillStyle = '#E8A820'; g.fillRect(cx2 + cw2 * 0.35, hy - ch2 * 0.62, cw2 * 0.3, ch2 * 0.62);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 3;
    g.strokeRect(cx2 + cw2 * 0.35, hy - ch2 * 0.62, cw2 * 0.3, ch2 * 0.62);
    // stage floor boards
    g.save(); g.beginPath(); g.rect(0, hy, W, H - hy); g.clip();
    g.strokeStyle = 'rgba(90,70,50,0.35)'; g.lineWidth = 2;
    for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, hy); g.lineTo(x - 30, H); g.stroke(); }
    g.restore();
    // floating primary shapes on the wall, the Vorkurs exercise
    g.fillStyle = '#D03A2B';
    g.beginPath(); g.arc(W * 0.10, H * 0.20, 26, 0, TAU); g.fill();
    g.fillStyle = '#E8A820';
    g.beginPath(); g.moveTo(W * 0.90, H * 0.14); g.lineTo(W * 0.94, H * 0.24); g.lineTo(W * 0.86, H * 0.24); g.closePath(); g.fill();
    g.fillStyle = '#2456A6'; g.fillRect(W * 0.885, H * 0.42, 44, 44);
    roomGlow(g, W * 0.5, hy + 40, 220, 'rgba(255,244,220,0.5)', 0.7);
  },
  drawRails(ctx) {
    // tubular steel: chrome gradient + brushed finish
    const g = ctx.createLinearGradient(TX0, TY0, TX0 + PW + RAIL * 2, TY0);
    g.addColorStop(0, '#8f9296'); g.addColorStop(0.35, '#d7d9db'); g.addColorStop(0.65, '#a9acae'); g.addColorStop(1, '#7c7f83');
    ctx.fillStyle = g;
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    brushedMetal(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, true);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // black leather inner edge
    ctx.save();
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 8;
    ctx.strokeRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // primary-color joint caps at the corners
    ctx.save();
    const caps = ['#D03A2B', '#E8A820', '#2456A6', '#D03A2B'];
    const pts = [[TX0 + 20, TY0 + 20], [TX0 + PW + RAIL * 2 - 20, TY0 + 20], [TX0 + 20, TY0 + PH + RAIL * 2 - 20], [TX0 + PW + RAIL * 2 - 20, TY0 + PH + RAIL * 2 - 20]];
    pts.forEach(([x, y], i) => {
      ctx.fillStyle = caps[i];
      ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.stroke();
    });
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#F2EBDC', ['#e6dcc4', '#faf4e6', '#dccfb2'], 1300, 0.10);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    const g = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(120,100,70,0.10)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    // the Vorkurs trio at center: red circle, yellow triangle, blue square
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(CX, PY + 14); ctx.lineTo(CX, PY + PH - 14); ctx.stroke();
    ctx.fillStyle = '#D03A2B';
    ctx.beginPath(); ctx.arc(CX, CY, 52, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#E8A820';
    ctx.beginPath(); ctx.moveTo(CX, CY - 30); ctx.lineTo(CX + 30, CY + 24); ctx.lineTo(CX - 30, CY + 24); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#2456A6';
    ctx.fillRect(CX - 17, CY - 17, 34, 34);
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.strokeRect(CX - 17, CY - 17, 34, 34);
    // face-off squares in primaries
    const cols = ['#D03A2B', '#E8A820', '#2456A6', '#1a1a1a'];
    let i = 0;
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.fillStyle = cols[i++ % 4];
        ctx.fillRect(fx - 7, fy - 7, 14, 14);
      }
    // goal creases: black arcs
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(PX, CY, 74, -0.72, 0.72); ctx.stroke();
    ctx.beginPath(); ctx.arc(PX + PW, CY, 74, Math.PI - 0.72, Math.PI + 0.72); ctx.stroke();
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    // black posts stacked with the three primaries
    ctx.fillStyle = '#141414';
    ctx.fillRect(x - 6, cy - w / 2 - 10, 12, w + 20);
    const cols = ['#D03A2B', '#E8A820', '#2456A6'];
    for (const sgn of [-1, 1]) {
      cols.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(x, cy + sgn * (w / 2 + 10) - sgn * i * 16, 7, 0, TAU); ctx.fill();
      });
    }
    ctx.restore();
  },
};

/* ================= 8. ZELLIGE RIAD ================= */
const THEME_ZEL = {
  id: 'zel', name: 'Zellige Riad', tagline: 'Cobalt stars · terracotta · the courtyard fountain, Marrakech',
  font: { display: "Georgia, 'Times New Roman', serif", body: "Georgia, serif" },
  ink: '#F0E6D2', accent: '#C96A3B', gold: '#C96A3B', particle: '#E8A06A', trail: '#4E7AC2',
  flash: 'rgba(201,106,59,1)', vignette: 'rgba(30,18,8,0.42)',
  goalChord: [261.63, 329.63, 392, 523.25],
  scoreboard: 'bulbs',
  board: { cab: '#143A75', cabHi: '#1E4E9D', bulb: '#ffcf7a',
           bulbDim: '#0e2a52', bolt: '#C96A3B' },
  puck: { hi: '#e08a5a', body: '#C96A3B', edge: '#7a3a1e', ring: '#F0E6D2' },
  mallet: { hi: '#6e4a30', base: '#4a2f1e', edge: '#241209', ring: '#4E7AC2', dish: '#38220f', dishHi: '#5c3a24', knob: '#b98a2f', knobHi: '#e8c86a' },
  css: { pageBg: '#120d08', panelBg: 'rgba(28,20,14,0.95)', panelBorder: '#C96A3B', btnBg: '#1E4E9D', btnInk: '#F7EFDD', title: '#F0E6D2', sub: '#b09a78', ghost: 'rgba(30,78,157,0.16)' },

  _tile: null, _starTile: null,
  drawRoom(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#EFDDB8'); g.addColorStop(1, '#D9BC8C');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // faint horseshoe arch outlines
    ctx.save(); ctx.strokeStyle = 'rgba(120,70,40,0.10)'; ctx.lineWidth = 10;
    for (const ax of [VW * 0.2, VW * 0.8]) {
      ctx.beginPath(); ctx.arc(ax, VH * 0.42, 120, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 120, VH * 0.42); ctx.lineTo(ax - 120, VH * 0.75); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax + 120, VH * 0.42); ctx.lineTo(ax + 120, VH * 0.75); ctx.stroke();
    }
    ctx.restore();
  },
  _makeStarTile() {
    // pre-rendered zellige lattice: cobalt stars on deep blue
    const c = document.createElement('canvas');
    c.width = c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#143A75'; g.fillRect(0, 0, 220, 220);
    const R = mulberry32(77);
    const cols = ['#1E4E9D', '#4E7AC2', '#C96A3B', '#F0E6D2'];
    for (let yy = 0; yy <= 220; yy += 55) {
      for (let xx = 0; xx <= 220; xx += 55) {
        const ox = (yy / 55) % 2 ? 27.5 : 0;
        g.fillStyle = cols[(R() * cols.length) | 0];
        star8(g, xx + ox - 27.5 + 27.5, yy, 20, R() * 0.4);
        g.fill();
        g.strokeStyle = '#F0E6D2'; g.lineWidth = 1.5; g.stroke();
      }
    }
    return c;
  },
  paintRoom(g, W, H) {
    // The Courtyard, tadelakt walls, horseshoe arch, star fountain
    const R = mulberry32(1550);
    const hy = roomBase(g, W, H, ['#EFDDB8', '#D9BC8C'], ['#C9A878', '#96703F']);
    if (!this._starTile) this._starTile = this._makeStarTile();
    // grand horseshoe arch, centered
    const ax = W * 0.5, ar = W * 0.22, ay = hy;
    g.fillStyle = '#C96A3B';
    g.beginPath();
    g.arc(ax, ay - ar * 0.55, ar, Math.PI, 0);
    g.rect(ax - ar, ay - ar * 0.55, ar * 2, ar * 0.55 + 4);
    g.fill();
    g.fillStyle = '#8a4a26';
    g.beginPath();
    g.arc(ax, ay - ar * 0.55, ar * 0.82, Math.PI, 0);
    g.rect(ax - ar * 0.82, ay - ar * 0.55, ar * 1.64, ar * 0.55 + 4);
    g.fill();
    // through the arch: hint of blue sky + palm
    const sky = g.createLinearGradient(0, ay - ar * 1.4, 0, ay);
    sky.addColorStop(0, '#7AB5D6'); sky.addColorStop(1, '#C9E2EE');
    g.fillStyle = sky;
    g.beginPath();
    g.arc(ax, ay - ar * 0.55, ar * 0.82, Math.PI, 0);
    g.rect(ax - ar * 0.82, ay - ar * 0.55, ar * 1.64, ar * 0.55 + 4);
    g.fill();
    g.strokeStyle = '#2c4a2e'; g.lineCap = 'round'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(ax + ar * 0.3, ay); g.quadraticCurveTo(ax + ar * 0.34, ay - ar * 0.5, ax + ar * 0.42, ay - ar * 0.75); g.stroke();
    g.lineWidth = 5;
    for (let i = 0; i < 6; i++) {
      const a = -0.5 - i * 0.3, fx = ax + ar * 0.42, fy = ay - ar * 0.75;
      g.beginPath(); g.moveTo(fx, fy);
      g.quadraticCurveTo(fx + Math.cos(a) * 50, fy + Math.sin(a) * 30 - 12, fx + Math.cos(a) * 84, fy + Math.sin(a) * 60 + 16);
      g.stroke();
    }
    // octagonal fountain basin with zellige stars
    const fxc = W * 0.5, fyc = hy + (H - hy) * 0.42, fr = Math.min(W, H) * 0.13;
    g.save();
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const px = fxc + Math.cos(a) * fr, py = fyc + Math.sin(a) * fr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = '#143A75'; g.fill();
    g.clip();
    for (let ty = fyc - fr; ty < fyc + fr; ty += 52)
      for (let tx = fxc - fr; tx < fxc + fr; tx += 52)
        g.drawImage(this._starTile, tx, ty, 56, 56);
    g.restore();
    // water shimmer
    g.fillStyle = 'rgba(180,220,240,0.25)';
    g.beginPath(); g.ellipse(fxc, fyc, fr * 0.7, fr * 0.4, 0, 0, TAU); g.fill();
    // hanging lanterns
    for (const [lx, lw] of [[W * 0.18, 1], [W * 0.82, 0.8]]) {
      const ly = H * 0.16;
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(lx, 0); g.lineTo(lx, ly); g.stroke();
      roomGlow(g, lx, ly + 26, 90 * lw, 'rgba(255,190,110,0.85)', 0.9);
      g.fillStyle = '#C96A3B';
      g.beginPath(); g.ellipse(lx, ly + 26, 16 * lw, 22 * lw, 0, 0, TAU); g.fill();
      g.fillStyle = '#1a1a1a'; g.fillRect(lx - 6 * lw, ly + 2, 12 * lw, 6);
    }
    // wall star band
    g.save(); g.globalAlpha = 0.5;
    for (let x = 20; x < W; x += 64) {
      g.fillStyle = '#1E4E9D';
      star8(g, x, H * 0.10, 18, 0.2); g.fill();
    }
    g.restore();
  },
  drawRails(ctx) {
    // carved cedar with a zellige star inlay band
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#5c3a24'); g.addColorStop(0.5, '#402818'); g.addColorStop(1, '#2c1a0e');
    ctx.fillStyle = g;
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    woodGrain(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, '#1c0f06', '#7a5230');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // star inlay band around the rail ring
    ctx.save();
    ctx.beginPath(); ctx.rect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    ctx.rect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.clip('evenodd');
    if (!this._starTile) this._starTile = this._makeStarTile();
    for (let ty = TY0; ty < TY0 + PH + RAIL * 2; ty += 44)
      for (let tx = TX0; tx < TX0 + PW + RAIL * 2; tx += 44)
        ctx.drawImage(this._starTile, tx, ty, 44, 44);
    ctx.fillStyle = 'rgba(20,58,117,0.25)';
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    ctx.restore();
    // brass inner edge
    ctx.save();
    ctx.strokeStyle = '#b98a2f'; ctx.lineWidth = 5;
    ctx.strokeRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#EFE3CC', ['#e2d2b2', '#f8efdc', '#d8c49c'], 1500, 0.10);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    // faint star lattice across the sand
    ctx.save(); ctx.globalAlpha = 0.16;
    if (!this._starTile) this._starTile = this._makeStarTile();
    for (let ty = PY; ty < PY + PH; ty += 110)
      for (let tx = PX; tx < PX + PW; tx += 110)
        ctx.drawImage(this._starTile, tx, ty, 110, 110);
    ctx.restore();
    const g = ctx.createLinearGradient(PX, PY, PX, PY + PH);
    g.addColorStop(0, 'rgba(255,250,235,0.20)'); g.addColorStop(1, 'rgba(140,100,60,0.14)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    ctx.strokeStyle = '#1E4E9D'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(CX, PY + 14); ctx.lineTo(CX, PY + PH - 14); ctx.stroke();
    ctx.beginPath(); ctx.arc(CX, CY, 62, 0, TAU); ctx.stroke();
    // terracotta center medallion: khatam star
    ctx.fillStyle = '#C96A3B';
    star8(ctx, CX, CY, 40, 0.2); ctx.fill();
    ctx.strokeStyle = '#F0E6D2'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#1E4E9D';
    star8(ctx, CX, CY, 18, 0.2); ctx.fill();
    // face-off dots: cobalt
    ctx.fillStyle = '#1E4E9D';
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.beginPath(); ctx.arc(fx, fy, 6, 0, TAU); ctx.fill();
      }
    // goal creases
    ctx.strokeStyle = '#1E4E9D'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(PX, CY, 74, -0.72, 0.72); ctx.stroke();
    ctx.beginPath(); ctx.arc(PX + PW, CY, 74, Math.PI - 0.72, Math.PI + 0.72); ctx.stroke();
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    // cobalt posts, terracotta caps
    ctx.fillStyle = '#1E4E9D';
    ctx.fillRect(x - 7, cy - w / 2 - 10, 14, w + 20);
    ctx.strokeStyle = '#F0E6D2'; ctx.lineWidth = 2;
    ctx.strokeRect(x - 7, cy - w / 2 - 10, 14, w + 20);
    ctx.fillStyle = '#C96A3B';
    star8(ctx, x, cy - w / 2 - 10, 11, 0.2); ctx.fill();
    star8(ctx, x, cy + w / 2 + 10, 11, 0.2); ctx.fill();
    ctx.restore();
  },
};

/* ================= 9. SWISS GRID ================= */
const THEME_SUISSE = {
  id: 'swi', name: 'Swiss Grid', tagline: 'Paper white · black rules · the Zurich gallery, 1957',
  font: { display: "'Helvetica Neue', Helvetica, Arial, sans-serif", body: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  ink: '#111111', accent: '#E30613', gold: '#E30613', particle: '#E30613', trail: '#111111',
  flash: 'rgba(227,6,19,1)', vignette: 'rgba(0,0,0,0.22)',
  goalChord: [349.23, 440, 523.25, 698.46],
  scoreboard: 'solari',
  board: { housing: '#111111', housingHi: '#2c2c2c', flap: '#F7F7F5', ink: '#111111',
           accent: '#E30613', plate: '#E30613', plateInk: '#ffffff', seam: 'rgba(0,0,0,0.14)' },
  puck: { hi: '#4a4a4a', body: '#1c1c1c', edge: '#000000', ring: '#E30613' },
  mallet: { hi: '#ffffff', base: '#EDEDED', edge: '#9a9a9a', ring: '#111111', dish: '#d8d8d8', dishHi: '#f4f4f4', knob: '#E30613', knobHi: '#ff5a5a' },
  css: { pageBg: '#0e0e0e', panelBg: 'rgba(247,247,245,0.97)', panelBorder: '#111111', btnBg: '#E30613', btnInk: '#ffffff', title: '#111111', sub: '#6a6a6a', ghost: 'rgba(227,6,19,0.10)' },

  _tile: null,
  drawRoom(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#F5F5F3'); g.addColorStop(1, '#E2E2DE');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // the grid, faint
    ctx.save(); ctx.strokeStyle = 'rgba(17,17,17,0.05)'; ctx.lineWidth = 1;
    for (let x = -200; x < VW + 200; x += 44) { ctx.beginPath(); ctx.moveTo(x, -200); ctx.lineTo(x, VH + 200); ctx.stroke(); }
    for (let y = -200; y < VH + 200; y += 44) { ctx.beginPath(); ctx.moveTo(-200, y); ctx.lineTo(VW + 200, y); ctx.stroke(); }
    // one red bar, very faint
    ctx.fillStyle = 'rgba(227,6,19,0.06)';
    ctx.fillRect(VW * 0.7, -200, 60, VH + 400);
    ctx.restore();
  },
  paintRoom(g, W, H) {
    // The Gallery, white walls, concrete floor, one red canvas, track light
    const hy = roomBase(g, W, H, ['#FAFAF8', '#ECECE8'], ['#D2D2CE', '#ACACA8']);
    // concrete floor joints
    g.save(); g.beginPath(); g.rect(0, hy, W, H - hy); g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2;
    for (let x = 0; x < W; x += W / 5) { g.beginPath(); g.moveTo(x, hy); g.lineTo(x, H); g.stroke(); }
    g.restore();
    // the red canvas, concrete art, slightly off-center
    const cxx = W * 0.38, cyw = W * 0.20, cyh = H * 0.30, cyt = H * 0.14;
    g.fillStyle = '#111'; g.fillRect(cxx - 8, cyt - 8, cyw + 16, cyh + 16);
    g.fillStyle = '#F7F7F5'; g.fillRect(cxx, cyt, cyw, cyh);
    g.fillStyle = '#E30613'; g.fillRect(cxx + cyw * 0.18, cyt + cyh * 0.16, cyw * 0.64, cyh * 0.68);
    // small black canvas beside it
    g.fillStyle = '#111'; g.fillRect(W * 0.64, H * 0.20, W * 0.10, H * 0.16);
    // track spotlight beam
    g.save(); g.globalAlpha = 0.14; g.fillStyle = '#fffbe8';
    g.beginPath();
    g.moveTo(W * 0.44, 0); g.lineTo(W * 0.50, 0);
    g.lineTo(W * 0.58, cyt + cyh); g.lineTo(W * 0.36, cyt + cyh);
    g.closePath(); g.fill();
    g.restore();
    roomGlow(g, cxx + cyw / 2, cyt + cyh / 2, 150, 'rgba(255,250,230,0.7)', 0.8);
    roomGlow(g, cxx + cyw / 2, hy + 50, 260, 'rgba(255,250,230,0.35)', 0.7);
    // black bench silhouette
    g.fillStyle = '#1a1a1a';
    g.fillRect(W * 0.30, hy - H * 0.085, W * 0.30, H * 0.028);
    g.fillRect(W * 0.33, hy - H * 0.057, W * 0.015, H * 0.057);
    g.fillRect(W * 0.555, hy - H * 0.057, W * 0.015, H * 0.057);
    // wall label plaque
    g.fillStyle = '#fff'; g.fillRect(W * 0.60, H * 0.40, W * 0.10, H * 0.05);
    g.fillStyle = '#111'; g.fillRect(W * 0.615, H * 0.415, W * 0.07, 3);
    g.fillRect(W * 0.615, H * 0.43, W * 0.045, 3);
  },
  drawRails(ctx) {
    // black anodized aluminum, red pinstripe
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#2c2c2e'); g.addColorStop(0.5, '#171718'); g.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = g;
    ctx.fillRect(TX0, TY0, PW + RAIL * 2, PH + RAIL * 2);
    brushedMetal(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, false);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // red pinstripe inner edge
    ctx.save();
    ctx.strokeStyle = '#E30613'; ctx.lineWidth = 4;
    ctx.strokeRect(PX - 4, PY - 4, PW + 8, PH + 8);
    ctx.restore();
    // black outer pinline
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2;
    ctx.strokeRect(TX0 + 8, TY0 + 8, PW + RAIL * 2 - 16, PH + RAIL * 2 - 16);
    ctx.restore();
  },
  drawSurface(ctx) {
    if (!this._tile) this._tile = noiseTile('#F7F7F5', ['#efefec', '#ffffff', '#e6e6e2'], 900, 0.08);
    tileOver(ctx, this._tile, PX, PY, PW, PH, 1);
    // the Swiss grid, faint
    ctx.save();
    ctx.strokeStyle = 'rgba(17,17,17,0.07)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(PX, PY, PW, PH); ctx.clip();
    for (let x = PX; x <= PX + PW; x += 44) { ctx.beginPath(); ctx.moveTo(x, PY); ctx.lineTo(x, PY + PH); ctx.stroke(); }
    for (let y = PY; y <= PY + PH; y += 44) { ctx.beginPath(); ctx.moveTo(PX, y); ctx.lineTo(PX + PW, y); ctx.stroke(); }
    ctx.restore();
    const g = ctx.createLinearGradient(PX, PY, PX, PY + PH);
    g.addColorStop(0, 'rgba(255,255,255,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
  },
  drawMarkings(ctx) {
    ctx.save();
    // strict black rules, one red dot
    ctx.strokeStyle = '#111111'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(CX, PY + 14); ctx.lineTo(CX, PY + PH - 14); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(CX, CY, 62, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#E30613';
    ctx.beginPath(); ctx.arc(CX, CY, 12, 0, TAU); ctx.fill();
    // face-off crosses
    ctx.strokeStyle = '#111111'; ctx.lineWidth = 5; ctx.lineCap = 'square';
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.beginPath();
        ctx.moveTo(fx - 9, fy); ctx.lineTo(fx + 9, fy);
        ctx.moveTo(fx, fy - 9); ctx.lineTo(fx, fy + 9);
        ctx.stroke();
      }
    // red goal-crease ticks
    ctx.strokeStyle = '#E30613'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(PX, CY, 74, -0.5, 0.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(PX + PW, CY, 74, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke();
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    // black posts, red square caps
    ctx.fillStyle = '#111111';
    ctx.fillRect(x - 6, cy - w / 2 - 10, 12, w + 20);
    ctx.fillStyle = '#E30613';
    ctx.fillRect(x - 9, cy - w / 2 - 16, 18, 12);
    ctx.fillRect(x - 9, cy + w / 2 + 4, 18, 12);
    ctx.restore();
  },
};

THEMES.bau = THEME_BAUHAUS;
THEMES.zel = THEME_ZEL;
THEMES.swi = THEME_SUISSE;

/* ================= 10. NEON MIDNIGHT =================
   Classic neon / glow-in-the-dark: near-black felt, neon-tube rails,
   a glowing puck with a light-tube trail. Neon is painted as layered
   strokes (wide faint halo + bright core), cheaper than shadowBlur
   and truer to a real tube. */
function neonTube(ctx, draw, color, core) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = color; ctx.globalAlpha = 0.22; ctx.lineWidth = (core || 3) + 9;
  draw(); ctx.stroke();
  ctx.globalAlpha = 0.45; ctx.lineWidth = (core || 3) + 4;
  draw(); ctx.stroke();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, (core || 3) * 0.45);
  draw(); ctx.stroke();
  ctx.restore();
}
const THEME_NEON = {
  id: 'neon', name: 'Neon Midnight', tagline: 'Black glass · neon tubes · the after-hours arcade',
  font: { display: 'Impact, "Arial Black", "Helvetica Neue", sans-serif', body: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  ink: '#e8fbff', accent: '#00f0ff', gold: '#ffe14d', particle: '#7df9ff', trail: '#00f0ff', trailGlow: '#00f0ff',
  flash: 'rgba(0,240,255,1)', vignette: 'rgba(0,0,0,0.55)',
  goalChord: [110.0, 130.81, 164.81, 220.0],
  scoreboard: 'neon',
  board: { housing: '#0a0c12', housingHi: '#161b28', digit: '#00f0ff', digitDim: '#ff2fb3',
           ink: '#bfefff', accent: '#ff2fb3', plate: '#10141f', plateInk: '#ffe14d' },
  puck: { hi: '#2a3a5c', body: '#0b0e18', edge: '#02030a', ring: '#00f0ff', glow: '#00e5ff' },
  mallet: { hi: '#3a4666', base: '#12151f', edge: '#05060c', ring: '#00f0ff', dish: '#0a0d16', dishHi: '#232c44', knob: '#ff2fb3', knobHi: '#ff7ad4' },
  css: { pageBg: '#030408', panelBg: 'rgba(8,12,22,0.96)', panelBorder: '#00f0ff', btnBg: '#00f0ff', btnInk: '#02141a', title: '#e8fbff', sub: '#5f7f95', ghost: 'rgba(0,240,255,0.14)' },

  drawRoom(ctx) {
    const g = ctx.createRadialGradient(VW / 2, VH / 2, 100, VW / 2, VH / 2, 780);
    g.addColorStop(0, '#0a0d18'); g.addColorStop(0.55, '#05070e'); g.addColorStop(1, '#020308');
    ctx.fillStyle = g; ctx.fillRect(-200, -200, VW + 400, VH + 400);
    // sparse starfield, faint, classy, never busy
    const R = mulberry32(1983);
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const x = R() * (VW + 400) - 200, y = R() * (VH + 400) - 200, r = R() * 1.3 + 0.3;
      ctx.fillStyle = 'rgba(160,220,255,' + (0.05 + R() * 0.10).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
  paintRoom(g, W, H) {
    // The arcade after hours, near-black room, neon spill from offscreen signs
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#070a12'); bg.addColorStop(1, '#03040a');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const spill = (x, color) => {
      const sg = g.createRadialGradient(x, H * 0.12, 10, x, H * 0.12, W * 0.28);
      sg.addColorStop(0, color); sg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H * 0.5);
    };
    spill(W * 0.16, 'rgba(0,240,255,0.10)');
    spill(W * 0.84, 'rgba(255,47,179,0.10)');
    // faint floor grid fading into the dark
    g.save(); g.strokeStyle = 'rgba(0,240,255,0.05)'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 56) { g.beginPath(); g.moveTo(x, H * 0.55); g.lineTo(x, H); g.stroke(); }
    for (let y = H * 0.55; y < H; y += 34) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.restore();
  },
  drawRails(ctx) {
    // dark rail body
    const g = ctx.createLinearGradient(TX0, TY0, TX0, TY0 + PH + RAIL * 2);
    g.addColorStop(0, '#141824'); g.addColorStop(0.5, '#0a0d16'); g.addColorStop(1, '#05070d');
    rr(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 26); ctx.fillStyle = g; ctx.fill();
    // cut out playfield
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 8); ctx.fill();
    ctx.restore();
    // neon tubes: cyan outer pinline, magenta inner edge
    neonTube(ctx, () => { rr(ctx, TX0 + 10, TY0 + 10, PW + RAIL * 2 - 20, PH + RAIL * 2 - 20, 20); }, 'rgba(0,240,255,0.9)', 3);
    neonTube(ctx, () => { rr(ctx, PX - 4, PY - 4, PW + 8, PH + 8, 8); }, 'rgba(255,47,179,0.9)', 3.5);
  },
  drawSurface(ctx) {
    const g = ctx.createLinearGradient(PX, PY, PX + PW, PY + PH);
    g.addColorStop(0, '#070a12'); g.addColorStop(0.5, '#04060c'); g.addColorStop(1, '#02040a');
    ctx.fillStyle = g; ctx.fillRect(PX, PY, PW, PH);
    // faint glow grid etched in the glass, barely there
    ctx.save(); ctx.strokeStyle = 'rgba(0,240,255,0.055)'; ctx.lineWidth = 1;
    for (let x = PX; x <= PX + PW; x += 64) { ctx.beginPath(); ctx.moveTo(x, PY); ctx.lineTo(x, PY + PH); ctx.stroke(); }
    for (let y = PY; y <= PY + PH; y += 64) { ctx.beginPath(); ctx.moveTo(PX, y); ctx.lineTo(PX + PW, y); ctx.stroke(); }
    ctx.restore();
  },
  drawMarkings(ctx) {
    ctx.save();
    neonTube(ctx, () => { ctx.beginPath(); ctx.moveTo(CX, PY + 14); ctx.lineTo(CX, PY + PH - 14); }, 'rgba(0,240,255,0.85)', 2.5);
    neonTube(ctx, () => { ctx.beginPath(); ctx.arc(CX, CY, 62, 0, TAU); }, 'rgba(255,47,179,0.85)', 2.5);
    // face-off dots, warm yellow, no tube (contrast beat)
    ctx.fillStyle = '#ffe14d';
    ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 12;
    for (const fx of [PX + PW * 0.25, PX + PW * 0.75])
      for (const fy of [PY + PH * 0.28, PY + PH * 0.72]) {
        ctx.beginPath(); ctx.arc(fx, fy, 5, 0, TAU); ctx.fill();
      }
    ctx.shadowBlur = 0;
    // goal creases
    neonTube(ctx, () => { ctx.beginPath(); ctx.arc(PX, CY, 74, -0.72, 0.72); }, 'rgba(0,240,255,0.7)', 2);
    neonTube(ctx, () => { ctx.beginPath(); ctx.arc(PX + PW, CY, 74, Math.PI - 0.72, Math.PI + 0.72); }, 'rgba(0,240,255,0.7)', 2);
    ctx.restore();
  },
  drawGoalTrim(ctx, side, gx, cy, w) {
    ctx.save();
    const x = side === 0 ? gx - RAIL + 8 : gx + RAIL - 8;
    neonTube(ctx, () => { ctx.beginPath(); ctx.moveTo(x, cy - w / 2); ctx.lineTo(x, cy + w / 2); }, 'rgba(255,47,179,0.9)', 4);
    ctx.fillStyle = '#ffe14d'; ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, cy - w / 2, 5, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy + w / 2, 5, 0, TAU); ctx.fill();
    ctx.restore();
  },
};

THEMES.neon = THEME_NEON;

let THEME = THEMES['deco'];
