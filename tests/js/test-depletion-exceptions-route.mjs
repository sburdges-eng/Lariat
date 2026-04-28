#!/usr/bin/env node
// Tests for the GET handler at app/api/costing/depletion-exceptions/route.js.
//
// Run: node --experimental-strip-types --test tests/js/test-depletion-exceptions-route.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const route = await import(
  '../../app/api/costing/depletion-exceptions/route.js'
);
const { GET } = route;

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM sales_lines;
    DELETE FROM dish_components;
    DELETE FROM bom_lines;
    DELETE FROM entities_recipes;
  `);
});

function getReq(qs = '') {
  return new Request(`http://localhost/api/costing/depletion-exceptions${qs}`);
}

describe('GET /api/costing/depletion-exceptions', () => {
  it('returns empty queue when no sales', async () => {
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.location_id, 'default');
    assert.equal(body.total, 0);
    assert.deepEqual(body.exceptions, []);
  });

  it('flags an unmapped dish from sales_lines', async () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('2026-W17', 'Mystery Plate', 3, 27, 'toast', 'default')`,
    ).run();

    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.exceptions[0].dish_name, 'Mystery Plate');
    assert.equal(body.exceptions[0].reason, 'no_dish_components');
    assert.equal(body.exceptions[0].total_net_sales, 27);
  });

  it('respects ?location= filter', async () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('2026-W17', 'Default Plate', 1, 10, 'toast', 'default'),
              ('2026-W17', 'Satellite Plate', 1, 12, 'toast', 'satellite')`,
    ).run();

    const res = await GET(getReq('?location=satellite'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.location_id, 'satellite');
    assert.equal(body.total, 1);
    assert.equal(body.exceptions[0].dish_name, 'Satellite Plate');
  });

  it('respects ?period= filter', async () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('2026-W17', 'Old Plate', 1, 10, 'toast', 'default'),
              ('2026-W18', 'New Plate', 1, 12, 'toast', 'default')`,
    ).run();

    const res = await GET(getReq('?period=2026-W18'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.period_label, '2026-W18');
    assert.equal(body.total, 1);
    assert.equal(body.exceptions[0].dish_name, 'New Plate');
  });

  it('clamps absurd ?limit= values', async () => {
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
         VALUES ('2026-W17', ?, 1, ?, 'toast', 'default')`,
      ).run(`Mystery ${i}`, 10 - i);
    }

    const res = await GET(getReq('?limit=999999'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 3);

    const tiny = await GET(getReq('?limit=1'));
    const tinyBody = await tiny.json();
    assert.equal(tinyBody.total, 1);
  });
});
