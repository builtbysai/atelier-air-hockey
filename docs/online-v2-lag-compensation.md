# Online V2 Host Lag Compensation Design

Status: design + executable contract only  
The deterministic Network Lab, ICE/network migration recovery, Quick Match, spectators, session resurrection, and authority migration are merged. Production lag compensation must remain disabled until the integrated `main` passes `npm run unit:online`, full CI/Visual QA, the Network Lab, and the real-device direct/TURN/migration matrix.

## Problem

Guest-side contact prediction now makes a remote hit feel immediate on the guest device.

The host is still authoritative. At meaningful RTT, the host may receive the guest's movement after the puck has already moved away from the contact point. That creates the classic disagreement:

> The guest clearly hit the puck locally, but the authoritative host simulation missed it.

The fix must improve fairness without letting the guest declare an authoritative hit, score, goal, puck position, or puck velocity.

## Decision

Use a **bounded current-authority-validated contact hint**, not full rollback.

The guest may tell the host:

- which authoritative state it was reacting to
- which input sequence caused the local predicted contact
- the guest mallet pose at that contact

The current authority decides whether that contact was physically plausible against recent authoritative history.

If valid, and if no newer authoritative touch/goal invalidates it, the host may apply a compensated collision impulse.

The host remains the only machine that decides the result.

## Why not trust the guest's predicted puck state

Do not send:

- "I hit the puck, therefore puck velocity is X"
- "the puck is now at X/Y"
- "I scored"

Those are outcomes.

The guest may submit only evidence needed to validate an input/contact. The host computes the outcome from its own physics constants.

## Why not full rollback yet

Full rollback would require deterministic save/restore/replay of:

- puck state
- both mallets
- spin
- contact latches
- wall collisions
- goal detection
- anti-stall behavior
- random behavior
- audiovisual side effects

That is a larger architectural project.

Atelier can likely capture most of the fairness gain with a small bounded contact history because there are only:

- one puck
- two mallets
- one guest-controlled striker
- a short useful rewind window

## Reuse the realtime state sequence as the time reference

Do not immediately add a separate synchronized wall clock.

The host already sends a monotonically wrapping 16-bit realtime state sequence at up to 60 Hz.

The guest already knows `Net.rtLastStateSeq`.

Use that sequence as the coarse authoritative reference.

Advantages:

- no clock synchronization protocol
- wrap handling already exists
- naturally gives a lower bound: the guest cannot have reacted before a state it had not received
- about 16.7 ms authoritative trajectory samples at 60 Hz

The guest predicts from an extrapolated puck, so **do not require the mallet to overlap the raw referenced snapshot**. That snapshot may be tens of milliseconds older than the visible contact.

Instead, the host scans its own authoritative puck trajectory forward from the referenced state through the bounded rewind window and finds the earliest plausible open-table intersection with the claimed mallet pose.

This avoids adding:

- synchronized clocks
- client timestamps
- client-declared puck position
- client-declared puck velocity

If later testing shows that 60 Hz trajectory resolution is insufficient, first interpolate between adjacent host samples. Only consider a separate 240 Hz host physics tick if measured evidence still requires it.

## Proposed contact hint packet

New additive realtime message type:

`NET_RT_HIT_HINT = 4`

Fixed binary shape, little-endian where applicable:

```text
byte 0      type
byte 1      protocol version
bytes 2-3   guest input sequence      u16
bytes 4-5   last host state sequence  u16
bytes 6-9   guest mallet x             f32
bytes 10-13 guest mallet y             f32
bytes 14-17 guest mallet vx            f32
bytes 18-21 guest mallet vy            f32
```

22 bytes total.

### Protocol compatibility

This is an **additive message type**, not a change to the existing state/input/ACK packet layouts.

