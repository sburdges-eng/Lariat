// Specials sandbox → menu engineering promotion (roadmap 3.6).
//
// A saved special carries a costed `cost_breakdown` — one line per
// ingredient, where `match` is the literal vendor_prices.ingredient
// string the sandbox costing resolved against. Menu engineering costs a
// dish through the dish→cost bridge (lib/dishCostBridge.ts), which reads
// `dish_components` rows and prices vendor_item components against
// vendor_prices / order_guide_items.
//
// Promotion therefore closes the loop with plain rows, no new pipeline:
//   1. Each matched cost_breakdown line becomes a dish_components row
//      (component_type='vendor_item', vendor_ingredient = line.match,
//      qty_per_serving = req_qty / servings, unit = req_unit) under the
//      chosen menu item name.
//   2. One specials_promotions row records the linkage (special_id →
//      menu_item_name) plus which vendor_ingredient rows this promotion
//      owns, so a re-promote refreshes/moves exactly those rows.
//
// Once Toast sales land under the same item name, computeMenuEngineering
// joins sales_lines against the bridge and the promoted dish shows up
// with a real per-serving cost — nothing in lib/menuEngineering.ts needs
// to know promotions exist.
//
// All writes happen inside one transaction together with the
// audit_events row (postAuditEvent enforces in-transaction posting).

import type { Database } from 'better-sqlite3';
import { getDb } from './db.ts';
import { postAuditEvent } from './auditEvents.ts';
import { normalizeDishName } from './dishCostBridge.ts';
import { normalizeIngredientKey } from './ingredientKey.ts';
import { convertQty, normalizeUnit } from './unitConvert.mjs';

/** One cost_breakdown line as produced by lib/computeEngine/sandboxCosting.ts. */
interface CostBreakdownLine {
  item?: string;
  req_qty?: number;
  req_unit?: string;
  match?: string | null;
  cost?: number | null;
  note?: string;
}

export interface PromoteSpecialInput {
  specialId: string;
  locationId: string;
  /** Menu item name to promote under. Defaults to the special's name. */
  menuItemName?: string;
  /** How many servings the cost_breakdown quantities represent. Default 1. */
  servings?: number;
}

export interface PromotedComponent {
  vendor_ingredient: string;
  qty_per_serving: number;
  unit: string;
}

export interface SkippedComponent {
  item: string;
  reason: 'unmatched' | 'invalid_qty' | 'unit_conflict';
}

export interface PromotionRecord {
  id: number;
  special_id: string;
  location_id: string;
  menu_item_name: string;
  servings: number;
  components_json: string;
  promoted_at: number;
  updated_at: number;
}

export type PromoteSpecialResult =
  | {
      ok: true;
      promotion: PromotionRecord;
      components: PromotedComponent[];
      skipped: SkippedComponent[];
      repromoted: boolean;
    }
  | { ok: false; error: 'not_found' | 'archived' | 'no_costable_components' };

interface SpecialRow {
  id: string;
  location_id: string;
  name: string;
  cost_breakdown: string | null;
  archived_at: number | null;
}

function parseBreakdown(raw: string | null): CostBreakdownLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Map cost_breakdown lines to per-serving vendor_item components.
 * Lines without a vendor match (or without a usable qty/unit) are
 * skipped and reported — they can't carry cost into the bridge.
 */
export function componentsFromBreakdown(
  breakdown: CostBreakdownLine[],
  servings: number,
): { components: PromotedComponent[]; skipped: SkippedComponent[] } {
  const components: PromotedComponent[] = [];
  const skipped: SkippedComponent[] = [];
  for (const line of breakdown) {
    const item = typeof line?.item === 'string' ? line.item : '';
    const match = typeof line?.match === 'string' ? line.match.trim() : '';
    if (!match) {
      skipped.push({ item, reason: 'unmatched' });
      continue;
    }
    const qty = Number(line?.req_qty);
    const unit = typeof line?.req_unit === 'string' ? line.req_unit.trim() : '';
    const canonUnit = normalizeUnit(unit);
    if (!Number.isFinite(qty) || qty <= 0 || !canonUnit) {
      skipped.push({ item: item || match, reason: 'invalid_qty' });
      continue;
    }
    const qtyPerServing = qty / servings;
    const key = match.toLowerCase();
    const existing = components.find((c) => c.vendor_ingredient.toLowerCase() === key);
    if (existing) {
      const convertedQty = convertQty(qtyPerServing, canonUnit, existing.unit, null);
      if (convertedQty == null) {
        skipped.push({ item: item || match, reason: 'invalid_qty' });
        continue;
      }
      existing.qty_per_serving += convertedQty;
      continue;
    }
    components.push({
      vendor_ingredient: match,
      qty_per_serving: qtyPerServing,
      unit: canonUnit,
    });
  }
  return { components, skipped };
}

