# Chile / chilli naming (binding)

Two different things — do **not** collapse them. There is **no** "chili" spelling in Lariat.

| Spelling | Means | Slug / BOM |
|----------|-------|------------|
| **green chilli** | House braised pork-butt stew (cup/bowl) | `green_chilli` recipe |
| **green chile** | Purchased diced green chile (Sysco / Shamrock) | vendor **leaf** ingredient |

## Hard rule — Queso / Mac Sauce

`queso_mac_sauce` uses **green chile** as a purchased leaf.

It must **never** list `green_chilli` in `sub_recipes` or pin `(sub-recipe=green_chilli)`.
Expanding queso must **not** pull pork-butt stew leaves.

`scripts/ingest_beo_recipe_tree.py` keeps `"green chile"` in `LEAF_NEVER_LINK` so a
stale cache ghost named "Green Chile" cannot re-link the vendor leaf.

## Cache rename pitfall

`npm run rebuild-cache` used to preserve orphan slugs from `recipes.json`. A
rename (`green_chile` → `green_chilli`) left both entries; BEO ingest then mapped
ingredient `"green chile"` → ghost `green_chile`. Rebuild now prunes orphans that
are absent from `recipe_index` and lack a normalized CSV.

## Why

BOM expand only walks declared `sub_recipes`. Keep the vendor leaf (**chile**) and the house stew (**chilli**) on different spellings so they cannot resolve into each other.
