# Plan: Auto-wire sales-driven depletion into the analytics ingest

**Branch:** `auto-depletion`
**Base:** `main @ 7493538` (post erp-audit fixes)
**Goal:** Make Toast sales automatically debit BOM-equivalent inventory without requiring a manual `scripts/apply-sales-depletion.mjs --apply` invocation. Surface the dish-components coverage gap so the kitchen team knows what data entry is still pending.

## Context

After the audit-fixes commit (`7493538`) the depletion engine is fully built and tested but only runs when an operator invokes the CLI. The seam where it should fire automatically is **after `scripts/ingest-analytics.mjs` rewrites `sales_lines`** — that's the only writer to the table the depletion engine reads.

Today's flow:
1. `scripts/toast-weekly-ingest.mjs` ingests Toast CSV/zip exports into `toast_sales_*` tables and `toast_labor_*` tables.
2. `npm run ingest:analytics` (separate invocation) reads `data/cache/*.json` and rewrites `sales_lines` (DELETE+INSERT scoped by `location_id`).
3. **Gap:** depletion never runs unless someone types the CLI by hand.

Goal flow:
1. (unchanged Toast weekly ingest)
2. `npm run ingest:analytics` runs depletion at the end of the same invocation, per period, with the existing skip-if-already-applied semantics from `lib/salesDepletion.ts::applyDepletionsForPeriod`.
3. A new coverage-report CLI gives the kitchen team a sorted punch list of dishes still missing `dish_components` rows so the unresolved count goes to zero over time.

## Out of scope

- Any change to `scripts/toast-weekly-ingest.mjs` itself — sales_lines is not written there.
- Any change to the depletion engine semantics. The engine already handles idempotency, --force, audit events, and unresolved reporting.
- Wiring depletion into the Toast API live-pull path (`scripts/toast-weekly-pull.mjs`) — out of scope; that path doesn't write sales_lines either.
- BEO event linking, FK migration of operational tables, entity resolution merge — separate plans.

## Tasks

### Task 1: Hook applyDepletionsForPeriod into scripts/ingest-analytics.mjs

**Files:**
- `scripts/ingest-analytics.mjs` (modify)
- `tests/js/test-analytics-depletion-integration.mjs` (new)

**Behavior:**

