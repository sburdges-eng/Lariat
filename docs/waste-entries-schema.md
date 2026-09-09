# `waste_entries` — proposed schema

**Status:** LANDED 2026-09-09. The three blocks below are the schema as
shipped, kept here for the reasoning behind each decision.

Applying it also required two things this proposal did not anticipate:
`SCHEMA_VERSION` 6 → 7 (`scripts/check-schema-version-bump.mjs` enforces a bump
on any DDL change), and the native side — `SchemaMigrator.webSchemaVersion`
6 → 7 plus regenerated parity fixtures, because
`SchemaMigratorTests.testFreshSchemaMatchesWebBaseline` compares web and native
schemas in **both** directions and fails on a table the web has and native
does not.

Nothing reads or writes the table yet. The `/inventory/waste` page and the
command-center rollup still write `inventory_updates` with
`direction='waste'`; cutting them over is follow-up work.

Backs **SOP 12 · Waste Logging** (`04_Kitchen Operations/SOP Binder/`). Replaces
the interim plan of writing waste into `inventory_updates` with
`direction: 'waste'`.

---

## Why a table and not a `direction` on `inventory_updates`

`inventory_updates` records a *movement* — a count went up or down. Waste is a
movement plus four things that table has nowhere to put:

1. **A reason, from a closed set.** SPOIL / OVERPREP / ERROR / EVENT. A free-text
   `note` cannot be grouped, and grouping is the entire point.
2. **A unit.** Portions, pounds and pans are not interchangeable. `delta TEXT`
   with no unit column makes the numbers unaddable.
3. **A cost at the moment it happened.** Recipe costs move. A pan thrown away in
   March costed against September's price is a wrong number presented
   confidently.
4. **Which thing was thrown away.** Waste happens at three levels — a raw
   ingredient, a prepped recipe, a finished plate — and each is costed from a
   different table.

## Why the identity columns are soft references, not foreign keys

`master_id`, `recipe_id` and `menu_item_uuid` are plain `TEXT`, deliberately.

A hard `REFERENCES` would mean **you cannot log waste for an item that is not
costed yet** — and only 19 recipes are costed today. The log would reject the
majority of real entries on day one, cooks would stop trying, and the data would
never exist. The join is done at read time and tolerates a miss.

This follows the existing style: `eighty_six` and `inventory_updates` both carry
soft ids for the same reason.

## Why `entered_during` exists

SOP 12 currently says *log at the moment of discard*, with the close-down sweep
as the exception. **That rule is a guess, and this column is how it gets tested.**

Every row records whether it was entered during service or at close. After a
month:

- If `close` entries dominate on high-cover nights, the at-discard rule is not
  survivable and the sweep becomes the honest standard.
- If `service` entries hold up, the rule stays and the exception stays narrow.

The log measures its own rule. Nobody has to argue about it from memory.

---

## Block 1 — `lib/db/schema/core.ts`

Add inside the existing `db.exec` template, after the `inventory_updates` block:

```sql
CREATE TABLE IF NOT EXISTS waste_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_date TEXT NOT NULL,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  station_id TEXT,

  -- what was thrown away, at whichever level applies
  item TEXT NOT NULL,
  master_id TEXT,                    -- ingredient_masters.master_id, soft ref
  recipe_id TEXT,                    -- recipe_costs.recipe_id, soft ref
  menu_item_uuid TEXT,               -- entities_menu_items.uuid, soft ref

  -- how much, in a unit that is fixed per item
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit TEXT NOT NULL CHECK(unit IN ('portion','lb','oz','each','pan','qt')),

  -- why, from the closed set in SOP 12
  reason TEXT NOT NULL CHECK(reason IN ('SPOIL','OVERPREP','ERROR','EVENT')),
  note TEXT,
  event_name TEXT,                   -- required when reason = 'EVENT' (SOP 16)

  -- cost snapshot AT LOG TIME, never recomputed
  unit_cost REAL,
  extended_cost REAL,
  cost_source TEXT CHECK(cost_source IN ('recipe_costs','vendor_prices','manual')),

  -- the instrument that tests SOP 12's own timing rule
  entered_during TEXT CHECK(entered_during IN ('service','close')),

  cook_id TEXT,
  sync_source_host TEXT,
  sync_source_started_at TEXT,
  sync_source_pk TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  location_id TEXT NOT NULL DEFAULT 'default'
);
```

## Block 2 — `lib/db/migrations.ts`, inside `ensureIndexes`

```sql
CREATE INDEX IF NOT EXISTS idx_waste_loc_date ON waste_entries(location_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_waste_reason ON waste_entries(location_id, reason, shift_date);
CREATE INDEX IF NOT EXISTS idx_waste_item ON waste_entries(item, location_id);
CREATE INDEX IF NOT EXISTS idx_waste_recipe ON waste_entries(recipe_id) WHERE recipe_id IS NOT NULL;
```

## Block 3 — `lib/db/types.ts`

```ts
export interface WasteEntryRow {
  id: number;
  shift_date: string;              // 'YYYY-MM-DD'
  logged_at: string;
  station_id: string | null;

  item: string;
  master_id: string | null;
  recipe_id: string | null;
  menu_item_uuid: string | null;

  quantity: number;
  unit: 'portion' | 'lb' | 'oz' | 'each' | 'pan' | 'qt';

  reason: 'SPOIL' | 'OVERPREP' | 'ERROR' | 'EVENT';
  note: string | null;
  event_name: string | null;       // set when reason === 'EVENT'

  unit_cost: number | null;        // snapshot, never recomputed
  extended_cost: number | null;    // quantity * unit_cost at log time
  cost_source: 'recipe_costs' | 'vendor_prices' | 'manual' | null;

  entered_during: 'service' | 'close' | null;

  cook_id: string | null;
  created_at: string;
  location_id: string;
}
```

---

## The two questions it is built to answer

**What did we throw away last week and what did it cost?**

```sql
SELECT reason, ROUND(SUM(extended_cost), 2) AS cost, COUNT(*) AS entries
  FROM waste_entries
 WHERE location_id = 'default'
   AND shift_date >= date('now', '-7 days')
 GROUP BY reason
 ORDER BY cost DESC;
```

**Is SOP 12's timing rule survivable on a busy night?**

```sql
SELECT w.shift_date,
       SUM(w.entered_during = 'service') AS at_discard,
       SUM(w.entered_during = 'close')   AS at_close,
       t.guests
  FROM waste_entries w
  LEFT JOIN toast_sales_daily t
         ON t.business_date = w.shift_date
 WHERE w.shift_date >= date('now', '-30 days')
 GROUP BY w.shift_date
 ORDER BY t.guests DESC;
```

If the top of that list is all `at_close`, the rule changes and SOP 12 gets one
sentence rewritten.
