# Online V2.5 Matchmaking, Spectators, and Resilience

Status: implementation roadmap, 2026-09-29.

## Research conclusions

The current direct-WebRTC + Cloudflare TURN architecture remains the right transport foundation. TURN solves difficult NAT/firewall connectivity, but it does not replace discovery, session continuity, spectator fan-out, or authority recovery.

Recommended additions:

1. Quick Match should reuse the existing Trystero/Nostr signaling layer instead of introducing a permanent matchmaking backend.
2. Spectators should use a separate room from the two-player gameplay room so watcher joins/leaves cannot disturb player peer selection.
3. The spectator publisher should be passive until a watcher appears. Trystero 0.25 supports passive rooms specifically for dormant backup/relay style peers.
4. Reload recovery should reuse the existing room code and reconnect protocol. Persist only a short-lived local resume checkpoint and expire it aggressively.
5. Authority migration requires separating player side from simulation authority. Do not implement an election while `role === host` still also means side 0, local input owner, scoring authority, snapshot sender, and restart owner.
6. Full rollback, spatial authority, ghost matches, and large spectator lobbies remain later experiments. They add complexity before the current authoritative model has exhausted its potential.

## Implementation order

### A. Discovery and identity

- Add a stable local random player id and compact local display label with no account server.
- Add recent-rival metadata stored locally.
- Add Quick Match using short-lived Trystero rendezvous rooms.
- Pair two clients, then immediately move them into an ordinary private Atelier room so gameplay still uses the proven one-rival architecture.
- Private host/join remains unchanged.

### B. Spectators

- Host authority opens a separate `watch` room.
- Limit watchers to a small fixed count.
- Spectators receive state/events only and can never send gameplay input.
- Use replaceable snapshots at a conservative cadence and dead reckon visually between them.
- Keep spectators out of the player room so they cannot affect its peer lock or reconnect lifecycle.

### C. Session resurrection

- Persist a short-lived checkpoint containing room code, player side/role, settings identity and enough authoritative/view state to offer recovery.
- Guest reload: automatically rejoin the same room and resync from host authority.
- Host reload: first restore the room and checkpoint; do not silently reset the score.
- Expire checkpoints quickly and clear them on deliberate leave.

### D. Authority migration

- Introduce separate `side` and `authority` concepts while preserving today's host/guest behavior.
- Add an authority epoch and deterministic tie-break.
- Only the current authority may emit snapshots, goals, score changes, serves, restarts, or authority epochs.
- A surviving peer promotes only after the old authority is conclusively gone, not during a normal ICE flap.
- A returning old host adopts the newer epoch instead of creating split brain.

## Guardrails

- Direct WebRTC remains preferred; Cloudflare TURN remains fallback.
- No permanent matchmaking/database server.
- Goals and scores remain authoritative.
- Existing reliable critical-event channel remains.
- Existing 60 Hz realtime lane and 30 Hz compatibility path remain.
- Quick Match and spectators must fail independently without breaking private matches.
- Spectators are intentionally capped rather than turning every phone into an SFU.
- No ranking/chat/moderation system is introduced with Quick Match.
