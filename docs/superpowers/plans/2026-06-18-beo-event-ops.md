# Plan — BEO Event Ops (banquet fire + cascade + inventory counts-first + standing prep par)

Branch: `worktree-feat+beo-event-ops` (worktree off `origin/main` @ a9e5479)
Plan file is the source of truth; ledger at `$(git rev-parse --git-path sdd)/progress.md`.
Executed via superpowers:subagent-driven-development (fresh implementer + reviewer per task, TDD).

## Goal

Ship the four-phase BEO event-ops refactor:
1. Banquet fire schedule moves *inside* an open BEO event; removed from Service nav.
2. BEO cascade: one engine feeds an order guide (leaf ingredients) + an event prep board (sub-recipe prep demands) from BEO line-item quantities.
3. Inventory becomes counts-first (Counts default; standing list seeded from `inventory_par`, par as reference).
4. Standing prep par: a configurable per-item/recipe target list, separate from banquet event prep.

## Grounded architecture facts (verified against code, not assumed)

### Fire schedule (Phase 1)
- Page: `app/prep/fire-schedule/page.jsx` + `app/prep/fire-schedule/_components/{StationColumn,CourseCard}.jsx` + `_lib/useFireCue.ts`.
- Nav entry: `app/_components/navRegistry.js` ~L225–232 (`id: 'fire-schedule'`, `href: '/prep/fire-schedule'`, `group: 'Service'`).
- Prep page link: `app/prep/page.jsx` ~L90–92 (`data-testid="prep-tile-fire-schedule"`).
- API: `app/api/beo/fire-schedule/route.js` — currently `GET ?date=YYYY-MM-DD&location=<slug>`; queries `beo_courses JOIN beo_events` by `event_date`+`location_id`, then `beo_line_items` by `course_id`; structures via `resolveSchedule()` in `lib/beoFireSchedule.ts`. PUBLIC (no auth).
- Tests: `app/__tests__/FireSchedule.test.jsx`, `tests/js/test-beo-fire-schedule-api.mjs`, `tests/js/test-beo-fire-schedule-rules.mjs`.
- Existing spec: `docs/superpowers/specs/2026-05-04-beo-fire-times.md` (must not be contradicted).

### BEO event UI (Phases 1–2)
- `app/beo/page.jsx` → `app/beo/BeoBoard.tsx`. Single board; event opened via `<select>` → `openEventId` state. **No tab system, no `/beo/[id]` route.**
- `PrepSheetTable` (BeoBoard.tsx ~L515–663): columns GROUP NOTE | ITEM | PREP | SECONDARY PREP | ORDER ITEMS | COURSE | TIME | COST | QTY | TOTAL.
- Right rail: `MenuPanel`, `app/beo/_components/CoursePanel.jsx`, `PrepHistoryPanel.jsx`.
- `GET /api/beo` → `{ location_id, events, prep_tasks, line_items }`. LineItem: `id, event_id, sort_order, item_name, category, unit_cost, quantity, course_id, order_time, prep_notes, secondary_prep_notes, order_items_notes, group_note`.
- `GET /api/beo/courses?event_id=&location=` → `{ courses:[...] }`.

