// ---------- themes ----------
const THEME_ORDER = ['deco', 'mid', 'brut', 'bil', 'mem', 'sashi', 'bau', 'zel', 'swi', 'neon'];
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
  document.title = THEME.name + ': Atelier Air Hockey';
  paintRoom();
  if (typeof paintTableWarp === 'function') paintTableWarp(); // 2.5D static table re-warp
  AudioSys.ambience(id); // room ambience follows the room (deferred pre-gesture)
  MusicSys.setTable(id); // generative music follows the room too (crossfades)
  if (typeof refreshTour === 'function') refreshTour();
  if (typeof updateStartLabel === 'function') updateStartLabel();
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

// Orientation locking is best-effort. It is most consistently available in
// installed/fullscreen experiences; normal browser tabs keep responsive Auto.
function appDisplayMode() {
  try {
    return (window.matchMedia && (
      matchMedia('(display-mode: fullscreen)').matches ||
      matchMedia('(display-mode: standalone)').matches
    )) || navigator.standalone === true || !!document.fullscreenElement;
  } catch (e) { return false; }
}
let orientationLockRejected = false;
function canLockOrientation() {
  try {
    return !orientationLockRejected && appDisplayMode() &&
      !!(screen && screen.orientation && typeof screen.orientation.lock === 'function');
  } catch (e) { return false; }
}
function applyScreenOrientationPreference() {
  try {
    const so = screen && screen.orientation;
    if (!so) return;
    if (Settings.orientation === 'auto') {
      if (typeof so.unlock === 'function') so.unlock();
      return;
    }
    if (!appDisplayMode() || typeof so.lock !== 'function') return;
    const p = so.lock(Settings.orientation);
    if (p && p.catch) p.catch(() => {
      orientationLockRejected = true;
      try { applySettingsToUI(); } catch (e) {}
    });
  } catch (e) {
    orientationLockRejected = true;
  }
}

// ---------- runtime quality ----------
const WakeSys = {
  sentinel: null, requesting: false, retryAt: 0, requestId: 0,
  wanted() {
    return !!(navigator.wakeLock && !document.hidden && !G.focusLost && !G.demo &&
      (G.state === 'count' || G.state === 'play' || G.state === 'goal' || G.state === 'replay'));
  },
  async sync() {
    const want = this.wanted();
    if (!want) { this.release(); return; }
    if (this.sentinel || this.requesting || performance.now() < this.retryAt) return;
    this.requesting = true;
    const requestId = ++this.requestId;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // A pending request can resolve after visibilitychange or pagehide.
      // Release that late sentinel instead of retaining a lock off-screen.
      if (requestId !== this.requestId || !this.wanted()) {
        try { await sentinel.release(); } catch (e) {}
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
        this.retryAt = performance.now() + 1800;
      }, { once:true });
    } catch (e) {
      if (requestId === this.requestId) this.retryAt = performance.now() + 5000;
    } finally {
      if (requestId === this.requestId) this.requesting = false;
    }
  },
  release() {
    this.requestId++;
    this.requesting = false;
    const s = this.sentinel;
    this.sentinel = null;
    if (s) { try { const p = s.release(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  }
};

const UpdateSys = {
  reg: null, waiting: null, dismissed: false, wired: false,
  applying: false, controllerChanged: false, reloading: false,
  safeSurface() {
    const menu = G.state === 'menu' && !$('menu').classList.contains('hidden');
    const win = G.state === 'win' && !$('winov').classList.contains('hidden');
    return menu || win;
  },
  sync() {
    const el = $('updateReady');
    if (!el) return;
    if (this.controllerChanged && this.applying && this.safeSurface() && !this.reloading) {
      this.reloading = true;
      location.reload();
      return;
    }
    const show = !!(this.waiting || this.controllerChanged) && !this.dismissed && this.safeSurface();
    el.classList.toggle('hidden', !show);
  },
  ready(worker) {
    if (!worker) return;
    this.waiting = worker;
    this.dismissed = false;
    const b = $('btnApplyUpdate');
    if (b) { b.disabled = false; b.textContent = 'Update'; }
    this.sync();
  },
  install(reg) {
    this.reg = reg;
    if (reg.waiting && navigator.serviceWorker.controller) this.ready(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller)
          this.ready(reg.waiting || worker);
      });
    });
    if (!this.wired) {
      this.wired = true;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.controllerChanged = true;
        this.waiting = null;
        this.sync();
      });
    }
  },
  apply() {
    if (this.controllerChanged && !this.waiting) {
      this.reloading = true;
      location.reload();
      return;
    }
    if (!this.waiting) return;
    this.applying = true;
    const b = $('btnApplyUpdate');
    if (b) { b.disabled = true; b.textContent = 'Updating…'; }
    this.waiting.postMessage({ type:'SKIP_WAITING' });
  },
  dismiss() {
    this.dismissed = true;
    this.sync();
  }
};

