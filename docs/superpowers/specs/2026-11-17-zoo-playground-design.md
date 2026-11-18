# Zoo Playground: design

Date: 2026-11-17 · Presentation: Thursday 2026-11-19 · Class: ~18 kindergarteners

> **Update 2026-11-17:** the presenter asked for **no spoken voice at all**. Every voice line
> below ("Welcome, Panda!", "Access denied!", the finale) is shown as text or carried by sound
> effects instead; nothing is spoken.

## Intent

Make the main projector moment feel like walking into a real zoo, game-like and alive.
When a kid taps their badge, **their own sticker animal** (a photo of the real die-cut sticker
on their badge) waits outside a big 3D ZOO gate. The gate swings open with confetti in the
badge's cardstock color, the sticker hops down the path into a **playground** in the middle of
the zoo where its sticker friends are already playing, the friends cheer, and it joins in.
As the class checks in, the playground fills up. When everyone is in, the playground throws a
party: "Congratulations, Official Zookeepers!"

Why: the kids should recognize *their* animal (the actual sticker, not a look-alike emoji)
and feel it arrive somewhere fun. The person presenting picked a 3D look after seeing a
throwaway spike and loved it. Its source is saved as the visual and technical starting point:
`docs/superpowers/specs/assets/2026-11-17-zoo-3d-spike.html` (three.js r128, classic UMD script
`three.min.js`, sprites from canvas textures, a tiny tween loop, follow camera).

## Goals

- The 3D zoo with a playground is the main scene (⌥3) for check-in.
- Sticker photos are used everywhere an animal appears: Zoo, The List, Who has the ___?,
  Setup, Debug. Emoji stays as the fallback for cards without a photo.
- Registering a badge, photo included, happens entirely on the iPhone in Zoo Tap:
  scan → snap → automatic cutout → name + cardstock color → save. About 20 s per badge.
- Works offline, fullscreen at 1080p and 720p on the presenter's Mac in Chrome.
- Badges not handed out (absent kids) can be marked **Not here today** from the phone, so the
  party starts when everyone actually present is in.

## Non-goals

- Zookeeper / kid characters (dropped: the sticker animal is the star).
- Feeding (dropped: "they are just happy").
- Real 3D animal models; animals are flat paper cutouts that face the camera.
- Linking USB-reader aliases on the phone (stays in the Mac Setup scene, ⌥1).
- Hosting anywhere but the Mac (GitHub Pages was considered and rejected: the server must run
  locally anyway).

## Anti-goals (failure even if it works)

- Check-in is slow: 18 kids in a line must not wait long. One arrival ≈ 6–8 s; when taps
  queue up, arrivals speed up.
- The scene stutters or breaks on the classroom projector with no way back: the current
  2D Zoo Gate stays available as a backup scene.
- Anything that needs internet during class.
- Small text or reading-dependent moments (voice + visuals carry it, as in the rest of the app).

## Constraints

- Deadline: working and tested by the evening of Wed 2026-11-18.
- Existing stack: Rust axum server with embedded static files; vanilla HTML/JS/CSS, no build
  step; scene system in `server/static/app.js`; SSE tap events; e2e Playwright suite and CI.
- The page stays "one HTML, one JS, one CSS"; the only addition is a vendored three.js file
  (`server/static/vendor/three.min.js`, **r128**, the same classic UMD build the spike uses,
  embedded in the binary). No ES modules.
- iOS app: SwiftUI + Core NFC, iOS 17+, signed with team K7T7J4BD4W, installed over Wi‑Fi.

## Approaches considered

**Registering stickers**
- **A. All on the phone in Zoo Tap (chosen).** Register mode: scan, camera, Apple Vision
  subject lift for the cutout, name + color, save. One device, cleanest cutouts.
- B. Phone scans, Mac webcam photographs. Awkward to hold stickers up; worse photos.
- C. Phone Safari Setup page for photos + Zoo Tap for scanning. Safari can't read NFC, so
  switching apps for every badge.

**3D engine**
- **three.js (chosen)**, the library from the spike, vendored for offline use.
- Babylon.js: much heavier for no gain here. Phaser: 2D only.

**Where it lives**
- **New 3D "Zoo" scene on ⌥3 (chosen)**; the current 2D Zoo Gate moves to ⌥6 as a backup.

## The design

