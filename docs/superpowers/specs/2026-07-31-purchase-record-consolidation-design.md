# Purchase-record consolidation and BOM chaining — design

**Date:** 2026-07-31
**Status:** DRAFT — awaiting approval before any code
**Scope:** Phase 1 consolidation (this doc's detail) · Phase 2 chaining (sketched, re-spec before starting)
**Prompted by:** PR #594 closed the April/May Sysco hole; the next question — "what did we
actually spend?" — cannot be answered from the current stores.

---

## 1. The problem

The purchase record is scattered across **five stores that have never been reconciled**, in two
different technologies, keyed on **five different identifier namespaces**.

| Store | Tech | Span | Docs | Total | Key format |
| --- | --- | --- | --- | --- | --- |
| `shamrock_invoices` | SQLite, 640 rows | 2025-09-29 .. 2026-03-26 | 68 | $33,824.51 | `9042239` — **Sales Order** |
| `sysco_invoices` | SQLite, 111 rows | 2026-03-09 .. 2026-03-26 | 7 | $9,140.17 | `759616979` — invoice |
| `photo_invoices` (+ `_lines`) | SQLite, 108 / 978 | 2025-07-03 .. 2026-06-12 | 108 (Sham 56 / Sysco 52) | $50,992.68 | `34151702` Sham · `759052072` Sysco — invoice |
| `vendor_summary.json` → `sysco.recent_items` | JSON cache, 207 items | .. 2026-06-01 | 19 | ~$14.4k recovered | `04488128` — **order number** |
| `spend_monthly` | SQLite, 7 rows | 2025-09 .. 2026-03 | — | $33,824.51 | month, **Shamrock only** |

### Why this is not a merge

Two structural facts make a naive union wrong.

**1. The stores hold different documents in one order lifecycle.** `shamrock_invoices` is built
from *order-confirmation* .xls exports (its `invoice_no` is the Sales Order field). The Shamrock
half of `photo_invoices` is built from photographs of the *delivered invoice*. The same physical
delivery legitimately appears in both, under numbers that can never match — 7-digit `90xxxxx`
against 8-digit `34xxxxxx`. The same holds on the Sysco side: the JSON cache keys on order
numbers (`04xxxxxx`) recovered from confirmation emails, while both `sysco_invoices` and the photo
rows key on invoice numbers (`759xxxxxx`).

Invoice-number dedupe reports **zero collisions across all four pairs**. That is a false negative,
not a clean bill of health.

**2. Dates are not comparable across stores.** Matching order-confirmation totals against
photo-invoice totals finds 5 exact-dollar matches in 68 — and **every one is exactly 21 days
apart**:

```text
conf 2025-10-20  $426.68  ->  photo 2025-11-10
conf 2025-10-23  $286.23  ->  photo 2025-11-13
conf 2025-11-03  $168.08  ->  photo 2025-11-24
conf 2025-12-11   $56.01  ->  photo 2026-01-01
conf 2025-12-11   $49.66  ->  photo 2026-01-01
```

Five for five at +21d is a billing cycle, not coincidence: `photo_invoices.invoice_date` is
carrying a **net-21 billing date**, not a delivery date. Any month-bucketed spend built from
`photo_invoices` is therefore shifted roughly three weeks late, and cross-store date matching on
raw dates is wrong by construction.

**Consequence today:** there is no query that answers "what did we spend in November" without
either double-counting deliveries present in two stores or missing those present in only one.
`spend_monthly` sidesteps this by covering one vendor from one source, and its schema —
a literal `shamrock_total_spend` column — cannot express a second vendor.

### Known-adjacent, deliberately out of scope here

`check_invoice_duplicates.py` (#594) addresses a *different* duplication: byte-identical
re-downloads inside the PDF archive (53 files / 35 invoices, $56,926 against $112,473). That is
filesystem hygiene upstream of ingest. This design assumes it has been run; it does not re-solve it.

---

## 2. What we are building — Phase 1

One canonical, append-only `purchase_lines` table that every ingest writes into, plus a read model
that is honest about which document a number came from.

### 2.1 Schema (new table, additive migration)

```sql
CREATE TABLE purchase_lines (
  id             INTEGER PRIMARY KEY,
  location_id    TEXT NOT NULL DEFAULT 'default',
  vendor         TEXT NOT NULL,          -- 'shamrock' | 'sysco'
  doc_type       TEXT NOT NULL,          -- 'order_confirmation' | 'invoice'
  doc_no         TEXT NOT NULL,          -- as printed, namespace per (vendor, doc_type)
  doc_date       TEXT,                   -- date as printed on the document
  delivery_date  TEXT,                   -- normalized; NULL when not derivable
  date_basis     TEXT NOT NULL,          -- 'delivery' | 'billing_net21' | 'unknown'
  sku            TEXT,
  description    TEXT NOT NULL,
  qty            REAL,
  unit           TEXT,
  pack_size      TEXT,
  unit_price     REAL,
  line_total     REAL NOT NULL,
  source         TEXT NOT NULL,          -- which ingest wrote it
  source_file    TEXT,
  superseded_by  INTEGER REFERENCES purchase_lines(id),
  imported_at    TEXT NOT NULL,
  UNIQUE(vendor, doc_type, doc_no, sku, description, location_id)
);
```

`date_basis` is the fix for the 21-day finding: it records what the date on the row *means*,
so a reader can never silently bucket a billing date as a delivery date.

### 2.2 The dedupe rule — supersession by source quality

> **Revised 2026-07-31 after measuring `photo_invoices`.** The original rule was
> "invoice supersedes order confirmation." That is wrong here, because our invoice-typed data is
> the *least* trustworthy source we have. Only **2 of 108** photo invoices reconcile
> (header total == sum of lines); 79 mismatch and 27 carry no lines at all. Lines sum to
> $57,234.70 against $50,992.68 of headers. It is OCR output, and `parse_confidence` is 0.0 on all
> 978 rows — the column was never populated, so it cannot gate anything. Letting `doc_type` alone
> decide precedence would have let unreconciled OCR override clean order-confirmation exports.

Precedence is by **source quality**, highest first, evaluated per (vendor, month):

| Tier | Source | Basis label | Why |
| --- | --- | --- | --- |
| 1 | invoice rows that reconcile (Sysco PDF ingest) | `invoice` | billed amount, internally consistent |
| 2 | order confirmations (Shamrock .xls, Sysco emails) | `estimated` | what we ordered; reconciles, but pre-delivery |
| 3 | photo/OCR rows | `photo_ocr` | last resort; only where nothing else covers the month |

Rules:

- Within a (vendor, month), count **exactly one tier** — the highest available. Never sum tiers.
- Every month in the read model carries its tier's basis label. A `photo_ocr` month is a visible
  admission that we are reading a photograph, not an accounting record.
- A photo row never supersedes a reconciling source, regardless of `doc_type`.

This still needs no fuzzy matching and still cannot double-count. `superseded_by` remains
unpopulated pending the net-21 answer (§5.1).

`purchase_lines` therefore carries one extra column:

```sql
  line_detail_status TEXT NOT NULL,   -- 'reconciled' | 'unreconciled' | 'header_only'
```

This cannot double-count, needs no heuristic matching, and degrades visibly rather than silently.
The `superseded_by` column exists so that a confirmation→invoice link can be recorded later if a
reliable one is found (the +21d rule is a candidate, but 5 of 68 is not enough evidence to
automate on — see §5).

### 2.3 `spend_monthly` migration

`shamrock_total_spend` becomes vendor-keyed. New shape, populated by rebuild from
`purchase_lines`, old column dropped only after parity is proven:

```sql
-- month, vendor, total_spend, basis ('invoice' | 'estimated'), source, location_id
```

### 2.4 Ingest changes

Five writers, each additive — no existing table loses its rows or its current behavior in Phase 1:

| Writer | Change |
| --- | --- |
| `ingest_shamrock_invoices.py` | also write `purchase_lines` as `doc_type='order_confirmation'`, `date_basis='delivery'` |
| `ingest_sysco_invoice_pdfs.py` | also write as `doc_type='invoice'`, `date_basis='delivery'` |
| `ingest_sysco_order_emails.py` | also write as `doc_type='order_confirmation'`, `date_basis='delivery'` |
| `ingest_invoice_photos.py` | also write as `doc_type='invoice'`, `date_basis='billing_net21'` |
| `vendor_summary.json` | becomes a *derived cache* rebuilt from `purchase_lines`, not a write target |

---

## 3. Acceptance criteria — Phase 1

1. `purchase_lines` holds every line from all four line-level sources; row counts reconcile
   per-source against the origin table (640 + 111 + 978 + 207, minus documented skips).
2. Per-source dollar totals reconcile to the origin store to the cent. **Exception, expected and
   pinned:** `photo_invoice_lines` does not reconcile to `photo_invoices` headers (2 of 108). The
   test asserts the *known* drift rather than equality, so a change in that drift is a failure.
3. No (vendor, month) total ever mixes two source tiers — pinned by test, not convention.
4. Every month in the read model carries an explicit `invoice` / `estimated` / `photo_ocr` basis.
5. `spend_monthly` rebuilt from `purchase_lines` reproduces the current 7 Shamrock months exactly
   before the old column is dropped.
6. Re-running any ingest twice changes nothing (idempotent on the UNIQUE key).
7. `vendor_summary.json` regenerated from `purchase_lines` is byte-stable across runs.
8. `pytest tests/python` and `npm run verify` green.

---

## 4. Phase 2 — chaining (sketch only, re-spec before starting)

With one purchase record, the chain invoice → ingredient → BOM → recipe cost can be closed.
Current state: `bom_lines.map_status` = **313 mapped · 2 auto_mapped · 157 UNMAPPED · 28 NULL** —
185 of 500 lines (37%) carry no vendor link, so cost stops before it reaches `recipe_costs`
(42 rows).

Intended shape, deliberately not designed in detail yet:

1. Surface the unmapped queue as a real worklist (`MAPPING_ENGINE_GAPS` B2, still open).
2. Work it down against the consolidated `purchase_lines` catalog, which after Phase 1 has
   materially more SKUs to match against than `vendor_prices` alone.
3. Only then build theoretical-vs-actual variance (`MAPPING_ENGINE_GAPS` B1), which needs both a
   trustworthy actual (Phase 1) and a complete theoretical (steps 1–2).

Doing variance before 1–2 produces a number that is confidently wrong — the exact failure mode
`CLAUDE.md` §7 warns about for costing.

---

## 5. Open questions for Sean

1. **Is the +21d Shamrock offset a real billing term?** If you confirm net-21, it becomes a
   deterministic confirmation→invoice link and `superseded_by` can be populated automatically
   rather than left for later. Five matches is suggestive, not sufficient.
2. ~~What `parse_confidence` floor excludes a photo line from spend?~~ **Answered by the data,
   2026-07-31: none is possible.** `parse_confidence` is 0.0 on all 978 rows — never populated. 24
   of 108 photo invoices also have a NULL `invoice_no`. Handled by tiering photo/OCR last (§2.2)
   rather than by a threshold. **Standing question instead:** is the photo archive worth
   re-parsing, or is it evidence-only? Tier 3 means it currently contributes spend for months no
   other source covers — 2025-07/08 and 2026-04..06 on the Shamrock side.
3. **Toast subscription invoices** (48 docs / 394 lines) are SaaS spend, not food. Confirm they
   stay out of `purchase_lines` — I have assumed out.
4. **Where does the Shamrock invoice-photo archive live**, and has it been through
   `check_invoice_duplicates.py`? Phase 1 assumes a deduped input.

---

## 6. Risk

- **Regulated-surface adjacency:** none. `purchase_lines` is costing data, touching no
  `PROTECTED_CONTRACTS.md` family. No PHI, no ledger, no sync envelope.
- **Schema change:** additive new table + one `spend_monthly` migration. Reversible; the old
  column survives until criterion 5 passes.
- **Blast radius:** `vendor_summary.json` changes from a written artifact to a derived one. Its
  readers must be enumerated before that flip (GitNexus is web-only — see the memory note — so
  this enumeration is grep, not `impact`).
