# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read-first

[`AGENTS.md`](AGENTS.md) is the canonical entrypoint and contains the binding domain rules. Architecture and patterns live in `docs/` — `docs/ARCHITECTURE.md`, `docs/PATTERNS.md`, `docs/UI_COPY_RULES.md`, and `docs/OPERATIONS.md` are load-bearing for non-trivial work and should be opened before changing the relevant area.

## Hard rules (frequently violated, never bend)

- This is **Lariat** (restaurant F&B ops). Do **not** confuse with COOLIO (image API).
- HACCP / labor logic is regulated. Never weaken validations or silently auto-correct records — surface errors. An out-of-range reading with a corrective note = yellow; without one = red. The 422 `needs_corrective_action` response enforces this at write time.
- Schema changes require a migration in `lib/db.ts` (`initSchema` / `initFoodSafetyLaborSchema` / `migrateLegacyColumns`); never edit existing DDL in place.
- UI copy targets line cooks under pressure. `docs/UI_COPY_RULES.md` is binding for anything a user sees: no SaaS jargon, kitchen verbs, 5th–8th grade reading level. Internal identifiers may stay technical. **Specifically:** never put shell commands (`<code>npm run …</code>`), env-var names (`LARIAT_*`), DB table names, or infra acronyms (LWW, family-1/2/3) into JSX text, button labels, `aria-label`/`placeholder`/`title` attrs, alert/toast strings, or subtitles — even on PIN-gated manager surfaces. Both normalize passes (`a14958d` + `7c08e9c`) drove these to zero; before any UI-touching commit, grep `app/**/*.{jsx,tsx}` for: `<code>npm `, `<code>LARIAT_`, `<code>XL/`, `Soft-delete`, `Archived rows`, `Per-location`, `Sandbox session`, `Generates a`.
- Vendor data encodings: Toast POS CSVs are **cp1252** (not UTF-8); Shamrock `.xls` files are legacy CDFV2 and need **`xlrd`** (not `openpyxl`).
- **Multi-session worktree protocol** — for any multi-commit batch, work in a per-tool worktree (`scripts/worktree.sh new claude <branch>` then `cd ../Lariat-worktrees/claude-<slug>`). The pre-commit guard refuses commits if HEAD drifts from the locked branch. See AGENTS.md "Multi-session protocol".
- **Branch naming is binding.** New branches must use one of `feat/`, `fix/`, `chore/`, `wip/`. Other prefixes (`cursor/`, `feature/` with -ure, `bundle-h-*`) are legacy and being retired — do not create new ones. `scripts/worktree.sh new` and the pre-commit guard both refuse non-conforming names. Override for legacy-fixup with `LARIAT_ALLOW_ANY_BRANCH=1`. See AGENTS.md "Branch naming".

## Common commands

```bash
# Dev / build
npm run dev                      # next dev on :3000, bound 0.0.0.0 so iPads on LAN can connect
npm run build && npm run start

# Ingest (full refresh after workbook edits)
npm run ingest:all               # ingest + ingest:costing + ingest:analytics + ingest:toast
npm run ingest:costing           # vendor_prices / recipe_costs / bom_lines / order_guide_items
npm run rebuild-cache            # regenerate data/cache/*.json from CSV+JSON sources
npm run import:vendor-prices -- <path/to.csv>   # out-of-band drink/beverage prices

# External integrations (OAuth2; configure via env, see docs/OPERATIONS.md)
node scripts/ingest-toast-timeseries.mjs      # Toast weekly sales + labor (manual-drop folder + scheduled orchestrator)
node scripts/ingest-sevenshifts.mjs           # 7shifts labor
node scripts/ingest-prism.mjs                 # Prism (scripts/prism_api/ holds auth+client)

# Tests — three runners, do NOT mix
npm run test:unit                # Jest, scoped to app/__tests__/** (jsdom, React component tests)
node --test tests/js/*.mjs       # Node test runner — server/API/rule integration tests (in-memory SQLite)
pytest tests/python              # Python ETL/parity tests
npm run test:e2e                 # Playwright

# Run a single Node test (the common case)
node --test tests/js/test-cooling-rules.mjs
node --experimental-strip-types --test tests/js/test-compute-engine.mjs   # required for .ts imports

# Convenience shortcuts (see package.json for the full list)
npm run test:rules               # all HACCP pure-rule modules
npm run test:schema              # migration idempotency + assertCriticalSchemas
npm run test:compute-engine      # C1–C4 / R2-C5 / I2 / I4 regression contracts
npm run test:datapack            # hybrid FTS5+BGE search client
npm run test:price-shocks        # vendor-price shock detection
npm run backup                   # snapshot data/lariat.db{,-wal,-shm} into backups/
npm run export                   # exports/YYYY-MM-DD/Lariat_Daily_Export.xlsx

# Kitchen-assistant prompt regression eval (needs `hermes` on PATH;
# Ollama leg auto-engages if 127.0.0.1:11434 is reachable). Locked
# baseline is 10/10 PASS — exit-code nonzero on any non-PASS.
npm run eval:assistant-prompt
```

