/* ============================================================================
 * net.js — online multiplayer for Atelier Air Hockey.
 *
 * All netcode lives here behind the `Net` interface. The engine (engine2.js)
 * touches it only through minimal hooks marked `// ONLINE:`. Nothing in this
 * file runs at load time except constant/function definitions, so the
 * offline game never pays for it — and no network request happens until the
 * user taps Online (the Trystero import is dynamic, inside the click path).
 *
 * ----------------------------------------------------------------------------
 * PROTOCOL
 *
 * Transport: Trystero 0.25.4 (WebRTC data channels, Nostr signaling), one
 * reliable ordered channel. Three actions:
 *
 *   st  host -> guest, ~25 Hz. Compact array (all numbers, 1-decimal):
 *       [px,py,pvx,pvy, m1x,m1y, m2x,m2y, s0,s1, flags, top, br]
 *        0-3  puck position / velocity (rink units, units/s)
 *        4-5  host mallet (m1) position
 *        6-7  guest mallet (m2) position (echo)
 *        8-9  scores [side0, side1]
 *        10   flags bitfield: 1=count 2=play 4=goal 8=pause 16=win 32=matchpoint
 *        11   host topSpeed (rounded, for the guest's win card)
 *        12   host bestRally (int, for the guest's win card)
 *
 *   in  guest -> host, ~30 Hz. Array [tx, ty]: guest mallet target, rink units.
 *
 *   ev  either direction, event objects {t, ...}:
 *       {t:'knock'}                      guest->host: "I'm here, start if waiting"
 *       {t:'hello', firstTo, pace, theme} host->guest: match settings (host wins)
 *       {t:'countdown', serveDir}        host->guest: begin the countdown
 *       {t:'goal', scorer, s0, s1, matchEnd} host->guest: ceremony sync
 *       {t:'pause'} / {t:'resume'}        either: pause state follows the sender
 *       {t:'rematch', phase}             either: 'offer' | 'accept' | 'decline'
 *       {t:'leave'}                      either: "I'm gone"
 *
 * Roles: Create -> host (side 0, m1, unflipped view). Join -> guest (side 1,
 * m2, view flipped so they play from their own side — see G.onlineFlip).
 * The host runs the 240 Hz sim untouched; the guest never simulates the puck.
 * Guest rendering: own mallet local every frame (zero input latency) + sent
 * via `in`; puck + host mallet from `st` with dead reckoning between
 * snapshots (extrapolate by last velocity, lerp-correct toward arrivals —
 * smooth, never teleports). Ceremony + boardKick run from `ev {t:'goal'}` so
 * the Solari / reels / cribbage / bulbs animate in sync on both sides.
 *
 * Room interface (what joinRoom returns; the stub implements the same shape):
 *   { selfId, getPeers(), onPeerJoin(cb), onPeerLeave(cb),
 *     makeAction(name) -> [send(data), receive(cb), progress(cb)], leave() }
 * Trystero's receive callback gets (data, peerId).
 *
 * Test hook: `?netstub` makes create()/join() use an in-page loopback room
 * (zero network). Net.testFullMatch() drives the entire online flow headlessly
 * (see DEV TEST HOOKS below). The stub never ships network behavior.
 * ==========================================================================*/

const Net = {
  // ---- lifecycle state ----
  room: null,          // Room (Trystero or stub)
  wire: null,          // {sendSt, sendIn, sendEv} from wireRoom()
  role: null,          // 'host' | 'guest' once a match is live
  active: false,       // true while a match owns the room
  code: null,          // 4-letter room code
  waitingForRival: false,

  // ---- UI state ----
  lobbyOpen: false,    // online overlay visible -> attract demo stays off

  // ---- host-side ----
  remote: { tx: 0, ty: 0 },  // guest mallet target, from `in`
  snapAcc: 0,

  // ---- guest-side ----
  rsnap: null,         // last decoded snapshot
  gview: null,         // dead-reckoning model {px,py,pvx,pvy}
  inAcc: 0,
  savedSettings: null, // guest's own prefs, restored on leave

  // ---- plumbing ----
  roomFactory: null,   // stub injection (dev only)
  stubMode: false,     // forced loopback (dev only)
  useLoopback: false,  // set by ?netstub at boot (dev only)
  _trystero: null,     // cached dynamic import
  joinTimer: 0,
  offerSent: false,    // rematch offer already sent this win screen
  botM1: null,         // dev only: AI brain driving the host mallet (stub tests)
};

/* Unambiguous code alphabet: no 0/O, 1/I/L. */
const NET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function netGenCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += NET_ALPHABET[(Math.random() * NET_ALPHABET.length) | 0];
  return c;
}

/* Pinned Nostr relays (Trystero 0.25 reads ONLY relayConfig — the old
 * relayUrls/relayRedundancy keys are silently ignored). */
const NET_RELAYS = [
  'wss://nos.lol',
  'wss://nostr-01.yakihonne.com',
  'wss://relay.mostr.pub',
  'wss://yabu.me/v2',
  'wss://purplerelay.com',
];
const NET_TURN_URLS = [
  'turn:staticauth.openrelay.metered.ca:80',
  'turn:staticauth.openrelay.metered.ca:443',
  'turn:staticauth.openrelay.metered.ca:80?transport=tcp',
  'turns:staticauth.openrelay.metered.ca:443?transport=tcp',
];

