// lib/vendorMappingRepo.ts — PIN-gated vendor catalog link writes with audit.

import type { Database as DB } from 'better-sqlite3';
import { postAuditEvent } from './auditEvents.ts';
import { deriveMasterId } from './ingredientKey.ts';
import type { CompareVendor } from './vendorCompare.ts';
import {
  type CatalogKey,
  getLatestVendorPriceRow,
  listSingleVendorMasters,
} from './vendorMapping.ts';

export class VendorMappingRejectedError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = 'VendorMappingRejectedError';
    this.status = status;
  }
}

export interface PairCatalogInput {
  syscoKey: CatalogKey;
  shamrockKey: CatalogKey;
  canonicalName: string;
  locationId?: string;
  cookId?: string | null;
  actorSource?: string;
}

export interface AttachCatalogInput {
  masterId: string;
  catalogKey: CatalogKey;
  locationId?: string;
  cookId?: string | null;
  actorSource?: string;
}

function normVendor(v: string): string {
  return v.trim().toLowerCase();
}

function assertCatalogVendor(key: CatalogKey, expected: CompareVendor): void {
  if (normVendor(key.vendor) !== expected) {
    throw new VendorMappingRejectedError(`Expected ${expected} catalog row.`, 422);
  }
}

function assertRowExists(db: DB, key: CatalogKey, locationId: string): { ingredient: string; master_id: string | null } {
  const row = getLatestVendorPriceRow(db, key, locationId);
  if (!row) {
    throw new VendorMappingRejectedError('Catalog row not found.', 404);
  }
  if (row.ingredient !== key.ingredient) {
    throw new VendorMappingRejectedError('Catalog ingredient mismatch.', 422);
  }
  return row;
}

function assertNotLinkedElsewhere(
  db: DB,
  key: CatalogKey,
  masterId: string,
  locationId: string,
): void {
  const row = assertRowExists(db, key, locationId);
  if (row.master_id && row.master_id !== masterId) {
    throw new VendorMappingRejectedError('That item is already linked to another staple.', 409);
  }
}

function upsertMaster(db: DB, masterId: string, canonicalName: string): void {
  db.prepare(
    `
    INSERT INTO ingredient_masters (master_id, canonical_name)
    VALUES (@master_id, @canonical_name)
    ON CONFLICT(master_id) DO UPDATE SET
      canonical_name = excluded.canonical_name
  `,
  ).run({ master_id: masterId, canonical_name: canonicalName });
}

function insertConfirmedMap(
  db: DB,
  recipeIngredient: string,
  vendorIngredient: string,
  locationId: string,
): void {
  db.prepare(
    `
    INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
    VALUES (@recipe_ingredient, @vendor_ingredient, 'confirmed', @location_id)
  `,
  ).run({
    recipe_ingredient: recipeIngredient,
    vendor_ingredient: vendorIngredient,
    location_id: locationId,
  });
}

function setVpMasterId(
  db: DB,
  key: CatalogKey,
  masterId: string,
  locationId: string,
): number {
  const info = db
    .prepare(
      `
      UPDATE vendor_prices
         SET master_id = @master_id
       WHERE location_id = @location_id
         AND lower(trim(vendor)) = @vendor
         AND sku = @sku
    `,
    )
    .run({
      master_id: masterId,
      location_id: locationId,
      vendor: normVendor(key.vendor),
      sku: key.sku,
    });
  return info.changes;
}

