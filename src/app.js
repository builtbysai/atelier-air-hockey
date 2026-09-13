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
 *       [px,py,pvx,pvy, m1x,m1y, m2x,m2y, s0,s1, flags, top, br, sv0, sv1]
 *        0-3  puck position / velocity (rink units, units/s)
 *        4-5  host mallet (m1) position
 *        6-7  guest mallet (m2) position (echo)
 *        8-9  scores [side0, side1]
 *        10   flags bitfield: 1=count 2=play 4=goal 8=pause 16=win 32=matchpoint
 *        11   host topSpeed (rounded, for the guest's win card)
 *        12   host bestRally (int, for the guest's win card)
 *        13-14 host saves [side0, side1]
 *
 *   in  guest -> host, ~30 Hz. Array [tx, ty]: guest mallet target, rink units.
 *
 *   ev  either direction, event objects {t, ...}:
 *       {t:'knock'}                      guest->host: "I'm here, start if waiting"
 *       {t:'hello', firstTo, pace, theme} host->guest: match settings (host wins)
 *       {t:'countdown', serveDir, svx, svy, gw} host->guest: begin the countdown + the rolled serve + host's goal-mouth width
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
 * ==========================================================================*/

const Net = {
  // ---- lifecycle state ----
  room: null,          // Room (Trystero or stub)
  wire: null,          // {sendSt, sendIn, sendEv} from wireRoom()
  role: null,          // 'host' | 'guest' once a match is live
  active: false,       // true while a match owns the room
  code: null,          // 6-character room code
  waitingForRival: false,
  peerId: null,        // the one accepted rival; all other peers are ignored
  opToken: 0,          // invalidates async create/join work after Cancel

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

  // ---- connection quality (display only — never affects net behavior) ----
  conn: { rtt: -1, pingId: 0, pendingTs: 0, pingAcc: 0 }, // RTT ms of last pong

  // ---- plumbing ----
  _trystero: null,     // cached dynamic import
  joinTimer: 0,
  offerSent: false     // rematch offer already sent this win screen
};

/* Unambiguous code alphabet: no 0/O, 1/I/L. */
const NET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function netGenCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += NET_ALPHABET[(Math.random() * NET_ALPHABET.length) | 0];
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

/* Dynamic import — the only network touch, and only after Online is used. */
Net.trystero = async function () {
  if (!('RTCPeerConnection' in window) || !window.crypto || !crypto.subtle)
    throw new Error('This browser does not support the WebRTC features required for online play.');
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
  recvSt((data, peerId) => { try { h.onSt(data, peerId); } catch (e) { Net.logErr(e); } });
  recvIn((data, peerId) => { try { h.onIn(data, peerId); } catch (e) { Net.logErr(e); } });
  recvEv((data, peerId) => { try { h.onEv(data, peerId); } catch (e) { Net.logErr(e); } });
  room.onPeerJoin((id) => { try { h.onPeerJoin(id); } catch (e) { Net.logErr(e); } });
  room.onPeerLeave((id) => { try { h.onPeerLeave(id); } catch (e) { Net.logErr(e); } });
  return { sendSt, sendIn, sendEv };
};
Net.logErr = function (e) { console.warn('[Atelier net]', e); };

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
    Math.round(G.stats ? G.stats.topSpeed : 0), G.stats ? G.stats.bestRally : 0,
    G.stats ? G.stats.saves[0] : 0, G.stats ? G.stats.saves[1] : 0];
};
Net.decodeSnapshot = function (a) {
  return {
    px: a[0], py: a[1], pvx: a[2], pvy: a[3],
    m1x: a[4], m1y: a[5], m2x: a[6], m2y: a[7],
    s0: a[8], s1: a[9], flags: a[10],
    top: a[11] || 0, br: a[12] || 0, sv0: a[13] || 0, sv1: a[14] || 0,
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
    B.innerHTML = '<p class="online-note">Hosting is instant — share the 6-character code ' +
      'and your rival joins straight in. Your table, your rules: ' +
      'the host\u2019s table and settings win.</p>';
    setBtn(P, 'Host a table', () => Net.create());
    setBtn(Q, 'Join with a code', () => Net.uiShow('join'));
  } else if (mode === 'join') {
    T.textContent = 'Join a table';
    S.textContent = 'Enter the 6-character code from your rival.';
    B.innerHTML = '<input id="onlineCodeInput" class="online-input" maxlength="6" ' +
      'autocomplete="off" autocapitalize="characters" spellcheck="false" ' +
      'placeholder="····" aria-label="Table code">';
    setBtn(P, 'Knock', () => Net.join(($('onlineCodeInput') || {}).value || ''));
    setBtn(Q, 'Back', () => Net.uiShow('choose'));
    setTimeout(() => {
      try {
        const input = $('onlineCodeInput');
        input.focus({ preventScroll: true });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); P.click(); } });
      } catch (e) { console.warn('Could not focus code field', e); }
    }, 60);
  } else if (mode === 'opening') {
    T.textContent = 'Opening table';
    S.textContent = 'Preparing a secure peer-to-peer room.';
    B.innerHTML = '<p class="online-note pulse">Connecting&hellip;</p>';
    setBtn(P, 'Cancel', () => Net.cancelLobby());
    setBtn(Q, null);
  } else if (mode === 'waiting') {
    T.textContent = 'Table hosted';
    S.textContent = 'Share this code with your rival.';
    B.innerHTML = '<div class="online-code">' + (data.code || '······') + '</div>' +
      '<div class="invite-actions"><button class="btn" id="copyInvite">Copy invite</button><button class="btn" id="shareInvite">Share invite</button></div>' +
      '<p class="online-note pulse">Waiting for a rival&hellip;</p>';
    setBtn(P, 'Cancel', () => Net.cancelLobby());
    setBtn(Q, null);
    const copy = $('copyInvite'), share = $('shareInvite');
    if (copy) copy.onclick = () => Net.copyInvite(data.code || '');
    if (share) {
      share.classList.toggle('hidden', !navigator.share);
      share.onclick = () => Net.shareInvite(data.code || '');
    }
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

Net.inviteUrl = function (code) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('join', code);
  return u.toString();
};
Net.copyInvite = async function (code) {
  const text = 'Join my Atelier Air Hockey table: ' + Net.inviteUrl(code);
  try {
    await navigator.clipboard.writeText(text);
    const b = $('copyInvite'); if (b) { b.textContent = 'Copied'; setTimeout(() => { if (b) b.textContent = 'Copy invite'; }, 1400); }
  } catch (e) { Net.uiError('Could not copy automatically — copy the table code instead.'); }
};
Net.shareInvite = async function (code) {
  if (!navigator.share) return Net.copyInvite(code);
  try { await navigator.share({ title: 'Atelier Air Hockey', text: 'Join my table', url: Net.inviteUrl(code) }); }
  catch (e) { if (e && e.name !== 'AbortError') Net.uiError('Could not open the share sheet.'); }
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
  const token = ++Net.opToken;
  Net.uiShow('opening');
  try {
    const { joinRoom } = await Net.trystero();
    if (token !== Net.opToken) return;
    const code = netGenCode();
    const room = await Net.makeRoom(joinRoom, code);
    if (token !== Net.opToken) { try { room.leave(); } catch (e) {} return; }
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
  const token = ++Net.opToken;
  const code = (rawCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
  if (code.length !== 6) { Net.uiError('That code needs 6 characters — check it and try again.'); return; }
  Net.uiShow('knocking', { code });
  try {
    const { joinRoom } = await Net.trystero();
    if (token !== Net.opToken) return;
    const room = await Net.makeRoom(joinRoom, code);
    if (token !== Net.opToken) { try { room.leave(); } catch (e) {} return; }
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
  Net.opToken++;
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
    onSt: (a, id) => Net.onSnapshot(a, id),
    onIn: (a, id) => Net.onInput(a, id),
    onEv: (ev, id) => Net.onEvent(ev, id),
  });
};
/* Drop the room object without ceremony (cancel paths). */
Net.dropRoom = function () {
  try { if (Net.room) Net.room.leave(); } catch (e) {}
  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null;
  Net.active = false; Net.waitingForRival = false;
  Net.resetConn(); // chip hides with the match
};

Net.acceptPeer = function (id) {
  if (!id) return false;
  if (!Net.peerId) Net.peerId = id;
  return id === Net.peerId;
};
Net.onPeerJoin = function (id) {
  if (!Net.acceptPeer(id)) return;
  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();
  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });
};
Net.onPeerLeave = function (id) {
  if (id !== Net.peerId) return;
  Net.peerId = null;
  if (Net.active || Net.waitingForRival) Net.onRivalLeft();
};

Net.onSnapshot = function (a, peerId) {
  if (Net.role !== 'guest' || !Net.active || !Net.acceptPeer(peerId)) return;
  if (!Array.isArray(a) || a.length < 15 || !a.slice(0, 15).every(Number.isFinite)) return;
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

Net.onInput = function (a, peerId) {
  if (Net.role !== 'host' || !Net.active || !Net.acceptPeer(peerId)) return;
  if (!Array.isArray(a) || a.length < 2 || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) return;
  Net.remote.tx = clamp(a[0], CX + MALLET_R, PX + PW - MALLET_R);
  Net.remote.ty = clamp(a[1], PY + MALLET_R, PY + PH - MALLET_R);
};

Net.onEvent = function (ev, peerId) {
  if (!Net.acceptPeer(peerId) || !ev || typeof ev !== 'object' || typeof ev.t !== 'string') return;
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
    case 'restart-req':
      // ONLINE: guest asks mid-match for a restart — host authority performs
      // it; the countdown event pulls the guest along via Net.onCountdown.
      if (Net.role === 'host' && Net.active) Net.restartMatchAsHost();
      break;
    case 'leave':
      if (Net.active || Net.waitingForRival) Net.onRivalLeft();
      break;
    // connection-quality probe: the echo rides the event channel but is
    // display-only — it never touches snapshots, inputs, or game state.
    case 'ping':
      if (Net.wire && Net.active) { try { Net.wire.sendEv({ t: 'pong', id: ev.id, ts: ev.ts }); } catch (e) {} }
      break;
    case 'pong':
      Net.onPong(ev);
      break;
  }
};

/* RTT probe: both sides ping every 2.5s while a match is live; each side
 * measures its OWN round trip and paints its OWN chip. */
Net.sendPing = function () {
  if (!Net.wire || !Net.active) return;
  Net.conn.pingId++;
  Net.conn.pendingTs = performance.now();
  try { Net.wire.sendEv({ t: 'ping', id: Net.conn.pingId, ts: Net.conn.pendingTs }); } catch (e) {}
};

Net.onPong = function (ev) {
  if (!ev || ev.id !== Net.conn.pingId || typeof ev.ts !== 'number') return;
  Net.conn.rtt = Math.max(0, Math.round(performance.now() - ev.ts));
  Net.paintConn();
};

/* Quality chip in the topbar: dot + RTT ms. Pure display; the chip hides
 * itself the moment we're not in a live online match. */
Net.paintConn = function () {
  const chip = $('connChip');
  if (!chip) return;
  const live = Net.active && G.mode === 'online';
  chip.classList.toggle('hidden', !live);
  if (!live) return;
  const dot = chip.querySelector('i');
  const label = chip.querySelector('em');
  const rtt = Net.conn.rtt;
  const cls = rtt < 0 ? 'unknown' : rtt < 120 ? 'good' : rtt < 300 ? 'fair' : 'poor';
  dot.className = cls;
  label.textContent = rtt < 0 ? '–ms' : rtt + 'ms';
};

Net.resetConn = function () {
  Net.conn.rtt = -1; Net.conn.pingId = 0; Net.conn.pendingTs = 0; Net.conn.pingAcc = 0;
  Net.paintConn();
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
  Net.resetConn(); // fresh RTT chip for this match
  Net.remote.tx = PX + PW - 170; Net.remote.ty = CY;
};

/* Host: a rival arrived — start the match, send the settings, count down. */
Net.startHostMatch = function () {
  if (Net.active || !Net.waitingForRival) return;
  Net.beginMatch('host');
  Net.sendHello();
  startCount();
  rollServe(Math.random() < 0.5 ? 1 : -1); // host rolls the serve once
  Net.sendCountdown();
};

/* Guest: the host's settings win. Stash our own, apply theirs, wait. */
Net.onHello = function (ev) {
  clearTimeout(Net.joinTimer);
  Net.savedSettings = { firstTo: Settings.firstTo, pace: Settings.pace, theme: THEME.id };
  if ([5, 7, 11].includes(+ev.firstTo)) Settings.firstTo = +ev.firstTo;
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
  // the host's goal-mouth width for this match (v20); 0/missing = old host,
  // fall back to the guest's own setting
  G.gwNet = (ev && Number.isFinite(ev.gw)) ? clamp(ev.gw, 150, 260) : 0;
  if (ev && (ev.serveDir === 1 || ev.serveDir === -1)) G.serveDir = ev.serveDir;
  if (ev && Number.isFinite(ev.svx) && Number.isFinite(ev.svy)) {
    G.serveVX = clamp(ev.svx, -PUCK_MAX, PUCK_MAX); G.serveVY = clamp(ev.svy, -PUCK_MAX, PUCK_MAX); // host's rolled serve
  } else if (G.serveDir) {
    rollServe(G.serveDir); // old-host fallback: roll locally
  }
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
  if (paused && G.state !== 'pause') togglePause(true, true);
  else if (!paused && G.state === 'pause') togglePause(false, true);
};