- keep the current realtime packet version for this additive type
- old peers already ignore unknown realtime message types
- a new guest may send a hint to an old host and it is harmlessly ignored
- an old guest simply never sends hints to a new host
- do not change the 12-byte input packet merely to carry lag-compensation data
- bump the realtime protocol/version only if an existing packet layout or semantic contract becomes incompatible

### Input sequence semantics

The hint is self-contained evidence. Its `inputSeq` is a correlation/deduplication key for the local action that produced the prediction; it is **not proof that the separate input packet arrived**.

This matters because input and hint packets share an unordered, zero-retransmit lane. Requiring both to arrive would make compensation unnecessarily fragile under packet loss.

Rules:

- validation may proceed even if the matching input packet was lost or arrives later
- a hint never updates `rtLastInputSeq`
- a hint never causes an input ACK
- existing ACK semantics remain tied only to accepted realtime input packets
- if the host has a recent input sequence, a hint may lead it only by a bounded modular amount
- initial contract bound: `MAX_HINT_INPUT_LEAD = 32`
- replay/stale hint ordering uses the existing wrap-safe 16-bit sequence comparison

This packet is replaceable realtime evidence, not a reliable game event.

A lost hint must not corrupt the match. It only means the host falls back to its ordinary current-state collision result.

## Current-authority history ring

When the host assigns/publishes each realtime state sequence, store a compact history item from the **same authoritative state used to encode that sequence**. The state sequence and history record must be created atomically from the caller's point of view; never attach a sequence to state sampled later.

Suggested shape:

```js
{
  seq,
  time,
  puckX,
  puckY,
  puckVx,
  puckVy,
  puckW,
  guestMalletX,
  guestMalletY,
  guestMalletVx,
  guestMalletVy,
  lastTouchSerial,
  pointSerial,
  state
}
```

Recommended initial history:

- 16 state snapshots
- about 267 ms at 60 Hz
- lookup by wrap-safe 16-bit state sequence
- age from the stored host monotonic timestamp, never from sequence distance alone

Maximum compensation window should initially be smaller:

- 150 ms target
- 180 ms hard maximum for experimentation

Never validate against arbitrary old history just because it is still in the ring.

For contact validation, the referenced sample is the **start** of a short authoritative trajectory window, not necessarily the contact sample. Scan forward only while:

- age remains inside the hard compensation window
- point serial stays unchanged
- touch serial stays unchanged
- state remains live play
- samples remain outside the conservative rail/goal ambiguity guard

The host's current authoritative puck state may be used as the final trajectory endpoint if it satisfies the same continuity gates.


## Authority migration and resurrection rules

Lag compensation must follow **authority ownership**, not the historical host/guest role.

When authority changes sides, or an authoritative session is resurrected after reload:

- clear the local lag-history ring
- clear processed-hint dedupe state
- clear any pending compensated-contact candidate
- start fresh local `pointSerial` / `touchSerial` tracking for compensation purposes
- do not import speculative guest prediction as authority history
- do not manufacture historical samples from the single migration/resurrection snapshot
- keep compensation disabled until the new authority has published enough of its own consecutive live-play state samples to validate a bounded trajectory

Recommended initial warm-up gate:

- require at least **3 consecutive current-authority history samples**
- every sample must belong to the same live-play point/touch continuity
- the referenced state sequence in a hint must exist in history created by the **current authority epoch**
- if the authority changes again, reset the warm-up immediately

The realtime state sequence intentionally remains continuous across authority migration. That is useful for packet ordering, but sequence continuity alone is **not** proof that a state belongs to the current authority's validation history.

A stale hint that references a pre-migration sequence therefore fails with `missing-history` rather than being interpreted against reconstructed or inherited history.

The 30 Hz reliable compatibility path is unaffected. Contact hints are optional realtime evidence; when the realtime lane is unavailable, ordinary authoritative collision behavior remains the fallback.

## Authoritative serials

Add two monotonic local host serials.

### `pointSerial`

Increment when:

- a goal is awarded
- a new point begins
- a restart begins

