# Lariat System Architecture

**Current Version**: 2026-04-15
**Core Stack**: Next.js 14, React 18, better-sqlite3, Node.js LTS.
**Data Philosophy**: Local-first, deterministic, Excel-to-JSON/SQLite ETL.

---

## 1. Data Flow & Source of Truth

The Lariat project operates on a "Workbook-as-Source" model with a local JSON + SQLite runtime.

1.  **Master Workbooks**: `XL/Lariat_Unified_Workbook.xlsx`, `XL/Lariat_Master_Costing_*.xlsx`, `XL/Lariat_Analytics_Workbook.xlsx`.
2.  **ETL Layer**: `scripts/ingest*.mjs` (Node wrappers) calling `scripts/ingest_*.py` (Python/openpyxl), plus `scripts/rebuild-cache.mjs` (Node, merges all CSV/JSON sources).
3.  **Runtime Read Model**:
    - **JSON cache** (`data/cache/*.json`) — templates: line checks, recipes, stations, menus, allergens, food safety, vendor summary, labor.
    - **SQLite** (`data/lariat.db`) — live ops writes (checks, sign-offs, 86s, inventory) + imported financial tables (vendor prices, recipe costs, BOM, sales, spend, BEO).
4.  **Live Writes**: iPad/browser → API routes → SQLite (append-only for ops tables).
5.  **Export**: `scripts/export.mjs` and `scripts/export-v2.mjs` → `exports/*.xlsx` + CSV.

---

## 2. Core Modules (lib/)

*   **`lib/db.js`**: SQLite connection (singleton, WAL mode), full schema DDL (14 tables), migration logic, `todayISO()`.
*   **`lib/data.js`**: JSON cache reader with in-memory mtime-based caching. All `get*()` functions.
*   **`lib/location.js`**: Multi-location support (`DEFAULT_LOCATION_ID`).
*   **`lib/menuEngineering.js`**: Menu engineering quadrant (Stars/Puzzles/Plowhorses/Dogs) from sales + cost joins.
*   **`lib/kitchenAssistantContext.js`**: Builds live-data context snapshot for LLM grounding.
*   **`lib/ollama.js`**: Ollama HTTP client for kitchen assistant.

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

**PIN-based gate** for sensitive (financial) pages. Enforced by `middleware.js`:

| Access Level | Pages | Auth Required |
| :--- | :--- | :--- |
| **All staff** | Today, Stations, Recipes, 86 Board, Inventory, Kitchen Assistant | None |
| **KM / Manager** | Analytics, Costing, Order Guide, Menu Engineering, BEO | `LARIAT_PIN` |

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
