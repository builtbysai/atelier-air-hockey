// ---------- themes ----------
const THEME_ORDER = ['deco', 'mid', 'brut', 'bil', 'mem', 'sashi', 'bau', 'zel', 'swi'];
function setTheme(id, silent) {
  if (!THEMES[id]) id = 'deco';
  THEME = THEMES[id];
  G.themeId = id; // the tour tracker needs to know which table just hosted a win
  if (!silent) {
    try {
      localStorage.setItem('atelier-ah-theme', id);
      const u = new URL(location.href); u.searchParams.set('table', id);
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { console.warn('Could not persist table selection', e); }
  }
  document.querySelectorAll('.tslide').forEach(el => {
    el.classList.toggle('sel', el.dataset.theme === id);
    el.setAttribute('aria-selected', el.dataset.theme === id ? 'true' : 'false');
  });
  carSync(id);
  const css = THEME.css, root = document.documentElement.style;
  root.setProperty('--pagebg', css.pageBg);
  root.setProperty('--panel', css.panelBg);
  root.setProperty('--pline', css.panelBorder);
  root.setProperty('--btnbg', css.btnBg);
  root.setProperty('--btnink', css.btnInk);
  root.setProperty('--title', css.title);
  root.setProperty('--sub', css.sub);
  root.setProperty('--ghost', css.ghost);
  root.setProperty('--display', THEME.font.display);
  root.setProperty('--body', THEME.font.body);
  document.title = THEME.name + ' — Atelier Air Hockey';
  paintRoom();
  AudioSys.ambience(id); // room ambience follows the room (deferred pre-gesture)
  if (!silent) AudioSys.ui();
}
function paintThumbnails() {
  document.querySelectorAll('canvas[data-thumb]').forEach(cv => {
    const id = cv.dataset.thumb, T = THEMES[id];
    if (!T) return;
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const k = Math.min(W / VW, H / VH);
    c.save();
    c.scale(k, k);
    c.translate((W / k - VW) / 2, (H / k - VH) / 2);
    T.drawRoom(c);
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
    c.fillStyle = '#000'; rr(c, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); c.fill();
    c.restore();
    T.drawRails(c); T.drawSurface(c); T.drawMarkings(c);
    T.drawGoalTrim(c, 0, PX, CY, goalW()); T.drawGoalTrim(c, 1, PX + PW, CY, goalW());
    // a mid-rally vignette: puck streaking, mallets poised
    c.save();
    c.strokeStyle = T.trail; c.globalAlpha = 0.5; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(CX - 190, CY + 60); c.quadraticCurveTo(CX, CY - 40, CX + 150, CY + 20); c.stroke();
    c.restore();
    const S = T.puck;
    const g = c.createRadialGradient(CX + 145, CY + 14, 2, CX + 150, CY + 20, PUCK_R);
    g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
    c.fillStyle = g;
    c.beginPath(); c.arc(CX + 150, CY + 20, PUCK_R, 0, TAU); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
    const M = T.mallet;
    const mg = c.createRadialGradient(CX - 285, CY + 108, 4, CX - 290, CY + 114, MALLET_R);
    mg.addColorStop(0, M.hi); mg.addColorStop(0.6, M.base); mg.addColorStop(1, M.edge);
    c.fillStyle = mg;
    c.beginPath(); c.arc(CX - 290, CY + 114, MALLET_R, 0, TAU); c.fill();
    c.lineWidth = 3; c.strokeStyle = M.ring; c.stroke();
    c.fillStyle = M.knob;
    c.beginPath(); c.arc(CX - 290, CY + 114, MALLET_R * 0.3, 0, TAU); c.fill();
    c.restore();
  });
}

// ---------- settings ----------
function setSetting(key, val) {
  // ONLINE: gameplay rules are agreed at match start (host->guest 'hello').
  // Lock them during an online match so peers can't desynchronize.
  if ((key === 'firstTo' || key === 'pace' || key === 'goalW') && G.mode === 'online' && (G.state === 'play' || G.state === 'count' || G.state === 'goal')) return;
  if (key === 'sound' || key === 'haptics') val = (val === 'true');
  if (key === 'firstTo') val = parseInt(val, 10);
  Settings[key] = val; saveSettings(); applySettingsToUI();
  // the menu's table thumbnails draw the goal mouth — repaint so the
  // preview always matches the chosen width
  if (key === 'goalW') { try { paintThumbnails(); } catch (e) {} }
}
function applySettingsToUI() {
  document.querySelectorAll('[data-set]').forEach(btn => {
    const selected = String(Settings[btn.dataset.set]) === btn.dataset.val;
    btn.classList.toggle('sel', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  const canVibrate = typeof navigator.vibrate === 'function';
  document.querySelectorAll('[data-set="haptics"]').forEach(btn => {
    btn.disabled = !canVibrate;
    btn.title = canVibrate ? '' : 'Haptics are not available on this device';
  });
  AudioSys.muted = !Settings.sound;
  AudioSys.syncMute(); // keep the looped ambience bed under Mute too
  const sb = $('btnSound');
  if (sb) {
    sb.classList.toggle('off', !Settings.sound);
    sb.innerHTML = Settings.sound ? '&#9834;' : '&#215;';
    sb.setAttribute('aria-label', Settings.sound ? 'Mute sound' : 'Unmute sound');
    sb.title = Settings.sound ? 'Mute sound (M)' : 'Unmute sound (M)';
  }
  const ff = $('footFirst');
  if (ff) ff.innerHTML = 'First to <b>' + Settings.firstTo + '</b> takes the table';
  updateStartLabel(); // v21: the START MATCH sub-line carries the current first-to
  const hf = $('helpFirst');
  if (hf) hf.textContent = Settings.firstTo;
}


let settingsReturn = 'menu';
function openSettings(from = 'menu') {
  settingsReturn = from;
  AudioSys.ui(); hideAll(); $('settings').classList.remove('hidden');
}
function closeSettings() {
  AudioSys.ui(); hideAll();
  $(settingsReturn === 'pause' ? 'pauseov' : 'menu').classList.remove('hidden');
}

function renderProgress() {
  const body = $('progressBody'), summary = $('progressSummary');
  if (!body || !summary) return;
  const unlocked = FEATS.filter(f => Feats.data[f.id]).length;
  summary.textContent = Tour.count() + '/' + THEME_ORDER.length + ' tables conquered · ' + unlocked + '/' + FEATS.length + ' feats unlocked';
  const featRows = FEATS.map(f => '<div class="progress-item"><span>' + (Feats.data[f.id] ? '★ ' : '○ ') + f.name + '</span><span>' + f.desc + '</span></div>').join('');
  const tableRows = THEME_ORDER.map(id => '<div class="progress-item"><span>' + (Tour.won(id) ? '★ ' : '○ ') + THEMES[id].name + '</span><span>' + (Tour.data[id] || 0) + ' wins</span></div>').join('');
  body.innerHTML = '<div class="seclabel">ACHIEVEMENTS</div>' + featRows + '<div class="seclabel">TABLE TOUR</div>' + tableRows;
}
function shareResult() {
  const score = G.score[0] + '–' + G.score[1];
  const text = 'Atelier Air Hockey · ' + THEME.name + ' · ' + score;
  const url = location.origin + location.pathname + '?table=' + encodeURIComponent(G.themeId);
  if (navigator.share) navigator.share({ title: 'Atelier Air Hockey', text, url }).catch(e => { if (e && e.name !== 'AbortError') console.warn(e); });
  else if (navigator.clipboard) navigator.clipboard.writeText(text + ' · ' + url).then(() => { const b = $('btnShareResult'); if (b) { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Share result', 1400); } }).catch(e => console.warn(e));
}

const keyDrive = new Set();
let keyLast = performance.now();
function keyboardGamepadDrive(now) {
  const dt = Math.min(0.04, Math.max(0, (now - keyLast) / 1000)); keyLast = now;
  if ((G.state === 'play' || G.state === 'count') && !G.demo && G.mode !== 'watch') {
    const speed = 920;
    // Screen-space input -> rink-space: portrait rotates the rink 90°, onlineFlip mirrors x.
    // (Matches the inverse of the render transform in screenToRink.)
    const toRink = (sx, sy) => {
      let dx, dy;
      if (typeof view !== 'undefined' && view.portrait) { dx = -sy; dy = -sx; }
      else { dx = sx; dy = sy; }
      if (G.onlineFlip) dx = -dx;
      return [dx, dy];
    };
    const move = (m, left, right, up, down, lo, hi) => {
      const sx = (keyDrive.has(right) ? 1 : 0) - (keyDrive.has(left) ? 1 : 0);
      const sy = (keyDrive.has(down) ? 1 : 0) - (keyDrive.has(up) ? 1 : 0);
      if (!sx && !sy) return;
      let [dx, dy] = toRink(sx, sy);
      const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      m.tx = clamp(m.tx + dx * speed * dt, lo, hi);
      m.ty = clamp(m.ty + dy * speed * dt, PY + MALLET_R, PY + PH - MALLET_R);
    };
    const guestOwnsRight = G.mode === 'online' && Net.role === 'guest';
    const p1 = guestOwnsRight ? G.m2 : G.m1;
    const p1Lo = guestOwnsRight ? CX + MALLET_R : PX + MALLET_R;
    const p1Hi = guestOwnsRight ? PX + PW - MALLET_R : CX - MALLET_R;
    move(p1, 'KeyA', 'KeyD', 'KeyW', 'KeyS', p1Lo, p1Hi);
    if (G.mode === '2p') move(G.m2, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', CX + MALLET_R, PX + PW - MALLET_R);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const applyPad = (pad, m, lo, hi) => {
        if (!pad) return;
        const ax = Math.abs(pad.axes[0] || 0) > .18 ? pad.axes[0] : 0;
        const ay = Math.abs(pad.axes[1] || 0) > .18 ? pad.axes[1] : 0;
        if (ax || ay) {
          let [dx, dy] = toRink(ax, ay);
          m.tx = clamp(m.tx + dx * speed * dt, lo, hi); m.ty = clamp(m.ty + dy * speed * dt, PY + MALLET_R, PY + PH - MALLET_R);
        }
      };
      applyPad(pads[0], p1, p1Lo, p1Hi);
      if (G.mode === '2p' && pads[1]) applyPad(pads[1], G.m2, CX + MALLET_R, PX + PW - MALLET_R);
    } catch (e) {}
  }
  requestAnimationFrame(keyboardGamepadDrive);
}

// ---------- UI wiring ----------
/* table carousel: slides are built from THEME_ORDER so markup stays
   a single source of truth; scroll position <-> selected theme. */
let carGuard = false; // true while we scroll programmatically
function buildCarousel() {
  const track = $('carTrack'), dots = $('carDots');
  if (!track || track.children.length) return;
  track.setAttribute('role', 'listbox'); track.setAttribute('aria-label', 'Table selection');
  if (dots) dots.setAttribute('aria-hidden', 'true');
  THEME_ORDER.forEach((id, i) => {
    const T = THEMES[id];
    const d = document.createElement('div');
    d.className = 'tslide'; d.dataset.theme = id;
    d.setAttribute('role', 'option'); d.tabIndex = 0;
    d.setAttribute('aria-label', T.name + ' table');
    d.innerHTML = '<canvas data-thumb="' + id + '" width="640" height="400"></canvas>' +
      '<div class="tmeta"><div class="tname">' + T.name + '</div>' +
      '<div class="tsub">' + T.tagline + '</div></div>';
    const pick = () => { AudioSys.init(); setTheme(id); };
    d.addEventListener('click', pick);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      if (e.key === 'ArrowRight') carStep(1);
      if (e.key === 'ArrowLeft') carStep(-1);
    });
    track.appendChild(d);
    const dot = document.createElement('i');
    dot.addEventListener('click', () => carGo(i));
    dots.appendChild(dot);
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (carGuard) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(carFromScroll);
  }, { passive: true });
}
function carIndex() {
  const track = $('carTrack');
  if (!track || !track.children.length) return 0;
  const w = track.children[0].offsetWidth + 12;
  return Math.round(track.scrollLeft / w);
}
function carFromScroll() {
  const i = Math.max(0, Math.min(THEME_ORDER.length - 1, carIndex()));
  if (THEMES[THEME_ORDER[i]] !== THEME) setTheme(THEME_ORDER[i]);
  else carPaint(i);
}
function carPaint(i) {
  const dots = $('carDots');
  if (dots) [...dots.children].forEach((d, j) => d.classList.toggle('sel', j === i));
  const cc = $('carCount');
  if (cc) cc.textContent = (i + 1) + ' / ' + THEME_ORDER.length;
}
function carGo(i) {
  const track = $('carTrack');
  if (!track || !track.children.length) return;
  i = (i + THEME_ORDER.length) % THEME_ORDER.length;
  const w = track.children[0].offsetWidth + 12;
  carGuard = true;
  track.scrollTo({ left: i * w, behavior: 'smooth' });
  setTimeout(() => { carGuard = false; }, 450);
  setTheme(THEME_ORDER[i]);
}
function carStep(d) { carGo(carIndex() + d); }
/* called by setTheme — scrolls the track when the theme changed
   from anywhere else (deep link, settings restore). */
function carSync(id) {
  const i = THEME_ORDER.indexOf(id);
  carPaint(Math.max(0, i));
  const track = $('carTrack');
  if (!track || !track.children.length || i < 0) return;
  const w = track.children[0].offsetWidth + 12;
  if (Math.abs(track.scrollLeft - i * w) > 4) {
    carGuard = true;
    track.scrollTo({ left: i * w });
    setTimeout(() => { carGuard = false; }, 120);
  }
}
// ---------- menu selection (v21) ----------
// rival buttons select the matchup; the START MATCH button launches it.
// Online keeps its own lobby flow.
const MenuSel = { mode: 'ai', diff: 1, watch: { a: 1, b: 2 } };
function selectRival(mode, diff) {
  MenuSel.mode = mode;
  if (diff != null) MenuSel.diff = diff;
  document.querySelectorAll('[data-diff]').forEach(b => {
    const selected = mode === 'ai' && +b.dataset.diff === MenuSel.diff;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  $('btn2p').classList.toggle('selected', mode === '2p');
  $('btn2p').setAttribute('aria-pressed', mode === '2p' ? 'true' : 'false');
  $('btnWatch').classList.toggle('selected', mode === 'watch');
  $('btnWatch').setAttribute('aria-pressed', mode === 'watch' ? 'true' : 'false');
  $('watchSel').classList.toggle('hidden', mode !== 'watch');
  updateStartLabel();
}
function selectWatch(side, idx) {
  MenuSel.watch[side] = idx;
  document.querySelectorAll(`[data-side="${side}"]`).forEach(b => {
    const selected = +b.dataset.watch === idx;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  updateStartLabel();
}
function updateStartLabel() {
  const s = $('startSub'); if (!s) return;
  let rival;
  if (MenuSel.mode === '2p') rival = 'TWO PLAYERS';
  else if (MenuSel.mode === 'watch') {
    const names = ['ROOKIE', 'CLUB PRO', 'CHAMPION'];
    rival = names[MenuSel.watch.a] + ' vs ' + names[MenuSel.watch.b];
  }
  else rival = ['ROOKIE', 'CLUB PRO', 'CHAMPION'][MenuSel.diff];
  s.textContent = rival + ' · FIRST TO ' + Settings.firstTo;
}

function installDialogA11y() {
  let returnFocus = null;
  const visible = () => document.querySelector('.overlay[role="dialog"]:not(.hidden)');
  const focusables = dlg => [...dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
  const sync = () => {
    const dlg = visible();
    if (dlg) {
      if (!dlg.contains(document.activeElement)) {
        if (!returnFocus || !document.body.contains(returnFocus)) returnFocus = document.activeElement;
        const f = focusables(dlg)[0];
        if (f) requestAnimationFrame(() => f.focus({ preventScroll: true }));
      }
    } else if (returnFocus && document.body.contains(returnFocus)) {
      const f = returnFocus; returnFocus = null;
      requestAnimationFrame(() => f.focus({ preventScroll: true }));
    }
  };
  const obs = new MutationObserver(sync);
  document.querySelectorAll('.overlay[role="dialog"]').forEach(d => obs.observe(d, { attributes: true, attributeFilter: ['class'] }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const dlg = visible(); if (!dlg) return;
    const fs = focusables(dlg); if (!fs.length) { e.preventDefault(); return; }
    const first = fs[0], last = fs[fs.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);
}

/* ---------- in-game confirm dialog ----------
 * Replaces the native confirm() for Restart / Quit / Reset progress: same
 * decisions and triggers, but a themed, focus-trapped, keyboard-operable
 * surface. askConfirm resolves true on confirm, false on cancel or Esc. */
let confirmResolve = null, confirmReturn = null;
function askConfirm({ title, message, ok, ret }) {
  return new Promise(resolve => {
    confirmResolve = resolve;
    confirmReturn = ret || null;
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    $('confirmOk').textContent = ok;
    hideAll();
    $('confirmov').classList.remove('hidden');
  });
}
function settleConfirm(val) {
  const r = confirmResolve; confirmResolve = null;
  const ret = confirmReturn; confirmReturn = null;
  AudioSys.ui();
  if (ret) { hideAll(); $(ret).classList.remove('hidden'); }
  if (r) r(val);
}

function wireUI() {
  installDialogA11y();
  buildCarousel();
  $('carPrev').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(-1); });
  $('carNext').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(1); });
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('ai', +btn.dataset.diff); });
  });
  $('btn2p').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('2p'); });
  $('btnWatch').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('watch'); });
  document.querySelectorAll('[data-watch]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectWatch(btn.dataset.side, +btn.dataset.watch); });
  });
  // Initialize watch selector UI to defaults (Club Pro vs Champion)
  selectWatch('a', MenuSel.watch.a); selectWatch('b', MenuSel.watch.b);
  $('btnStart').addEventListener('click', () => {
    AudioSys.init(); AudioSys.ui();
    if (MenuSel.mode === 'watch') startGame('watch', MenuSel.watch);
    else startGame(MenuSel.mode, MenuSel.diff);
  });
  // ONLINE: the only entry point that touches the network — the Trystero
  // import happens inside, on the tap, never before.
  $('btnOnline').addEventListener('click', () => Net.openLobby());
  selectRival('ai', G.difficulty); // paint the initial selection + start label
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); setSetting(btn.dataset.set, btn.dataset.val); });
  });
  $('btnSettings').addEventListener('click', () => openSettings('menu'));
  $('btnPauseSettings').addEventListener('click', () => openSettings('pause'));
  $('settingsClose').addEventListener('click', closeSettings);
  $('btnHelp').addEventListener('click', () => { AudioSys.ui(); applySettingsToUI(); hideAll(); $('help').classList.remove('hidden'); });
  $('btnProgress').addEventListener('click', () => { AudioSys.ui(); renderProgress(); hideAll(); $('progress').classList.remove('hidden'); });
  $('progressClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnResetProgress').addEventListener('click', async () => {
    const ok = await askConfirm({
      title: 'Reset progress',
      message: 'Reset records, personal bests, achievements, and table-tour progress on this device?',
      ok: 'Reset everything', ret: 'progress',
    });
    if (!ok) return;
    [Record.key, Best.key, Feats.key, Tour.key].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    Record.load(); Best.load(); Feats.load(); Tour.load(); refreshRecordLines(); refreshTour(); renderProgress();
  });
  $('helpClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnPause').addEventListener('click', () => togglePause());
  $('btnResume').addEventListener('click', () => togglePause());
  $('btnRestart').addEventListener('click', async () => {
    if (G.score[0] || G.score[1]) {
      const ok = await askConfirm({
        title: 'Restart match',
        message: 'Restart this match and reset the score?',
        ok: 'Restart', ret: 'pauseov',
      });
      if (!ok) return;
    }
    restartMatch();
  });
  $('btnQuit').addEventListener('click', async () => {
    if (G.score[0] || G.score[1]) {
      const ok = await askConfirm({
        title: 'Quit match',
        message: 'Quit this match?',
        ok: 'Quit to menu', ret: 'pauseov',
      });
      if (!ok) return;
    }
    quitToMenu();
  });
  // ONLINE: rival-left overlay — back to the menu (leave() runs inside quitToMenu)
  $('dropMenu').addEventListener('click', quitToMenu);
  // in-game confirm dialog buttons
  $('confirmOk').addEventListener('click', () => settleConfirm(true));
  $('confirmCancel').addEventListener('click', () => settleConfirm(false));
  $('btnRematch').addEventListener('click', () => {
    AudioSys.ui();
    // ONLINE: a rematch needs the rival's accept — the host restarts on accept
    if (G.mode === 'online') Net.offerRematch();
    else if (G.mode === 'watch') startGame('watch', G.watch); // EXHIBITION: preserve the AI matchup
    else startGame(G.mode, G.difficulty);
  });
  $('btnWinMenu').addEventListener('click', quitToMenu);
  $('btnShareResult').addEventListener('click', shareResult);
  $('btnMenu2').addEventListener('click', () => {
    if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
    else if (G.state === 'pause') { hideAll(); $('pauseov').classList.remove('hidden'); }
    else quitToMenu();
  });
  $('btnSound').addEventListener('click', () => {
    AudioSys.init();
    setSetting('sound', String(!Settings.sound)); // persists; button UI syncs via applySettingsToUI
  });
  window.addEventListener('keydown', e => {
    const interactive = e.target && e.target.closest && e.target.closest('input, textarea, select, button, a, [role="option"], [contenteditable="true"]');
    if (interactive && e.key !== 'Escape') return;
    if (e.key === 'p' || e.key === 'P') togglePause();
    else if (e.key === 'm' || e.key === 'M') $('btnSound').click();
    else if (e.key === 'Escape') {
      if (!$('confirmov').classList.contains('hidden')) settleConfirm(false);
      else if (!$('help').classList.contains('hidden')) $('helpClose').click();
      else if (!$('settings').classList.contains('hidden')) $('settingsClose').click();
      else if (!$('progress').classList.contains('hidden')) $('progressClose').click();
      else if (!$('onlineov').classList.contains('hidden') && !Net.active) Net.cancelLobby();
      else if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
    }
    else if (e.key === 'Enter' && G.state === 'menu' && !$('menu').classList.contains('hidden')) {
      // v21: Enter on the menu launches the selected matchup
      AudioSys.init(); AudioSys.ui(); startGame(MenuSel.mode, MenuSel.diff);
    }
  });
  window.addEventListener('keydown', e => {
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code) && (G.state === 'play' || G.state === 'count')) { keyDrive.add(e.code); e.preventDefault(); }
  }, { passive: false });
  window.addEventListener('keyup', e => keyDrive.delete(e.code));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { keyDrive.clear(); if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true); }
  });
  window.addEventListener('blur', () => keyDrive.clear());
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let rzRAF = 0, rzT = 0;
  const onResize = () => {
    if (!rzRAF) rzRAF = requestAnimationFrame(() => { rzRAF = 0; resize(); });
    clearTimeout(rzT);
    rzT = setTimeout(resize, 120);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
}