/* ---------------- per-frame ---------------- */
/* Host: snapshots @25Hz. Guest: input @30Hz + dead reckoning every frame.
 * No-op unless a match is live. */
Net.pump = function (rdt) {
  if (!Net.active || !Net.wire) return;
  // RTT probe: cheap, on the event channel, display-only
  Net.conn.pingAcc += rdt;
  if (Net.conn.pingAcc >= 2.5) { Net.conn.pingAcc = 0; Net.sendPing(); }
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
    // saves are monotonic counters — take the host's max, same as top speed
    if (s.sv0 > G.stats.saves[0]) G.stats.saves[0] = s.sv0;
    if (s.sv1 > G.stats.saves[1]) G.stats.saves[1] = s.sv1;
  }
};

/* ---------------- events out ---------------- */
Net.sendHello = function () {
  Net.wire.sendEv({ t: 'hello', firstTo: Settings.firstTo, pace: Settings.pace, theme: THEME.id });
};
// The serve vector rides along so both machines play the identical point —
// the host's roll is the source of truth, the guest just applies it.
// gw carries the host's goal-mouth width (v20) so the guest renders and
// (via the host's snapshots) plays the same table.
Net.sendCountdown = function () {
  Net.wire.sendEv({ t: 'countdown', serveDir: G.serveDir,
    svx: Math.round(G.serveVX * 10) / 10, svy: Math.round(G.serveVY * 10) / 10,
    gw: Math.round(goalW()) });
};
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
  rollServe(Math.random() < 0.5 ? 1 : -1); // host rolls the serve once
  Net.sendCountdown();
};

/* ---------------- leave / disconnect ---------------- */
Net.leave = function () {
  if (Net.wire && Net.active) { try { Net.wire.sendEv({ t: 'leave' }); } catch (e) {} }
  Net.dropRoom();
  Net.code = null;
  Net.offerSent = false;
  G.onlineFlip = false;
  if (G.mode === 'online') G.mode = 'ai';
  if (Net.savedSettings) {
    Settings.firstTo = Net.savedSettings.firstTo;
    Settings.pace = Net.savedSettings.pace;
    if (Net.savedSettings.theme && THEMES[Net.savedSettings.theme]) setTheme(Net.savedSettings.theme, true);
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
  Net.paintConn(); // active is false now — the chip hides itself
  AudioSys.ui();
};

/* ============================================================
   ATELIER AIR HOCKEY — engine v2
   Rebuilt from research: Brunswick 1969 roots, near-zero-friction
   puck glide, velocity-transfer striking, human-like AI, and the
   full juice canon (hit-stop, trauma shake + rotation, particles,
   squash, trails, scuff permanence, slow-mo goal ceremony).
   Single file. Mobile-first. No external assets but fonts.
   ============================================================ */
'use strict';

// ---------- dimensions (2:1 rink, USAA-style proportions) ----------
const VW = 1440, VH = 1040;          // view space
const PX = 200, PY = 200, PW = 1040, PH = 640;  // playfield
const CX = PX + PW / 2, CY = PY + PH / 2;
const PUCK_R = 26, MALLET_R = 46, RAIL = 26;
// Goal-mouth presets (v20): adjustable in Settings → Goal mouth. Standard is
// the new default — narrower than the old fixed 230 (36% of the wall was
// swallowing deflections). The host's choice rides the countdown event
// online; guests apply it as a match-scoped override (G.gwNet).
const GOAL_W = 230; // the Wide preset; legacy fixed width — use goalW() below
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
  sound: true,
  haptics: true,
  firstTo: 7,         // 5 | 7 | 11
  pace: 'classic',     // 'casual' | 'classic' | 'lightning'
  effects: 'full',     // 'full' | 'subtle' | 'minimal' — spectacle scaler, never touches physics
  goalW: 'standard',   // 'narrow' | 'standard' | 'wide' — goal-mouth width (v20)
};
// prefers-reduced-motion: detected at boot; userShake remembers whether the
// player explicitly chose a shake level (their choice always wins).
const PRM = { reduce: false, userShake: false };
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('atelier-ah-settings') || '{}');
    PRM.userShake = Object.prototype.hasOwnProperty.call(s, 'shake');
    for (const k of Object.keys(Settings)) if (s[k] !== undefined) Settings[k] = s[k];
  } catch (e) {}
  if (![5, 7, 11].includes(Settings.firstTo)) Settings.firstTo = 7;
  if (!['off', 'subtle', 'full'].includes(Settings.shake)) Settings.shake = 'full';
  if (!['casual', 'classic', 'lightning'].includes(Settings.pace)) Settings.pace = 'classic';
  if (!['full', 'subtle', 'minimal'].includes(Settings.effects)) Settings.effects = 'full';
  if (!['narrow', 'standard', 'wide'].includes(Settings.goalW)) Settings.goalW = 'standard';
}
// Effects scalers — one place to look up how much spectacle is allowed.
// Physics, pacing, and AI never consult these.
const fxParticles = () => Settings.effects === 'minimal' ? 0.35 : Settings.effects === 'subtle' ? 0.65 : 1;
const fxTrail = () => Settings.effects === 'minimal' ? 0.5 : Settings.effects === 'subtle' ? 0.75 : 1;
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
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
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
// repaint every menu record line — call after results are stored and whenever
// the menu is shown (Record.line returns '' so unplayed rivals stay clean)
function refreshRecordLines() {
  document.querySelectorAll('[data-rec]').forEach(el => {
    el.textContent = el.dataset.rec === 'p2p' ? recordLine2p() : Record.line(el.dataset.rec);
  });
}

// ---------- personal bests ----------
// Per matchup ('ai0' | 'ai1' | 'ai2' | 'p2p'): fastest win, top puck speed,
// longest rally, biggest margin. Checked in showWin(); beaten records earn a
// ★ line on the win card. Same local-only rule as Record — online matches
// are session-only, netcode never touches this module.
const Best = {
  key: 'atelier-ah-best',
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
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
const FEATS = [
  { id: 'shutout',   name: 'SHUTOUT',   desc: 'a clean sheet' },
  { id: 'comeback',  name: 'COMEBACK',  desc: 'won from three down' },
  { id: 'hattrick',  name: 'HAT-TRICK', desc: 'three goals on the spin' },
  { id: 'speedster', name: 'SPEEDSTER', desc: 'puck past 60 km/h' },
  { id: 'grandtour', name: 'GRAND TOUR', desc: 'all nine tables conquered' },
];
const Feats = {
  key: 'atelier-ah-feats',
  data: {},
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
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
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (e) { this.data = {}; }
  },
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
// repaint the tour counter + conquered pips — call on boot and whenever the
// menu is shown (Tour data only changes at match end)
function refreshTour() {
  document.querySelectorAll('.tslide').forEach(el =>
    el.classList.toggle('won', Tour.won(el.dataset.theme)));
  const tc = $('tourCount');
  if (tc) tc.textContent = 'TOUR ' + Tour.count() + '/' + THEME_ORDER.length;
}
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
// Real tables: puck floats on air jets — near-zero friction. A good shove
// crosses an 8ft table several times. Damping here is exponential /s.
const PUCK_DAMP = 0.09;              // default damping; pace setting overrides at runtime
const WALL_REST = 0.95;              // default rail restitution; pace setting overrides at runtime
const PUCK_MAX = 3100;               // fastest pro smash, in units/s
const STRIKE_XFER = 1.45;            // mallet->puck velocity transfer
const SMACK_BONUS = 0.55;            // extra punch on fast flicks
const SUB_HZ = 240;                  // physics substeps (anti-tunnel)
const STALL_V = 130, STALL_T = 1.4;  // anti-dead-puck trigger

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rand = (a, b) => a + Math.random() * (b - a); // themes.js uses rand(a,b)
const hyp = Math.hypot;
// '#rrggbb' + alpha -> 'rgba(...)' — theme hexes need alpha for glow overlays
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'rgba(216,169,63,' + a + ')';
  const n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
let interacted = false; // set on first real pointer input (gates vibrate)

// ---------- procedural audio ----------
const AudioSys = {
  ctx: null, master: null, muted: false,
  init() {
    if (this.ctx) { this._ensureAmbience(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.syncMute(); // honor the persisted sound setting (boot w/ sound off)
    } catch (e) { /* silent */ }
    this._ensureAmbience();
  },
  // starts the pending room's bed once a ctx exists (autoplay-safe: only
  // called from init(), which only runs on real user input)
  _ensureAmbience() { if (this.ctx && this.ambKey) this.ambience(this.ambKey); },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; return this.muted; },
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
    src.connect(hp); hp.connect(g1); g1.connect(this.master);
    src.start(t);
    // body
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = (170 + p * 460) * vr;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.55 * p + 0.06, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    o.connect(g2); g2.connect(this.master);
    o.start(t); o.stop(t + 0.12);
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
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  },
  // save thud: a soft low knock for goal-line blocks — felt, not announced
  thud() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g); g.connect(this.master);
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
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.24);
    });
  },
  // goal-frame clank: a heavier metallic knock than the post ping — the
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
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.5);
    });
    // the metal-on-metal knock: a short burst of filtered noise up front
    const src = this.ctx.createBufferSource(); src.buffer = this._noiseBuf();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.22 * p, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(bp); bp.connect(ng); ng.connect(this.master);
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
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.1);
  },
  goalChord(notes) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.75);
    });
    // air swell
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.7;
    const g = this.ctx.createGain(); g.gain.value = 0.25;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0);
  },
  blip(f, dur = 0.09, vol = 0.3) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  ui() { this.blip(1150, 0.05, 0.18); },
  count(final) { this.blip(final ? 990 : 620, final ? 0.28 : 0.12, 0.32); },
  // ---------- room ambience (generated, no assets) ----------
  // Subtle per-room bed (looped shaped noise) plus sparse random events:
  // jazz-room bass plucks, poolside laps, a concrete-hall wash, felt hush,
  // loft murmur swells with the odd glass clink, machiya rain and wood
  // creaks. Levels sit well under SFX. Everything routes through master, so
  // Mute silences it. The bed only ever exists after init(), which runs
  // solely on real user input (autoplay-safe). Switching rooms crossfades
  // the bed instead of clicking.
  ambKey: null, amb: null, ambTimer: null,
  ambience(id) { // public: called from setTheme()
    if (!ROOM_AMB[id]) id = 'deco';
    this.ambKey = id;
    if (this.ctx && (!this.amb || this.amb.key !== id)) this._startAmbience();
  },
  syncMute() { if (this.master) this.master.gain.value = this.muted ? 0 : 0.5; },
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
    src.connect(flt); flt.connect(g); g.connect(this.master);
    const nodes = { key: this.ambKey, src, flt, g, cfg, wet: [] };
    // brut hall: a short feedback delay as a cheap room wash on the bed
    if (cfg.bed.hall) {
      const dly = this.ctx.createDelay(1); dly.delayTime.value = 0.31;
      const fb = this.ctx.createGain(); fb.gain.value = 0.35;
      const wet = this.ctx.createGain(); wet.gain.value = 0.5;
      g.connect(dly); dly.connect(fb); fb.connect(dly);
      dly.connect(wet); wet.connect(this.master);
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
    if (!this.amb || !this.ctx || this.muted || this.ctx.state !== 'running') return;
    const a = this.amb, cfg = a.cfg, t = this.ctx.currentTime;
    // the loft murmurs: slow random swells on the bed
    if (cfg.bed.swell) a.g.gain.setTargetAtTime(cfg.bed.g * rnd(0.7, 1.3), t, 1.2);
    for (const ev of cfg.events) if (Math.random() < ev.p) this[ev.f]();
  },
  // --- sparse one-shot events (all check muted via _ambTick) ---
  _bass() { // distant upright pluck in the jazz room
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = [55, 65.41, 73.42, 82.41, 98][Math.floor(rnd(5))];
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.055, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.6);
  },
  _mote() { // faint piano-ish mote, A-minor colour
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.value = [110, 130.81, 146.83, 164.81, 220][Math.floor(rnd(5))];
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.028, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(g); g.connect(this.master);
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
    src.connect(hp); hp.connect(g); g.connect(this.master);
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
      o.connect(g); g.connect(this.master);
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
    o.connect(g); g.connect(this.master);
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
};
function buzz(pat) { try { if (interacted && Settings.haptics && navigator.vibrate) navigator.vibrate(pat); } catch (e) {} }

