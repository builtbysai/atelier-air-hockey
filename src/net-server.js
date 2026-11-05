/* ============================================================================
 * net-server.js - client for the dedicated Atelier Air Hockey server.
 *
 * Server mode is opt-in (`?netMode=server`); the P2P path in net.js stays the
 * default. In server mode BOTH players are equal clients of one Cloudflare
 * Durable Object that runs the physics, scores goals and owns the match. This
 * file only moves bytes and maps server events onto the existing Net guest
 * path, so prediction, reconciliation, ACK fencing, the lag-compensation hint,
 * the ceremony/score handling and every overlay are the SAME code P2P uses:
 *
 *   server -> client  binary 56-byte state (type 1)  -> Net.onRealtimeMessage
 *                     binary 4-byte input ACK (3)    -> Net.onRealtimeMessage
 *                     JSON hello / countdown / goal / pause / resume /
 *                          rematch / leave           -> Net.onEvent
 *                     JSON welcome / error / rival-drop / rival-back (here)
 *   client -> server  binary 12-byte input (type 2), 22-byte hint (type 4)
 *                     JSON join / pause / resume / rematch / restart-req / leave
 *                     text 'ping' (answered by the runtime: RTT probe + keep-alive)
 *
 * Client model: the local player owns its mallet (zero input latency, same as a
 * P2P guest); the server is the single authority for puck, rival mallet, score
 * and match state. Each client is told `authoritySide = 1 - mySide`, so the
 * existing "ease the authority's mallet" path animates the RIVAL mallet.
 * ==========================================================================*/

const NET_SERVER_URL = 'wss://atelier-air-hockey-server.saihanswissle.workers.dev';
const NET_SERVER_SESSION_KEY = 'atelier-ah-server-v1';
const NET_SERVER_CONNECT_TIMEOUT_MS = 8000;
const NET_SERVER_RETRY_MS = [400, 900, 1800, 3000];
const NET_SERVER_RESUME_TTL_MS = 80 * 1000;   // below the server's 90 s drop grace
const NET_SERVER_PING_MS = 2500;

const NetServer = {
  ws: null, intent: null, code: null, pid: null, key: null, settings: null,
  token: 0,            // invalidates async work after Cancel / leave
  open: false,         // socket open AND welcomed
  joined: false,       // the server accepted our seat at least once
  retries: 0, retryTimer: 0, connectTimer: 0, pingTimer: 0,
  pingQueue: [],       // ids of outstanding 'ping' texts (the runtime answers in order)
  leaving: false,
};

/* Loopback-only override: ?netServer=ws://localhost:8787 points a local dev Worker at it.
 * A crafted link can never send players to a foreign server. */
