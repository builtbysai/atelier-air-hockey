/* ============================================================================
 * match.js - one authoritative match, as a pure state machine.
 *
 * No Cloudflare APIs, no timers, no I/O: the Durable Object (worker.js) feeds
 * it connect/disconnect/message/tick events with an injected clock and drains
 * `out` (frames to send). That keeps every rule here unit-testable in Node.
 *
 * Both players are equals. The server owns the puck, both mallets, the score,
 * the countdown, goals, pause, win and rematch. A client only ever sends:
 *   - its mallet TARGET (binary type 2, same 12-byte packet as P2P)
 *   - an optional contact HINT (binary type 4, validated by the shared validator)
 *   - control events (pause / resume / rematch / restart-req / leave)
 * and receives the same 56-byte state packet (type 1) and 4-byte input ACK
 * (type 3) the P2P realtime lane uses, plus JSON control events whose names
 * match the P2P `ev` protocol (hello, countdown, goal, pause, resume, rematch,
 * leave) so the client's existing handlers consume them unchanged.
 * ==========================================================================*/

const SRV_VERSION = 1;
const SRV_COUNT_S = 2.0;                 // game.js updateCount: play at countT >= 2.0
const SRV_GOAL_HOLD_S = 1.95;            // GOAL_HOLD_OWN
const SRV_GOAL_HOLD_WIN_S = 2.70;        // GOAL_HOLD_WIN
const SRV_MAX_DT_S = 0.05;
const SRV_DROP_GRACE_MS = 90 * 1000;     // a dropped player has this long to come back
const SRV_EMPTY_TTL_MS = 60 * 1000;      // zero connected players -> match ends, DO freed
const SRV_LOBBY_TTL_MS = 10 * 60 * 1000; // a created room nobody joins
const SRV_MATCH_MAX_MS = 2 * 60 * 60 * 1000;
const SRV_FIRST_TO = [5, 7, 11];

function srvFreshStats() { return { topSpeed: 0, rally: 0, bestRally: 0, rallyLastSide: -1, saves: [0, 0] }; }
function srvValidId(s) { return typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s); }

class Match {
  constructor(code, nowMs, opts = {}) {
    this.code = code;
    this.createdMs = nowMs;
    this.rng = opts.rng || Math.random;
    this.state = 'lobby';           // lobby | count | play | goal | pause | win | ended
    this.settings = { firstTo: 7, pace: 'classic', goalW: 200 };
    this.players = [null, null];
    this.score = [0, 0];
    this.stats = srvFreshStats();
    this.world = simWorld({ rng: this.rng });
    this.serve = { dir: 1, vx: 0, vy: 0 };
    this.musicSeed = 0;
    this.countT = 0; this.goalT = 0; this.goalSide = 0; this.winSide = 0;
    this.pausedFrom = 'play';
    this.pauseReasons = new Set();  // 'manual' | 'drop0' | 'drop1' | 'restore'
    this.offerFrom = -1;
    this.lastTickMs = 0;
    this.emptySinceMs = 0;
    // lag compensation (shared validator)
    this.lagRing = lagRingNew(); this.lagEpoch = 1;
    this.pointSerial = 0; this.touchSerial = 0;
    this.stateSeq = 0;
    this.metrics = { hintsReceived: 0, hintsAccepted: 0, hintsApplied: 0, reasons: {}, inputs: 0, frames: 0 };
    this.out = [];
  }

  // ---- outbox ---------------------------------------------------------------
  send(to, json) { this.out.push({ to, json }); }
  sendBin(to, bin) { this.out.push({ to, bin }); }
  drain() { const o = this.out; this.out = []; return o; }
  /* Per-recipient decoration: the client's existing guest path treats the
   * remote simulator as "authority", so tell each client the OTHER side owns
   * authority (its rival's mallet is eased, its own mallet is local). */
  decorate(side, ev) { return Object.assign({ authoritySide: 1 - side, authorityEpoch: 1 }, ev); }

  // ---- membership -----------------------------------------------------------
  connectedCount() { return this.players.filter(p => p && p.connected).length; }