/* Dynamic import — the ONLY network touch, and only after the user taps
 * Online. Cached after first use. Skipped entirely in stub/loopback mode. */
Net.trystero = async function () {
  if (Net.roomFactory || Net.stubMode || Net.useLoopback) return {};
  if (!Net._trystero) Net._trystero = await import('https://esm.run/trystero@0.25.4');
  return Net._trystero;
};

/* TURN credential, computed locally (TURN REST shared-secret scheme — the
 * "secret" is public by design, nothing sensitive ships). 24h TTL. */
Net.turnCredential = async function () {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const username = exp + ':' + Math.random().toString(36).slice(2, 10);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('openrelayprojectsecret'),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { username, password: btoa(bin) };
};

Net.makeRoom = async function (joinRoom, code) {
  // Dev/test injection wins — the factory's room is used as-is (the old code
  // ignored the factory's return value and built an unrelated pair).
  if (Net.roomFactory) return Net.roomFactory();
  if (Net.stubMode || Net.useLoopback) return Net.createStubPair(15).a;
  const turn = await Net.turnCredential();
  return joinRoom(
    {
      appId: 'atelier-air-hockey',
      relayConfig: { urls: NET_RELAYS, redundancy: 5 },
      turnConfig: [{ urls: NET_TURN_URLS, username: turn.username, credential: turn.password }],
    },
    'atelier-ah-' + code
  );
};

/* Wire a Room's three actions to handler callbacks. Shared by the real game
 * and the headless test guest — one place, one shape. */
Net.wireRoom = function (room, h) {
  const [sendSt, recvSt] = room.makeAction('st');
  const [sendIn, recvIn] = room.makeAction('in');
  const [sendEv, recvEv] = room.makeAction('ev');
  recvSt((data) => { try { h.onSt(data); } catch (e) { Net.logErr(e); } });
  recvIn((data) => { try { h.onIn(data); } catch (e) { Net.logErr(e); } });
  recvEv((data) => { try { h.onEv(data); } catch (e) { Net.logErr(e); } });
  room.onPeerJoin((id) => { try { h.onPeerJoin(id); } catch (e) { Net.logErr(e); } });
  room.onPeerLeave((id) => { try { h.onPeerLeave(id); } catch (e) { Net.logErr(e); } });
  return { sendSt, sendIn, sendEv };
};
Net.logErr = function (e) { if (window.__errs) window.__errs.push({ msg: 'net: ' + (e && e.message) }); };

/* ---------------- snapshot codec ---------------- */
const _r1 = (v) => Math.round(v * 10) / 10;
Net.encodeSnapshot = function () {
  const p = G.puck;
  let flags = 0;
  if (G.state === 'count') flags |= 1;
  else if (G.state === 'play') flags |= 2;
  else if (G.state === 'goal') flags |= 4;
  else if (G.state === 'pause') flags |= 8;
  else if (G.state === 'win') flags |= 16;
  if ((G.score[0] === Settings.firstTo - 1 || G.score[1] === Settings.firstTo - 1) && (flags & 3)) flags |= 32;
  return [_r1(p.x), _r1(p.y), _r1(p.vx), _r1(p.vy),
    _r1(G.m1.x), _r1(G.m1.y), _r1(G.m2.x), _r1(G.m2.y),
    G.score[0], G.score[1], flags,
    Math.round(G.stats ? G.stats.topSpeed : 0), G.stats ? G.stats.bestRally : 0];
};
Net.decodeSnapshot = function (a) {
  return {
    px: a[0], py: a[1], pvx: a[2], pvy: a[3],
    m1x: a[4], m1y: a[5], m2x: a[6], m2y: a[7],
    s0: a[8], s1: a[9], flags: a[10],
    top: a[11] || 0, br: a[12] || 0,
  };
};

/* ============================================================================
 * LOBBY UI — atelier-styled, one compact card, nothing scrolls. Modes:
 * choose | join | waiting (host) | knocking (guest) | guestwait
 * | rematchoffer (rival wants a rematch)
 * ========================================================================== */
