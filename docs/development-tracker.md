# Atelier Air Hockey — Development Tracker

Updated: 2026-09-28

This tracker covers the post-v1 stabilization and gameplay-quality pass requested after real-device playtesting and replay review.

## Current status

| Priority | Work | Status |
| --- | --- | --- |
| P0 | Free Hit target wall; mallet contact wrap; AI emergency defense; foreground canvas recovery; Exhibition persistence | Shipped on `main` (#60–#64) |
| P1 | Three-stage Workshop; adaptive GIF export; speed-scaled impact light | Shipped on `main` (#66–#68) |
| P2 | Rival tactics; goal ceremony | Shipped on `main` (#70–#71) |
| P2 | Rally definition, progress feedback, and Workshop reset | In PR #73; awaiting final review and merge |

The supplied GIFs show the old 190–199 × 420 export path. The current exporter uses a 640 px long side, a palette built from the clip, and no dark full-frame wash. The mallet and AI fixes are separate physics/decision changes, so export fidelity does not mask either gameplay defect.

## Working rules

- Work in small slices: branch → PR → CI → Visual QA → Rival Lab when gameplay-related → merge.
- Fix correctness before adding spectacle.
- Do not hide physics/AI defects with scripted outcomes.
- Every gameplay fix needs a deterministic regression test or Rival Lab metric where practical.
- Every visual change must preserve reduced-motion behavior and compact-phone no-scroll QA.
- Exhibition is observational only: it may show per-match information, but must never persist records, mastery, challenges, achievements, Tour progress, or Workshop progress.

## Priority

### P0 — broken behavior / data correctness

#### P0.1 Free Hit: replace the empty opponent goal with a continuous practice target
**Observed:** Free Hit removes the rival, but the opponent goal remains live. Shots repeatedly score and reset the drill.

**Source cause:** the Free Hit branch parks `m2`, while normal goal detection remains active. `Practice.onGoal()` has no Free Hit behavior, so it falls through to `resetPoint()`.

**Plan**
- Keep the player's own goal live.
- Treat the far goal mouth as a closed practice end / target zone.
- A clean target hit gives concise feedback and rebounds the puck back into play instead of scoring/resetting.
- An own goal still resets the puck so defending yourself matters.
- Remove/hide the far goal-mouth presentation where appropriate so the visual rule matches the physics.

**Acceptance**
- Free Hit can run indefinitely without automatic scoring loops.
- Far target hits do not change score or restart countdown.
- Own goals still reset.
- Top, Elevated, and Surface cameras all communicate the target correctly.

#### P0.2 Mallet contact wrap → own goal
**Observed in GIF #1:** during sustained close contact near the player's end, the puck migrates around the mallet and emerges goal-side, creating an own goal.

**Likely cause:** radial overlap resolution follows the instantaneous center-to-center normal but does not preserve the contact hemisphere. The 1.2s possession/glue window lets a puck remain continuously attached long enough to roll around the mallet without a genuine separation.

**Plan**
- Track the goal-axis hemisphere where each continuous mallet contact begins.
- If a puck that began safely on the table-facing side wraps through the mallet to the goal-facing side without separation, release/redirect it back toward open ice rather than allowing a geometric pass-through.
- Preserve legitimate incoming saves where contact genuinely begins goal-side.
- Add a deterministic contact-wrap regression fixture.

**Acceptance**
- No continuous-contact front→back wrap through a mallet.
- Legitimate saves still work.
- No increase in Rival Lab own-goal/shank metrics.

#### P0.3 AI must interrupt recovery for a live goal threat
**Observed in GIF #2:** the defender backs away/repositions while the puck remains dangerous, opening the goal.

**Source cause:** `recover` always calls `goHome()`. A new inbound threat cannot preempt recovery until the state times out; rebound re-engagement is probabilistic and aimed at loose possession, not emergency defense.

**Plan**
- Threat detection must preempt `recover` immediately into `defend`.
- Emergency defense outranks personality/rebound/recovery behavior.
- Add a Rival Lab scenario for rebound → renewed inbound threat during recovery.

**Acceptance**
- AI never continues retreat/recovery while a live puck is goal-bound on its half.
- Rival personalities still differ once the emergency passes.

#### P0.4 Background/resume black canvas
**Observed:** after pausing/backgrounding and returning, the playfield can be black.

**Likely cause:** the game intentionally stops canvas rendering while focus is lost, but currently has no backing-store/context restoration handler and no explicit repaint on foreground return.

**Plan**
- Add `contextlost` / `contextrestored` recovery where supported.
- On foreground return, re-fit the canvas and force a safe redraw before interaction resumes.
- Keep the simulation paused until the user resumes.
- Add browser QA for background-style repaint lifecycle where practical.

**Acceptance**
- Returning from background always shows the paused game state, not black.
- No simulation time jump.
- Audio still requires a user gesture to resume.

#### P0.5 Exhibition persistence isolation
**Current code review:** records, Tour/mastery/challenges, and personal-best writes are already excluded from `watch` inside `showWin()`, but this must be a contract, not an accidental collection of conditions.

**Plan**
- Add an explicit eligibility helper/regression tests so Exhibition can never enter persistent progression/stat writes.
- Keep per-match scoreboard/stat display allowed.

**Acceptance**
- Exhibition cannot change records, bests, achievements, mastery, challenges, Tour, or Workshop state.

---

### P1 — training, export fidelity, and feedback quality

#### P1.1 Workshop progression: three-stage drills
The one-and-done drills are too easy and do not create a mastery curve.

**Design**
- Each core drill gets three increasingly demanding stages.
- Clearing Stage 1 preserves today's progression/unlock value.
- The same session advances immediately into Stage 2, then Stage 3.
- Existing saves migrate safely: old cleared drills count as Stage 1, never lose progress.
- Free Hit remains an open sandbox, not a graded drill.

**Initial targets to validate**
- Power: 20 → 22 → 24 km/h.
- Control: 10 → 15 → 20 hit rally.
- Keeper: 3 → 5 → 7 consecutive saves.

Difficulty should rise in planned steps instead of staying flat; progression research supports sequencing increasingly demanding combinations of learned skills rather than repeating the same base task.

**Acceptance**
- A new player gets a quick first success.
- Better players have meaningful Stage 2/3 goals.
- Clear feedback shows current stage, progress, PB, and next target.
- Stage 1 still unlocks the same progression route as today.

#### P1.2 GIF export fidelity
**Observed:** supplied exports are about 190–199 × 420 and visibly harsher/darker than live play.

**Source cause**
- Export clamps the long side to 420 px.
- RGB332 reduces every frame to a fixed 256-color palette before encoding.
- 10 fps and the replay overlay further emphasize stepping.

**Plan**
- Raise portrait export to a practical social/share size while keeping mobile memory bounded.
- Replace raw RGB332 with a better palette strategy (global/adaptive palette or perceptual quantization), with optional dithering only if it improves the art style.
- Preserve the exact replay camera composition and theme values.
- Keep asynchronous yielding so export does not freeze the result screen.
- Add objective QA: dimensions, decode, frame count, and representative screenshot comparison.

**Acceptance**
- Export looks recognizably like the live game at normal phone viewing size.
- No muddy blacks/banding on dark tables.
- Mobile export remains responsive and bounded.

#### P1.3 Impact light intensity should encode impact, not blind the player
**Current:** every SMASH gets `G.hitFlash = 0.8`, a 260-unit white bloom, and full room pulse.

**Plan**
- Normalize impact energy above the SMASH threshold.
- Use a soft nonlinear curve so near-threshold hits are subtle and exceptional hits are brighter without clipping.
- Scale radius, alpha, duration, particles, room pulse, and haptic strength as separate channels.
- Subtle mode gets a lower ceiling; reduced motion keeps flash suppression.
- Keep flashing comfortably below WCAG flash-frequency limits and avoid large repeated high-luminance pulses.

**Acceptance**
- A 1450-impact hit is clearly less bright than a 2200+ hit.
- Full mode still feels powerful.
- Subtle mode never produces a screen-dominating white bloom.
- Repeated rallies do not create rapid bright flashing.

---

### P2 — game feel / depth

#### P2.1 Rival strategy expansion from real air-hockey tactics
Research-backed behaviors to model:
- **Floating triangle defense:** re-center relative to puck position; come forward for straight/angle coverage, pull deeper for bank threats.
- **Cut/cross families:** similar-looking release with opposite target lanes.
- **Single-wall under/over banks:** choose based on defender depth.
- **Drifts:** controlled setup movement before a shot to change timing and freeze the keeper.
- **Recovery discipline:** return to the defensive triangle after offense unless personality intentionally pressures a rebound.

Personality mapping:
- Rookie: simple triangle, obvious straight/cut mix, slower re-center, few banks.
- Club Pro: floating triangle, cut/cross variation, deliberate banks, occasional drift setup.
- Champion: strong floating triangle, deceptive same-release families, drift + keeper read, rebound pressure, disciplined emergency recovery.

**Acceptance**
- Personalities differ by decisions, not only speed/error.
- Rival Lab tracks shot family, defensive depth, re-centering, and emergency-defense success.

#### P2.2 Goal ceremony / reward pass
The current goal moment is readable but not sufficiently rewarding.

**Plan**
- Keep the celebration short enough not to interrupt flow.
- Create a hierarchy: normal goal < lead change/tie < streak < match point < winning goal.
- Reward with information-carrying layers: scorer callout, score change, brief theme-native burst, sound/haptic accent, and earned context.
- Avoid slot-machine/variable-reward patterns; payoff should correspond to what the player actually did.
- Preserve reduced-motion and subtle-effects alternatives.

**Acceptance**
- Goals feel materially more satisfying without delaying rematch flow.
- Winning goals are unmistakably stronger than routine goals.
- No excessive flashing.

#### P2.3 Rally counter clarity + juice
**Current:** only multiples of five briefly show `N HIT RALLY`, while Workshop Control uses every mallet contact as progress. The two concepts are easy to confuse.

**Plan**
- Use one clear definition everywhere: a rally is successive valid mallet returns since serve/goal.
- Surface milestones without making the HUD persistent/noisy.
- Use small escalating feedback at meaningful milestones (5, 10, 15, 20), with stronger treatment only for a new PB or Workshop target.
- Ensure accidental repeated contact during one smother episode counts once.

**Acceptance**
- Players can infer exactly why the number changed.
- Workshop and match rally counts agree.
- Long rallies feel tense/rewarding without covering play.

---

## Research notes

### Air-hockey tactics
- Gold Standard Air Hockey: under-bank deception and same-release shot families.
- Billy Stubbs / Say AH: floating-triangle defense, re-centering, cut/cross + bank combinations.
- Bubble & Air Hockey: triangle defense and under/over bank selection based on keeper depth.
- A [published air-hockey robot strategy](https://publications.lib.chalmers.se/records/fulltext/240634/240634.pdf) prioritizes goal defense against fast inbound pucks and active interception when the puck slows. [EA Air Hockey's designer](https://blog.stevewetherill.com/posts/2022-01-11-ea-air-hockey-designing-a-one-button-mobile-game/) describes transitioning between offensive and defensive mallet positions. These support the emergency-defense override and the rivals' changing defensive depth.

### Progression
- Microsoft Research, CHI 2015: effective progressions practice base concepts and combinations with increasing mastery demands.
- Gameplay progression literature consistently warns against flat difficulty and abrupt spikes; staged escalation should be playtested, not assumed.
- The [CHI 2015 progression study](https://www.microsoft.com/en-us/research/?p=334439) supports practice that grows in complexity; the Workshop's 20/22/24, 10/15/20, and 3/5/7 targets are design starting points, not empirically validated difficulty settings for this game.

### Visual feedback / flashing
- W3C WCAG 2.2 2.3.1: avoid more than three flashes in one second or stay below luminance/area thresholds.
- Impact feedback should communicate hit strength and importance; spectacle is not useful if every hit reads as maximum.
- The [W3C flash criterion](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold) informs the capped, local impact glint. [MDN's GIF format guide](https://developer.mozilla.org/en-US/docs/Glossary/GIF) explains the 256-color limit behind the adaptive palette. [MDN's canvas recovery guidance](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/isContextLost) documents repainting after context restoration.

## Execution order

1. P0.1 Free Hit target-wall loop.
2. P0.2 mallet wrap own-goal fix.
3. P0.3 AI recovery emergency-defense fix.
4. P0.4 background/canvas recovery.
5. P0.5 Exhibition persistence contract.
6. P1.1 Workshop staged progression.
7. P1.2 GIF fidelity.
8. P1.3 impact intensity curve.
9. P2.1 rival strategy expansion.
10. P2.2 goal ceremony reward pass.
11. P2.3 rally counter pass.
