# Atelier Air Hockey

A handcrafted browser air-hockey game with nine art-directed tables, local AI rivals, same-screen two-player play, and peer-to-peer online matches.

**Play:** https://builtbysai.com/atelier-air-hockey/

## Development

`src/` is the source of truth. The runtime is split into `themes.js`, `scoreboards.js`, `net.js`, `game.js`, and `ui.js`, with `styles.css` and `template.html` as the page shell. Root `index.html` is generated from `src/template.html` for GitHub Pages.

```bash
npm run build
npm test
```

CI checks source/build consistency, core stabilization invariants, and JavaScript syntax. Historical release snapshots live in Git history; current releases should use Git tags/releases instead of copied HTML builds.

## Controls

- Mouse/touch: direct mallet control.
- Keyboard: WASD for player one; arrow keys for player two.
- Gamepads: pad one controls player one; pad two controls player two.
- P: pause/resume. M: mute/unmute. Esc: close the current dialog or pause/resume.

## Online play

Online matches use Trystero 0.25/WebRTC with Nostr signaling. The host is authoritative for physics and match settings. Rooms use a six-character invite/deep link, bind one rival, target all game traffic to that rival, validate inbound state, and provide a short reconnect grace period for transient drops. No account is required.

## Privacy and local data

Offline play makes no game-network request. Online play loads Trystero and uses WebRTC, Nostr signaling relays, and TURN when needed to establish the peer-to-peer session. Settings, records, personal bests, achievements, and table-tour progress stay in this browser via `localStorage` and can be reset from Progress.

## License

See [LICENSE](./LICENSE).
