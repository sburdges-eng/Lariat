/**
 * Entity layer resolver — Phase 1 of the canonical-entity rollout.
 *
 * Every ingest path (Toast, 7shifts, Prism, Shamrock, Sysco, manual)
 * routes its source-system identifiers through one of the
 * `resolveOrCreate*` helpers below. The helper either:
 *   1. Finds an existing UUID via the external_ids registry, or
 *   2. Creates a new entity row + external_ids row in a single
 *      transaction and returns the new UUID.
 *
 * Either way the caller gets back a stable internal UUID it can write
 * onto the source-system row (vendor_prices.vendor_uuid,
 * sales_lines.menu_item_uuid, etc., as those FKs land in Phase 2).
 *
 * Idempotency: repeat calls with the same (source_system, external_id,
 * location_id, entity_type) bump `last_seen_at` and return the same UUID.
 *
 * Resolver functions are SYNCHRONOUS because better-sqlite3 is synchronous.
 * Callers should wrap multi-resolution batches in a single
 * `db.transaction(...)` for throughput.
 */

import type { Database } from 'better-sqlite3';
import { uuidv7 } from './uuid';

export type EntityType =
  | 'employee'
  | 'vendor'
  | 'menu_item'
  | 'recipe'
  | 'ingredient'
  | 'purchase_order'
  | 'event';

export type SourceSystem =
  | 'toast'
  | '7shifts'
  | 'prism'
  | 'shamrock'
  | 'sysco'
  | 'webstaurant'
  | 'manual';

export interface ResolveResult {
  /** Internal UUID v7 for the entity. */
  uuid: string;
  /** True iff this call created a new entity row (and registry row). */
  created: boolean;
}

