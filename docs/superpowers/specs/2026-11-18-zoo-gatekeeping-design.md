# Zoo gatekeeping: denial, trick votes, special-badge finale, tally, phone remote

Date: 2026-11-18 · Presentation: Thursday 2026-11-19 · Brainstormed and agreed with the presenter
in a separate session; this doc records that agreement plus the build calls.

## Intent

Replace the red ACCESS DENIED moment with a story the presenter steers live: unknown badges get a
gentle retry, trick badges go to a thumbs-up/down class vote, and one special badge is denied
until the presenter "adds it to the Zoo List", after which its entry starts the party. A tally
replaces the "N of M" counter. The presenter drives all of it from a Presenter tab on the phone,
with keyboard shortcuts on the Mac as the fallback.

New lesson order: mystery badges handed out → kids tap into the zoo → trick badge votes →
special-badge finale → party → kids decorate badges while the presenter takes questions. The
opening uses a bare NFC sticker on ⌥2 Secret Number (no code change).

## Goals

- Card **roles**: `normal`, `trick`, `special` (plus the existing "not here today"), set in the
  projector Setup scene (⌥1) and in Zoo Tap's Register mode.
- **Unknown badges** (no match or ambiguous) in all kid scenes except Secret Number: small
  friendly "Oops! Tap again 🔄" with a soft boop for ~1.5 s. No red, no buzzer, nobody enters.
  The presenter panel and the phone show the raw ID.
- **Tally**: big tally marks in groups of five (four strokes + a diagonal), pop per entry, no
  denominator. +1 for each normal entry, each trick voted in, and the special badge.
- **Trick vote**: tapping a trick badge shows its stored animal + color with a bouncing "?" and two
  big pictures, 👍 "Let in" / 👎 "Keep out". Presenter decides (phone or key). Let in: it
  enters with confetti in its stored color, +1. Keep out: a gatekeeper goose 🪿 waves it bye-bye with
  a silly honk; no tally.
- **Special finale**: (1) tap → nearly wordless denial: the animal peeks at the gate, the goose
  honks and shakes its head, the padlock wobbles, silly sound; gate stays shut. (2) **Allow** →
  a "Zoo List" overlay inside the zoo scene (sticker photos of everyone in) and a pencil scribble
  adds the special badge; its status flips to allowed (persisted on the server). (3) next tap →
  it enters, +1, and **the party starts**. This replaces "everyone present is in" as the party
  trigger; ⌥S still starts the party manually.
- **Phone remote**: Zoo Tap gets a **Presenter** tab (scene buttons, show/hide Zoo List, Let in,
  Keep out, Allow special, Start party, Reset), the last waiting trick/special badge (animal + raw
  ID), the last unknown raw ID, and a **Help** sheet listing every Mac shortcut.
- **Reset** (rehearsals): special back to denied, trick votes cleared, tally and zoo cleared.

## Non-goals

- Counting votes; the presenter eyeballs thumbs.
- A denominator or "everyone's here" auto-party.
- Any spoken voice / TTS (still banned).

## Anti-goals

- Anything that scares or shames a kid holding an unrecognized badge (hence no red, no buzzer).
- A phone hiccup that blocks the show: every phone button has a keyboard equivalent.

## Constraints

Same stack and rules as `2026-11-17-zoo-playground-design.md`: offline, Thursday deadline, page is
`index.html` + `app.js` + `styles.css` + vendored three.js r128, every change tested, never commit
with failing tests, kid scenes bright and nearly wordless.

## Approaches considered

- **Where zoo session state lives** (tally, check-ins, trick votes, party): **in the page, in the
  existing browser store (chosen)**; it already survives reloads and both zoo scenes share it. The
  server keeps only what the phone must see or what must survive a page wipe: card roles, the
  special badge's *allowed* flag, the last waiting badge, the last unknown ID. Moving all session
  state to the server was rejected: more endpoints and migration risk two days out.
- **How commands reach the page**: **one path through the server (chosen)**. A key press and a
  phone button both `POST /api/command`; the server applies its part (allow, reset, clearing the
  waiting badge) and broadcasts a `command` SSE event; the page runs one shared handler. If the
  POST fails (server down), page-only commands run locally. Rejected: separate key and phone
  paths, which would drift.
- **2D Zoo Gate backup (⌥6)**: **shares the same session logic and overlays (chosen)**, so the
  backup behaves identically; only the entry animation differs.

