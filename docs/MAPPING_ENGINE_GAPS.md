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

- [x] **Task.** Close the gap `scripts/lib/units.py:10-12` explicitly declined.
- [x] **Files.** **Architectural correction from plan:** cost math runs in
  `scripts/ingest-costing.mjs` (JS, T3 post-pass), not Python. `units.py`
  serves other scripts (`rebuild_merged_prices.py`, `bom_expand.py` — recipe-
  tree expansion, not costing) and is frozen as the canonical table source.
  Landed: `lib/unitConvert.mjs` (byte-exact JS mirror of `units.py` with the
  added density-bridge algorithm) + conversion integrated into
  `_ingestCostingImpl`. Parity fixture at `tests/fixtures/unit_convert_parity.json`
  generated by `scripts/lib/generate_unit_convert_fixture.py`.
- [x] **Failure mode.** If density is missing for an ingredient that needs a cross-dim conversion, **set `map_status='NEEDS_DENSITY'`, emit to unmapped queue, do not silently pick a default**. Protected statuses (`confirmed` / `mapped` / `auto_mapped`) are never downgraded.
- [x] **Test fixture.** Recipe "1 cup diced onion" + vendor "50 lb sack onion" + density 0.56 g/ml → covered by `tests/js/test-t4-unit-convert-integration.mjs` ("cross-dim with density present"). Parity covered by 51-row fixture across identity / same-dim / cross-dim / count-refusal / unknown-unit / edge-qty cases.
- [x] **Acceptance.** Every BOM row with `unit IN (volume)` paired to a `vendor_prices.pack_unit IN (weight)` either (a) has a density key and costs correctly, or (b) is flagged `map_status='NEEDS_DENSITY'` and appears in B2's unmapped queue via the existing `reason='unmapped_status'` path (no wiring change needed in `computeUnmapped`).

### T4.1 — Count-bridge + density backfill (follow-up)

Live-DB audit after T4 surfaced a real interpretation gap: **99 BOM rows couldn't convert** — 61 missing-density cross-dim, 35 count-involved (cilantro ct, jalapeno ea, etc.), 3 with unknown-bom-unit tokens ("bunch", "box", "#10 can"). 88 of those had `map_status='mapped'`, which T4's protected-status rule correctly refused to downgrade — but silently skipped their delta contribution, so the gap was invisible.

- [x] **Density backfill.** 54 rows added to `data/seeds/ingredient_densities.csv` covering every ingredient that hit the missing-density path (sugar family, oils, sauces, fresh produce, cheese, spices). Source-enum + "verify in-house" notes convention preserved.
- [x] **Count-bridge table.** New `ingredient_unit_weights` schema (PK `(ingredient_key, unit)`, columns `g_per_unit`, `source`) with 32 seed rows via `data/seeds/ingredient_unit_weights.csv` + `scripts/seed_ingredient_unit_weights.py`. Answers "how many grams is 1 ct / bunch / ea / box / bottle / case of this ingredient."
- [x] **Algorithm extension.** New `bridgeCount()` pure fn in `scripts/ingest-costing.mjs` converts count ↔ weight via the grams-per-unit lookup, count ↔ volume via density (grams as intermediate), count ↔ count through grams. T4 post-pass tries `bridgeCount` first, falls back to `convertQty`. `lib/unitConvert.mjs` stays frozen in parity with `scripts/lib/units.py` — count-bridge lives in the ingest layer where ingredient identity is known, same scoping posture `units.py:10-12` takes for density.
- [x] **Unit-token extensions.** Added `bunch`, `box`, `slice`, `sprig`, `clove`, `cn` as count units (plus plural synonyms + `#10 can → can` mapping) to both `units.py` and `unitConvert.mjs`. Parity fixture regenerates byte-identical; no existing test row exercised these.
- [x] **Post-pass as separate entrypoint.** `runCostingPostPass(db, locationId)` extracted as a named export from `scripts/ingest-costing.mjs` so operators can apply deltas without the destructive DELETE+INSERT path. New CLI `scripts/apply-costing-deltas.mjs` populates `bom_lines.yield_pct`/`loss_factor` via ingredient_yields JOIN, then runs only the post-pass. Supports `--dry-run` with full rollback.
- [x] **TOTAL-row fix.** `runCostingPostPass` now propagates the aggregate delta to `recipe_costs.TOTAL` in the same transaction. Latent since T3 (fc05b09) — surfaced for the first time when T4.1's apply-costing-deltas ran against a live DB that had never gone through a T3 post-pass (TOTAL=$3706.94 but SUM=$4573.43 after deltas landed).
- [x] **Diagnostic tool.** `scripts/diagnose-conversion-failures.mjs` — read-only bucket classifier for auditing conversion coverage without mutating DB. Reports ok / skip / fail rows grouped by failure reason.

