# Atelier Online V2 Roadmap

Last updated: 2026-09-29  
Current reference main commit when this roadmap was refreshed: `0ec851f65c18`

## New-agent quick start

If you are taking over this work:

1. Start from current `main`, not an older Online V2 branch.
2. Read this roadmap, then read `docs/online-v2-lag-compensation.md`.
3. Read `src/net.js` before modifying transport or authority logic.
4. Do **not** duplicate draft PR #88. It already contains ICE recovery / network migration.
5. PR #89 (deterministic Network Lab), #93 (forced TURN verification), #95 (blackout recovery coverage), #96 (exact latency matrix), and #97 (lost-input heartbeat recovery) are merged on `main`.
6. When GitHub Actions return on October 2, validate #88 first, then run the merged Network Lab through the full suite.
7. Only after the Network Lab is green should host-side lag compensation move from design into production code.
8. Preserve host-authoritative score/goals, the reliable compatibility path, and short-lived server-issued TURN credentials.
9. If CI reports only a PWA cache identity mismatch after a code change, update `sw.js` to the exact fingerprint CI prints, then rerun the suite.
10. Update this roadmap whenever a phase lands so it remains the single source of truth.

Current staged head at this refresh:

- PR #88 `feat/online-v2-ice-recovery`: `f93d1be4f6631a6c6cafee25477463fd6ae84099`

Current merged Online V2 stack includes PRs #80, #81, #84, #86, #89, #93, #95, #96 and #97.

## Goal

Make Atelier's online air hockey feel as close to local play as practical while keeping the service inexpensive and mostly peer-to-peer.

Non-negotiables:

- Host-authoritative score and match state.
- Direct WebRTC is the preferred path.
- TURN is fallback only.
- No required player accounts, database, dedicated game-server fleet, Redis, or paid always-on backend for v1.
- Goals, scores, win state, pause/rematch and other critical state stay reliable/authoritative.
- Realtime position/input traffic may be lossy because newer state replaces older state.
- Every Online V2 enhancement must preserve the reliable legacy/fallback path when the optional fast lane is unavailable.
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
- Existing reliable 30 Hz Trystero path remains the compatibility fallback.
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

High-risk production behavior remains staged until the full test/visual suite can run again.

### Draft PR #88 - ICE recovery / network migration

Branch: `feat/online-v2-ice-recovery`

Staged work:

- monitor `connectionstatechange` and `iceconnectionstatechange`
- brief debounce for transient disconnects
- bounded recovery attempt budget
- force-refresh short-lived Cloudflare ICE credentials
- preserve the peer's existing ICE configuration if credential refresh fails
- preserve relay-only policy when the forced TURN diagnostic is active
- replace the active ICE server set only when fresh credentials are available
- call `RTCPeerConnection.restartIce()`
- let Trystero's existing `negotiationneeded` signaling carry the restart
- cleanly remove listeners/timers when the peer/room is dropped
- preserve the existing 15-second gameplay reconnect fallback
- focused recovery tests included

Do not duplicate this work. The branch was rebased onto current `main` during static review. Upstream Trystero source confirms its peer layer handles `onnegotiationneeded` by creating a new offer, but the browser/network behavior still requires full CI, Visual QA and real migration testing before merge.

### PR #89 - deterministic Network Lab

Merged into `main` as test-only infrastructure.

Implemented:

- seeded virtual clock/network
- configurable latency and jitter
- random loss and burst loss
- packet reordering
- clean / broadband / mobile / hotel Wi-Fi / brutal profiles
- real binary realtime state traffic through the simulator
- real guest input + cumulative ACK traffic through the simulator
- exact fixed one-way delay matrix at 0 / 30 / 60 / 100 / 150 / 250 ms
- 1 / 5 / 15 second total packet blackouts with fresh-state convergence
- lost first guest-input recovery through the existing 500 ms stationary heartbeat
- bounded in-flight queue assertions at high fixed latency
- metrics for delivery, drops, reorder count and maximum queue depth

The merge does **not** mean the lab has been declared green. Run the full suite when Actions return before using its results to tune or enable lag compensation.

### PR #93 - forced TURN verification mode

Merged into `main`.

Implemented:

- diagnostic-only `?netRoute=turn` switch
- Trystero `rtcConfig` override so its default STUN list is not inherited during the forced test
- TURN/TURNS-only ICE server filtering
- WebRTC `iceTransportPolicy: 'relay'`
- fail-closed behavior in diagnostic mode if TURN credentials are missing
- focused configuration tests
- real-device direct + forced-TURN checklist in `docs/online-v2-turn-verification.md`

Normal production behavior remains direct WebRTC preferred with Cloudflare TURN fallback. This does not change authority, packet formats, critical-event reliability, or the 30 Hz compatibility path.

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

Do not blindly fork Trystero. Prefer a pinned vendored dependency plus the smallest compatibility patch necessary.

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

Guest prediction improves perceived latency, but the authoritative host still evaluates the guest mallet against its current simulation state.

Next fairness target:

- Add host simulation tick IDs.
- Add guest-observed host tick to input packets.
- Keep a small circular history buffer on the host.
- Validate guest contact conservatively against recent historical states.
- Never allow the guest to authoritatively declare a goal/hit outcome.
- Cap rewind window; do not reward intentionally stale inputs.

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
- prediction/reconciliation metrics under the chaos profiles

Track:

- RTT
- jitter
- realtime packet gaps
- stale/out-of-order packets
- prediction count
- reconciliation count
- maximum correction distance
- realtime channel buffered bytes
- selected ICE candidate route
- bytes sent/received
- reconnect time

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

1. Verify production `POST /ice` and the merged forced TURN path on real devices.
2. Run full CI + Visual QA for PR #88, then merge only if green.
3. Run the merged Network Lab through the full suite and inspect/tune from measured results.
4. Run real direct, forced-TURN and Wi-Fi/cellular migration tests.
5. After the Network Lab is green, implement bounded host-side contact lag compensation.
6. Vendor/pin Trystero and harden mobile leave/rejoin cleanup without changing the P2P architecture.
7. Improve Nostr relay resilience based on measured failures.
8. Add Quick Match.
9. Add local identity / recent rivals / challenge flow.
10. Add session resurrection.
11. Add authority migration.
12. Evaluate whether rollback is still worth the complexity.

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
6. Keep the reliable compatibility path.
7. Keep TURN credentials short-lived and server-issued.
8. Add a protocol version when making incompatible binary packet changes.
9. Measure before adding complexity.
10. Update this roadmap when a phase lands.

## Immediate next task

### While Actions remain unavailable

Do not stack another high-risk production protocol/physics change on top of unverified PR #88 or before the merged Network Lab has actually executed.

Safe work:

1. Continue filling only meaningful Network Lab coverage gaps with test-only changes; exact latency, blackout convergence and lost-input heartbeat recovery are already merged.
2. Review PR #88 statically, but keep its production recovery behavior staged until it can run through the full suite.
3. Keep lag-compensation implementation on paper or an isolated experimental branch until the Network Lab executes successfully.
4. Use the merged forced TURN diagnostic for real-device relay validation when practical.

### When Actions return

1. Run PR #88 through full CI + Visual QA; fix and merge if green.
2. Run the merged Network Lab through full CI and confirm it is green.
3. Run normal direct-preferred + forced TURN real-device tests using `docs/online-v2-turn-verification.md`.
4. Then implement host tick/history contact compensation as the next production phase.

The lag-compensation design should add a bounded host tick reference to guest input, retain a small host history ring, and validate contact against recent history without allowing the guest to authoritatively declare hits or goals.