// ---------- settings ----------
function syncReducedMotionPreference(reduce) {
  PRM.reduce = !!reduce;
  // System preference may choose the safe session default, but never overrides
  // a shake level the player explicitly picked and saved themselves.
  if (!PRM.userShake) Settings.shake = PRM.reduce ? 'subtle' : 'full';
}
function installReducedMotionPreference() {
  try {
    if (!window.matchMedia) return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    syncReducedMotionPreference(mq.matches);
    const onChange = e => {
      syncReducedMotionPreference(e.matches);
      applySettingsToUI();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) {}
}
function setSetting(key, val) {
  // ONLINE: gameplay rules are agreed at match start (host->guest 'hello').
  // Lock them during an online match so peers can't desynchronize.
  if ((key === 'firstTo' || key === 'pace' || key === 'goalW') && G.mode === 'online' && (G.state === 'play' || G.state === 'count' || G.state === 'goal')) return;
  if (key === 'haptics') val = (val === 'true');
  if (key === 'firstTo') val = parseInt(val, 10);
  if (key === 'soundVolume' || key === 'musicVolume') val = clamp(Math.round(Number(val) || 0), 0, 100);
  Settings[key] = val;
  if (key === 'shake') PRM.userShake = true;
  if (key === 'soundVolume' || key === 'musicVolume') {
    Settings.sound = Settings.soundVolume > 0;
    Settings.music = Settings.musicVolume > 0;
    Settings.masterMuted = !Settings.sound && !Settings.music;
    // Keep a useful restore point when sliders are adjusted directly. A
    // central mute snapshots the exact current mix separately in AudioSys.
    if (val > 0) Settings[key === 'soundVolume' ? 'soundBeforeMute' : 'musicBeforeMute'] = val;
  }
  saveSettings();
  if (key === 'touchOffset') resetTransientControls();
  applySettingsToUI();
  // the menu's table thumbnails draw the goal mouth - repaint so the
  // preview always matches the chosen width
  if (key === 'goalW') { try { paintThumbnails(); } catch (e) {} }
  if (key === 'orientation' || key === 'camera') applyScreenOrientationPreference();
  // Orientation and camera only change presentation. Physics, AI and net
  // state remain in the same flat rink coordinates.
  if (key === 'orientation' || key === 'camera') { try { resize(); } catch (e) {} }
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
  // Top-down can rotate internally on every browser. 2.5D can only force a
  // device orientation when the installed/fullscreen environment exposes a
  // working Screen Orientation lock, so never show a control that does nothing.
  const boardRow = $('boardRow'), orientationLabel = $('orientationLabel'), orientationNote = $('orientationNote');
  const topDown = Settings.camera === 'top', lockable25 = !topDown && canLockOrientation();
  if (boardRow) boardRow.classList.toggle('hidden', !topDown && !lockable25);
  if (orientationLabel) orientationLabel.textContent = topDown ? 'Board orientation' : 'Device orientation';
  if (orientationNote) {
    const explain = !topDown && !lockable25;
    orientationNote.classList.toggle('hidden', !explain);
    orientationNote.textContent = explain ? 'Rotate your device to change orientation in this camera view.' : '';
  }
  // ONLINE: match rules are agreed at match start - lock them mid-match so
  // peers can't desynchronize. setSetting also refuses these; the disabled
  // state makes the lock visible instead of a silent no-op.
  const rulesLocked = typeof G !== 'undefined' && G.mode === 'online' &&
    (G.state === 'play' || G.state === 'count' || G.state === 'goal');
  ['firstTo', 'pace', 'goalW'].forEach(k => {
    document.querySelectorAll('[data-set="' + k + '"]').forEach(btn => {
      btn.disabled = rulesLocked;
      btn.title = rulesLocked ? 'Match rules are locked during an online match' : '';
    });
  });
  AudioSys.syncPreferenceState();
  AudioSys.syncMute();
  AudioSys.syncMusic();
  AudioSys.syncMaster();
  MusicSys.syncEnabled();
  const sb = $('btnSound');
  if (sb) {
    sb.classList.toggle('off', Settings.masterMuted);
    sb.innerHTML = Settings.masterMuted ? '&#215;' : '&#9834;';
    sb.setAttribute('aria-label', Settings.masterMuted ? 'Unmute all audio' : 'Mute all audio');
    sb.title = Settings.masterMuted ? 'Unmute all (M)' : 'Mute all (M)';
  }
  updateStartLabel();
  const hf = $('helpFirst');
  if (hf) hf.textContent = Settings.firstTo;
  const paceLabel = ({ casual:'Casual', classic:'Classic', lightning:'Lightning' }[Settings.pace] || 'Classic');
  const goalLabel = ({ narrow:'Narrow', standard:'Standard', wide:'Wide' }[Settings.goalW] || 'Standard');
  const rs = $('ruleSumScore'), rp = $('ruleSumPace'), rg = $('ruleSumGoal');
  if (rs) rs.textContent = Settings.firstTo;
  if (rp) rp.textContent = paceLabel;
  if (rg) rg.textContent = goalLabel;
  const cf = $('ruleCurrentFirst'), cp = $('ruleCurrentPace'), cg = $('ruleCurrentGoal');
  if (cf) cf.textContent = 'First to ' + Settings.firstTo;
  if (cp) cp.textContent = paceLabel;
  if (cg) cg.textContent = goalLabel;
  const audioValueText = value => value === 0 ? 'Muted' : value + '%';
  const sv = $('soundVol'), svv = $('soundVolVal');
  if (sv) {
    if (document.activeElement !== sv) sv.value = Settings.soundVolume;
    sv.setAttribute('aria-valuetext', Settings.soundVolume === 0 ? 'Muted' : Settings.soundVolume + ' percent');
  }
  if (svv) svv.textContent = audioValueText(Settings.soundVolume);
  const mv = $('musicVol'), mvv = $('musicVolVal');
  if (mv) {
    if (document.activeElement !== mv) mv.value = Settings.musicVolume;
    mv.setAttribute('aria-valuetext', Settings.musicVolume === 0 ? 'Muted' : Settings.musicVolume + ' percent');
  }
  if (mvv) mvv.textContent = audioValueText(Settings.musicVolume);

  const touchCapable = (navigator.maxTouchPoints || 0) > 0 ||
    (window.matchMedia && matchMedia('(pointer:coarse)').matches);
  const touchRow = $('touchOffsetRow'), touchNote = $('touchOffsetNote');
  if (touchRow) touchRow.classList.toggle('hidden', !touchCapable);
  if (touchNote) {
    touchNote.classList.toggle('hidden', !touchCapable);
    const label = ({ low:'Low', medium:'Medium', high:'High' }[Settings.touchOffset] || 'Medium');
    touchNote.textContent = label + ' keeps the mallet ahead of your finger while preserving direct 1:1 dragging. The offset fades near rails and center so movement never gets stuck.';
  }
  const hint = $('hint');
  if (hint) hint.textContent = 'Drag behind your mallet to move';
  const touchFoot = $('touchControlHint');
  if (touchFoot) touchFoot.textContent = 'Drag behind the mallet · Tap pause for match controls';
  const helpTouch = $('helpTouchMove');
  if (helpTouch) helpTouch.innerHTML = '<b>Drag just behind your mallet.</b> It follows your finger directly while staying ahead of your thumb, so you can see puck contact and flick naturally.';
}


let settingsReturn = 'menu';
let activePreferenceTab = 'feel';
const PREFERENCE_TABS = ['feel', 'controls', 'audio', 'view'];

function showPreferenceTab(name, focus = false) {
  if (!PREFERENCE_TABS.includes(name)) name = 'feel';
  activePreferenceTab = name;
  document.querySelectorAll('[data-pref-tab]').forEach(btn => {
    const selected = btn.dataset.prefTab === name;
    btn.classList.toggle('sel', selected);
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    btn.tabIndex = selected ? 0 : -1;
    if (selected && focus) requestAnimationFrame(() => btn.focus({ preventScroll:true }));
  });
  document.querySelectorAll('[data-pref-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.prefPanel !== name);
  });
}

