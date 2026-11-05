/* ============================================================================
 * worker.js - Cloudflare Worker + Durable Object glue for the dedicated
 * Atelier Air Hockey server. All game rules live in match.js / sim.js and the
 * SHARED-SIM region of src/net.js; this file only does transport, routing,
 * hibernation, the 60 Hz loop, persistence and the expiry alarm.
 *
 *   Worker      GET /health            -> {ok:true, service:"atelier-air-hockey-server"}
 *               GET /ws/<CODE>         -> WebSocket, routed to env.MATCH.idFromName(CODE)
 *   Durable Object class  AirHockeyMatch  (SQLite-backed; binding name MATCH)
 *
 * One Durable Object per match. The room code IS the object name, so two
 * players typing the same code always land on the same object; no lobby
 * server, no database, no accounts.
 * ==========================================================================*/

const SRV_ALLOWED_ORIGINS = new Set(['https://builtbysai.com']);
const SRV_TICK_MS = 1000 / 60;
const SRV_CHECKPOINT_MS = 15000;
const SRV_MAX_JSON_BYTES = 512;
const SRV_RATE_WINDOW_MS = 1000;
const SRV_RATE_MAX = 240;               // inputs are ~30/s; anything above this is abuse
const SRV_MAX_PENDING_SOCKETS = 6;

function srvOriginAllowed(origin) {
  if (!origin) return true; // non-browser clients cannot be stopped by Origin anyway
  if (SRV_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch { return false; }
}

function srvJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

const srvWorker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return srvJson({ ok: true, service: 'atelier-air-hockey-server', v: SRV_VERSION });
    const route = url.pathname.match(/^\/ws\/([A-Z2-9]{6})$/);
    if (!route) return srvJson({ error: 'not_found' }, 404);
    if (request.headers.get('Upgrade') !== 'websocket') return srvJson({ error: 'expected_websocket' }, 426);
    if (!srvOriginAllowed(request.headers.get('Origin') || '')) return srvJson({ error: 'origin_not_allowed' }, 403);
    // room code -> Durable Object: deterministic, so both players meet in one object
    const stub = env.MATCH.get(env.MATCH.idFromName(route[1]));
    return stub.fetch(request);
  },
};

