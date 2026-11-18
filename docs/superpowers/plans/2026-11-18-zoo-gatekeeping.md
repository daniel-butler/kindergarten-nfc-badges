# Zoo Gatekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gentle retry for unknown badges, trick-badge class votes, a special-badge finale that starts the party, a tally counter, and a phone Presenter remote.

**Architecture:** The server gains card roles, an `allowed` flag, a presenter-state record and a command endpoint that broadcasts `command` SSE events. The page gains one shared zoo session (state in the browser store, tap routing by role, DOM overlays, tally) used by both zoo scenes, and one command handler fed by keys and SSE. Zoo Tap gains a role picker and a Presenter tab.

**Tech Stack:** Rust (axum 0.8), vanilla JS + three.js r128, Playwright, SwiftUI.

**Spec:** `docs/superpowers/specs/2026-11-18-zoo-gatekeeping-design.md` (builds on `2026-11-17-zoo-playground-design.md`).

## Global Constraints

- Deadline Thursday 2026-11-19; offline; no spoken voice/TTS anywhere.
- Page files: `index.html`, `app.js`, `styles.css`, `vendor/three.min.js` only.
- Rust fmt + clippy `-D warnings` clean; never commit with failing tests; never mask exit codes.
- Roles: `"normal" | "trick" | "special"`; legacy `trick: true` input → `"trick"`.
- Commands: `scene-setup scene-secret scene-zoo scene-list scene-who scene-gate scene-debug toggle-list let-in keep-out allow-special party reset`.
- Keys: ⌥L toggle-list, ⌥Y let-in, ⌥N keep-out, ⌥A allow-special, ⌥S party (zoo scenes), ⌥R reset (double press within 3 s).
- Copy: retry pill `Oops! Tap again 🔄`; vote choices `👍 Let it in` / `👎 Keep it out`; list title `📋 Zoo List`; finale stays `Congratulations, Official Zookeepers!`.
- Kid scenes with the retry pill: zoo, gate, list, who. Secret Number unchanged.

## Review Focus

1. **A tap arriving while a trick vote is on screen** → it waits; after the decision it is processed (no lost or double entries).
2. **Let in / Keep out pressed with no trick waiting** → nothing changes, a small presenter banner says nothing is waiting.
3. **Reset pressed from the phone while the page shows another scene** → the zoo session is still cleared (verified on the next ⌥3).
4. **Special tapped again after Allow but before the list overlay is closed** → overlay closes, special enters, party starts once.
5. **Legacy `cards.json` with `trick: true` and no `role`** → loads as trick; saving writes `role` (Rust test).

---

### Task 1: Server — roles, allowed, presenter state, commands

**Files:** `server/src/registry.rs`, `server/src/taps.rs`, `server/src/main.rs`, `e2e/tests/api.spec.js`, `e2e/tests/helpers.js` (FOX_TRICK → `role: 'trick'`)

**Interfaces — Produces:**
- Rust: `enum Role { Normal, Trick, Special }` (serde lowercase, default Normal); `Card.role`, `Card.allowed: bool` (default false); input-only `trick` alias; `Registry::set_allowed_for_specials(&mut self, allowed: bool) -> Result<(), String>`.
- `struct PresenterState { waiting: Option<Waiting>, last_unknown: Option<Unknown> }`, `Waiting { kind: "trick"|"special", card: Card, raw_id: String, ts: u64 }`, `Unknown { raw_id, ts }`, updated in the `/tap` handler.
- HTTP: `GET /api/presenter`; `POST /api/command {action}` → 200 `{"ok":true}` / 400; SSE `event: command` `data: {"action": "..."}`.

