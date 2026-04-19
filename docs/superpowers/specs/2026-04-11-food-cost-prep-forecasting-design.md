# Food Cost & Prep Forecasting — Design Spec

**Date:** 2026-04-11
**Status:** Approved (Phase 1 in scope for next PR; Phase 2 gated on data accumulation)
**Parent context:** Group C of the Lariat Cockpit advanced features roadmap (C → A → D → B order)

## Goal

Turn the dormant sales + costing data in `data/lariat.db` into actionable kitchen intelligence:
1. **Live food cost %** per menu item, visible where managers already look (menu engineering + a dedicated dashboard).
2. **Daily sales ingest pipeline** (manual CSV now, Toast API later) so we can build a day-of-week prep forecast.
3. **Prep forecast + smart prep assistant** — deferred to Phase 2, gated on 4+ weeks of daily data accumulation.

## Non-goals

- Real-time webhooks or order-level streaming (Phase 3+, out of scope).
- Replacing Toast reporting — this augments, doesn't replace.
- Automated reorder logic — order guide already exists, not touching it here.
- Forecasting without data — we will not ship a forecast that only has monthly averages; it would be worse than useless.

---

## Phase split

**Phase 1 — ships this PR:**
| # | Component | Files |
|---|-----------|-------|
| 1 | Schema migration | `lib/db.js` (add `service_date`, `service_period` columns to `sales_lines`) |
| 2 | Manual daily Toast CSV ingest | `scripts/ingest-toast-daily.mjs`, `scripts/ingest_toast_daily.py` |
| 3 | Toast Partner API ingest stub | `scripts/ingest-toast-api.mjs` (gated on env vars, fails with instructions if missing) |
| 4 | Food cost library | `lib/foodCost.js` |
| 5 | Menu engineering page badges | `app/menu-engineering/page.jsx` |
| 6 | Food cost dashboard | `app/food-cost/page.jsx`, `app/food-cost/FoodCostDashboard.jsx`, `app/api/food-cost/route.js` |

**Phase 2 — ships ~4 weeks later once daily data exists:**
| # | Component | Files |
|---|-----------|-------|
| 7 | Prep forecast library | `lib/prepForecast.js` |
| 8 | Prep forecast UI | `app/prep-forecast/page.jsx`, `app/prep-forecast/PrepForecast.jsx`, `app/api/prep-forecast/route.js` |
| 9 | Kitchen assistant context extension | `lib/kitchenAssistantContext.js` — add conditional prep forecast injection |
| 10 | Day-of-week multiplier config | `lib/prepForecast.js` config constants (tunable) |

The Phase 1 PR ships Phase 2 scaffolding (`lib/prepForecast.js` exists but refuses to run with a clear "Need N more weeks of daily data" message). This means Phase 2 is purely a "flip the switch" moment once the data exists.

---

## Architecture

### Data flow

```
Toast (monthly CSV, existing)      ──┐
                                      ├─▶ sales_lines ───┐
Toast (daily CSV, new manual path)   ──┤                 │
                                      ├─▶                │
Toast Partner API (auto, Phase 1.5)  ──┘                 │
                                                          ▼
                                                    lib/foodCost.js
                                                          │
                                                          ├─▶ /menu-engineering (badges)
                                                          ├─▶ /food-cost (dashboard)
                                                          └─▶ [Phase 2] lib/prepForecast.js
                                                                              │
                                                                              ├─▶ /prep-forecast page
                                                                              └─▶ kitchen assistant context
```

### Schema migration

Current `sales_lines`:
```sql
CREATE TABLE sales_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_label TEXT,              -- e.g. "Toast - Item Sales (Mar 2026)"
  item_name TEXT NOT NULL,
  quantity_sold REAL,
  net_sales REAL,
  source TEXT,
  location_id TEXT DEFAULT 'default',
  imported_at TEXT DEFAULT (datetime('now'))
);
```

Add two nullable columns + index:
```sql
ALTER TABLE sales_lines ADD COLUMN service_date TEXT;      -- YYYY-MM-DD, null for monthly rows
ALTER TABLE sales_lines ADD COLUMN service_period TEXT;    -- 'day' | 'month', null for pre-migration rows
CREATE INDEX IF NOT EXISTS idx_sales_service_date ON sales_lines(service_date, location_id);
```

Run via `lib/db.js` `initSchema()` — idempotent, survives multiple runs.

Existing March 2026 row has `service_period=NULL` after migration. A follow-up one-liner backfills them to `service_period='month'` and leaves `service_date=NULL`. Food cost logic treats `service_period='month'` as whole-month data, `service_period='day'` as daily.