// ---------- boot ----------
function boot() {
  loadSettings();
  Record.load(); Best.load(); Feats.load(); Tour.load();
  refreshRecordLines(); // paint any stored records under the menu buttons
  refreshTour(); // tour counter + conquered-table pips
  // accessibility: prefers-reduced-motion drops Shake to Subtle for the
  // session — unless the player explicitly chose a shake level — and
  // fxFlash() kills flashes, confetti, and room reactivity from then on.
  try {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      PRM.reduce = true;
      if (!PRM.userShake) Settings.shake = 'subtle';
    }
  } catch (e) {}
  resize(); wireUI(); applySettingsToUI();
  let initialTheme = 'deco';
  try { const savedTheme = localStorage.getItem('atelier-ah-theme'); if (savedTheme && THEMES[savedTheme]) initialTheme = savedTheme; } catch (e) {}
  setTheme(initialTheme, true);
  refreshTour();
  const paintLater = () => { try { paintThumbnails(); } catch (e) { console.warn('Thumbnail paint failed', e); } };
  if ('requestIdleCallback' in window) requestIdleCallback(paintLater, { timeout: 800 }); else setTimeout(paintLater, 0);
  resetPositions();
  G.ai1 = mkBrain(0, 1); G.ai2 = mkBrain(1, 1);
  // deep links: ?table=mid&play , ?table=bil&2p , ?demo
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('table') && THEMES[q.get('table')]) setTheme(q.get('table'), true);
    if (q.get('join')) { Net.openLobby(); Net.join(q.get('join')); try { const u = new URL(location.href); u.searchParams.delete('join'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {} }
    else if (q.has('play')) startGame('ai', G.difficulty);
    else if (q.has('2p')) startGame('2p');
    else if (q.has('demo')) { G.idleT = 99; }
  } catch (e) {}
  requestAnimationFrame(frame);
  requestAnimationFrame(keyboardGamepadDrive);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker registration failed', e));
}
document.addEventListener('DOMContentLoaded', boot);
