# LariatNative H6d — multi-window support (make ⌘N correct)

Date: 2026-07-07
Status: draft (awaiting review)
Parent: `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` §4 (H6 Platform integration)
Siblings: H6a notifications (shipped), H6b printing (shipped), H6c menu-bar extra (shipped, PR #444)

## Goal

Make the macOS app genuinely usable with more than one window open. `⌘N` "New Window" is already
the default `WindowGroup` behavior today, but two app-global pieces of state make a second window
misbehave: (1) board **selection** (`selectedId`/`showingPalette`) is App-level `@State` shared by
every window, so navigating in one window changes the other and two windows cannot show different
boards; and (2) the **active poller** (`BoardPollerHub.shared.active`) is a single global
"most-recently-started poller," so both windows' freshness chip and `⌘R` target whichever board
appeared last anywhere. H6d makes each window navigate independently and gives each window a
freshness chip + `⌘R` + `⌘K` + `⌘1…⌘0` that act on *its own* board. This is the last H6 slice; it
closes the holistic-bar platform-integration item before the Phase C flip. Native-only; no web
parity.

## Non-goals (out of scope this round)

- **New tear-off UI** — no "Open this board in a new window" command/button. `⌘N` (open another
  window, which starts at the default board) is the only entry point this round.
- **Named / restorable / per-board-typed windows**, window-state restoration across launches,
  `Window`/`WindowGroup(id:)` scenes. Over-scope for closing H6.
- **Per-window notification streams or per-window menu-bar extras** — `AlertMonitor` and the H6c
  `MenuBarExtra` stay app-global singletons (one poll, one status item); only their *navigation
  target* is defined (see "App-level navigation").
- **Changing the poll cadence / freshness model** (H5) — H6d only re-scopes *which* poller the
  chip/⌘R address, not how polling works. The per-board poll loops are untouched.
- **iPad / multi-scene on iOS** — `MenuBarExtra` and this window model are macOS-only; iOS keeps
  its single scene.

## Background: what already works vs. what's broken

Verified in the audit:
- Each of **57 board view-models** owns a `private let poller = BoardPoller()`; the view drives it
  with `.task { vm.start() }` / `.onDisappear { vm.stop() }`. The poll **loops run per-VM**, so
  data in a second window is already fresh — the loops don't depend on the global hub.
- `BoardPoller.start()/stop()` self-register into `BoardPollerHub.shared` (`activate`/`deactivate`),
  and `active` = the most-recently-started poller **globally**.
- `BoardPollerHub` is referenced in exactly four places, all rewritten or removed by H6d:
  `BoardPoller.start`, `BoardPoller.stop`, `PollFreshnessIndicator`, and the ⌘R command.
- `selectedId` / `showingPalette` are `@State` on the `LariatApp: App` struct → one instance shared
  by all windows.
- No `FocusedValue` / `focusedSceneValue` / preference plumbing exists yet.

So the **only** defects with two windows are: independent navigation is impossible (shared
selection), and the freshness chip + ⌘R/⌘K/⌘1–0 target the wrong window's board. H6d fixes exactly
those.

## User-facing surface

- `⌘N` opens a second (third, …) window. Each window independently shows and navigates its own
  board via the sidebar, `⌘K` palette, and `⌘1…⌘0` tier jumps — **the key window only**.
- Each window's bottom-trailing **freshness chip** reflects *that window's* current board — including
  a background / second-display window (the H5 wall-mounted case is preserved).
- `⌘R` "Refresh Now" refreshes the **key window's** board (disabled when the key window's board has
  no poller, e.g. a static/aggregate screen).
- H6a notification tap and H6c menu-bar "Open Command Board" / alert-row tap bring the app forward
  and navigate the **primary window** (see below).

No new screens, no new visible controls.

## Data model deltas

None. No tables, columns, or migrations — this is entirely SwiftUI scene/state architecture over
in-memory state.

## Components / architecture

Layering stays directional; because the package has **no `LariatAppTests` target**, this is
predominantly `LariatApp`-layer scene wiring gated by `swift build` + manual multi-window GUI smoke
(same honest posture as H6a/H6b/H6c). The chosen mechanism (user-ratified) is the idiomatic
**publish-up**: boards publish their poller upward; each window consumes its own; app-level commands
read the key window via focus.