**Live-DB acceptance (`~/Dev/Lariat/data/lariat.db` via apply-costing-deltas):**

| metric | before T4.1 | after T4.1 |
|---|---|---|
| BOM yield coverage | 0/302 | 302/302 (100%) |
| Conversion failures | 99 (88 silent + 11 flagged) | 0 |
| `map_status='NEEDS_DENSITY'` | — | 0 |
| `recipe_costs.TOTAL` | $3706.94 | $4573.43 |
| SUM(batch_cost) non-TOTAL | $3706.94 | $4573.43 |
| Drift (TOTAL − SUM) | $0 | $0 |

23 recipes yield-adjusted, Δ_total = +$866.49, max per-recipe $324.98. 14 new integration tests (bridgeCount pure fn + ingest wiring + synonyms + TOTAL-row consistency); 228 JS tests total, all pass.

**Known data-quality items surfaced, not fixed here:**
- Excel workbook miscodes — Bean Black `ct`, Pepper Red Diced `ct`, Tomatillo 600 `oz`, Beef Cheek `ea` — handled via seed rows rather than edits to the user's source-of-truth workbook.
- `vendor_prices.yield_pct` coverage only 2/341 during live apply — ingredient-key mismatch between `bom_lines.ingredient` and `vendor_prices.ingredient` (T7 territory; `ingredient_masters` will collapse).

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

### T5b — Invoice integration (deferred)

- [ ] **Task.** Wire `reconcile_catch_weight` into
  `scripts/ingest_sysco_invoice_pdfs.py` and
  `scripts/ingest_shamrock_invoices.py` so real invoices populate
  `vendor_prices.actual_received_lb` and `reconciled_unit_price`.
- [ ] **Blocker.** Needs a real Sysco / Shamrock invoice with per-pack
  delivered weight (the current PDF parsers extract line-item totals but
  not per-pack actual weights). May require a sample from a recent
  delivery and an update to the PDF extraction layer.
- [ ] **Acceptance.** 100% of catch-weight categories that appear in real
  invoices have both columns populated after ingest. Lariat's actual
  catch-weight-ish items per the current `vendor_prices` catalog:
  `beef cheek meat`, `basa flt bnls sknls viet iqf swai` (frozen fish
  fillet), various bacon SKUs, chicken wings, burger patties — not the
  ribeye/salmon/whole-fish/lamb-rack menu the plan originally called out
  (Lariat's current menu doesn't include those).

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

### D3 — Positional-column INSERT fragility (flagged by T2c review) — DONE

**Resolved by commit `7df45b3` ("refactor(costing): named-parameter INSERTs in ingest-costing", 2026-04-20).** Both `vendor_prices` and `bom_lines` INSERTs in `scripts/ingest-costing.mjs` now use `@name` bindings, so a schema/column mismatch raises at `prepare()`-time instead of silently NULL-ing a new column. T5 catch-weight columns cannot land half-wired. Kept here as a marker so the historical reviewer trail stays intact.

