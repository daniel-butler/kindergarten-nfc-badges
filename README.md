# Classroom Zoo: NFC Badges

The Classroom Zoo is locked, and only zookeepers with a badge can get in. Kids tap NFC badges
(NTAG215 stickers under animal stickers, on assorted cardstock) and a projector page reacts.

| Path      | What                                                                  |
|-----------|-----------------------------------------------------------------------|
| `server/` | Rust (axum) server: tap pipeline, ID matching, card registry, SSE, embedded web page |
| `ios/`    | "Zoo Tap": SwiftUI + Core NFC app that reads badge UIDs and POSTs them |
| `e2e/`    | Playwright end-to-end tests: real server + real browser               |

## Run the server

```sh
cd server
cargo run --release -- --cards ~/cards.json      # binds 0.0.0.0:8080
cargo run --release -- --port 9000 --cards ~/cards.json
```

On startup it prints the cards file and the Mac's LAN URLs (use the `en0` one in the phone app).
Without `--cards`, `cards.json` lives next to the binary (inside `target/`, which `cargo clean`
deletes), so pass `--cards` for the real registry.

## Hotspot setup (no internet needed)

1. iPhone: Settings → Personal Hotspot → **Allow Others to Join** on. Keep this screen open
   while the Mac joins.
2. Mac: join the iPhone's Wi‑Fi network.
3. Start the server. Note the `Phone app URL: http://172.20.10.x:8080` line it prints.
4. iPhone app: enter that URL. The iPhone reaches the Mac over its own hotspot.
5. If the phone can't connect: macOS Firewall (System Settings → Network → Firewall) must allow
   `badge-server` incoming connections; the first launch usually asks.

The projector page uses `http://localhost:8080/` on the Mac, so it works even without the hotspot.
Speech uses the Mac's built-in voices, which work offline.

## iPhone app (Zoo Tap)

1. Open `ios/ClassroomZoo.xcodeproj` in Xcode. Signing is preset to team `K7T7J4BD4W` with
   automatic signing and bundle ID `com.rekuro.ClassroomZoo` (change both under
   *Signing & Capabilities* if needed). Xcode registers the App ID with the
   **NFC Tag Reading** capability on first build.
2. Plug in the iPhone, pick it as the run destination, press **Run**. First time on the phone:
   Settings → Privacy & Security → **Developer Mode** on, and trust the developer certificate
   (Settings → General → VPN & Device Management).
3. In the app: enter the server URL printed by the server (e.g. `http://172.20.10.2:8080`), tap
   **Test connection** (allow Local Network access when asked) → "✅ Connected: N badges".
4. Tap **Start Scanning** and hold badges to the top of the phone one after another. Each read
   buzzes, POSTs `{id, source: "phone"}`, shows the animal, and keeps scanning. iOS ends an NFC
   session after about a minute; tap Start again.

A badge left on the phone isn't re-sent within 2 seconds. Without a phone, check the networking
code on the Mac:

```sh
cd ios
swiftc ClassroomZoo/TapClient.swift Tests/main.swift -o /tmp/tapcheck && /tmp/tapcheck
BADGE_SERVER=localhost:8080 /tmp/tapcheck      # also sends a real tap to a running server
```

## Projector page

Open `http://localhost:8080/` in Chrome on the Mac and click **Click to start** (unlocks sound
and goes fullscreen). The USB reader types into this window; the page keeps focus by itself.

Presenter keys always use **Option** so the reader can never trigger them:

| Key | Action |
|-----|--------|
| ⌥1 | Setup (presenter only) |
| ⌥2 | Secret Number |
| ⌥3 | Zoo Gate (main scene) |
| ⌥4 | The List |
| ⌥5 | Who has the ___? |
| ⌥0 | Debug (presenter only) |
| ⌥S | Scene action: open the gate now / next animal |
| ⌥P | Presenter panel (also: click the invisible top-right corner) |
| ⌥F | Fullscreen |
| ⌥M | Mute all sound |
| ⌥V | Voice on/off |
| ⌥T | Typing test mode: accept hand-typed hex (normally ignored as too slow) |