// ---------- game state ----------
// whiff: per-strike chance the AI swings clean through (a human error, never a
// superhuman stat — it only ever makes rivals weaker). windup: telegraph time.
const DIFFS = [
  { name: 'Rookie',   maxSpeed: 780,  react: 0.30, aimErr: 100, strike: 0.62, aggro: 0.50, tick: 0.14, whiff: 0.12, windup: 0.11 },
  { name: 'Club Pro', maxSpeed: 1180, react: 0.13, aimErr: 45,  strike: 1.00, aggro: 0.70, tick: 0.09, whiff: 0.03, windup: 0.11 },
  { name: 'Champion', maxSpeed: 1520, react: 0.10, aimErr: 34,  strike: 1.25, aggro: 0.95, tick: 0.06, whiff: 0.01, windup: 0.14 },
];
const PLAYER_CAP = 4200; // mallet tracking cap — 1:1 feel, no teleporting

const G = {
  state: 'menu',            // menu | count | play | goal | win | pause
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
  scuffs: [], parts: [], trail: [], texts: [], pulses: [],
  puckSq: 1, puckSqA: 0,    // squash amount / angle
  letterT: 0, flashA: 0,
  hitFlash: 0, hitFlashX: 0, hitFlashY: 0, // SMASH-tier impact flash
  roomPulse: 0,             // room reactivity: decays, feeds the lamp-glow overlay
  saveT: 0,                 // save-moment puck glow timer
  nearCd: 0, dipT: 0,       // near-miss cooldown + shared time-dip timer
                              // (near-miss dip and SMASH slow-mo beat)
  missGlow: null,           // { side, t } post glow after a near miss
  rattle: null,             // { side, t } goal-frame rattle after a hard frame hit
  goalFrameT: 0,            // goal-frame flash timer
  board: freshBoard(),      // scoreboard animation state
  ai: null,                 // per-ai brain state
  stats: null,              // per-match stats (top speed, rally, time)
  onlineFlip: false,        // ONLINE: guest view is mirrored — they play from their own side
  hintLive: false,          // first-time hint currently showing on the table
  themeId: 'deco',          // current table id (setTheme) — feeds the tour tracker
};
function freshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, saves: [0, 0], t0: 0, streak: [0, 0], bestStreak: [0, 0], worstDef: [0, 0] }; }
G.stats = freshStats();
const pointers = new Map(); // pointerId -> side (0 left/player, 1 right)

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
  };
}
function resetPositions() {
  const m1 = G.m1, m2 = G.m2;
  m1.x = m1.tx = PX + 170; m1.y = m1.ty = CY;
  m2.x = m2.tx = PX + PW - 170; m2.y = m2.ty = CY;
  m1.vx = m1.vy = m2.vx = m2.vy = 0;
  for (const m of [m1, m2]) { m.glueT = 0; m.ghostT = 0; m.touching = false; m.trail.length = 0; }
  G.puck = { x: CX, y: CY, vx: 0, vy: 0, r: PUCK_R, w: 0, ang: 0 };
  G.trail.length = 0; G.stallT = 0; G.lastTouch = -1;
  G.stallX = CX; G.stallY = CY; G.anchorT = 0;
  G.puckSq = 1;
}
G.m1 = mkMallet(0); G.m2 = mkMallet(1);

// ---------- view / input mapping ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let view = { w: 0, h: 0, s: 1, ox: 0, oy: 0, portrait: false };

function resize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  view.w = w; view.h = h;
  view.portrait = h > w * 1.05;
  if (!view.portrait) {
    view.s = Math.min(w / VW, h / VH);
    view.ox = (w - VW * view.s) / 2; view.oy = (h - VH * view.s) / 2;
  } else {
    view.s = Math.min(w / VH, h / VW);
    view.ox = (w - VH * view.s) / 2; view.oy = (h - VW * view.s) / 2;
  }
  view.dpr = dpr;
  paintRoom();
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
  const { s, ox, oy, portrait } = view;
  const u = (cx - ox) / s, v = (cy - oy) / s;
  let x, y;
  if (!portrait) { x = u; y = v; }
  else { x = VW - v; y = VH - u; }
  if (G.onlineFlip) x = VW - x; // ONLINE: invert the guest view mirror
  return { x, y };
}
// ONLINE: scoreboard / win / ribbon labels by side (0 = left/host, 1 = right/guest)
function onlineSideLabel(side) {
  const amGuest = typeof Net !== 'undefined' && Net.role === 'guest';
  if (side === 0) return amGuest ? 'RIVAL' : 'YOU';
  return amGuest ? 'YOU' : 'RIVAL';
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
// move mallet toward target with a speed cap — 1:1 feel, never teleports
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
    // flood it — ~8 points of ~26u reads as a streak, not a smear
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

// Touch finger-offset (v8): the mallet floats away from the fingertip so the
// finger never covers it — the convention top mobile air hockey games use.
// Size-aware: roughly one mallet diameter of screen-space offset, scaled by
// the current view transform, so it feels right on phones and tablets.
// Direction is away from the player's own body: in portrait 2P the top
// player (side 1) gets the offset flipped so the mallet sits below the
// fingertip. Online guests are mirror-flipped to play from their own side,
// so they always keep the standard upward offset. Mouse/pen are untouched.
function touchOffsetY(side) {
  const malletScreenR = MALLET_R * (view.s || 1); // rink units -> CSS px
  const off = clamp(malletScreenR * 2.0, 40, 96); // ~one mallet diameter
  const topPlayer = view.portrait && side === 1 && G.mode === '2p';
  return topPlayer ? off : -off;
}

function onPointerDown(e) {
  AudioSys.init(); AudioSys.resume();
  interacted = true;
  if (G.state === 'menu' || G.state === 'win') return; // buttons own the UI
  const touch = e.pointerType === 'touch';
  // Side assignment uses the raw (unshifted) touch point so the vertical
  // offset can never drag a touch across the center line in portrait 2P.
  const raw = screenToRink(e.clientX, e.clientY);
  if (G.mode === 'online' && !pointers.has(e.pointerId)) {
    // ONLINE: exactly one local mallet — host plays m1, guest plays m2. No AI.
    if (pointers.size > 0) return;
    pointers.set(e.pointerId, Net.role === 'guest' ? 1 : 0);
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
  const r = screenToRink(e.clientX, e.clientY + (touch ? touchOffsetY(side) : 0));
  m.tx = r.x; m.ty = r.y;
  G.idleT = 0;
}
function onPointerMove(e) {
  if (!pointers.has(e.pointerId)) return;
  if (G.state === 'menu' || G.state === 'win') return;
  const side = pointers.get(e.pointerId);
  const touch = e.pointerType === 'touch';
  const r = screenToRink(e.clientX, e.clientY + (touch ? touchOffsetY(side) : 0));
  const m = side === 0 ? G.m1 : G.m2;
  m.tx = r.x; m.ty = r.y;
  G.idleT = 0;
}
function onPointerUp(e) { pointers.delete(e.pointerId); }

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
      onRailHit(p.x, PY, imp);
    }
  } else if (p.y > PY + PH - r) {
    p.y = PY + PH - r;
    if (p.vy > 0) {
      const imp = p.vy;
      p.vy = -p.vy * paceWall(); p.vx *= 0.995;
      onRailHit(p.x, PY + PH, imp);
    }
  }
  // end walls with goal mouths
  const inMouth = Math.abs(p.y - CY) < goalW() / 2 - 6;
  // the goal frame rings: contact just outside the mouth is a post hit
  const nearPost = !inMouth && Math.abs(p.y - CY) < goalW() / 2 + 42;
  if (p.x < PX + r && !inMouth) {
    p.x = PX + r;
    if (p.vx < 0) { const imp = -p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX, p.y, imp, nearPost); }
  } else if (p.x > PX + PW - r && !inMouth) {
    p.x = PX + PW - r;
    if (p.vx > 0) { const imp = p.vx; p.vx = -p.vx * paceWall(); p.vy *= 0.995; onRailHit(PX + PW, p.y, imp, nearPost); }
  }
}

// mallet is kinematic (infinite mass): positional separation + impulse
// with full mallet-velocity transfer, so flicks become rockets.
//
// Possession clock (stuck-puck fix): a mallet pressing the puck into a rail
// pocket defeats both anti-stall systems — constant contact keeps resetting
// G.stallT, and the displacement nudge gets smothered. So each mallet tracks
// glueT: sustained gentle contact time. Hard hits reset it; 2.5s of pressing
// (legit contact is ~0.18s) forcibly releases the puck. Rail pins squirt
// along the rail; open-ice presses pop off the mallet face. The pressing
// mallet goes ghost for 0.30s so it can't instantly re-trap.
function collideMallet(p, m, dt) {
  const dx = p.x - m.x, dy = p.y - m.y;
  const minD = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (m.ghostT > 0) { m.glueT = 0; return; } // ghostT ticks in stepPhysics
  if (d2 >= minD * minD || d2 === 0) return;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  m.touching = true;
  // --- possession clock ---
  const vn0 = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  const mvn0 = m.vx * nx + m.vy * ny;
  if (-vn0 + Math.max(0, mvn0) > 650) m.glueT = 0;
  else m.glueT += dt;
  if (m.glueT > 2.5) {
    const nearT = p.y < PY + 70, nearB = p.y > PY + PH - 70;
    const nearL = p.x < PX + 70, nearR = p.x > PX + PW - 70;
    const inMouthY = Math.abs(p.y - CY) < goalW() / 2;
    let rx = nx, ry = ny, railed = false;
    if (nearT && ry < 0) { ry = 0; railed = true; }
    if (nearB && ry > 0) { ry = 0; railed = true; }
    if (nearL && rx < 0 && !inMouthY) { rx = 0; railed = true; }
    if (nearR && rx > 0 && !inMouthY) { rx = 0; railed = true; }
    if (!railed) {
      p.x = m.x + nx * minD; p.y = m.y + ny * minD;
      p.vx = nx * 560; p.vy = ny * 560;
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
      onMalletHit(p.x, p.y, 750, rx, ry);
    }
    m.glueT = 0; G.lastTouch = m.side;
    return;
  }
  // --- normal contact ---
  p.x = m.x + nx * minD; p.y = m.y + ny * minD;
  const rvx = p.vx - m.vx, rvy = p.vy - m.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return; // separating
  // Speed-dependent restitution: a still/slow mallet SMOTHERS the puck
  // (real goalie play — the puck drops dead for possession), a driven
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
  // safety: a genuinely driven hit never dies
  const sp = hyp(p.vx, p.vy);
  const msp = hyp(m.vx, m.vy);
  if (sp < 250 && msp > 800) {
    p.vx = nx * 250; p.vy = ny * 250;
  }
  const nsp = hyp(p.vx, p.vy);
  if (nsp > PUCK_MAX) { p.vx *= PUCK_MAX / nsp; p.vy *= PUCK_MAX / nsp; }
  // english: tangential mallet velocity at contact becomes puck spin —
  // the Magnus curve is applied in stepPhysics
  const tx = -ny, ty = nx;
  const tang = (m.vx - p.vx) * tx + (m.vy - p.vy) * ty;
  p.w = clamp((p.w || 0) + tang / 260, -12, 12);
  G.lastTouch = m.side;
  G.stallT = 0;
  const impact = -vn + Math.max(0, mvn);
  // SAVE: a fast lateral block of a puck bound for your own goal gets the
  // soft treatment — thud, ring pulse, brief puck glow. High drama, low noise.
  if (m.saveCd <= 0 && impact > 220 && (m.side === 0 ? pvx0 < -450 : pvx0 > 450) && msp0 > 650) {
    m.saveCd = 0.9;
    G.saveT = 0.55;
    G.pulses.push({ x: p.x, y: p.y, t: 0 });
    AudioSys.thud();
    // match stat: bank a save for the defender's side (real play only — never demo)
    if (G.state === 'play' && !G.demo && G.stats) G.stats.saves[m.side]++;
  }
  // fast flicks whoosh on the way through (cooled down so rallies don't hiss)
  if (msp0 > 1300 && m.whooshT <= 0) {
    m.whooshT = 0.3;
    AudioSys.whoosh(msp0 / 3000);
  }
  onMalletHit(p.x, p.y, impact, nx, ny);
}

