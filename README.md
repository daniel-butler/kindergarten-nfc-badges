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
4. **Check in** mode: tap **Start Scanning** and hold badges to the top of the phone one after
   another. Each read buzzes, POSTs `{id, source: "phone"}`, shows the animal, and keeps
   scanning. iOS ends an NFC session after about a minute; tap Start again.

**Register mode** (one badge at a time, ~20 s each):
1. **Scan a badge to register**, hold the badge to the phone.
2. New badge: the camera opens. Snap the sticker straight on; the app lifts it off the cardstock
   automatically (checkerboard = transparent). **Retake** if the edges look wrong.
3. Type the animal's name (e.g. "Panda"), tap its cardstock color, pick its role
   (**Normal / 🎭 Trick / ⭐ Special**), **Save**. The photo shows up on the projector right away.
4. A badge that's already registered shows its photo with **📸 Retake photo**, **✏️ Edit** and
   **💤 Not here today**. Flip 💤 for every badge you're holding back (absent kids): those
   animals stay out of the zoo and Who has the ___?. Tapping that badge later checks it in as
   normal.

After the photo, Zoo Tap tidies the cutout: leftover bits of the sticker's old white border
are removed and an even white die-cut border is drawn around the drawing's dark outline. A
sticker with no dark outline is kept as the plain cutout. To try the same steps on a Mac:
`swiftc -O ios/Tools/clean-sticker/main.swift ios/ClassroomZoo/StickerEdges.swift -o /tmp/clean-sticker`
then `/tmp/clean-sticker photo.png sticker.png`.

Trick badges: photograph a *different* (spare) sticker and/or pick a different color, and set
the role to 🎭 Trick. The special badge: any animal, role ⭐ Special.

**Presenter mode** (the phone remote): big buttons for 👍 Let in / 👎 Keep out (trick vote),
⭐ Allow special, 📋 Zoo List, 🎉 Party, every scene, and 🔄 Reset (asks to confirm). It shows the
badge that's waiting for you (trick or special: its sticker, name and raw ID) and the last unknown
ID. **Help** lists every Mac shortcut, for when the phone can't reach the Mac. The app remembers
which tab you were on.

A badge left on the phone isn't re-sent within 2 seconds. Without a phone, check the networking
code on the Mac:

```sh
cd ios
swiftc ClassroomZoo/TapClient.swift ClassroomZoo/StickerEdges.swift Tests/*.swift -o /tmp/tapcheck && /tmp/tapcheck
BADGE_SERVER=localhost:8080 /tmp/tapcheck      # also sends a real tap to a running server
```

## Lesson flow

Mystery badges handed out → kids tap into the zoo (⌥3) → trick badge votes → special-badge
finale → party → kids decorate badges while you take questions. Open with a bare NFC sticker on
⌥2 Secret Number.

## Projector page

Open `http://localhost:8080/` in Chrome on the Mac and click **Click to start** (unlocks sound
and goes fullscreen). The USB reader types into this window; the page keeps focus by itself.

Presenter keys always use **Option** so the reader can never trigger them:

| Key | Action |
|-----|--------|
| ⌥1 | Setup (presenter only) |
| ⌥2 | Secret Number |
| ⌥3 | Zoo playground, 3D (main scene) |
| ⌥4 | The List |
| ⌥5 | Who has the ___? |
| ⌥6 | Zoo Gate, 2D (backup if 3D misbehaves) |
| ⌥0 | Debug (presenter only) |
| ⌥L | Show / hide the Zoo List |
| ⌥Y | 👍 Let it in (trick vote) |
| ⌥N | 👎 Keep it out (trick vote) |
| ⌥A | ⭐ Allow the special badge |
| ⌥S | Start the party (zoo scenes) / next animal (Who has) |
| ⌥R ⌥R | Reset the zoo (press twice within 3 s): tally, everyone inside, votes, party, special denied again |
| ⌥P | Presenter panel (also: click the invisible top-right corner) |
| ⌥F | Fullscreen |
| ⌥M | Mute all sound |
| ⌥T | Typing test mode: accept hand-typed hex (normally ignored as too slow) |

