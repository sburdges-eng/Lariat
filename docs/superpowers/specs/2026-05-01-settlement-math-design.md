# Settlement math — design

**Phase 2 task:** B (settlement math). **Scope:** B1 + B2 + B3 (page only). B4 (DICE reconciliation) is deferred — blocked on Task C. PDF export is deferred — its own slice once parity is established.

**Plan source:** `docs/PHASE2_PLAN.md` §B. This spec narrows that plan to a shippable slice and resolves the open shape questions the plan left as TBD (deal storage, time-window attribution, PIN scoping).

## Goal

Lariat computes per-show settlement (ticket revenue − fees − talent payout − costs-off-top + Toast bar/food) for any show in the DB, surfaces it on a manager-gated page, and lets a manager edit the deal-point inputs. The slice ships when six consecutive shows produce a settlement number that ties out against the Prism number to within $5 / 0.5%.

## Out of scope (named, so we don't drift)

- PDF export, signed or otherwise.
- DICE reconciliation queue (B4 — blocked on Task C).
- Multi-show-per-night attribution.
- Talent ACH disbursement.
- Backfill of historical deals from Prism CSV.
- Per-route role splits (sound engineer vs box-office manager) — deferred to Phase 3 labor.

## Schema — one new table

`show_deals` is first-class (not nested in `shows.status_json`) so the settlement query is plain SQL and audit / migration / typed access all come for free.

```sql
CREATE TABLE IF NOT EXISTS show_deals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id            INTEGER NOT NULL REFERENCES shows(id),
  location_id        TEXT NOT NULL DEFAULT 'default',
  guarantee_cents    INTEGER NOT NULL DEFAULT 0,
  vs_pct_after_costs REAL,                          -- 0.0–1.0, NULL for flat-guarantee deals
  costs_off_top_json TEXT NOT NULL DEFAULT '[]',    -- [{label,cents}]
  buyout_cents       INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_cook_id TEXT,
  UNIQUE (show_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_show_deals_show ON show_deals(show_id, location_id);
```

**Money discipline.** Cents-as-INTEGER, not REAL dollars. Kills float drift in compounded settlement math; converts to dollars only at the rendering boundary. The existing `box_office_lines.face_price` / `fees` and `sales_lines.net_amount` stay REAL (their tables predate this spec); the parser converts them to cents at read time, then the settlement aggregate stays in INTEGER.

**Migration.** Added in a new initializer block in `lib/db.ts`. Per the `CLAUDE.md` hard rule, no edits to existing DDL.

## Components

```
lib/dealPoints.ts          — pure-fn parser + computeTalentPayout (no I/O)
lib/settlementRepo.ts      — getSettlement(showId, locationId), upsertDeal(showId, deal, cookId)
app/api/shows/[id]/settlement/route.js  — GET, PIN-gated
app/api/shows/[id]/deal/route.js        — GET / PUT, PIN-gated
app/shows/[id]/settlement/page.jsx      — read view + collapsed deal editor
tests/js/test-deal-points.mjs           — pure-fn boundary cases
tests/js/test-settlement-repo.mjs       — in-memory SQLite + real audit_events
```

Plus a new entry in `app/_components/navRegistry.js` so the palette and floorplan don't drift.

### `lib/dealPoints.ts` — pure module

```ts
export type DealCost = { label: string; cents: number };

export type DealPoint = {
  guaranteeCents: number;
  vsPctAfterCosts: number | null;     // null = flat guarantee, no overage split
  costsOffTop: DealCost[];
  buyoutCents: number;
};

export function parseDeal(row: ShowDealRow): DealPoint;        // throws on malformed costs_off_top_json
export function emptyDeal(): DealPoint;                        // {0,null,[],0}

export function computeTalentPayout(args: {
  deal: DealPoint;
  ticketRevenueCents: number;
}): {
  guaranteeCents: number;     // always = deal.guaranteeCents
  vsBonusCents: number;       // 0 if vs_pct null or under guarantee
  buyoutCents: number;
  totalCents: number;
};
```

