# Atelier Air Hockey

A handcrafted browser air-hockey game with nine art-directed tables, local AI rivals, same-screen two-player play, and peer-to-peer online matches.

**Play:** https://builtbysai.com/atelier-air-hockey/

## Development

`src/` is the source of truth. `src/template.html` is the page shell, with `styles.css`, `themes.js`, `scoreboards.js`, and `app.js` loaded as classic browser sources in dependency order. The root `index.html` is generated from `src/template.html` for GitHub Pages.

```bash
npm run build
npm test
```

CI fails when the generated root file drifts from the source template or when core stabilization invariants regress. Historical v4-v7 HTML snapshots remain in Git history; current releases should use Git tags/releases rather than duplicated production files.

## Controls

- Mouse/touch: direct mallet control.
- Keyboard: WASD for player one; arrow keys for player two.
- Gamepads: first pad controls player one; a second pad controls player two when available.
- P: pause/resume. M: mute/unmute. Esc: pause/resume.

## Online play

Online matches use Trystero/WebRTC with Nostr signaling. The host is authoritative for physics and match settings. Rooms use a six-character invite code/deep link, accept one bound rival, validate inbound input, and ignore messages from extra peers. No account is required.

## Local data

Settings, records, personal bests, achievements, and table-tour progress are stored only in this browser via `localStorage`. They can be reset from the Progress screen.

## License

See [LICENSE](./LICENSE).
