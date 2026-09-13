/* ============================================================
   ATELIER AIR HOCKEY — theme renderers
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
  id: 'deco', name: 'Noir Deco', tagline: 'Black lacquer · brass · walnut — the speakeasy table',
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
  id: 'mid', name: "Palm Springs '62", tagline: 'Walnut · brass · cream laminate — the Eichler game room',
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
  id: 'brut', name: 'Beton', tagline: 'Raw concrete · aluminum · safety orange — the bunker table',
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
  id: 'bil', name: 'The Billiard Room', tagline: 'Mahogany · brass · snooker green — the members\u2019 club table',
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
