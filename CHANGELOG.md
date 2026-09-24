# Changelog

## 2026-09-24 — Neon table, separate sound/music, per-table music, portrait text fix, keyboard discoverability

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
  so every canvas-drawn glyph in portrait — scoreboard digits, labels,
  countdown, GOAL! banner, floating text — rendered mirror-reversed.
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

## v24.3 — 2026-09-24

**Music you can actually hear, a board toggle that means it, and pause on focus loss.**

### Music volume
- Music voice gains were ~10x too quiet against the SFX bed (pad 0.030,
  melody 0.020–0.034, drum 0.05). Raised every voice ~3x across all nine
  tables — pad 0.090, bass 0.225, melody 0.060/0.102, pulse 0.090,
  drum 0.15, shimmer 0.048, goal swell 0.135 — with the master/SFX chain
  untouched, so SFX keeps its headroom.
- New **Music volume** slider in Settings (0–100, default 70). Persisted in
  `atelier-ah-settings` as `musicVolume`, clamped and validated on load.
- The slider drives a perceptual curve with unity at the 70 default
  (`(v/70)^1.5`, 0 = silent, 100 ≈ +4.6 dB) applied as a multiplier on the
  live music bus — table levels, the goal duck, and match-point intensity
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
- Mid-match, focus loss takes the regular pause path — the pause card comes
  up and the online rival is paused too, so a guest's tab switch can't drift
  a host's sim. Anywhere else, a lightweight tap-to-resume veil covers the
  screen without disturbing the state underneath.
- Resume is **always** a user gesture (tap the veil, the pause card's
  Resume, or Escape) — never automatic — so the browser autoplay policy
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

## v24.2 — 2026-09-24
- Per-table music levels, AI countdown/defense changes, board orientation
  setting, puck squash/stretch.