Net.uiShow = function (mode, data) {
  data = data || {};
  const T = $('onlineTitle'), S = $('onlineSub'), B = $('onlineBody'),
        E = $('onlineErr'), P = $('onlinePrimary'), Q = $('onlineSecondary');
  E.classList.add('hidden'); E.textContent = '';
  P.classList.remove('hidden'); Q.classList.remove('hidden');
  P.disabled = false; Q.disabled = false;
  const setBtn = (el, label, fn) => {
    if (!label) { el.classList.add('hidden'); el.onclick = null; return; }
    el.classList.remove('hidden'); el.textContent = label; el.onclick = fn;
  };
  if (mode === 'choose') {
    T.textContent = 'Play a rival';
    S.textContent = 'Host a table, or join one with a code.';
    B.innerHTML = '<p class="online-note">Hosting is instant — share the 4-letter code ' +
      'and your rival joins straight in. Your table, your rules: ' +
      'the host\u2019s table and settings win.</p>';
    setBtn(P, 'Host a table', () => Net.create());
    setBtn(Q, 'Join with a code', () => Net.uiShow('join'));
  } else if (mode === 'join') {
    T.textContent = 'Join a table';
    S.textContent = 'Enter the 4-letter code from your rival.';
    B.innerHTML = '<input id="onlineCodeInput" class="online-input" maxlength="4" ' +
      'autocomplete="off" autocapitalize="characters" spellcheck="false" ' +
      'placeholder="····" aria-label="Table code">';
    setBtn(P, 'Knock', () => Net.join(($('onlineCodeInput') || {}).value || ''));
    setBtn(Q, 'Back', () => Net.uiShow('choose'));
    setTimeout(() => { try { $('onlineCodeInput').focus({ preventScroll: true }); } catch (e) {} }, 60);
  } else if (mode === 'waiting') {
    T.textContent = 'Table hosted';
    S.textContent = 'Share this code with your rival.';
    B.innerHTML = '<div class="online-code">' + (data.code || '····') + '</div>' +
      '<p class="online-note pulse">Waiting for a rival&hellip;</p>';
    setBtn(P, 'Cancel', () => Net.cancelLobby());
    setBtn(Q, null);
  } else if (mode === 'knocking') {
    T.textContent = 'Knocking';
    S.innerHTML = 'Asking to join table <b>' + (data.code || '') + '</b>.';
    B.innerHTML = '<p class="online-note pulse">Waiting for the host&hellip;</p>';
    setBtn(P, 'Cancel', () => Net.cancelLobby());
    setBtn(Q, null);
  } else if (mode === 'guestwait') {
    T.textContent = 'You\u2019re in';
    S.textContent = 'The host is setting the table.';
    B.innerHTML = '<p class="online-note pulse">Waiting for the host to start&hellip;</p>';
    setBtn(P, 'Cancel', () => Net.cancelLobby());
    setBtn(Q, null);
  } else if (mode === 'rematchoffer') {
    T.textContent = 'Rematch?';
    S.textContent = 'Your rival wants another.';
    B.innerHTML = '<p class="online-note">Same table, same rules. First to ' +
      Settings.firstTo + ' takes it.</p>';
    setBtn(P, 'Accept', () => Net.acceptRematch());
    setBtn(Q, 'Decline', () => Net.declineRematch());
  }
};
Net.uiError = function (msg) {
  const e = $('onlineErr');
  e.textContent = msg; e.classList.remove('hidden');
};
Net.openLobby = function () {
  AudioSys.init();
  Net.lobbyOpen = true;
  if (G.mode !== 'online') { G._prevMode = G.mode; G.mode = 'online'; } // ONLINE: lobby open -> no attract demo
  G.idleT = 0;
  hideAll();
  $('onlineov').classList.remove('hidden');
  Net.uiShow('choose');
};
Net.closeLobby = function () {
  Net.lobbyOpen = false;
  hideAll(); $('menu').classList.remove('hidden');
  if (G.mode === 'online' && !Net.active) G.mode = G._prevMode || 'ai';
};

Net.create = async function () {
  Net.uiShow('waiting', { code: '' });
  try {
    const { joinRoom } = await Net.trystero();
    const code = netGenCode();
    const room = await Net.makeRoom(joinRoom, code);
    Net.initRoom(room, 'host');
    Net.code = code;
    Net.waitingForRival = true;
    Net.uiShow('waiting', { code });
  } catch (e) {
    Net.uiShow('choose');
    Net.uiError("Couldn't reach the lobby — check your connection and try again.");
  }
};

Net.join = async function (rawCode) {
  const code = (rawCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 4);
  if (code.length !== 4) { Net.uiError('That code needs 4 letters — check it and try again.'); return; }
  Net.uiShow('knocking', { code });
  try {
    const { joinRoom } = await Net.trystero();
    const room = await Net.makeRoom(joinRoom, code);
    Net.initRoom(room, 'guest');
    Net.code = code;
    clearTimeout(Net.joinTimer);
    Net.joinTimer = setTimeout(() => {
      if (!Net.active) {
        Net.uiShow('choose');
        Net.uiError("Couldn't reach that table — check the code and try again.");
        Net.dropRoom();
      }
    }, 20000);
    // fast path: host already waiting
    if (Object.keys(room.getPeers()).length > 0 && Net.wire) Net.wire.sendEv({ t: 'knock' });
  } catch (e) {
    Net.uiShow('choose');
    Net.uiError("Couldn't reach the lobby — check your connection and try again.");
  }
};

Net.cancelLobby = function () {
  clearTimeout(Net.joinTimer);
  Net.dropRoom();
  Net.code = null;
  Net.closeLobby();
  AudioSys.ui();
};

/* ---------------- room lifecycle ---------------- */
Net.initRoom = function (room, role) {
  Net.dropRoom();
  Net.room = room;
  Net.role = role; // provisional until the match starts
  Net.wire = Net.wireRoom(room, {
    onPeerJoin: (id) => Net.onPeerJoin(id),
    onPeerLeave: (id) => Net.onPeerLeave(id),
    onSt: (a) => Net.onSnapshot(a),
    onIn: (a) => Net.onInput(a),
    onEv: (ev) => Net.onEvent(ev),
  });
};
/* Drop the room object without ceremony (cancel paths). */
Net.dropRoom = function () {
  try { if (Net.room) Net.room.leave(); } catch (e) {}
  Net.room = null; Net.wire = null; Net.role = null;
  Net.active = false; Net.waitingForRival = false;
};

Net.onPeerJoin = function () {
  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();
};
Net.onPeerLeave = function () {
  if (Net.active || Net.waitingForRival) Net.onRivalLeft();
};