- [ ] Step 1: failing Rust tests: `role_defaults_to_normal_and_legacy_trick_maps_to_trick` (load JSON with `"trick":true`, no role → Trick; serialized JSON has `"role":"trick"` and no `"trick"`), `set_allowed_for_specials_persists`, `presenter_records_waiting_and_unknown` (pure fn `PresenterState::observe(&mut self, raw_id, card: Option<&Card>, ts)`; trick → waiting trick; special not allowed → waiting special; allowed special → waiting cleared; None → last_unknown), `command_names_parse` (`Command::parse("let-in")` ok, `"nope"` → None).
- [ ] Step 2: `cargo test` → compile errors.
- [ ] Step 3: implement; command effects in the handler: allow-special → `set_allowed_for_specials(true)` + cards broadcast; let-in/keep-out → clear waiting if kind trick; reset → `set_allowed_for_specials(false)` + cards broadcast + clear presenter state; then broadcast command.
- [ ] Step 4: `cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings` → pass.
- [ ] Step 5: e2e `api.spec.js`: `role round-trips and legacy trick maps to trick`, `presenter shows waiting trick and last unknown`, `allow-special flips allowed and broadcasts command` (EventSource receives `command` with `allow-special`, GET cards shows `allowed:true`), `reset clears allowed and presenter state`, `unknown command is 400`.
- [ ] Step 6: `npx playwright test tests/api.spec.js` → pass. Commit `Server: card roles, presenter state, command endpoint`.

### Task 2: Shared zoo session — tally, retry, commands, reset

**Files:** `server/static/app.js`, `server/static/styles.css`, `e2e/tests/zoo3d.spec.js`, `e2e/tests/kid-scenes.spec.js`

**Interfaces — Produces (JS globals):**
- `ZooStore` state shape `{ checkedIn: string[], tally: number, tricks: {[id]: 'in'|'out'}, open: boolean }` (old saved state without `tally`/`tricks` loads with `tally = checkedIn.length`, `tricks = {}`).
- `const Commands = { run(action), send(action) }`: `send` POSTs `/api/command` (falls back to `run` for page-only actions if the POST fails); SSE `command` events call `run`. Scene commands call `Badge.show`; zoo commands call the current scene's `onCommand(action)` if it has one; `reset` always clears `ZooStore` then calls `onCommand('reset')`.
- `function tallyMarks(n): HTMLElement` (`.zoo-tally[data-count=n]`, groups of five SVG marks, last mark has class `pop`).
- `function zooRetry(root)` shows `.zoo-oops` "Oops! Tap again 🔄" for 1.5 s with `Sound.boop()`.
- Zoo scenes' `state()` adds `tally`, `pendingVote` (id|null), `listOpen` (bool), `specialDenied` (bool, true while the denial is shown).

- [ ] Step 1: failing e2e (rewrite counter/ACCESS DENIED tests): `normal taps add tally marks` (2 normals → `.zoo-tally[data-count="2"]`), `unknown badge: gentle retry, no buzzer, nobody enters` (spy `Badge.sound.buzzer`; `.zoo-oops` visible with the copy; `.zoo-denied` count 0; buzzer not called; tally 0), same retry test for ⌥6, `party only via special or ⌥S` (all normals in → no finale after 4 s), `Option+S starts the party` (key) and `party command over /api/command`, `reset (⌥R twice) clears tally, check-ins and party`, `reset over /api/command while on ⌥4 clears the zoo` (Review Focus 3), tally survives reload.
- [ ] Step 2: run → fail.
- [ ] Step 3: implement `ZooStore` shape, `Commands`, keys ⌥L/⌥Y/⌥N/⌥A/⌥S/⌥R (double-press banner), `tallyMarks`, `zooRetry`, `Sound.boop`/`Sound.honk`; both zoo scenes show the tally, drop the auto-party rule and use `zooRetry` for unknown.
- [ ] Step 4: full e2e → pass. Commit `Zoo: tally, gentle retry, commands and reset`.

### Task 3: Trick votes

**Files:** `server/static/app.js`, `server/static/styles.css`, `e2e/tests/zoo3d.spec.js`

**Interfaces — Consumes:** Task 2 session/commands. **Produces:** `.zoo-vote` overlay (cardCircle of stored card, `.vote-question` "?", `.vote-yes` "👍 Let it in", `.vote-no` "👎 Keep it out"); `.zoo-goose` bye-bye overlay; `ZooStore.tricks`.

