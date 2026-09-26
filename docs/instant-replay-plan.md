# Instant Replay Plan

## Goal

Add a fast, skippable goal replay without changing live physics, AI, or online authority. Replay should work with Top-down, Elevated, and Surface because it reuses the normal renderer.

## Recommended architecture

Use a visual snapshot ring buffer rather than re-running physics backwards.

- Sample the live match at 30 Hz.
- Keep the latest 5 seconds in a fixed circular buffer.
- At a goal, preserve roughly 3.5 to 4 seconds before the goal plus a short post-goal beat.
- Replay snapshots by interpolating between adjacent frames.
- Never write replay state back into the live `G` simulation.
- Resume from the already-preserved live post-goal state after replay.

A 30 Hz buffer for 5 seconds is about 150 snapshots. Even with puck, two mallets, score/state, and a small amount of visual metadata, this is only tens of kilobytes.

## Snapshot shape

Keep snapshots deliberately small:

```js
{
  t,
  puck: { x, y, vx, vy, w, ang },
  m1: { x, y, vx, vy },
  m2: { x, y, vx, vy },
  score: [left, right],
  state,
  themeId,
  camera,
  onlineFlip,
  goalW,
  fx: {
    puckSq,
    puckSqA,
    hitFlash,
    hitFlashX,
    hitFlashY
  }
}
```

Do not snapshot particles, audio nodes, DOM overlays, or timers. Recreate only lightweight replay-safe visual accents.

## Playback

1. Normal play continuously records snapshots.
2. `onGoal()` marks the replay endpoint before the goal ceremony mutates presentation state.
3. The normal scoring state remains authoritative and frozen.
4. Replay renders an interpolated snapshot timeline at 0.65x to 0.8x speed.
5. The last 300 to 500 ms can ease into the goal moment.
6. A small `REPLAY` label and `Skip` action appear in screen space.
7. Replay exits into the normal goal ceremony or next countdown.

Interpolation should be linear for position and velocity. Puck angle should use shortest-angle interpolation so spin does not jump across 360 degrees.

## Camera behavior

Default replay behavior should preserve the camera the player was using when the goal happened.

- Top-down replays Top-down.
- Elevated replays Elevated.
- Surface replays Surface.
- If orientation changes while replay is open, refit the camera but keep the snapshot timeline unchanged.

A later enhancement could offer a cinematic replay camera, but that should not be part of v1.

## Local modes

Phase 1 should support:

- Vs House
- Two Players
- Exhibition

These modes share the local authoritative simulation, so snapshot capture is straightforward.

## Online mode

Do not let replay alter online simulation timing.

Recommended phase 2:

- Host remains authoritative.
- Each peer records its own received/rendered snapshots locally.
- A goal event contains the authoritative goal timestamp/sequence.
- Each peer replays its already-buffered local snapshots around that sequence.
- No replay snapshot traffic is needed unless testing shows client buffers diverge visually.

Until that path is verified, online replay can remain disabled while local replay ships.

## Settings

Add a persisted preference:

- Instant replay: Goals / Off

Default: Goals.

Persist it inside the existing `atelier-ah-settings` object in localStorage.

## UX rules

- Replay should never exceed about 4 seconds.
- Skip must be one tap/click and Escape should also skip.
- Do not show replay on the initial face-off or non-goal pauses.
- Respect `prefers-reduced-motion`: play at normal speed with no replay camera easing, or allow the user setting to disable it.
- Audio should use a short replay mix, not replay already-scheduled Web Audio nodes.
- The scoreboard should clearly retain the newly awarded score so replay never creates scoring ambiguity.

## Implementation stages

### Stage 1: capture and local playback
- Add fixed-size snapshot ring buffer.
- Record at 30 Hz from the frame loop.
- Add interpolation helpers.
- Add replay state that renders without advancing physics.
- Support local modes.
- Add skip controls and tests.

### Stage 2: visual polish
- Add `REPLAY` label.
- Add short audio treatment.
- Tune playback window and speed.
- Verify all ten table themes and all three cameras.

### Stage 3: online
- Associate buffered snapshots with host goal sequence/timestamp.
- Verify host/guest replay boundaries.
- Keep network simulation frozen only locally at presentation level, never at authority level.

## Testing

Add tests for:

- ring buffer overwriting oldest snapshots
- interpolation at 0, 0.5, and 1
- shortest-angle puck interpolation
- goal endpoint capture before ceremony mutation
- replay never increments score
- replay never calls network send functions
- skip restores the correct live state
- camera/orientation changes only refit presentation
- localStorage preference migration

## Research basis

The design follows established real-time game techniques:

- Glenn Fiedler, Snapshot Interpolation: https://gafferongames.com/post/snapshot_interpolation/
- Glenn Fiedler, Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- Glenn Fiedler, What Every Programmer Needs To Know About Game Networking: https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/

Snapshot buffering plus interpolation is a better fit here than deterministic rewind because Atelier already has a high-frequency physics simulation, visual effects, AI, and online authority that should remain untouched by replay presentation.
