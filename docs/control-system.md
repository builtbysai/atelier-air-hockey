# Control system

## Design goals

Atelier treats every control method as a way to produce the same mallet target. Physics, the 4200-unit mallet cap, collisions, scoring, and the online target protocol stay unchanged. That keeps inputs fair across local and online play and prevents camera modes from becoming different games.

## Defaults

| Platform | Default | Why |
| --- | --- | --- |
| Mouse / trackpad | Direct hover | Closest desktop equivalent to physically moving an air-hockey striker. No click is required. |
| Touch | Direct drag | Highest positional and flick fidelity. Existing finger offset keeps the mallet visible. |
| Keyboard | Balanced ramp | Quick taps give small defensive corrections; held input ramps into attack speed. |
| Gamepad | Balanced analog | Left stick uses a radial dead zone and continuous magnitude. |
| Touch alternate | Floating stick | Dynamic-follow relative control with precision near center, full-speed attack at the edge, and optional triangle recovery on release. |

Controls are configured from **Preferences → Controls**. Mouse and trackpad remain direct because OS pointer sensitivity already supplies the appropriate device-level adjustment.

## 2D and 2.5D

Absolute inputs (mouse and direct touch) convert screen positions through `screenToRink()`.

Relative inputs (keyboard, gamepad, floating stick) start as screen-space directions and pass through `screenVectorToRink()`. Top-down portrait rotation, online mirroring, Elevated, and Surface cameras therefore share one direction mapping. The player's screen-right stays right and screen-up stays away from them regardless of presentation.

2.5D relative input projects the mallet to the screen, applies a small screen-space vector, then unprojects that point back to the table plane. This avoids hand-tuned camera-specific axis rules.

## Input behavior

### Touch direct
- Pointer capture keeps a drag alive when the finger moves outside the canvas element.
- A screen-space finger offset keeps the mallet visible.
- The offset fades near playable boundaries so retreating from a rail never feels stuck.
- Same-screen two-player assigns each active touch to one side.

### Floating touch stick
- The input origin is the exact touch-down point. It is never clamped inward near a screen edge.
- The radius adapts to screen size and the stick uses a small scaled radial dead zone with a precision-first response curve.
- At full throw, the base follows thumb drift. This keeps neutral and reversal a short movement away instead of letting the finger run far beyond the stick.
- Full throw has enough target speed to create a real attacking flick; small deflections remain proportionally slower for defense.
- The vector is still screen-relative and flows through the shared 2D/2.5D mapping.
- The outer ring highlights at full throw so maximum input is visible even without physical stick resistance.

### Floating-stick release assist
**Preferences → Controls → Release assist** offers `Triangle` (default) or `Off`.

Triangle assist is deliberately limited:
- On release, it snapshots one recovery target based on the current puck lane and the goal-centre-to-puck geometry used by floating-triangle air-hockey defense.
- The target sits forward of the goal and floats slightly higher when the puck is farther away.
- Recovery waits briefly, then moves at a controlled speed for at most about 1.25 seconds.
- Any new touch, keyboard, or gamepad input cancels it immediately.
- If the puck blocks the recovery path, the mallet holds rather than automatically pushing through the puck.
- The recovery point does **not** continuously track the puck, predict shots, or choose bank-defense corners. It is control assistance, not an auto-goalie.

### Mouse / trackpad
- Moving over the game canvas directly targets the mallet without holding a button.
- Clicking and dragging still works.
- Moving onto UI stops hover steering so pause/settings controls cannot move the mallet underneath an overlay.

### Keyboard
- WASD controls player one / the local online player.
- Arrow keys control player two in same-screen two-player.
- Digital input ramps from precision speed to attack speed over about 150 ms.
- Diagonals are normalized, so diagonal movement is not faster.

### Gamepad
- First connected pad controls player one; second controls player two in same-screen play.
- Left stick uses a radial dead zone and response curve instead of independent per-axis clipping.
- Menu/Start pauses or resumes a match.
- Primary/A activates the main menu action.

## Feel profiles

Keyboard and gamepad each expose **Precise**, **Balanced**, and **Fast** target-travel profiles. These only change how quickly the input advances the target. They never bypass `driveMallet()`, `PLAYER_CAP`, side boundaries, or online authority.

## Online behavior

The network wire format is unchanged. Non-authority players still send only `tx, ty`; the authority drives the remote mallet through the same `driveMallet(..., PLAYER_CAP)` path. Control preferences are local and do not need negotiation.

## Interruption safety

Blur, tab/background transitions, pointer cancellation, and focus loss clear held keys, active pointers, floating sticks, hover ownership, and transient input timestamps before the existing focus-loss pause takes over.

## QA checklist

- Direct mouse follows without a held button in Top-down, Elevated, and Surface.
- Portrait and online-flipped relative controls remain screen-relative.
- Touch direct can reach rails and center boundary without sticky offset behavior.
- Floating stick begins exactly under the thumb, including touches near screen edges.
- Long thumb drags pull the floating base along instead of increasing the neutral-return distance.
- Full throw reaches attack speed; small throw remains precise; reversing direction does not require crossing an oversized stale origin.
- Triangle release assist recovers briefly, cancels on manual input, and refuses to push through a blocking puck.
- Release assist Off leaves the mallet at the released position.
- Keyboard tap is precise; hold ramps faster; diagonals are not faster than cardinals.
- Gamepad center is stable; diagonal magnitude is circular; Menu/Start pauses.
- Same-screen two-player keeps independent touch / keyboard / gamepad ownership.
- Guest online input remains local-feeling while authority, scoring, and physics stay host/authority-owned.