function alignComponentsToVendorPackUnits(
  components: PromotedComponent[],
  skipped: SkippedComponent[],
  locationId: string,
  db: Database,
): PromotedComponent[] {
  const latestVendorPackUnit = db.prepare(
    `SELECT pack_unit
       FROM vendor_prices
      WHERE location_id = ? AND lower(ingredient) = lower(?)
      ORDER BY imported_at DESC, id DESC
      LIMIT 1`,
  );
  const densityForIngredient = db.prepare(
    `SELECT g_per_ml
       FROM ingredient_densities
      WHERE ingredient_key = ?`,
  );

  const aligned: PromotedComponent[] = [];
  for (const component of components) {
    const vendorRow = latestVendorPackUnit.get(locationId, component.vendor_ingredient) as
      | { pack_unit: string | null }
      | undefined;
    const packUnit = normalizeUnit(vendorRow?.pack_unit || '');
    if (!packUnit || packUnit === component.unit) {
      aligned.push(component);
      continue;
    }

    const densityRow = densityForIngredient.get(
      normalizeIngredientKey(component.vendor_ingredient),
    ) as { g_per_ml: number | null } | undefined;
    const convertedQty = convertQty(
      component.qty_per_serving,
      component.unit,
      packUnit,
      densityRow?.g_per_ml ?? null,
    );
    if (convertedQty == null || !Number.isFinite(convertedQty) || convertedQty <= 0) {
      skipped.push({ item: component.vendor_ingredient, reason: 'invalid_qty' });
      continue;
    }

    aligned.push({
      vendor_ingredient: component.vendor_ingredient,
      qty_per_serving: convertedQty,
      unit: packUnit,
    });
  }
  return aligned;
}

function loadPromotion(
  db: Database,
  specialId: string,
  locationId: string,
): PromotionRecord | undefined {
  return db
    .prepare(
      `SELECT * FROM specials_promotions WHERE special_id = ? AND location_id = ?`,
    )
    .get(specialId, locationId) as PromotionRecord | undefined;
}

/** Promotion record for one saved special (or undefined if never promoted). */
export function getPromotionForSpecial(
  specialId: string,
  locationId: string = 'default',
  db: Database = getDb(),
): PromotionRecord | undefined {
  return loadPromotion(db, specialId, locationId);
}

/** All promotion records for a location, keyed by special_id (list-view badge). */
export function getPromotionsByLocation(
  locationId: string = 'default',
  db: Database = getDb(),
): Map<string, PromotionRecord> {
  const rows = db
    .prepare(`SELECT * FROM specials_promotions WHERE location_id = ?`)
    .all(locationId) as PromotionRecord[];
  return new Map(rows.map((r) => [r.special_id, r]));
}

/**
 * Promote a saved special onto the menu-engineering cost surface.
 *
 * Transactional and idempotent: re-promoting the same special refreshes
 * the dish_components rows this promotion owns (deleting the previous
 * set first, so a renamed menu item doesn't leave orphans behind) and
 * updates the promotion record in place.
 */
