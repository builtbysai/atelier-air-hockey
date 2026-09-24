/* ============================================================================
 * net.js — online multiplayer for Atelier Air Hockey.
 *
 * All netcode lives here behind the `Net` interface. The game runtime (game.js)
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
 * Trystero 0.25 room shape: peer listeners are callback properties and
 * makeAction() returns an action object. Messages expose sender metadata via
 * action.onMessage(data, {peerId}); outbound traffic is targeted to the one
 * accepted rival instead of broadcast to every peer in the signaling room.
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
  handshakePeerId: null, // reserves the first peer while its handshake is still pending
  opToken: 0,          // invalidates async create/join work after Cancel
  disconnectTimer: 0,
  reconnecting: false,
  reconnectState: null,

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
    'atelier-ah-' + code,
    {
      onPeerHandshake: async (peerId) => {
        const locked = Net.peerId || Net.handshakePeerId;
        if (locked && locked !== peerId) throw new Error('Table is full');
        if (!Net.handshakePeerId) Net.handshakePeerId = peerId;
      },
      onJoinError: (details) => {
        if (details && details.peerId === Net.handshakePeerId && !Net.peerId) Net.handshakePeerId = null;
        Net.logErr(details && (details.error || details));
      },
    }
  );
};

/* Wire Trystero 0.25 action objects to the game-facing Net interface. */
Net.wireRoom = function (room, h) {
  const st = room.makeAction('st');
  const input = room.makeAction('in');
  const ev = room.makeAction('ev');
  st.onMessage = (data, meta = {}) => { try { h.onSt(data, meta.peerId); } catch (e) { Net.logErr(e); } };
  input.onMessage = (data, meta = {}) => { try { h.onIn(data, meta.peerId); } catch (e) { Net.logErr(e); } };
  ev.onMessage = (data, meta = {}) => { try { h.onEv(data, meta.peerId); } catch (e) { Net.logErr(e); } };
  room.onPeerJoin = (id) => { try { h.onPeerJoin(id); } catch (e) { Net.logErr(e); } };
  room.onPeerLeave = (id) => { try { h.onPeerLeave(id); } catch (e) { Net.logErr(e); } };
  const send = (action, data) => {
    if (!Net.peerId) return Promise.resolve();
    return action.send(data, { target: Net.peerId }).catch(Net.logErr);
  };
  return {
    sendSt: (data) => send(st, data),
    sendIn: (data) => send(input, data),
    sendEv: (data) => send(ev, data),
  };
};
Net.logErr = function (e) { console.warn('[Atelier net]', e); };
Net.connectionError = function (e, fallback) {
  Net.logErr(e);
  const msg = e && typeof e.message === 'string' ? e.message : '';
  return /does not support|secure context/i.test(msg) ? msg : fallback;
};

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
      'placeholder="······" aria-label="Table code">';
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
    Net.uiError(Net.connectionError(e, "Couldn't reach the lobby — check your connection and try again."));
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
    // Fast path: bind the first existing peer before targeted knock.
    const peers = Object.keys(room.getPeers());
    if (peers.length > 0 && Net.wire && Net.acceptPeer(peers[0])) Net.wire.sendEv({ t: 'knock' });
  } catch (e) {
    Net.uiShow('choose');
    Net.uiError(Net.connectionError(e, "Couldn't reach the lobby — check your connection and try again."));
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
  clearTimeout(Net.disconnectTimer); Net.disconnectTimer = 0;
  Net.reconnecting = false; Net.reconnectState = null;
  Net.setPauseNotice(false);
  try { if (Net.room) Net.room.leave(); } catch (e) {}
  Net.room = null; Net.wire = null; Net.role = null; Net.peerId = null; Net.handshakePeerId = null;
  Net.active = false; Net.waitingForRival = false;
  Net.resetConn(); // chip hides with the match
};

