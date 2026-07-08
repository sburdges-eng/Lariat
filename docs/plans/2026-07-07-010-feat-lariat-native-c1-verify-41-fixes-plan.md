---
title: "Phase C1 verify-41 — fix plan (security + parity + coverage)"
date: 2026-07-07
spec: docs/superpowers/specs/2026-07-07-lariat-native-c1-verify-41-design.md
ledger: docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md
branch: feat/lariat-native-c1-verify-41
scope_decision: "max scope (all defects + benign read leaks), one PR"
---

# Context

The verify pass (41/41 rows + 2 VM-gate completeness sweeps) found: the native
**repository** layer is faithful and well-tested, but the SwiftUI **View/ViewModel**
layer — which the repository parity tests never exercise — has per-board gate holes.
User approved **max scope, one PR**. Every fix is TDD (test first, confirm red for
the right reason, minimal green, one commit per task). No web-app or `data/lariat.db`
edits. Never weaken a test.

**Test seam for the read-gate tasks:** guard the ViewModel's poll (`refresh()`/
`start()`) with `PinVerifier().gateConfigured` + active-user check, mirroring
`MorningViewModel.swift:56-91`, so `repo.list()/load()` does **not** fire without an
active PIN. This is unit-testable at the VM level (assert no fetch when gate-on +
no user), unlike a pure `ShowsGatedBoard` View wrapper. Where a View also renders
PHI, additionally hide the sensitive subview behind the same `pinOk`.

Acceptance command (per task): `swift test` from `LariatNative/`, filtered to the
task's test, e.g. `swift test --filter IngredientMastersGate`. Full gate = SPEC
step 5.

# Tasks

## Security — PHI/PII + auth (T1–T4)

### T1 — ingredient-masters: add the missing write gate + read-poll gate
- **Bug:** `IngredientMastersViewModel.swift:72-74` accepts `pinUser ?? …activeUser`
  where nil is valid → a cook with no PIN session writes an audited costing
  `correction`; web 401s. Read poll (`.task → refresh → list()`) also ungated.
- **Fix:** gate `markReviewed` with `ManagementWrite().requireSession` +
  `validateActiveUser` (mirror `PackChangesView.swift:70,92-93`); guard the read
  poll like `MorningViewModel`.
- **Test (red first):** `markReviewed` with gate-on + no active user throws and
  writes zero rows (assert `audit_events`/`ingredient_masters` unchanged); read
  poll with gate-on + no user leaves rows empty / does not query.
- **paths_touched:** `LariatNative/Sources/LariatApp/IngredientMastersViewModel.swift`,
  `LariatNative/Tests/**` (new gate test target/file).
- **MUST NOT modify:** `IngredientMastersRepository.swift` (repo rules verified
  faithful), any web `app/api/**`, other ViewModels.

### T2 — sick-worker: stop rendering PHI to non-PIN viewers
- **Bug:** `SickWorkerRepository.load()` (:38,:49) `SELECT *`; `SickWorkerView.metaLine`
  renders `diagnosed_illness`+`symptoms` unconditionally. Web active list uses a thin
  projection excluding both (PHI only behind PIN history).
- **Fix:** narrow the **active** fetch projection to the web column set
  (`id, shift_date, location_id, cook_id, action, started_at, return_at`) so the
  active `SickWorkerRow` carries no symptoms/diagnosis; keep `SELECT *` only on the
  PIN-gated history path. Also gate `metaLine` PHI behind `pinOk` in the View as
  defense-in-depth.
- **Test (red first):** active `load()` returns rows with nil/empty
  symptoms+diagnosed_illness; history path (PIN) still returns them.
- **paths_touched:** `LariatNative/Sources/LariatDB/SickWorkerRepository.swift`,
  `LariatNative/Sources/LariatApp/SickWorkerView.swift`, `LariatNative/Tests/**`.
