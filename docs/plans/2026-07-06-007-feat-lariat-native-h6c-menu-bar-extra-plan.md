# Plan — H6c LariatNative menu-bar extra (live red/amber signal panel)

Date: 2026-07-06
SPEC: `docs/superpowers/specs/2026-07-06-lariat-native-h6c-menu-bar-extra-design.md`
Branch (on approval): `feat/lariat-native-h6c-menu-bar-extra` (worktree via `scripts/worktree.sh new claude feat/lariat-native-h6c-menu-bar-extra`)
Model routing: Sonnet implementer for T1–T4 (default SwiftUI/LariatModel tier); this is non-regulated shell/display work (no money/PIN/HACCP/audit/schema surface), so no Opus escalation required. Opus reviewer optional on T4 shell wiring.

## Freeze/impact declaration (per native guide §2)

- **Affected subsystem:** LariatApp shell (scene graph) + LariatModel compute; H6a `AlertMonitor` (additive read publish).
- **Freeze-readiness impact:** none — additive, no Phase C write-route, no schema ownership change.
- **Determinism impact:** none — no cloud dependency, no absolute paths; `MenuBarStatusCompute` is pure.
- **Security/audit impact:** none — read-only display; no DB writes, no `audit_events`, no PIN/HACCP/money math touched.
- **Acceptance gates:** `swift build && swift test` green from `LariatNative/` + documented manual GUI smoke.

## Task list

### T1 — `MenuBarStatusCompute` (pure core, TDD)
- **Description:** Add `MenuBarStatusCompute` + `MenuBarStatus` / `MenuBarSeverity` in LariatModel:
  partition `[CommandAlert]` into deterministically-sorted `redAlerts`/`amberAlerts` (count desc,
  then `source` asc), derive `redCount`/`amberCount`, `badgeText` (nil at redCount 0 else
  `String(redCount)`), `overall` (`.clean`/`.amber`/`.red`), `isAllClear`.
- **TDD:** write `MenuBarStatusComputeTests` FIRST; confirm red for the right reason (missing type),
  then implement to green. Cases: empty→clean; red-only; amber-only; mixed; deterministic tie-break.
- **paths_touched:**
  - `LariatNative/Sources/LariatModel/Compute/MenuBarStatusCompute.swift` (new)
  - `LariatNative/Tests/LariatModelTests/MenuBarStatusComputeTests.swift` (new)
- **MUST NOT modify:** `CommandCompute.swift` (no alert-logic change), `AlertMonitorEngine.swift`,
  `AlertMonitorCompute.swift`, any `LariatApp/**` file.
- **Acceptance:** `cd LariatNative && swift test --filter MenuBarStatusComputeTests` green;
  `swift build`.
- **Depends on:** none.

### T2 — `AlertMonitor` publish `currentAlerts` + `lastTickAt` + `refreshNow()`
- **Description:** Additive edit to the existing H6a singleton: at the end of each successful
  `tick(...)`, assign observable `private(set) var currentAlerts: [CommandAlert]` (full red+amber
  list) and `private(set) var lastTickAt: Date?`. Add `func refreshNow()` that forces one immediate
  tick using the `db`/`writeDb` captured at `start(...)` (safe no-op if never started). No change to
  the firing engine, permission gating, or peak/re-arm semantics.
- **Pre-edit:** run GitNexus `impact({target: "AlertMonitor", direction: "upstream"})`; report blast
  radius (expected: `LariatApp.rootView` `.task` start site only). Warn if HIGH/CRITICAL.
- **paths_touched:**
  - `LariatNative/Sources/LariatApp/AlertMonitor.swift`
- **MUST NOT modify:** `AlertMonitorEngine.swift`, `AlertMonitorCompute.swift`,
  `NotificationPoster.swift`, `AlertNotificationDelegate.swift`, `CommandCompute.swift`.
- **Acceptance:** `cd LariatNative && swift build`; `swift test --filter AlertMonitorTests` still
  green (no regression). If a branchable decision emerges, extract a pure helper + test it.
- **Depends on:** none (parallelizable with T1).

### T3 — `MenuBarPanelView` (the `.window` panel)
- **Description:** New SwiftUI view bound to `AlertMonitor.shared`; feed `currentAlerts` through
  `MenuBarStatusCompute`; render header + freshness (from `lastTickAt`), RED section, AMBER section,
  all-clear state, and the two action buttons. Reuse `CommandView`'s red/amber row visual
  convention (extract a shared row subview only if it stays clean; else mirror locally). Row tap +
  "Open Command Board" call the navigate closure with
  `AlertNotificationRouting.commandFeatureId`; "Refresh Now" calls `AlertMonitor.shared.refreshNow()`.