function openSettings(from = 'menu', tab = activePreferenceTab) {
  settingsReturn = from;
  AudioSys.ui();
  applySettingsToUI();
  showPreferenceTab(tab);
  hideAll();
  $('settings').classList.remove('hidden');
}
function closeSettings() {
  AudioSys.ui();
  hideAll();
  $(settingsReturn === 'pause' ? 'pauseov' : 'menu').classList.remove('hidden');
}

function openRules() {
  AudioSys.ui(); applySettingsToUI(); hideAll(); $('rules').classList.remove('hidden');
}
function closeRules() {
  AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden');
}

function masteryLabel(id) {
  const n = Mastery.level(id);
  return n >= 3 ? 'MASTERED' : n === 2 ? 'HOUSE STANDARD' : n === 1 ? 'ROOKIE CLEARED' : 'UNTESTED';
}
function renderWorkshopMenu() {
  for (const id of ['power','control','keeper','free']) {
    const el = document.querySelector('[data-workshop="' + id + '"]');
    const state = $('workshop' + id[0].toUpperCase() + id.slice(1) + 'State');
    const free = id === 'free', stage = free ? 0 : Workshop.stage(id), best = free ? '' : Workshop.bestLabel(id);
    if (el) el.classList.toggle('cleared', stage >= 1);
    if (state) {
      if (free) state.textContent = 'OPEN TABLE';
      else if (stage >= 3) state.textContent = 'MASTERED' + (best ? ' · PB ' + best : '');
      else if (stage > 0) state.textContent = stage + '/3 CLEARED' + (best ? ' · PB ' + best : '');
      else state.textContent = 'STAGE 1/3' + (best ? ' · PB ' + best : '');
    }
  }
}
function openWorkshop() {
  AudioSys.ui(); renderWorkshopMenu(); hideAll(); $('workshop').classList.remove('hidden');
}
function renderProgress() {
  const body = $('progressBody'), summary = $('progressSummary');
  if (!body || !summary) return;
  const openRooms = THEME_ORDER.filter(tableUnlocked).length;
  summary.textContent = openRooms + '/' + THEME_ORDER.length + ' rooms open · ' +
    Mastery.masteredCount() + ' tables mastered · ' + TableChallenges.count() + '/10 challenges · ' +
    Workshop.count() + '/3 drills cleared · ' + Workshop.masteredCount() + '/3 drills mastered';
  const featRows = FEATS.map(f => '<div class="progress-item"><span>' + (Feats.data[f.id] ? '★ ' : '○ ') + f.name + '</span><span>' + f.desc + '</span></div>').join('');
  const workshopRows = ['power','control','keeper'].map(id => {
    const best = Workshop.bestLabel(id), stage = Workshop.stage(id);
    const nextStage = Math.min(3, stage + 1);
    const status = stage >= 3 ? 'mastered'
      : stage > 0 ? stage + '/3 cleared · next ' + workshopStageTarget(id, nextStage).toLowerCase()
      : workshopStageTarget(id, 1).toLowerCase();
    return '<div class="progress-item"><span>' + (stage >= 3 ? '★ ' : stage > 0 ? '◆ ' : '○ ') + WORKSHOP_DRILLS[id].name + '</span><span>' +
      status + (best ? ' · PB ' + best : '') + '</span></div>';
  }).join('');
  const tableRows = THEME_ORDER.map(id => {
    const locked = !tableUnlocked(id);
    const right = locked ? 'LOCKED · ' + tableLockReason(id) : masteryLabel(id);
    return '<div class="progress-item' + (locked ? ' locked' : '') + '"><span>' +
      (Mastery.mastered(id) ? '★ ' : Tour.won(id) ? '◆ ' : locked ? '◇ ' : '○ ') + THEMES[id].name +
      '</span><span>' + right + '</span></div>';
  }).join('');
  const challengeRows = THEME_ORDER.map(id => {
    const c = TABLE_CHALLENGES[id], done = TableChallenges.done(id);
    return '<div class="progress-item challenge-row' + (done ? ' done' : '') + '"><span>' +
      (done ? '★ ' : '○ ') + THEMES[id].name + ' · ' + c.name +
      '</span><span>' + (done ? 'cleared' : c.short.toLowerCase()) + '</span></div>';
  }).join('');
  body.innerHTML = '<div class="seclabel">WORKSHOP</div>' + workshopRows +
    '<div class="seclabel">TABLE MASTERY</div>' + tableRows +
    '<div class="seclabel">HOUSE CHALLENGES</div>' + challengeRows +
    '<div class="seclabel">ACHIEVEMENTS</div>' + featRows;
}
function shareResult() { return ShareSys.shareResult(); }

