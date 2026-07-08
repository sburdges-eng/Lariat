---
title: "BeoPull + BeoCascade golden fixture manifest (Wave B oracle)"
date: 2026-07-07
status: exported
parent: docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md
export_script: scripts/dev/export_beo_fixtures.py
output_dir: LariatNative/Tests/Fixtures/BeoCascade/
---

# Beo fixture manifest

15 JSON files. Regenerate:

```bash
python3 scripts/dev/export_beo_fixtures.py
```

Depends on Wave A `BomExpandCompute` for `pull_orders` / `build_cascade` parity.

---

## Schema (`schema_version: 1`)

```json
{
  "schema_version": 1,
  "id": "<fixture_id>",
  "module": "beo_pull" | "beo_cascade",
  "source_test": "...",
  "manifest": { "...": "optional inline manifests" },
  "beo_map": { "menu item key": ["slug", ...] },
  "input": { "mode": "...", "...": "..." },
  "expect": { "...": "..." }
}
```

### `input.mode` (beo_pull)

| Mode | Fields |
|------|--------|
| `normalize_client` | `samples[]` |
| `build_demand` | `invoice`, optional `qty_in_yield_units` |
| `pull_orders` | `invoice`, optional `inventory` |

### `input.mode` (beo_cascade)

| Mode | Fields |
|------|--------|
| `build_cascade` | `line_items`, optional `inventory`, `map_warnings` |

---

## BeoPull fixtures (10)

| ID | Source test | Expect headline |
|----|-------------|-----------------|
| `normalize_client_equivalence` | `NormalizeClient::test_equivalences` | All samples → `navratil` / `""` |
| `build_demand_unmapped` | `BuildDemand::test_unmapped_item_reported_not_dropped` | Cupcakes in unmapped |
| `build_demand_one_batch` | `BuildDemand::test_qty_is_number_of_batches_by_default` | 1 ziti → 22 qt queso |
| `build_demand_yield_units` | `BuildDemand::test_qty_in_yield_units_mode` | 4 qt queso |
| `build_demand_trio_multi_recipe` | `BuildDemand::test_single_menu_item_maps_to_multiple_recipes` | 2 slugs |
| `build_demand_per_mapping_scale` | `BuildDemand::test_per_mapping_scale_factor_overrides_yield_units` | 4×5.5 = 22 qt |
| `build_demand_partial_scale_factor` | `BuildDemand::test_scale_factor_only_applies_to_its_mapping` | queso 6, salsa 3 |
| `build_demand_direct_name_resolution` | `BuildDemand::test_direct_name_resolution_fallback` | display name → slug |
| `pull_orders_salsa_aggregated` | `PullOrders::test_cascade_aggregates_sub_recipe_demand` | **Headline** summed salsa leaves |
| `pull_orders_inventory_subtract` | `PullOrders::test_inventory_subtracts_to_order` | to_order clamped ≥ 0 |

---

## BeoCascade fixtures (5)

| ID | Source test | Expect headline |
|----|-------------|-----------------|
| `cascade_order_guide_scaled` | `test_order_guide_totals_are_scaled_correctly` | roma 2 lb, cheese 6 lb @ 2 batches |
| `cascade_prep_demands_nodes` | `test_prep_demands_display_name_and_qty` | queso 16 qt, salsa 4 qt |
| `cascade_unmapped_mystery_item` | `test_unmapped_item_appears_in_unmapped` | Mystery in unmapped |
| `cascade_inventory_subtract` | `test_inventory_subtracted_in_order_guide` | roma to_order reduced |
| `cascade_missing_sub_warning` | `test_missing_sub_recipe_degrades_to_warning` | warning names `missing_sub` |

**Deferred to Wave B PR (not fixture-exported):** manifest_warnings scoping, prep_demands sort order, map_warnings merge — covered by additional Swift tests mirroring Python classes.

---

## Swift test map (proposed)

| Fixture | Test class |
|---------|------------|
| `normalize_client_*` | `BeoPullComputeTests` |
| `build_demand_*` | `BeoPullComputeTests` |
| `pull_orders_*` | `BeoPullComputeTests` |
| `cascade_*` | `BeoCascadeComputeTests` |