  /* A player presents {pid, key}. Returns {ok, side, resumed} or {ok:false, code}. */
  connect(join, nowMs) {
    if (this.state === 'ended') return { ok: false, code: 'ended' };
    if (!join || !srvValidId(join.pid) || !srvValidId(join.key)) return { ok: false, code: 'bad-join' };
    let side = this.players.findIndex(p => p && p.pid === join.pid);
    let resumed = false;
    if (side >= 0) {
      if (this.players[side].key !== join.key) return { ok: false, code: 'bad-key' };
      resumed = true;
    } else {
      const roomExists = !!this.players[0];
      if (join.intent === 'create' && roomExists) return { ok: false, code: 'code-taken' };
      if (join.intent !== 'create' && !roomExists) return { ok: false, code: 'no-such-room' };
      side = this.players[0] ? (this.players[1] ? -1 : 1) : 0;
      if (side < 0) return { ok: false, code: 'room-full' };
      this.players[side] = {
        pid: join.pid, key: join.key, connected: false, droppedMs: 0,
        tx: side === 0 ? PX + 170 : PX + PW - 170, ty: CY,
        lastInputSeq: null, lastHintSeq: null, lastHintPose: null, needsFull: true,
      };
      if (side === 0) this.applySettings(join);
    }
    const p = this.players[side];
    const wasConnected = p.connected;
    p.connected = true; p.droppedMs = 0; this.emptySinceMs = 0;
    p.needsFull = !(join.have === true);   // client says it already holds a live match view
    p.lastInputSeq = null;                 // a new socket restarts input sequencing
    this.send(side, { t: 'welcome', v: SRV_VERSION, side, code: this.code, resumed, state: this.state });

    if (this.state === 'lobby') {
      if (this.players[0] && this.players[1] && this.players[0].connected && this.players[1].connected)
        this.startMatch(nowMs);
    } else {
      this.pauseReasons.delete('drop' + side);
      if (this.pauseReasons.has('restore') && this.connectedCount() === 2) {
        this.pauseReasons.delete('restore');
        this.startPoint(false, nowMs); // a restored match restarts its point cleanly
      }
      this.syncPlayer(side);
      const other = 1 - side;
      if (this.players[other] && this.players[other].connected) this.send(other, { t: 'rival-back' });
      this.maybeResume();
    }
    return { ok: true, side, resumed, wasConnected };
  }

  applySettings(j) {
    if (SRV_FIRST_TO.includes(+j.firstTo)) this.settings.firstTo = +j.firstTo;
    if (PACES[j.pace]) this.settings.pace = j.pace;
    if (GOAL_WIDTHS.includes(+j.gw)) this.settings.goalW = +j.gw;
  }

  /* Re-hello a (re)connecting client that does not hold a live match view. */
  syncPlayer(side) {
    const p = this.players[side];
    if (this.state === 'lobby') return;
    if (p.needsFull) {
      p.needsFull = false;
      this.send(side, this.decorate(side, this.helloEv()));
      this.send(side, this.decorate(side, this.countdownEv(true)));
    }
    this.broadcastState(side);
  }

  disconnect(side, nowMs) {
    const p = this.players[side];
    if (!p || !p.connected) return;
    p.connected = false; p.droppedMs = nowMs;
    if (this.connectedCount() === 0) this.emptySinceMs = nowMs;
    if (this.state === 'lobby' || this.state === 'ended') return;
    const other = 1 - side;
    if (this.state === 'win') { // nothing to protect; the room waits out its grace
      if (this.players[other] && this.players[other].connected) this.send(other, { t: 'rival-drop', graceMs: SRV_DROP_GRACE_MS });
      return;
    }
    this.pause('drop' + side);
    if (this.players[other] && this.players[other].connected) this.send(other, { t: 'rival-drop', graceMs: SRV_DROP_GRACE_MS });
  }

  // ---- events ---------------------------------------------------------------
  helloEv() {
    return { t: 'hello', firstTo: this.settings.firstTo, pace: this.settings.pace, theme: null, mseed: this.musicSeed };
  }
  countdownEv(fresh) {
    return {
      t: 'countdown', fresh, s0: this.score[0], s1: this.score[1], serveDir: this.serve.dir,
      svx: Math.round(this.serve.vx * 10) / 10, svy: Math.round(this.serve.vy * 10) / 10,
      gw: this.world.goalW, mseed: this.musicSeed,
    };
  }
  both(fn) { for (let s = 0; s < 2; s++) if (this.players[s] && this.players[s].connected) this.send(s, fn(s)); }

