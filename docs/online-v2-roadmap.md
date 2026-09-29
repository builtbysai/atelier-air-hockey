# Atelier Online V2 Roadmap

Last updated: 2026-09-29  
Current reference main commit when this roadmap was refreshed: `ad32f0a5b987`

## New-agent quick start

If you are taking over this work:

1. Start from current `main`, not an older Online V2 branch.
2. Read this roadmap, then read `docs/online-v2-lag-compensation.md`.
3. Read `src/net.js` before modifying transport or authority logic.
4. Do **not** duplicate draft PR #88. It already contains ICE recovery / network migration.
5. The deterministic Network Lab and its hardening are merged on `main`, including exact latency, blackout, input recovery, score convergence, transport metrics, sequence tracing, prediction-chaos coverage, production-physics drift guards, additive-message robustness, and executable lag-compensation contracts.
6. When GitHub Actions return on October 2, validate #88 first, then run the merged Network Lab through the full suite.
7. Only after the Network Lab is green should host-side lag compensation move from design into production code.
8. Preserve host-authoritative score/goals, the reliable fallback lane, and short-lived server-issued TURN credentials.
9. If CI reports only a PWA cache identity mismatch after a code change, update `sw.js` to the exact fingerprint CI prints, then rerun the suite.
10. Update this roadmap whenever a phase lands so it remains the single source of truth.

Current staged head at this refresh:

- PR #88 `feat/online-v2-ice-recovery`: `abf9cbf37d46784b3f8b54c0cd96c303ac89352a`

Current merged Online V2 stack includes PRs #80, #81, #84, #86, #89, #93, #95, #96, #97, #99, #100, #101, #102, #103, #107, #108, #109, #110, #111 and #113.

## Version-zero compatibility policy

Atelier is still version zero and currently has one active tester. Current builds are expected to use the same current protocol. Do **not** add settings migrations, old-client message fallbacks, compatibility aliases, or capability shims unless a real external compatibility requirement appears.

This does not remove resilience. The 30 Hz reliable lane, direct-WebRTC-to-TURN fallback, reconnect/session resurrection, and browser/PWA fallbacks are current runtime behavior and should remain.

## Goal

Make Atelier's online air hockey feel as close to local play as practical while keeping the service inexpensive and mostly peer-to-peer.

Non-negotiables:

- Host-authoritative score and match state.
- Direct WebRTC is the preferred path.
- TURN is fallback only.
- No required player accounts, database, dedicated game-server fleet, Redis, or paid always-on backend for v1.
- Goals, scores, win state, pause/rematch and other critical state stay reliable/authoritative.
- Realtime position/input traffic may be lossy because newer state replaces older state.
- Every Online V2 enhancement must preserve the reliable fallback lane when the optional fast lane is unavailable.
- Never ship Cloudflare's long-lived TURN key/token to the browser.

## Production infrastructure

Cloudflare credential Worker:

`https://atelier-turn-credentials.saihanswissle.workers.dev`

Expected routes:

- `GET /health`
- `POST /ice`

The user confirmed `/health` returns:

`{"ok":true,"service":"atelier-turn-credentials"}`

Worker source of truth:

`infra/cloudflare/turn-worker.js`

Required Cloudflare Worker secrets:

- `CF_TURN_KEY_ID`
- `CF_TURN_API_TOKEN`

The client uses Cloudflare TURN credentials from `/ice`. If the credential service is unavailable, Online mode falls back to Cloudflare STUN-only direct P2P instead of failing closed.

Important: the agent environment could not independently resolve the fresh workers.dev hostname, so the live `POST /ice` path still needs a real-browser/device verification.

## Current Online architecture

```text
Private room / invite
        |
        v
Nostr discovery/signaling
        |
        v
WebRTC ICE
   |           |
 direct      Cloudflare TURN
preferred      fallback
   |           |
   +-----+-----+
         |
 RTCPeerConnection
   |             |
   |             |
control       realtime
reliable      unordered
ordered       maxRetransmits: 0
   |             |
goals          puck state
pause          guest input
rematch        input ACKs
settings       60 Hz when open
countdown
         |
         v
Host-authoritative simulation
         +
Guest contact prediction
         +
ACK-fenced reconciliation
```

