---
title: "Native 0.2 L1 prep baseline — oracle + spawn timing"
date: 2026-07-07
status: recorded
canonical_id: native-0.2-l1
deprecated_alias: phase-iii
parent: docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md
machine: local dev (darwin), repo at ~/Dev/hospitality/Lariat
---

# Native 0.2 L1 prep baseline (Steps 1 + 5)

> **Terminology:** [`docs/NATIVE_RELEASES_AND_TAXONOMY.md`](../../NATIVE_RELEASES_AND_TAXONOMY.md)

Recorded before any L1 implementation. Re-run after L1 Wave C for comparison.

---

## Step 1 — Oracle test runs

### Python (primary oracle)

```bash
python3 -m unittest tests.python.test_bom_expand \
  tests.python.test_beo_pull tests.python.test_beo_cascade_cli -v
```

| Result | Detail |
|--------|--------|
| **54 run, 53 pass, 1 skip, 0 fail** | 0.183s wall |
| Skip | `ManifestFromCsvs` canary when costing CSVs absent in minimal checkout |

### JavaScript integration (real recipes on disk)

```bash
node --experimental-strip-types --test tests/js/test-recipe-calculator.mjs
```

| Result | Detail |
|--------|--------|
| **5/5 pass** | ~159ms suite (includes Python spawn) |
| Slowest test | `scales a recipe to the exact leaf totals` ~64ms |

### Swift (wrapper parity only — no BOM math yet)

```bash
cd LariatNative && swift test --filter BeoCascadeClientTests
```

| Result | Detail |
|--------|--------|
| **16/16 pass** | ~6ms test body |

---

## Step 5 — Spawn vs in-process timing (n=10)

Environment: `python3`, repo root `/Users/seanburdges/Dev/hospitality/Lariat`,
~77 normalized recipe CSVs.

### `bom_expand_cli.py`

Payload: `{"recipe_slug":"pork_chop_marinade","multiplier":2,"root":"<repo>"}`

| Metric | ms |
|--------|---:|
| min | 37.0 |
| p50 | 43.4 |
| p95 | 46.8 |
| max | 74.6 |
| mean | 44.5 |

### `beo_cascade_cli.py`

Payload: `{"line_items":[{"item_name":"Mac and Cheese","quantity":40}],"root":"<repo>"}`

| Metric | ms |
|--------|---:|
| min | 38.4 |
| p50 | 40.1 |
| p95 | 41.6 |
| max | 44.4 |
| mean | 40.0 |

### In-process Python (load manifest + expand, no spawn)

Same slug/multiplier as BOM CLI (`pork_chop_marinade`, 2×, unit `gal`):

| Metric | ms |
|--------|---:|
| min | 1.9 |
| p50 | 2.1 |
| p95 | 2.5 |
| max | 2.6 |
| mean | 2.2 |

---

## Interpretation

| Observation | Implication for Native 0.2 L1 |
|-------------|---------------------------|
| Spawn p50 **~40–43 ms** vs in-process p50 **~2 ms** | **~20×** overhead is process startup + JSON CLI, not graph walk |
| BEO cascade not slower than single expand | Cascade cost is dominated by same manifest load + spawn |
| JS integration test ~64ms | User-visible assistant action includes full spawn path |
| 5s / 15s timeouts | Far above p95 today — timeouts guard broken env, not normal latency |

**L1 Wave C target:** In-process + manifest cache → repeat calls **<5 ms** after warm load.

---

## Step 2 artifact

Unit table diff: `docs/superpowers/specs/2026-07-07-bom-unit-table-diff.md`

**Decision D3:** Copy bom_expand tables verbatim for Wave A; defer UnitConvert merge to P3-2.

---

## Kickoff checklist status

| Step | Status |
|------|--------|
| 0 Gates | **Snapshot recorded** 2026-07-07 (G0/G3/G4 open; G1/G2 pass) — kickoff plan §0 |
| 1 Oracle baseline | **Done** (this doc) |
| 2 Unit table diff | **Done** |
| 3 Fixture manifest | **Done** — 16 JSON files + `docs/superpowers/specs/2026-07-07-bom-expand-fixture-manifest.md` |
| 4 Decision log | D3 done; **D1/D2/D4 proposed** — `docs/superpowers/specs/2026-07-07-phase-iii-decisions-d1-d2-d4.md` (owner sign-off pending) |
| 5 Perf baseline | **Done** (this doc) |
| 6 Wave A code | Not started |

---

## Step 3 — Fixture export (2026-07-07)

```bash
python3 scripts/dev/export_bom_expand_fixtures.py
```

| Output | Count |
|--------|------:|
| `LariatNative/Tests/Fixtures/BomExpand/*.json` | 16 (15 §5.2 + canary) |

Regenerate after `bom_expand.py` or oracle test changes. Full manifest catalog:
`docs/superpowers/specs/2026-07-07-bom-expand-fixture-manifest.md`.
