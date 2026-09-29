import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { VirtualNetwork, NETWORK_PROFILES } from './helpers/net-chaos.mjs';

async function loadNetWorld() {
  const source = await readFile(new URL('../src/net.js', import.meta.url), 'utf8');
  const G = {
    mode:'online', state:'play', onlineFlip:false,
    puck:{ x:400, y:300, vx:500, vy:80 },
    m1:{ x:150, y:300, tx:150, ty:300, vx:0, vy:0, side:0, r:46, trail:[] },
    m2:{ x:650, y:300, tx:650, ty:300, vx:0, vy:0, side:1, r:46, trail:[], hitSq:1, hitSqA:0 },
    score:[0,0], stats:{topSpeed:0,bestRally:0,saves:[0,0]},
    serveVX:0, serveVY:0, serveDir:1, trail:[],
  };
  const context = vm.createContext({
    console, Math, Date, Promise, URL, TextEncoder, Uint8Array, ArrayBuffer, DataView,
    setTimeout, clearTimeout,
    performance:{ now:() => 0 },
    G,
    Settings:{ firstTo:7, pace:'classic' },
    clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
    PX:60, PW:680, PY:80, PH:440, CX:400, CY:300,
    PUCK_R:26, MALLET_R:46, PUCK_MAX:2000, SMACK_BONUS:0.34,
    goalW:()=>200,
    $:()=>null,
  });
  vm.runInContext(source + '\nthis.__Net = Net;', context, { filename:'src/net.js' });
  const Net = context.__Net;
  Net.active = true;
  Net.peerId = 'peer';
  return { Net, G };
}

function connectRealtime(host, guest, profile) {
  const net = new VirtualNetwork(profile);

  const hostChannel = {
    readyState:'open', bufferedAmount:0,
    send(data) { net.send(payload => guest.Net.onRealtimeMessage(payload), data, 'h->g'); },
  };
  const guestChannel = {
    readyState:'open', bufferedAmount:0,
    send(data) { net.send(payload => host.Net.onRealtimeMessage(payload), data, 'g->h'); },
  };

  host.Net.role = 'host';
  guest.Net.role = 'guest';
  host.Net.rtReady = guest.Net.rtReady = true;
  host.Net.rtChannel = hostChannel;
  guest.Net.rtChannel = guestChannel;

  // Reliable fallback is deliberately inert in this lab. If the fast lane
  // unexpectedly falls back, the test should expose it rather than hide it.
  host.Net.wire = guest.Net.wire = {
    sendSt:()=>Promise.resolve(),
    sendIn:()=>Promise.resolve(),
    sendEv:()=>Promise.resolve(),
  };

  return net;
}

test('virtual network profiles are deterministic', () => {
  const a = new VirtualNetwork(NETWORK_PROFILES.hotelWifi);
  const b = new VirtualNetwork(NETWORK_PROFILES.hotelWifi);
  const da = [], db = [];
  for (let i=0;i<100;i++) {
    a.send(v=>da.push(v), i);
    b.send(v=>db.push(v), i);
  }
  a.drain(); b.drain();
  assert.deepEqual(da, db);
  assert.deepEqual(a.report(), b.report());
});

for (const [name, profile] of Object.entries(NETWORK_PROFILES)) {
  test('realtime state converges under ' + name, async () => {
    const host = await loadNetWorld();
    const guest = await loadNetWorld();
    const net = connectRealtime(host, guest, profile);

    for (let i=0;i<180;i++) {
      host.G.puck.x = 120 + i * 2;
      host.G.puck.y = 280 + Math.sin(i / 12) * 40;
      host.G.puck.vx = 720;
      host.G.puck.vy = Math.cos(i / 12) * 160;
      host.Net.sendRealtime(host.Net.encodeRealtimeState());
      net.advance(1000 / 60);
    }
    assert.equal(net.drain(), true);

    assert.ok(guest.Net.rtLastStateSeq !== null, name + ': guest received realtime state');
    assert.ok(guest.Net.rtLastStateSeq > 120, name + ': guest converged to recent sequence ' + guest.Net.rtLastStateSeq);
    assert.ok(Number.isFinite(guest.Net.rsnap?.px), name + ': decoded snapshot remains finite');

    const report = net.report();
    assert.ok(report.delivered > 0);
    assert.ok(report.queued === 0);
  });

  test('input ACK progress survives ' + name, async () => {
    const host = await loadNetWorld();
    const guest = await loadNetWorld();
    const net = connectRealtime(host, guest, profile);

    // Host input validation expects the normal game clamp constants, supplied
    // by the vm world. Move the guest target enough that every packet matters.
    for (let i=0;i<180;i++) {
      const packet = guest.Net.encodeRealtimeInput(500 + (i % 120), 200 + (i % 180));
      guest.Net.sendRealtime(packet);
      net.advance(1000 / 60);
    }
    assert.equal(net.drain(), true);

    assert.ok(host.Net.rtLastInputSeq !== null, name + ': host received guest input');
    assert.ok(guest.Net.rtAckInputSeq !== null, name + ': guest received cumulative ACK');
    assert.ok(guest.Net.inputAcked(1), name + ': cumulative ACK covers old input');
    assert.ok(net.report().queued === 0);
  });
}