## Completed work

### PR #80 - Build Online V2 TURN foundation

Merged.

Implemented:

- Cloudflare TURN credential endpoint integration.
- Cloudflare STUN fallback.
- Removed client-side OpenRelay shared-secret credential generation.
- ICE path diagnostics through `RTCPeerConnection.getStats()`.
- Internal Direct / Nearby / Relayed route classification.
- Checked-in Cloudflare Worker source and deployment documentation.
- TURN integration regression tests.

### PR #81 - Add Online V2 low-latency realtime channel

Merged.

Implemented:

- Second negotiated WebRTC data channel using the existing peer connection.
- `ordered: false`.
- `maxRetransmits: 0`.
- Fixed-size binary packets.
- 16-bit packet sequence numbers.
- Stale/out-of-order packet rejection.
- 60 Hz state/input cadence when the fast lane is open.
- Existing reliable 30 Hz Trystero path remains the transport fallback.
- Replaceable realtime packets are dropped under backpressure rather than queued.
- Critical control events remain on the reliable ordered channel.

### PR #82 / #83 - TURN Worker parser fixes

Merged.

The initial localhost regex was too easy to mis-copy/escape in Cloudflare's editor. The Worker now validates localhost development origins with `new URL()` instead of a regex.

Worker syntax is included in the repo syntax check.

### PR #84 - Add Online V2 input acknowledgements

Merged.

Implemented:

- Cumulative realtime input ACK packets.
- Wrap-safe 16-bit input acknowledgement ordering.
- Host ACKs only newly accepted inputs.
- Guest can ask whether an input sequence has been processed by the authoritative host.

This is the reconciliation fence for guest prediction.

### PR #86 - Add instant guest puck contact prediction

Merged.

Implemented:

- Credible guest-mallet contact reacts immediately on the guest device.
- Contact-causing target input is forced onto the realtime lane.
- Prediction is tied to that input sequence.
- Prediction stays active until:
  1. host ACKs the input, and
  2. a newer authoritative state arrives.
- Small divergence blends back to authority.
- Large/stale divergence hard-corrects.
- Local hit feedback fires immediately.
- Prediction is disabled while reconnecting/backpressured or when the fast lane is unavailable.
- Prediction never owns goals, scores, match state or rival authority.
- Near the goal line the guest yields to host authority rather than inventing a goal.
- Stale-snapshot teleport protection no longer erases an active prediction.

### Existing Online foundation before V2

Already present before the above work:

- Host-authoritative 240 Hz game physics.
- Online host drives its own mallet and simulates the guest mallet from remote target input.
- Guest-side local mallet response.
- Guest puck dead reckoning between authoritative snapshots.
- Room code / share-link / QR invite flow.
- RTT display.
- Mid-match disconnect grace/reconnect UI.
- Host settings/serve/goal synchronization.
- Rematch flow.
- Guest score/stat convergence.
- Existing latency/reconnect unit coverage.

## Work staged during the GitHub Actions outage

### Integrated Online V2 resilience work

PR #88 and the former #115-#119 resilience stack have now been integrated through PR #121 at the user's explicit request after static review.

Integrated behavior:

- ICE/network migration recovery with bounded `restartIce()`, short-lived credential refresh, stale-peer fencing, relay-policy preservation, and fallback to the existing gameplay reconnect path.
- Account-free local identity, recent-rival history, and Nostr/Trystero Quick Match discovery.
- Quick Match contention hardening for 3+ simultaneous players: one active reservation, busy rejection, bounded reservation timeout, retry, disconnect recovery, and stale-callback protection.
- Separate passive spectator room with a cap of 3 viewers, authoritative snapshots/events only, and no gameplay/authority path.
- Spectator matches do not pollute recent-rival history.
- 45-second local session resurrection lease with authority-only state restoration.
- Player side is independent from simulation authority.
- Authority migration uses monotonic epochs, preserves the normal 15-second reconnect grace first, promotes only from authoritative state, and requires a valid peer authority claim before unfreezing after a long disconnect.
- Newer remote authority epochs must carry a valid authoritative snapshot; unresolved authority handshakes fail closed instead of risking split brain.
- Resurrection and authority migration compose: a promoted guest reloads as authority, while a demoted original host reloads as non-authority and resyncs from the migrated authority.
- Focused regression coverage exists for ICE recovery, matchmaking, spectators, resurrection, and authority migration.

### Post-integration correctness fixes

Static cross-feature review after the resilience merge found and fixed three real lifecycle defects:

- **#122 spectator startup:** normal hosting tried to open the watcher room before the match had an active authority, so fresh matches could publish no spectator room. Watcher publishing now starts after match activation and reopens after a late host-side restart.
- **#123 spectator reconnect idempotency:** a winning authority could reopen watcher publishing after long-disconnect settlement while its existing watcher room was still alive. Watcher-room creation is now idempotent.
- **#124 migrated-authority late rejoin:** dead-match recovery still assumed the original guest knocks and original host restarts. Rejoin initiation/restart now follows current authority ownership, and a former host can receive a fresh hello without losing its stable player side/origin role.
- **#125 lag-compensation design:** updated to reset and warm current-authority history after migration/resurrection before any future contact hint can validate.

### Validation status

This integration was merged during the GitHub Actions outage at the user's explicit request. It has completed static integration review, but the full executable suite and real-device matrix still need to run when Actions or a development machine are available.

Do not treat the absence of a failing CI run as proof that the integration is green.

### Already merged supporting work

PR #89 provides the deterministic Network Lab. PR #93 provides forced-TURN verification mode. Direct WebRTC remains preferred; Cloudflare TURN remains fallback. Host/current-authority scoring remains authoritative, critical events remain reliable, and the 30 Hz reliable fallback lane remains.

## Current known risks / unfinished areas

### 1. Live TURN credential path must be verified

The Worker health route is confirmed live, but `POST /ice` must still be verified from a real browser with the production origin.

Acceptance:

- HTTP success from `https://builtbysai.com`.
- Response includes Cloudflare STUN/TURN `iceServers`.
- No long-lived API token appears in browser source, DevTools bundles, or repo.
- A forced TURN-only test successfully creates a relayed WebRTC connection.

### 2. Trystero is still dynamically loaded from esm.run

Current Online code still depends on a runtime Trystero CDN import.

Target:

- Vendor/pin the exact Trystero build in the app.
- Remove runtime dependency on esm.run.
- Keep upstream-compatible changes small.

Known upstream concerns observed during research:

- Trystero 0.25.4 has had an open mobile leave/rejoin issue involving sends on a closed data channel.
- Recent Nostr discovery behavior has changed to reduce relay load and may affect room discovery timing.

Do not blindly fork Trystero. Prefer a pinned vendored dependency plus the smallest integration patch necessary.

### 3. Mobile network migration/recovery

Current app has a gameplay reconnect grace period, but Trystero itself closes a peer after a short sustained disconnected state.

Next resilience target:

- Detect `disconnected` before final close.
- Refresh ICE servers if necessary.
- Call `RTCPeerConnection.restartIce()`.
- Preserve the match while switching Wi-Fi <-> cellular when possible.
- Recreate the optional realtime lane after a new peer connection.
- Avoid duplicate reconnect/leave events.

### 4. Host-side contact lag compensation

Detailed design: `docs/online-v2-lag-compensation.md`

The design now has an executable data contract in `tests/fixtures/online-v2-lag-compensation.json` plus `tests/net-lag-compensation-contract.test.mjs`. No production compensation is enabled.

