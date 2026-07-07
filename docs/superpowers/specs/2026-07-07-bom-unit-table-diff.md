---
title: "BOM expand vs UnitConvert — unit table diff (Phase III prep)"
date: 2026-07-07
status: draft — decision recorded for Wave A
parent: docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-kickoff-plan.md
---

# Unit table diff: `bom_expand.convert_qty` vs `UnitConvert.swift`

**Decision D3 (Wave A):** Copy `bom_expand.py` tables **verbatim** into
`BomExpandCompute.convertQty`. Do **not** delegate to `UnitConvert` until Wave A
parity is green, then evaluate merge in P3-2.

---

## Why three unit systems exist

| Module | Base unit | Used by |
|--------|-----------|---------|
| `scripts/lib/bom_expand.py` | volume → **qt**, weight → **lb** | Recipe DAG expansion, BEO cascade |
| `scripts/lib/units.py` / `lib/unitConvert.mjs` | volume → **ml**, weight → **g** | Costing, vendor compare, depletion |
| `LariatModel/UnitConvert.swift` | mirrors JS (`ml` / `g`) | Native costing, depletion, receiving |

BOM expand intentionally uses **coarser qt/lb tables** and **rejects count/pack
units** in `convert_qty` (unless `pack_conversions` on the child recipe). Costing
uses **precise SI anchors** plus count bridge and density cross-dim.

---

## Same-dimension conversions (mathematically equivalent)

Example: 4 cup → qt

- **bom_expand:** `4 * (1/4) / 1.0 = 1.0 qt`
- **UnitConvert:** `4 * 236.5882365 / 946.352946 = 1.0 qt`

Both agree within float noise for units present in **both** tables.

---

## Keys in `bom_expand` but handled differently in `UnitConvert`

| Unit | bom_expand | UnitConvert |
|------|------------|-------------|
| `c` | cup alias (`1/4` qt) | not in synonyms → unknown |
| `#` | weight (`1.0` lb) | not listed |
| `teaspoon` / `tablespoon` | volume aliases | normalized to `tsp` / `tbsp` |
| `floz` vs `fl oz` | both in table | `floz` + synonym `fl oz` |

**Port rule:** Include all `bom_expand` keys including `c` and `#`.

---

## Keys in `UnitConvert` but **absent** from `bom_expand.convert_qty`

| Category | Examples | bom_expand behavior |
|----------|----------|---------------------|
| Count | `ea`, `bag`, `bunch`, `case` | `convert_qty` → **None** |
| Cross-dim | cup → lb | **None** (fail loud or pack_size) |
| Density bridge | flour cup → g | **Not supported** — use `pack_conversions` on recipe |
| Extra weight | `mg` | **None** in bom_expand |

**Port rule:** Do not add count/cross-dim to BomExpandCompute.convertQty — only
same-dimension qt/lb paths + `pack_conversions` reconciliation.

---

## Factor precision

| | bom_expand | units.py / UnitConvert |
|--|------------|------------------------|
| Volume | Normalized to 1 qt (e.g. ml → 0.00105668821 qt) | ml → 946.352946 ml/qt |
| Weight | Normalized to 1 lb | g → 453.59237 g/lb |

Swift port must copy **bom_expand literals exactly** (not re-derived from ml/g tables)
so golden fixtures match at `places=6`.

---

## `pack_conversions` (bom_expand only today)

Recipe index column `pack_size`: `bag:3:qt` means 1 bag = 3 qt yield.

This path is **separate** from `convert_qty`. UnitConvert has
`convertPackSizeToLineUnit` for vendor **pricing** — different contract.

**Port rule:** Port `_reconcile_sub_unit_qty` + index CSV parsing unchanged.

---

## P3-2 merge options (after Wave A green)

| Option | When |
|--------|------|
| Keep separate `BomExpandCompute.convertQty` | Forever acceptable — small surface |
| Generate both table sets from one JSON fixture | P3-2 unit consolidation |
| Delegate volume/weight same-dim to UnitConvert | Only after proving identical outputs on BOM test vectors |

---

## Verification vectors (Wave A must pass)

From `tests/python/test_bom_expand.py` `UnitConversion`:

1. cup → qt sub-recipe reference (mexi_slaw / chipotle_aioli)
2. gal → qt top-level demand (soup)
3. lb → qt **must fail** (UnitMismatchError)

Add Swift tests pinned to Python numeric outputs, not UnitConvert outputs.