Formula:
```
overage      = max(0, ticketRevenueCents − Σcostsoff_top − guaranteeCents)
vsBonus      = vsPctAfterCosts == null ? 0 : floor(overage × vsPctAfterCosts)
total        = guaranteeCents + vsBonus + buyoutCents
```

Boundary tests:
1. Flat guarantee, ticket revenue > guarantee → bonus 0.
2. vs deal, revenue ≤ guarantee + costs → bonus 0.
3. vs deal, revenue > guarantee + costs → bonus = (overage × pct) floor.
4. All-zero deal → total 0.
5. Costs > revenue → overage clamped at 0.
6. Buyout-only (no guarantee) → total = buyout.

### `lib/settlementRepo.ts`

```ts
export type SettlementSummary = {
  show: { id: number; bandName: string; date: string; locationId: string };
  deal: DealPoint;
  ticketing: {
    grossCents: number;     // Σ(face_price × qty)
    feesCents: number;      // Σ(fees × qty)
    netCents: number;       // gross − fees
    bySource: Record<'dice'|'walkup'|'comp'|'will_call'|'guestlist', { qty: number; grossCents: number }>;
  };
  toast: {
    foodCents: number;
    barCents: number;
    totalCents: number;
    attributionDate: string;     // = shows.show_date for v1
    sourceRowCount: number;
  };
  talent: {
    guaranteeCents: number;
    vsBonusCents: number;
    buyoutCents: number;
    totalCents: number;
  };
  netDoorCents: number;          // ticketing.netCents − costsOffTop − talent.totalCents
  costsOffTopCents: number;
  computedAt: string;
};

export function getSettlement(showId: number, locationId: string): SettlementSummary;
export function upsertDeal(showId: number, deal: DealPoint, cookId: string, locationId: string): void;
```

Both functions go through the existing `getDb()` helper; `upsertDeal` wraps the UPSERT and the `audit_events` write in a single `db.transaction(...)` per `docs/PATTERNS.md §3`.

`getSettlement` is read-only and a single function call (no transaction needed). Sequence:
1. SELECT `shows` row by `(id, location_id)` — 404 if missing.
2. SELECT `show_deals` row, fall back to `emptyDeal()` if none.
3. Aggregate `box_office_lines` by `source` and overall.
4. Aggregate `sales_lines` filtered to `business_date = shows.show_date`, split by category bucket.
5. Compute talent payout and net door from the deal + aggregates via `computeTalentPayout`.

### Bar/food category buckets

