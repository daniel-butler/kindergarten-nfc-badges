# 👩‍💻 Developer guide

[← Back to the README](../README.md) · [Presenter guide](presenter-guide.md) · [Setup guide](setup.md)

## How it's built

| Path      | What |
|-----------|------|
| `server/` | Rust (axum) server: tap pipeline, badge ID matching, card registry, sticker photos, commands, SSE. The projector page (`server/static/`, vanilla JS + three.js r128) is embedded in the binary. |
| `ios/`    | **Zookeeper**: SwiftUI + Core NFC. Check in, Register (camera + Vision cutout + edge cleanup), and the Presenter remote. |
| `e2e/`    | Playwright end-to-end tests against a real server and browser. |
| `docs/`   | Guides, design notes (`superpowers/specs`) and plans (`superpowers/plans`). |

Every tap, from the reader or the phone, goes through `POST /tap`. The server normalizes and
matches the ID and broadcasts it over SSE, and the projector page reacts. Presenter commands
(keys on the Mac or buttons on the phone) go through `POST /api/command` and come back to the page
as SSE `command` events, so both paths behave the same.

## HTTP API

| Method | Path             | Body / result |
|--------|------------------|---------------|
| POST   | `/tap`           | `{"id":"04A1B2C3D4E5F6","source":"phone"\|"reader"}` → tap event |
| GET    | `/events`        | SSE. `tap` → tap event; `cards` → full card list after any change; `command` → `{action}` |
| GET    | `/api/cards`     | card list |
| PUT    | `/api/cards`     | replace the card list. `409` if invalid, or if one badge would map to two cards |
| POST   | `/api/cards`     | create or replace one card by `canonical_id` (keeps aliases/photo when omitted) |
| GET    | `/api/cards/resolve?id=X` | `{ canonical_id, card }` using the normal matching; not counted as a tap |
| PUT    | `/api/cards/{id}/image` | `image/png`, max 5 MB → `images/<id>.png` next to `cards.json` |
| POST   | `/api/cards/clear-away` | clear 💤 on every card |
| GET    | `/api/presenter` | `{ waiting: { kind: "trick"\|"special", card, raw_id, ts } \| null, last_unknown: { raw_id, ts } \| null }` |
| POST   | `/api/log`       | `{ "source": "page"\|"phone", "lines": [..] }` → 204, appended to `badge-server.log` |
| POST   | `/api/command` | `{ "action": "let-in" }` → broadcast as SSE `command`. Actions: `scene-setup scene-secret scene-zoo scene-list scene-who scene-gate scene-debug toggle-list let-in keep-out allow-special party reset` |
| GET    | `/images/<id>.png` | sticker photos |
| GET/PUT| `/api/link-mode` | `{"enabled":true}` turns on alias linking (the Setup scene does this) |

- **Tap event:** `{ raw_id, canonical_id, source, card: Card|null, ts, linked? }`
- **Card:** `{ canonical_id, aliases: [..], emoji, label, color: { hex, name }, role: "normal"|"trick"|"special", allowed, away, image? }`
- **Older files:** cards saved with `"trick": true` load as role trick.

## How badge IDs match

All IDs are normalized to uppercase hex with no separators (`04:a1:b2…` → `04A1B2…`). An incoming
ID resolves to a card by, strongest first:

1. an exact match on the canonical ID or any alias
2. a byte-reversed match
3. a 4-byte match: an 8-character ID equal to the first or last 4 bytes of a full ID, normal or
   reversed

If two cards tie at the best level, the tap counts as unknown rather than guessing. Saving a card
list where one badge would match two cards is rejected loudly.

## Tests

```sh
cd server && cargo test                              # ID matching, registry, roles, presenter state
cd e2e && npm install && npm run install-browser     # once
cd e2e && npm test                                   # starts a server on :8181 with a fresh cards file
cd ios && swiftc ClassroomZoo/TapClient.swift ClassroomZoo/StickerEdges.swift Tests/*.swift -o /tmp/tapcheck && /tmp/tapcheck
BADGE_SCRATCH_SERVER=localhost:8181 /tmp/tapcheck    # also talks to a THROWAWAY server (it adds a test badge)
```

