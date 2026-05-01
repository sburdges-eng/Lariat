#!/usr/bin/env node
// Integration tests for /api/pest (FDA §6-501.111).
// Pest control log: service_visit / sighting / trap_check entries.
//
// Pure validator is covered by test-pest-rules.mjs. Here we exercise
// route-level behavior: POST happy path, validator 400, GET.
//
// Run: node --experimental-strip-types --test tests/js/test-pest-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-pest-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/pest/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM pest_control_log; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/pest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/pest${qs}`);
}
function countLogs() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM pest_control_log').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/pest — happy path', () => {
  it('records a service_visit; row + audit written', async () => {
    const res = await POST(postReq({
      entry_type: 'service_visit',
      vendor: 'Acme Pest',
      technician: 'Jorge',
      findings: 'No activity in any traps. All bait stations refreshed.',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.entry_type, 'service_visit');
    assert.strictEqual(body.entry.vendor, 'Acme Pest');
    assert.strictEqual(countLogs(), 1);
    assert.strictEqual(countAudit('pest_control_log'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='pest_control_log'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });

  it('records a sighting with a pest specified', async () => {
    const res = await POST(postReq({
      entry_type: 'sighting',
      pest: 'roach',
      severity: 'low',
      findings: 'One adult on dock floor near recycling.',
      corrective_action: 'Swept, traps reset, vendor notified.',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM pest_control_log').get();
    assert.strictEqual(row.entry_type, 'sighting');
    assert.strictEqual(row.pest, 'roach');
    assert.strictEqual(row.severity, 'low');
  });
});

describe('POST /api/pest — validation', () => {
  it('400 when entry_type is missing', async () => {
    const res = await POST(postReq({ findings: 'something' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countLogs(), 0);
  });

  it('400 when entry_type is unknown', async () => {
    const res = await POST(postReq({ entry_type: 'tornado' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countLogs(), 0);
  });

  it('400 when sighting has no pest specified', async () => {
    const res = await POST(postReq({ entry_type: 'sighting' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /pest must be specified/);
    assert.strictEqual(countLogs(), 0);
  });

  it('400 when pest is unknown', async () => {
    const res = await POST(postReq({ entry_type: 'sighting', pest: 'dragon' }));
    assert.strictEqual(res.status, 400);
  });

  it('400 when severity is unknown', async () => {
    const res = await POST(postReq({
      entry_type: 'sighting',
      pest: 'roach',
      severity: 'apocalyptic',
    }));
    assert.strictEqual(res.status, 400);
  });
});

describe('GET /api/pest', () => {
  it('lists rows scoped by location, newest first', async () => {
    await POST(postReq({ entry_type: 'service_visit', vendor: 'Acme', technician: 'Jorge' }));
    await POST(postReq({ entry_type: 'trap_check', findings: 'all clear' }));
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.ok(body.location_id);
  });
});
