# Plan: Wire Up All Logic — Costing Pipeline + Operations

## Context
90% of BOM ingredient costs are dummy-priced ($1/ea). The ingredient_vendor_map has 147 entries and the Sysco/Shamrock catalogs have real prices, but the pipeline fails to connect them because:
1. The merged_prices file is incomplete (only ~130 entries, many from dummy supplements)
2. Unit conversion fails silently when recipe units don't match vendor units
3. Many ingredient name variations aren't in the map

This makes Costing, Food Cost Report, Menu Engineering, and Order Guide all produce unreliable numbers. Meanwhile, the Catering page doesn't help with prep timelines or fire times.

## Task 1: Rebuild merged prices from all vendor sources
**Files:** `scripts/rebuild_merged_prices.py` (new), `costing/` output
**Spec:** Write a script that reads ALL vendor price sources:
- `costing/sysco_line_list_*.csv` (latest)
- `workbook/data/shamrock_orders.csv` (extract unit prices from order data)
- `workbook/data/cross_supplier_pricing.csv`
- `workbook/data/sysco_product_catalog.csv`

Deduplicate by ingredient (keep cheapest unit price per ingredient). Output to `costing/YYYY-MM-DD_merged_prices.csv` in the existing schema: `ingredient,vendor,sku,pack_size,pack_unit,pack_price_usd,unit_price_usd,effective_date,category,notes`

**Acceptance:** Running the script produces a merged file with 200+ real-priced ingredients (up from ~130). No dummy entries.

## Task 2: Expand ingredient_vendor_map coverage
**Files:** `costing/ingredient_vendor_map.csv`
**Spec:** Run `bom_cost.py` after Task 1 and capture the list of still-unmatched ingredients. For each one:
- Find the closest match in the new merged prices by fuzzy matching
- Add the mapping to `ingredient_vendor_map.csv`
- Use `cost_proxy_*` notes for reasonable substitutions (e.g., different pepper varieties)

**Acceptance:** Unmatched ingredient count drops below 20 (from current ~160). `validate_ingredient_vendor_map.py` passes clean.

## Task 3: Fix unit conversion coverage in BOM pipeline  
**Files:** `libs/units.py`, `workbook/data/unit_conversions.csv`
**Spec:** The BOM pipeline marks `unit_converted=False` when recipe units don't match vendor units. Check which conversions are failing and add missing conversion factors:
- Common mismatches: recipe uses `cup`/`tbsp`/`tsp`, vendor sells by `lb`/`oz`/`gal`/`g`
- These need density entries in `libs/units.py` DENSITY_G_PER_ML table
- Also check `workbook/data/unit_conversions.csv` UnitConversions table used by the xlsx

**Acceptance:** `bom_cost.py` output has fewer than 10 `unit_converted=False` rows (down from current count). Re-run smoke check passes.

## Task 4: Verify costing pipeline end-to-end
**Files:** smoke check, BOM output
**Spec:** After Tasks 1-3, re-run:
```
python3 scripts/rebuild_merged_prices.py
python3 scripts/bom_cost.py  
python3 scripts/food_cost_report.py
./scripts/smoke_check.sh
```
Verify: dummy-priced rows < 15% of BOM (down from 90%). Food cost report produces meaningful percentages. Smoke check passes.

**Acceptance:** BOM has >85% real-priced ingredients. Smoke check green. Food cost report shows realistic percentages (most items 20-40%, not 22,000%).

## Task 5: Wire up Catering prep timeline with fire times
**Files:** `pages/7_Catering.py`, `operations/shift_sequence.csv`
**Spec:** The BEO Tracker tab has a prep planner but no fire time scheduling. Add:
- Read `operations/shift_sequence.csv` for phase/timing structure
- Show a countdown view: "T-3 days: braise meats", "T-1 day: prep sauces", "Day of: fire appetizers at 5:30"
- For Navratil (Apr 10): calculate prep days backward from event date
- Show which items need ordering vs JP purchase vs on-hand

**Acceptance:** Navratil event shows a day-by-day prep countdown with fire times. Items flagged as "need to order" vs "JP buys" vs "on hand".

## Task 6: Fix Menu Engineering / BCG matrix
**Files:** `pages/6_Menu_Engineering.py`, `scripts/menu_engineering.py`
**Spec:** The BCG matrix (stars/plowhorses/puzzles/dogs) requires both `food_cost_pct` and `quantity_sold` per menu item. Check why it's not rendering:
- Verify POS sales data exists and links to recipes via `menu_item_id`
- Verify food cost data joins correctly
- Fix the classification logic and render a working 2x2 scatter plot

**Acceptance:** Menu Engineering page shows a working BCG quadrant chart with menu items plotted by popularity vs profitability.

## Dependencies
- Tasks 1→2→3→4 are sequential (costing pipeline)
- Tasks 5 and 6 are independent of each other but Task 6 benefits from Task 4 (accurate costs)
- Execute: 1, 2, 3, 4 in sequence, then 5 and 6 in parallel
