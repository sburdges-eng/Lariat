# Lariat Cockpit — operations

## Python test setup (one-time, per checkout)

Several test suites shell out to Python fixture builders and ingest scripts that
require `openpyxl`, `xlrd`, and `pandas`.  A project-local venv isolates these
from whatever Python is on your PATH.

```bash
bash scripts/install-python-deps.sh   # creates .venv, installs requirements-dev.txt
```

Run this once after cloning (or after pulling a `requirements-dev.txt` change).
`npm run test:shows` and the individual `test:shows-ingest / test:shows-repo /
test:shows-api / test:shows-py` targets all rely on `.venv/bin/python3` and
`.venv/bin/pytest`.  If `.venv` is missing the JS tests print a clear error with
the setup command.

The `.venv` is gitignored.  `.venv-datapack` (heavy ML deps for the data pack)
is a separate venv managed independently; see `scripts/datapack/`.

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

## Runtime env names

Use the canonical names below in `.env.local` and launchd/environment files. Older aliases are still read for one release and emit a one-time warning when used.

| Variable | Required | Purpose |
|----------|----------|---------|
| `LARIAT_LOCATION_ID` | No | Default site id for single-site installs, discovery metadata, and manager PIN/location-scoped helpers. |
| `LARIAT_EXPORT_LOCATION` | No | Daily export location override when exporting a site other than `LARIAT_LOCATION_ID`. |
| `LARIAT_7SHIFTS_API_KEY` | No | Optional 7shifts health/degraded-mode credential check. |

## Kitchen assistant (local LLM, grounded — required)

The **Kitchen assistant** page (`/kitchen-assistant`) and the **Specials Sandbox** (`/specials`) both call **Ollama** on the same Mac as the Next.js server. **Ollama must be running** — the routes have no feature flag and will return `502` (with `ollamaReachable: false` on the GET ping) if the daemon is not reachable. Each request injects a **snapshot of live data** (today’s active 86s, recent inventory rows, line-check progress, sign-offs, and recipe snippets matched from `data/cache/recipes.json`) so the model is instructed to **only** use that context for operational claims—reducing hallucination and avoiding “fake POS” answers.

**Allergen / dietary:** Tags in context are **heuristic** (from the recipe book ingest), not legal allergen statements. The UI and system prompt tell staff to escalate allergies to a manager.

**Latency:** On 16 GB+ Macs the kitchen-tested base is `deepseek-r1:14b` (~9 GB resident, ~30 tok/s on M4). For older Macs or 8 GB Airs, `deepseek-r1:7b` is recommended (~4.7 GB resident). Tune `LARIAT_OLLAMA_TIMEOUT_MS` / `LARIAT_ASSISTANT_MAX_TOKENS` / `LARIAT_ASSISTANT_NUM_CTX` if replies are slow or cut off.

**DeepSeek R1 reasoning note.** DeepSeek R1 is a reasoning model that uses a `<think>` block for internal monologues. `lib/ollama.ts::ollamaChat()` sends `think: false` on every request to suppress this thinking output from the final response — this is required for the JSON-action contracts to work correctly in the UI. Don't remove it.