### Cascade engine (Phase 2)
- `scripts/lib/bom_expand.py`: `expand_recipe(manifest,slug,qty,unit)->dict[(ing,unit),qty]`; `aggregate_demand(manifest,demands)->dict[(ing,unit),qty]`; `build_manifest_from_normalized(recipes_csv, normalized_dir)`; `Manifest{slug,display_name,yield_qty,yield_unit,sub_recipe_slugs,bom,allergens}`. Errors: `UnknownRecipeError`, `UnitMismatchError`, `RecipeCycleError`.
- `scripts/lib/beo_pull.py`: `load_beo_recipe_map(csv,manifest)`, `build_demand(rows,manifest,beo_map,qty_in_yield_units)->(demand,unmapped)`, `pull_orders(manifest,demand,inventory)->OrderLine[]`. `InvoiceRow{menu_item,qty,unit}`, `Unmapped{menu_item,reason}`, `OrderLine{ingredient,unit,total_needed,on_hand,to_order}`.
- `scripts/bom_expand_cli.py`: stdin JSON `{recipe_slug|recipe_name, qty|multiplier, unit, root}` → stdout `{recipe_slug,target_qty,target_unit,scale_factor,leaf_rows:[{ingredient,qty,unit}]}`. Builds manifest from `root/recipes/recipe_index.csv` + `root/recipes/normalized/`.
- `lib/recipeCalculator.ts`: spawn pattern — `spawn(PYTHON_BIN, [cliPath])`, `PYTHON_BIN = process.env.LARIAT_PYTHON || 'python3'`, `cliPath = scripts/bom_expand_cli.py`, write JSON to stdin, parse stdout JSON, `CalculatorError`, `DEFAULT_TIMEOUT_MS = 5000`, `resolveProjectRoot() = process.env.LARIAT_ROOT || process.cwd()`. **Copy this exact pattern.**
- Data present: `menus/beo_recipe_map.csv` (cols `beo_item,recipe_id` where recipe_id is a display name), `recipes/recipe_index.csv`, `recipes/normalized/` (73 CSVs). No `costing/bom_*.csv` (legacy `build_manifest` path unused by CLI).
- `aggregate_demand` returns LEAVES only. Per-sub-recipe prep demand needs a new walk (Task 5).
- Tests: `tests/python/test_bom_expand.py`, `tests/python/test_beo_pull.py`, `tests/js/test-sub-recipe-graph.mjs`.
- `scripts/debug-event-ops.mjs` is an empty 0-byte stub — ignore.

### Inventory (Phase 3)
- Route-based tabs in `app/inventory/_nav.jsx`: `TABS = [Log(/inventory), Counts(/inventory/counts), Par(/inventory/par), Waste(/inventory/waste)]`; default = Log (`/inventory` root renders `InventoryBoard` over `inventory_updates`).
- Counts: `app/inventory/counts/page.jsx` (list), `app/inventory/counts/[id]/page.jsx` + `CountSheet.jsx`. API `/api/inventory/counts` (headers), `/api/inventory/counts/[id]/lines` (`ingredient, sku, on_hand_qty, unit`; UNIQUE(count_id,ingredient,sku)).
- Par: `app/inventory/par/page.jsx`. API `/api/inventory/par` GET/POST/DELETE. Table `inventory_par{vendor,ingredient,sku,par_qty,par_unit,pack_size,pack_unit,category,note,location_id}`.
- Tests: `tests/js/test-inventory-counts-api.mjs`, `tests/js/test-inventory-par-api.mjs`.

### Prep board (Phase 4)
- `app/prep/page.jsx` + `app/prep/PrepBoard.jsx`: daily task-queue over `prep_tasks` (claim/start/done/skip); already has "Suggested Prep" from par deficit.
- API `/api/prep-tasks` GET/POST, `/api/prep-tasks/[id]` PATCH/DELETE.
- Tests: `tests/js/test-prep-tasks-api.mjs`.

### DB / schema (cross-cutting)
- All schema in `lib/db.ts` `initSchema()`. `SCHEMA_VERSION = 1` (~L978). Pre-commit `scripts/check-schema-version-bump.mjs` requires bumping `SCHEMA_VERSION` in the same commit that changes DDL.
- `getDb()` → better-sqlite3, WAL, `foreign_keys = ON`. Parameterized queries via `.prepare(...).all/get/run(...)`.
- `assertCriticalSchemas()` (~L3088–3152) lists required columns per critical table.
- Schema test: `tests/js/test-schema-migrations.mjs` (PRAGMA assertions; idempotency).
- pytest 9.0.2 runs on system `python3` (`python3 -m pytest tests/python/...`). No `.venv`.

## Global Constraints (binding — reviewers use these as the attention lens)