`#setup`, `#secret`, `#zoo`, `#list`, `#who`, `#debug` in the URL open that scene directly.

### Scenes

Kid scenes use a bright sky theme, big emoji, and a spoken voice (most kindergarteners can't
read yet). Setup and Debug stay dark.

- **Setup**: tap a badge. Unknown → pick an animal and cardstock color → Save. Known → shows it,
  with ✏️ Change / 🗑️ Delete. Click an animal in the bottom strip to edit it. **🎭 Trick** marks a
  badge whose stored animal/color deliberately doesn't match the physical badge. Link mode is on
  only while this scene is open. Duplicate badges get a full-screen red warning.
- **Secret Number**: any tap, known or not, reveals the raw ID digit by digit on rainbow tiles
  while the voice reads each digit, then a chime.
- **Zoo Gate**: a locked gate. Each check-in walks that animal through the gate into the zoo
  with confetti in its cardstock color, a chime, and "Welcome, Penguin keeper!". The counter and
  progress bar count only non-trick badges. Unknown badge → ACCESS DENIED. When every non-trick
  badge is in (or on ⌥S) the gate opens with a fanfare, all animals parade across, and it ends on
  "Congratulations, Official Zookeepers!". Check-ins survive a page reload;
  **Reset check-ins** is in the presenter panel.
- **The List**: every registered card with its secret number, animal and color swatch. A tap shows
  the tapped number, visibly scans down the list, then highlights and enlarges the matching row
  ("Found it! Penguin!").
- **Who has the ___?**: "Who has the 🐧 Penguin?" Right badge → confetti in its color and
  "Yes!"; the next animal comes up after 4 seconds. Wrong badge → silly buzzer and "Nope!
  That's the Lion!". ⌥S skips. Every card gets asked once before any repeats.
- **Debug**: live log of every tap (source, raw_id, canonical_id, matched card) plus ignored reader
  input.

**Trick badges** take part everywhere like any other card; they're only left out of the Zoo Gate
"all checked in" count.

**Secret Number vs. The List:** Secret Number shows the ID exactly as the device sent it. If the
USB reader sends a shortened or reversed form, it won't look like the List's number, but The List
still finds the right row and shows the tapped number at the top.

### Writing a scene

Scenes live in `server/static/app.js`:

```js
Badge.registerScene({
  id: 'myscene', name: '🎈 My scene', key: '6',   // ⌥6
  kid: true,                                       // bright theme
  onEnter(root, Badge) { /* render into root (full-screen) */ },
  onTap(ev) { /* ev.card is null when unknown; repeats filtered unless acceptRepeats */ },
  onCards(cards) {}, onExit() {},
  onSkip() {}, skipLabel: 'Do the thing',          // ⌥S
  actions: [{ label: 'Reset', run() {} }],         // presenter panel buttons
});
```

Helpers on `Badge`: `cards`, `sound.chime() / buzzer() / silly() / fanfare() / tick()`,
`voice.say(text)`, `confetti.burst(colors) / rain(colors)`, `later(fn, ms)` (auto-cancelled on
scene change), `banner(text)`, `saveCards(cards)`, `ANIMALS`, `COLORS`.

In a debug build (`cargo run`) static files are read from disk, so edit and refresh. A release
build embeds them in the binary.

## API

| Method | Path             | Body / result |
|--------|------------------|---------------|
| POST   | `/tap`           | `{"id":"04A1B2C3D4E5F6","source":"phone"\|"reader"}` → tap event |
| GET    | `/events`        | SSE. `event: tap` → tap event; `event: cards` → full card list after any change |
| GET    | `/api/cards`     | card list |
| PUT    | `/api/cards`     | replace card list. `409` if invalid or the same badge would map to two cards |
| GET/PUT| `/api/link-mode` | `{"enabled":true}` turns on alias linking (the Setup scene does this) |

