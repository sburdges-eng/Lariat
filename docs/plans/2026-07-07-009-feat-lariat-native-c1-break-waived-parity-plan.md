# Plan — Phase C1 Break waived-meal open-guard parity + ledger refresh

Date: 2026-07-07
SPEC: `docs/superpowers/specs/2026-07-07-lariat-native-c1-break-waived-parity-design.md`
Branch (on approval): `feat/lariat-native-c1-break-waived-parity` (worktree via `scripts/worktree.sh new claude feat/lariat-native-c1-break-waived-parity`)
Model routing: **Opus / lead-authored.** Regulated write-rule (COMPS #39 labor) — the guide mandates Opus for HACCP/labor write-rule changes. The change is confined to one guard's gating condition; adversarially self-review the diff against the web oracle before commit.

## Freeze/impact declaration (per native guide §2)

- **Affected subsystem:** `LariatDB` `BreakRepository.start` (one write rule) + its tests; C1 ledger doc.
- **Freeze-readiness impact:** positive — removes a REFUTED row blocking C5; no schema/ownership change.
- **Determinism impact:** none.
- **Security/audit impact:** the audited-write transaction + `audit_events` insert are untouched; only the open-break guard's gate changes. No PIN/location/actor_source change.
- **Acceptance gates:** `swift build && swift test` green (full suite) + the TDD red→green driver.

## Task list

### T1 — BreakRepository: run the open-break 409 guard unconditionally (parity) + waived-meal tests
- **Description:** Remove the `if waived == 0 { … }` wrapper (BreakRepository.swift:93–105) so the
  open-break lookup + `openBreakExists` throw run for **every** start, matching web
  (`app/api/breaks/route.js:88-96`). The lookup SQL (`ended_at IS NULL AND waived = 0`) is unchanged.
  Update the adjacent comment to state the web-parity intent.
- **TDD (LariatDB has a test target):**
  1. Write `testWaivedMealWhileOpenBreakThrows409` FIRST; run it — confirm it fails because native
     currently **inserts** the waived meal instead of throwing (red for the right reason, not a
     compile error).
  2. Remove the gate → the test goes green.
  3. Add the coverage the ledger flagged as missing: `testWaivedMealStoredAsSingleCompletedRow`,
     `testWaivedNonMealBreakThrows400`, `testWaivedMealWithoutWaiverRefThrows400` (these pass
     immediately — characterization tests; they must stay green).
- **paths_touched:**
  - `LariatNative/Sources/LariatDB/BreakRepository.swift`
  - `LariatNative/Tests/LariatDBTests/BreakRepositoryTests.swift`
- **MUST NOT modify:** the `end`/`load` paths, `BreakCompute`/`evaluateShift`, the INSERT column list,
  the audit envelope, `BreakStartInput`, any BEO/KitchenAssistant file.
- **Pre-edit:** GitNexus `impact` on `BreakRepository` (report blast radius; the change is internal —
  no signature change — but warn on HIGH/CRITICAL).
- **Acceptance:** `cd LariatNative && swift test --filter BreakRepositoryTests` green (incl. the new
  red→green driver); full `swift test` no regression; `git diff` shows only the gate + comment
  changed in the repo (no other logic).
- **Depends on:** none.

### T2 — Refresh the C1 ledger + design-doc status + memory
- **Description:** Update the C1 ledger to match current `main`: BEO `delete_event`/`prep_done` rows →
  **verified + fixed** (predicate + cross-location tests present); KitchenAssistant
  `code_search`/`db_query` → **deferred/edge (documented stub; web env-gated off)**, not "ported";
  Break row → **fixed** (guard unconditional + tests). Recount the summary tallies (REFUTED 3 → 0)
  with an explicit "re-verified 2026-07-07 against `main`" note. Flip the design-doc `Status:` →
  implemented. Update memory (`lariat-native-port-status` + `MEMORY.md`).
- **paths_touched:**
  - `docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md`
  - `docs/superpowers/specs/2026-07-07-lariat-native-c1-break-waived-parity-design.md`
  - memory files (outside repo)
- **MUST NOT modify:** any `LariatNative/**` source.
- **Acceptance:** docs only; ledger tallies internally consistent.
- **Depends on:** T1 landed.

## Dependency order

```
T1 ─→ T2
```

## Commit discipline

- One commit per task, `T1:`/`T2:` prefix. `detect_changes({scope:"compare", base_ref:"main"})` —
  verified against a `git merge-base origin/main HEAD` diff — before each commit. Never weaken the
  red test. Never push to `main`; never auto-merge — open a PR after T1's gates pass (T2 rides the PR).

## Scope contract (every subagent/implementer dispatch)

```
SCOPE CONTRACT
- task_id: <T#>
- MAY modify: <that task's paths_touched, verbatim>
- MUST NOT modify: <that task's MUST NOT list, verbatim>
- MUST NOT implement: any task other than <T#>. Adjacent temptation → report, don't fix here.
```

## Final acceptance gate (before "done")

- `cd LariatNative && swift build && swift test` fully green (paste output; note the new test count).
- The red→green driver's red state was observed and recorded (not skipped).
- `detect_changes` (merge-base-scoped) shows only `BreakRepository.swift` + its tests + docs vs `main`.
- `git diff` proves no change to the audit envelope / end / load / compute — guard-gate + tests only.
