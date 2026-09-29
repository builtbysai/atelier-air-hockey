import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NET_TEST_PHYSICS } from './helpers/net-test-physics.mjs';
import { VirtualNetwork, NETWORK_PROFILES } from './helpers/net-chaos.mjs';

async function loadWorld(clock) {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const hits = [];
  const G = {
    state:'play', mode:'online', onlineFlip:true,
    puck:{ x:550, y:300, vx:0, vy:0 },
    m1:{ x:120, y:300, tx:120, ty:300, vx:0, vy:0, r:46, trail:[] },
    m2:{ x:610, y:300, tx:610, ty:300, vx:-900, vy:0, r:46, trail:[], hitSq:1, hitSqA:0 },
    score:[0,0],
    stats:{ topSpeed:0, bestRally:0, saves:[0,0] },
    trail:[], serveVX:0, serveVY:0, serveDir:1,
  };
  const context = vm.createContext({
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array,
    ArrayBuffer, DataView, setTimeout, clearTimeout,
    performance:{ now:() => clock.now },
    G,
    Settings:{ firstTo:7, pace:'classic' },
    PX:60, PW:680, PY:80, PH:440, CY:300,
    ...NET_TEST_PHYSICS,
    goalW:()=>200,
    paceDamp:()=>0.07,
    paceWall:()=>0.92,
    onMalletHit:(...args)=>hits.push(args),
    driveMallet(m){ m.x=m.tx; m.y=m.ty; },
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    $:()=>null,
  });
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename:'src/net.js' });
  return { Net:context.__Net, G, hits };
}

function statePacket(seq, state) {
  const buffer = new ArrayBuffer(56);
  const v = new DataView(buffer);
  v.setUint8(0, 1);
  v.setUint8(1, 1);
  v.setUint16(2, seq & 0xffff, true);
  const values = [
    state.px, state.py, state.pvx, state.pvy,
    state.m1x, state.m1y, state.m2x, state.m2y,
  ];
  let o = 4;
  for (const value of values) {
    v.setFloat32(o, value, true);
    o += 4;
  }
  v.setUint8(36, state.s0);
  v.setUint8(37, state.s1);
  v.setUint8(38, 2); // play
  v.setUint16(39, 0, true);
  v.setUint16(41, 0, true);
  v.setUint16(43, 0, true);
  v.setUint16(45, 0, true);
  v.setFloat32(47, 0, true);
  v.setFloat32(51, 0, true);
  v.setInt8(55, 1);
  return buffer;
}

async function runPredictionProfile(name, profile) {
  const clock = { now:0 };
  const { Net, G, hits } = await loadWorld(clock);
  const net = new VirtualNetwork(profile);

  let hostAcceptedInput = false;
  let hostHitAt = null;
  let hostStateSeq = 10;
  let predictions = 0;

  Net.active = true;
  Net.role = 'guest';
  Net.peerId = 'rival';
  Net.wire = {
    sendIn:()=>Promise.resolve(),
    sendEv:()=>Promise.resolve(),
    sendSt:()=>Promise.resolve(),
  };
  Net.rtReady = true;
  Net.rtChannel = {
    readyState:'open',
    bufferedAmount:0,
    send(data) {
      net.send(payload => {
        const v = new DataView(payload);
        if (v.getUint8(0) !== 2) return;
        const seq = v.getUint16(2, true);
        hostAcceptedInput = true;
        if (hostHitAt === null) hostHitAt = net.now;
        const ack = Net.encodeRealtimeAck(seq);
        net.send(packet => Net.onRealtimeMessage(packet), ack, 'ack');
      }, data, 'input');
    },
  };

  Net.gview = { px:550, py:300, pvx:0, pvy:0 };
  Net.rsnap = {
    px:550, py:300, pvx:0, pvy:0,
    m1x:120, m1y:300, m2x:610, m2y:300,
    s0:0, s1:0, flags:2, top:0, br:0, sv0:0, sv1:0,
    svx:0, svy:0, sdir:1,
  };
  Net.snapT = 0;
  Net.rtLastStateSeq = hostStateSeq;

  const originalPredict = Net.tryPredictGuestHit.bind(Net);
  Net.tryPredictGuestHit = () => {
    const predicted = originalPredict();
    if (predicted) predictions++;
    return predicted;
  };

  const beforeScore = [...G.score];
  assert.equal(Net.tryPredictGuestHit(), true, name + ': local contact should predict immediately');
  assert.ok(G.puck.vx < 0, name + ': predicted puck should react before network authority returns');
  assert.equal(hits.length, 1, name + ': local hit feedback should fire immediately');

  const dt = 1 / 60;
  const frames = 180; // 3 seconds of virtual play
  for (let frame=0; frame<frames; frame++) {
    const elapsed = hostHitAt === null ? 0 : Math.max(0, (net.now - hostHitAt) / 1000);
    const px = hostHitAt === null ? 550 : Math.max(180, 550 - 520 * elapsed);
    const pvx = hostHitAt === null ? 0 : -520;

    const state = statePacket(++hostStateSeq, {
      px, py:300, pvx, pvy:0,
      m1x:120, m1y:300, m2x:610, m2y:300,
      s0:0, s1:0,
    });
    net.send(packet => Net.onRealtimeMessage(packet), state, 'state');

    Net.pump(dt);
    net.advance(1000 / 60);
    clock.now = net.now;
  }

  assert.equal(net.drain(), true, name + ': all queued packets should drain');
  clock.now = net.now;

  // Let the real guest easing consume the final authoritative snapshot.
  for (let i=0;i<30;i++) {
    clock.now += 1000 / 60;
    Net.guestApply(dt);
  }

  return {
    name,
    hostAcceptedInput,
    predictions,
    corrections:Net.predictionCorrections,
    maxError:Net.predictionMaxError,
    finalPrediction:Net.guestPrediction,
    score:[...G.score],
    beforeScore,
    lastStateSeq:Net.rtLastStateSeq,
    lastAckSeq:Net.rtAckInputSeq,
    transport:net.report(),
    finalPuck:{ x:G.puck.x, y:G.puck.y, vx:G.puck.vx, vy:G.puck.vy },
  };
}

for (const [name, profile] of Object.entries(NETWORK_PROFILES)) {
  test('guest prediction reconciles safely under ' + name, async () => {
    const result = await runPredictionProfile(name, profile);

    assert.equal(result.hostAcceptedInput, true, name + ': at least one guest target must reach authority');
    assert.ok(result.predictions >= 1, name + ': prediction metric should record local contact');
    assert.ok(result.corrections >= 1, name + ': prediction must hand back to authority');
    assert.equal(result.finalPrediction, null, name + ': prediction cannot remain permanently speculative');
    assert.ok(Number.isFinite(result.maxError), name + ': correction error metric must stay finite');
    assert.ok(result.maxError >= 0);
    assert.ok(result.maxError <= Math.hypot(680, 440) + 1,
      name + ': correction error cannot exceed the playable table diagonal: ' + JSON.stringify(result));
    assert.deepEqual(result.score, result.beforeScore,
      name + ': guest prediction must never create or alter a score');
    assert.ok(result.lastStateSeq !== null, name + ': authoritative state must keep arriving');
    assert.ok(result.lastAckSeq !== null, name + ': cumulative ACK progress must eventually arrive');
    assert.ok(Number.isFinite(result.finalPuck.x) && Number.isFinite(result.finalPuck.y));
    assert.ok(result.transport.queued === 0);
  });
}
