import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/feel-events.js', import.meta.url), 'utf8');
const Feel = runInNewContext(source + '\nFeel;', {});

const clean = { normalSpeed: 1420, malletDrive: 1080, malletSpeed: 1130,
  tangentialSpeed: 180, outgoingSpeed: 1860 };
test('clean, aligned drive is recognized without requiring straight-to-goal direction', () => {
  assert.equal(Feel.perfectStrike(clean), true);
});
test('glancing or slow strikes are not perfect', () => {
  assert.equal(Feel.perfectStrike({ ...clean, tangentialSpeed: 900 }), false);
  assert.equal(Feel.perfectStrike({ ...clean, malletDrive: 450 }), false);
  assert.equal(Feel.perfectStrike({ ...clean, malletSpeed: 1700 }), false);
  assert.equal(Feel.perfectStrike({ ...clean, outgoingSpeed: 850 }), false);
});
test('save, assisted escape and missing data never earn a perfect strike', () => {
  assert.equal(Feel.perfectStrike({ ...clean, save:true }), false);
  assert.equal(Feel.perfectStrike({ ...clean, assisted:true }), false);
  assert.equal(Feel.perfectStrike({ ...clean, tangentialSpeed:NaN }), false);
  assert.equal(Feel.perfectStrike(null), false);
});
test('alternating touches require space and time; same-side dribbles are ignored', () => {
  const first = { side:0, x:320, y:420, ms:1000 };
  assert.equal(Feel.meaningfulReturn(first, {side:-1}), true);
  assert.equal(Feel.meaningfulReturn({side:0,x:1000,y:420,ms:2000},first),false);
  assert.equal(Feel.meaningfulReturn({side:1,x:360,y:420,ms:2000},first),false);
  assert.equal(Feel.meaningfulReturn({side:1,x:1000,y:420,ms:1050},first),false);
  assert.equal(Feel.meaningfulReturn({side:1,x:1000,y:420,ms:1260},first),true);
});
test('rally curve is capped and neutral for early play', () => {
  assert.equal(Feel.rallyIntensity(0),0);
  assert.equal(Feel.rallyIntensity(3),0);
  assert.equal(Feel.rallyIntensity(7),4/9);
  assert.equal(Feel.rallyIntensity(12),1);
  assert.equal(Feel.rallyIntensity(100),1);
});
test('long-rally release is subtle, capped and immune to invalid values', () => {
  assert.equal(Feel.goalRelease(2),0);
  assert.ok(Feel.goalRelease(15)>Feel.goalRelease(8));
  assert.equal(Feel.goalRelease(50),0.12);
  assert.equal(Feel.goalRelease(NaN),0);
});

test('bounded live tuning updates strike detection without modifying shipped defaults', () => {
  assert.equal(Feel.tune('minNormalSpeed', 1700), true);
  const clean = { normalSpeed:1420, malletDrive:1080, malletSpeed:1130,
    tangentialSpeed:180, outgoingSpeed:1860 };
  assert.equal(Feel.perfectStrike(clean), false);
  assert.equal(Feel.defaults.minNormalSpeed, 1000);
  assert.equal(Feel.tune('minNormalSpeed', 999999), true);
  assert.equal(Feel.tuning.minNormalSpeed, 1700);
  assert.equal(Feel.tune('notASetting', 10), false);
  assert.equal(Feel.tune('minNormalSpeed', NaN), false);
  Feel.reset();
  assert.equal(Feel.perfectStrike(clean), true);
});
test('preset capture, validated imports and reset are transient and safe', () => {
  Feel.tune('rallyStart', 5);
  Feel.tune('goalReleaseCap', 0.09);
  const saved = Feel.preset();
  Feel.reset();
  assert.equal(Feel.goalRelease(15), 0.12);
  assert.equal(Feel.applyPreset(saved), true);
  assert.equal(Feel.rallyIntensity(5), 0);
  assert.equal(Feel.goalRelease(15), 0.09);
  assert.equal(Feel.applyPreset({ rallyStart:NaN }), false);
  assert.equal(Feel.applyPreset({ __proto__:null, unknown:100 }), false);
  Feel.reset();
  assert.equal(Feel.goalRelease(15), 0.12);
});