### Server (Rust)

- `Card` gains `image: Option<String>`: the served URL of the cutout, e.g.
  `/images/04A1B2C3D4E5F6.png?v=1731871234` (the `v` busts browser caches after a retake).
- `POST /api/cards`: upsert one card by `canonical_id` (create or replace that card's fields;
  aliases are kept when omitted). Same validation and duplicate detection as `PUT /api/cards`
  (409 on duplicate badge). Lets the phone register one badge without a read-modify-write of
  the whole list. Broadcasts the `cards` SSE event.
- `PUT /api/cards/{canonical_id}/image`: body is a PNG (`Content-Type: image/png`), max 5 MB.
  Validates the PNG signature, writes `images/<canonical_id>.png` in the directory that holds
  `cards.json` (atomic write), sets `card.image`, persists, broadcasts `cards`.
  404 if the card doesn't exist.
- `GET /api/cards/resolve?id=<id>`: returns `{ canonical_id, card: Card | null }` using the
  normal matching rules; no SSE broadcast, no link-mode side effects.
- `GET /images/<file>.png` serves those files (no directory listing; reject `..` and anything
  that isn't `<hex>.png`).
- Deleting a card (via `PUT /api/cards` without it) leaves its image file; harmless.
- `Card` gains `away: bool` (default false), editable through `POST /api/cards`.
  `POST /api/cards/clear-away` sets it false on every card ("Everyone's here").
- A `/tap` of a card with `away: true` clears it (persist + `cards` broadcast) before the tap
  event goes out, so a late kid just checks in.
- Rust unit tests for upsert, resolve, away clearing on tap, image validation, path safety.

### iPhone app (Zoo Tap)

Two modes on the one screen, a segmented control: **Check in** (today's continuous scanning)
and **Register**.

Register flow, one badge at a time:
1. **Scan** (single-read NFC session; it ends after one read). The app asks the server which
   card this badge is with `GET /api/cards/resolve?id=<UID>`, which uses the same matching as
   `/tap` (exact, alias, reversed, 4-byte) without broadcasting a tap. So a card first created
   from a USB-reader tap is still found, and Register edits that card instead of creating a
   duplicate.
2. **Snap**: the camera opens (`UIImagePickerController`, rear camera).
3. **Cutout**: Vision `VNGenerateForegroundInstanceMaskRequest` lifts the sticker off the
   cardstock; the result is trimmed to its bounding box, scaled so the long side is ≤ 600 px,
   and shown on a checkerboard for confirmation. If Vision finds no subject, use the photo
   cropped to the center square and say so. **Retake** is always available.
4. **Name**: a text field (pre-filled when re-registering). The name is what the voice says
   ("Who has the Panda?") and what The List shows.
5. **Cardstock color**: the same swatches as the Mac Setup page (same names and hex values).
6. **Trick** toggle.
7. **Save**: `POST /api/cards` then `PUT /api/cards/{id}/image`. Success shows the cutout
   with "Saved ✓" and a haptic; then "Scan next badge".

An existing card scanned in Register mode shows its current photo, name and color, with
**Retake photo**, **Edit**, and a **💤 Not here today** switch (saved immediately).

The card's `emoji` (still required by the server) is set from a small name→emoji map
(Panda→🐼, Owl→🦉, Bee→🐝, Frog→🐸, Puppy/Dog→🐶, Budgie/Bird→🐦, …), else 🐾.

### Projector page

**Sticker art everywhere.** One helper renders a card's art: the `image` when present
(an `<img>` in 2D scenes, a texture in 3D), else the emoji. Used by Zoo, Zoo Gate (backup),
The List, Who has the ___?, Setup, and Debug.

**New 3D "Zoo" scene (⌥3, kid scene).** Built with three.js like the spike; full-screen canvas
inside the scene root.

- *World:* sky, grass, low-poly trees, a fence around the zoo, the big ZOO archway gate at
  the front, a path from the gate to the playground in the middle.
- *Playground pieces:* a slide, a set of swings (3 seats), a seesaw, a merry-go-round, and open
  grass. Each piece has animation slots (slide: climb + slide loop; swings: pendulum; seesaw:
  two riders; merry-go-round: riders orbit with it; grass: hopping wanderers).
- *Stickers:* flat cutouts (sprites) that always face the camera, keeping each image's aspect
  ratio, with a soft ground shadow. Same on-screen height for every animal.
- *Activity scheduler:* animals inside rotate between pieces every ~10–15 s so it always looks
  busy, with any number of animals from 1 to ~25. Extra animals wander the grass.
- *Arrival (tap of a known badge not yet inside):* the camera swoops to the gate; the sticker
  appears outside; the gate opens with confetti in the badge's cardstock color, a chime, and
  "Welcome, Panda!"; the sticker hops down the path; friends inside bounce with hearts; it
  joins a piece; the camera returns to the overview. ~6–8 s.
- *Queue:* arrivals play one after another. With 2+ waiting, the camera stays on the gate and
  each arrival takes ~3 s (no swoop back between them).
- *Already inside:* that animal jumps and waves where it is; small tick sound; no camera move.
- *Unknown badge:* the gate stays shut; ACCESS DENIED overlay with the silly buzzer and voice
  (same as today).
- *Counter:* "12 of 18 animals are home" with the progress bar, counting cards that are
  neither trick nor away. Trick badges arrive like everyone else. Away animals are not shown
  in the zoo and are not in the party.
- *Finale:* when every non-trick card is in (or on ⌥S), a playground party: all animals jump
  to the middle and dance, fanfare, confetti rain in all the badge colors, voice and big text
  "Congratulations, Official Zookeepers!". Taps after the finale make that animal jump with
  confetti.
- *State:* check-ins persist in browser storage exactly like the current Zoo Gate (survive a
  reload); presenter panel has **Reset check-ins**.
- *Performance:* fixed object counts, no shadows maps (blob shadows), pixel ratio ≤ 2.

**Away cards elsewhere:** Who has the ___? never picks an away card. The List shows away
cards faded with 💤. Setup shows a 💤 marker. The presenter panel gets **Everyone's here**.

**Backup:** the current 2D Zoo Gate scene moves to ⌥6, unchanged except for sticker art.
The two scenes share the same stored check-ins.

### Testing

- Rust: unit tests for upsert, image upload validation, image path safety.
- e2e (Playwright): POST card + upload a PNG → `card.image` set, image served; Zoo scene loads
  with no page errors; tapping updates the counter, queues arrivals, marks the animal inside,
  shows ACCESS DENIED for unknown, finale text appears (driven by state the scene exposes for
  tests, not pixels); The List and Who has the ___? render `<img>` for cards with images;
  720p fits.
- iOS: TapClient checks for the new endpoints (request shapes, response parsing); Vision cutout
  verified by hand on a real sticker; signed build installed over Wi‑Fi.

### Build order

1. Server: `image` field, upsert, image upload/serving + tests.
2. 3D Zoo playground scene with emoji fallback + e2e (works before any photos exist).
3. Sticker art in The List, Who has the ___?, Setup, Debug, backup Zoo Gate.
4. Zoo Tap Register mode with Vision cutout; install on the phone.
5. README and pre-class checklist update.

## Decided by the presenter

- 3D zoo (from the spike); the sticker animal walks in, not a zookeeper character.
- Confetti as each animal goes through the gate.
- Animals join a playground with their sticker friends and are "just happy".
- Real sticker photos, snapped on the phone while registering (approach A).
- Trick badges: photograph a different (spare) sticker and/or pick a different color when
  registering, then flip 🎭 Trick. No special code.
- "Not here today" is set from the phone by scanning the badge being held back.

## Calls made by Claude (to check)

- Playground pieces: slide, swings, seesaw, merry-go-round, open grass.
- Finale = playground party; ⌥S starts it early.
- Counter wording "N of M animals are home"; trick badges excluded from the count.
- Old Zoo Gate kept as a backup on ⌥6.
- Name comes from a text field on the phone; emoji fallback picked from the name.
- Queue speed-up when several kids tap in a row.
- "Not here today" is stored on the server card (survives restarts), cleared by tapping that
  badge or by **Everyone's here**; away cards skipped by Who has, faded in The List.

## Open (to discuss after this ships)

- The ACCESS DENIED case: the presenter wants to talk it through. Until then it behaves as
  today (gate stays shut, silly buzzer, voice).

## Left to the builder

Playground geometry and colors, camera paths and easing, animation timings within the ranges
above, the name→emoji map contents, Swift view structure, exact test layout.
