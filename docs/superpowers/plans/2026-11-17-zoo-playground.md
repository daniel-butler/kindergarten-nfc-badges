# Zoo Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 3D zoo-playground check-in scene where each kid's real sticker (photographed and cut out on the iPhone while registering) walks through the gate and joins its friends, plus "Not here today" from the phone.

**Architecture:** The Rust server gains card photos (`image`), an `away` flag, a single-card upsert, a non-broadcasting resolve, and image upload/serving. The projector page gets a three.js scene (vendored r128 UMD) registered like the other scenes in `app.js`, a shared check-in store with the 2D Zoo Gate (kept as a backup on ⌥6), and one art helper so sticker photos appear in every scene. Zoo Tap gains a Register mode that scans one badge, snaps a photo, lifts the sticker with Vision, and saves via the new endpoints.

**Tech Stack:** Rust (axum 0.8, tokio, serde, rust-embed), vanilla JS + three.js r128, Playwright e2e, SwiftUI + Core NFC + Vision (iOS 17).

**Spec:** `docs/superpowers/specs/2026-11-17-zoo-playground-design.md` (visual/technical reference for the 3D world: `docs/superpowers/specs/assets/2026-11-17-zoo-3d-spike.html`).

## Global Constraints

- Done and tested by the evening of Wed 2026-11-18; works offline.
- Page stays one HTML (`index.html`), one JS (`app.js`), one CSS (`styles.css`) plus `vendor/three.min.js` (three.js **r128** classic UMD build). No ES modules, no build step.
- Rust: `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean; minimal new dependencies (none expected).
- Image uploads: PNG only, max 5 MB, stored as `images/<canonical_id>.png` next to `cards.json`; `card.image` = `/images/<canonical_id>.png?v=<unix_ms>`.
- Counter copy: `"<done> of <total> animals are home"`; `total` counts cards that are neither `trick` nor `away`; zero total shows `"No animals registered yet"`.
- Finale copy: `"Congratulations, Official Zookeepers!"` (text and voice).
- New 3D scene: id `zoo`, key `3`, `kid: true`. Old 2D scene: id `gate`, key `6`, `kid: true`. Both share check-in storage key `zoo-gate-v1`.
- Away cards: not in the zoo/party/count; never asked in Who has the ___?; faded with 💤 in The List; 💤 marker in Setup; a `/tap` clears `away`.
- iOS 17 minimum; signing team K7T7J4BD4W; bundle `com.rekuro.ClassroomZoo`; needs `NSCameraUsageDescription`.
- Kid-facing scenes: bright theme, voice lines via `Voice.say`, big visuals, no small text.
- Never mask test exit codes when running suites before committing.

## Review Focus

1. **A late kid's "away" badge tapped at the gate** → it checks in and the total grows back by one (Task 1 Rust test + Task 2 e2e).
2. **Several kids tapping in quick succession** (5 taps within 2 s) → counter updates immediately for each, all 5 end up inside, no tap lost (Task 2 e2e).
3. **Image upload for an unknown id / oversized / non-PNG / path tricks** → 404 / 413 / 415 / 404, nothing written (Task 1 tests).
4. **WebGL unavailable on some machine** → the Zoo scene shows "3D isn't available here: press ⌥6 for the Zoo Gate" instead of a blank screen (Task 2 e2e via forced failure).
5. **Re-registering a badge whose card was created from a USB-reader tap** (canonical is the 4-byte reader form) → phone resolves to that card and edits it, no duplicate (Task 1 resolve test; Task 4 uses resolve).

---

### Task 1: Server — photos, away, upsert, resolve

**Files:**
- Modify: `server/src/registry.rs` (Card fields, new Registry methods + tests)
- Modify: `server/src/main.rs` (routes, handlers, body limit, tap clears away)
- Modify: `server/src/taps.rs` (clear away on tap + test)
- Test: `e2e/tests/api.spec.js` (new endpoint cases)

**Interfaces:**
- Produces (Rust): `Card { …, image: Option<String> /* skip if None */, away: bool /* serde default */ }`;
  `Registry::upsert(&mut self, card: Card) -> Result<Card, String>` (keeps existing `aliases` when the incoming list is empty, keeps existing `image` when incoming is `None`);
  `Registry::set_image(&mut self, canonical_id: &str, png: &[u8], version_ms: u64) -> Result<Card, ImageError>` with `enum ImageError { NotFound, NotPng, TooLarge, Io(String) }`;
  `Registry::clear_away(&mut self) -> Result<(), String>`; `Registry::images_dir(&self) -> PathBuf` (= `cards.json` parent + `images`).
- Produces (HTTP): `POST /api/cards` (body Card) → 200 Card | 409 text; `GET /api/cards/resolve?id=X` → `{ "canonical_id": "...", "card": Card|null }` (400 on bad hex); `PUT /api/cards/{id}/image` (`image/png`) → 200 Card | 404 | 413 | 415; `POST /api/cards/clear-away` → 200 `[Card]`; `GET /images/{file}` → PNG | 404. Every mutation broadcasts the `cards` SSE event.

- [ ] **Step 1: Write failing Rust tests in `registry.rs`**: `upsert_creates_then_replaces_keeping_aliases_and_image`, `upsert_rejects_duplicate_badge` (`Err` containing `"duplicate"`), `set_image_writes_file_and_sets_versioned_url` (url == `"/images/04A1B2C3D4E5F6.png?v=42"`, file exists), `set_image_rejects_non_png_unknown_and_large` (`NotPng`, `NotFound`, `TooLarge` for 5 MB + 1), `clear_away_resets_all`. In `taps.rs`: `tap_on_away_card_clears_it` (handle() on an away card → returned card `away == false`, registry persisted).
- [ ] **Step 2: Run** `cd server && cargo test` — Expected: compile errors / FAIL for the new tests.
- [ ] **Step 3: Implement** the Card fields and Registry methods (validation reuses `validate`; PNG check = first 8 bytes `89 50 4E 47 0D 0A 1A 0A`; atomic write like `save`), the away-clearing in `Linker::handle` (clear before returning the card, via `upsert`), and handlers in `main.rs`. Wrap the image route with `axum::extract::DefaultBodyLimit::max(5 * 1024 * 1024 + 1024)`. `GET /images/{file}` accepts only `^[0-9A-F]+\.png$`. Resolve uses `ids::normalize` + `Registry::resolve` without touching the Linker or broadcasting.
- [ ] **Step 4: Run** `cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings` — Expected: all pass, no warnings.
- [ ] **Step 5: Add e2e cases to `api.spec.js`**: `upsert one card and resolve it in reader form` (POST card, GET resolve `C3B2A104` → that card), `image upload is stored, served, and versioned` (PUT a 1×1 PNG buffer → `card.image` matches `/^\/images\/04A1B2C3D4E5F6\.png\?v=\d+$/`, GET it → 200 `image/png`), `image upload rejects unknown id, non-png, and oversized` (404, 415, 413), `images route refuses path tricks` (`/images/..%2Fcards.json` and `/images/cards.json` → 404), `away card tapped clears away; clear-away resets all`.
- [ ] **Step 6: Run** `cd e2e && npx playwright test tests/api.spec.js; echo EXIT $?` — Expected: `EXIT 0`.
- [ ] **Step 7: Commit** `git commit -m "Server: card photos, away flag, single-card upsert, resolve"`

### Task 2: 3D Zoo playground scene

**Files:**
- Create: `server/static/vendor/three.min.js` (download `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`, commit as-is)
- Modify: `server/static/index.html` (`<script src="vendor/three.min.js">` before `app.js`)
- Modify: `server/static/app.js` (shared check-in store; rename old scene to `gate`/`6`; new `zoo` scene)
- Modify: `server/static/styles.css` (zoo overlay styles)
- Test: `e2e/tests/zoo3d.spec.js` (new); update `e2e/tests/kid-scenes.spec.js` Zoo Gate tests to `#gate`/`Alt+6`