export function promoteSpecialToMenu(
  input: PromoteSpecialInput,
  db: Database = getDb(),
): PromoteSpecialResult {
  const { specialId, locationId } = input;
  const special = db
    .prepare(
      `SELECT id, location_id, name, cost_breakdown, archived_at
         FROM specials WHERE id = ? AND location_id = ?`,
    )
    .get(specialId, locationId) as SpecialRow | undefined;
  if (!special) return { ok: false, error: 'not_found' };
  if (special.archived_at !== null) return { ok: false, error: 'archived' };

  const servings =
    typeof input.servings === 'number' && Number.isFinite(input.servings) && input.servings > 0
      ? input.servings
      : 1;
  const menuItemName = (input.menuItemName ?? special.name).trim();
  const canonicalMenuItemName = normalizeDishName(menuItemName);

  const breakdown = parseBreakdown(special.cost_breakdown);
  const { components: rawComponents, skipped } = componentsFromBreakdown(breakdown, servings);
  const components = alignComponentsToVendorPackUnits(rawComponents, skipped, locationId, db);
  if (components.length === 0) return { ok: false, error: 'no_costable_components' };

  const now = Date.now();
  const prior = loadPromotion(db, specialId, locationId);

  const deletePriorComponent = db.prepare(
    `DELETE FROM dish_components
      WHERE location_id = ? AND dish_name = ?
        AND component_type = 'vendor_item' AND vendor_ingredient = ?`,
  );
  const upsertComponent = db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
        qty_per_serving, unit, notes)
     VALUES (?, ?, 'vendor_item', NULL, ?, ?, ?, ?)
     ON CONFLICT(location_id, dish_name, vendor_ingredient)
       WHERE component_type = 'vendor_item'
     DO UPDATE SET
       qty_per_serving = excluded.qty_per_serving,
       unit = excluded.unit,
       notes = excluded.notes,
       updated_at = datetime('now')`,
  );

  const txn = db.transaction((): PromotionRecord => {
    // Re-promote: remove the rows the prior promotion materialized so a
    // changed menu item name (or dropped ingredient) doesn't leave stale
    // cost rows under the old dish. Hand-entered components for other
    // ingredients are untouched.
    if (prior) {
      let priorComponents: PromotedComponent[] = [];
      try {
        const parsed = JSON.parse(prior.components_json);
        if (Array.isArray(parsed)) priorComponents = parsed;
      } catch {
        /* keep [] */
      }
      for (const c of priorComponents) {
        deletePriorComponent.run(
          locationId,
          normalizeDishName(prior.menu_item_name),
          c.vendor_ingredient,
        );
      }
    }

    const note = `promoted from special ${specialId}`;
    for (const c of components) {
      upsertComponent.run(
        locationId,
        canonicalMenuItemName,
        c.vendor_ingredient,
        c.qty_per_serving,
        c.unit,
        note,
      );
    }

    const componentsJson = JSON.stringify(components);
    let record: PromotionRecord;
    if (prior) {
      db.prepare(
        `UPDATE specials_promotions
            SET menu_item_name = ?, servings = ?, components_json = ?, updated_at = ?
          WHERE id = ?`,
      ).run(menuItemName, servings, componentsJson, now, prior.id);
      record = {
        ...prior,
        menu_item_name: menuItemName,
        servings,
        components_json: componentsJson,
        updated_at: now,
      };
    } else {
      const info = db
        .prepare(
          `INSERT INTO specials_promotions
             (special_id, location_id, menu_item_name, servings, components_json,
              promoted_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(specialId, locationId, menuItemName, servings, componentsJson, now, now);
      record = {
        id: Number(info.lastInsertRowid),
        special_id: specialId,
        location_id: locationId,
        menu_item_name: menuItemName,
        servings,
        components_json: componentsJson,
        promoted_at: now,
        updated_at: now,
      };
    }

    postAuditEvent({
      entity: 'specials_promotion',
      entity_id: record.id,
      action: prior ? 'update' : 'insert',
      actor_cook_id: null,
      actor_source: 'pic_ui',
      location_id: locationId,
      payload: {
        special_id: specialId,
        menu_item_name: menuItemName,
        servings,
        component_count: components.length,
        skipped_count: skipped.length,
      },
    });

    return record;
  });

  const promotion = txn();
  return { ok: true, promotion, components, skipped, repromoted: Boolean(prior) };
}
