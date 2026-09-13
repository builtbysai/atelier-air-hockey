/* ============================================================
   ATELIER AIR HOCKEY — theme renderers, second set
   Memphis Milano '81 and Wabi-Sabi Sashiko, plus the shared
   screen-space room painters (pre-rendered offscreen by the
   engine on theme change / resize — one drawImage per frame).
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

/* Bacterio squiggle — the Memphis signature stroke */
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
  id: 'mem', name: 'Memphis Milano', tagline: 'Laminate confetti · squiggles · the loft party — 1981',
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
    // The Loft Party — gallery wall, terrazzo, pendant light
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
    // The Machiya — timber beams, shoji glow, tatami, lantern light
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
    // shoji screens — warm glowing lattice
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
    // hanging noren suggestion — indigo cloth strips
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
  // The Skyline Bar — black lacquer, brass inlay, ziggurat skyline
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
  // The Cabana — breeze-block, terrazzo, low desert sun, palm
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
  // The Bunker Gallery — board-formed concrete, skylight shaft, rust accent
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
  // The Century Club — bottle-green plaster, oak wainscot, billiard lamp
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
  // the billiard lamp — green shade + amber pool
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
