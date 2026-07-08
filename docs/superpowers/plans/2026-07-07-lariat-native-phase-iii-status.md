---
title: "Phase III P3-1 — live status (read this first)"
date: 2026-07-07
status: active
branch: feat/lariat-native-phase-iii-bom-inprocess
refresh: scripts/dev/phase_iii_status.sh
---

# Phase III status — P3-1 in-process BOM

**Read this file first.** Reference material lives in the kickoff plan and audit specs;
execution steps live in the wave plans.

**North star:** Native assistant + BEO cascade without `python3` spawn (H8 blocker).

---

## Parallel lanes (what blocks what)

| Lane | Blocks Wave A start? | Blocks Wave C wire-up? | Blocks release? |
|------|----------------------|------------------------|-----------------|
| G4 owner scope sign-off | **Yes** | — | — |
| D1 recipe root (packaged) | No | **Yes** | **Yes** (H8) |
| C4 shutoff + ≥7 green days | No | No | **Yes** |
| C5 web route deletion | No | No | **Yes** |
| H7 Phase 2 | No | No | Polish only |

**Prep (Steps 0–5):** complete. **Wave A code:** not started.

---

## Entry gates (G0–G4)

| # | Gate | Status | Evidence / next action |
|---|------|--------|------------------------|
| G0 | Service-day shutoff documented | **FAIL** | Run endgame §2 test; log date + gaps in endgame doc |
| G1 | C1 ledger trustworthy | **PASS** | 71/71 ported-write verified (`2026-07-03-lariat-native-phase-c1-rule-ledger.md`) |
| G2 | `swift test` green | **PASS** | 1021 tests, 0 failures (2026-07-07 local) |
| G3 | H8 packaging path chosen | **FAIL** | `.pkg` works; Developer ID + notarization + D1 open |
| G4 | Owner approves P3-1 scope | **PENDING** | Sign `2026-07-07-phase-iii-decisions-d1-d2-d4.md` |

---

## Holistic bar snapshot

| Track | Status | Notes |
|-------|--------|-------|
| H6 | **COMPLETE** | H6d multi-window on branch `feat/lariat-native-h6d-multi-window` — merge TBD |
| H7 | **PARTIAL** | H7a Phase 1 merged; Phase 2 (~61 files) not started |
| H8 | **IN PROGRESS** | `package-app.sh --pkg` green; GUI smoke + notarization open |

---

## Phase III waves

| Wave | Status | Plan | PR slices |
|------|--------|------|-----------|
| **A** — BomExpand parity | **Not started** | `2026-07-07-lariat-native-phase-iii-wave-a.md` | A1 types+convert → A2 expand → A3 loader |
| **B** — BeoPull + Cascade | Blocked on A | kickoff §1 | — |
| **C** — Wire + delete spawns | Blocked on B + D1 | kickoff §8 | — |

---

## Owner decisions

| ID | Status | Doc |
|----|--------|-----|
| D1 Recipe root (Application Support) | **Proposed** | `specs/2026-07-07-phase-iii-decisions-d1-d2-d4.md` |
| D2 Native spawn Wave C / web Phase D | **Proposed** | same |
| D3 Copy Python unit tables (Wave A) | **Approved** | `specs/2026-07-07-bom-unit-table-diff.md` |
| D4 Keep Python CLIs | **Proposed** | decisions memo |

---

## Oracle health (last recorded 2026-07-07)

| Oracle | Result |
|--------|--------|
| Python `test_bom_expand` + beo | 54 run, 53 pass, 1 skip |
| JS `test-recipe-calculator.mjs` | 5/5 |
| Swift `BeoCascadeClientTests` | 16/16 |
| Fixtures `BomExpand/*.json` | 16 files |
| Spawn p50 → in-process p50 | ~43 ms → ~2 ms |

Refresh: `scripts/dev/phase_iii_status.sh`

---

## Doc index

| Need | File |
|------|------|
| **This status** | `plans/2026-07-07-lariat-native-phase-iii-status.md` |
| Wave A execution | `plans/2026-07-07-lariat-native-phase-iii-wave-a.md` |
| Full architecture map | `plans/2026-07-07-lariat-native-phase-iii-kickoff-plan.md` |
| Fixture catalog | `specs/2026-07-07-bom-expand-fixture-manifest.md` |
| Port scope audit | `specs/2026-07-07-bom-expand-swift-port-audit.md` |
| P3-2+ backlog | `specs/2026-07-07-lariat-native-phase-iii-language-consolidation-backlog.md` |
| Prep baseline | `specs/2026-07-07-phase-iii-prep-baseline.md` |

---

## MACP (when Wave A starts)

```bash
scripts/worktree.sh new cursor feat/lariat-native-phase-iii-bom-inprocess
node scripts/agent-session.mjs update --claimed "LariatNative/Sources/LariatModel/Compute/BomExpandTypes.swift,..."
```

Append session start to `.agent-sessions/handoff.md`. One claim per PR slice (A1/A2/A3).
