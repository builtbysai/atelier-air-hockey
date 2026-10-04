/* ============================================================
   ATELIER AIR HOCKEY - engine v2
   Rebuilt from research: Brunswick 1969 roots, near-zero-friction
   puck glide, velocity-transfer striking, human-like AI, and the
   full juice canon (hit-stop, trauma shake + rotation, particles,
   squash, trails, scuff permanence, slow-mo goal ceremony).
   Modular source. Mobile-first. No image/audio asset dependencies.
   ============================================================ */
'use strict';

// ---------- dimensions (2:1 rink, USAA-style proportions) ----------
const VW = 1440, VH = 1040;          // view space
const PX = 200, PY = 200, PW = 1040, PH = 640;  // playfield
const CX = PX + PW / 2, CY = PY + PH / 2;
const PUCK_R = 26, MALLET_R = 46, RAIL = 26;
// Goal-mouth presets (v20): adjustable in Settings → Goal mouth. Standard is
// the new default - narrower than the old fixed 230 (36% of the wall was
// swallowing deflections). The host's choice rides the countdown event
// online; guests apply it as a match-scoped override (G.gwNet).
const GOAL_PRESETS = { narrow: 170, standard: 200, wide: 230 };
function goalW() {
  if (G.gwNet > 0) return G.gwNet; // online guest: the host's width for this match
  return GOAL_PRESETS[Settings.goalW] || GOAL_PRESETS.standard;
}
const TX0 = PX - RAIL, TY0 = PY - RAIL;
const TAU = Math.PI * 2;

// ---------- user settings (persisted) ----------
const Settings = {
  shake: 'full',      // 'off' | 'subtle' | 'full'
  soundVolume: 100,   // 0-100 - 0 is muted, 100 preserves today's calibrated SFX level
  soundBeforeMute: 100, // remembered mix used by the global mute button
  musicVolume: 70,    // 0-100 - whole music/ambience bus; 70 is the calibrated unity point
  musicBeforeMute: 70, // remembered mix used by the global mute button
  haptics: true,
  firstTo: 7,         // 5 | 7 | 11
  pace: 'classic',     // 'casual' | 'classic' | 'lightning'
  effects: 'full',     // 'full' | 'subtle' | 'minimal' - spectacle scaler, never touches physics
  instantReplay: 'goals', // 'goals' | 'off' - local goal replays only
  goalW: 'standard',   // 'narrow' | 'standard' | 'wide' - goal-mouth width (v20)
  orientation: 'auto', // 'auto' | 'landscape' | 'portrait' - persisted display preference
  camera: 'top', // 'top' | 'elevated' | 'surface' - 2.5D camera (v25)
  touchOffset: 'medium', // 'low' | 'medium' | 'high' - screen-space finger/striker separation
  keyboardFeel: 'balanced', // 'precise' | 'balanced' | 'fast' - digital target travel profile
  gamepadFeel: 'balanced', // 'precise' | 'balanced' | 'fast' - analog target travel profile
};
// prefers-reduced-motion: detected at boot; userShake remembers whether the
// player explicitly chose a shake level (their choice always wins).
const PRM = { reduce: false, userShake: false };
function loadSavedObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (e) { return {}; }
}
function loadSettings() {
  const stored = loadSavedObject('atelier-ah-settings');
  PRM.userShake = Object.prototype.hasOwnProperty.call(stored, 'shake');
  for (const k of Object.keys(Settings)) if (stored[k] !== undefined) Settings[k] = stored[k];
  if (![5, 7, 11].includes(Settings.firstTo)) Settings.firstTo = 7;
  if (!['off', 'subtle', 'full'].includes(Settings.shake)) Settings.shake = 'full';
  if (!['casual', 'classic', 'lightning'].includes(Settings.pace)) Settings.pace = 'classic';
  if (!['full', 'subtle', 'minimal'].includes(Settings.effects)) Settings.effects = 'full';
  if (!['goals', 'off'].includes(Settings.instantReplay)) Settings.instantReplay = 'goals';
  if (!['narrow', 'standard', 'wide'].includes(Settings.goalW)) Settings.goalW = 'standard';
  if (!['auto', 'landscape', 'portrait'].includes(Settings.orientation)) Settings.orientation = 'auto';
  if (!['top', 'elevated', 'surface'].includes(Settings.camera)) Settings.camera = 'top';
  if (!['low', 'medium', 'high'].includes(Settings.touchOffset)) Settings.touchOffset = 'medium';
  if (!['precise', 'balanced', 'fast'].includes(Settings.keyboardFeel)) Settings.keyboardFeel = 'balanced';
  if (!['precise', 'balanced', 'fast'].includes(Settings.gamepadFeel)) Settings.gamepadFeel = 'balanced';
  if (!Number.isFinite(Settings.soundVolume)) Settings.soundVolume = 100;
  else Settings.soundVolume = clamp(Math.round(Settings.soundVolume), 0, 100);
  if (!Number.isFinite(Settings.musicVolume)) Settings.musicVolume = 70;
  else Settings.musicVolume = clamp(Math.round(Settings.musicVolume), 0, 100);
  if (!Number.isFinite(Settings.soundBeforeMute)) Settings.soundBeforeMute = 100;
  else Settings.soundBeforeMute = clamp(Math.round(Settings.soundBeforeMute), 0, 100);
  if (!Number.isFinite(Settings.musicBeforeMute)) Settings.musicBeforeMute = 70;
  else Settings.musicBeforeMute = clamp(Math.round(Settings.musicBeforeMute), 0, 100);
}
// Effects scalers - one place to look up how much spectacle is allowed.
// Physics, pacing, and AI never consult these.
const fxParticles = () => Settings.effects === 'minimal' ? 0.35 : Settings.effects === 'subtle' ? 0.65 : 1;
const fxTrail = () => (Settings.effects === 'minimal' ? 0.5 : Settings.effects === 'subtle' ? 0.75 : 1) *
  (1 + Feel.rallyIntensity(G.stats ? G.stats.rally : 0) * Feel.tuning.rallyTrailLift);
const fxRoom = () => Settings.effects === 'full' && !PRM.reduce;   // room reactivity
const fxFlash = () => Settings.effects !== 'minimal' && !PRM.reduce; // flashes & glows
function saveSettings() {
  try { localStorage.setItem('atelier-ah-settings', JSON.stringify(Settings)); } catch (e) {}
}

// ---------- local rival record ----------
// W/L per AI rival plus P1/P2 for same-screen 2P, stored in localStorage so it
// survives reloads. Deliberately local-only: online matches are live sessions,
// not a stored record, and netcode never touches this module.
const Record = {
  key: 'atelier-ah-record',
  data: {},
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  // key: 'ai0' | 'ai1' | 'ai2' | 'p1' | 'p2'. won: did this key's side win?
  bump(key, won) {
    let r = this.data[key];
    if (!r || typeof r.w !== 'number' || typeof r.l !== 'number') r = this.data[key] = { w: 0, l: 0 };
    if (won) r.w++; else r.l++;
    this.save();
  },
  // one rival's line, e.g. '3W–1L', or '' when no games are recorded yet
  line(key) {
    const r = this.data[key];
    return (r && (r.w || r.l)) ? r.w + 'W–' + r.l + 'L' : '';
  },
};
// combined line for the Two Players menu button: 'P1 3W–1L · P2 1W–3L'
function recordLine2p() {
  const a = Record.line('p1'), b = Record.line('p2');
  if (!a && !b) return '';
  return 'P1 ' + (a || '0W–0L') + ' · P2 ' + (b || '0W–0L');
}
// repaint every menu record line - call after results are stored and whenever
// the menu is shown (Record.line returns '' so unplayed rivals stay clean)
function refreshRecordLines() {
  document.querySelectorAll('[data-rec]').forEach(el => {
    el.textContent = el.dataset.rec === 'p2p' ? recordLine2p() : Record.line(el.dataset.rec);
  });
}

// ---------- personal bests ----------
// Per matchup ('ai0' | 'ai1' | 'ai2' | 'p2p'): fastest win, top puck speed,
// longest rally, biggest margin. Checked in showWin(); beaten records earn a
// ★ line on the win card. Same local-only rule as Record - online matches
// are session-only, netcode never touches this module.
const Best = {
  key: 'atelier-ah-best',
  data: {},
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
};
function fmtTime(secs) {
  return Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
}
// returns the display labels of any records just beaten (possibly empty)
function checkBest(key, secs, kmh, rally, margin) {
  let b = Best.data[key];
  if (!b || typeof b !== 'object') b = Best.data[key] = {};
  const out = [];
  const consider = (field, v, lower, label) => {
    if (typeof b[field] !== 'number') { b[field] = v; out.push(label); }
    else if (lower ? v < b[field] : v > b[field]) { b[field] = v; out.push(label); }
  };
  consider('win', secs, true, 'fastest win ' + fmtTime(secs));
  consider('speed', kmh, false, 'top speed ' + kmh + ' km/h');
  consider('rally', rally, false, 'longest rally ' + rally);
  consider('margin', margin, false, 'biggest margin ' + margin);
  if (out.length) Best.save();
  return out;
}

// ---------- achievements ----------
// One-time named feats, unlocked for the human winner of a local match and
// announced on the win card. Persisted per device; local-only like Record.
const SPEEDSTER_KMH = 24;
const FEATS = [
  { id: 'shutout',   name: 'SHUTOUT',   desc: 'a clean sheet' },
  { id: 'comeback',  name: 'COMEBACK',  desc: 'won from three down' },
  { id: 'hattrick',  name: 'HAT-TRICK', desc: 'three goals on the spin' },
  { id: 'speedster', name: 'SPEEDSTER', desc: 'puck past ' + SPEEDSTER_KMH + ' km/h' },
  { id: 'grandtour', name: 'GRAND TOUR', desc: 'all ten tables conquered' },
];
const Feats = {
  key: 'atelier-ah-feats',
  data: {},
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  // returns true only on a fresh unlock
  unlock(id) {
    if (this.data[id]) return false;
    this.data[id] = 1; this.save();
    return true;
  },
};

// ---------- table tour ----------
// Wins per table (theme id) for the human side, local matches only. Feeds the
// menu's tour counter, the gold pip on conquered carousel slides, and the
// GRAND TOUR feat.
const Tour = {
  key: 'atelier-ah-tour',
  data: {},
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  bump(id) {
    if (THEME_ORDER.indexOf(id) < 0) return;
    this.data[id] = (this.data[id] || 0) + 1;
    this.save();
  },
  won(id) { return (this.data[id] || 0) > 0; },
  count() { return THEME_ORDER.filter(id => this.won(id)).length; },
};
// repaint the tour counter + conquered pips - call on boot and whenever the
// menu is shown (Tour data only changes at match end)
function refreshTour() {
  document.querySelectorAll('.tslide').forEach(el => {
    const id = el.dataset.theme, locked = !tableUnlocked(id);
    el.classList.toggle('won', Tour.won(id));
    el.classList.toggle('mastered', Mastery.mastered(id));
    el.classList.toggle('challenged', TableChallenges.done(id));
    el.classList.toggle('locked', locked);
    const lock = el.querySelector('.tlock'), why = el.querySelector('[data-lock-reason]');
    const chip = el.querySelector('[data-challenge]');
    if (lock) lock.classList.toggle('hidden', !locked);
    if (why) why.textContent = locked ? tableLockReason(id) : '';
    const def = TABLE_CHALLENGES[id], challengeDone = TableChallenges.done(id);
    if (chip) {
      chip.classList.toggle('done', challengeDone);
      chip.textContent = challengeDone ? '◆ CHALLENGE CLEARED' : (def ? '◆ ' + def.short : '');
    }
    const base = THEMES[id] ? THEMES[id].name + ' table' : 'Table';
    const challenge = !locked && def
      ? '. House challenge: ' + def.name + '. ' + def.desc + (challengeDone ? '. Cleared.' : '.')
      : '';
    el.setAttribute('aria-label', locked ? base + '. Locked. ' + tableLockReason(id) : base + challenge);
  });
  const tc = $('tourCount');
  if (tc) tc.textContent = 'TOUR ' + Tour.count() + '/' + THEME_ORDER.length;
}

// ---------- table mastery + workshop ----------
// Mastery is deliberately separate from raw win counts. It measures which
// House rival the player has actually beaten on each table and feeds the
// skill gates below. Stronger wins grant the lower marks automatically.
const Mastery = {
  key: 'atelier-ah-mastery',
  data: {},
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  level(id) {
    const n = Number(this.data[id]) || 0;
    return clamp(Math.round(n), 0, 3);
  },
  award(id, diffIdx) {
    if (!id || diffIdx == null) return [];
    const before = this.level(id);
    const after = Math.max(before, clamp(Number(diffIdx) + 1, 1, 3));
    if (after === before) return [];
    this.data[id] = after; this.save();
    const out = [];
    if (before < 2 && after >= 2) out.push('HOUSE STANDARD');
    if (before < 3 && after >= 3) out.push('TABLE MASTERED');
    return out;
  },
  mastered(id) { return this.level(id) >= 3; },
  masteredCount() {
    return ['deco','mid','brut','bil','mem','sashi','bau','zel','swi','neon']
      .filter(id => this.mastered(id)).length;
  },
};

const TABLE_CHALLENGES = Object.freeze({
  deco:  { name:'Clean Finish',   short:'ALLOW ≤2',       desc:'Win while allowing 2 goals or fewer', kind:'concede', value:2 },
  mid:   { name:'Keep It Moving', short:'10-HIT RALLY',   desc:'Win with a 10-hit rally',             kind:'rally',   value:10 },
  brut:  { name:'Heavy Hand',     short:'22 KM/H',        desc:'Reach 22 km/h and win',                kind:'speed',   value:22 },
  bil:   { name:'Banker',         short:'BANK GOAL',      desc:'Score a bank goal and win',            kind:'bank',    value:1 },
  mem:   { name:'Turnaround',     short:'TRAIL BY 2',     desc:'Win after trailing by 2',              kind:'deficit', value:2 },
  sashi: { name:'Last Line',      short:'5 SAVES',        desc:'Make 5 saves and win',                 kind:'saves',   value:5 },
  bau:   { name:'Form & Function',short:'WIN BY 3',       desc:'Win by 3 goals or more',               kind:'margin',  value:3 },
  zel:   { name:'Pattern Play',   short:'12-HIT GOAL',    desc:'Score after a 12-hit rally',           kind:'goalRally', value:12 },
  swi:   { name:'Grid Lock',      short:'3 IN A ROW',     desc:'Score 3 in a row and win',             kind:'streak',  value:3 },
  neon:  { name:'After Dark',     short:'24 KM/H · +2',   desc:'Reach 24 km/h and win by 2',           kind:'neon',    value:24 },
});
const TableChallenges = {
  key:'atelier-ah-table-challenges',
  data:{},
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  done(id) { return !!this.data[id]; },
  complete(id) {
    if (!TABLE_CHALLENGES[id] || this.data[id]) return false;
    this.data[id] = 1; this.save(); return true;
  },
  count() { return THEME_ORDER.filter(id => this.done(id)).length; },
  met(id, ctx) {
    const c = TABLE_CHALLENGES[id];
    if (!c || !ctx) return false;
    switch (c.kind) {
      case 'concede': return ctx.oppScore <= c.value;
      case 'rally': return ctx.bestRally >= c.value;
      case 'speed': return ctx.topSpeedKmh >= c.value;
      case 'bank': return ctx.bankGoals >= c.value;
      case 'deficit': return ctx.worstDef <= -c.value;
      case 'saves': return ctx.saves >= c.value;
      case 'margin': return ctx.margin >= c.value;
      case 'goalRally': return ctx.bestGoalRally >= c.value;
      case 'streak': return ctx.bestStreak >= c.value;
      case 'neon': return ctx.topSpeedKmh >= c.value && ctx.margin >= 2;
      default: return false;
    }
  },
  check(id, ctx) {
    if (this.done(id) || !this.met(id, ctx)) return false;
    return this.complete(id);
  },
};

const Workshop = {
  key: 'atelier-ah-workshop',
  data: {},
  current: null,
  returnTheme: 'deco',
  load() { this.data = loadSavedObject(this.key); },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
  },
  // Stored drill values are completed stage numbers.
  stage(id) {
    const n = Number(this.data[id]);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(0, Math.min(3, Math.floor(n)));
  },
  done(id) { return this.stage(id) >= 1; },
  mastered(id) { return this.stage(id) >= 3; },
  completeStage(id, stage) {
    if (!id) return false;
    const next = Math.max(1, Math.min(3, Math.floor(Number(stage) || 1)));
    if (this.stage(id) >= next) return false;
    this.data[id] = next; this.save();
    return true;
  },
  best(id) {
    const n = Number(this.data._best && this.data._best[id]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },
  bumpBest(id, value) {
    value = Number(value) || 0;
    if (!id || value <= this.best(id)) return false;
    if (!this.data._best || typeof this.data._best !== 'object') this.data._best = {};
    this.data._best[id] = value; this.save();
    return true;
  },
  bestLabel(id) {
    const n = this.best(id);
    if (!n) return '';
    if (id === 'power') return Math.round(n) + ' KM/H';
    if (id === 'control') return Math.round(n) + ' HITS';
    if (id === 'keeper') return Math.round(n) + ' SAVES';
    return String(Math.round(n));
  },
  count() { return ['power','control','keeper'].filter(id => this.done(id)).length; },
  masteredCount() { return ['power','control','keeper'].filter(id => this.mastered(id)).length; },
};

// The first four rooms are always open. Later rooms use related skill gates
// with a Workshop alternate route so progression never becomes a single wall.
const TABLE_GATES = Object.freeze({
  mem:   { mastery:'brut', drill:'power',   text:'Master Beton or clear Power' },
  sashi: { mastery:'mem',  drill:'control', text:'Master Memphis or clear Control' },
  bau:   { mastery:'sashi',drill:'keeper',  text:'Master Sashiko or clear Keeper' },
  zel:   { mastery:'bau',  challenge:'bau', count:3, text:'Master Bauhaus, clear its challenge, or master 3 tables' },
  swi:   { mastery:'zel',  challenge:'zel', count:5, text:'Master Zellige, clear its challenge, or master 5 tables' },
  neon:  { mastery:'swi',  challenge:'swi', count:6, text:'Master Swiss Grid, clear its challenge, or master 6 tables' },
});
function tableUnlocked(id) {
  if (['deco','mid','brut','bil'].includes(id)) return true;
  if (Tour.won(id)) return true; // never revoke a room a returning player already conquered
  const g = TABLE_GATES[id];
  if (!g) return true;
  if (g.mastery && Mastery.mastered(g.mastery)) return true;
  if (g.drill && Workshop.done(g.drill)) return true;
  if (g.challenge && TableChallenges.done(g.challenge)) return true;
  if (g.count && Mastery.masteredCount() >= g.count) return true;
  return false;
}
function tableLockReason(id) {
  const g = TABLE_GATES[id];
  return g && !tableUnlocked(id) ? g.text : '';
}
function newlyUnlockedTables(before) {
  const ids = ['deco','mid','brut','bil','mem','sashi','bau','zel','swi','neon'];
  return ids.filter(id => !before[id] && tableUnlocked(id));
}
function tableUnlockSnapshot() {
  const out = {};
  for (const id of ['deco','mid','brut','bil','mem','sashi','bau','zel','swi','neon'])
    out[id] = tableUnlocked(id);
  return out;
}

const WORKSHOP_DRILLS = Object.freeze({
  power:   { name:'Power',    stages:[20,22,24], unit:'KM/H', coach:0,    serve:1 },
  control: { name:'Control',  stages:[10,15,20], unit:'HITS', coach:0,    serve:1 },
  keeper:  { name:'Keeper',   stages:[3,5,7],    unit:'SAVES', coach:1,   serve:-1 },
  free:    { name:'Free Hit', target:'Shots, banks, and control', coach:null, serve:1, free:true },
});
function workshopStageGoal(id, stage) {
  const d = WORKSHOP_DRILLS[id];
  if (!d || !d.stages || !d.stages.length) return 0;
  const i = Math.max(0, Math.min(d.stages.length - 1, (Number(stage) || 1) - 1));
  return d.stages[i];
}
function workshopStageTarget(id, stage) {
  const goal = workshopStageGoal(id, stage);
  if (id === 'power') return 'Score at ' + goal + ' km/h';
  if (id === 'control') return 'Trade ' + goal + ' alternating returns';
  if (id === 'keeper') return 'Make ' + goal + ' saves in a row';
  return WORKSHOP_DRILLS[id]?.target || '';
}
const Practice = {
  active:false, id:null, progress:0, stage:1, replayMastered:false, freeHits:0, sessionUnlocks:[],
  begin(id) {
    const d = WORKSHOP_DRILLS[id];
    if (!d) return false;
    const completed = d.free ? 0 : Workshop.stage(id);
    this.active = true;
    this.id = id;
    this.progress = 0;
    this.stage = d.free ? 0 : Math.min(completed + 1, d.stages.length);
    this.replayMastered = !d.free && completed >= d.stages.length;
    this.freeHits = 0;
    this.sessionUnlocks = [];
    Workshop.current = id;
    this.syncHud();
    return true;
  },
  cancel() {
    this.active = false; this.id = null; this.progress = 0; this.stage = 1;
    this.replayMastered = false; this.freeHits = 0; this.sessionUnlocks = []; Workshop.current = null;
    const hud = $('workshopHud'); if (hud) hud.classList.add('hidden');
  },
  goal() { return workshopStageGoal(this.id, this.stage); },
  preparePoint() {
    if (!this.active || this.id !== 'free') return;
    // Free Hit is genuinely solo. Park the unused rival outside the rendered
    // rink and keep it non-colliding instead of inventing a second physics mode.
    G.ai2 = null;
    G.m2.x = G.m2.tx = VW + MALLET_R * 4;
    G.m2.y = G.m2.ty = CY;
    G.m2.vx = G.m2.vy = 0;
    G.m2.ghostT = 1e9;
  },
  syncHud(note) {
    const d = WORKSHOP_DRILLS[this.id]; if (!d) return;
    const hud = $('workshopHud'), title = $('workshopHudTitle'), target = $('workshopHudTarget'), prog = $('workshopHudProgress');
    if (hud) hud.classList.remove('hidden');
    if (title) title.textContent = d.free
      ? 'WORKSHOP · ' + d.name.toUpperCase()
      : 'WORKSHOP · ' + d.name.toUpperCase() + ' · STAGE ' + this.stage + '/' + d.stages.length;
    if (target) {
      if (note) target.textContent = note;
      else if (this.replayMastered) target.textContent = 'MASTERED · ' + workshopStageTarget(this.id, this.stage);
      else target.textContent = d.free ? d.target : workshopStageTarget(this.id, this.stage);
    }
    if (!prog) return;
    if (d.free) {
      prog.textContent = this.freeHits ? this.freeHits + ' TARGET' + (this.freeHits === 1 ? '' : 'S') : 'OPEN TABLE';
      return;
    }
    const value = this.id === 'power' ? Math.round(this.progress) : this.progress;
    prog.textContent = value + ' / ' + this.goal() + ' ' + d.unit;
  },
  maybeClear() {
    const d = WORKSHOP_DRILLS[this.id];
    const goal = this.goal();
    if (!d || d.free || this.progress < goal) return false;
    // A fully mastered drill remains replayable for PBs, but never re-awards
    // progression or interrupts the session with another completion card.
    if (Workshop.stage(this.id) >= this.stage) {
      this.syncHud('MASTERED · keep pushing your PB');
      return false;
    }

    const clearedStage = this.stage;
    const before = tableUnlockSnapshot();
    Workshop.completeStage(this.id, clearedStage);
    const unlocked = newlyUnlockedTables(before);
    for (const id of unlocked) if (!this.sessionUnlocks.includes(id)) this.sessionUnlocks.push(id);

    if (clearedStage < d.stages.length) {
      this.stage = clearedStage + 1;
      this.progress = 0;
      addText(CX, CY, 'STAGE ' + clearedStage + ' CLEAR', THEME.gold || '#d8a93f', 30);
      const unlockText = unlocked.length ? ' · Unlocked ' + unlocked.map(x => THEMES[x].name).join(', ') : '';
      this.resetPoint('Stage ' + clearedStage + ' clear' + unlockText + ' · Stage ' + this.stage);
      return true;
    }

    this.complete();
    return true;
  },
  onFreeTarget(speedKmh) {
    if (!this.active || this.id !== 'free') return;
    this.freeHits++;
    this.syncHud('Target hit · ' + Math.max(1, Math.round(speedKmh || 0)) + ' km/h');
    addText(PX + PW - 92, CY, 'TARGET', THEME.gold || '#d8a93f', 34);
  },
  onRally(n) {
    if (!this.active) return;
    if (this.id === 'control') {
      this.progress = Math.max(this.progress, n);
      Workshop.bumpBest('control', this.progress);
      this.syncHud();
      this.maybeClear();
    }
  },
  onSave(side) {
    if (!this.active || this.id !== 'keeper' || side !== 0) return;
    this.progress++;
    Workshop.bumpBest('keeper', this.progress);
    this.syncHud();
    this.maybeClear();
  },
  onGoal(scorer, speedKmh) {
    if (!this.active) return;
    if (this.id === 'free') {
      // The far end is a rebound target, not a goal. Only an own goal reaches
      // onGoal() in Free Hit; reset so the player still has to defend.
      if (scorer === 1) {
        this.resetPoint();
        this.syncHud('Own goal · reset');
      }
      return;
    }
    if (this.id === 'power' && scorer === 0) {
      this.progress = Math.max(this.progress, speedKmh);
      Workshop.bumpBest('power', speedKmh);
      this.syncHud(speedKmh >= this.goal() ? 'Power target hit' : 'Keep driving through the puck');
      if (this.maybeClear()) return;
    } else if (this.id === 'control') {
      this.progress = 0; this.syncHud('Rally reset · build it again');
    } else if (this.id === 'keeper') {
      this.progress = 0; this.syncHud('Save streak reset · hold the line');
    }
    this.resetPoint();
  },
  resetPoint(note) {
    if (!this.active) return;
    resetPositions();
    this.preparePoint();
    if (G.stats) { G.stats.rally = 0; G.stats.rallyLastSide = -1; }
    startCount();
    rollServe(WORKSHOP_DRILLS[this.id].serve);
    $('topbar').classList.remove('hidden');
    this.syncHud(note);
  },
  complete() {
    if (!this.active || !this.id) return;
    const id = this.id, d = WORKSHOP_DRILLS[id];
    const best = Workshop.bestLabel(id);
    const unlocked = this.sessionUnlocks.slice();
    this.active = false;
    G.state = 'practiceDone';
    clearCeremony(); Replay.reset();
    hideAll();
    const hud = $('workshopHud'); if (hud) hud.classList.add('hidden');
    const title = $('workshopDoneTitle'), copy = $('workshopDoneText');
    if (title) title.textContent = d.name + ' mastered.';
    if (copy) {
      const pb = best ? 'PB ' + best + '. ' : '';
      const unlock = unlocked.length ? 'Unlocked ' + unlocked.map(x => THEMES[x].name).join(', ') + '. ' : '';
      copy.textContent = pb + unlock + 'All 3 stages cleared.';
    }
    $('workshopDone').classList.remove('hidden');
    Haptics.fire('win');
    AudioSys.goalChord(THEME.goalChord || [392,523.25,659.25,783.99]);
    Workshop.current = null;
  },
};
// puck pace: how lively the table plays
const PACES = {
  casual:    { damp: 0.22,  wall: 0.88, serve: 560, label: 'Casual' },
  classic:   { damp: 0.09,  wall: 0.95, serve: 780, label: 'Classic' },
  lightning: { damp: 0.045, wall: 0.99, serve: 980, label: 'Lightning' },
};
const paceDamp = () => PACES[Settings.pace].damp;
const paceWall = () => PACES[Settings.pace].wall;
const paceServe = () => PACES[Settings.pace].serve;

// ---------- physics tuning (from research) ----------
// Real tables: puck floats on air jets - near-zero friction. A good shove
// crosses an 8ft table several times. Damping here is exponential /s.
const PUCK_DAMP = 0.09;              // default damping; pace setting overrides at runtime
const WALL_REST = 0.95;              // default rail restitution; pace setting overrides at runtime
const PUCK_MAX = 3100;               // fastest pro smash, in units/s
const STRIKE_XFER = 1.45;            // mallet->puck velocity transfer
const SMACK_BONUS = 0.55;            // extra punch on fast flicks
const SUB_HZ = 240;                  // physics substeps (anti-tunnel)
const STALL_V = 130, STALL_T = 1.4;  // anti-dead-puck trigger
const GLUE_HARD_CUTOFF = 1.2;        // corner-pin release timing (see collideMallet); was 2.5

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rand = (a, b) => a + Math.random() * (b - a); // themes.js uses rand(a,b)
const hyp = Math.hypot;
// '#rrggbb' + alpha -> 'rgba(...)' - theme hexes need alpha for glow overlays
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'rgba(216,169,63,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
let interacted = false; // set on first real pointer input (gates vibrate)

// ---------- procedural audio ----------
const AudioSys = {
  ctx: null, sfxBus: null, musicBus: null, muted: false,
  init() {
    if (this.ctx) { this._ensureAmbience(); MusicSys.prime(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // Sound Effects and Music (including room ambience) have independent
      // gain stages. Global mute is represented only by both visible sliders
      // being at zero, so there is no hidden master state to drift out of sync.
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.ctx.destination);
      this.musicBus.connect(this.ctx.destination);
      this.syncMute();
      this.syncMusic();
    } catch (e) { /* silent */ }
    this._ensureAmbience();
    MusicSys.prime(); // generative music also waits for the first user gesture
  },
  // starts the pending room's bed once a ctx exists (autoplay-safe: only
  // called from init(), which only runs on real user input)
  _ensureAmbience() { if (this.ctx && this.ambKey) this.ambience(this.ambKey); },
  // suspend()/resume() back the focus-loss pause: every voice routes through
  // this context, so suspending it silences music, SFX, and ambience at once.
  // Promises are caught - resume() without a user gesture stays suspended
  // (browser policy) instead of throwing an unhandled rejection.
  suspend() { try { if (this.ctx && this.ctx.state === 'running') { const p = this.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} },
  resume() { try { if (this.ctx && this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} },
  // layered clack: noise transient + tonal body, pitch mapped to impact, ±5% variance.
  // pitchMul climbs ~3% per rally hit so long rallies audibly tighten.
  hit(power, pitchMul = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, vr = (1 + rnd(-0.05, 0.05)) * pitchMul;
    const p = clamp(power, 0, 1);
    // transient
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g1 = this.ctx.createGain(); g1.gain.value = 0.5 * p + 0.08;
    src.connect(hp); hp.connect(g1); g1.connect(this.sfxBus);
    src.start(t);
    // body
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = (170 + p * 460) * vr;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.55 * p + 0.06, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o.connect(g2); g2.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
  },
  // Dry, ultra-short perfect-strike signature; no ordinary hit on top.
  perfectCrack() {
    if (!this.ctx || this.muted) return;
    const ac = this.ctx, t = ac.currentTime;
    const src = ac.createBufferSource(); src.buffer = this._noiseBuf();
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 2850; bp.Q.value = 0.85;
    const g = ac.createGain();
    g.gain.setValueAtTime(Feel.tuning.perfectCrackGain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.042);
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t, rnd(1.7)); src.stop(t + 0.05);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} };
    const o = ac.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(460, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.035);
    const bg = ac.createGain();
    bg.gain.setValueAtTime(0.14, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.043);
    o.connect(bg); bg.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.048);
    o.onended = () => { try { o.disconnect(); bg.disconnect(); } catch (e) {} };
  },
  // mallet whoosh: fast flicks get an airy sweep before the clack lands
  whoosh(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = clamp(power, 0, 1);
    const len = Math.floor(this.ctx.sampleRate * 0.16);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.14);
    const g = this.ctx.createGain(); g.gain.value = 0.10 + p * 0.14;
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t);
  },
  // save thud: a soft low knock for goal-line blocks - felt, not announced
  thud() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.2);
  },
  // post ping: the goal frame rings when the puck kisses it
  ping() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [622, 933].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * (1 + rnd(-0.01, 0.01));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(i ? 0.10 : 0.16, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.24);
    });
  },
  // goal-frame clank: a heavier metallic knock than the post ping - the
  // whole frame takes the hit, so it answers low and long instead of bright
  clank(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = clamp(power, 0.15, 1);
    // hollow low partials: inharmonic so it reads as bent metal, not a bell
    [208, 311, 517].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * (1 + rnd(-0.015, 0.015));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime((i ? 0.08 : 0.20) * p, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.30 + i * 0.05);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.5);
    });
    // the metal-on-metal knock: a short burst of filtered noise up front
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.22 * p, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
    src.start(t, rnd(1.2)); src.stop(t + 0.1);
  },
  rail(power) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, p = clamp(power, 0, 1);
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.value = 130 * (1 + rnd(-0.05, 0.05));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22 * p + 0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.1);
  },
  goalChord(notes, energy = 1) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime, e = clamp(energy, 0.35, 1.15);
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4 * e, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g); g.connect(this.sfxBus);
      o.start(t); o.stop(t + 0.75);
    });
    // air swell: scales harder than the notes so conceded goals stay restrained.
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0.25 * e * e;
    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    src.start(t0);
  },
  blip(f, dur = 0.09, vol = 0.3) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
  },
  ui() { this.blip(1150, 0.05, 0.18); },
  count(final) { this.blip(final ? 990 : 620, final ? 0.28 : 0.12, 0.32); },
  // ---------- room ambience (generated, no assets) ----------
  // Subtle per-room bed (looped shaped noise) plus sparse random events:
  // jazz-room bass plucks, poolside laps, a concrete-hall wash, felt hush,
  // loft murmur swells with the odd glass clink, machiya rain and wood
  // creaks. Levels sit well under SFX. The bed rides the music bus, so it
  // follows the Music volume - muting Sound Effects leaves it playing. The bed only
  // ever exists after init(), which runs solely on real user input
  // (autoplay-safe). Switching rooms crossfades the bed instead of clicking.
  ambKey: null, amb: null, ambTimer: null,
  ambience(id) { // public: called from setTheme()
    if (!ROOM_AMB[id]) id = 'deco';
    this.ambKey = id;
    if (this.ctx && (!this.amb || this.amb.key !== id)) this._startAmbience();
  },
  syncMute() {
    if (!this.sfxBus) return;
    const v = clamp(Settings.soundVolume, 0, 100) / 100;
    this.muted = v <= 0;
    this.sfxBus.gain.value = this.muted ? 0 : 0.5 * Math.pow(v, 1.5);
  }, // SFX/UI only - 100 preserves the calibrated 0.5 gain
  syncMusic() {
    if (!this.musicBus) return;
    const v = clamp(Settings.musicVolume, 0, 100) / 70;
    this.musicBus.gain.value = v <= 0 ? 0 : Math.min(2, Math.pow(v, 1.5));
  }, // whole music + ambience bus; 70 is unity
  isMasterMuted() {
    return Settings.soundVolume <= 0 && Settings.musicVolume <= 0;
  },
  setMasterMuted(m) {
    const mute = !!m;
    const wasMuted = this.isMasterMuted();
    if (mute && !wasMuted) {
      // Snapshot the exact mix, including an intentionally-zero channel.
      Settings.soundBeforeMute = Settings.soundVolume;
      Settings.musicBeforeMute = Settings.musicVolume;
      Settings.soundVolume = 0;
      Settings.musicVolume = 0;
    } else if (!mute && wasMuted) {
      let sound = clamp(Math.round(Number(Settings.soundBeforeMute) || 0), 0, 100);
      let music = clamp(Math.round(Number(Settings.musicBeforeMute) || 0), 0, 100);
      // If both sliders were manually dragged to zero before any mute snapshot,
      // restore the calibrated defaults rather than making "unmute" a no-op.
      if (sound <= 0 && music <= 0) { sound = 100; music = 70; }
      Settings.soundVolume = sound;
      Settings.musicVolume = music;
    }
    try { saveSettings(); } catch (e) {}
    this.syncMute();
    this.syncMusic();
    MusicSys.syncEnabled();
    return this.isMasterMuted();
  },
  _noiseBuf() { // cached 2s loopable noise, pink-ish so beds stay smooth
    if (this._nb) return this._nb;
    const len = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.08;
    }
    this._nb = buf; return buf;
  },
  _startAmbience() {
    const cfg = ROOM_AMB[this.ambKey || 'deco'];
    const t = this.ctx.currentTime;
    this._killAmbience(); // fade out whatever was playing
    // bed: looped noise -> per-room filter -> gain -> master
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf(); src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2; // no two rooms identical
    const flt = this.ctx.createBiquadFilter();
    flt.type = cfg.bed.type; flt.frequency.value = cfg.bed.f; flt.Q.value = cfg.bed.q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(cfg.bed.g, t + 0.1, 0.9); // gentle 2s swell-in
    src.connect(flt); flt.connect(g); g.connect(this.musicBus);
    const nodes = { key: this.ambKey, src, flt, g, cfg, wet: [] };
    // brut hall: a short feedback delay as a cheap room wash on the bed
    if (cfg.bed.hall) {
      const dly = this.ctx.createDelay(1); dly.delayTime.value = 0.31;
      const fb = this.ctx.createGain(); fb.gain.value = 0.35;
      const wet = this.ctx.createGain(); wet.gain.value = 0.5;
      g.connect(dly); dly.connect(fb); fb.connect(dly);
      dly.connect(wet); wet.connect(this.musicBus);
      nodes.wet = [dly, fb, wet];
    }
    // poolside air breathes: slow LFO on the bed gain
    if (cfg.bed.lfo) {
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = cfg.bed.lfo;
      const lg = this.ctx.createGain(); lg.gain.value = cfg.bed.g * 0.35;
      lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
      nodes.lfo = lfo;
    }
    src.start(t);
    this.amb = nodes;
    if (!this.ambTimer) this.ambTimer = setInterval(() => this._ambTick(), 1100);
  },
  _killAmbience() {
    if (!this.amb) return;
    const a = this.amb; this.amb = null;
    const t = this.ctx.currentTime;
    a.g.gain.cancelScheduledValues(t);
    a.g.gain.setTargetAtTime(0.0001, t, 0.35); // fade fast, disconnect late
    setTimeout(() => {
      try { a.src.stop(); } catch (e) {}
      [a.src, a.flt, a.g, a.lfo].concat(a.wet).forEach(n => { if (n) try { n.disconnect(); } catch (e) {} });
    }, 1500);
  },
  _ambTick() { // every ~1.1s: roll the room's sparse events
    if (!this.amb || !this.ctx || Settings.musicVolume <= 0 || this.ctx.state !== 'running') return;
    const a = this.amb, cfg = a.cfg, t = this.ctx.currentTime;
    // the loft murmurs: slow random swells on the bed
    if (cfg.bed.swell) a.g.gain.setTargetAtTime(cfg.bed.g * rnd(0.7, 1.3), t, 1.2);
    for (const ev of cfg.events) if (Math.random() < ev.p) this[ev.f]();
  },
  // --- sparse room one-shots (music/ambience bus; gated by _ambTick) ---
  _bass() { // distant upright pluck in the jazz room
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = [55, 65.41, 73.42, 82.41, 98][Math.floor(rnd(5))];
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.6);
  },
  _mote() { // faint piano-ish mote, A-minor colour
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = [110, 130.81, 146.83, 164.81, 220][Math.floor(rnd(5))];
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.028, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 1.05);
  },
  _splash() { // soft poolside lap
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf();
    src.playbackRate.value = 1.4;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(hp); hp.connect(g); g.connect(this.musicBus);
    src.start(t, rnd(1.5)); src.stop(t + 0.35);
  },
  _clink() { // distant glass in the loft
    const t = this.ctx.currentTime;
    [2490, 3160].forEach((f, i) => {
      const o = this.ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = f * (1 + rnd(-0.01, 0.01));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(i ? 0.014 : 0.02, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.45);
    });
  },
  _creak() { // old wood settling in the machiya
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(105, t + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.032, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + 0.85);
  },
};
// Per-room ambience character, keyed by theme id.
const ROOM_AMB = {
  deco:  { bed: { type: 'lowpass',  f: 400,  q: 0.6, g: 0.022 },
           events: [ { p: 0.26, f: '_bass' }, { p: 0.16, f: '_mote' } ] },
  mid:   { bed: { type: 'bandpass', f: 850,  q: 0.7, g: 0.026, lfo: 0.12 },
           events: [ { p: 0.10, f: '_splash' } ] },
  brut:  { bed: { type: 'lowpass',  f: 170,  q: 0.5, g: 0.020, hall: true },
           events: [] },
  bil:   { bed: { type: 'lowpass',  f: 240,  q: 0.5, g: 0.012 },
           events: [] },
  mem:   { bed: { type: 'bandpass', f: 520,  q: 1.0, g: 0.028, swell: true },
           events: [ { p: 0.07, f: '_clink' } ] },
  sashi: { bed: { type: 'highpass', f: 2600, q: 0.5, g: 0.024 },
           events: [ { p: 0.05, f: '_creak' } ] },
  bau:   { bed: { type: 'bandpass', f: 640,  q: 0.8, g: 0.024 },
           events: [ { p: 0.06, f: '_clink' } ] },   // the workshop: airy room tone, distant tool clinks
  zel:   { bed: { type: 'bandpass', f: 1200, q: 0.6, g: 0.020 },
           events: [ { p: 0.09, f: '_splash' } ] }, // the courtyard fountain
  swi:   { bed: { type: 'highpass', f: 3000, q: 0.5, g: 0.014 },
           events: [ { p: 0.04, f: '_mote' } ] },    // the gallery hush
  neon:  { bed: { type: 'bandpass', f: 300,  q: 0.9, g: 0.018, hall: true },
           events: [ { p: 0.05, f: '_mote' } ] },    // the arcade after hours: electric hum, faint neon buzz
};

