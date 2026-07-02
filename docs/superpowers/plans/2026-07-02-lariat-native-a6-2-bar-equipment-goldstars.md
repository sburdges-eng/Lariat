# LariatNative A6.2 — bar, equipment, gold-stars

Wave: A6.2 · Branch: `feat/lariat-native-a6-2-bar` · Worktree: `worktrees/a6-2-bar`

## Gap-audit (web sources are the spec)

### bar — `app/bar/page.jsx` + `app/bar/par/page.jsx`
Both are **server components** — no `app/api/bar` routes exist; no fetches to trace.
Entirely **read-only**; no writes, no audit events, no PIN (`/bar` is not in
middleware `SENSITIVE_PREFIXES`).

- `/bar` (pour-cost dashboard):
  - Reads `data/cache/recipes.json` (`getRecipes()`) + `recipe_costs` (one
    query per location) and joins in memory.
  - Bar-recipe filter (permissive OR): category regex
    `/cocktail|drink|beverage|spirit|liquor/i`, slug prefix `cocktail_` /
    `drink_`, or any object `menu_items[]` entry with numeric `price > 0`.
  - `firstMenuPrice`: FIRST object menu_item with numeric price > 0 →
    `{name, price, size_oz}`. String entries (current data shape) → null.
  - `computePourCost`: `yield_unit=='oz'` → `cpu × pourOz` where pourOz =
    menu `size_oz` (if finite > 0) else recipe yield (if finite > 0) else
    null; `'each'` → `cpu`; other units → null (not portionable).
  - Thresholds (authoritative): green ≤ 18 %, yellow 18–22 %, red > 22 %,
    gray = no pct. Gray reason: no cost row → "add recipe cost";
    cost_per_pour null → "yield not portionable"; else "add menu price".
  - Sort: tone rank (red 0 < yellow 1 < green 2 < gray 3), then pct DESC
    (null → −∞). Counts card per tone.
  - Production data today has ZERO bar recipes → page renders empty state.
- `/bar/par` (read-only bar-scoped par list):
  - Same latest-count LEFT JOIN as `/inventory/par` with
    `p.category IS NOT NULL AND lower(p.category) IN` `['beer','wine',
    'liquor','spirit','cocktail','bar','beverage']` (parameterized).
  - `low` = `par_qty != null && on_hand_qty != null && on_hand < par`.
  - Group by category (name asc); "All (n)" / "Low (n)" filter.
  - Intentionally read-only (adds happen on /inventory/par).

Oracles: none in tests/js for bar (`test-bar*` does not exist). Native tests
are authored against the page code (documented per test).

### equipment — `app/equipment/*` + 4 routes `app/api/equipment{,/maintenance,/parts,/schedule}`
- Reads (all location-scoped, `?location`/`?location_id` alias):
  - equipment + `COALESCE(SUM(maintenance.cost),0) AS maintenance_cost`,
    ORDER BY category, name.
  - parts / schedule / maintenance with optional `equipment_id` filter;
    orders: `equipment_id, part_number` / `equipment_id,
    COALESCE(next_due,'9999-12-31')` / `service_date DESC, id DESC`.
- Writes — **NO audit events, NO PIN** (open surface; `withIdempotency`
  wrapper exists on web but native ports NO idempotency — divergence
  asserted by test):
  - POST /api/equipment: `name` required (400). Clips: name 200, category
    60 → default 'Uncategorized', make_model/model_number/serial/vendor/
    vendor_order_ref/manual_path 500, dates 32, notes 2000, status 32 →
    default 'active'. `purchase_cost` toMoney → REAL (Double).
  - POST maintenance: `equipment_id` positive int + `service_date`
    required (400). type 32 → 'Routine', cost REAL, notes 1000,
    receipt_reference 500, cook_id 64.
  - POST parts: `equipment_id` + `part_number` required (400).
    description/vendor 500, unit_price/qty_on_hand REAL, last_ordered 32,
    last_order_ref 500, notes 2000.
  - POST schedule: `equipment_id` + `task`(500) + `frequency`(60)
    required (400). last_done/next_due 32, notes 2000.
  - FK `equipment_id → equipment(id)` is enforced (web pragma
    `foreign_keys = ON`; native GRDB `foreignKeysEnabled = true`).
- UI derived state: warranty expired / schedule overdue = date < today
  (midnight-local); Maint $ + Capital $ per card; tabs details/parts/
  schedule/log.

Oracles: `tests/js/test-equipment-location-scoping.mjs` — location alias +
trim + default scoping for all four routes (ported as repository
location-scoping tests; the body-alias/query-alias mechanics are
web-transport-specific, natively the repository takes `locationId`).