**Interfaces:**
- Consumes: `Card.away`, `Card.trick`, `Card.image` (Task 1); `Badge.later`, `Sound.*`, `Voice.say`, `Confetti` (existing).
- Produces (JS, global in `app.js`):
  `const ZooStore = { load(): {checkedIn: string[], open: boolean}, save(state), reset() }` (key `zoo-gate-v1`; both zoo scenes use it);
  `function zooCounts(cards, checkedIn): {done: number, total: number}` (excludes trick and away; `done` counts only real, present cards inside);
  `function cardTexture(card): THREE.Texture` (sticker image when `card.image`, else emoji canvas; cached by `canonical_id + image`);
  zoo scene object exposes `state(): { inside: string[], queued: number, finale: boolean }` for tests.
- DOM contract (tests rely on it): `.zoo-counter` (counter copy from Global Constraints), `.zoo-denied` overlay containing `ACCESS DENIED`, `.zoo3d-finale` containing the finale copy, `.zoo3d-fallback` when WebGL fails, panel actions `Reset check-ins` and skip label `🎉 Start the party`.

- [ ] **Step 1: Write failing e2e tests in `zoo3d.spec.js`** (cards: PENGUIN, LION, FOX_TRICK, plus one `away: true` card): `zoo loads with no page errors and shows "0 of 2 animals are home"`; `known tap: counter updates immediately and the animal is inside after the arrival` (`state().inside` contains id within 10 s; voice history contains `"Welcome, Penguin!"`); `five quick taps all arrive` (5 registered cards, 5 POSTs within 2 s → counter `5 of 5` immediately, `state().inside.length === 5` within 25 s); `unknown badge shows ACCESS DENIED and the gate stays shut`; `away card tapped checks in and total grows` (`"1 of 3 animals are home"`); `last real arrival starts the party` (`.zoo3d-finale` text within 20 s); `Alt+s starts the party early`; `check-ins survive reload and are shared with the backup Zoo Gate on Alt+6`; `Reset check-ins clears both`; `no WebGL shows the fallback` (use `page.addInitScript` to make `HTMLCanvasElement.prototype.getContext` return null for `webgl`/`webgl2` → `.zoo3d-fallback` visible); `zero real cards shows "No animals registered yet" and never parties`.
- [ ] **Step 2: Run** `cd e2e && npx playwright test tests/zoo3d.spec.js; echo EXIT $?` — Expected: failures (scene missing).
- [ ] **Step 3: Implement** `ZooStore`/`zooCounts` and switch the old scene to them (id `gate`, key `6`, counter copy updated, away cards excluded from slots).
- [ ] **Step 4: Implement the `zoo` scene.** Start from the spike's renderer/world/sprite/tween/confetti code. World per spec: grass, trees, perimeter fence, ZOO archway gate with opening doors, path gate→playground; playground pieces slide, 3-seat swings, seesaw, merry-go-round, open grass, each with animation slots; animals are sprites from `cardTexture` keeping image aspect, equal on-screen height, blob shadow. Activity scheduler reassigns inside animals every 10–15 s; extras wander. Arrival ≈ 7 s (camera swoop to gate → doors open + `Confetti` burst in `card.color.hex` + `Sound.chime` + `Voice.say("Welcome, <label>!")` → hop along path → friends bounce + hearts → join a piece → camera back); with ≥2 queued, ≈3 s each and the camera stays at the gate. Already inside: jump + `Sound.tick`, no camera move. Unknown: `.zoo-denied` overlay + `Sound.buzzer` + `Voice.say("Access denied!", {pitch: 1.6})`, doors stay shut. Finale (all real present cards in, or `onSkip`): fanfare, `Confetti.rain(all colors)`, animals gather and dance, `.zoo3d-finale` overlay + voice. WebGL failure → `.zoo3d-fallback`. Dispose renderer and stop the RAF loop in `onExit`. Pixel ratio ≤ 2, no shadow maps.
- [ ] **Step 5: Run** the zoo tests, then the full suite: `npx playwright test; echo EXIT $?` — Expected: `EXIT 0`.
- [ ] **Step 6: Visual check** — screenshot at 1920×1080 and 1280×720 with 18 cards (overview, mid-arrival, party) and look at them; fix anything unreadable or overlapping.
- [ ] **Step 7: Commit** `git commit -m "3D zoo playground check-in scene; Zoo Gate kept on ⌥6"`

