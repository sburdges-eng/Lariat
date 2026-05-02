# Breaker Audit — 2026-05-02 — Section 4

**Section covered:** 4 — Costing / inventory / vendor price history / unit parity.

**Auditor:** claude

**Read-only:** YES.

**GitNexus:** reindexed during this pass (16,206 nodes / 24,779 edges).

---

## Method

Six-prong checklist applied to the financial computation pipeline:
- `lib/computeEngine/` (recipeCosting, marginAnalysis, accountingVariance, sandboxCosting)
- `lib/costingBenchmarks.mjs` — the resolver
- `lib/vendorPricesRepo.ts` — the upsert path
- `scripts/ingest-costing.mjs` — the destructive ingest
- `scripts/import-vendor-prices.mjs` — the out-of-band beverage importer
- `vendor_prices_history` schema + readers
- `lib/unitConvert.mjs` ↔ `scripts/lib/units.py` parity tables
- `lib/ingredientKey.ts` ↔ `scripts/lib/ingredient_key.py` normalize
- `lib/salesDepletion.ts` — inventory_updates writer (read-only check)

---

## Findings

| # | Priority | Title |
|---|---|---|
| 1 | **P1** | `upsertVendorPrice` (the only beverage-import write path) UPDATEs `vendor_prices` rows in place without snapshotting to `vendor_prices_history`. Beverage price-trend history has gaps between costing ingests; the manager-facing trend tile silently mis-renders the beverage class. [Full record](findings/2026-05-02-beverage-vendor-prices-history-gap.md). |

No P0, P2, or P3 findings this pass.

---

## Verified-correct surfaces

- **`scripts/ingest-costing.mjs:268-297`** — snapshot INSERT happens BEFORE the DELETE, both in one `db.transaction`, with beverage rows preserved via `COALESCE(LOWER(category), '') NOT IN (BEVERAGE_CATEGORIES)`. The food-side history contract holds.
- **`lib/computeEngine/recipeCosting.ts:34`** — `recomputeRecipeCosts` delegates to `computeCostVariance` from `costingBenchmarks.mjs`. The "split-resolver" regression (the one CLAUDE.md says this module exists to prevent) is closed.
- **`lib/unitConvert.mjs` ↔ `scripts/lib/units.py`** — the WEIGHT_TO_G and VOLUME_TO_ML factor tables are byte-exact mirrors. The parity test (`test-unit-convert-parity.mjs`) is the load-bearing gate; spot-check confirms the tables match.
- **`lib/ingredientKey.ts` ↔ `scripts/lib/ingredient_key.py`** — both implement the same 4-step algorithm (lower → strip-bracket-prefix → drop-non-alphanum → collapse-whitespace). The order of `.trim()` calls differs cosmetically but the composition is equivalent under all input shapes I could construct. Parity test (`test-ingredient-key-parity.mjs`) is the gate.
- **`lib/salesDepletion.ts:445-461`** — inventory_updates writes use `direction` ('in'/'out') and `note`, with `audit_events` posted in the same transaction. Mirrors the receiving closed-loop credit shape from #95.
- **`vendor_prices_history` schema** (`lib/db.ts:1194-1220`) — partial unique index pattern is correct; indexes on `(location_id, vendor, sku)`, `snapshot_at`, and `ingredient` cover the trend-query shape.

---

## Test gaps surfaced

- **`tests/js/test-vendor-prices-history-on-upsert.mjs` does not exist.** The existing `test-vendor-prices-history-and-beverage-preserve.mjs` only covers the costing-ingest snapshot path. Add a test that calls `upsertVendorPrice` twice with different prices and asserts a snapshot of the OLD price exists in `vendor_prices_history`.
- The compute-engine resolver delegation has no anti-regression test that fails if a future change to `recipeCosting.ts` introduces its own ingredient→price matching code instead of calling `computeCostVariance`. A "did anyone duplicate the resolver?" grep test would close that loop.

---

## Recommended next moves

1. **Fix finding #1** — the snapshot in `upsertVendorPrice` is a ~10-line add inside the existing transaction. Pair with the new test. Single-purpose PR.
2. **Hoist `snapshotVendorPriceById(db, id, reason)`** to `lib/vendorPricesHistory.ts` (a new file) so future writers compose correctly. That's a `contract-hardening` refactor per `REFACTOR_GOVERNANCE.md`. Optional and can ride finding #1's PR.
3. **Section 5 next pass** — Shows / settlement / box office. Highest-leverage remaining section because it touches money flowing OUT (talent payouts) and is freshly Phase 2-built so the convention is still evolving.

---

## Stop conditions hit

None. Section 4 sweep completed.

---

## Workflow notes

- The fresh GitNexus reindex paid for itself: tracing `upsertVendorPrice` callers via `mcp__gitnexus__context` would have surfaced the gap faster than the grep walk I used. Next pass I'll lead with the graph query.
- The financial-pipeline section has more verified-correct surfaces than any prior section. That's a good sign — the unit parity tests, the resolver delegation, and the costing-ingest snapshot order are all load-bearing patterns that have held up. The one real gap (beverage upsert history) is a single un-bridged path between two systems that were each individually correct.
