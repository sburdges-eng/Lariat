# Breaker Audit Finding

**Subsystem:** Shows / box office (Section 5)

**Invariant:** Cash custody is regulated. Per `docs/PHASE2_PLAN.md`: "DICE ticket count vs scanned count variance ≤ $0 at close-of-show." The Phase 2 plan specifies idempotent ingest of DICE tickets via `bulkUpsertFromDice` "idempotent UPDATE on external_ref" — i.e., re-running the DICE pull on the same set of orders MUST produce identical `box_office_lines` rows, not duplicate them.

The contract is also documented at the top of `lib/boxOfficeRepo.ts:5,17`:
> "'dice' — DICE order (external_ref = order id; deduped on it)"
> "bulkUpsertFromDice(db, lines): idempotent UPDATE on external_ref"

**Break attempt:**
1. Build the documented behavior — try to import `bulkUpsertFromDice` from `lib/boxOfficeRepo.ts`.
2. Insert a DICE line via `createBoxOfficeLine(db, { source: 'dice', external_ref: 'DICE-12345', qty: 1, ... })`.
3. Re-insert the same line — same `external_ref`, same show, same qty.

**Observed result:**

(1) `bulkUpsertFromDice` is **not exported** from `lib/boxOfficeRepo.ts`. The exported functions are `listLinesForShow`, `summarizeBoxOffice`, `createBoxOfficeLine`, `markScanned`, `boxOfficeCompleteness`. The doc-comment promises a function that doesn't exist.

(2) The schema at `lib/db.ts:1799-1817` declares:
```sql
CREATE TABLE IF NOT EXISTS box_office_lines (
  ...
  external_ref TEXT,
  ...
);
CREATE INDEX IF NOT EXISTS idx_box_office_source
  ON box_office_lines(source, external_ref);
```

The index is **not** unique. `external_ref` has no UNIQUE constraint. The DB will not refuse a duplicate `(source='dice', external_ref='DICE-12345')` insert.

(3) `createBoxOfficeLine` (the only INSERT path today) accepts `external_ref` from the caller and INSERTs it verbatim with no pre-check. A scripted DICE ingest that uses this path will silently double-credit on retry.

**Expected result:** A `UNIQUE` partial index on `(source, external_ref) WHERE external_ref IS NOT NULL` (matching the partial-unique pattern used by `inventory_updates.receiving_log_id` from #95), plus a `bulkUpsertFromDice(db, lines)` helper that uses `INSERT … ON CONFLICT(source, external_ref) DO UPDATE …` so a re-run is a no-op (or updates non-key fields).

**Risk:** P1. Talent-payout settlement variance. Today the gap is dormant because `scripts/ingest-dice.mjs` doesn't exist yet (Phase 2 §C2 — future). When it lands:

- A retry after a network hiccup mid-ingest produces 2× rows for the affected DICE orders.
- `getSettlement` sums `qty * face_price` across `box_office_lines`, so duplicated rows inflate `grossCents`.
- Inflated `grossCents` increases the talent's `vsBonus` (since `overage = gross - costs - guarantee`).
- Net effect: the venue overpays talent by a factor proportional to the dup count, with the audit trail showing TWO 'insert' events but no 'duplicate' anomaly.

The Phase 2 plan's "settlement variance ≤ $5 / 0.5%" acceptance criterion is unreachable until this is closed because a single retry can blow past $5 trivially on a $5,000 door.

**Repro command:**
```bash
# Confirm the contract gap:
grep -n "bulkUpsertFromDice" lib/boxOfficeRepo.ts
# Returns the doc-comment lines only — no export.

grep -n "UNIQUE" lib/db.ts | grep box_office_lines
# Returns nothing — no UNIQUE constraint on external_ref.

# (Once #ingest-dice lands, a runtime test would POST identical lines twice
# and assert exactly one row exists.)
```

**Likely files:**
- `lib/db.ts:1799-1817` — add `CREATE UNIQUE INDEX IF NOT EXISTS idx_box_office_external_ref_unique ON box_office_lines(source, external_ref) WHERE external_ref IS NOT NULL;` via `migrateLegacyColumns` (don't edit existing DDL in place per CLAUDE.md hard rules).
- `lib/boxOfficeRepo.ts` — implement the documented `bulkUpsertFromDice` using `ON CONFLICT(source, external_ref) DO UPDATE`. Stays in the same `db.transaction` wrapping `postAuditEvent`, mirroring `createBoxOfficeLine`.
- New: `tests/js/test-box-office-dice-idempotency.mjs` — pin the contract with a 2× insert test.

**Fix class:** schema (migration) + logic + test

**Priority:** **P1** — latent until the DICE ingest lands, but the gap is named in the Phase 2 plan and the doc-comment, and is a money-losing bug the moment the importer ships.

---

## Optional notes

- The fix is small but has THREE moving parts (migration, function, test). One PR.
- The partial unique index pattern (`WHERE external_ref IS NOT NULL`) matches what #95 used for the `receiving_log_id` FK. Walkup/comp/will_call lines that legitimately have no external_ref must not collide with each other.
- Adjacent thing noticed but NOT this finding: `getSettlement` reads `box_office_lines.qty` as a number and multiplies by `face_price`. If `qty` is ever stored fractional (it's INTEGER in the schema, so this is unlikely), the rounding chain `Math.round(face_price * qty * 100)` would compound. Not a bug today, just a footnote.