Net.onSnapshot = function (a) {
  if (Net.role !== 'guest' || !Net.active) return;
  const s = Net.decodeSnapshot(a);
  if (!Net.gview) {
    Net.gview = { px: s.px, py: s.py, pvx: s.pvx, pvy: s.pvy };
  } else {
    // teleport guard: a snapshot from across the table means our model is
    // stale (missed packets) — seed hard instead of rubber-banding.
    const d = Math.hypot(s.px - Net.gview.px, s.py - Net.gview.py);
    if (d > 420) { Net.gview.px = s.px; Net.gview.py = s.py; }
  }
  Net.rsnap = s;
};

Net.onInput = function (a) {
  if (Net.role !== 'host' || !Net.active) return;
  Net.remote.tx = a[0]; Net.remote.ty = a[1];
};

Net.onEvent = function (ev) {
  if (!ev || !ev.t) return;
  switch (ev.t) {
    case 'knock':
      if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();
      break;
    case 'hello':
      if (Net.role === 'guest' && !Net.active) Net.onHello(ev);
      break;
    case 'countdown':
      if (Net.role === 'guest') Net.onCountdown(ev);
      break;
    case 'goal':
      if (Net.role === 'guest' && Net.active) Net.guestGoal(ev);
      break;
    case 'pause':
      if (Net.active) Net.applyRemotePause(true);
      break;
    case 'resume':
      if (Net.active) Net.applyRemotePause(false);
      break;
    case 'rematch':
      Net.onRematch(ev.phase || '');
      break;
    case 'leave':
      if (Net.active || Net.waitingForRival) Net.onRivalLeft();
      break;
  }
};

/* ---------------- match flow ---------------- */
Net.beginMatch = function (role) {
  Net.role = role;
  Net.active = true;
  Net.waitingForRival = false;
  Net.offerSent = false;
  Net.lobbyOpen = false;
  G.mode = 'online';
  G.onlineFlip = (role === 'guest'); // ONLINE: guest plays from their own side
  G.score = [0, 0]; G.winSide = 0;
  G.demo = false; G.idleT = 0;
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  G.scuffs.length = 0; G.texts.length = 0;
  resetPositions();
  G.ai1 = null; G.ai2 = null; // ONLINE: no AI online, ever
  G.stats = freshStats(); G.stats.t0 = performance.now();
  pointers.clear();
  hideAll();
  $('topbar').classList.remove('hidden');
  // reset rematch UI
  const rb = $('btnRematch'); rb.textContent = 'Rematch'; rb.disabled = false;
  // net state
  Net.rsnap = null; Net.gview = null;
  Net.snapAcc = 0; Net.inAcc = 0;
  Net.remote.tx = PX + PW - 170; Net.remote.ty = CY;
};

/* Host: a rival arrived — start the match, send the settings, count down. */
Net.startHostMatch = function () {
  if (Net.active || !Net.waitingForRival) return;
  Net.beginMatch('host');
  Net.sendHello();
  startCount();
  G.serveDir = Math.random() < 0.5 ? 1 : -1;
  Net.sendCountdown();
};

/* Guest: the host's settings win. Stash our own, apply theirs, wait. */
Net.onHello = function (ev) {
  clearTimeout(Net.joinTimer);
  Net.savedSettings = { firstTo: Settings.firstTo, pace: Settings.pace };
  if (ev.firstTo) Settings.firstTo = ev.firstTo;
  if (ev.pace && PACES[ev.pace]) Settings.pace = ev.pace;
  try { applySettingsToUI(); } catch (e) {}
  if (ev.theme && THEMES[ev.theme]) setTheme(ev.theme, true);
  Net.role = 'guest';
  Net.active = true;
  Net.waitingForRival = false;
  G.mode = 'online';
  G.onlineFlip = true;
  Net.uiShow('guestwait');
};

/* Guest: a countdown always starts a fresh leg (first match or rematch). */
Net.onCountdown = function (ev) {
  if (Net.role !== 'guest' || !Net.active) return;
  Net.beginMatch('guest');
  if (ev && (ev.serveDir === 1 || ev.serveDir === -1)) G.serveDir = ev.serveDir;
  startCount();
};

/* Guest-side ceremony: the host's {t:'goal'} is the source of truth — the
 * scores arrive final, so the ceremony must NOT increment again. The scores
 * are also stamped into the snapshot cache so the per-frame apply can't
 * regress them with a stale pre-goal snapshot. */
Net.guestGoal = function (ev) {
  G.score = [ev.s0, ev.s1];
  if (Net.rsnap) { Net.rsnap.s0 = ev.s0; Net.rsnap.s1 = ev.s1; }
  beginGoalCeremony(ev.scorer); // visuals only — no scoring, no send
};

/* Remote pause without echoing an event back (the sender already sent it). */
Net.applyRemotePause = function (paused) {
  if (paused) togglePause(true, true);
  else togglePause(false, true);
};

/* ---------------- per-frame ---------------- */
/* Host: snapshots @25Hz. Guest: input @30Hz + dead reckoning every frame.
 * No-op unless a match is live. */