The `--experimental-strip-types` flag is required for any `node --test` that imports a `.ts` file directly. Match the existing pattern in `package.json`.

## Architecture in one page

**Stack.** Next.js 16 App Router + React 19, Node LTS, **better-sqlite3** in WAL mode, Python 3 (`openpyxl`, `xlrd`, `pdfplumber`) for ingest, **Ollama (required)** for the Kitchen Assistant + Specials Sandbox. Local-first, deterministic, offline-capable. No hidden runtime AI coupling.

**Next 16 build/dev quirks.** `dev` and `build` scripts pin `--webpack` because next 16 defaults to Turbopack but `next.config.mjs::webpack` does dual-runtime aliasing for three Node-only chains (mDNS via `bonjour-service`, datapack via `@huggingface/transformers` + `onnxruntime-*`, drainer via `better-sqlite3`) — none of that has been ported to Turbopack config. Do **not** drop the `--webpack` flag without porting `next.config.mjs`. `package.json` carries an `overrides` block (`postcss: ^8.5.10`, `esbuild: ^0.25.10`) to clear transitive vulns under next's bundled pipeline; `npm audit fix --force` will try to downgrade `next` itself instead — ignore it. Middleware (`middleware.js`) still functions but prints a deprecation warning at startup; rename → `proxy.ts` is a separate PR (touches the PIN gate everywhere).

**Kitchen Assistant.** No feature flag — `/api/kitchen-assistant` and `/api/specials` go straight to Ollama via `lib/ollama.ts::ollamaChat()`. If Ollama is unreachable the GET ping reports `ollamaReachable: false` (UI shows an "AI is down" banner) and POST returns `502`. Configure with `LARIAT_OLLAMA_URL` / `LARIAT_OLLAMA_MODEL` (default `lari-the-kitchen-assistant` — the custom Modelfile-built tag from `training/Modelfile`, FROM `deepseek-r1:14b`); see `docs/OPERATIONS.md` for the full env table. `lib/ollama.ts::ollamaChat()` sends `think: false` on every request — DeepSeek R1 routes reasoning into a hidden `thinking` channel that consumes `num_predict` before any visible content; older models ignore the flag. The legacy `LARIAT_ASSISTANT_ENABLED` flag has been removed.

**Three storage tiers, distinct ownership:**

| Tier | Path | Owner | Mutation policy |
|------|------|-------|-----------------|
| Source workbooks | `XL/*.xlsx`, `data/originals/`, `data/imports/` | Operator (Excel) | Edited by humans, gitignored |
| JSON cache | `data/cache/*.json` (14 templates) | `npm run ingest` / `rebuild-cache` | **Never hand-edit** — regenerated from sources |
| Live DB | `data/lariat.db` (40+ tables) | API routes + ingest scripts | WAL; live ops tables append-only; financial tables DELETE+INSERT per ingest |

**ETL pattern (`docs/PATTERNS.md §2`).** Node `.mjs` wrapper `execSync`s the matching Python `.py` parser, parses JSON from stdout, then owns all SQLite writes inside a `db.transaction(...)`. Post-pass math (T3 yield delta, T4 unit convert, T5b catch-weight backfill, T6 pack-size detect, T7 master rebuild, T8 shrinkage) lives in Node, not Python. `ingest_runs` row tracks each pass.

**HACCP rule-module shape (`docs/PATTERNS.md §1`).** Every regulated concept (cooling, temp log, receiving, sanitizer, date marks, sick worker, calibrations, cleaning, pest, SDS, TPHC) is exactly five files: pure rule module in `lib/<concept>.ts` (no I/O, threshold constants, citations), API route in `app/api/<concept>/route.js`, board UI in `app/food-safety/<concept>/`, hub-page tile, and paired tests in `tests/js/test-<concept>-rules.mjs` + `test-<concept>-api.mjs`. The rule module is the single source of truth for thresholds and FDA/CO citations — never hand-type a citation in UI copy.

