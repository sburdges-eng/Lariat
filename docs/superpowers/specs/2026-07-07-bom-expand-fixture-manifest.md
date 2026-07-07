---
title: "BomExpand golden fixture manifest (Phase III Wave A oracle)"
date: 2026-07-07
status: exported
parent: docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-kickoff-plan.md
export_script: scripts/dev/export_bom_expand_fixtures.py
output_dir: LariatNative/Tests/Fixtures/BomExpand/
---

# BomExpand fixture manifest

16 JSON files (15 §5.2 minimum + 1 §5.3 canary). Regenerate:

```bash
python3 scripts/dev/export_bom_expand_fixtures.py
```

Swift tests load fixtures by `id` field; compare leaves/nodes at `tolerance_places` (default 6).

---

## JSON schema (`schema_version: 1`)

```json
{
  "schema_version": 1,
  "id": "<fixture_id>",
  "source_test": "<python or js test pointer>",
  "manifest": { "<slug>": { "slug", "display_name", "yield_qty", "yield_unit",
    "sub_recipe_slugs", "bom[]", "allergens", "pack_conversions" } },
  "input": { "mode": "...", "...": "..." },
  "expect": { "leaves"|"nodes"|"error"|"warnings": "..." }
}
```

### `input.mode`

| Mode | Required fields | `expect` shape |
|------|-----------------|----------------|
| `expand_recipe` | `slug`, `qty`, `unit`; optional `collect_warnings` | `leaves` or `error` + `warnings` |
| `aggregate_demand` | `demands`: `[[slug, qty, unit], ...]` | `leaves` or `error` |
| `expand_recipe_demand` | `demands` | `nodes`: `[[slug, unit, qty], ...]` |
| `find_manifest_warnings` | (none) | `warnings` array from `find_manifest_warnings` |

### Error fixtures

```json
"expect": {
  "error": "UnitMismatchError",
  "message_contains": ["queso_mac_sauce", "bag"]
}
```

---

## Fixture catalog (§5.2 — 15 files)

| ID | Source test | Input summary | Expected outcome |
|----|-------------|---------------|------------------|
| `single_leaf_scale` | `ExpandLeafOnly::test_single_leaf_recipe_scales_linearly` | `blackened_tomato_salsa` × 10 qt | Leaves: `roma tomatoes` 5669.9 g, `lime juice` 59.147 ml |
| `queso_embeds_salsa` | `ExpandWithSubRecipe::test_queso_expansion_pulls_salsa_leaves` | `queso_mac_sauce` × 22 qt | Leaves: milk 7570.82 ml, tomatoes 1133.98 g, cilantro 0.2 cup |
| `queso_plus_standalone_salsa` | `ExpandWithSubRecipe::test_queso_plus_standalone_salsa_aggregates` | Demands: queso 22 qt + salsa 4 qt | **Headline:** tomatoes 3401.94 g, cilantro 0.6 cup, milk 7570.82 ml |
| `cycle_a_b` | `Errors::test_cycle_detected` | `a` × 5 qt | `RecipeCycleError`; message contains `a`, `b` |
| `unit_mismatch_top` | `Errors::test_unit_mismatch_top_level` | salsa × 1 **lb** | `UnitMismatchError` |
| `unit_mismatch_sub_bag` | `Errors::test_sub_recipe_unit_mismatch_fails_loud` | queso × 22 qt (BOM refs salsa in **bag**) | `UnitMismatchError`; names queso, salsa, bag |
| `pack_size_bag_to_qt` | `PackSizeConversion::test_pack_size_resolves_cross_dimension_boundary` | queso × 22 qt; green_chile `bag:3:qt` | Leaves: `pork` 6 lb |
| `graceful_skip_bad_sub` | `GracefulDegradation::test_incompatible_sub_row_skipped_rest_kept` | queso × 22 qt + warnings sink | Leaves: `heavy cream` 3 qt; 1 warning mentioning `green_chile` |
| `explicit_sub_recipe_pin` | `ExplicitSubRecipePin::test_pin_binds_child_when_name_mismatches` | birria × 16 qt; pin `qb_seasoning` | Leaves: `salt` 0.5 qt |
| `expand_recipe_demand_half_batch` | `ExpandRecipeDemand::test_sub_recipe_scaled_for_half_batch` | queso 11 qt | Nodes: queso 11 qt, salsa 1 qt |
| `expand_recipe_demand_compound_salsa` | `ExpandRecipeDemand::test_two_demands_sharing_sub_recipe_compound` | queso 22 qt + salsa 4 qt | Nodes: queso 22 qt, salsa **6** qt (compound) |
| `manifest_warning_orphan_sub` | `ManifestWarnings::test_unreferenced_declared_sub_is_warned` | `find_manifest_warnings` | Warn pair `(beer_batter, beer_flour)` |
| `cup_to_qt_sub_reference` | `UnitConversion::test_sub_recipe_compatible_unit_converts` | mexi_slaw × 10 qt | Leaves: `mayo` 0.75 qt |
| `gal_demand_on_qt_recipe` | `UnitConversion::test_top_level_compatible_unit_converts` | soup × 1 **gal** | Leaves: `stock` 3 qt |
| `pork_chop_marinade_2x` | `test-recipe-calculator.mjs` scales 2× | Real manifest from `recipes/`; slug × 2 gal | 8 leaves at 2× base (see JS `PORK_CHOP_LEAVES_1X`) |

---

## §5.3 — Real-CSV / canary (separate file)

| ID | Source test | Notes |
|----|-------------|-------|
| `canary_queso_green_chile_bag` | `ManifestFromCsvs::test_queso_bom_has_known_unit_mismatch` | **Must expect `UnitMismatchError`.** Export uses **synthetic** bag mismatch (costing `bom_*.csv` absent in checkout). Normalized `recipes/` uses qt for green_chile — does not trigger canary. Do not weaken Swift port when this fixture passes. |

---

## Manifest literals reference (synthetic fixtures)

Shared salsa + queso manifests match `test_bom_expand.py::_mk` in `ExpandWithSubRecipe` /
`ExpandRecipeDemand` setUp.

**Queso BOM (synthetic):** yield 22 qt; subs `[blackened_tomato_salsa]`; rows:
`whole milk` 7570.82 ml; `blackened_tomato_salsa` 2 qt (sub).

**Salsa BOM (synthetic):** yield 20 qt; rows: `roma tomatoes` 11339.8 g; `cilantro` 2 cup
(or + `lime juice` 118.294 ml in leaf-only fixture).

**Pork chop 1× leaves** (from `tests/js/test-recipe-calculator.mjs`):

| ingredient | unit | qty @ 1 gal |
|------------|------|-------------|
| adobo seasoning | cup | 0.25 |
| chopped garlic | cup | 0.25 |
| cilantro | bunch | 1 |
| cumin | cup | 0.25 |
| garlic powder | cup | 0.25 |
| lime juice | cup | 2 |
| orange juice | cup | 2 |
| pepper | cup | 0.25 |

@ 2× gal: multiply all by 2 (`pork_chop_marinade_2x.json`).

---

## Export tooling

| Item | Path |
|------|------|
| Dev script | `scripts/dev/export_bom_expand_fixtures.py` |
| Output | `LariatNative/Tests/Fixtures/BomExpand/*.json` |
| Not in app target | Fixtures are test-only; no SwiftPM resource bundle |

Re-export when `scripts/lib/bom_expand.py` or oracle tests change.
