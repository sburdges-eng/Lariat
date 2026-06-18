#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { GET: getCatalog } = await import('../../app/api/purchasing/vendor-catalog/route.js');
const { POST: postPair } = await import('../../app/api/purchasing/vendor-link/pair/route.js');
const { POST: postAttach } = await import('../../app/api/purchasing/vendor-link/attach/route.js');
const { GET: getCompare } = await import('../../app/api/purchasing/vendor-compare/route.js');

beforeEach(() => {
  db.exec(`DELETE FROM audit_events; DELETE FROM ingredient_maps; DELETE FROM ingredient_masters; DELETE FROM vendor_prices;`);
  delete process.env.LARIAT_PIN;
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

describe('vendor mapping API', () => {
  it('GET catalog returns chicken rows', async () => {
    seedUnlinkedPair();
    const res = await getCatalog(new Request('http://localhost/api/purchasing/vendor-catalog?vendor=sysco&q=chicken'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.rows.length >= 1);
    assert.ok(body.coverage);
  });

  it('POST pair without PIN when gate disabled', async () => {
    seedUnlinkedPair();
    const res = await postPair(
      new Request('http://localhost/api/purchasing/vendor-link/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          syscoKey: { vendor: 'sysco', sku: 'S123', ingredient: 'CHICKEN BREAST B/S' },
          shamrockKey: { vendor: 'shamrock', sku: 'H456', ingredient: 'CHICKEN BRST BNLS' },
          canonicalName: 'Chicken Breast',
        }),
      }),
    );
    assert.equal(res.status, 200);
    const cmp = await getCompare(new Request('http://localhost/api/purchasing/vendor-compare'));
    const cmpBody = await cmp.json();
    assert.equal(cmpBody.masters_with_both_vendors, 1);
  });

  it('POST attach completes single-vendor master', async () => {
    db.prepare(`INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado')`).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Avocado', 'Sysco', 'S1', 'default', 'avocado', 1, 'each', 1.5)`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, pack_size, pack_unit, unit_price)
       VALUES ('Avocado Hass', 'Shamrock', 'H1', 'default', 1, 'each', 1.4)`,
    ).run();
    const res = await postAttach(
      new Request('http://localhost/api/purchasing/vendor-link/attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          masterId: 'avocado',
          catalogKey: { vendor: 'shamrock', sku: 'H1', ingredient: 'Avocado Hass' },
        }),
      }),
    );
    assert.equal(res.status, 200);
    const cmp = await getCompare(new Request('http://localhost/api/purchasing/vendor-compare'));
    const cmpBody = await cmp.json();
    assert.equal(cmpBody.masters_with_both_vendors, 1);
  });
});