Net.pump = function (rdt) {
  if (!Net.active || !Net.wire) return;
  if (Net.role === 'host') {
    Net.snapAcc += rdt;
    if (Net.snapAcc >= 1 / 25 && (G.state === 'count' || G.state === 'play' || G.state === 'goal')) {
      Net.snapAcc = 0;
      Net.wire.sendSt(Net.encodeSnapshot());
    }
  } else {
    Net.inAcc += rdt;
    if (Net.inAcc >= 1 / 30) { Net.inAcc = 0; Net.sendInput(); }
    Net.guestApply(rdt);
  }
};

Net.easeHostMallet = function (rdt) {
  if (!Net.rsnap) return;
  const k = Math.min(1, rdt * 18);
  G.m1.x += (Net.rsnap.m1x - G.m1.x) * k;
  G.m1.y += (Net.rsnap.m1y - G.m1.y) * k;
};

/* Guest per-frame: ease the reckoning model toward the latest snapshot,
 * extrapolate by velocity, cheap rail reflection, then publish to G for the
 * renderer. Scores and win-card stats follow the wire. */
Net.guestApply = function (rdt) {
  const s = Net.rsnap, gv = Net.gview;
  if (!s || !gv) return;
  const k = 0.5; // lerp-correct: smooth, never teleports
  gv.px += (s.px - gv.px) * k; gv.py += (s.py - gv.py) * k;
  gv.pvx = s.pvx; gv.pvy = s.pvy;
  gv.px += gv.pvx * rdt; gv.py += gv.pvy * rdt;
  if (gv.py < PY + PUCK_R) { gv.py = PY + PUCK_R; gv.pvy = Math.abs(gv.pvy); }
  else if (gv.py > PY + PH - PUCK_R) { gv.py = PY + PH - PUCK_R; gv.pvy = -Math.abs(gv.pvy); }
  if (gv.px < PX + PUCK_R) { gv.px = PX + PUCK_R; gv.pvx = Math.abs(gv.pvx); }
  else if (gv.px > PX + PW - PUCK_R) { gv.px = PX + PW - PUCK_R; gv.pvx = -Math.abs(gv.pvx); }
  G.puck.x = gv.px; G.puck.y = gv.py; G.puck.vx = gv.pvx; G.puck.vy = gv.pvy;
  G.trail.push({ x: gv.px, y: gv.py });
  if (G.trail.length > 16) G.trail.shift();
  Net.easeHostMallet(rdt);
  G.score[0] = s.s0; G.score[1] = s.s1;
  if (G.stats) {
    if (s.top > G.stats.topSpeed) G.stats.topSpeed = s.top;
    if (s.br > G.stats.bestRally) G.stats.bestRally = s.br;
  }
};

/* ---------------- events out ---------------- */
Net.sendHello = function () {
  Net.wire.sendEv({ t: 'hello', firstTo: Settings.firstTo, pace: Settings.pace, theme: THEME.id });
};
Net.sendCountdown = function () { Net.wire.sendEv({ t: 'countdown', serveDir: G.serveDir }); };
Net.sendGoal = function (scorer) {
  Net.wire.sendEv({
    t: 'goal', scorer,
    s0: G.score[0], s1: G.score[1],
    matchEnd: G.score[scorer] >= Settings.firstTo,
  });
};
Net.sendPause = function (paused) { Net.wire.sendEv({ t: paused ? 'pause' : 'resume' }); };
Net.sendInput = function () {
  Net.wire.sendIn([_r1(G.m2.tx), _r1(G.m2.ty)]);
};

/* ---------------- rematch ---------------- */
/* Either side can offer from the win screen. The HOST always performs the
 * restart — the guest's accept just tells the host to go. */
Net.offerRematch = function () {
  if (!Net.active || !Net.wire || Net.offerSent) return;
  Net.offerSent = true;
  Net.wire.sendEv({ t: 'rematch', phase: 'offer' });
  const b = $('btnRematch'); b.textContent = 'Offer sent…'; b.disabled = true;
  AudioSys.ui();
};
Net.onRematch = function (phase) {
  if (!Net.active) return;
  if (phase === 'offer') {
    if (G.state !== 'win') return; // offers only make sense at full time
    hideAll();
    $('onlineov').classList.remove('hidden');
    Net.uiShow('rematchoffer');
    AudioSys.ui();
  } else if (phase === 'accept') {
    if (Net.role === 'host') Net.restartMatchAsHost();
    else { Net.uiShow('guestwait'); } // host accepted — they're starting it
  } else if (phase === 'decline') {
    if (!Net.offerSent) return;
    Net.offerSent = false;
    const b = $('btnRematch');
    b.textContent = 'Rival declined'; b.disabled = true;
    setTimeout(() => {
      if (Net.active && G.state === 'win' && !Net.offerSent) {
        b.textContent = 'Rematch'; b.disabled = false;
      }
    }, 2200);
  }
};
Net.acceptRematch = function () {
  if (!Net.active || !Net.wire) return;
  Net.wire.sendEv({ t: 'rematch', phase: 'accept' });
  AudioSys.ui();
  if (Net.role === 'host') Net.restartMatchAsHost();
  // guest: the host restarts and the countdown event resets us
};
Net.declineRematch = function () {
  if (Net.wire) Net.wire.sendEv({ t: 'rematch', phase: 'decline' });
  AudioSys.ui();
  hideAll(); $('winov').classList.remove('hidden');
};
Net.restartMatchAsHost = function () {
  Net.beginMatch('host');
  startCount();
  G.serveDir = Math.random() < 0.5 ? 1 : -1;
  Net.sendCountdown();
};