### Idempotency contract

Re-ingesting the same source data must not create duplicates. The ingest scripts use this rule:

```
DELETE FROM sales_lines
WHERE location_id = ?
  AND service_period = 'day'
  AND service_date = ?
  AND source = ?;
```

…before inserting, so rerunning `ingest:toast-daily` with the same CSV replaces that day's rows atomically.

---

## Component 1 — Schema migration (`lib/db.js`)

Extend `initSchema()` to run the two `ALTER TABLE` statements wrapped in `try/catch` for `SQLITE_ERROR: duplicate column` (SQLite has no `ADD COLUMN IF NOT EXISTS`). Add the index. Back-fill existing rows with `UPDATE sales_lines SET service_period='month' WHERE service_period IS NULL AND period_label LIKE '%Item Sales%'`.

---

## Component 2 — Manual daily Toast CSV ingest

### Trigger

```bash
npm run ingest:toast-daily
# or explicit path:
LARIAT_TOAST_DAILY_DIR=./XL/toast_daily npm run ingest:toast-daily
```

### Expected directory structure

```
XL/toast_daily/
  2026-04-01.csv
  2026-04-02.csv
  ...
```

### Expected CSV schema

Toast's "Sales Summary by Item" export. The ingest is lenient: it matches columns by header name (case-insensitive), accepts any of:

| Logical field | Accepted header names |
|---------------|----------------------|
| item name | `Item`, `Item Name`, `Menu Item`, `Name` |
| quantity | `Qty Sold`, `Quantity`, `Units`, `Qty` |
| net sales | `Net Sales`, `Net`, `Revenue`, `Net $` |

### Behavior

1. Walks `XL/toast_daily/*.csv`
2. For each file, parses `YYYY-MM-DD` from filename
3. Reads CSV, maps columns to logical fields
4. Deletes existing daily rows for that date + source (idempotent)
5. Inserts rows with `service_date=<date>`, `service_period='day'`, `source='toast_daily_csv'`, `period_label='Toast daily <date>'`
6. Reports counts: "Ingested N rows from 2026-04-01, 12 unique items"

Python helper (`scripts/ingest_toast_daily.py`) uses `pandas` if available, falls back to `csv` stdlib. Node wrapper invokes Python and inserts via better-sqlite3, matching the pattern of `ingest-costing.mjs`.

### Error handling

- Missing `XL/toast_daily/` → creates the directory and exits with a helpful "drop files here" message
- Unparseable filename → logs warning, skips file
- Missing required columns → logs warning with detected headers, skips file
- Non-numeric quantity/revenue → coerces to 0 with warning

---

## Component 3 — Toast Partner API ingest (stub)

### Trigger

```bash
npm run ingest:toast-api
# Requires env vars (fails cleanly if missing):
#   TOAST_API_CLIENT_ID
#   TOAST_API_CLIENT_SECRET
#   TOAST_API_RESTAURANT_GUID
#   TOAST_API_HOST (default: https://ws-api.toasttab.com)
```

### Behavior

1. Validates all four env vars are set. If any missing, prints a block explaining what each is and where to get it (Toast Support → Partner API), then exits with code 2.
2. OAuth2 client credentials: POST `/authentication/v1/authentication/login` with `clientId`, `clientSecret`, `userAccessType: TOAST_MACHINE_CLIENT` → receives bearer token.
3. Queries `/orders/v2/ordersBulk?startDate=...&endDate=...` for yesterday's orders.
4. Aggregates orders → items → daily totals per `externalId` (Toast item ID).
5. Same idempotent insert as the manual CSV path, with `source='toast_api'`.
6. Optional: accept `--date YYYY-MM-DD` or `--from/--to` range arguments for backfills.

### Scope note

This is a "shell out to the API" script, **not** a long-running daemon. Meant to be run by cron overnight:
```
0 3 * * * cd /Users/seanburdges/Dev/Lariat && npm run ingest:toast-api
```

### Documentation

`training/TOAST_API_SETUP.md` explains how to request credentials from Toast Support and what permissions the token needs.

---

## Component 4 — Food cost library (`lib/foodCost.js`)

### Core function