- **MUST NOT modify:** the write/clear paths (verified faithful incl. cross-loc guard),
  `SickWorkerCompute.swift` rule math.

### T3 — performance-reviews: gate the HR read
- **Bug:** web `requirePin` even to READ; native reaches `list()` via an ungated
  `NavigationLink` (`CommandView.swift:308`) auto-polling on `.task`.
- **Fix:** poll-guard `PerformanceReviewsViewModel` refresh (gate-on + no active user
  → no fetch, show locked state).
- **Test (red first):** refresh with gate-on + no user does not query; with active
  user, fetches.
- **paths_touched:** `LariatNative/Sources/LariatApp/PerformanceReviewsView.swift`
  (+ its VM if separate), `LariatNative/Tests/**`.
- **MUST NOT modify:** `PerformanceReviewsRepository.swift`, the create path (gated
  correctly per write sweep).

### T4 — host-waitlist: gate the guest-PII read
- **Bug:** web `requirePin` GET + `/api/host` middleware; native
  `HostStandViewModel.swift:54-67` auto-polls `load()` every 5s, reads open by design.
  Leaks party names/phones/notes. *(Note: host-waitlist is outside the original 41 —
  a previously-`✓` write-verified row; the sweep caught the read leak.)*
- **Fix:** poll-guard `HostStandViewModel` refresh like the others.
- **Test (red first):** poll with gate-on + no user does not `load()`.
- **paths_touched:** `LariatNative/Sources/LariatApp/HostStandViewModel.swift`
  (+ `HostStandView.swift`), `LariatNative/Tests/**`.
- **MUST NOT modify:** `HostWaitlistRepository.swift` write/transition paths.

## Benign read leaks — costing/menu IP (T5–T7, user opted in)