// ---------- generative music ----------
// MusicSys: a seeded generative ambient engine - one musical identity per
// table, 100% synthesized (no assets, so the PWA offline story stays
// intact). Layers follow the shipped-game hybrid pattern:
//   * vertical: a pad bed always; at match point a pulse layer joins plus
//     denser melody and a slightly lifted bed; goals get a soft swell while
//     the bed ducks under the goal ceremony.
//   * horizontal: table changes crossfade to the new room's music.
//   * stingers: none - the goal ceremony owns that moment; music stays back.
// Scheduling: a 150ms interval schedules against audioContext.currentTime
// with 0.4s lookahead; musical time is an accumulated ideal clock, never
// the timer's own firing time, so tab jank can't drift the beat. The RNG is
// seeded per table (mulberry32), so each room's music is a stable identity
// across sessions, not a shuffle. Music rides AudioSys.musicBus - the Sound
// Sound Effects volume never touches it, and Music volume never touches SFX.
// Euclidean onset pattern: k hits spread as evenly as possible over n steps,
// rotated by rot. Bjorklund's algorithm, the same math behind the tresillo
// E(3,8) = [x..x..x.] and the cinquillo E(5,8). Used for bass lines and percussion.
function euclid(k, n, rot) {
  const seq = [];
  if (k <= 0 || n <= 0) return new Array(Math.max(0, n)).fill(false);
  if (k >= n) return new Array(n).fill(true);
  const counts = [], remainders = [];
  let divisor = n - k, level = 0;
  remainders.push(k);
  for (;;) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level++;
    if (remainders[level] <= 1) break;
  }
  counts.push(divisor);
  (function build(l) {
    if (l === -1) seq.push(false);
    else if (l === -2) seq.push(true);
    else {
      for (let i = 0; i < counts[l]; i++) build(l - 1);
      if (remainders[l] !== 0) build(l - 2);
    }
  })(level);
  // start on a hit, then apply the rotation
  const first = seq.indexOf(true);
  const lined = first > 0 ? seq.slice(first).concat(seq.slice(0, first)) : seq;
  const r = ((rot || 0) % n + n) % n;
  return r ? lined.map((_, i) => lined[(i - r + n) % n]) : lined;
}
// Generative music, composed: every table gets its own harmonic progression,
// its own motivic material, and its own rhythmic grammar. The engine walks
// each progression in composed order (not random), develops a short motif
// through repetition, sequence, inversion and fragmentation, and arranges
// itself across 2-phrase sections (enter, settle, full, break) so the room
// breathes. Percussion uses Euclidean onset patterns with velocity accents,
// restrained swing and ghost notes; rooms that should be still get none.
// Fields per room:
//   seed/root/mode/bpm: identity. padCut: lowpass on the pad. melWave: motif voice.
//   prog: the progression, one chord per 4-bar phrase. Each chord is {r, t}:
//     r = root offset in semitones from the table root, t = chord tones voiced
//     compactly above that root (common tones shared with neighbors wherever
//     the harmony allows, so the pad glides instead of jumping).
//   bridge: alternate chords for every 4th cycle (a turnaround keeps long
//     matches from looping identically forever).
//   bass: Euclidean pattern over a 16-step bar; k hits, n steps, rot offset;
//     alt = interval (semitones) the pattern alternates to on odd hits.
//   motif: q = the question phrase, a = the answer phrase, as [mode-degree, beats].
//     Degrees wrap octaves diatonically, so sequences and inversions stay in key.
//   drums: null where the room should be still; otherwise per-layer Euclidean
//     patterns {k, n, rot, vol}. swing = off-8th delay as a fraction of a
//     16th; ghost = probability of a barely-there extra 16th.
//   form: per-section voice densities [enter, settle, full, break]; match point
//     forces the full section.
const MUSIC = {
  deco:  { seed: 1929, root: 45, mode: [0, 2, 3, 5, 7, 9, 10], bpm: 56, padCut: 800,  melWave: 'triangle', swing: 0.12, level: 1.100,
           prog: [ {r:0,t:[0,3,7,10,14]}, {r:8,t:[8,12,15,19,22]}, {r:5,t:[5,8,12,17,19]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,8,12,17,19]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:2, n:16, rot:0, vol: 0.225, wave: 'sine', cut: 500, alt: 7 },
           motif: { q: [[4,1],[5,1],[6,2]], a: [[5,1],[4,1],[3,1],[2,2]] },
           drums: null,
           form: [ {bass:0,mel:.5,drums:0}, {bass:.6,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.3,mel:.4,drums:0} ],
           pulse: false, drone: false, shimmer: false },   // noir lounge: A melodic-minor ballad, Am9 Fmaj9 Dm9 E7, motif in thirds
  mid:   { seed: 1977, root: 43, mode: [0, 2, 3, 5, 7, 8, 10], bpm: 96, padCut: 1400, melWave: 'sawtooth', swing: 0.04, level: 1.000,
           prog: [ {r:0,t:[0,3,7,14]}, {r:8,t:[8,12,15,19]}, {r:3,t:[3,7,10,14]}, {r:10,t:[10,14,17,21]} ],
           bridge: [ {r:8,t:[8,12,15,19]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:4, n:16, rot:0, vol: 0.250, wave: 'sawtooth', cut: 700, alt: 12 },
           motif: { q: [[4,1],[5,1],[4,1],[2,1]], a: [[5,2],[4,1],[3,1]] },
           drums: { kick: {k:4,n:16,rot:0,vol:.32}, snare: {k:2,n:16,rot:4,vol:.28}, hat: {k:8,n:16,rot:0,vol:.10}, ghost: 0 },
           form: [ {bass:.5,mel:.5,drums:.5}, {bass:.8,mel:.7,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.4,mel:.5,drums:0} ],
           pulse: true, drone: false, shimmer: true },     // synthwave: four-on-the-floor, driving octave bass, neon motif
  brut:  { seed: 1963, root: 41, mode: [0, 1, 3, 5, 7, 8, 10], bpm: 66, padCut: 500,  melWave: 'sine',     swing: 0,    level: 1.100,
           prog: [ {r:0,t:[0,3,7,12]}, {r:8,t:[8,12,15]}, {r:0,t:[0,3,7]}, {r:7,t:[7,11,14]} ],
           bridge: [ {r:8,t:[8,12,15]}, {r:7,t:[7,11,14]} ],
           bass: { k:1, n:16, rot:0, vol: 0.300, wave: 'sine', cut: 300, alt: 0 },
           motif: { q: [[0,2],[1,2]], a: [[0,4]] },
           drums: null,
           form: [ {bass:.5,mel:.5,drums:0}, {bass:1,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.5,mel:.5,drums:0} ],
           pulse: false, drone: true, shimmer: false },     // brutalist drone: phrygian concrete, one massive bass hit per bar
  bil:   { seed: 1955, root: 48, mode: [0, 2, 3, 5, 7, 9, 10], bpm: 72, padCut: 1100, melWave: 'triangle', swing: 0.30, level: 1.100,
           prog: [ {r:0,t:[0,3,7,10,14]}, {r:5,t:[5,9,12,15,19]}, {r:0,t:[0,3,7,10]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,9,12,15,19]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:3, n:16, rot:2, vol: 0.220, wave: 'sine', cut: 600, alt: 7 },
           motif: { q: [[4,1],[3,1],[2,2]], a: [[2,1],[1,1],[0,2]] },
           drums: null,
           form: [ {bass:.5,mel:.6,drums:0}, {bass:.8,mel:.8,drums:0}, {bass:1,mel:1,drums:0}, {bass:.4,mel:.5,drums:0} ],
           pulse: false, drone: false, shimmer: false },    // billiard room: C dorian jazz, Cm9 F9 G7, heavy swing, blue-note descent
  mem:   { seed: 1968, root: 45, mode: [0, 2, 4, 5, 7, 9, 10], bpm: 112, padCut: 1600, melWave: 'square', swing: 0.08, level: 1.000,
           prog: [ {r:0,t:[0,4,7,10]}, {r:5,t:[5,9,12,15]}, {r:0,t:[0,4,7,10]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,9,12,15]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:4, n:16, rot:0, vol: 0.260, wave: 'triangle', cut: 800, alt: 12 },
           motif: { q: [[0,1],[2,1],[4,1],[5,1]], a: [[4,1],[2,1],[0,2]] },
           drums: { kick: {k:2,n:16,rot:0,vol:.32}, snare: {k:2,n:16,rot:4,vol:.28}, hat: {k:8,n:16,rot:2,vol:.11}, ghost: .6 },
           form: [ {bass:.6,mel:.6,drums:.6}, {bass:.8,mel:.8,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.5,mel:.6,drums:.4} ],
           pulse: true, drone: false, shimmer: false },     // memphis juke joint: mixolydian I7 IV7 V7, offbeat hats, walking fire
  sashi: { seed: 1988, root: 50, mode: [0, 2, 5, 7, 8],       bpm: 60, padCut: 2400, melWave: 'sine',     swing: 0,    level: 0.900,
           prog: [ {r:0,t:[0,5,7,12]}, {r:5,t:[5,8,12]}, {r:0,t:[0,5,7]}, {r:7,t:[7,12,14]} ],
           bridge: [ {r:5,t:[5,8,12]}, {r:7,t:[7,12,14]} ],
           bass: { k:1, n:16, rot:8, vol: 0.200, wave: 'sine', cut: 500, alt: 0 },
           motif: { q: [[3,2],[2,2]], a: [[2,3],[1,1]] },
           drums: null,
           form: [ {bass:.5,mel:.5,drums:0}, {bass:.7,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.3,mel:.4,drums:0} ],
           pulse: false, drone: false, shimmer: true },      // kaiseki: hirajoshi stillness, two-note motifs, space as an instrument
  bau:   { seed: 1972, root: 40, mode: [0, 2, 3, 5, 7, 8, 10], bpm: 120, padCut: 2000, melWave: 'sawtooth', swing: 0,   level: 1.000,
           prog: [ {r:0,t:[0,3,7,12]}, {r:8,t:[8,12,15]}, {r:3,t:[3,7,10]}, {r:10,t:[10,14,17]} ],
           bridge: [ {r:8,t:[8,12,15]}, {r:11,t:[11,15,18]} ],
           bass: { k:8, n:16, rot:0, vol: 0.240, wave: 'sawtooth', cut: 900, alt: 12 },
           motif: { q: [[4,1],[4,1],[5,1],[4,1]], a: [[3,1],[2,1],[1,1],[0,1]] },
           drums: { kick: {k:4,n:16,rot:0,vol:.30}, snare: {k:2,n:16,rot:4,vol:.26}, hat: {k:16,n:16,rot:0,vol:.09}, ghost: .3 },
           form: [ {bass:.7,mel:.5,drums:.6}, {bass:1,mel:.7,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.6,mel:.5,drums:.5} ],
           pulse: true, drone: false, shimmer: false },     // bauhaus motorik: 16th hats, root-octave bass engine, relentless
  zel:   { seed: 1994, root: 40, mode: [0, 1, 4, 5, 7, 8, 10], bpm: 104, padCut: 1200, melWave: 'sawtooth', swing: 0.06, level: 1.000,
           prog: [ {r:0,t:[0,4,7,12]}, {r:1,t:[1,5,8]}, {r:0,t:[0,4,7]}, {r:10,t:[10,14,17]} ],
           bridge: [ {r:1,t:[1,5,8]}, {r:0,t:[0,4,7]} ],
           bass: { k:6, n:16, rot:0, vol: 0.270, wave: 'sawtooth', cut: 800, alt: 0 },
           motif: { q: [[0,1],[1,1],[0,1],[3,1]], a: [[3,1],[2,1],[1,1],[0,1]] },
           drums: { kick: {k:3,n:16,rot:0,vol:.32}, snare: {k:1,n:16,rot:8,vol:.26}, hat: {k:6,n:16,rot:0,vol:.10}, ghost: .5 },
           form: [ {bass:.6,mel:.6,drums:.6}, {bass:.8,mel:.8,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.5,mel:.5,drums:.4} ],
           pulse: false, drone: false, shimmer: false },    // zellige: phrygian-dominant gnawa trance, tresillo kick, pedal bass
  swi:   { seed: 1957, root: 41, mode: [0, 2, 4, 5, 7, 9, 11], bpm: 76, padCut: 2200, melWave: 'sine',     swing: 0.10, level: 0.900,
           prog: [ {r:0,t:[0,4,7,12]}, {r:5,t:[5,9,12]}, {r:0,t:[0,4,7]}, {r:7,t:[7,11,14,17]} ],
           bridge: [ {r:5,t:[5,9,12]}, {r:7,t:[7,11,14,17]} ],
           bass: { k:2, n:16, rot:4, vol: 0.200, wave: 'sine', cut: 500, alt: 7 },
           motif: { q: [[4,1],[5,1],[7,2]], a: [[5,1],[4,1],[2,2]] },
           drums: null,
           form: [ {bass:.5,mel:.5,drums:0}, {bass:.7,mel:.7,drums:0}, {bass:1,mel:1,drums:0}, {bass:.4,mel:.5,drums:0} ],
           pulse: false, drone: false, shimmer: true },     // alpine music box: F major I IV V, gentle ascent, snow-light
  neon:  { seed: 1983, root: 33, mode: [0, 2, 3, 5, 7, 8, 10], bpm: 118, padCut: 900,  melWave: 'sawtooth', swing: 0.05, level: 1.000,
           prog: [ {r:0,t:[0,3,7,12]}, {r:3,t:[3,7,10,14]}, {r:5,t:[5,8,12,16]}, {r:7,t:[7,10,14,17]} ],
           bridge: [ {r:3,t:[3,7,10,14]}, {r:7,t:[7,10,14,17]} ],
           bass: { k:8, n:16, rot:0, vol: 0.260, wave: 'sawtooth', cut: 1000, alt: 12 },
           motif: { q: [[4,1],[2,1],[0,1],[2,1]], a: [[3,1],[2,1],[0,2]] },
           drums: { kick: {k:4,n:16,rot:0,vol:.32}, snare: {k:2,n:16,rot:4,vol:.28}, hat: {k:16,n:16,rot:0,vol:.09}, ghost: .4 },
           form: [ {bass:.6,mel:.5,drums:.6}, {bass:.8,mel:.7,drums:.8}, {bass:1,mel:1,drums:1}, {bass:.5,mel:.5,drums:.5} ],
           pulse: true, drone: false, shimmer: false },      // neon midnight: i III iv v synthwave, 16th hats, night-drive
};

const MusicSys = {
  key: 'deco', pendingKey: 'deco', intensity: 0, rally: 0,
  timer: 0, nodes: null, nextT: 0, beat: 0,
  rng: null, progIdx: 0, curChord: null, xfade: 0, sessionSeed: 0,
  bassHit: 0, bassPat: null, kickPat: null, snarePat: null, hatPat: null, prevPad: null,
  voices: [], // live voice gains - killed on room switch so the old room's long pad tail can't bleed into the new room
  mf(m) { return 440 * Math.pow(2, (m - 69) / 12); }, // midi -> hz
  cfg() { return MUSIC[this.key] || MUSIC.deco; },
  ac() { return AudioSys.ctx; },
  // User music volume lives on AudioSys.musicBus so it scales both the
  // generative score and room ambience together. Per-room dynamics stay here.
  targetLevel() { return this.cfg().level * (this.intensity ? 1.3 : 1) * (1 + this.rally * Feel.tuning.rallyMusicLift); },
  applyVolume() { AudioSys.syncMusic(); },
  // --- lifecycle ---
  prime() { // first-user-gesture path, via AudioSys.init()
    if (Settings.musicVolume <= 0 || !this.ac()) return;
    this.key = this.pendingKey = (MUSIC[G.themeId] ? G.themeId : 'deco');
    this.start();
  },
  syncEnabled() { // the Music slider calls here
    if (Settings.musicVolume > 0) { if (this.ac() && !this.timer) this.start(); }
    else this.stop();
  },
  setTable(id) { // from setTheme: always records; crossfades when audible
    if (!MUSIC[id]) id = 'deco';
    this.pendingKey = id;
    if (!this.timer || id === this.key || !this.nodes) return;
    const token = ++this.xfade, self = this;
    const t = this.ac().currentTime, g = this.nodes.musicG.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.0001, t, 0.25);
    // silence the old room's voices at once (the bus dip masks the cut) so
    // a 16-beat pad tail can't wash over the new room's entrance
    this.killVoices();
    setTimeout(() => {
      if (token !== self.xfade || !self.timer || !self.nodes) return;
      self.key = id; self.reseed();
      self.nodes.musicG.gain.setTargetAtTime(self.targetLevel(), self.ac().currentTime, 0.8);
    }, 750);
  },
  killVoices() { // disconnect every live generative voice; the bus dip hides the seam
    for (const v of this.voices) { try { v.disconnect(); } catch (e) {} }
    this.voices = [];
  },
  reseed() {
    const c = this.cfg();
    // The session seed lets two online peers derive the same generative
    // sequence (see the Net hello handshake); offline it is 0 and each room
    // uses its composed seed. Either way the music is deterministic.
    this.rng = mulberry32((c.seed ^ (this.sessionSeed | 0)) >>> 0);
    this.progIdx = 0; this.curChord = c.prog[0];
    this.beat = 0; this.bassHit = 0; this.prevPad = null;
    this.bassPat = c.bass ? euclid(c.bass.k, 16, c.bass.rot || 0) : null;
    if (c.drums) {
      this.kickPat = euclid(c.drums.kick.k, 16, c.drums.kick.rot || 0);
      this.snarePat = euclid(c.drums.snare.k, 16, c.drums.snare.rot || 0);
      this.hatPat = euclid(c.drums.hat.k, 16, c.drums.hat.rot || 0);
    } else this.kickPat = this.snarePat = this.hatPat = null;
  },
  // Online sync: the host deals one session seed in the hello handshake so
  // both peers seed the same generative sequence. Sample-phase alignment
  // is NOT guaranteed (separate AudioContexts, separate clocks); the shared
  // seed only guarantees the same notes in the same order.
  setSessionSeed(s) {
    this.sessionSeed = s | 0;
    if (this.timer) this.reseed(); // already playing: restart the sequence on the new seed
  },
  // Countdown start: restart the phrase on the shared downbeat. Host and
  // guest each anchor to their own countdown, so network jitter keeps them
  // from being sample-aligned - but both start the same phrase of the same
  // sequence at the same musical moment.
  alignBeat() {
    if (!this.timer || !this.ac()) return;
    this.beat = 0;
    this.nextT = this.ac().currentTime + 0.15;
  },
  start() {
    const ac = this.ac();
    if (!ac || this.timer || Settings.musicVolume <= 0) return;
    try { ac.resume(); } catch (e) {}
    this.key = this.pendingKey;
    this.buildBus();
    this.reseed();
    const t = ac.currentTime;
    this.nextT = t + 0.2;
    this.nodes.musicG.gain.setValueAtTime(0.0001, t);
    this.nodes.musicG.gain.setTargetAtTime(this.targetLevel(), t + 0.1, 1.4);
    this.timer = setInterval(() => this.tick(), 150);
  },
  stop() { // full stop: timer cleared, bus fades out, nodes disconnected late
    this.xfade++; // invalidate any in-flight crossfade
    this.killVoices();
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    const n = this.nodes, ac = this.ac();
    this.nodes = null;
    if (n && ac) {
      const t = ac.currentTime;
      try {
        n.musicG.gain.cancelScheduledValues(t);
        n.musicG.gain.setTargetAtTime(0.0001, t, 0.18);
      } catch (e) {}
      setTimeout(() => {
        [n.musicG, n.duckG, n.dly, n.fb, n.wet].forEach(x => { try { x.disconnect(); } catch (e) {} });
      }, 1400);
    }
  },
  buildBus() {
    const ac = this.ac();
    const musicG = ac.createGain(); musicG.gain.value = 0.0001; // per-room level
    const duckG = ac.createGain(); duckG.gain.value = 1;         // goal-ceremony dip
    musicG.connect(duckG); duckG.connect(AudioSys.musicBus);      // music rides its own bus - Sound Effects volume never touches it
    // one shared feedback delay as cheap space for plucks and shimmer
    const dly = ac.createDelay(1); dly.delayTime.value = 0.34;
    const fb = ac.createGain(); fb.gain.value = 0.32;
    const wet = ac.createGain(); wet.gain.value = 0.4;
    dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(musicG);
    this.nodes = { musicG, duckG, dly, fb, wet };
  },
  // --- scheduler ---
  tick() {
    if (!this.timer) return;
    const ac = this.ac();
    if (!ac || !this.nodes) return;
    if (ac.state !== 'running') { this.nextT = ac.currentTime + 0.2; return; } // re-anchor, never burst
    const spb = 60 / this.cfg().bpm, ahead = ac.currentTime + 0.4;
    let guard = 0;
    while (this.nextT < ahead && guard++ < 32) {
      this.scheduleBeat(this.nextT, this.beat, spb);
      this.nextT += spb; this.beat++;
    }
  },
  // One beat of composed music. Harmony turns over every 16-beat phrase;
  // bass and drums live on a 16-step grid inside each bar; the motif is laid
  // down whole-phrase at the phrase start so it always lands intact.
  scheduleBeat(t, n, spb) {
    const c = this.cfg(), pn = n % 16;
    const phraseN = (n - pn) / 16;
    const form = c.form[Math.floor(phraseN / 2) % 4]; // 2-phrase sections: enter, settle, full, break
    const dens = this.intensity ? { bass: 1, mel: 1, drums: 1 } : form; // match point: the room goes full
    if (pn === 0) this.startPhrase(t, spb, phraseN);
    if (c.bass) this.bass16(t, n, spb, dens.bass);
    if (c.drums && dens.drums > 0) this.drums16(t, n, spb, dens);
    if (this.intensity && c.pulse && pn % 2 === 0) this.pulseTok(t); // match-point motorik
    else if (this.rally >= 0.68 && c.pulse && pn % 4 === 0) this.pulseTok(t, this.rally * 0.19);
    if (c.shimmer && this.rng() < 0.10 * dens.mel) this.shimmerTone(t);
  },
  // Phrase start: advance the composed progression (the bridge chords every
  // 4th cycle), bloom the pad, lay the drone, and develop the motif.
  startPhrase(t, spb, phraseN) {
    const c = this.cfg();
    const cyc = Math.floor(this.progIdx / c.prog.length);
    const chord = (c.bridge && cyc % 4 === 3)
      ? c.bridge[this.progIdx % c.bridge.length]
      : c.prog[this.progIdx % c.prog.length];
    this.progIdx++;
    this.curChord = chord;
    this.padChord(chord.t.map(s => this.mf(c.root + s)), t, spb * 16);
    if (c.drone) this.tone({ f: this.mf(c.root - 12), t, a: 2.5, d: spb * 16, vol: 0.105, wave: 'sine', cut: 200 });
    this.scheduleMotif(t, spb, phraseN);
  },
  // Motivic development across the 8-phrase form cycle. The motif is stated
  // twice before anything develops it (no development without identity),
  // then moves through diatonic sequence, fragmentation with the answer
  // phrase, inversion, and a closing echo. Degrees wrap octaves diatonically,
  // so development can never play a wrong note.
  scheduleMotif(t, spb, phraseN) {
    const c = this.cfg(), m = c.motif;
    if (!m) return;
    const pc = phraseN % 8;
    const seq = (notes, steps) => notes.map(nb => [nb[0] + steps, nb[1]]);
    const inv = (notes) => { const p = notes[0][0]; return notes.map(nb => [2 * p - nb[0], nb[1]]); };
    const frag = (notes) => notes.slice(0, Math.max(1, Math.ceil(notes.length / 2)));
    let line;
    if (pc === 0 || pc === 1) line = m.q;
    else if (pc === 2) line = seq(m.q, 1);
    else if (pc === 3) line = frag(m.q).concat(m.a);
    else if (pc === 4) line = m.q;
    else if (pc === 5) line = inv(m.q);
    else if (pc === 6) line = seq(m.q, -1);
    else line = m.a.concat(frag(m.q));
    const form = c.form[Math.floor(phraseN / 2) % 4];
    const gate = (pc === 0 || pc === 1) ? 1 : (this.intensity ? 1 : form.mel);
    let bt = 0;
    const sq = c.melWave === 'square';
    for (const nb of line) {
      if (bt >= 16) break;
      if (this.rng() < gate)
        this.tone({ f: this.mf(c.root + 12 + this.degToSemi(c.mode, nb[0])), t: t + bt * spb,
                    a: 0.008, d: Math.min(nb[1] * spb * 0.92, 2.4), vol: sq ? 0.060 : 0.102,
                    wave: c.melWave, cut: sq ? 1800 : 2600, send: 0.5 });
      bt += nb[1];
    }
  },
  degToSemi(mode, deg) {
    const L = mode.length, o = Math.floor(deg / L);
    return mode[((deg % L) + L) % L] + 12 * o;
  },
  // Bass on the 16-step grid: the room's Euclidean pattern, roots from the
  // current chord, alternate hits stepping up to `alt` for line movement.
  bass16(t, n, spb, density) {
    const c = this.cfg(), b = c.bass, s16 = spb / 4;
    const step0 = (n % 4) * 4;
    for (let s = 0; s < 4; s++) {
      if (!this.bassPat[(step0 + s) % 16]) continue;
      if (this.rng() > density) continue;
      const alt = b.alt && ((this.bassHit++ % 2) === 1);
      const f = this.mf(c.root - 12 + this.curChord.r + (alt ? b.alt : 0));
      this.tone({ f, t: t + s * s16, a: 0.02, d: 1.6, vol: b.vol, wave: b.wave || 'sine', cut: b.cut || 500 });
    }
  },
  // Drums on the 16-step grid: Euclidean layers, velocity accents by grid
  // position (downbeat strongest), a couple ms of human lateness, restrained
  // swing on the off-8ths, and barely-there ghost 16ths.
  drums16(t, n, spb, dens) {
    const c = this.cfg(), d = c.drums, s16 = spb / 4;
    const step0 = (n % 4) * 4;
    const layers = [
      [this.kickPat, d.kick, (tt, v) => this.kickHit(tt, v)],
      [this.snarePat, d.snare, (tt, v) => this.snareHit(tt, v)],
      [this.hatPat, d.hat, (tt, v, st) => this.hatHit(tt, v, st)],
    ];
    for (const layer of layers) {
      const pat = layer[0], cfg = layer[1], play = layer[2];
      for (let s = 0; s < 4; s++) {
        const step = (step0 + s) % 16;
        if (!pat[step]) continue;
        if (step !== 0 && this.rng() > dens.drums) continue; // the downbeat anchor never drops
        const accent = step % 4 === 0 ? 1 : (step % 2 === 0 ? 0.8 : 0.55);
        const v = Math.max(0.012, cfg.vol * accent * (0.85 + this.rng() * 0.3));
        let tt = t + s * s16;
        if (c.swing && step % 4 === 2) tt += c.swing * spb / 6; // the swung off-8th sits late
        tt += 0.0015 + this.rng() * 0.003; // human: a couple ms late, never early
        play(tt, v, step);
      }
    }
    if (d.ghost && this.rng() < d.ghost * dens.drums)
      this.hatHit(t + (1 + 2 * Math.floor(this.rng() * 2)) * s16, 0.16 * d.hat.vol, -1);
  },
  kickHit(t, v) { // synthesized kick: 120 Hz dropping to 45, short and round
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const osc = ac.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.10);
    const g = ac.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g); g.connect(n.musicG);
    osc.start(t); osc.stop(t + 0.2);
    this.voices.push(g);
  },
  snareHit(t, v) { // noise burst through a bandpass plus body
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const src = ac.createBufferSource(); src.buffer = AudioSys._noiseBuf();
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(bp); bp.connect(g); g.connect(n.musicG);
    src.start(t); src.stop(t + 0.16);
    this.voices.push(g);
  },
  hatHit(t, v, step) { // highpassed noise tick; ghosts get the shortest tail
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const src = ac.createBufferSource(); src.buffer = AudioSys._noiseBuf();
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ac.createGain();
    const dur = step === -1 ? 0.03 : 0.045;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(g); g.connect(n.musicG);
    src.start(t); src.stop(t + dur + 0.02);
    this.voices.push(g);
  },
  shimmerTone(t) {
    const c = this.cfg();
    this.tone({ f: this.mf(c.root + 24 + [0, 7, 12][Math.floor(this.rng() * 3)]),
                t, a: 0.6, d: 3.6, vol: 0.048, wave: 'sine', cut: 4000, send: 0.7 });
  },
  // --- voices (all cheap: an osc or two, a filter, an envelope) ---
  tone(o) { // { f, t, a, d, vol, wave, cut, send }
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const osc = ac.createOscillator(); osc.type = o.wave || 'triangle'; osc.frequency.value = o.f;
    const flt = ac.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = o.cut || 2400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), o.t + (o.a || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + (o.a || 0.01) + o.d);
    osc.connect(flt); flt.connect(g); g.connect(n.musicG);
    let send = null;
    if (o.send) { send = ac.createGain(); send.gain.value = o.send; g.connect(send); send.connect(n.dly); }
    osc.start(o.t); osc.stop(o.t + (o.a || 0.01) + o.d + 0.1);
    this.voices.push(g); // room switches kill live voices (see killVoices)
    osc.onended = () => { try { osc.disconnect(); flt.disconnect(); g.disconnect(); if (send) send.disconnect(); } catch (e) {} };
  },
  padChord(freqs, t, dur, level = 0.090) {
    const ac = this.ac(), n = this.nodes, c = this.cfg();
    if (!n) return;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = c.padCut * (this.intensity ? 1.2 : 1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.setTargetAtTime(Math.max(0.0002, level), t + 0.05, Math.min(2.5, dur / 6)); // slow bloom
    g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 1.0);              // melt out before the next chord
    lp.connect(g); g.connect(n.musicG);
    this.voices.push(g); // the long pad tail is the main room-switch bleeder
    freqs.forEach((f, i) => {
      const o = ac.createOscillator(); o.type = 'triangle';
      o.frequency.value = f; o.detune.value = i % 2 ? 6 : -6;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.4);
      o.onended = () => { try { o.disconnect(); } catch (e) {} };
    });
    setTimeout(() => { try { lp.disconnect(); g.disconnect(); } catch (e) {} },
      Math.max(0, (t + dur + 0.6 - ac.currentTime) * 1000) + 400);
  },
  pulseTok(t, gain = 1) { // quieter variant supports rally tension
    const ac = this.ac(), n = this.nodes;
    if (!n) return;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(105, t + 0.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.090 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(n.musicG);
    o.start(t); o.stop(t + 0.1);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  },
  // --- adaptive events ---
  goalSwell(energy = 1) { // hierarchy follows the visual ceremony; never a jingle
    if (!this.timer || !this.ac() || !this.nodes) return;
    const ac = this.ac(), n = this.nodes, t = ac.currentTime, c = this.cfg();
    const e = clamp(energy, 0.4, 1.15);
    const duck = 0.76 - 0.26 * e;
    const returnAt = 0.45 + 0.65 * e;
    const returnTau = 0.38 + 0.32 * e;
    const swellPeak = 0.135 * e;
    const swellPeakAt = 0.40 + 0.15 * e;
    const swellEnd = 1.0 + 0.5 * e;
    n.duckG.gain.cancelScheduledValues(t);
    n.duckG.gain.setTargetAtTime(duck, t, 0.09);
    n.duckG.gain.setTargetAtTime(1.0, t + returnAt, returnTau);
    const src = ac.createBufferSource(); src.buffer = AudioSys._noiseBuf(); src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.9);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(swellPeak, t + swellPeakAt);
    g.gain.exponentialRampToValueAtTime(0.0001, t + swellEnd);
    src.connect(bp); bp.connect(g); g.connect(n.musicG);
    src.start(t); src.stop(t + swellEnd + 0.1);
    src.onended = () => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} };
    this.padChord((this.curChord ? this.curChord.t : c.prog[0].t).map(s => this.mf(c.root + s)),
      t + 0.05, 1.4 + e, 0.090 * e);
  },
  setRally(level, force = false) {
    level = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    if (!force && this.rally === level) return;
    this.rally = level;
    const n = this.nodes, ac = this.ac();
    if (n && ac) n.musicG.gain.setTargetAtTime(this.targetLevel(), ac.currentTime, 0.45);
    // The existing room bed ducks very slightly as meaningful returns build.
    const amb = AudioSys.amb;
    if (amb && ac && amb.g && amb.cfg)
      amb.g.gain.setTargetAtTime(amb.cfg.bed.g * (1 - level * 0.14), ac.currentTime, 0.38);
  },
  setIntensity(i) {
    i = i ? 1 : 0;
    if (i === this.intensity) return;
    this.intensity = i;
    const n = this.nodes, ac = this.ac();
    if (n && ac) n.musicG.gain.setTargetAtTime(this.targetLevel(), ac.currentTime, 0.8);
  },
  // --- structural introspection (headless verification) ---
  state() { return { key: this.key, pendingKey: this.pendingKey, intensity: this.intensity, running: !!this.timer }; },
};
const HAPTIC_PATTERNS = Object.freeze({
  strike: 10,
  perfect: 7,
  smash: [16, 22, 26],
  rail: 7,
  post: [12, 18, 14],
  save: [18, 24, 20],
  serve: 8,
  goal: [24, 30, 42],
  concede: [18, 30, 18],
  win: [28, 22, 42, 28, 70],
  loss: [18, 32, 18],
});
const HAPTIC_COOLDOWN = Object.freeze({
  strike: 70, perfect: 140, smash: 110, rail: 100, post: 140, save: 260,
  serve: 500, goal: 700, concede: 700, win: 1200, loss: 1200,
});
const Haptics = {
  last: Object.create(null),
  fire(name) {
    try {
      if (!interacted || !Settings.haptics || !navigator.vibrate) return false;
      const pattern = name === 'perfect' ? Feel.tuning.perfectHapticMs : HAPTIC_PATTERNS[name];
      if (pattern == null || pattern === 0) return false;
      const now = performance.now();
      const cooldown = HAPTIC_COOLDOWN[name] || 0;
      if (now - (this.last[name] || -1e9) < cooldown) return false;
      this.last[name] = now;
      navigator.vibrate(pattern);
      return true;
    } catch (e) { return false; }
  },
  cancel() { try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {} },
};
// ---------- game state ----------
// whiff: per-strike chance the AI swings clean through (a human error, never a
// superhuman stat - it only ever makes rivals weaker). windup: telegraph time.
const DIFFS = [
  {
    name:'Rookie', style:'COUNTER PUNCHER',
    maxSpeed:1080, react:0.22, aimErr:68, strike:0.88, aggro:0.64, tick:0.105, whiff:0.06, windup:0.13,
    homeDepth:175, homeTrack:0.40, bankChance:0.08, centerBias:0.28, recover:0.43,
    readKeeper:0.30, rebound:0.12, engageSpeed:1450, attackDelay:0.10, pressureDepth:70, pressBoost:0.10,
    counterWindow:1.05, counterSpeed:1950, blockOffset:82, laneMemory:0.42,
    triangleFloat:0.18, cutChance:0.62, underShare:0.84, sameRelease:0.18, delayChance:0.10,
  },
  {
    name:'Club Pro', style:'PLACEMENT PLAYER',
    maxSpeed:1320, react:0.12, aimErr:38, strike:1.05, aggro:0.76, tick:0.075, whiff:0.02, windup:0.11,
    homeDepth:205, homeTrack:0.44, bankChance:0.22, centerBias:0.10, recover:0.32,
    readKeeper:0.72, rebound:0.35, engageSpeed:1780, attackDelay:0.05, pressureDepth:95, pressBoost:0.14,
    counterWindow:0.82, counterSpeed:2200, blockOffset:72, laneMemory:0.16,
    triangleFloat:0.38, cutChance:0.54, underShare:0.72, sameRelease:0.55, delayChance:0.28,
  },
  {
    name:'Champion', style:'PRESSURE PLAYER',
    maxSpeed:1600, react:0.075, aimErr:20, strike:1.22, aggro:0.94, tick:0.05, whiff:0.005, windup:0.095,
    homeDepth:240, homeTrack:0.58, bankChance:0.44, centerBias:0.00, recover:0.22,
    readKeeper:0.92, rebound:0.62, engageSpeed:2180, attackDelay:0.00, pressureDepth:125, pressBoost:0.20,
    counterWindow:0.62, counterSpeed:2500, blockOffset:62, laneMemory:0.08,
    triangleFloat:0.56, cutChance:0.48, underShare:0.64, sameRelease:0.82, delayChance:0.42,
  },
];
const PLAYER_CAP = 4200; // mallet tracking cap - 1:1 feel, no teleporting

