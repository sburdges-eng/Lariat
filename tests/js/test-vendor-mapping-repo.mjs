#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { pairCatalogRows, attachCatalogRow, VendorMappingRejectedError } = await import(
  '../../lib/vendorMappingRepo.ts'
);

beforeEach(() => {
  db.exec(`DELETE FROM audit_events; DELETE FROM ingredient_maps; DELETE FROM ingredient_masters; DELETE FROM vendor_prices;`);
});

function seedUnlinkedPair() {
  db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id)
     VALUES ('CHICKEN BREAST B/S', 'Sysco', 'S123', 1, 'lb', 4.2, 'default')`,
  ).run();
  db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id)
     VALUES ('CHICKEN BRST BNLS', 'Shamrock', 'H456', 1, 'lb', 3.9, 'default')`,
  ).run();
}

describe('vendorMappingRepo', () => {
  it('pair creates master maps and VP links with audit', () => {
    seedUnlinkedPair();
    const result = pairCatalogRows(db, {
      syscoKey: { vendor: 'sysco', sku: 'S123', ingredient: 'CHICKEN BREAST B/S' },
      shamrockKey: { vendor: 'shamrock', sku: 'H456', ingredient: 'CHICKEN BRST BNLS' },
      canonicalName: 'Chicken Breast',
    });
    assert.equal(result.master_id, 'chicken_breast');
    const maps = db.prepare(`SELECT COUNT(*) AS c FROM ingredient_maps WHERE status = 'confirmed'`).get();
    assert.equal(maps.c, 2);
    const vp = db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices WHERE master_id = 'chicken_breast'`).get();
    assert.equal(vp.c, 2);
    const audits = db.prepare(`SELECT COUNT(*) AS c FROM audit_events`).get();
    assert.ok(audits.c >= 3);
  });

  it('attach adds missing vendor', () => {
    db.prepare(`INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado')`).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Avocado', 'Sysco', 'S1', 'default', 'avocado', 1, 'each', 1.5)`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, pack_size, pack_unit, unit_price)
       VALUES ('Avocado Hass', 'Shamrock', 'H1', 'default', 1, 'each', 1.4)`,
    ).run();
    attachCatalogRow(db, {
      masterId: 'avocado',
      catalogKey: { vendor: 'shamrock', sku: 'H1', ingredient: 'Avocado Hass' },
    });
    const row = db.prepare(`SELECT master_id FROM vendor_prices WHERE sku = 'H1'`).get();
    assert.equal(row.master_id, 'avocado');
  });

  it('rejects attach when catalog already linked elsewhere', () => {
    db.prepare(`INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado')`).run();
    db.prepare(`INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('lime', 'Lime')`).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Avocado', 'Sysco', 'S1', 'default', 'avocado', 1, 'each', 1.5)`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Lime', 'Shamrock', 'H9', 'default', 'lime', 1, 'each', 0.2)`,
    ).run();
    assert.throws(
      () =>
        attachCatalogRow(db, {
          masterId: 'avocado',
          catalogKey: { vendor: 'shamrock', sku: 'H9', ingredient: 'Lime' },
        }),
      (err) => err instanceof VendorMappingRejectedError && err.status === 409,
    );
    const lime = db.prepare(`SELECT master_id FROM vendor_prices WHERE sku = 'H9'`).get();
    assert.equal(lime.master_id, 'lime');
  });
});
