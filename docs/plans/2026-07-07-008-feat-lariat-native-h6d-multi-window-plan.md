# Plan — H6d LariatNative multi-window (make ⌘N correct)

Date: 2026-07-07
SPEC: `docs/superpowers/specs/2026-07-07-lariat-native-h6d-multi-window-design.md`
Branch (on approval): `feat/lariat-native-h6d-multi-window` (worktree via `scripts/worktree.sh new claude feat/lariat-native-h6d-multi-window`)
Model routing: Sonnet for T1/T2 (new plumbing + mechanical fan-out). **T3 lead-authored / Opus** — it is the architectural integration (scene extraction, focus/preference, hub deletion) and has no unit-test net; non-regulated (no money/PIN/HACCP/audit/schema), so no compliance escalation, but the intricacy warrants the top tier + careful GUI smoke.

## Freeze/impact declaration (per native guide §2)

- **Affected subsystem:** LariatApp shell (scene graph, commands, freshness chip, poller lifecycle). No LariatModel/LariatDB behavior change (one optional pure helper only).
- **Freeze-readiness impact:** none — additive/architectural UI; no Phase C write-route, no schema ownership change.
- **Determinism impact:** none — no cloud dependency, no absolute paths.
- **Security/audit impact:** none — UI/scene state only; no DB writes, no `audit_events`, no PIN/HACCP/money.
- **Acceptance gates:** `swift build` + full `swift test` green (no regression) + documented manual multi-window GUI smoke.

## Task list

