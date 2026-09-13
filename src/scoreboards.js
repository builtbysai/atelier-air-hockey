/* ============================================================
   ATELIER AIR HOCKEY — scoreboards
   Physical scoring devices, one per theme. The engine owns the
   animation state (G.board); each renderer is a pure draw call.

   Draw contract:
     draw(ctx, s0, s1, target, trim, B, labels)
     - trim: per-theme palette for the device
     - B: { shown:[a,b], anim:[{t,from},{t,from}] } — t goes 0→1
     - labels: ['YOU','CPU'] or ['P1','P2']
   Anchor: top-center of virtual space (y=8). The engine's portrait
   rotation handles orientation; every device fits ~400×110.
   ============================================================ */

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBackS(t) { const c = 1.2; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

const Scoreboards = {

  /* ---------- SOLARI split-flap (default) ----------
     Gino Valle, 1956. Dark steel housings, off-white flaps,
     brass target plate, amber MP glow at match point. */
  solari: {
    draw(ctx, s0, s1, target, trim, B, labels) {
      const T = Object.assign({
        housing: '#26262b', housingHi: '#3a3a40', flap: '#17171a',
        ink: '#f0e9d6', accent: '#c9a227', plate: '#8a6d2f', plateInk: '#241a10',
        seam: 'rgba(0,0,0,0.85)',
      }, trim || {});
      const y = 8, modW = 148, modH = 76, gap = 18;
      const scores = [s0, s1];
      for (let i = 0; i < 2; i++) {
        const cx = CX + (i === 0 ? -1 : 1) * (modW / 2 + gap / 2 + 8);
        const hx = cx - modW / 2 - 9, hy = y, hw = modW + 18, hh = modH + 30;
        const mp = scores[i] === target - 1;
        ctx.save();
        if (mp) { ctx.shadowColor = 'rgba(255,170,60,0.9)'; ctx.shadowBlur = 22; }
        rr(ctx, hx, hy, hw, hh, 10);
        const hg = ctx.createLinearGradient(hx, hy, hx, hy + hh);
        hg.addColorStop(0, T.housingHi); hg.addColorStop(0.5, T.housing); hg.addColorStop(1, '#0c0c0e');
        ctx.fillStyle = hg; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        // corner rivets
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        for (const [rx, ry] of [[hx + 7, hy + 7], [hx + hw - 7, hy + 7], [hx + 7, hy + hh - 7], [hx + hw - 7, hy + hh - 7]]) {
          ctx.beginPath(); ctx.arc(rx, ry, 2.4, 0, TAU); ctx.fill();
        }
        const fx = cx - modW / 2, fy = y + 9;
        // flap well
        ctx.fillStyle = '#000'; rr(ctx, fx - 3, fy - 3, modW + 6, modH + 6, 5); ctx.fill();
        const A = B.anim[i], shown = B.shown[i], from = A.from;
        const dig = d => String(d);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const drawDigit = (d, alpha, dy, sy) => {
          ctx.save();
          ctx.beginPath(); ctx.rect(fx, fy, modW, modH); ctx.clip();
          ctx.globalAlpha = alpha;
          const fg = ctx.createLinearGradient(fx, fy, fx, fy + modH);
          fg.addColorStop(0, T.flap); fg.addColorStop(1, '#000');
          ctx.fillStyle = fg; ctx.fillRect(fx, fy, modW, modH);
          ctx.translate(cx, fy + modH / 2 + (dy || 0)); ctx.scale(1, sy == null ? 1 : sy);
          ctx.font = '700 62px "Arial Narrow", Impact, sans-serif';
          ctx.fillStyle = T.ink;
          ctx.fillText(dig(d), 0, 2);
          ctx.restore();
        };
        if (A.t < 1 && from !== shown) {
          // new digit sits behind; old flap falls away from the seam
          drawDigit(shown, 1);
          const k = clamp(A.t / 0.55, 0, 1);
          ctx.save();
          ctx.beginPath(); ctx.rect(fx, fy, modW, modH / 2); ctx.clip();
          drawDigit(from, 1 - k * 0.4, 0, Math.max(0.001, 1 - k));
          ctx.restore();
          ctx.save();
          ctx.beginPath(); ctx.rect(fx, fy + modH / 2, modW, modH / 2); ctx.clip();
          drawDigit(from, 1 - k, 0, 1);
          ctx.restore();
        } else {
          drawDigit(shown, 1);
        }
        // center seam
        ctx.fillStyle = T.seam; ctx.fillRect(fx, fy + modH / 2 - 1, modW, 2);
        // label + MP tag
        ctx.fillStyle = 'rgba(240,233,214,0.55)';
        ctx.font = '600 13px Georgia, serif';
        ctx.fillText(labels[i], cx, hy + hh - 9);
        if (mp) {
          ctx.fillStyle = '#ffb43c';
          ctx.font = '700 12px "Arial Narrow", sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('MP', hx + hw - 8, hy + 13);
          ctx.textAlign = 'center';
        }
        ctx.restore();
      }
      // engraved target plate
      const pw = 190, px = CX - pw / 2, py = y + modH + 34;
      ctx.save();
      rr(ctx, px, py, pw, 22, 4);
      const pg = ctx.createLinearGradient(px, py, px, py + 22);
      pg.addColorStop(0, T.accent); pg.addColorStop(1, T.plate);
      ctx.fillStyle = pg; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = T.plateInk;
      ctx.font = '600 12px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('F I R S T   T O   ' + target, CX, py + 12);
      ctx.restore();
    }
  },

  /* ---------- SCORE REEL (EM pinball drums) ----------
     Palm Springs '62 + Memphis. Cream drum rolls vertically,
     ratchet overshoot, red jewel lamp at match point. */
  reels: {
    draw(ctx, s0, s1, target, trim, B, labels) {
      const T = Object.assign({
        frame: '#f5f0e6', frameEdge: '#4a3826', drum: '#f7f2e7',
        drumShade: '#d9d2bd', ink: '#2b2118', jewel: '#d93a2b',
      }, trim || {});
      const y = 8, winW = 130, winH = 76, gap = 26;
      const scores = [s0, s1];
      for (let i = 0; i < 2; i++) {
        const cx = CX + (i === 0 ? -1 : 1) * (winW / 2 + gap / 2 + 12);
        const fx = cx - winW / 2 - 10, fy = y, fw = winW + 20, fh = winH + 34;
        const mp = scores[i] === target - 1;
        ctx.save();
        rr(ctx, fx, fy, fw, fh, 8);
        ctx.fillStyle = T.frame; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = T.frameEdge; ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        rr(ctx, fx + 5, fy + 5, fw - 10, fh - 10, 5); ctx.stroke();
        const wx = cx - winW / 2, wy = y + 8;
        // drum window
        ctx.save();
        rr(ctx, wx, wy, winW, winH, 4);
        ctx.clip();
        const A = B.anim[i], shown = B.shown[i], from = A.from;
        const k = A.t < 1 && from !== shown ? easeOutBackS(clamp(A.t, 0, 1)) : 1;
        const off = lerp(from, shown, k) * winH;
        ctx.fillStyle = T.drum; ctx.fillRect(wx, wy - winH, winW, winH * 3);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '700 62px "Arial Narrow", Impact, sans-serif';
        for (let d = -1; d <= 12; d++) {
          const dy = wy + winH / 2 + d * winH - off;
          if (dy < wy - winH || dy > wy + winH * 2) continue;
          const near = Math.abs(d - lerp(from, shown, k)) < 0.5;
          ctx.globalAlpha = near ? 1 : 0.45;
          ctx.fillStyle = T.ink;
          ctx.fillText(String(d < 0 ? 0 : d), cx, dy + 2);
        }
        ctx.globalAlpha = 1;
        // cylindrical shading
        const sg = ctx.createLinearGradient(wx, wy, wx, wy + winH);
        sg.addColorStop(0, 'rgba(0,0,0,0.42)'); sg.addColorStop(0.22, 'rgba(0,0,0,0)');
        sg.addColorStop(0.78, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = sg; ctx.fillRect(wx, wy, winW, winH);
        ctx.restore();
        rr(ctx, wx, wy, winW, winH, 4);
        ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
        // jewel lamp at match point
        if (mp) {
          const jx = fx + fw - 14, jy = fy + 14;
          const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 160);
          ctx.save();
          ctx.shadowColor = T.jewel; ctx.shadowBlur = 16 * pulse;
          const jg = ctx.createRadialGradient(jx, jy, 1, jx, jy, 9);
          jg.addColorStop(0, '#fff'); jg.addColorStop(0.4, T.jewel); jg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = jg;
          ctx.beginPath(); ctx.arc(jx, jy, 9, 0, TAU); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = T.frameEdge;
        ctx.font = '600 13px Georgia, serif'; ctx.textAlign = 'center';
        ctx.fillText(labels[i], cx, fy + fh - 10);
        ctx.restore();
      }
      // narrow TO reel for the target
      const tw = 74, tx = CX - tw / 2, ty = y + winH + 40;
      ctx.save();
      rr(ctx, tx, ty, tw, 24, 4);
      ctx.fillStyle = T.frame; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = T.frameEdge; ctx.stroke();
      ctx.fillStyle = T.ink;
      ctx.font = '700 17px "Arial Narrow", Impact, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TO ' + target, CX, ty + 13);
      ctx.restore();
    }
  },

  /* ---------- CRIBBAGE PEGS ----------
     The Billiard Room. Mahogany board, brass pegs leapfrogging
     along drilled tracks; gold game-hole ring at the target. */
  cribbage: {
    draw(ctx, s0, s1, target, trim, B, labels) {
      const T = Object.assign({
        board: '#5a3a22', boardHi: '#7a5230', hole: '#160e06',
        peg: '#d8a93f', pegHi: '#f4dfa0', ring: '#c9a227',
      }, trim || {});
      const y = 10, bw = 400, bh = 84, bx = CX - bw / 2;
      const N = Math.max(11, target + 1), scores = [s0, s1];
      ctx.save();
      rr(ctx, bx, y, bw, bh, 8);
      const bg = ctx.createLinearGradient(bx, y, bx, y + bh);
      bg.addColorStop(0, T.boardHi); bg.addColorStop(1, T.board);
      ctx.fillStyle = bg; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
      // brass corner inlays
      ctx.fillStyle = T.ring;
      for (const [ix, iy] of [[bx + 9, y + 9], [bx + bw - 9, y + 9], [bx + 9, y + bh - 9], [bx + bw - 9, y + bh - 9]]) {
        ctx.beginPath(); ctx.arc(ix, iy, 3.4, 0, TAU); ctx.fill();
      }
      const trackY = i => y + 22 + i * 30;
      const holeX = n => bx + 46 + n * ((bw - 92) / (N - 1));
      for (let i = 0; i < 2; i++) {
        const ty = trackY(i);
        // game-hole ring at the target
        const mp = scores[i] === target - 1;
        ctx.save();
        if (mp) { ctx.shadowColor = T.ring; ctx.shadowBlur = 10 + 6 * Math.sin(performance.now() / 300); }
        ctx.strokeStyle = T.ring; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(holeX(target), ty, 10.5, 0, TAU); ctx.stroke();
        ctx.restore();
        for (let n = 0; n < N; n++) {
          const hx = holeX(n);
          ctx.fillStyle = T.hole;
          ctx.beginPath(); ctx.arc(hx, ty, 6.4, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.beginPath(); ctx.arc(hx - 1.6, ty - 1.6, 2.2, 0, TAU); ctx.fill();
        }
        const A = B.anim[i], shown = B.shown[i], from = A.from;
        const peg = (n, alpha, hopK) => {
          let px = holeX(clamp(n, 0, N - 1)), py = ty;
          if (hopK != null && hopK < 1) {
            const x0 = holeX(clamp(from, 0, N - 1));
            px = lerp(x0, px, hopK);
            py = ty - Math.sin(hopK * Math.PI) * 16;
          }
          ctx.save();
          ctx.globalAlpha = alpha;
          const pg = ctx.createRadialGradient(px - 2, py - 3, 1, px, py, 8);
          pg.addColorStop(0, T.pegHi); pg.addColorStop(0.55, T.peg); pg.addColorStop(1, '#6a4a12');
          ctx.fillStyle = pg;
          ctx.beginPath(); ctx.arc(px, py, 7.6, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath(); ctx.arc(px - 2.4, py - 2.8, 1.8, 0, TAU); ctx.fill();
          ctx.restore();
        };
        // rear peg marks the previous score (authentic leapfrog)
        if (shown > 0) peg(shown - 1, 0.45);
        if (A.t < 1 && from !== shown) peg(shown, 1, easeOutCubic(clamp(A.t / 0.6, 0, 1)));
        else peg(shown, 1);
        ctx.fillStyle = 'rgba(240,230,200,0.6)';
        ctx.font = '600 12px Georgia, serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(labels[i], bx + 10, ty);
      }
      ctx.fillStyle = 'rgba(240,230,200,0.5)';
      ctx.font = '600 11px Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillText('G A M E', CX, y + bh - 8);
      ctx.restore();
    }
  },

  /* ---------- GRANDSTAND BULBS ----------
     Beton. Riveted steel cabinet, 5×7 incandescent matrices,
     flicker-on animation, bulb-chase pulse at match point. */
  bulbs: {
    draw(ctx, s0, s1, target, trim, B, labels) {
      const T = Object.assign({
        cab: '#2a2c2e', cabHi: '#3d4043', bulb: '#ffcf7a',
        bulbDim: '#3a3a3a', bolt: '#17181a',
      }, trim || {});
      // 5×7 bitmask font, rows top→bottom
      const FONT = {
        '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
        '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
        '2': [0x0E, 0x11, 0x01, 0x0E, 0x10, 0x10, 0x1F],
        '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
        '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
        '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
        '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
        '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
        '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
        '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
      };
      const y = 8, bw = 400, bh = 96, bx = CX - bw / 2;
      const scores = [s0, s1];
      ctx.save();
      rr(ctx, bx, y, bw, bh, 6);
      const cg = ctx.createLinearGradient(bx, y, bx, y + bh);
      cg.addColorStop(0, T.cabHi); cg.addColorStop(1, T.cab);
      ctx.fillStyle = cg; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      ctx.fillStyle = T.bolt;
      for (const [qx, qy] of [[bx + 8, y + 8], [bx + bw - 8, y + 8], [bx + 8, y + bh - 8], [bx + bw - 8, y + bh - 8]]) {
        ctx.beginPath(); ctx.arc(qx, qy, 3, 0, TAU); ctx.fill();
      }
      const digit = (d, dx, dy, cell, animK, seed) => {
        const rows = FONT[String(clamp(d, 0, 9))];
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 5; c++) {
            const on = (rows[r] >> (4 - c)) & 1;
            const px = dx + c * cell, py = dy + r * cell;
            if (!on) {
              ctx.fillStyle = T.bulbDim;
              ctx.beginPath(); ctx.arc(px, py, cell * 0.30, 0, TAU); ctx.fill();
              continue;
            }
            // staggered ramp-on with one-frame flicker
            let a = 1;
            if (animK < 1) {
              const stagger = ((r * 5 + c + seed) % 35) / 35 * 0.5;
              const local = clamp((animK - stagger) / 0.5, 0, 1);
              a = local <= 0 ? 0 : (local < 0.25 ? (Math.random() < 0.5 ? 0.3 : 0.9) : local);
            }
            if (a <= 0) {
              ctx.fillStyle = T.bulbDim;
              ctx.beginPath(); ctx.arc(px, py, cell * 0.30, 0, TAU); ctx.fill();
              continue;
            }
            ctx.save();
            ctx.globalAlpha = a;
            ctx.shadowColor = T.bulb; ctx.shadowBlur = 10;
            const bg2 = ctx.createRadialGradient(px, py, 0.5, px, py, cell * 0.42);
            bg2.addColorStop(0, '#fff6e0'); bg2.addColorStop(0.5, T.bulb); bg2.addColorStop(1, 'rgba(255,160,60,0.15)');
            ctx.fillStyle = bg2;
            ctx.beginPath(); ctx.arc(px, py, cell * 0.42, 0, TAU); ctx.fill();
            ctx.restore();
          }
        }
      };
      const cell = 9, dw = 5 * cell, dh = 7 * cell;
      for (let i = 0; i < 2; i++) {
        const cx = CX + (i === 0 ? -1 : 1) * 108;
        const A = B.anim[i], shown = B.shown[i];
        const animK = A.t < 1 && A.from !== shown ? clamp(A.t / 0.7, 0, 1) : 1;
        const mp = scores[i] === target - 1;
        if (mp) {
          // bulb-chase pulse: warm halo breathing around the digit
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 280);
          ctx.save();
          ctx.shadowColor = T.bulb; ctx.shadowBlur = 26 * pulse;
          ctx.strokeStyle = 'rgba(255,207,122,' + (0.35 + 0.4 * pulse).toFixed(2) + ')';
          ctx.lineWidth = 3;
          rr(ctx, cx - dw / 2 - 8, y + 12, dw + 16, dh + 8, 6); ctx.stroke();
          ctx.restore();
        }
        const chars = String(Math.max(0, Math.min(99, Math.round(shown))));
        const dc = chars.length > 1 ? 6 : cell;
        const totalW = chars.length * (5 * dc) + Math.max(0, chars.length - 1) * dc;
        chars.split('').forEach((ch, di) =>
          digit(+ch, cx - totalW / 2 + dc / 2 + di * 6 * dc, y + 16 + (chars.length > 1 ? 9 : 0), dc, animK, i * 17 + di));
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], cx, y + bh - 9);
      }
      // small TO target matrix
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '700 15px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('TO ' + target, CX, y + bh / 2);
      ctx.restore();
    }
  },
};

/* engine-side animation state */
function freshBoard() {
  return { shown: [0, 0], anim: [{ t: 1, from: 0 }, { t: 1, from: 0 }] };
}
function boardKick(side) {
  const Bd = G.board;
  Bd.anim[side] = { t: 0, from: Bd.shown[side] };
  Bd.shown[side] = G.score[side];
}
function tickBoard(rdt) {
  const Bd = G.board;
  for (let i = 0; i < 2; i++) {
    if (Bd.anim[i].t < 1) Bd.anim[i].t = Math.min(1, Bd.anim[i].t + rdt / 0.5);
  }
}
function drawScoreboard(ctx) {
  // ONLINE: labels by role — the local player is always "YOU"
  const labels = G.mode === '2p' ? ['P1', 'P2']
    : G.mode === 'online' ? [onlineSideLabel(0), onlineSideLabel(1)]
    : ['YOU', DIFFS[G.difficulty].name.toUpperCase()];
  const dev = Scoreboards[THEME.scoreboard] || Scoreboards.solari;
  dev.draw(ctx, G.score[0], G.score[1], Settings.firstTo, THEME.board, G.board, labels);
}