**Audit — two tracks, no overlap (`docs/PATTERNS.md §3`):**
- **DB audit** (`audit_events` table, `lib/auditEvents.ts`): every regulated mutation. `postAuditEvent()` MUST run inside the same `db.transaction(...)` as the source INSERT — it warns if called outside one. **Do not** wrap it in try/catch in the route; an audit failure must roll back the source row. Append-only; corrections get a new row with `action='correction'` + `replaces_id`.
- **File audit** (`data/audit/management-actions.jsonl`, `lib/auditLog.mjs`): management actions outside regulated tables (recipe edits, ingredient remaps, cost updates).

**JS↔Python parity helpers.** `lib/unitConvert.mjs` ↔ `scripts/lib/units.py` and `lib/ingredientKey.ts` ↔ `scripts/lib/ingredient_key.py` must produce byte-identical output. Python is authoritative; regenerate the JS fixture via `python3 scripts/lib/generate_unit_convert_fixture.py` when conversion logic changes. Tests: `test:unit-convert`, `test:ingredient-key`.

**Price-trend invariant.** `vendor_prices` is rebuilt per costing-ingest (DELETE+INSERT). Before the DELETE, `scripts/ingest-costing.mjs` snapshots every current row into append-only `vendor_prices_history` keyed on `run_id`+`snapshot_at`. The DELETE also preserves any row whose `LOWER(category)` is in `BEVERAGE_CATEGORIES` — those are populated out-of-band by `scripts/import-vendor-prices.mjs` and survive the sweep. Tests: `test:vendor-prices-history`.

**Compute engine (`docs/ARCHITECTURE.md §7`).** `lib/computeEngine/` runs `recomputeRecipeCosts → recomputeMarginAnalysis → computeAccountingVariance` on demand. Step 1 delegates ingredient→price matching to `computeCostVariance()` in `lib/costingBenchmarks.mjs` so the live engine and the T7/D6 variance path share one resolver — **do not** re-implement matching in `recipeCosting.ts`; that divergence is the specific regression this module exists to prevent. Triggered via `POST /api/compute/status` (PIN-gated) or fire-and-forget from `POST /api/receiving` using the `setImmediate` + static-import pattern in `docs/PATTERNS.md §9`.

**Location scoping (`docs/PATTERNS.md §4`).** Every operational + financial table carries `location_id TEXT NOT NULL DEFAULT 'default'`. Every API route extracts via `lib/location.ts` (`locationFromRequest` reads `?location=`; `locationFromBody` reads `body.location_id`). Client state in `localStorage.lariat_location` via `useLocation()` (`app/_components/useLocation.js`); changes broadcast a `LOC_EVENT` so sidebar/palette/floorplan stay in sync. **Do not** derive `location_id` from cookie, header, or session.

**Nav registry.** `app/_components/navRegistry.js` is the single source of truth for nav links, command palette, and floorplan zones. Adding a page = add one entry to `NAV_ITEMS`. Never hand-roll a `<Link>` to a route that isn't registered — palette and sidebar will drift.

**PIN gate (`docs/ARCHITECTURE.md §4`).** `middleware.js` gates KM/manager surfaces (`/analytics`, `/costing`, `/purchasing`, `/menu-engineering`, `/beo`, `/management`, and their `/api/*` siblings). Cookie `lariat_pin_ok` is HMAC-signed with `LARIAT_PIN_SECRET`; routes re-check via `lib/pin.ts::hasPinCookie()` so curl/replay can't bypass the middleware.

**LLM action JSON (`docs/PATTERNS.md §10`).** When the Kitchen Assistant needs a number the LLM can't reliably compute, the LLM emits `{ "action": "...", ... }` and the backend (`extractAction()` in `app/api/specials/route.js`) intercepts, runs the deterministic computation, strips the JSON, and appends rendered output. Always guard `payload.*` field types before they flow into compute code. Use static imports for the compute helpers — past dynamic-import bugs silently swallowed module errors.