Tap event: `{ raw_id, canonical_id, source, card: Card|null, ts, linked? }`
Card: `{ canonical_id, aliases: [..], emoji, label, color: { hex: "#1E5BD8", name: "Blue" }, trick }`

## How IDs match

All IDs are normalized to uppercase hex with no separators (`04:a1:b2…` → `04A1B2…`).
An incoming ID resolves to a card by, strongest first:

1. exact match on the canonical ID or any alias
2. byte-reversed match
3. 4-byte truncation: the 8-hex-char ID equals the first or last 4 bytes of a full UID, normal or reversed

If two cards tie at the best level, the tap counts as unknown rather than guessing. Saving a
registry where one badge would match two cards is rejected loudly.

**Linking:** if the reader emits something none of the rules catch, open Setup, tap the badge on
the device it's registered with, then on the other device within 5 seconds. The unknown ID
becomes an alias of that card.

## Automated tests

```sh
cd server && cargo test                              # ID matching, registry, linking
cd e2e && npm install && npm run install-browser     # once
cd e2e && npm test                                   # starts the server on :8181 with a fresh cards file
```

CI also builds the iOS app for the simulator and runs the TapClient checks on macOS.

The e2e suite covers the HTTP API, SSE, keyboard-wedge capture, every scene (including voice
lines), the presenter panel, and 720p layouts with 25 badges. CI runs fmt, clippy, unit tests and
e2e on every push.

## Test with no hardware

```sh
cd server && cargo run -- --cards /tmp/cards.json &
curl -sN localhost:8080/events &          # watch events
curl -X PUT localhost:8080/api/cards -H 'content-type: application/json' \
  -d '[{"canonical_id":"04A1B2C3D4E5F6","emoji":"🐧","label":"Penguin","color":{"hex":"#1E5BD8","name":"Blue"}}]'
curl localhost:8080/tap -H 'content-type: application/json' -d '{"id":"04A1B2C3D4E5F6","source":"phone"}'
curl localhost:8080/tap -H 'content-type: application/json' -d '{"id":"C3B2A104","source":"reader"}'   # truncated + reversed → 🐧
curl localhost:8080/tap -H 'content-type: application/json' -d '{"id":"DEADBEEF","source":"reader"}'   # unknown → card: null
```

On the page: press **⌥T** (typing test mode), type `c3b2a104` and Enter: same as the reader.
Press ⌥T again to turn it off. Watch everything in **⌥0 Debug**.

## Pre-class checklist

**The night before**
- [ ] `cargo build --release` and copy `server/target/release/badge-server` somewhere safe.
- [ ] Install Zoo Tap on the iPhone from Xcode (development builds stay valid for days, but
      reinstall if it won't open).
- [ ] Register every badge in Setup (⌥1) with the **phone**; set 🎭 on the three trick badges.
- [ ] Tap every badge on the **USB reader** in Setup. Any that show the picker instead of the
      card: tap on the phone, then the reader within 5 s to link them.
- [ ] Back up `cards.json`.
- [ ] Dry run: ⌥2 → ⌥3 (check in a few, ⌥S to open, Reset check-ins) → ⌥4 → ⌥5.

**In the classroom**
- [ ] Mac on the iPhone hotspot; server running with `--cards ~/cards.json`.
- [ ] Chrome → `http://localhost:8080/#zoo`, **Click to start**, fullscreen (⌥F).
- [ ] Projector volume up; ⌥P → Chime and Voice buttons play.
- [ ] ⌥P status shows 🟢 Connected and the right card count.
- [ ] Zoo Tap: server URL set, **Test connection** shows ✅, Start Scanning, one test tap shows
      in ⌥0 Debug as 📱 phone.
- [ ] Reader: one test tap shows as ⌨️ reader. Typing test mode is **off**.
- [ ] ⌥3 → **Reset check-ins** right before the kids start.
- [ ] Spare badge for "ACCESS DENIED" demo (any unregistered NFC sticker).
