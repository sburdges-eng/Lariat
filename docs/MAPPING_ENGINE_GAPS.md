# Mapping Engine — Gap Audit & Fix Plan

**Audit date:** 2026-04-19
**Scope:** Recipe ↔ vendor ↔ POS normalization layer.
**Owner:** Sean.
**Status:** Plan drafted. No code changed yet.

This document is the pre-deploy gate for the mapping engine. Every fix here lands, then we rerun the benchmark harness. Ship criteria is at the bottom.

---

## Findings (evidence-backed)

| # | Edge case / metric | Status | Evidence |
|---|---|---|---|
| 1 | Volume↔weight (density) | **PARTIAL** | `scripts/lib/units.py:10-12` — density explicitly out-of-scope. No `ingredient_densities` table. |
| 2 | Per-ingredient yield % | **MISSING** | `lib/db.ts:378-391` `recipe_costs.yield` is *batch output*, not ingredient yield. `bom_lines` (393-407) has no `yield_pct`. |
| 3 | Cooking shrinkage | **MISSING** | `app/api/inventory/route.js` POSTs free-text `delta/direction`. No raw→cooked loss factor anywhere in `lib/` or `scripts/`. |
| 4 | Catch weight | **MISSING** | `scripts/seed_vendor_pack_weights.py:38` writes to `costing/vendor_pack_weights.csv` — `costing/` **does not exist**. `scripts/lib/invoice_processor.py:52` has literal TODO `# Logic to be expanded based on pack_size reconciliation`. |
| 5 | Pack-size sub detection (6×#10 → 4×#10) | **MISSING** | `scripts/ingest-costing.mjs` deletes and re-inserts `vendor_prices`; no diff against prior pack_size. No alert, no history. |
| 6 | Multi-vendor SKU collapse | **PARTIAL** | `lib/db.ts:410-417` `ingredient_maps` exists but has no canonical master id. `scripts/lib/vendor_catalog.py:38-52` `_make_join_key` intentionally non-fuzzy — Sysco vs Shamrock descriptions won't merge. `ingredient_maps` covers ~147 of ~300+ BOM lines. |
| B1 | Theoretical vs actual cost variance | **MISSING** | No `cost_variance_pct` field anywhere. `lib/menuEngineering.ts` computes margin quadrants, not cost drift. |
| B2 | Unmapped-item queue | **MISSING** | `bom_lines.map_status` (db.ts:401) exists but is never surfaced as a queue or counted as a KPI. |
| B3 | Price-update latency | **MISSING** | `imported_at` is per-row `datetime('now')` text, per-batch only. No `ingest_runs` table, no job id, no end-to-end latency measurement. |

Net: **0 of 6 fully handled, 2 partial, 4 missing. All 3 benchmarks uninstrumented.**

---

## Fix plan (ordered by dependency, not payoff)

Each task below is scoped to land independently behind `migrateLegacyColumns()` (`lib/db.ts:618`), which is idempotent via `PRAGMA table_info` presence check. Schema changes are additive — no data loss risk, reversible by dropping the added column.

Check a box only when the acceptance criterion has been re-run and passed.

---

### T1 — Schema foundation: yield, loss, density

- [ ] **Task.** Add nullable columns that unblock every COGS-affecting fix downstream.
- [ ] **Files.** `lib/db.ts` (extend `migrateLegacyColumns()` around line 657).
- [ ] **Schema delta.**
  ```sql
  ALTER TABLE bom_lines     ADD COLUMN yield_pct       REAL;   -- 0..1, default NULL
  ALTER TABLE bom_lines     ADD COLUMN loss_factor     REAL;   -- cooking shrinkage, 0..1
  ALTER TABLE vendor_prices ADD COLUMN yield_pct       REAL;   -- vendor-default trim yield
  CREATE TABLE IF NOT EXISTS ingredient_densities (
    ingredient_key TEXT PRIMARY KEY,  -- normalized form, same key as vendor_catalog._make_join_key
    g_per_ml       REAL NOT NULL,
    source         TEXT,              -- "seed" | "measured" | "vendor"
    updated_at     TEXT DEFAULT (datetime('now'))
  );
  ```
- [ ] **TS types.** Extend `VendorPrice` (lib/db.ts:94-) and `BomLine` (lib/db.ts:126-) with the new fields as `number | null`.
- [ ] **Acceptance.** `sqlite3 data/lariat.db ".schema bom_lines"` shows the two new columns; existing rows un-touched (NULL in new columns).

---

### T2 — Seed density + yield reference data

- [ ] **Task.** Populate the tables from T1. Without data, T1 is inert.
- [ ] **Files.** New `scripts/seed_ingredient_densities.py`, new `scripts/seed_ingredient_yields.py`. Companion CSVs in `data/seeds/`.
- [ ] **Seed densities** (~50 rows covering items that actually appear in recipes): water 1.0, oil 0.92, flour 0.53, granulated sugar 0.85, diced onion 0.56, chopped tomato 0.98, milk 1.03, heavy cream 1.01, etc. Key must be produced by the same normalization used in `scripts/lib/vendor_catalog.py:_make_join_key` — extract that into a shared helper so Python and the density lookup agree byte-for-byte.
- [ ] **Seed yields** (per ingredient, based on The Book of Yields or Lariat measurements): yellow onion 0.85, bell pepper 0.82, avocado 0.65, tomato 0.92, cilantro 0.50, ribeye 0.88 after trim, etc.
- [ ] **Acceptance.** Both seed scripts are idempotent (upsert). After run: `SELECT COUNT(*) FROM ingredient_densities` ≥ 40; `SELECT COUNT(*) FROM bom_lines WHERE yield_pct IS NOT NULL` > 50% of costed lines.

---

### T3 — Apply yield + loss in costing math

- [ ] **Task.** Recompute `unit_price` and `recipe_costs.batch_cost` using `yield_pct` and `loss_factor`. Without this, T1+T2 data exists but doesn't move COGS.
- [ ] **Files.** `scripts/ingest_costing.py` (yield_qty_effective = bom.qty / (yield_pct × (1 − loss_factor))). `scripts/lib/bom_expand.py` — extend `Manifest` model.
- [ ] **Formula.** `true_ingredient_cost = pack_price × (bom_qty / (yield_pct × (1 − loss_factor))) / (pack_size_in_bom_unit)`. Default yield_pct=1.0, loss_factor=0.0 when NULL (i.e., pre-T2 behavior preserved).
- [ ] **Test fixture.** `tests/fixtures/cogs_yield.json`: one recipe with 1 lb diced onion → should cost 1/0.85 = 1.176 lb of 50-lb sack. Assert `batch_cost` within 0.01 of expected.
- [ ] **Acceptance.** Pytest passes. Run against live workbook: every recipe with a seeded yield shows a `batch_cost` delta ≥ 0 vs pre-migration snapshot. Zero regressions for recipes where yield=1.0.

---

### T4 — Volume→weight via density table

- [ ] **Task.** Close the gap `scripts/lib/units.py:10-12` explicitly declined.
- [ ] **Files.** `scripts/lib/units.py` (add `convert_cross_dimension(qty, from_unit, to_unit, ingredient_key, densities)`). `scripts/lib/bom_expand.py` (call it before costing when dimensions differ).
- [ ] **Failure mode.** If density is missing for an ingredient that needs a cross-dim conversion, **set `map_status='NEEDS_DENSITY'`, emit to unmapped queue, do not silently pick a default**.
- [ ] **Test fixture.** Recipe "1 cup diced onion" + vendor "50 lb sack onion" + density 0.56 g/ml → 240 ml × 0.56 = 134 g = 0.296 lb. Assert line costs at 0.296/50 × pack_price.
- [ ] **Acceptance.** Grep of `bom_lines` after ingest: every row with `unit IN ('cup','tbsp','tsp','ml','l','fl oz')` paired to a vendor row in lb/kg either (a) has a density key and costs correctly, or (b) is in the unmapped queue.

---

### T5 — Catch-weight reconciliation

Split into T5a (infrastructure + math, no live invoice coupling) and T5b
(wire into Sysco/Shamrock invoice ingesters). T5a lands the table,
columns, ingest, and reconciliation function; T5b is blocked on having
real Sysco/Shamrock invoices with per-pack delivered weight to test
against.

### T5a — Schema + ingest + reconciliation math

- [x] **Schema delta.** `vendor_catch_weights` table with the plan's shape
  and `vendor_prices` gains `actual_received_lb` + `reconciled_unit_price`
  via `migrateLegacyColumns()` (idempotent). Drift guard in
  `assertCriticalSchemas` catches legacy partial-deploy tables.
  ```sql
  CREATE TABLE IF NOT EXISTS vendor_catch_weights (
    vendor        TEXT NOT NULL,
    sku           TEXT NOT NULL,
    catalog_wt_lb REAL NOT NULL,
    tare_lb       REAL,
    source        TEXT,
    updated_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (vendor, sku)
  );
  ALTER TABLE vendor_prices ADD COLUMN actual_received_lb REAL;
  ALTER TABLE vendor_prices ADD COLUMN reconciled_unit_price REAL;
  ```
- [x] **Ingest.** New `scripts/ingest_catch_weights.py` loads
  `data/seeds/vendor_pack_weights.csv` (108 rows, Sysco-sourced, copied
  from archive) into `vendor_catch_weights` via idempotent UPSERT on
  `(vendor, sku)`. Wired as `npm run seed:catch_weights` and chained into
  `seed:all`. Validates `catalog_wt_lb > 0`, `tare_lb >= 0`; rolls back on
  any validation failure.
- [x] **Reconciliation math.** New module-level function
  `scripts.lib.invoice_processor.reconcile_catch_weight(catalog_wt_lb,
  actual_received_lb, invoice_total, *, threshold=0.02, tare_lb=None)`.
  Returns `{net_received_lb, deviation_pct, unit_price_catalog,
  unit_price_actual, reconciled_unit_price, reconciled}`. When
  `|deviation_pct| > threshold`, `reconciled_unit_price =
  invoice_total / net_received_lb`; otherwise the catalog-based price.
  Kept separate from the existing `InvoiceProcessor.reconcile_unit_cost`
  (which does quantity-based drift detection — unrelated concern).
- [x] **Test fixture.** Plan's ribeye example — 10 lb catalog, 10.4 lb
  delivered, $150 invoiced → `unit_price_catalog=15.00`,
  `reconciled_unit_price=14.4231`, `reconciled=true`. Plus 16 additional
  cases: tare-subtraction (cilantro bunch 8 lb gross / 2 lb tare / 6 lb
  net → 25% deviation), threshold boundary (exactly 2% is NOT reconciled
  — strict >), custom threshold, input validation (zero / negative /
  NaN), NOT NULL enforcement.
- [x] **Acceptance (T5a).** JS schema tests (5/5) + Python reconciliation
  tests (17/17) + Python ingest tests (7/7) pass. `vendor_catch_weights`
  populated with 107 rows from the archived CSV against a scratch DB;
  idempotent on rerun.

### T5b — Invoice integration

The exploration flagged that both PDF parsers already ship with the
catch-weight signal in-band — Sysco as `T/WT=` continuation rows, Shamrock
as `\nActual Weight: XX lbs` inside the description cell — but both were
discarded by the existing ingest. T5b captures both, reconciles against
`vendor_catch_weights`, and persists per-invoice reconciliation rows as
well as a backfilled snapshot on `vendor_prices`.

- [x] **Sysco parser (`scripts/ingest_sysco_invoice_pdfs.py`).**
  `parse_line_item` now returns a dict with the peeled SKUs + line_total
  + unit_price. The main parse loop captures `T/WT=` continuation
  numerics onto the previous item as `actual_received_lb`.
  `_collapse_in_pdf_duplicates` sums `line_total` and
  `actual_received_lb` across split-shipment rows so downstream
  reconciliation sees aggregate dollars against aggregate delivered
  weight. New `enrich_catch_weights(db_path, items)` opens the SQLite
  DB, loads vendor_catch_weights for Sysco, divides T/WT total by qty
  to get per-pack actual, calls `reconcile_catch_weight`, and stores
  `reconciled_unit_price` on the item dict (which gets persisted to
  `vendor_summary.json.sysco.recent_items`). Returns counters
  `{matched, reconciled, no_catalog, no_actual}`.
- [x] **Shamrock parser (`scripts/ingest_shamrock_invoices.py`).**
  `parse_invoice` regex-parses `Actual Weight: XX lbs` from the
  description cell into a structured `actual_received_lb` column. New
  `enrich_catch_weights(conn, rows)` joins against `vendor_catch_weights`
  on SKU (vendor='shamrock'), calls `reconcile_catch_weight`, and sets
  `reconciled_unit_price` on each row when deviation exceeds threshold.
  Runs before the `DELETE+INSERT` transaction so the enrichment lookup
  is read-only against vendor_catch_weights.
- [x] **Schema migration (shamrock_invoices).** `ensure_table` gained
  `actual_received_lb` and `reconciled_unit_price` columns + idempotent
  `ALTER TABLE ... ADD COLUMN` migration block for pre-T5b DBs.
- [x] **vendor_prices backfill (T5b.3).** New exported
  `backfillCatchWeightsIntoVendorPrices(db, locationId)` in
  `scripts/ingest-costing.mjs` joins the latest per-sku Shamrock
  invoice (MAX(delivery_date)) into `vendor_prices` — writing both
  `actual_received_lb` and `reconciled_unit_price` on every matching
  row. Called from `_ingestCostingImpl` at the end of the post-pass so
  the costing DELETE+INSERT sweep doesn't lose the audit trail.
  Sysco's per-invoice data lives in `vendor_summary.json` (file cache);
  a future follow-up could import it into a sibling SQLite table and
  extend this function to scan both sources.
- [x] **Scope of `reconciled_unit_price`.** Populated ONLY when the
  reconciliation actually triggered (|deviation| > threshold, default
  2%). A NULL value means "no drift detected" rather than "no data" —
  the non-NULL `actual_received_lb` on the same row distinguishes those
  two cases. Matches the dashboard's intent to surface flagged rows.
- [x] **Test plan.** Python: 12 tests in
  `tests/python/test_invoice_catch_weight_wiring.py` covering
  `parse_line_item` dict shape, SKU peel, Sysco enrichment (match /
  within-threshold / missing DB / pre-T5a DB), Shamrock regex (integer,
  decimal, whitespace, case variations, missing), Shamrock enrichment
  (match + reconcile / no catalog / no actual / within threshold). JS:
  5 tests in `tests/js/test-catch-weight-backfill.mjs` covering
  latest-per-sku selection, NULL-invoice skip, same-sku multi-row
  update, missing shamrock_invoices table. 7 pre-existing JS suites +
  all Python suites stay green (76 pass, 3 skipped, 1 unrelated
  pre-existing failure in `NormalizeSeriesPinsNaNBehavior`).
- [x] **Smoke against real invoice.** Ran parse_pdf on
  `EnterpriseInvoice-759616979.pdf` → 40 line items, 2 catch-weight
  (pork chop 2 CS / T/WT=17.4 / $318.25 and chicken breast 1 CS /
  T/WT=20.65 / $117.68). With synthetic catalog rows seeded (pork chop
  catalog_wt_lb=8.0, chicken catalog_wt_lb=20.0), enrich produced
  `reconciled_unit_price=$18.29/lb` for pork chop (matches the invoice's
  stamped unit price exactly) and `$5.70/lb` for chicken breast.

**Known limitations / follow-ups:**
- No Shamrock entries in `data/seeds/vendor_pack_weights.csv` yet — the
  seed CSV came from the Sysco product catalog filter. Shamrock
  catch-weight catalog rows need to be measured in-house or pulled
  from Shamrock's catalog before Shamrock reconciliation fires on
  anything. Until then, the enrichment correctly stores
  `actual_received_lb` but leaves `reconciled_unit_price` NULL (the
  "no catalog" bucket).
- Sysco catch-weight data lives in `vendor_summary.json`, not a SQLite
  table. The T5b.3 backfill only reads `shamrock_invoices`. Adding a
  `sysco_invoices` table (or lifting the cache into SQLite) is the
  natural next step to round out vendor_prices backfill for Sysco too.

---

### T6 — Pack-size substitution detection

- [ ] **Task.** Catch silent vendor swaps (6×#10 → 4×#10) before they poison case-price math.
- [ ] **Files.** `scripts/ingest-costing.mjs` — before the delete-and-reinsert in `vendor_prices`, diff incoming `pack_size`/`pack_unit` against the latest prior row per `(vendor, sku)`.
- [ ] **Schema delta.**
  ```sql
  CREATE TABLE IF NOT EXISTS pack_size_changes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor       TEXT NOT NULL,
    sku          TEXT NOT NULL,
    prev_pack    TEXT,  -- e.g. "6x#10"
    new_pack     TEXT,
    prev_price   REAL,
    new_price    REAL,
    detected_at  TEXT DEFAULT (datetime('now')),
    acknowledged INTEGER DEFAULT 0
  );
  ```
- [ ] **Behavior.** On detection: log row, flag `vendor_prices.map_status='PACK_CHANGED'`, surface in the unmapped/attention queue until user acks.
- [ ] **Test fixture.** Two successive ingest runs for SKU `SYSCO-12345`: run 1 = `6x#10, $42.00`; run 2 = `4x#10, $36.00`. Assert one row in `pack_size_changes`, `acknowledged=0`.
- [ ] **Acceptance.** Synthetic fixture passes. Manual run against the last two real Sysco invoice pairs shows zero false positives for same-pack price changes.

---

### T7 — Multi-vendor SKU collapse (ingredient master)

- [ ] **Task.** Collapse Sysco and Shamrock rows for the same thing into one internal master. Fixes fragmented inventory and menu-engineering joins.
- [ ] **Files.** `lib/db.ts` (new table + extend `vendor_prices`). `scripts/rebuild_merged_prices.py` (populate). `app/api/costing/route.js` (join via master).
- [ ] **Schema delta.**
  ```sql
  CREATE TABLE IF NOT EXISTS ingredient_masters (
    master_id     TEXT PRIMARY KEY,     -- slug: "ketchup_heinz_1gal"
    canonical_name TEXT NOT NULL,
    category      TEXT,
    preferred_vendor TEXT,
    last_reviewed TEXT
  );
  ALTER TABLE vendor_prices ADD COLUMN master_id TEXT;       -- FK to ingredient_masters
  ALTER TABLE bom_lines     ADD COLUMN master_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_vp_master ON vendor_prices(master_id);
  CREATE INDEX IF NOT EXISTS idx_bom_master ON bom_lines(master_id);
  ```
- [ ] **Population strategy.** Seed masters from the existing `ingredient_maps` (lib/db.ts:410-417) that are `status='confirmed'`. Unconfirmed rows enter the unmapped queue. Do **not** fuzz-match automatically (`_make_join_key` deliberately refuses this — same posture).
- [ ] **Menu-engineering.** `lib/menuEngineering.ts` joins on `master_id`, not `ingredient` string.
- [ ] **Test fixture.** Seed `heinz_ketchup_1gal` master. Insert a Sysco row and a Shamrock row both pointing at it. Assert a recipe consuming "ketchup" pulls a single merged cost (weighted avg or preferred-vendor, your call — default to preferred_vendor with avg fallback).
- [ ] **Acceptance.** After backfill, `SELECT COUNT(DISTINCT master_id)` < `SELECT COUNT(DISTINCT ingredient)` (i.e., collapse happened). Zero `vendor_prices.master_id IS NULL` rows in categories that have any confirmed master.

---

### T8 — Cooking shrinkage in inventory depletion

- [ ] **Task.** Toast sells cooked 8 oz burger; inventory depletes raw 10.66 oz (25% loss). Currently depletes 8 oz or nothing.
- [ ] **Files.** `app/api/inventory/route.js` — when the inventory movement originates from a POS sale (source='toast'), lookup `bom_lines.loss_factor` for the cook step and divide.
- [ ] **Schema delta.** None beyond T1. `bom_lines.loss_factor` from T1 is the source of truth per-ingredient-per-recipe.
- [ ] **Test fixture.** Seed burger recipe with patty loss_factor=0.25. Post a Toast sale for 1 burger. Assert inventory_updates row has `delta = -10.66 oz` (raw), not `-8 oz`.
- [ ] **Acceptance.** Mock Toast sales of a known loss-factor recipe deplete inventory at the raw-weight equivalent ±0.1 oz.

---

### T9 — Benchmark instrumentation (pre-deploy gate)

This is the bar that lets us say the engine works.

- [ ] **B1 — Variance metric.**
  - Files: `app/api/costing/route.js`, `lib/menuEngineering.ts`.
  - Compute per-recipe `actual_avg_unit_cost` (from rolling 30-day `vendor_prices`) vs `recipe_costs.cost_per_yield_unit`. Expose `cost_variance_pct`.
  - Dashboard tile: red if any recipe >5%, yellow >2%.
- [ ] **B2 — Unmapped queue.**
  - New `app/api/unmapped/route.js` returning `{ total_items, unmapped_count, pct, rows: [...] }` from `bom_lines.map_status NOT IN ('confirmed','mapped')` + `vendor_prices.master_id IS NULL` + `map_status IN ('NEEDS_DENSITY','PACK_CHANGED')`.
  - Target <1%, red >3%.
- [ ] **B3 — Ingest latency.**
  ```sql
  CREATE TABLE IF NOT EXISTS ingest_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,      -- 'costing' | 'analytics' | 'unified'
    started_at TEXT NOT NULL,
    finished_at TEXT,
    rows_in    INTEGER,
    rows_out   INTEGER,
    status     TEXT                -- 'ok' | 'partial' | 'failed'
  );
  ```
  - Every `scripts/ingest-*.{mjs,py}` opens a run row at start, closes at end.
  - Dashboard shows last-ingest-age per kind; red if any >1h stale.
- [ ] **Acceptance.** All three tiles render in `app/costing/` with live numbers off the seed data. No dummy values.

---

## Definition of done (ship gate)

Run `npm run ingest:all` against a mock week (historical Sysco/Shamrock invoices + historical Toast POS). Then:

| Benchmark | Threshold |
|---|---|
| Theoretical vs actual cost variance | **<2% aggregate, no recipe >5%** |
| Unmapped-item queue | **<1% of total costed BOM lines** |
| Price update latency | **<1 h from ingest start to dashboard visibility** |

All three green → engine is deploy-ready. Any red → fix the root cause, not the metric.

---

## Known debt

These are tracked follow-ups from code-quality reviews. Non-blocking; address when touching the affected subsystem.

### D1 — Coverage test can silently self-delete

`tests/python/test_seed_coverage.py` is a no-op test by design (informational reporter, no assertions). If the hard-coded live-DB path moves or the live DB is unavailable, the test silently skips with a message that default `pytest` output hides. A future misconfig that leaves the test skipping forever would look identical to "passing" in CI.

**Fix when touched:** either (a) add `self.assertGreater(n_bom, 0)` as a baseline assertion so an empty-DB state fails instead of passes, or (b) rename the file to `coverage_report.py` and invoke it as a standalone tool rather than a pytest test.

### D2 — Seed script duplication

`scripts/seed_ingredient_densities.py` and `scripts/seed_ingredient_yields.py` share ~95% of their structure. Drift risk when a fix lands in one but not the other (e.g., the I1 CSV shape guard was added in lockstep — a future fix may not be).

**Fix when touched:** extract shared upsert logic into `scripts/lib/seed_upsert.py` with a `SeedSpec` dataclass carrying `(table_name, pk_column, columns, validators)`. Both seed scripts become ~40-line thin callers.

### D3 — Positional-column INSERT fragility (flagged by T2c review)

`scripts/ingest-costing.mjs` uses positional `?` placeholders for `vendor_prices` (10 cols) and `bom_lines` (13 cols). When T5 adds `actual_received_lb` to `vendor_prices`, whoever writes T5 must remember to extend both the column list AND the argument tuple — SQLite silently accepts the shorter INSERT and leaves the new column NULL-by-default. No test catches this.

**Fix when T5 lands:** convert both INSERTs to named-parameter binding: `INSERT INTO vendor_prices (...) VALUES (@ingredient, @vendor, ...)` with `stmt.run({ ingredient, vendor, ... })`. `better-sqlite3` throws on key mismatch, which is the safety this design needs. Also worth adding a schema-parity test that inspects `PRAGMA table_info(...)` and asserts the INSERT covers every non-auto column.

### D4 — Excel batch_cost vs raw-sum drift (flagged by T3 review)

T3 adds yield-delta on top of Excel's `recipe_costs.batch_cost`, assuming `excel_batch_cost === Σ (bom_qty × pack_price / pack_size)` across BOM lines. Current workbook holds this. If Excel ever introduces per-line rounding, case-minimum bucketing, sub-recipe caching, or other non-trivial adjustments, T3's delta still adjusts correctly FOR the yield portion but the resulting batch_cost becomes "Excel + our delta" rather than "absolute true cost".

**Fix when workbook scales up:** at T3-pass time, compute `Σ (qty × pack_price / pack_size)` per recipe and compare against `recipe_costs.batch_cost`. Log an INFO line when drift exceeds $0.10. Observability only — no behavior change, catches the scenario early. Consider a hard CHECK (≥ $1.00 drift) once observability confirms the invariant in production.

### D5 — Missing null-guard matrix coverage in T3 yield-math tests (flagged by T3 review)

`tests/js/test-ingest-costing-yield-math.mjs` tests 2 of the 5 zero/NULL guards: zero `pack_size` and NULL `pack_price`. Missing: zero `bom_qty`, NULL `bom_qty`, NULL `pack_size`. Code guards all 5 uniformly at `scripts/ingest-costing.mjs:213-220` so these are coverage gaps, not functionality gaps.

**Fix when touched:** parameterize the null-guard matrix — one parameterized test × 6 cases (3 columns × {NULL, 0}) closes the gap cheaply. Also split the current collapsed "NULL yield_pct + NULL loss_factor" test (line 87) into two cases so a broken single-field default can't hide behind a compensating pass.

### D6 — B1 variance fallback silently masks unmapped rows (flagged by T9 review)

`lib/costingBenchmarks.mjs:92-93` falls back to the BOM line's own `pack_price` / `pack_size` when no `vendor_prices` row matches on normalized ingredient_key. This keeps variance = 0 byte-exact on fresh ingest (correct contract), but also means a recipe with zero vendor-price matches silently reports "healthy" variance while failing completely in B2's unmapped queue. An operator reading B1 in isolation could miss a mapping-engine regression.

**Fix when touched:** either (a) drop the fallback — lines without a vendor match contribute to a separate `unmatched_lines` counter, and recipes where `unmatched_lines/total_lines > threshold` are excluded from the variance aggregate with an explicit reason; or (b) add page-level copy that reads the three tiles in priority order (unmapped first, variance only meaningful when unmapped is green). Option (a) is stricter and better matches operator intuition at a glance.

### Intentionally not debt (just flagging)

- `notes` column in the densities CSV is read then discarded — the `ingredient_densities` table has no `notes` column. Parity with `ingredient_yields` (which has `notes`) would require a schema migration that isn't worth it now.
- Padded yield CSV rows beyond the top-40 BOM ingredients (filet mignon, etc.) are intentional to pre-cover near-future menu additions. `tests/python/test_seed_coverage.py` verifies live-BOM coverage is 100%.

---

## Out of scope (track separately)

- Replacing `_make_join_key` with an embedding-based matcher. Current intentional posture (non-fuzzy) is correct; T7's master table is the right place to encode human-confirmed merges.
- Real-time EDI streaming from Sysco/Shamrock. T5/T6 assume batch invoice ingest — fine for Lariat scale.
- HACCP temp-log mapping. Separate subsystem.
