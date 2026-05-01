# Master costing tile — design

**Phase 2 task:** E. **Scope:** E1 (per-recipe ABC ranking) + E2 (menu-engineering quadrant copy polish) + E3 (28-day variance trend tile on `/costing`).

**Plan source:** `docs/PHASE2_PLAN.md` §E.

## Goal

A manager landing on `/costing` sees, at a glance, (a) which recipes carry the business (ABC contribution), (b) where the menu sits in the Stars/Plowhorses/Puzzles/Dogs quadrant with plain-language explainers, and (c) how the theoretical-vs-actual COGS variance has trended over the last 28 days. All three derive from existing tables — no new schema.

## Out of scope

- New schema. `accounting_variance`, `sales_lines`, `dish_components`, `bom_lines`, and the `MenuEngineeringRow` shape from `lib/menuEngineering.ts` are sufficient.
- Recipe-level drill-down inside the variance trend (named in PHASE2_PLAN E3 — deferred). The tile shows the chart and per-period numbers; click-through to a per-recipe drill page is its own slice.
- Reworking the existing quadrant table layout. E2 is a **copy-only** change.
- ABC ranking inside `/menu-engineering` (the cross-promo wiring is its own slice once E1 settles).

## Components

```
lib/abcRanking.ts                  — pure-fn: rows → A/B/C tiers + cumulative %
lib/varianceTrend.ts               — read-only: last N days of accounting_variance
                                     grouped by week; sparkline-friendly shape
app/costing/_components/AbcTile.jsx        — tile rendering ABC summary table
app/costing/_components/VarianceTrend.jsx  — tile rendering trend (inline SVG)
app/costing/page.jsx               — modify: add the two tiles below B1/B2/B3
app/menu-engineering/page.tsx      — modify: per-quadrant explainer copy
tests/js/test-abc-ranking.mjs      — pure-fn boundary tests
tests/js/test-variance-trend.mjs   — in-memory SQLite, edge cases
```

### `lib/abcRanking.ts` — pure module

```ts
export interface AbcInputRow {
  itemName: string;
  qty: number;                    // units sold in window
  costPerUnit: number | null;     // NULL = unlinked, excluded from rank
  marginPct: number | null;       // NULL = unlinked, excluded
  netSales: number;
}

export type AbcTier = 'A' | 'B' | 'C' | 'unranked';

export interface AbcRankedRow extends AbcInputRow {
  contributionDollars: number;    // (avg_price - cost) × qty, or 0 if unlinked
  menuMixPct: number;             // qty / totalQty
  scoreCents: number;             // round(contributionDollars * menuMixPct * 100)
  cumulativePct: number;          // 0–100, running cumulative share of total score
  tier: AbcTier;
}

export function rankByContribution(
  rows: AbcInputRow[],
  thresholds?: { aPct?: number; bPct?: number },  // default 0.80 / 0.95
): AbcRankedRow[];
```

Rules:
1. Linked rows (`costPerUnit != null && marginPct != null`) get a real `scoreCents`. Unlinked rows pass through with `tier: 'unranked'` and `scoreCents: 0`.
2. Sort linked rows by `scoreCents` descending. Compute cumulative share of total score.
3. Rows whose cumulative share crosses `aPct` (default 80%) get `tier: 'A'`; up to `bPct` (default 95%) get `tier: 'B'`; the rest get `tier: 'C'`.
4. Cumulative is monotonic, so the boundary row at exactly the threshold goes into the lower tier (e.g. cumulative 80.0% lands in `'A'`).

This is the canonical Pareto-curve ABC, expressed deterministically. No randomness, no rolling windows — the ranking is over whatever time window the caller provides via the row set.

### `lib/varianceTrend.ts`

```ts
export interface VarianceTrendPoint {
  periodStart: string;            // ISO date
  periodEnd: string;
  variancePct: number | null;     // null when actual_cogs is missing
  varianceAmount: number | null;
  thresholdColor: 'green' | 'yellow' | 'red';   // 0–2 / 2–5 / ≥ 5 (matches T9)
}

export interface VarianceTrend {
  points: VarianceTrendPoint[];   // up to N points, oldest first
  pCurrent: number | null;        // most recent variancePct
  pAverage: number | null;        // average over window, null-safe
  windowDays: number;             // configured window (28 default)
  rowsFound: number;              // 0 = no data ingested yet
}

export function getVarianceTrend(
  locationId: string,
  windowDays?: number,            // default 28
): VarianceTrend;
```

