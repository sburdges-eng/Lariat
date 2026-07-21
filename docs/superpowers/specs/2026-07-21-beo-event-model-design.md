# BEO event-model schema wave — design

**Date:** 2026-07-21 · **Branch:** `feat/beo-event-model` · **Status:** DRAFT
**Origin:** `docs/beo-native-parity-audit-2026-07-21.md` Tier 1 #1 — the one shared
schema decision that gates staffing math (#10), margin math (#11), fill-to-minimum
invoice math (#2 gap), bar forecast (#12), and Library badges (#8). Owner said:
"tackle schema alone" — this wave is the data-model foundation ONLY.

## Goal

Give `beo_events` the fields Studio 5 (`docs/Lariat_BEO_Studio_5.html`) treats as
first-class, plus child tables for AV/production charges, additional fees, and
run-of-show — web-first (web owns schema pre-flip), keeping every native gate green.
No dependent math, no UI, no native Records/Repository consumption (those are the
next waves).

## Schema changes (lib/db.ts)

### `beo_events` — six new nullable columns (migrateLegacyColumns pattern)

| column | type | meaning | validation (route-level, house style: no CHECKs in DDL) |
|---|---|---|---|
| `space` | TEXT | room/space name | clip(120) |
| `service_style` | TEXT | `passed` \| `buffet` \| `plated` | enum, else 400 |
| `service_hours` | REAL | service window length | finite \> 0, else 400 |
| `bar_mode` | TEXT | `fill` \| `fixed` (NULL = no bar plan) | enum, else 400 |
| `bar_amount` | REAL | fixed-tab $ (or fill cap later) | finite ≥ 0, else 400 |
| `bar_notes` | TEXT | bar plan notes | clip(500) |

All nullable, no defaults — absent = "not planned yet" (min_spend precedent).
All six are **clearable** on update via the provided-flag CASE pattern
(min_spend precedent), not COALESCE.

### New table `beo_event_charges` — AV/production + additional fees

One table, `kind` discriminator — Studio 5's `av[]` and `fees[]` share an
identical `{item, charge, cost}` shape; two tables would duplicate everything.

```sql
CREATE TABLE IF NOT EXISTS beo_event_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- 'av' | 'fee' (route-validated)
  item_name TEXT NOT NULL,
  charge REAL NOT NULL DEFAULT 0,  -- billed to client
  cost REAL NOT NULL DEFAULT 0,    -- house cost (margin math later)
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_beo_charges_ev ON beo_event_charges(event_id);
```

The charge-vs-cost split is the point — the audit flagged that shoehorning AV/fees
into `beo_line_items` (unit_cost only) loses it.

### New table `beo_run_of_show` — Studio 5 `soe[]` `{t, what}`

```sql
CREATE TABLE IF NOT EXISTS beo_run_of_show (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  show_time TEXT,                  -- clock string, operator-typed
  note TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_beo_soe_ev ON beo_run_of_show(event_id);
```

No `location_id` on either child table — scoped through the event join
(`beo_line_items` precedent; every route verifies the parent event's location).

`SCHEMA_VERSION` 4 → 5 (sick-note precedent: additive DDL waves bump it).

## API changes (app/api/beo/route.js)

- `action: 'event'` — accept the six new fields with the validations above.
- `action: 'update_event'` — partial-patch; all six use the provided-flag CASE
  (present → set, including explicit NULL to clear; omitted → preserve).
- New actions, mirroring the line/update_line/delete_line handlers exactly
  (PIN gate via existing checkPostGate, location check through parent event,
  postAuditEvent per write):
  - `charge` / `update_charge` / `delete_charge` (entity `beo_event_charges`)
  - `soe` / `update_soe` / `delete_soe` (entity `beo_run_of_show`)
- GET event detail — include the new event fields plus `charges` and
  `run_of_show` arrays (sort_order, id ASC).

## Cloud-bridge / protected-surface analysis (checked, no action)

`beo_events` is on `ALLOWED_TABLES` with `TABLE_WIRE_VERSION.beo_events: 1` —
but **no production code enqueues rows yet** (the push producer is still gated
on the owner's native-producer decision), and the golden-envelope fixtures are
generated from fixed literal inputs in
`scripts/gen-cloud-bridge-golden-envelopes.mjs`, not DB reads. New columns
therefore change zero live or golden wire bytes. `TABLE_WIRE_VERSION` stays 1;
the pushed row shape is finalized when the producer lands. New child tables are
NOT added to `ALLOWED_TABLES` (default deny stands).

## Native parity (fixtures only — must land in the same PR, sick-note precedent)

```
node scripts/dump-fresh-schema.mjs --executable > LariatNative/Sources/LariatDB/Resources/frozen_schema.sql
node scripts/dump-fresh-schema.mjs              > LariatNative/Tests/LariatDBTests/Fixtures/web_schema_baseline.sql
node scripts/dump-fresh-schema.mjs --seeds      > LariatNative/Tests/LariatDBTests/Fixtures/web_seed_baseline.txt
node scripts/dump-fresh-schema.mjs --full       > LariatNative/Tests/LariatDBTests/Fixtures/web_full_dump.sql
```

`swift build && swift test` must stay green (SchemaMigratorTests replay the new
frozen schema). No native Records/Repository/View changes in this wave.

## Tests (TDD — written first)

New `tests/js/test-beo-event-model.mjs` (beo-fixtures helper), covering:
1. create event with all six fields → persisted + returned by GET
2. create event without them → all NULL (no accidental defaults)
3. update_event partial-patch: omitted preserves; explicit null clears each
4. enum soft-rejects: bad service_style / bar_mode / kind → 400, nothing written
5. numeric soft-rejects: negative bar_amount, zero/negative service_hours → 400
6. charges CRUD (both kinds) + soe CRUD, incl. audit events emitted
7. ON DELETE CASCADE: deleting an event removes its charges + run_of_show rows
8. location scoping: wrong location_id can't touch another location's event/children

## Out of scope (explicitly deferred to later waves)

Staffing/margin/bar-forecast/invoice math; web UI panels; native
Records/Repository/View consumption; Library badges; Season/Settings; any
`ALLOWED_TABLES` or wire-version change; catering-menu price storage.

## Gates

`npm run` schema check + typecheck + lint + the new/existing beo test suites +
`swift build`/`swift test` (fixture parity) — all green before PR.