const G = {
  state: 'menu',            // menu | count | play | replay | goal | win | pause | practiceDone
  mode: 'ai', difficulty: 1,
  score: [0, 0], winSide: 0,
  m1: null, m2: null, puck: null,
  timeScale: 1, freezeT: 0,
  trauma: 0,
  countT: 0, countN: 3, goalT: 0, goalSlowT: 0, goalSide: 0,
  stallT: 0, stallX: CX, stallY: CY, anchorT: 0, lastTouch: -1,
  idleT: 0, demo: false, gwNet: 0, // gwNet: online guest's match-scoped goal-width override (v20)
  serveDir: 1,
  pausedFrom: 'play',
  focusLost: false,     // focus-loss freeze: sim+net hold, audio suspended, veil up
  scuffs: [], parts: [], trail: [], texts: [], pulses: [],
  puckSq: 1, puckSqA: 0,    // squash amount / angle
  puckSqV: 0,              // squash spring velocity (damped-spring recovery)
  letterT: 0, flashA: 0,
  hitFlash: 0, hitFlashX: 0, hitFlashY: 0, hitFlashR: 160, // speed-scaled SMASH impact flash
  roomPulse: 0,             // room reactivity: decays, feeds the lamp-glow overlay
  saveT: 0,                 // save-moment puck glow timer
  nearCd: 0,               // near-miss cooldown
  missGlow: null,           // { side, t } post glow after a near miss
  rattle: null,             // { side, t } goal-frame rattle after a hard frame hit
  goalFrameT: 0,            // goal-frame flash timer
  goalShockY: CY,            // visual-only mouth entry; never affects puck position
  board: freshBoard(),      // scoreboard animation state
  ai: null,                 // per-ai brain state
  stats: null,              // per-match stats (top speed, rally, time)
  onlineFlip: false,        // ONLINE: guest view is mirrored - they play from their own side
  hintLive: false,          // first-time hint currently showing on the table
  rallyHudT: 0, rallyHudN: 0, // brief rally milestones instead of persistent HUD clutter
  goalStreakLabel: '',       // one concise earned callout during goal celebration
  goalMomentLabel: '',       // tie / lead / match-point context
  goalRewardLabel: '',       // earned shot craft: bank / counter / rally / rocket
  goalContext: null,         // authority-owned bounded semantic goal presentation
  goalScorerLabel: '',       // YOU SCORE / ROOKIE SCORES / P1 SCORES
  goalRallyBonus: 0,         // capped contextual goal-release accent
  goalSpeedKmh: 0,           // speed at the instant the puck crossed the line
  inputDriveT: [0, 0],        // most recent relative/hover control activity per player side
  pausedGoalCeremony: null,   // semantic goal payload held across pause/focus loss
  themeId: 'deco',          // current table id (setTheme) - feeds the tour tracker
};
function freshStats() {
  return {
    topSpeed: 0, rally: 0, bestRally: 0, bestGoalRally: 0, bankGoals: [0, 0],
    rallyLastSide: -1, rallyLastX: 0, rallyLastY: 0, rallyLastMs: 0,
    saves: [0, 0], t0: 0, streak: [0, 0], bestStreak: [0, 0], worstDef: [0, 0],
  };
}
G.stats = freshStats();

// ---------- instant replay ----------
// Local-only visual rewind. The live simulation stays frozen and authoritative
// while render() temporarily borrows interpolated puck/mallet positions.
const REPLAY_HZ = 30;
const REPLAY_MAX = REPLAY_HZ * 5;
const REPLAY_OFFER_AT = 1.00;
const REPLAY_START_AT = 1.28;
const GOAL_HOLD_OWN = 1.95;
const GOAL_HOLD_CONCEDE = 1.60;
const GOAL_HOLD_WIN = 2.70;
function replayAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
function replayLerp(a, b, t) { return a + (b - a) * t; }
function replayMix(a, b, t) {
  const mixBody = (x, y) => ({
    x: replayLerp(x.x, y.x, t), y: replayLerp(x.y, y.y, t),
    vx: replayLerp(x.vx, y.vx, t), vy: replayLerp(x.vy, y.vy, t),
  });
  return {
    puck: {
      ...mixBody(a.puck, b.puck),
      w: replayLerp(a.puck.w, b.puck.w, t),
      ang: replayAngle(a.puck.ang, b.puck.ang, t),
    },
    m1: mixBody(a.m1, b.m1),
    m2: mixBody(a.m2, b.m2),
    puckSq: replayLerp(a.puckSq, b.puckSq, t),
    puckSqA: replayAngle(a.puckSqA, b.puckSqA, t),
  };
}
const Replay = {
  frames: [], active: false, clip: null, pendingClip: null,
  acc: 0, elapsed: 0, scorer: -1, pendingScorer: -1, returnMode: 'goal',
  requested: false, offerT: 0,
  reelQueue: null, reelIndex: 0, reelReturn: 'win', replayContext: '',
  sourceRate: 0.80,
  reset() {
    this.frames.length = 0; this.clip = null; this.pendingClip = null; this.active = false;
    this.acc = 0; this.elapsed = 0; this.scorer = -1; this.pendingScorer = -1; this.returnMode = 'goal';
    this.requested = false; this.offerT = 0;
    this.reelQueue = null; this.reelIndex = 0; this.reelReturn = 'win'; this.replayContext = '';
    this.hideOffer();
    const hud = document.getElementById('replayHud'); if (hud) hud.classList.add('hidden');
    const progress = document.getElementById('replayProgress'); if (progress) progress.style.transform = 'scaleX(0)';
    const winReplay = document.getElementById('btnWinReplay'); if (winReplay) winReplay.classList.add('hidden');
    document.body.classList.remove('replay-mode');
  },
  snapshot() {
    const body = m => ({ x:m.x, y:m.y, vx:m.vx, vy:m.vy });
    return {
      puck:{ x:G.puck.x, y:G.puck.y, vx:G.puck.vx, vy:G.puck.vy, w:G.puck.w || 0, ang:G.puck.ang || 0 },
      m1:body(G.m1), m2:body(G.m2), puckSq:G.puckSq, puckSqA:G.puckSqA,
    };
  },
  push() {
    this.frames.push(this.snapshot());
    if (this.frames.length > REPLAY_MAX) this.frames.shift();
  },
  record(dt) {
    if (this.active || G.mode === 'online' || G.mode === 'workshop' || G.demo || G.state !== 'play') return;
    this.acc += dt;
    const step = 1 / REPLAY_HZ;
    while (this.acc >= step) { this.acc -= step; this.push(); }
  },
  capture(scorer) {
    this.pendingClip = null; this.pendingScorer = -1; this.requested = false; this.offerT = 0;
    if (G.mode === 'online' || G.demo || this.frames.length < REPLAY_HZ) {
      this.frames.length = 0; this.acc = 0; return null;
    }
    this.push();
    const keep = Math.min(this.frames.length, Math.round(REPLAY_HZ * 2.4));
    const clip = this.frames.slice(-keep);
    if (Settings.instantReplay === 'goals' && goalIsYours(scorer)) {
      this.pendingClip = clip;
      this.pendingScorer = scorer;
    }
    this.frames.length = 0; this.acc = 0;
    return clip;
  },
  hasPending() { return !!(this.pendingClip && this.pendingClip.length > 1); },
  showOffer() {
    if (!this.hasPending() || this.active || this.requested) return;
    const b = document.getElementById('replayOffer'); if (b) b.classList.remove('hidden');
  },
  hideOffer() {
    const b = document.getElementById('replayOffer'); if (b) b.classList.add('hidden');
  },
  discardPending() {
    this.pendingClip = null; this.pendingScorer = -1; this.requested = false; this.offerT = 0; this.hideOffer();
  },
  keepOfferDuringCount(seconds = 1.0) {
    if (!this.hasPending()) return;
    this.offerT = seconds;
    this.showOffer();
  },
  tickOffer(dt) {
    if (!this.hasPending() || this.active || this.offerT <= 0 || G.state !== 'count') return;
    this.offerT = Math.max(0, this.offerT - dt);
    if (this.offerT <= 0) this.discardPending();
  },
  request() {
    if (!this.hasPending() || this.active) return;
    this.requested = true; this.offerT = 0; this.hideOffer();
    // During the celebration, remember the choice but let the emotional beat
    // land first. During countdown the player has explicitly chosen replay,
    // so play it immediately and restart countdown afterward.
    if (G.state === 'count') this.startPending('goal');
  },
  setHud(word = 'REPLAY', context = '') {
    const label = document.querySelector('#replayHud .replay-word');
    const detail = document.getElementById('replayContext');
    const skip = document.getElementById('replaySkip');
    if (label) label.textContent = word;
    if (detail) detail.textContent = context || '';
    if (skip) {
      const inReel = this.returnMode === 'reel' && this.reelQueue && this.reelQueue.length;
      skip.textContent = inReel && this.reelIndex < this.reelQueue.length - 1 ? 'Next' : (inReel ? 'Done' : 'Skip');
    }
  },
  startClip(clip, scorer, returnMode = 'win', context = '') {
    if (!clip || clip.length < 2 || this.active) return false;
    this.clip = clip;
    this.scorer = scorer;
    this.elapsed = 0; this.active = true; this.returnMode = returnMode; this.replayContext = context || '';
    this.requested = false; this.offerT = 0; this.hideOffer();
    const winReplay = document.getElementById('btnWinReplay'); if (winReplay) winReplay.classList.add('hidden');
    clearCeremony();
    hideAll();
    G.state = 'replay';
    document.body.classList.add('replay-mode');
    $('topbar').classList.add('hidden');
    const hud = document.getElementById('replayHud'); if (hud) hud.classList.remove('hidden');
    const progress = document.getElementById('replayProgress'); if (progress) progress.style.transform = 'scaleX(0)';
    this.setHud('REPLAY', this.replayContext);
    return true;
  },
  startReel(items, returnMode = 'win') {
    if (this.active) return false;
    const queue = (items || []).filter(item => item?.goal?.clip?.length > 1).slice(0, 3);
    if (!queue.length) return false;
    this.reelQueue = queue; this.reelIndex = 0; this.reelReturn = returnMode;
    return this.startReelItem();
  },
  startReelItem() {
    const item = this.reelQueue && this.reelQueue[this.reelIndex];
    if (!item) return false;
    const ok = this.startClip(item.goal.clip, item.goal.scorer, 'reel', item.title + ' · ' + item.detail);
    if (ok) this.setHud('MOMENT ' + (this.reelIndex + 1) + '/' + this.reelQueue.length, this.replayContext);
    return ok;
  },
  startPending(returnMode = 'goal') {
    if (!this.hasPending()) return false;
    const clip = this.pendingClip, scorer = this.pendingScorer;
    this.pendingClip = null; this.pendingScorer = -1;
    return this.startClip(clip, scorer, returnMode);
  },
  duration() {
    return this.clip && this.clip.length > 1 ? ((this.clip.length - 1) / REPLAY_HZ) / this.sourceRate : 0;
  },
  sample() {
    if (!this.clip || !this.clip.length) return null;
    if (this.clip.length === 1) return this.clip[0];
    const src = Math.min(this.clip.length - 1, this.elapsed * this.sourceRate * REPLAY_HZ);
    const i = Math.floor(src), j = Math.min(this.clip.length - 1, i + 1), t = src - i;
    return replayMix(this.clip[i], this.clip[j], t);
  },
  update(dt) {
    if (!this.active) return;
    this.elapsed += dt;
    const duration = this.duration();
    const progress = document.getElementById('replayProgress');
    if (progress) progress.style.transform = 'scaleX(' + clamp(duration > 0 ? this.elapsed / duration : 0, 0, 1).toFixed(3) + ')';
    if (this.elapsed >= duration) this.finish();
  },
  finish(forceExit = false) {
    if (!this.active) return;
    const ret = this.returnMode;
    if (ret === 'reel' && !forceExit && this.reelQueue && this.reelIndex < this.reelQueue.length - 1) {
      this.reelIndex++;
      const item = this.reelQueue[this.reelIndex];
      this.clip = item.goal.clip; this.scorer = item.goal.scorer; this.elapsed = 0;
      this.replayContext = item.title + ' · ' + item.detail;
      const progress = document.getElementById('replayProgress');
      if (progress) progress.style.transform = 'scaleX(0)';
      this.setHud('MOMENT ' + (this.reelIndex + 1) + '/' + this.reelQueue.length, this.replayContext);
      return;
    }
    const finalReturn = ret === 'reel' ? this.reelReturn : ret;
    this.active = false; this.clip = null; this.elapsed = 0; this.scorer = -1; this.returnMode = 'goal';
    this.reelQueue = null; this.reelIndex = 0; this.reelReturn = 'win'; this.replayContext = '';
    document.body.classList.remove('replay-mode');
    const hud = document.getElementById('replayHud'); if (hud) hud.classList.add('hidden');
    const progress = document.getElementById('replayProgress'); if (progress) progress.style.transform = 'scaleX(0)';
    this.setHud('REPLAY', '');
    if (finalReturn === 'win') {
      G.state = 'win';
      hideAll(); $('winov').classList.remove('hidden');
      $('topbar').classList.add('hidden');
    } else {
      advanceAfterGoal();
    }
    if (typeof GifExport !== 'undefined' && GifExport.active)
      setTimeout(() => GifExport.finish(), 0);
  },
  applyFrame() {
    if (!this.active) return null;
    const f = this.sample(); if (!f) return null;
    const saveBody = m => ({ x:m.x, y:m.y, vx:m.vx, vy:m.vy });
    const saved = {
      puck:{ x:G.puck.x, y:G.puck.y, vx:G.puck.vx, vy:G.puck.vy, w:G.puck.w, ang:G.puck.ang },
      m1:saveBody(G.m1), m2:saveBody(G.m2), puckSq:G.puckSq, puckSqA:G.puckSqA,
      trail:G.trail,
    };
    Object.assign(G.puck, f.puck); Object.assign(G.m1, f.m1); Object.assign(G.m2, f.m2);
    G.puckSq = f.puckSq; G.puckSqA = f.puckSqA; G.trail = [];
    return saved;
  },
  restoreFrame(saved) {
    if (!saved) return;
    Object.assign(G.puck, saved.puck); Object.assign(G.m1, saved.m1); Object.assign(G.m2, saved.m2);
    G.puckSq = saved.puckSq; G.puckSqA = saved.puckSqA; G.trail = saved.trail;
  },
};
// ---------- match highlights ----------
// Goal clips are tiny snapshot arrays, not video. We keep enough metadata to
// pick meaningful match moments without adding any network traffic or another
// simulation path.
const Highlights = {
  goals: [], nextId: 1, touchSerial: 0,
  point: null, latestGoal: null,
  freshPoint() {
    return { saves:[0,0], nearMisses:[0,0], postHits:[0,0], bankBy:-1, bankSerial:-1 };
  },
  reset() {
    this.goals.length = 0; this.nextId = 1; this.touchSerial = 0;
    this.point = this.freshPoint(); this.latestGoal = null;
  },
  local() { return G.mode !== 'online' && G.mode !== 'workshop' && !G.demo; },
  tracks() { return this.local() || (G.mode === 'online' && onlineIsAuthority()); },
  noteTouch(side) {
    if (!this.tracks()) return;
    this.touchSerial++;
    // A new mallet touch invalidates an earlier bank unless this same touch
    // later kisses a side rail before the goal.
    if (!this.point) this.point = this.freshPoint();
    this.point.bankBy = -1; this.point.bankSerial = -1;
  },
  noteRail(x, y, isPost) {
    if (!this.tracks()) return;
    if (!this.point) this.point = this.freshPoint();
    const target = x < CX ? 0 : 1;
    if (isPost) {
      this.point.postHits[target]++;
      return;
    }
    const sideRail = Math.abs(y - PY) < 2 || Math.abs(y - (PY + PH)) < 2;
    if (sideRail && G.lastTouch >= 0) {
      this.point.bankBy = G.lastTouch;
      this.point.bankSerial = this.touchSerial;
    }
  },
  noteSave(side) {
    if (!this.tracks()) return;
    if (!this.point) this.point = this.freshPoint();
    this.point.saves[side]++;
  },
  noteNearMiss(targetSide) {
    if (!this.tracks()) return;
    if (!this.point) this.point = this.freshPoint();
    this.point.nearMisses[targetSide]++;
  },
  recordGoal(scorer, clip) {
    const point = this.point || this.freshPoint();
    this.point = this.freshPoint();
    const st = G.stats || freshStats();
    const speedKmh = Math.round(hyp(G.puck.vx, G.puck.vy) * (2.4384 / PW) * 3.6);
    const score = [G.score[0], G.score[1]];
    const prev = score.slice(); prev[scorer] = Math.max(0, prev[scorer] - 1);
    const other = 1 - scorer;
    const tiesGame = score[0] === score[1];
    const tookLead = score[scorer] === score[other] + 1 && prev[scorer] <= prev[other];
    const erasedDeficit = prev[scorer] < prev[other] && score[scorer] >= score[other];
    const winning = score[scorer] >= Settings.firstTo;
    const matchPoint = !winning && score[scorer] === Settings.firstTo - 1;
    const bankShot = point.bankBy === scorer && point.bankSerial === this.touchSerial;
    const savesBeforeGoal = point.saves[scorer] || 0;
    const pressure = (point.nearMisses[other] || 0) + (point.postHits[other] || 0);
    const goal = {
      id: 0,
      scorer, clip:null, speedKmh,
      rally: st.rally || 0,
      score, prevScore: prev,
      themeId: G.themeId,
      winning, matchPoint, tiesGame, tookLead, erasedDeficit, bankShot,
      savesBeforeGoal, pressure,
      streak: (st.streak && st.streak[scorer]) || 1,
    };
    // Ceremony craft feedback should survive even when the replay buffer is
    // too short to save a clip. Highlight storage still stays local-only.
    this.latestGoal = goal;
    if (!clip || clip.length < 2 || !this.local()) return;
    goal.id = this.nextId++; goal.clip = clip;
    this.goals.push(goal);
    if (this.goals.length > 12) this.goals.shift();
  },
  skillLabel(g) {
    if (!g) return '';
    if (g.bankShot) return 'BANK SHOT';
    if (g.savesBeforeGoal >= 2) return 'SAVE + SCORE';
    if ((g.rally || 0) >= 12) return 'RALLY FINISH · ' + g.rally;
    if ((g.speedKmh || 0) >= 22) return 'ROCKET · ' + g.speedKmh + ' KM/H';
    return '';
  },
  get(id) { return this.goals.find(g => g.id === Number(id)) || null; },
  scoreGoal(g) {
    let score = 10;
    if (g.winning) score += 140;
    if (g.erasedDeficit) score += 70;
    if (g.tookLead) score += 42;
    if (g.matchPoint) score += 28;
    if (g.bankShot) score += 48;
    if (g.savesBeforeGoal) score += Math.min(3, g.savesBeforeGoal) * 22;
    if (g.streak >= 3) score += 30;
    else if (g.streak === 2) score += 14;
    score += Math.min(42, (g.rally || 0) * 2);
    score += Math.min(36, (g.speedKmh || 0) * 1.4);
    score += Math.min(18, (g.pressure || 0) * 6);
    return score;
  },
  describe(g) {
    const scoreText = g.score[0] + '–' + g.score[1];
    if (g.winning) return { kind:'winning', title:'Winning goal', detail:scoreText };
    if (g.erasedDeficit && g.tiesGame) return { kind:'comeback', title:'Comeback equalizer', detail:scoreText };
    if (g.erasedDeficit && g.tookLead) return { kind:'comeback', title:'Comeback lead', detail:scoreText };
    if (g.bankShot) return { kind:'bank', title:'Bank shot', detail:g.speedKmh + ' km/h · ' + scoreText };
    if (g.savesBeforeGoal >= 2) return { kind:'counter', title:'Save and score', detail:g.savesBeforeGoal + ' saves · ' + scoreText };
    if ((g.rally || 0) >= 12) return { kind:'rally', title:'Long rally finish', detail:g.rally + ' hits · ' + scoreText };
    if ((g.speedKmh || 0) >= 22) return { kind:'speed', title:'Rocket goal', detail:g.speedKmh + ' km/h · ' + scoreText };
    if (g.tookLead) return { kind:'lead', title:'Lead change', detail:scoreText };
    if (g.tiesGame) return { kind:'equalizer', title:'Equalizer', detail:scoreText };
    if (g.streak >= 3) return { kind:'streak', title:'Hat trick goal', detail:scoreText };
    if (g.matchPoint) return { kind:'matchpoint', title:'Match point', detail:scoreText };
    return { kind:'goal', title:sideLabel(g.scorer) + ' goal', detail:g.speedKmh + ' km/h · ' + scoreText };
  },
  moments() {
    if (!this.goals.length) return [];
    const ranked = this.goals.map(goal => ({ goal, score:this.scoreGoal(goal), ...this.describe(goal) }))
      .sort((a,b) => b.score - a.score || b.goal.id - a.goal.id);
    const last = this.goals[this.goals.length - 1];
    const winner = ranked.find(item => item.goal.id === last.id && last.winning);
    const out = [], seen = new Set();
    if (winner) { out.push(winner); seen.add(winner.goal.id); }
    for (const item of ranked) {
      if (seen.has(item.goal.id)) continue;
      seen.add(item.goal.id); out.push(item);
      if (out.length >= 3) break;
    }
    return out.slice(0, 3);
  },
  reel() { return this.moments(); },
  play(id, returnMode = 'win') {
    const goal = this.get(id);
    if (!goal) return false;
    const desc = this.describe(goal);
    return Replay.startClip(goal.clip, goal.scorer, returnMode, desc.title + ' · ' + desc.detail);
  },
  playReel(returnMode = 'win') {
    const reel = this.reel();
    return reel.length ? Replay.startReel(reel, returnMode) : false;
  },
};

const pointers = new Map(); // pointerId -> side (0 left/player, 1 right)
let mouseHoverSide = null;     // desktop direct manipulation does not require holding a button

function mkMallet(side) {
  return {
    side, x: 0, y: 0, tx: 0, ty: 0,
    vx: 0, vy: 0,             // smoothed velocity (for strike transfer)
    r: MALLET_R,
    glueT: 0,                 // possession clock: sustained gentle contact time
    ghostT: 0,                // post-release grace: this mallet can't touch the puck
    touching: false,          // set per substep by collideMallet
    whooshT: 0, saveCd: 0,    // juice cooldowns
    trail: [],                // recent positions on fast flicks
    hitSq: 1, hitSqA: 0,      // impact squash amount / angle (mirrors G.puckSq)
    contactActive: false,     // hit-effects edge latch - see collideMallet
    contactStartedGoalward: false, // continuous-contact hemisphere guard
  };
}
function resetPositions() {
  const m1 = G.m1, m2 = G.m2;
  m1.x = m1.tx = PX + 170; m1.y = m1.ty = CY;
  m2.x = m2.tx = PX + PW - 170; m2.y = m2.ty = CY;
  m1.vx = m1.vy = m2.vx = m2.vy = 0;
  for (const m of [m1, m2]) { m.glueT = 0; m.ghostT = 0; m.touching = false; m.trail.length = 0; m.hitSq = 1; m.hitSqA = 0; m.contactActive = false; m.contactStartedGoalward = false; }
  G.puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R, w: 0, ang: 0 };
  G.trail.length = 0; G.stallT = 0; G.lastTouch = -1;
  G.stallX = CX; G.stallY = CY; G.anchorT = 0;
  G.puckSq = 1; G.puckSqV = 0;
  // v24.2: park the AI brains in guard with latches cleared, so a point never
  // starts with a stale windup/strike/threat carried over from the last one
  for (const b of [G.ai1, G.ai2]) {
    if (!b) continue;
    b.state = 'guard'; b.tState = 0; b.tickT = 0;
    b.behindH = false; b.sideH = false; b.threatH = false; b.abortCd = 0;
    b.possessT = 0; b.pinT = 0; b.whiff = false; b.counterT = 0; b.counterCommitted = false; b.lastReadKeeper = false;
    b.bankX = b.bankY = null; b.shotFamily = 'cross'; b.deceptive = false; b.releaseSide = 0; b.delayedRelease = false; b.windGoal = 0;
    b.hist.length = 0;
    b.seen.x = CX; b.seen.y = CY; b.seen.vx = 0; b.seen.vy = 0;
  }
}
G.m1 = mkMallet(0); G.m2 = mkMallet(1);

// ---------- view / input mapping ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let canvasContextLost = false;
let view = { w: 0, h: 0, s: 1, ox: 0, oy: 0, portrait: false, camera: 'top', cam: null };
// flat playfield staging canvas for the 2.5D warp (rink resolution).
// Created lazily on first 2.5D frame so minimal-DOM test sandboxes that load
// game.js never pay for it.
let pfCanvas = null, pfCtx = null;
function pfStage() {
  if (!pfCanvas) {
    pfCanvas = document.createElement('canvas');
    pfCanvas.width = VW; pfCanvas.height = VH;
    pfCtx = pfCanvas.getContext('2d');
  }
  return pfCtx;
}

function resize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  view.w = w; view.h = h;
  // 2.5D camera: the camera IS the presentation when active.
  view.camera = ['top', 'elevated', 'surface'].includes(Settings.camera) ? Settings.camera : 'top';
  // Auto follows the actual viewport shape. Explicit Portrait/Landscape
  // choices override it and persist. 2.5D cameras fit directly to the physical
  // viewport; ui.js also offers this preference to the Screen Orientation API
  // when an installed/fullscreen app supports locking.
  const wantsPortrait = Settings.orientation === 'portrait' ||
    (Settings.orientation === 'auto' && h > w);
  view.portrait = view.camera === 'top' && wantsPortrait;
  if (!view.portrait) {
    view.s = Math.min(w / VW, h / VH);
    view.ox = (w - VW * view.s) / 2; view.oy = (h - VH * view.s) / 2;
  } else {
    view.s = Math.min(w / VH, h / VW);
    view.ox = (w - VH * view.s) / 2; view.oy = (h - VW * view.s) / 2;
  }
  view.dpr = dpr;
  fitCamera();
  paintRoom();
  paintTableWarp(); // 2.5D: re-warp the static table for the new fit
}

// Mobile browsers can discard a canvas backing store while an installed PWA
// is backgrounded. Keep simulation state frozen, but explicitly rebuild and
// repaint the presentation surface when the page becomes visible again.
// contextlost/contextrestored are not supported everywhere, so foreground
// repaint remains the cross-browser fallback.
function markCanvasContextLost() { canvasContextLost = true; }
function recoverCanvasSurface() {
  if (canvasContextLost) return false;
  if (typeof ctx.isContextLost === 'function' && ctx.isContextLost()) return false;
  resize();       // assigning canvas width/height rebuilds the backing store
  render();       // paint the paused/current state immediately, before input
  return true;
}
function markCanvasContextRestored() {
  canvasContextLost = false;
  recoverCanvasSurface();
}

// ---------- 2.5D camera ----------
// Optional faux-2.5D views (elevated / surface) alongside the top-down view.
// The simulation never leaves flat table space: the camera is a pure view
// layer. camProject maps table coords (x, y, z = height above the surface)
// to screen CSS px; camUnproject inverts a screen point through a
// ray/plane intersection so pointer control keeps tracking the mallet.
// All ten tables share the same geometry, so every theme gets both views
// for free. Pure functions of (preset, w, h, flip) - unit-testable.
const CAM_PRESETS = {
  elevated: { c: [-650, CY, 720], look: [760, CY, 0] },
  surface: { c: [-60, CY, 170], look: [950, CY, 0] },
};
function cameraPresetForViewport(name, w, h) {
  const base = CAM_PRESETS[name];
  if (!base) return null;
  if (name !== 'surface' || !w || !h) return base;
  // Surface stays low and cinematic on wide displays, then progressively
  // opens up as the viewport becomes portrait. This avoids both the old thin
  // strip and the abrupt camera jump at a single aspect-ratio threshold.
  const portraitMix = clamp((h / w - 1.0) / 0.55, 0, 1);
  return {
    c: [
      lerp(base.c[0], -300, portraitMix),
      CY,
      lerp(base.c[2], 520, portraitMix)
    ],
    look: [
      lerp(base.look[0], 800, portraitMix),
      CY,
      0
    ]
  };
}
const TX1 = TX0 + PW + RAIL * 2, TY1 = TY0 + PH + RAIL * 2; // table footprint
function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function v3norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
// Build a fitted camera. flip mirrors it behind the other end so the online
// guest plays from their own side, exactly like the top-down mirror.
function makeCamera(presetName, w, h, flip) {
  const pr = cameraPresetForViewport(presetName, w, h);
  if (!pr || !w || !h) return null;
  const mx = flip ? VW : 0, ms = flip ? -1 : 1;
  const C = [mx + ms * pr.c[0], pr.c[1], pr.c[2]];
  const L = [mx + ms * pr.look[0], pr.look[1], pr.look[2]];
  const fwd = v3norm(v3sub(L, C));
  const right = v3norm(v3cross(fwd, [0, 0, 1]));
  const up = v3cross(right, fwd);
  // Fit everything that can visibly extend beyond the surface: table body,
  // goal pockets and the compact striker grip.
  const p1 = (x, y, z) => {
    const dx = x - C[0], dy = y - C[1], dz = z - C[2];
    const Xc = dx * right[0] + dy * right[1] + dz * right[2];
    const Yc = dx * up[0] + dy * up[1] + dz * up[2];
    const Zc = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
    return [Xc / Zc, Yc / Zc];
  };
  const pad = presetName === 'surface' ? 62 : 48;
  const xL = TX0 - pad, xR = TX1 + pad, yT = TY0 - pad, yB = TY1 + pad;
  const pts = [
    [xL, yT, 0], [xR, yT, 0], [xL, yB, 0], [xR, yB, 0],
    [xL, yT, -50], [xL, yB, -50], [xR, yT, -50], [xR, yB, -50],
    [CX, CY, 64]
  ].map(([x, y, z]) => p1(x, y, z));
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [px, py] of pts) {
    if (px < x0) x0 = px; if (px > x1) x1 = px;
    if (py < y0) y0 = py; if (py > y1) y1 = py;
  }
  const bL = 0.025 * w, bT = (h > w ? 0.14 : 0.16) * h;
  const bR = 0.975 * w, bB = 0.965 * h;
  const f = Math.min((bR - bL) / (x1 - x0), (bB - bT) / (y1 - y0));
  return { C, fwd, right, up, f, cx: (bL + bR) / 2 - f * (x0 + x1) / 2, cy: (bT + bB) / 2 + f * (y0 + y1) / 2 };
}
function fitCamera() {
  view.cam = view.camera === 'top' ? null
    : makeCamera(view.camera, view.w, view.h, !!G.onlineFlip);
}
// table (x, y, z) -> screen CSS px. s = screen px per rink unit at that depth.
function camProject(cam, x, y, z) {
  if (!cam) return null;
  const dx = x - cam.C[0], dy = y - cam.C[1], dz = z - cam.C[2];
  const Xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const Yc = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const Zc = dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2];
  if (Zc < 1) return null; // behind the near plane
  const s = cam.f / Zc;
  return { x: cam.cx + Xc * s, y: cam.cy - Yc * s, s, zc: Zc };
}
// screen CSS px -> table (x, y) via ray/plane (z=0) intersection.
// This is the exact inverse of camProject for z=0 points.
function camUnproject(cam, sx, sy) {
  const nx = (sx - cam.cx) / cam.f, ny = -(sy - cam.cy) / cam.f;
  const rx = cam.fwd[0] + nx * cam.right[0] + ny * cam.up[0];
  const ry = cam.fwd[1] + nx * cam.right[1] + ny * cam.up[1];
  const rz = cam.fwd[2] + nx * cam.right[2] + ny * cam.up[2];
  const t = -cam.C[2] / rz;
  return { x: cam.C[0] + rx * t, y: cam.C[1] + ry * t };
}
// pre-render the theme's room to an offscreen canvas (screen space)
function paintRoom() {
  const w = view.w, h = view.h, dpr = view.dpr || 1;
  if (!w || !h) return;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * dpr));
  c.height = Math.max(2, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  if (THEME.paintRoom) THEME.paintRoom(g, w, h);
  else {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#141414'); bg.addColorStop(1, '#080808');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
  }
  G.roomCanvas = c;
}
// client px -> rink coords (inverse of render transform)
function screenToRink(cx, cy) {
  // 2.5D: the camera is the transform - invert through the ray/plane hit.
  // The camera already sits behind the viewer's own end (mirrored for the
  // online guest), so the result is true rink coords, no extra flip.
  if (view.camera !== 'top' && view.cam) return camUnproject(view.cam, cx, cy);
  const { s, ox, oy, portrait } = view;
  const u = (cx - ox) / s, v = (cy - oy) / s;
  let x, y;
  if (!portrait) { x = u; y = v; }
  else { x = VW - v; y = u; } // inverse of the true-rotation portrait matrix
  if (G.onlineFlip) x = VW - x; // ONLINE: invert the guest view mirror
  return { x, y };
}