### Task 3: Sticker art everywhere + away in other scenes

**Files:**
- Modify: `server/static/app.js`, `server/static/styles.css`
- Test: `e2e/tests/kid-scenes.spec.js`, `e2e/tests/scenes.spec.js`

**Interfaces:**
- Consumes: `Card.image`, `Card.away` (Task 1).
- Produces: `function cardArt(card, sizeVmin): HTMLElement` — `<img class="sticker" src=card.image alt=card.label>` sized to `sizeVmin` (height, aspect kept) when `card.image`, else a `<span class="emoji-art">` with the emoji at that size. `ring()`, `cardCircle()`, Setup strip/card view, The List rows, Who has the ___?, Debug card cell, and the `gate` scene use it.
  Presenter panel button `Everyone's here` → `POST /api/cards/clear-away`.

- [ ] **Step 1: Write failing e2e tests**: `The List shows the sticker image for cards with a photo` (upload PNG for PENGUIN → its row contains `img.sticker[src^="/images/04A1B2C3D4E5F6.png"]`), `Who has the ___? shows the sticker image`, `away cards: List row has class away and 💤; Who never asks for them` (only away + one present card → 5 skips never show the away card), `Everyone's here clears away from the panel`.
- [ ] **Step 2: Run** them — Expected: FAIL.
- [ ] **Step 3: Implement** `cardArt` and use it at each site listed above; away styling (`.list-row.away { opacity: .45 }` + 💤), Who's `pickNext` filters `!c.away`, Setup mini-card 💤, panel button.
- [ ] **Step 4: Run** `npx playwright test; echo EXIT $?` — Expected: `EXIT 0`.
- [ ] **Step 5: Commit** `git commit -m "Show sticker photos in every scene; handle away cards"`

### Task 4: Zoo Tap Register mode

