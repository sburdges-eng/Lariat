#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { GET } = await import('../../app/api/purchasing/vendor-compare/route.js');

beforeEach(() => {
  db.exec(`DELETE FROM ingredient_masters; DELETE FROM vendor_prices;`);
  delete process.env.LARIAT_PIN;
});

function seedPair() {
  db.prepare(
    `INSERT INTO ingredient_masters (master_id, canonical_name) VALUES ('avocado', 'Avocado')`,
  ).run();
  for (const [vendor, price] of [['Sysco', 4.0], ['Shamrock', 3.5]]) {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
       VALUES ('Avocado', ?, ?, 1, 'lb', ?, ?, 'default', 'avocado')`,
    ).run(vendor, `${vendor[0]}1`, price, price);
  }
}

describe('GET /api/purchasing/vendor-compare', () => {
  it('returns compare rows', async () => {
    seedPair();
    const res = await GET(new Request('http://localhost/api/purchasing/vendor-compare'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.masters_with_both_vendors, 1);
    assert.equal(body.rows[0].master_id, 'avocado');
  });
});