A hint whose historical `pointSerial` differs from current is invalid.

### `touchSerial`

Increment once per **authoritative leading-edge puck-mallet contact episode**, using the same notion of a new contact that drives hit feedback/Highlights. Do not increment on every 240 Hz overlap substep while a mallet is continuously touching/smothering the puck.

Store it in history.

For v1, if current `touchSerial` differs from the referenced historical value, reject the hint. This intentionally treats any intervening authoritative touch as superseding authority, including a host collision that already recognized the same guest hit. In that case compensation is unnecessary anyway.

This prevents a delayed guest claim from overwriting a legitimate later host save/strike.

## Validation pipeline

A contact hint is accepted only if every gate passes.

### Gate 1: protocol and sequence

- exact 22-byte hint packet and correct packet version
- all numeric fields finite
- referenced host state sequence exists in the history ring
- hint input sequence is not a duplicate/replay of the newest processed hint
- if a recent host input sequence exists, the hint is no more than 32 modular input sequences ahead
- the matching input packet does not need to have arrived

### Gate 2: age

- history age <= compensation window
- reject stale hints beyond the hard maximum

Initial contract:

`MAX_CONTACT_REWIND_MS = 180`

Compute age as `hostNow - history.time` using the host monotonic clock. Never estimate hint age as `sequenceDelta * 16.7` because send cadence, backpressure and scheduling can vary.

Tune only after the Network Lab and real-device runs produce measurements.

### Gate 3: point/state continuity

Reject if:

- point serial changed
- host is not in live play
- a goal ceremony/countdown/restart occurred
- the referenced history was not live play

### Gate 4: side bounds

Guest mallet pose must be physically inside the guest half plus a tiny numeric tolerance.

Never accept a guest pose across the center line or through a rail.

### Gate 5: mallet speed plausibility

Guest-reported velocity must respect a tolerance around `PLAYER_CAP`.

Do not simply trust the velocity fields.

Compare against:

- previous accepted guest pose/input
- elapsed authoritative time
- `PLAYER_CAP`
- small tolerance for sampling/rounding

Initial contract: reported mallet speed may not exceed `PLAYER_CAP * 1.10`.

Use the production `PLAYER_CAP`; do not copy a numeric cap into network code. The Online test harness now has a contract that fails when production collision constants drift.

### Gate 6: authoritative trajectory contact geometry

The raw guest-referenced state is only the lower bound. Search the host's own authoritative puck samples from that state forward through the allowed window.

For each adjacent open-table sample pair:

1. treat the puck path over that short 60 Hz interval as a line segment
2. test the claimed guest mallet center against that segment using an expanded radius
3. choose the **earliest** segment/intersection that is physically plausible
4. interpolate host puck position/time/velocity at that candidate point

Expanded contact radius:

```text
PUCK_R + MALLET_R + CONTACT_TOLERANCE
```

Initial contract:

- `CONTACT_TOLERANCE = 12` rink units

Use the earliest plausible intersection, not whichever sample gives the most favorable rebound.

This is deliberately conservative and uses only host-authored puck history. The guest does not send a puck position or a contact timestamp.

The executable fixture `valid-contact-after-referenced-state` specifically proves that validating only the raw referenced snapshot would be incorrect.

### Gate 7: approaching contact

At the selected authoritative trajectory intersection, derive the contact normal from the interpolated **host puck position** and the claimed mallet position.

Interpolate/use the host-authored puck velocity for that candidate. Then require physically closing relative motion.

Do not accept a mallet that was already moving away from the puck.

Use the same physical ideas as `collideMallet`:

- contact normal
- host-authored puck velocity at the candidate
- claimed mallet velocity after speed/pose plausibility checks
- relative normal velocity
- mallet normal velocity

The trajectory search locates a possible contact; this gate decides whether it is a plausible strike rather than a geometric near-pass.

### Gate 8: no superseding authority