### gold-stars — `app/gold-stars/*` + `app/api/gold-stars{,/[id]}`
- GET board: today's stars only (`date(created_at,'localtime') =
  date('now','localtime')`), `deleted_at IS NULL`, ORDER BY id DESC LIMIT 50.
- GET `?view=leaderboard`: `SUM(stars) total_stars, COUNT(*) awards,
  MAX(awarded_date) last_awarded` GROUP BY cook_name ORDER BY total_stars
  DESC, cook_name ASC; excludes soft-deleted.
- POST (award) — **requirePin** on web: cook_name + reason required
  (400 'Cook and reason needed'); stars clamped
  `min(max(Number(stars)||1,1),3)`; transaction: INSERT + audit
  `entity='gold_stars', action='insert'` (web actor_source `'api'`,
  actor_cook_id null).
- DELETE [id] — **requirePin**: invalid id → 400; row missing / wrong
  location / already deleted → 404 (**no idempotency** — second delete is
  404; divergence asserted); transaction: soft delete
  (`deleted_at=datetime('now'), deleted_by='manager_pin'`) + audit
  `action='delete'` payload {cook_name, reason, stars, awarded_date}
  (web actor_source `'manager_pin'`).
- Roster comes from `/api/staff` (active members, `first last`).

Oracles: `tests/js/test-gold-stars-api.mjs` — un-PIN'd POST writes nothing;
PIN'd POST writes row + 1 audit row; board hides yesterday + soft-deleted;
leaderboard aggregates across days, tie broken by name ASC, carries
last_awarded; soft-deleted rows leave the leaderboard. All ported.

## Native design

### Tier choice (documented)
The web sidebar groups gold-stars under "Service" and bar/equipment under the
"Books" shelf — no native tier exists for any of them, and the parallel A6.1
wave already claimed `.foh` ("Front of house"). Following the tier-per-wave
precedent, A6.2 registers a new **`.house` ("House")** tier — venue-program
boards that are neither kitchen production nor compliance:

- `house.bar` — "Bar program" (pour costs; cross-link to bar par)
- `house.barPar` — "Bar par" (read-only)
- `house.equipment` — "Equipment"
- `house.goldStars` — "Gold stars"

New group file `HouseFeatures.swift`; one descriptor each in
`FeatureCatalog.all`; four lines in `FeatureRegistry.all`; registry tests
extended with an exact-set `.house` assertion.

### Layers
- LariatModel: `BarRecords` + `Compute/BarCompute` (pour-cost math,
  thresholds, tones, sort, counts, bar-recipe filter, menu-price pick;
  `BarRecipeLoader` file I/O follows the `DishBridgeRecipeLoader`
  precedent), `EquipmentRecords` + `Compute/EquipmentCompute` (overdue /
  warranty-expired), `GoldStarRecords` + `Compute/GoldStarCompute`
  (star clamp).
- LariatDB: `BarRepository` (reads only), `EquipmentRepository` (reads +
  4 transactional NON-audited writes — posture pinned by test, mirroring
  the DishComponents precedent), `GoldStarsRepository` (reads + 2
  PIN-gated audited writes via AuditedWriteRunner/AuditEventWriter).
- LariatApp: `BarView(+VM)`, `BarParView(+VM)`, `EquipmentView(+VM)`,
  `GoldStarsView(+VM)`; 3–5 s poll, LariatTheme, EmptyState, labeled
  ProgressView, `.searchable` on lists; gold-stars writes gated by
  `PinEntrySheet` + `ManagementWrite.requireSession` (native analog of
  requirePin).

### Conventions
- actor_source: `native_cook` for equipment writes (open surface — but no
  audit rows at all, so this only shapes RegulatedWriteContext);
  `native_mac` for gold-stars writes (requirePin on web ⇒ PIN-gated
  native). Documented divergences: web audit actor_source is `'api'`
  (POST) / `'manager_pin'` (DELETE) — native uses the program-wide
  `native_mac` convention; native passes the PIN user id as
  actor_cook_id where web sends null (richer, consistent with A5).
  The `gold_stars.deleted_by` COLUMN keeps the web literal
  `'manager_pin'` (row parity).
- Money: all money columns here are REAL (`purchase_cost`, `cost`,
  `unit_price`, `recipe_costs.*`) → Swift `Double`. `gold_stars.stars`
  is INTEGER count (not money) → `Int`.
- No migrations; test fixtures CREATE the real lib/db.ts schemas
  (incl. `audit_events`). Never touch data/lariat.db.
- No idempotency; typed WriteErrors thrown BEFORE any write, all
  `LocalizedError` so `WriteErrorMapper`'s fallback maps them (that file
  is out of scope for edits).

### Out of scope / edge-blockers
- `/api/staff` roster: native reads `data/cache/staff.json` directly via
  the existing `StaffCatalog` (display-name title-casing is a cosmetic
  divergence from the web's raw `first last` concatenation — noted).
- Equipment `manual_path` links open files/URLs; the web serves
  `/{manual_path}` over HTTP — public-URL surface → edge-blocker note,
  native renders the path as text.
- Web `withIdempotency` (Idempotency-Key header) — transport-level,
  deliberately not ported (program decision; divergence asserted in
  tests by observing duplicate inserts create duplicate rows).
