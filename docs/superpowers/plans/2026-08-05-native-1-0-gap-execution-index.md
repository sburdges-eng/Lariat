---
title: "Native 1.0 / ops gap — execution plan index"
date: 2026-08-05
status: active — plans authored; Front 0 in progress
canonical_id: native-1-0-gap-plans
parent: docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md
taxonomy: docs/NATIVE_RELEASES_AND_TAXONOMY.md
---

# Native 1.0 / ops gap — execution plan index

Single map from the 2026-08-05 gap audit to executable fronts. Do not reopen
finished H6 / H7a Phase 2 / Native 0.2 L1 wave code.

**Taxonomy:** [`docs/NATIVE_RELEASES_AND_TAXONOMY.md`](../../NATIVE_RELEASES_AND_TAXONOMY.md)

---

## Order of attack

| # | Front | Blocks | Plan | Owner gate? |
|---|-------|--------|------|-------------|
| **0** | GUI smoke (Native 0.2) + G0 shutoff | Native 0.2 freeze claim; C4 start | [`2026-08-05-g0-gui-smoke-and-shutoff.md`](2026-08-05-g0-gui-smoke-and-shutoff.md) | **Yes — Mac GUI + service day** |
| **1** | H8 notarization / Developer ID | Native 1.0 distribution | [`2026-08-05-h8-notarization.md`](2026-08-05-h8-notarization.md) | Yes — identity |
| **2** | C4 reconcile (≥7 green days) | C5 | [`2026-08-05-c4-reconcile.md`](2026-08-05-c4-reconcile.md) | Yes — ops window |
| **3** | C5 write-route cutover | Phase D | [`2026-08-05-c5-write-cutover.md`](2026-08-05-c5-write-cutover.md) | Opus/Max review |
| **4** | Phase D edge reduction | Phase E | [`2026-08-05-phase-d-edge-reduction.md`](2026-08-05-phase-d-edge-reduction.md) | After C5 |
| **5** | Phase E consolidation | — | [`2026-08-05-phase-e-consolidation.md`](2026-08-05-phase-e-consolidation.md) | ☠ per-batch confirm |
| **P1** | Costing confidence UI | Operator trust | [`2026-08-05-costing-confidence.md`](2026-08-05-costing-confidence.md) | Design approval |
| **P2** | Purchase-record consolidation | Spend truth | [`2026-08-05-purchase-consolidation.md`](2026-08-05-purchase-consolidation.md) | Design approval |
| **P3** | BEO batch flooring → native | Web/native order-guide parity | [`2026-08-05-beo-batch-flooring-native.md`](2026-08-05-beo-batch-flooring-native.md) | No |
| **P4** | Master product catalog land | Vendor price ingest | PR #604 + [`2026-08-05-master-catalog-land.md`](2026-08-05-master-catalog-land.md) | Review |
| **P5** | Web `/v2` Stage 1 cook pilot | Stage 2 manager | [`2026-08-05-v2-stage1-pilot.md`](2026-08-05-v2-stage1-pilot.md) | In-person devices |
| **P6** | Ops polish bag | Hygiene | [`2026-08-05-ops-polish-bag.md`](2026-08-05-ops-polish-bag.md) | Mixed |

Parallel lanes: **0 ∥ 1 ∥ P\*** once Front 0 checklists exist. **2 → 3 → 4 → 5** are serial.

---

## Already done — do not re-open

| Item | Evidence |
|------|----------|
| Native 0.2 L1 Waves A/B/C code | PR #448; `2026-07-07-native-0.2-l1-status.md` |
| H6a–H6d platform integration | #428, H6b/c merges, H6d #445 |
| H7a Phase 1 + Phase 2 (10 tiers) | #430, #432–#441 |
| C1 ledger 71/71 | `2026-07-03-lariat-native-phase-c1-rule-ledger.md` |
| C2 SchemaMigrator + C3 ActorSource (pre-flip) | build artifacts on `main` |
| BEO cascade `warnings` web + native passthrough | #544, #552 |
| First-PIN bootstrap on a fresh install | #606 |

### Unconfigured-install lane (landed after this index was authored)

Web made `pinRequiredForPic()` unconditionally `true` on 2026-07-28; native
matched it the same week. An install with **no** manager PIN now refuses
manager-tier reads and writes instead of opening them.

| Change | PR |
|--------|-----|
| Fresh install can set its first manager PIN | #606 (merged) |
| Manager-tier reads refuse when no PIN is configured | #607 |
| Shows reads + write attribution refuse likewise | #609 (closes #608) |

Front 0 Part B depends on this — see its B1 prerequisite. Anything that
re-opens a board on an unconfigured install is a regression, not a fix.

---

## Status sync rule

When a front exits, update in the **same PR**:

1. This index (status column / checkbox)
2. `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md` “What still blocks”
3. `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md` (if L1/G0/H8)
4. Endgame DoD in `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` when a §5 box flips

---

## Cloud / headless limit

Front **0** GUI smoke and service-day shutoff **cannot** be completed in a Linux
cloud agent. Agents prepare checklists, package scripts, and log templates;
the owner (or a macOS session) fills the pass/fail boxes and signs the G0 log.