class AirHockeyMatch {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.match = null; this.loop = 0; this.lastCheckpoint = 0;
    this.rate = new Map();
    // Keep-alive / RTT probe answered by the runtime without waking the object.
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) {}
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('m');
      if (!saved) return;
      const now = Date.now();
      const connected = [];
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment();
        if (att && att.side >= 0) connected.push(att.side);
      }
      this.match = Match.restore(saved, now, connected);
      this.match.afterRestore(now);
      this.afterEvent();
    });
  }

  async fetch(request) {
    const code = new URL(request.url).pathname.split('/').pop();
    const pending = this.ctx.getWebSockets().filter(w => { const a = w.deserializeAttachment(); return !a || a.side < 0; });
    if (pending.length >= SRV_MAX_PENDING_SOCKETS) return srvJson({ error: 'busy' }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ side: -1, code });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- socket events --------------------------------------------------------
  async webSocketMessage(ws, message) {
    const now = Date.now();
    if (!this.allow(ws, now)) { try { ws.close(1008, 'rate'); } catch (e) {} return; }
    const att = ws.deserializeAttachment() || { side: -1 };
    try {
      if (typeof message === 'string') {
        if (message.length > SRV_MAX_JSON_BYTES) return;
        let ev; try { ev = JSON.parse(message); } catch (e) { return; }
        if (att.side < 0) { if (ev && ev.t === 'join') this.handleJoin(ws, att, ev, now); }
        else if (this.match) this.match.onJson(att.side, ev, now);
      } else if (att.side >= 0 && this.match) {
        this.match.onBinary(att.side, message, now);
      }
    } catch (e) { console.warn('[air-hockey-server] message error', e && e.message); }
    this.afterEvent(true);
  }

  async webSocketClose(ws) { this.dropSocket(ws); }
  async webSocketError(ws) { this.dropSocket(ws); }

  dropSocket(ws) {
    this.rate.delete(ws);
    const att = ws.deserializeAttachment();
    try { ws.close(1000, 'bye'); } catch (e) {}
    if (att && att.side >= 0 && !att.replaced && this.match) {
      this.match.disconnect(att.side, Date.now());
      this.afterEvent(true);
    }
  }

  allow(ws, now) {
    let r = this.rate.get(ws);
    if (!r || now - r.t0 > SRV_RATE_WINDOW_MS) { r = { t0: now, n: 0 }; this.rate.set(ws, r); }
    return ++r.n <= SRV_RATE_MAX;
  }

  handleJoin(ws, att, ev, now) {
    const reply = (obj) => { try { ws.send(JSON.stringify(obj)); } catch (e) {} };
    const fresh = !this.match;
    if (fresh) {
      if (ev.intent !== 'create') { reply({ t: 'error', code: 'no-such-room' }); try { ws.close(1000, 'no-such-room'); } catch (e) {} return; }
      this.match = new Match(att.code, now);
    }
    const res = this.match.connect(ev, now);
    if (!res.ok) {
      // the match.out holds nothing for this socket yet; report and drop
      this.match.drain();
      reply({ t: 'error', code: res.code });
      if (fresh) this.match = null; // a failed create leaves no state behind
      try { ws.close(1000, res.code); } catch (e) {}
      return;
    }
    // one live socket per seat: a reconnect replaces the old one silently
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment();
      if (a && a.side === res.side) { other.serializeAttachment(Object.assign({}, a, { replaced: true })); try { other.close(4000, 'replaced'); } catch (e) {} }
    }
    ws.serializeAttachment({ side: res.side, code: att.code });
  }

  // ---- outbox / loop / persistence / alarm -------------------------------------
  flush() {
    if (!this.match) return;
    const out = this.match.drain();
    if (!out.length) return;
    const bySide = [[], []];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.side >= 0 && !a.replaced) bySide[a.side].push(ws);
    }
    for (const o of out) {
      const targets = o.to === 'all' ? bySide[0].concat(bySide[1]) : (bySide[o.to] || []);
      const data = o.bin || JSON.stringify(o.json);
      for (const ws of targets) { try { ws.send(data); } catch (e) {} }
    }
  }

  afterEvent(persist = false) {
    this.flush();
    this.syncLoop();
    if (this.match && this.match.state === 'ended') { void this.wipe(); return; }
    if (persist && this.match) this.save();
    this.syncAlarm();
  }

  syncLoop() {
    const want = !!(this.match && this.match.wantsTick());
    if (want && !this.loop) {
      this.loop = setInterval(() => {
        try {
          const now = Date.now();
          this.match.tick(now);
          this.flush();
          if (now - this.lastCheckpoint > SRV_CHECKPOINT_MS) { this.lastCheckpoint = now; this.save(); }
          if (!this.match.wantsTick()) { this.syncLoop(); this.save(); }
        } catch (e) { console.warn('[air-hockey-server] tick error', e && e.message); }
      }, SRV_TICK_MS);
    } else if (!want && this.loop) { clearInterval(this.loop); this.loop = 0; }
  }

  save() { try { void this.ctx.storage.put('m', this.match.serialize()); } catch (e) {} }

  syncAlarm() {
    const d = this.match ? this.match.deadline() : 0;
    try { if (d) void this.ctx.storage.setAlarm(d); else void this.ctx.storage.deleteAlarm(); } catch (e) {}
  }

  async alarm() {
    if (!this.match) return;
    if (this.match.expire(Date.now())) { this.afterEvent(); return; }
    this.syncAlarm();
  }

  /* The match is over (or nobody is left): tell anyone still attached, close
   * the sockets and delete every stored byte so the object costs nothing. */
  async wipe() {
    this.flush();
    if (this.loop) { clearInterval(this.loop); this.loop = 0; }
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'match-ended'); } catch (e) {} }
    this.match = null;
    try { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); } catch (e) {}
  }
}