function stepPhysics(dt) {
  const p = G.puck;
  // glide: near-zero friction, like air jets (pace setting tunes the table)
  const damp = Math.exp(-paceDamp() * dt);
  p.vx *= damp; p.vy *= damp;
  // Magnus: puck spin (english from tangential mallet contact) curves flight.
  // |a| = K·|w|·|v| — at w=10, v=2000 that's ~600 u/s², a visible bend
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
    const m = mi === 0 ? G.m1 : G.m2; // indexed, not [G.m1, G.m2] — no alloc at 240 Hz
    if (m.ghostT > 0) m.ghostT -= dt;
    if (m.whooshT > 0) m.whooshT -= dt;
    if (m.saveCd > 0) m.saveCd -= dt;
    if (!m.touching) m.glueT = Math.max(0, m.glueT - dt * 2);
    m.touching = false;
  }
  collideMallet(p, G.m1, dt);
  collideMallet(p, G.m2, dt);
  collideWalls(p);
  // goals: full crossing of the line inside the mouth
  if (p.x > PX + PW + p.r * 0.35 && Math.abs(p.y - CY) < goalW() / 2) onGoal(0);
  else if (p.x < PX - p.r * 0.35 && Math.abs(p.y - CY) < goalW() / 2) onGoal(1);
  // near-miss drama: a fast puck kissing the goal frame without scoring —
  // a tiny time dip, a glowing post, a soft tick. Once per 1.5s max.
  if (G.state === 'play' && !G.demo && G.nearCd <= 0) {
    const dy = Math.abs(p.y - CY);
    const nearL = p.x > PX - 30 && p.x < PX + 80;
    const nearR = p.x > PX + PW - 80 && p.x < PX + PW + 30;
    if ((nearL || nearR) && dy > goalW() / 2 - 30 && dy < goalW() / 2 + PUCK_R + 26 && hyp(p.vx, p.vy) > 500) {
      G.nearCd = 1.5;
      if (fxFlash()) {
        G.dipT = 0.22;
        G.missGlow = { side: nearL ? 0 : 1, t: 0.7 };
      }
      AudioSys.blip(1500, 0.05, 0.10);
    }
  }
  // anti-stall: a real table never lets the puck die mid-rink — a whisper
  // of air from the jets keeps the game alive
  if (G.state === 'play') stallWatch(dt);
  // trail
  G.trail.push({ x: p.x, y: p.y });
  if (G.trail.length > Math.round(16 * fxTrail())) G.trail.shift();
  // squash recovery
  G.puckSq += (1 - G.puckSq) * Math.min(1, dt * 9);
}

