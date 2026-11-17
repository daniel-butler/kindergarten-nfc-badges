# Kindergarten NFC Badges

Kids tap NFC badges (NTAG215 stickers under animal stickers) and a projector page reacts.
This monorepo holds:

| Path      | What                                                                 |
|-----------|----------------------------------------------------------------------|
| `server/` | Rust (axum) server: tap pipeline, ID matching, card registry, SSE, embedded web page |
| `ios/`    | SwiftUI + Core NFC tap app *(step 4)*                                |

## Run the server

```sh
cd server
cargo run --release                 # binds 0.0.0.0:8080
cargo run --release -- --port 9000 --cards ~/cards.json
```

On startup it prints the cards file path and the Mac's LAN URLs (use the `en0` one in the phone app).
`cards.json` lives next to the binary unless you pass `--cards`. Tip: pass `--cards` so
`cargo clean` can't delete your registry.

## API

| Method | Path             | Body / result |
|--------|------------------|---------------|
| POST   | `/tap`           | `{"id":"04A1B2C3D4E5F6","source":"phone"\|"reader"}` → tap event |
| GET    | `/events`        | SSE. `event: tap` → tap event; `event: cards` → full card list after any change |
| GET    | `/api/cards`     | card list |
| PUT    | `/api/cards`     | replace card list. `409` if the same badge would map to two cards |
| GET/PUT| `/api/link-mode` | `{"enabled":true}` turns on alias linking (the Setup scene does this) |

Tap event: `{ raw_id, canonical_id, source, card: Card|null, ts, linked? }`
Card: `{ canonical_id, aliases: [..], emoji, label, color? }`

## How IDs match

All IDs are normalized to uppercase hex with no separators (`04:a1:b2…` → `04A1B2…`).
An incoming ID resolves to a card by, strongest first:

1. exact match on the canonical ID or any alias
2. byte-reversed match
3. 4-byte truncation: the 8-hex-char ID equals the first or last 4 bytes of a full UID, normal or reversed

If two cards tie at the best level, the tap counts as unknown rather than guessing. Saving a
registry where one badge would match two cards is rejected loudly.

**Linking:** if the reader emits something none of the rules catch, turn on link mode, tap
the badge on the device it's registered with, then on the other device within 5 seconds.
The unknown ID becomes an alias of that card.

## Test with no hardware

```sh
cd server && cargo test
cargo run -- --cards /tmp/cards.json &
curl -sN localhost:8080/events &          # watch events
curl -X PUT localhost:8080/api/cards -H 'content-type: application/json' \
  -d '[{"canonical_id":"04A1B2C3D4E5F6","emoji":"🐧","label":"Penguin"}]'
curl localhost:8080/tap -H 'content-type: application/json' -d '{"id":"04A1B2C3D4E5F6","source":"phone"}'
curl localhost:8080/tap -H 'content-type: application/json' -d '{"id":"C3B2A104","source":"reader"}'   # truncated + reversed → 🐧
curl localhost:8080/tap -H 'content-type: application/json' -d '{"id":"DEADBEEF","source":"reader"}'   # unknown → card: null
```