/* ---------------- leave / disconnect ---------------- */
Net.leave = function () {
  if (Net.wire && Net.active) { try { Net.wire.sendEv({ t: 'leave' }); } catch (e) {} }
  Net.dropRoom();
  Net.code = null;
  Net.botM1 = null;
  Net.offerSent = false;
  G.onlineFlip = false;
  if (G.mode === 'online') G.mode = 'ai';
  if (Net.savedSettings) {
    Settings.firstTo = Net.savedSettings.firstTo;
    Settings.pace = Net.savedSettings.pace;
    Net.savedSettings = null;
    try { applySettingsToUI(); } catch (e) {}
  }
  Net.lobbyOpen = false;
};

/* The rival is gone mid-anything: freeze the table, say so, offer the menu.
 * Idempotent — safe if the room already dropped. */
Net.onRivalLeft = function () {
  if (!Net.active && !Net.waitingForRival) return;
  Net.active = false;
  Net.waitingForRival = false;
  Net.offerSent = false;
  clearCeremony();
  // freeze the sim behind the overlay (host: stop the clock; guest: stop
  // dead reckoning) so nothing keeps playing without a rival
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') {
    G.pausedFrom = G.state === 'pause' ? G.pausedFrom : 'play';
    G.state = 'pause';
  }
  Net.rsnap = null; Net.gview = null;
  hideAll();
  $('onlinedropov').classList.remove('hidden');
  AudioSys.ui();
};

/* ============================================================================
 * STUB ROOM — in-page loopback implementing the Room interface. Zero network.
 * Activated by ?netstub or Net.roomFactory. Two rooms linked by link(); a
 * send on one is delivered to the other's receive handlers after ~latencyMs.
 * ========================================================================== */
Net.createStubPair = function (latencyMs) {
  latencyMs = latencyMs == null ? 15 : latencyMs;
  function makeRoom(tag) {
    const handlers = { st: [], in: [], ev: [], join: [], leave: [] };
    const room = {
      tag,
      selfId: 'stub-' + tag + '-' + Math.random().toString(36).slice(2, 8),
      _peer: null,
      getPeers() { return room._peer ? { [room._peer.selfId]: 1 } : {}; },
      onPeerJoin(cb) { handlers.join.push(cb); },
      onPeerLeave(cb) { handlers.leave.push(cb); },
      makeAction(name) {
        const send = (data) => {
          if (room._peer) {
            const peer = room._peer, from = room.selfId;
            // structuredClone keeps the loopback honest (no shared refs)
            const copy = (typeof structuredClone === 'function') ? structuredClone(data) : JSON.parse(JSON.stringify(data));
            setTimeout(() => peer._recv(name, copy, from), latencyMs);
          }
        };
        const recv = (cb) => { handlers[name].push(cb); };
        return [send, recv, () => {}];
      },
      _recv(name, data, fromId) {
        handlers[name].forEach((cb) => { try { cb(data, fromId); } catch (e) { Net.logErr(e); } });
      },
      _fireJoin(peer) { handlers.join.forEach((cb) => { try { cb(peer.selfId); } catch (e) { Net.logErr(e); } }); },
      _fireLeave(peer) { handlers.leave.forEach((cb) => { try { cb(peer.selfId); } catch (e) { Net.logErr(e); } }); },
      leave() {
        const p = room._peer;
        room._peer = null;
        if (p) { p._peer = null; setTimeout(() => p._fireLeave(room), 10); }
      },
    };
    return room;
  }
  const a = makeRoom('a'), b = makeRoom('b');
  return {
    a, b,
    link() {
      a._peer = b; b._peer = a;
      setTimeout(() => { a._fireJoin(b); b._fireJoin(a); }, 10);
    },
  };
};

/* ============================================================================
 * DEV TEST HOOKS — headless full-flow verification. Called from the console
 * (or CDP); never invoked by the game itself. Exercises the REAL Net paths:
 * lobby UI -> create/join -> hello -> countdown -> 25Hz snapshots ->
 * dead reckoning -> ev goal -> boardKick sync -> win -> rematch -> leave.
 * Scoring is forced deterministically through the real onGoal path (no AI
 * needed) so a full first-to-N match runs in seconds, not minutes.
 * ========================================================================== */
Net.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A virtual guest: speaks the protocol against a stub room with plain
 * objects — no G, no DOM. Used to drive the REAL host side headlessly. */