  onJson(side, ev, nowMs) {
    if (!ev || typeof ev !== 'object' || typeof ev.t !== 'string' || this.state === 'ended' || this.state === 'lobby') return;
    const other = 1 - side;
    switch (ev.t) {
      case 'pause':
        if (this.pause('manual')) this.send(other, { t: 'pause' });
        break;
      case 'resume':
        if (this.pauseReasons.delete('manual')) { this.send(other, { t: 'resume' }); this.maybeResume(); }
        break;
      case 'rematch':
        if (this.state !== 'win') break;
        if (ev.phase === 'offer') { this.offerFrom = side; this.send(other, { t: 'rematch', phase: 'offer' }); }
        else if (ev.phase === 'accept' && this.offerFrom === other) {
          this.send(other, { t: 'rematch', phase: 'accept' });
          this.startMatch(nowMs);
        } else if (ev.phase === 'decline') { this.offerFrom = -1; this.send(other, { t: 'rematch', phase: 'decline' }); }
        break;
      case 'restart-req':
        if (this.connectedCount() === 2 && this.state !== 'win') this.startMatch(nowMs);
        break;
      case 'sync-req':
        this.broadcastState(side);
        break;
      case 'leave':
        this.end('left', side);
        break;
    }
  }

  pause(reason) {
    const live = this.state === 'count' || this.state === 'play' || this.state === 'goal';
    if (live) { this.pausedFrom = this.state; this.state = 'pause'; }
    if (this.state !== 'pause') return false;
    this.pauseReasons.add(reason);
    return true;
  }
  maybeResume() {
    if (this.state === 'pause' && this.pauseReasons.size === 0) {
      this.state = this.pausedFrom;
      this.lastTickMs = 0; // do not simulate the paused wall-clock gap
      this.broadcastState();
    }
  }

  end(reason, bySide) {
    if (this.state === 'ended') return;
    this.state = 'ended'; this.endReason = reason;
    for (let s = 0; s < 2; s++)
      if (s !== bySide && this.players[s] && this.players[s].connected) this.send(s, { t: 'leave', reason });
  }

  // ---- match flow -----------------------------------------------------------
  startMatch(nowMs) {
    this.score = [0, 0]; this.stats = srvFreshStats(); this.winSide = 0; this.offerFrom = -1;
    this.pauseReasons.clear();
    this.world = simWorld({ pace: this.settings.pace, goalW: this.settings.goalW, rng: this.rng });
    this.musicSeed = (this.rng() * 0xFFFFFFFF) >>> 0;
    this.lagRing = lagRingNew(); this.lagEpoch++; this.pointSerial = 0; this.touchSerial = 0;
    for (const p of this.players) if (p) { p.lastHintSeq = null; p.lastHintPose = null; p.lastInputSeq = null; p.needsFull = false; }
    this.both(s => this.decorate(s, this.helloEv()));
    this.startPoint(true, nowMs);
  }

  startPoint(fresh, nowMs, dir) {
    simResetPositions(this.world);
    for (let s = 0; s < 2; s++) { const p = this.players[s]; if (p) { this.world.m[s].tx = p.tx = this.world.m[s].x; this.world.m[s].ty = p.ty = this.world.m[s].y; } }
    this.serve = simRollServe(this.world, dir || (this.rng() < 0.5 ? 1 : -1));
    this.pointSerial++;                    // a new point/restart invalidates every older contact claim
    this.state = 'count'; this.countT = 0;
    this.stats.rally = 0; this.stats.rallyLastSide = -1;
    this.lastTickMs = nowMs;
    this.both(s => this.decorate(s, this.countdownEv(fresh)));
    this.broadcastState();
  }

  hooks() {
    return {
      touch: () => { this.touchSerial = (this.touchSerial + 1) >>> 0; },
      rally: (side) => {
        const st = this.stats;
        if (this.state !== 'play' || side === st.rallyLastSide) return;
        st.rallyLastSide = side; st.rally++;
        if (st.rally > st.bestRally) st.bestRally = st.rally;
      },
      save: (side) => { if (this.state === 'play') this.stats.saves[side]++; },
    };
  }

  onGoal(scorer, nowMs) {
    this.score[scorer]++;
    this.state = 'goal'; this.goalT = 0; this.goalSide = scorer;
    this.stats.rally = 0; this.stats.rallyLastSide = -1;
    const matchEnd = this.score[scorer] >= this.settings.firstTo;
    this.both(() => ({ t: 'goal', scorer, s0: this.score[0], s1: this.score[1], matchEnd }));
  }

