# Vendored dependencies

- `qrcode.js` - QR code generator used by the share dialog.
- `trystero-nostr-0.25.4.mjs` - Trystero 0.25.4 (MIT), Nostr strategy, bundled
  unmodified from the npm packages `trystero@0.25.4`, `@trystero-p2p/nostr@0.25.4`,
  `@trystero-p2p/core@0.25.4`, `@noble/secp256k1`. Rebuild:
  `esbuild node_modules/trystero/dist/index.mjs --bundle --format=esm --target=es2020 --minify --legal-comments=inline`.
  Loaded lazily by `Net.trystero()` in `src/net.js` (only when Online is used).
  Do not point this back at a CDN; if upgrading, bump the file name and the import together.
