# Online V2 Real-Device Verification

This runbook separates what can be verified on current `main` from the network-migration work still staged in draft PR #88.

Current status:

- deterministic Network Lab is merged
- forced TURN diagnostic is merged
- `npm run unit:online` is merged
- ICE recovery / Wi-Fi-cellular migration remains draft in PR #88

Production stays direct-preferred WebRTC with Cloudflare TURN only as fallback. Forced TURN is diagnostic-only.

## Test setup

Prefer two real devices.

Recommended pairing:

- device A: desktop/laptop on Wi-Fi
- device B: phone capable of switching between Wi-Fi and cellular
- production origin: `https://builtbysai.com/atelier-air-hockey/`

Record for every run:

- browser + version
- OS + version
- network for each peer
- `Net.rtc`
- `Net.rtReady`
- RTT from the connection chip
- `Net.rtDropped`
- `Net.predictionCorrections`
- `Net.predictionMaxError`
- visible correction/stutter
- duplicate goal, score mismatch, stuck puck or stuck mallet target

## Phase A - current main

These checks do not require PR #88.

### 1. Production credential request

From DevTools on the production site:

```js
fetch('https://atelier-turn-credentials.saihanswissle.workers.dev/ice', {
  method: 'POST',
  credentials: 'omit',
  cache: 'no-store',
}).then(async r => ({ status:r.status, body:await r.json() }))
```

Pass:

- HTTP success from the production origin
- response contains STUN and TURN/TURNS `iceServers`
- TURN username/credential are temporary values
- no long-lived Cloudflare API token is present in source, bundles, Network payloads or the repository

### 2. Normal direct-preferred match

Use the normal URL on both peers.

1. Host on device A.
2. Join from device B.
3. Play for several minutes.
4. Exercise rapid guest movement, repeated puck contacts, at least two goals, pause/resume and rematch.
5. Inspect the Online diagnostics after the connection settles.

Expected:

- direct or nearby route when the networks permit it
- relay is also valid when NAT/firewall conditions require TURN
- realtime lane opens when supported
- score, goals, countdown, pause, win state and rematch remain synchronized
- no stale physics burst after brief packet disruption
- no duplicate score or permanently stuck target

### 3. Forced TURN-only match

Load **both peers** with:

```text
https://builtbysai.com/atelier-air-hockey/?netRoute=turn
```

If a room/share URL is used, ensure the guest URL also contains `netRoute=turn`.

This mode:

- removes STUN-only entries
- supplies only TURN/TURNS servers to Trystero
- sets `iceTransportPolicy: 'relay'`
- fails closed if usable TURN credentials are unavailable

Expected:

- match connects
- `Net.rtc.route === 'relay'`
- connection chip reports Relayed
- realtime lane may still open
- reliable compatibility traffic remains available
- gameplay authority and score synchronization are unchanged

### 4. TURN gameplay stress pass

During the forced relay match:

- make fast repeated guest contacts
- play through multiple goals
- pause and resume
- complete a rematch
- briefly background and restore the phone once
- watch `Net.rtDropped`, correction count and maximum correction error

Do not invent pass/fail correction thresholds yet. Capture the numbers so real-device evidence can drive tuning.

## Phase B - PR #88 migration verification

Run this only after PR #88 passes `npm run unit:online`, full CI and Visual QA and is available in a testable build.

Trystero 0.25.4 behavior matters here:

- continuously `disconnected`: closes after 5 seconds
- `failed` or `closed`: closes immediately
- Atelier #88 starts recovery after a 700 ms disconnected debounce
- TURN refresh is budgeted to 800 ms
- if refresh is unavailable/slow, existing ICE config is retained and `restartIce()` still proceeds
- Atelier's existing match reconnect grace remains the fallback after peer close

### 5. Wi-Fi -> cellular migration

Use the phone as one player.

1. Start a healthy match while the phone is on Wi-Fi.
2. Confirm current route/RTT and that gameplay is synchronized.
3. While the puck is in normal play, disable Wi-Fi on the phone and allow cellular to take over.
4. Do not reload either page.
5. Observe connection state, pause/reconnect UI and recovery time.
6. Resume play and score at least one additional goal.

Record:

- time from network switch to playable state
- whether the same peer recovered in place
- whether the match entered Atelier's fallback reconnect flow
- route before and after migration
- score before and after migration
- correction/drop counters before and after migration

### 6. Cellular -> Wi-Fi migration

Repeat the same procedure in the reverse direction.

This catches browser/OS behavior that is not symmetric between losing cellular and losing Wi-Fi.

## Interpreting migration results

### Best result: in-place ICE recovery

- peer remains alive
- short freeze/reconnect indication only
- recovery completes before Trystero's 5-second disconnected close
- score and match state never reset
- gameplay resumes from one authoritative state

### Acceptable fallback

Some browser/network combinations may close the WebRTC peer before in-place recovery succeeds.

The fallback is acceptable only if:

- Atelier's reconnect UI appears
- the peer rejoins within the existing grace period
- the match resumes without score divergence
- no duplicate goal or stale physics burst occurs

### Failure

Treat any of these as a blocker:

- page reload is required
- room/match is lost during an ordinary supported network switch
- duplicated goal
- score divergence
- permanently stuck puck/mallet target
- stale realtime packet burst after recovery
- forced TURN silently connects over direct candidates

## Failure triage order

For relay failures:

1. production-origin `POST /ice`
2. TURN/TURNS URLs present
3. both peers loaded with `netRoute=turn`
4. CORS/credential errors
5. selected candidate route
6. UDP TURN vs TLS/TCP TURN on restrictive networks

For migration failures:

1. whether the connection first reached `disconnected` or jumped directly to `failed`
2. time spent disconnected
3. whether credential refresh completed or timed out
4. whether `restartIce()` ran before Trystero peer close
5. whether the fallback peer rejoin occurred
6. whether authoritative score/state reconverged

## Exit criteria before host lag compensation

Do not move host-side lag compensation into production until:

- `npm run unit:online` passes
- full CI + Visual QA pass
- normal direct-preferred match succeeds on real devices
- forced TURN-only match succeeds on real devices
- critical reliable events remain synchronized
- prediction/reconciliation metrics have been captured under real latency
- PR #88 migration behavior has been measured on at least one phone network switch
- no long-lived TURN secret is exposed