// Relative controls (keyboard and gamepad) are expressed in screen space
// first, then projected into rink space. This is the single
// mapping path for top-down, portrait and both 2.5D cameras, so "up" and
// "right" always mean the same thing to the player even when the table view
// changes. Direct mouse/touch continues to use screenToRink() above.
function screenVectorToRink(m, sx, sy) {
  if (!m) return [0, 0];
  if (view.camera !== 'top' && view.cam) {
    const p = camProject(view.cam, m.x, m.y, 0);
    if (p) {
      const q = camUnproject(view.cam, p.x + sx * 24, p.y + sy * 24);
      const dx = q.x - m.x, dy = q.y - m.y, n = hyp(dx, dy);
      if (n > 1e-6) {
        const k = hyp(sx, sy) / n;
        return [dx * k, dy * k];
      }
    }
    return [0, 0];
  }
  let dx, dy;
  if (view.portrait) { dx = -sy; dy = sx; }
  else { dx = sx; dy = sy; }
  if (G.onlineFlip) dx = -dx;
  return [dx, dy];
}

const CONTROL_FEEL_SCALE = { precise: 0.80, balanced: 1, fast: 1.22 };
function controlFeelScale(name) {
  return CONTROL_FEEL_SCALE[name] || 1;
}

// Radial dead zone + rescale. Per-axis dead zones create a square response
// and make diagonal shots feel slower; radial shaping preserves direction.
function shapeAnalogInput(x, y, dead = 0.16, curve = 1.18) {
  const mag = hyp(x, y);
  if (!Number.isFinite(mag) || mag <= dead) return [0, 0];
  const t = clamp((mag - dead) / Math.max(1e-6, 1 - dead), 0, 1);
  const shaped = Math.pow(t, curve);
  return [x / mag * shaped, y / mag * shaped];
}

function markControlDrive(side, now = performance.now()) {
  if (side !== 0 && side !== 1) return;
  if (!Array.isArray(G.inputDriveT)) G.inputDriveT = [0, 0];
  G.inputDriveT[side] = now;
}

function pointerOwnsSide(side) {
  for (const s of pointers.values()) if (s === side) return true;
  return false;
}
function controlInputActive(side, now = performance.now()) {
  if (mouseHoverSide === side || pointerOwnsSide(side)) return true;
  return now - ((G.inputDriveT && G.inputDriveT[side]) || 0) < 140;
}
function targetBoundsForSide(side, r = MALLET_R) {
  return {
    lo: side === 0 ? PX + r : CX + 8,
    hi: side === 0 ? CX - 8 : PX + PW - r,
    top: PY + r,
    bottom: PY + PH - r,
  };
}

// Advance a mallet target from a relative screen-space vector. The physical
// mallet still passes through driveMallet() and PLAYER_CAP, so faster control
// profiles never bypass the same physics/online fairness ceiling.
function nudgeMalletTarget(m, sx, sy, speed, dt) {
  if (!m || !sx && !sy || !(dt > 0)) return false;
  const mag = clamp(hyp(sx, sy), 0, 1);
  let [dx, dy] = screenVectorToRink(m, sx, sy);
  const n = hyp(dx, dy);
  if (n <= 1e-6) return false;
  dx /= n; dy /= n;
  const b = targetBoundsForSide(m.side, m.r || MALLET_R);
  m.tx = clamp(m.tx + dx * speed * mag * dt, b.lo, b.hi);
  m.ty = clamp(m.ty + dy * speed * mag * dt, b.top, b.bottom);
  markControlDrive(m.side);
  G.idleT = 0;
  return true;
}

// ONLINE helpers use the current net.js side/authority API directly.
function onlinePlayerSide() {
  return typeof Net === 'undefined' ? null : Net.playerSide();
}
function onlineIsAuthority() {
  return typeof Net !== 'undefined' && Net.isAuthority();
}
function onlineIsPlayer() {
  return typeof Net !== 'undefined' && Net.isPlayer();
}
function onlineLocalMallet() {
  return typeof Net === 'undefined' ? null : Net.localMallet();
}

// ONLINE: scoreboard / win / ribbon labels by player side.
function onlineSideLabel(side) {
  if (typeof Net !== 'undefined' && Net.role === 'spectator') return side === 0 ? 'P1' : 'P2';
  const localSide = onlinePlayerSide();
  if (localSide !== null) return side === localSide ? 'YOU' : 'RIVAL';
  return side === 0 ? 'P1' : 'P2';
}
// Scoreboard + match-point ribbon side labels, by mode. Exhibition (watch)
// names both AIs - the left board is never "YOU" when no human is playing.
function sideLabel(side) {
  // While the lobby overlay sits over a paused match, openLobby flips G.mode
  // to 'online' (to keep the attract demo off). The scoreboard behind the
  // overlay must keep showing the paused match's real labels, so use the
  // mode recorded at pause time instead of the flipped one.
  const mode = (G._lobbyPaused && G._lobbyPausedMode) ? G._lobbyPausedMode : G.mode;
  if (mode === '2p') return side === 0 ? 'P1' : 'P2';
  if (mode === 'workshop') return side === 0 ? 'YOU' : 'COACH';
  if (mode === 'online') return onlineSideLabel(side);
  if (mode === 'watch' && G.watch) return DIFFS[G.watch[side === 0 ? 'a' : 'b']].name.toUpperCase();
  return side === 0 ? 'YOU' : DIFFS[G.difficulty].name.toUpperCase();
}
function rinkText(c, str, x, y) {
  // ONLINE: rink-space text that stays upright when the guest view is mirrored.
  // Use ONLY inside the flipped playfield block: the mirror in the current
  // transform would flip glyphs, so this counter-flips them back. Screen-space
  // type (countdown, GOAL! letterbox) lives outside the flip and must keep
  // using plain fillText.
  if (!G.onlineFlip) { c.fillText(str, x, y); return; }
  c.save(); c.translate(x, y); c.scale(-1, 1);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(str, 0, 0); c.restore();
}
function clampMallet(m) {
  const r = m.r;
  if (m.side === 0) m.x = clamp(m.x, PX + r, CX - 8);
  else m.x = clamp(m.x, CX + 8, PX + PW - r);
  m.y = clamp(m.y, PY + r, PY + PH - r);
  m.tx = clamp(m.tx, m.side === 0 ? PX + r : CX + 8, m.side === 0 ? CX - 8 : PX + PW - r);
  m.ty = clamp(m.ty, PY + r, PY + PH - r);
}
// move mallet toward target with a speed cap - 1:1 feel, never teleports
function driveMallet(m, dt, cap) {
  const dx = m.tx - m.x, dy = m.ty - m.y;
  const d = hyp(dx, dy), maxD = cap * dt;
  if (d > 0.5) {
    const step = Math.min(d, maxD);
    const nx = m.x + dx / d * step, ny = m.y + dy / d * step;
    const ivx = (nx - m.x) / dt, ivy = (ny - m.y) / dt;
    const k = 1 - Math.exp(-22 * dt);
    m.vx += (ivx - m.vx) * k; m.vy += (ivy - m.vy) * k;
    m.x = nx; m.y = ny;
    // motion trail on fast flicks: distance-based so 240 Hz substeps don't
    // flood it - ~8 points of ~26u reads as a streak, not a smear
    const tr = m.trail, last = tr[tr.length - 1];
    if (hyp(m.vx, m.vy) > 1200) {
      if (!last || hyp(m.x - last.x, m.y - last.y) > 26) {
        tr.push({ x: m.x, y: m.y });
        if (tr.length > 8) tr.shift();
      }
    } else if (tr.length) tr.shift();
  } else {
    const k = 1 - Math.exp(-14 * dt);
    m.vx += (0 - m.vx) * k; m.vy += (0 - m.vy) * k;
  }
  clampMallet(m);
}

// Touch finger-offset: float the mallet roughly one screen-space diameter
// ahead of the fingertip so the player's hand never covers the striker.
// "Ahead" follows the actual player axis: horizontal in top-down landscape,
// vertical in portrait / 2.5D. This keeps the physical forward direction
// consistent when the same phone rotates between portrait and landscape.
// Online guests see the board mirrored from their own end, so their forward
// screen direction stays the same as the host's. Mouse/pen are untouched.
function touchOffsetScreen(side, cx, cy) {
  let malletPx;
  if (view.camera !== 'top' && view.cam && cx !== undefined) {
    // Measure apparent striker size at the touch depth. Finger occlusion is
    // screen-space, so perspective changes visual size but not control meaning.
    const r = camUnproject(view.cam, cx, cy);
    const pr = camProject(view.cam, r.x, r.y, 0);
    malletPx = pr ? MALLET_R * pr.s : 28;
  } else {
    malletPx = MALLET_R * (view.s || 1);
  }

  // Direct touch stays spatially anchored to the finger; only the striker
  // target is shifted ahead. The CSS-pixel floor accounts for the thumb
  // itself while the mallet multiplier keeps separation visually proportional.
  // Medium is larger than the previous one-diameter offset because that still
  // allowed the thumb to cover puck contact on typical phones.
  const profiles = {
    low:    { finger:50, mallet:1.7 },
    medium: { finger:72, mallet:2.5 },
    high:   { finger:94, mallet:3.3 },
  };
  const p = profiles[Settings.touchOffset] || profiles.medium;
  const minDim = Math.max(320, Math.min(view.w || innerWidth || 390, view.h || innerHeight || 844));
  const deviceScale = clamp(minDim / 390, 0.92, 1.12);
  const off = clamp(Math.max(p.finger * deviceScale, malletPx * p.mallet), 42, 126);

  // Landscape top-down: offset toward the opponent along the table X axis.
  if (view.camera === 'top' && !view.portrait) {
    const rightLocal2P = side === 1 && G.mode === '2p';
    return { x: rightLocal2P ? -off : off, y: 0 };
  }

  // Portrait and 2.5D: the player's forward axis is screen Y. Same-screen P2
  // sits at the far/top end; every other local/online player advances upward.
  const topPlayer = side === 1 && G.mode === '2p' && (view.portrait || view.camera !== 'top');
  return { x: 0, y: topPlayer ? off : -off };
}

// Convert a touch point into its mallet target. The visual finger offset is
// full strength in open space, then fades over the final two offset-lengths
// before a playable boundary. That avoids the fixed-offset dead zone where a
// finger can move away from center/rail but the clamped mallet appears stuck.
function touchTargetRink(side, cx, cy, raw = screenToRink(cx, cy)) {
  const off = touchOffsetScreen(side, cx, cy);
  const shifted = screenToRink(cx + off.x, cy + off.y);
  const dx = shifted.x - raw.x, dy = shifted.y - raw.y;
  const m = side === 0 ? G.m1 : G.m2;
  const r = (m && m.r) || MALLET_R;
  const minX = side === 0 ? PX + r : CX + 8;
  const maxX = side === 0 ? CX - 8 : PX + PW - r;
  const minY = PY + r, maxY = PY + PH - r;

  // roomRatio is how many full offset vectors fit before the first bound.
  // Full offset returns at ratio >= 2; inside that zone it scales linearly,
  // so retreating the finger always retreats the mallet instead of sticking.
  let roomRatio = Infinity;
  if (dx > 1e-6) roomRatio = Math.min(roomRatio, (maxX - raw.x) / dx);
  else if (dx < -1e-6) roomRatio = Math.min(roomRatio, (raw.x - minX) / -dx);
  if (dy > 1e-6) roomRatio = Math.min(roomRatio, (maxY - raw.y) / dy);
  else if (dy < -1e-6) roomRatio = Math.min(roomRatio, (raw.y - minY) / -dy);
  const scale = Number.isFinite(roomRatio) ? clamp(roomRatio / 2, 0, 1) : 1;
  return { x: raw.x + dx * scale, y: raw.y + dy * scale };
}

function onPointerDown(e) {
  AudioSys.init(); AudioSys.resume();
  interacted = true;
  if (G.state === 'menu' || G.state === 'win' || G.state === 'replay') return; // buttons/replay own the UI
  if (G.mode === 'watch') return; // EXHIBITION: no human input - both mallets are AI-driven
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const touch = e.pointerType === 'touch';
  // Side assignment uses the raw (unshifted) touch point so the vertical
  // offset can never drag a touch across the center line in portrait 2P.
  const raw = screenToRink(e.clientX, e.clientY);
  if (G.mode === 'online' && Net.role === 'spectator') return;
  if (G.mode === 'online' && !pointers.has(e.pointerId)) {
    // ONLINE: exactly one local mallet - host plays m1, guest plays m2. No AI.
    if (pointers.size > 0) return;
    pointers.set(e.pointerId, onlinePlayerSide() === 1 ? 1 : 0);
  } else if (G.mode === '2p' && !pointers.has(e.pointerId)) {
    const side = raw.x > CX ? 1 : 0;
    const taken = [...pointers.values()];
    if (!taken.includes(side)) pointers.set(e.pointerId, side);
    else return;
  } else if (!pointers.has(e.pointerId)) {
    if (pointers.size > 0 && G.mode !== '2p') return;
    pointers.set(e.pointerId, 0);
  }
  const side = pointers.get(e.pointerId);
  const m = side === 0 ? G.m1 : G.m2;
  mouseHoverSide = e.pointerType === 'mouse' ? side : mouseHoverSide;

  const target = touch ? touchTargetRink(side, e.clientX, e.clientY, raw) : raw;
  m.tx = target.x; m.ty = target.y;
  markControlDrive(side);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  G.idleT = 0;
}

function onPointerMove(e) {
  if (G.state === 'menu' || G.state === 'win' || G.state === 'replay') return;

  // Mouse/trackpad is absolute direct manipulation: no click-and-drag is
  // required. Limit hover-follow to the canvas so moving over pause/settings
  // UI does not unexpectedly steer the mallet underneath the overlay.
  if (!pointers.has(e.pointerId)) {
    if (e.pointerType === 'mouse' && e.target === canvas &&
        (G.state === 'play' || G.state === 'count') && G.mode !== 'watch' &&
        !(G.mode === 'online' && Net.role === 'spectator')) {
      const side = G.mode === 'online' ? (onlinePlayerSide() === 1 ? 1 : 0) : 0;
      const m = side === 0 ? G.m1 : G.m2;
      const r = screenToRink(e.clientX, e.clientY);
      m.tx = r.x; m.ty = r.y;
      mouseHoverSide = side;
      markControlDrive(side);
      G.idleT = 0;
    }
    return;
  }

  const side = pointers.get(e.pointerId);
  const touch = e.pointerType === 'touch';
  const m = side === 0 ? G.m1 : G.m2;

  const target = touch ? touchTargetRink(side, e.clientX, e.clientY) : screenToRink(e.clientX, e.clientY);
  m.tx = target.x; m.ty = target.y;
  markControlDrive(side);
  G.idleT = 0;
}

function onPointerUp(e) {
  const side = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  if (e.pointerType === 'mouse') {
    let overCanvas = false;
    try { overCanvas = document.elementFromPoint(e.clientX, e.clientY) === canvas; } catch (err) {}
    mouseHoverSide = overCanvas && (side === 0 || side === 1) ? side : null;
  }
}
function onPointerLeave(e) {
  if (e.pointerType === 'mouse' && !pointers.has(e.pointerId)) mouseHoverSide = null;
}
function resetTransientControls() {
  pointers.clear();
  mouseHoverSide = null;
  if (Array.isArray(G.inputDriveT)) G.inputDriveT[0] = G.inputDriveT[1] = 0;
}

// ---------- physics ----------
function puckSpeed() { return hyp(G.puck.vx, G.puck.vy); }

function collideWalls(p) {
  const r = p.r;
  // top / bottom rails
  if (p.y < PY + r) {
    p.y = PY + r;
    if (p.vy < 0) {
      const imp = -p.vy;
      p.vy = -p.vy * paceWall(); p.vx *= 0.995;
      onRailHit(p.x, PY, imp, false, 0, 1);
    }
  } else if (p.y > PY + PH - r) {
    p.y = PY + PH - r;
    if (p.vy > 0) {
      const imp = p.vy;
      p.vy = -p.vy * paceWall(); p.vx *= 0.995;
      onRailHit(p.x, PY + PH, imp, false, 0, -1);
    }
  }
  // end walls with goal mouths. Free Hit closes the far/right mouth into
  // a rebound target so practice stays continuous while the player's own
  // left goal remains live.
  const inMouth = Math.abs(p.y - CY) < goalW() / 2 - 6;
  const freeTarget = G.mode === 'workshop' && Practice.active && Practice.id === 'free';
  // the goal frame rings: contact just outside the mouth is a post hit
  const nearPost = !inMouth && Math.abs(p.y - CY) < goalW() / 2 + 42;
  if (p.x < PX + r && !inMouth) {
    p.x = PX + r;
    if (p.vx < 0) { const imp = -p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX, p.y, imp, nearPost, 1, 0); }
  } else if (p.x > PX + PW - r && (!inMouth || freeTarget)) {
    p.x = PX + PW - r;
    if (p.vx > 0) {
      const imp = p.vx;
      p.vx = -p.vx * paceWall(); p.vy *= 0.995;
      onRailHit(PX + PW, p.y, imp, freeTarget && inMouth ? false : nearPost, -1, 0);
      if (freeTarget && inMouth)
        Practice.onFreeTarget(imp * (2.4384 / PW) * 3.6);
    }
  }
}

// mallet is kinematic (infinite mass): positional separation + impulse
// with full mallet-velocity transfer, so flicks become rockets.
//
// Possession clock (stuck-puck fix): a mallet pressing the puck into a rail
// pocket defeats both anti-stall systems - constant contact keeps resetting
// G.stallT, and the displacement nudge gets smothered. So each mallet tracks
// glueT: sustained gentle contact time. Hard hits reset it; past
// GLUE_HARD_CUTOFF (1.2s - legit contact is ~0.18s, so this never touches
// normal play; lowered from the original 2.5s) an unconditional release
// fires. Rail pins squirt along the rail; open-ice presses pop off the
// mallet face. The pressing mallet goes ghost for 0.30s so it can't
// instantly re-trap.
//
// A gentler progressive nudge (easing the puck out over the whole glue
// window rather than one release at the end) was tried and measured here
// and didn't hold up: once the mallet and puck velocities both settle near
// zero the two are just resting in contact, not colliding, so nothing in
// the per-substep collision response ever runs to apply a nudge to - the
// puck is asleep, not being repeatedly struck. Fixing that properly needs
// a position-based (not impulse-based) escape, which is a bigger change
// than this pass - the hard cutoff alone still cuts the worst case from
// 2.5s to 1.2s, and the separate contactActive fix below removes the
// hundreds-of-events-per-second effects spam that made the wait feel far
// worse than the raw duration.
// shared escape-direction logic for a puck pinned in a rail/corner pocket -
// used by both the progressive relief nudge and the hard release below, so
// they always agree on which way is "out." A true double-corner (near two
// rails at once) can't just zero both blocked axes - that leaves a zero
// vector - so once anything is railed we commit to a single clean axis:
// along the top/bottom rail toward whichever side exit is nearer.
function glueEscapeDir(p, nx, ny) {
  const nearT = p.y < PY + 70, nearB = p.y > PY + PH - 70;
  const nearL = p.x < PX + 70, nearR = p.x > PX + PW - 70;
  const inMouthY = Math.abs(p.y - CY) < goalW() / 2;
  let rx = nx, ry = ny, railed = false;
  if (nearT && ry < 0) { ry = 0; railed = true; }
  if (nearB && ry > 0) { ry = 0; railed = true; }
  if (nearL && rx < 0 && !inMouthY) { rx = 0; railed = true; }
  if (nearR && rx > 0 && !inMouthY) { rx = 0; railed = true; }
  if (railed) {
    if (nearT || nearB) { rx = (p.x - PX) < (PX + PW - p.x) ? 1 : -1; ry = 0; }
    else { rx = 0; ry = (p.y - PY) < (PY + PH - p.y) ? 1 : -1; }
  }
  return { rx, ry, railed, nearT, nearB, nearL, nearR };
}
function aiBrainForSide(side) {
  if (G.mode === 'watch') return side === 0 ? G.ai1 : G.ai2;
  if (G.mode === 'ai') return side === 1 ? G.ai2 : null;
  return null;
}
function aiControlledBlock(m, p, preVx) {
  const brain = aiBrainForSide(m.side);
  if (!brain || G.state !== 'play') return false;
  const onOwnHalf = m.side === 0 ? p.x < CX : p.x > CX;
  if (!onOwnHalf) return false;

  const goalSign = m.side === 0 ? -1 : 1;
  const beforeGoalward = Math.max(0, goalSign * preVx);
  const afterGoalward = Math.max(0, goalSign * p.vx);
  // Only correct a contact that CREATED a much more dangerous own-goal
  // vector. A shot that was already travelling goalward remains a real
  // defensive test; the AI does not get a magic save.
  if (afterGoalward <= 360 || afterGoalward <= beforeGoalward + 150) return false;

  const clearSpeed = clamp(Math.max(320, afterGoalward * 0.58), 320, 920);
  p.vx = -goalSign * clearSpeed;
  // Keep some lane energy so blocks glance into open ice instead of becoming
  // robotic straight returns. Strong transverse motion is preserved.
  p.vy = clamp(p.vy, -1500, 1500);
  brain.counterT = Math.max(brain.counterT || 0, (brain.diff.counterWindow || 0) * 0.7);
  return true;
}

function contactWrapReleaseNormal(m, p, nx, ny) {
  const goalSign = m.side === 0 ? -1 : 1; // + points toward this mallet's own goal
  const goalward = goalSign * (p.x - m.x);
  if (!m.contactActive) {
    // A real incoming save may begin on the goal side. Preserve that case;
    // only police a contact that began safely on the table-facing hemisphere.
    m.contactStartedGoalward = goalward > 6;
    return null;
  }
  if (m.contactStartedGoalward || goalward <= 4) return null;

  // Continuous overlap has crossed through the mallet's goal axis without a
  // separation. A rigid puck/mallet pair cannot physically pass through each
  // other this way; keep it on the table-facing hemisphere and release it.
  const sx = -goalSign * 0.18;
  const sySign = Math.abs(ny) > 0.08 ? Math.sign(ny) : 1;
  return { nx:sx, ny:sySign * Math.sqrt(1 - sx * sx) };
}

function collideMallet(p, m, dt) {
  const dx = p.x - m.x, dy = p.y - m.y;
  const minD = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (m.ghostT > 0) { m.glueT = 0; m.contactActive = false; m.contactStartedGoalward = false; return; } // ghostT ticks in stepPhysics
  if (d2 >= minD * minD || d2 === 0) { m.contactActive = false; m.contactStartedGoalward = false; return; }
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  const preTouchVx = p.vx, preTouchVy = p.vy;
  m.touching = true;

  const wrapRelease = contactWrapReleaseNormal(m, p, nx, ny);
  if (wrapRelease) {
    const goalSign = m.side === 0 ? -1 : 1;
    const clear = clamp(Math.max(420, Math.abs(preTouchVx) * 0.45, hyp(m.vx, m.vy) * 0.22), 420, 900);
    p.x = m.x + wrapRelease.nx * minD;
    p.y = m.y + wrapRelease.ny * minD;
    p.vx = -goalSign * clear;
    p.vy = clamp(preTouchVy + wrapRelease.ny * 160, -1200, 1200);
    p.w *= 0.45;
    m.glueT = 0; m.ghostT = 0.08; m.touching = false;
    m.contactActive = false; m.contactStartedGoalward = false;
    G.lastTouch = m.side; G.stallT = 0;
    return;
  }
  // --- possession clock ---
  const vn0 = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  const mvn0 = m.vx * nx + m.vy * ny;
  if (-vn0 + Math.max(0, mvn0) > 650) m.glueT = 0;
  else m.glueT += dt;
  if (m.glueT > GLUE_HARD_CUTOFF) {
    const { rx: rx0, ry: ry0, railed, nearT, nearB, nearL } = glueEscapeDir(p, nx, ny);
    let rx = rx0, ry = ry0;
    if (!railed) {
      p.x = m.x + nx * minD; p.y = m.y + ny * minD;
      p.vx = nx * 560; p.vy = ny * 560;
      m.hitSq = 0.8; m.hitSqA = Math.atan2(ny, nx);
      noteRallyTouch(m.side);
      onMalletHit(p.x, p.y, 500, nx, ny);
    } else {
      if (nearT || nearB) {
        p.y = nearT ? PY + p.r : PY + PH - p.r;
        p.x = clamp(p.x, PX + p.r, PX + PW - p.r);
        rx = (p.x - PX) < (PX + PW - p.x) ? 1 : -1; ry = 0;
      } else {
        p.x = nearL ? PX + p.r : PX + PW - p.r;
        p.y = clamp(p.y, PY + p.r, PY + PH - p.r);
        rx = 0; ry = (p.y - PY) < (PY + PH - p.y) ? 1 : -1;
      }
      p.vx = rx * 950; p.vy = ry * 950;
      m.ghostT = 0.30;
      m.hitSq = 0.72; m.hitSqA = Math.atan2(ry, rx);
      noteRallyTouch(m.side);
      onMalletHit(p.x, p.y, 750, rx, ry);
    }
    m.glueT = 0; m.contactActive = false; G.lastTouch = m.side;
    Highlights.noteTouch(m.side);
    if (RivalLab.active) RivalLab.noteTouch(m.side, preTouchVx, preTouchVy, p.vx, p.vy);
    return;
  }
  // --- normal contact ---
  p.x = m.x + nx * minD; p.y = m.y + ny * minD;
  const rvx = p.vx - m.vx, rvy = p.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) { m.contactActive = false; m.contactStartedGoalward = false; return; } // separating
  // Speed-dependent restitution: a still/slow mallet SMOTHERS the puck
  // (real goalie play - the puck drops dead for possession), a driven
  // mallet bounces it lively. This is what makes traps, dribbles and
  // possession possible instead of endless pinball.
  const msp0 = hyp(m.vx, m.vy);
  const e = lerp(0.35, 0.92, clamp(msp0 / 1200, 0, 1));
  let j = -(1 + e) * vn;
  // smack bonus: mallet driving into the puck adds extra punch
  const mvn = m.vx * nx + m.vy * ny; // >0 means mallet moving toward puck
  const pvx0 = p.vx; // pre-impulse: save detection reads the puck's intent, not its rebound
  if (mvn > 0) j += mvn * SMACK_BONUS;
  p.vx += nx * j; p.vy += ny * j;
  const aiControlledClear = aiControlledBlock(m, p, preTouchVx);
  // safety: a genuinely driven hit never dies
  const sp = hyp(p.vx, p.vy);
  const msp = hyp(m.vx, m.vy);
  if (sp < 250 && msp > 800) {
    p.vx = nx * 250; p.vy = ny * 250;
  }
  const nsp = hyp(p.vx, p.vy);
  if (nsp > PUCK_MAX) { p.vx *= PUCK_MAX / nsp; p.vy *= PUCK_MAX / nsp; }
  // english: tangential mallet velocity at contact becomes puck spin -
  // the Magnus curve is applied in stepPhysics
  const tx = -ny, ty = nx;
  const tang = (m.vx - p.vx) * tx + (m.vy - p.vy) * ty;
  p.w = clamp((p.w || 0) + tang / 260, -12, 12);
  G.lastTouch = m.side;
  if (RivalLab.active) RivalLab.noteTouch(m.side, preTouchVx, preTouchVy, p.vx, p.vy);
  G.stallT = 0;
  // hit-effects cascade (sound, particles, shake, save/whoosh, mallet recoil):
  // only on the leading edge of a contact episode. Continuous smothering
  // contact re-enters this branch every substep (up to 240/sec) while the
  // puck is pinned against the mallet - without this gate that's hundreds
  // of hit-sounds + camera shakes + particle bursts a second for a puck
  // that isn't going anywhere (the "stuck buzzing" / rapid-fire feel).
  // A genuinely separate touch (vn>=0 above, or losing contact entirely)
  // always clears the latch first, so a real fast dribble still gets a
  // distinct hit registered for each bounce.
  if (!m.contactActive) {
    Highlights.noteTouch(m.side);
    const impact = -vn + Math.max(0, mvn);
    let savedThisHit = false;
    // SAVE: a fast lateral block of a puck bound for your own goal gets the
    // soft treatment - thud, ring pulse, brief puck glow. High drama, low noise.
    const inboundSave = m.side === 0 ? pvx0 < -450 : pvx0 > 450;
    const onOwnHalf = m.side === 0 ? p.x < CX : p.x > CX;
    if (m.saveCd <= 0 && impact > 320 && inboundSave && onOwnHalf) {
      m.saveCd = 0.9;
      G.saveT = 0.55;
      G.pulses.push({ x: p.x, y: p.y, t: 0 });
      AudioSys.thud();
      Haptics.fire('save');
      savedThisHit = true;
      // match stat: bank a save for the defender's side (real play only - never demo)
      if (G.state === 'play' && !G.demo && G.stats) G.stats.saves[m.side]++;
      Highlights.noteSave(m.side);
      if (G.mode === 'workshop') Practice.onSave(m.side);
      const saveBrain = m.side === 0 ? G.ai1 : G.ai2;
      if (saveBrain && (G.mode === 'ai' || G.mode === 'watch'))
        saveBrain.counterT = saveBrain.diff.counterWindow || 0;
    }
    // fast flicks whoosh on the way through (cooled down so rallies don't hiss)
    if (msp0 > 1300 && m.whooshT <= 0) {
      m.whooshT = 0.3;
      AudioSys.whoosh(msp0 / 3000);
    }
    // the mallet takes a bit of the recoil too - a driven strike compresses
    // it along the contact normal for a couple frames before it springs back
    m.hitSq = 1 - clamp(impact / 2600, 0, 0.34);
    m.hitSqA = Math.atan2(ny, nx);
    noteRallyTouch(m.side);
    onMalletHit(p.x, p.y, impact, nx, ny, savedThisHit, {
      normalSpeed:-vn, malletDrive:Math.max(0, mvn), malletSpeed:msp0,
      tangentialSpeed:rvx * -ny + rvy * nx, outgoingSpeed:hyp(p.vx, p.vy),
      save:savedThisHit,
    });
  }
  m.contactActive = true;
}

function stepPhysics(dt) {
  const p = G.puck;
  // glide: near-zero friction, like air jets (pace setting tunes the table)
  const damp = Math.exp(-paceDamp() * dt);
  p.vx *= damp; p.vy *= damp;
  // Magnus: puck spin (english from tangential mallet contact) curves flight.
  // |a| = K·|w|·|v| - at w=10, v=2000 that's ~600 u/s², a visible bend
  // across the table; negligible at low speed. Spin decays in ~1s.
  if (p.w) {
    const spm = hyp(p.vx, p.vy);
    if (spm > 60) {
      const mx = -p.vy * 0.03 * p.w * dt, my = p.vx * 0.03 * p.w * dt;
      p.vx += mx; p.vy += my;
    }
    p.w *= Math.exp(-1.1 * dt);
    if (Math.abs(p.w) < 0.05) p.w = 0;
    p.ang = (p.ang || 0) + p.w * dt;
  }
  // match stats: fastest the puck ever flies (table-scale km/h later)
  if (G.state === 'play' && !G.demo) {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > G.stats.topSpeed) G.stats.topSpeed = sp;
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  // per-mallet per-substep bookkeeping: ghost/whoosh/save cooldowns tick
  // here (not in collideMallet) so they decay even without contact; glueT
  // decays when the mallet isn't touching so the possession ring never
  // lingers after a clean separation.
  for (let mi = 0; mi < 2; mi++) {
    const m = mi === 0 ? G.m1 : G.m2; // indexed, not [G.m1, G.m2] - no alloc at 240 Hz
    if (m.ghostT > 0) m.ghostT -= dt;
    if (m.whooshT > 0) m.whooshT -= dt;
    if (m.saveCd > 0) m.saveCd -= dt;
    if (!m.touching) m.glueT = Math.max(0, m.glueT - dt * 2);
    m.touching = false;
    m.hitSq += (1 - m.hitSq) * Math.min(1, dt * 10); // recoil recovery
  }
  collideMallet(p, G.m1, dt);
  collideMallet(p, G.m2, dt);
  collideWalls(p);
  // goals: full crossing of the line inside the mouth
  if (p.x > PX + PW + p.r * 0.35 && Math.abs(p.y - CY) < goalW() / 2) onGoal(0);
  else if (p.x < PX - p.r * 0.35 && Math.abs(p.y - CY) < goalW() / 2) onGoal(1);
  // near-miss drama: a fast puck kissing the goal frame without scoring -
  // a tiny time dip, a glowing post, a soft tick. Once per 1.5s max.
  if (G.state === 'play' && !G.demo && G.nearCd <= 0) {
    const dy = Math.abs(p.y - CY);
    const nearL = p.x > PX - 30 && p.x < PX + 80;
    const nearR = p.x > PX + PW - 80 && p.x < PX + PW + 30;
    if ((nearL || nearR) && dy > goalW() / 2 - 30 && dy < goalW() / 2 + PUCK_R + 26 && hyp(p.vx, p.vy) > 500) {
      G.nearCd = 1.5;
      Highlights.noteNearMiss(nearL ? 0 : 1);
      if (fxFlash()) {
        G.missGlow = { side: nearL ? 0 : 1, t: 0.7 };
      }
      AudioSys.blip(1500, 0.05, 0.10);
    }
  }
  // anti-stall: a real table never lets the puck die mid-rink - a whisper
  // of air from the jets keeps the game alive
  if (G.state === 'play') stallWatch(dt);
  // trail
  G.trail.push({ x: p.x, y: p.y });
  if (G.trail.length > Math.round(16 * fxTrail())) G.trail.shift();
  // squash recovery: a damped spring, not an exponential fade - the puck
  // pops back with a faint overshoot, the way real rubber does. k=200/d=16
  // recovers in ~0.15s with a ~2% overshoot, settled by ~0.4s: snappy and
  // physical, never cartoonish.
  G.puckSqV += (-(G.puckSq - 1) * 200 - G.puckSqV * 16) * dt;
  G.puckSq += G.puckSqV * dt;
}

// Anti-stall: air jets. A dead puck never sits - shared by live play and the
// attract demo so neither can freeze mid-rink.
function stallWatch(dt) {
  const p = G.puck;
  // displacement anchor: a pinned puck (constant mallet contact keeps
  // resetting stallT below) still counts as stalled if it goes nowhere.
  // The nudge aims at open ice, not random - it reads as the table
  // breathing, not a glitch.
  if (hyp(p.x - G.stallX, p.y - G.stallY) > 90) {
    G.stallX = p.x; G.stallY = p.y; G.anchorT = 0;
  } else {
    G.anchorT += dt;
    if (G.anchorT > 2.6) {
      G.anchorT = 0; G.stallX = p.x; G.stallY = p.y;
      const dx = CX - p.x, dy = CY - p.y, dl = hyp(dx, dy) || 1;
      p.vx = dx / dl * 430; p.vy = dy / dl * 430;
      airPuff(p.x, p.y);
    }
  }
  const sp = hyp(p.vx, p.vy);
  if (sp < STALL_V) {
    G.stallT += dt;
    if (G.stallT > STALL_T) {
      G.stallT = 0;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const ang = (Math.random() < 0.75 ? 0 : Math.PI) + rnd(-0.5, 0.5) + (dir > 0 ? 0 : Math.PI);
      const push = 380;
      p.vx += Math.cos(ang) * push; p.vy += Math.sin(ang) * push * 0.6;
      airPuff(p.x, p.y);
    }
  } else G.stallT = 0;
}