Reads the last `windowDays` days of `accounting_variance` (filtered by `location_id`, ordered by `period_end ASC`). Color buckets reuse the costing dashboard's existing thresholds (`< 2`, `2–5`, `≥ 5`) to stay consistent with the B1 tile.

### Tiles — visual shape

`AbcTile` (read-only):

```
┌─ ABC contribution ─────────────────────────────────┐
│ A · 9 dishes · 80% of margin                       │
│ B · 14 dishes · 15% of margin                      │
│ C · 47 dishes · 5% of margin                       │
│ unranked · 12 dishes · no costing                  │
│                                                    │
│ Top 5 in tier A:                                   │
│ 1. Bacon Burger      · $4.21 / unit · 480 sold     │
│ 2. Mac Balls         · $3.85 / unit · 612 sold     │
│ ...                                                │
└────────────────────────────────────────────────────┘
```

`VarianceTrend` (read-only sparkline):

```
┌─ COGS variance · last 28 days ─────────────────────┐
│ current 3.2%    avg 2.8%    last green run 5d ago  │
│                                                    │
│ ▂▂▃▅▇▆▄▃▂  ← inline SVG sparkline (28 cells)       │
│                                                    │
│ Green ≤ 2% · Yellow 2–5% · Red ≥ 5%                │
│ Source: accounting_variance (compute engine)       │
└────────────────────────────────────────────────────┘
```

Both tiles render gracefully when `rowsFound === 0` (no data yet) — surface a "no runs ingested for this window" amber notice rather than rendering empty bars.

### Quadrant copy polish (E2)

Edit `app/menu-engineering/page.tsx:11-16`. Add a per-quadrant **action** sentence to the existing description. Examples:

| Quadrant | Today | Add |
|---|---|---|
| Star | High margin & popularity | Don't change a thing — protect availability and supply. |
| Plowhorse | Low margin, high popularity | Reprice or sub a cheaper component before margin drift sinks the night. |
| Puzzle | High margin, low popularity | Push it on specials boards — the room doesn't know it exists. |
| Dog | Low margin & popularity | Cut from the menu unless it's anchoring a category. |

UI copy follows `docs/UI_COPY_RULES.md` — kitchen verbs, no SaaS jargon.

## Acceptance criteria

| Criterion | Test |
|---|---|
| `rankByContribution` correctness on six boundary cases | `tests/js/test-abc-ranking.mjs` |
| `getVarianceTrend` returns last 28 days when ≤ 28 are present, the most-recent 28 when > 28 | `tests/js/test-variance-trend.mjs` |
| `getVarianceTrend` returns `rowsFound: 0` and `points: []` when the table is empty | same |
| Costing page renders both tiles with no errors against an empty DB | manual smoke test, captured at the bottom of the spec post-merge |
| Quadrant copy on `/menu-engineering` reads at the 5th–8th-grade level (per UI_COPY_RULES) | manual review |

## Build sequence

1. `lib/abcRanking.ts` + boundary tests (TDD; pure-fn first).
2. `lib/varianceTrend.ts` + tests.
3. `AbcTile.jsx` + `VarianceTrend.jsx` (server-rendered, no client JS).
4. Wire both into `/costing` page.
5. Quadrant copy edit on `/menu-engineering/page.tsx`.
6. Full-suite verification gates.
7. PR.

## Risks

| Risk | Mitigation |
|---|---|
| ABC ranking on tiny menus (≤3 dishes) yields trivial tiers | Explicit empty/short-input test; tier `'A'` allowed to swallow everything if total dishes < 4. |
| `accounting_variance` empty in dev DBs without compute runs | Tile renders the empty-state amber notice; smoke test covers this path. |
| SVG sparkline rendering quirks across browsers | Use plain `<rect>` per data point with `viewBox` in user units — no `<path>` math. |
| 28-day window vs irregular ingest cadence | `rowsFound` is the lever — show it next to the average so a manager sees `5 runs in 28 days` and knows to chase the cron. |
