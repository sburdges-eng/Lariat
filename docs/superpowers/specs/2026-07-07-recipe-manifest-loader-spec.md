---
title: "RecipeManifestLoader — CSV contract (Wave A3 / Wave C)"
date: 2026-07-07
status: approved oracle
parent: docs/superpowers/plans/2026-07-07-lariat-native-phase-iii-wave-a.md
python_source: scripts/lib/bom_expand.py
---

# RecipeManifestLoader — file contract

Swift `RecipeManifestLoader` must mirror Python `build_manifest_from_normalized` +
`load_beo_recipe_map` (Wave B). **No silent coercion** — same fail-loud / warnings-sink
semantics as `bom_expand.py`.

---

## Paths (relative to `LARIAT_ROOT`)

| File | Loader function |
|------|-----------------|
| `recipes/recipe_index.csv` | `_load_recipe_index` |
| `recipes/normalized/{slug}.csv` | per-slug BOM rows |
| `menus/beo_recipe_map.csv` | `load_beo_recipe_map` |

---

## `recipe_index.csv`

| Column | Maps to | Rules |
|--------|---------|-------|
| `recipe_id` | `Manifest.slug` | Required; skip empty |
| `recipe_name` | `display_name` | Default slug if blank |
| `yield` | `yield_qty` | `_parse_float` — empty → 0 |
| `yield_unit` | `yield_unit` | Strip whitespace |
| `sub_recipes` | `sub_recipe_slugs` | `;`-split, strip each |
| `pack_size` | `pack_conversions` | `;`-split specs `unit:factor:yield_unit` |

Extra columns are **ignored**.

---

## `recipes/normalized/{slug}.csv`

| Column | Maps to | Rules |
|--------|---------|-------|
| `ingredient` | BOM `ingredient` | Strip |
| `qty` | BOM `qty` | `_parse_float` |
| `unit` | BOM `unit` | Strip |
| `portions_per_batch` | *(ignored)* | Not used by expander |
| `notes` | sub-recipe detection | Lowercased |

**Sub-recipe row:** `(sub-recipe)` in notes OR `(sub-recipe=slug)` pin regex.

Missing normalized file → empty BOM (not an error).

---

## `menus/beo_recipe_map.csv`

| Column | Maps to | Rules |
|--------|---------|-------|
| `beo_item` | lookup key | `normalize_client` |
| `recipe_id` | slug resolution | Match **display name**, not slug |
| `per_count` | scales | Optional per-mapping factor |

Unresolved rows → `Unmapped` list. Multiple rows per item → multiple slugs.

---

## D1-B layout

See `specs/2026-07-07-d1-application-support-layout.md`.

---

## Parity tests

| Test | Fixture |
|------|---------|
| Normalized load | `pork_chop_marinade_2x.json` |
| Pack size | `pack_size_bag_to_qt.json` |
| BEO scales | `build_demand_per_mapping_scale.json` |