// Anti-stall: air jets. A dead puck never sits — shared by live play and the
// attract demo so neither can freeze mid-rink.
function stallWatch(dt) {
  const p = G.puck;
  // displacement anchor: a pinned puck (constant mallet contact keeps
  // resetting stallT below) still counts as stalled if it goes nowhere.
  // The nudge aims at open ice, not random — it reads as the table
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
    aimX: 0, aimY: 0, windT: 0,
    pinT: 0, pinX: 0, pinY: 0, swayT: rnd(10), possessT: 0,
    arPhase: 0, // 'around' detour phase: 0 = sidestep clear, 1 = cross goal-side
    whiff: false, // this strike will swing clean through (a human miss)
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
function perfNow() { return performance.now() / 1000; }

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
function aiHome(b) {
  // home: goal-side, slightly favoring puck's vertical zone — with idle sway
  b.swayT += 1 / 60;
  const hx = b.side === 0 ? PX + 190 : PX + PW - 190;
  const hy = CY + (b.seen.y - CY) * 0.35 + Math.sin(b.swayT * 1.7) * 14;
  return { x: hx, y: clamp(hy, PY + 90, PY + PH - 90) };
}
function aiThink(b, dt, m) {
  const D = b.diff;
  b.tState += dt; b.tickT += dt;
  if (b.tickT < D.tick) return; // decisions at 7–16 Hz, like a human
  b.tickT = 0;
  const s = b.seen, p = G.puck;
  const myGoalX = b.side === 0 ? PX : PX + PW;
  const foeGoalX = b.side === 0 ? PX + PW : PX;
  const puckOnMySide = b.side === 0 ? s.x < CX : s.x > CX;
  const puckSpeed = hyp(s.vx, s.vy);
  const threat = (b.side === 0 ? s.vx < -500 : s.vx > 500) && puckOnMySide;

  const setTx = (x, y) => {
    m.tx = b.side === 0 ? clamp(x, PX + MALLET_R, CX - 8) : clamp(x, CX + 8, PX + PW - MALLET_R);
    m.ty = clamp(y, PY + MALLET_R, PY + PH - MALLET_R);
  };
  const goHome = () => { const h = aiHome(b); setTx(h.x, h.y); };

  // Own-goal guard (v19): never plow through a slow puck that sits between
  // the mallet and your own net — that shove is the #1 measured own-goal
  // mechanism (AI own-goal rate was ~22% before this fix). Detour around it
  // to the goal side first. Skipped for live threats (defend handles those)
  // and for the strike sequence itself.
  if (b.state === 'guard' || b.state === 'defend') {
    const dirS = b.side === 1 ? 1 : -1; // +1 points at my own goal (right)
    const pSpd = hyp(p.vx, p.vy);
    const towardMe = dirS * p.vx > 150;      // live dribble — defend it, don't dodge
    const between = dirS * (p.x - m.x) > 0;  // puck sits between me and my net
    const close = hyp(p.x - m.x, p.y - m.y) < MALLET_R + PUCK_R + 80;
    if (!towardMe && pSpd < 450 && between && close) {
      b.state = 'around'; b.tState = 0; b.arPhase = 0;
    }
  }

  // pin rescue: if I'm smothering the puck into my corner and it hasn't gone
  // anywhere, I'm the trap — back off and dig it out. Speed-based checks
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
      goHome();
      if (threat) { b.state = 'defend'; b.tState = 0; }
      else if (puckOnMySide && puckSpeed < 1200 && Math.random() < D.aggro) { b.state = 'engage'; b.tState = 0; }
      break;
    }
    case 'around': {
      // OWN-GOAL DETOUR (v19): a slow puck sits between the mallet and my
      // net — driving through it shoves it in. Two beats: sidestep clear
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
      // a live threat cancels the detour — go block it
      if (threat) { b.state = 'defend'; b.tState = 0; }
      b.tState += D.tick; break;
    }
    case 'defend': {
      // intercept the predicted trajectory in front of goal
      const tHit = clamp(Math.abs((s.x - (b.side === 0 ? PX + 150 : PX + PW - 150)) / (s.vx || 1)), 0, 1.1);
      const pr = predictPuck(s.x, s.y, s.vx, s.vy, tHit * 0.85);
      const gx = b.side === 0 ? PX + 130 : PX + PW - 130;
      // deflection steering (v19): meet the puck slightly toward the mouth
      // CENTER from its lane, so the contact normal kicks deflections toward
      // the walls instead of into your own mouth. Only near the mouth — far
      // from it the lane coverage matters more than the deflection angle.
      const nearMouth = Math.abs(pr.y - CY) < goalW() / 2 + 60;
      const steerY = nearMouth ? (CY - pr.y) * 0.25 : 0;
      setTx(gx + (pr.x - gx) * 0.35, pr.y + steerY);
      if (!threat) { b.state = 'guard'; b.tState = 0; }
      // if the puck sits in reach (smothered block, loose puck), take it
      if (puckSpeed < 900 && hyp(s.x - m.x, s.y - m.y) < 220) { b.state = 'engage'; b.tState = 0; }
      break;
    }
    case 'engage': {
      // skate to the puck — always from the GOAL side. Driving straight at
      // a puck from the far side shoves it toward your own net (the classic
      // goalie own goal), so when the mallet isn't behind the puck yet it
      // swings wide around it first, then commits.
      const dirS = b.side === 1 ? 1 : -1; // +1 = toward my own goal (right)
      // desperate block: it's coming at my net fast and I'm on the wrong
      // side — forget the footwork, go meet it (defend steers the deflection)
      if (threat && dirS * (m.x - s.x) < 40) { b.state = 'defend'; b.tState = 0; break; }
      const behind = dirS * (m.x - s.x) > 50;
      if (!behind) {
        const wy = clamp(s.y + (m.y <= s.y ? -180 : 180), PY + MALLET_R, PY + PH - MALLET_R);
        setTx(s.x + dirS * 70, wy);
      } else {
        setTx(s.x, s.y);
      }
      const d = hyp(s.x - m.x, s.y - m.y);
      // possession clock: herding the puck at close range counts as control
      if (d < MALLET_R + PUCK_R + 44) b.possessT += D.tick; else b.possessT = Math.max(0, b.possessT - D.tick);
      // windup ONLY from behind the puck — striking from the wrong side
      // blasts it into your own net
      if (behind && d < MALLET_R + PUCK_R + 26 && (puckSpeed < 700 || b.possessT > 0.35)) {
        b.state = 'windup'; b.tState = 0; b.windT = 0; b.possessT = 0;
        // pick aim: the FAR post, not the middle — the mouth corner farthest
        // from the puck's lane forces the keeper to travel across. aimErr
        // scatters the shot per difficulty, so Rookie sprays it (missing
        // often) while Champion pins the post.
        const bank = Math.random() < (b.diff === DIFFS[2] ? 0.35 : 0.12);
        b.bankY = bank ? (Math.random() < 0.5 ? PY + 40 : PY + PH - 40) : null;
        const farSide = s.y < CY ? 1 : -1;
        b.aimX = foeGoalX;
        b.aimY = CY + farSide * (goalW() / 2 - 12) + rnd(-1, 1) * D.aimErr;
      }
      if (!puckOnMySide || puckSpeed > 1700) { b.state = 'guard'; b.tState = 0; b.possessT = 0; }
      break;
    }
    case 'windup': {
      // ANTICIPATION: pull back away from the aim point — telegraphs the smash
      b.windT += D.tick;
      let ax = b.aimX, ay = b.aimY;
      if (b.bankY !== null) { ax = s.x; ay = b.bankY; } // aim at the rail first
      const dx = ax - s.x, dy = ay - s.y, dl = hyp(dx, dy) || 1;
      const back = 95;
      setTx(s.x - dx / dl * back, s.y - dy / dl * back);
      if (b.windT > D.windup) {
        // commit to the strike only if the mallet is still behind the LIVE
        // puck — it can drift during the windup, and lunging from the wrong
        // side blasts it into your own net
        const dirS = b.side === 1 ? 1 : -1;
        if (dirS * (m.x - p.x) < 30) { b.state = 'recover'; b.tState = 0; break; }
        b.state = 'strike'; b.tState = 0;
        // the whiff: a human misread, rolled per difficulty — the lunge
        // below will be offset clean past the puck
        b.whiff = Math.random() < (D.whiff || 0);
      }
      break;
    }
    case 'strike': {
      // drive THROUGH the puck toward the aim point — this is where
      // mallet velocity becomes puck velocity. Lead the puck slightly
      // so the lunge connects on a moving target.
      const dirS = b.side === 1 ? 1 : -1;
      // last-instant sanity: if the mallet somehow isn't behind the puck
      // at strike time, abort — lunging from the wrong side blasts it
      // into your own net
      if (b.tState <= D.tick * 1.5 && dirS * (m.x - p.x) < 20) {
        b.state = 'recover'; b.tState = 0; break;
      }
      const px = s.x + s.vx * 0.1, py = s.y + s.vy * 0.1;
      let ax = b.aimX, ay = b.aimY;
      if (b.bankY !== null) { ax = s.x; ay = b.bankY; }
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
      goHome();
      // a whiffed swing takes longer to gather — the embarrassment tax
      if (b.tState > (b.whiff ? 0.75 : 0.4)) { b.state = 'guard'; b.tState = 0; b.whiff = false; }
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
  // the mallet is capped to a soft speed — a fast wrong-side touch is
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
// pooled particles — no allocation in the hot loop
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

// impact events — the layered hit stack.
// Tiers around the 650 hit-stop threshold: tap (<650), drive (650–1400),
// SMASH (>1400). Each tier buys more shake, a bigger flash, and a deeper
// pitch; SMASH also startles the room itself (see G.roomPulse).
function hitTier(impact) { return impact > 1400 ? 2 : impact > 650 ? 1 : 0; }
function onMalletHit(x, y, impact, nx, ny) {
  // rally bookkeeping first — the clack pitches up ~3% per hit so long
  // rallies audibly tighten (capped at +36%)
  let rallyN = 0;
  if (G.state === 'play' && !G.demo && G.stats) {
    G.stats.rally++;
    if (G.stats.rally > G.stats.bestRally) G.stats.bestRally = G.stats.rally;
    rallyN = G.stats.rally;
  }
  const v = clamp(impact / 2200, 0, 1);
  const tier = hitTier(impact);
  const fxp = fxParticles();
  // hit-stop: 1–2 frames, scaled — the brain reads it as weight
  if (tier >= 1) G.freezeT = Math.max(G.freezeT, Math.min(tier === 2 ? 0.045 : 0.032, 0.010 + v * 0.022));
  addTrauma(tier === 2 ? 0.55 + v * 0.45 : 0.18 + v * 0.5);
  if (tier === 2) {
    if (fxFlash()) {
      G.hitFlash = 0.8; G.hitFlashX = x; G.hitFlashY = y;
      // SMASH slow-mo beat: ~90ms at the dip scale right after the 45ms
      // hit-stop — the Holedown blend (freeze, then a near-halt beat, then
      // full speed). Rides the shared dipT channel with the near-miss dip
      // (Math.max: the two never stack or extend each other); play-state
      // only, so it can never touch the goal ceremony's reserved slow-mo.
      G.dipT = Math.max(G.dipT, 0.09);
    }
    if (fxRoom()) G.roomPulse = 1;
    buzz([15, 30, 25]);
  }
  // puck squash along the impact normal, 10–20%
  G.puckSq = 1 - (0.10 + v * 0.10);
  G.puckSqA = Math.atan2(ny, nx);
  burst(x, y, Math.max(1, Math.round((5 + v * 12) * fxp)), THEME.particle, 200 + v * 480);
  if (tier === 2) burst(x, y, Math.max(1, Math.round(10 * fxp)), '#ffffff', 500 + v * 500, 3);
  // permanence: hard hits leave a fading scuff on the cloth
  if (impact > 900 && G.scuffs.length < 48) {
    G.scuffs.push({ x, y, a: 0.20, ang: Math.atan2(ny, nx) + Math.PI / 2, len: 26 + v * 40 });
  }
  AudioSys.hit(v, 1 + Math.min(rallyN, 12) * 0.03);
  if (v > 0.55) buzz(12);
}
function onRailHit(x, y, impact, isPost) {
  const v = clamp(impact / 2200, 0, 1);
  if (impact > 1100) { G.freezeT = Math.max(G.freezeT, 0.012); addTrauma(0.12 + v * 0.2); }
  if (impact > 300) burst(x, y, Math.max(1, Math.round((3 + v * 6) * fxParticles())), THEME.particle, 140 + v * 260, 2.5);
  if (isPost && impact > 900) {
    // the goal frame rattles: a hard frame hit earns a low clank and a
    // visible shake of the trim — deliberately heavier than the post ping
    AudioSys.clank(v);
    if (fxFlash()) G.rattle = { side: x < PX + PW / 2 ? 0 : 1, t: 0.42 };
    burst(x, y, Math.max(1, Math.round(10 * fxParticles())), '#ffffff', 380, 2.5);
  } else if (isPost && impact > 200) {
    // the goal frame rings — a distinct metallic ping plus a bright kiss
    AudioSys.ping();
    burst(x, y, Math.max(1, Math.round(8 * fxParticles())), '#ffffff', 320, 2.5);
  } else {
    AudioSys.rail(v);
  }
}

// ---------- state management ----------
// Ceremony flags (letterbox, flash, slow-mo) belong to the 'goal' state.
// Every exit path funnels through clearCeremony so a mid-ceremony quit,
// restart, or win can never leave GOAL! / slow-mo stuck on screen.
function clearCeremony() {
  G.letterT = 0; G.flashA = 0; G.goalT = 0; G.goalSlowT = 0;
  G.timeScale = 1;
}
// ---------- game flow ----------
function startGame(mode, diff) {
  AudioSys.init(); AudioSys.resume();
  G.mode = mode; G.difficulty = diff == null ? G.difficulty : diff;
  G.score = [0, 0]; G.winSide = 0;
  G.demo = false; G.idleT = 0; G.gwNet = 0; // local/host: goal width from Settings (guests get the host's via countdown)
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  G.scuffs.length = 0; G.texts.length = 0;
  resetPositions();
  G.ai2 = mkBrain(1, G.difficulty);
  G.ai1 = (mode === '2p') ? null : mkBrain(0, G.difficulty); // demo brain, unused in 1p
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
  if (mode === 'online' && Net.role === 'host') Net.sendCountdown();
}
// First-time hint: one line on the first local match ("Drag to move your
// mallet"), dismissed forever after the first goal. Persisted in
// localStorage so it never returns. Online/demo never get the hint — it's a
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
// serve — the host rolls, the guest receives (see Net.sendCountdown).
function rollServe(dir) {
  const sp = paceServe(), roll = Math.random();
  let ang, speed;
  if (roll < 0.10) {          // banker — kiss the side rail first
    ang = (60 + Math.random() * 16) * (Math.random() < 0.5 ? 1 : -1);
    speed = sp * (0.92 + Math.random() * 0.16);
  } else if (roll < 0.22) {   // dink — a slow teasing feed
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
  if (G.countT >= 1.65 && !G.goPlayed) { G.goPlayed = true; AudioSys.count(true); }
  if (G.countT >= 2.0) {
    G.goPlayed = false;
    G.state = 'play';
    // serve the rolled point — the player who was scored on gets the puck
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
  if (G.mode === 'online' && Net.role !== 'host') return;
  G.score[scorer]++; // the single place a goal changes the score
  if (G.mode !== 'online' && G.stats) {
    // streaks + worst-deficit tracking for the v23 fun pass (host-owned in
    // online play would desync the guest's view, so guests never track)
    const st = G.stats;
    st.streak[scorer]++; st.streak[1 - scorer] = 0;
    if (st.streak[scorer] > st.bestStreak[scorer]) st.bestStreak[scorer] = st.streak[scorer];
    st.worstDef[0] = Math.min(st.worstDef[0], G.score[0] - G.score[1]);
    st.worstDef[1] = Math.min(st.worstDef[1], G.score[1] - G.score[0]);
  }
  if (G.hintLive) dismissHint(true); // first goal dismisses the hint forever
  beginGoalCeremony(scorer); // visuals only — never scores, never sends
  if (G.mode === 'online') Net.sendGoal(scorer); // ONLINE: tell the guest to play it
}
// ONLINE: start the goal ceremony visuals only — no scoring, no sending.
// The host scores first in onGoal; the guest's scores arrive final in the
// goal event. Splitting it this way makes double-counting impossible.
// Goal hierarchy: YOUR goals get the full treatment (confetti storm, frame
// flash, deeper chord); conceded goals are a smaller, dimmer affair.
function goalIsYours(scorer) {
  if (G.mode === '2p') return true; // both ends are players — both celebrate
  if (G.mode === 'online') return (Net.role === 'host') === (scorer === 0);
  return scorer === 0;
}
function confettiColors() {
  return [THEME.gold || '#d8a93f', THEME.particle, '#ffffff', THEME.ink].filter(Boolean);
}
// goal-streak announcements — the little combo rush that makes scoring feel
// addictive. Local matches only (online guests never own the sim, and the
// streak state isn't in the snapshot), gated on fxFlash() like the rest of
// the ceremony juice.
function announceStreak(scorer) {
  if (G.mode === 'online' || G.demo) return;
  const st = G.stats;
  if (!st || !goalIsYours(scorer) || !fxFlash()) return;
  const n = st.streak[scorer];
  if (n < 2) return;
  const label = n === 2 ? 'TWO IN A ROW'
    : n === 3 ? 'HAT-TRICK!'
    : n + ' IN A ROW — UNSTOPPABLE!';
  addText(CX, CY - 200, label, THEME.gold || '#d8a93f', 56);
}
function beginGoalCeremony(scorer) {
  boardKick(scorer);
  G.goalSide = scorer;
  if (G.stats) G.stats.rally = 0; // new rally after each goal
  G.state = 'goal';
  G.goalT = 0; G.goalSlowT = 0; G.letterT = 0;
  G.timeScale = 0.22; // the reserved channel: slow-mo belongs to goals
  const yours = goalIsYours(scorer);
  G.flashA = yours ? 1 : 0.65;
  G.goalFrameT = yours ? 1 : 0.5;
  $('topbar').classList.add('hidden'); // ceremony is cinematic — no mis-taps
  const gx = scorer === 0 ? PX + PW : PX;
  const fxp = fxParticles();
  burst(gx, CY, Math.max(4, Math.round(46 * fxp)), THEME.particle, 620, 4.5);
  burst(gx, CY, Math.max(2, Math.round(20 * fxp)), '#ffffff', 380, 3);
  if (!PRM.reduce) {
    // theme-colored confetti storm — bigger when YOU score
    const cols = confettiColors();
    const n = Math.round((yours ? 90 : 36) * fxp);
    for (let c = 0; c < 3; c++) burst(gx, CY, Math.max(1, Math.round(n / 3)), cols[c % cols.length], 380 + c * 160, 4 + c);
  }
  addTrauma(0.85);
  addText(gx + (scorer === 0 ? -130 : 130), CY - 120, '+1', THEME.gold || '#d8a93f', 52);
  announceStreak(scorer); // TWO IN A ROW / HAT-TRICK / N IN A ROW — UNSTOPPABLE!
  AudioSys.goalChord(THEME.goalChord || [523.25, 659.25, 783.99, 1046.5]);
  buzz([25, 40, 40]);
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
  // the winning goal gets ~30% more ceremony
  const matchPoint = G.score[G.goalSide] >= Settings.firstTo;
  if (G.goalT > (matchPoint ? 2.86 : 2.2)) {
    clearCeremony();
    if (G.score[0] >= Settings.firstTo || G.score[1] >= Settings.firstTo) {
      G.winSide = G.score[0] > G.score[1] ? 0 : 1;
      G.state = 'win';
      showWin();
    } else {
      resetPositions();
      rollServe(G.goalSide === 0 ? 1 : -1); // scored-on player gets the puck
      $('topbar').classList.remove('hidden');
      startCount();
      // ONLINE: the host's countdown mirrors to the guest so both start even
      if (G.mode === 'online' && Net.role === 'host') Net.sendCountdown();
    }
  }
}
function showWin() {
  clearCeremony(); // defensive: no ceremony visuals leak under the overlay
  $('topbar').classList.add('hidden');
  const you = G.winSide === 0;
  // local rival record — AI rivals per difficulty, P1/P2 for same-screen 2P
  // (online matches are session-only: no stored record)
  if (G.mode === 'ai') Record.bump('ai' + G.difficulty, G.winSide === 0);
  else if (G.mode === '2p') { Record.bump('p1', G.winSide === 0); Record.bump('p2', G.winSide === 1); }
  $('winTitle').textContent = G.mode === '2p'
    ? (you ? 'Player One wins' : 'Player Two wins')
    : G.mode === 'online' // ONLINE: labels by role, not by side
    ? (onlineSideLabel(G.winSide) === 'YOU' ? 'You win' : 'Rival wins')
    : (you ? 'You win' : DIFFS[G.difficulty].name + ' wins');
  $('winSub').textContent = G.score[0] + ' — ' + G.score[1];
  // match stats: top puck speed (table-scale km/h), longest rally, saves
  // per side (same side order as the score), and match duration. Two lines
  // so the line never overflows a phone card; innerHTML is safe here —
  // every value is numeric.
  const st = G.stats || freshStats();
  const kmh = st.topSpeed * (2.4384 / PW) * 3.6; // 8ft table mapping
  const secs = Math.max(1, Math.round((performance.now() - st.t0) / 1000));
  try {
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    const sv = st.saves || [0, 0];
    $('winStats').innerHTML = 'Top puck ' + Math.round(kmh) + ' km/h · Longest rally ' + st.bestRally +
      '<br>Saves ' + sv[0] + '–' + sv[1] + ' · ' + mm + ':' + ss;
    // v23 fun pass — personal bests, achievements, table tour. Local matches
    // only: online stays session-only (no stored records, no feats, and the
    // guest's snapshot is display-only).
    if (G.mode === 'ai' || G.mode === '2p') {
      const feats = $('winFeats');
      if (G.mode === '2p' || G.winSide === 0) { // records + feats belong to a human winner
        const margin = Math.abs(G.score[0] - G.score[1]);
        const recs = checkBest(G.mode === 'ai' ? 'ai' + G.difficulty : 'p2p',
          secs, Math.round(kmh), st.bestRally || 0, margin);
        if (recs.length) $('winStats').innerHTML += '<br>★ New record — ' + recs.join(' · ');
        const fresh = [];
        if (G.score[1 - G.winSide] === 0 && Feats.unlock('shutout')) fresh.push('SHUTOUT');
        if ((st.worstDef || [0, 0])[G.winSide] <= -3 && Feats.unlock('comeback')) fresh.push('COMEBACK');
        if (((st.bestStreak || [0, 0])[G.winSide] || 0) >= 3 && Feats.unlock('hattrick')) fresh.push('HAT-TRICK');
        if (Math.round(kmh) >= 60 && Feats.unlock('speedster')) fresh.push('SPEEDSTER');
        Tour.bump(G.themeId);
        if (Tour.count() >= THEME_ORDER.length && Feats.unlock('grandtour')) fresh.push('GRAND TOUR');
        feats.textContent = fresh.length ? '🏆 UNLOCKED — ' + fresh.join(' · ') : '';
      } else {
        feats.textContent = '';
      }
    } else {
      $('winFeats').textContent = '';
    }
  } catch (e) {}
  hideAll(); $('winov').classList.remove('hidden');
  G.hintLive = false; // match over — the hint never survives a match end
  AudioSys.goalChord([392, 523.25, 659.25, 783.99, 1046.5]);
  // slow theme-colored confetti rain over the win card (DOM — the card
  // is a positioned container; pieces clean themselves up)
  if (!PRM.reduce && Settings.effects !== 'minimal') {
    const card = $('winov').querySelector('.card');
    const cols = confettiColors();
    const n = Settings.effects === 'subtle' ? 22 : 46;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'confetti';
      s.style.left = rnd(2, 96) + '%';
      s.style.background = cols[i % cols.length];
      s.style.animationDuration = rnd(1.8, 3.4) + 's';
      s.style.animationDelay = rnd(0, 0.9) + 's';
      s.style.width = rnd(6, 10) + 'px';
      card.appendChild(s);
      setTimeout(() => s.remove(), 4600);
    }
  }
}
function togglePause(force, silent) {
  // ONLINE: silent=true applies a pause that arrived over the wire — it must
  // not echo back, or the two clients would ping-pong pause events forever.
  // Pausing is allowed from 'goal' too: the ceremony is cleared so a frozen
  // GOAL! banner / slow-mo can't sit under the pause card, and resume replays
  // the ceremony from its start (goalT=0) rather than a stale timeScale.
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') {
    G.pausedFrom = G.state;
    if (G.state === 'goal') clearCeremony();
    G.state = 'pause';
    hideAll(); $('pauseov').classList.remove('hidden');
    AudioSys.ui();
    if (G.mode === 'online' && !silent) Net.sendPause(true);
  } else if (G.state === 'pause' && force !== true) {
    G.state = G.pausedFrom;
    hideAll();
    if (G.state === 'play' || G.state === 'count' || G.state === 'goal') $('topbar').classList.remove('hidden');
    if (G.hintLive) $('hint').classList.remove('hidden'); // hint survives pause/resume
    if (G.mode === 'online' && !silent) Net.sendPause(false);
  }
}
// Restart the current match from the pause menu.
// LOCAL (ai/2p): immediate — startGame resets score, board, stats, and counts
// down. ONLINE: host authority — the host restarts directly (the countdown
// event pulls the guest along via Net.onCountdown); the guest sends a
// restart request and the host performs it, so both sides stay in sync.
// Never changes net snapshot/input behavior — restart flows through the
// existing countdown handshake.
function restartMatch() {
  AudioSys.ui();
  if (G.mode === 'online') {
    if (Net.role === 'host') Net.restartMatchAsHost();
    else if (Net.wire) Net.wire.sendEv({ t: 'restart-req' });
    return;
  }
  startGame(G.mode, G.difficulty);
}
function quitToMenu() {
  if (G.mode === 'online') Net.leave(); // ONLINE: leave the room first — leave() resets mode
  G.state = 'menu'; G.idleT = 0; G.demo = false; G.gwNet = 0; // drop any guest goal-width override
  clearCeremony();
  G.freezeT = 0; G.trauma = 0;
  G.board = freshBoard();
  pointers.clear();
  resetPositions();
  hideAll(); $('menu').classList.remove('hidden');
  $('topbar').classList.add('hidden');
  G.hintLive = false; // match over — the hint never survives a match end
  refreshRecordLines(); // menu record lines reflect the just-finished match
  refreshTour(); // tour counter + conquered pips reflect the just-finished match
  AudioSys.ui();
}
function hideAll() {
  // ONLINE: online overlays are part of the overlay stack too
  for (const id of ['menu', 'help', 'settings', 'pauseov', 'winov', 'onlineov', 'onlinedropov', 'hint']) $(id).classList.add('hidden');
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
      // ONLINE: host-only branch — the guest never reaches playStep (see
      // frame). The host drives m1; m2's target arrives over the wire.
      driveMallet(G.m1, sdt, PLAYER_CAP);
    } else {
      if (pointers.size > 0) driveMallet(G.m1, sdt, PLAYER_CAP);
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
  if (G.freezeT > 0) { G.freezeT -= rdt; render(); return; } // hit-stop
  G.trauma = Math.max(0, G.trauma - rdt * 1.7);
  // juice timers decay every frame, whatever the state
  G.hitFlash = Math.max(0, G.hitFlash - rdt * 3);
  G.roomPulse = Math.max(0, G.roomPulse - rdt * 1.4);
  G.saveT = Math.max(0, G.saveT - rdt);
  G.nearCd = Math.max(0, G.nearCd - rdt);
  G.dipT = Math.max(0, G.dipT - rdt);
  if (G.missGlow) { G.missGlow.t -= rdt; if (G.missGlow.t <= 0) G.missGlow = null; }
  if (G.rattle) { G.rattle.t -= rdt; if (G.rattle.t <= 0) G.rattle = null; }
  tickBoard(rdt); // scoreboard flip/reel/peg/bulb animation
  switch (G.state) {
    case 'menu':
      // ONLINE: no attract demo while the online lobby is up — mode is
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
      // ONLINE: each side drives only their own mallet during the countdown
      else if (G.mode === 'online') { driveMallet(Net.role === 'host' ? G.m1 : G.m2, rdt, PLAYER_CAP); }
      else { if (pointers.size > 0) driveMallet(G.m1, rdt, PLAYER_CAP); aiDrive(G.ai2, rdt, G.m2); }
      updateParts(rdt);
      break;
    case 'play':
      // ONLINE: the guest does not simulate — the host owns the physics.
      // The guest only drives their own mallet; puck and rival mallet arrive
      // over the wire (dead-reckoned in Net.pump).
      // Near-miss dip: the reserved channel is goals' slow-mo, but a 0.22s
      // 0.55x dip on a post kiss — and the ~90ms SMASH slow-mo beat on
      // SMASH-tier mallet hits — are smaller beats that share this channel
      // (Math.max, never stacking). Never overlaps the ceremony (state
      // leaves 'play' first).
      if (G.mode === 'online' && Net.role === 'guest') driveMallet(G.m2, rdt, PLAYER_CAP);
      else playStep(rdt * G.timeScale * (G.dipT > 0 ? 0.55 : 1));
      updateParts(rdt);
      break;
    case 'goal':
      updateGoal(rdt);
      updateParts(rdt);
      break;
    case 'win':
    case 'pause':
      updateParts(rdt * 0.25);
      break;
  }
  Net.pump(rdt); // ONLINE: snapshots out (host), inputs out (guest), dead reckoning
  render();
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

function render() {
  const dpr = view.dpr || 1, w = view.w, h = view.h, s = view.s;
  // the room: pre-rendered on theme change / resize — one drawImage, no shake
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (G.roomCanvas) ctx.drawImage(G.roomCanvas, 0, 0, w, h);
  else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  // room reactivity: a SMASH startles the room — a warm lamp-glow swells and
  // sways gently overhead, always in the theme's own gold
  if (G.roomPulse > 0.01 && fxRoom()) {
    const lx = w / 2 + Math.sin(perfNow() * 2.1) * w * 0.06 * G.roomPulse;
    const rg = ctx.createRadialGradient(lx, h * 0.04, 10, lx, h * 0.04, h * 0.55);
    rg.addColorStop(0, hexA(THEME.gold || '#d8a93f', 0.20 * G.roomPulse));
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  // trauma shake: slight rotation + translation (rotation reads as force)
  const sh = shakeOffset();
  ctx.translate(w / 2, h / 2); ctx.rotate(sh.r); ctx.translate(-w / 2 + sh.x, -h / 2 + sh.y);
  if (!view.portrait) { ctx.translate(view.ox, view.oy); ctx.scale(s, s); }
  else ctx.transform(0, -s, -s, 0, view.ox + s * VH, view.oy + s * VW);

  // goal zoom: ease toward the mouth during the ceremony (playfield only)
  ctx.save();
  if (G.letterT > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const z = 1 + 0.10 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.translate(gx, CY); ctx.scale(z, z); ctx.translate(-gx, -CY);
  }

  // ONLINE: the guest plays from their own side, so the playfield mirrors —
  // their mallet and goal sit where the host's do. Everything above the
  // playfield (scoreboard, ceremony type, ribbon) stays unflipped.
  ctx.save();
  if (G.onlineFlip) { ctx.translate(VW, 0); ctx.scale(-1, 1); }

  // table shadow + rails + surface
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 22;
  ctx.fillStyle = '#000';
  rr(ctx, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); ctx.fill();
  ctx.restore();
  THEME.drawRails(ctx);
  THEME.drawSurface(ctx);
  THEME.drawMarkings(ctx);

  // scuffs (permanence)
  for (const sc of G.scuffs) {
    ctx.save(); ctx.translate(sc.x, sc.y); ctx.rotate(sc.ang);
    ctx.fillStyle = 'rgba(10,8,6,' + sc.a.toFixed(3) + ')';
    ctx.fillRect(-sc.len / 2, -1.6, sc.len, 3.2);
    ctx.restore();
  }

  // puck trail
  const tr = G.trail;
  if (tr.length > 1) {
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 1; i < tr.length; i++) {
      const a = (i / tr.length) * 0.35;
      ctx.strokeStyle = THEME.trail;
      ctx.globalAlpha = a;
      ctx.lineWidth = 2 + (i / tr.length) * 8;
      ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
    }
    ctx.restore();
  }

  // speed lines: above 1500 the trail alone undersells it — theme-colored
  // streaks stretch back along the velocity vector
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
      ctx.globalAlpha = Math.max(0.06, 0.28 - i * 0.04);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(G.puck.x - cvx * (PUCK_R + 6) + ox, G.puck.y - svx * (PUCK_R + 6) + oy);
      ctx.lineTo(G.puck.x - cvx * (PUCK_R + 6 + len) + ox, G.puck.y - svx * (PUCK_R + 6 + len) + oy);
      ctx.stroke();
    }
    ctx.restore();
  }

  // goal-frame rattle: a hard frame hit visibly shakes the trim for ~0.4s
  // (fxFlash() gates it for Minimal effects + prefers-reduced-motion; the
  // jitter itself scales with the Shake setting, like trauma shake)
  for (let side = 0; side < 2; side++) {
    const gx = side === 0 ? PX : PX + PW;
    let ox = 0, oy = 0;
    if (G.rattle && G.rattle.side === side && fxFlash()) {
      const j = 4.5 * (G.rattle.t / 0.42) * shakeK();
      ox = rnd(-1, 1) * j; oy = rnd(-1, 1) * j;
    }
    ctx.save(); ctx.translate(ox, oy);
    THEME.drawGoalTrim(ctx, side, gx, CY, goalW());
    ctx.restore();
  }

  // goal-frame flash: the scored-on frame lights up in theme gold
  if (G.goalFrameT > 0 && fxFlash()) {
    const fgx = G.goalSide === 0 ? PX + PW : PX;
    ctx.save();
    ctx.globalAlpha = G.goalFrameT * 0.9;
    ctx.strokeStyle = THEME.gold || '#d8a93f'; ctx.lineWidth = 5;
    rr(ctx, fgx - 16, CY - goalW() / 2 - 16, 32, goalW() + 32, 16); ctx.stroke();
    ctx.restore();
  }
  // near-miss post glow: the kissed posts smolder briefly
  if (G.missGlow && fxFlash()) {
    const mgx = G.missGlow.side === 0 ? PX : PX + PW;
    ctx.save();
    ctx.globalAlpha = clamp(G.missGlow.t / 0.7, 0, 1) * 0.8;
    ctx.fillStyle = THEME.gold || '#d8a93f';
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.arc(mgx, CY + sgn * goalW() / 2, 10, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawPuck(ctx);
  drawMallet(ctx, G.m1);
  drawMallet(ctx, G.m2);

  // mallet motion trails on fast flicks (recorded in driveMallet)
  for (const m of [G.m1, G.m2]) {
    const tr = m.trail;
    for (let i = 0; i < tr.length; i++) {
      const a = (i / tr.length) * 0.30 * fxTrail();
      if (a <= 0.01) continue;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = THEME.trail;
      ctx.beginPath(); ctx.arc(tr[i].x, tr[i].y, m.r * (0.35 + 0.55 * i / tr.length), 0, TAU); ctx.fill();
      ctx.restore();
    }
    // possession readability: sustained gentle contact (>0.4s) draws a soft
    // ring under the puck — it reads as control, never as a stuck puck
    if (m.glueT > 0.4) {
      const pr = PUCK_R + 12 + Math.sin(perfNow() * 6) * 3;
      ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = THEME.gold || '#d8a93f';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(G.puck.x, G.puck.y, pr, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  // particles as motion streaks
  ctx.save(); ctx.lineCap = 'round';
  for (const q of PPOOL) {
    if (!q.on) continue;
    const a = clamp(q.life / q.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.strokeStyle = q.color;
    ctx.lineWidth = q.size * a + 0.5;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.lineTo(q.x - q.vx * 0.035, q.y - q.vy * 0.035);
    ctx.stroke();
  }
  ctx.restore();

  // save-moment ring pulses: a soft expanding ring where the block happened
  for (const q of G.pulses) {
    const k = q.t / 0.6;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.7;
    ctx.strokeStyle = THEME.gold || '#d8a93f';
    ctx.lineWidth = 4 * (1 - k) + 1;
    ctx.beginPath(); ctx.arc(q.x, q.y, 30 + k * 90, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // goal flash
  if (G.flashA > 0) {
    const gx = G.goalSide === 0 ? PX + PW : PX;
    const g = ctx.createRadialGradient(gx, CY, 10, gx, CY, 420);
    const fc = THEME.flash || 'rgba(216,169,63,1)';
    g.addColorStop(0, fc); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.globalAlpha = G.flashA * 0.55; ctx.fillStyle = g;
    ctx.fillRect(gx - 430, CY - 430, 860, 860);
    ctx.restore();
  }

  // SMASH-tier impact flash: a hard white-gold pop exactly where it landed
  if (G.hitFlash > 0 && fxFlash()) {
    const hg = ctx.createRadialGradient(G.hitFlashX, G.hitFlashY, 8, G.hitFlashX, G.hitFlashY, 260);
    hg.addColorStop(0, 'rgba(255,255,255,' + (0.55 * G.hitFlash).toFixed(3) + ')');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save(); ctx.fillStyle = hg;
    ctx.fillRect(G.hitFlashX - 270, G.hitFlashY - 270, 540, 540);
    ctx.restore();
  }

  // floating texts (positions flip with the playfield; glyphs stay upright)
  for (const t of G.texts) {
    const a = 1 - t.t / 1.1;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = '800 ' + t.size + 'px ' + THEME.font.display;
    ctx.fillStyle = t.color;
    rinkText(ctx, t.str, t.x, t.y); // ONLINE: upright type in the mirrored view
    ctx.restore();
  }
  ctx.restore(); // ONLINE flip

  // countdown — anticipation with a pop
  if (G.state === 'count') {
    const frac = (G.countT % 0.55) / 0.55;
    const label = G.countT < 1.65 ? String(3 - Math.floor(G.countT / 0.55)) : 'GO!';
    const pop = 1 + (1 - frac) * 0.55;
    ctx.save();
    ctx.globalAlpha = clamp(1.4 - frac, 0, 1);
    ctx.translate(CX, CY - 40); ctx.scale(pop, pop);
    ctx.font = '800 120px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.ink;
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 24;
    ctx.fillText(label, 0, 0); // screen space — never flipped
    ctx.restore();
  }

  // letterbox + GOAL! — the reserved channel (stable screen space, above the zoom)
  ctx.restore();
  if (G.letterT > 0) {
    const bh = 120 * easeOutBack(clamp(G.letterT, 0, 1));
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, VW, bh); ctx.fillRect(0, VH - bh, VW, bh);
    ctx.globalAlpha = clamp((G.letterT - 0.25) * 2.4, 0, 1);
    const zp = easeOutBack(clamp((G.letterT - 0.2) * 1.6, 0, 1));
    ctx.translate(CX, CY); ctx.scale(zp, zp);
    ctx.font = '800 92px ' + THEME.font.display;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.gold || '#d8a93f';
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 30;
    ctx.fillText('GOAL!', 0, -6); // screen space — never flipped
    ctx.restore();
  }

  drawScoreboard(ctx);

  // rally counter: consecutive hits without a goal — shown once it matters,
  // tucked under the match-point ribbon's slot so the two never collide
  if ((G.state === 'play' || G.state === 'count') && !G.demo && G.stats && G.stats.rally >= 4) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 13px ' + THEME.font.body;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = THEME.gold || '#e9d9a6';
    ctx.fillText('RALLY ×' + G.stats.rally, CX, 108);
    ctx.restore();
  }

  // match-point ribbon — theme-agnostic, sits under the scoreboard
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const t = Settings.firstTo;
    const m0 = G.score[0] === t - 1, m1 = G.score[1] === t - 1;
    if (m0 || m1) {
      const who = (m0 && m1) ? 'NEXT GOAL WINS'
        : G.mode === '2p' ? ((m0 ? 'PLAYER ONE' : 'PLAYER TWO') + ' — MATCH POINT')
        : G.mode === 'online' ? ((m0 ? onlineSideLabel(0) : onlineSideLabel(1)) + ' — MATCH POINT') // ONLINE
        : ((m0 ? 'YOU' : DIFFS[G.difficulty].name.toUpperCase()) + ' — MATCH POINT');
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 12px ' + THEME.font.body;
      const tw = ctx.measureText(who).width;
      const pw = tw + 30, ph = 24, px = CX - pw / 2, py = 66;
      ctx.globalAlpha = 0.92;
      rr(ctx, px, py, pw, ph, 12);
      ctx.fillStyle = 'rgba(10,8,5,0.78)'; ctx.fill();
      ctx.strokeStyle = THEME.gold || '#c9a227'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = THEME.gold || '#e9d9a6';
      ctx.fillText(who, CX, py + ph / 2 + 1);
      ctx.restore();
    }
  }

  // vignette
  const vg = ctx.createRadialGradient(CX, CY, VH * 0.42, CX, CY, VH * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, THEME.vignette || 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);

  // dim the attract game behind the menu
  if (G.state === 'menu') {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, VW, VH);
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
  // velocity stretch above 1500: elongate along travel — but only once the
  // impact squash has recovered, so the two deformations never fight
  const psp = hyp(p.vx, p.vy);
  if (psp > 1500 && G.puckSq > 0.96) {
    const va = Math.atan2(p.vy, p.vx), st = clamp((psp - 1500) / 2800, 0, 1) * 0.30;
    c.rotate(va); c.scale(1 + st, 1 - 0.45 * st); c.rotate(-va);
  }
  c.rotate(G.puckSqA);
  const sq = G.puckSq;
  c.scale(sq, 1 + (1 - sq) * 0.7); // squash along the impact normal
  const g = c.createRadialGradient(-5, -6, 2, 0, 0, PUCK_R);
  g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, PUCK_R, 0, TAU); c.fill();
  c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.ellipse(-5, -7, 4.5, 3, -0.5, 0, TAU); c.fill();
  c.restore();
  // spin cue: a small theme-gold dot rides the puck's rotation when it
  // carries english — the Magnus curve becomes readable before it bends
  if (Math.abs(p.w || 0) > 2.5) {
    const da = p.ang || 0;
    c.save();
    c.fillStyle = THEME.gold || '#d8a93f'; c.globalAlpha = 0.85;
    c.beginPath(); c.arc(p.x + Math.cos(da) * PUCK_R * 0.55, p.y + Math.sin(da) * PUCK_R * 0.55, 4.5, 0, TAU); c.fill();
    c.restore();
  }
}

function drawMallet(c, m) {
  const S = THEME.mallet, r = m.r;
  c.save();
  // shadow
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.beginPath(); c.ellipse(m.x + 6, m.y + 10, r, r * 0.9, 0, 0, TAU); c.fill();
  // body
  const g = c.createRadialGradient(m.x - r * 0.3, m.y - r * 0.35, r * 0.1, m.x, m.y, r);
  g.addColorStop(0, S.hi); g.addColorStop(0.6, S.base); g.addColorStop(1, S.edge);
  c.fillStyle = g;
  c.beginPath(); c.arc(m.x, m.y, r, 0, TAU); c.fill();
  c.lineWidth = 3; c.strokeStyle = S.ring; c.stroke();
  // dish
  const dg = c.createRadialGradient(m.x - 6, m.y - 8, 2, m.x, m.y, r * 0.62);
  dg.addColorStop(0, S.dishHi); dg.addColorStop(1, S.dish);
  c.fillStyle = dg;
  c.beginPath(); c.arc(m.x, m.y, r * 0.62, 0, TAU); c.fill();
  // knob
  const kg = c.createRadialGradient(m.x - 4, m.y - 5, 1, m.x, m.y, r * 0.30);
  kg.addColorStop(0, S.knobHi); kg.addColorStop(1, S.knob);
  c.fillStyle = kg;
  c.beginPath(); c.arc(m.x, m.y, r * 0.30, 0, TAU); c.fill();
  c.restore();
}

// ---------- themes ----------
const THEME_ORDER = ['deco', 'mid', 'brut', 'bil', 'mem', 'sashi', 'bau', 'zel', 'swi'];
function setTheme(id, silent) {
  if (!THEMES[id]) id = 'deco';
  THEME = THEMES[id];
  G.themeId = id; // the tour tracker needs to know which table just hosted a win
  if (!silent) {
    try {
      localStorage.setItem('atelier-ah-theme', id);
      const u = new URL(location.href); u.searchParams.set('table', id);
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) { console.warn('Could not persist table selection', e); }
  }
  document.querySelectorAll('.tslide').forEach(el => {
    el.classList.toggle('sel', el.dataset.theme === id);
    el.setAttribute('aria-selected', el.dataset.theme === id ? 'true' : 'false');
  });
  carSync(id);
  const css = THEME.css, root = document.documentElement.style;
  root.setProperty('--pagebg', css.pageBg);
  root.setProperty('--panel', css.panelBg);
  root.setProperty('--pline', css.panelBorder);
  root.setProperty('--btnbg', css.btnBg);
  root.setProperty('--btnink', css.btnInk);
  root.setProperty('--title', css.title);
  root.setProperty('--sub', css.sub);
  root.setProperty('--ghost', css.ghost);
  root.setProperty('--display', THEME.font.display);
  root.setProperty('--body', THEME.font.body);
  document.title = THEME.name + ' — Atelier Air Hockey';
  paintRoom();
  AudioSys.ambience(id); // room ambience follows the room (deferred pre-gesture)
  if (!silent) AudioSys.ui();
}
function paintThumbnails() {
  document.querySelectorAll('canvas[data-thumb]').forEach(cv => {
    const id = cv.dataset.thumb, T = THEMES[id];
    if (!T) return;
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const k = Math.min(W / VW, H / VH);
    c.save();
    c.scale(k, k);
    c.translate((W / k - VW) / 2, (H / k - VH) / 2);
    T.drawRoom(c);
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
    c.fillStyle = '#000'; rr(c, TX0, TY0, PW + RAIL * 2, PH + RAIL * 2, 34); c.fill();
    c.restore();
    T.drawRails(c); T.drawSurface(c); T.drawMarkings(c);
    T.drawGoalTrim(c, 0, PX, CY, goalW()); T.drawGoalTrim(c, 1, PX + PW, CY, goalW());
    // a mid-rally vignette: puck streaking, mallets poised
    c.save();
    c.strokeStyle = T.trail; c.globalAlpha = 0.5; c.lineWidth = 7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(CX - 190, CY + 60); c.quadraticCurveTo(CX, CY - 40, CX + 150, CY + 20); c.stroke();
    c.restore();
    const S = T.puck;
    const g = c.createRadialGradient(CX + 145, CY + 14, 2, CX + 150, CY + 20, PUCK_R);
    g.addColorStop(0, S.hi); g.addColorStop(0.55, S.body); g.addColorStop(1, S.edge);
    c.fillStyle = g;
    c.beginPath(); c.arc(CX + 150, CY + 20, PUCK_R, 0, TAU); c.fill();
    c.lineWidth = 2.5; c.strokeStyle = S.ring; c.stroke();
    const M = T.mallet;
    const mg = c.createRadialGradient(CX - 285, CY + 108, 4, CX - 290, CY + 114, MALLET_R);
    mg.addColorStop(0, M.hi); mg.addColorStop(0.6, M.base); mg.addColorStop(1, M.edge);
    c.fillStyle = mg;
    c.beginPath(); c.arc(CX - 290, CY + 114, MALLET_R, 0, TAU); c.fill();
    c.lineWidth = 3; c.strokeStyle = M.ring; c.stroke();
    c.fillStyle = M.knob;
    c.beginPath(); c.arc(CX - 290, CY + 114, MALLET_R * 0.3, 0, TAU); c.fill();
    c.restore();
  });
}

// ---------- settings ----------
function setSetting(key, val) {
  if (key === 'sound' || key === 'haptics') val = (val === 'true');
  if (key === 'firstTo') val = parseInt(val, 10);
  Settings[key] = val; saveSettings(); applySettingsToUI();
  // the menu's table thumbnails draw the goal mouth — repaint so the
  // preview always matches the chosen width
  if (key === 'goalW') { try { paintThumbnails(); } catch (e) {} }
}
function applySettingsToUI() {
  document.querySelectorAll('[data-set]').forEach(btn => {
    const selected = String(Settings[btn.dataset.set]) === btn.dataset.val;
    btn.classList.toggle('sel', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  AudioSys.muted = !Settings.sound;
  AudioSys.syncMute(); // keep the looped ambience bed under Mute too
  const sb = $('btnSound');
  if (sb) {
    sb.classList.toggle('off', !Settings.sound);
    sb.innerHTML = Settings.sound ? '&#9834;' : '&#215;';
    sb.setAttribute('aria-label', Settings.sound ? 'Mute sound' : 'Unmute sound');
    sb.title = Settings.sound ? 'Mute sound (M)' : 'Unmute sound (M)';
  }
  const ff = $('footFirst');
  if (ff) ff.innerHTML = 'First to <b>' + Settings.firstTo + '</b> takes the table';
  updateStartLabel(); // v21: the START MATCH sub-line carries the current first-to
  const hf = $('helpFirst');
  if (hf) hf.textContent = Settings.firstTo;
}


function renderProgress() {
  const body = $('progressBody'), summary = $('progressSummary');
  if (!body || !summary) return;
  const unlocked = FEATS.filter(f => Feats.data[f.id]).length;
  summary.textContent = Tour.count() + '/' + THEME_ORDER.length + ' tables conquered · ' + unlocked + '/' + FEATS.length + ' feats unlocked';
  const featRows = FEATS.map(f => '<div class="progress-item"><span>' + (Feats.data[f.id] ? '★ ' : '○ ') + f.name + '</span><span>' + f.desc + '</span></div>').join('');
  const tableRows = THEME_ORDER.map(id => '<div class="progress-item"><span>' + (Tour.won(id) ? '★ ' : '○ ') + THEMES[id].name + '</span><span>' + (Tour.data[id] || 0) + ' wins</span></div>').join('');
  body.innerHTML = '<div class="seclabel">ACHIEVEMENTS</div>' + featRows + '<div class="seclabel">TABLE TOUR</div>' + tableRows;
}
function shareResult() {
  const score = G.score[0] + '–' + G.score[1];
  const text = 'Atelier Air Hockey · ' + THEME.name + ' · ' + score;
  const url = location.origin + location.pathname + '?table=' + encodeURIComponent(G.themeId);
  if (navigator.share) navigator.share({ title: 'Atelier Air Hockey', text, url }).catch(e => { if (e && e.name !== 'AbortError') console.warn(e); });
  else if (navigator.clipboard) navigator.clipboard.writeText(text + ' · ' + url).then(() => { const b = $('btnShareResult'); if (b) { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Share result', 1400); } }).catch(e => console.warn(e));
}

const keyDrive = new Set();
let keyLast = performance.now();
function keyboardGamepadDrive(now) {
  const dt = Math.min(0.04, Math.max(0, (now - keyLast) / 1000)); keyLast = now;
  if ((G.state === 'play' || G.state === 'count') && !G.demo) {
    const speed = 920;
    const move = (m, left, right, up, down, lo, hi) => {
      let dx = (keyDrive.has(right) ? 1 : 0) - (keyDrive.has(left) ? 1 : 0);
      let dy = (keyDrive.has(down) ? 1 : 0) - (keyDrive.has(up) ? 1 : 0);
      if (dx || dy) {
        const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
        m.tx = clamp(m.tx + dx * speed * dt, lo, hi);
        m.ty = clamp(m.ty + dy * speed * dt, PY + MALLET_R, PY + PH - MALLET_R);
      }
    };
    move(G.m1, 'KeyA', 'KeyD', 'KeyW', 'KeyS', PX + MALLET_R, CX - MALLET_R);
    if (G.mode === '2p') move(G.m2, 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', CX + MALLET_R, PX + PW - MALLET_R);
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const applyPad = (pad, m, lo, hi) => {
        if (!pad) return;
        const ax = Math.abs(pad.axes[0] || 0) > .18 ? pad.axes[0] : 0;
        const ay = Math.abs(pad.axes[1] || 0) > .18 ? pad.axes[1] : 0;
        if (ax || ay) { m.tx = clamp(m.tx + ax * speed * dt, lo, hi); m.ty = clamp(m.ty + ay * speed * dt, PY + MALLET_R, PY + PH - MALLET_R); }
      };
      applyPad(pads[0], G.m1, PX + MALLET_R, CX - MALLET_R);
      if (G.mode === '2p') applyPad(pads[1] || pads[0], G.m2, CX + MALLET_R, PX + PW - MALLET_R);
    } catch (e) {}
  }
  requestAnimationFrame(keyboardGamepadDrive);
}

// ---------- UI wiring ----------
/* table carousel: slides are built from THEME_ORDER so markup stays
   a single source of truth; scroll position <-> selected theme. */
let carGuard = false; // true while we scroll programmatically
function buildCarousel() {
  const track = $('carTrack'), dots = $('carDots');
  if (!track || track.children.length) return;
  track.setAttribute('role', 'listbox'); track.setAttribute('aria-label', 'Table selection');
  if (dots) dots.setAttribute('aria-hidden', 'true');
  THEME_ORDER.forEach((id, i) => {
    const T = THEMES[id];
    const d = document.createElement('div');
    d.className = 'tslide'; d.dataset.theme = id;
    d.setAttribute('role', 'option'); d.tabIndex = 0;
    d.setAttribute('aria-label', T.name + ' table');
    d.innerHTML = '<canvas data-thumb="' + id + '" width="640" height="400"></canvas>' +
      '<div class="tmeta"><div class="tname">' + T.name + '</div>' +
      '<div class="tsub">' + T.tagline + '</div></div>';
    const pick = () => { AudioSys.init(); setTheme(id); };
    d.addEventListener('click', pick);
    d.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      if (e.key === 'ArrowRight') carStep(1);
      if (e.key === 'ArrowLeft') carStep(-1);
    });
    track.appendChild(d);
    const dot = document.createElement('i');
    dot.addEventListener('click', () => carGo(i));
    dots.appendChild(dot);
  });
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (carGuard) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(carFromScroll);
  }, { passive: true });
}
function carIndex() {
  const track = $('carTrack');
  if (!track || !track.children.length) return 0;
  const w = track.children[0].offsetWidth + 12;
  return Math.round(track.scrollLeft / w);
}
function carFromScroll() {
  const i = Math.max(0, Math.min(THEME_ORDER.length - 1, carIndex()));
  if (THEMES[THEME_ORDER[i]] !== THEME) setTheme(THEME_ORDER[i]);
  else carPaint(i);
}
function carPaint(i) {
  const dots = $('carDots');
  if (dots) [...dots.children].forEach((d, j) => d.classList.toggle('sel', j === i));
  const cc = $('carCount');
  if (cc) cc.textContent = (i + 1) + ' / ' + THEME_ORDER.length;
}
function carGo(i) {
  const track = $('carTrack');
  if (!track || !track.children.length) return;
  i = (i + THEME_ORDER.length) % THEME_ORDER.length;
  const w = track.children[0].offsetWidth + 12;
  carGuard = true;
  track.scrollTo({ left: i * w, behavior: 'smooth' });
  setTimeout(() => { carGuard = false; }, 450);
  setTheme(THEME_ORDER[i]);
}
function carStep(d) { carGo(carIndex() + d); }
/* called by setTheme — scrolls the track when the theme changed
   from anywhere else (deep link, settings restore). */
function carSync(id) {
  const i = THEME_ORDER.indexOf(id);
  carPaint(Math.max(0, i));
  const track = $('carTrack');
  if (!track || !track.children.length || i < 0) return;
  const w = track.children[0].offsetWidth + 12;
  if (Math.abs(track.scrollLeft - i * w) > 4) {
    carGuard = true;
    track.scrollTo({ left: i * w });
    setTimeout(() => { carGuard = false; }, 120);
  }
}
// ---------- menu selection (v21) ----------
// rival buttons select the matchup; the START MATCH button launches it.
// Online keeps its own lobby flow.
const MenuSel = { mode: 'ai', diff: 1 };
function selectRival(mode, diff) {
  MenuSel.mode = mode;
  if (diff != null) MenuSel.diff = diff;
  document.querySelectorAll('[data-diff]').forEach(b => {
    const selected = mode === 'ai' && +b.dataset.diff === MenuSel.diff;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  $('btn2p').classList.toggle('selected', mode === '2p');
  $('btn2p').setAttribute('aria-pressed', mode === '2p' ? 'true' : 'false');
  updateStartLabel();
}
function updateStartLabel() {
  const s = $('startSub'); if (!s) return;
  const rival = MenuSel.mode === '2p' ? 'TWO PLAYERS' : ['ROOKIE', 'CLUB PRO', 'CHAMPION'][MenuSel.diff];
  s.textContent = rival + ' · FIRST TO ' + Settings.firstTo;
}

function wireUI() {
  buildCarousel();
  $('carPrev').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(-1); });
  $('carNext').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); carStep(1); });
  document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('ai', +btn.dataset.diff); });
  });
  $('btn2p').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); selectRival('2p'); });
  $('btnStart').addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); startGame(MenuSel.mode, MenuSel.diff); });
  // ONLINE: the only entry point that touches the network — the Trystero
  // import happens inside, on the tap, never before.
  $('btnOnline').addEventListener('click', () => Net.openLobby());
  selectRival('ai', G.difficulty); // paint the initial selection + start label
  document.querySelectorAll('[data-set]').forEach(btn => {
    btn.addEventListener('click', () => { AudioSys.init(); AudioSys.ui(); setSetting(btn.dataset.set, btn.dataset.val); });
  });
  $('btnSettings').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('settings').classList.remove('hidden'); });
  $('settingsClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnHelp').addEventListener('click', () => { AudioSys.ui(); applySettingsToUI(); hideAll(); $('help').classList.remove('hidden'); });
  $('btnProgress').addEventListener('click', () => { AudioSys.ui(); renderProgress(); hideAll(); $('progress').classList.remove('hidden'); });
  $('progressClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnResetProgress').addEventListener('click', () => {
    if (!confirm('Reset records, personal bests, achievements, and table-tour progress on this device?')) return;
    [Record.key, Best.key, Feats.key, Tour.key].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    Record.load(); Best.load(); Feats.load(); Tour.load(); refreshRecordLines(); refreshTour(); renderProgress();
  });
  $('helpClose').addEventListener('click', () => { AudioSys.ui(); hideAll(); $('menu').classList.remove('hidden'); });
  $('btnPause').addEventListener('click', () => togglePause());
  $('btnResume').addEventListener('click', () => togglePause());
  $('btnRestart').addEventListener('click', restartMatch);
  $('btnQuit').addEventListener('click', quitToMenu);
  // ONLINE: rival-left overlay — back to the menu (leave() runs inside quitToMenu)
  $('dropMenu').addEventListener('click', quitToMenu);
  $('btnRematch').addEventListener('click', () => {
    AudioSys.ui();
    // ONLINE: a rematch needs the rival's accept — the host restarts on accept
    if (G.mode === 'online') Net.offerRematch();
    else startGame(G.mode, G.difficulty);
  });
  $('btnWinMenu').addEventListener('click', quitToMenu);
  $('btnShareResult').addEventListener('click', shareResult);
  $('btnMenu2').addEventListener('click', () => {
    if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
    else if (G.state === 'pause') { hideAll(); $('pauseov').classList.remove('hidden'); }
    else quitToMenu();
  });
  $('btnSound').addEventListener('click', () => {
    AudioSys.init();
    setSetting('sound', String(!Settings.sound)); // persists; button UI syncs via applySettingsToUI
  });
  window.addEventListener('keydown', e => {
    const interactive = e.target && e.target.closest && e.target.closest('input, textarea, select, button, a, [contenteditable="true"]');
    if (interactive && e.key !== 'Escape') return;
    if (e.key === 'p' || e.key === 'P') togglePause();
    else if (e.key === 'm' || e.key === 'M') $('btnSound').click();
    else if (e.key === 'Escape') {
      if (G.state === 'pause') togglePause();
      else if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true);
      else if (!$('help').classList.contains('hidden')) $('helpClose').click();
      else if (!$('settings').classList.contains('hidden')) $('settingsClose').click();
    }
    else if (e.key === 'Enter' && G.state === 'menu' && !$('menu').classList.contains('hidden')) {
      // v21: Enter on the menu launches the selected matchup
      AudioSys.init(); AudioSys.ui(); startGame(MenuSel.mode, MenuSel.diff);
    }
  });
  window.addEventListener('keydown', e => {
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code) && (G.state === 'play' || G.state === 'count')) { keyDrive.add(e.code); e.preventDefault(); }
  }, { passive: false });
  window.addEventListener('keyup', e => keyDrive.delete(e.code));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (G.state === 'play' || G.state === 'count' || G.state === 'goal')) togglePause(true);
  });
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let rzRAF = 0, rzT = 0;
  const onResize = () => {
    if (!rzRAF) rzRAF = requestAnimationFrame(() => { rzRAF = 0; resize(); });
    clearTimeout(rzT);
    rzT = setTimeout(resize, 120);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
}