| Variable | Default | Purpose |
|----------|---------|---------|
| `LARIAT_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API base. |
| `LARIAT_OLLAMA_MODEL` | `lari-the-kitchen-assistant` | Model name as shown by `ollama list`. The default is the custom Modelfile-built model in `training/Modelfile` (FROM `deepseek-r1:14b`). Override to point at any other tag. |
| `LARIAT_OLLAMA_TIMEOUT_MS` | `45000` | Abort inference after this many ms (502 to client). |
| `LARIAT_ASSISTANT_TEMPERATURE` | `0.2` | Lower = less creative / fewer inventions. |
| `LARIAT_ASSISTANT_MAX_TOKENS` | `512` | `num_predict` cap for shorter, faster replies. |
| `LARIAT_ASSISTANT_NUM_CTX` | `4096` | Context window size sent to Ollama. |

**Setup (kitchen Mac) — required for the Kitchen Assistant and Specials Sandbox:**

1. Install [Ollama](https://ollama.com) and run it (menu bar app).
2. `ollama pull deepseek-r1:14b` (the base for the custom model).
3. `ollama create lari-the-kitchen-assistant -f training/Modelfile` (builds the grounded kitchen-assistant model the app expects by default).
4. Restart `npm run start` / the launcher.

If Ollama is not running, `/kitchen-assistant` and `/specials` show an "AI is down" banner and `POST /api/kitchen-assistant` / `POST /api/specials` return `502`. The rest of the app (line ops, costing, HACCP, BEO, …) works unchanged.

The assistant uses **`location_id`** from the sidebar (`?location=` / `lariat_location` in localStorage) so multi-site 86/inventory/sign-off context stays aligned with the rest of the app.

## Local model training (Mac M4 / Apple Silicon)

See `training/SETUP.md` for full instructions. Quick summary:

1. **Ollama custom model** (recommended first): Uses a Modelfile with the Lariat system prompt baked in. No GPU training needed — just `ollama create lari-the-kitchen-assistant -f training/Modelfile`.
2. **LoRA fine-tuning** (optional, for better grounding): Uses `mlx-lm` on Apple Silicon to fine-tune a small model on Lariat Q&A pairs. Requires ~12 GB RAM for a 3B model.

The assistant works well out of the box with the grounded context approach (no fine-tuning needed). Fine-tuning is for marginal gains in restaurant-specific phrasing and faster inference.

## PIN for sensitive pages

Set **`LARIAT_PIN`** in the environment (e.g. `.env.local` on the kitchen Mac). When set, **Analytics**, **Costing**, **Order guide**, **Menu engineering**, **BEO**, and their `/api/*` routes require a successful POST to `/api/auth/pin` (see **/login-pin**). Cooks use **Today / Stations / Recipes / 86 / Inventory** without the PIN. Use **Sign out (sensitive pages)** in the sidebar to clear the cookie.

## Multi-location

Operational rows (**line checks**, **sign-offs**, **86**, **inventory**) and all v2 financial tables store **`location_id`** (default `default`). Pass **`?location=your_id`** on pages and APIs once you add rows to the `locations` table. Daily export filters with **`LARIAT_EXPORT_LOCATION`** first, then **`LARIAT_LOCATION_ID`** (default `default`).

## Backups

- **SQLite (live shifts):** copy `data/lariat.db` (and `data/lariat.db-wal` / `data/lariat.db-shm` if present) before risky changes or on a schedule. Restoring is replacing those files while the app is stopped.
- **JSON cache (read-only templates):** `data/cache/*.json` is regenerated by `npm run ingest`. Keep a zip of `data/cache/` if you need to roll back after a bad workbook edit.
- **Daily exports:** run `npm run export` (optionally with a date). Outputs go to `exports/` as `.xlsx` and `.csv`.
- **v2 snapshot (costing, sales, BEO, etc.):** run `npm run export:v2` (optional date argument). Writes `exports/lariat_v2_snapshot_YYYY-MM-DD.xlsx` plus per-table CSVs (`v2_YYYY-MM-DD_*.csv`).
- **`npm run backup` (scripts/backup.mjs):** snapshots `lariat.db` + off-tree `uploads/` + `audit/` into `backups/<stamp>/`, with `SHA256SUMS` and `manifest.json`; verify a snapshot with `npm run backup -- verify <DIR>`.
- **Sick-note PHI key escrow (P0-6):** the media key file (`<dataDir>/keys/sick-note-media.json`) that decrypts doctor's-note documents is **excluded from backups by design** — a stolen or copied backup holds ciphertext only. Recovery is (1) the macOS Keychain mirror (`com.lariat.sick-note-media-key`, same Mac or synced via iCloud Keychain), plus (2) a one-time manual copy of the key file into a password manager as a second escrow point. Restoring onto a **new Mac** requires placing that key file back under `<dataDir>/keys/` before sick-note documents can be opened; `manifest.json`'s `sick_note_key_fingerprint` lets a restore confirm the right key is present without the manifest itself containing it. Key rotation is not supported in v1 — losing the key permanently loses every encrypted document.

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