Net.makeVirtualGuest = function (room, opts) {
  opts = opts || {};
  const gv = {
    hello: null, countdowns: 0, serveDirs: [], goals: [], snaps: 0,
    pauses: [], rematchPhases: [], puck: null, m1x: 0, m1y: 0,
    score: [0, 0], maxLerpCorr: 0, teleports: 0, sawLeave: false,
  };
  gv.wire = Net.wireRoom(room, {
    onPeerJoin: () => {},
    onPeerLeave: () => { gv.sawLeave = true; },
    onSt: (arr) => {
      const s = Net.decodeSnapshot(arr);
      gv.snaps++;
      if (!gv.puck) gv.puck = { x: s.px, y: s.py, vx: s.pvx, vy: s.pvy };
      else {
        const corr = Math.hypot(s.px - gv.puck.x, s.py - gv.puck.y);
        if (corr > 420) { gv.teleports++; gv.puck.x = s.px; gv.puck.y = s.py; } // guard: hard seed
        else {
          if (corr > gv.maxLerpCorr) gv.maxLerpCorr = corr;
          gv.puck.x += (s.px - gv.puck.x) * 0.5; gv.puck.y += (s.py - gv.puck.y) * 0.5;
        }
        gv.puck.vx = s.pvx; gv.puck.vy = s.pvy;
      }
      gv.m1x = s.m1x; gv.m1y = s.m1y; gv.score = [s.s0, s.s1];
      gv.wire.sendIn([PX + PW - 170, CY]); // parked mallet
    },
    onIn: () => {},
    onEv: (ev) => {
      if (ev.t === 'hello') gv.hello = ev;
      else if (ev.t === 'countdown') { gv.countdowns++; gv.serveDirs.push(ev.serveDir); }
      else if (ev.t === 'goal') gv.goals.push(ev);
      else if (ev.t === 'pause') gv.pauses.push(true);
      else if (ev.t === 'resume') gv.pauses.push(false);
      else if (ev.t === 'rematch') gv.rematchPhases.push(ev.phase);
      else if (ev.t === 'leave') gv.sawLeave = true;
    },
  });
  return gv;
};

/* A virtual host: speaks the protocol to drive the REAL guest side. */
Net.makeVirtualHost = function (room) {
  const hv = { knock: false, inputs: [], sawLeave: false, offer: false };
  hv.wire = Net.wireRoom(room, {
    onPeerJoin: () => {},
    onPeerLeave: () => {},
    onSt: () => {},
    onIn: (a) => { hv.inputs.push(a); },
    onEv: (ev) => {
      if (ev.t === 'knock') hv.knock = true;
      else if (ev.t === 'rematch' && ev.phase === 'offer') hv.offer = true;
      else if (ev.t === 'leave') hv.sawLeave = true;
    },
  });
  return hv;
};

/* Wait until cond() is true or ms elapse. */
Net.until = async function (cond, ms, tick) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (cond()) return true;
    await Net.sleep(tick || 50);
  }
  return cond();
};

/* Phase A: REAL host (this page's G) vs virtual guest. Goals are forced
 * through the real onGoal path — deterministic, no AI, seconds not minutes. */
Net.testHostVsVirtualGuest = async function (report) {
  const step = (n, c) => { report.steps.push(n + ': ' + (c ? 'ok' : 'FAIL')); if (!c) report.ok = false; };
  const pair = Net.createStubPair(10);
  Net.roomFactory = () => pair.a;
  Net.openLobby();
  step('lobby opens', !$('onlineov').classList.contains('hidden'));
  await Net.create();
  step('host waiting with code', Net.waitingForRival && /^[A-Z2-9]{4}$/.test(Net.code || ''));
  const gv = Net.makeVirtualGuest(pair.b);
  pair.link();
  gv.wire.sendEv({ t: 'knock' });
  step('host starts on knock', await Net.until(() => Net.active && G.mode === 'online' && Net.role === 'host', 3000));
  step('guest got hello+countdown', await Net.until(() => gv.hello && gv.countdowns >= 1, 3000));
  step('host settings win', gv.hello && gv.hello.firstTo === Settings.firstTo && gv.hello.theme === THEME.id);
  step('snapshots flow', await Net.until(() => gv.snaps > 20, 4000));
  step('no attract demo online', G.demo === false);
  // pause sync: host pauses -> guest sees it, host resumes -> guest sees it
  step('host reaches play', await Net.until(() => G.state === 'play', 8000));
  togglePause();
  step('pause event sent', await Net.until(() => gv.pauses[gv.pauses.length - 1] === true, 2000));
  togglePause();
  step('resume event sent', await Net.until(() => gv.pauses[gv.pauses.length - 1] === false, 2000));
  // deterministic match: force real goals until first-to-2
  const savedFirstTo = Settings.firstTo;
  Settings.firstTo = 2;
  let forced = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 60000) {
    if (G.state === 'win') break;
    if (G.state === 'play') { onGoal(0); forced++; }
    await Net.sleep(120);
  }
  step('match completed (first to 2)', G.state === 'win' && G.score[0] === 2);
  step('guest saw every goal event', gv.goals.length === forced && forced === 2);
  step('goal scores match', gv.goals.every((g, i) => g.s0 === i + 1 && g.s1 === 0));
  step('guest score in sync', gv.score[0] === 2 && gv.score[1] === G.score[1]);
  step('matchEnd flagged on the winner', gv.goals[1].matchEnd === true && gv.goals[0].matchEnd === false);
  step('dead reckoning sane (lerp corr<420, guard fired on resets)',
    gv.maxLerpCorr < 420 && gv.teleports >= 1);
  step('win card shown', !$('winov').classList.contains('hidden'));
  step('win title is role-aware', $('winTitle').textContent === 'You win');
  // rematch: virtual guest offers, host accepts through the real handler
  gv.wire.sendEv({ t: 'rematch', phase: 'offer' });
  step('host sees rematch prompt', await Net.until(() => !$('onlineov').classList.contains('hidden') && $('onlineTitle').textContent === 'Rematch?', 3000));
  Net.acceptRematch();
  step('rematch resets both', await Net.until(() => G.score[0] === 0 && G.score[1] === 0 && gv.countdowns >= 2, 4000));
  // rival leaves mid-ceremony: force a goal, drop the peer during it
  step('host reaches play again', await Net.until(() => G.state === 'play', 8000));
  onGoal(1);
  await Net.sleep(250);
  step('ceremony running', G.state === 'goal' && G.letterT > 0);
  pair.b.leave(); // rival disconnects mid-ceremony (raw drop, no event)
  step('rival-left overlay, no leak', await Net.until(() =>
    !$('onlinedropov').classList.contains('hidden') && G.letterT === 0 && G.flashA === 0, 3000));
  step('host shut down cleanly', Net.active === false && Net.waitingForRival === false);
  $('dropMenu').click();
  await Net.sleep(250);
  step('back to menu clean', G.state === 'menu' && Net.room === null && !Net.active &&
    G.onlineFlip === false && G.mode !== 'online');
  Settings.firstTo = savedFirstTo;
  Net.roomFactory = null;
  return gv;
};

