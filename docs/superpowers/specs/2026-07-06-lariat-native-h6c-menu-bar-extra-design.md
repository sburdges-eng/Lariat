# LariatNative H6c — menu-bar extra (live red/amber signal panel)

Date: 2026-07-06
Status: draft (awaiting review)
Parent: `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` §4 (H6 Platform integration)
Siblings: H6a `2026-07-04-lariat-native-h6a-alert-notifications-design.md` (shipped),
H6b `2026-07-06-lariat-native-h6b-native-printing-design.md` (shipped)

## Goal

Add a macOS **menu-bar extra** — a persistent status item that surfaces the live
`CommandAlert` set (red **and** amber) app-wide, so an operator sees the restaurant's
current red/amber signal picture at a glance even when the main Lariat window is buried behind
other apps. It reuses the H6a `AlertMonitor`'s existing 45s poll as its single data source (no
second poller, no extra DB read) and clicking through jumps to the Command board via the same
routing constant the H6a notification tap already uses. This is the second-to-last H6 platform
slice (native printing H6b shipped; multi-window is deferred to H6d). Native-only capability with
no web equivalent — there is no parity oracle to port.

## Non-goals (out of scope this round)

- **Multi-window (H6d).** Explicitly split out this wave. It carries the only real risk in the
  H6c bundle: `BoardPollerHub.shared.active` is a single global "most-recently-started poller"
  that both ⌘R and `PollFreshnessIndicator` key off, so true multi-window needs a deliberate
  rework to per-window/scene-scoped active tracking. That gets its own wave and its own SPEC.
- **Notification preferences / per-source mute UI** — a settings screen is a separate follow-up
  only if actually wanted (same posture as H6a).
- **Turning Lariat into a menu-bar-only / `LSUIElement` / Dock-hidden app**, or changing what
  happens when the main window closes. The menu-bar extra is purely *additive*; the main window
  stays the primary surface and the Dock icon / activation policy are unchanged.
- **Any change to alert *content* or *sourcing*.** H6c only *displays* the alerts
  `CommandCompute.alertsFor` already produces. No new `CommandAlert` sources, no threshold edits,
  no change to red-vs-amber classification.
- **Any change to H6a notification-firing behavior** — red-only firing, peak/re-arm dedup, and
  permission gating all stay exactly as shipped. H6c adds a *display* consumer of the same poll,
  not a second notifier.
- **Remote/push/cross-device or cross-process alert sync** — purely local to one running app
  instance, same as H6a.

## User-facing surface

