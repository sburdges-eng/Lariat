# Lariat System Architecture

**Current Version**: 2026-04-24
**Core Stack**: Next.js 14, React 18, better-sqlite3, Node.js LTS, Python 3 (openpyxl, xlrd, pdfplumber), optional Ollama.
**Data Philosophy**: Local-first, deterministic, Excel-to-JSON/SQLite ETL. Append-only audit trail on regulated surfaces. No hidden runtime AI coupling.

See also: [`PATTERNS.md`](PATTERNS.md) for canonical module patterns (HACCP rule modules, ingest delegation, audit split, location scoping).

---

## 1. Data Flow & Source of Truth

The Lariat project operates on a "Workbook-as-Source" model with a local JSON + SQLite runtime.

1.  **Master Workbooks** (operator-staged under `XL/`, gitignored):
    - `XL/Lariat_Unified_Workbook.xlsx` — line checks, setups, Recipe Book, staff, Toast item sales
    - `XL/Lariat_Master_Costing_*.xlsx` — vendor prices, recipe costs, BOM, ingredient maps
    - `XL/lariat_operations_workbook_*.xlsx` — order guide
    - `XL/Lariat_Analytics_Workbook.xlsx` — Shamrock spend (optional)
    - `XL/Lariat Recipe Book.pdf` — optional PDF recipe layer
    Additional ingest sources (also under `data/imports/` or `data/originals/`): Shamrock `.xls` invoices, Sysco invoice PDFs, Toast CSV exports, 7shifts CSV exports, WebstaurantStore spend reports, Drive kitchen-ops exports.