- [ ] Step 1: failing e2e: `trick tap shows the vote with its stored animal`, `let in (⌥Y) → enters with tally +1`, `keep out (⌥N) → goose, no entry, no tally; tapping again shows the goose, not a vote`, `let-in via /api/command`, `a tap during a vote waits and is processed after` (Review Focus 1), `let in with nothing waiting changes nothing` (Review Focus 2: banner `Nothing is waiting`).
- [ ] Step 2: run → fail. Step 3: implement in the shared session (vote pauses the arrival queue). Step 4: full e2e → pass. Commit `Zoo: trick badge votes`.

### Task 4: Special-badge finale and Zoo List

**Files:** `server/static/app.js`, `server/static/styles.css`, `e2e/tests/zoo3d.spec.js`

**Interfaces — Produces:** `.zoo-special-denied` overlay (sticker peeking, `🪿` shaking, `🔒` wobble); `.zoo-list` overlay (`📋 Zoo List`, `.zoo-list-item[data-id]` per inside card, `.zoo-list-new` scribble entry); scene `onCommand('toggle-list')`.

- [ ] Step 1: failing e2e: `special tap: silly denial, nobody enters, no tally`, `allow (⌥A) shows the Zoo List with everyone inside and scribbles the special in; card becomes allowed`, `allowed special tap closes the list, enters, tally +1, party starts` (Review Focus 4), `allow via /api/command`, `⌥L toggles the Zoo List`, `reset sends the special back to denied`.
- [ ] Step 2: run → fail. Step 3: implement. Step 4: full e2e → pass. Commit `Zoo: special badge finale and Zoo List`.

### Task 5: Other scenes, Setup roles, presenter panel

**Files:** `server/static/app.js`, `server/static/styles.css`, `e2e/tests/kid-scenes.spec.js`, `e2e/tests/scenes.spec.js`

- [ ] Step 1: failing e2e: The List and Who has show `.zoo-oops` for unknown (no buzzer; Who has still says "Nope!" for a wrong known badge); Setup role picker (`button.role[data-role=special]`) saves `role: "special"`, strip shows ⭐; panel shows `Last unknown: DEADBEEF` and command buttons that work.
- [ ] Step 2: run → fail. Step 3: implement. Step 4: full e2e → pass. Commit `Retry in List/Who, Setup roles, presenter panel commands`.

### Task 6: Zoo Tap — roles and Presenter tab

**Files:** `ios/ClassroomZoo/TapClient.swift`, `RegisterView.swift`, `ContentView.swift`, new `PresenterView.swift`, `ios/Tests/main.swift`

**Interfaces — Produces:** `CardDTO.role: String` (decodes legacy `trick`), `PresenterDTO { waiting: WaitingDTO?, last_unknown: UnknownDTO? }`, `TapClient.command(_ action: String, server:) async -> Result<Void, Error>`, `TapClient.presenter(server:) async -> Result<PresenterDTO, Error>`, `TapClient.shortcuts: [(key: String, action: String)]`.

- [ ] Step 1: failing Swift checks: role decode (role, legacy trick, default), PresenterDTO decode, shortcuts list non-empty and contains `⌥A`; live (BADGE_SERVER): `command("party")` ok, `command("nope")` fails, upsert trick card + tap it via `/tap` → `presenter()` waiting kind trick.
- [ ] Step 2: run → fail. Step 3: implement client, role picker, Presenter tab (poll 1.5 s while visible, Reset confirmation, Help sheet). Step 4: checks pass; device + simulator builds warning-free; install on the phone. Commit `Zoo Tap: roles and Presenter remote`.

### Task 7: Docs and CI

- [ ] README: roles, lesson flow, retry/vote/special/tally, keys, Presenter tab, reset, checklist (assign roles, rehearse with Reset). Mark the 2026-11-17 spec's ACCESS DENIED/"N of M" parts as superseded.
- [ ] Full run: Rust fmt/clippy/test, Swift checks, e2e → pass. Commit, push, watch CI.