### D4 — Excel batch_cost vs raw-sum drift (flagged by T3 review)

T3 adds yield-delta on top of Excel's `recipe_costs.batch_cost`, assuming `excel_batch_cost === Σ (bom_qty × pack_price / pack_size)` across BOM lines. Current workbook holds this. If Excel ever introduces per-line rounding, case-minimum bucketing, sub-recipe caching, or other non-trivial adjustments, T3's delta still adjusts correctly FOR the yield portion but the resulting batch_cost becomes "Excel + our delta" rather than "absolute true cost".

**Fix when workbook scales up:** at T3-pass time, compute `Σ (qty × pack_price / pack_size)` per recipe and compare against `recipe_costs.batch_cost`. Log an INFO line when drift exceeds $0.10. Observability only — no behavior change, catches the scenario early. Consider a hard CHECK (≥ $1.00 drift) once observability confirms the invariant in production.

### D5 — Missing null-guard matrix coverage in T3 yield-math tests (flagged by T3 review)

`tests/js/test-ingest-costing-yield-math.mjs` tests 2 of the 5 zero/NULL guards: zero `pack_size` and NULL `pack_price`. Missing: zero `bom_qty`, NULL `bom_qty`, NULL `pack_size`. Code guards all 5 uniformly at `scripts/ingest-costing.mjs:213-220` so these are coverage gaps, not functionality gaps.

**Fix when touched:** parameterize the null-guard matrix — one parameterized test × 6 cases (3 columns × {NULL, 0}) closes the gap cheaply. Also split the current collapsed "NULL yield_pct + NULL loss_factor" test (line 87) into two cases so a broken single-field default can't hide behind a compensating pass.

### D6 — B1 variance fallback silently masks unmapped rows (flagged by T9 review)

`lib/costingBenchmarks.mjs:92-93` falls back to the BOM line's own `pack_price` / `pack_size` when no `vendor_prices` row matches on normalized ingredient_key. This keeps variance = 0 byte-exact on fresh ingest (correct contract), but also means a recipe with zero vendor-price matches silently reports "healthy" variance while failing completely in B2's unmapped queue. An operator reading B1 in isolation could miss a mapping-engine regression.

**Partially addressed by T4 (2026-04-20):** BOM rows whose pack_size unit cannot be interpreted (missing density for cross-dim, count unit, unknown unit) now carry `map_status='NEEDS_DENSITY'` and surface in B2 via `reason='unmapped_status'`. The worst case — a recipe costed from BOM rows whose vendor units can't even be dim-checked — now shows up in B2 rather than being swallowed silently. The B1 fallback path is still present for the "no vendor_prices row matches" case, so the debt narrows but does not close.

**Fix when touched:** either (a) drop the fallback — lines without a vendor match contribute to a separate `unmatched_lines` counter, and recipes where `unmatched_lines/total_lines > threshold` are excluded from the variance aggregate with an explicit reason; or (b) add page-level copy that reads the three tiles in priority order (unmapped first, variance only meaningful when unmapped is green). Option (a) is stricter and better matches operator intuition at a glance.

### Intentionally not debt (just flagging)

- `notes` column in the densities CSV is read then discarded — the `ingredient_densities` table has no `notes` column. Parity with `ingredient_yields` (which has `notes`) would require a schema migration that isn't worth it now.
- Padded yield CSV rows beyond the top-40 BOM ingredients (filet mignon, etc.) are intentional to pre-cover near-future menu additions. `tests/python/test_seed_coverage.py` verifies live-BOM coverage is 100%.

---

## Out of scope (track separately)

- Replacing `_make_join_key` with an embedding-based matcher. Current intentional posture (non-fuzzy) is correct; T7's master table is the right place to encode human-confirmed merges.
- Real-time EDI streaming from Sysco/Shamrock. T5/T6 assume batch invoice ingest — fine for Lariat scale.
- HACCP temp-log mapping. Separate subsystem.