const keyDrive = new Set();
const keyRamp = [0, 0];
const gamepadButtonLatch = new Map();
let keyLast = performance.now();

function gamepadPressedOnce(pad, buttonIndex) {
  if (!pad || !pad.buttons || !pad.buttons[buttonIndex]) return false;
  const key = pad.index + ':' + buttonIndex;
  const down = !!pad.buttons[buttonIndex].pressed;
  const was = !!gamepadButtonLatch.get(key);
  gamepadButtonLatch.set(key, down);
  return down && !was;
}

function digitalControlVector(m, left, right, up, down, dt) {
  if (!m) return [0, 0, 0];
  const sx = (keyDrive.has(right) ? 1 : 0) - (keyDrive.has(left) ? 1 : 0);
  const sy = (keyDrive.has(down) ? 1 : 0) - (keyDrive.has(up) ? 1 : 0);
  const side = m.side === 1 ? 1 : 0;
  if (!sx && !sy) {
    keyRamp[side] = Math.max(0, keyRamp[side] - dt * 9);
    return [0, 0, 0];
  }
  // Digital input needs both tiny defensive corrections and fast flicks.
  // Ease from precision speed to attack speed over ~150 ms instead of making
  // every key press an all-or-nothing full-speed shove.
  keyRamp[side] = Math.min(1, keyRamp[side] + dt / 0.15);
  const t = keyRamp[side];
  const ease = t * t * (3 - 2 * t);
  const speed = (760 + 1460 * ease) * controlFeelScale(Settings.keyboardFeel);
  return [sx, sy, speed];
}