### Connection tests (Chrome and Firefox)

`e2e/tests/connection.spec.js` puts a small TCP relay between the projector page and the server so
a test can cut the live connection or make the server unreachable, the way a network blip, a
sleeping Mac or a restarted server would. They run in Chrome **and Firefox** (the classroom Mac
uses Firefox), and check the page comes back by itself and that taps made during the outage
still reach the zoo.

How it works: every event gets an id; the server keeps the last 2 minutes (up to 100) and replays
what a reconnecting page missed (`Last-Event-ID`, or `?last=` for a fresh connection). Each new
connection starts with a `hello` event, because Firefox doesn't count the connection as open
until data arrives (otherwise it waits for the 15-second keep-alive).

### Phone and page together

```sh
cd e2e && npm run test:phone
```

These tests run **Zookeeper in the iOS simulator** against the same server as the projector page. Each
Playwright test sets up the server and the page, runs one XCUITest from
`ios/UITests/ClassroomZooUITests.swift` that presses the app's real buttons, then checks the page:

- a badge read on the phone walks into the zoo
- the waiting trick badge shows on the phone; Let in / Keep out decide the vote
- Allow special opens the Zoo List, and the special's next tap starts the party
- Reset empties the zoo
- 💤 Not here today reaches the page

The simulator has no NFC, so debug builds read badge IDs from `ZOO_FAKE_TAGS` instead (release
builds don't contain this). The tests need Xcode. They use a booted iPhone simulator, or the first
available one (set `BADGE_SIM` to a simulator ID to choose). The first run builds the app into
`e2e/.ios-build/`. A plain `npm test` skips them.

### CI

CI (GitHub Actions) runs `cargo fmt`, `clippy -D warnings`, the Rust tests and the e2e suite on
Linux. On macOS it runs the Swift checks, builds the iOS app, and runs the phone + page tests.

The sticker cleanup also runs on a Mac:
`swiftc -O ios/Tools/clean-sticker/main.swift ios/ClassroomZoo/StickerEdges.swift -o /tmp/clean-sticker`,
then `/tmp/clean-sticker photo.png sticker.png`.

## The shared log

The server writes `badge-server.log` next to the cards file (`~/badge-server.log` when run with
`--cards ~/cards.json`). The projector page and Zookeeper send their own lines to `POST /api/log`,
so everything is in one place, in order:

```
2026-11-18T15:16:14.123Z [server] tap from phone 04C718FE082289 → 🐑 Sheep
2026-11-18T15:16:14.150Z [page] 10:16:14.140 tap 04C718FE082289 → 🐑 Sheep
2026-11-18T15:17:02.004Z [phone] 10:17:01.998 app in the background
2026-11-18T15:17:05.311Z [page] 10:17:05.300 lost connection to server (retrying)
```

Server times are UTC; page and phone lines start with their own local time. Lines the page or
phone write while the Mac can't be reached are sent once it can. Requests the phone polls every
1.5 s (`/api/presenter`) only appear when they fail.

## Add a scene

Scenes live in `server/static/app.js`:

```js
Badge.registerScene({
  id: 'myscene', name: '🎈 My scene', key: '7',   // ⌥7
  kid: true,                                       // bright theme
  onEnter(root, Badge) { /* render into root (full-screen) */ },
  onTap(ev) { /* ev.card is null when unknown; repeats filtered unless acceptRepeats */ },
  onCards(cards) {}, onExit() {},
  onSkip() {}, skipLabel: 'Do the thing',          // ⌥S
  onCommand(action) {},                            // presenter commands while this scene is open
});
```

Helpers: `Badge.cards`, `Badge.sound.chime() / boop() / honk() / silly() / fanfare()`,
`cardArt(card, sizeVmin)` (sticker photo or emoji), `Badge.confetti.burst(colors) / rain(colors)`,
`Badge.later(fn, ms)` (cancelled on scene change), `Badge.banner(text)`, `zooRetry(root)`.

In a debug build (`cargo run`), static files are read from disk, so you can edit and refresh. A
release build embeds them in the binary.
