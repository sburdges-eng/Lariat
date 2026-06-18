# Spec — BEO cascade overrides (Phase 2 override schema + persistence)

Status: design. Write this before building the cascade-override UI. Builds on the shipped Phase 2 cascade (read-only): `lib/beoCascade.ts`, `GET /api/beo/cascade?event_id=N`, and the Order-guide / Prep tabs in `BeoBoard`.

## Goal

Let a manager adjust the computed cascade per row — bump/cut an order-guide buy quantity, exclude a line, or change a prep target for one event — **without mutating the deterministic cascade engine and without losing the computed baseline**. Overrides are per-event, persistent, and always shown alongside the computed value (never silently replace it).

## Non-goals

- No change to `scripts/beo_cascade_cli.py` / `bom_expand` / `beo_pull` — the engine stays pure and deterministic.
- No global/standing overrides — these are scoped to one BEO event. (Standing targets are `prep_par`, a separate surface.)
- No vendor/pack-size rounding logic here (future).

## What is overridable

The cascade returns two row sets (current shapes from `lib/beoCascade.ts`):
- **order guide row:** `{ ingredient, unit, total_needed, on_hand, to_order }`
- **prep demand row:** `{ recipe_slug, display_name, qty, unit }`

Override operations per row:
| Kind | Row identity | Overridable | Semantics |
|------|--------------|-------------|-----------|
| `order_guide` | `ingredient` + `unit` | `override_to_order` (number), `excluded` (bool) | replaces the displayed buy qty / drops the line from the buy list |
| `prep` | `recipe_slug` + `unit` | `override_qty` (number), `excluded` (bool) | replaces the prep target qty / drops the prep line |

`on_hand` override is out of scope for v1 (on-hand wiring itself is deferred); revisit when inventory on-hand feeds the cascade.

## Schema (new table — follows the `prep_par` / `inventory_par` conventions)

```sql
CREATE TABLE IF NOT EXISTS beo_cascade_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  location_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('order_guide','prep')),
  -- row identity: ingredient (order_guide) OR recipe_slug (prep), plus unit
  row_key TEXT NOT NULL,            -- ingredient name OR recipe_slug
  unit TEXT NOT NULL DEFAULT '',
  override_qty REAL,                -- null = no qty override (only excluded set)
  excluded INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0,1)),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, kind, row_key, unit),
  FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_beo_cascade_overrides_event
  ON beo_cascade_overrides(event_id, kind);
```
Notes: `NOT NULL DEFAULT ''` on `unit` + the 4-col `UNIQUE` make the key meaningful (same SQLite-NULL gotcha handled in `prep_par`). `ON DELETE CASCADE` cleans up when an event is deleted. Requires `SCHEMA_VERSION` bump (currently 2 on the BEO branch → 3) + `assertCriticalSchemas` entry + `test-schema-migrations.mjs` coverage (per the schema-change convention).

## Persistence + application

- **Compute then overlay.** The cascade engine produces the baseline rows. Overrides are applied at READ time in the API layer — never written back into the engine output cache.
- Extend `GET /api/beo/cascade?event_id=N`: after `cascadeFromLineItems`, load `beo_cascade_overrides` for the event and annotate each row:
  - order guide row → add `{ override_to_order, excluded, overridden: bool }`; `display_to_order = excluded ? 0 : (override_to_order ?? to_order)`.
  - prep row → add `{ override_qty, excluded, overridden: bool }`; `display_qty = excluded ? 0 : (override_qty ?? qty)`.
  - Keep `total_needed`/`to_order`/`qty` (the computed baseline) in the payload so the UI shows both.
  - Overrides whose `row_key` no longer matches any computed row are returned in a `stale_overrides: [...]` array (no silent drops — the row may have disappeared because a line item changed; surface it so the manager can clear it).
- **Write path:** new route `PUT/DELETE /api/beo/cascade/overrides` (or `POST` upsert + `DELETE`), mirroring `/api/prep-par` conventions (location scoping via the event, `withIdempotency`, `postAuditEvent` with `entity: 'beo_cascade_overrides'`). Body: `{ event_id, kind, row_key, unit, override_qty?, excluded?, note?, location_id, cook_id }`. Upsert keyed on the UNIQUE tuple; validate the event belongs to the location (404 on mismatch, like the cascade route).

## UI (Order guide / Prep tabs)

- Each row gets an inline editable qty field (defaulting to the computed value) + an exclude toggle. On change → upsert override → refetch cascade.
- Visual: when `overridden`, show the computed baseline struck/greyed next to the override (e.g. `~~10 lb~~ → 8 lb`); excluded rows render dimmed with a restore action.
- A `stale_overrides` banner (reuse the `UnmappedCallout` pattern) listing overrides that no longer map to a computed row, each with a clear-it action.
- Overrides never hide the unmapped/error callouts already shipped.

## Open decisions (resolve before build)

1. Order-guide identity: use raw `ingredient` string (as the engine emits) for `row_key`, or a normalized key? Recommend raw to match the cascade output exactly; revisit if ingredient names drift.
2. Whether excluding a prep line should also subtract its leaves from the order guide (coupled) or stay independent (v1: independent — simpler, predictable).
3. Audit granularity: one audit event per upsert (recommended) vs batched.

## Test plan (when built)

- Schema test for `beo_cascade_overrides` (table/columns/UNIQUE/CHECK/index + version bump).
- Override route: upsert/delete, location scoping, 404 on cross-location event.
- Cascade route: baseline preserved; override_qty/excluded applied to `display_*`; `stale_overrides` surfaced when an override's row_key has no matching computed row.
- UI: edit → upsert → refetch shows override; exclude dims row; stale banner renders.
