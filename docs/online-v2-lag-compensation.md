# Online V2 Host Lag Compensation Design

Status: design only  
Implementation should begin only after draft PR #89, the deterministic Network Lab, is runnable and green.

## Problem

Guest-side contact prediction now makes a remote hit feel immediate on the guest device.

The host is still authoritative. At meaningful RTT, the host may receive the guest's movement after the puck has already moved away from the contact point. That creates the classic disagreement:

> The guest clearly hit the puck locally, but the authoritative host simulation missed it.

The fix must improve fairness without letting the guest declare an authoritative hit, score, goal, puck position, or puck velocity.

## Decision

Use a **bounded host-validated contact hint**, not full rollback.

The guest may tell the host:

- which authoritative state it was reacting to
- which input sequence caused the local predicted contact
- the guest mallet pose at that contact

The host decides whether that contact was physically plausible against recent authoritative history.

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
- naturally ties the claim to a state the host actually published
- about 16.7 ms resolution at 60 Hz

If later testing shows that 60 Hz temporal resolution is insufficient, add a 240 Hz host physics tick as protocol v3.

## Proposed contact hint packet

New realtime message type:

`NET_RT_HIT_HINT`

Suggested fixed binary shape:

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

This packet is replaceable realtime evidence, not a reliable game event.

A lost hint must not corrupt the match. It only means the host falls back to its ordinary current-state collision result.

## Host history ring

When the host publishes each realtime state sequence, store a compact history item.

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

Maximum compensation window should initially be smaller:

- 150 ms target
- 180 ms hard maximum for experimentation

Never validate against arbitrary old history just because it is still in the ring.

## Authoritative serials

Add two monotonic local host serials.

### `pointSerial`

Increment when:

- a goal is awarded
- a new point begins
- a restart begins

A hint whose historical `pointSerial` differs from current is invalid.

### `touchSerial`

Increment on every authoritative puck-mallet contact.

Store it in history.

If another authoritative touch happened after the claimed historical moment, do not apply an old compensated impulse on top of the newer touch.

This prevents a delayed guest claim from overwriting a legitimate later host save/strike.

## Validation pipeline

A contact hint is accepted only if every gate passes.

### Gate 1: protocol and sequence

- correct packet version
- input sequence is plausible/current
- referenced host state sequence exists in the history ring
- hint is not a duplicate/replay of one already processed

### Gate 2: age

- history age <= compensation window
- reject stale hints beyond the hard maximum

Suggested start:

`MAX_CONTACT_REWIND_MS = 180`

Tune using the Network Lab.

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

A useful initial tolerance is a percentage, not a huge fixed cheat window.

### Gate 6: historical contact geometry

Against the historical puck state:

```text
distance(puck, guestMallet) <= PUCK_R + MALLET_R + CONTACT_TOLERANCE
```

Suggested initial tolerance:

- 8 to 16 rink units

Tune from chaos tests and real devices.

### Gate 7: approaching contact

The relative normal velocity must indicate a real closing contact.

Do not accept a mallet that was already moving away from the puck.

Use the same physical ideas as `collideMallet`:

- contact normal
- relative velocity
- mallet normal velocity

### Gate 8: no superseding authority

Reject if current authoritative state has a later touch serial than the referenced history, unless the later touch is proven to be the same guest contact.

Initial implementation should be conservative and reject ambiguity.

### Gate 9: no impossible current state

Do not apply compensation if:

- goal already occurred
- puck is inside a goal transition
- current puck is extremely far from the historical continuation
- applying the correction would teleport through a rail/goal frame

## How to apply an accepted contact

Recommended first version:

1. Use the historical authoritative puck state.
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

Before implementation, extract the core mallet-puck impulse calculation into a side-effect-free helper.

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

Then both:

- normal authoritative `collideMallet`
- lag-compensation validation

use exactly the same restitution/smack/max-speed math.

Do not duplicate constants or create a second "network physics" model.

Keep audiovisual effects outside the pure solver.

## Contact-hint deduplication

Track the newest processed hint input sequence.

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

1. Merge and run Network Lab PR #89.
2. Measure current prediction under each network profile.
3. Extract pure collision solver with existing physics behavior unchanged.
4. Add host state history ring only.
5. Add contact hint codec only.
6. Add validation gates with compensation disabled and collect unit metrics.
7. Enable compensated velocity application in tests.
8. Tune age/geometry tolerance.
9. Real-device test direct WebRTC.
10. Real-device test forced TURN.
11. Only then ship to production.

## Do not do yet

- no full rollback
- no client-authoritative puck
- no guest-declared goal
- no position teleport rewind
- no large forgiveness radius
- no hidden physics assist based on who is losing
- no dedicated server just to solve this issue