export function pairCatalogRows(db: DB, input: PairCatalogInput): { master_id: string } {
  const locationId = input.locationId ?? 'default';
  const canonical = input.canonicalName?.trim() ?? '';
  if (!canonical) {
    throw new VendorMappingRejectedError('Enter a staple name.', 422);
  }

  assertCatalogVendor(input.syscoKey, 'sysco');
  assertCatalogVendor(input.shamrockKey, 'shamrock');

  const masterId = deriveMasterId(canonical);
  if (!masterId) {
    throw new VendorMappingRejectedError('Staple name is too short.', 422);
  }

  const existing = db
    .prepare(`SELECT canonical_name FROM ingredient_masters WHERE master_id = ?`)
    .get(masterId) as { canonical_name: string } | undefined;
  if (existing && existing.canonical_name !== canonical) {
    throw new VendorMappingRejectedError('That staple name is already linked.', 409);
  }

  assertNotLinkedElsewhere(db, input.syscoKey, masterId, locationId);
  assertNotLinkedElsewhere(db, input.shamrockKey, masterId, locationId);

  const actorSource = input.actorSource ?? 'manager_ui';

  db.transaction(() => {
    upsertMaster(db, masterId, canonical);
    postAuditEvent({
      entity: 'ingredient_masters',
      entity_id: null,
      action: 'correction',
      actor_cook_id: input.cookId ?? null,
      actor_source: actorSource,
      location_id: locationId,
      payload: { master_id: masterId, canonical_name: canonical, op: 'vendor_link_pair' },
    });

    insertConfirmedMap(db, canonical, input.syscoKey.ingredient, locationId);
    postAuditEvent({
      entity: 'ingredient_maps',
      entity_id: null,
      action: 'correction',
      actor_cook_id: input.cookId ?? null,
      actor_source: actorSource,
      location_id: locationId,
      payload: {
        recipe_ingredient: canonical,
        vendor_ingredient: input.syscoKey.ingredient,
        status: 'confirmed',
        op: 'vendor_link_pair',
      },
    });

    insertConfirmedMap(db, canonical, input.shamrockKey.ingredient, locationId);
    postAuditEvent({
      entity: 'ingredient_maps',
      entity_id: null,
      action: 'correction',
      actor_cook_id: input.cookId ?? null,
      actor_source: actorSource,
      location_id: locationId,
      payload: {
        recipe_ingredient: canonical,
        vendor_ingredient: input.shamrockKey.ingredient,
        status: 'confirmed',
        op: 'vendor_link_pair',
      },
    });

    const syscoChanges = setVpMasterId(db, input.syscoKey, masterId, locationId);
    const shamChanges = setVpMasterId(db, input.shamrockKey, masterId, locationId);
    if (syscoChanges === 0 || shamChanges === 0) {
      throw new VendorMappingRejectedError('Catalog row not found.', 404);
    }

    postAuditEvent({
      entity: 'vendor_prices',
      entity_id: null,
      action: 'correction',
      actor_cook_id: input.cookId ?? null,
      actor_source: actorSource,
      location_id: locationId,
      payload: {
        master_id: masterId,
        sysco_sku: input.syscoKey.sku,
        shamrock_sku: input.shamrockKey.sku,
        op: 'vendor_link_pair',
      },
    });
  })();

  return { master_id: masterId };
}

export function attachCatalogRow(db: DB, input: AttachCatalogInput): { master_id: string } {
  const locationId = input.locationId ?? 'default';
  const masterId = input.masterId?.trim();
  if (!masterId) {
    throw new VendorMappingRejectedError('Pick a staple.', 422);
  }

  const master = db
    .prepare(`SELECT master_id, canonical_name FROM ingredient_masters WHERE master_id = ?`)
    .get(masterId) as { master_id: string; canonical_name: string } | undefined;
  if (!master) {
    throw new VendorMappingRejectedError('Staple not found.', 404);
  }

  const singles = listSingleVendorMasters(db, locationId);
  const row = singles.find((s) => s.master_id === masterId);
  if (!row) {
    throw new VendorMappingRejectedError('Staple already has both vendors or none.', 409);
  }

  if (normVendor(input.catalogKey.vendor) !== row.missing_vendor) {
    throw new VendorMappingRejectedError(`Pick a ${row.missing_vendor} item.`, 422);
  }

  assertNotLinkedElsewhere(db, input.catalogKey, masterId, locationId);

  const actorSource = input.actorSource ?? 'manager_ui';

  db.transaction(() => {
    insertConfirmedMap(db, master.canonical_name, input.catalogKey.ingredient, locationId);
    postAuditEvent({
      entity: 'ingredient_maps',
      entity_id: null,
      action: 'correction',
      actor_cook_id: input.cookId ?? null,
      actor_source: actorSource,
      location_id: locationId,
      payload: {
        recipe_ingredient: master.canonical_name,
        vendor_ingredient: input.catalogKey.ingredient,
        status: 'confirmed',
        op: 'vendor_link_attach',
      },
    });

    const changes = setVpMasterId(db, input.catalogKey, masterId, locationId);
    if (changes === 0) {
      throw new VendorMappingRejectedError('Catalog row not found.', 404);
    }

    postAuditEvent({
      entity: 'vendor_prices',
      entity_id: null,
      action: 'correction',
      actor_cook_id: input.cookId ?? null,
      actor_source: actorSource,
      location_id: locationId,
      payload: {
        master_id: masterId,
        vendor: input.catalogKey.vendor,
        sku: input.catalogKey.sku,
        op: 'vendor_link_attach',
      },
    });
  })();

  return { master_id: masterId };
}
