---
title: "Phase 4 Evidence — verify Native 0.2 freeze"
date: 2026-07-10
status: automated gates PASS — GUI smoke owner-pending
contract: ~/Dev/00_AI Engineering Delegation Contract.pdf
architecture: docs/superpowers/plans/2026-07-10-phase2-architecture-verify-0.2.md
autonomy: level 2
---

# Phase 4 — Verification evidence (verify-0.2)

## Summary

Native 0.2 L1 (in-process BOM/BEO, native spawn deletion) is **automated-verified** on `main` @ `3e1f283` (L1 landed via PR #448). Status docs repaired. **Owner GUI smoke** remains the only open DoD checkbox for a full freeze claim.

## Gates

| Gate | Result | Evidence |
|------|--------|----------|
| `swift build` | **PASS** | 2026-07-10; build complete |
| `swift test` (full) | **PASS** | **1021 tests, 0 failures** (~8.1s XCTest) |
| `swift test --filter BomExpand` | **PASS** | 17 tests, 0 failures |
| Python oracles | **PASS** | 54 run, OK (1 skip) — bom_expand + beo_pull + beo_cascade_cli |
| JS `test-recipe-calculator.mjs` | **PASS** | 5/5 (web edge still spawns; expected per D2/D4) |
| Status doc truth | **PASS** | `2026-07-07-native-0.2-l1-status.md` + taxonomy updated |
| GUI smoke (no python3) | **PENDING owner** | Checklist below |

### Tooling note

Trailing `Test run with 0 tests` lines from the Swift Testing harness are **noise**, not a failed suite. Authoritative count is XCTest **1021**.

## Wiring spot-check (static)

- `KitchenAssistantViewModel` constructs `NativeBomCalculator()` (not Python spawn).
- `AssistantSupport.swift` documents `PythonBomCalculator` as removed.
- `BeoCascadeClient` default runner marked in-process (L1 Wave C).
- D1-B tree present on this Mac:
  - `~/Library/Application Support/Lariat/recipes/recipe_index.csv`
  - `~/Library/Application Support/Lariat/menus/beo_recipe_map.csv`
- Ad-hoc app bundle present: `LariatNative/build/Lariat.app`

## Owner GUI smoke checklist (V4)

From `LariatNative/Scripts/PACKAGING.md` (notarization **not** required for this verify front):

1. [ ] Quit any running Lariat; clear `LARIAT_ROOT` / `LARIAT_DATA_DIR` if set in the shell you use to launch.
2. [ ] Double-click `LariatNative/build/Lariat.app` (or `open "/Users/seanburdges/Dev/hospitality/Lariat/LariatNative/build/Lariat.app"`).
3. [ ] Kitchen assistant: run a `scale_recipe` / scale action that returns leaf rows.
4. [ ] BEO board: run cascade; confirm order guide + prep demands.
5. [ ] Activity Monitor during (3)–(4): **no `python3`** process spawned by Lariat.

Reply `smoke pass` or `smoke fail <note>` when done.

## Files changed (Phase 3)

| File | Change |
|------|--------|
| `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md` | Truth repair — Waves A/B/C DONE |
| `docs/NATIVE_RELEASES_AND_TAXONOMY.md` | Native 0.2 status → code-complete |
| `docs/superpowers/plans/2026-07-10-phase4-verify-0.2-evidence.md` | This evidence pack |
| Phase 1/2 plan status fields | Updated as needed |

**No Swift/TS product code changed.**

## Assumptions / limitations

- Worktree skipped (edit guard on `Lariat-worktrees`); docs edited on dirty `main` checkout — only claimed doc paths.
- Dirty unrelated WIP (`desktop/`, `app/v2/*`, caches) left untouched.
- Full freeze = automated PASS + owner smoke PASS.

## Phase 5 readiness

Integrate (commit/PR) **docs-only** when owner wants. Do not mix with dirty desktop/v2 WIP.

## Handoff

| Field | Content |
|-------|---------|
| Inputs | Approved Phase 2; U1=verify-0.2 |
| Outputs | Green gates; repaired status; this evidence |
| Decisions made | None irreversible |
| Tests | Listed above |
| Unresolved | Owner GUI smoke; H8 notarization; G0/C4 for Native 1.0 |
| Interfaces | None modified |
