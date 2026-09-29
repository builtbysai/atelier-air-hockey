import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NET_TEST_PHYSICS } from './helpers/net-test-physics.mjs';

const raw = await readFile(
  new URL('./fixtures/online-v2-lag-compensation.json', import.meta.url),
  'utf8'
);
const spec = JSON.parse(raw);

const REQUIRED_REASONS = new Set([
  'accepted',
  'malformed',
  'duplicate-or-replay',
  'missing-history',
  'stale',
  'input-lead',
  'point-state',
  'side-bounds',
  'velocity',
  'geometry',
  'separating',
  'superseded',
  'unsafe-transition',
]);

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

test('lag compensation hint packet layout is exact and contiguous', () => {
  assert.deepEqual(
    {
      type: spec.packet.type,
      version: spec.packet.version,
      byteLength: spec.packet.byteLength,
      littleEndian: spec.packet.littleEndian,
    },
    { type:4, version:1, byteLength:22, littleEndian:true }
  );

  let nextOffset = 0;
  for (const field of spec.packet.fields) {
    assert.equal(field.offset, nextOffset, 'packet field gap/overlap at ' + field.name);
    assert.ok(field.size === 1 || field.size === 2 || field.size === 4);
    assert.ok(['u8','u16','f32'].includes(field.kind));
    nextOffset += field.size;
  }
  assert.equal(nextOffset, spec.packet.byteLength);
  assert.deepEqual(
    spec.packet.fields.map(field => field.name),
    ['type','version','inputSeq','stateSeq','malletX','malletY','malletVx','malletVy']
  );
});

test('lag compensation contract fixture has stable policy bounds', () => {
  assert.equal(spec.version, 1);
  assert.equal(spec.policy.maxRewindMs, 180);
  assert.equal(spec.policy.maxInputLead, 32);
  assert.equal(spec.policy.contactTolerance, 12);
  assert.equal(spec.policy.speedTolerance, 1.10);
  assert.equal(spec.policy.railGuard, NET_TEST_PHYSICS.PUCK_R * 2);
});

test('lag compensation guest bounds match production table geometry', async () => {
  const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
  const match = source.match(
    /const\s+PX\s*=\s*([0-9.]+),\s*PY\s*=\s*([0-9.]+),\s*PW\s*=\s*([0-9.]+),\s*PH\s*=\s*([0-9.]+)/
  );
  assert.ok(match, 'could not read production table geometry');
  const [, pxRaw, pyRaw, pwRaw, phRaw] = match;
  const PX = Number(pxRaw), PY = Number(pyRaw), PW = Number(pwRaw), PH = Number(phRaw);
  const CX = PX + PW / 2;
  assert.deepEqual(spec.policy.guestBounds, {
    xMin: CX + 8,
    xMax: PX + PW - NET_TEST_PHYSICS.MALLET_R,
    yMin: PY + NET_TEST_PHYSICS.MALLET_R,
    yMax: PY + PH - NET_TEST_PHYSICS.MALLET_R,
  });
});

test('lag compensation contract cases are unique and cover every rejection gate', () => {
  const ids = new Set();
  const reasons = new Set();

  for (const item of spec.cases) {
    assert.equal(typeof item.id, 'string');
    assert.ok(item.id.length > 0);
    assert.equal(ids.has(item.id), false, 'duplicate fixture id ' + item.id);
    ids.add(item.id);

    assert.ok(item.expected === 'accept' || item.expected === 'reject');
    assert.ok(REQUIRED_REASONS.has(item.reason), 'unknown reason ' + item.reason);
    reasons.add(item.reason);

    assert.ok(Number.isInteger(item.hint.inputSeq) && item.hint.inputSeq >= 0 && item.hint.inputSeq <= 0xffff);
    assert.ok(Number.isInteger(item.hint.stateSeq) && item.hint.stateSeq >= 0 && item.hint.stateSeq <= 0xffff);

    if (item.reason === 'malformed') {
      assert.equal(item.hint.malletVx, null);
    } else {
      for (const key of ['malletX','malletY','malletVx','malletVy']) {
        assert.ok(finite(item.hint[key]), item.id + ': non-finite ' + key);
      }
    }

    if (item.history !== null) {
      assert.equal(item.history.seq, item.hint.stateSeq, item.id + ': history must be keyed by referenced state sequence');
      for (const key of ['timeMs','puckX','puckY','puckVx','puckVy','puckW']) {
        assert.ok(finite(item.history[key]), item.id + ': non-finite history ' + key);
      }
    }

    if (item.trajectory !== undefined) {
      assert.ok(Array.isArray(item.trajectory) && item.trajectory.length >= 2,
        item.id + ': trajectory must contain at least two authoritative samples');
      assert.equal(item.trajectory[0].seq, item.hint.stateSeq,
        item.id + ': trajectory must begin at the guest-referenced state');
      assert.equal(item.trajectory[0].timeMs, item.history.timeMs);
      let priorTime = -Infinity;
      for (const sample of item.trajectory) {
        assert.ok(sample.timeMs >= priorTime, item.id + ': trajectory time must be monotonic');
        priorTime = sample.timeMs;
        assert.equal(sample.pointSerial, item.history.pointSerial);
        assert.equal(sample.touchSerial, item.history.touchSerial);
        assert.equal(sample.state, 'play');
        for (const key of ['puckX','puckY','puckVx','puckVy','puckW']) {
          assert.ok(finite(sample[key]), item.id + ': non-finite trajectory ' + key);
        }
      }
    }

    if (item.expected === 'accept') assert.equal(item.reason, 'accepted');
    else assert.notEqual(item.reason, 'accepted');
  }

  for (const reason of REQUIRED_REASONS) {
    assert.ok(reasons.has(reason), 'missing contract fixture for ' + reason);
  }

  const lostInputAccept = spec.cases.find(item =>
    item.expected === 'accept' && item.matchingInputArrived === false
  );
  assert.ok(lostInputAccept, 'contract must prove a self-contained hint can survive matching input loss');

  const wrapAccept = spec.cases.find(item => item.id === 'valid-wraparound-sequences');
  assert.equal(wrapAccept.expected, 'accept');
  assert.ok(wrapAccept.lastInputSeq > wrapAccept.hint.inputSeq,
    'accepted wraparound fixture must cross the ordinary integer boundary');

  const wrapReplay = spec.cases.find(item => item.id === 'wraparound-replay');
  assert.equal(wrapReplay.reason, 'duplicate-or-replay');
  assert.ok(wrapReplay.hint.inputSeq > wrapReplay.lastHintSeq,
    'replay fixture must look newer under ordinary integer comparison');

  const extrapolatedContact = spec.cases.find(item => item.id === 'valid-contact-after-referenced-state');
  assert.equal(extrapolatedContact.expected, 'accept');
  const rawDistance = Math.hypot(
    extrapolatedContact.history.puckX - extrapolatedContact.hint.malletX,
    extrapolatedContact.history.puckY - extrapolatedContact.hint.malletY
  );
  assert.ok(rawDistance > NET_TEST_PHYSICS.PUCK_R + NET_TEST_PHYSICS.MALLET_R + spec.policy.contactTolerance,
    'trajectory fixture must prove raw referenced-snapshot overlap is insufficient');
});
