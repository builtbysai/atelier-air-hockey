import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';\nimport { NET_TEST_PHYSICS } from './helpers/net-test-physics.mjs';

async function loadWorld() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const hits = [];
  const G = {
    state: 'play', mode: 'online',
    puck: { x: 550, y: 300, vx: 0, vy: 0 },
    m1: { x: 120, y: 300, vx: 0, vy: 0 },
    m2: { x: 610, y: 300, tx: 610, ty: 300, vx: -900, vy: 0, r: 46, hitSq: 1, hitSqA: 0 },
    score: [0, 0],
    stats: { topSpeed: 0, bestRally: 0, saves: [0, 0] },
    trail: [],
  };
  const context = {
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    ArrayBuffer, DataView, setTimeout, clearTimeout, performance,
    G,
    Settings: { firstTo: 7 },
    PX: 60, PW: 680, PY: 80, PH: 440, CY: 300,
    ...NET_TEST_PHYSICS,
    goalW: () => 200,
    paceDamp: () => 0.07,
    paceWall: () => 0.92,
    onMalletHit: (...args) => hits.push(args),
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    $: () => null,
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename: 'src/net.js' });
  return { Net: context.__Net, G, hits, context };
}

function armRealtime(Net) {
  const sent = [];
  Net.active = true;
  Net.role = 'guest';
  Net.peerId = 'rival';
  Net.wire = { sendIn: () => Promise.resolve(), sendEv: () => Promise.resolve(), sendSt: () => Promise.resolve() };
  Net.rtReady = true;
  Net.rtChannel = {
    readyState: 'open',
    bufferedAmount: 0,
    send(data) { sent.push(data); },
  };
  return sent;
}

test('guest contact prediction reacts immediately and fences on an input sequence', async () => {
  const { Net, G, hits } = await loadWorld();
  const sent = armRealtime(Net);
  Net.gview = { px: 550, py: 300, pvx: 0, pvy: 0 };
  Net.rsnap = { px: 550, py: 300, pvx: 0, pvy: 0, m1x: 120, m1y: 300, s0:0, s1:0, top:0, br:0, sv0:0, sv1:0 };
  Net.snapT = performance.now();
  Net.rtLastStateSeq = 10;

  const predicted = Net.tryPredictGuestHit();
  assert.equal(predicted, true);
  assert.ok(Net.guestPrediction);
  assert.equal(Net.guestPrediction.inputSeq, 1);
  assert.equal(Net.guestPrediction.stateSeq, 10);
  assert.ok(Net.gview.pvx < 0, 'guest puck should leave the right-side mallet immediately');
  assert.equal(G.puck.vx, Net.gview.pvx);
  assert.equal(hits.length, 1, 'impact feedback should fire immediately on the guest');
  assert.equal(sent.length, 1, 'prediction forces the current guest target onto the realtime lane');
});

test('prediction stays local until the host ACKs and publishes a newer state', async () => {
  const { Net } = await loadWorld();
  armRealtime(Net);
  Net.gview = { px: 550, py: 300, pvx: 0, pvy: 0 };
  Net.rsnap = { px: 550, py: 300, pvx: 0, pvy: 0, m1x: 120, m1y: 300, s0:0, s1:0, top:0, br:0, sv0:0, sv1:0 };
  Net.snapT = performance.now();
  Net.rtLastStateSeq = 10;
  assert.equal(Net.tryPredictGuestHit(), true);
  const afterHitVx = Net.gview.pvx;

  Net.advanceGuestPrediction(1 / 60);
  assert.ok(Net.guestPrediction, 'no ACK means keep the speculative flight alive');
  assert.ok(Net.gview.pvx < 0);
  assert.ok(Math.abs(Net.gview.pvx) > Math.abs(afterHitVx) * 0.9);

  Net.rtAckInputSeq = Net.guestPrediction.inputSeq;
  Net.advanceGuestPrediction(1 / 60);
  assert.ok(Net.guestPrediction, 'ACK alone is not enough; wait for a post-hit state');

  Net.rtLastStateSeq = 11;
  Net.rsnap = { ...Net.rsnap, px: 515, py: 300, pvx: -760, pvy: 0 };
  for (let i = 0; i < 14 && Net.guestPrediction; i++) Net.advanceGuestPrediction(1 / 60);
  assert.equal(Net.guestPrediction, null, 'prediction should hand back to host authority after reconciliation');
  assert.ok(Net.gview.pvx < 0);
  assert.ok(Net.predictionCorrections >= 1);
});

test('prediction never invents a goal at the mouth', async () => {
  const { Net, G } = await loadWorld();
  armRealtime(Net);
  G.m2.x = 720; G.m2.tx = 720; G.m2.vx = 900;
  Net.gview = { px: 770, py: 300, pvx: 850, pvy: 0 };
  Net.rsnap = { px: 770, py: 300, pvx: 850, pvy: 0, m1x:120, m1y:300, s0:0, s1:0, top:0, br:0, sv0:0, sv1:0 };
  Net.snapT = performance.now();
  Net.rtLastStateSeq = 20;

  // This synthetic state begins near the goal mouth with an active prediction.
  Net.guestPrediction = { inputSeq: 1, stateSeq: 20, age: 0, reconciling: false, reconcileT: 0 };
  Net.advanceGuestPrediction(1 / 30);
  assert.equal(Net.guestPrediction?.reconciling ?? false, true, 'near the goal line, prediction must yield to host authority');
});

test('snapshot teleport guard does not erase an active speculative hit', async () => {
  const { Net } = await loadWorld();
  armRealtime(Net);
  Net.gview = { px: 700, py: 300, pvx: -1400, pvy: 0 };
  Net.guestPrediction = { inputSeq: 2, stateSeq: 5, age: 0.05, reconciling: false, reconcileT: 0 };
  Net.onSnapshot([100,300,0,0,120,300,610,300,0,0,2,0,0,0,0,0,0,1], 'rival');
  assert.equal(Net.gview.px, 700, 'large stale snapshot should not hard-seed the predicted puck');
});
