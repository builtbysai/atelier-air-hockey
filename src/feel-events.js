/* Game Feel V3: pure, presentation-only classification. No physics or DOM state. */
'use strict';
const Feel = Object.freeze({
  defaults: Object.freeze({
    minNormalSpeed: 1000,
    minMalletDrive: 700,
    minOutgoingSpeed: 1200,
    minDriveAlignment: 0.78,
    maxGlanceRatio: 0.48,
    minReturnDistance: 165,
    minReturnGapMs: 120,
  }),
  perfectStrike(impact, cfg = this.defaults) {
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
  meaningfulReturn(next, previous, cfg = this.defaults) {
    if (!next || !Number.isInteger(next.side) || next.side < 0 || next.side > 1) return false;
    if (!previous || previous.side === -1) return true;
    if (previous.side === next.side) return false;
    const coords = [next.x, next.y, next.ms, previous.x, previous.y, previous.ms];
    if (!coords.every(Number.isFinite)) return false;
    if (next.ms - previous.ms < cfg.minReturnGapMs) return false;
    return Math.hypot(next.x - previous.x, next.y - previous.y) >= cfg.minReturnDistance;
  },
  rallyIntensity(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, (n - 3) / 9));
  },
  goalRelease(n) {
    // A 15+ return finish gets at most twelve percent more ceremony energy.
    return Math.max(0, Math.min(0.12, (Number.isFinite(n) ? n - 6 : 0) * 0.014));
  },
});