After the existing `INSERT INTO sales_lines` loop completes (within or just after the same transaction — caller's choice), the script must:

1. Query `SELECT DISTINCT period_label FROM sales_lines WHERE location_id = ?`.
2. For each period, call `applyDepletionsForPeriod(db, { location_id, period_label, shift_date: <today UTC YYYY-MM-DD>, apply: true })`. The function already skips already-applied (location, period) tuples and writes nothing on dry-runs.
3. Log a one-line summary per period: `period=<label>  sales=<n>  writes=<n>  unresolved=<n>  [run=<id>|skip already-applied]`.
4. Print an aggregate total at the end of the analytics ingest output.

Add a CLI flag:

- `--skip-depletion` — if present, the depletion sweep is bypassed entirely. Useful when an operator is debugging the analytics ingest itself.

The depletion call MUST come AFTER the sales_lines transaction has committed; the existing `db.transaction(...)` block at the top of `ingest-analytics.mjs` should not be widened to wrap depletion writes. Each depletion gets its own transaction (already done inside `applyDepletionsForPeriod`).

`shift_date` for the inventory_updates rows: today's UTC date (`new Date().toISOString().slice(0, 10)`). Per the depletion spec, that's "this is when we recorded the calculated consumption" — not tied to the sales period date.

**Test (`tests/js/test-analytics-depletion-integration.mjs`):**

Use `setDbPathForTest(':memory:')` and the existing pattern from `tests/js/test-sales-depletion.mjs`. Steps:

1. Seed `dish_components` for `'Test Burger'` with two vendor_item rows (e.g. 6oz patty, 1 each bun).
2. Build a minimal cache JSON object in memory representing 1 sales row for `'Test Burger'`, qty 5. Write to a tmp dir.
3. Import `scripts/ingest-analytics.mjs` and call its `main()` function (or whatever the script's entry point is — refactor minimally if needed) pointing at the tmp cache dir.
4. Assert:
   - `sales_lines` has 1 row with the expected period_label, qty=5.
   - `sales_depletion_runs` has 1 row for that period.
   - `inventory_updates` has 2 rows (patty + bun), each with note matching `/^\[deplete-run=\d+\]/`.
   - Each inventory_updates row has direction='out' and a delta string matching `/^-\d/`.
5. Re-run the ingest. Assert: `sales_depletion_runs` still has exactly 1 row (already-applied skipped), `inventory_updates` row count unchanged.
6. Run with `--skip-depletion` (or pass `{ skipDepletion: true }` to the entry point). Assert: depletion is skipped — no new sales_depletion_runs rows.

**Acceptance:**

- Running `node --experimental-strip-types scripts/ingest-analytics.mjs` without flags writes `sales_lines` AND triggers depletion for every period in the location.
- Running with `--skip-depletion` writes only `sales_lines` (legacy behavior).
- Test passes.

### Task 2: dish-components coverage CLI report

**Files:**
- `scripts/dish-components-coverage.mjs` (new)
- `tests/js/test-dish-components-coverage.mjs` (new)

**Behavior:**

CLI that surfaces dishes appearing in `sales_lines` but missing a `dish_components` row, sorted by aggregate quantity_sold descending.

Command-line interface:

```
node --experimental-strip-types scripts/dish-components-coverage.mjs [flags]

Flags:
  --location=<id>       Default 'default'.
  --top=<n>             Limit output to top-N rows (default 50).
  --csv-out=<path>      Write a fill-me CSV ready for the kitchen team
                        to populate and re-import via scripts/import-
                        dish-components.mjs. Header columns:
                          dish_name, recipe_slug, vendor_ingredient,
                          qty_per_serving, unit, notes
                        dish_name is pre-populated; the rest are blank.
  -h, --help            Show this help.
```

Pretty-printed table output (always, in addition to optional CSV):

```
dish-components coverage gap (location=default)

  rank  qty_sold   net_sales  periods  dish_name
  ----  --------   ---------  -------  ---------
     1     1234     5678.00      3     BAJA FISH TACOS
     2      987     4321.00      3     ROPE BURGER (no dish_components in this location)
     ...

  TOTAL: 52 dishes missing dish_components, accounting for X% of recent sales velocity.
```

Pure SQL — one query joining `sales_lines` against `dish_components` with a LEFT JOIN whose right side must be NULL for the gap. Trim and case-insensitive match (`LOWER(TRIM(...))`).

The CSV output, when `--csv-out` is set, must be UTF-8 with `\n` line endings (not CRLF) and quote fields that contain commas. One row per gap dish.

**Test (`tests/js/test-dish-components-coverage.mjs`):**

1. Seed 3 dishes in `sales_lines` with varying quantity_sold.
2. Seed `dish_components` for one of them.
3. Call the report function (export it from the script for testability).
4. Assert: returned 2 rows, sorted by quantity_sold DESC.
5. Call with `--top=1`; assert: 1 row, the highest-velocity gap.
6. Call with `--csv-out=<tmpfile>`; assert: file exists, parses with a CSV reader (or just regex), has the expected header and one row per gap dish.

**Acceptance:**

- Report function returns the gap list correctly.
- CSV is shape-compatible with `scripts/import-dish-components.mjs` (verify by reading the existing import script's expected header).
- Test passes.

### Task 3: End-to-end pipeline integration test

**Files:**
- `tests/js/test-toast-to-depletion-pipeline.mjs` (new)

**Behavior:**

Single-test integration that demonstrates the full chain from a Toast sales record to an inventory_updates row, exercising the wire-up from Task 1. Distinct from the per-task test in Task 1 by being end-to-end-flavored: it reads from a realistic cache JSON (not just direct DB inserts) and asserts every link.

**Steps:**

1. Build a tmp dir with a minimal cache structure: `data/cache/menu.json` (or whatever ingest-analytics actually reads — confirm by reading the script). Add 2 dishes with sales: `'Burger'` (qty 10) and `'Salad'` (qty 4) for one period.
2. Seed entity_recipes + bom_lines + dish_components for 'Burger' (covers the recipe-component path including yield ratio and shrinkage).
3. Seed dish_components for 'Salad' as vendor_item only (covers the simpler path).
4. Run the analytics ingest entry point.
5. Assert:
   - sales_lines: 2 rows.
   - sales_depletion_runs: 1 row (one period processed).
   - inventory_updates: rows for every BOM line of 'Burger' + each vendor_item of 'Salad'. Counts add up.
   - Each row has the `[deplete-run=N]` note prefix.
   - Quantities match expected hand-calculated values (qty * dish_component qty_per_serving, with shrinkage where applicable).
6. Run analytics ingest a second time. Assert: NO new inventory_updates rows.

**Acceptance:**

- Test executes the full chain in a single process.
- Test fails if the Task 1 wire-up is later removed.
- Hand-calculated quantities match the test assertions (no asserting against function output you don't trust).

## Out-of-scope explicitly listed

- Modifying `scripts/toast-weekly-ingest.mjs`. The orchestrator doesn't write sales_lines.
- Auto-running on Toast API pulls (`scripts/toast-weekly-pull.mjs`).
- The data-entry of dish_components rows themselves. Task 2's CSV scaffold gives the kitchen team the input format; populating it is their work.
- Any change to compute engine, BEO, entity layer.

## Definition of done

- All 3 tasks pass spec and code-quality reviews.
- Full test suite green (existing + new).
- `tsc --noEmit` clean for new code.
- A dry-run on the live DB (read-only — copy `data/lariat.db` to a scratch path first) shows the new analytics-ingest output formatting works.
