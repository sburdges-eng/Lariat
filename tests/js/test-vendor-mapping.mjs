#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const {
  searchVendorCatalog,
  listSingleVendorMasters,
  summarizeMappingCoverage,
  catalogKeyString,
  parseCatalogKeyString,
} = await import('../../lib/vendorMapping.ts');

beforeEach(() => {
  db.exec(`DELETE FROM ingredient_masters; DELETE FROM vendor_prices; DELETE FROM ingredient_maps;`);
});

function seedCatalog() {
  db.prepare(
    `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('chicken_breast', 'Chicken Breast')`,
  ).run();
  db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
     VALUES ('CHICKEN BREAST B/S', 'Sysco', 'S123', 1, 'lb', 4.2, 'default', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
     VALUES ('CHICKEN BRST BNLS', 'Shamrock', 'H456', 1, 'lb', 3.9, 'default', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
     VALUES ('Avocado', 'Sysco', 'S99', 1, 'each', 1.5, 'default', 'avocado')`,
  ).run();
  db.prepare(
    `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado')`,
  ).run();
  db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
     VALUES ('Avocado Hass', 'Shamrock', 'H99', 1, 'each', 1.4, 'default', 'avocado')`,
  ).run();
}

describe('vendorMapping read layer', () => {
  it('search returns unlinked chicken when unlinkedOnly', () => {
    seedCatalog();
    const rows = searchVendorCatalog(db, { vendor: 'sysco', q: 'chicken', unlinkedOnly: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sku, 'S123');
    assert.equal(rows[0].master_id, null);
  });

  it('linked sysco avocado excluded when unlinkedOnly', () => {
    seedCatalog();
    const rows = searchVendorCatalog(db, { vendor: 'sysco', q: 'avocado', unlinkedOnly: true });
    assert.equal(rows.length, 0);
  });

  it('lists single-vendor master missing shamrock', () => {
    db.prepare(`INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime')`).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Lime', 'Sysco', 'S1', 'default', 'lime', 1, 'each', 0.25)`,
    ).run();
    const singles = listSingleVendorMasters(db);
    assert.equal(singles.length, 1);
    assert.equal(singles[0].missing_vendor, 'shamrock');
  });

  it('coverage counts match fixture', () => {
    seedCatalog();
    const c = summarizeMappingCoverage(db);
    assert.equal(c.mapped_pairs, 1);
    assert.equal(c.unlinked_sysco, 1);
    assert.equal(c.unlinked_shamrock, 1);
  });

  it('catalog key round-trip', () => {
    const key = { vendor: 'sysco', sku: 'S1', ingredient: 'Chicken' };
    const raw = catalogKeyString(key);
    assert.deepEqual(parseCatalogKeyString(raw), key);
  });
});