- **paths_touched:**
  - `LariatNative/Sources/LariatApp/MenuBarPanelView.swift` (new)
  - (optional, only if extraction stays clean) a shared alert-row subview file — declare it here
    before extracting; otherwise mirror the style locally.
- **MUST NOT modify:** `LariatApp.swift` (scene wiring is T4), `AlertMonitor.swift`,
  `CommandView.swift` (unless a clean shared-row extraction is chosen — then note it and keep
  `CommandView` rendering visually identical).
- **Acceptance:** `cd LariatNative && swift build`.
- **Depends on:** T1 (uses `MenuBarStatusCompute`), T2 (reads `currentAlerts`/`lastTickAt`).

### T4 — Wire `MenuBarExtra` scene into `LariatApp.body`
- **Description:** Add, under `#if os(macOS)`, a `MenuBarExtra` alongside the existing `WindowGroup`
  with `.menuBarExtraStyle(.window)`. Custom label reads `AlertMonitor.shared` → glyph tinted by
  `overall`, red-count badge from `badgeText`. Content is `MenuBarPanelView` wired with a navigate
  closure that sets `selectedId` and an activation step (`NSApp.activate()` + main window forward),
  reusing the `LariatAppDelegate` activation approach. Panel dismisses after navigating.
- **Pre-edit:** run GitNexus `impact({target: "LariatApp", direction: "upstream"})` (or on `body`);
  report blast radius; warn if HIGH/CRITICAL before editing.
- **paths_touched:**
  - `LariatNative/Sources/LariatApp/LariatApp.swift`
  - (optional) `LariatNative/Sources/LariatApp/MenuBarLabel.swift` (new) if the label needs its own
    small view — declare before creating.
- **MUST NOT modify:** the existing `WindowGroup` `rootView` behavior, the `CommandMenu("Boards")`
  block, `SheetPresenceMonitor`, `AlertMonitor` internals, any board/view-model file.
- **Acceptance:** `cd LariatNative && swift build` + **manual GUI smoke** (documented checklist:
  status item shows/hides red badge as alerts change; panel lists red then amber; all-clear renders;
  "Open Command Board" and an alert-row tap both activate the app + navigate to Command; "Refresh
  Now" updates the freshness line). Run via the `run-lariat` skill / `swift run LariatApp`.
- **Depends on:** T3, T2.

### T5 — Docs + status update
- **Description:** Flip the H6c design-doc `Status:` to shipped; update the endgame /
  `LARIAT_NATIVE_FINAL_AGENT_GUIDE.md` "H6 remaining slices" line (line ~55) to record menu-bar
  extra done, multi-window (H6d) remaining; update the auto-memory `lariat-native-port-status`.
- **paths_touched:**
  - `docs/superpowers/specs/2026-07-06-lariat-native-h6c-menu-bar-extra-design.md`
  - `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`
  - memory: `~/.claude/projects/-Users-seanburdges-Dev-hospitality-Lariat/memory/lariat-native-port-status.md` + `MEMORY.md`
- **MUST NOT modify:** any `LariatNative/**` source.
- **Acceptance:** docs only; no build gate. (Not a code commit — bundle into the final housekeeping
  commit or the PR body.)
- **Depends on:** T1–T4 landed.

## Dependency order

```
T1 ─┐
    ├─→ T3 ─→ T4 ─→ T5
T2 ─┘        ↑
             └── (T2 also feeds T4's label)
```

T1 and T2 are independent (parallelizable). T3 needs both. T4 needs T3 (+T2). T5 last.

## Commit discipline

- One commit per task, prefix with the task id: `T1: …`, `T2: …`, `T3: …`, `T4: …`, `T5: …`.
- Run `detect_changes({scope: "compare", base_ref: "main"})` before each commit — confirm only the
  task's `paths_touched` symbols/flows changed. Never weaken or delete a failing test to green it.
- Never push to `main`; never auto-merge. Open a PR after T4's gates pass (T5 docs can ride the PR).

## Scope contract (applies to every subagent/implementer dispatch)

```
SCOPE CONTRACT
- task_id: <T#>
- MAY modify: <the paths_touched globs for that task, verbatim>
- MUST NOT modify: <that task's MUST NOT list, verbatim>
- MUST NOT implement: any task other than <T#>. Adjacent bug/temptation → write it in
  the report, do not fix it in this commit.
```

## Final acceptance gate (before "done")

- `cd LariatNative && swift build && swift test` fully green (paste output — no "done" without it).
- Manual GUI smoke checklist from T4 executed and noted.
- `detect_changes` shows only H6c-scoped changes vs `main`.
- No regression in `AlertMonitorTests`, `CommandComputeTests`, or the wider suite.
