# Lariat Cockpit — operations

## Source-of-truth cadence (Toast, Shamrock, Sysco, 7shifts, spreadsheets)

Decide **which file wins** when two sources disagree. Suggested defaults:

| Source | Typical cadence | Feeds | Ingest command |
|--------|-----------------|-------|----------------|
| **Toast** (POS) | Daily or after each service window | Item sales, payments | `npm run ingest:analytics` |
| **Shamrock** (vendor) | Weekly or when orders close | Spend trends | `npm run ingest:analytics` |
| **Sysco** (vendor) | Per delivery / weekly | Purchase history, catalog, item pricing | `npm run rebuild-cache` (reads `data/csv/sysco_*.csv`) |
| **7shifts** (labor) | Weekly or per schedule publish | Labor hours, cost by role, OT | Export CSVs to `dev/exports/YYYY-MM-DD/Labor - *.csv`, then `npm run rebuild-cache` |
| **Manual spreadsheets** | When KM updates costing or menus | Master Costing, operations workbook | `npm run ingest:costing` |
| **Drink-price CSV** (liquor/beer/wine) | When beverage prices change | `vendor_prices` rows with `category IN ('Beer','Wine','Liquor','Spirit','Cocktail')` | `npm run import:vendor-prices -- <path/to.csv>` |
| **Recipe Hub** (normalized CSVs) | When recipes change | Ingredients, allergens, procedures | `npm run rebuild-cache` |
| **Menu CSVs** | When menu version changes | Menu items, station map, Toast links | `npm run rebuild-cache` |
| **HACCP templates** | Annually or after audit | Food safety CCPs, temp limits | `npm run rebuild-cache` |

Re-run the relevant ingest/rebuild after updating source files; restart the app if it was already running.

**Drink-price cadence note.** Drink rows live in the same `vendor_prices` table as food rows, but the costing-ingest DELETE+INSERT sweep preserves them (any row whose `category` is a beverage). So drink prices **do NOT need to be re-imported after every `ingest:costing`** — they survive. The protection lives in `scripts/ingest-costing.mjs` (`BEVERAGE_CATEGORIES`). Full pre-DELETE snapshot of every row (food + drink) is kept in `vendor_prices_history` for trend analysis — query by `(vendor, sku)` ordered by `snapshot_at`.

## Kitchen assistant (local LLM, grounded)

The **Kitchen assistant** page (`/kitchen-assistant`) calls **Ollama** on the same Mac as the Next.js server. Each request injects a **snapshot of live data** (today’s active 86s, recent inventory rows, line-check progress, sign-offs, and recipe snippets matched from `data/cache/recipes.json`) so the model is instructed to **only** use that context for operational claims—reducing hallucination and avoiding “fake POS” answers.

**Allergen / dietary:** Tags in context are **heuristic** (from the recipe book ingest), not legal allergen statements. The UI and system prompt tell staff to escalate allergies to a manager.

**Latency:** Use a **small quantized model** on 16 GB Macs (e.g. `gemma2:2b` or `gemma2:9b` Q4). Tune timeouts and token limits if replies are slow or cut off.

