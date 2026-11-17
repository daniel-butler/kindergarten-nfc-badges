# Kindergarten NFC Badges

Kids tap NFC badges (NTAG215 stickers under animal stickers) and a projector page reacts.
This monorepo holds:

| Path      | What                                                                 |
|-----------|----------------------------------------------------------------------|
| `server/` | Rust (axum) server: tap pipeline, ID matching, card registry, SSE, embedded web page |
| `ios/`    | SwiftUI + Core NFC tap app *(step 4)*                                |
| `e2e/`    | Playwright end-to-end tests: real server + real browser               |

## Run the server

```sh
cd server
cargo run --release                 # binds 0.0.0.0:8080
cargo run --release -- --port 9000 --cards ~/cards.json
```

On startup it prints the cards file path and the Mac's LAN URLs (use the `en0` one in the phone app).
`cards.json` lives next to the binary unless you pass `--cards`. Tip: pass `--cards` so
`cargo clean` can't delete your registry.

## Projector page

Open `http://localhost:8080/` in Chrome on the Mac, click **Click to start** (unlocks sound,
goes fullscreen). The USB reader types into this window; the page keeps focus on its own.

Presenter keys always use **Option** so the reader can never trigger them:

| Key | Action |
|-----|--------|
| ⌥1 | Setup scene |
| ⌥2 | Free tap scene |
| ⌥0 | Debug scene |
| ⌥P | Presenter panel (also: click the invisible top-right corner) |
| ⌥F | Fullscreen |
| ⌥S | Skip / next (scenes that support it) |
| ⌥M | Mute |
| ⌥T | Typing test mode: accept hand-typed hex (normally ignored as too slow) |

`#setup`, `#free`, `#debug` in the URL open that scene directly.

### Scenes

- **Setup**: tap a badge. Unknown → pick an animal and cardstock color → Save. Known → shows it,
  with ✏️ Change / 🗑️ Delete. Click an animal in the bottom strip to edit it. Link mode is on
  only while this scene is open. Duplicate badges get a full-screen red warning.
- **Free tap**: known badge → giant emoji in its color, label, chime, confetti in its color.
  Unknown → ACCESS DENIED + buzzer.
- **Debug**: live log of every tap (source, raw_id, canonical_id, matched card) plus ignored
  reader input.

### Writing a scene

Scenes live in `server/static/app.js`. Copy an existing one:

```js
Badge.registerScene({
  id: 'myscene', name: '🎈 My scene', key: '3',   // ⌥3
  onEnter(root, Badge) { /* render into root (full-screen) */ },
  onTap(ev) { /* ev.card is null when unknown; ev.repeat filtered unless acceptRepeats */ },
  onCards(cards) {}, onSkip() {}, onExit() {},
});
```

Helpers on `Badge`: `cards`, `sound.chime() / buzzer() / silly() / fanfare()`,
`confetti.burst(colors) / rain(colors)`, `later(fn, ms)` (auto-cancelled on scene change),
`banner(text)`, `saveCards(cards)`, `ANIMALS`, `COLORS`, `colorName(hex)`.

In a debug build (`cargo run`) static files are read from disk, so edit `app.js` and refresh.
A release build embeds them in the binary.

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

## Automated tests

```sh
cd server && cargo test          # ID matching, registry, linking (unit)
cd e2e && npm install && npm run install-browser   # once
cd e2e && npm test               # starts the server on :8181 with a temp cards file
```

The e2e suite covers the HTTP API, SSE, keyboard-wedge capture (fast vs. slow typing, non-hex,
focus), every scene, the presenter panel, and the 720p layout. CI runs fmt, clippy, unit tests
and e2e on every push.

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

On the page: press **⌥T** (typing test mode), type `c3b2a104` and Enter: the Penguin appears,
the same as the reader would produce. Press ⌥T again to turn it off: hand typing is ignored
again, which is how it should be in class. Watch everything in **⌥0 Debug**.
