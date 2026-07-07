---
title: "Phase III — language consolidation backlog (post cutover)"
date: 2026-07-07
status: draft — backlog only; do not start before Phase C4/C5 gates
parent: docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md
related: docs/superpowers/specs/2026-07-07-bom-expand-swift-port-audit.md
---

# Phase III — Language consolidation backlog

**When:** After Phase C service-day shutoff, C5 write-route cutover waves, and H8
packaging — not in parallel with C1 verify or schema-ownership flip.

**Goal:** Remove runtime dependencies and duplicate logic without weakening
parity or audit semantics. This is **consolidation**, not language purity.

## Non-goals

- Tauri / Rust shell (conflicts with `LariatNative` endgame).
- Rewriting working T6 pack-size detection or `lib/salesDepletion.ts` for speed.
- Adding a fourth SQL layer (SQLx) alongside better-sqlite3 + GRDB.
- Touching regulated write paths without Opus/Max review and parity oracles.

---

## Priority matrix

| ID | Where | What improves | Target | Priority | Oracle |
|----|-------|---------------|--------|----------|--------|
| **P3-1** | `bom_expand.py` spawn chain | Packaging, tail latency, no system Python on hub Mac | Swift `LariatModel` | **P0** | `tests/python/test_bom_expand.py`, `test-recipe-calculator.mjs`, `test_beo_cascade_cli.py` |
| **P3-2** | `lib/unitConvert.mjs` + `scripts/lib/units.py` + `UnitConvert.swift` | Correctness / drift | Swift SSOT; deprecate duplicates | **P1** | `test-sales-depletion.mjs`, `UnitConvertTests.swift`, fixture generators |
| **P3-3** | `lib/computeEngine/*` (web-only writer) | Phase C architecture | Swift compute + GRDB repos | **P1** | `test-compute-status-route.mjs`, costing/depletion tests |
| **P3-4** | `lib/datapackSearch.ts` semantic/hybrid | Native query packaging | CoreML/MLX in Swift (optional) | **P2** | `test-datapack-search.mjs`, `DatapackSearchComputeTests` |
| **P3-5** | `scripts/ingest_*.py` (Shamrock/Toast/PDF) | Batch throughput | **Keep Python** | **Defer** | ingest scripts + cp1252/xlrd fixtures |
| **P3-6** | `scripts/ingest-costing.mjs` → `ingest_costing.py` | Batch only | **Keep** unless profiling proves bottleneck | **Defer** | ingest-costing tests |
| **P3-7** | Electron desktop wrapper (`docs/desktop-wrapper-design.md`) | Hub Mac supervisor | **Superseded by** `LariatNative` H8 `.pkg` | **Cancel** | — |

---

## P3-1 — BOM expand in-process (lead item)

See full scoped audit:
`docs/superpowers/specs/2026-07-07-bom-expand-swift-port-audit.md`

Summary:

- **Problem:** Web + native shell out to Python on user-facing paths (kitchen
  assistant scale, BEO cascade). H8 notarization wants a self-contained app.
- **Recommendation:** Swift port to `LariatModel/Compute/BomExpandCompute.swift`
  (+ `BeoPullCompute.swift`), not embedded Python, not Rust/Tauri.
- **Estimate:** 48–72 eng-hours (mid confidence); 30 Python unit tests + 5 JS
  integration tests as oracle.

---

## P3-2 — Unit conversion single source of truth

Frozen JS↔Python parity today (`docs/V2_FREEZE_PLAN.md`). Native already has
`UnitConvert.swift` for depletion/costing subset.

**Plan:**

1. Declare Swift `LariatModel/UnitConvert` authoritative for native service day.
2. Generate or sync constants from one golden fixture (do not hand-edit three copies).
3. Leave Python `units.py` for offline ingest until ingest moves or calls Swift CLI.

---

## P3-3 — Compute engine native writer

C1 ledger gap: `triggerComputeEngine` still web-only; native reads snapshots.

**Plan:** Port `rollupRecipeCosts` + accounting variance write path to
`LariatDB` after C1 B3 inventory/costing rows verified. Not a language-speed play —
required for Phase D edge reduction.

---

## P3-4 — Datapack semantic search (optional)

Lexical FTS already native. Semantic uses `transformers.js` + Python-built
`vectors.npy`. Only worth Swift/CoreML if cooks use hybrid search daily.

---

## Explicit rejects (from architecture review 2026-07-07)

| Proposal | Verdict |
|----------|---------|
| Tauri `#[tauri::command]` backend | Wrong stack |
| PyO3 in Rust shell | Fourth runtime |
| SQLx for inventory | Schema drift vs GRDB |
| Serde rewrite of Shamrock ingest | Python ecosystem is the asset |
| Rewrite T6 / sales depletion in Rust | Negative ROI; parity risk |

---

## Acceptance gates (any Phase III item)

1. Parity tests green against frozen web/Python oracle (no weakened assertions).
2. `swift build && swift test` from `LariatNative/`.
3. Spawn call sites removed or behind injectable stub only in tests.
4. H8 packaging smoke: app runs without system `python3` on clean Mac (for P3-1).
5. Opus review for any change touching money, BEO demand, or assistant actions.
