# Air Hockey dedicated server report

Date: 2026-11-05. Local commit only, not pushed. Nothing was deployed to Cloudflare: no Worker, Durable Object, route or secret was created.

## Result in one paragraph

A server-authoritative mode now exists behind `?netMode=server`. Both players are equal clients of one SQLite-backed Cloudflare Durable Object that runs the physics at the same 240 Hz substep rate, scores goals, owns pause/rematch, and keeps the match alive through either player dropping. The mallet impulse solver, the 9-gate contact-hint validator, the history ring and the wire codecs exist **once**, in the `SHARED-SIM` region of `src/net.js`. The browser runs that region as before, and the server bundle embeds the exact same bytes. P2P stays the default and is unchanged. The one place the code is not single-source is the table stepping (walls, mallet drive, glue release, goal line), which `game.js` entangles with sound and particles; that is an effect-free port pinned to `game.js` by a step-for-step parity test. It has not been run in a real Durable Object, and no two real devices have played on it (see "What I could not verify").

## Test results (actual, this run)

| Check | Result |
|---|---|
| `npm test` (check, syntax, unit, build, check) | **exit 0. 507 tests, 507 pass, 0 fail, 0 skipped, 0 cancelled** |
| `npm run unit:online` | **246 tests, 246 pass, 0 fail** (baseline before this work: 190) |
| Of which new server tests (`tests/net-server-*.test.mjs`) | 55 tests: 24 match logic, 9 Worker/DO glue, 11 client, 5 parity, 6 deploy manifest |
| Parity, game.js vs server sim | 5 tests, about 200,000 compared 240 Hz substeps over 3 paces, 3 goal widths and 9 seeds, exact agreement (< 1e-9) on puck, mallets, glue timers, touch count, saves, goals |
| Headless Chrome, 390x844, 320x568, 844x390, 768x1024 | menu, local match, server-mode lobby, unreachable server, join with a code, default P2P lobby: **0 page errors at every size** |

GitHub CI was not run. Nothing here claims CI is green.

The headless runs log two `console.error` lines per size. Those are Chrome's own network-failure messages for the WebSocket I deliberately pointed at a refused port (`ERR_UNSAFE_PORT`). They are not page errors, and the client turns the failure into a visible lobby message ("Couldn't reach the game server...") with no timers left running.

## Research and decisions

**Server shape.** A thin Worker routes `GET /ws/<CODE>` to `env.MATCH.get(env.MATCH.idFromName(CODE))`. One Durable Object per match, one WebSocket per player. The room code is the object name, so two players typing the same code always meet in the same object. No lobby server, database or accounts. `?netServer=` is honoured only for loopback hosts, so a crafted link cannot send players to a foreign server.

**Tick and network model (feel stays identical).**
- Physics: the same `SUB_HZ = 240` substep scheme as `game.js` (`sub = ceil(dt / (1/240))`, `sdt = dt / sub`), run from a 60 Hz loop. One state frame per tick, 60 Hz out, same as the P2P realtime lane. The wire format is the **same** 56-byte state, 12-byte input, 4-byte ACK and 22-byte hint packets, so the client's prediction, ACK fence and reconciliation code run unchanged.
- Client to server input is 30 Hz (`NET_SERVER_INPUT_HZ`), not the P2P 60 Hz. This is the one deliberate departure: every inbound message is a billed request at 20:1, and the server drives the mallet at 240 Hz regardless. The local mallet is still immediate on the client.
- Free-tier fit (design numbers, see DEPLOY.md): requests are the binding limit, about 55 ten-minute matches per day at the worst case (60 msg/s), more with idle mallets. Duration allows about 170. The 60 Hz loop runs only while the table is live; lobby, pause, win screen and dropped-player waits run no loop and hibernate. The RTT probe is the literal text `ping`, auto-answered by `setWebSocketAutoResponse` without waking the object. Measured simulation cost in Node: about 7 microseconds per tick including inputs.

