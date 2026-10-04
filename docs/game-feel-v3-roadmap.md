# Game Feel V3 and Spectator Reactions Roadmap

**Planning date:** 2026-10-03  
**Status:** Phases 0–1 partially shipped (PRs #134, #137); contextual-goal and goal-first visual slices shipped (#138, #139). Other items remain planned.  
**Relationship:** Supplements `docs/online-v2-roadmap.md`; do not displace Online V2 correctness and real-device gates.

## Implementation checkpoint (2026-10-03)

First playable slice in PR #134:
- Added pure `src/feel-events.js`: geometry-based perfect-strike classifier, spaced meaningful returns, capped rally intensity and goal-release weighting.
- Connected real collision metadata to the existing procedural audio, haptics, impact flash, rally stats, music bus/ambience, short pulse layer, trails and goal-frame energy. Kept the main UI clear of routine rally counters.
- Removed gameplay-clock hit-stop and hard-hit/near-miss slow-motion dips. The post-goal presentation and optional replay still own their own visual phases.
- Updated PWA precache/hash, syntax/static checks and purposeful VM/integration tests. 11 focused feel tests and independent build checks pass. The full suite shows the same **21 baseline failures** documented in issue #136, independently reproduced without Game Feel V3 changes; do not misreport whole-suite green.
- **Not yet shipped by this slice:** complete Feel Lab sliders, cross-peer authoritative feel-event IDs/context, guest perfect-hit reconciliation, context-aware goal-type variants, fast restart, replay-specific audio/timeline effects, room-specific props, spectator emoji transport.

A minimal hidden Feel Lab is implemented on PR #137 (15 live sliders, bounds, current-tab preset capture/apply/reset, diagnostic hit/rally counters, keyboard support, URL opt-in only). First playable V3 slice remains PR #134. Authority-owned compact goal context is merged in PR #138 and a first-frame physical goal reflection is merged in PR #139. Next: epoch-safe feel-event IDs, score-device punch, compact/skip-friendly ceremonies and replay/resurrection parity. Before spectator transport changes, stabilize Online V2 failures in #136.

## Live Feel Lab (PR #137)

- Open on an installed/live build using `?feelLab=1`; button remains collapsed by default. No panel or extra controls without the URL flag.
- Tunable parameters are local to the current tab and clamped by the pure Feel module; they are not saved, broadcast, or able to change puck physics.
- Edit clean-hit geometry/flash/sound/haptic, meaningful-return distance/time, rally music/trail/brightness and capped long-rally release. Presets can be captured and validated/pasted as JSON; Reset restores shipping defaults.
- Live event counters provide immediate feedback for balancing actual play. This is a small tuning panel, not yet a full scenario-generation/visual profiling suite.
- Keep the remaining roadmap phases unchanged until each lands. Do not claim the Online V2 baseline suite is green: inherited failing tests are tracked in #136.

## Authority-owned goal context (merged PR #138)

- Pure `Feel.goalContext` classifies winning, comeback, match-point, bank, long-rally and rocket using existing Highlights metadata. Winning/comeback context takes priority over shot craft; one short craft descriptor may accompany it. OWN GOAL and ANGLE remain pending until contact/trajectory proof exists.
- Online authority now collects bank/rail evidence without recording guest-side replay clips. The existing *reliable* goal event carries a bounded optional `fx` summary to the guest and passive spectator room. Invalid or missing fields fall back to conservative visuals; no score/physics changes and no new realtime stream.
- The ceremony uses the same validated classification across devices and adds a restrained rhythm difference for meaningful finishes. Snapshot-only goal recovery is intentionally generic until an epoch-safe context replay mechanism is implemented.
- This does not resolve the inherited baseline Online V2 failures in issue #136; keep reliability gating before adding spectator reaction transport.

## Physical goal-first follow-up (merged PR #139)

- Add a very thin, directional 170ms mouth reflection that begins on the first confirmed goal frame, moves *into* the scored-on goal, and fades before the ceremony panel takes over. All three shallow arcs share pure timing/geometry and stay within the opening.
- Top-down and 2.5D cameras render the same world-space wave; rendering is gated by reduced-motion/Minimal effects and never changes puck coordinates, AI, simulation delta or snapshot cadence.
- The host sends one optional, rounded mouth crossing Y value inside the existing reliable goal event for guest/spectator visual alignment. Legacy events still work by falling back to the last rendered puck Y, bounded within the actual goal mouth.
- Focused tests verify first-frame direction, timing fade, goal bounds, render hooks, and online visual-position parity. PR #139 focused test group: 27/27 passing; independent build checks passing. The full suite has the same 21 pre-existing failures in issue #136. Next: device-level visual tuning and physical scoreboard-specific punch.

## Physical scoreboard and responsive layout pass (in progress)
- Use the existing 0.5-second scoreboard animation as the only clock for a short earned scoring response: Solari flap recoil, reel catch, cribbage landing ring, deterministic bulb ignition and localized neon glow. Respect Reduced Motion and Minimal effects. No generic entire-board scaling or permanent extra UI.
- Use a shared `scoreboardHudLayout` function in the live game and an isolated actual-renderer visual review harness. Reserve the mobile/tablet top-right control region, including the wider online quality chip, at narrow portrait/landscape/desktop viewport widths.
- Generate screenshot artifacts of all five physical scoring devices across phone portrait, phone landscape and desktop in GitHub Actions. Screenshots are representative renderer fixtures, not a substitute for real-device end-to-end review.
- No transport or physics behavior changes. Keep the inherited 21-failure baseline in issue #136 visible.

## Vision

Make Atelier teach precise striking through a recognizable sound and tactile signature, progressively build tension through meaningful rallies and close matches, then resolve that tension in context-aware, physical-feeling goals. Keep the UI restrained and gameplay fully fair. Give online spectators small social reactions that never jeopardize physics or network smoothness.

The primary principle is **contextual feedback, not indiscriminate visual intensity**.

## Verified foundation on main at planning time

Read `src/game.js`, `src/net.js`, `src/ui.js`, `src/scoreboards.js` before implementing.

- `game.js` already has three impact tiers (`hitTier`), a flash profile, puck/mallet squash, particles, scuffs, `roomPulse`, `AudioSys`, `MusicSys`, `Haptics`, alternating rally counting, `Highlights`, goal ceremonies, serve countdown, local instant replay and a replay HUD.
- Audio and music are procedurally generated using Web Audio. `MusicSys.setIntensity(i)` is currently effectively **binary**, enabled for match point. Its match-point pulse is an existing feature, not a blank slate. Do not add a second music engine.
- `Highlights.recordGoal` and `Highlights.skillLabel` already track/recognize bank goals, fast goals, saves-to-score, long rallies, lead changes and winning goals, mostly for **local play**. Goal context for online spectators/guests must be authority-owned.
- The live render already applies `G.dipT` at 0.55 speed for hard hits/near misses; `G.timeScale=0.22` is used in the post-goal ceremony. These conflict with the stricter proposed **replay-only slow motion** goal. Explicitly audit and remove live physics-time changes, replacing perceived impact with sound, recoil, tiny visual displacement, and local cosmetic effects.
- Ten scoreboards already render as different physical devices with `boardKick`/animation state. Improve each device's response, not one universal CSS transformation.
- The serve currently uses a 2-second countdown followed by a simulated serve velocity. Preserve authoritative serve choice, rules, and countdown synchronization; the puck-drop ritual is strictly visual/audio.
- Goal ceremonies currently hold roughly 1.60–1.95 s for normal goals and 2.70 s for wins, before the following 2-second countdown. Fast restart needs a carefully redesigned ceremony state, not just shorter constants.
- The spectator system already uses a passive room, **maximum 3 viewers**, and 20 Hz snapshots through Trystero. This is not a general-purpose realtime chat architecture. Its sends are currently via Trystero's room actions. Keep spectators passive and cap traffic.
- The player's main WebRTC realtime lane is unordered/unreliable with 60 Hz when healthy; reliable 30 Hz fallback and critical reliable authoritative events must survive. The user is doing real-device testing; do not declare online correctness verified from source review alone.
- Existing Settings includes `effects` (full/subtle/minimal), `shake` (off/subtle/full), `haptics`, independent SFX/music volumes, and an audio mute controller. Expand the common effect scalers rather than creating redundant public preferences.

## Architectural first step: one authoritative semantic event, multiple local presenters

Define an immutable, small **semantic feel event** emitted at the authoritative simulation collision/score transition, not in each renderer:

```js
// Illustrative schema; not yet implemented.
{
  id, matchEpoch, tick, type, side,
  pointId, x, y, nx, ny,
  relativeNormalSpeed, tangentialSpeed,
  incomingPuckSpeed, outgoingPuckSpeed,
  rallyCount, goalContext
}
```

Keep the event data minimal: no entire trajectories or audio parameters on the wire. Use a stateless event classifier plus bounded per-point context tracker (last touch side, touch serial, side-rail hits, last meaningful return, prior scores, worst deficit, streak). Use the *existing* `Highlights` / `G.stats` definitions as the migration starting point; do not double-count.

- Local authoritative collision emits event exactly once. Local visual/audio/haptic consumers can vary per device and preference.
- Guest predicts immediate impact feedback from local plausible contact, but classification is **provisional**. Deduplicate by input sequence/authoritative event ID during reconciliation. A failed speculative perfect strike must not create permanent stats or unlocks.
- Authority owns official goal metadata; transmit compact additive context with the existing reliable goal event (optional fields for compatibility) so guests and spectators display the same BANK/ROCKET/LONG RALLY/OWN GOAL classification.
- On authority migration/reload, fence by authority epoch and point ID. Do not replay goal celebrations or resurrect stale rally intensity.
- Presentation never feeds back into puck collision resolution, timing, AI decisions, or network snapshot cadence. Local UI skipping never advances online authority.

Suggested maintainability modules *after* refactoring for seams: `src/feel-events.js` (classification and intensity calculation), `src/feel-presenter.js` (visual cues), `src/feel-lab.js` (development controls); retain `AudioSys`/`MusicSys` and scoreboard/theme owners in their existing modules. Avoid a large rewrite unless baseline extraction tests justify it.

## Phase 0: correctness, instrumentation and a minimal developer Feel Lab

**Why first:** Many requested effects already exist, and tuning independently will cause contradictory timings and mix levels.

1. Capture current baseline at 60/120 Hz and throttled mobile. Profile render-frame time, emitted collisions/second, active audio nodes, particle counts, retained replay memory, and spectator traffic. Run existing offline and online tests; separately track the user's real-device reports.
2. Build a hidden, opt-in Feel Lab with live settings and reproducible scenarios. It must not affect ranked/actual play values or be mistaken for a security-gated feature on a static site.
3. Centralize strict effect budgets, accessibility limits, deduplicated event IDs, and the debug readout. Load defaults from one data-driven configuration object, keep public preferences simple, and avoid new backward-compatibility/migration scaffolding without a demonstrated need.
4. Remove all manipulation of live simulation delta by the new effects. Audit current `G.freezeT`, `G.dipT`, `G.timeScale` users to distinguish gameplay slowdown from *render-only* recoil. Explicitly test online tick-rate neutrality.

**Feel Lab controls:** contact flash duration/intensity/footprint; squash spring; trail threshold/gain; micro impulse pixels/duration; particle budget; contact pitch range; haptic patterns/cooldowns; rally intensity curves; per-goal emphasis and skip window; replay playback speed and hold duration; emoji rate limits / latency. Include reset-to-default, capture/paste presets, scenario triggers, event log and device FPS/latency view. Exclude god-mode/control manipulation.

**Exit criteria:** classifying the same semantic event produces identical labels across modes; disabled features create no work; baseline gameplay rules, host authority, goal counting, and the Online V2 fallback remain unchanged.

## Phase 1: perfect strikes, escalating rallies, contextual release (#5, #13, #14)

**Perfect strike:**
- Evaluate from actual relative contact velocity projected onto the collision normal, tangential velocity, shot-direction alignment and outward mallet-facing geometry. Reject taps, glancing collisions and stale speculative contacts. Calibration should allow intentional bank shots; do not hard-code 'must point directly at the goal'.
- Avoid claiming a physically intrinsic mallet 'sweet spot': a circular air-hockey mallet has no directional face. Design this as learned timing/alignment feedback, not extra puck power.
- Proposed starting thresholds (lab only): high normal-relative speed vs observed strike distribution (e.g. top ~20%), low tangential leakage, outgoing trajectory within a tunable aim cone. Refit thresholds from actual gameplay distribution and test keyboard/gamepad/touch fairness.
- Distinct short dry 'crack', localized warm flash (< one perceptually brief beat, no full-screen strobe), subtle optional 5–10 ms haptic if supported. Respect cooldown; no persistent PERFECT label. Do not double-fire on guest correction or amplify simultaneous rail/strike into clipping.

**Rally:**
- Reuse alternating-touch count but add *meaningful return* debounce: disallow wall pinball/no real exchange, and require sufficient puck travel/time or possession exchange. Maintain a current intensity target based on rally progression.
- Starting curve: 1–3 neutral; 4–9 progressively brighter timbre and slightly stronger trail; 10+ capped tension/music layer. Suggested normalized intensity: `clamp((meaningfulReturns - 3) / 9, 0, 1)` with onset smoothing. Preserve clarity of puck/goal audio and never exceed mix loudness.
- Add a soft ambient duck and musically timed layer within `MusicSys`, not a separate soundtrack. At goal/reset, release immediately in presentation (brief, controlled audio decay), not by resetting the score or restarting all oscillators.
- Remove intrusive rally milestone typography in normal play. Keep numbers for highlights/workshop stats and optional accessibility/text telemetry.

**Rally release:** capture rally count *before* goal state resets it. Contextual goal-energy modifier should be capped, e.g. a 15-hit finish earns a little more attack/swell than an instant serve goal, without doubling volume/particles.

**Tests:** same-side repeated hits not counted; rail/post contacts don't count as opponent returns; guest predicted/reconciled strike doesn't duplicate; mute + separate music/SFX sliders still work; per-frame intensity has no physics writes.

## Phase 2: physical and contextual goals, score and restart (#16–18, #25–27, #34)

**Physical first:** goal-mouth impact and frame/material response should appear within the first rendered frame of a confirmed goal; authoritative score update is immediate. Animate goal mesh/trim/light displacement or a tiny projected directional reflection wave into the mouth, then scoreboard physical-device punch (5–8% visual overshoot where suitable), then a short ceremony. Avoid full-screen white flashes. Preserve 2D and 2.5D perspective integrity.

**Classification:** reuse `Highlights.recordGoal` as initial data model; prioritize one primary label by stable precedence:
1. WINNING GOAL / winner confirmation (match result beats shot craft);
2. true COMEBACK lead/equalizer or MATCH POINT context;
3. OWN GOAL (only if last toucher and scored-on side prove it);
4. exceptional LONG RALLY, BANK, ROCKET, ANGLE (angle only if tracked shot/crossing geometry supports it);
5. generic goal.
Keep optional secondary short shot descriptor rather than multiple simultaneous badges. No 'fake' ROCKET or OWN GOAL based solely on impression.

**Variation:** use different rhythmic/typographic/emphasis profiles based on the classification while respecting the active table's theme and goal ownership (conceded goals should not be just as celebratory for the local player). Cap audiovisual energy based on event context.

**Serve:** add tiny drop/settle/bounce, shadow follow-through, short table resonance during the *existing* countdown. Do not physically re-simulate extra collisions or change the authority-sent serve vector.

**Fast restart:** target physically legible impact and score feedback in ~100–150 ms, compact normal ceremony around 0.5–0.8s (lab tunable), accessible win ceremony longer if desired. Allow tap/drag to skip the *tail*. In offline play, proceed into existing authoritative countdown once mandatory score feedback lands. In online play, skip only local cosmetics and wait for authority's countdown; skip must not transmit new start commands or hide pause/reconnect/goal confirmation.

**Rematch:** reuse the already-loaded game scene and themed assets. Retract score/win presentation and visually return puck to center as new authoritative match state starts. Avoid page reload and duplicate music contexts.

**Tests:** duplicate/stale goal events; online guest vs host same label; pause/reconnect during goal; repeated fast tap/drag; match-ending goal vs ordinary goal; all 10 boards; both camera projections; spectator enters mid-ceremony.

## Phase 3: match drama and environments (#15, #20, #22–24, #32)

**Unified presentation intensity:** keep separate sources with priority:
- rally tension: moment-to-moment continuous;
- match state: match point / both sides at one point away / 1-point late-game margin, computed for first-to-5/7/11 dynamically;
- comeback momentum: significant earlier deficit plus >=3 unanswered scores, strictly audiovisual.
Combine by a capped mix rule, not arithmetic stacking. No score-altering rubber-banding or extra AI difficulty.

Extend existing binary `MusicSys.setIntensity` to accept a smoothed continuous intensity with short, musical transition windows. Match point should subtly modify existing pulse/narrowed mix, not restart music. On a 6–6 first-to-7 game, acknowledge next-goal-wins as a special state, not a tennis-style deuce mechanic. Respect independent volume buses and full mute.

**Theme room reactions:** use theme-defined response primitives, not huge per-room rewrites. Strong strike/goal can lightly flex lamp glow in Deco, tick neon in Neon, disturb a tiny reflection in Zellige, shift paper/light in Sashiko, etc. One or two well-authored cues per room are better than generic particles. Existing `G.roomPulse` is the starting hook; effects are cosmetic and bounded.

**Puck shadows:** modulate ellipse stretch/softness and slight trailing offset by velocity/contact using existing flat and projected puck render functions. Do not simulate actual puck height or obscure goal-line visibility. Render at capped quality for older mobiles.

**Camera impulse:** hard hits only, ~1–3 screen pixels and ~30–70 ms as a first Feel Lab range; goals can get a slightly stronger local impulse. Never displace pointer/hit-test/world physics coordinates or online control targets. Reuse Settings.shake and OS reduced-motion gates; default off when reduced motion is requested. Avoid constant vibration/jitter.

**Tests:** game physics identical across effect presets; no impairment of touch alignment or keyboard navigation; mute doesn't drift; graphics minimal and reduced-motion are genuinely calm.

## Phase 4: replay-specific treatment (#35–37)

- Slow motion belongs exclusively to the replay player. Live play has no physics slowdown. At exceptional rocket/bank impact, use replay timeline normal -> ~60% for the decisive contact/post -> normal into goal. Store semantic impact timestamps alongside local clips or derive deterministically from annotated captures; don't guess from playback position alone.
- Distinguish replay sonically with low-pass filtered/ducked ambience **on local replay-only buses** and a smooth unfilter when returning to live. Preserve master mute and both volume sliders. Do not resynthesize loud hit sound from every interpolated replay frame.
- Optional ~150ms replay freeze frame on genuinely exceptional plays, tiny shot-speed/trajectory graphic anchored out of the puck's path. Avoid freezing every goal or adding full-screen overlays.
- Existing local replay buffer is ~5 seconds at 30Hz; `Replay.record`/`capture` currently exclude online. Online replay requires a **separate measured design** that reconstructs authority-sourced samples or records local interpolated view with divergence warnings. Do not imply the existing online mode supports authoritative replay, and don't piggyback replay frames onto the competitive realtime lane.
- Honor replay skip, device memory and low-power profiles.

**Tests:** replay entry/exit audio restoration; true paused vs slow replay state; clip timestamp interpolation; muted replay; pause/restart/scene change during a clip; no live game slowing down.

## Phase 5: spectator emoji reactions (social, not chat)

Build on existing separate passive watcher room, 3-spectator cap and 20Hz spectator state stream.

**UX:**
- Small four- or five-choice palette: e.g. 👏, 🔥, 😮, 💫 (labels accessible, no typed chat).
- One-tap, keyboard-friendly, responsive, not covering mallets, puck, score or online control surfaces.
- Show reactions as short-lived, subtle bubbles **around the room boundary/spectator edge** rather than floating over puck trajectories. During active play keep them quiet; after a goal allow slightly more visibility. Respect effects=minimum and reduced motion. Spectator reaction UI should never display a chat text input.
- Players may have an option to hide spectator reactions, but spectators can continue using them.

**Protocol:**
- Create a small explicit `watchReaction` input action on the watcher room, separate from gameplay input. Fixed enum, no arbitrary text/HTML/URLs, bounded packet length.
- Start with per-watcher rate 1/3 seconds, 10/60 seconds, burst at most two before cooldown; tune in network lab. Validate on the current authority against current spectator membership; no authority/score/mallet side effects. Ignore stale match epochs/invalid types; no unbounded queues.
- Host can aggregate short counts for watchers and optionally share a tiny **noncritical** reaction digest with the two players. Do not occupy the high-priority gameplay realtime channel and do not add reliable gameplay-event head-of-line pressure. Drop or coalesce reactions under high buffering/jitter and never delay a state snapshot or goal.
- On authority migration, rebuild reaction fanout through current watcher-room owner, discard stale reactions and avoid duplicate join listeners. Don't require accounts or introduce open text chat/moderation burdens.

**Tests:** burst spam, late join, over-cap viewers, reconnect, authority migration, malicious payload, severe packet loss, emoji disabled locally. Record bytes/s and latency compared with reactions off. Real three-device verification is required before shipment.

## Phase 6: coordinated tuning and release

Run staged local rollout:
1. Phase 0 + perfect-strike prototype; adjust by playing actual touch/mouse/keyboard/gamepad controls.
2. Finish semantic events, rally curve and contextual local goals.
3. Confirm online state/context synchronization on a direct and forced-TURN path before enabling remote contextual feedback.
4. Add shorter celebrations and theme reactions; conduct visual QA across ten tables, top-down and perspective, desktop and mobile.
5. Add replay polish, then spectator emoji opt-in, each behind reversible feature flags during validation.
6. Measure whether changes improve perceived cleanliness, distinguishable strike quality and rematch flow; remove effects that fail, instead of shipping all possible effects.

**Release criteria:**
- The puck never stops in the guest's center because of new feel traffic; malformed reaction/context packets never affect state.
- No physics, AI, score or authoritative clock changes from disabled/enabled effects.
- Goal context labels agree across host/guest/watcher, including migration and resurrection where supported.
- Reactions do not measurably degrade 60Hz realtime performance, 30Hz fallback or already-known failure cases; spectators optional and disposable.
- Smooth, skippable goals; an input can never accidentally skip authoritative reconnect/pause or start next point twice.
- Reduced motion, flashes, haptics, zero-audio and low-effects paths are fully respected. Avoid large/repeated flashes; verify WCAG 2.3.1 flash thresholds.
- Mobile performance, audio-node cleanup, bounded particle allocation, and board positioning pass real-device review.
- CI, Network Lab and real-browser direct/relayed/reconnect paths pass before merging network changes. The user retains real-device testing ownership.

## Research references and design constraints

- [Designing Game Feel: A Survey](https://arxiv.org/abs/2011.09201): tuning/physicality, juicing/amplification, streamlining/support.
- [Wwise Adventure: Interactive Music](https://www.audiokinetic.com/download/documents/WwiseProjectAdventure_en.pdf): state/intensity-driven vertical/horizontal musical layers.
- [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API): gain, filters, sample-accurate parameter scheduling and compressors.
- [MDN Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API): progressive enhancement only; not uniformly supported.
- [Xbox Accessibility Guideline 117](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/117): disable or reduce camera motion and distracting visual effects.
- [W3C WCAG three flashes](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold): strict flash design/testing.
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion): OS preference support.
- [RFC 8831](https://www.rfc-editor.org/rfc/rfc8831.html): data-channel delivery and message-priority design.
- [MDN RTCDataChannel bufferedAmount](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount): no spectator reaction queue growth under backpressure.

## Explicit non-goals

No backend spectator fleet, user account system, open chat, gameplay rubber-banding, new WebAudio framework, major scene-engine replacement, global-on-all-touches camera shake, giant combo counter, or unverified online replay feature. No user-facing PERFECT badge during ordinary play.

## Developer handoff checklist

- Re-read current `main` and the Online V2 roadmap; this planning document is a snapshot, not proof that main remains unchanged.
- Reuse existing `AudioSys`, `MusicSys`, `Haptics`, `Highlights`, `Replay`, `Scoreboards`, `Net` watcher architecture.
- Start at Phase 0 and Phase 1. Work on small branches/PRs with a testable acceptance contract.
- Keep authoritative physics and network reliability priorities above cosmetic features.
- Add short checkpoint notes and update this roadmap as real implementations merge.