**Data Pack (`scripts/datapack/` + `lib/datapackSearch.ts`).** External knowledge base — USDA FoodData Central, Open Food Facts, RecipeNLG, Wikibooks Cookbook, FDA Food Code, FoodSafety.gov, FlavorDB — built by a Python pipeline (`download_all.py` → `extract_and_normalize.py` → `build_sqlite_index.py` / `build_fts_index.py` / `build_embeddings_index.py`) and consumed at runtime via the read-only TS client. Hybrid search = FTS5 (BM25) ⊕ BGE semantic (transformers.js, `BAAI/bge-small-en-v1.5`) fused by RRF; vectors are streamed from per-bucket `vectors.npy`. The pack lives off-tree on the external SSD, symlinked into `data/lariat-data`. **The client is graceful-degraded**: if the symlink is missing it never throws — `available()` returns false and every search no-ops. The Kitchen Assistant uses this to ground food-safety questions in FDA Food Code text and ingredient questions in USDA Foods.

**Entity layer (`lib/entities.ts`).** Phase 1 of the canonical-entity rollout. Every external system (toast, 7shifts, prism, shamrock, sysco, manual) routes its source-system identifiers through `resolveOrCreate*` helpers that hit the `external_ids` registry and return a stable internal UUIDv7. Resolvers are synchronous (better-sqlite3 is sync) — wrap multi-resolution batches in a single `db.transaction(...)` for throughput. Backfill scripts live at `scripts/backfill/{employees,ingredients,menu_items,recipes,vendors}.mjs`. Pre-backfill DB snapshot: `data/lariat.db.bak-pre-backfill`.

**Sales depletion (`lib/salesDepletion.ts`).** Phase 3: when Toast reports "sold 3 Baja Tacos," the system auto-debits BOM-equivalent ingredients from inventory. Two layers: pure resolver `resolveDepletionsForSale(salesLine, dishComponents, bomLines, recipes)` returns depletion rows with no I/O (unit-testable); applier `applyDepletionsForPeriod(location, period)` wraps it in a single tx that writes `inventory_updates` + `audit_events` + a `sales_depletion_runs` row. Resolution chain: `sales_lines.item_name` → `dish_components` → for each row, either `vendor_item` (direct) or `recipe` (expand via `bom_lines` scaled by yield in `entities_recipes`). Pre-phase3 DB snapshot: `data/lariat.db.bak-pre-phase3`.

**KDS sibling repo.** This repo owns the **server** side of the Lariat ↔ KDS protocol (`lib/kds.ts` rule module, `app/api/kds/tickets/route.js`, `app/api/kds/tickets/[id]/bump/route.js`, `app/kds/punch/page.jsx`, `kds_tickets` + `kds_ticket_lines` tables in `lib/db.ts`, Bonjour advertise via `lib/mdnsDiscovery.ts`). The **client** is a separate Swift app at `~/Dev/Lariat-KDS/` (gh: `sburdges-eng/Lariat-KDS`). The protocol spec lives at `Lariat-KDS/docs/lariat-kds-protocol.md`; the Swift parser fails closed on any drift in the response shape. **Do not change `BumpResponse` field names in `lib/kds.ts` without updating the protocol doc first** — that's a hard rule per `Lariat-KDS/CLAUDE.md`.

**Kitchen-assistant prompt eval (`training/eval/`).** Regression harness for `lib/ollama.ts::GROUNDED_SYSTEM`. Two runners (`hermes -z` always; Ollama if `127.0.0.1:11434` reachable) + Hermes grader. Locked baseline: 10/10 PASS — exit-code nonzero on any non-PASS (FAIL, PARTIAL, or ERROR), so the script can gate CI or pre-merge. Run via `npm run eval:assistant-prompt`. Per-run JSON dumps land in `training/eval/results/` (gitignored).

## Testing rules

- **Do not mock SQLite.** Integration tests use a real in-memory DB via `setDbPathForTest()`. We got burned by mocked costing math; don't retry.
- HACCP rule-module tests must exercise every threshold boundary. API tests must verify audit-event emission and transactional rollback.
- For testing with realistic data: real-looking recipe/inventory fixtures, not `foo`/`bar`. Domain rules only surface against realistic shapes.

## Legacy

`Lariat-v2/` (Streamlit/Pandas prototype) and `lariat-kms/` (separate Flask repo) are archived — do not modify or reference for new work.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Lariat** (23209 symbols, 35392 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Lariat/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Lariat/clusters` | All functional areas |
| `gitnexus://repo/Lariat/processes` | All execution flows |
| `gitnexus://repo/Lariat/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
