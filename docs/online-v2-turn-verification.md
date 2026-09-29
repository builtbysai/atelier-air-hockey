# Online V2 Direct + Forced TURN Verification

Use this checklist after draft PR #88 (ICE recovery) and draft PR #89 (Network Lab) are validated and merged.

The production architecture remains direct-preferred WebRTC. The forced TURN path below is diagnostic-only and exists to prove that Cloudflare TURN actually carries the peer connection when direct candidates are disabled.

## Preconditions

- Use two real devices if possible.
- Prefer different networks for the direct test, for example desktop Wi-Fi + phone cellular.
- Use the production origin: `https://builtbysai.com/atelier-air-hockey/`.
- Confirm the Cloudflare Worker health route responds successfully.
- Keep DevTools available on at least one peer so the selected ICE route can be inspected.

## 1. Verify short-lived credentials from the production origin

From DevTools on the production site, run:

```js
fetch('https://atelier-turn-credentials.saihanswissle.workers.dev/ice', {
  method: 'POST',
  credentials: 'omit',
  cache: 'no-store',
}).then(r => r.json())
```

Pass criteria:

- request succeeds from the production origin
- response contains Cloudflare STUN/TURN `iceServers`
- TURN username/credential are short-lived values
- no long-lived Cloudflare API token appears in client source, bundles, Network payloads, or the repository

## 2. Direct-preferred real-device test

Open the normal production URL on both devices.

1. Host a table on device A.
2. Join from device B.
3. Play for at least a few minutes.
4. Inspect `Net.rtc.route` after the connection settles.
5. Inspect `Net.rtReady`.

Expected:

- `Net.rtc.route` is `direct` or `nearby`, not `relay`
- realtime lane opens when both peers support it
- goals, score, pause, countdown, rematch and win state remain authoritative and synchronized
- no duplicate goals or stale queued puck motion

If the network naturally requires TURN, record that result rather than treating it as a failure. The purpose of this pass is to observe the normal direct-preferred behavior.

## 3. Forced TURN-only test

Use this diagnostic query parameter on **both peers**:

```text
?netRoute=turn
```

Example host URL:

```text
https://builtbysai.com/atelier-air-hockey/?netRoute=turn
```

If joining with a room link/code, make sure the guest also has `netRoute=turn` in its URL.

What this mode does:

- fetches the same short-lived Cloudflare credentials as production
- strips all STUN-only entries
- passes only TURN/TURNS entries through Trystero `rtcConfig.iceServers`
- sets WebRTC `iceTransportPolicy: 'relay'`
- fails closed if no TURN credential is available instead of silently succeeding over direct P2P

Expected:

- the match connects
- `Net.rtc.route === 'relay'`
- the connection chip tooltip reports `Relayed`
- `Net.rtReady` can still open
- the reliable 30 Hz compatibility path still works if the realtime lane does not
- goals, score and match state remain host-authoritative

## 4. Gameplay verification on TURN

Play a short match and explicitly exercise:

- rapid guest mallet movement
- several puck contacts
- at least two goals
- pause/resume
- one rematch
- one leave/rejoin cycle after PR #88 is merged
- one Wi-Fi/cellular migration after PR #88 is merged, where browser support permits

Record:

- browser + OS for both peers
- network type for both peers
- `Net.rtc`
- RTT shown in the connection chip
- whether `Net.rtReady` opened
- reconnect time if migration/recovery was exercised
- any visible correction, stuck state, duplicate goal or score divergence

## 5. Failure interpretation

A forced-TURN failure is useful evidence.

Check in this order:

1. production-origin `POST /ice` succeeds
2. returned credentials contain TURN/TURNS URLs
3. both peers actually loaded with `netRoute=turn`
4. browser console has no CORS or credential-service errors
5. selected candidate route is relay when connected
6. compare UDP TURN vs TLS/TCP TURN behavior if a restrictive network blocks UDP

Do not weaken the normal direct-preferred configuration to make a forced-TURN test pass. Fix the relay path itself.

## Exit criteria

This phase is complete when:

- normal mode establishes a healthy direct-preferred connection on at least one real-device pairing
- forced mode establishes a relay-only connection on at least one real-device pairing
- critical events remain synchronized
- the host remains authoritative for puck outcomes, goals and score
- no long-lived TURN secret is exposed client-side
- results are recorded before host-side lag compensation is enabled