interface BaseResolveInput {
  source_system: SourceSystem;
  external_id: string;
  location_id?: string;
  /** Source-specific extras to store on external_ids.metadata_json. */
  metadata?: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function bumpLastSeen(
  db: Database,
  externalIdRow: { id: number; entity_uuid: string },
  metadata?: Record<string, unknown>,
): void {
  if (metadata) {
    db.prepare(
      `UPDATE external_ids
          SET last_seen_at = ?, metadata_json = ?
        WHERE id = ?`,
    ).run(nowIso(), JSON.stringify(metadata), externalIdRow.id);
  } else {
    db.prepare(
      `UPDATE external_ids SET last_seen_at = ? WHERE id = ?`,
    ).run(nowIso(), externalIdRow.id);
  }
}

function findExistingMapping(
  db: Database,
  entity_type: EntityType,
  source_system: SourceSystem,
  external_id: string,
  location_id: string,
): { id: number; entity_uuid: string } | null {
  return db
    .prepare(
      `SELECT id, entity_uuid FROM external_ids
        WHERE entity_type = ? AND source_system = ?
          AND external_id = ? AND location_id = ?
        LIMIT 1`,
    )
    .get(entity_type, source_system, external_id, location_id) as
    | { id: number; entity_uuid: string }
    | null
    || null;
}

function insertExternalId(
  db: Database,
  entity_type: EntityType,
  entity_uuid: string,
  source_system: SourceSystem,
  external_id: string,
  location_id: string,
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO external_ids
       (entity_type, entity_uuid, source_system, external_id, location_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entity_type,
    entity_uuid,
    source_system,
    external_id,
    location_id,
    metadata ? JSON.stringify(metadata) : null,
  );
}

// ── Employees ──────────────────────────────────────────────────────

export interface ResolveEmployeeInput extends BaseResolveInput {
  display_name: string;
  primary_email?: string | null;
  primary_phone?: string | null;
}

/**
 * Resolve a (source, external_id) tuple to an employee UUID. Creates the
 * employee + registry row if absent. Re-running with the same input is a
 * no-op aside from a `last_seen_at` bump.
 *
 * NOTE: this does NOT merge two employee records that turn out to be the
 * same person across sources (Toast `chosen_name='Sarah'` vs
 * 7shifts `user_id=4729`). That's the entity-resolution problem and
 * lives in a follow-up. Phase 1 keeps a 1:1 mapping per source row.
 */
export function resolveOrCreateEmployee(
  db: Database,
  input: ResolveEmployeeInput,
): ResolveResult {
  const location_id = input.location_id ?? 'default';
  return db.transaction((): ResolveResult => {
    const existing = findExistingMapping(
      db, 'employee', input.source_system, input.external_id, location_id,
    );
    if (existing) {
      bumpLastSeen(db, existing, input.metadata);
      return { uuid: existing.entity_uuid, created: false };
    }
    const uuid = uuidv7();
    db.prepare(
      `INSERT INTO entities_employees
         (uuid, display_name, primary_email, primary_phone)
       VALUES (?, ?, ?, ?)`,
    ).run(uuid, input.display_name, input.primary_email ?? null, input.primary_phone ?? null);
    insertExternalId(
      db, 'employee', uuid, input.source_system, input.external_id, location_id, input.metadata,
    );
    return { uuid, created: true };
  })();
}

// ── Vendors ────────────────────────────────────────────────────────

export interface ResolveVendorInput extends BaseResolveInput {
  display_name: string;
  category?: string | null;
}

export function resolveOrCreateVendor(
  db: Database,
  input: ResolveVendorInput,
): ResolveResult {
  const location_id = input.location_id ?? 'default';
  return db.transaction((): ResolveResult => {
    const existing = findExistingMapping(
      db, 'vendor', input.source_system, input.external_id, location_id,
    );
    if (existing) {
      bumpLastSeen(db, existing, input.metadata);
      return { uuid: existing.entity_uuid, created: false };
    }
    const uuid = uuidv7();
    db.prepare(
      `INSERT INTO entities_vendors (uuid, display_name, category)
       VALUES (?, ?, ?)`,
    ).run(uuid, input.display_name, input.category ?? null);
    insertExternalId(
      db, 'vendor', uuid, input.source_system, input.external_id, location_id, input.metadata,
    );
    return { uuid, created: true };
  })();
}

// ── Menu items ─────────────────────────────────────────────────────

export interface ResolveMenuItemInput extends BaseResolveInput {
  display_name: string;
  category?: string | null;
  base_price?: number | null;
}

export function resolveOrCreateMenuItem(
  db: Database,
  input: ResolveMenuItemInput,
): ResolveResult {
  const location_id = input.location_id ?? 'default';
  return db.transaction((): ResolveResult => {
    const existing = findExistingMapping(
      db, 'menu_item', input.source_system, input.external_id, location_id,
    );
    if (existing) {
      bumpLastSeen(db, existing, input.metadata);
      return { uuid: existing.entity_uuid, created: false };
    }
    const uuid = uuidv7();
    db.prepare(
      `INSERT INTO entities_menu_items
         (uuid, display_name, category, base_price, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      uuid,
      input.display_name,
      input.category ?? null,
      input.base_price ?? null,
      location_id,
    );
    insertExternalId(
      db, 'menu_item', uuid, input.source_system, input.external_id, location_id, input.metadata,
    );
    return { uuid, created: true };
  })();
}

// ── Recipes ────────────────────────────────────────────────────────

export interface ResolveRecipeInput extends BaseResolveInput {
  slug: string;
  display_name: string;
  yield_qty?: number | null;
  yield_unit?: string | null;
  category?: string | null;
}

/**
 * Recipes are unusual: the canonical "external" id used by recipes.json
 * and bom_lines today IS the slug itself. Pass `source_system: 'manual'`
 * with `external_id = slug` for that case. Toast → recipe mappings (when
 * we wire them) use `source_system: 'toast'` with the Toast guid.
 *
 * The slug column on entities_recipes carries the same value as
 * external_id when source='manual' so existing slug-based code paths
 * (recipes.json, bom_lines.recipe_id) keep working through Phase 2.
 */
export function resolveOrCreateRecipe(
  db: Database,
  input: ResolveRecipeInput,
): ResolveResult {
  const location_id = input.location_id ?? 'default';
  return db.transaction((): ResolveResult => {
    const existing = findExistingMapping(
      db, 'recipe', input.source_system, input.external_id, location_id,
    );
    if (existing) {
      bumpLastSeen(db, existing, input.metadata);
      return { uuid: existing.entity_uuid, created: false };
    }
    // If a recipe with the same (slug, location_id) already exists from
    // another source, link to it instead of creating a duplicate.
    const bySlug = db
      .prepare(
        `SELECT uuid FROM entities_recipes WHERE slug = ? AND location_id = ?`,
      )
      .get(input.slug, location_id) as { uuid: string } | undefined;
    const uuid = bySlug?.uuid ?? uuidv7();
    if (!bySlug) {
      db.prepare(
        `INSERT INTO entities_recipes
           (uuid, slug, display_name, yield_qty, yield_unit, category, location_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uuid,
        input.slug,
        input.display_name,
        input.yield_qty ?? null,
        input.yield_unit ?? null,
        input.category ?? null,
        location_id,
      );
    }
    insertExternalId(
      db, 'recipe', uuid, input.source_system, input.external_id, location_id, input.metadata,
    );
    return { uuid, created: !bySlug };
  })();
}

// ── Ingredients ────────────────────────────────────────────────────

export interface ResolveIngredientInput extends BaseResolveInput {
  ingredient_key: string;
  display_name: string;
  category?: string | null;
  default_unit?: string | null;
}

/**
 * Ingredients are global (not per-location) since `ingredient_key` is the
 * normalized join key already used across sites in vendor_prices,
 * bom_lines, ingredient_densities. The location_id on external_ids still
 * lets a Sysco SKU at site A and the same SKU at site B coexist, both
 * pointing at the same ingredient UUID.
 */
export function resolveOrCreateIngredient(
  db: Database,
  input: ResolveIngredientInput,
): ResolveResult {
  const location_id = input.location_id ?? 'default';
  return db.transaction((): ResolveResult => {
    const existing = findExistingMapping(
      db, 'ingredient', input.source_system, input.external_id, location_id,
    );
    if (existing) {
      bumpLastSeen(db, existing, input.metadata);
      return { uuid: existing.entity_uuid, created: false };
    }
    const byKey = db
      .prepare(`SELECT uuid FROM entities_ingredients WHERE ingredient_key = ?`)
      .get(input.ingredient_key) as { uuid: string } | undefined;
    const uuid = byKey?.uuid ?? uuidv7();
    if (!byKey) {
      db.prepare(
        `INSERT INTO entities_ingredients
           (uuid, display_name, ingredient_key, category, default_unit)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        uuid,
        input.display_name,
        input.ingredient_key,
        input.category ?? null,
        input.default_unit ?? null,
      );
    }
    insertExternalId(
      db, 'ingredient', uuid, input.source_system, input.external_id, location_id, input.metadata,
    );
    return { uuid, created: !byKey };
  })();
}

// ── Events ─────────────────────────────────────────────────────────

export interface ResolveEventInput extends BaseResolveInput {
  display_name: string;
  event_date?: string | null;
  event_time?: string | null;
  venue?: string | null;
  headliner?: string | null;
  guest_count?: number | null;
  status?: 'planned' | 'confirmed' | 'cancelled' | 'completed';
}

export function resolveOrCreateEvent(
  db: Database,
  input: ResolveEventInput,
): ResolveResult {
  const location_id = input.location_id ?? 'default';
  return db.transaction((): ResolveResult => {
    const existing = findExistingMapping(
      db, 'event', input.source_system, input.external_id, location_id,
    );
    if (existing) {
      bumpLastSeen(db, existing, input.metadata);
      return { uuid: existing.entity_uuid, created: false };
    }
    const uuid = uuidv7();
    db.prepare(
      `INSERT INTO entities_events
         (uuid, display_name, event_date, event_time, venue,
          headliner, guest_count, status, location_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uuid,
      input.display_name,
      input.event_date ?? null,
      input.event_time ?? null,
      input.venue ?? null,
      input.headliner ?? null,
      input.guest_count ?? null,
      input.status ?? 'planned',
      location_id,
    );
    insertExternalId(
      db, 'event', uuid, input.source_system, input.external_id, location_id, input.metadata,
    );
    return { uuid, created: true };
  })();
}

// ── Lookups ────────────────────────────────────────────────────────

/**
 * Look up an entity UUID by (source_system, external_id, location_id,
 * entity_type) without creating anything. Returns null when absent.
 */
export function lookupEntityUuid(
  db: Database,
  entity_type: EntityType,
  source_system: SourceSystem,
  external_id: string,
  location_id = 'default',
): string | null {
  const row = db
    .prepare(
      `SELECT entity_uuid FROM external_ids
        WHERE entity_type = ? AND source_system = ?
          AND external_id = ? AND location_id = ?
        LIMIT 1`,
    )
    .get(entity_type, source_system, external_id, location_id) as
    | { entity_uuid: string }
    | undefined;
  return row?.entity_uuid ?? null;
}

/** All external-id rows pointing at this UUID. */
export function listExternalIdsForEntity(
  db: Database,
  entity_uuid: string,
): Array<{
  source_system: string;
  external_id: string;
  location_id: string;
  entity_type: string;
  first_seen_at: string;
  last_seen_at: string;
}> {
  return db
    .prepare(
      `SELECT source_system, external_id, location_id, entity_type,
              first_seen_at, last_seen_at
         FROM external_ids
        WHERE entity_uuid = ?
        ORDER BY first_seen_at`,
    )
    .all(entity_uuid) as Array<{
      source_system: string;
      external_id: string;
      location_id: string;
      entity_type: string;
      first_seen_at: string;
      last_seen_at: string;
    }>;
}
