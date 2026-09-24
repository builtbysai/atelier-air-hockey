# Changelog

## Unreleased: composed music, room QR invites, HUD master mute, netcode feel (feat/audio-qr-music-240924)

### Music: composed, not random
- Every table's room is now composed material: an ordered chord progression
  with smooth common-tone voicings (plus a bridge turnaround every 4th cycle),
  a question/answer motif developed across an 8-phrase cycle (establish,
  repeat, diatonic sequence, fragmentation, inversion, echo), Euclidean bass
  lines tied to the current chord root, Euclidean kick/snare/hat layers with
  velocity accents, restrained swing and ghost notes where the room wants them,
  and a 4-section arrangement arc (enter, settle, full, break). Match point
  still forces the full section.
- The scheduler runs on proper Bjorklund onsets (tresillo, cinquillo,
  four-on-the-floor, backbeat) instead of hand-rolled grids.
- Online: the host deals a music session seed in the hello handshake and both
  peers reseed the same generative sequence; the countdown re-anchors both
  phrase clocks. Same notes in the same order on both machines (sample-phase
  alignment is not claimed: separate clocks, separate AudioContexts).

### Online: scannable room QR
- The host lobby now shows a QR code of the full join URL next to the
  6-character code, so a second device joins with zero typing. The encoder is
  vendored locally (qrcode-generator 1.4.4, MIT), so the QR draws with no
  network. The rendered code is decode-verified in tests.

### HUD: master mute
- The speaker icon and the M key now mute all audio at once without changing
  the Sound or Music settings underneath; unmuting restores each bus to its
  own setting. The state persists across sessions.

### Online feel: prediction, knock retries, quieter input
- Guest puck rendering now predicts from the freshest snapshot (position +
  velocity times bounded age) and eases toward the prediction with a
  time-based exponential coefficient, instead of lerping 50% toward stale
  data every frame. Same feel at any frame rate.
- Join knocks retry briefly (a few tries at 1.5s) since the first knock can
  race peer discovery; the 20s join timer still owns the final verdict.
- Guest input sends are delta-suppressed (a stationary mallet sends nothing)
  with a 500ms heartbeat so a dropped packet never sticks the host's mallet.
- `?room=CODE` is now an alias for `?join=CODE` in shared links.

## 2026-09-24: Neon table, separate sound/music, per-table music, portrait text fix, keyboard discoverability

### New: Neon Midnight table
- Tenth themed table: near-black glass/felt, cyan + magenta + yellow tube lighting,
  subtle grid and starfield, neon rails and goal trim, glowing puck and trail,
  matching paddles, dedicated physical neon scoreboard, room ambience config, and
  synthwave music config. Registered through `THEME_ORDER`, the carousel, the
  Table Tour (now "all ten tables conquered"), and the menu tagline
  ("Ten rooms. One puck. Neon after dark.").

### Audio: sound and music are now independent
- `AudioSys` was split from one shared master gain into two buses: `sfxBus`
  (driven by the Sound setting) and `musicBus` (driven by the Music setting).
  Music keeps playing with Sound off; muting Music no longer kills sound effects.
  Room ambience stays on the SFX bus.

### Audio: each table has its own music room
- `setTable()` now crossfades between per-table generative music rooms (ten rooms,
  one per table) instead of one shared loop. The nine existing rooms were
  differentiated further with varied bass waveforms; the neon room is a
  118 BPM minor-mode synthwave track (saw bass/melody, pulse + drums).
  Old pad voices are killed at the crossfade low point so tails don't smear the
  new room's identity, and ended gains are pruned from the voice list.

### Fixed: mirrored text in portrait orientation
- Root cause: the portrait view matrix was a reflection (negative determinant),
  so every canvas-drawn glyph in portrait (scoreboard digits, labels,
  countdown, GOAL! banner, floating text) rendered mirror-reversed.
- The matrix is now a true 90° rotation (positive determinant); `screenToRink()`,
  the portrait keyboard/gamepad mapping, and the orientation regression test
  were updated to match. Portrait text now rotates with the table like a
  physical scoreboard turned on its side instead of mirroring.

### Keyboard controls: now discoverable
- The controls existed (WASD / arrows / gamepads, P pause, M sound, Esc, Enter)
  but were barely documented. Help now leads with mouse, finger, WASD, arrows,
  and gamepads; the menu footer lists the keys; Two Players help still explains
  WASD + arrows, two touches, mouse/touch, and two gamepads.
- Verified by simulation: AI (WASD → local mallet), 2P (WASD → P1, arrows → P2,
  simultaneous with pointer on the other side), online host (WASD → left mallet),
  online guest (WASD → right mallet), portrait (W → toward the far goal),
  P pause/resume, M sound toggle.
## Unreleased: online netcode repair (feat/online-netcode-240924)

**The remote mallet actually moves now, and the netcode survives real networks.**

Hans's report: online was "barely playable" (a `-ms` chip, ~149ms ping,
"rival left" on every flap, lag with no sync). Root causes found and fixed:

### The game-breaking one: host ignored the guest's mallet
- `Net.onInput()` stored the guest's target in `Net.remote`, but nothing
  ever read it. The authoritative host's `G.m2` never moved, so the guest
  could never touch the puck. The host now folds every guest input target
  into `G.m2` via `Net.driveRemoteMallet()` on every physics substep and
  during the countdown, with the same speed cap and side clamping as a
  local mallet (targets are clamped to the guest half on receipt, so a
  hostile or buggy peer can't drag their mallet across the center line).
- Verified by a 150ms-RTT loopback simulation: the guest tracks the puck
  with bounded error and no teleports.

### Ping chip: honest numbers only
- The `-ms` was a raw `-1` sentinel rendered as text. The chip now shows
  `–ms` while unknown, smooths samples with an EWMA (one slow pong can't
  swing the display), namespaces probe ids per side per match (the two
  sides' probes can never be mistaken for each other), keeps its own send
  timestamps, ignores stray pongs, and falls back to `–ms` when samples go
  stale (>10s) instead of showing a fossilized number. Each side still
  measures and paints only its own round trip.

### Disconnects: grace instead of instant "rival left"
- A mid-match peer loss now freezes the table and shows "reconnecting"
  for a 15-second grace window (mobile ICE restarts routinely exceed the
  old 5s) instead of declaring the rival gone at the first flap. A clean
  `leave` still ends the match immediately.
- Rejoin inside the window resumes seamlessly; a manual pause from before
  the drop is kept and the rejoin never sends a `resume` that would clobber
  the rival's own pause. Snapshots resume at 30Hz (up from 25Hz) so the
  guest reconverges faster.
- A peer that rejoins after the match was declared dead re-knocks and the
  host starts a genuinely fresh match (new hello/settings, countdown,
  serve roll, fresh RTT chip) instead of a silent dead table.
- A knocker bailing before the match starts no longer kills the waiting
  room. The host keeps waiting.

### Guest state reconciliation
- Snapshot flags are now the backstop for lost event-channel messages:
  a missed goal is recovered from the score increment, a missed countdown
  adopts the serve vector/direction from new snapshot slots, a missed pause
  or resume is applied from the pause flag, and missed full time adopts the
  final scores. The two sides reconverge instead of drifting apart forever.
- The guest holds the frozen frame while paused. Dead reckoning no longer
  extrapolates the puck behind the pause card.

### Hardening
- Every `Net.send*` is now a safe no-op with no wire or no live match
  (previously several would throw on `Net.wire.sendEv`).

### Tests
- New `tests/net-online.test.mjs`: 16 tests, including a delayed loopback
  transport (75ms each way ≈ Hans's 150ms) proving RTT convergence,
  bounded guest tracking error with no teleports, input clamping, missed
  event recovery, the reconnect grace window, manual-pause preservation,
  and send-path safety. Full suite: 69/69 pass.

### Still needs Hans's real-device test
- Two real devices over the Internet, feel at 100–200ms RTT, reconnect
  through a real mobile/Wi-Fi transition, and both sides' focus loss.

## v24.3, 2026-09-24

**Music you can actually hear, a board toggle that means it, and pause on focus loss.**

### Music volume
- Music voice gains were ~10x too quiet against the SFX bed (pad 0.030,
  melody 0.020–0.034, drum 0.05). Raised every voice ~3x across all nine
  tables. Pad 0.090, bass 0.225, melody 0.060/0.102, pulse 0.090,
  drum 0.15, shimmer 0.048, goal swell 0.135, with the master/SFX chain
  untouched, so SFX keeps its headroom.
- New **Music volume** slider in Settings (0–100, default 70). Persisted in
  `atelier-ah-settings` as `musicVolume`, clamped and validated on load.
- The slider drives a perceptual curve with unity at the 70 default
  (`(v/70)^1.5`, 0 = silent, 100 ≈ +4.6 dB) applied as a multiplier on the
  live music bus (table levels, the goal duck, and match-point intensity)
  all compose with it. Changes take effect immediately, no restart.

### Board orientation
- The Board setting is now authoritative on **every** screen: Portrait
  forces the rotated presentation anywhere, Landscape keeps the rink
  unrotated anywhere. Previously a tall phone screen overrode Landscape
  and forced rotation regardless of the setting. Input mapping, keyboard,
  and gamepad paths already branch on the same flag, so nothing else moves.

### Pause on focus loss
- `visibilitychange → hidden` and `window blur` now freeze everything: the
  sim, the attract demo, particles, and the online net pump all hold, and
  the AudioContext suspends (music, SFX, ambience stop at once).
- Mid-match, focus loss takes the regular pause path. The pause card comes
  up and the online rival is paused too, so a guest's tab switch can't drift
  a host's sim. Anywhere else, a lightweight tap-to-resume veil covers the
  screen without disturbing the state underneath.
- Resume is **always** a user gesture (tap the veil, the pause card's
  Resume, or Escape). Never automatic, so the browser autoplay policy
  can't leave audio silently dead. `lastT` keeps updating while frozen, so
  resume can't time-jump.
- A rival's resume arriving over the wire while the local tab is still away
  resumes the shared match but keeps the local veil up until the user taps.

### Tests
- 53 unit tests green, including new coverage: volume default/validation/
  persistence, the perceptual gain curve, live bus re-aiming, raised voice
  peaks per table, orientation authority on five screen shapes (desktop,
  phone portrait/landscape, tablet, square), and the focus-pause state
  machine (hidden/blur freeze, no auto-resume, gesture resume, audio
  suspend, sim hold, silent-remote-resume veil).

### Not verified
- Real-device listening (music balance on phone speakers).
- Real two-device online focus-loss behavior.

## v24.2, 2026-09-24
- Per-table music levels, AI countdown/defense changes, board orientation
  setting, puck squash/stretch.
