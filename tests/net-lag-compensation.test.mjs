// Production host lag compensation: shared solver, history ring, serials,
// warm-up/reset, 22-byte hint codec, the nine-gate validator (driven by the
// SAME data fixtures as the contract test) and velocity-first application.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NET_TEST_PHYSICS } from './helpers/net-test-physics.mjs';

const spec = JSON.parse(await readFile(new URL('./fixtures/online-v2-lag-compensation.json', import.meta.url), 'utf8'));
const netSource = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');

async function loadWorld() {
  const clock = { now: 1000 };
  const feedback = [];
  const classList = { add() {}, remove() {}, toggle() {}, contains: () => true };
  const G = {
    state: 'play', mode: 'online',
    puck: { x: 800, y: 520, vx: 500, vy: 0, w: 0, r: 26 },
    m1: { x: 400, y: 520, tx: 400, ty: 520, vx: 0, vy: 0, r: 46, side: 0 },
    m2: { x: 900, y: 520, tx: 900, ty: 520, vx: 0, vy: 0, r: 46, side: 1 },
    score: [0, 0], stats: { topSpeed: 0, bestRally: 0, saves: [0, 0] }, trail: [], scuffs: [], texts: [],
  };
  const context = vm.createContext({
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView, Set,
    setTimeout, clearTimeout, performance: { now: () => clock.now }, G,
    Settings: { firstTo: 7 }, THEME: { id: 'deco' }, THEMES: { deco: {} }, PACES: { classic: {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    PX: 200, PY: 200, PW: 1040, PH: 640, CX: 720, CY: 520,
    ...NET_TEST_PHYSICS,
    goalW: () => 200,
    onCompensatedContact: (...args) => feedback.push(args),
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    $: () => ({ classList, textContent: '', disabled: false }),
    clearCeremony() {}, freshBoard: () => ({}), resetPositions() {}, hideAll() {}, fitCamera() {}, paintTableWarp() {},
    freshStats: () => ({ topSpeed: 0, bestRally: 0, saves: [0, 0] }), pointers: { clear() {} },
  });
  vm.runInContext(netSource + '\nthis.__Net = Net; this.__solve = solveMalletImpulse;', context, { filename: 'src/net.js' });
  const Net = context.__Net;
  Net.active = true; Net.role = 'host'; Net.side = 0; Net.authoritySide = 0; Net.authorityEpoch = 1;
  Net.peerId = 'rival';
  Net.logErr = () => {};
  Net.saveSessionCheckpoint = () => true;
  return { Net, G, clock, feedback, solve: context.__solve };
}

// Publish n authoritative samples, ~16.7 ms apart. Returns their sequences.
function publish(Net, clock, n = 1) {
  const out = [];
  for (let i = 0; i < n; i++) { clock.now += 16.7; out.push(Net.sequencedSnapshot().seq); }
  return out;
}

// A straight-line puck in play: publishes `n` samples moving +dx per sample.
// dx is units per ~16.7 ms sample; 50 keeps the puck at 3000 u/s, under production PUCK_MAX.
function flyPuck(Net, G, clock, { x = 700, y = 520, vx = 900, dx = 50, n = 3 } = {}) {
  const seqs = [];
  for (let i = 0; i < n; i++) {
    G.puck.x = x + dx * i; G.puck.y = y; G.puck.vx = vx; G.puck.vy = 0;
    seqs.push(publish(Net, clock)[0]);
  }
  G.puck.x = x + dx * n; // live puck one step beyond the newest sample
  clock.now += 16.7;
  return seqs;
}

const mallet = { malletX: 865, malletY: 520, malletVx: -1200, malletVy: 0 };
const packet = (Net, h) => Net.encodeHitHint(h);

// ------------------------------------------------------------------ solver ----
test('the mallet/puck normal-contact impulse exists exactly once and everything shares it', () => {
  assert.equal((netSource.match(/mvn \* SMACK_BONUS/g) || []).length, 1, 'one smack-bonus impulse in net.js');
  assert.equal((gameSource.match(/SMACK_BONUS/g) || []).length, 1, 'game.js only declares the constant');
  assert.match(gameSource, /malletImpulseVelocity\(\{/, 'authoritative collideMallet uses the shared solver');
  assert.match(gameSource, /limitMalletRebound\(/);
  assert.match(gameSource, /malletSpinDelta\(/);
  assert.doesNotMatch(gameSource, /lerp\(0\.35, 0\.92/, 'no private restitution curve in game.js');
  assert.equal((netSource.match(/0\.35 \+ \(0\.92 - 0\.35\)/g) || []).length, 1, 'restitution curve exists once');
  // guest prediction and host compensation both call solveMalletImpulse
  assert.match(netSource, /const hit = solveMalletImpulse\(\{\s*puckVx: gv\.pvx/);
  assert.match(netSource, /const hit = solveMalletImpulse\(\{\s*puckVx: contact\.puckVx/);
});

test('solver matches the original inline collideMallet formula across random contacts', async () => {
  const { solve } = await loadWorld();
  const { PUCK_MAX, SMACK_BONUS } = NET_TEST_PHYSICS;
  const reference = (s) => { // verbatim original game.js normal-contact branch
    const vn = (s.puckVx - s.malletVx) * s.nx + (s.puckVy - s.malletVy) * s.ny;
    if (vn >= 0) return null;
    const msp0 = Math.hypot(s.malletVx, s.malletVy);
    const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const e = lerp(0.35, 0.92, clamp(msp0 / 1200, 0, 1));
    let j = -(1 + e) * vn;
    const mvn = s.malletVx * s.nx + s.malletVy * s.ny;
    if (mvn > 0) j += mvn * SMACK_BONUS;
    let vx = s.puckVx + s.nx * j, vy = s.puckVy + s.ny * j;
    if (Math.hypot(vx, vy) < 250 && msp0 > 800) { vx = s.nx * 250; vy = s.ny * 250; }
    const nsp = Math.hypot(vx, vy);
    if (nsp > PUCK_MAX) { vx *= PUCK_MAX / nsp; vy *= PUCK_MAX / nsp; }
    const spin = ((s.malletVx - vx) * -s.ny + (s.malletVy - vy) * s.nx) / 260;
    return { vx, vy, spin };
  };
  let seed = 0xC0FFEE, checked = 0, separating = 0;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 4000; i++) {
    const a = rnd() * Math.PI * 2;
    const s = {
      puckVx: (rnd() - 0.5) * 6000, puckVy: (rnd() - 0.5) * 6000,
      malletVx: (rnd() - 0.5) * 8000, malletVy: (rnd() - 0.5) * 8000,
      nx: Math.cos(a), ny: Math.sin(a),
    };
    const want = reference(s), got = solve(s);
    if (!want) { assert.equal(got, null); separating++; continue; }
    assert.deepEqual([got.vx, got.vy, got.spin], [want.vx, want.vy, want.spin]);
    assert.ok(Math.hypot(got.vx, got.vy) <= PUCK_MAX + 1e-9);
    checked++;
  }
  assert.ok(checked > 500 && separating > 500, 'both branches exercised');
});

// ------------------------------------------------------------------- codec ----
test('type-4 contact hint is exactly 22 bytes, little-endian, and additive', async () => {
  const { Net } = await loadWorld();
  const h = { inputSeq: 0xBEEF, stateSeq: 0x1234, malletX: 865.5, malletY: 520.25, malletVx: -1200.5, malletVy: 33.75 };
  const buf = Net.encodeHitHint(h);
  assert.equal(buf.byteLength, spec.packet.byteLength);
  const v = new DataView(buf);
  for (const f of spec.packet.fields) {
    const got = f.kind === 'u8' ? v.getUint8(f.offset) : f.kind === 'u16' ? v.getUint16(f.offset, true) : v.getFloat32(f.offset, true);
    const want = { type: 4, version: 1, ...h }[f.name];
    assert.equal(got, want, f.name);
  }
  assert.deepEqual({ ...Net.decodeHitHint(v) }, h);
  assert.equal(Net.decodeHitHint(new DataView(new ArrayBuffer(21))), null, 'wrong length');
  const wrongVersion = new DataView(Net.encodeHitHint(h)); wrongVersion.setUint8(1, 2);
  assert.equal(Net.decodeHitHint(wrongVersion), null, 'wrong version');
  // existing layouts are untouched
  assert.equal(Net.encodeRealtimeState().byteLength, 56);
  assert.equal(Net.encodeRealtimeInput(1, 2).byteLength, 12);
  assert.equal(Net.encodeRealtimeAck(1).byteLength, 4);
});

test('a hint is evidence only: it never moves input sequencing, ACKs or lane health', async () => {
  const { Net, G, clock } = await loadWorld();
  const sent = [];
  Net.rtReady = true; Net.rtChannel = { readyState: 'open', bufferedAmount: 0, send: (d) => sent.push(d) };
  const seqs = flyPuck(Net, G, clock);
  Net.rtLastInputSeq = 50; Net.rtLastInputRxT = 0; Net.rtLastRxT = 0;
  Net.onRealtimeMessage(packet(Net, { inputSeq: 51, stateSeq: seqs[0], ...mallet }));
  assert.equal(Net.rtLastInputSeq, 50, 'hint must not advance the input sequence');
  assert.equal(Net.rtLastInputRxT, 0); assert.equal(Net.rtLastRxT, 0);
  assert.equal(sent.length, 0, 'no ACK is produced by a hint');
});

test('non-authority peers (and old peers) ignore hints without error', async () => {
  const { Net, G, clock } = await loadWorld();
  const seqs = flyPuck(Net, G, clock);
  Net.authoritySide = 1; // we are no longer the authority
  const before = JSON.stringify(G.puck);
  assert.doesNotThrow(() => Net.onRealtimeMessage(packet(Net, { inputSeq: 1, stateSeq: seqs[0], ...mallet })));
  assert.equal(JSON.stringify(G.puck), before);
  assert.equal(Net.lagMetrics, null);
});

// -------------------------------------------- fixtures via the production validator ----
test('every contract fixture is decided identically by the production validator', async () => {
  const { Net } = await loadWorld();
  const seen = new Set();
  for (const c of spec.cases) {
    const view = {
      nowMs: c.nowMs, lastInputSeq: c.lastInputSeq, lastHintSeq: c.lastHintSeq,
      hinterSide: 1, current: c.current, history: c.history, trajectory: c.trajectory || null,
    };
    const result = Net.validateContactHint(c.hint, view);
    assert.equal(result.reason, c.reason, c.id);
    assert.equal(result.ok, c.expected === 'accept', c.id);
    seen.add(result.reason);
  }
  for (const reason of ['accepted','malformed','duplicate-or-replay','missing-history','stale','input-lead',
    'point-state','side-bounds','velocity','geometry','separating','superseded','unsafe-transition'])
    assert.ok(seen.has(reason), 'validator never produced ' + reason);
});

test('accepted fixture contacts select the earliest authoritative intersection', async () => {
  const { Net } = await loadWorld();
  const c = spec.cases.find(x => x.id === 'valid-contact-after-referenced-state');
  const r = Net.validateContactHint(c.hint, {
    nowMs: c.nowMs, lastInputSeq: c.lastInputSeq, lastHintSeq: c.lastHintSeq,
    hinterSide: 1, current: c.current, history: c.history, trajectory: c.trajectory,
  });
  assert.ok(r.ok);
  const R = NET_TEST_PHYSICS.PUCK_R + NET_TEST_PHYSICS.MALLET_R + spec.policy.contactTolerance;
  assert.ok(Math.abs(Math.hypot(r.contact.puckX - c.hint.malletX, r.contact.puckY - c.hint.malletY) - R) < 1e-6,
    'contact is where the host path first enters the expanded radius');
  assert.ok(r.contact.puckX > 760 && r.contact.puckX < 820);
  assert.ok(r.contact.timeMs > 916.7 && r.contact.timeMs < 933.4);
});

test('validator rejects each gate for the right reason on live history', async () => {
  const cases = [
    ['stale', (w) => { w.clock.now += 400; }],
    ['superseded', (w) => { w.Net.noteTouch(); }],
    ['point-state', (w) => { w.Net.notePoint(); }],
    ['point-state', (w) => { w.G.state = 'goal'; }],
    ['input-lead', (w) => { w.Net.rtLastInputSeq = 100; }, { inputSeq: 140 }],
    ['side-bounds', () => {}, { malletX: 700 }],
    ['velocity', () => {}, { malletVx: -5000 }],
    ['geometry', () => {}, { malletX: 1100 }],
    ['separating', () => {}, { malletVx: 2500 }],
  ];
  for (const [reason, mutate, over = {}] of cases) {
    const w = await loadWorld();
    const seqs = flyPuck(w.Net, w.G, w.clock);
    mutate(w);
    const before = { ...w.G.puck };
    const r = w.Net.onHitHint(new DataView(packet(w.Net, { inputSeq: 61, stateSeq: seqs[0], ...mallet, ...over })));
    assert.equal(r.reason, reason, reason + ' ' + JSON.stringify(over));
    assert.deepEqual({ ...w.G.puck }, before, reason + ' must not alter the puck');
    assert.equal(w.feedback.length, 0);
  }
});

test('rail proximity is rejected rather than risking a wrong retroactive collision', async () => {
  const w = await loadWorld();
  const seqs = flyPuck(w.Net, w.G, w.clock, { y: 240 });
  const r = w.Net.onHitHint(new DataView(packet(w.Net, { inputSeq: 61, stateSeq: seqs[0], ...mallet, malletY: 246 })));
  assert.equal(r.reason, 'unsafe-transition');
});

// ----------------------------------------------- history, serials, warm-up ----
test('history is recorded atomically with each state sequence and bounded to 16 samples', async () => {
  const { Net, G, clock } = await loadWorld();
  G.puck.x = 777; G.puck.vx = 123;
  const [seq] = publish(Net, clock);
  const item = Net.lagSample(seq);
  assert.equal(item.seq, seq);
  assert.equal(item.puckX, 777); assert.equal(item.puckVx, 123);
  assert.equal(item.state, 'play'); assert.equal(item.timeMs, clock.now);
  assert.equal(item.guestMalletX, G.m2.x, 'authority stores the rival (guest) mallet');
  const all = publish(Net, clock, 20);
  assert.equal(Net.lagSample(seq), null, 'oldest sample fell out of the ring');
  assert.ok(Net.lagSample(all[all.length - 1]));
  assert.equal(all.filter(s => Net.lagSample(s)).length, 16);
});

test('history lookup survives 16-bit sequence wraparound', async () => {
  const { Net, G, clock } = await loadWorld();
  Net.rtStateSeq = 0xfffd;
  const seqs = publish(Net, clock, 6);
  assert.deepEqual(seqs.slice(0, 4), [0xfffe, 0xffff, 0, 1]);
  for (const s of seqs) assert.equal(Net.lagSample(s).seq, s);
  assert.ok(G);
});

test('serials: points and leading-edge touches are monotonic and stored per sample', async () => {
  const { Net, clock } = await loadWorld();
  const [a] = publish(Net, clock);
  Net.noteTouch(); Net.noteTouch(); Net.notePoint();
  const [b] = publish(Net, clock);
  assert.equal(Net.lagSample(a).touchSerial, 0); assert.equal(Net.lagSample(a).pointSerial, 0);
  assert.equal(Net.lagSample(b).touchSerial, 2); assert.equal(Net.lagSample(b).pointSerial, 1);
  assert.match(gameSource, /Net\.noteTouch\(\); \/\/ lag compensation: one serial per leading-edge contact episode/);
  assert.match(gameSource, /function startCount\(\) \{\s*Net\.notePoint\(\)/);
  assert.match(gameSource, /function beginGoalCeremony\(scorer\) \{\s*Net\.notePoint\(\)/);
});

test('compensation stays disabled until three consecutive current-authority samples exist', async () => {
  const w = await loadWorld();
  const { Net, G, clock } = w;
  const verdicts = [];
  for (let i = 0; i < 3; i++) {
    G.puck.x = 700 + 50 * i; G.puck.vx = 900;
    const [seq] = publish(Net, clock);
    if (i === 0) var first = seq;
    G.puck.x += 10; clock.now += 3.3; // hint arrives ~3 ms after the newest sample
    verdicts.push(Net.onHitHint(new DataView(packet(Net, { inputSeq: 10 + i, stateSeq: first, ...mallet }))).reason);
  }
  assert.deepEqual(verdicts.slice(0, 2), ['missing-history', 'missing-history'], 'warm-up not complete');
  assert.equal(verdicts[2], 'accepted', 'third consecutive sample opens the gate');
});

test('every authority change, new match, new lane and dropped room resets compensation state', async () => {
  const { Net, G, clock } = await loadWorld();
  const arm = () => { flyPuck(Net, G, clock); Net.lagLastHintSeq = 77; Net.lagLastHintPose = { x: 1, y: 1, timeMs: 1 }; };
  const epoch = () => Net.lagEpoch;
  const cleared = (label) => {
    assert.equal(Net.lagRing.every(x => x === null), true, label + ': ring cleared');
    assert.equal(Net.lagLastHintSeq, null, label + ': dedupe cleared');
    assert.equal(Net.lagLastHintPose, null, label + ': pose cleared');
    assert.equal(Net.lagTouchSerial, 0, label); assert.equal(Net.lagPointSerial, 0, label);
  };
  // promotion: a guest becoming authority starts from nothing
  arm(); let e = epoch();
  Net.role = 'guest'; Net.side = 1; Net.authoritySide = 0; Net.sessionId = 'abcdefghijklmnopqrstuvwx';
  Net.rsnap = Net.decodeSnapshot([700, 520, 0, 0, 400, 520, 900, 520, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(Net.promoteAuthority(), true);
  assert.ok(epoch() > e); cleared('promote');
  // demotion by a newer remote authority claim
  Net.authoritySide = 1; Net.authorityEpoch = 2; Net.authorityMigrationReady = true;
  arm(); e = epoch();
  Net.onAuthorityClaim({ v: 1, sid: Net.sessionId, epoch: 3, side: 0,
    authority: { snapshot: [700, 520, 0, 0, 400, 520, 900, 520, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1], state: 'play' } });
  assert.ok(epoch() > e); cleared('claim');
  // fresh match / session restore both pass through beginMatch
  Net.authoritySide = 0; Net.side = 0; Net.role = 'host';
  arm(); e = epoch(); Net.beginMatch('host'); assert.ok(epoch() > e); cleared('beginMatch');
  // a new realtime lane drops hint dedupe only (history belongs to the authority epoch)
  arm(); Net.closeRealtime(); assert.equal(Net.lagLastHintSeq, null);
  assert.ok(Net.lagRing.some(x => x !== null), 'closeRealtime keeps authority history');
  arm(); Net.dropRoom(); cleared('dropRoom');
});

test('a pre-migration hint fails with missing-history instead of reading inherited history', async () => {
  const w = await loadWorld();
  const { Net, G, clock } = w;
  const seqs = flyPuck(Net, G, clock);
  Net.resetLagHistory(); // what promotion / resurrection do
  const r = Net.onHitHint(new DataView(packet(Net, { inputSeq: 61, stateSeq: seqs[0], ...mallet })));
  assert.equal(r.reason, 'missing-history');
});

test('after migration the OLD host is the hinting player and bounds mirror to its half', async () => {
  const w = await loadWorld();
  const { Net, G, clock } = w;
  Net.side = 1; Net.role = 'guest'; Net.authoritySide = 1; // original guest now owns authority
  assert.equal(Net.isAuthority(), true);
  G.m1.x = 500; // rival (original host) mallet is on side 0
  // Mid-table path (the live puck must stay outside the rail guard, or Gate 9 rightly refuses).
  const seqs = flyPuck(Net, G, clock, { x: 600, y: 520, vx: -900, dx: -50 });
  const mine = { malletX: 535, malletY: 520, malletVx: 1200, malletVy: 0 };
  assert.equal(Net.onHitHint(new DataView(packet(Net, { inputSeq: 5, stateSeq: seqs[0], ...mine }))).reason, 'accepted');
  const seqs2 = flyPuck(Net, G, clock, { x: 600, y: 520, vx: -900, dx: -50 });
  assert.equal(Net.onHitHint(new DataView(packet(Net, { inputSeq: 6, stateSeq: seqs2[0], ...mine, malletX: 1000 }))).reason, 'side-bounds');
});

test('Gate 9 refuses a live puck inside the rail guard (mirrored side) and a puck that outran PUCK_MAX', async () => {
  // Authority on side 1, hinter on side 0; the live puck ends 20 units from the left rail.
  const a = await loadWorld();
  a.Net.side = 1; a.Net.role = 'guest'; a.Net.authoritySide = 1;
  const s1 = flyPuck(a.Net, a.G, a.clock, { x: 400, y: 520, vx: -900, dx: -60 });
  const r1 = a.Net.onHitHint(new DataView(packet(a.Net, { inputSeq: 5, stateSeq: s1[0], malletX: 335, malletY: 520, malletVx: 1200, malletVy: 0 })));
  assert.equal(r1.reason, 'unsafe-transition');
  // Live puck jumped 100 units in 3 ms (> PUCK_MAX): history and now disagree.
  const b = await loadWorld();
  for (let i = 0; i < 3; i++) { b.G.puck.x = 700 + 50 * i; b.G.puck.vx = 900; var first = i ? first : publish(b.Net, b.clock)[0]; if (i) publish(b.Net, b.clock); }
  b.G.puck.x += 100; b.clock.now += 3;
  const r2 = b.Net.onHitHint(new DataView(packet(b.Net, { inputSeq: 7, stateSeq: first, ...mallet })));
  assert.equal(r2.reason, 'unsafe-transition');
  assert.equal(r2.detail, 'inconsistent');
});

// -------------------------------------------------- application + metrics ----
test('accepted hint applies only a recomputed velocity: no teleport, one touch, no duplicates', async () => {
  const w = await loadWorld();
  const { Net, G, clock, feedback, solve } = w;
  const seqs = flyPuck(Net, G, clock);
  const posBefore = [G.puck.x, G.puck.y], touchBefore = Net.lagTouchSerial;
  const ring = Net.lagBuildView({ stateSeq: seqs[0] }, clock.now);
  const verdict = Net.validateContactHint({ inputSeq: 61, stateSeq: seqs[0], ...mallet }, ring);
  assert.ok(verdict.ok);
  const want = solve({ puckVx: verdict.contact.puckVx, puckVy: verdict.contact.puckVy,
    malletVx: mallet.malletVx, malletVy: mallet.malletVy, nx: verdict.contact.nx, ny: verdict.contact.ny });

  const buf = packet(Net, { inputSeq: 61, stateSeq: seqs[0], ...mallet });
  const r = Net.onHitHint(new DataView(buf));
  assert.equal(r.reason, 'accepted');
  assert.deepEqual([G.puck.x, G.puck.y], posBefore, 'velocity-first: position untouched');
  assert.equal(G.puck.vx, want.vx); assert.equal(G.puck.vy, want.vy);
  assert.ok(G.puck.vx < 0, 'puck now travels away from the guest mallet, toward the host');
  assert.equal(Net.lagTouchSerial, touchBefore + 1);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0][0], 1, 'feedback credited to the guest side');

  const velAfter = [G.puck.vx, G.puck.vy];
  const replay = Net.onHitHint(new DataView(buf));
  assert.equal(replay.reason, 'duplicate-or-replay');
  const reordered = Net.onHitHint(new DataView(packet(Net, { inputSeq: 60, stateSeq: seqs[0], ...mallet })));
  assert.equal(reordered.reason, 'duplicate-or-replay', 'older input sequence cannot double-apply');
  assert.deepEqual([G.puck.vx, G.puck.vy], velAfter);
  assert.equal(feedback.length, 1);
  // a later hint that still points at pre-touch history is superseded, not applied
  const late = Net.onHitHint(new DataView(packet(Net, { inputSeq: 62, stateSeq: seqs[1], ...mallet })));
  assert.equal(late.reason, 'superseded');

  const m = Net.lagMetrics;
  assert.equal(m.hintsReceived, 4); assert.equal(m.hintsAccepted, 1); assert.equal(m.hintsApplied, 1);
  assert.equal(m.hintsRejectedSuperseded, 1);
  assert.equal(m.reasons['duplicate-or-replay'], 2);
});

test('compensated speed obeys the production puck cap', async () => {
  const w = await loadWorld();
  const seqs = flyPuck(w.Net, w.G, w.clock, { vx: 3000 });
  const r = w.Net.onHitHint(new DataView(packet(w.Net, { inputSeq: 61, stateSeq: seqs[0], ...mallet, malletVx: -4600 })));
  assert.equal(r.reason, 'accepted');
  assert.ok(Math.hypot(w.G.puck.vx, w.G.puck.vy) <= NET_TEST_PHYSICS.PUCK_MAX + 1e-9);
});

test('metrics count age, geometry, velocity and superseded rejections separately', async () => {
  const w = await loadWorld();
  const { Net, G, clock } = w;
  const run = (over, pre) => {
    const seqs = flyPuck(Net, G, clock); if (pre) pre();
    return Net.onHitHint(new DataView(packet(Net, { inputSeq: (Net.lagLastHintSeq ?? 0) + 1, stateSeq: seqs[0], ...mallet, ...over }))).reason;
  };
  assert.equal(run({}, () => { clock.now += 500; }), 'stale');
  assert.equal(run({ malletX: 1100 }), 'geometry');
  assert.equal(run({ malletVx: -9000 }), 'velocity');
  assert.equal(run({}, () => Net.noteTouch()), 'superseded');
  const m = Net.lagMetrics;
  assert.deepEqual([m.hintsRejectedAge, m.hintsRejectedGeometry, m.hintsRejectedVelocity, m.hintsRejectedSuperseded], [1, 1, 1, 1]);
  assert.equal(m.hintsAccepted, 0);
});

test('a failing validator is swallowed: the match continues on ordinary physics', async () => {
  const w = await loadWorld();
  const seqs = flyPuck(w.Net, w.G, w.clock);
  w.Net.validateContactHint = () => { throw new Error('boom'); };
  const before = { ...w.G.puck };
  assert.doesNotThrow(() => w.Net.onRealtimeMessage(packet(w.Net, { inputSeq: 1, stateSeq: seqs[0], ...mallet })));
  assert.deepEqual({ ...w.G.puck }, before);
  assert.equal(w.Net.lagMetrics.hintsAccepted, 0);
  // malformed bytes (NaN / bad version) are counted, never applied
  w.Net.validateContactHint = Object.getPrototypeOf(w.Net).validateContactHint;
});

test('malformed hint packets are counted and ignored', async () => {
  const w = await loadWorld();
  const seqs = flyPuck(w.Net, w.G, w.clock);
  const nan = new DataView(packet(w.Net, { inputSeq: 1, stateSeq: seqs[0], ...mallet, malletVx: NaN }));
  assert.equal(w.Net.onHitHint(nan).reason, 'malformed');
  const bad = new DataView(packet(w.Net, { inputSeq: 1, stateSeq: seqs[0], ...mallet })); bad.setUint8(1, 9);
  assert.equal(w.Net.onHitHint(bad).reason, 'malformed');
  assert.equal(w.Net.lagMetrics.reasons.malformed, 2);
});

// ------------------------------------------------------------- guest sender ----
test('guest hint carries the last host state seq and its own mallet pose, never an outcome', async () => {
  const w = await loadWorld();
  const { Net } = w;
  const sent = [];
  Net.rtReady = true; Net.rtChannel = { readyState: 'open', bufferedAmount: 0, send: (d) => sent.push(d) };
  assert.equal(Net.sendHitHint(7, { x: 1, y: 2, vx: 3, vy: 4 }), false, 'no state seq yet: nothing to reference');
  Net.rtLastStateSeq = 4321;
  assert.equal(Net.sendHitHint(7, { x: 865, y: 520, vx: -1200, vy: 5 }), true);
  const h = Net.decodeHitHint(new DataView(sent[0]));
  assert.deepEqual({ ...h }, { inputSeq: 7, stateSeq: 4321, malletX: 865, malletY: 520, malletVx: -1200, malletVy: 5 });
  assert.equal(Net.lagMetrics.hintsSent, 1);
});
