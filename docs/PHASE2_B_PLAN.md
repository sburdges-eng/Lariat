# Phase 2 B — Settlement Math: Implementation Plan

**Status as of 2026-05-12.**  This document serves as the follow-on agent's source
of truth for Phase 2 task B.  It supersedes the B-section stub in `docs/PHASE2_PLAN.md`
where the two conflict.

---

## Divergence notice — actual state vs. original plan

`docs/PHASE2_PLAN.md` listed `lib/settlementRepo.ts` and `app/shows/[id]/settlement/`
as **future** work for the Phase 2 B leg.  By the time `feat/phase2-event-ops-vertical`
merged (PR #62, 2026-04-28) those files were fully shipped:

| Original plan | Actual state on `main` |
|---|---|
| `lib/settlementRepo.ts` — future skeleton | **Fully implemented** — `getSettlement`, `upsertDeal`, `SettlementSummary` |
| `app/shows/[id]/settlement/` — future route stub | **Fully implemented** — server page + `DealEditor` client component |
| `lib/dealPoints.ts` — not mentioned | **Exists** — `parseDeal`, `computeTalentPayout`, `DealPoint`, `ShowDealRow` |
| Deal data from `shows.status_json.deal` (per plan) | **Actual**: dedicated `show_deals` table (cents-based integers) |
| B2 roll-up shape: `{show_id, ticket_revenue, fees, …}` | **Actual**: nested `SettlementSummary` with sub-objects for ticketing, toast, talent |

The `parseDealTerms` + `DealTerms` additions in this starter PR fill the only
genuine gap: a **defensive raw-JSON parser** for untyped external input (Prism CSV
blob, inbound API body, status_json) before it is normalised into the internal
`DealPoint` (cents-based).  All other B1–B3 items were already shipped.

---

## B1 — Deal-point parser

### Status: **complete** (two layers)

**Layer 1 — DB-row parser (`lib/dealPoints.ts::parseDeal`).**  Takes a typed
`ShowDealRow` from the `show_deals` table and returns a `DealPoint` (cents-based).
Existing; not modified by this PR.

**Layer 2 — Raw-JSON parser (`lib/dealPoints.ts::parseDealTerms`).**  Added by this
PR.  Takes `unknown` (API body, CSV-imported blob, `shows.status_json.deal`) and
returns a validated `DealTerms` (USD-valued).  Throws `InvalidDealShape` on any
missing required field or non-numeric / out-of-range value.

`dealTermsToDealPoint(terms: DealTerms): DealPoint` converts from Layer 2 output to
Layer 1 input, rounding at the USD→cents boundary.

### Curated deal samples (from `test-import-prism-deals.mjs` fixtures)

All three shapes observed in the importer's test fixtures and real Prism backfill CSV:

**Sample 1 — Flat guarantee (most common)**
```json
{ "guarantee_usd": 1500, "vs_pct_after_costs": null, "buyout_usd": 0 }
```
DB: `guarantee_cents=150000, vs_pct_after_costs=NULL, costs_off_top_json='[]', buyout_cents=0`

**Sample 2 — Guarantee + vs% split (mid-tier touring act)**
```json
{
  "guarantee_usd": 1000,
  "vs_pct_after_costs": 0.85,
  "costs_off_top": [{ "label": "Sound", "amount_usd": 50 }],
  "buyout_usd": 0
}
```
DB: `guarantee_cents=100000, vs_pct_after_costs=0.85, costs_off_top_json='[{"label":"Sound","cents":5000}]'`

**Sample 3 — Guarantee + vs% + buyout (includes hospitality)**
```json
{
  "guarantee_usd": 800,
  "vs_pct_after_costs": 0.80,
  "costs_off_top": [],
  "buyout_usd": 250
}
```
DB: `guarantee_cents=80000, vs_pct_after_costs=0.80, buyout_cents=25000`

**Sample 4 — Zero guarantee (free/comp show, bar-only)**
```json
{ "guarantee_usd": 0, "vs_pct_after_costs": null }
```

**Sample 5 — Multi-cost deal (festival split)**
```json
{
  "guarantee_usd": 2500,
  "vs_pct_after_costs": 0.65,
  "costs_off_top": [
    { "label": "Sound", "amount_usd": 50 },
    { "label": "Backline", "amount_usd": 75 },
    { "label": "Hospitality", "amount_usd": 200 }
  ],
  "buyout_usd": 0
}
```

> **Divergence note**: `docs/PHASE2_PLAN.md §B1` described deal input as
> `shows.status_json.deal`.  The live DB stores deals in the dedicated `show_deals`
> table (schema in `lib/db.ts:1884`), not in `status_json`.  The `status_json`
> column on `shows` exists for show-level metadata (booking status, promo notes) but
> does not carry deal terms in the current schema.  If external systems push deals as
> a JSON blob (e.g., a future webhook from DICE or Prism), `parseDealTerms` is the
> intake validator before `dealTermsToDealPoint` + `upsertDeal` normalize it into the
> `show_deals` table.

---

## B2 — Per-show settlement query

### Status: **complete** (`lib/settlementRepo.ts::getSettlement`)

The SQL roll-up is implemented inside `getSettlement(showId, locationId)`.  For
reference, the three sub-queries it runs (as single `db.prepare` calls):

```sql
-- 1. Show row (FK anchor)
SELECT id, band_name, show_date
  FROM shows
 WHERE id = ? AND location_id = ?;

-- 2. Deal terms
SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
  FROM show_deals
 WHERE show_id = ? AND location_id = ?;

-- 3. Ticket roll-up (box_office_lines)
SELECT source, qty, face_price, fees
  FROM box_office_lines
 WHERE show_id = ? AND location_id = ?;

-- 4. Toast bar+food revenue (attributed by show_date)
SELECT COALESCE(SUM(net_sales), 0) AS net_sales,
       COALESCE(SUM(orders),    0) AS orders,
       COALESCE(SUM(guests),    0) AS guests,
       COUNT(*)                    AS rows_found
  FROM toast_sales_daily
 WHERE shift_date = ? AND location_id = ?;
```

`SettlementSummary` shape (actual, in `lib/settlementRepo.ts:91`):

```ts
{
  show:     { id, bandName, date, locationId },
  deal:     DealPoint,                        // cents-based
  ticketing: { grossCents, feesCents, netCents, bySource },
  toast:    { totalCents, ordersCount, guestsCount, attributionDate, rowsFound },
  talent:   { guaranteeCents, vsBonusCents, buyoutCents, totalCents },
  costsOffTopCents: number,
  netDoorCents: number,                       // tickets net − costs − talent
  computedAt: string,                         // ISO timestamp
}
```

> **Divergence note**: The `docs/PHASE2_PLAN.md` B2 roll-up shape
> `{show_id, location_id, ticket_revenue, fees, talent_cost, bar_revenue, food_revenue, net_to_house}`
> was a first-draft sketch.  The actual `SettlementSummary` is richer (nested
> ticketing breakdown by source, separate Toast attribution, talent payout split into
> guarantee + vs-bonus + buyout).  The flat shape from the plan would not support the
> deal-editor or the PDF export.

---

## B3 — Settlement publish surface

### Status: **complete** (`app/shows/[id]/settlement/page.jsx`)

Page: `GET /shows/[id]/settlement?location=<loc>`.  PIN-gated via middleware.

Components shipped:
- `app/shows/[id]/settlement/page.jsx` — server component, reads `getSettlement`, renders ticket + Toast + talent + net-door cards
- `app/shows/[id]/settlement/_components/DealEditor.jsx` — client component, PIN-gated deal form (guarantee, vs%, costs-off-top, buyout)
- `app/shows/[id]/_components/TabStrip.jsx` — shared tab nav (Stage / Sound / Box Office / Settlement)

**Remaining B3 work (not yet shipped):**
- PDF export / "signed settlement" print view — `docs/PHASE2_PLAN.md §B3` says "signed PDF export". Not yet implemented.  Suggest: `react-pdf` or a server-rendered HTML-to-PDF via `puppeteer` at `GET /api/shows/[id]/settlement/pdf`.  PIN-gated.  Out of scope for this starter PR.

---

## B4 — Reconciliation against DICE

### Status: **not started** (depends on Phase 2 C — DICE ingest)

B4 reconciles DICE-provided ticket counts against Lariat's `box_office_lines` rows
(source='dice') and flags variances.  It cannot start until `scripts/ingest-dice.mjs`
(Phase 2 C2) writes to `box_office_lines`.

**Reconciliation rules (to be implemented):**

1. **Count parity** — after DICE ingest, `SUM(qty) WHERE source='dice'` for a show
   must equal `shows.status_json.tickets_sold` (the DICE-reported sold count).
   Variance > 0 → flag in the exception queue.

2. **Revenue parity** — `SUM(face_price * qty) WHERE source='dice'` must equal the
   DICE gross within ±$5 absolute or ±0.5% relative (same tolerance as the
   settlement-vs-Prism criterion in `docs/PHASE2_PLAN.md §Acceptance criteria`).
   Variance outside tolerance → flag.

3. **Scan completion** — at close-of-show, any `box_office_lines` row where
   `scanned_at IS NULL AND source='dice'` is an unscanned ticket.  If unscanned
   count > 0 at `show_date + 2 hours` → surface in the exception queue as "potential
   no-shows or ghost scans".

4. **External-ref orphans** — `box_office_lines.external_ref` must resolve to a
   known DICE order id.  If the DICE API returns a 404 on any `external_ref` during a
   reconcile pass → flag the line as `source_conflict`.

**Exception surface** — variance rows go to `/costing/depletion-exceptions`-shaped
queue (same component reuse pattern as depletion exceptions).  Each row: show,
variance amount, rule that fired, `reconciled_at` timestamp.  Triage action:
"Acknowledge" (writes `audit_events`) or "Re-pull from DICE" (re-triggers
`ingest-dice.mjs --show <id>`).

**Dependency chain:** C1 (DICE OAuth) → C2 (`ingest-dice.mjs`) → B4 reconciliation.
DICE API access was listed as a pre-flight checklist item in `docs/PHASE2_PLAN.md`.

---

## What this starter PR delivers

| Item | File | Status |
|---|---|---|
| `DealTerms` interface (USD, raw/external shape) | `lib/dealPoints.ts` | Added |
| `parseDealTerms(unknown): DealTerms` | `lib/dealPoints.ts` | Added |
| `dealTermsToDealPoint(DealTerms): DealPoint` | `lib/dealPoints.ts` | Added |
| ≥5 tests for `parseDealTerms` | `tests/js/test-settlement-deal-parser.mjs` | Added |
| `test:settlement-deal-parser` npm script | `package.json` | Added |
| B implementation plan (this file) | `docs/PHASE2_B_PLAN.md` | Added |

`computeSettlement` is not a stub here because `getSettlement` in
`lib/settlementRepo.ts` already fully implements B2.  Adding a stub would introduce
a dead code path alongside a working implementation.

---

## Next steps for follow-on PRs

1. **Settlement PDF export** (B3 remaining) — add `GET /api/shows/[id]/settlement/pdf`
   route, PIN-gated, renders a print-ready HTML settlement sheet.  Reference the
   `netDoorCents`, `talent.totalCents`, and `ticketing.grossCents` fields from
   `SettlementSummary`.

2. **DICE B4 reconciliation** — after `scripts/ingest-dice.mjs` lands (Phase 2 C2),
   implement the four reconciliation rules above.  Wire into the exception queue
   component.

3. **Settlement parity check** — once 6 real shows have run through Lariat settlement,
   run `scripts/verify-settlement-parity.mjs` (to be written) to compare against Prism
   exports.  Block Prism cutover until parity criterion is met.
