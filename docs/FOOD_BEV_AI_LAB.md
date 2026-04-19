# Food/Bev AI Lab — iTerm2 + parallel CLIs

Four-tab layout so **workspace**, **Codex**, **Gemini**, and **Claude** run **in parallel** (separate processes) from the same project root — useful for datasheets, scheduling, and Lariat ops.

## Launch

1. Install [iTerm2](https://iterm2.com/) (recommended) and your CLIs (`codex`, `gemini`, `claude` — exact names depend on how you installed them). If iTerm2 is **not** installed, the launcher falls back to **Terminal.app** and opens **four separate windows** (same commands).
2. **First run:** macOS may prompt to allow **Terminal/iTerm** automation (Apple Events). Grant access so `osascript` can drive iTerm2.
3. From the repo:

```bash
./scripts/launch-food-bev-lab.sh
```

Or double-click **`Food-Bev AI Lab.command`** in Finder.

### Environment overrides

| Variable | Purpose |
|----------|---------|
| `FOOD_BEV_LAB_ROOT` | Project root (defaults to parent of `scripts/`) |
| `CODEX_CMD` | Full shell command for tab 2 (default `codex`) |
| `GEMINI_CMD` | Tab 3 (default `gemini`) |
| `CLAUDE_CMD` | Tab 4 (default `claude`) |

Examples:

```bash
export CODEX_CMD='npx @openai/codex'
export GEMINI_CMD='gemini'
export CLAUDE_CMD='claude'
FOOD_BEV_LAB_ROOT="$HOME/Desktop/LARIAT" ./scripts/launch-food-bev-lab.sh
```

If a binary is missing, that tab will show a shell error — fix PATH or set `*_CMD` to a valid command.

## What each tab is for

| Tab | Role |
|-----|------|
| **1 · Workspace** | Login shell in the repo: `csv*` tools, Python, `npm run ingest`, git, scheduling spreadsheets, quick scripts. |
| **2 · Codex** | OpenAI Codex CLI (or your substitute) — code/data transforms, sheet logic. |
| **3 · Gemini** | Google Gemini CLI — long-context review, multimodal if your build supports it. |
| **4 · Claude** | Anthropic Claude CLI — policies, HR wording, structured docs. |

Work **in parallel**: split tasks (e.g. one agent cleans CSV, another drafts policy) and merge in Git or shared folders.

---

## Tools & skills mapped to your list

| Need | Suggested tooling | Notes |
|------|-------------------|--------|
| **CSV parse / create / concat** | `csvkit` (`csvcut`, `csvstack`, `csvsql`), `xsv`, Python **pandas** | Install: `pip install csvkit pandas` or `brew install csvkit xsv`. Concat: `csvstack a.csv b.csv > out.csv`. |
| **Recipe ingestion (docs, txt, csv)** | Lariat **`npm run ingest`**, **`scripts/ingest_unified.py`**; extend with Python/pdfplumber for one-off PDFs | Keep a **single source workbook**; avoid hand-editing `data/cache/*.json`. |
| **Cost management** | Lariat **`ingest:costing`**, **`/costing`**, **`export:v2`** | Master Costing workbook → SQLite; re-ingest after price updates. |
| **Labor management** | Unified workbook **Labor** sheets → `staff.json` via ingest; future: export Toast labor CSV → staging table | You may add a small import script + SQLite table `labor_hours` if you outgrow Excel. |
| **HR documentation** | Templates in repo `docs/hr/` (add as needed); Claude tab for drafts; store signed PDFs outside git or use git LFS | Do **not** commit SSNs/bank info — use encrypted store + links. |
| **Daily reports** | **`npm run export`**, **`export:v2`**; cron or `launchd` on the kitchen Mac | Email or copy `exports/` to shared drive. |
| **Menu management** | Excel **Menu** sheets + Lariat recipes cache; link menu items to costing `recipe_id` where possible | Version menus by date in sheet names or a `menu_versions` table later. |

---

## Implementations you may still want (gaps)

These are common in Food/Bev + ops; you have partial coverage via Lariat + spreadsheets.

### High value

- **Forecasting / prep alignment** — tie **historical sales** (Toast) to **prep lists** and par levels; flag when projected covers exceed prep capacity.
- **Waste & spoilage log** — separate from 86: track $ and reason (training, spoilage, comp) for COGS variance.
- **Vendor contracts & price effective dates** — beyond spot prices: renewal alerts, bracket pricing.
- **Scheduling beyond labor roster** — shift **templates**, **availability**, **no-show** log; integration with Google Calendar or When I Work (export CSV at minimum).
- **Allergen / nutritional publishing** — customer-facing export from recipe data (you already tag allergens in Lariat recipes).
- **HACCP / temp logs** — if required: simple daily checklist app or CSV with sign-off (similar pattern to line checks).

### Compliance & money

- **Tip pooling / distribution rules** — documented policy + spreadsheet or lightweight calc from POS export.
- **Invoice / AP** — Shamrock/Sysco invoice matching to `spend_monthly` (you have analytics ingest; extend with invoice IDs).
- **Sales tax / non-taxed items** — your unified workbook has accounting sheets; optional pipeline into SQLite for dashboards.

### Guest & event

- **BEO / catering** — Lariat **BEO** module exists; extend with **event menus** linked to costing and **deposit** tracking.
- **Reservations / turns** (if table service) — usually POS-specific; at minimum export CSV for analysis.

### Data & reliability

- **Import staging + audit** — append-only `import_batches` with file hash so a bad Toast CSV doesn’t silently overwrite history.
- **Idempotent recipe keys** — stable `recipe_id` across menu renames for menu engineering and costing joins.
- **Role-based access** — you have optional **`LARIAT_PIN`** for sensitive pages; extend with KM vs cook if you expose money on LAN.

### Outside sources to review

- **NRA / state restaurant association** — labor poster and wage rule checklists.
- **FDA Food Code** (local health adoption) — for HACCP scope.
- **PCI** — if you store cards (usually you don’t; POS handles).
- **TTB** — if you manage bar program compliance separately.

---

## Optional: Raycast / Shortcuts

You can bind **`launch-food-bev-lab.sh`** to a Raycast hotkey or macOS Shortcuts “Run Shell Script” for one-keystroke launch.

---

## Troubleshooting

- **Nothing happens** — Confirm iTerm2 is installed (or use the Terminal fallback). Try `osascript scripts/terminal-food-bev-lab.applescript "$PWD" codex gemini claude` if iTerm is missing; with iTerm, use `scripts/iterm-food-bev-lab.applescript` and accept automation permissions.
- **AppleScript error “Expected end of line… found class name”** — Usually means iTerm2 is not installed: AppleScript cannot load iTerm’s dictionary, so `create window with default profile` does not parse. Install iTerm2 or rely on the launcher’s **Terminal.app** fallback (`terminal-food-bev-lab.applescript`).
- **Wrong directory** — Set `FOOD_BEV_LAB_ROOT` explicitly.
- **CLI not found** — `which codex gemini claude` and adjust `*_CMD`.