**Files:**
- Modify: `ios/ClassroomZoo/TapClient.swift` (models + endpoints + name→emoji + colors)
- Create: `ios/ClassroomZoo/StickerCutout.swift`
- Create: `ios/ClassroomZoo/RegisterView.swift`
- Modify: `ios/ClassroomZoo/NFCScanner.swift` (single-read mode)
- Modify: `ios/ClassroomZoo/ContentView.swift` (Check in / Register picker)
- Modify: `ios/Config/Info.plist` (`NSCameraUsageDescription`: "Zoo Tap photographs each badge's sticker so it can walk into the zoo.")
- Test: `ios/Tests/main.swift`

**Interfaces:**
- Consumes: HTTP endpoints from Task 1.
- Produces (Swift): `struct CardDTO: Codable { canonical_id, aliases: [String], emoji, label, color: ColorDTO, trick: Bool, away: Bool, image: String? }`; `struct ColorDTO: Codable { hex, name }`;
  `TapClient.cardstockColors: [ColorDTO]` (the same 13 name/hex pairs as `COLORS` in `app.js`);
  `TapClient.emoji(forName: String) -> String` (case-insensitive map incl. Panda🐼 Owl🦉 Bee🐝 Frog🐸 Puppy/Dog🐶 Budgie/Parakeet/Bird🐦 Bunny/Rabbit🐰 Cat🐱 Fox🦊 Lion🦁 Tiger🐯 Bear🐻 Penguin🐧 Monkey🐵 Unicorn🦄 Turtle🐢 Koala🐨 Elephant🐘 Giraffe🦒, else 🐾);
  `TapClient.resolve(id:server:) async -> Result<(canonicalID: String, card: CardDTO?), Error>`;
  `TapClient.upsert(_ card: CardDTO, server:) async -> Result<CardDTO, Error>`;
  `TapClient.uploadImage(_ png: Data, id:server:) async -> Result<CardDTO, Error>`;
  `NFCScanner.scanOnce(_ done: @escaping (String) -> Void)` (session invalidates after the first UID);
  `StickerCutout.lift(_ image: UIImage) async -> (image: UIImage, lifted: Bool)` (Vision `VNGenerateForegroundInstanceMaskRequest`; trimmed to subject bounds; long side ≤ 600 px; fallback = center square crop, `lifted: false`).

- [ ] **Step 1: Add failing checks to `ios/Tests/main.swift`**: `emoji(forName: "panda") == "🐼"`, `emoji(forName: "Fairy Frog") == "🐸"` (word match), `emoji(forName: "Zork") == "🐾"`; `cardstockColors.count == 13` and contains `("Blue", "#1E5BD8")`; `CardDTO` decodes the server's JSON with and without `image`/`away`; upsert request body encodes `trick`/`away`; live (with `BADGE_SERVER`): upsert → resolve finds it → upload 1×1 PNG → card has `image`.
- [ ] **Step 2: Run** `cd ios && swiftc ClassroomZoo/TapClient.swift Tests/main.swift -o /tmp/tapcheck && /tmp/tapcheck` — Expected: compile errors / FAIL.
- [ ] **Step 3: Implement** TapClient additions until checks pass (live run against `badge-server --port 8099 --cards <tmp>`).
- [ ] **Step 4: Implement** `StickerCutout`, `scanOnce`, `RegisterView` (flow: Scan → resolve → existing: photo/name/color + Retake photo / Edit / **💤 Not here today** switch saved immediately via upsert; new: camera (`UIImagePickerController`, rear) → cutout preview on checkerboard (Retake) → name field → 13 swatches → Trick switch → Save = upsert then uploadImage → "Saved ✓" + success haptic → "Scan next badge"), and the segmented picker in `ContentView`.
- [ ] **Step 5: Build** for the simulator and device unsigned (no warnings), then signed to the phone: `xcodebuild … -destination 'id=00008150-0011382C3AE9401C' -allowProvisioningUpdates build` and `xcrun devicectl device install app …` — Expected: `BUILD SUCCEEDED`, `App installed`.
- [ ] **Step 6: Commit** `git commit -m "Zoo Tap: Register mode with sticker photo cutout and Not here today"`

### Task 5: Docs and CI

**Files:**
- Modify: `README.md` (scenes table: ⌥3 Zoo 3D, ⌥6 Zoo Gate backup; registering on the phone; away; Everyone's here; checklist: register 18 badges with photos, hold back absent kids' badges via 💤, check ⌥3 runs smoothly on the projector, ⌥6 fallback)
- Modify: `.github/workflows/ci.yml` only if new tests need it (iOS job already compiles `TapClient.swift` + `Tests/main.swift`)

- [ ] **Step 1: Update README** per the list above.
- [ ] **Step 2: Run everything**: `cd server && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test; cd ../e2e && npx playwright test; echo EXIT $?` — Expected: `EXIT 0`.
- [ ] **Step 3: Commit and push**; watch CI with `gh run watch <id> --exit-status` — Expected: both jobs pass.