Reject if current authoritative state has a later touch serial than the referenced history, unless the later touch is proven to be the same guest contact.

Initial implementation should be conservative and reject ambiguity.

### Gate 9: no impossible/ambiguous transition

Do not apply compensation if:

- goal already occurred
- current or historical match state is not live play
- puck is inside a goal transition
- the historical/current contact is too close to a rail/goal transition for the simple velocity-only correction to be unambiguous
- current puck is physically inconsistent with the bounded historical window

Initial conservative open-table guard:

- `RAIL_GUARD = 2 * PUCK_R`

A rejected hint falls back to ordinary host physics. V1 should prefer a false negative near rails over retroactively applying the wrong collision after a wall/goal interaction.

## How to apply an accepted contact

Recommended first version:

1. Use the selected/interpolated authoritative trajectory contact state.
2. Use the validated guest mallet pose/velocity.
3. Run the same collision impulse math as `collideMallet`.
4. Compute the compensated outgoing puck velocity.
5. Apply that **velocity** to the current authoritative puck.
6. Keep current authoritative puck position unless a very small separation correction is necessary.
7. Increment touch serial.
8. Let ordinary host simulation continue.

Why velocity-first:

- avoids rewinding the entire current world
- avoids visual teleport on the host
- avoids replaying wall/goal side effects
- guest has already shown the predicted hit locally
- next host snapshot reconciles the guest to the accepted/rejected result

Do not initially rewind and replay the full 240 Hz world.

## Shared collision math

Before implementation, extract the **normal open-table** mallet-puck impulse calculation into a side-effect-free helper. Do not put glue escape, wrap-release, AI clear behavior, scoring, sound, particles, stats, or highlight side effects into the pure solver.

For example:

```js
solveMalletImpulse({
  puckVx,
  puckVy,
  malletVx,
  malletVy,
  nx,
  ny
})
```

It should return only physical results.

Then all three paths:

- normal authoritative `collideMallet` normal-contact branch
- existing guest contact prediction
- lag-compensation validation/application

use the same restitution/smack/max-speed math for velocity.

The current guest predictor duplicates this calculation in `src/net.js`; the production lag-compensation work should remove that drift rather than add a third copy. Keep the extraction behavior-preserving before enabling any compensation.

Do not duplicate constants or create a second "network physics" model.

Keep audiovisual effects outside the pure solver.

## Contact-hint deduplication

Track the newest processed **hint** input sequence separately from `rtLastInputSeq`.

A repeated hint for the same input must not cause a second impulse.

Because the realtime lane is unordered, use the existing modular 16-bit sequence helper.

## Interaction with guest prediction

Guest flow:

1. guest locally detects credible contact
2. guest immediately predicts puck response
3. guest forces current input packet onto realtime lane
4. guest sends one contact hint referencing:
   - that input sequence
   - most recent host state sequence
   - local mallet pose/velocity
5. guest continues predicted flight
6. host validates or rejects hint
7. ordinary authoritative state arrives
8. existing ACK/state fence reconciles the guest

No extra reliable acceptance message is required initially.

The authoritative state itself is the result.

A debug-only metric may count accepted/rejected hints.

## Executable contract fixtures

Before production code exists, the acceptance policy is captured as data in:

`tests/fixtures/online-v2-lag-compensation.json`

and schema/coverage checked by:

`tests/net-lag-compensation-contract.test.mjs`

The fixtures intentionally do **not** implement a second validator or physics solver. When the real host validator is built, its tests should run these same cases through the production function.

The fixture also locks:

- realtime type `4`
- current realtime version `1`
- exact 22-byte field offsets/sizes
- little-endian integer/float encoding
- 16-bit input/state sequence wraparound cases
- acceptance when the matching input packet was lost, proving the hint stays self-contained
- acceptance when contact occurs **after** the raw referenced snapshot, proving validation must scan forward through authoritative history
- rejection when no point on that bounded authoritative trajectory reaches contact geometry