1. **Never break the existing fire-schedule date contract.** The `?date=&location=` query path and its response shape (`{date, location_id, stations:[{station_id, courses:[{id,event_id,event_title,course_label,fire_at,lines:[{id,item_name,quantity,prep_notes}]}]}]}`) must remain green. New behavior is **additive** (`?event_id=N`).
2. **No silent drops.** Cascade must surface unmapped BEO items (`unmapped:[{menu_item, reason}]`) in API responses and the UI. Never discard an item that can't be mapped.
3. **Parameterized SQL only** — never string-interpolate values into SQL (placeholders + bound params, as existing code does).
4. **`location_id` scoping** — every new query that reads/writes location-owned data filters by `location_id` (default `'default'`), matching existing routes.
5. **Schema changes require `SCHEMA_VERSION` bump** in the same commit + `assertCriticalSchemas` entry + `test-schema-migrations.mjs` coverage.
6. **Reuse the proven spawn pattern** from `lib/recipeCalculator.ts` for any new Python shell (timeout, stdin JSON, stdout JSON parse, `CalculatorError`-style typed errors). Do not invent a new IPC pattern.
7. **TDD** — failing test first, minimal code to green, never weaken a test to pass. Run the named covering tests and report output.
8. **checkjs/TS** — new `.ts`/`.tsx` must pass `npm run typecheck`; new `.js` route files follow the existing `// @ts-check`-style conventions already in sibling routes.
9. **Default Simplicity** (CLAUDE.md) — minimum viable; no speculative config/guards/multi-profile.
10. **Verification gate before any commit**: at minimum the task's covering tests + `npm run typecheck`. Full gate (`npm run verify` + pytest + eslint) at phase boundaries / final review.

## Decisions (resolving plan ambiguities; chosen for minimal risk + Default Simplicity)

- **D1 — BEO tabs in `BeoBoard.tsx`, no new route.** Add `activeTab` state; tab bar above the open event. Tabs: **Sheet** (default; wraps existing `PrepSheetTable` unchanged) | **Order guide** | **Prep** | **Fire**. Rationale: matches "inside open BEO event," reuses `openEventId`, smallest blast radius.
- **D2 — Fire API additive.** Add `?event_id=N` to `app/api/beo/fire-schedule/route.js` (filter to one event, ignore date when event_id present). Keep date path. Fire tab calls `?event_id=N`.
- **D3 — Cascade = new `lib/beoCascade.ts` + new `scripts/beo_cascade_cli.py`** reusing `beo_pull` + `bom_expand`. CLI stdin `{line_items:[{item_name,quantity}], root, qty_in_yield_units?, inventory?}` → stdout `{order_guide:[OrderLine], prep_demands:[{recipe_slug,display_name,qty,unit}], unmapped:[{menu_item,reason}]}`. New route `GET /api/beo/cascade?event_id=N`.
- **D4 — Per-sub-recipe prep demand:** add `expand_recipe_demand(manifest, demands)` to `bom_expand.py` returning aggregated per-recipe-node demand `{(slug,unit): qty}` (records every recipe/sub-recipe node visited, scaled). Order guide uses `aggregate_demand` (leaves); prep board uses `expand_recipe_demand` (recipe nodes).
- **D5 — Inventory counts-first:** reorder `_nav.jsx` (Counts first); redirect `/inventory` → `/inventory/counts`; keep Log/Waste. Counts entry seeds the standing ingredient list from `inventory_par` (par shown as a reference band), inline on-hand entry.
- **D6 — `prep_par` standing table (no shift_date):** `prep_par{id, location_id, recipe_slug, ingredient, target_qty, unit, station_id, sort_order, note, created_at, updated_at}` with `UNIQUE(location_id, station_id, recipe_slug, ingredient)`. New API `/api/prep-par` GET/POST/DELETE. New `app/prep/par/page.jsx` editable list. Existing task queue stays.

## Tasks

### Phase 1 — Banquet fire schedule under events + nav cleanup