/* Phase B: virtual host vs REAL guest (this page) — guest apply path. */
Net.testVirtualHostVsGuest = async function (report) {
  const step = (n, c) => { report.steps.push(n + ': ' + (c ? 'ok' : 'FAIL')); if (!c) report.ok = false; };
  const pair = Net.createStubPair(10);
  Net.roomFactory = () => pair.a;
  const hv = Net.makeVirtualHost(pair.b);
  Net.openLobby();
  Net.uiShow('join');
  await Net.join('TEST');
  step('guest knocking', $('onlineTitle').textContent === 'Knocking');
  pair.link();
  await Net.sleep(200);
  // the virtual host speaks first: settings, then the countdown
  hv.wire.sendEv({ t: 'hello', firstTo: 3, pace: 'classic', theme: 'deco' });
  step('guest joined (hello applied)', await Net.until(() => Net.active && Net.role === 'guest', 3000));
  step('host settings win', Settings.firstTo === 3);
  step('guest view flipped', G.onlineFlip === true);
  hv.wire.sendEv({ t: 'countdown', serveDir: 1 });
  step('guest countdown + serve sync', await Net.until(() => G.state === 'count', 3000) && G.serveDir === 1);
  // stream snapshots: puck flying; guest dead-reckons between them
  const realKick = boardKick;
  let kicks = 0;
  boardKick = (s) => { kicks++; realKick(s); };
  const snap = [900, 520, -1400, 60, 300, 520, 1100, 520, 0, 0, 2, 0, 0];
  for (let i = 0; i < 25; i++) { hv.wire.sendSt(snap); await Net.sleep(40); }
  step('guest renders puck from wire', Math.abs(G.puck.x - 900) < 260);
  step('guest input reaches host', hv.inputs.length > 3);
  // goal event -> ceremony + boardKick in sync, score NOT double-counted
  hv.wire.sendEv({ t: 'goal', scorer: 1, s0: 0, s1: 1, matchEnd: false });
  step('guest ceremony runs', await Net.until(() => G.state === 'goal' && G.letterT > 0, 2000));
  step('guest boardKick fired once', kicks === 1);
  step('guest score exact (no double count)', G.score[0] === 0 && G.score[1] === 1);
  // rival leaves mid-ceremony -> overlay, no leak
  hv.wire.sendEv({ t: 'leave' });
  step('rival-left overlay', await Net.until(() => !$('onlinedropov').classList.contains('hidden'), 3000));
  step('no ceremony leak', G.letterT === 0 && G.flashA === 0);
  step('guest sim frozen', G.state === 'pause');
  boardKick = realKick;
  $('dropMenu').click();
  await Net.sleep(250);
  step('guest back to menu, settings restored',
    !$('menu').classList.contains('hidden') && Net.room === null &&
    G.onlineFlip === false && Settings.firstTo === 7);
  Net.roomFactory = null;
};

/* Full headless run: both phases, error capture, settings restore. */
Net.testFullMatch = async function () {
  const report = { steps: [], ok: true, errors: [] };
  const errs = [];
  const onErr = (e) => errs.push(e.message || String(e));
  window.addEventListener('error', onErr);
  const savedFirstTo = Settings.firstTo, savedPace = Settings.pace;
  const savedMode = G.mode;
  try {
    report.steps.push('--- phase A: real host vs virtual guest ---');
    await Net.testHostVsVirtualGuest(report);
    report.steps.push('--- phase B: virtual host vs real guest ---');
    await Net.testVirtualHostVsGuest(report);
  } catch (e) {
    report.ok = false;
    report.steps.push('EXCEPTION: ' + (e && e.message));
  }
  window.removeEventListener('error', onErr);
  report.errors = errs.concat((window.__errs || []).map((e) => e.msg));
  report.ok = report.ok && report.errors.length === 0;
  Settings.firstTo = savedFirstTo; Settings.pace = savedPace;
  try { applySettingsToUI(); } catch (e) {}
  // always leave the page in a clean menu state
  try { Net.dropRoom(); } catch (e) {}
  Net.roomFactory = null;
  G.onlineFlip = false;
  if (G.mode === 'online') G.mode = savedMode === 'online' ? 'ai' : savedMode;
  clearCeremony();
  hideAll(); $('menu').classList.remove('hidden'); $('topbar').classList.add('hidden');
  G.state = 'menu'; G.idleT = 0; G.demo = false;
  Net.lobbyOpen = false;
  return report;
};
