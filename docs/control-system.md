# Control system

## Design goals

Atelier treats every control method as a way to produce the same mallet target. Physics, the 4200-unit mallet cap, collisions, scoring, and the online target protocol stay unchanged. That keeps inputs fair across local and online play and prevents camera modes from becoming different games.

## Defaults

| Platform | Default | Why |
| --- | --- | --- |
| Mouse / trackpad | Direct hover | Closest desktop equivalent to physically moving an air-hockey striker. No click is required. |
| Touch | Direct drag + Medium offset | Fast, precise direct manipulation with the mallet kept visibly ahead of the finger. |
| Keyboard | Balanced ramp | Quick taps give small defensive corrections; held input ramps into attack speed. |
| Gamepad | Balanced analog | Left stick uses a radial dead zone and continuous magnitude. |

Controls are configured from **Preferences → Controls**. Mouse and trackpad remain direct because OS pointer sensitivity already supplies the appropriate device-level adjustment.

## 2D and 2.5D

Absolute inputs (mouse and direct touch) convert screen positions through `screenToRink()`.

Relative inputs (keyboard and gamepad) start as screen-space directions and pass through `screenVectorToRink()`. Top-down portrait rotation, online mirroring, Elevated, and Surface cameras therefore share one direction mapping. The player's screen-right stays right and screen-up stays away from them regardless of presentation.

2.5D relative input projects the mallet to the screen, applies a small screen-space vector, then unprojects that point back to the table plane. This avoids hand-tuned camera-specific axis rules.

## Input behavior

### Touch direct
Touch is intentionally a single direct-manipulation model. The retired relative-stick mode introduced target drift: the player's thumb controlled velocity relative to a separate origin while air hockey demands an immediate spatial relationship between hand and striker.

- Pointer capture keeps a drag alive when the finger moves outside the canvas element.
- The finger maps directly to the mallet target with a forward screen-space offset.
- The offset points toward the opponent, so the hand trails the striker instead of covering the striker/puck contact point.
- The offset is applied in screen space before unprojection, so Top-down, Portrait, Elevated, Surface, and online-mirrored views preserve the same visual relationship.
- Near playable boundaries the offset fades continuously. Pulling away from a rail or center line therefore always pulls the mallet away too.
- Same-screen two-player assigns each active touch to one side.

### Touch offset
**Preferences → Controls → Touch offset** exposes `Low`, `Medium`, and `High`.

The offset combines two constraints:
1. a CSS-pixel thumb-clearance floor, because finger occlusion is a screen-space problem;
2. a multiplier of the mallet's apparent screen radius, so the separation still looks proportional as table scale/camera depth changes.

Current profiles:
- **Low**: closer/direct feel, about a 50 px minimum.
- **Medium**: default, about a 72 px minimum.
- **High**: maximum visibility, about a 94 px minimum.

The values scale modestly with viewport size and cap at 126 CSS px. Changing the offset never changes mallet physics, max speed, collisions, puck transfer, or online authority.
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

Blur, tab/background transitions, pointer cancellation, and focus loss clear held keys, active pointers, hover ownership, and transient input timestamps before the existing focus-loss pause takes over.

## QA checklist

- Direct mouse follows without a held button in Top-down, Elevated, and Surface.
- Portrait and online-flipped relative controls remain screen-relative.
- Touch Low / Medium / High all keep the mallet ahead of the finger.
- Medium provides visibly more puck-contact clearance than the previous one-diameter offset.
- Touch can reach rails and the center boundary without a sticky offset dead zone.
- Reversing direction moves the mallet immediately; there is no separate virtual origin to cross.
- Same-screen two-player offsets each player toward their own opponent-facing direction.
- Elevated and Surface touch offsets remain visually ahead of the finger through projection/unprojection.
- Keyboard tap is precise; hold ramps faster; diagonals are not faster than cardinals.
- Gamepad center is stable; diagonal magnitude is circular; Menu/Start pauses.
- Guest online input remains local-feeling while authority, scoring, and physics stay host/authority-owned.
