#!/usr/bin/env node
// Query-plan coverage for DB-query registry indexes.
// Run: node --experimental-strip-types --test tests/js/test-db-query-indexes.mjs

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-db-query-indexes-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const { DB_QUERIES } = await import('../../lib/dbQueryRegistry.ts');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const sqliteTimestamp = (daysAgo, offsetSeconds = 0) =>
  new Date(Date.now() - daysAgo * 86400000 - offsetSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

before(() => {
  const insertHistory = db.prepare(
    `INSERT INTO vendor_prices_history
       (run_id, ingredient, vendor, sku, pack_size, pack_unit, pack_price,
        unit_price, category, location_id, snapshot_at, snapshot_reason)
     VALUES (?, ?, ?, ?, 1, 'case', ?, ?, ?, ?, ?, 'index-plan-test')`,
  );
  const insertLivePrice = db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price,
        unit_price, category, location_id, imported_at)
     VALUES (?, ?, ?, 1, 'case', ?, ?, ?, ?, ?)`,
  );
  const insertAudit = db.prepare(
    `INSERT INTO audit_events
       (shift_date, location_id, actor_source, entity, entity_id, action,
        payload_json, note, created_at)
     VALUES (date(?), ?, ?, ?, ?, 'view', '{}', 'index plan test', ?)`,
  );

  db.transaction(() => {
    let runId = 1;
    for (const locationId of ['default', 'annex']) {
      for (let skuNo = 0; skuNo < 600; skuNo += 1) {
        const vendor = skuNo % 2 === 0 ? 'sysco' : 'shamrock';
        const sku = `INDEX-${locationId.toUpperCase()}-${skuNo}`;
        const ingredient = skuNo % 3 === 0 ? 'Avocado' : skuNo % 3 === 1 ? 'Ribeye' : 'Fryer Oil';
        const category = skuNo % 3 === 0 ? 'produce' : skuNo % 3 === 1 ? 'meat' : 'pantry';
        for (const daysAgo of [75, 45, 21, 13, 3]) {
          const price = 10 + (skuNo % 17) + (daysAgo < 14 ? 2 : 0);
          insertHistory.run(
            runId++,
            ingredient,
            vendor,
            sku,
            price,
            price,
            category,
            locationId,
            sqliteTimestamp(daysAgo, skuNo),
          );
        }
        insertLivePrice.run(
          ingredient,
          vendor,
          sku,
          12,
          12,
          category,
          locationId,
          sqliteTimestamp(skuNo % 20, skuNo),
        );
      }

      for (let n = 0; n < 7000; n += 1) {
        const createdAt = sqliteTimestamp((n % 240) / 24, n);
        const entity =
          n % 5 === 0 ? 'db_query' :
          n % 5 === 1 ? 'temp_log' :
          n % 5 === 2 ? 'eighty_six' :
          n % 5 === 3 ? 'inventory_updates' :
          'receiving_log';
        const actorSource =
          n % 4 === 0 ? 'kitchen_assistant' :
          n % 4 === 1 ? 'cook_ui' :
          n % 4 === 2 ? 'pic_ui' :
          'sync_replay';
        insertAudit.run(createdAt, locationId, actorSource, entity, n, createdAt);
      }
    }
  })();
  db.exec('ANALYZE');
});

function explainDetails(queryName, params) {
  const spec = DB_QUERIES.find((q) => q.name === queryName);
  assert.ok(spec, `missing db query spec ${queryName}`);
  return db.prepare(`EXPLAIN QUERY PLAN ${spec.sql}`).all(params).map((row) => row.detail);
}

describe('db_query roadmap index plans', () => {
  it('vendor_price_shocks uses a location + snapshot range index for history rows', () => {
    const details = explainDetails('vendor_price_shocks', {
      location_id: 'default',
      days: 14,
      threshold_pct: 10,
    });

    assert.ok(
      details.some((line) =>
        /SEARCH vendor_prices_history USING INDEX idx_vph_loc_snapshot_shock \(location_id=\? AND snapshot_at>\?\)/.test(line),
      ),
      `expected vendor_price_shocks to range by location + snapshot_at:\n${details.join('\n')}`,
    );
  });

  it('audit_log_recent uses a location + created_at range index', () => {
    const details = explainDetails('audit_log_recent', {
      location_id: 'default',
      hours: 24,
      entity: null,
      actor_source: null,
    });

    assert.ok(
      details.some((line) =>
        /SEARCH audit_events USING INDEX idx_audit_recent_loc_created \(location_id=\? AND created_at>\?\)/.test(line),
      ),
      `expected audit_log_recent to range by location + created_at:\n${details.join('\n')}`,
    );
    assert.equal(
      details.some((line) => /^SCAN audit_events\b/.test(line)),
      false,
      `audit_log_recent should not full-scan audit_events:\n${details.join('\n')}`,
    );
  });

  it('audit_log_recent keeps the same time-range plan when optional filters are present', () => {
    const details = explainDetails('audit_log_recent', {
      location_id: 'default',
      hours: 24,
      entity: 'db_query',
      actor_source: 'kitchen_assistant',
    });

    assert.ok(
      details.some((line) =>
        /SEARCH audit_events USING INDEX idx_audit_recent_loc_created \(location_id=\? AND created_at>\?\)/.test(line),
      ),
      `expected filtered audit_log_recent to retain the location + created_at index:\n${details.join('\n')}`,
    );
  });
});
