# Runbook — pull 28 days of daily per-item sales from Toast (for #267)

**Goal:** fill `sales_lines` with ≥28 distinct days of `service_period='day'` rows
so the Phase 2 prep-forecast readiness gate (GH #267, gate 3) flips to GO.

**How:** ask Toast's built-in AI assistant to export the last 28 days of
per-item sales as one CSV per day, then run the local ingest. The ingest
(`scripts/ingest-toast-daily.mjs`, `npm run ingest:toast-daily`) expects:

- **Filenames:** `XL/toast_daily/<YYYY-MM-DD>.csv` — one file per service day.
- **Columns (header row, case-insensitive):** an item column (`Item` / `Item Name`
  / `Menu Item` / `Name`), a quantity column (`Qty Sold` / `Quantity` / `Units`
  / `Qty`), and a net-sales column (`Net Sales` / `Net` / `Revenue` / `Net $`).
- Blank/non-numeric quantity or net coerces to `0`; unknown extra columns are ignored.

---

## Copy-paste prompt for the Toast AI assistant

> I need to export **per-item sales, broken down by individual day, for the last
> 28 calendar days** (through yesterday). Please produce the data as **one file
> per day**, where each file is a CSV named exactly `YYYY-MM-DD.csv` (the service
> date), containing one row per menu item sold that day.
>
> Each CSV must have this header row, exactly these three columns in this order:
>
> ```
> Item,Qty Sold,Net Sales
> ```
>
> - **Item** — the menu item name.
> - **Qty Sold** — total units of that item sold that day (number only).
> - **Net Sales** — net sales dollars for that item that day (number only, no `$`).
>
> One row per item; do not include category subtotals, day totals, tax, tips, or
> a grand-total row. If an item had no sales on a given day, omit it (don't emit a
> zero row). Give me all 28 files. If you can only deliver a single combined file,
> include a leading `Date` column (`YYYY-MM-DD`) so I can split by day.

---

## After you have the files

1. Drop the CSVs into `XL/toast_daily/` (the ingest creates this folder on first
   run if it's missing). Confirm names are `2026-05-01.csv`, `2026-05-02.csv`, ….
2. Run the ingest (idempotent — safe to re-run; it replaces a day's rows):

   ```bash
   npm run ingest:toast-daily
   ```

3. Re-check the #267 readiness gate:

   ```bash
   sqlite3 data/lariat.db "SELECT COUNT(DISTINCT service_date) FROM sales_lines WHERE service_period='day'"
   ```

   Gate 3 is GO once that count is **≥ 28** (with ≥4 distinct weeks of coverage).

> **Note:** if the assistant returns a single combined file with a `Date` column,
> split it into per-day `YYYY-MM-DD.csv` files before running the ingest — the
> current ingest keys the service date off the **filename**, not a Date column.
> (Combined-file support is a possible future enhancement.)