| Variable | Default | Purpose |
|----------|---------|---------|
| `LARIAT_ASSISTANT_ENABLED` | (off) | Set to `1` or `true` to enable `/api/kitchen-assistant` and the nav link. |
| `LARIAT_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API base. |
| `LARIAT_OLLAMA_MODEL` | `gemma2:2b` | Model name as shown by `ollama list`. |
| `LARIAT_OLLAMA_TIMEOUT_MS` | `45000` | Abort inference after this many ms (502 to client). |
| `LARIAT_ASSISTANT_TEMPERATURE` | `0.2` | Lower = less creative / fewer inventions. |
| `LARIAT_ASSISTANT_MAX_TOKENS` | `512` | `num_predict` cap for shorter, faster replies. |
| `LARIAT_ASSISTANT_NUM_CTX` | `4096` | Context window size sent to Ollama. |

**Setup (kitchen Mac):**

1. Install [Ollama](https://ollama.com) and run it (menu bar app).
2. `ollama pull gemma2:2b` (or your chosen model matching `LARIAT_OLLAMA_MODEL`).
3. In `.env.local`: `LARIAT_ASSISTANT_ENABLED=1` (and optional overrides above).
4. Restart `npm run start` / the launcher.

The assistant uses **`location_id`** from the sidebar (`?location=` / `lariat_location` in localStorage) so multi-site 86/inventory/sign-off context stays aligned with the rest of the app.

## Local model training (Mac M4 / Apple Silicon)

See `training/SETUP.md` for full instructions. Quick summary:

1. **Ollama custom model** (recommended first): Uses a Modelfile with the Lariat system prompt baked in. No GPU training needed — just `ollama create lariat-assistant -f training/Modelfile`.
2. **LoRA fine-tuning** (optional, for better grounding): Uses `mlx-lm` on Apple Silicon to fine-tune a small model on Lariat Q&A pairs. Requires ~12 GB RAM for a 3B model.

The assistant works well out of the box with the grounded context approach (no fine-tuning needed). Fine-tuning is for marginal gains in restaurant-specific phrasing and faster inference.

## PIN for sensitive pages

Set **`LARIAT_PIN`** in the environment (e.g. `.env.local` on the kitchen Mac). When set, **Analytics**, **Costing**, **Order guide**, **Menu engineering**, **BEO**, and their `/api/*` routes require a successful POST to `/api/auth/pin` (see **/login-pin**). Cooks use **Today / Stations / Recipes / 86 / Inventory** without the PIN. Use **Sign out (sensitive pages)** in the sidebar to clear the cookie.

## Multi-location

Operational rows (**line checks**, **sign-offs**, **86**, **inventory**) and all v2 financial tables store **`location_id`** (default `default`). Pass **`?location=your_id`** on pages and APIs once you add rows to the `locations` table. Daily export filters with **`LARIAT_EXPORT_LOCATION`** or **`LARIAT_LOCATION`** (default `default`).

## Backups

- **SQLite (live shifts):** copy `data/lariat.db` (and `data/lariat.db-wal` / `data/lariat.db-shm` if present) before risky changes or on a schedule. Restoring is replacing those files while the app is stopped.
- **JSON cache (read-only templates):** `data/cache/*.json` is regenerated by `npm run ingest`. Keep a zip of `data/cache/` if you need to roll back after a bad workbook edit.
- **Daily exports:** run `npm run export` (optionally with a date). Outputs go to `exports/` as `.xlsx` and `.csv`.
- **v2 snapshot (costing, sales, BEO, etc.):** run `npm run export:v2` (optional date argument). Writes `exports/lariat_v2_snapshot_YYYY-MM-DD.xlsx` plus per-table CSVs (`v2_YYYY-MM-DD_*.csv`).

## Ingest order (full refresh)

From the project root, with Python 3 + `openpyxl` installed (`pip install openpyxl`; optional `pdfplumber` for PDF recipes):

```bash
npm run ingest:all
```

Or stepwise:

1. `npm run ingest` — unified workbook → `line_checks`, `setups`, `recipes`, `staff` (from Labor sheet), `stations` (from `scripts/stations-seed.json`).
2. `npm run ingest:costing` — Master Costing + operations order guide → SQLite `vendor_prices`, `recipe_costs`, `bom_lines`, `ingredient_maps`, `order_guide_items`.
3. `npm run ingest:analytics` — Toast item sales + monthly spend → SQLite `sales_lines`, `spend_monthly`.

Environment overrides:

- `LARIAT_SOURCE`, `LARIAT_PDF` — unified workbook and recipe PDF.
- `LARIAT_COSTING`, `LARIAT_OPS` — costing and operations workbooks.
- `LARIAT_UNIFIED`, `LARIAT_ANALYTICS` — unified + analytics workbooks for the analytics ingest.

## If `better-sqlite3` fails to load

Reinstall native bindings on the machine that runs the app (Node major version and OS must match the build):

```bash
npm rebuild better-sqlite3
```