// ---------- AI: plays like a real person ----------
// States: guard -> track -> engage -> windup -> strike -> recover,
// plus defend (intercept) and cornerEscape. One brain drives m2 in
// solo play; in demo mode a second brain drives m1.
function mkBrain(side, diffIdx) {
  return {
    side, diff: DIFFS[diffIdx],
    state: 'guard', tState: 0, tickT: 0,
    aimX: 0, aimY: 0, windT: 0, windGoal: 0,
    bankX: null, bankY: null, shotFamily: 'cross', deceptive:false, releaseSide:0, delayedRelease:false,
    pinT: 0, pinX: 0, pinY: 0, swayT: rnd(10), possessT: 0,
    arPhase: 0, // 'around' detour phase: 0 = sidestep clear, 1 = cross goal-side
    whiff: false, // this strike will swing clean through (a human miss)
    counterT: 0, // short possession window after a real save/block
    counterCommitted: false,
    concededLane: 0, concededLaneY: CY, concededLaneRepeat: 0,
    lastReadKeeper: false, // whether the current attack intentionally read the defender
    // commitment hysteresis (v24): sticky latches with deadbands so the AI
    // can't dither between strike/defend/reposition when the puck sits on a
    // decision boundary - the feint-loop fix. behindH: mallet truly behind
    // the puck on LIVE geometry (not delayed perception). sideH: puck
    // possession latched across the center line. threatH: threat on/off
    // band. abortCd: cooldown after a cancelled windup before it may wind
    // up again.
    behindH: false, sideH: false, threatH: false, abortCd: 0,
    seen: { x: CX, y: CY, vx: 0, vy: 0 }, // delayed perception
    hist: [], // puck history for reaction delay
  };
}
function aiPerceive(b, dt) {
  b.hist.push({ x: G.puck.x, y: G.puck.y, vx: G.puck.vx, vy: G.puck.vy, t: perfNow() });
  const cutoff = perfNow() - b.diff.react;
  while (b.hist.length > 2 && b.hist[0].t < cutoff) b.hist.shift();
  const s = b.hist[0];
  b.seen.x = s.x; b.seen.y = s.y; b.seen.vx = s.vx; b.seen.vy = s.vy;
}
function perfNow() {
  return RivalLab.active ? RivalLab.clock : performance.now() / 1000;
}

// predict puck position t seconds ahead, with top/bottom wall bounces
function predictPuck(x, y, vx, vy, t) {
  let px = x, py = y;
  const step = 1 / 60;
  let rem = t;
  while (rem > 0) {
    const dt = Math.min(step, rem);
    px += vx * dt; py += vy * dt;
    if (py < PY + PUCK_R) { py = PY + PUCK_R; vy = Math.abs(vy) * paceWall(); }
    else if (py > PY + PH - PUCK_R) { py = PY + PH - PUCK_R; vy = -Math.abs(vy) * paceWall(); }
    rem -= dt;
  }
  return { x: px, y: py };
}
function aiBankPoint(px, py, goalX, targetY, railY) {
  // Mirror the goal target across the chosen side rail. The straight line to
  // that mirror intersects the rail at the physically correct single-bank
  // contact point, so banks are aimed at the goal instead of "just hit a wall".
  const mirroredY = railY * 2 - targetY;
  const den = mirroredY - py;
  const t = Math.abs(den) < 1 ? 0.5 : clamp((railY - py) / den, 0.08, 0.92);
  return {
    x: clamp(px + (goalX - px) * t, PX + 70, PX + PW - 70),
    y: railY,
  };
}
function aiPlanShot(b, s, keeper, foeGoalX) {
  const D = b.diff;
  const readsKeeper = Math.random() < (D.readKeeper || 0);
  b.lastReadKeeper = readsKeeper;
  const laneY = readsKeeper && keeper ? keeper.y : s.y;
  const farSide = laneY < CY ? 1 : -1;
  const farY = CY + farSide * (goalW() / 2 - 12);
  const puckLane = Math.abs(s.y - CY) > 24 ? Math.sign(s.y - CY) : farSide;
  const cutY = CY + puckLane * (goalW() / 2 - 12);
  const error = rnd(-1, 1) * D.aimErr;

  b.bankX = b.bankY = null;
  b.deceptive = Math.random() < (D.sameRelease || 0);
  b.delayedRelease = Math.random() < (D.delayChance || 0);
  b.windGoal = D.windup + (b.delayedRelease ? rnd(0.055, 0.15) : 0);

  const bank = Math.random() < (D.bankChance == null ? 0.12 : D.bankChance);
  if (bank) {
    const under = Math.random() < (D.underShare == null ? 0.72 : D.underShare);
    b.shotFamily = under ? 'under' : 'over';
    const targetY = clamp(farY + error * 0.45, CY - goalW() / 2 + 10, CY + goalW() / 2 - 10);
    // An under uses the rail nearest its scoring corner. An over attacks the
    // same opening from the opposite rail. Both are exact one-bank paths.
    const targetSide = targetY < CY ? -1 : 1;
    const railSide = under ? targetSide : -targetSide;
    const railY = railSide < 0 ? PY + PUCK_R + 8 : PY + PH - PUCK_R - 8;
    const bankPt = aiBankPoint(s.x, s.y, foeGoalX, targetY, railY);
    b.bankX = bankPt.x; b.bankY = bankPt.y;
    b.aimX = bankPt.x; b.aimY = bankPt.y;
    b.releaseSide = targetSide;
    return;
  }

  const cut = Math.random() < (D.cutChance == null ? 0.5 : D.cutChance);
  b.shotFamily = cut ? 'cut' : 'cross';
  const targetY = cut ? cutY : farY;
  b.aimX = foeGoalX;
  b.aimY = lerp(targetY, CY, D.centerBias || 0) + error;
  b.releaseSide = targetY < CY ? -1 : 1;
}
function aiMatchPressure(b) {
  // Difficulty never secretly changes reaction time or max speed mid-match.
  // The rival only changes positioning/intent: trail -> step higher, lead ->
  // sit a little deeper. A player streak also wakes the House up slightly.
  if (!G.score) return 0;
  const mine = G.score[b.side] || 0, theirs = G.score[1 - b.side] || 0;
  const deficit = clamp(theirs - mine, -3, 3);
  const opponentStreak = G.stats && G.stats.streak ? Math.max(0, (G.stats.streak[1 - b.side] || 0) - 1) : 0;
  const matchPointThreat = theirs >= Settings.firstTo - 1 ? 0.10 : 0;
  return clamp(deficit * 0.12 + Math.min(2, opponentStreak) * 0.07 + matchPointThreat, -0.18, 0.52);
}
function aiRememberGoalLane(scorer) {
  let defender = null;
  if (G.mode === 'ai') {
    // Solo House match: only the right-side rival is AI controlled.
    if (scorer !== 0) return;
    defender = G.ai2;
  } else if (G.mode === 'watch') {
    defender = scorer === 0 ? G.ai2 : G.ai1;
  } else return;
  if (!defender || !(defender.diff.laneMemory > 0)) return;

  const lane = G.puck.y < CY ? -1 : 1;
  if (lane === defender.concededLane)
    defender.concededLaneRepeat = Math.min(3, defender.concededLaneRepeat + 1);
  else {
    defender.concededLane = lane;
    defender.concededLaneRepeat = 1;
  }
  defender.concededLaneY = clamp(G.puck.y, CY - goalW() * 0.48, CY + goalW() * 0.48);
}
function aiHome(b) {
  // Each rival occupies a visibly different defensive line. Rookie protects
  // the mouth and counter-punches, Club Pro shadows lanes, Champion holds
  // high and squeezes space. Match pressure moves that line, never raw speed.
  b.swayT += 1 / 60;
  const D = b.diff, pressure = aiMatchPressure(b);
  const fromOwnGoal = clamp((b.side === 0 ? b.seen.x - PX : PX + PW - b.seen.x) / PW, 0, 1);
  // Floating-triangle principle: when the puck is far away, step a little
  // closer to center and re-center laterally; as it approaches, sink back
  // toward the mouth and honor the shooting lane more strongly.
  const floatDepth = (D.triangleFloat || 0) * 95 * fromOwnGoal;
  const depth = (D.homeDepth || 190) + pressure * (D.pressureDepth || 80) + floatDepth;
  const baseTrack = (D.homeTrack == null ? 0.35 : D.homeTrack) + pressure * 0.16;
  const track = clamp(baseTrack * (1 - fromOwnGoal * 0.14), 0.18, 0.78);
  const hx = b.side === 0 ? PX + depth : PX + PW - depth;
  const sway = 10 + (D.readKeeper || 0) * 12;
  const repeats = Math.max(0, (b.concededLaneRepeat || 0) - 1);
  const learned = repeats
    ? (b.concededLaneY - CY) * (D.laneMemory || 0) * Math.min(1, repeats / 2)
    : 0;
  const hy = CY + (b.seen.y - CY) * track + learned + Math.sin(b.swayT * 1.7) * sway;
  return { x: hx, y: clamp(hy, PY + 90, PY + PH - 90) };
}
function aiThink(b, dt, m) {
  const D = b.diff;
  b.tState += dt; b.tickT += dt;
  if (b.state !== 'recover') b.reboundTried = false;
  if (b.counterT > 0) b.counterT = Math.max(0, b.counterT - dt);
  if (b.abortCd > 0) b.abortCd -= dt;
  if (b.tickT < D.tick) return; // decisions at 7–16 Hz, like a human
  b.tickT = 0;
  const s = b.seen, p = G.puck;
  const myGoalX = b.side === 0 ? PX : PX + PW;
  const foeGoalX = b.side === 0 ? PX + PW : PX;
  const puckOnMySide = b.side === 0 ? s.x < CX : s.x > CX;
  const puckSpeed = hyp(s.vx, s.vy);
  // HYSTERESIS LATCHES (v24) - see mkBrain. The raw signals flicker when
  // the puck sits on a boundary (center line, threat speed, behind margin);
  // a latch only flips once the puck is clearly across its band, so the
  // brain can't shuttle guard<->engage<->defend every few ticks.
  const dirS0 = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
  // threat: on at 500 u/s inbound (delayed perception - a human needs a beat
  // to notice), off at 350 or once it leaves my side. v24.2: the OFF edge
  // reads the LIVE puck, not the delayed ghost. The old code kept defend
  // latched on a stale inbound read after the puck bounced off the rail or
  // was deflected away - the AI would then lunge at a puck that was moving
  // away from its net, meet it from the wrong side, and shank it home.
  // That stale-threat lunge was the #1 measured own-goal mechanism.
  if (!b.threatH && (b.side === 0 ? s.vx < -500 : s.vx > 500) && puckOnMySide) b.threatH = true;
  else if (b.threatH && ((b.side === 0 ? p.vx > -350 : p.vx < 350) || !puckOnMySide)) b.threatH = false;
  const threat = b.threatH;
  // side possession: latch across the center line with a 40u deadband - the
  // puck jittering on the line can't bounce guard<->engage anymore
  if (b.side === 0 ? s.x < CX - 40 : s.x > CX + 40) b.sideH = true;
  else if (b.side === 0 ? s.x > CX + 40 : s.x < CX - 40) b.sideH = false;
  // behind: sticky on LIVE geometry, not delayed perception - committing to
  // a strike on a ghost puck is exactly the feint loop (windup on stale
  // `seen`, abort on live `p`, repeat). Latch at >50, release at <0.
  const liveBehind = dirS0 * (m.x - p.x);
  if (!b.behindH && liveBehind > 50) b.behindH = true;
  else if (b.behindH && liveBehind < 0) b.behindH = false;

  const setTx = (x, y) => {
    m.tx = b.side === 0 ? clamp(x, PX + MALLET_R, CX - 8) : clamp(x, CX + 8, PX + PW - MALLET_R);
    m.ty = clamp(y, PY + MALLET_R, PY + PH - MALLET_R);
  };
  const goHome = () => { const h = aiHome(b); setTx(h.x, h.y); };
  const aimDefense = () => {
    // Intercept the predicted trajectory from the goal side. Shared by the
    // normal defend state and emergency recovery interruption so a goalie
    // never spends one more decision tick skating home during a live threat.
    const tHit = clamp(Math.abs((s.x - (b.side === 0 ? PX + 150 : PX + PW - 150)) / (s.vx || 1)), 0, 1.1);
    const pr = predictPuck(s.x, s.y, s.vx, s.vy, tHit * 0.85);
    const gx = b.side === 0 ? PX + 130 : PX + PW - 130;
    const nearMouth = Math.abs(pr.y - CY) < goalW() / 2 + 60;
    const steerY = nearMouth ? (CY - pr.y) * 0.25 : 0;
    const goalSide = b.side === 0 ? -1 : 1;
    const blockX = gx + (pr.x - gx) * 0.28 + goalSide * (D.blockOffset || 70);
    setTx(blockX, pr.y + steerY);
  };

  // Own-goal guard (v19): never plow through a slow puck that sits between
  // the mallet and your own net - that shove is the #1 measured own-goal
  // mechanism (AI own-goal rate was ~22% before this fix). Detour around it
  // to the goal side first. Skipped for live threats (defend handles those)
  // and for the strike sequence itself. Capped at 450 u/s: chasing a fast
  // puck with a sidestep causes its own wrong-side collisions (measured).
  if (b.state === 'guard' || b.state === 'defend') {
    const dirS = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
    const pSpd = hyp(p.vx, p.vy);
    const towardMe = dirS * p.vx > 150;      // live dribble - defend it, don't dodge
    const between = dirS * (p.x - m.x) > 0;  // puck sits between me and my net
    const close = hyp(p.x - m.x, p.y - m.y) < MALLET_R + PUCK_R + 80;
    if (!towardMe && pSpd < 450 && between && close) {
      b.state = 'around'; b.tState = 0; b.arPhase = 0;
    }
  }

  // pin rescue: if I'm smothering the puck into my corner and it hasn't gone
  // anywhere, I'm the trap - back off and dig it out. Speed-based checks
  // fail here because a pinned puck jitters fast between mallet and rail.
  if (b.state !== 'windup' && b.state !== 'strike') {
    const myCorner = b.side === 0
      ? (p.x < PX + 210 && (p.y < PY + 210 || p.y > PY + PH - 210))
      : (p.x > PX + PW - 210 && (p.y < PY + 210 || p.y > PY + PH - 210));
    const smothering = hyp(p.x - m.x, p.y - m.y) < MALLET_R + PUCK_R + 46;
    if (myCorner && smothering) {
      if (hyp(p.x - b.pinX, p.y - b.pinY) > 120) { b.pinX = p.x; b.pinY = p.y; b.pinT = 0; }
      b.pinT += D.tick;
      if (b.pinT > 0.8 && b.state !== 'escape') { b.state = 'escape'; b.tState = 0; b.pinT = 0; }
    } else { b.pinT = 0; b.pinX = p.x; b.pinY = p.y; }
  }

  switch (b.state) {
    case 'guard': {
      // v24.2: don't skate home through a live puck. If the puck blocks the
      // path and isn't coming at my net, hold until it clears - driving
      // through from the wrong side shoves it home (measured own-goal
      // mechanism; the stale-threat defend fix funnels these here). Slow
      // pucks are handled by the 'around' detour above; this is for ones
      // moving too fast to detour around.
      const h = aiHome(b);
      const dirSg = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
      const towardMe = dirSg * p.vx > 150;
      const pSpd = hyp(p.vx, p.vy);
      let blocked = false;
      if (!towardMe && pSpd > 120) {
        const dxh = h.x - m.x, dyh = h.y - m.y;
        const segLen2 = dxh * dxh + dyh * dyh;
        if (segLen2 > 1) {
          const t = clamp(((p.x - m.x) * dxh + (p.y - m.y) * dyh) / segLen2, 0, 1);
          blocked = hyp(p.x - (m.x + dxh * t), p.y - (m.y + dyh * t)) < MALLET_R + PUCK_R + 30;
        }
      }
      if (blocked) setTx(m.x, m.y); // hold - the puck will clear
      else goHome();
      if (threat) { b.state = 'defend'; b.tState = 0; }
      else {
        const pressure = aiMatchPressure(b);
        const countering = b.counterT > 0;
        const attackChance = countering ? 1
          : clamp(D.aggro + pressure * (D.pressBoost || 0.12), 0.20, 0.99);
        const attackDelay = countering ? 0 : (D.attackDelay || 0);
        const engageSpeed = countering ? (D.counterSpeed || D.engageSpeed || 1500) : (D.engageSpeed || 1500);
        if (b.sideH && puckSpeed < engageSpeed && b.tState >= attackDelay && Math.random() < attackChance) {
          b.state = 'engage'; b.tState = 0;
        }
      }
      break;
    }
    case 'around': {
      // OWN-GOAL DETOUR (v19): a slow puck sits between the mallet and my
      // net - driving through it shoves it in. Two beats: sidestep clear
      // (backing away can never touch it), then cross to its goal side so
      // the next touch clears it AWAY from the net.
      const dirS = b.side === 1 ? 1 : -1;
      if (b.arPhase === 0) {
        const wy = clamp(p.y + (m.y <= p.y ? -200 : 200), PY + MALLET_R, PY + PH - MALLET_R);
        setTx(m.x - dirS * 30, wy);
        if (Math.abs(m.y - wy) < 50 || b.tState > 0.55) { b.arPhase = 1; b.tState = 0; }
      } else {
        setTx(p.x + dirS * 120, p.y);
        if (dirS * (m.x - p.x) > 60 || b.tState > 1.1) { b.state = 'engage'; b.tState = 0; }
      }
      // a live threat cancels the detour - go block it
      if (threat) { b.state = 'defend'; b.tState = 0; }
      break;
    }
    case 'defend': {
      aimDefense();
      // if the puck sits in reach (smothered block, loose puck), take it.
      // v24.2: this reads LIVE geometry and is checked BEFORE the guard
      // fallback. The old order fell through to guard on the delayed `seen`
      // read, so after a block the AI would skate home for a beat and then
      // come back - the visible "backing away from a hittable puck".
      const liveSpd = hyp(p.vx, p.vy);
      const counterReach = b.counterT > 0 ? 380 : 220;
      const counterSpeed = b.counterT > 0 ? (D.counterSpeed || 1800) : 900;
      if (liveSpd < counterSpeed && hyp(p.x - m.x, p.y - m.y) < counterReach) { b.state = 'engage'; b.tState = 0; }
      else if (!threat) { b.state = 'guard'; b.tState = 0; }
      break;
    }
    case 'engage': {
      // skate to the puck - always from the GOAL side. Driving straight at
      // a puck from the far side shoves it toward your own net (the classic
      // goalie own goal), so when the mallet isn't behind the puck yet it
      // swings wide around it first, then commits.
      const dirS = b.side === 1 ? 1 : -1; // +1 = toward my own goal (right)
      // desperate block: it's coming at my net fast and I'm on the wrong
      // side - forget the footwork, go meet it (defend steers the deflection)
      if (threat && dirS * (m.x - s.x) < 40) { b.state = 'defend'; b.tState = 0; break; }
      // b.behindH is the sticky live-geometry latch from the top of aiThink:
      // swing wide until truly behind the puck, then drive at it. The
      // deadband stops the sidestep<->drive target shuttle that read as
      // dithering from the stands.
      if (!b.behindH) {
        const wy = clamp(s.y + (m.y <= s.y ? -180 : 180), PY + MALLET_R, PY + PH - MALLET_R);
        const wx = s.x + dirS * 70;
        // v24.2: swing wide WITHOUT crossing the puck. Driving straight at
        // (wx, wy) can cut through a puck sitting between the mallet and the
        // waypoint - a wrong-side touch that shoves it toward your own net
        // (measured own-goal mechanism). If the live puck blocks the straight
        // path, hold x and clear laterally first; the x-approach runs once
        // we're on the wide line, 180u off the puck's lane.
        const clearR = MALLET_R + PUCK_R + 24;
        const dxw = wx - m.x, dyw = wy - m.y;
        const segLen2 = dxw * dxw + dyw * dyw;
        let blocked = false;
        if (segLen2 > 1) {
          const t = clamp(((p.x - m.x) * dxw + (p.y - m.y) * dyw) / segLen2, 0, 1);
          blocked = hyp(p.x - (m.x + dxw * t), p.y - (m.y + dyw * t)) < clearR;
        }
        if (blocked) setTx(m.x, wy);
        else setTx(wx, wy);
      } else {
        setTx(s.x, s.y);
      }
      const liveD = hyp(p.x - m.x, p.y - m.y);
      const liveSpd = hyp(p.vx, p.vy);
      // possession clock: herding the puck at close range counts as control
      if (liveD < MALLET_R + PUCK_R + 44) b.possessT += D.tick; else b.possessT = Math.max(0, b.possessT - D.tick);
      // windup ONLY from behind the puck on LIVE geometry. The old code
      // committed on delayed perception and the live-puck own-goal guard
      // then cancelled the strike: pull back, retreat, repeat - the visible
      // feint loop. abortCd spaces out attempts after a cancelled windup so
      // one bad read can't strobe the telegraph.
      const counterShot = b.counterT > 0 && b.behindH &&
        liveD < MALLET_R + PUCK_R + 58 && liveSpd < (D.counterSpeed || 1900);
      if (b.abortCd <= 0 && b.behindH &&
          ((liveD < MALLET_R + PUCK_R + 26 && (liveSpd < 700 || b.possessT > 0.35)) || counterShot)) {
        b.state = 'windup'; b.tState = 0; b.windT = 0; b.possessT = 0;
        b.counterCommitted = counterShot;
        if (counterShot) b.counterT = 0;
        // Pick from real air-hockey families: cut/cross straights plus
        // under/over single banks. Better rivals also disguise those families
        // behind the same release and vary the hold before the strike.
        const keeper = b.side === 0 ? G.m2 : G.m1;
        aiPlanShot(b, s, keeper, foeGoalX);
      }
      // give up the chase only once the puck is clearly gone: the latched
      // side plus a higher speed bar than the engage-entry bar (hysteresis)
      if (!b.sideH || puckSpeed > 1900) { b.state = 'guard'; b.tState = 0; b.possessT = 0; }
      break;
    }
    case 'windup': {
      // ANTICIPATION: skilled rivals hide different shots behind nearly the
      // same preparation. The real bank/cut direction is revealed only on the
      // strike; Rookie mostly telegraphs, Champion disguises it often.
      b.windT += D.tick;
      let ax = b.aimX, ay = b.aimY;
      if (b.deceptive) {
        ax = foeGoalX;
        ay = s.y + b.releaseSide * 72;
      }
      const dx = ax - s.x, dy = ay - s.y, dl = hyp(dx, dy) || 1;
      const back = 95;
      setTx(s.x - dx / dl * back, s.y - dy / dl * back);
      if (b.windT > (b.windGoal || D.windup)) {
        // commit to the strike only if the mallet is still behind the LIVE
        // puck - it can drift during the windup, and lunging from the wrong
        // side blasts it into your own net
        const dirS = b.side === 1 ? 1 : -1;
        if (dirS * (m.x - p.x) < 30) { b.state = 'recover'; b.tState = 0; b.abortCd = 0.6; break; }
        b.state = 'strike'; b.tState = 0;
        // the whiff: a human misread, rolled per difficulty - the lunge
        // below will be offset clean past the puck
        b.whiff = Math.random() < (D.whiff || 0);
      }
      break;
    }
    case 'strike': {
      // drive THROUGH the puck toward the aim point - this is where
      // mallet velocity becomes puck velocity. Lead the puck slightly
      // so the lunge connects on a moving target.
      const dirS = b.side === 1 ? 1 : -1;
      // last-instant sanity: if the mallet somehow isn't behind the puck
      // at strike time, abort - lunging from the wrong side blasts it
      // into your own net
      if (b.tState <= D.tick * 1.5 && dirS * (m.x - p.x) < 20) {
        b.state = 'recover'; b.tState = 0; b.abortCd = 0.6; break;
      }
      const px = s.x + s.vx * 0.1, py = s.y + s.vy * 0.1;
      const ax = b.aimX, ay = b.aimY;
      const dx = ax - px, dy = ay - py, dl = hyp(dx, dy) || 1;
      const through = 150;
      let tx = px + dx / dl * through, ty = py + dy / dl * through;
      if (b.whiff) {
        // swing clean through: offset perpendicular past the puck's edge
        // (130u > mallet + puck radius, so it genuinely misses)
        const side = Math.random() < 0.5 ? 1 : -1;
        tx += (-dy / dl) * 130 * side;
        ty += (dx / dl) * 130 * side;
      }
      setTx(tx, ty);
      if (b.tState > 0.34) { b.state = 'recover'; b.tState = 0; }
      break;
    }
    case 'recover': {
      // Emergency defense outranks recovery personality. A rebound or second
      // shot that becomes goal-bound must interrupt the retreat immediately;
      // otherwise the mallet visibly backs away while the puck scores.
      if (threat) {
        b.state = 'defend'; b.tState = 0;
        aimDefense();
        break;
      }
      goHome();
      const recovery = D.recover || 0.4;
      // Club Pro and especially Champion will sometimes stay on a loose
      // rebound instead of obediently retreating after every swing. This is
      // where the pressure-player personality actually becomes visible.
      if (!b.reboundTried && b.tState >= recovery * 0.45) {
        b.reboundTried = true;
        const liveOwnSide = b.side === 0 ? p.x < CX - 20 : p.x > CX + 20;
        const loose = hyp(p.vx, p.vy) < (D.engageSpeed || 1500);
        const reachable = hyp(p.x - m.x, p.y - m.y) < 340;
        if (!b.whiff && liveOwnSide && loose && reachable && Math.random() < (D.rebound || 0)) {
          b.state = 'engage'; b.tState = 0; break;
        }
      }
      // a whiffed swing takes longer to gather - the embarrassment tax
      if (b.tState > (b.whiff ? recovery + 0.35 : recovery)) {
        b.state = 'guard'; b.tState = 0; b.whiff = false; b.counterCommitted = false;
      }
      break;
    }
    case 'escape': {
      // two-beat dig-out: first back off to release the pin, then drive
      // through the puck toward open ice
      if (b.tState < 0.32) {
        const h = aiHome(b);
        setTx(m.x + (h.x - m.x) * 0.85, m.y + (h.y - m.y) * 0.85);
      } else {
        const dx = CX - p.x, dy = CY - p.y, dl = hyp(dx, dy) || 1;
        setTx(p.x + dx / dl * 160, p.y + dy / dl * 160);
      }
      if (b.tState > 0.9) { b.state = 'guard'; b.tState = 0; }
      break;
    }
  }
  // Crease caution (v19): on the wrong side of the puck while positioning,
  // the mallet is capped to a soft speed - a fast wrong-side touch is
  // exactly how own goals happen; a soft touch never is. aiDrive applies it.
  // Defend/strike stay uncapped: blocks and lunges need full speed.
  const dirS = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
  b.careful = dirS * (m.x - p.x) < 40 &&
    (b.state === 'engage' || b.state === 'around' || b.state === 'guard');
}
function aiDrive(b, dt, m) {
  aiPerceive(b, dt);
  aiThink(b, dt, m);
  // the strike param finally does something: lunges scale with the
  // difficulty's strike rating, so Rookie pokes and Champion detonates
  let cap = b.diff.maxSpeed * (b.state === 'strike' ? 1.5 * b.diff.strike : 1);
  if (b.careful) cap *= 0.45; // wrong side of the puck: soft touches only
  driveMallet(m, dt, cap);
}

/* ---------- rival balance lab ----------
 * A deterministic, localhost-only soak runner for real game physics + brains.
 * It never ships a debug UI and public pages do not expose its API.
 *
 * Why it lives beside the AI:
 * - unit tests can verify profile math, but emergent bugs (stalls, own goals,
 *   over-defending, zero-shot matches) only appear when the real state
 *   machine and physics run together.
 * - fixed-step seeded matches make tuning changes comparable across commits.
 */
const RivalLab = {
  active:false,
  clock:0,
  current:null,
  lastTouchEvent:null,

  seeded(seed) {
    let x = (Number(seed) || 1) >>> 0;
    return () => {
      x += 0x6D2B79F5;
      let t = x;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  freshSide(diffIdx) {
    return {
      difficulty: diffIdx,
      name: DIFFS[diffIdx].name,
      style: DIFFS[diffIdx].style,
      stateTime: Object.create(null),
      transitions: Object.create(null),
      strikes:0, windups:0, banks:0, cuts:0, unders:0, overs:0, deceptive:0, delayed:0, keeperReads:0, whiffs:0, counterShots:0,
      defends:0, rebounds:0, detours:0, escapes:0,
      goals:0, ownGoals:0, ownGoalsByState:Object.create(null), saves:0,
    };
  },
  observe(side, brain, previous, dt) {
    const out = this.current.sides[side];
    out.stateTime[brain.state] = (out.stateTime[brain.state] || 0) + dt;
    if (previous === brain.state) return;
    const key = previous + '>' + brain.state;
    out.transitions[key] = (out.transitions[key] || 0) + 1;
    if (brain.state === 'defend') out.defends++;
    if (brain.state === 'around') out.detours++;
    if (brain.state === 'escape') out.escapes++;
    if (brain.state === 'windup') {
      out.windups++;
      if (brain.bankY !== null) out.banks++;
      if (brain.shotFamily === 'cut') out.cuts++;
      if (brain.shotFamily === 'under') out.unders++;
      if (brain.shotFamily === 'over') out.overs++;
      if (brain.deceptive) out.deceptive++;
      if (brain.delayedRelease) out.delayed++;
      if (brain.lastReadKeeper) out.keeperReads++;
      if (brain.counterCommitted) out.counterShots++;
    }
    if (brain.state === 'strike') {
      out.strikes++;
      if (brain.whiff) out.whiffs++;
    }
    if (previous === 'recover' && brain.state === 'engage') out.rebounds++;
  },
  noteTouch(side, preVx, preVy, postVx, postVy) {
    if (!this.active) return;
    const goalSign = side === 0 ? -1 : 1;
    const before = Math.max(0, goalSign * preVx);
    const after = Math.max(0, goalSign * postVx);
    // A failed block that merely slows an inbound shot is not an own goal.
    // Count only contacts that create or materially accelerate goalward speed.
    const shank = after > 320 && after > before + 160;
    const brain = side === 0 ? G.ai1 : G.ai2;
    this.lastTouchEvent = {
      side, time:this.clock, shank,
      beforeGoalward:before, afterGoalward:after,
      speed:hyp(postVx,postVy), state:brain?.state || 'unknown'
    };
  },
  onGoal(scorer) {
    const last = this.lastTouchEvent;
    G.score[scorer]++;
    aiRememberGoalLane(scorer);
    const out = this.current.sides[scorer];
    out.goals++;
    if (last && last.side !== scorer && last.shank && this.clock - last.time < 1.2) {
      const own = this.current.sides[last.side];
      own.ownGoals++;
      own.ownGoalsByState[last.state] = (own.ownGoalsByState[last.state] || 0) + 1;
    }
    this.current.goalSpeeds.push(Math.round(puckSpeed() * (2.4384 / PW) * 3.6));
    this.current.rallies.push(G.stats ? G.stats.rally || 0 : 0);
    if (G.stats) {
      G.stats.streak[scorer]++; G.stats.streak[1 - scorer] = 0;
      G.stats.rally = 0; G.stats.rallyLastSide = -1;
    }
    if (G.score[scorer] >= this.current.firstTo) {
      G.winSide = scorer;
      G.state = 'win';
      return;
    }
    resetPositions();
    rollServe(scorer === 0 ? 1 : -1);
    G.state = 'play';
    G.puck.vx = G.serveVX; G.puck.vy = G.serveVY;
  },
  summarizeSide(out, seconds) {
    const stateShare = {};
    for (const [key, value] of Object.entries(out.stateTime))
      stateShare[key] = +(value / Math.max(0.001, seconds)).toFixed(3);
    return {
      difficulty: out.difficulty,
      name: out.name,
      style: out.style,
      strikes:out.strikes,
      strikesPerMinute:+(out.strikes / Math.max(0.001, seconds) * 60).toFixed(2),
      windups:out.windups,
      bankRate:+(out.banks / Math.max(1, out.windups)).toFixed(3),
      cutRate:+(out.cuts / Math.max(1, out.windups)).toFixed(3),
      underRate:+(out.unders / Math.max(1, out.windups)).toFixed(3),
      overRate:+(out.overs / Math.max(1, out.windups)).toFixed(3),
      deceptiveReleaseRate:+(out.deceptive / Math.max(1, out.windups)).toFixed(3),
      delayedReleaseRate:+(out.delayed / Math.max(1, out.windups)).toFixed(3),
      keeperReadRate:+(out.keeperReads / Math.max(1, out.windups)).toFixed(3),
      whiffRate:+(out.whiffs / Math.max(1, out.strikes)).toFixed(3),
      counterShots:out.counterShots,
      defends:out.defends,
      rebounds:out.rebounds,
      detours:out.detours,
      escapes:out.escapes,
      goals:out.goals,
      ownGoals:out.ownGoals,
      ownGoalsByState:{ ...out.ownGoalsByState },
      saves:out.saves,
      stateShare,
    };
  },
  runMatch(a, b, seed = 1, opts = {}) {
    if (!['localhost','127.0.0.1'].includes(window.location?.hostname))
      throw new Error('RivalLab is localhost only');
    const firstTo = Math.max(3, Math.min(7, Number(opts.firstTo) || 5));
    const maxSeconds = Math.max(30, Number(opts.maxSeconds) || 240);
    const dt = 1 / 180;
    const oldRandom = Math.random;
    const oldSettings = {
      firstTo:Settings.firstTo, effects:Settings.effects, haptics:Settings.haptics,
      shake:Settings.shake, instantReplay:Settings.instantReplay,
    };
    Math.random = this.seeded(seed);
    this.active = true; this.clock = 0; this.lastTouchEvent = null;
    this.current = {
      seed, firstTo, matchup:[a,b], sides:[this.freshSide(a), this.freshSide(b)],
      goalSpeeds:[], rallies:[], deadT:0, deadMax:0, timedOut:false,
    };
    try {
      Settings.firstTo = firstTo;
      Settings.effects = 'minimal'; Settings.haptics = false; Settings.shake = 'off'; Settings.instantReplay = 'off';
      G.mode = 'watch'; G.watch = { a, b }; G.difficulty = b; G.demo = false;
      G.score = [0,0]; G.winSide = 0; G.state = 'play';
      G.stats = freshStats(); G.stats.t0 = performance.now();
      G.ai1 = mkBrain(0, a); G.ai2 = mkBrain(1, b);
      resetPositions();
      rollServe(Math.random() < 0.5 ? 1 : -1);
      G.puck.vx = G.serveVX; G.puck.vy = G.serveVY;

      let steps = 0;
      while (G.state === 'play' && this.clock < maxSeconds) {
        const p0 = G.ai1.state, p1 = G.ai2.state;
        aiDrive(G.ai1, dt, G.m1); aiDrive(G.ai2, dt, G.m2);
        this.observe(0, G.ai1, p0, dt); this.observe(1, G.ai2, p1, dt);
        stepPhysics(dt);
        this.clock += dt;
        if (puckSpeed() < 90) this.current.deadT += dt;
        else this.current.deadT = 0;
        this.current.deadMax = Math.max(this.current.deadMax, this.current.deadT);
        if ((++steps % 180) === 0) {
          // Simulation skips render/updateParts, so discard presentation-only
          // debris once per simulated second.
          G.parts.length = 0; G.texts.length = 0; G.pulses.length = 0; G.scuffs.length = 0;
        }
      }
      if (G.state === 'play') this.current.timedOut = true;
      for (let i = 0; i < 2; i++)
        this.current.sides[i].saves = G.stats?.saves?.[i] || 0;
      const duration = +this.clock.toFixed(2);
      const result = {
        seed, matchup:[DIFFS[a].name,DIFFS[b].name], duration,
        score:[...G.score], winner:G.state === 'win' ? G.winSide : -1,
        timedOut:this.current.timedOut,
        deadlocked:this.current.deadMax > 5,
        maxDeadPuckSeconds:+this.current.deadMax.toFixed(2),
        topSpeedKmh:Math.round((G.stats?.topSpeed || 0) * (2.4384 / PW) * 3.6),
        bestRally:G.stats?.bestRally || 0,
        averageGoalSpeedKmh:this.current.goalSpeeds.length
          ? Math.round(this.current.goalSpeeds.reduce((x,y)=>x+y,0) / this.current.goalSpeeds.length) : 0,
        sides:[
          this.summarizeSide(this.current.sides[0], duration),
          this.summarizeSide(this.current.sides[1], duration),
        ],
      };
      return result;
    } finally {
      Math.random = oldRandom;
      Object.assign(Settings, oldSettings);
      this.active = false; this.current = null;
    }
  },
  runSuite(seeds = [11,29,47,83]) {
    const pairs = [[0,0],[1,1],[2,2],[0,1],[1,2],[0,2],[2,0]];
    const matches = [];
    for (const [a,b] of pairs)
      for (const seed of seeds) matches.push(this.runMatch(a,b,seed));
    const self = {};
    for (let d = 0; d < 3; d++) {
      const sample = matches.filter(m => m.sides[0].difficulty === d && m.sides[1].difficulty === d);
      const allSides = sample.flatMap(m => m.sides);
      const avg = key => +(allSides.reduce((n,x)=>n + (x[key] || 0),0) / Math.max(1,allSides.length)).toFixed(3);
      self[DIFFS[d].name] = {
        matches:sample.length,
        strikesPerMinute:avg('strikesPerMinute'),
        bankRate:avg('bankRate'),
        keeperReadRate:avg('keeperReadRate'),
        whiffRate:avg('whiffRate'),
        rebounds:avg('rebounds'),
        ownGoals:allSides.reduce((n,x)=>n+x.ownGoals,0),
      };
    }
    return { matches, self };
  },
};
if (typeof window !== 'undefined' && ['localhost','127.0.0.1'].includes(window.location?.hostname))
  window.__atelierRivalLab = RivalLab;

// ---------- juice ----------
function addTrauma(x) {
  let k = Settings.shake === 'off' ? 0 : Settings.shake === 'subtle' ? 0.45 : 1;
  if (Settings.effects === 'minimal') k = Math.min(k, 0.45); // Minimal caps Shake at Subtle
  G.trauma = clamp(G.trauma + x * k, 0, 1);
}
// shared shake-intensity scale: mirrors addTrauma's gating so every new
// shake flavor respects the Shake setting + Minimal cap identically
function shakeK() {
  let k = Settings.shake === 'off' ? 0 : Settings.shake === 'subtle' ? 0.45 : 1;
  if (Settings.effects === 'minimal') k = Math.min(k, 0.45);
  return k;
}
function shakeOffset() {
  // Nijman's rule: a touch of ROTATION reads as force; pure translation reads as a glitch
  const t2 = G.trauma * G.trauma;
  return {
    x: rnd(-1, 1) * 13 * t2,
    y: rnd(-1, 1) * 13 * t2,
    r: rnd(-1, 1) * 0.011 * t2,
  };
}
// pooled particles - no allocation in the hot loop
const PPOOL = [];
for (let i = 0; i < 260; i++) PPOOL.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 3, color: '#fff' });
function burst(x, y, n, color, speed, size = 3.5) {
  let c = 0;
  for (const q of PPOOL) {
    if (q.on) continue;
    q.on = true;
    const a = rnd(TAU), sp = rnd(0.25, 1) * speed;
    q.x = x; q.y = y; q.vx = Math.cos(a) * sp; q.vy = Math.sin(a) * sp;
    q.life = q.max = rnd(0.25, 0.6); q.size = size * rnd(0.6, 1.3); q.color = color;
    if (++c >= n) break;
  }
}
function airPuff(x, y) {
  // the table's air jets whisper the dead puck back to life
  for (let i = 0; i < 10; i++) {
    for (const q of PPOOL) {
      if (q.on) continue;
      q.on = true;
      q.x = x + rnd(-30, 30); q.y = y + rnd(-30, 30);
      q.vx = rnd(-40, 40); q.vy = rnd(-90, -20);
      q.life = q.max = rnd(0.4, 0.8); q.size = rnd(2, 5); q.color = 'rgba(200,220,235,0.5)';
      break;
    }
  }
}
function updateParts(dt) {
  for (const q of PPOOL) {
    if (!q.on) continue;
    q.life -= dt;
    if (q.life <= 0) { q.on = false; continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    const d = Math.exp(-3.2 * dt);
    q.vx *= d; q.vy *= d;
  }
  for (let i = G.scuffs.length - 1; i >= 0; i--) {
    G.scuffs[i].a -= dt * 0.10;
    if (G.scuffs[i].a <= 0) G.scuffs.splice(i, 1);
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i];
    t.t += dt; t.y -= dt * 46;
    if (t.t > 1.1) G.texts.splice(i, 1);
  }
  // save-moment ring pulses: expand and fade over 0.6s
  for (let i = G.pulses.length - 1; i >= 0; i--) {
    G.pulses[i].t += dt;
    if (G.pulses[i].t > 0.6) G.pulses.splice(i, 1);
  }
}
function addText(x, y, str, color, size = 44) {
  G.texts.push({ x, y, str, color, size, t: 0 });
  if (G.texts.length > 8) G.texts.shift();
}