Read once from `lib/saleCategories.ts` (existing file or new const if it doesn't exist):

```ts
export const BAR_CATEGORIES = new Set(['Bar', 'Beer', 'Wine', 'Spirits', 'Cocktail', 'NA']);
export const FOOD_CATEGORIES = new Set(['Food', 'Kitchen', 'Snack', 'Dessert']);
```

If a `sales_lines.category` value is in neither set, it counts toward `toast.totalCents` only (visible as "Uncategorized" line). The implementer should grep `sales_lines.category` distinct values during build and adjust the sets to match production data — this spec assumes the buckets above as a starting list.

### Routes

- `GET  /api/shows/[id]/settlement` → `SettlementSummary` JSON. PIN-required.
- `GET  /api/shows/[id]/deal`       → `{ deal: DealPoint } | { deal: null }`. PIN-required.
- `PUT  /api/shows/[id]/deal`       → upsert. Body: `{ deal: DealPoint }`. PIN-required. Validates each numeric field is a non-negative integer, `vsPctAfterCosts` is `null` or `0 ≤ x ≤ 1`, `costsOffTop` is an array of `{label: string, cents: int}`. Returns the post-write `SettlementSummary`.

Both routes go through `lib/pin.ts::hasPinCookie()` and `lib/location.ts::locationFromRequest()`. Add the three paths to the gated set in `middleware.js`.

### Page — `/shows/[id]/settlement`

Read-only by default; collapsed `<details>` block with the deal editor. The editor PUT-s back, the page revalidates. Uses `useLocation()` and follows the existing `app/shows/[id]/_components/` patterns.

Layout (top to bottom):
1. Show header (band, date, room).
2. Ticketing panel — gross / fees / net, breakdown by source.
3. Toast panel — food / bar / total, attribution date, row count.
4. Talent panel — guarantee / vs bonus / buyout / total. Editor button.
5. Net door (large).

UI copy follows `docs/UI_COPY_RULES.md` — no SaaS jargon. "Talent payout" not "Talent compensation"; "Net to door" not "Net revenue."

## Time-window attribution (the rule)

A show's Toast revenue is `sales_lines` where `business_date = shows.show_date`. **Single rule, single date column join.**

**Documented limitation.** Multi-show-per-night attribution is undefined for v1; if both shows share a `show_date`, the manager sees combined revenue on each settlement. A future slice can add `shows.business_window` (start_at, end_at) for time-bucketed splitting. This is the lowest-friction rule that ships parity vs Prism (which also runs daily).

## PIN gate

- Add to gated set in `middleware.js`: `/shows/*/settlement`, `/api/shows/*/settlement`, `/api/shows/*/deal`.
- Routes re-check via `hasPinCookie()` (defends against curl bypass per the existing pattern in `docs/ARCHITECTURE.md §4`).

## Audit

- `upsertDeal` writes one `audit_events` row per call:
  - `entity_type = 'show_deal'`
  - `entity_id = <show_deals.id>`
  - `action = 'upsert'` (or `'correction'` if a prior row existed)
  - `actor_cook_id = cookId` (caller-asserted, per existing pattern)
  - `payload_json` = the new deal as DTO
- `postAuditEvent` runs **inside the same `db.transaction(...)`** as the UPSERT — no try/catch wrapping.
- Settlement *reads* don't write audit.

## Acceptance criteria

| Criterion | Test |
|---|---|
| `computeTalentPayout` correct on six boundary cases | `tests/js/test-deal-points.mjs` |
| `getSettlement` round-trip (in-memory DB → repo → JSON) <50ms p95 | `tests/js/test-settlement-repo.mjs` (1000-call median + p95 assertion) |
| PIN gate enforced at the route layer (middleware bypass via curl returns 401) | `tests/js/test-settlement-route.mjs` |
| `audit_events` row written on every deal upsert; rollback if either side fails | `tests/js/test-settlement-repo.mjs` (transactional rollback case) |
| Settlement page loads and matches a hand-computed receipt for a real show | Manual smoke test, captured as a notes block at bottom of the spec post-cutover |

## Risks

| Risk | Mitigation |
|---|---|
| `sales_lines.category` distinct values don't match BAR/FOOD set | Build script greps distinct categories before tests; spec sets are starting list |
| Multi-show-per-night undercounts | Documented limitation; flag in UI when `shows` count for the date > 1 |
| Float drift in legacy REAL columns | Convert to cents at read boundary; settlement aggregate stays INTEGER |
| Operator forgets to enter the deal before show day | Settlement page renders gracefully with `emptyDeal()` and a "no deal entered" banner |
| Cents overflow at 2³¹ in INTEGER (JS number safe range) | SQLite INTEGER is 8 bytes; JS `number` safe up to 2⁵³ — > $90 trillion. Non-issue. |

## Build sequence

1. Schema migration in `lib/db.ts` + idempotency test.
2. `lib/dealPoints.ts` + `tests/js/test-deal-points.mjs` (TDD; pure-fn first).
3. `lib/settlementRepo.ts` + `tests/js/test-settlement-repo.mjs`.
4. Routes (`/api/shows/[id]/settlement`, `/api/shows/[id]/deal`) + route tests.
5. `middleware.js` PIN-gate update.
6. Page + nav registry entry.
7. Manual smoke test on a real show, capture in spec notes.
8. PR.