## The design

### Server

- `Card.role: "normal" | "trick" | "special"` (default normal). Legacy `trick: true` on input maps
  to role trick, so existing `cards.json` files keep working. `Card.allowed: bool` (default false),
  meaningful for special cards.
- `GET /api/presenter` → `{ waiting: { kind: "trick"|"special", card, raw_id, ts } | null,
  last_unknown: { raw_id, ts } | null }`. A tap of a trick card, or of a special card that isn't
  allowed yet, sets `waiting`; a tap of an allowed special clears it; an unknown tap sets
  `last_unknown`.
- `POST /api/command { action }`, actions: `scene-setup`, `scene-secret`, `scene-zoo`,
  `scene-list`, `scene-who`, `scene-gate`, `scene-debug`, `toggle-list`, `let-in`, `keep-out`,
  `allow-special`, `party`, `reset`. Unknown action → 400. Server effects: `allow-special` sets
  `allowed` on every special card (persist + `cards` event); `let-in`/`keep-out` clear a trick
  `waiting`; `reset` sets `allowed=false` on special cards (persist + `cards`) and clears `waiting`
  and `last_unknown`. Then it broadcasts `event: command`, `data: { action }`.

### Projector page

- A shared **zoo session** used by the 3D Zoo (⌥3) and the 2D Zoo Gate (⌥6): state (check-ins,
  tally, trick decisions, party) in the browser store; tap routing by role; DOM overlays for the
  retry pill, vote card, goose bye-bye, special denial and Zoo List; the tally display.
- Tap routing in zoo scenes: unknown → retry pill. Away → clears on the server and enters as
  normal (unchanged). Normal → enters, +1. Trick: undecided → vote card (arrivals pause until
  decided); voted in → already inside (bounce); kept out → goose again. Special: not allowed →
  denial; allowed and outside → enters, +1, party after its arrival; inside → bounce.
- Any tap closes the Zoo List overlay first.
- Keys (all Option+): existing ⌥1–⌥6, ⌥0 scenes; ⌥L Zoo List; ⌥Y Let in; ⌥N Keep out;
  ⌥A Allow special; ⌥S Start party (in the zoo scenes; still "next animal" in Who has); ⌥R Reset
  (press twice within 3 s; the first press shows "Press ⌥R again to reset").
- The List and Who has the ___?: unknown → the same retry pill (Who has keeps its silly "Nope!" for
  a *wrong known* badge). Secret Number unchanged.
- Presenter panel: the command buttons, and the last unknown raw ID.
- Setup (⌥1): a three-way role picker (Normal / 🎭 Trick / ⭐ Special) replaces the trick switch;
  strip markers 🎭 and ⭐.
- Sounds: new soft `boop` and goose `honk`.

### Zoo Tap (iOS)

- Register mode: a segmented role picker (Normal / Trick / Special) replaces the trick switch.
- New **Presenter** tab: scene buttons, Zoo List, 👍 Let in, 👎 Keep out, ⭐ Allow special,
  🎉 Start party, 🔄 Reset (confirmation dialog). Polls `/api/presenter` every 1.5 s while open to
  show the waiting badge (sticker or emoji, kind, raw ID) and the last unknown raw ID. **Help**
  opens a sheet listing every Mac shortcut.

### Tests

Per the agreed list: unknown → retry, no buzzer, nobody enters (zoo, gate, list, who); trick →
vote, let in → enters + tally, keep out → none; special → denial, allow → list overlay + role flip,
admitted → party; tally per normal/voted-in trick/special; every command via keyboard and via
`/api/command`; reset restores the start state; roles in Setup and Register; old ACCESS DENIED
and "N of M" tests rewritten. Rust unit tests for roles, legacy trick, presenter state and
commands; Swift checks for the new client calls.

## Calls made by Claude (to check)

- Session state stays in the page; the server holds roles, `allowed`, and the phone's waiting/unknown
  info.
- `allow-special` allows every special card (normally there is one).
- Arrivals pause while a trick vote is on screen.
- ⌥Y/⌥N/⌥A/⌥L/⌥R for the new commands; Reset needs a double press on the keyboard and a
  confirmation on the phone.
- The 2D backup shares the same behavior.
- Secret Number keeps showing unknown badges' numbers (it's the opening demo).