test('out-of-order realtime state can never roll the guest sequence backward', async () => {
  const guest = await loadNetWorld();
  guest.Net.role = 'guest';

  const mk = seq => {
    const buffer = new ArrayBuffer(56);
    const v = new DataView(buffer);
    v.setUint8(0, 1); v.setUint8(1, 1); v.setUint16(2, seq, true);
    // Remaining fields default to zero, which is valid finite test data.
    return buffer;
  };

  guest.Net.onRealtimeMessage(mk(20));
  guest.Net.onRealtimeMessage(mk(18));
  guest.Net.onRealtimeMessage(mk(21));
  guest.Net.onRealtimeMessage(mk(19));

  assert.equal(guest.Net.rtLastStateSeq, 21);
});

test('hotel Wi-Fi profile actually exercises loss and reordering', () => {
  const net = new VirtualNetwork({ ...NETWORK_PROFILES.hotelWifi, seed:44 });
  let delivered = 0;
  for (let i=0;i<1000;i++) net.send(()=>delivered++, i);
  net.drain();
  const report = net.report();
  assert.ok(report.dropped > 0, JSON.stringify(report));
  assert.ok(report.reordered > 0, JSON.stringify(report));
  assert.equal(delivered, report.delivered);
});


for (const seconds of [1, 5, 15]) {
  test('realtime state reconverges after ' + seconds + 's packet blackout without stale burst', async () => {
    const host = await loadNetWorld();
    const guest = await loadNetWorld();
    const net = connectRealtime(host, guest, NETWORK_PROFILES.clean);

    // Establish a known-good state, then fully drain it so any queue observed
    // during the blackout can only come from blackout traffic.
    for (let i=0;i<12;i++) {
      host.G.puck.x = 240 + i;
      host.Net.sendRealtime(host.Net.encodeRealtimeState());
      net.advance(1000 / 60);
    }
    assert.equal(net.drain(), true);
    const beforeSeq = guest.Net.rtLastStateSeq;
    const before = net.report();

    // A real disconnect does not preserve replaceable realtime physics.
    // Model that by dropping every packet for the outage duration.
    net.loss = 1;
    const frames = seconds * 60;
    for (let i=0;i<frames;i++) {
      host.G.puck.x = 260 + (i % 240);
      host.G.puck.y = 260 + Math.sin(i / 9) * 60;
      host.Net.sendRealtime(host.Net.encodeRealtimeState());
      net.advance(1000 / 60);
    }

    const during = net.report();
    assert.equal(during.queued, 0, 'blackout must not accumulate stale realtime state');
    assert.equal(during.maxQueue, before.maxQueue, 'blackout must not grow the realtime queue');
    assert.ok(during.dropped - before.dropped >= frames, 'blackout should drop every realtime state');

    // Once transport returns, a handful of fresh states must supersede the
    // entire missing window. No replay of blackout traffic is required.
    net.loss = 0;
    for (let i=0;i<12;i++) {
      host.G.puck.x = 500 + i;
      host.G.puck.y = 320;
      host.Net.sendRealtime(host.Net.encodeRealtimeState());
      net.advance(1000 / 60);
    }
    assert.equal(net.drain(), true);

    assert.notEqual(guest.Net.rtLastStateSeq, beforeSeq);
    assert.equal(guest.Net.rtLastStateSeq, host.Net.rtStateSeq,
      'guest should converge to the newest authoritative state after blackout');
    assert.ok(Number.isFinite(guest.Net.rsnap?.px));
    assert.equal(net.report().queued, 0);
  });
}

test('latest guest input and cumulative ACK recover after packet blackout', async () => {
  const host = await loadNetWorld();
  const guest = await loadNetWorld();
  const net = connectRealtime(host, guest, NETWORK_PROFILES.clean);

  for (let i=0;i<6;i++) {
    guest.Net.sendRealtime(guest.Net.encodeRealtimeInput(520 + i, 260 + i));
    net.advance(1000 / 60);
  }
  assert.equal(net.drain(), true);
  const acceptedBefore = host.Net.rtLastInputSeq;

  net.loss = 1;
  for (let i=0;i<120;i++) {
    guest.Net.sendRealtime(guest.Net.encodeRealtimeInput(560 + (i % 40), 280));
    net.advance(1000 / 60);
  }
  assert.equal(net.report().queued, 0);

  net.loss = 0;
  const latest = guest.Net.encodeRealtimeInput(610, 300);
  const latestSeq = guest.Net.rtInputSeq;
  guest.Net.sendRealtime(latest);
  net.advance(1000 / 60);
  assert.equal(net.drain(), true);

  assert.ok(host.Net.seqNewer(host.Net.rtLastInputSeq, acceptedBefore));
  assert.equal(host.Net.remote.tx, 610);
  assert.equal(host.Net.remote.ty, 300);
  assert.equal(guest.Net.inputAcked(latestSeq), true,
    'new cumulative ACK should fence all lost inputs before the recovered target');
  assert.equal(net.report().queued, 0);
});