> These are self-documented native posture ("costing-tier reads aren't per-view
> gated today"). Same poll-guard fix; no PHI. Overriding the documented posture per
> the user's max-scope choice.

### T5 — pack-changes: read-poll gate
- Poll-guard `PackChangesView`/VM read (write gate already correct). Test + paths as
  T3-shape. MUST NOT modify the acknowledge write path.

### T6 — specials-saved: read-poll gate
- Poll-guard `SpecialsViewModel` `list()`/`get()` (web `hasPinOrTempPin('menu.specials_edit')`
  on GET). Projection parity already holds. MUST NOT modify write/export/promote gates
  (verified). Test.

### T7 — costing depletion-exceptions + variance-attribution: read-poll gates
- Two read-only costing boards, same pattern. MUST NOT touch their (nonexistent) write
  paths or other costing repos. Test each.

## Parity fixes (T8–T9)

### T8 — temp-log: restore the calibration-warning advisory + audit note
- **Bug:** `TempLogRepository.swift:95` hardcodes `calibrationWarning = nil` → the
  `:130` audit-note branch is dead; web computes it, stamps `audit_events.note`, and
  returns the cook advisory.
- **Fix:** compute the warning in `postReading` via the existing
  `HaccpPlanCompute.classifyProbes`/`ProbeCompute` when `probe_id` is given
  (advisory, never blocking); stamp the `calibration_warning:<probe>` note and return
  it (VM→View render path already consumes `result.calibrationWarning`).
- **Test (red first):** a reading citing an overdue/never-calibrated probe returns a
  non-nil `calibrationWarning` and writes the `calibration_warning:` note into
  `audit_events`; an in-range/calibrated probe returns nil (non-blocking either way).
- **paths_touched:** `LariatNative/Sources/LariatDB/TempLogRepository.swift`,
  `LariatNative/Tests/**`.
- **MUST NOT modify:** the CCP temp bounds (verified), the back-date PIN gate,
  `TempLogCompute` band math.

### T9 — promote: reproduce the `menu_item_name` error copy
- **Bug (cosmetic):** web relabels shared-validator `name`→`menu_item_name` in the 400
  body; native surfaces raw "name required"/"name max 200 chars".
- **Fix:** in the promote path, map the `.nameRequired`/`.nameTooLong` message to the
  `menu_item_name` wording (route-local relabel; do not change the shared validator).
- **Test (red first):** promote with blank/over-long menu_item_name yields the
  `menu_item_name …` message, still 400 before any write.
- **paths_touched:** `LariatNative/Sources/LariatDB/SpecialsRepository.swift` (promote
  path only) or a thin promote-local map, `LariatNative/Tests/**`.
- **MUST NOT modify:** `SpecialsValidators.swift` shared copy (other routes depend on
  the raw `name` wording), other specials paths.

## Coverage — parity code present, add the missing tests (T10–T12)

> Test-only tasks: no production behavior change. Red = the assertion the current
> suite lacks; it should pass immediately against existing correct code (if it fails,
> that is a real bug → stop and investigate, do not weaken).

### T10 — cleaning: add `CleaningComputeTests`
- Cover every `CleaningCompute.validateCleaningLog` clip/validation 400 branch
  (area>100, notes>500, completed_at>40+ISO, shift_date YYYY-MM-DD, cook_id>64,
  schedule_id>0) that today only has `missing-task`.
- **paths_touched:** `LariatNative/Tests/LariatModelTests/CleaningComputeTests.swift` (new).
- **MUST NOT modify:** any `Sources/**`.

### T11 — thermometer-calibrations: add `CalibrationComputeTests`
- Cover `CalibrationCompute` validation (thermometer_id required, note>500,
  frequency_days≤0) + the ±2.0°F pass/fail boundary + ice_point=32 + altitude boiling
  point.
- **paths_touched:** `LariatNative/Tests/LariatModelTests/CalibrationComputeTests.swift` (new).
- **MUST NOT modify:** any `Sources/**`.

### T12 — prep-tasks/[id]: assert the audit `{before,after}` payload shape
- Add a test reading `payload_json` for the update (`{before,after}`) and delete
  (`{before}`) audit rows (today only `action`/count are asserted).
- **paths_touched:** `LariatNative/Tests/LariatDBTests/PrepRepositoryTests.swift`.
- **MUST NOT modify:** any `Sources/**`.

## Ledger (T13 — last, after all fixes green)

### T13 — refresh the C1 rule ledger
- Flip all 41 `·` rows to `✓` (or `✓` + resolution note for the fixed refutations);
  correct the 3 stale `✗` cells (L93/94/122) to `✓` with the resolution notes already
  in the prose; update the Summary block (verified 27→68, refuted→0, "verify not run"
  41→0) and drop the "Verification coverage is partial" caveat.
- Add a short **read-gate dimension** subsection: the sweep found VM-layer read/write
  gate holes the original write-focused pass didn't examine; record which are fixed
  here and which are logged.
- Log the **defer/ratify** items as ledger notes (not silently dropped):
  `sync_feed` HACCP omission (unratified — needs an edge-blocker decision like
  receiving's), `reservations` guest-PII open on both web+native (owner note), audit
  payload-shape divergences (perf-reviews key names; tip-pool/wage-notices `{row}`
  wrapping), sound missing native `updateScene`, and the benign costing/menu reads
  now gated by T5–T7.
- **paths_touched:** the two ledger/spec docs.
- **MUST NOT modify:** any `Sources/**` or `Tests/**`.

# Dependencies & ordering
- T1–T12 are independent (distinct files); run in the listed order (security first).
- T1 owns all of `IngredientMastersViewModel` (write+read gate) — no sibling task
  touches it.
- T13 is strictly last (depends on T1–T12 landing green).

# Out of scope (this PR)
- Any web `app/api/**`, `lib/**`, or `data/lariat.db` edit.
- The C5 route deletions themselves (this only makes the ledger safe to act on).
- Building a native `sync_feed` producer (C5-cutover decision, logged in T13).
- Re-verifying the 27 already-upheld rows.