// impact events - the layered hit stack.
// Tiers around the 650 hit-stop threshold: tap (<650), drive (650–1400),
// SMASH (>1400). Each tier buys more shake, a bigger flash, and a deeper
// pitch; SMASH also startles the room itself (see G.roomPulse).
function hitTier(impact) { return impact > 1400 ? 2 : impact > 650 ? 1 : 0; }
function impactFlashProfile(impact) {
  // Human brightness perception is not linear. Start the visible SMASH range
  // gently, ease up with speed, and cap both alpha and footprint so even the
  // hardest legal puck strike reads as force instead of a white-out.
  const t = clamp((impact - 1400) / 1300, 0, 1);
  const smooth = t * t * (3 - 2 * t);
  const maxEnergy = Settings.effects === 'subtle' ? 0.34 : 0.48;
  return {
    energy: lerp(0.12, maxEnergy, smooth),
    radius: lerp(125, Settings.effects === 'subtle' ? 175 : 205, smooth),
    room: lerp(0.30, 0.82, smooth),
  };
}
function noteRallyTouch(side) {
  if (G.state !== 'play' || G.demo || !G.stats) return;
  const st = G.stats;
  const next = { side, x:G.puck.x, y:G.puck.y, ms:performance.now() };
  const prev = { side:st.rallyLastSide, x:st.rallyLastX, y:st.rallyLastY, ms:st.rallyLastMs };
  if (!Feel.meaningfulReturn(next, prev)) return;
  st.rallyLastSide = side; st.rallyLastX = next.x; st.rallyLastY = next.y; st.rallyLastMs = next.ms;
  st.rally++;
  st.bestRally = Math.max(st.bestRally, st.rally);
  if (G.mode === 'workshop') Practice.onRally(st.rally);
  else MusicSys.setRally(Feel.rallyIntensity(st.rally));
  if (typeof FeelLab !== 'undefined') FeelLab.recordRally(st.rally);
  // No giant combo counter: audio and trails communicate mounting pressure.
}

function onMalletHit(x, y, impact, nx, ny, suppressHaptic, contact = null) {
  const perfect = !suppressHaptic && !!contact && Feel.perfectStrike(contact);
  const v = clamp(impact / 2200, 0, 1);
  const tier = hitTier(impact);
  const fxp = fxParticles();
  // No hit-stop on the authoritative gameplay clock.
  addTrauma(tier === 2 ? 0.55 + v * 0.45 : 0.18 + v * 0.5);
  if (tier === 2) {
    const flash = perfect ? { energy:Feel.tuning.perfectFlashEnergy, radius:92, room:0.45 } : impactFlashProfile(impact);
    if (fxFlash()) {
      G.hitFlash = Math.max(G.hitFlash, flash.energy);
      G.hitFlashX = x; G.hitFlashY = y; G.hitFlashR = flash.radius;
    }
    if (fxRoom()) G.roomPulse = Math.max(G.roomPulse, flash.room);
    if (!suppressHaptic && !perfect) Haptics.fire('smash');
  }
  // puck squash along the impact normal, 10–20%. Restarts the recovery
  // spring from rest at the deformed shape.
  G.puckSq = 1 - (0.10 + v * 0.10);
  G.puckSqA = Math.atan2(ny, nx);
  G.puckSqV = 0;
  burst(x, y, Math.max(1, Math.round((5 + v * 12) * fxp)), THEME.particle, 200 + v * 480);
  if (tier === 2) burst(x, y, Math.max(1, Math.round(10 * fxp)), '#ffffff', 500 + v * 500, 3);
  // permanence: hard hits leave a fading scuff on the cloth
  if (impact > 900 && G.scuffs.length < 48) {
    G.scuffs.push({ x, y, a: 0.20, ang: Math.atan2(ny, nx) + Math.PI / 2, len: 26 + v * 40 });
  }
  const rallyN = G.stats ? G.stats.rally : 0;
  if (perfect) {
    AudioSys.perfectCrack();
    Haptics.fire('perfect');
  } else {
    AudioSys.hit(v, 1 + Feel.rallyIntensity(rallyN) * Feel.tuning.rallyPitchLift);
    if (!suppressHaptic && tier < 2 && v > 0.55) Haptics.fire('strike');
  }
  if (typeof FeelLab !== 'undefined' && G.state === 'play' && !G.demo)
    FeelLab.recordHit({ perfect, impact });
}
function onRailHit(x, y, impact, isPost, nx, ny) {
  Highlights.noteRail(x, y, isPost);
  const v = clamp(impact / 2200, 0, 1);
  // puck squash on rails and the goal frame, 8–20% along the impact normal -
  // shared with the mallet-hit squash. Keeps the deeper of overlapping
  // deformations and restarts the spring from the new shape.
  if (nx !== undefined) {
    G.puckSq = Math.min(G.puckSq, 1 - (0.08 + v * 0.12));
    G.puckSqA = Math.atan2(ny, nx);
    G.puckSqV = 0;
  }
  if (impact > 1100) addTrauma(0.12 + v * 0.2);
  if (impact > 300) burst(x, y, Math.max(1, Math.round((3 + v * 6) * fxParticles())), THEME.particle, 140 + v * 260, 2.5);
  if (isPost && impact > 900) {
    // the goal frame rattles: a hard frame hit earns a low clank and a
    // visible shake of the trim - deliberately heavier than the post ping
    AudioSys.clank(v);
    Haptics.fire('post');
    if (fxFlash()) G.rattle = { side: x < PX + PW / 2 ? 0 : 1, t: 0.42 };
    burst(x, y, Math.max(1, Math.round(10 * fxParticles())), '#ffffff', 380, 2.5);
  } else if (isPost && impact > 200) {
    // the goal frame rings - a distinct metallic ping plus a bright kiss
    AudioSys.ping();
    burst(x, y, Math.max(1, Math.round(8 * fxParticles())), '#ffffff', 320, 2.5);
  } else {
    AudioSys.rail(v);
    if (impact > 1100) Haptics.fire('rail');
  }
}

// ---------- state management ----------
// Ceremony flags (letterbox, flash, slow-mo) belong to the 'goal' state.
// Every exit path funnels through clearCeremony so a mid-ceremony quit,
// restart, or win can never leave GOAL! / slow-mo stuck on screen.
function clearCeremony() {
  G.letterT = 0; G.flashA = 0; G.goalT = 0; G.goalSlowT = 0;
  G.goalStreakLabel = ''; G.goalMomentLabel = ''; G.goalScorerLabel = ''; G.goalSpeedKmh = 0;
  G.timeScale = 1;
}
function holdGoalCeremonyForPause() {
  const held = {
    goalSide:G.goalSide,
    goalStreakLabel:G.goalStreakLabel,
    goalMomentLabel:G.goalMomentLabel,
    goalScorerLabel:G.goalScorerLabel,
    goalSpeedKmh:G.goalSpeedKmh,
  };
  clearCeremony();
  return held;
}
function resumeGoalCeremonyAfterPause() {
  const held = G.pausedGoalCeremony;
  if (!held) return;
  G.goalSide = held.goalSide;
  G.goalStreakLabel = held.goalStreakLabel;
  G.goalMomentLabel = held.goalMomentLabel;
  G.goalScorerLabel = held.goalScorerLabel;
  G.goalSpeedKmh = held.goalSpeedKmh;
  G.goalT = 0; G.goalSlowT = 0; G.letterT = 0;
  G.timeScale = 0.22;
  const yours = goalIsYours(G.goalSide);
  G.flashA = yours ? 0.45 : 0.30;
  G.goalFrameT = yours ? 0.45 : 0.25;
  G.pausedGoalCeremony = null;
}
// ---------- game flow ----------
function startGame(mode, diff) {
  AudioSys.init(); AudioSys.resume();
  G.mode = mode;
  // EXHIBITION: diff is {a, b} - independent difficulty for left/right AI.
  if (mode === 'watch') { G.watch = { a: diff.a, b: diff.b }; G.difficulty = diff.b; }
  else { G.watch = null; G.difficulty = diff == null ? G.difficulty : diff; }
  G.score = [0, 0]; G.winSide = 0;
  Replay.reset();
  Highlights.reset();
  G.demo = false; G.idleT = 0; G.gwNet = 0; // local/host: goal width from Settings (guests get the host's via countdown)
  clearCeremony(); G.pausedGoalCeremony = null;
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  G.scuffs.length = 0; G.texts.length = 0;
  resetPositions();
  if (mode === 'watch') {
    G.ai1 = mkBrain(0, G.watch.a);
    G.ai2 = mkBrain(1, G.watch.b);
  } else {
    G.ai2 = mkBrain(1, G.difficulty);
    G.ai1 = (mode === '2p') ? null : mkBrain(0, G.difficulty); // demo brain, unused in 1p
  }
  G.stats = freshStats(); G.stats.t0 = performance.now();
  pointers.clear();
  hideAll();
  $('menu').classList.add('hidden');
  $('topbar').classList.remove('hidden');
  maybeShowHint();
  startCount();
  // first serve: face-off decides who gets the puck (random side), then roll
  // the serve flavor once so local and online both use the same point
  rollServe(Math.random() < 0.5 ? 1 : -1);
  // ONLINE: the host's countdown mirrors to the guest so both start even
  if (mode === 'online' && onlineIsAuthority()) Net.sendCountdown(true);
}
function startWorkshop(id) {
  const d = WORKSHOP_DRILLS[id];
  if (!d) return;
  AudioSys.init(); AudioSys.resume();
  Practice.returnTheme = G.themeId;
  if (!tableUnlocked(G.themeId)) setTheme('deco', true);
  G.mode = 'workshop'; G.difficulty = d.coach == null ? 0 : d.coach;
  G.watch = null; G.score = [0,0]; G.winSide = 0;
  Replay.reset(); Highlights.reset();
  G.demo = false; G.idleT = 0; G.gwNet = 0;
  clearCeremony(); G.pausedGoalCeremony = null; G.freezeT = 0; G.trauma = 0; G.board = freshBoard();
  G.scuffs.length = 0; G.texts.length = 0;
  resetPositions();
  G.ai1 = null; G.ai2 = d.coach == null ? null : mkBrain(1, d.coach);
  G.stats = freshStats(); G.stats.t0 = performance.now();
  pointers.clear();
  if (!Practice.begin(id)) return;
  Practice.preparePoint();
  hideAll();
  $('topbar').classList.remove('hidden');
  $('workshopHud').classList.remove('hidden');
  startCount();
  rollServe(d.serve);
}
// First-time hint: one line on the first local match ("Drag to move your
// mallet"), dismissed forever after the first goal. Persisted in
// localStorage so it never returns. Online/demo never get the hint - it's a
// local-match affordance only, and netcode stays untouched.
const HINT_KEY = 'atelier-ah-hintseen';
function hintSeen() {
  try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; }
}
function maybeShowHint() {
  if ((G.mode !== 'ai' && G.mode !== '2p') || hintSeen()) { G.hintLive = false; return; }
  G.hintLive = true;
  $('hint').classList.remove('hidden');
}
function dismissHint(markSeen) {
  G.hintLive = false;
  $('hint').classList.add('hidden');
  if (markSeen) { try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {} }
}
function startCount() {
  G.state = 'count'; G.countT = 0; G.countN = 3; G.goPlayed = false;
  MusicSys.setRally(0);
  if (G.score[0] === 0 && G.score[1] === 0) MusicSys.setIntensity(0); // fresh match: the bed at rest
  MusicSys.alignBeat(); // both peers start the same phrase on the countdown downbeat
  G.puck.x = CX; G.puck.y = CY; G.puck.vx = 0; G.puck.vy = 0;
  G.trail.length = 0;
}
// Serve variety: the player who was scored on (or a random side on the first
// serve, per the face-off rule) strikes the puck from center. A real struck
// serve isn't the same shot every time, so roll a flavor:
//   banker  ~10%: shallow drive that kisses the side rail first
//   dink    ~12%: a slow teasing feed
//   wide    ~28%: driven through at a real angle, ±32°
//   drive   ~50%: the classic straight serve with a touch of wobble
// Rolled once per point and stored on G so host and guest play the identical
// serve - the host rolls, the guest receives (see Net.sendCountdown).
function rollServe(dir) {
  const sp = paceServe(), roll = Math.random();
  let ang, speed;
  if (roll < 0.10) {          // banker - kiss the side rail first
    ang = (60 + Math.random() * 16) * (Math.random() < 0.5 ? 1 : -1);
    speed = sp * (0.92 + Math.random() * 0.16);
  } else if (roll < 0.22) {   // dink - a slow teasing feed
    ang = (Math.random() - 0.5) * 50;
    speed = sp * (0.52 + Math.random() * 0.14);
  } else if (roll < 0.50) {   // wide angle
    ang = (Math.random() - 0.5) * 64;
    speed = sp * (0.90 + Math.random() * 0.20);
  } else {                    // straight drive with a little wobble
    ang = (Math.random() - 0.5) * 16;
    speed = sp * (0.95 + Math.random() * 0.22);
  }
  G.serveDir = dir;
  const a = ang * Math.PI / 180;
  G.serveVX = Math.cos(a) * speed * dir;
  G.serveVY = Math.sin(a) * speed;
}
function updateCount(rdt) {
  G.countT += rdt;
  const n = 3 - Math.floor(G.countT / 0.55);
  if (n !== G.countN && n >= 1) { G.countN = n; AudioSys.count(false); }
  if (G.countT >= 1.65 && !G.goPlayed) {
    G.goPlayed = true; AudioSys.count(true); Haptics.fire('serve');
  }
  if (G.countT >= 2.0) {
    G.goPlayed = false;
    G.state = 'play';
    // serve the rolled point - the player who was scored on gets the puck
    // (USAA basic rules §4: "the player scored upon receives possession of
    // the puck for the next serve")
    G.puck.vx = G.serveVX; G.puck.vy = G.serveVY;
  }
}
function onGoal(scorer) {
  if (G.demo) { // attract mode: no ceremony, just play on
    burst(G.puck.x, G.puck.y, 24, THEME.particle, 420);
    AudioSys.hit(0.8);
    resetPositions();
    rollServe(Math.random() < 0.5 ? 1 : -1);
    G.puck.vx = G.serveVX; G.puck.vy = G.serveVY;
    return;
  }
  if (G.state !== 'play') return;
  // ONLINE: the host owns the simulation; a guest never scores locally.
  if (G.mode === 'online' && !onlineIsAuthority()) return;
  if (G.mode === 'workshop') {
    const kmh = Math.round(puckSpeed() * (2.4384 / PW) * 3.6);
    Practice.onGoal(scorer, kmh);
    return;
  }
  if (RivalLab.active && G.mode === 'watch') {
    RivalLab.onGoal(scorer);
    return;
  }
  G.goalRallyBonus = Feel.goalRelease(G.stats ? G.stats.rally : 0);
  if (typeof FeelLab !== 'undefined') FeelLab.recordGoal(G.stats ? G.stats.rally : 0);
  MusicSys.setRally(0);
  G.score[scorer]++; // the single place a goal changes the score
  // match-point lift: the music gains its pulse layer when someone is one away
  MusicSys.setIntensity(G.score[0] >= Settings.firstTo - 1 || G.score[1] >= Settings.firstTo - 1 ? 1 : 0);
  if (G.mode !== 'online' && G.stats) {
    // streaks + worst-deficit tracking for the v23 fun pass (host-owned in
    // online play would desync the guest's view, so guests never track)
    const st = G.stats;
    st.streak[scorer]++; st.streak[1 - scorer] = 0;
    if (st.streak[scorer] > st.bestStreak[scorer]) st.bestStreak[scorer] = st.streak[scorer];
    st.worstDef[0] = Math.min(st.worstDef[0], G.score[0] - G.score[1]);
    st.worstDef[1] = Math.min(st.worstDef[1], G.score[1] - G.score[0]);
  }
  aiRememberGoalLane(scorer);
  if (G.hintLive) dismissHint(true); // first goal dismisses the hint forever
  if (G.stats) {
    G.stats.bestGoalRally = Math.max(G.stats.bestGoalRally || 0, G.stats.rally || 0);
    const hp = Highlights.point;
    if (hp && hp.bankBy === scorer && hp.bankSerial === Highlights.touchSerial)
      G.stats.bankGoals[scorer]++;
  }
  const goalClip = Replay.capture(scorer);
  Highlights.recordGoal(scorer, goalClip);
  beginGoalCeremony(scorer);
  if (G.mode === 'online') Net.sendGoal(scorer); // reliable context travels with authoritative goal
}
// ONLINE: start the goal ceremony visuals only - no scoring, no sending.
// The host scores first in onGoal; the guest's scores arrive final in the
// goal event. Splitting it this way makes double-counting impossible.
// Goal hierarchy: YOUR goals get the full treatment (confetti storm, frame
// flash, deeper chord); conceded goals are a smaller, dimmer affair.
function goalIsYours(scorer) {
  if (G.mode === '2p') return true; // both ends are players - both celebrate
  if (G.mode === 'watch') return false; // exhibition has no human side
  if (G.mode === 'online') {
    if (Net.role === 'spectator') return false;
    return onlinePlayerSide() === scorer;
  }
  return scorer === 0;
}
function confettiColors() {
  return [THEME.gold || '#d8a93f', THEME.particle, '#ffffff', THEME.ink].filter(Boolean);
}
// goal-streak announcements - the little combo rush that makes scoring feel
// addictive. Local matches only (online guests never own the sim, and the
// streak state isn't in the snapshot), gated on fxFlash() like the rest of
// the ceremony juice.
function announceStreak(scorer) {
  G.goalStreakLabel = '';
  if (G.mode === 'online' || G.demo) return;
  const st = G.stats;
  if (!st || !goalIsYours(scorer) || !fxFlash()) return;
  const n = st.streak[scorer];
  if (n < 2) return;
  G.goalStreakLabel = n === 2 ? 'TWO IN A ROW'
    : n === 3 ? 'HAT TRICK'
    : n + ' IN A ROW';
}
function goalScorerCallout(scorer) {
  const who = sideLabel(scorer);
  return who === 'YOU' ? 'YOU SCORE' : who + ' SCORES';
}
function goalMomentContext(scorer) {
  const mine = G.score[scorer], theirs = G.score[1 - scorer], target = Settings.firstTo;
  if (mine >= target) return 'WINNING GOAL';
  if (mine === target - 1 && theirs === target - 1) return 'NEXT GOAL WINS';
  if (G.goalStreakLabel) return G.goalStreakLabel;
  if (mine === target - 1) return 'MATCH POINT';
  if (mine === theirs) return 'LEVEL';
  if (mine === theirs + 1) return 'LEAD TAKEN';
  return '';
}
function spokenSideLabel(side) {
  const label = sideLabel(side);
  if (label === 'YOU') return 'You';
  if (label === 'P1') return 'Player one';
  if (label === 'P2') return 'Player two';
  return label.charAt(0) + label.slice(1).toLowerCase();
}
function announceGoalStatus(scorer) {
  const el = $('gameStatus');
  if (!el) return;
  const moment = G.goalMomentLabel ? ' ' + G.goalMomentLabel + '.' : '';
  const reward = G.goalRewardLabel ? ' ' + G.goalRewardLabel.replace(' · ', ', ') + '.' : '';
  el.textContent = spokenSideLabel(scorer) + ' scores. Score ' +
    G.score[0] + ' to ' + G.score[1] + '.' + moment + reward;
}
function beginGoalCeremony(scorer, remoteGoalContext = null, remoteGoalY = null) {
  G.pausedGoalCeremony = null;
  boardKick(scorer);
  G.goalSide = scorer;
  // Remote viewers use the host's crossing position when available.
  const crossingY = Number.isFinite(remoteGoalY) ? remoteGoalY : G.puck.y;
  G.goalShockY = clamp(crossingY, CY - goalW()/2 + 18, CY + goalW()/2 - 18);
  if (G.stats) { G.stats.rally = 0; G.stats.rallyLastSide = -1; } // new exchange after each goal
  G.rallyHudT = 0; G.rallyHudN = 0;
  G.state = 'goal';
  G.goalT = 0; G.goalSlowT = 0; G.letterT = 0;
  G.timeScale = 0.22; // the reserved channel: slow-mo belongs to goals
  const yours = goalIsYours(scorer);
  G.flashA = Math.min(1, (yours ? 1 : 0.65) + G.goalRallyBonus * 0.20);
  G.goalFrameT = Math.min(1, (yours ? 1 : 0.5) + G.goalRallyBonus * 0.32);
  $('topbar').classList.add('hidden'); // ceremony is cinematic - no mis-taps
  const gx = scorer === 0 ? PX + PW : PX;
  const fxp = fxParticles();
  burst(gx, CY, Math.max(4, Math.round(46 * fxp)), THEME.particle, 620, 4.5);
  burst(gx, CY, Math.max(2, Math.round(20 * fxp)), '#ffffff', 380, 3);
  if (!PRM.reduce) {
    // theme-colored confetti storm - bigger when YOU score
    const cols = confettiColors();
    const n = Math.round((yours ? 90 : 36) * fxp);
    for (let c = 0; c < 3; c++) burst(gx, CY, Math.max(1, Math.round(n / 3)), cols[c % cols.length], 380 + c * 160, 4 + c);
  }
  addTrauma(0.85);
  // The host classifies once, then sends the same bounded visual facts to
  // guest and gallery. Snapshot recovery without the event stays conservative.
  const latest = Highlights.latestGoal;
  const localFacts = G.mode !== 'online' || onlineIsAuthority();
  const fresh = localFacts && latest && latest.scorer === scorer &&
    latest.score && latest.score[0] === G.score[0] && latest.score[1] === G.score[1];
  const facts = fresh ? { ...latest, target:Settings.firstTo } : {
    scorer, score:G.score, target:Settings.firstTo, rally:0, speedKmh:0,
  };
  G.goalContext = remoteGoalContext && Feel.validGoalContext(remoteGoalContext,G.score,scorer,Settings.firstTo)
    ? Object.freeze({kind:remoteGoalContext.kind,craft:remoteGoalContext.craft,
      rally:remoteGoalContext.rally,speed:remoteGoalContext.speed})
    : Feel.goalContext(facts);
  G.goalRallyBonus = Feel.goalRelease(G.goalContext.rally);
  // Keep local captured velocity for replays; remote display uses host truth.
  G.goalSpeedKmh = (G.mode === 'online' && !onlineIsAuthority())
    ? G.goalContext.speed : Math.round(puckSpeed() * (2.4384 / PW) * 3.6);
  announceStreak(scorer);
  G.goalScorerLabel = goalScorerCallout(scorer);
  G.goalMomentLabel = G.goalContext.kind === 'comeback' ? 'COMEBACK' : goalMomentContext(scorer);
  G.goalRewardLabel = Feel.craftLabel(G.goalContext) ||
    (fresh && G.mode !== 'online' ? Highlights.skillLabel(latest) : '');
  announceGoalStatus(scorer);
  const winningGoal = G.score[scorer] >= Settings.firstTo;
  const goalNotes = THEME.goalChord || [523.25, 659.25, 783.99, 1046.5];
  // Human-owned goals keep the full room signature. Conceded/exhibition goals
  // use only the opening interval and a lighter swell so the mix mirrors the
  // existing visual/haptic hierarchy instead of celebrating both sides equally.
  const goalEnergy = Math.min(1.15, (yours ? (winningGoal ? 1.12 : 1.0) : (winningGoal ? 0.62 : 0.52)) + G.goalRallyBonus);
  AudioSys.goalChord(yours ? goalNotes : goalNotes.slice(0, 2), goalEnergy);
  MusicSys.goalSwell(goalEnergy);
  Haptics.fire(yours ? 'goal' : 'concede');
}
function updateGoal(rdt) {
  G.goalT += rdt; G.goalSlowT += rdt;
  G.letterT = clamp(G.letterT + rdt * 3.2, 0, 1);
  G.flashA = Math.max(0, G.flashA - rdt * 2.4);
  G.goalFrameT = Math.max(0, G.goalFrameT - rdt * 1.8);
  if (G.goalSlowT > 1.0) G.timeScale = lerp(G.timeScale, 1, clamp(rdt * 5, 0, 1));
  // ease the puck into the net
  const p = G.puck;
  const gx = G.goalSide === 0 ? PX + PW + 70 : PX - 70;
  p.x = lerp(p.x, gx, clamp(rdt * 5, 0, 1));
  p.y = lerp(p.y, CY, clamp(rdt * 5, 0, 1));
  p.vx *= 0.9; p.vy *= 0.9;

  const winningGoal = G.score[G.goalSide] >= Settings.firstTo;
  // Replay is an optional reward after the goal has already landed. A choice
  // made during celebration waits for the emotional beat; ignoring it never
  // delays the next serve.
  if (!winningGoal && G.goalT >= REPLAY_OFFER_AT && Replay.hasPending()) Replay.showOffer();
  if (!winningGoal && Replay.requested && G.goalT >= REPLAY_START_AT) {
    clearCeremony();
    Replay.startPending('goal');
    return;
  }
  const hold = winningGoal ? GOAL_HOLD_WIN
    : (goalIsYours(G.goalSide) ? GOAL_HOLD_OWN : GOAL_HOLD_CONCEDE);
  if (G.goalT > hold) advanceAfterGoal();
}
function advanceAfterGoal() {
  const winningGoal = G.score[0] >= Settings.firstTo || G.score[1] >= Settings.firstTo;
  const keepOffer = !winningGoal && Replay.hasPending();
  clearCeremony();
  Replay.hideOffer();
  if (winningGoal) {
    G.winSide = G.score[0] > G.score[1] ? 0 : 1;
    G.state = 'win';
    showWin();
    return;
  }
  resetPositions();
  rollServe(G.goalSide === 0 ? 1 : -1); // scored-on player gets the puck
  startCount();
  $('topbar').classList.remove('hidden');
  if (keepOffer) Replay.keepOfferDuringCount(1.0);
  else Replay.discardPending();
  // ONLINE: the host's countdown mirrors to the guest so both start even
  if (G.mode === 'online' && onlineIsAuthority()) Net.sendCountdown();
}
function matchPersistsProgress(mode = G.mode) {
  // Exhibition is observational only. Keep this as the single contract used
  // by result persistence so future stats/mastery features cannot accidentally
  // treat AI-vs-AI viewing as player progression.
  return mode === 'ai' || mode === '2p';
}
function resultIsHumanWin() {
  if (G.mode === 'ai') return G.winSide === 0;
  if (G.mode === '2p') return true;
  if (G.mode === 'online') return onlineSideLabel(G.winSide) === 'YOU';
  if (G.mode === 'watch') return false; // exhibition has no human winner
  return false;
}
function buildWinBurst(won) {
  const host = $('winBurst');
  if (!host) return;
  host.innerHTML = '';
  if (!won || PRM.reduce || Settings.effects === 'minimal') return;
  const count = Settings.effects === 'subtle' ? 12 : 20;
  const shape = (G.themeId === 'mid' || G.themeId === 'mem' || G.themeId === 'neon') ? 'alt'
    : (G.themeId === 'sashi' || G.themeId === 'zel' || G.themeId === 'bil') ? 'diamond' : '';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = shape && i % 3 === 0 ? shape : (i % 4 === 0 ? 'alt' : '');
    p.style.setProperty('--a', (i * 360 / count + rnd(-5, 5)).toFixed(1) + 'deg');
    p.style.setProperty('--travel', (-rnd(95, 180)).toFixed(0) + 'px');
    p.style.setProperty('--delay', Math.round(rnd(0, 140)) + 'ms');
    host.appendChild(p);
  }
  setTimeout(() => { if (host) host.innerHTML = ''; }, 1500);
}
function addWinAward(type, label) {
  const box = $('winFeats');
  if (!box || !label) return;
  const el = document.createElement('span');
  el.className = 'win-award ' + type;
  el.textContent = label;
  box.appendChild(el);
}
function showWin() {
  clearCeremony(); // defensive: no ceremony visuals leak under the overlay
  MusicSys.setIntensity(0); // the room exhales - bed back to rest
  $('topbar').classList.add('hidden');
  const humanWin = resultIsHumanWin();
  const you = G.winSide === 0;
  const canPersist = matchPersistsProgress();

  // Only eligible played matches may write persistent result data.
  if (canPersist && G.mode === 'ai') Record.bump('ai' + G.difficulty, G.winSide === 0);
  else if (canPersist && G.mode === '2p') { Record.bump('p1', G.winSide === 0); Record.bump('p2', G.winSide === 1); }

  let winnerName;
  if (G.mode === '2p') winnerName = you ? 'Player One' : 'Player Two';
  else if (G.mode === 'online') {
    const label = onlineSideLabel(G.winSide);
    winnerName = Net.role === 'spectator' ? (label === 'P1' ? 'Player One' : 'Player Two')
      : label === 'YOU' ? 'You' : 'Rival';
  }
  else if (G.mode === 'watch') winnerName = DIFFS[G.watch[G.winSide === 0 ? 'a' : 'b']].name;
  else winnerName = you ? 'You' : DIFFS[G.difficulty].name;

  const card = $('winov').querySelector('.win-card');
  if (card) {
    card.classList.remove('win-win', 'win-loss', 'win-neutral');
    card.classList.add(humanWin ? 'win-win'
      : ((G.mode === 'watch' || (G.mode === 'online' && Net.role === 'spectator')) ? 'win-neutral' : 'win-loss'));
  }

  $('winTitle').textContent = winnerName + (winnerName === 'You' ? ' took the table.' : ' takes the table.');
  $('winScoreLeft').textContent = G.score[0];
  $('winScoreRight').textContent = G.score[1];
  $('winSub').setAttribute('aria-label', 'Final score ' + G.score[0] + ' to ' + G.score[1]);

  const margin = Math.abs(G.score[0] - G.score[1]);
  $('winResultLine').textContent = THEME.name.toUpperCase() + ' · ' + margin + ' GOAL' + (margin === 1 ? '' : 'S') + ' MARGIN';

  // Real match highlights replace the old two-line stats paragraph.
  const st = G.stats || freshStats();
  const kmh = Math.round(st.topSpeed * (2.4384 / PW) * 3.6); // 8ft table mapping
  const secs = Math.max(1, Math.round((performance.now() - st.t0) / 1000));
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
  const sv = st.saves || [0, 0];
  $('winTopSpeed').textContent = kmh;
  $('winLongestRally').textContent = st.bestRally || 0;
  $('winSaves').textContent = sv[0] + '–' + sv[1];
  $('winTime').textContent = mm + ':' + ss;
  $('winSaveLabel').textContent = sideLabel(0) + ' · ' + sideLabel(1);

  // Earned moments only. No filler badges.
  const awards = $('winFeats');
  if (awards) { awards.innerHTML = ''; awards.classList.add('hidden'); }
  let firstTableWin = false;
  if (canPersist && (G.mode === '2p' || G.winSide === 0)) {
    const key = G.mode === 'ai' ? 'ai' + G.difficulty : 'p2p';
    const recs = checkBest(key, secs, kmh, st.bestRally || 0, margin);
    recs.forEach(label => addWinAward('record', label));

    const fresh = [];
    if (G.score[1 - G.winSide] === 0 && Feats.unlock('shutout')) fresh.push('SHUTOUT');
    if ((st.worstDef || [0, 0])[G.winSide] <= -3 && Feats.unlock('comeback')) fresh.push('COMEBACK');
    if (((st.bestStreak || [0, 0])[G.winSide] || 0) >= 3 && Feats.unlock('hattrick')) fresh.push('HAT TRICK');
    if (kmh >= SPEEDSTER_KMH && Feats.unlock('speedster')) fresh.push('SPEEDSTER');

    const unlockBefore = tableUnlockSnapshot();
    if (G.mode === 'ai' && G.winSide === 0) {
      const challengeContext = {
        oppScore:G.score[1],
        bestRally:st.bestRally || 0,
        topSpeedKmh:kmh,
        bankGoals:(st.bankGoals && st.bankGoals[0]) || 0,
        worstDef:(st.worstDef && st.worstDef[0]) || 0,
        saves:(st.saves && st.saves[0]) || 0,
        margin,
        bestGoalRally:st.bestGoalRally || 0,
        bestStreak:(st.bestStreak && st.bestStreak[0]) || 0,
      };
      if (TableChallenges.check(G.themeId, challengeContext))
        addWinAward('feat', 'CHALLENGE CLEARED · ' + TABLE_CHALLENGES[G.themeId].name.toUpperCase());
      Mastery.award(G.themeId, G.difficulty).forEach(label => addWinAward('feat', label));
    }
    firstTableWin = !Tour.won(G.themeId);
    Tour.bump(G.themeId);
    if (firstTableWin) addWinAward('feat', 'TABLE CONQUERED');
    newlyUnlockedTables(unlockBefore).forEach(id => addWinAward('feat', 'UNLOCKED · ' + THEMES[id].name));
    if (Tour.count() >= THEME_ORDER.length && Feats.unlock('grandtour')) fresh.push('GRAND TOUR');
    fresh.forEach(label => addWinAward('feat', label));
  }
  if (awards && awards.children.length) awards.classList.remove('hidden');

  const kicker = $('winKicker');
  if (kicker) {
    if (G.mode === 'watch') kicker.textContent = 'EXHIBITION · FULL TIME';
    else if (G.mode === 'online' && Net.role === 'spectator') kicker.textContent = 'WATCHING · FULL TIME';
    else if (humanWin && firstTableWin) kicker.textContent = 'TABLE CONQUERED';
    else if (humanWin) kicker.textContent = 'FULL TIME · VICTORY';
    else kicker.textContent = 'FULL TIME';
  }

  if (typeof renderWinHighlights === 'function') renderWinHighlights();
  const reel = Highlights.reel();
  const hasReel = reel.length >= 2;
  const reelBtn = $('btnMatchReel');
  if (reelBtn) reelBtn.classList.toggle('hidden', !hasReel);
  const winReplay = $('btnWinReplay');
  const rematch = $('btnRematch');
  if (rematch) rematch.classList.toggle('hidden', G.mode === 'online' && Net.role === 'spectator');
  const hasReplay = Replay.hasPending();
  if (winReplay) winReplay.classList.toggle('hidden', hasReel || !hasReplay);
  const momentActions = $('winMomentActions');
  if (momentActions) momentActions.classList.toggle('solo', !hasReel && !hasReplay);
  hideAll(); $('winov').classList.remove('hidden');
  G.hintLive = false;

  // One short, theme-native payoff. No looping spectacle.
  G.roomPulse = humanWin ? 1 : 0.35;
  if (humanWin) addTrauma(0.28);
  buildWinBurst(humanWin);
  const chord = (THEME.goalChord || [392, 523.25, 659.25, 783.99]).slice();
  if (humanWin && chord.length) chord.push(chord[0] * 2);
  AudioSys.goalChord(chord);
  if (!(G.mode === 'online' && Net.role === 'spectator')) Haptics.fire(humanWin ? 'win' : 'loss');
}
function togglePause(force, silent) {
  // ONLINE: silent=true applies a pause that arrived over the wire - it must
  // not echo back, or the two clients would ping-pong pause events forever.
  // Pausing is allowed from 'goal' too: the ceremony is cleared so a frozen
  // GOAL! banner / slow-mo can't sit under the pause card, and resume replays
  // the ceremony from its start (goalT=0) rather than a stale timeScale.
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') {
    G.pausedFrom = G.state;
    if (G.state === 'goal') {
      G.pausedGoalCeremony = holdGoalCeremonyForPause();
      Replay.hideOffer();
    }
    G.state = 'pause';
    $('topbar').classList.add('hidden');
    hideAll(); $('pauseov').classList.remove('hidden');
    AudioSys.ui();
    if (G.mode === 'online' && !silent) Net.sendPause(true);
  } else if (G.state === 'pause' && force !== true) {
    G.state = G.pausedFrom;
    hideAll();
    if (G.state === 'goal') resumeGoalCeremonyAfterPause();
    if (G.state === 'play' || G.state === 'count') $('topbar').classList.remove('hidden');
    else if (G.state === 'goal') $('topbar').classList.add('hidden');
    if (G.mode === 'workshop' && Practice.active) $('workshopHud').classList.remove('hidden');
    if (G.hintLive) $('hint').classList.remove('hidden'); // hint survives pause/resume
    if (!silent) {
      // a local resume is always a user gesture, so the context may restart
      AudioSys.resume();
      G.focusLost = false;
    } else if (G.focusLost) {
      // the rival resumed while our tab is still away: stay frozen behind
      // the tap-to-resume veil instead of silently coming back to life
      $('focusov').classList.remove('hidden');
    }
    if (G.mode === 'online' && !silent) Net.sendPause(false);
  }
}
// ---------- focus-loss pause ----------
// visibilitychange -> hidden and window blur both land here (wired in ui.js).
// Everything freezes: the sim, the attract demo, particles, and the net pump
// all hold via the frame() guard; the AudioContext suspends so music, SFX,
// and ambience stop at once. Mid-match this also takes the regular pause path
// (pause card + pause event to the rival, so an online rival pauses too
// instead of drifting on a stale sim). Anywhere else a lightweight
// tap-to-resume veil covers the screen without disturbing the state below.
// Audio never auto-resumes: the veil (or the pause card's Resume button)
// only clears on a real user gesture, which is what the autoplay policy
// needs for ctx.resume() to take effect.
function pauseForFocusLoss() {
  if (G.focusLost) return;
  G.focusLost = true;
  AudioSys.suspend();
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
  // the pause card is already a tap-to-resume surface; only veil when it
  // isn't up (menus, win card, an already-manual pause, confirm dialogs)
  if ($('pauseov').classList.contains('hidden')) $('focusov').classList.remove('hidden');
}
function resumeFromFocusLoss() { // the veil's tap handler - a user gesture
  if (!G.focusLost) return;
  AudioSys.resume();
  G.focusLost = false;
  $('focusov').classList.add('hidden');
}
// Restart the current match from the pause menu.
// LOCAL (ai/2p): immediate - startGame resets score, board, stats, and counts
// down. ONLINE: host authority - the host restarts directly (the countdown
// event pulls the guest along via Net.onCountdown); the guest sends a
// restart request and the host performs it, so both sides stay in sync.
// Never changes net snapshot/input behavior - restart flows through the
// existing countdown handshake.
function restartMatch() {
  AudioSys.ui();
  if (G.mode === 'online') {
    if (onlineIsAuthority()) Net.restartMatchAsAuthority();
    else if (Net.wire) Net.wire.sendEv({ t:'restart-req' });
    return;
  }
  if (G.mode === 'workshop' && Practice.id) startWorkshop(Practice.id);
  else if (G.mode === 'watch') startGame('watch', G.watch); // EXHIBITION: preserve the AI matchup
  else startGame(G.mode, G.difficulty);
}
function quitToMenu() {
  const wasWorkshop = G.mode === 'workshop';
  const workshopTheme = Practice.returnTheme;
  if (G.mode === 'online') Net.leave();
  if (wasWorkshop || Practice.active) Practice.cancel();
  G.state = 'menu'; G.idleT = 0; G.demo = false; G.gwNet = 0; // drop any guest goal-width override
  G.watch = null; // EXHIBITION: clear the AI matchup on quit
  clearCeremony(); G.pausedGoalCeremony = null;
  Replay.reset();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  pointers.clear();
  resetPositions();
  if (wasWorkshop && workshopTheme && THEMES[workshopTheme]) setTheme(workshopTheme, true);
  hideAll(); $('menu').classList.remove('hidden');
  $('topbar').classList.add('hidden');
  G.hintLive = false; // match over - the hint never survives a match end
  refreshRecordLines(); // menu record lines reflect the just-finished match
  refreshTour(); // tour counter + conquered pips reflect the just-finished match
  AudioSys.ui();
}
function hideAll() {
  // Dialog cleanup must be structural, not an allowlist. A newly added modal
  // should never be able to survive because someone forgot to append its ID
  // here (the old Controls overlay exposed exactly that failure mode).
  document.querySelectorAll('.overlay:not([data-persistent-overlay])').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[data-game-chrome]').forEach(el => el.classList.add('hidden'));
}
function $(id) { return document.getElementById(id); }

