/* Game Feel V3: pure classification + bounded, transient tuning.
 * Only the opt-in Feel Lab changes `tuning`; no settings migration or
 * gameplay state is stored here. Nothing in Feel may mutate physics.
 */
'use strict';
const FEEL_DEFAULTS = Object.freeze({
  minNormalSpeed: 1000, minMalletDrive: 700, minOutgoingSpeed: 1200,
  minDriveAlignment: 0.78, maxGlanceRatio: 0.48,
  minReturnDistance: 165, minReturnGapMs: 120,
  perfectFlashEnergy: 0.16, perfectCrackGain: 0.28, perfectHapticMs: 7,
  rallyStart: 3, rallySpan: 9, rallyTrailLift: 0.25,
  rallyMusicLift: 0.045, rallyPitchLift: 0.10,
  goalReleaseCap: 0.12,
});
// Bounds are deliberately conservative: the lab should teach feel without
// turning accessibility or audio safety into arbitrary editable values.
const FEEL_BOUNDS = Object.freeze({
  minNormalSpeed: [700, 1700], minMalletDrive: [450, 1200],
  minOutgoingSpeed: [800, 2000], minDriveAlignment: [0.55, 0.95],
  maxGlanceRatio: [0.2, 0.9], minReturnDistance: [95, 290],
  minReturnGapMs: [80, 260],
  perfectFlashEnergy: [0.06, 0.22], perfectCrackGain: [0.12, 0.36],
  perfectHapticMs: [0, 12], rallyStart: [2, 6],
  rallySpan: [5, 15], rallyTrailLift: [0, 0.35],
  rallyMusicLift: [0, 0.06], rallyPitchLift: [0, 0.15],
  goalReleaseCap: [0, 0.15],
});
const Feel = Object.freeze({
  defaults: FEEL_DEFAULTS,
  bounds: FEEL_BOUNDS,
  tuning: { ...FEEL_DEFAULTS },
  tune(key, value) {
    if (!Object.prototype.hasOwnProperty.call(FEEL_BOUNDS, key) || !Number.isFinite(value)) return false;
    const [lo, hi] = FEEL_BOUNDS[key];
    this.tuning[key] = Math.max(lo, Math.min(hi, value));
    return true;
  },
  reset() {
    Object.assign(this.tuning, FEEL_DEFAULTS);
  },
  preset() {
    // Copy-only snapshot; never trust imported presets as unbounded params.
    return { ...this.tuning };
  },
  applyPreset(preset) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return false;
    const entries = Object.entries(preset);
    if (!entries.length || entries.some(([k, v]) =>
      !Object.prototype.hasOwnProperty.call(FEEL_BOUNDS, k) || !Number.isFinite(v))) return false;
    for (const [key, value] of entries) this.tune(key, value);
    return true;
  },
  perfectStrike(impact, cfg = this.tuning) {
    if (!impact || impact.assisted || impact.save) return false;
    const fields = ['normalSpeed', 'malletDrive', 'malletSpeed', 'tangentialSpeed', 'outgoingSpeed'];
    if (!fields.every(key => Number.isFinite(impact[key]))) return false;
    if (impact.malletSpeed <= 0 || impact.normalSpeed <= 0) return false;
    return impact.normalSpeed >= cfg.minNormalSpeed &&
      impact.malletDrive >= cfg.minMalletDrive &&
      impact.outgoingSpeed >= cfg.minOutgoingSpeed &&
      impact.malletDrive / impact.malletSpeed >= cfg.minDriveAlignment &&
      Math.abs(impact.tangentialSpeed) / impact.normalSpeed <= cfg.maxGlanceRatio;
  },
  meaningfulReturn(next, previous, cfg = this.tuning) {
    if (!next || !Number.isInteger(next.side) || next.side < 0 || next.side > 1) return false;
    if (!previous || previous.side === -1) return true;
    if (previous.side === next.side) return false;
    const coords = [next.x, next.y, next.ms, previous.x, previous.y, previous.ms];
    if (!coords.every(Number.isFinite)) return false;
    if (next.ms - previous.ms < cfg.minReturnGapMs) return false;
    return Math.hypot(next.x - previous.x, next.y - previous.y) >= cfg.minReturnDistance;
  },
  rallyIntensity(n, cfg = this.tuning) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, (n - cfg.rallyStart) / cfg.rallySpan));
  },
  goalRelease(n, cfg = this.tuning) {
    return Math.max(0, Math.min(cfg.goalReleaseCap, (Number.isFinite(n) ? n - 6 : 0) * 0.014));
  },

  // Authority-owned presentation only. OWN GOAL and ANGLE require stronger
  // touch/trajectory evidence; do not infer them from lastTouch alone.
  goalContext(facts) {
    const f=facts||{}, score=Array.isArray(f.score)&&f.score.length===2?f.score:[0,0];
    const scorer=f.scorer===1?1:0, target=Number.isInteger(f.target)&&f.target>=2?f.target:7;
    const rally=Number.isInteger(f.rally)?Math.max(0,Math.min(99,f.rally)):0;
    const speed=Number.isFinite(f.speedKmh)?Math.max(0,Math.min(199,Math.round(f.speedKmh))):0;
    const p=f.prevScore;
    const comeback=!!(f.erasedDeficit&&Array.isArray(p)&&p.length===2&&p[scorer]<p[1-scorer]&&score[scorer]>=score[1-scorer]);
    const winning=score[scorer]>=target, matchPoint=!winning&&score[scorer]===target-1;
    const craft=f.bankShot?'bank':rally>=12?'long-rally':speed>=22?'rocket':'';
    const kind=winning?'winning':comeback?'comeback':matchPoint?'match-point':craft||'goal';
    return Object.freeze({kind,craft,rally,speed});
  },
  validGoalContext(c,score,scorer,target) {
    if (!c||typeof c!=='object'||Array.isArray(c))return false;
    if (!['winning','comeback','match-point','bank','long-rally','rocket','goal'].includes(c.kind)||
      !['','bank','long-rally','rocket'].includes(c.craft)||
      !Number.isInteger(c.rally)||c.rally<0||c.rally>99||
      !Number.isInteger(c.speed)||c.speed<0||c.speed>199)return false;
    if (['bank','long-rally','rocket'].includes(c.kind)&&c.craft!==c.kind)return false;
    if (!Array.isArray(score)||score.length!==2||![0,1].includes(scorer)||
      !Number.isInteger(target)||target<2)return false;
    if (c.kind==='winning'&&score[scorer]<target)return false;
    if (c.kind==='match-point'&&(score[scorer]!==target-1||score[scorer]>=target))return false;
    if (c.kind==='comeback'&&score[scorer]<score[1-scorer])return false;
    return true;
  },
  craftLabel(c) {
    if (!c)return '';
    if (c.craft==='bank')return 'BANK SHOT';
    if (c.craft==='long-rally')return 'RALLY FINISH · '+c.rally;
    if (c.craft==='rocket')return 'ROCKET · '+c.speed+' KM/H';
    return '';
  },
  // A render-only wave: within the first 170ms it travels into the scored
  // goal. Tiny opacity and a fixed particle-free profile protect readability.
  goalWave(t) {
    if (!Number.isFinite(t) || t < 0 || t >= 0.17) return null;
    const p = t / 0.17;
    const ease = 1 - (1-p)*(1-p);
    return Object.freeze({
      advance: 4 + 48 * ease,
      span: 16 + 23 * ease,
      alpha: 0.27 * Math.pow(1-p, 1.5),
    });
  },
});
