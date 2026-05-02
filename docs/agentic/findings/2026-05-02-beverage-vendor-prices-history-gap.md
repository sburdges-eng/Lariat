# Breaker Audit Finding

**Subsystem:** Costing / vendor price history (Section 4)

**Invariant:** `vendor_prices_history` is the **append-only** history of vendor prices. The "price-trend invariant" in `CLAUDE.md` says: "Before the DELETE, scripts/ingest-costing.mjs snapshots every current row into append-only vendor_prices_history keyed on run_id+snapshot_at. The DELETE also preserves any row whose `LOWER(category)` is in `BEVERAGE_CATEGORIES` — those are populated out-of-band by `scripts/import-vendor-prices.mjs` and survive the sweep."

The implicit contract: every change to `vendor_prices` is reflected in `vendor_prices_history`. The food side honours this because the costing ingest snapshots-then-DELETEs-then-INSERTs. The beverage side does not.

**Break attempt:**
1. Operator imports beverage CSV at price A: `npm run import:vendor-prices -- beverages.csv` → vendor_prices row inserted at price A.
2. Operator updates beverage CSV to price B (e.g. distributor changes): `npm run import:vendor-prices -- beverages-v2.csv` → vendor_prices row UPDATEd in place to price B.
3. Query: `SELECT pack_price, snapshot_at FROM vendor_prices_history WHERE category = 'beer' ORDER BY snapshot_at` to reconstruct the price trend for that beer.

**Observed result:** `vendor_prices_history` returns rows only from the most recent costing-ingest run (which snapshots the post-update state). The pre-update price A is **lost from history**. `lib/vendorPricesRepo.ts::upsertVendorPrice` (called by `scripts/import-vendor-prices.mjs:285`) does an in-place UPDATE on lines 171–177:

```ts
db.prepare(
  `UPDATE vendor_prices
      SET pack_size = ?, pack_unit = ?, pack_price = ?, unit_price = ?,
          category = ?, imported_at = datetime('now')
    WHERE id = ?`,
).run(...);
```

There is no preceding `INSERT INTO vendor_prices_history ... SELECT FROM vendor_prices`. The OLD price is overwritten in place with no trace.

**Expected result:** Either (a) `upsertVendorPrice` snapshots the pre-update row to `vendor_prices_history` before the UPDATE (preferred — keeps the helper canonical and works for any caller), or (b) `import-vendor-prices.mjs` does a snapshot pass before invoking the upsert loop (matches the costing-ingest pattern). Either way: in the same `db.transaction` so a UPDATE failure rolls back the snapshot.

**Risk:** Beverage price-trend reconstruction has gaps proportional to the gap between two beverage CSV imports without a costing ingest between them. In the typical operator cadence (weekly costing ingest, occasional ad-hoc beverage price updates from a distributor change), most beverage price changes will be lost from the trend before the next snapshot fires.

The price-trend tile (`/api/vendor-prices/history` and the `/costing` view that consumes it) silently mis-renders the beverage class — the chart shows fewer points and a discontinuous jump from old → new price. A manager investigating "why did beer cost change?" sees no record of when, only the most recent snapshot.

**Repro command:**
```bash
# Assert the function lacks a snapshot path:
grep -n "INSERT INTO vendor_prices_history" lib/vendorPricesRepo.ts scripts/import-vendor-prices.mjs
# Returns nothing — gap confirmed.

# Assert the existing test doesn't cover the upsert-path snapshot contract:
grep -n "import-vendor-prices\|upsertVendorPrice" tests/js/test-vendor-prices-history-and-beverage-preserve.mjs
# Returns nothing.
```

**Likely files:**
- `lib/vendorPricesRepo.ts:148-196` — `upsertVendorPrice` (preferred fix site)
- `scripts/import-vendor-prices.mjs:282-290` — alternative fix site
- New: `tests/js/test-vendor-prices-history-on-upsert.mjs` — pin the new contract

**Fix class:** logic + test

**Priority:** **P1** — silent data loss on financial price-trend history. Not a current production crash, but the data is gone from the moment the second import lands.

---

## Optional notes

- Cleanest fix: at the top of `upsertVendorPrice`'s transaction, after the SELECT-existing block, if `existing && !skipped`, `INSERT INTO vendor_prices_history (...) SELECT ... FROM vendor_prices WHERE id = existing.id` with `snapshot_reason='upsert-vendor-price'` (or `'beverage-import'` if the caller passes a tag). Then proceed with UPDATE. Same transaction.
- The snapshot_reason tag is already in the schema (`lib/db.ts:1194`) and used by the costing-ingest snapshot. The trend chart can color-code points by reason — useful for the manager investigating a price change.
- Adjacent thing noticed but NOT this finding: `upsertVendorPrice` returns `{ outcome: 'updated', row: refetched }` BEFORE the snapshot would land in the proposed fix. Make sure the snapshot fires BEFORE the UPDATE so the snapshot captures the pre-change state, not the post-change state.
- Adjacent thing #2: Same gap could exist for any future helper that mutates `vendor_prices` in place (e.g. an admin "fix the price typo" surface). The snapshot-on-write should be a single canonical path. Consider hoisting it into a `lib/vendorPricesHistory.ts::snapshotVendorPriceById(db, id, reason)` helper so every future caller composes correctly.
