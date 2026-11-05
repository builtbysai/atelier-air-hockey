# Air Hockey multiplayer report: lag compensation and communication

Date: 2026-11-05. Local commit only, not pushed.
Scope: finish the host-side lag compensation that a runtime restart interrupted, then work through the communication items.

## Test results (actual, this run)

| Check | Result |
|---|---|
| `npm test` (check, syntax, unit, build, check) | **exit 0. 451 tests, 451 pass, 0 fail, 0 skipped** |
| `npm run unit:online` | **190 tests, 190 pass, 0 fail** (run after the final comms test was added; the full suite above includes it) |
| Static checks (`scripts/check.mjs`), before and after build | pass, including the PWA cache identity check |

CI on GitHub has not been run. Nothing here claims CI is green.

## The two failing tests: root cause and fix

Both failures were the production validator correctly refusing **physically impossible fixtures**. The guard was not buggy, so I did not weaken it.

1. **"compensation stays disabled until three consecutive current-authority samples exist."**
   - The fixture moved the puck 60 units per 16.7 ms sample, about 3590 u/s. Production `PUCK_MAX` is 3100.
   - It then put the live puck another 60 units ahead after only 1 ms.
   - Gate 9's "current puck physically inconsistent with the bounded historical window" check (`unsafe-transition`, detail `inconsistent`) is right to reject that.
   - Fix: samples now advance 50 units per step (3000 u/s), and the hint arrives about 3 ms after the newest sample.
2. **"after migration the OLD host is the hinting player and bounds mirror to its half."**
   - The puck flew left from x=400 to a live position of x=220.
   - The left rail is at x=200 and `RAIL_GUARD` is `2 * PUCK_R` = 52, so the live puck sat inside the guard and Gate 9 returned `unsafe-transition`.
   - The side-bounds mirroring was correct: the second assertion, `malletX: 1000` giving `side-bounds`, still passes.
   - Fix: the path now runs mid-table (x=600 down to 450), clear of the rail.
3. **Regression test added:** "Gate 9 refuses a live puck inside the rail guard (mirrored side) and a puck that outran PUCK_MAX". It pins both behaviors so the guard cannot be quietly loosened.

The PWA cache failure was a stale `sw.js` fingerprint. `npm run build` regenerates it (it is now `atelier-air-hockey-6d24e99f134c`), and the check passes.

## Lag-compensation implementation (`src/net.js`, `src/game.js`)

Rollout steps from the design doc, all implemented:

1. **Shared solver.** `solveMalletImpulse` / `malletImpulseVelocity`, `limitMalletRebound` and `malletSpinDelta` live once in `net.js`. These are used by authoritative `collideMallet`, guest prediction, and host compensation. A test confirms the restitution curve and smack bonus each exist once. A randomized 4000-case test confirms the solver matches the original inline formula exactly.
2. **History ring.** 16 samples are recorded at the single place that assigns state sequences (`sequencedSnapshot` → `recordLagSample`), so sequence and sample are atomic. Each holds the puck, the rival mallet, `pointSerial`, `touchSerial`, state, epoch and a monotonic timestamp. Lookup is wrap-safe.
   - `touchSerial` increments once per leading-edge contact episode, including the glue-escape and wrap-release paths.
   - `pointSerial` increments on a new point, restart and goal.
3. **Reset and warm-up.** `resetLagHistory()` runs on promotion, an authority claim, `beginMatch` (which covers new matches and session resurrection) and `dropRoom`. It clears the ring, serials, dedupe state and last result, and bumps the epoch. `closeRealtime` clears only hint dedupe. Compensation needs at least 3 consecutive same-point, same-touch, live-play samples from the current epoch. A pre-migration reference fails with `missing-history`.
4. **Hint codec.** `NET_RT_HIT_HINT = 4`, exactly 22 bytes, little-endian, version 1. Existing 56-byte state, 12-byte input and 4-byte ACK layouts are untouched and asserted. A hint never advances `rtLastInputSeq`, never produces an ACK, and never touches lane health.
5. **Validator.** `Net.validateContactHint(hint, view)` is pure and returns `{ok, reason, detail, contact?}`. Each gate is enforced as follows:
   - **Gate 1, protocol and sequence:** integer and finite checks (`malformed`). A modular newer-than-last-hint check (`duplicate-or-replay`). The referenced seq must exist in the current epoch's history and be warm (`missing-history`). The lead over the latest input is at most 32 (`input-lead`). The matching input packet is not required.
   - **Gate 2, age:** `nowMs - history.timeMs` from the host monotonic clock, at most 180 ms, never derived from sequence distance (`stale`).
   - **Gate 3, point/state continuity:** same `pointSerial`, and both the historical and current state must be `play` (`point-state`).
   - **Gate 4, side bounds:** the pose must lie in the hinting player's half, mirrored by `Net.remoteSide()` so it follows authority, not host/guest role (`side-bounds`).
   - **Gate 5, speed:** reported speed at most `PLAYER_CAP * 1.10`, plus a hop check against the previous accepted pose and a reachability check against the stored mallet pose (`velocity`, with detail `speed`, `hop` or `reach`).
   - **Gate 6, trajectory geometry:** scans the authority's own samples forward from the referenced one, plus the live puck as the final endpoint only when continuity holds. It takes the earliest segment/circle entry at radius `PUCK_R + MALLET_R + 12` and interpolates the puck state there (`geometry`).
   - **Gate 7, approaching contact:** the normal comes from the interpolated host puck and the claimed mallet. The shared solver returns null if the pair is separating (`separating`).
   - **Gate 8, superseding authority:** any change in `touchSerial` since the referenced sample rejects the hint (`superseded`). It runs before the scan because a changed serial makes the scan meaningless.
   - **Gate 9, ambiguous transition:** rejects when a pre-contact sample, the contact point or the live puck is within `2 * PUCK_R` of a rail or goal (`unsafe-transition`). It also rejects when the live puck is farther from the contact than `PUCK_MAX * elapsed + MALLET_R` (`unsafe-transition`, detail `inconsistent`).