### T1 — Per-window plumbing types (new files, inert)
- **Description:** Add the mechanism types, consumed by nobody yet so the build stays green:
  - `ActiveBoardPoller` (Equatable `===`-identity box around `BoardPoller?`).
  - `ActiveBoardPollerKey: PreferenceKey` (reduce = last non-nil wins) + `View.tracksActiveBoard(_ poller:)`.
  - `FocusedValueKey`s: `\.windowChrome` (carries key window's `showPalette()`, `jumpToTier(_:)`, `isModalUp`) and `\.activeBoardPoller`.
  - `WindowRouter` (`@Observable @MainActor` singleton: `register(navigate:)` primary-window wins / re-assign on deregister; `navigate(id)` activates + primary window forward + calls its navigate; no-op when none).
  - OPTIONAL: extract `WindowRouter`'s primary-after-deregister choice as a pure `LariatModel` helper + a small `LariatModelTests` case, **only if** it reads as a genuine branch (else skip — do not manufacture a test for wiring).
- **paths_touched:**
  - `LariatNative/Sources/LariatApp/MultiWindowPlumbing.swift` (new — the boxes/keys/modifier/focused values)
  - `LariatNative/Sources/LariatApp/WindowRouter.swift` (new)
  - (optional) `LariatNative/Sources/LariatModel/Compute/WindowRegistryCompute.swift` + `LariatNative/Tests/LariatModelTests/WindowRegistryComputeTests.swift`
- **MUST NOT modify:** `BoardPoller.swift`, `LariatApp.swift`, `PollFreshnessIndicator.swift`, any board VM/view.
- **Acceptance:** `cd LariatNative && swift build`; optional helper test green.
- **Depends on:** none.

### T2 — Boards publish their poller upward (mechanical fan-out, inert consumers)
- **Description:** Make every poller-owning board publish its poller so a window can read it — nothing consumes it yet, so no behavior change:
  - Expose the poller: `private let poller = BoardPoller()` → `let poller = BoardPoller()` across all **57** VMs (uniform; a single scripted find-replace, then eyeball the diff).
  - Adopt `.tracksActiveBoard(vm.poller)` on **every poller-owning board view**, next to its existing `.task { vm.start() }` (or wherever the board mounts).
  - **Completeness is a parity gate, not a grep:** enumerate the 57 poller-owning VMs → confirm each one's on-screen view adopts the modifier. The naive `vm.start()` grep (52) under-counts (differing var/file names); reconcile the delta explicitly and record the final adoption count.
- **paths_touched:** the 57 `*ViewModel.swift` / board `*View.swift` files under `LariatNative/Sources/LariatApp/` that own a `BoardPoller` (enumerated at task start).
- **MUST NOT modify:** `BoardPoller.swift` (hub removal is T3), `LariatApp.swift`, `PollFreshnessIndicator.swift`, `MultiWindowPlumbing.swift`/`WindowRouter.swift` (T1 done).
- **Acceptance:** `cd LariatNative && swift build`; **parity assertion** (count of `.tracksActiveBoard(` == count of poller-owning VMs); `swift test` full suite unchanged (no behavior change expected).
- **Depends on:** T1 (needs the `.tracksActiveBoard` modifier).

### T3 — Shell integration + hub deletion (atomic; the real switch)
- **Description:** The one commit that flips to per-window. Must be done whole (build is red mid-way):
  - Extract **`RootWindowView`** from `LariatApp.rootView`: move `selectedId` / `showingPalette` / new `activePoller` into it; build its own `AppContext` (`navigate: { selectedId = $0 }`); render NavigationSplitView + palette sheet + `AlertMonitor` `.task`.
  - Per-window freshness: `RootWindowView` reads the `ActiveBoardPollerKey` preference into `activePoller` (use `backgroundPreferenceValue`/`overlayPreferenceValue` or `onPreferenceChange` — whichever compiles warning-clean) and passes it to `PollFreshnessIndicator(poller:)`.
  - Publish focus values: `.focusedSceneValue(\.windowChrome, …)` and `.focusedSceneValue(\.activeBoardPoller, activePoller)`.
  - Replace the inline `CommandMenu("Boards")` with `BoardsCommands: Commands` reading `@FocusedValue(\.windowChrome)` + `@FocusedValue(\.activeBoardPoller)` (⌘K/⌘1–0 via chrome, ⌘R via poller, same `isModalUp` disabling).
  - Register the window in `WindowRouter` (primary = first); wire `AlertMonitor.start(navigate:)` and H6c `openCommandBoard()` through `WindowRouter.shared.navigate`.
  - **Delete `BoardPollerHub`**; remove `activate`/`deactivate` from `BoardPoller.start()/stop()`; rewrite `PollFreshnessIndicator` to take `poller:` instead of reading the hub.
  - The App `body`: `WindowGroup { RootWindowView(...) }.commands { BoardsCommands() }` + the existing `#if os(macOS)` `MenuBarExtra`.
- **Pre-edit:** GitNexus `impact` on `BoardPoller` and `LariatApp` (report blast radius; the BoardPoller change is internal — no start/stop signature change — but warn if HIGH/CRITICAL surfaces anything unexpected).
- **paths_touched:**
  - `LariatNative/Sources/LariatApp/LariatApp.swift`
  - `LariatNative/Sources/LariatApp/RootWindowView.swift` (new)
  - `LariatNative/Sources/LariatApp/BoardPoller.swift` (remove hub calls + delete `BoardPollerHub`)
  - `LariatNative/Sources/LariatApp/PollFreshnessIndicator.swift`
- **MUST NOT modify:** board VMs/views (T2), `MenuBarPanelView.swift` (unchanged — only its injected closure changes, in `LariatApp`), `AlertMonitor.swift` internals beyond the navigate wiring already exposed, any LariatModel/LariatDB.
- **Acceptance:** `cd LariatNative && swift build` + full `swift test` green + **manual multi-window GUI smoke** (checklist below).
- **Depends on:** T1, T2.

### T4 — Docs + memory
- **Description:** Design-doc `Status:` → implemented; native guide "H6 remaining slices" line → **all H6 done, H6d closes it**; update auto-memory `lariat-native-port-status` + `MEMORY.md`.
- **paths_touched:** the H6d design doc, `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`, memory files (outside repo).
- **MUST NOT modify:** any `LariatNative/**` source.
- **Depends on:** T1–T3 landed.

## Manual multi-window GUI smoke (T3 gate)

Run out-of-sandbox against live DB (`swift run LariatApp`, `LARIAT_PIN=0708`):
- [ ] `⌘N` opens a 2nd window; set each to a *different* board; navigating window A does **not** move window B.
- [ ] Each window's freshness chip tracks **its own** board; background a window (focus the other) — its chip still updates.
- [ ] `⌘R` / `⌘K` / `⌘1…⌘0` act on the **key** window only; `⌘R` disabled on a static board.
- [ ] H6a notification tap and H6c menu-bar "Open Command Board" / alert-row tap bring the **primary** window forward and navigate it.
- [ ] Close a non-primary window → others fine. Close the **primary** window → app-level nav still resolves (to a remaining window or no-ops), no crash.
- [ ] Single-window behavior is unchanged from today.

## Dependency order

```
T1 ─→ T2 ─→ T3 ─→ T4
```
Strictly sequential: T2 needs T1's modifier; T3 consumes T1+T2 and is the atomic switch; T4 documents.

## Commit discipline

- One commit per task, `T1:`/`T2:`/`T3:`/`T4:` prefix. `detect_changes({scope:"compare", base_ref:"main"})` (verified against a `git merge-base origin/main HEAD` diff — the compare can false-positive on a drifted fork point, per the port-status lessons) before each commit. Never weaken a failing test. Never push to `main`; never auto-merge — open a PR after T3 gates pass (T4 rides the PR).

## Scope contract (every subagent/implementer dispatch)

```
SCOPE CONTRACT
- task_id: <T#>
- MAY modify: <that task's paths_touched, verbatim>
- MUST NOT modify: <that task's MUST NOT list, verbatim>
- MUST NOT implement: any task other than <T#>. Adjacent temptation → report it, don't fix it here.
```

## Final acceptance gate (before "done")

- `cd LariatNative && swift build && swift test` fully green (paste output).
- Multi-window GUI smoke checklist executed and noted (out-of-sandbox; screenshot-verify if Screen Recording is granted, else user eyeball).
- `detect_changes` (merge-base-scoped) shows only H6d files vs `main`.
- `BoardPollerHub` fully removed (grep = 0 references); every poller-owning board publishes (parity count holds).