`#setup`, `#secret`, `#zoo`, `#list`, `#who`, `#gate`, `#debug` in the URL open that scene directly.

### Scenes

Kid scenes use a bright sky theme, the real sticker photos (emoji when a badge has no photo yet),
and sound effects. There is no spoken voice. Setup and Debug stay dark.

- **Setup**: tap a badge. Unknown → pick an animal, cardstock color and role
  (Normal / 🎭 Trick / ⭐ Special) → Save. Known → shows it, with ✏️ Change / 🗑️ Delete. Click an
  animal in the bottom strip to edit it. Link mode is on only while this scene is open. Duplicate
  badges get a full-screen red warning.
- **Secret Number**: any tap, known or not, reveals the raw ID digit by digit on rainbow tiles
  with a tick per digit, then a chime.
- **Zoo playground (3D, main)**: a tap swoops the camera to the ZOO gate, where that badge's
  sticker waits. The gate opens with confetti in its cardstock color and a chime, the sticker hops
  down the path into the playground, its friends bounce with hearts, and it joins the slide,
  swings, seesaw, merry-go-round or grass (animals rotate every ~12 s). Several taps in a row
  queue up and arrive faster. A **tally** at the top adds a mark (groups of five) for each normal
  entry, each trick badge voted in, and the special badge. Check-ins survive a reload.
  - *Unknown badge*: small "Oops! Tap again 🔄" with a soft boop. Nobody goes in.
  - *🎭 Trick badge*: its stored animal and color with a bouncing "?" and 👍 Let it in / 👎 Keep it
    out. Kids vote with thumbs; you press ⌥Y / ⌥N (or the phone). Let in → it walks in with
    confetti and a mark. Keep out → the gatekeeper goose 🪿 waves it bye-bye with a honk. Taps
    during a vote wait their turn.
  - *⭐ Special badge*: denied at first (it peeks at the gate, the goose honks and shakes its
    head, the padlock wobbles). Press ⌥A: the **Zoo List** pops up with everyone inside and a
    pencil scribbles the special badge in. The next tap of the special badge walks it in, adds a
    mark, and **starts the party**. ⌥S still starts the party any time.
- **Zoo Gate (2D backup, ⌥6)**: the earlier flat version with the same rules, tally and check-ins.
- **The List**: every registered card with its secret number, animal and color swatch. A tap shows
  the tapped number, visibly scans down the list, then highlights and enlarges the matching row
  and 💤 badges faded.
- **Who has the ___?**: shows one animal: "Who has the Panda?" Right badge → confetti in its
  color and "Yes!"; the next animal comes up after 4 seconds. Wrong badge → silly buzzer and
  "Nope! That's the Lion"; unknown badge → the gentle "Oops! Tap again". ⌥S skips. Every present
  card is asked once before any repeats.
- **Debug**: live log of every tap (source, raw_id, canonical_id, matched card) plus ignored reader
  input.

Outside the zoo, trick and special badges act like any other card. The presenter panel (⌥P) has
the zoo buttons, **💤 Everyone's here** (clears every 💤), and the last unknown badge's raw ID.

**Secret Number vs. The List:** Secret Number shows the ID exactly as the device sent it. If the
USB reader sends a shortened or reversed form, it won't look like the List's number, but The List
still finds the right row and shows the tapped number at the top.

### Writing a scene

Scenes live in `server/static/app.js`:

```js
Badge.registerScene({
  id: 'myscene', name: '🎈 My scene', key: '7',   // ⌥7
  kid: true,                                       // bright theme
  onEnter(root, Badge) { /* render into root (full-screen) */ },
  onTap(ev) { /* ev.card is null when unknown; repeats filtered unless acceptRepeats */ },
  onCards(cards) {}, onExit() {},
  onSkip() {}, skipLabel: 'Do the thing',          // ⌥S
  actions: [{ label: 'Reset', run() {} }],         // presenter panel buttons
});
```