**Validator on the server, no third copy.** I turned the validator, ring and codecs in `net.js` into free functions of plain data, wrapped in `// <<SHARED-SIM:BEGIN/END>>` markers. `Net.*` methods are now thin aliases. `build.mjs` slices that region into the Worker, and a test asserts the bundle contains the exact region text and that `mvn * SMACK_BONUS`, the restitution curve and the validator each appear exactly once in the bundle. On the server both seats are hinters: each has its own dedupe state and last pose, and the validator's "guest mallet" reach check is fed from the hinting seat's recorded mallet. After the refactor all 190 pre-existing online tests passed unmodified.

**Matchmaking and routing.** Room code to Durable Object by `idFromName`. First connect with `intent: create` makes the match and proposes the rules (validated; a joiner's settings are ignored). `join` to a nonexistent room, `create` on a live one, a third player, a bad key and an ended room each return a distinct error code that the client shows as a readable message. A failed create leaves nothing in storage. Quick Match and Spectate are P2P features and are hidden in server mode; the lobby shows `Connection: Dedicated server` or `Connection: Peer to peer`. Invite links carry `netMode=server` so the joiner lands on the same transport.

**Reconnection and lifecycle.** A seat is `pid` + `key` (random 24-char, kept in `sessionStorage`). Socket drop: the table pauses, the rival sees "reconnecting", the client retries the same seat with backoff (0.4, 0.9, 1.8, then 3 s) for up to 80 s, and a page reload inside the window rejoins the same seat. The server holds the seat for 90 s, then ends the match and tells the survivor. One player waits in the lobby (10 min). Zero connected players ends the match after 60 s and wipes storage and alarm so the object costs nothing. Hard cap 2 h. State is checkpointed to SQLite on transitions and every 15 s while live. A hibernation wake restores paused, lobby and win states exactly. A crashed live table comes back paused and restarts its point once both players return. A manual pause survives a drop and rejoin.

**What happened to the P2P path: kept, as the default.** Keeping both does not double the maintenance surface, because the math is one source and the table port is parity-tested. The server client reuses the existing guest code path end to end (prediction, ceremony, score convergence, overlays); `net-server.js` is about 350 lines of transport. Removing P2P would also delete Quick Match, spectators and TURN recovery, which the server does not replace, so nothing in it is dead. Making server mode the default is a decision for after a live two-device test.

**Rejected alternatives.**
- *Reimplementing physics or the validator on the server:* a third copy of math that already drifted once. Rejected for the shared region.
- *Refactoring `game.js` so the browser also calls a pure table core:* the right end state, but `collideMallet` interleaves AI blocking, sound, highlights and stats through 150 lines, and a behavior change in the local game was out of scope for a mode that must leave local play "exactly as it is". The parity test is the guard instead, and the refactor is still available later.
- *A new `cloudflare:workers` `DurableObject` base class:* unnecessary for the hibernation handlers and it would make the module untestable in Node.
- *Server ticking at 30 Hz or 120 Hz physics:* would change the feel; kept 240 Hz substeps and 60 Hz broadcast.
- *Rollback netcode:* the design doc already says not yet; the server being the authority removes the problem it solved.
- *Wrangler/npm at deploy time:* not allowed; the bundle is string concatenation and `worker.js` is committed, with a test that fails if it goes stale.

## Server layout and deploy (details in `infra/cloudflare/air-hockey-server/DEPLOY.md`)

```
infra/cloudflare/air-hockey-server/
  worker.js        GENERATED single module (default export = fetch, named export AirHockeyMatch). Upload this.
  metadata.json    the exact multipart `metadata` part
  DEPLOY.md        names, binding, migration, curl commands, smoke tests, free-tier math
  build.mjs        node-only bundler: SHARED-SIM region of src/net.js + src/sim.js + src/match.js + src/worker.js
  src/sim.js       effect-free table physics port (parity-tested against game.js)
  src/match.js     pure match state machine (no Cloudflare APIs; unit-tested with an injected clock)
  src/worker.js    router + Durable Object glue (hibernation, 60 Hz loop, checkpoint, expiry alarm)
```

| | |
|---|---|
| Worker name | `atelier-air-hockey-server` |
| Entry module | `worker.js` |
| Binding | `durable_object_namespace`, name `MATCH`, class `AirHockeyMatch` |
| Migration | tag `v1`, `new_sqlite_classes: ["AirHockeyMatch"]` (never `new_classes`) |
| Secrets | none |

Bug uploads with one multipart `PUT .../workers/scripts/atelier-air-hockey-server` (`metadata.json` + `worker.js`), then enables the workers.dev subdomain. The exact curl commands are in DEPLOY.md. `npm run build` now also rebuilds `worker.js`, and `build.mjs --check` fails if it is stale.

## How the client switches

`?netMode=server` (read by `Net.serverMode()`). `Net.create` and `Net.join` dispatch to `NetServer.start`. `src/net-server.js` is a new classic script loaded after `net.js`, added to the service worker precache and the cache fingerprint. Each client is told `authoritySide = 1 - mySide`, so the existing "ease the authority's mallet" path animates the rival's mallet while the local mallet stays immediate. The WebSocket is presented to `Net` as the realtime lane, so lane health, ACK fencing and hint sending are the P2P code. Local and AI play are untouched.

## Dead code and cleanup

- Removed from `game.js`: `PUCK_DAMP`, `WALL_REST`, `STRIKE_XFER` (declared, never read; the pace table owns damping and rail restitution).
- Removed from `net.js`: three wrappers that nothing called (`Net.lagTrajectory`, `Net.lagNearRail`, `Net.lagSegmentEntry`) and the duplicated constants block.
- **For Bug, not touched:** about 100 stale remote-tracking branches (`origin/feat/*`, `fix/*`, `test/*`, `docs/*`, mostly merged); no local branches were deleted. `air-hockey-multiplayer-report.md` is the previous run's report and is still accurate for P2P lag compensation.

## What I could not verify

- **No real Durable Object ran.** The glue (`worker.js`) is tested against in-memory fakes of `ctx.storage`, hibernatable sockets, alarms and timers. A local Node WebSocket stand-in around the real `Match` let two real headless Chrome pages play a point, move mallets, see each other, drop and resume a seat, and leave. That proves the client and the match logic, not Cloudflare behavior.
- Assumptions about the platform that only a live object can confirm: `setInterval` holds a 60 Hz cadence inside a Durable Object without drift that matters; the free plan's CPU limits do not interfere with a long-lived tick loop; `setWebSocketAutoResponse` messages bill as I assumed; hibernation actually engages when the loop is stopped; `idFromName` routing lands both players on one object under real conditions; the compatibility date `2025-09-01` is accepted.
- The free-tier numbers are design arithmetic, not measurements.
- No real-network latency, jitter, loss, Wi-Fi/cellular switch, mobile browser backgrounding, or Safari WebSocket behavior was tested. Server-side lag compensation is tested only with synthetic histories and hints, not real latency.
- Headless screenshots do not replace a real phone, and the existing rule stands that UI is not "ready" without one.
- A test-harness note: calling `Net.leave()` directly (not through the menu) leaves `G.mode = 'ai'` with no AI brains and logs `Cannot read properties of null (reading 'hist')`. That is the existing P2P behavior of `leave` and does not occur through the UI.

## What still needs Hans or a real device

1. Bug deploys the Worker, then runs the smoke tests in DEPLOY.md.
2. Two real phones on different networks: host and join through `?netMode=server`, play a full match, and judge the feel against P2P at the same RTT. This is the gate for any change of default.
3. Kill one phone's connection for 10 to 20 s, restore it, and confirm the match resumes with the rival seeing "reconnecting".
4. Check the daily request count after a day of use against the 100k cap. If it gets close, `NET_SERVER_INPUT_HZ = 20` is the first lever.
5. Decide whether server mode should become the default, and whether to keep a `?netMode=p2p` escape hatch.
