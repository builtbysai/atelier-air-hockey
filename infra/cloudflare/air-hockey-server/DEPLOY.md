# Atelier Air Hockey dedicated server: deploy notes for Bug

Source of truth for the Worker `atelier-air-hockey-server`. One Module Worker, one SQLite-backed
Durable Object class, no secrets, no routes beyond workers.dev. **Nothing here has been deployed.**

| What | Value |
|---|---|
| Worker (script) name | `atelier-air-hockey-server` |
| Entry module | `worker.js` (generated, committed; ES module, no imports) |
| Durable Object class | `AirHockeyMatch` (named export of `worker.js`) |
| Binding | type `durable_object_namespace`, **name `MATCH`**, `class_name` `AirHockeyMatch` |
| Migration | tag **`v1`**, **`new_sqlite_classes: ["AirHockeyMatch"]`** (never `new_classes`: the Free plan rejects it) |
| Compatibility date | `2025-09-01` (no flags needed) |
| Secrets / vars | none |
| Public URL once enabled | `https://atelier-air-hockey-server.saihanswissle.workers.dev` (what `src/net-server.js` `NET_SERVER_URL` points at) |

`metadata.json` in this folder is the exact `metadata` part of the upload.

## Routes

- `GET /health` -> `{"ok":true,"service":"atelier-air-hockey-server","v":1}`
- `GET /ws/<CODE>` (WebSocket upgrade, `CODE` = 6 chars of `A-Z2-9`). The Worker validates the code and the
  `Origin` (`https://builtbysai.com`, `localhost`, `127.0.0.1`), then forwards to
  `env.MATCH.get(env.MATCH.idFromName(CODE))`. The room code **is** the Durable Object name, so both players
  always meet in the same object.

## Deploy (Workers Scripts API, no wrangler, no npm)

The bundle is already built. To rebuild after changing `src/` or the shared region of `../../../src/net.js`:

```sh
node infra/cloudflare/air-hockey-server/build.mjs          # rewrites worker.js (also part of `npm run build`)
node infra/cloudflare/air-hockey-server/build.mjs --check  # fails if worker.js is stale
```

Upload (multipart, module Worker):

```sh
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/atelier-air-hockey-server" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F 'metadata=@infra/cloudflare/air-hockey-server/metadata.json;type=application/json' \
  -F 'worker.js=@infra/cloudflare/air-hockey-server/worker.js;type=application/javascript+module'
```

Then enable the workers.dev route (first deploy only):

```sh
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/atelier-air-hockey-server/subdomain" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' --data '{"enabled":true}'
```

The migration runs once, on the first upload that carries it. For every later upload, delete the `migrations`
key from the `metadata` you send (the tag `v1` is already applied).

Smoke tests after deploy:

1. `curl https://atelier-air-hockey-server.saihanswissle.workers.dev/health` returns the JSON above.
2. Open `https://builtbysai.com/<game>/?netMode=server` on two devices, tap Online. The lobby must say
   `Connection: Dedicated server`. Host a table on one, join the code on the other, play a point.
3. Kill one device's Wi-Fi for ~10 s, restore it: the match must resume (the rival sees "reconnecting").
4. Check Workers Logs for `[air-hockey-server]` warnings (tick or message errors).

If the account's workers.dev subdomain is not `saihanswissle`, change `NET_SERVER_URL` in `src/net-server.js`.

## Free-tier budget (design numbers, not measurements)

Limits: 100,000 DO requests/day, 13,000 GB-s/day, 5 GB storage. Incoming WebSocket messages bill 20:1; outbound is free.

- **Requests are the binding limit.** Each client sends its mallet target at 30 Hz while moving (`NET_SERVER_INPUT_HZ`);
  a stationary mallet sends a 2 Hz heartbeat. Worst case 2 players x 30 msg/s = 60 msg/s = 3 billed requests/s =
  ~10,800 per match-hour, ~1,800 per 10-minute match. Roughly **55 ten-minute matches/day** at the worst case,
  more in practice (idle mallets, pauses, lobbies). The auto-answered `ping` (RTT + keep-alive) adds ~0.04 req/s.
  Knob if the day cap is ever hit: `NET_SERVER_INPUT_HZ = 20` gives ~80 matches/day.
- **Duration is not binding.** The 60 Hz loop runs only while the table is live (countdown / play / goal). Lobbies,
  pauses, the win screen and dropped-player waits run no loop and hibernate. 128 MB x 600 s = 75 GB-s per 10-minute
  match, i.e. ~170 matches/day against 13,000 GB-s.
- **Storage is trivial.** One ~1.5 KB row, rewritten on every state change and every 15 s while live, deleted when the
  match ends, the lobby expires or both players are gone. Row writes: roughly 50 per 10-minute match.
- Measured CPU of the simulation in Node: ~7 microseconds per 60 Hz tick including input handling.

## Lifecycle the object enforces (alarm-driven)

| Situation | Behavior |
|---|---|
| Creator alone | Lobby waits up to 10 min, then the object wipes itself |
| A player's socket drops mid-match | Table pauses, rival sees "reconnecting"; the same seat (`pid` + `key`) can return for 90 s |
| 90 s elapse | Match ends, survivor gets `leave`, storage wiped |
| Zero connected players | Match ends after 60 s, storage wiped, object freed |
| Any match | Hard cap 2 h |
| Object evicted / redeployed | State is restored from SQLite; a live table restarts its point once both players are back |