Helpers on `Badge`: `cards`, `sound.chime() / buzzer() / silly() / fanfare() / tick()`,
`cardArt(card, sizeVmin)` (sticker photo or emoji), `confetti.burst(colors) / rain(colors)`, `later(fn, ms)` (auto-cancelled on
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
| POST   | `/api/cards`     | create or replace one card by `canonical_id` (keeps aliases/photo when omitted) |
| GET    | `/api/cards/resolve?id=X` | `{ canonical_id, card }` using the normal matching; not counted as a tap |
| PUT    | `/api/cards/{id}/image` | `image/png` body, max 5 MB → stored as `images/<id>.png` next to `cards.json` |
| POST   | `/api/cards/clear-away` | clear 💤 on every card |
| GET    | `/api/presenter` | `{ waiting: { kind: "trick"\|"special", card, raw_id, ts } \| null, last_unknown: { raw_id, ts } \| null }` |
| POST   | `/api/command` | `{ "action": "let-in" }` etc. → broadcast as SSE `event: command`. Actions: `scene-setup scene-secret scene-zoo scene-list scene-who scene-gate scene-debug toggle-list let-in keep-out allow-special party reset` |
| GET    | `/images/<id>.png` | the sticker photos |
| GET/PUT| `/api/link-mode` | `{"enabled":true}` turns on alias linking (the Setup scene does this) |

Tap event: `{ raw_id, canonical_id, source, card: Card|null, ts, linked? }`
Card: `{ canonical_id, aliases: [..], emoji, label, color: { hex: "#1E5BD8", name: "Blue" }, role: "normal"|"trick"|"special", allowed, away, image? }`
(older files with `"trick": true` load as role trick.)

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

The e2e suite covers the HTTP API (including sticker photos and 💤), SSE, keyboard-wedge
capture, every scene including the 3D zoo, the presenter panel, and 720p layouts with 25
badges. CI runs fmt, clippy, unit tests and e2e on every push.

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
- [ ] Start it with `--cards ~/cards.json` (photos land in `~/images/`).
- [ ] Zoo Tap is on the iPhone (reinstall from Xcode if it won't open).
- [ ] Zoo Tap → **Register**: scan each of the 18 badges, snap its sticker, name it, pick its
      cardstock color, role. Three 🎭 trick badges (photograph a spare sticker for them) and one
      ⭐ special badge.
- [ ] Tap every badge on the **USB reader** with Setup (⌥1) open. Any that show the picker
      instead of the card: tap it on the phone, then the reader within 5 s to link them.
- [ ] Back up `cards.json` and the `images/` folder.
- [ ] Rehearse the whole flow from the phone's **Presenter** tab: ⌥2 → ⌥3, a few check-ins, an
      unknown sticker (gentle retry), a trick vote each way, the special badge (denied → Allow →
      party), then **Reset**. Make sure ⌥3 runs smoothly on the Mac; if not, ⌥6 is the 2D backup.

**In the classroom**
- [ ] Mac on the iPhone hotspot; server running with `--cards ~/cards.json`.
- [ ] Chrome → `http://localhost:8080/#zoo`, **Click to start**, fullscreen (⌥F).
- [ ] Projector volume up; ⌥P → Chime plays.
- [ ] ⌥P status shows 🟢 Connected and the right card count; **💤 Everyone's here** if last
      time's 💤 are still set.
- [ ] Zoo Tap → **Register**, scan each badge you're holding back → **💤 Not here today**.
- [ ] Zoo Tap → **Check in**: server URL set, **Test connection** shows ✅, Start Scanning; one
      test tap shows in ⌥0 Debug as 📱 phone.
- [ ] Reader: one test tap shows as ⌨️ reader. Typing test mode is **off**.
- [ ] **Reset** (phone, or ⌥R twice) right before the kids start.
- [ ] A bare NFC sticker for the Secret Number opening.