Initial reason vocabulary:

- `accepted`
- `malformed`
- `duplicate-or-replay`
- `missing-history`
- `stale`
- `input-lead`
- `point-state`
- `side-bounds`
- `velocity`
- `geometry`
- `separating`
- `superseded`
- `unsafe-transition`

The fixture policy starts with:

- max rewind: 180 ms
- max hint lead over latest input: 32 sequences
- contact tolerance: 12 rink units
- speed tolerance: 10% over production `PLAYER_CAP`
- rail/goal ambiguity guard: `2 * PUCK_R`
- guest bounds: exactly the same bounds enforced by `clampMallet` / `Net.onInput`

These are starting safety bounds, not promises about final game feel.

## Anti-cheat posture

This is a casual invite/quick-match game, not a cash tournament system, but the host should still reject obviously impossible claims.

The guest never controls:

- score
- goal
- puck position
- final puck velocity
- point state
- match state

The host validates:

- age
- geometry
- side bounds
- velocity
- point continuity
- touch continuity

This is enough for the intended threat model without central servers.

If Atelier later adds ranked verified competition, reevaluate the entire trust model.

## Metrics to add

Host:

- `lagHintsReceived`
- `lagHintsAccepted`
- `lagHintsRejectedAge`
- `lagHintsRejectedGeometry`
- `lagHintsRejectedVelocity`
- `lagHintsRejectedSuperseded`

Guest:

- existing prediction count
- reconciliation count
- maximum correction distance
- predicted contacts eventually matching host direction
- hard corrections

Network Lab should report these per profile.

## Network Lab acceptance cases

### Clean

Expected:

- almost no compensated hints needed
- normal host collision usually happens before hint compensation matters
- no duplicate impulses

### Mobile, about 130 ms RTT

Expected:

- guest hit remains immediate
- valid hint acceptance prevents most visible false misses
- small reconciliation corrections

### Hotel Wi-Fi

Expected:

- lost hint does not break state
- later authoritative snapshots still converge
- no duplicate goal/touch
- reordering does not double-apply a hint

### Brutal

Expected:

- graceful degradation
- stale hints rejected
- no huge retroactive puck teleport
- score remains authoritative

## Failure safety

If contact compensation throws, rejects, or receives malformed data:

- ignore the hint
- keep current host simulation
- continue the match

The feature is an accuracy improvement, never a match-critical dependency.

## Rollout sequence

1. Validate the integrated `main`: `npm run unit:online`, full test/build, and Visual QA.
2. Run the merged Network Lab and capture current prediction/reconciliation baselines.
3. Run the real-device normal, forced-TURN, Wi-Fi/cellular migration, resurrection, spectator, Quick Match, and authority-migration matrix.
4. Fix any integration defects before changing collision behavior.
5. Extract one behavior-preserving pure normal-contact impulse solver; make authoritative collision and guest prediction share it.
6. Add current-authority state history plus point/touch serials with compensation still disabled.
7. Add explicit history reset/warm-up behavior for authority migration and authoritative session resurrection.
8. Add the 22-byte type-4 hint codec; do not change existing input/state packet layouts.
9. Implement the current-authority validator returning debug rejection reasons and run the existing data fixtures through the **production** validator.
10. Collect accepted/rejected metrics with velocity application still disabled.
11. Enable compensated velocity application in tests only.
12. Tune age/geometry bounds from Network Lab + device evidence.
13. Re-run direct and forced-TURN real-device matches, including authority migration during a point.
14. Ship only if false misses improve without duplicate touches, score divergence, rail artifacts, migration artifacts, or large correction regressions.

## Do not do yet

- no full rollback
- no client-authoritative puck
- no guest-declared goal
- no position teleport rewind
- no large forgiveness radius
- no hidden physics assist based on who is losing
- no dedicated server just to solve this issue