One new always-present `MenuBarExtra` scene (macOS only — the scene is `#if os(macOS)`-guarded
because `MenuBarExtra` is unavailable on the package's iOS 17 target).

**Status item (menu bar):**
- An SF Symbol glyph whose tint reflects the worst severity currently present
  (clean / amber-only / red).
- A count badge showing the number of **red** alerts when that count is > 0. Amber never
  contributes to the badge count (consistent with H6a's "red = critical" framing); amber is only
  surfaced inside the panel.

**Dropdown panel (`.menuBarExtraStyle(.window)` — a custom SwiftUI view):**
- **Header:** "Live signals" plus a freshness line derived from `AlertMonitor.lastTickAt`
  ("updated Ns ago", or "—" if it has never ticked).
- **RED section:** each red `CommandAlert` as a row (message + count), red-tinted, reusing the
  existing `CommandView` alert-row visual convention
  (`LariatNative/Sources/LariatApp/CommandView.swift` §363–478).
- **AMBER section:** each amber `CommandAlert`, amber-tinted (`LariatTheme.amber`).
- **All-clear state:** when there are no red or amber alerts, a single calm "All clear" row (no
  empty sections).
- **Actions:** "Open Command Board" and "Refresh Now" (see below). Each alert row is itself
  tappable.

**Behaviors:**
- Tapping an alert row **or** "Open Command Board": activate the app, bring the main window
  forward, and navigate to the Command board via `AlertNotificationRouting.commandFeatureId`
  (`"manager.command"`) — the *same* constant the H6a notification tap uses, so there is one
  routing source of truth. The panel then dismisses (standard menu behavior).
- "Refresh Now": force one immediate `AlertMonitor` tick so the panel reflects fresh data
  without waiting up to 45s. It refreshes the *alert data only*; it does not touch the on-screen
  board's poller (⌘R already owns that) and does not alter H6a's peak/re-arm firing state.

## Data model deltas

None. No new tables or columns, no migration. H6c is a pure in-memory read/display of the alert
set `AlertMonitor` already computes each tick.

## Components / architecture

Layering stays directional (`LariatApp → LariatDB → LariatModel`); all *testable* logic lands in
`LariatModel` because the package has **no `LariatAppTests` target** (only `LariatModelTests` and
`LariatDBTests` — see `Package.swift`). SwiftUI `Scene`/view wiring is therefore `swift build` +
manual GUI smoke, the same posture as H6a's `AlertMonitor.swift` and H6b's view layer.

1. **`MenuBarStatusCompute`** (NEW, `Sources/LariatModel/Compute/MenuBarStatusCompute.swift`) —
   the TDD core. A pure function mapping `[CommandAlert]` to a `MenuBarStatus` value:
   - `redAlerts` / `amberAlerts`: the two severity-partitioned lists, each sorted
     deterministically (count descending, then `source` ascending as a stable tie-break).
   - `redCount` / `amberCount`.
   - `badgeText: String?` — `nil` when `redCount == 0`, else `String(redCount)`.
   - `overall: MenuBarSeverity` — `.clean` / `.amber` / `.red` (worst severity present; red wins
     over amber, amber over clean).
   - `isAllClear: Bool` — no red and no amber.
   No Foundation UI types, no `Date`, no I/O — trivially unit-testable.

2. **`AlertMonitor`** (existing, small additive edit —
   `Sources/LariatApp/AlertMonitor.swift`):
   - Publish observable state the panel binds to: `private(set) var currentAlerts: [CommandAlert]`
     and `private(set) var lastTickAt: Date?`, both assigned at the end of each successful
     `tick(...)` from the **full** `alerts` list (red *and* amber — the tick already computes the
     complete list via `CommandCompute.alertsFor`; today it only forwards it to the firing engine,
     which filters to red internally). Publishing the full list is independent of, and does not
     change, the red-only firing path.
   - Add `func refreshNow()` — triggers one immediate tick (resets the 45s cadence). It must reuse
     the same `db`/`writeDb` handles captured at `start(...)`; if the monitor was never started
     (e.g. DB unavailable) it is a safe no-op.
   - No change to `AlertMonitorEngine`, `NotificationPoster`, permission gating, or the
     peak/re-arm state machine.

3. **`MenuBarPanelView`** (NEW, `Sources/LariatApp/MenuBarPanelView.swift`) — the `.window`-style
   panel. Reads `AlertMonitor.shared` (observable), feeds `currentAlerts` through
   `MenuBarStatusCompute`, renders the RED/AMBER sections + all-clear + freshness + actions.
   Reuses `CommandView`'s red/amber row styling convention (extract a shared row subview *only* if
   it stays clean — otherwise mirror the style locally; no forced refactor). Untestable in-package
   → acceptance is `swift build` + GUI smoke.

4. **`MenuBarExtra` scene + status-item label** (additive edit to `LariatApp.body` —
   `Sources/LariatApp/LariatApp.swift`, `#if os(macOS)`): add a `MenuBarExtra` alongside the
   existing `WindowGroup`, `.menuBarExtraStyle(.window)`, whose custom label reads
   `AlertMonitor.shared` so glyph tint + red-count badge update live, and whose content is
   `MenuBarPanelView`. The navigate closure reuses the app-level `selectedId` `@State` (reachable
   from the App body, exactly as `rootView` builds `AppContext.navigate` inline). Activation for
   "Open Command"/row-taps: `NSApp.activate()` + bring the main window forward, then
   `selectedId = AlertNotificationRouting.commandFeatureId`, reusing the app-delegate activation
   approach already in `LariatAppDelegate`. This is additive shell wiring; it does not touch the
   A0 feature-registration pattern the "never edit LariatApp.swift for board wiring" convention
   protects (that convention is about *board* registration, not shell scenes — H6a's `.task`
   wiring set the same precedent).

## Invariants

- The menu-bar extra **never writes to the database** — read-only display of in-memory alert
  state, same posture as `AlertMonitor` and `CommandView`.
- **Exactly one poller.** The panel renders `AlertMonitor`'s last-computed alerts; H6c introduces
  no second poll loop and no duplicate DB read.
- **Badge counts red only.** Amber is listed in the panel but never contributes to the status-item
  count (consistent with H6a).
- **One routing source of truth.** Opening Command from the menu bar uses the same
  `AlertNotificationRouting.commandFeatureId` constant as the H6a notification tap — no second
  hard-coded id, no drift.
- **`refreshNow()` refreshes alert data only.** It never mutates H6a's peak/re-arm firing state and
  never touches the on-screen board's `BoardPoller`.
- **Additive only.** Adding the `MenuBarExtra` scene must not change existing `WindowGroup`
  behavior, the ⌘K / ⌘R / ⌘1–⌘0 `CommandMenu`, `SheetPresenceMonitor`, or notification firing.
- **Degrades cleanly.** DB unavailable / `AlertMonitor` never started → `currentAlerts` empty →
  panel shows "All clear", status item shows the neutral glyph with no badge, no crash.
- `MenuBarStatusCompute` output is **deterministic** — same input list always yields the same
  ordering (explicit tie-break), so the panel never reorders rows spuriously between ticks.

## Testing

- **`MenuBarStatusComputeTests`** (NEW, `Tests/LariatModelTests/`) — the pure core:
  - empty input → `.clean`, `badgeText == nil`, `isAllClear`, both sections empty.
  - red only → `overall == .red`, `badgeText == "\(redCount)"`, amber section empty.
  - amber only → `overall == .amber`, `badgeText == nil`, red section empty, not all-clear.
  - mixed red+amber → both sections populated, badge == redCount.
  - deterministic sort / tie-break (equal counts fall back to `source` order; a shuffled input
    yields the same output order).
- **`AlertMonitor` additive change** — the diff/peak/re-arm logic stays covered by the existing
  `AlertMonitorTests`; confirm no regression. `currentAlerts`/`lastTickAt` publishing and
  `refreshNow()` are wiring over an already-tested tick; acceptance is a clean `swift build` plus
  the unchanged `AlertMonitorTests` staying green (extract a pure helper only if a genuinely
  branchable decision appears).
- **Scene / panel / status-item label** — `swift build` + a documented manual GUI smoke checklist
  (status item shows/hides badge as alerts change; panel lists red then amber; "Open Command"
  and a row tap both activate + navigate; "Refresh Now" updates freshness; all-clear renders),
  matching the H6a/H6b view-layer posture.
- No web oracle — native-only feature; this is intentional native-over-web divergence, per the
  endgame doc's framing of the holistic bar.

## Open questions

1. **Status-item SF Symbol** — proposed default `fork.knife` (neutral), tinted by `overall`
   severity, red-count badge overlaid. Alternative: `bell` / `exclamationmark.triangle`. Pick at
   T4; low stakes, easily swapped.
2. **Does "Refresh Now" also nudge the on-screen board poller?** Default: **no** — alert data only,
   keeping concerns separate (⌘R already refreshes the active board). Confirm this is the desired
   split.
3. **Publish amber from `AlertMonitor`?** The tick already computes the full red+amber list but
   today only forwards it to the red-only firing engine. H6c publishes the whole list for the
   panel; confirm this is acceptable (it does not change firing).
4. **Shared alert-row subview vs. local mirror** — whether to extract `CommandView`'s alert-row
   style into a shared component or mirror it in `MenuBarPanelView`. Decide at T3 by whichever
   stays cleaner; not a blocking decision.