2.  **ETL Layer**:
    - Node wrappers (`scripts/ingest.mjs`, `scripts/ingest-costing.mjs`, `scripts/ingest-analytics.mjs`) shell out to Python (`scripts/ingest_unified.py`, `ingest_costing.py`, `ingest_analytics.py`) via `execSync` and consume JSON on stdout. Python handles Excel/PDF parse; Node owns SQLite writes and post-pass math (T3 yield delta, T4 unit convert, T5b catch-weight backfill, T6 pack-size detect, T7 ingredient-master rebuild, T8 shrinkage).
    - `scripts/ingest-toast-timeseries.mjs` parses Toast CSVs entirely in Node (CSV doesn't need Python).
    - Standalone Python: `ingest_shamrock_invoices.py`, `ingest_sysco_invoice_pdfs.py`, `ingest_toast_menu_catalog.py`, `ingest_toast_sales_summary.py`, `ingest_webstaurant_purchases.py`, `ingest_drive_kitchen_ops.py`, `ingest_catering_menu.py`.
    - Seeds (CSV → SQLite via `scripts/lib/seed_upsert.py`): `seed_ingredient_densities.py`, `seed_ingredient_yields.py`, `seed_ingredient_unit_weights.py`, `ingest_catch_weights.py` (per-vendor).
    - `scripts/rebuild-cache.mjs` merges CSV + JSON sources into `data/cache/*.json`.
3.  **Runtime Read Model**:
    - **JSON cache** (`data/cache/*.json`, 14 files) — templates: recipes, stations, staff, line_checks, setups, menu, allergen_matrix, food_safety, vendor_summary, labor_summary, closings, weekly_prep, order_guide, catering_menu. Read by `lib/data.ts` (mtime-aware in-memory cache).
    - **SQLite** (`data/lariat.db`) — 40+ tables grouped by family:
        - **Line ops:** `line_check_entries`, `station_signoffs`, `eighty_six`, `inventory_updates`, `specials`, `gold_stars`, `preshift_notes`, `service_hours`, `locations`
        - **HACCP (F1–F17):** `cooling_log`, `date_marks`, `receiving_log`, `sanitizer_checks`, `sick_worker_reports`, `shift_pic`, `cleaning_schedule`, `cleaning_log`, `pest_control_log`, `thermometer_calibrations`, `tphc_entries`, `sds_registry`, `temp_log`, `employee_health_acknowledgments`
        - **Labor (L1–L7):** `shift_breaks`, `paid_sick_leave_balances`, `staff_certifications`, `tip_pool_distributions`, `staff_flags`, `wage_notices`
        - **Audit (A1):** `audit_events` (append-only, within-transaction writes from every regulated route)
        - **Costing (T1–T9):** `vendor_prices`, `vendor_prices_history` (append-only trend snapshot; see note below), `recipe_costs`, `bom_lines`, `ingredient_maps`, `ingredient_masters`, `ingredient_densities`, `ingredient_yields`, `ingredient_unit_weights`, `vendor_catch_weights`, `pack_size_changes`, `ingest_runs`, `order_guide_items`
        - **Commerce:** `sales_lines`, `spend_monthly`, `dish_components`, `toast_sales_daily`, `toast_sales_dow`, `toast_sales_hour`, `toast_sales_summaries`, `toast_menu_items`, `toast_menu_options`, `shamrock_invoices`, `sysco_invoices`
        - **Events:** `beo_events`, `beo_line_items`, `beo_prep_tasks`
        - **Equipment:** `equipment`, `equipment_parts`, `equipment_maintenance`, `equipment_maintenance_schedule`
    - Full schema defined in `lib/db.ts`: `initSchema()` + `initFoodSafetyLaborSchema()` + `migrateLegacyColumns()` + `assertCriticalSchemas()`.
4.  **Live Writes**: iPad/browser → API route → rule module validation → `getDb().transaction(() => { insert(); postAuditEvent(); })`. HACCP/labor/regulated routes wrap both writes in one transaction so audit rows can never strand from their source row.
5.  **File-based audit** (`data/audit/management-actions.jsonl`, written by `lib/auditLog.mjs`) — separate from DB audit; tracks management actions (recipe edits, cost updates). Read-only API at `/api/audit/log`; UI at `/management/audit-log`.
6.  **Export**: `scripts/export.mjs` → `exports/[YYYY-MM-DD]/Lariat_Daily_Export.xlsx` + optional `HACCP_CO_Compliance.xlsx`. Backup: `scripts/backup.mjs` → `backups/lariat_[stamp].db{,-wal,-shm}`.

---

## 2. Core Modules (lib/)

31 files split between pure rule modules, data/infra, and bridges. Full catalog in [`PATTERNS.md`](PATTERNS.md); highlights:

**Infra (core runtime, consumed everywhere):**
- `lib/db.ts` — better-sqlite3 singleton (WAL mode), 40+ table DDL, `initSchema()`, `initFoodSafetyLaborSchema()`, `migrateLegacyColumns()`, `assertCriticalSchemas()`, `todayISO()`, type interfaces for every row.
- `lib/data.ts` — JSON cache reader; mtime-aware in-memory cache; `getRecipes()`, `getStations()`, `getStaff()`, `getMenu()`, `getFoodSafety()`, `getAllergenMatrix()`, `getVendorSummary()`, `getLaborSummary()`, etc.
- `lib/location.ts` — `DEFAULT_LOCATION_ID`, `locationFromRequest()`, `locationFromBody()`. Every row that can vary per site carries `location_id`.
- `lib/pin.ts` — PIN cookie helpers; `hasPinCookie()`, `pinConfigured()`, `pinRequiredForPic()`. HMAC-signed cookie (see §4).
- `lib/auditEvents.ts` — DB audit (`audit_events` table); `postAuditEvent()` must run inside the same transaction as the source insert.
- `lib/auditLog.mjs` — file JSONL audit; management-action log.

**HACCP rule modules** (pure functions, 1:1 with a route + board + table + test file):
`tempLog.ts` (13 CCP points), `cooling.ts` (2-stage §3-501.14), `receiving.ts` (7 categories §3-202.11/.15), `sanitizer.ts` (chlorine/quat/iodine), `dateMarks.ts` (7-day §3-501.17), `sickWorker.ts` (Big-6 §2-201.11), `calibrations.ts` (§4-502.11 ice/boiling, altitude-aware), `cleaning.ts`, `pestControl.ts`, `sds.ts`, `inventoryShrinkage.ts` (T8 cooking shrinkage).

**Labor rule modules:**
`breaks.ts` (CO COMPS #39 meal/rest), `paidSickLeave.ts` (HFWA accrual, 1h/30h worked, 48h cap).

**Costing / mapping engine:**
`costingBenchmarks.mjs` (T9 variance, T7 merged cost, B1/B2), `unitConvert.mjs` (byte-parity with `scripts/lib/units.py`), `ingredientKey.ts` (byte-parity with `scripts/lib/ingredient_key.py`), `dishCostBridge.ts` (dish→recipe→ingredient→vendor link_state), `menuEngineering.ts` (star/puzzle/plowhorse/dog quadrant), `bomVendorProposals.ts`, `bomPlanActionItems.mjs`, `subRecipeGraph.ts` (cascaded 86), `recipeCalculator.ts` (spawns `scripts/bom_expand_cli.py`), `dishComponents.ts`, `dishComponentsRepo.ts` (shared upsert used by the API route + CLI importer, PR #26), `vendorPricesRepo.ts` (surgical upsert for out-of-band drink prices; keyed on `(location_id, vendor, sku, ingredient)`, PR #27), `dishCoverageReport.ts` (fill-me CSV composer, PR #28).

**Price-trend invariant:** `vendor_prices` is rebuilt per costing-ingest run (DELETE+INSERT), so the live table never carries history. `scripts/ingest-costing.mjs` snapshots every current row for the target location into `vendor_prices_history` *before* the DELETE — append-only, keyed on `run_id` + `snapshot_at` — so per-SKU price series survive the sweep. The DELETE also preserves rows whose `LOWER(category)` is in `BEVERAGE_CATEGORIES` (beer / wine / liquor / spirit / cocktail); those rows are populated by `scripts/import-vendor-prices.mjs` and have no workbook feed.

**Kitchen Assistant (LLM):**
`kitchenAssistantContext.ts` (grounded-context builder; reads 86s / inventory / sign-offs / line checks / BEOs from DB, caps at 12k chars), `ollama.ts` (HTTP client; GROUNDED_SYSTEM vs CREATIVE_SYSTEM prompts with ALLERGEN/HACCP boundaries).

---

## 3. Key Operations Logic

### **Line Checks & Sign-offs**
`Station Template (JSON) → Cook fills on iPad → Rows in SQLite → Today page aggregates`
*   Templates in `data/cache/line_checks.json`, canonical source: `scripts/stations-seed.json`.

### **86 Board**
`Cook 86s item → SQLite row → Banner on Today page → KM resolves`
*   Inline 86 from any line-check row or from the dedicated board.

### **Recipe Costing**
`Master Costing Workbook → ingest_costing.py → SQLite (vendor_prices, recipe_costs, bom_lines)`
*   Menu engineering joins `sales_lines` (Toast) with `recipe_costs` for margin analysis.

### **BEO & Event Execution**
`BEO Items → Recipe Map → Kitchen Stations → Order Pull`
*   **`menus/beo_recipe_map.csv`**: Bridges finished BEO dishes to component recipes.
*   **`menus/menu_station_map.csv`**: Routes items to specific stations.
*   **`scripts/beo_order_pull.py`**: Calculates shopping list for upcoming events.

---

## 4. Access Control

**PIN-based gate** for sensitive pages and the management surface. Enforced by `middleware.js` on the listed prefixes, and re-checked at each gated API route via `lib/pin.ts::hasPinCookie()` so curl / replay cannot bypass the middleware.

**Current matcher** (`middleware.js:41–55`):

| Access Level | Page prefixes | API prefixes | Auth Required |
| :--- | :--- | :--- | :--- |
| **All staff** | Today, Stations, Recipes, 86 Board, Inventory, Food safety, Labor, Kitchen Assistant, Equipment, Specials, Gold Stars, Admin (cleaning-schedule, service-hours) | `/api/{auth, checks, signoff, inventory, eighty-six, recipes, stations, staff, locations, preshift-notes, specials, gold-stars, cooling, temp-log, receiving, sanitizer-check, date-marks, sick-worker, thermometer-calibrations, cleaning, cleaning-schedule, service-hours, breaks, certifications, pest, sds, equipment/*, dish-components, dish-coverage, kitchen-assistant, unmapped}` | None |
| **KM / Manager** | `/analytics`, `/costing`, `/purchasing`, `/menu-engineering`, `/beo`, `/management` | `/api/costing`, `/api/analytics`, `/api/menu-engineering`, `/api/beo`, `/api/audit` | `LARIAT_PIN` env + HMAC-signed `lariat_pin_ok` cookie |

**Cookie integrity.** The `lariat_pin_ok` cookie is HMAC-signed with `LARIAT_PIN_SECRET` (required alongside `LARIAT_PIN`). A cookie forged as a plain `lariat_pin_ok=1` is rejected by `middleware.js` and `hasPinCookie()`. Rotate the secret to force re-auth across all browsers.

**Environment:**
- `LARIAT_PIN` — the PIN cooks type at `/login-pin` (e.g. `0708`).
- `LARIAT_PIN_SECRET` — HMAC signing secret (≥ 32 chars recommended). If absent but `LARIAT_PIN` is set, the app falls back to the legacy unsigned cookie with a deployment warning — existing cookies continue to work so the gate doesn't lock anyone out on an incomplete deploy.

---

## 5. Directory Structure

```
Lariat/
├── app/                    # Next.js App Router (14 pages + 14 API routes)
│   ├── _components/        # Shared: Sidebar, PinLogout
│   ├── api/                # REST endpoints (checks, 86, inventory, costing, etc.)
│   ├── stations/[id]/      # Station line check (server + client)
│   ├── recipes/[slug]/     # Recipe detail + scaler
│   └── ...                 # analytics, costing, beo, kitchen-assistant, etc.
├── lib/                    # Server-side business logic
├── scripts/                # ETL pipeline (ingest, export, rebuild-cache, backup)
├── data/
│   ├── cache/              # Generated JSON templates (DO NOT hand-edit)
│   └── lariat.db           # SQLite (runtime + imported financials)
├── XL/                     # Source workbooks (human-editable)
├── recipes/                # Normalized recipe CSVs + index
├── menus/                  # Menu definitions, station/Toast/BEO maps
├── costing/                # Historical costing artifacts
├── allergens/              # Big 9 allergen matrix
├── food_safety/            # HACCP templates, temp logs
├── training/               # LLM fine-tuning (Modelfile, QA pairs, LoRA config)
├── exports/                # Generated daily exports
└── backups/                # Database backups (npm run backup)
```

---

## 6. Legacy Codebases (Archived)

| Codebase | Location | Stack | Status |
|----------|----------|-------|--------|
| Lariat-v2 | `Lariat-v2/` | Python + Streamlit + Pandas | **Archived.** Original prototype. |
| lariat-kms | `lariat-kms/` | Python Flask + SQLAlchemy | **Abandoned.** Separate git repo. |

These are not part of the active application and should not be modified or referenced for new work.
