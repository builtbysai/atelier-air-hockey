# Atelier TURN credential Worker

Source of truth for the Worker deployed at:

`https://atelier-turn-credentials.saihanswissle.workers.dev`

## Required Worker secrets

- `CF_TURN_KEY_ID`
- `CF_TURN_API_TOKEN`

Both stay server-side. Never commit their values.

## Routes

- `GET /health` returns a non-sensitive health response.
- `POST /ice` mints short-lived Cloudflare Realtime TURN credentials.
- `OPTIONS /ice` handles browser CORS preflight.

Production browser requests are accepted from `https://builtbysai.com`; localhost and
127.0.0.1 are accepted for development.

The Worker requests a four-hour credential TTL. The game caches a successful ICE
response for one hour and falls back to Cloudflare STUN-only direct P2P when this
Worker is unreachable, so a credential outage does not disable Online mode.

Deploy `turn-worker.js` as a Module Worker. The public Worker URL is not secret.