6. **Fixtures through the production validator.** `tests/net-lag-compensation.test.mjs` runs every case in `online-v2-lag-compensation.json` through `Net.validateContactHint` and asserts that all 13 reason codes are produced.
7. **Metrics.** `hintsSent/Received/Accepted/Applied` and per-reason counters for age, geometry, velocity, superseded and other, plus a `reasons` map. Available as `Net.lagMetrics`.
8. **Compensated application.** `applyCompensatedContact` recomputes the outcome from the authority's own physics. It sets only the live puck's velocity and spin, with no position change, no rewind and no guest-declared score. It increments `touchSerial` and fires `onCompensatedContact`, which adds rally, highlight and sound feedback. It also ghosts the host's own overlapping mallet for one pass so a strike cannot apply twice.

Safety:
- A throwing validator is swallowed and the match continues on ordinary physics.
- `?netLag=off` disables compensation.
- Hints are ignored by non-authority and old peers.

## Communication work

- **TURN / ICE fallback.** The existing fallback to Cloudflare STUN is kept. I found and fixed two defects:
  - `fetch` had no timeout, so a hung credential service stalled room creation. It now aborts after 4 s.
  - A failure was not remembered. It now backs off for 30 s so each room open does not re-wait, while ICE-recovery refreshes still always retry.
  - A previously issued credential set is reused through an outage while it is under 3 h old (the Worker TTL is 4 h). Beyond that it drops to STUN-only. Credentials remain short-lived and server-issued, and nothing long-lived ships to the browser.
- **Trystero vendoring.** `src/vendor/trystero-nostr-0.25.4.mjs` (62 KB, MIT) is bundled unmodified from the npm packages for `trystero@0.25.4` with esbuild. `Net.trystero()` imports it from the same origin, and the `esm.run` import is gone. A test fails if any source file references a CDN. The build recipe is in `src/vendor/README.md`. It is loaded lazily, so the offline game pays nothing. The service worker's network-first rule covers `.js` and `.css`, and the `.mjs` file falls through to stale-while-revalidate. Its name is versioned, so a new Trystero version means a new file name.
- **Mobile migration and recovery.** Already present and covered by `net-ice-recovery` tests: disconnected detection, a bounded credential refresh, `restartIce()`, and bounded attempts. I found no defect to fix. The send paths on a closed channel are already guarded (`sendRealtime` checks `readyState` and has a try/catch, and the reliable sends `.catch`). Real Wi-Fi/cellular behavior is unverified (see below).
- **Nostr signaling.** No change. I have no measured production relay failures, and the roadmap says not to add an owned signaling fallback without them. Redundancy remains 5 of 5 pinned relays.
  - The vendored build exports `getRelaySockets` and `pauseRelayReconnection` for future relay-health work.
  - In this sandbox every relay socket failed through the proxy and Trystero retried repeatedly. That is environmental, but it shows the retry rate is worth measuring on a real network.

## Headless verification (Chromium headless shell, via route-served files, service worker blocked)

- **Viewports:** 390x844, 320x568, 844x390 and 768x1024 all passed. The menu showed, Start Match began a local `ai` match in state `play`, and dragging the mallet worked. **No page errors in any of them.** At 844x390 the puck scored during the drag test, which is normal play.
- **Audio:** the AudioContext went from `running` to `suspended` on a hidden-tab visibilitychange and stayed suspended on return. Tapping Resume on the pause card put it back to `running`.
- **Online:** tapping Online then Start opens the lobby, and the vendored Trystero loaded from `/src/vendor/trystero-nostr-0.25.4.mjs` in the browser with no CDN request.

## Not verified here

- **A two-peer online match did not run.** The sandbox proxy blocks the Nostr WebSockets (`Establishing a tunnel via proxy server failed`), so no room could form and the guest saw "Couldn't reach that table". Lag compensation was therefore exercised only through the unit/VM harness and the Network Lab tests, not in two live browsers.
- **Network Lab profiles:** the `unit:online` and `net-prediction` suites run the deterministic lab, but I did not capture a separate per-profile report (clean, mobile about 130 ms, hotel Wi-Fi, brutal) for this report.
- **Live `POST /ice` from a real browser on the production origin**, and a forced `?netRoute=turn` relayed connection, were not tested. Both need a real network.
- **Wi-Fi/cellular switch, backgrounded-PWA recovery, session resurrection and authority migration mid-point** need real devices.
- **Game feel.** The 180 ms window, 12-unit tolerance and 2x`PUCK_R` rail guard are starting values. Whether false misses actually improve without rail or migration artifacts can only be judged on phones. I did not confirm any improvement beyond the tests.
- The rejection rate near rails is expected to be higher than ideal by design (the doc prefers a false negative).

## Needs Hans or a real device

1. Two phones on different networks: play with lag compensation on versus `?netLag=off`, and read `Net.lagMetrics` after a match.
2. A forced-TURN match (`?netRoute=turn` on both) and a normal match, to verify the credential fetch on the real origin.
3. A Wi-Fi to cellular switch during a point, and an authority migration during a point.
4. Check for rail or edge artifacts and duplicate touches on compensated hits.

## Dead code / cleanup

- The duplicated impulse calculations in `game.js` and in guest prediction were removed in favor of the shared solver.
- The `esm.run` runtime dependency was removed.
- I did not delete branches.
- I did not do a broader dead-code sweep beyond the paths I touched, so there may be more.