**T1 — Fire API: additive `?event_id=N`.**
- Files: `app/api/beo/fire-schedule/route.js`, `lib/beoFireSchedule.ts` (only if resolver needs an event-scoped entry), `tests/js/test-beo-fire-schedule-api.mjs` (+rules if touched).
- Approach: when `event_id` present and valid integer, query courses for that event (still join events, still `location_id` scoped); response shape identical (single event's stations). When absent, unchanged date path.
- Acceptance: new test asserts `?event_id=N` returns only that event's courses/lines in the same shape; existing date tests still pass; bad/cross-location event_id → empty stations (not error).

**T2 — BEO tab scaffold in `BeoBoard.tsx`.**
- Files: `app/beo/BeoBoard.tsx`, new `app/beo/_components/EventTabs.jsx` (or inline), component test (jest/RTL) e.g. `app/__tests__/BeoBoardTabs.test.jsx`.
- Approach: add `activeTab` state (default `'sheet'`); tab bar shown only when an event is open; **Sheet** renders existing `PrepSheetTable` unchanged; **Order guide**/**Prep**/**Fire** render placeholder panels (filled by T3/T9). No change to prep-sheet behavior.
- Acceptance: switching tabs shows/hides panels; Sheet is default and identical to current rendering; no regression in existing BEO tests.

**T3 — Fire tab content (per-event).**
- Files: `app/beo/_components/EventFirePanel.jsx`, wire into `BeoBoard.tsx`; component test.
- Approach: fetch `/api/beo/fire-schedule?event_id=<openEventId>&location=<loc>`; render station columns/course cards (reuse display logic from fire-schedule `_components` or a lean adaptation). Read-only display of fire times for the open event.
- Acceptance: opening an event + Fire tab fetches event-scoped schedule and renders stations/courses; empty state when no courses.

**T4 — Remove fire from nav + redirect.**
- Files: `app/_components/navRegistry.js` (remove `fire-schedule` entry), `app/prep/page.jsx` (remove the link tile), redirect `/prep/fire-schedule` → `/beo` (Next redirect in the page or `next.config`/middleware — match existing redirect convention in repo), test.
- Approach: keep `/prep/fire-schedule` route returning a redirect to `/beo` (do not 404 — preserves bookmarks). Remove nav + prep-tile references.
- Acceptance: nav registry no longer lists fire-schedule; `/prep` tile gone; `/prep/fire-schedule` redirects to `/beo`; existing fire page tests updated or removed coherently.

### Phase 2 — BEO cascade (order guide + event prep board)

**T5 — `expand_recipe_demand` in `bom_expand.py`.**
- Files: `scripts/lib/bom_expand.py`, `tests/python/test_bom_expand.py`.
- Approach: new function returning per-recipe-node aggregated demand `{(slug,unit): qty}` over a demands iterable, recording each recipe AND sub-recipe node with scaled qty (reuse the existing `_expand_into` traversal logic; add node recording). Same error semantics.
- Acceptance: pytest covers a recipe with a sub-recipe (e.g. queso→salsa): both the parent and the sub-recipe appear with correct scaled quantities; duplicate top-level demands compound.

**T6 — `scripts/beo_cascade_cli.py`.**
- Files: `scripts/beo_cascade_cli.py`, `tests/python/test_beo_cascade_cli.py`.
- Approach: stdin JSON `{line_items:[{item_name,quantity}], root, qty_in_yield_units?, inventory?}`. Build manifest via `build_manifest_from_normalized`; load `menus/beo_recipe_map.csv` via `load_beo_recipe_map`; `build_demand` (line items as `InvoiceRow`); order_guide via `pull_orders` (leaves, on-hand subtraction); prep_demands via `expand_recipe_demand` (recipe nodes, resolved to `display_name`); collect `unmapped`. Output `{order_guide, prep_demands, unmapped}`; `{error}` + non-zero exit on failure (match `bom_expand_cli.py` error contract).
- Acceptance: pytest feeds line items through a temp root fixture (or the real data dir) and asserts order_guide leaves + prep_demands recipe nodes + unmapped surfacing.

**T7 — `lib/beoCascade.ts`.**
- Files: `lib/beoCascade.ts`, `tests/js/test-beo-cascade.mjs`.
- Approach: copy the `recipeCalculator.ts` spawn pattern verbatim (PYTHON_BIN, timeout, stdin JSON, stdout parse, typed error). Export `cascadeFromLineItems(lineItems, opts)` returning `{ orderGuide, prepDemands, unmapped }` typed.
- Acceptance: TS test spawns the CLI against real data and asserts shapes + a typed error on bad input.

**T8 — `GET /api/beo/cascade?event_id=N`.**
- Files: `app/api/beo/cascade/route.js`, `tests/js/test-beo-cascade-api.mjs`.
- Approach: load `beo_line_items` for `event_id` (location-scoped via the event), map to `{item_name, quantity}`, call `cascadeFromLineItems`, return `{ event_id, order_guide, prep_demands, unmapped }`. Optionally fold in on-hand from latest inventory count (MVP: skip on-hand or pass empty).
- Acceptance: API test inserts an event + line items, hits the route, asserts cascade output incl. unmapped; cross-location/missing event → empty/clear response (no leak).

**T9 — Order guide + Prep tab panels.**
- Files: `app/beo/_components/EventOrderGuidePanel.jsx`, `app/beo/_components/EventPrepPanel.jsx`, wire into `BeoBoard.tsx`; component test.
- Approach: both fetch `/api/beo/cascade?event_id=`; Order guide lists aggregated leaf ingredients (ingredient, unit, total_needed, to_order); Prep lists sub-recipe prep demands grouped sensibly; both render an "Unmapped items" callout when present.
- Acceptance: panels render cascade output; unmapped surfaced visibly; loading/empty states handled.

### Phase 3 — Inventory counts-first

**T10 — Counts default + tab reorder + redirect.**
- Files: `app/inventory/_nav.jsx` (Counts first), redirect `/inventory` → `/inventory/counts`, test.
- Approach: reorder TABS; make `/inventory` redirect to `/inventory/counts` (preserve `?location=`); Log relabeled/kept as secondary. Update `_nav` active-state logic accordingly.
- Acceptance: visiting `/inventory` lands on Counts; Log/Par/Waste still reachable; active-tab highlighting correct.

**T11 — Standing counts list seeded from `inventory_par`. → VERIFIED ALREADY IMPLEMENTED (no new code).**
- Reality (verified 2026-06-18): the par-seeded standing count sheet already exists and predates this branch. `app/inventory/counts/[id]/page.jsx` (L29-42) loads ALL `inventory_par` rows for the location LEFT JOINed with existing `inventory_count_lines`; `CountSheet.jsx` (L181-272) renders them grouped by category, shows `par_qty`/`par_unit` as a reference band ("par {qty} {unit}"), provides inline on-hand entry that upserts via `/api/inventory/counts/[id]/lines`, flags low-on-hand (orange), surfaces off-list/orphan lines, and has a free-add row. The counts list (`counts/page.jsx`) has StartCountButton + open badge.
- So Phase 3's only required change was T10 (make Counts the default route + move Log). No rebuild — reusing the working solution (AGENTS.md) and avoiding hallucinated/duplicate work.
- Acceptance: met by existing code + T10; existing `tests/js/test-inventory-counts-api.mjs` covers the lines path.

### Phase 4 — Standing prep par

**T12 — `prep_par` table.**
- Files: `lib/db.ts` (DDL in `initSchema`, bump `SCHEMA_VERSION` 1→2, add `assertCriticalSchemas` entry, index), `tests/js/test-schema-migrations.mjs`.
- Approach: add table per D6; `UNIQUE(location_id, station_id, recipe_slug, ingredient)`; index `idx_prep_par_loc_station ON prep_par(location_id, station_id, sort_order)`. Add to assert list + schema test.
- Acceptance: `npm run test:schema` green; version-bump hook satisfied; idempotent init.

**T13 — `/api/prep-par` GET/POST/DELETE.**
- Files: `app/api/prep-par/route.js`, `tests/js/test-prep-par-api.mjs`.
- Approach: mirror `/api/inventory/par` route conventions (location scoping, upsert on POST, DELETE by id). Parameterized SQL.
- Acceptance: API test covers upsert/list/delete + location scoping.

**T14 — `app/prep/par/page.jsx` editable standing par list.**
- Files: `app/prep/par/page.jsx` + small client component, link from `app/prep/page.jsx`, test.
- Approach: editable list (add/edit/delete) over `/api/prep-par`, grouped by station; link from the prep board. Existing task queue untouched.
- Acceptance: page renders/edits standing par rows; reachable from prep board.

## Final
- Whole-branch review (superpowers:requesting-code-review) on the full diff vs `origin/main`.
- Full verification gate: `npm run verify` + `python3 -m pytest tests/python` + `npm run lint`.
- Hand to user for main-merge approval (per goal: "comit to main will be approved by me").

## Dependency order
T1 → T2 → T3 → T4 (Phase 1); T5 → T6 → T7 → T8 → T9 (Phase 2, after T2 scaffold); T10 → T11 (Phase 3); T12 → T13 → T14 (Phase 4). Phases 3 and 4 are independent of 1–2 and of each other.