Key design correction from the current pass: the guest predicts against an extrapolated puck, so the host must not validate geometry only against the raw state sequence the guest referenced. That sequence is the lower bound; validation scans forward through the host's own bounded authoritative puck trajectory and selects the earliest plausible open-table intersection.

Guest prediction improves perceived latency, but the authoritative host still evaluates the guest mallet against its current simulation state.

Next fairness target after the validation gates:

- Reuse the existing 16-bit realtime host state sequence as the guest's lower-bound reference.
- Keep a small host-authored circular puck/mallet history tied atomically to those published state sequences.
- Add the separate additive 22-byte type-4 contact hint; do not change the existing input packet layout.
- Scan forward from the referenced state through bounded authoritative history to the earliest plausible open-table contact.
- Validate age, sequence, point/touch continuity, side bounds, speed, geometry, approach direction and rail/goal ambiguity.
- Never allow the guest to authoritatively declare a hit outcome, puck state, goal or score.
- Cap rewind age and reject ambiguous/stale evidence.

This should solve the classic: "I hit it on my screen but the host said I missed."

### 5. Network Lab / chaos testing

Merged deterministic coverage now includes:

- latency: 0 / 30 / 60 / 100 / 150 / 250 ms
- jitter
- random packet loss
- burst loss
- packet reordering
- realtime-lane backpressure unit coverage
- 1 / 5 / 15 second packet blackouts
- lost-input heartbeat recovery

Still pending real or recovery-integrated validation:

- Wi-Fi -> cellular style connection migration through PR #88
- browser-level direct vs relayed route behavior
- subjective prediction/reconciliation tuning from real-device measurements
- comparison of deterministic #113 baselines against real-device measurements

Track:

- RTT
- jitter
- realtime packet gaps (test-harness sequence tracing merged)
- stale/out-of-order packets (test-harness sequence tracing merged)
- prediction count (deterministic chaos coverage merged; surfaced per profile by #113)
- reconciliation count (deterministic chaos coverage merged; surfaced per profile by #113)
- maximum correction distance (deterministic chaos coverage merged; surfaced per profile by #113)
- predicted strike direction vs eventual authoritative direction (#113 baseline diagnostic)
- ACK fence completion and advancement past the prediction's referenced host state (#113 baseline diagnostic)
- realtime channel buffered bytes
- selected ICE candidate route
- bytes sent/received (virtual transport byte metrics merged)
- reconnect time
- lag-hint candidate contact age
- distance from historical contact point to the host's current puck when the hint arrives
- accepted/rejected lag-hint reason counts once the validator exists

Acceptance invariants:

- no duplicate goal
- no divergent score
- no permanently stuck puck
- no stale queued physics burst (deterministic blackout coverage merged)
- no permanent mallet target after packet loss (heartbeat recovery coverage merged)
- reconnect converges to one authoritative state (packet-level convergence covered; actual peer migration still pending #88 validation)

### 6. Nostr signaling resilience

Current signaling is deliberately serverless/decentralized but should not depend forever on one static list of public relays.

Target:

- relay health observations
- preferred + fallback relay strategy
- bounded retries
- no aggressive relay spam
- preserve private room code UX

Only add a tiny owned signaling fallback if measured production failures justify it.

### 7. Quick Match

After transport/recovery is stable:

- Publish short-lived open-table advertisements through ephemeral Nostr events.
- No persistent central lobby database.
- Pair compatible protocol/rules peers.
- Expire advertisements automatically.
- Keep private invite mode unchanged.

### 8. Local player identity / recent rivals

Optional social layer with no account server:

- locally generated identity key
- local display name
- friend/rival exchange through QR/link/code
- recent rivals stored locally
- challenge a known rival when both are online

Do not add chat/moderation burden for v1.

### 9. Session resurrection

Target:

- save a minimal local resume token/checkpoint
- page reload/crash during a match attempts to resume
- resync from authority instead of returning directly to main menu
- expire resume state safely

### 10. Authority migration

Later, separate player side from simulation authority.

Target:

- if authority disappears after state has converged, surviving peer can become the new authority
- use an authority epoch/tie-break rule
- prevent split-brain authority
- old host returning adopts the newer authority epoch

Do this only after resume/reconnect behavior is solid.

### 11. Full rollback is research, not the next task

Atelier is a plausible rollback candidate because the state is small, but do not jump there yet.

Rollback would first require:

- deterministic fixed-tick simulation
- serializable/restoreable physics state
- deterministic randomness
- deterministic collision ordering
- replaying historical input without visual/audio side effects

First measure host-authority + guest prediction + lag compensation. If that feels excellent up to the target latency, stop there.

## Recommended implementation order from here

1. Run `npm run unit:online` and the full test/build suite on the integrated `main`.
2. Run Visual QA.
3. Run the deterministic Network Lab and inspect/tune from measured results.
4. Run real direct, forced-TURN, Wi-Fi/cellular migration, and reconnect tests.
5. Run the feature-specific browser matrix: 3+ player Quick Match contention, three-device spectator join/leave, guest reload, authority reload, long host loss/promotion, former-host return/adoption, and reload before/after promotion.
6. Fix any integration defects before adding more high-risk protocol behavior.
7. After the Network Lab is green, implement bounded host-side contact lag compensation.
8. Vendor/pin Trystero and continue hardening mobile leave/rejoin cleanup without changing the P2P architecture.
9. Improve Nostr relay resilience based on measured failures.
10. Finish the recent-rival challenge UX only after Quick Match reliability is measured in production.
11. Evaluate whether rollback is still worth the complexity.

## Experience targets

Target behavior:

- 30-60 ms RTT: should feel effectively local in normal play.
- 100-150 ms RTT: immediate guest contact response; competitive and stable.
- 150-200 ms RTT: clearly online but fully playable.
- 200-250 ms RTT: degraded gracefully without state corruption or huge corrections.
- packet loss/jitter: no stale-state queue or duplicate scoring.
- Wi-Fi/cellular switch: recover/freeze briefly rather than kill the match when the browser/network allows it.
- TURN/direct path selection is invisible to normal users.

## GitHub Actions outage note

As of 2026-09-29 the user reported GitHub Actions quota unavailable until October 2.

During this window:

- Continue development in small isolated branches.
- Add tests with every protocol change.
- Do not claim Actions are green.
- Prefer changes that preserve fallback behavior.
- Re-run full CI + Visual QA for every branch created during the outage after Actions return.
- Do not merge a high-risk physics/protocol change solely because static inspection looks correct unless the user explicitly chooses that risk.

## Handoff rules for the next agent

Before changing Online code:

1. Read this file.
2. Read `src/net.js`.
3. Inspect the latest Online PRs (#80, #81, #84, #86).
4. Do not replace the architecture with a central server without evidence that the P2P approach cannot satisfy the requirement.
5. Keep score/goals authoritative.
6. Keep the reliable fallback lane.
7. Keep TURN credentials short-lived and server-issued.
8. Add a protocol version when making incompatible binary packet changes.
9. Measure before adding complexity.
10. Update this roadmap when a phase lands.

## Immediate next task

### First priority

Validate the integrated Online V2 resilience stack on `main`.

Required gates:

1. `npm run unit:online`
2. full `npm test`
3. Visual QA
4. direct WebRTC test
5. forced Cloudflare TURN test
6. Wi-Fi/cellular migration test
7. 3+ client Quick Match contention test
8. spectator join/leave and authority-handoff test
9. guest and authority reload/session-resurrection tests
10. long-disconnect authority migration and former-host-return test

### After validation

Only then continue with bounded host-side contact lag compensation. The lag-compensation design uses the existing host realtime state sequence as a lower-bound reference, a bounded host-authored history ring, and a separate additive type-4 contact hint. The current authority alone validates the trajectory and computes any future outcome.