// demo / attract mode: two club-pro brains rally behind the menu
function demoStep(rdt) {
  if (!G.ai1 || !G.ai2) { G.ai1 = mkBrain(0, 1); G.ai2 = mkBrain(1, 1); }
  const sub = 3, sdt = rdt / sub;
  for (let i = 0; i < sub; i++) {
    aiDrive(G.ai1, sdt, G.m1);
    aiDrive(G.ai2, sdt, G.m2);
    stepPhysics(sdt);
    if (G.state !== 'menu') break;
  }
}
function playStep(rdt) {
  const sub = Math.max(1, Math.ceil(rdt / (1 / SUB_HZ)));
  const sdt = rdt / sub;
  for (let i = 0; i < sub; i++) {
    // player mallets
    if (G.mode === '2p') {
      driveMallet(G.m1, sdt, PLAYER_CAP);
      driveMallet(G.m2, sdt, PLAYER_CAP);
    } else if (G.mode === 'online') {
      // ONLINE: authority-only branch. The authority drives its own mallet;
      // the rival mallet follows the latest remote target regardless of which
      // player currently owns simulation authority.
      const local = onlineLocalMallet();
      if (local) driveMallet(local, sdt, PLAYER_CAP);
      Net.driveRemoteMallet(sdt);
    } else if (G.mode === 'workshop' && Practice.id === 'free') {
      if (controlInputActive(0)) driveMallet(G.m1, sdt, PLAYER_CAP);
      else { G.m1.tx = G.m1.x; G.m1.ty = G.m1.y; driveMallet(G.m1, sdt, PLAYER_CAP); }
      Practice.preparePoint();
    } else if (G.mode === 'watch') {
      // EXHIBITION: both mallets are AI-driven.
      aiDrive(G.ai1, sdt, G.m1);
      aiDrive(G.ai2, sdt, G.m2);
    } else {
      // 1p: every local control path drives the same tx/ty target. Only pin
      // the target when no pointer, hover, keyboard, gamepad or floating-stick
      // source owns this side; otherwise direct mouse hover would stop short
      // of the cursor as soon as pointermove events settle.
      if (controlInputActive(0)) driveMallet(G.m1, sdt, PLAYER_CAP);
      else { G.m1.tx = G.m1.x; G.m1.ty = G.m1.y; driveMallet(G.m1, sdt, PLAYER_CAP); }
      aiDrive(G.ai2, sdt, G.m2);
    }
    stepPhysics(sdt);
    if (G.state !== 'play') break;
  }
}

let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  // Local visual QA freezes the simulation after ui.js composes a deterministic
  // state. Public builds can never enable this: the QA route is localhost-only.
  if (window.__atelierVisualQA?.freeze) { render(); return; }
  // Focus-loss freeze: sim, demo, particles, and the net pump all hold.
  // The DOM veil already covers the last rendered frame, so skip repainting
  // the canvas until focus returns. lastT still updates above, preventing a
  // resume time-jump while avoiding wasted GPU work behind the veil.
  if (G.focusLost) return;
  // Never stop physics or the online pump for a cosmetic impact.
  G.trauma = Math.max(0, G.trauma - rdt * 1.7);
  // juice timers decay every frame, whatever the state
  G.hitFlash = Math.max(0, G.hitFlash - rdt * 3);
  G.roomPulse = Math.max(0, G.roomPulse - rdt * 1.4);
  G.saveT = Math.max(0, G.saveT - rdt);
  G.nearCd = Math.max(0, G.nearCd - rdt);
  G.rallyHudT = Math.max(0, G.rallyHudT - rdt);
  Replay.tickOffer(rdt);
  if (G.missGlow) { G.missGlow.t -= rdt; if (G.missGlow.t <= 0) G.missGlow = null; }
  if (G.rattle) { G.rattle.t -= rdt; if (G.rattle.t <= 0) G.rattle = null; }
  tickBoard(rdt); // scoreboard flip/reel/peg/bulb animation
  switch (G.state) {
    case 'menu':
      // ONLINE: no attract demo while the online lobby is up - mode is
      // 'online' from the moment the lobby opens until the session ends.
      G.idleT += rdt; G.demo = G.idleT > 5 && G.mode !== 'online';
      if (G.demo) {
        if (!G._demoKick) { // serve the demo so the attract screen actually rallies
          G._demoKick = true;
          G.puck.vx = paceServe() * (Math.random() < 0.5 ? 1 : -1); G.puck.vy = rnd(-200, 200);
        }
        demoStep(rdt);
        stallWatch(rdt);
      } else { G._demoKick = false; G.stallT = 0; }
      updateParts(rdt);
      break;
    case 'count':
      updateCount(rdt);
      if (G.mode === '2p') { driveMallet(G.m1, rdt, PLAYER_CAP); driveMallet(G.m2, rdt, PLAYER_CAP); }
      // ONLINE: each side drives only their own mallet during the countdown;
      // the host also folds the guest's input target into m2 so it never
      // snaps when the serve goes live
      else if (G.mode === 'online') {
        if (onlineIsAuthority()) {
          const local = onlineLocalMallet();
          if (local) driveMallet(local, rdt, PLAYER_CAP);
          Net.driveRemoteMallet(rdt);
        } else if (onlineIsPlayer()) {
          const local = onlineLocalMallet();
          if (local) driveMallet(local, rdt, PLAYER_CAP);
        }
      }
      // EXHIBITION / SINGLE-PLAYER: AI mallets hold their reset spots during
      // the countdown - no perceiving, no thinking, no skating. (v24.2: the
      // old code ran aiDrive here, so the AI would drift, pre-aim, and even
      // start its attack decision before the puck was live.)
      else if (G.mode === 'watch') { /* both AI mallets hold */ }
      else { if (pointers.size > 0) driveMallet(G.m1, rdt, PLAYER_CAP); }
      updateParts(rdt);
      break;
    case 'play':
      Replay.record(rdt);
      // ONLINE: the guest does not simulate - the host owns the physics.
      // The guest only drives their own mallet; puck and rival mallet arrive
      // over the wire (dead-reckoned in Net.pump).
      // Cosmetic feedback never changes the live simulation clock.
      if (G.mode === 'online' && onlineIsPlayer() && !onlineIsAuthority()) {
        const local = onlineLocalMallet();
        if (local) driveMallet(local, rdt, PLAYER_CAP);
      }
      else if (G.mode === 'online' && Net.role === 'spectator') { /* snapshots drive the gallery view */ }
      else playStep(rdt);
      updateParts(rdt);
      break;
    case 'replay':
      Replay.update(rdt);
      break;
    case 'goal':
      updateGoal(rdt);
      updateParts(rdt);
      break;
    case 'win':
    case 'pause':
    case 'practiceDone':
      updateParts(rdt * 0.25);
      break;
  }
  Net.pump(rdt); // ONLINE: snapshots out (host), inputs out (guest), dead reckoning
  render();
  if (typeof GifExport !== 'undefined' && GifExport.active) GifExport.capture(t);
  if (typeof WakeSys !== 'undefined') WakeSys.sync();
  if (typeof UpdateSys !== 'undefined') UpdateSys.sync();
}

// ---------- render ----------
function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function easeOutBack(t) { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

/* ---------- the house plaque ----------
 * One visual language for every canvas announcement: a dark warm pill with a
 * gold hairline and letterspaced small caps. Theme-agnostic by design, so it
 * reads identically on all ten rooms, light or dark. Match-point and the
 * rally counter share one slot through this renderer - only one ever draws. */
function drawPlaque(ctx, cx, y, text, opts) {
  opts = opts || {};
  const size = opts.size || 12;
  const track = opts.track == null ? 2 : opts.track;
  const ph = opts.h || 26;
  ctx.save();
  ctx.font = '600 ' + size + 'px ' + THEME.font.body;
  if ('letterSpacing' in ctx) ctx.letterSpacing = track + 'px';
  const tw = ctx.measureText(text).width + (('letterSpacing' in ctx) ? 0 : track * text.length * 0.6);
  const pw = tw + 34;
  const px = cx - pw / 2, py = y - ph / 2;
  ctx.globalAlpha = opts.alpha || 0.94;
  rr(ctx, px, py, pw, ph, ph / 2);
  ctx.fillStyle = 'rgba(12,9,6,0.86)'; ctx.fill();
  ctx.strokeStyle = THEME.gold || '#c9a227'; ctx.lineWidth = 1.25; ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.ink || THEME.gold || '#e9d9a6';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx + track / 2, y + 1);
  ctx.restore();
}

// The flat playfield: table, rails, surface, markings and every effect that
// lives ON the surface (scuffs, trails, flashes, particles). Drawn with an
// affine rink transform - the top-down view draws it straight to the main
// canvas; the 2.5D views stage it on the offscreen canvas and warp it.
function drawTableStaticFlat(c) {
  // table shadow + rails + surface
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 46; c.shadowOffsetY = 22;
  c.fillStyle = '#000';
  rr(c, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); c.fill();
  c.restore();
  THEME.drawRails(c);
  THEME.drawSurface(c);
  THEME.drawMarkings(c);
}

function drawTableFlat(c) {
  drawTableStaticFlat(c);

  // scuffs (permanence)
  for (const sc of G.scuffs) {
    c.save(); c.translate(sc.x, sc.y); c.rotate(sc.ang);
    c.fillStyle = 'rgba(10,8,6,' + sc.a.toFixed(3) + ')';
    c.fillRect(-sc.len / 2, -1.6, sc.len, 3.2);
    c.restore();
  }

  // puck trail
  const tr = G.trail;
  if (tr.length > 1) {
    c.save(); c.lineCap = 'round';
    // neon tables set trailGlow: the streak blooms like a light tube
    if (THEME.trailGlow) { c.shadowColor = THEME.trailGlow; c.shadowBlur = 14; }
    for (let i = 1; i < tr.length; i++) {
      const a = (i / tr.length) * 0.35;
      c.strokeStyle = THEME.trail;
      c.globalAlpha = a;
      c.lineWidth = 2 + (i / tr.length) * 8;
      c.beginPath(); c.moveTo(tr[i - 1].x, tr[i - 1].y); c.lineTo(tr[i].x, tr[i].y); c.stroke();
    }
    c.restore();
  }

  // speed lines: above 1500 the trail alone undersells it - theme-colored
  // streaks stretch back along the velocity vector
  const psp = puckSpeed();
  if (psp > 1500 && Settings.effects !== 'minimal') {
    const nsl = Settings.effects === 'subtle' ? 3 : Math.min(5, 1 + Math.floor((psp - 1500) / 400));
    const va = Math.atan2(G.puck.vy, G.puck.vx);
    const cvx = Math.cos(va), svx = Math.sin(va);
    c.save(); c.lineCap = 'round'; c.strokeStyle = THEME.trail;
    for (let i = 0; i < nsl; i++) {
      const off = (i - (nsl - 1) / 2) * 14;
      const ox = -svx * off, oy = cvx * off;
      const len = psp * (0.05 + i * 0.012);
      c.globalAlpha = Math.max(0.06, 0.28 - i * 0.04);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(G.puck.x - cvx * (PUCK_R + 6) + ox, G.puck.y - svx * (PUCK_R + 6) + oy);
      c.lineTo(G.puck.x - cvx * (PUCK_R + 6 + len) + ox, G.puck.y - svx * (PUCK_R + 6 + len) + oy);
      c.stroke();
    }
    c.restore();
  }

  // goal-frame rattle: a hard frame hit visibly shakes the trim for ~0.4s
  // (fxFlash() gates it for Minimal effects + prefers-reduced-motion; the
  // jitter itself scales with the Shake setting, like trauma shake)
  const freeHit = G.mode === 'workshop' && Practice.active && Practice.id === 'free';
  for (let side = 0; side < 2; side++) {
    if (freeHit && side === 1) continue;
    const gx = side === 0 ? PX : PX + PW;
    let ox = 0, oy = 0;
    if (G.rattle && G.rattle.side === side && fxFlash()) {
      const j = 4.5 * (G.rattle.t / 0.42) * shakeK();
      ox = rnd(-1, 1) * j; oy = rnd(-1, 1) * j;
    }
    c.save(); c.translate(ox, oy);
    THEME.drawGoalTrim(c, side, gx, CY, goalW());
    c.restore();
  }

  if (freeHit) {
    const tx = PX + PW - 54, half = goalW() / 2;
    c.save();
    c.globalAlpha = 0.82;
    c.strokeStyle = THEME.gold || '#d8a93f';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(PX + PW - 3, CY - half); c.lineTo(PX + PW - 3, CY + half); c.stroke();
    for (const r of [22, 44, 68]) {
      c.globalAlpha = r === 22 ? 0.9 : 0.42;
      c.lineWidth = r === 22 ? 3 : 2;
      c.beginPath(); c.arc(tx, CY, r, 0, TAU); c.stroke();
    }
    c.restore();
  }

  // goal-frame flash: the scored-on frame lights up in theme gold
  if (G.goalFrameT > 0 && fxFlash()) {
    const fgx = G.goalSide === 0 ? PX + PW : PX;
    c.save();
    c.globalAlpha = G.goalFrameT * 0.9;
    c.strokeStyle = THEME.gold || '#d8a93f'; c.lineWidth = 5;
    rr(c, fgx - 16, CY - goalW() / 2 - 16, 32, goalW() + 32, 16); c.stroke();
    c.restore();
  }
  // near-miss post glow: the kissed posts smolder briefly
  if (G.missGlow && fxFlash()) {
    const mgx = G.missGlow.side === 0 ? PX : PX + PW;
    c.save();
    c.globalAlpha = clamp(G.missGlow.t / 0.7, 0, 1) * 0.8;
    c.fillStyle = THEME.gold || '#d8a93f';
    for (const sgn of [-1, 1]) {
      c.beginPath(); c.arc(mgx, CY + sgn * goalW() / 2, 10, 0, TAU); c.fill();
    }
    c.restore();
  }
}

// Two renderers share identical world-space wave geometry. No particles,
// world displacement, timer or extra simulation. Curves stay inside the mouth.
function goalWavePaths() {
  if (G.state !== 'goal' || !fxFlash()) return null;
  const wave = Feel.goalWave(G.goalT);
  if (!wave) return null;
  const dir = G.goalSide === 0 ? 1 : -1;
  const gx = dir === 1 ? PX + PW : PX;
  const half = goalW()/2;
  const y = clamp(G.goalShockY, CY-half+wave.span+4, CY+half-wave.span-4);
  const paths = [];
  for (let i=0;i<3;i++) {
    const points = [], span = wave.span * (1-i*0.18);
    for (let j=0;j<=6;j++) {
      const u = j/3 - 1;
      points.push([gx + dir*(Math.max(1,wave.advance-i*7)+12*(1-u*u)), y+u*span]);
    }
    paths.push(points);
  }
  return {paths,alpha:wave.alpha};
}
function drawGoalWaveFlat(c) {
  const w = goalWavePaths();
  if (!w) return;
  c.save(); c.strokeStyle = THEME.gold || '#d8a93f';
  c.lineCap = 'round';
  for(let i=0;i<w.paths.length;i++) {
    c.globalAlpha = w.alpha * (1-i*0.25);
    c.lineWidth = 1.75-i*0.25;
    c.beginPath();
    w.paths[i].forEach(([x,y],j)=>j?c.lineTo(x,y):c.moveTo(x,y));
    c.stroke();
  }
  c.restore();
}

// Surface-bound motion FX: mallet trails, possession ring, particle streaks,
// save pulses, impact flash. Stays with the table in every camera.
function drawFxFlat(c) {
  // mallet motion trails on fast flicks (recorded in driveMallet)
  for (const m of [G.m1, G.m2]) {
    const tr = m.trail;
    for (let i = 0; i < tr.length; i++) {
      const a = (i / tr.length) * 0.30 * fxTrail();
      if (a <= 0.01) continue;
      c.save(); c.globalAlpha = a; c.fillStyle = THEME.trail;
      c.beginPath(); c.arc(tr[i].x, tr[i].y, m.r * (0.35 + 0.55 * i / tr.length), 0, TAU); c.fill();
      c.restore();
    }
    // possession readability: sustained gentle contact (>0.4s) draws a soft
    // ring under the puck - it reads as control, never as a stuck puck
    if (m.glueT > 0.4) {
      const pr = PUCK_R + 12 + Math.sin(perfNow() * 6) * 3;
      c.save(); c.globalAlpha = 0.55; c.strokeStyle = THEME.gold || '#d8a93f';
      c.lineWidth = 3;
      c.beginPath(); c.arc(G.puck.x, G.puck.y, pr, 0, TAU); c.stroke();
      c.restore();
    }
  }

  // particles as motion streaks
  c.save(); c.lineCap = 'round';
  for (const q of PPOOL) {
    if (!q.on) continue;
    const a = clamp(q.life / q.max, 0, 1);
    c.globalAlpha = a;
    c.strokeStyle = q.color;
    c.lineWidth = q.size * a + 0.5;
    c.beginPath();
    c.moveTo(q.x, q.y);
    c.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
    c.stroke();
  }
  c.restore();

  // save-moment ring pulses: a soft expanding ring where the block happened
  for (const q of G.pulses) {
    const k = q.t / 0.6;
    c.save();
    c.globalAlpha = (1 - k) * 0.7;
    c.strokeStyle = THEME.gold || '#d8a93f';
    c.lineWidth = 4 * (1 - k) + 1;
    c.beginPath(); c.arc(q.x, q.y, 30 + k * 90, 0, TAU); c.stroke();
    c.restore();
  }

  // goal flash
  if (G.flashA > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const g = c.createRadialGradient(gx, CY, 10, gx, CY, 420);
    const fc = THEME.flash || 'rgba(216,169,63,1)';
    g.addColorStop(0, fc); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.globalAlpha = G.flashA * 0.55; c.fillStyle = g;
    c.fillRect(gx - 430, CY - 430, 860, 860);
    c.restore();
  }
  drawGoalWaveFlat(c);

  // SMASH-tier impact flash: speed-scaled, short, and warm enough to read
  // as an impact glint without washing the whole table white.
  if (G.hitFlash > 0 && fxFlash()) {
    const r = G.hitFlashR || 160;
    const hg = c.createRadialGradient(G.hitFlashX, G.hitFlashY, 6, G.hitFlashX, G.hitFlashY, r);
    hg.addColorStop(0, 'rgba(255,246,224,' + (0.55 * G.hitFlash).toFixed(3) + ')');
    hg.addColorStop(0.28, hexA(THEME.gold || '#d8a93f', 0.22 * G.hitFlash));
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    c.save(); c.fillStyle = hg;
    c.fillRect(G.hitFlashX - r, G.hitFlashY - r, r * 2, r * 2);
    c.restore();
  }
}

// Floating score texts in flat rink space (top-down only). The 2.5D views
// project these to screen space instead so the type stays readable.
function drawTextsFlat(c) {
  // floating texts (positions flip with the playfield; glyphs stay upright).
  // Two passes: a dark blurred backing for separation on the lightest rooms,
  // then the crisp color face on top - the gold stays gold, no muddy outline.
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    c.font = '800 ' + t.size + 'px ' + THEME.font.display;
    c.fillStyle = 'rgba(15,10,5,0.85)';
    c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 12;
    rinkText(c, t.str, t.x, t.y); // ONLINE: upright type in the mirrored view
    c.shadowBlur = 0;
    c.fillStyle = t.color;
    rinkText(c, t.str, t.x, t.y);
    c.restore();
  }
}

function render() {
  const replaySaved = G.state === 'replay' ? Replay.applyFrame() : null;
  const dpr = view.dpr || 1, w = view.w, h = view.h, s = view.s;
  // the room: pre-rendered on theme change / resize - one drawImage, no shake
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (G.roomCanvas) ctx.drawImage(G.roomCanvas, 0, 0, w, h);
  else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  // room reactivity: a SMASH startles the room - a warm lamp-glow swells and
  // sways gently overhead, always in the theme's own gold
  if (G.roomPulse > 0.01 && fxRoom()) {
    const lx = w / 2 + Math.sin(perfNow() * 2.1) * w * 0.06 * G.roomPulse;
    const rg = ctx.createRadialGradient(lx, h * 0.04, 10, lx, h * 0.04, h * 0.55);
    rg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.20 * G.roomPulse));
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  // Camera branch: top-down keeps the classic affine rink transform; the
  // 2.5D views stage the flat playfield offscreen and warp it through the
  // fitted pinhole camera. Physics, AI and netcode never see the difference.
  if (view.camera !== 'top' && view.cam) render25(w, h);
  else renderTop(w, h);
  if (replaySaved) Replay.restoreFrame(replaySaved);
}

// Classic top-down view: the affine rink transform, byte-identical to the
// pre-2.5D render path.
function renderTop(w, h) {
  const s = view.s;
  // The rink may rotate for portrait, but the score/status HUD never does.
  // Keep every world transform inside this save/restore and render UI after it
  // in CSS-pixel screen space.
  ctx.save();
  const sh = shakeOffset();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (!view.portrait) { ctx.translate(view.ox, view.oy); ctx.scale(s, s); }
  else ctx.transform(0, -s, s, 0, view.ox, view.oy + s * VW);

  ctx.save();
  if (G.letterT > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const z = 1 + 0.10 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.translate(gx, CY); ctx.scale(z, z); ctx.translate(-gx, -CY);
  }
  ctx.save();
  if (G.onlineFlip) { ctx.translate(VW, 0); ctx.scale(-1, 1); }
  drawTableFlat(ctx);
  drawPuck(ctx);
  drawMallet(ctx, G.m1);
  if (!(G.mode === 'workshop' && Practice.id === 'free')) drawMallet(ctx, G.m2);
  drawFxFlat(ctx);
  drawTextsFlat(ctx);
  ctx.restore(); // ONLINE flip
  ctx.restore(); // goal zoom
  ctx.restore(); // rink transform

  renderScreenTail(w, h);
}

function hudStatusText() {
  if (G.demo || (G.state !== 'play' && G.state !== 'count')) return '';
  const target = Settings.firstTo;
  const m0 = G.score[0] === target - 1, m1 = G.score[1] === target - 1;
  if (m0 || m1) {
    if (m0 && m1) return 'NEXT GOAL WINS';
    if (G.mode === '2p') return (m0 ? 'P1' : 'P2') + ' · MATCH POINT';
    if (G.mode === 'online') return (m0 ? onlineSideLabel(0) : onlineSideLabel(1)) + ' · MATCH POINT';
    return sideLabel(m0 ? 0 : 1) + ' · MATCH POINT';
  }
  if (G.state === 'play' && G.rallyHudT > 0 && G.rallyHudN >= 3)
    return 'RALLY · ' + G.rallyHudN;
  return '';
}

// All game modes and camera views share this screen-space score/status layer.
// The scoreboard device still comes from the active room; only its placement
// is standardized so controls, labels, and camera transforms cannot collide.
function drawHudCore(c, w, h) {
  if (G.demo || G.mode === 'workshop') return;
  // On compact devices the controls own the upper-right corner. Center
  // the physical board inside the remaining safe region, not over the pause
  // button or the wider online connection chip.
  const compactBar = w <= 760;
  const rightReserve = compactBar
    ? (G.mode === 'online' ? 104 : 58)
    : (G.mode === 'online' ? 190 : 112);
  const maxHudW = Math.min(440, Math.max(0, w - rightReserve - 16));
  const hs = clamp(Math.min(1, maxHudW / 400), 0.34, 1);
  const hudCenter = Math.min(w * 0.5, w - rightReserve - 8 - 200 * hs);
  const top = Math.max(5, h * 0.008);
  c.save();
  c.translate(hudCenter - CX * hs, top);
  c.scale(hs, hs);
  drawScoreboard(c);
  const status = hudStatusText();
  // Every themed scoreboard fits above ~150 virtual px. y=164 leaves a
  // deliberate breathing gap under even the tallest target plate.
  if (status) drawPlaque(c, CX, 164, status, { size: 11, h: 25, track: 1.5, alpha: 0.92 });
  c.restore();
}

function drawCountdownScreen(c, w, h) {
  if (G.state !== 'count') return;
  const frac = (G.countT % 0.55) / 0.55;
  const label = G.countT < 1.65 ? String(3 - Math.floor(G.countT / 0.55)) : 'GO!';
  const pop = 1 + (1 - frac) * 0.55;
  const fs = clamp(Math.min(w * 0.20, h * 0.16), 54, 120);
  c.save();
  c.globalAlpha = clamp(1.4 - frac, 0, 1);
  c.translate(w * 0.5, h * 0.50); c.scale(pop, pop);
  c.font = '800 ' + fs.toFixed(1) + 'px ' + THEME.font.display;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = THEME.ink;
  c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 24;
  c.fillText(label, 0, 0);
  c.restore();
}

function drawGoalTextScreen(c, w, h) {
  if (G.letterT <= 0) return;
  const yours = goalIsYours(G.goalSide);
  const gold = THEME.gold || '#d8a93f';
  const ink = THEME.ink || '#f4ead3';
  const sub = getComputedStyle(document.documentElement).getPropertyValue('--sub').trim() || '#aa9a78';
  const t = clamp(G.goalT / 1.65, 0, 1);
  const alpha = clamp((G.letterT - 0.08) * 2.7, 0, 1) * clamp((1.12 - t) * 4.2, 0.35, 1);
  // Context changes the arrival rhythm a little, not the gameplay clock.
  const specialFinish = G.goalContext &&
    ['rocket','long-rally','comeback','winning'].includes(G.goalContext.kind);
  const titlePop = PRM.reduce ? 1 : 1 + (easeOutBack(clamp(G.letterT * (specialFinish ? 1.55 : 1.35), 0, 1)) - 1) *
    (specialFinish ? 1.08 : 1);
  const scorePop = PRM.reduce ? 1 : 0.94 + 0.06 * easeOutBack(clamp((G.goalT - 0.12) * 2.9, 0, 1));
  // Short landscape has a permanent scoreboard + rule plaque across the
  // upper band. Keep the cinematic beat below that chrome instead of letting
  // YOU SCORE / GOAL compete with it. Portrait and roomy screens are unchanged.
  const compactLandscape = w / Math.max(1, h) > 1.55 && h < 520;
  const cy = h * (compactLandscape ? 0.61 : 0.50);
  const panelW = Math.min(w * 0.82, 720);
  const panelH = compactLandscape
    ? clamp(h * 0.30, 112, 152)
    : clamp(h * 0.34, 126, 250);
  const left = (w - panelW) * 0.5, top = cy - panelH * 0.5;

  c.save();
  c.globalAlpha = alpha;

  // A cinematic wash makes the beat legible without replacing the table
  // with a modal card. Your goals get more light; conceded goals stay quiet.
  const wash = c.createRadialGradient(w * 0.5, cy, 0, w * 0.5, cy, Math.max(w, h) * 0.55);
  wash.addColorStop(0, yours ? 'rgba(8,7,5,.22)' : 'rgba(8,7,5,.34)');
  wash.addColorStop(1, 'rgba(4,3,3,.04)');
  c.fillStyle = wash; c.fillRect(0, 0, w, h);

  const lineA = yours ? 0.78 : 0.40;
  c.strokeStyle = hexA(gold, lineA); c.lineWidth = 1;
  c.beginPath(); c.moveTo(left, top); c.lineTo(left + panelW, top);
  c.moveTo(left, top + panelH); c.lineTo(left + panelW, top + panelH); c.stroke();

  if (!PRM.reduce && yours) {
    const sweep = easeOutCubic(clamp(G.goalT * 2.6, 0, 1));
    const tick = panelW * 0.11 * sweep;
    c.globalAlpha = alpha * (0.25 + 0.55 * (1 - clamp((G.goalT - 0.25) * 1.4, 0, 1)));
    c.strokeStyle = hexA(gold, 0.88); c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const yy = cy + (i - 1) * panelH * 0.17;
      c.beginPath();
      c.moveTo(left - 8 - tick, yy); c.lineTo(left - 8, yy);
      c.moveTo(left + panelW + 8, yy); c.lineTo(left + panelW + 8 + tick, yy);
      c.stroke();
    }
    c.globalAlpha = alpha;
  }

  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowColor = 'rgba(0,0,0,.62)'; c.shadowBlur = 18;

  const kickerY = top + panelH * 0.16;
  c.fillStyle = yours ? gold : sub;
  c.font = '700 ' + clamp(panelH * 0.075, 10, 16).toFixed(1) + 'px ' + THEME.font.body;
  c.fillText(G.goalScorerLabel || 'GOAL', w * 0.5, kickerY);

  const fs = clamp(Math.min(w * 0.15, panelH * 0.42), 44, 98);
  c.save();
  c.translate(w * 0.5, top + panelH * 0.42); c.scale(titlePop, titlePop);
  c.font = '800 ' + fs.toFixed(1) + 'px ' + THEME.font.display;
  c.lineWidth = Math.max(3, fs * 0.065);
  c.strokeStyle = 'rgba(0,0,0,.58)';
  c.strokeText('GOAL', 0, 0);
  c.fillStyle = yours ? gold : ink;
  c.fillText('GOAL', 0, 0);
  c.restore();

  // Score slam: the number that actually changed gets a short, earned punch.
  // It reads instantly without adding a redundant "+1" banner.
  const scoreY = top + panelH * 0.67;
  const scoreFs = clamp(panelH * 0.20, 24, 48);
  const scorerKick = PRM.reduce ? 1 : 1 + 0.14 * (1 - easeOutCubic(clamp((G.goalT - 0.08) * 2.5, 0, 1)));
  const scoreGap = clamp(panelW * 0.075, 36, 58);
  c.save();
  c.translate(w * 0.5, scoreY); c.scale(scorePop, scorePop);
  c.shadowBlur = 10;
  c.font = '800 ' + scoreFs.toFixed(1) + 'px ' + THEME.font.display;
  c.fillStyle = sub; c.fillText(':', 0, 0);
  for (let side = 0; side < 2; side++) {
    const sx = side === 0 ? -scoreGap : scoreGap;
    c.save(); c.translate(sx, 0);
    if (side === G.goalSide) c.scale(scorerKick, scorerKick);
    c.fillStyle = side === G.goalSide ? (yours ? gold : ink) : ink;
    c.fillText(String(G.score[side]), 0, 0);
    c.restore();
  }
  c.restore();

  const detail = [G.goalMomentLabel, G.goalSpeedKmh ? G.goalSpeedKmh + ' KM/H' : ''].filter(Boolean).join('  ·  ');
  if (detail) {
    c.shadowBlur = 0;
    c.fillStyle = G.goalMomentLabel ? (yours ? gold : ink) : sub;
    c.font = '700 ' + clamp(panelH * 0.060, 9, 13).toFixed(1) + 'px ' + THEME.font.body;
    c.fillText(detail, w * 0.5, top + panelH * (G.goalRewardLabel ? 0.82 : 0.88));
  }

  if (G.goalRewardLabel) {
    c.shadowBlur = 0;
    const rewardFs = clamp(panelH * 0.055, 8.5, 12);
    c.font = '800 ' + rewardFs.toFixed(1) + 'px ' + THEME.font.body;
    const rewardW = Math.min(panelW * 0.58, c.measureText(G.goalRewardLabel).width + 28);
    const rewardH = clamp(panelH * 0.105, 16, 24);
    const rewardY = top + panelH * 0.92;
    c.fillStyle = hexA(gold, yours ? 0.13 : 0.08);
    c.fillRect(w * 0.5 - rewardW * 0.5, rewardY - rewardH * 0.5, rewardW, rewardH);
    c.strokeStyle = hexA(gold, yours ? 0.62 : 0.32); c.lineWidth = 1;
    c.strokeRect(w * 0.5 - rewardW * 0.5 + 0.5, rewardY - rewardH * 0.5 + 0.5, rewardW - 1, rewardH - 1);
    c.fillStyle = yours ? gold : ink;
    c.fillText(G.goalRewardLabel, w * 0.5, rewardY + 0.5);
  }
  c.restore();
}