  /* Advance the simulation to `nowMs`; broadcast one state frame per call
   * while the table is live. Safe to call at any cadence. */
  tick(nowMs) {
    if (this.state !== 'count' && this.state !== 'play' && this.state !== 'goal') { this.lastTickMs = 0; return; }
    let dt = this.lastTickMs ? (nowMs - this.lastTickMs) / 1000 : 1 / 60;
    this.lastTickMs = nowMs;
    if (!(dt > 0)) return;
    dt = Math.min(dt, SRV_MAX_DT_S);
    const w = this.world;
    if (this.state === 'goal') {
      this.goalT += dt;
      const p = w.puck, gx = this.goalSide === 0 ? PX + PW + 70 : PX - 70;
      const k = clamp(dt * 5, 0, 1);
      p.x += (gx - p.x) * k; p.y += (CY - p.y) * k; p.vx *= 0.9; p.vy *= 0.9;
      const hold = this.score[this.goalSide] >= this.settings.firstTo ? SRV_GOAL_HOLD_WIN_S : SRV_GOAL_HOLD_S;
      if (this.goalT > hold) {
        if (this.score[this.goalSide] >= this.settings.firstTo) {
          this.winSide = this.score[0] > this.score[1] ? 0 : 1;
          this.state = 'win';
          this.broadcastState();
          return;
        }
        this.startPoint(false, nowMs, this.goalSide === 0 ? 1 : -1);
        return;
      }
    } else {
      if (this.state === 'count') {
        this.countT += dt;
        if (this.countT >= SRV_COUNT_S) {
          this.state = 'play';
          w.puck.vx = this.serve.vx; w.puck.vy = this.serve.vy;
        }
      }
      const sub = Math.max(1, Math.ceil(dt / (1 / SUB_HZ))), sdt = dt / sub, hooks = this.hooks();
      for (let i = 0; i < sub; i++) {
        for (let s = 0; s < 2; s++) {
          const p = this.players[s];
          if (p) { w.m[s].tx = p.tx; w.m[s].ty = p.ty; }
          simDriveMallet(w.m[s], sdt, PLAYER_CAP);
        }
        if (this.state !== 'play') continue; // countdown: mallets move, puck waits
        const scorer = simStepPhysics(w, sdt, hooks, this.stats);
        if (scorer >= 0) { this.onGoal(scorer, nowMs); break; }
      }
    }
    this.recordAndBroadcast(nowMs);
  }

  // ---- state frames ---------------------------------------------------------
  snapshotArray() {
    const p = this.world.puck, [m1, m2] = this.world.m;
    let flags = 0;
    const st = this.state === 'pause' ? this.pausedFrom : this.state;
    if (this.state === 'pause') flags |= 8;
    else if (st === 'count') flags |= 1; else if (st === 'play') flags |= 2;
    else if (st === 'goal') flags |= 4; else if (st === 'win') flags |= 16;
    if ((this.score[0] === this.settings.firstTo - 1 || this.score[1] === this.settings.firstTo - 1) && (flags & 3)) flags |= 32;
    return [p.x, p.y, p.vx, p.vy, m1.x, m1.y, m2.x, m2.y, this.score[0], this.score[1], flags,
      Math.round(this.stats.topSpeed), this.stats.bestRally, this.stats.saves[0], this.stats.saves[1],
      this.serve.vx, this.serve.vy, this.serve.dir];
  }

  nextSeq() { this.stateSeq = (this.stateSeq + 1) & 0xffff; return this.stateSeq; }

  /* Publish the authoritative state under a new sequence AND record the exact
   * same state in the lag history, atomically (design doc: history ring). */
  recordAndBroadcast(nowMs) {
    const seq = this.nextSeq(), w = this.world, p = w.puck;
    this.lagRing[seq & (NET_LAG_HISTORY - 1)] = {
      seq, epoch: this.lagEpoch, timeMs: nowMs,
      pointSerial: this.pointSerial, touchSerial: this.touchSerial, state: this.state,
      puckX: p.x, puckY: p.y, puckVx: p.vx, puckVy: p.vy, puckW: Number.isFinite(p.w) ? p.w : 0,
      mallets: w.m.map(m => ({ x: m.x, y: m.y, vx: m.vx, vy: m.vy })),
    };
    this.metrics.frames++;
    this.sendBin('all', rtEncodeState(this.snapshotArray(), seq));
  }

  /* One-off frame (reconnect, pause, win, sync-req); not recorded for lag history. */
  broadcastState(to = 'all') {
    if (this.state === 'lobby' || this.state === 'ended') return;
    this.sendBin(to, rtEncodeState(this.snapshotArray(), this.nextSeq()));
  }