// ---------- boot ----------
function boot() {
  loadSettings();
  Record.load(); Best.load(); Feats.load(); Tour.load();
  refreshRecordLines(); // paint any stored records under the menu buttons
  refreshTour(); // tour counter + conquered-table pips
  // accessibility: prefers-reduced-motion drops Shake to Subtle for the
  // session — unless the player explicitly chose a shake level — and
  // fxFlash() kills flashes, confetti, and room reactivity from then on.
  try {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      PRM.reduce = true;
      if (!PRM.userShake) Settings.shake = 'subtle';
    }
  } catch (e) {}
  resize(); wireUI(); applySettingsToUI();
  let initialTheme = 'deco';
  try { const savedTheme = localStorage.getItem('atelier-ah-theme'); if (savedTheme && THEMES[savedTheme]) initialTheme = savedTheme; } catch (e) {}
  setTheme(initialTheme, true);
  refreshTour();
  const paintLater = () => { try { paintThumbnails(); } catch (e) { console.warn('Thumbnail paint failed', e); } };
  if ('requestIdleCallback' in window) requestIdleCallback(paintLater, { timeout: 800 }); else setTimeout(paintLater, 0);
  resetPositions();
  G.ai1 = mkBrain(0, 1); G.ai2 = mkBrain(1, 1);
  // deep links: ?table=mid&play , ?table=bil&2p , ?demo
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('table') && THEMES[q.get('table')]) setTheme(q.get('table'), true);
    if (q.get('join')) { Net.openLobby(); Net.join(q.get('join')); }
    else if (q.has('play')) startGame('ai', G.difficulty);
    else if (q.has('2p')) startGame('2p');
    else if (q.has('demo')) { G.idleT = 99; }
  } catch (e) {}
  requestAnimationFrame(frame);
  requestAnimationFrame(keyboardGamepadDrive);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker registration failed', e));
}
document.addEventListener('DOMContentLoaded', boot);
