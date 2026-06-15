# Toast Sales Timeseries Importer Plan

> **STATUS: SHIPPED (verified 2026-06-15 reconciliation) — Toast three-table importer (daily/dow/hour): CSV parser, Node ingest wrapper, kitchen-assistant integration; 53/53 tests pass.**

Date: 2026-04-18
Source files: `data/originals/Toast/sales-by-{date,day,time}-apr6-2020-apr17,2026.csv`

## Goal

Ingest Toast's three aggregate sales exports — daily timeseries, day-of-week, hour-of-day — into SQLite so the kitchen assistant and future dashboards can answer trend/staffing/forecast questions ("what does Friday typically look like?", "are we behind YoY?"). These exports are a different granularity from the existing per-item `sales_lines` and need their own tables.

## Input shape

Each CSV has columns: `Period, Net Sales, Orders, Guests, Group, Date Range, <trailing empty>`.

- `Group=1` is the current-period export (Apr 6 2020 → Apr 17 2026).
- `Group=2` is Toast's YoY comparison (Apr 6 2019 → Apr 17 2025).
- `Date Range` uses `|` as the inline separator (`Apr 6| 2020 - Apr 17| 2026`) — not a comma, so a naive CSV split is fine; strip trailing empty fields.
- Period formats: `MM/DD/YYYY` for date; `Sun`..`Sat` for day; `H:MM AM/PM` for time.

Row counts: 4408 date, 14 day, 42 time.

## Out of scope

- `SalesSummary_2020-04-06_2026-04-12.xlsx/.zip` in `RevanueandLabor/`. Different shape, separate future task.
- Per-item sales (already handled by `ingest_analytics.py` → `sales_lines`).
- Dashboards / UI surfaces. This plan lands data only.

## Schema additions

### `[MODIFY] lib/db.ts` — add three tables in `initSchema`

```sql
CREATE TABLE IF NOT EXISTS toast_sales_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_date TEXT NOT NULL,         -- ISO YYYY-MM-DD
  net_sales REAL,
  orders INTEGER,
  guests INTEGER,
  comparison_group INTEGER NOT NULL, -- 1 = current, 2 = YoY prior
  date_range TEXT,                   -- raw 'Apr 6 2020 - Apr 17 2026'
  source TEXT,                       -- 'toast_csv'
  location_id TEXT DEFAULT 'default',
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(shift_date, comparison_group, location_id)
);
CREATE INDEX IF NOT EXISTS idx_toast_daily_loc_date ON toast_sales_daily(location_id, shift_date);

CREATE TABLE IF NOT EXISTS toast_sales_dow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week TEXT NOT NULL,         -- 'Sun'..'Sat'
  net_sales REAL,
  orders INTEGER,
  guests INTEGER,
  comparison_group INTEGER NOT NULL,
  date_range TEXT,
  source TEXT,
  location_id TEXT DEFAULT 'default',
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(day_of_week, comparison_group, location_id)
);

CREATE TABLE IF NOT EXISTS toast_sales_hour (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hour_24 INTEGER NOT NULL,          -- 0..23, parsed from '3:00 PM'
  label TEXT NOT NULL,               -- original '3:00 PM' preserved for display
  net_sales REAL,
  orders INTEGER,
  guests INTEGER,
  comparison_group INTEGER NOT NULL,
  date_range TEXT,
  source TEXT,
  location_id TEXT DEFAULT 'default',
  imported_at TEXT DEFAULT (datetime('now')),
  UNIQUE(hour_24, comparison_group, location_id)
);
```

Mirror row-type interfaces at the top of `lib/db.ts` alongside existing `SalesLineRow`.

## Parser

### `[NEW] scripts/lib/toast_csv.mjs`

Pure JS; no Python. Exports:

```ts
parseToastDateCsv(text: string): Array<{ shift_date: string; net_sales: number; orders: number; guests: number; comparison_group: 1|2; date_range: string }>
parseToastDayCsv(text: string):  Array<{ day_of_week: DOW; net_sales: number; orders: number; guests: number; comparison_group: 1|2; date_range: string }>
parseToastTimeCsv(text: string): Array<{ hour_24: number; label: string; net_sales: number; orders: number; guests: number; comparison_group: 1|2; date_range: string }>
```

Requirements:
- Header row is required; error with the header line on mismatch.
- Tolerate the trailing empty column; split on commas but clamp to the expected column count.
- `MM/DD/YYYY` → ISO `YYYY-MM-DD`; never apply timezone math.
- Hour parser covers `12:00 AM` → 0, `12:00 PM` → 12, `1:00 PM` → 13, etc.
- Every value is a finite number or the row is rejected with a logged reason (don't silently coerce NaN to 0).
- Day values must be in `{Sun,Mon,Tue,Wed,Thu,Fri,Sat}`; reject otherwise.
- `comparison_group` must be `1` or `2`; reject otherwise.
- Return the cleaned rows plus a `rejects` array describing skipped lines — the caller decides whether to fail hard.

### `[NEW] tests/js/test-toast-csv.mjs`

Node `--test` suite covering:
- Happy path for each of the three files (fixture-based; use small inline fixtures, not the real CSVs).
- Header mismatch produces a useful error.
- Trailing empty field is handled.
- Group 2 rows are preserved, not dropped.
- `12:00 AM` → 0 and `12:00 PM` → 12 boundary cases.
- Invalid row (bad date, non-numeric net_sales, group=3) goes to `rejects` without aborting.

## Ingest script

### `[NEW] scripts/ingest-toast-timeseries.mjs`

```
Usage: node scripts/ingest-toast-timeseries.mjs [--dir path] [--location default] [--strict]
```

Behavior:
- Discovers the three CSVs by glob pattern (`sales-by-date-*.csv`, etc.) in `--dir` (default `data/originals/Toast/`). Uses the newest file per category if multiple exist, logs which file was picked.
- Per table: `DELETE FROM <t> WHERE location_id = ?` then bulk insert inside a single transaction. Full-replace (not append) to match the sibling `ingest-analytics.mjs` pattern and to keep re-runs idempotent.
- Prints a summary: `✓ Toast timeseries: 4408 daily / 14 dow / 42 hour rows (group 1+2) → SQLite (default)`.
- Exit non-zero on any parser failure when `--strict`, otherwise warn and continue with accepted rows.

### `[MODIFY] package.json`

- Add `"ingest:toast": "node scripts/ingest-toast-timeseries.mjs"`.
- Extend `"ingest:all"` to chain the new script after `ingest:analytics`.

## Assistant context hook (small, not a dashboard)

### `[MODIFY] lib/kitchenAssistantContext.ts`

Add a new always-on helper `renderDailySalesTrend(db, locationId, date)` that surfaces the last 7 days of `toast_sales_daily` (group 1) and, when available, the matching YoY (group 2) rows — one compact block. Keep it behind a cap and empty-when-no-data, consistent with the existing oversight helpers. No keyword gating; this is the kind of trend data a manager always benefits from seeing.

This is the only place the importer touches live product code. Do not add new UI.

## Success criteria

1. `npx tsc --noEmit` passes.
2. `npm run ingest:toast` against the current CSVs produces the expected row counts per file in the summary.
3. `node --test tests/js/test-toast-csv.mjs` passes.
4. Running the importer twice back-to-back leaves the row counts identical (idempotent).
5. Asking the assistant "how did this week compare to last year?" surfaces numbers drawn from `toast_sales_daily`, not an apology about missing data.

## Risks

- Toast occasionally changes export headers. The parser's hard header check is deliberate — better a loud failure than silent schema drift.
- `comparison_group` naming is chosen to stay export-agnostic; if a future Toast export adds a 3rd group, relax the validator to accept any positive integer and keep going.
- `toast_sales_daily.shift_date` collides semantically with the `shift_date` used in HACCP / line-check tables. It's the same calendar-day concept; sharing the column name is intentional so future joins read naturally.