  // ---- realtime input -------------------------------------------------------
  onBinary(side, buf, nowMs) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 4 || buf.byteLength > 64) return;
    const v = new DataView(buf), type = v.getUint8(0), pl = this.players[side];
    if (!pl || this.state === 'ended' || this.state === 'lobby') return;
    if (type === NET_RT_INPUT) {
      const d = rtDecodeInput(v);
      if (!d || !rtSeqNewer(d.seq, pl.lastInputSeq) || !Number.isFinite(d.tx) || !Number.isFinite(d.ty)) return;
      pl.lastInputSeq = d.seq;
      const t = simClampTarget(side, d.tx, d.ty);
      pl.tx = t.x; pl.ty = t.y;
      this.metrics.inputs++;
      // Cumulative, replaceable ACK: the client's prediction fence.
      this.sendBin(side, rtEncodeAck(pl.lastInputSeq));
    } else if (type === NET_RT_HIT_HINT) {
      this.onHint(side, v, nowMs);
    }
  }

  onHint(side, v, nowMs) {
    const m = this.metrics, pl = this.players[side];
    m.hintsReceived++;
    let result;
    try {
      const hint = lagDecodeHint(v);
      if (!hint) { result = { ok: false, reason: 'malformed' }; }
      else {
        const p = this.world.puck;
        const view = lagBuildView(this.lagRing, this.lagEpoch, hint, nowMs, {
          lastInputSeq: pl.lastInputSeq, lastHintSeq: pl.lastHintSeq, hinterSide: side, prevPose: pl.lastHintPose,
          current: {
            pointSerial: this.pointSerial, touchSerial: this.touchSerial, state: this.state,
            puckX: p.x, puckY: p.y, puckVx: p.vx, puckVy: p.vy, puckW: Number.isFinite(p.w) ? p.w : 0,
          },
          newestSeq: this.stateSeq,
        });
        if (view.history) { // the validator's "guestMallet" is the HINTING player's mallet
          const hm = view.history.mallets[side];
          view.history = Object.assign({}, view.history, {
            guestMalletX: hm.x, guestMalletY: hm.y, guestMalletVx: hm.vx, guestMalletVy: hm.vy,
          });
        }
        result = lagValidateContactHint(hint, view);
        if (result.reason !== 'malformed' && result.reason !== 'duplicate-or-replay' && result.reason !== 'input-lead')
          pl.lastHintSeq = hint.inputSeq;
        if (result.ok) {
          pl.lastHintPose = { x: hint.malletX, y: hint.malletY, timeMs: nowMs };
          const hit = lagApplyContact(p, result.contact, hint);
          if (hit) {
            m.hintsApplied++;
            this.touchSerial = (this.touchSerial + 1) >>> 0;
            this.world.lastTouch = side;
            this.world.stallT = 0;
            const mal = this.world.m[side], dx = p.x - mal.x, dy = p.y - mal.y, minD = p.r + mal.r;
            // the server's own copy of that mallet already overlapping consumes the claim: no double strike
            if (dx * dx + dy * dy < minD * minD) mal.ghostT = Math.max(mal.ghostT || 0, NET_LAG_GHOST_S);
            this.hooks().rally(side);
          }
        }
      }
    } catch (e) { result = { ok: false, reason: 'malformed' }; }
    m.reasons[result.reason] = (m.reasons[result.reason] || 0) + 1;
    if (result.ok) m.hintsAccepted++;
    this.lastHintResult = result;
    return result;
  }

  // ---- lifecycle ------------------------------------------------------------
  /* True while the DO should run its 60 Hz loop. Paused / lobby / win cost nothing. */
  wantsTick() { return this.state === 'count' || this.state === 'play' || this.state === 'goal'; }

  /* Next wall-clock moment something expires, or 0. */
  deadline() {
    if (this.state === 'ended') return 0;
    let d = this.createdMs + SRV_MATCH_MAX_MS;
    if (this.state === 'lobby') d = Math.min(d, this.createdMs + SRV_LOBBY_TTL_MS);
    for (const p of this.players) if (p && !p.connected && p.droppedMs) d = Math.min(d, p.droppedMs + SRV_DROP_GRACE_MS);
    if (this.emptySinceMs) d = Math.min(d, this.emptySinceMs + SRV_EMPTY_TTL_MS);
    return d;
  }

  /* Enforce expiry. Returns true when the match is over and the DO should be wiped. */
  expire(nowMs) {
    if (this.state === 'ended') return true;
    if (nowMs >= this.createdMs + SRV_MATCH_MAX_MS) { this.end('max-duration', -1); return true; }
    if (this.state === 'lobby') {
      if (nowMs >= this.createdMs + SRV_LOBBY_TTL_MS && this.connectedCount() < 2) { this.end('lobby-timeout', -1); return true; }
      if (this.emptySinceMs && nowMs >= this.emptySinceMs + SRV_EMPTY_TTL_MS) { this.end('empty', -1); return true; }
      return false;
    }
    if (this.emptySinceMs && nowMs >= this.emptySinceMs + SRV_EMPTY_TTL_MS) { this.end('empty', -1); return true; }
    for (let s = 0; s < 2; s++) {
      const p = this.players[s];
      if (p && !p.connected && p.droppedMs && nowMs >= p.droppedMs + SRV_DROP_GRACE_MS) { this.end('rival-gone', s); return true; }
    }
    return false;
  }

  // ---- persistence (survives a DO eviction / redeploy) -----------------------
  serialize() {
    const w = this.world;
    return {
      v: SRV_VERSION, code: this.code, createdMs: this.createdMs, state: this.state, settings: this.settings,
      score: this.score, stats: this.stats, musicSeed: this.musicSeed, serve: this.serve,
      pausedFrom: this.pausedFrom, pauseReasons: [...this.pauseReasons], winSide: this.winSide,
      goalSide: this.goalSide, goalT: this.goalT, countT: this.countT, offerFrom: this.offerFrom,
      pointSerial: this.pointSerial, touchSerial: this.touchSerial, stateSeq: this.stateSeq,
      world: {
        puck: { x: w.puck.x, y: w.puck.y, vx: w.puck.vx, vy: w.puck.vy, w: w.puck.w },
        m: w.m.map(m => ({ x: m.x, y: m.y, tx: m.tx, ty: m.ty, vx: m.vx, vy: m.vy })),
      },
      players: this.players.map(p => p && { pid: p.pid, key: p.key, tx: p.tx, ty: p.ty }),
    };
  }

  /* Rebuild after a hibernation wake or a crash. `connected` lists the sides
   * whose sockets still exist. Non-ticking states (lobby / pause / win) come
   * back exactly as they were; a live table (count / play / goal) can only be
   * restored after its sockets died, so it comes back paused and restarts the
   * point cleanly once both players are present again. */
  static restore(data, nowMs, connected = [], opts) {
    const m = new Match(data.code, data.createdMs, opts);
    m.settings = Object.assign(m.settings, data.settings);
    m.score = data.score; m.stats = data.stats; m.musicSeed = data.musicSeed; m.serve = data.serve;
    m.world = simWorld({ pace: m.settings.pace, goalW: m.settings.goalW, rng: m.rng });
    if (data.world) {
      Object.assign(m.world.puck, data.world.puck);
      data.world.m.forEach((s, i) => Object.assign(m.world.m[i], s));
    }
    m.players = data.players.map((p, i) => p && {
      pid: p.pid, key: p.key, connected: connected.includes(i), droppedMs: connected.includes(i) ? 0 : nowMs,
      tx: p.tx, ty: p.ty, lastInputSeq: null, lastHintSeq: null, lastHintPose: null, needsFull: false,
    });
    m.pausedFrom = data.pausedFrom || 'play'; m.winSide = data.winSide || 0;
    m.goalSide = data.goalSide || 0; m.goalT = data.goalT || 0; m.countT = data.countT || 0;
    m.offerFrom = Number.isInteger(data.offerFrom) ? data.offerFrom : -1;
    m.pointSerial = data.pointSerial >>> 0; m.touchSerial = data.touchSerial >>> 0; m.stateSeq = (data.stateSeq | 0) & 0xffff;
    m.lagEpoch = 1000; // the history ring is not persisted: warm up again
    if (m.connectedCount() === 0) m.emptySinceMs = nowMs;
    const live = ['count', 'play', 'goal'].includes(data.state);
    if (live) { m.state = 'pause'; m.pauseReasons.add('restore'); }
    else {
      m.state = data.state;
      for (const r of data.pauseReasons || []) m.pauseReasons.add(r);
      for (let s = 0; s < 2; s++) if (m.players[s] && !m.players[s].connected && m.state === 'pause') m.pauseReasons.add('drop' + s);
    }
    return m;
  }

  /* Call once after restore(): a restored live match whose players are both
   * still attached restarts its point immediately. */
  afterRestore(nowMs) {
    if (this.pauseReasons.has('restore') && this.connectedCount() === 2) {
      this.pauseReasons.delete('restore');
      this.startPoint(false, nowMs);
    }
  }
}
