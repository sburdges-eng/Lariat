#!/usr/bin/env node
// Integration tests for /api/sds (OSHA HCS, 29 CFR 1910.1200).
// SDS registry: one row per chemical product on premises.
//
// Pure validator is covered by test-sds-rules.mjs. Here we exercise
// route-level behavior: POST happy path, validator 400, GET.
//
// Run: node --experimental-strip-types --test tests/js/test-sds-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sds-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/sds/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM sds_registry; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/sds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/sds${qs}`);
}
function countSds() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM sds_registry').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/sds — happy path', () => {
  it('registers a product; row + audit written', async () => {
    const res = await POST(postReq({
      product_name: 'Quat Sanitizer 256',
      manufacturer: 'Ecolab',
      hazard_class: 'corrosive',
      storage_location: 'Chemical closet — line',
      url: 'https://example.com/sds/quat256.pdf',
      last_reviewed: '2026-04-01',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.product_name, 'Quat Sanitizer 256');
    assert.strictEqual(body.entry.hazard_class, 'corrosive');
    assert.strictEqual(body.entry.active, 1);
    assert.strictEqual(countSds(), 1);
    assert.strictEqual(countAudit('sds_registry'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='sds_registry'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });

  it('defaults active=1 and last_reviewed to today when omitted', async () => {
    await POST(postReq({ product_name: 'Degreaser X' }));
    const row = testDb.prepare('SELECT * FROM sds_registry').get();
    assert.strictEqual(row.active, 1);
    assert.ok(row.last_reviewed);
  });
});

describe('POST /api/sds — validation', () => {
  it('400 when product_name is missing', async () => {
    const res = await POST(postReq({ manufacturer: 'Ecolab' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /product_name is required/);
    assert.strictEqual(countSds(), 0);
  });

  it('400 when product_name is empty/whitespace', async () => {
    const res = await POST(postReq({ product_name: '   ' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countSds(), 0);
  });

  it('400 when hazard_class is not a GHS enum value', async () => {
    const res = await POST(postReq({
      product_name: 'Mystery Goo',
      hazard_class: 'spooky',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 when url does not start with http(s)', async () => {
    const res = await POST(postReq({
      product_name: 'Mystery Goo',
      url: 'file:///tmp/sheet.pdf',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 when last_reviewed is not YYYY-MM-DD', async () => {
    const res = await POST(postReq({
      product_name: 'Mystery Goo',
      last_reviewed: '04/01/2026',
    }));
    assert.strictEqual(res.status, 400);
  });
});

describe('GET /api/sds', () => {
  it('lists active products only, ordered by product_name', async () => {
    await POST(postReq({ product_name: 'Zebra Cleaner' }));
    await POST(postReq({ product_name: 'Apple Wash' }));
    await POST(postReq({ product_name: 'Retired Chem', active: false }));
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.strictEqual(body.rows[0].product_name, 'Apple Wash');
    assert.strictEqual(body.rows[1].product_name, 'Zebra Cleaner');
  });
});