function renderScreenTail(w, h) {
  // Vignette belongs to the room, not the HUD. Draw it first so the score and
  // status text remain crisp on every light/dark table.
  const vg = ctx.createRadialGradient(w * 0.5, h * 0.52, h * 0.28, w * 0.5, h * 0.52, h * 0.82);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, THEME.vignette || 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);

  if (G.state === 'menu') {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, w, h);
  }

  drawGoalTextScreen(ctx, w, h);
  drawCountdownScreen(ctx, w, h);
  drawHudCore(ctx, w, h);
}
function renderTail(w, h) { renderScreenTail(w, h); }
function renderTail25(w, h) { renderScreenTail(w, h); }

// ---------- 2.5D view ----------
// The playfield is staged flat on the offscreen canvas (affine only, so all
// ten themes render untouched), then warped through the fitted pinhole
// camera strip by strip. Objects with real height - puck, mallet handles,
// the table body - are drawn in true perspective on top, far to near.
function render25(w, h) {
  const cam = view.cam;
  if (!cam) { renderTop(w, h); return; } // fitted camera missing: safe fallback
  // The table (surface, rails, markings, skirt) is pre-warped once per camera
  // fit into warpCanvas - one drawImage per frame. Only the dynamic FX, puck
  // and mallets are drawn per frame, in true perspective.
  if (!warpCanvas) paintTableWarp();
  // trauma shake in screen space - same language as the top-down view,
  // applied to the whole scene at once
  const sh = shakeOffset();
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (warpCanvas) ctx.drawImage(warpCanvas, 0, 0, w, h);
  drawDynTable25(cam);
  drawFx25(cam);
  drawObjects25(cam);
  drawTexts25(cam);
  ctx.restore();
  renderTail25(w, h);
}

// The table gets a real body: near and side faces extruded below the surface
// so the tabletop reads as a physical object, not a projected poster.
// Baked into the pre-warped table canvas (static per camera fit).
function drawTableSkirt25(g, cam) {
  const T = 46; // body thickness in rink units
  const quad = (pts, fill) => {
    const q = pts.map(([x, y, z]) => camProject(cam, x, y, z));
    if (q.some(p => !p)) return;
    g.beginPath();
    g.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i].x, q[i].y);
    g.closePath();
    g.fillStyle = fill; g.fill();
  };
  // side faces first (darker), near face last (catches the room light)
  quad([[TX0, TY0, 0], [TX1, TY0, 0], [TX1, TY0, -T], [TX0, TY0, -T]], '#0a0a0d');
  quad([[TX0, TY1, 0], [TX1, TY1, 0], [TX1, TY1, -T], [TX0, TY1, -T]], '#0a0a0d');
  quad([[TX0, TY0, 0], [TX0, TY1, 0], [TX0, TY1, -T], [TX0, TY0, -T]], '#121216');
}

// Pre-warped 2.5D table: the surface, rails, markings and skirt are static
// per theme, so the perspective warp runs once per camera fit (resize,
// camera switch, theme change, online flip) into a screen-space canvas.
// Each frame then costs a single drawImage. The trauma shake applies on top
// of the pre-warped image, exactly as it did when the warp ran per frame.
let warpCanvas = null;
function paintTableWarp() {
  if (view.camera === 'top' || !view.cam || !view.w || !view.h) { warpCanvas = null; return; }
  // flat playfield -> offscreen staging (identity transform: the staging
  // canvas is exactly rink resolution, so rink coords map 1:1 to source px)
  const pfx = pfStage();
  pfx.setTransform(1, 0, 0, 1, 0, 0);
  pfx.clearRect(0, 0, VW, VH);
  drawTableStaticFlat(pfx);
  const dpr = view.dpr || 1, w = view.w, h = view.h;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * dpr));
  c.height = Math.max(2, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  drawTableSkirt25(g, view.cam);
  warpPlayfield25(g, view.cam);
  warpCanvas = c;
}

// Warp an arbitrary rink rect [x0,x1]x[y0,y1] from a source canvas through
// the camera. (sx,sy) is the source-canvas px offset of rink (x0,y0): the
// full-table staging canvas is 1:1 with rink coords (offset 0,0); small
// transient canvases (goal trim) carry their own offset.
function warpRect25(g, cam, src, ox, oy, x0, x1, y0, y1) {
  const dy = y1 - y0;
  const bounds = [x0];
  const stack = [[x0, x1]];
  let guard = 0;
  while (stack.length && guard++ < 20000) {
    const [a, b] = stack.pop();
    if (b - a < 0.5 || triErr25(cam, a, b, y0, y1) < 0.5) bounds.push(b);
    else { const m = (a + b) / 2; stack.push([m, b]); stack.push([a, m]); }
  }
  bounds.sort((p, q) => p - q);
  const tops = [], bots = [];
  for (const x of bounds) {
    const t = camProject(cam, x, y0, 0), bo = camProject(cam, x, y1, 0);
    if (!t || !bo) return; // unreachable: the fit keeps every corner in front
    tops.push(t); bots.push(bo);
  }
  for (let i = 0; i + 1 < bounds.length; i++) {
    const sx0 = bounds[i], sx1 = bounds[i + 1], dx = sx1 - sx0;
    const T0 = tops[i], T1 = tops[i + 1], B0 = bots[i], B1 = bots[i + 1];
    triBlit25(g, src, ox, oy, [[sx0, y0], [sx1, y0], [sx1, y1]],
              [[T0.x, T0.y], [T1.x, T1.y], [B1.x, B1.y]], sx0, y0, dx, dy);
    triBlit25(g, src, ox, oy, [[sx0, y0], [sx1, y1], [sx0, y1]],
              [[T0.x, T0.y], [B1.x, B1.y], [B0.x, B0.y]], sx0, y0, dx, dy);
  }
}

function warpPlayfield25(g, cam) {
  warpRect25(g, cam, pfCanvas, 0, 0, TX0, TX1, TY0, TY1);
}

// Draw one source triangle through the affine its three true projected
// corners determine, clipped to the destination triangle. The strip's full
// source rect is drawn (it covers the triangle); the clip cuts the excess.
// Source px = rink coords minus the (ox,oy) canvas offset.
function triBlit25(g, src, ox, oy, sTri, dTri, sx, sy, sw, sh) {
  const A = triAffine25(sTri, dTri);
  if (!A) return;
  const [[d0x, d0y], [d1x, d1y], [d2x, d2y]] = dTri;
  g.save();
  g.beginPath();
  g.moveTo(d0x, d0y); g.lineTo(d1x, d1y); g.lineTo(d2x, d2y);
  g.closePath(); g.clip();
  g.transform(A[0], A[1], A[2], A[3], A[4], A[5]);
  g.drawImage(src, sx - ox, sy - oy, sw, sh, sx, sy, sw, sh);
  g.restore();
}

// Affine from three source points to three screen points, as
// [m11, m12, m21, m22, ex, ey] for ctx.transform. Pure math - unit-testable.
function triAffine25(sTri, dTri) {
  const [[s0x, s0y], [s1x, s1y], [s2x, s2y]] = sTri;
  const [[d0x, d0y], [d1x, d1y], [d2x, d2y]] = dTri;
  const a11 = s1x - s0x, a12 = s1y - s0y, a21 = s2x - s0x, a22 = s2y - s0y;
  const det = a11 * a22 - a12 * a21;
  if (!det) return null;
  const i11 = a22 / det, i12 = -a12 / det, i21 = -a21 / det, i22 = a11 / det;
  const b11 = d1x - d0x, b12 = d1y - d0y, b21 = d2x - d0x, b22 = d2y - d0y;
  const m11 = b11 * i11 + b21 * i12, m21 = b11 * i21 + b21 * i22;
  const m12 = b12 * i11 + b22 * i12, m22 = b12 * i21 + b22 * i22;
  return [m11, m12, m21, m22,
    d0x - (m11 * s0x + m21 * s0y), d0y - (m12 * s0x + m22 * s0y)];
}

// Worst-case screen-space error of the two-triangle warp over a strip:
// sample interior points and compare the affine prediction against the
// true projection. Pure math - unit-testable.
function triErr25(cam, sx0, sx1, y0, y1) {
  const A = camProject(cam, sx0, y0, 0), B = camProject(cam, sx1, y0, 0);
  const C = camProject(cam, sx0, y1, 0), D = camProject(cam, sx1, y1, 0);
  if (!A || !B || !C || !D) return 1e9;
  const f1 = triAffine25([[sx0, y0], [sx1, y0], [sx1, y1]],
                         [[A.x, A.y], [B.x, B.y], [D.x, D.y]]);
  const f2 = triAffine25([[sx0, y0], [sx1, y1], [sx0, y1]],
                         [[A.x, A.y], [D.x, D.y], [C.x, C.y]]);
  if (!f1 || !f2) return 1e9;
  const proj = (f, x, y) => [f[0] * x + f[2] * y + f[4], f[1] * x + f[3] * y + f[5]];
  let worst = 0;
  const dx = sx1 - sx0, dy = y1 - y0;
  const pts = [[0.5, 0.004], [0.5, 0.996], [0.25, 0.5], [0.75, 0.5], [0.5, 0.5]];
  for (const [u, v] of pts) {
    const x = sx0 + dx * u, y = y0 + dy * v;
    const t = camProject(cam, x, y, 0);
    if (!t) return 1e9;
    // triangle 1 covers the region below the (sx0,y0)-(sx1,y1) diagonal
    const f = v < u ? f1 : f2;
    const [px, py] = proj(f, x, y);
    const e = Math.hypot(px - t.x, py - t.y);
    if (e > worst) worst = e;
  }
  return worst;
}

// Screen-space ellipse for a circle of radius r on the table plane at
// (x, y, z). The camera never rolls, so table-y maps (unforeshortened) to
// screen-x and table-x (depth) maps to screen-y: each axis gets its own
// true local scale instead of a fudge factor.
function tableEll25(cam, x, y, z, r) {
  const p0 = camProject(cam, x, y, z);
  if (!p0) return null;
  const px = camProject(cam, x + r, y, z), py = camProject(cam, x, y + r, z);
  if (!px || !py) return null;
  return { x: p0.x, y: p0.y, rx: Math.abs(py.x - p0.x), ry: Math.abs(px.y - p0.y), s: p0.s };
}

function drawShadow25(cam, x, y, r) {
  const e = tableEll25(cam, x, y, 0, r);
  if (!e) return;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU);
  ctx.fill();
}

// Puck and mallets, drawn far-to-near in true perspective.
function drawObjects25(cam) {
  const p = G.puck;
  const freeHit = G.mode === 'workshop' && Practice.id === 'free';
  drawShadow25(cam, p.x + 10, p.y + 14, PUCK_R * 1.05);
  drawShadow25(cam, G.m1.x + 8, G.m1.y + 12, G.m1.r);
  if (!freeHit) drawShadow25(cam, G.m2.x + 8, G.m2.y + 12, G.m2.r);
  const items = [
    { z: camProject(cam, p.x, p.y, 0), f: () => drawPuck25(cam) },
    { z: camProject(cam, G.m1.x, G.m1.y, 0), f: () => drawMallet25(cam, G.m1) },
    ...(freeHit ? [] : [{ z: camProject(cam, G.m2.x, G.m2.y, 0), f: () => drawMallet25(cam, G.m2) }]),
  ];
  // painter's order: far (large zc) first. A missing projection sorts last.
  items.sort((u, v) => (v.z ? v.z.zc : -1) - (u.z ? u.z.zc : -1));
  for (const it of items) it.f();
}

const PUCK_H25 = 20;   // puck thickness in rink units
const HANDLE_H25 = 48; // compact air-hockey grip height in rink units

// The puck as a short cylinder: dark wall, theme-dressed top, spin cue.
function drawPuck25(cam) {
  const p = G.puck, S = THEME.puck;
  const base = tableEll25(cam, p.x, p.y, 0, PUCK_R);
  const top = tableEll25(cam, p.x, p.y, PUCK_H25, PUCK_R);
  if (!base || !top) return;
  // wall
  ctx.fillStyle = S.edge;
  ctx.beginPath();
  ctx.ellipse(base.x, base.y, base.rx, base.ry, 0, 0, TAU);
  ctx.fill();
  // top face
  const rx = top.rx, ry = top.ry;
  if (S.glow) { ctx.save(); ctx.shadowColor = S.glow; ctx.shadowBlur = 26; }
  const g = ctx.createRadialGradient(top.x - rx * 0.2, top.y - ry * 0.25, 2, top.x, top.y, rx);
  g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(top.x, top.y, rx, ry, 0, 0, TAU); ctx.fill();
  if (S.glow) ctx.restore();
  ctx.lineWidth = Math.max(1.2, 2.5 * top.s);
  ctx.strokeStyle = S.ring; ctx.stroke();
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(top.x - rx * 0.2, top.y - ry * 0.28, rx * 0.18, ry * 0.12, -0.5, 0, TAU);
  ctx.fill();
  // save-moment halo after a goal-line block
  if (G.saveT > 0 && fxFlash()) {
    const sg = ctx.createRadialGradient(top.x, top.y, rx * 0.5, top.x, top.y, rx * 2.2);
    sg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.5 * (G.saveT / 0.55)));
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(top.x, top.y, rx * 2.2, 0, TAU); ctx.fill();
  }
  // spin cue: the theme-gold dot rides the puck's rotation
  if (Math.abs(p.w || 0) > 2.5) {
    const da = p.ang || 0;
    const dp = camProject(cam, p.x + Math.cos(da) * PUCK_R * 0.55, p.y + Math.sin(da) * PUCK_R * 0.55, PUCK_H25);
    if (dp) {
      ctx.save();
      ctx.globalAlpha = 0.85; ctx.fillStyle = THEME.gold || '#d8a93f';
      ctx.beginPath(); ctx.arc(dp.x, dp.y, Math.max(2, 4.5 * top.s), 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

// Goal body language is render-only: the AI conceder gives ground for one
// beat, then settles back. Personality changes the size of that response,
// never the physical mallet position, hitbox, or AI target.
function goalRivalRenderPose(m) {
  const base = { x:m.x, y:m.y };
  if (G.state !== 'goal' || G.goalSide === m.side || PRM.reduce || Settings.effects === 'minimal')
    return base;

  let diffIdx = -1;
  if (G.mode === 'ai' && m.side === 1) diffIdx = G.difficulty;
  else if (G.mode === 'watch' && G.watch) diffIdx = m.side === 0 ? G.watch.a : G.watch.b;
  if (diffIdx < 0) return base;

  const u = clamp(G.goalT / 1.05, 0, 1);
  const pulse = Math.sin(Math.PI * u);
  const fx = Settings.effects === 'subtle' ? 0.6 : 1;
  const retreat = [48, 28, 14][clamp(diffIdx, 0, 2)] * pulse * fx;
  const towardOwnGoal = m.side === 0 ? -1 : 1;
  return { x:m.x + towardOwnGoal * retreat, y:m.y };
}

// The mallet as a physical striker: theme-dressed base disc plus a standing
// wooden handle with a knob, like a real air hockey mallet.
function drawMallet25(cam, m) {
  const S = THEME.mallet, r = m.r, pose = goalRivalRenderPose(m);
  const base = tableEll25(cam, pose.x, pose.y, 0, r);
  const neck = tableEll25(cam, pose.x, pose.y, 18, r * 0.34);
  const cap = tableEll25(cam, pose.x, pose.y, HANDLE_H25, r * 0.24);
  if (!base || !neck || !cap) return;

  const g = ctx.createRadialGradient(base.x - base.rx * 0.3, base.y - base.ry * 0.35, base.rx * 0.1, base.x, base.y, base.rx);
  g.addColorStop(0, S.hi); g.addColorStop(0.6, S.base); g.addColorStop(1, S.edge);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(base.x, base.y, base.rx, base.ry, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1.5, 3 * base.s);
  ctx.strokeStyle = S.ring; ctx.stroke();

  const dg = ctx.createRadialGradient(base.x - base.rx * 0.13, base.y - base.ry * 0.17, 2, base.x, base.y, base.rx * 0.62);
  dg.addColorStop(0, S.dishHi); dg.addColorStop(1, S.dish);
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.ellipse(base.x, base.y, base.rx * 0.62, base.ry * 0.62, 0, 0, TAU); ctx.fill();

  // A real air-hockey pusher has a short molded grip. The old tall post
  // became a long visual obstruction in the low Surface camera.
  ctx.fillStyle = S.knob || S.edge;
  ctx.beginPath();
  ctx.moveTo(neck.x - neck.rx, neck.y);
  ctx.lineTo(cap.x - cap.rx, cap.y);
  ctx.lineTo(cap.x + cap.rx, cap.y);
  ctx.lineTo(neck.x + neck.rx, neck.y);
  ctx.closePath(); ctx.fill();

  const kg = ctx.createRadialGradient(cap.x - cap.rx * 0.28, cap.y - cap.ry * 0.3, 1, cap.x, cap.y, cap.rx * 1.2);
  kg.addColorStop(0, S.knobHi || S.hi); kg.addColorStop(1, S.knob || S.edge);
  ctx.fillStyle = kg;
  ctx.beginPath(); ctx.ellipse(cap.x, cap.y, cap.rx * 1.15, Math.max(2, cap.ry * 1.15), 0, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1, 1.6 * cap.s); ctx.strokeStyle = S.ring; ctx.stroke();
}

// Project the same brief room-bound reflection into the elevated cameras.
function drawGoalWave25(cam) {
  const w = goalWavePaths();
  if (!w) return;
  ctx.save(); ctx.strokeStyle = THEME.gold || '#d8a93f'; ctx.lineCap = 'round';
  for(let i=0;i<w.paths.length;i++) {
    const projected = w.paths[i].map(([x,y])=>camProject(cam,x,y,0));
    if(projected.some(p=>!p))continue;
    ctx.globalAlpha = w.alpha * (1-i*0.25);
    ctx.lineWidth = Math.max(0.7, (1.75-i*0.25)*projected[3].s);
    ctx.beginPath();
    projected.forEach((p,j)=>j?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.stroke();
  }
  ctx.restore();
}
function drawGoalPocket25(cam, side) {
  const frontX = side === 0 ? PX : PX + PW;
  const backX = frontX + (side === 0 ? -72 : 72);
  const half = goalW() / 2;
  const pts = [
    camProject(cam, frontX, CY - half, 0),
    camProject(cam, backX, CY - half, -14),
    camProject(cam, backX, CY + half, -14),
    camProject(cam, frontX, CY + half, 0),
  ];
  if (pts.some(p => !p)) return;
  ctx.save();
  ctx.fillStyle = 'rgba(4,4,7,0.76)';
  ctx.strokeStyle = THEME.gold || '#d8a93f';
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(1, 2 * (pts[0].s + pts[3].s) / 2);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.42; ctx.stroke();
  ctx.restore();
}

function drawPracticeTarget25(cam) {
  const tx = PX + PW - 54, half = goalW() / 2;
  const top = camProject(cam, PX + PW - 3, CY - half, 0);
  const bot = camProject(cam, PX + PW - 3, CY + half, 0);
  if (top && bot) {
    ctx.save();
    ctx.globalAlpha = 0.82; ctx.strokeStyle = THEME.gold || '#d8a93f';
    ctx.lineWidth = Math.max(1, 3 * (top.s + bot.s) / 2);
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
    ctx.restore();
  }
  for (const r of [22, 44, 68]) {
    const e = tableEll25(cam, tx, CY, 0, r);
    if (!e) continue;
    ctx.save();
    ctx.globalAlpha = r === 22 ? 0.9 : 0.42;
    ctx.strokeStyle = THEME.gold || '#d8a93f';
    ctx.lineWidth = Math.max(1, (r === 22 ? 3 : 2) * e.s);
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

// Table-bound dynamics in the 2.5D view: everything drawTableFlat draws
// per frame on top of the static table (scuffs, trail, speed lines, goal
// trim, frame flash, post glow), projected to true depth. The static table
// itself lives pre-warped in warpCanvas.
function drawDynTable25(cam) {
  // scuffs (permanence): short dark streaks, projected as thick segments
  for (const sc of G.scuffs) {
    const ca = Math.cos(sc.ang), sa = Math.sin(sc.ang);
    const p0 = camProject(cam, sc.x - ca * sc.len / 2, sc.y - sa * sc.len / 2, 0);
    const p1 = camProject(cam, sc.x + ca * sc.len / 2, sc.y + sa * sc.len / 2, 0);
    if (!p0 || !p1) continue;
    ctx.save();
    ctx.globalAlpha = sc.a;
    ctx.strokeStyle = 'rgb(10,8,6)';
    ctx.lineWidth = Math.max(0.6, 3.2 * (p0.s + p1.s) / 2);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    ctx.restore();
  }
  // puck trail
  const tr = G.trail;
  if (tr.length > 1) {
    ctx.save(); ctx.lineCap = 'round';
    if (THEME.trailGlow) { ctx.shadowColor = THEME.trailGlow; ctx.shadowBlur = 14; }
    ctx.strokeStyle = THEME.trail;
    for (let i = 1; i < tr.length; i++) {
      const p0 = camProject(cam, tr[i - 1].x, tr[i - 1].y, 0);
      const p1 = camProject(cam, tr[i].x, tr[i].y, 0);
      if (!p0 || !p1) continue;
      ctx.globalAlpha = (i / tr.length) * 0.35;
      ctx.lineWidth = Math.max(0.6, (2 + (i / tr.length) * 8) * (p0.s + p1.s) / 2);
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    ctx.restore();
  }
  // speed lines above 1500: theme-colored streaks back along the velocity
  if (G.puck) {
    const psp = puckSpeed();
    if (psp > 1500 && Settings.effects !== 'minimal') {
      const nsl = Settings.effects === 'subtle' ? 3 : Math.min(5, 1 + Math.floor((psp - 1500) / 400));
      const va = Math.atan2(G.puck.vy, G.puck.vx);
      const cvx = Math.cos(va), svx = Math.sin(va);
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = THEME.trail;
      for (let i = 0; i < nsl; i++) {
        const off = (i - (nsl - 1) / 2) * 14;
        const ox = -svx * off, oy = cvx * off;
        const len = psp * (0.05 + i * 0.012);
        const p0 = camProject(cam, G.puck.x - cvx * (PUCK_R + 6) + ox, G.puck.y - svx * (PUCK_R + 6) + oy, 0);
        const p1 = camProject(cam, G.puck.x - cvx * (PUCK_R + 6 + len) + ox, G.puck.y - svx * (PUCK_R + 6 + len) + oy, 0);
        if (!p0 || !p1) continue;
        ctx.globalAlpha = Math.max(0.06, 0.28 - i * 0.04);
        ctx.lineWidth = Math.max(0.6, 3 * (p0.s + p1.s) / 2);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.restore();
    }
  }
  // Recessed goal pockets keep both mouths legible in low-angle views.
  const freeHit = G.mode === 'workshop' && Practice.active && Practice.id === 'free';
  for (let side = 0; side < 2; side++) {
    if (freeHit && side === 1) continue;
    drawGoalPocket25(cam, side);
  }
  // Theme trim remains on top so every room keeps its identity.
  for (let side = 0; side < 2; side++) {
    if (freeHit && side === 1) continue;
    drawTrim25(cam, side);
  }
  if (freeHit) drawPracticeTarget25(cam);
  drawGoalWave25(cam);
  // goal-frame flash: the scored-on frame lights up in theme gold
  if (G.goalFrameT > 0 && fxFlash()) {
    const fgx = G.goalSide === 0 ? PX + PW : PX, gw = goalW();
    const c = [[fgx - 16, CY - gw / 2 - 16], [fgx + 16, CY - gw / 2 - 16],
               [fgx + 16, CY + gw / 2 + 16], [fgx - 16, CY + gw / 2 + 16]]
      .map(([x, y]) => camProject(cam, x, y, 0));
    if (!c.some(p => !p)) {
      ctx.save();
      ctx.globalAlpha = G.goalFrameT * 0.9;
      ctx.strokeStyle = THEME.gold || '#d8a93f';
      ctx.lineWidth = Math.max(1, 5 * (c[0].s + c[2].s) / 2);
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
  }
  // near-miss post glow: the kissed posts smolder briefly
  if (G.missGlow && fxFlash()) {
    const mgx = G.missGlow.side === 0 ? PX : PX + PW;
    ctx.save();
    ctx.globalAlpha = clamp(G.missGlow.t / 0.7, 0, 1) * 0.8;
    ctx.fillStyle = THEME.gold || '#d8a93f';
    for (const sgn of [-1, 1]) {
      const e = tableEll25(cam, mgx, CY + sgn * goalW() / 2, 0, 10);
      if (!e) continue;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// One goal mouth's trim in the 2.5D view: the theme draws its trim art into
// a small rink-space canvas (with the rattle jitter when active), which is
// then warped through the camera - the theme's identity survives intact.
let trimCanvas = null;
function drawTrim25(cam, side) {
  const gx = side === 0 ? PX : PX + PW, gw = goalW();
  const pad = 40, rx0 = gx - pad, ry0 = CY - gw / 2 - pad;
  const TW = pad * 2, TH = Math.ceil(gw + pad * 2);
  if (!trimCanvas || trimCanvas.width !== TW || trimCanvas.height !== TH) {
    trimCanvas = document.createElement('canvas');
    trimCanvas.width = TW; trimCanvas.height = TH;
  }
  let ox = 0, oy = 0;
  if (G.rattle && G.rattle.side === side && fxFlash()) {
    const j = 4.5 * (G.rattle.t / 0.42) * shakeK();
    ox = rnd(-1, 1) * j; oy = rnd(-1, 1) * j;
  }
  const tc = trimCanvas.getContext('2d');
  tc.setTransform(1, 0, 0, 1, 0, 0);
  tc.clearRect(0, 0, TW, TH);
  tc.save(); tc.translate(-rx0 + ox, -ry0 + oy);
  THEME.drawGoalTrim(tc, side, gx, CY, gw);
  tc.restore();
  warpRect25(ctx, cam, trimCanvas, rx0, ry0, rx0, rx0 + TW, ry0, ry0 + TH);
}

// Dynamic FX in the 2.5D view: the same elements as the flat FX layer
// (trails, rings, particles, pulses, flashes), each projected to its true
// depth instead of being baked into the warped table. Per-element
// projection is exact for small primitives and costs a few camProjects.
function drawFx25(cam) {
  const ell = (x, y, r, style, alpha, lw) => {
    const e = tableEll25(cam, x, y, 0, r);
    if (!e) return;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, Math.max(0.5, e.rx), Math.max(0.5, e.ry), 0, 0, TAU);
    if (lw) { ctx.strokeStyle = style; ctx.lineWidth = Math.max(0.75, lw * e.s); ctx.stroke(); }
    else { ctx.fillStyle = style; ctx.fill(); }
    ctx.restore();
  };
  // mallet motion trails on fast flicks (recorded in driveMallet)
  for (const m of [G.m1, G.m2]) {
    const tr = m.trail;
    for (let i = 0; i < tr.length; i++) {
      const a = (i / tr.length) * 0.30 * fxTrail();
      if (a <= 0.01) continue;
      ell(tr[i].x, tr[i].y, m.r * (0.35 + 0.55 * i / tr.length), THEME.trail, a);
    }
    // possession readability: sustained gentle contact (>0.4s) draws a soft
    // ring under the puck - it reads as control, never as a stuck puck
    if (m.glueT > 0.4) {
      const pr = PUCK_R + 12 + Math.sin(perfNow() * 6) * 3;
      ell(G.puck.x, G.puck.y, pr, THEME.gold || '#d8a93f', 0.55, 3);
    }
  }
  // particles as motion streaks
  ctx.save(); ctx.lineCap = 'round';
  for (const q of PPOOL) {
    if (!q.on) continue;
    const a = clamp(q.life / q.max, 0, 1);
    const p0 = camProject(cam, q.x, q.y, 0);
    const p1 = camProject(cam, q.x - q.vx * 0.035, q.y - q.vy * 0.035, 0);
    if (!p0 || !p1) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = q.color;
    ctx.lineWidth = Math.max(0.5, (q.size * a + 0.5) * (p0.s + p1.s) / 2);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.restore();
  // save-moment ring pulses: a soft expanding ring where the block happened
  for (const q of G.pulses) {
    const k = q.t / 0.6;
    ell(q.x, q.y, 30 + k * 90, THEME.gold || '#d8a93f', (1 - k) * 0.7, 4 * (1 - k) + 1);
  }
  // goal flash + SMASH impact flash: radial blooms projected onto the table
  const flash = (x, y, r, color, alpha) => {
    const e = tableEll25(cam, x, y, 0, r);
    if (!e || alpha <= 0.01) return;
    const gr = ctx.createRadialGradient(e.x, e.y, e.rx * 0.05, e.x, e.y, e.rx);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = gr;
    ctx.fillRect(e.x - e.rx, e.y - e.ry, e.rx * 2, e.ry * 2);
    ctx.restore();
  };
  if (G.flashA > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    flash(gx, CY, 420, THEME.flash || 'rgba(216,169,63,1)', G.flashA * 0.55);
  }
  if (G.hitFlash > 0 && fxFlash()) {
    flash(G.hitFlashX, G.hitFlashY, G.hitFlashR || 160,
      'rgba(255,246,224,' + (0.55 * G.hitFlash).toFixed(3) + ')', 1);
  }
}

// Countdown in the 2.5D view: the same pop language as the top-down view,
// placed on the table in true perspective so it sits in the scene.
function drawCountdown25(cam) {
  if (G.state !== 'count') return;
  const frac = (G.countT % 0.55) / 0.55;
  const label = G.countT < 1.65 ? String(3 - Math.floor(G.countT / 0.55)) : 'GO!';
  const pop = 1 + (1 - frac) * 0.55;
  const p = camProject(cam, CX, CY - 40, 120);
  if (!p) return;
  const minPx = view.camera === 'surface' ? 46 : 40;
  const fontPx = clamp(120 * p.s * pop, minPx, 118);
  ctx.save();
  ctx.globalAlpha = clamp(1.4 - frac, 0, 1);
  ctx.font = '800 ' + fontPx.toFixed(1) + 'px ' + THEME.font.display;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = THEME.ink;
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24;
  ctx.fillText(label, p.x, p.y);
  ctx.restore();
}

// Floating texts projected to screen space so the type stays upright and
// readable at any camera angle, sized by the local depth scale.
function drawTexts25(cam) {
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    const p = camProject(cam, t.x, t.y, 50);
    if (!p) continue;
    const minPx = view.camera === 'surface' ? 17 : 14;
    const size = clamp(t.size * p.s * 1.08, minPx, 64);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = '800 ' + size.toFixed(1) + 'px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.5, size * 0.085);
    ctx.strokeStyle = 'rgba(7,5,4,0.72)';
    ctx.shadowColor = 'rgba(0,0,0,0.68)'; ctx.shadowBlur = Math.max(8, size * 0.28);
    ctx.strokeText(t.str, p.x, p.y);
    ctx.shadowBlur = 0;
    ctx.fillStyle = t.color;
    ctx.fillText(t.str, p.x, p.y);
    ctx.restore();
  }
}


function drawPuck(c) {
  const p = G.puck, S = THEME.puck;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath(); c.ellipse(p.x + 5, p.y + 8, PUCK_R, PUCK_R * 0.92, 0, 0, TAU); c.fill();
  c.translate(p.x, p.y);
  // save-moment glow: the puck holds a brief halo after a goal-line block
  if (G.saveT > 0 && fxFlash()) {
    const sg = c.createRadialGradient(0, 0, PUCK_R * 0.5, 0, 0, PUCK_R * 2.2);
    sg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.5 * (G.saveT / 0.55)));
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sg;
    c.beginPath(); c.arc(0, 0, PUCK_R * 2.2, 0, TAU); c.fill();
  }
  // velocity stretch: continuous from cruise (~600 u/s), proportional to
  // speed - subtle at a glide, pronounced on a real shot. Elongates along
  // the travel vector with a volume-preserving pinch across it. Pauses while
  // an impact squash is still springing back, so the two never fight.
  const psp = hyp(p.vx, p.vy);
  if (psp > 600 && G.puckSq > 0.96) {
    const va = Math.atan2(p.vy, p.vx), st = clamp((psp - 600) / 3200, 0, 1) * 0.22;
    c.rotate(va); c.scale(1 + st, 1 / (1 + st)); c.rotate(-va);
  }
  c.rotate(G.puckSqA);
  const sq = G.puckSq;
  c.scale(sq, 1 / sq); // volume-preserving: the bulge matches the squash
  // neon tables set puck.glow: a light-tube halo around the puck body
  if (S.glow) { c.shadowColor = S.glow; c.shadowBlur = 26; }
  const g = c.createRadialGradient(-5, -6, 2, 0, 0, PUCK_R);
  g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, PUCK_R, 0, TAU); c.fill();
  c.shadowBlur = 0;
  c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.ellipse(-5, -7, 4.5, 3, -0.5, 0, TAU); c.fill();
  c.restore();
  // spin cue: a small theme-gold dot rides the puck's rotation when it
  // carries english - the Magnus curve becomes readable before it bends
  if (Math.abs(p.w || 0) > 2.5) {
    const da = p.ang || 0;
    c.save();
    c.fillStyle = THEME.gold || '#d8a93f'; c.globalAlpha = 0.85;
    c.beginPath(); c.arc(p.x + Math.cos(da) * PUCK_R * 0.55, p.y + Math.sin(da) * PUCK_R * 0.55, 4.5, 0, TAU); c.fill();
    c.restore();
  }
}

function drawMallet(c, m) {
  const S = THEME.mallet, r = m.r, pose = goalRivalRenderPose(m);
  c.save();
  // shadow (drawn in world space, unaffected by squash so it doesn't swim)
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(pose.x + 6, pose.y + 10, r, r * 0.9, 0, 0, TAU); c.fill();
  c.translate(pose.x, pose.y);
  // squash/stretch: a fast-driven mallet leans into its own travel
  // (exaggeration/appeal), and a strike compresses it along the contact
  // normal for a couple frames before springing back (recoil) - same
  // visual language as the puck's deformation for a consistent feel.
  const msp = hyp(m.vx, m.vy);
  if (msp > 900 && m.hitSq > 0.97) {
    const ma = Math.atan2(m.vy, m.vx), st = clamp((msp - 900) / 3300, 0, 1) * 0.16;
    c.rotate(ma); c.scale(1 + st, 1 - 0.5 * st); c.rotate(-ma);
  }
  const sq = m.hitSq;
  if (sq < 0.999) {
    c.rotate(m.hitSqA); c.scale(sq, 1 + (1 - sq) * 0.6); c.rotate(-m.hitSqA);
  }
  // body
  const g = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, S.hi); g.addColorStop(0.6, S.base); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  c.lineWidth = 3; c.strokeStyle = S.ring; c.stroke();
  // dish
  const dg = c.createRadialGradient(-6, -8, 2, 0, 0, r * 0.62);
  dg.addColorStop(0, S.dishHi); dg.addColorStop(1, S.dish);
  c.fillStyle = dg;
  c.beginPath(); c.arc(0, 0, r * 0.62, 0, TAU); c.fill();
  // knob
  const kg = c.createRadialGradient(-4, -5, 1, 0, 0, r * 0.30);
  kg.addColorStop(0, S.knobHi); kg.addColorStop(1, S.knob);
  c.fillStyle = kg;
  c.beginPath(); c.arc(0, 0, r * 0.30, 0, TAU); c.fill();
  c.restore();
}