```js
/**
 * Compute food cost % per menu item by joining sales + recipes.
 * Returns one row per matched menu item:
 *   { menu_item, recipe_id, qty_sold, revenue, batch_cost_per_sold_unit, food_cost_pct, margin_pct, status }
 * status ∈ 'good' (<30%) | 'watch' (30-35%) | 'high' (>35%) | 'unknown' (no cost match)
 */
export function computeFoodCosts(locationId = 'default', opts = {}) { ... }

/**
 * Blended food cost % across all matched items, weighted by revenue.
 * Returns { blended_pct, total_revenue, total_cost, matched_items, unmatched_items }
 */
export function computeBlendedFoodCost(locationId = 'default', opts = {}) { ... }
```

### Join strategy

1. Sum `sales_lines` grouped by `item_name` for the period (default: all time, optional date range)
2. Normalize `item_name` via `menus/toast_recipe_map.csv` → `recipe_id`
3. Join to `recipe_costs` on `recipe_id` → get `cost_per_yield_unit`
4. Compute `qty_in_yield_units` from `quantity_sold` × `portions_per_sold_unit` (this mapping lives in `toast_recipe_map.csv` — extend that CSV with a `portions_per_sold_unit` column)
5. `cost = qty_in_yield_units × cost_per_yield_unit`
6. `food_cost_pct = cost / revenue × 100`
7. Menu items with no recipe match → `status='unknown'`, excluded from blended total

### Configuration

Thresholds live in the library as exported constants, easy to tune:

```js
export const FOOD_COST_THRESHOLDS = {
  good: 30,   // < 30% = green
  watch: 35,  // 30-35% = yellow
  // > 35% = red
};
```

---

## Component 5 — Menu engineering badges

In `app/menu-engineering/page.jsx`, after the quadrant computation, call `computeFoodCosts(loc)` and match by `recipe_id`. Render a `<span className="food-cost-badge">` next to each row showing:

```
Food cost: 28.4%   [green pill]
```

Colors via CSS variables matching the existing theme (green `var(--green)`, yellow `var(--yellow)`, red `var(--red)`). "Unknown" rows show a dimmed "—" instead.

No layout rewrite — just an inline addition. Adds ~30 lines of JSX + 10 lines of CSS.

---

## Component 6 — Food cost dashboard (`/food-cost`)

### Layout

```
┌─────────────────────────────────────────────────┐
│ FOOD COST                                       │
│ ┌─────────────────────┐  ┌─────────────────┐   │
│ │ Blended cost %      │  │ Matched / Total │   │
│ │        28.4%        │  │   42 / 58       │   │
│ │  target: < 30%      │  │  72% coverage   │   │
│ └─────────────────────┘  └─────────────────┘   │
│                                                  │
│ ▼ Highest cost % items                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ Fish & Chips       38.2%  $1606 rev  RED    │ │
│ │ Nashville Chicken  34.1%  $1489 rev  YELLOW │ │
│ │ ...                                          │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ ▶ Full table (sortable)                         │
│ ▶ Unmatched items (72%, click to map)           │
└─────────────────────────────────────────────────┘
```

### Components

- `app/food-cost/page.jsx` — server component wrapper
- `app/food-cost/FoodCostDashboard.jsx` — client component (sortable table with useState)
- `app/api/food-cost/route.js` — GET endpoint returning `{ blended, rows, unmatched }`

### Sidebar link

Added after `/menu-engineering` in the "v2 — Ops & money" section.

### Empty state

If no `recipe_costs` rows exist: "Run `npm run ingest:costing` to compute food cost". If no `sales_lines` rows: "Run `npm run ingest:analytics` (monthly) or `npm run ingest:toast-daily`".

---

## Phase 2 preview — Prep forecasting (design only)

### `lib/prepForecast.js` — API shape

```js
/**
 * Forecast prep requirements for a target date based on daily sales history.
 * Returns { recipe_id, recipe_name, forecast_qty, unit, days_analyzed, confidence }
 * Falls back to static multipliers if no daily data exists.
 */
export function forecastPrep(locationId, targetDate, opts = {}) { ... }

/**
 * Check whether we have enough daily data to run a real forecast.
 * Returns { ready: bool, days: int, weeks: int, oldestDate, newestDate }
 */
export function forecastReadiness(locationId) { ... }
```

### Forecasting algorithm (Phase 2)

1. `forecastReadiness` checks for ≥28 rows of `service_period='day'` spanning ≥4 distinct weeks
2. If not ready → return empty + `ready: false` + message
3. If ready → compute per-recipe daily sales for each of the last 4 same-weekdays-as-target
4. Average those 4 values per recipe → `forecast_qty_in_menu_items`
5. Multiply by BOM → ingredient-level rollup grouped by station
6. Optionally subtract on-hand from `inventory_updates` (same `shift_date`, direction='in')
7. Return forecast with confidence score (higher if weekday variance is low)