1. **`RootWindowView`** (NEW, extracted from `LariatApp.rootView`) — the per-window root. Owns the
   state that must be per-window:
   - `@State selectedId: String? = FeatureRegistry.defaultId`
   - `@State showingPalette = false`
   - `@State activePoller: BoardPoller?` — this window's current board poller, driven by a
     preference (below).
   Builds its own `AppContext` with `navigate: { selectedId = $0 }` (so every board's existing
   `ctx.navigate` is automatically per-window), renders the `NavigationSplitView` + palette sheet +
   the freshness chip (reading `activePoller`, not the global hub) + the `AlertMonitor` `.task`.
   The App's `WindowGroup` body becomes `RootWindowView(database:writeDatabase:catalog:
   catalogError:)`.

2. **Per-window active-poller publication** (NEW):
   - `ActiveBoardPoller` — a tiny `Equatable` wrapper around `BoardPoller?` (identity comparison,
     `===`), so it can be a `PreferenceKey` value and feed `onPreferenceChange`.
   - `ActiveBoardPollerKey: PreferenceKey` — `reduce` = last non-nil wins (only one board occupies
     the detail at a time; the transient both/neither frames resolve to the incoming board / nil).
   - `View.tracksActiveBoard(_ poller:)` — one-line modifier = `.preference(key:…, value:…)`.
     **Adopted by every poller-owning board view** next to its existing `.task { vm.start() }`.
   - Each board VM's `private let poller` becomes **internal** `let poller` (mechanical, so the view
     can read `vm.poller`).
   - `RootWindowView` reads the preference (`.onPreferenceChange` / `backgroundPreferenceValue`) into
     `activePoller` — window-local, so a **background** window's chip stays correct (this is why the
     chip does not use focus).

3. **App-level commands via focus** (NEW `BoardsCommands: Commands`):
   - Replaces the inline `CommandMenu("Boards")` in `LariatApp.body`.
   - `@FocusedValue(\.windowChrome)` and `@FocusedValue(\.activeBoardPoller)` — read the **key**
     window's published values (commands act on the key window; focus is the correct scoping here).
   - `windowChrome` (published by `RootWindowView` via `.focusedSceneValue`) carries the key
     window's `showPalette()`, `jumpToTier(_:)`, and `isModalUp` so ⌘K / ⌘1…⌘0 operate on it.
   - ⌘R → `activeBoardPoller?.refreshNow()`, disabled when nil.

4. **`WindowRouter`** (NEW, `@Observable @MainActor` app-level singleton) — the single target for
   app-level entry points that are not inside any window (the H6c `MenuBarExtra` scene) or are a
   global singleton (H6a `AlertMonitor`). Holds the **primary window's** `navigate` closure (first
   `RootWindowView` to register wins; re-assigned if the primary closes; `nil` → no-op).
   `navigate(id)` activates the app, brings the primary window forward, and calls its `navigate`.
   - `AlertMonitor.start(navigate:)` is wired to `WindowRouter.shared.navigate`.
   - H6c `openCommandBoard()` (in `LariatApp`) calls `WindowRouter.shared.navigate(
     AlertNotificationRouting.commandFeatureId)` instead of mutating a now-per-window `selectedId`.
   App-level navigation targeting the *primary* (not necessarily key) window is an intentional
   simplification for this slice (see Open Questions).

5. **Removals / edits**:
   - **Delete `BoardPollerHub`** and its `activate`/`deactivate` calls from `BoardPoller.start/stop`
     (the poller no longer self-registers globally; it is published per-window via the preference).
   - **`PollFreshnessIndicator`** takes the poller as a parameter (`PollFreshnessIndicator(poller:)`)
     instead of reading `BoardPollerHub.shared.active`; `RootWindowView` passes its `activePoller`.
   - **`MenuBarPanelView`** is unchanged (its `onOpenCommand` closure is what changes, in `LariatApp`).

## Invariants

- **No behavior change for a single window.** One window must look and behave exactly as today
  (same navigation, same chip, same ⌘R/⌘K/⌘1–0).
- **Independent navigation** — selecting/jumping in window A never changes window B's board.
- **Per-window chip correctness** — each window's freshness chip reflects that window's board even
  when the window is not key/frontmost (preserves the H5 wall-mounted-second-display case).
- **Key-window commands** — ⌘R/⌘K/⌘1–0 act on the key window's board; ⌘R disabled when that board
  has no poller.
- **No second poll loop, no extra DB read** — H6d re-scopes an existing pointer; polling is
  unchanged (each board's loop already runs per-VM).
- **Completeness** — *every* poller-owning board view publishes via `.tracksActiveBoard`; a missed
  board would silently lose its chip/⌘R. Enforced by a parity check (adoption count == poller-owning
  VM count), not a naive grep.
- **App-level nav has a defined target** — notification tap + menu-bar open always resolve to the
  primary window (or no-op if none), never to an arbitrary/last window; never crash when zero
  windows are open.
- **No writes** — H6d touches only UI/scene state; no DB, audit, PIN, or money surface.

## Testing

- **No `LariatAppTests` target** → the scene/focus/preference/router wiring is `swift build` + the
  full existing `swift test` staying green (no regression) + a **manual multi-window GUI smoke**:
  - two windows show different boards; navigating one doesn't move the other;
  - each window's chip tracks its own board; a backgrounded window's chip still updates;
  - ⌘R / ⌘K / ⌘1…⌘0 act on the key window only;
  - notification tap + menu-bar "Open Command" navigate the primary window and bring it forward;
  - closing a window (incl. the primary) leaves the others working and app-level nav still resolves.
- **Extract a pure helper only if a real branch emerges** — the one candidate is `WindowRouter`'s
  "which window is primary after one deregisters" (first-remaining) as a pure function over a token
  list in `LariatModel` with a small unit test; the preference `reduce` (last-non-nil) is too
  trivial to be worth a target. Decide at implementation; do not manufacture tests for pure wiring.
- No web oracle — native-only.

## Open questions

1. **App-level nav target** — primary window (this SPEC) vs. the key/frontmost window. Primary is
   simpler and avoids per-window focus tracking for `AlertMonitor`/menu-bar; frontmost is arguably
   more intuitive when several windows are open. Default: **primary**, revisit only if it feels
   wrong in smoke.
2. **`AlertMonitor` start ownership** — it is started from `RootWindowView.task` and guarded to run
   once (first window). If the first window closes, its captured handles stay valid (singleton), but
   confirm the guard + `WindowRouter` indirection means notifications keep working after the
   starting window closes. Verify in smoke.
3. **`onPreferenceChange` concurrency** — the closure is `@Sendable` in recent SDKs; writing
   `@State activePoller` from it may need `backgroundPreferenceValue`/`overlayPreferenceValue`
   instead, or an identity-boxed value. Pick whichever compiles cleanly with no warning at T-time;
   both are equivalent in behavior.
4. **`.tracksActiveBoard` adoption completeness** — 57 poller-owning VMs vs. 52 naive `vm.start()`
   grep hits (differing var/file names). Adoption must be driven by the poller-owning VM list with a
   parity assertion, not the grep. Confirm the exact final count at T-time.