Net.acceptPeer = function (id) {
  if (!id) return false;
  if (Net.handshakePeerId && id !== Net.handshakePeerId) return false;
  if (!Net.peerId) Net.peerId = id;
  if (id === Net.peerId) Net.handshakePeerId = null;
  return id === Net.peerId;
};
Net.onPeerJoin = function (id) {
  if (!Net.acceptPeer(id)) return;
  const wasReconnecting = Net.reconnecting;
  clearTimeout(Net.disconnectTimer); Net.disconnectTimer = 0;
  Net.reconnecting = false;
  Net.paintConn();
  if (wasReconnecting && Net.active) {
    // Both roles resume their own retained state. Previously only the host
    // resumed here, leaving a reconnecting guest stuck on the pause overlay.
    // But if the user had manually paused before the drop, keep them paused.
    Net.setPauseNotice(false);
    if (G.state === 'pause' && Net.reconnectState && Net.reconnectState !== 'pause' && !Net.wasPausedBeforeDisconnect) togglePause(false, true);
    Net.reconnectState = null;
    Net.wasPausedBeforeDisconnect = false;
    if (Net.wire) Net.wire.sendEv({ t: 'resume' });
    return;
  }
  if (Net.role === 'host' && Net.waitingForRival && !Net.active) Net.startHostMatch();
  else if (Net.role === 'guest' && !Net.active && Net.wire) Net.wire.sendEv({ t: 'knock' });
};
// pause-card reconnect notice: visible only while the match waits on a
// dropped rival; hidden the moment play resumes or the room goes away.
// Uses the shared $() helper so headless unit tests (no DOM) stay green.
Net.setPauseNotice = function (on) {
  const el = (typeof $ === 'function') ? $('pauseNotice') : null;
  if (el) el.classList.toggle('hidden', !on);
};
Net.onPeerLeave = function (id) {
  if (id !== Net.peerId) return;
  Net.peerId = null; Net.handshakePeerId = null;
  if (!Net.active && !Net.waitingForRival) return;
  if (Net.waitingForRival) { Net.onRivalLeft(); return; }
  Net.reconnecting = true;
  // Remember if the user had manually paused before the drop, so we don't
  // auto-resume on reconnect and lose their manual pause.
  Net.wasPausedBeforeDisconnect = (G.state === 'pause');
  Net.reconnectState = G.state === 'pause' ? G.pausedFrom : G.state;
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true, true);
  Net.setPauseNotice(true);
  Net.paintConn();
  clearTimeout(Net.disconnectTimer);
  Net.disconnectTimer = setTimeout(() => {
    if (!Net.peerId && Net.reconnecting) {
      Net.reconnecting = false;
      Net.onRivalLeft();
    }
  }, 5000);
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

Net.validGoalEvent = function (ev) {
  return (ev.scorer === 0 || ev.scorer === 1) && Number.isInteger(ev.s0) && Number.isInteger(ev.s1) &&
    ev.s0 >= 0 && ev.s1 >= 0 && ev.s0 <= Settings.firstTo && ev.s1 <= Settings.firstTo;
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
      if (Net.role === 'guest' && Net.active && Net.validGoalEvent(ev)) Net.guestGoal(ev);
      break;
    case 'pause':
      if (Net.active) Net.applyRemotePause(true);
      break;
    case 'resume':
      if (Net.active) Net.applyRemotePause(false);
      break;
    case 'rematch':
      if (['offer', 'accept', 'decline'].includes(ev.phase)) Net.onRematch(ev.phase);
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
      if (Net.wire && Net.active && Number.isInteger(ev.id) && Number.isFinite(ev.ts))
        Net.wire.sendEv({ t: 'pong', id: ev.id, ts: ev.ts });
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
  if (!ev || ev.id !== Net.conn.pingId || !Number.isFinite(ev.ts)) return;
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
  if (Net.reconnecting) { dot.className = 'fair'; label.textContent = 'reconnecting'; return; }
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
  Net.setPauseNotice(false);
  $('onlinedropov').classList.remove('hidden');
  Net.paintConn(); // active is false now — the chip hides itself
  AudioSys.ui();
};