Net.serverUrl = function () {
  try {
    const o = new URL(location.href).searchParams.get('netServer');
    if (o) {
      const u = new URL(o);
      if ((u.protocol === 'ws:' || u.protocol === 'wss:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin;
    }
  } catch (e) {}
  return NET_SERVER_URL;
};

Net.modeLabel = function () { return Net.serverMode() ? 'Dedicated server' : 'Peer to peer'; };

NetServer.randomId = function () {
  const bytes = new Uint8Array(18);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_'); // 24 URL-safe chars
};

NetServer.saveSession = function () {
  try { sessionStorage.setItem(NET_SERVER_SESSION_KEY, JSON.stringify({ code: NetServer.code, pid: NetServer.pid, key: NetServer.key, t: Date.now() })); } catch (e) {}
};
NetServer.clearSession = function () { try { sessionStorage.removeItem(NET_SERVER_SESSION_KEY); } catch (e) {} };
NetServer.readSession = function (now = Date.now()) {
  try {
    const s = JSON.parse(sessionStorage.getItem(NET_SERVER_SESSION_KEY) || 'null');
    if (s && /^[A-Z2-9]{6}$/.test(s.code) && typeof s.pid === 'string' && typeof s.key === 'string' && now - s.t < NET_SERVER_RESUME_TTL_MS) return s;
  } catch (e) {}
  return null;
};

/* Fresh-connect entry from the lobby: intent 'create' hosts a table, 'join' knocks. */
NetServer.start = async function (intent, rawCode) {
  const code = intent === 'create'
    ? (/^[A-Z2-9]{6}$/.test(rawCode || '') ? rawCode : netGenCode())
    : (rawCode || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
  if (intent === 'join' && code.length !== 6) { Net.uiError('That code needs 6 characters. Check it and try again.'); return; }
  const token = ++Net.opToken;
  Net.dropRoom();           // first: it may tear down a previous server room via Net.room.leave()
  NetServer.teardown(false);
  NetServer.token = token;
  Object.assign(NetServer, { intent, code, pid: NetServer.randomId(), key: NetServer.randomId(), joined: false, retries: 0, leaving: false,
    // only the creator proposes the rules; the server ignores a joiner's
    settings: intent === 'create' ? { firstTo: Settings.firstTo, pace: Settings.pace, gw: Math.round(goalW()) } : null });
  Net.uiShow(intent === 'create' ? 'opening' : 'knocking', { code });
  NetServer.install(intent === 'create' ? 'host' : 'guest');
  NetServer.connect(false);
};

/* Page reload inside the grace window: rejoin the SAME seat. */
NetServer.tryResume = async function () {
  const s = NetServer.readSession();
  if (!s || Net.active || Net.room) return false;
  const token = ++Net.opToken;
  Net.dropRoom();
  NetServer.teardown(false);
  Object.assign(NetServer, { token, intent: 'join', code: s.code, pid: s.pid, key: s.key, joined: true, retries: 0, leaving: false, settings: null });
  Net.openLobby();
  Net.uiShow('resuming');
  NetServer.install('guest'); // the welcome frame corrects role/side
  NetServer.connect(false);
  return true;
};

/* Present a Room-shaped object to Net so dropRoom/leave/cancel work unchanged. */
NetServer.install = function (role) {
  Net.code = NetServer.code;
  Net.role = role;
  Net.side = role === 'host' ? 0 : 1;
  Net.peerId = 'server';
  Net.room = { leave: () => NetServer.teardown(true), getPeers: () => ({ server: true }) };
  Net.wire = {
    sendSt() { return Promise.resolve(); },
    sendIn() { return Promise.resolve(); },              // inputs ride the binary lane only
    sendEv: (ev) => { NetServer.sendJson(ev); return Promise.resolve(); },
  };
  Net.rtc = { route: 'server', protocol: 'ws', localType: '', remoteType: '', availableOut: 0 };
};

NetServer.sendJson = function (obj) {
  const ws = NetServer.ws;
  if (!ws || ws.readyState !== 1) return false;
  try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
};

/* The realtime lane is the WebSocket: same packets, same health rules. */
NetServer.laneAdapter = function (ws) {
  return {
    get readyState() { return ws.readyState === 1 ? 'open' : ws.readyState === 0 ? 'connecting' : 'closed'; },
    get bufferedAmount() { return ws.bufferedAmount; },
    send: (b) => ws.send(b),
    close: () => {},   // the socket's lifetime belongs to NetServer, not to Net.closeRealtime
  };
};

NetServer.connect = function (isRetry) {
  const token = NetServer.token;
  let ws;
  try { ws = new WebSocket(Net.serverUrl() + '/ws/' + NetServer.code); }
  catch (e) { NetServer.failed(isRetry, 'unreachable'); return; }
  ws.binaryType = 'arraybuffer';
  NetServer.ws = ws;
  clearTimeout(NetServer.connectTimer);
  NetServer.connectTimer = setTimeout(() => {
    if (token === NetServer.token && NetServer.ws === ws && ws.readyState !== 1) {
      NetServer.ws = null; // its late onclose must not be handled twice
      try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch (e) {}
      NetServer.failed(isRetry, 'timeout');
    }
  }, NET_SERVER_CONNECT_TIMEOUT_MS);
  ws.onopen = () => {
    if (token !== NetServer.token || NetServer.ws !== ws) return;
    // intent 'create' only on the FIRST connect of a created room; a reconnect is always a plain join of our own seat
    const resuming = NetServer.joined;
    NetServer.sendJson(Object.assign({
      t: 'join', pid: NetServer.pid, key: NetServer.key,
      intent: resuming ? 'join' : NetServer.intent,
      have: resuming && Net.active && Net.matchStarted,
    }, resuming || !NetServer.settings ? {} : NetServer.settings));
  };
  ws.onmessage = (ev) => {
    if (token !== NetServer.token || NetServer.ws !== ws) return;
    try {
      if (typeof ev.data === 'string') {
        if (ev.data === 'pong') NetServer.onPong();
        else NetServer.onJson(JSON.parse(ev.data));
      } else Net.onRealtimeMessage(ev.data);
    } catch (e) { Net.logErr(e); }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (token !== NetServer.token || NetServer.ws !== ws) return;
    NetServer.onClosed(isRetry);
  };
};

NetServer.onJson = function (ev) {
  if (!ev || typeof ev.t !== 'string') return;
  switch (ev.t) {
    case 'welcome': return NetServer.onWelcome(ev);
    case 'error': return NetServer.onError(ev.code);
    case 'rival-drop': return NetServer.rivalDrop();
    case 'rival-back': return NetServer.rivalBack();
    case 'leave': // the match is over for good: never reconnect to a closed table
      NetServer.leaving = true; NetServer.clearSession();
      return Net.onEvent(ev, 'server');
    default: Net.onEvent(ev, 'server'); // hello, countdown, goal, pause, resume, rematch, leave
  }
};

NetServer.onWelcome = function (ev) {
  const wasReconnecting = Net.reconnecting;
  NetServer.open = true; NetServer.joined = true; NetServer.retries = 0; NetServer.firstFailT = 0;
  clearTimeout(NetServer.connectTimer);
  Net.role = ev.side === 0 ? 'host' : 'guest';
  Net.side = ev.side === 0 ? 0 : 1;
  Net.peerId = 'server';
  Net.authoritySide = 1 - Net.side; Net.authorityEpoch = 1;
  const ws = NetServer.ws;
  Net.rtChannel = NetServer.laneAdapter(ws); Net.rtPc = null; Net.rtReady = true;
  Net.rtOpenedT = performance.now(); Net.rtLastRxT = Net.rtLastStateRxT = Net.rtLastAckRxT = 0;
  Net.rtLastStateSeq = null; Net.rtAckInputSeq = null; Net.lastAppliedStateSeq = null;
  Net.lastIn = null;   // the server's input sequencing restarts with the socket
  Net.rtInputSeq = 0;
  NetServer.saveSession();
  NetServer.startPing();
  if (wasReconnecting) NetServer.rivalBack(); // our own return: unfreeze exactly like a rival's return
  if (ev.state === 'lobby') { Net.waitingForRival = ev.side === 0; if (ev.side === 0) Net.uiShow('waiting', { code: NetServer.code }); }
};

NetServer.onError = function (code) {
  NetServer.token++; // stop all retry logic for this attempt
  const wasLive = Net.active;
  NetServer.teardown(false);
  NetServer.clearSession();
  const messages = {
    'no-such-room': "No table with that code. Check it and try again.",
    'code-taken': 'That table code is already in use. Try hosting again.',
    'room-full': 'That table already has two players.',
    'bad-join': "Couldn't join that table. Try again.",
    'bad-key': "That seat belongs to someone else.",
    'ended': 'That table has closed.',
    'busy': 'The server is busy. Try again in a moment.',
  };
  if (wasLive) { Net.onRivalLeft(); return; }
  Net.dropRoom(); Net.code = null;
  Net.uiShow('choose');
  Net.uiError(messages[code] || "Couldn't reach the game server. Try again.");
};

/* Unreachable server / lost socket. Before a match: a clear lobby error, no hang.
 * During a match: freeze, say "reconnecting", retry the same seat with backoff. */
NetServer.failed = function (isRetry, why) {
  Net.logErr(new Error('game server ' + why));
  NetServer.onClosed(isRetry);
};

NetServer.onClosed = function () {
  const wasOpen = NetServer.open;
  NetServer.open = false;
  clearTimeout(NetServer.connectTimer);
  NetServer.stopPing();
  if (Net.rtChannel && Net.rtReady) Net.rtReady = false;
  if (NetServer.leaving) return;
  if (!NetServer.joined) { // never got a seat: tell the player plainly
    NetServer.teardown(false);
    Net.dropRoom(); Net.code = null;
    Net.uiShow('choose');
    Net.uiError("Couldn't reach the game server. Check your connection, or switch back to peer-to-peer.");
    return;
  }
  if (Net.active && !Net.reconnecting) NetServer.freezeForReconnect();
  const delay = NET_SERVER_RETRY_MS[Math.min(NetServer.retries, NET_SERVER_RETRY_MS.length - 1)];
  NetServer.retries++;
  const budget = NET_SERVER_RESUME_TTL_MS;
  const nowT = performance.now(); // monotonic: a wall-clock jump must not shorten or extend the budget
  if (!NetServer.firstFailT) NetServer.firstFailT = nowT;
  if (nowT - NetServer.firstFailT > budget) {
    NetServer.firstFailT = 0;
    NetServer.teardown(false); NetServer.clearSession();
    if (Net.active) Net.onRivalLeft(); else { Net.dropRoom(); Net.uiShow('choose'); Net.uiError('Lost the connection to the game server.'); }
    return;
  }
  const token = NetServer.token;
  clearTimeout(NetServer.retryTimer);
  NetServer.retryTimer = setTimeout(() => { if (token === NetServer.token && !NetServer.leaving) NetServer.connect(true); }, delay);
  if (wasOpen || NetServer.retries > 1) Net.paintConn();
};

/* Freeze the table the same way a rival drop does (pause card + notice), silently. */
NetServer.freezeForReconnect = function () {
  Net.reconnecting = true;
  Net.dropPaused = (G.state === 'pause');
  Net.reconnectState = G.state === 'pause' ? G.pausedFrom : G.state;
  if (G.state === 'play' || G.state === 'count' || G.state === 'goal') togglePause(true, true);
  Net.setPauseNotice(true);
  Net.paintConn();
};
NetServer.rivalDrop = function () { if (Net.active && !Net.reconnecting) NetServer.freezeForReconnect(); };
NetServer.rivalBack = function () {
  NetServer.firstFailT = 0;
  if (!Net.reconnecting) return;
  Net.reconnecting = false;
  Net.setPauseNotice(false);
  const resumeUs = !Net.dropPaused && G.state === 'pause' && Net.reconnectState && Net.reconnectState !== 'pause';
  if (resumeUs) togglePause(false, true);
  Net.reconnectState = null; Net.dropPaused = false;
  Net.paintConn();
};

/* RTT: the runtime auto-answers the literal text 'ping' with 'pong' without
 * waking the object, so probing is free of duration cost. */
NetServer.startPing = function () {
  NetServer.stopPing();
  NetServer.pingTimer = setInterval(() => NetServer.ping(), NET_SERVER_PING_MS);
};
NetServer.stopPing = function () { clearInterval(NetServer.pingTimer); NetServer.pingTimer = 0; NetServer.pingQueue.length = 0; };
NetServer.ping = function () {
  const ws = NetServer.ws;
  if (!ws || ws.readyState !== 1) return;
  Net.conn.pingId++;
  const id = Net.conn.salt + '-' + Net.conn.pingId;
  if (!Net.conn.pending) Net.conn.pending = {};
  Net.conn.pending[id] = performance.now();
  NetServer.pingQueue.push(id);
  if (NetServer.pingQueue.length > 8) NetServer.pingQueue.shift();
  try { ws.send('ping'); } catch (e) {}
};
NetServer.onPong = function () {
  const id = NetServer.pingQueue.shift();
  if (id) Net.onPong({ id });
};

/* Close the socket and stop every timer. `leaving` suppresses reconnect. */
NetServer.teardown = function (leaving) {
  NetServer.leaving = !!leaving;
  clearTimeout(NetServer.retryTimer); NetServer.retryTimer = 0;
  clearTimeout(NetServer.connectTimer); NetServer.connectTimer = 0;
  NetServer.stopPing();
  NetServer.firstFailT = 0;
  const ws = NetServer.ws;
  NetServer.ws = null; NetServer.open = false;
  if (leaving) NetServer.clearSession();
  if (ws) { try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch (e) {} }
};