function keyboardGamepadDrive(now) {
  const dt = Math.min(0.04, Math.max(0, (now - keyLast) / 1000)); keyLast = now;
  if (G.focusLost) { requestAnimationFrame(keyboardGamepadDrive); return; }

  let pads = [];
  try { pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; } catch (e) {}

  // Standard gamepad affordances: Menu/Start pauses during a match and the
  // primary button activates the main menu action. Edge latching prevents a
  // held button from toggling every animation frame.
  const primaryPad = pads[0];
  if (primaryPad) {
    if (gamepadPressedOnce(primaryPad, 9)) {
      if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
    }
    if (gamepadPressedOnce(primaryPad, 0) && G.state === 'menu' &&
        !$('menu').classList.contains('hidden') && $('btnStart')) {
      $('btnStart').click();
    }
  }

  const spectator = G.mode === 'online' && typeof Net !== 'undefined' && Net.role === 'spectator';
  if ((G.state === 'play' || G.state === 'count') && !G.demo && G.mode !== 'watch' && !spectator) {
    const ownsRight = G.mode === 'online' && onlinePlayerSide() === 1;
    const p1 = ownsRight ? G.m2 : G.m1;
    const p2 = G.mode === '2p' ? G.m2 : null;

    const driveKeys = (m, left, right, up, down) => {
      const [sx, sy, speed] = digitalControlVector(m, left, right, up, down, dt);
      if (!speed) return false;
      return nudgeMalletTarget(m, sx, sy, speed, dt);
    };

    const drivePad = (pad, m) => {
      if (!pad || !m) return false;
      const [sx, sy] = shapeAnalogInput(pad.axes[0] || 0, pad.axes[1] || 0, 0.16, 1.16);
      if (!sx && !sy) return false;
      return nudgeMalletTarget(m, sx, sy, 2260 * controlFeelScale(Settings.gamepadFeel), dt);
    };

    const p1Keys = driveKeys(p1, 'KeyA', 'KeyD', 'KeyW', 'KeyS');
    if (!p1Keys) drivePad(pads[0], p1);

    if (p2) {
      const p2Keys = driveKeys(p2, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown');
      if (!p2Keys) drivePad(pads[1], p2);
    }
  } else {
    keyRamp[0] = Math.max(0, keyRamp[0] - dt * 9);
    keyRamp[1] = Math.max(0, keyRamp[1] - dt * 9);
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
  track.setAttribute('aria-orientation', 'horizontal');
  if (dots) dots.setAttribute('aria-hidden', 'true');
  THEME_ORDER.forEach((id, i) => {
    const T = THEMES[id];
    const d = document.createElement('div');
    d.className = 'tslide'; d.dataset.theme = id;
    d.setAttribute('role', 'option'); d.tabIndex = i === 0 ? 0 : -1;
    d.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    d.setAttribute('aria-label', T.name + ' table');
    d.innerHTML = '<canvas data-thumb="' + id + '" width="640" height="400"></canvas>' +
      '<div class="tlock hidden"><strong>LOCKED</strong><small data-lock-reason></small></div>' +
      '<div class="tchallenge" data-challenge aria-hidden="true"></div>' +
      '<div class="tmeta"><div class="tname">' + T.name + '</div>' +
      '<div class="tsub">' + T.tagline + '</div></div>';
    const pick = () => { AudioSys.init(); setTheme(id); };
    d.addEventListener('click', pick);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const next = e.key === 'Home' ? 0
          : e.key === 'End' ? THEME_ORDER.length - 1
          : (i + (e.key === 'ArrowRight' ? 1 : -1) + THEME_ORDER.length) % THEME_ORDER.length;
        carGo(next);
        requestAnimationFrame(() => track.children[next]?.focus({ preventScroll:true }));
      }
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
  const track = $('carTrack');
  if (track) [...track.children].forEach((option, j) => {
    const selected = j === i;
    option.tabIndex = selected ? 0 : -1;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
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
/* called by setTheme - scrolls the track when the theme changed
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
// ---------- menu selection ----------
// Mode choice is separate from rival difficulty. Online remains inert until
// the primary action is pressed, preserving the explicit network gesture.
const MenuSel = { mode: 'ai', diff: 1, watch: { a: 1, b: 2 } };
function selectRival(mode, diff) {
  MenuSel.mode = mode;
  if (diff != null) MenuSel.diff = diff;
  const modeButtons = {
    ai: $('btnHouse'), '2p': $('btn2p'), online: $('btnOnline'), watch: $('btnWatch')
  };
  Object.entries(modeButtons).forEach(([key, btn]) => {
    if (!btn) return;
    const selected = key === mode;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  document.querySelectorAll('[data-diff]').forEach(b => {
    const selected = mode === 'ai' && +b.dataset.diff === MenuSel.diff;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  $('houseSel').classList.toggle('hidden', mode !== 'ai');
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
  const label = $('startLabel'), s = $('startSub'), start = $('btnStart');
  if (!s || !label) return;
  if (!tableUnlocked(G.themeId)) {
    label.textContent = 'TABLE LOCKED';
    s.textContent = tableLockReason(G.themeId).toUpperCase();
    if (start) start.disabled = true;
    return;
  }
  if (start) start.disabled = false;
  let rival;
  if (MenuSel.mode === '2p') { label.textContent = 'START MATCH'; rival = 'TWO PLAYERS'; }
  else if (MenuSel.mode === 'online') { label.textContent = 'PLAY ONLINE'; rival = 'HOST OR JOIN'; }
  else if (MenuSel.mode === 'watch') {
    label.textContent = 'START EXHIBITION';
    const names = ['ROOKIE', 'CLUB PRO', 'CHAMPION'];
    rival = names[MenuSel.watch.a] + ' vs ' + names[MenuSel.watch.b];
  } else {
    label.textContent = 'START MATCH';
    rival = ['ROOKIE', 'CLUB PRO', 'CHAMPION'][MenuSel.diff];
  }
  s.textContent = rival + ' · FIRST TO ' + Settings.firstTo;
}

function installDialogA11y() {
  let returnFocus = null;
  const visible = () => {
    const dialogs = [...document.querySelectorAll('.overlay[role="dialog"]:not(.hidden)')];
    return dialogs[dialogs.length - 1] || null; // last in DOM is the topmost dialog layer
  };
  const focusables = dlg => [...dlg.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.closest('.hidden,[hidden],[aria-hidden="true"]'));
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
  // Always dismiss the overlay, even when no return panel was named -
  // otherwise a ret-less confirm (or a future caller that omits ret) leaves
  // a stuck dialog that Escape can never clear.
  hideAll();
  if (ret) $(ret).classList.remove('hidden');
  if (r) r(val);
}

function wireUI() {
  installDialogA11y();
  wireShareUI();
  $('btnApplyUpdate').addEventListener('click', () => UpdateSys.apply());
  $('btnDismissUpdate').addEventListener('click', () => UpdateSys.dismiss());
  buildCarousel();
  $('carPrev').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(-1); });
  $('carNext').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(1); });
  $('btnHouse').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('ai'); });
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('ai', +btn.dataset.diff); });
  });
  $('btn2p').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('2p'); });
  $('btnOnline').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('online'); });
  $('btnWatch').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('watch'); });
  document.querySelectorAll('[data-watch]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectWatch(btn.dataset.side, +btn.dataset.watch); });
  });
  // Initialize watch selector UI to defaults (Club Pro vs Champion)
  selectWatch('a', MenuSel.watch.a); selectWatch('b', MenuSel.watch.b);
  $('btnStart').addEventListener('click', () => {
    AudioSys.init(); AudioSys.ui();
    if (MenuSel.mode === 'online') { Net.openLobby(); return; }
    if (MenuSel.mode === 'watch') startGame('watch', MenuSel.watch);
    else startGame(MenuSel.mode, MenuSel.diff);
  });
  selectRival('ai', G.difficulty); // paint the initial selection + start label
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); setSetting(btn.dataset.set, btn.dataset.val); });
  });
  $('btnWorkshop').addEventListener('click', openWorkshop);
  document.querySelectorAll('[data-workshop]').forEach(btn => {
    btn.addEventListener('click', () => startWorkshop(btn.dataset.workshop));
  });
  $('workshopClose').addEventListener('click', () => {
    if (G.mode === 'workshop') { quitToMenu(); return; }
    AudioSys.ui(); refreshTour(); updateStartLabel(); hideAll(); $('menu').classList.remove('hidden');
  });
  $('workshopExit').addEventListener('click', quitToMenu);
  $('workshopAgain').addEventListener('click', () => {
    quitToMenu();
    openWorkshop();
  });
  $('workshopDoneMenu').addEventListener('click', quitToMenu);
  $('btnRules').addEventListener('click', openRules);
  $('rulesClose').addEventListener('click', closeRules);
  $('btnSettings').addEventListener('click', () => openSettings('menu'));
  $('btnPauseSettings').addEventListener('click', () => openSettings('pause'));
  $('settingsClose').addEventListener('click', closeSettings);
  document.querySelectorAll('[data-pref-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      AudioSys.ui();
      showPreferenceTab(btn.dataset.prefTab);
    });
    btn.addEventListener('keydown', e => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
      e.preventDefault();
      const i = PREFERENCE_TABS.indexOf(btn.dataset.prefTab);
      const next = e.key === 'Home' ? 0
        : e.key === 'End' ? PREFERENCE_TABS.length - 1
        : (i + (e.key === 'ArrowRight' ? 1 : -1) + PREFERENCE_TABS.length) % PREFERENCE_TABS.length;
      showPreferenceTab(PREFERENCE_TABS[next], true);
    });
  });
  $('controlsReset').addEventListener('click', () => {
    AudioSys.init(); AudioSys.ui();
    Settings.touchOffset = 'medium';
    Settings.keyboardFeel = 'balanced';
    Settings.gamepadFeel = 'balanced';
    saveSettings(); applySettingsToUI();
  });
  const sv = $('soundVol');
  if (sv) sv.addEventListener('input', () => {
    AudioSys.init();
    setSetting('soundVolume', sv.value);
  });
  const mv = $('musicVol');
  if (mv) mv.addEventListener('input', () => {
    AudioSys.init();
    setSetting('musicVolume', mv.value);
  });
  // focus-loss veil: any tap is the resume gesture (autoplay policy)
  $('focusov').addEventListener('click', () => { AudioSys.init(); resumeFromFocusLoss(); });
  $('btnHelp').addEventListener('click', () => { AudioSys.ui(); applySettingsToUI(); hideAll(); $('help').classList.remove('hidden'); });
  $('tourCount').addEventListener('click', () => { AudioSys.ui(); renderProgress(); hideAll(); $('progress').classList.remove('hidden'); });
  $('progressClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnResetProgress').addEventListener('click', async () => {
    const ok = await askConfirm({
      title: 'Reset progress',
      message: 'Reset records, personal bests, achievements, Workshop clears, House challenges, and Table Tour mastery on this device?',
      ok: 'Reset everything', ret: 'progress',
    });
    if (!ok) return;
    [Record.key, Best.key, Feats.key, Tour.key, Mastery.key, TableChallenges.key, Workshop.key].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    Record.load(); Best.load(); Feats.load(); Tour.load(); Mastery.load(); TableChallenges.load(); Workshop.load();
    refreshRecordLines(); refreshTour(); renderWorkshopMenu(); renderProgress();
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
  // ONLINE: rival-left overlay - back to the menu (leave() runs inside quitToMenu)
  $('dropMenu').addEventListener('click', quitToMenu);
  // in-game confirm dialog buttons
  $('confirmOk').addEventListener('click', () => settleConfirm(true));
  $('confirmCancel').addEventListener('click', () => settleConfirm(false));
  $('btnRematch').addEventListener('click', () => {
    AudioSys.ui();
    // ONLINE: a rematch needs the rival's accept - the host restarts on accept
    if (G.mode === 'online') Net.offerRematch();
    else if (G.mode === 'watch') startGame('watch', G.watch); // EXHIBITION: preserve the AI matchup
    else startGame(G.mode, G.difficulty);
  });
  $('btnWinMenu').addEventListener('click', quitToMenu);
  $('btnShareResult').addEventListener('click', shareResult);
  $('replayOffer').addEventListener('click', () => Replay.request());
  $('btnWinReplay').addEventListener('click', () => Replay.startPending('win'));
  $('replaySkip').addEventListener('click', () => Replay.finish());
  $('btnSound').addEventListener('click', () => {
    AudioSys.init();
    // One source of truth: global mute changes the visible channel sliders,
    // and direct slider changes derive the global muted state in return.
    AudioSys.setMasterMuted(!Settings.masterMuted);
    applySettingsToUI();
  });
  window.addEventListener('keydown', e => {
    // the focus-loss veil owns the keyboard: only Escape dismisses it
    if (G.focusLost) {
      if (e.key === 'Escape') { AudioSys.init(); resumeFromFocusLoss(); }
      return;
    }
    const interactive = e.target && e.target.closest && e.target.closest('input, textarea, select, button, a, [role="option"], [contenteditable="true"]');
    if (interactive && e.key !== 'Escape') return;
    if (e.key === 'p' || e.key === 'P') togglePause();
    else if (e.key === 'm' || e.key === 'M') $('btnSound').click();
    else if (e.key === 'Escape') {
      if (G.state === 'replay') Replay.finish(true);
      else if (!$('confirmov').classList.contains('hidden')) settleConfirm(false);
      else if (!$('help').classList.contains('hidden')) $('helpClose').click();
      else if (!$('settings').classList.contains('hidden')) $('settingsClose').click();
      else if (!$('rules').classList.contains('hidden')) $('rulesClose').click();
      else if (!$('workshop').classList.contains('hidden')) $('workshopClose').click();
      else if (!$('workshopDone').classList.contains('hidden')) $('workshopDoneMenu').click();
      else if (!$('progress').classList.contains('hidden')) $('progressClose').click();
      else if (!$('onlineov').classList.contains('hidden') && !Net.active) Net.cancelLobby();
      else if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
    }
    else if (e.key === 'Enter' && G.state === 'menu' && !$('menu').classList.contains('hidden')) {
      // Route the keyboard shortcut through the same primary action as a tap.
      // This keeps Online and Exhibition behavior identical across inputs.
      $('btnStart').click();
    }
  });
  window.addEventListener('keydown', e => {
    if (G.focusLost) return; // veiled: no input accumulates behind the overlay
    const spectator = G.mode === 'online' && typeof Net !== 'undefined' && Net.role === 'spectator';
    if (!spectator && ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code) &&
        (G.state === 'play' || G.state === 'count')) { keyDrive.add(e.code); e.preventDefault(); }
  }, { passive: false });
  window.addEventListener('keyup', e => keyDrive.delete(e.code));
  // focus loss pauses everything: sim, net, and audio freeze; the veil (or
  // the pause card) then waits for a tap. Never auto-resumes - the resume
  // must be a user gesture or the AudioContext stays suspended (policy).
  document.addEventListener('visibilitychange', () => {
    keyDrive.clear();
    if (document.hidden) {
      resetTransientControls();
      WakeSys.release();
      pauseForFocusLoss();
    } else {
      // Backgrounded PWAs can return with a discarded/blank canvas backing
      // store even though the simulation state is intact. Re-fit and repaint
      // before the player taps Resume; audio and simulation stay paused.
      recoverCanvasSurface();
      WakeSys.sync();
      UpdateSys.sync();
    }
  });
  window.addEventListener('blur', () => {
    keyDrive.clear(); keyRamp[0] = keyRamp[1] = 0;
    resetTransientControls();
    pauseForFocusLoss();
  });
  window.addEventListener('focus', () => recoverCanvasSurface());
  window.addEventListener('pagehide', () => {
    try { Net.saveSessionCheckpoint(); } catch (e) {}
    WakeSys.release();
  });
  canvas.addEventListener('contextlost', () => markCanvasContextLost());
  canvas.addEventListener('contextrestored', () => markCanvasContextRestored());
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerleave', onPointerLeave);
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

// ---------- deterministic visual QA ----------
// CI-only state composer. It is intentionally unreachable on builtbysai.com
// and only activates on localhost/127.0.0.1 so QA helpers never become product UI.
function applyVisualQaState(name) {
  if (!name || !['localhost', '127.0.0.1'].includes(location.hostname)) return false;
  window.__atelierVisualQA = { freeze:true, state:name };
  document.documentElement.classList.add('visual-qa');
  PRM.reduce = true;
  Settings.shake = 'off';
  Settings.effects = 'minimal';
  Settings.instantReplay = 'off';

  const baseMatch = camera => {
    hideAll(); Replay.reset(); Highlights.reset(); Practice.cancel();
    G.mode = 'ai'; G.difficulty = 1; G.demo = false; G.onlineFlip = false; G.focusLost = false;
    G.score = [3,2]; G.winSide = 0; G.board = freshBoard(); G.stats = freshStats();
    G.stats.t0 = performance.now() - 83000; G.stats.topSpeed = 2380; G.stats.bestRally = 12; G.stats.saves = [4,3];
    resetPositions();
    G.puck.x = CX + 86; G.puck.y = CY - 34; G.puck.vx = 920; G.puck.vy = -280;
    G.m1.x = CX - 290; G.m1.y = CY + 110; G.m1.tx = G.m1.x; G.m1.ty = G.m1.y;
    G.m2.x = CX + 290; G.m2.y = CY - 100; G.m2.tx = G.m2.x; G.m2.ty = G.m2.y;
    Settings.camera = camera || 'top'; resize(); G.state = 'play';
    $('topbar').classList.remove('hidden');
  };

  switch (name) {
    case 'menu':
      hideAll(); G.state = 'menu'; G.demo = false; G.idleT = 0; $('menu').classList.remove('hidden'); break;
    case 'rules':
      hideAll(); G.state = 'menu'; applySettingsToUI(); $('rules').classList.remove('hidden'); break;
    case 'preferences':
      hideAll(); G.state = 'menu'; applySettingsToUI(); $('settings').classList.remove('hidden'); break;
    case 'workshop-menu':
      renderWorkshopMenu(); hideAll(); G.state = 'menu'; $('workshop').classList.remove('hidden'); break;
    case 'progress':
      renderProgress(); hideAll(); G.state = 'menu'; $('progress').classList.remove('hidden'); break;
    case 'workshop':
      baseMatch('top');
      G.mode = 'workshop'; G.difficulty = 0; G.ai1 = null; G.ai2 = mkBrain(1,0);
      Practice.begin('power'); Practice.progress = 24; Practice.syncHud();
      G.state = 'play'; $('workshopHud').classList.remove('hidden'); break;
    case 'workshop-free':
      baseMatch('top');
      G.mode = 'workshop'; G.difficulty = 0; G.ai1 = null; G.ai2 = null;
      Practice.begin('free'); Practice.preparePoint();
      G.state = 'play'; $('workshopHud').classList.remove('hidden'); break;
    case 'top':
    case 'elevated':
    case 'surface':
      baseMatch(name); break;
    case 'goal':
      baseMatch('top'); G.score = [4,2]; G.goalSide = 0; G.goalT = 0.72; G.goalSlowT = 0.72;
      G.letterT = 1; G.goalStreakLabel = 'TWO IN A ROW'; G.goalMomentLabel = 'TWO IN A ROW';
      G.goalScorerLabel = 'YOU SCORE'; G.goalSpeedKmh = 24;
      G.state = 'goal'; $('topbar').classList.add('hidden'); break;
    case 'goal-rival':
      baseMatch('top'); PRM.reduce = false; Settings.effects = 'full'; G.difficulty = 1;
      G.score = [4,2]; G.goalSide = 0; G.goalT = 0.52; G.goalSlowT = 0.52;
      G.letterT = 1; G.goalStreakLabel = ''; G.goalMomentLabel = 'LEAD TAKEN';
      G.goalScorerLabel = 'YOU SCORE'; G.goalSpeedKmh = 22;
      G.state = 'goal'; $('topbar').classList.add('hidden'); break;
    case 'replay': {
      baseMatch('top');
      const a = Replay.snapshot(); G.puck.x += 90; G.m1.y -= 45; const b = Replay.snapshot();
      Replay.clip = [a,b,a,b]; Replay.active = true; Replay.elapsed = 0.04; Replay.scorer = 0; Replay.returnMode = 'win';
      G.state = 'replay'; document.body.classList.add('replay-mode'); $('topbar').classList.add('hidden');
      $('replayHud').classList.remove('hidden'); $('replayProgress').style.transform = 'scaleX(.56)'; break;
    }
    case 'pause':
      baseMatch('top'); G.pausedFrom = 'play'; G.state = 'pause'; hideAll(); $('pauseov').classList.remove('hidden'); break;
    case 'win': {
      baseMatch('top'); G.score = [7,4]; G.winSide = 0; G.state = 'win';
      G.stats.t0 = performance.now() - 112000; G.stats.topSpeed = 2640; G.stats.bestRally = 18;
      G.stats.saves = [6,3]; G.stats.bestStreak = [3,1]; G.stats.worstDef = [-3,0];
      const clip = Array.from({ length:72 }, () => Replay.snapshot());
      Highlights.goals = [
        { id:1, scorer:0, clip, speedKmh:20, rally:8, score:[2,1], prevScore:[1,1], themeId:G.themeId,
          bankShot:true, savesBeforeGoal:0, pressure:1, streak:1, tookLead:true },
        { id:2, scorer:0, clip, speedKmh:24, rally:12, score:[5,3], prevScore:[4,3], themeId:G.themeId,
          bankShot:false, savesBeforeGoal:2, pressure:2, streak:2, tookLead:false },
        { id:3, scorer:0, clip, speedKmh:22, rally:18, score:[7,4], prevScore:[6,4], themeId:G.themeId,
          bankShot:false, savesBeforeGoal:0, pressure:1, streak:3, winning:true },
      ];
      Highlights.nextId = 4;
      showWin(); break;
    }
    case 'update':
      hideAll(); G.state = 'menu'; G.demo = false; G.idleT = 0; $('menu').classList.remove('hidden');
      // Model a real waiting worker so UpdateSys.sync() keeps the banner
      // visible instead of immediately undoing the QA state.
      UpdateSys.waiting = { postMessage() {} }; UpdateSys.dismissed = false;
      $('updateReady').classList.remove('hidden'); break;
    default:
      hideAll(); G.state = 'menu'; $('menu').classList.remove('hidden'); break;
  }
  UpdateSys.sync();
  window.__atelierVisualQA.controlState = () => ({
    state:G.state,
    portrait:!!view.portrait,
    activePointers:pointers.size,
    centerLimit:CX - MALLET_R,
    m1:{ x:G.m1.x, y:G.m1.y, tx:G.m1.tx, ty:G.m1.ty },
  });
  return true;
}

// ---------- boot ----------
function boot() {
  loadSettings();
  applyScreenOrientationPreference();
  Record.load(); Best.load(); Feats.load(); Tour.load(); Mastery.load(); TableChallenges.load(); Workshop.load();
  refreshRecordLines(); // paint any stored records under the menu buttons
  refreshTour(); // tour counter + conquered-table pips
  // Accessibility: keep reduced-motion live for the whole PWA session.
  // Canvas flashes/room reactivity read PRM.reduce directly; an explicit
  // in-app Shake choice remains authoritative.
  installReducedMotionPreference();
  resize(); wireUI(); applySettingsToUI();
  let initialTheme = 'deco';
  try { const savedTheme = localStorage.getItem('atelier-ah-theme'); if (savedTheme && THEMES[savedTheme]) initialTheme = savedTheme; } catch (e) {}
  setTheme(initialTheme, true);
  refreshTour();
  const paintLater = () => { try { paintThumbnails(); } catch (e) { console.warn('Thumbnail paint failed', e); } };
  if ('requestIdleCallback' in window) requestIdleCallback(paintLater, { timeout: 800 }); else setTimeout(paintLater, 0);
  resetPositions();
  G.ai1 = mkBrain(0, 1); G.ai2 = mkBrain(1, 1);
  // Deep links are explicit user intent and take precedence over a short-lived
  // crash/reload checkpoint.
  let explicitRoute = false;
  // deep links: ?table=mid&play , ?table=bil&2p , ?demo
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('table') && THEMES[q.get('table')]) setTheme(q.get('table'), true);
    const joinCode = q.get('join') || q.get('room'); // ?room= is an alias for ?join=
    if (joinCode) {
      explicitRoute = true;
      Net.clearSessionCheckpoint();
      Net.openLobby(); Net.join(joinCode);
      try { const u = new URL(location.href); u.searchParams.delete('join'); u.searchParams.delete('room'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    }
    else if (q.has('play') && tableUnlocked(G.themeId)) { explicitRoute = true; Net.clearSessionCheckpoint(); startGame('ai', G.difficulty); }
    else if (q.has('2p') && tableUnlocked(G.themeId)) { explicitRoute = true; Net.clearSessionCheckpoint(); startGame('2p'); }
    else if (q.has('demo')) { explicitRoute = true; Net.clearSessionCheckpoint(); G.idleT = 99; }
    if (q.get('qa')) explicitRoute = true;
    applyVisualQaState(q.get('qa'));
  } catch (e) {}
  requestAnimationFrame(frame);
  requestAnimationFrame(keyboardGamepadDrive);
  if (!explicitRoute) void Net.tryResumeSession();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        UpdateSys.install(reg);
        try { reg.update(); } catch (e) {}
      })
      .catch(e => console.warn('Service worker registration failed', e));
  }
}
document.addEventListener('DOMContentLoaded', boot);