### Static day-of-week multipliers (Phase 2 fallback)

Config in `lib/prepForecast.js`:
```js
export const DEFAULT_DOW_MULTIPLIERS = {
  0: 1.1,   // Sun
  1: 0.7,   // Mon
  2: 0.8,   // Tue
  3: 0.9,   // Wed
  4: 1.0,   // Thu
  5: 1.4,   // Fri
  6: 1.5,   // Sat
};
```

### `/prep-forecast` page (Phase 2)

Table: station × recipe × forecast qty × on-hand × prep needed.
Empty state: "Prep forecasting needs 4 weeks of daily sales data. Currently: N days across M weeks. Run `npm run ingest:toast-daily` each morning to accumulate data."

### Kitchen assistant context extension (Phase 2)

In `lib/kitchenAssistantContext.js`, add:
```js
const isPrepForecastQ = /prep|forecast|how much|how many|tomorrow|saturday|sunday|monday/i.test(userQuestion);
if (isPrepForecastQ) {
  const readiness = forecastReadiness(locationId);
  if (readiness.ready) {
    const forecast = forecastPrep(locationId, nextBusinessDate(userQuestion));
    text += '\nPREP FORECAST (grounded in last 4 same-weekdays):\n' + formatForecast(forecast);
  } else {
    text += `\nPREP FORECAST: not available (need 4 weeks of daily data, have ${readiness.days} days)\n`;
  }
}
```

---

## Testing approach

### Phase 1

- `tests/test-food-cost.mjs` (node:test)
  - Computes blended cost % against a seeded in-memory DB
  - Verifies threshold classification (good/watch/high/unknown)
  - Verifies unmatched items are excluded from blended total
- `tests/test-ingest-toast-daily.mjs`
  - Writes a fixture CSV to a temp dir
  - Runs the ingest
  - Verifies rows, idempotency (rerun replaces, doesn't duplicate)
- Build check: `npm run build` must pass
- Manual smoke: dashboard loads, badges render on menu engineering

### Phase 2 (not in this PR)

- Forecast readiness returns `ready: false` with fewer than 4 weeks
- Forecast math matches hand-computed expected values on seeded data

---

## Error handling & edge cases

| Case | Behavior |
|------|----------|
| `toast_recipe_map.csv` missing `portions_per_sold_unit` | Default to 1.0, log warning on first load |
| Item in sales but no recipe match | `status='unknown'`, shown separately in "Unmatched" dashboard section |
| Recipe with zero yield | Excluded with log warning (avoids divide-by-zero) |
| Daily CSV with only some items | Works — food cost for missing items falls through to monthly data |
| Monthly + daily data both present for same item | Monthly takes precedence when no daily rows exist for the item's date range; daily wins when both exist and period is scoped to daily |
| Toast API 401 | Clear error: "Check TOAST_API_CLIENT_ID / SECRET env vars" |
| Toast API rate limit | Retry with exponential backoff (5s, 15s, 45s); fail after 3 attempts |

---

## Open questions (deferred)

1. **Location-aware thresholds** — should `FOOD_COST_THRESHOLDS` be per-location? Assumption: no for now, one target for all. Revisit when multi-location data is real.
2. **Blended cost time range** — default to "all available data". Should it be configurable (last 30 days, this month, last quarter)? Assumption: not in Phase 1, add if managers ask.
3. **Unmatched items workflow** — should `/food-cost` have an inline editor to map unmatched Toast items to recipes? Assumption: no, edit `menus/toast_recipe_map.csv` directly for now.
4. **Historical trend chart** — food cost % over time (weekly). Assumption: defer to Phase 2.5 if managers find it useful.

---

## Success criteria

**Phase 1 ships when:**
- [ ] `npm run ingest:toast-daily` works with a sample CSV
- [ ] `npm run ingest:toast-api` fails cleanly without credentials (with setup instructions)
- [ ] Food cost badges render on `/menu-engineering` with correct colors
- [ ] `/food-cost` dashboard loads with blended %, top offenders, sortable table
- [ ] Tests pass (`node --test tests/test-food-cost.mjs tests/test-ingest-toast-daily.mjs`)
- [ ] `npm run build` passes
- [ ] Existing monthly March 2026 data still flows through the new code paths

**Phase 2 ships when:**
- [ ] 4+ weeks of daily data has accumulated in production
- [ ] `/prep-forecast` page shows non-empty forecast
- [ ] Kitchen assistant answers "how much queso should I prep for Saturday" with a real number grounded in daily history
