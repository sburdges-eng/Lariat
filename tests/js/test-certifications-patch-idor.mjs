#!/usr/bin/env node
// Cross-location IDOR guard for PATCH /api/certifications.
//
// POST already writes locationFromBody. PATCH looked up the row by
// numeric id only, so a PIC scoped to site-A could deactivate a
// site-B CFPM/food-handler record by guessing the id.
//
// Mirror of tests/js/test-tphc-patch-idor.mjs. 404 (not 403) is
// deliberate: existence at another site must not leak.
//
// Run: node --experimental-strip-types --test tests/js/test-certifications-patch-idor.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

delete process.env.LARIAT_PIN;

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-certs-idor-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/certifications/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM staff_certifications; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/certifications', {
    method: 'POST',
    headers: { cookie: 'lariat_pin_ok=1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body, qs = '') {
  return new Request(`http://localhost/api/certifications${qs}`, {
    method: 'PATCH',
    headers: { cookie: 'lariat_pin_ok=1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function addCert(overrides = {}) {
  const res = await POST(postReq({
    cook_id: 'alice',
    cert_type: 'cfpm',
    cert_label: 'ServSafe CFPM',
    issuer: 'National Restaurant Association',
    issued_on: '2026-01-15',
    expires_on: '2031-01-15',
    ...overrides,
  }));
  assert.strictEqual(res.status, 200, 'POST should succeed in fixture setup');
  const body = await res.json();
  return body.entry.id;
}

function countAuditByAction(action) {
  return testDb
    .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='staff_certifications' AND action=?`)
    .get(action).c;
}

describe('PATCH /api/certifications — cross-location IDOR guard', () => {
  it('404 when caller location does not match the row location', async () => {
    const id = await addCert({ location_id: 'site-a' });

    const res = await PATCH(patchReq(
      { id, active: false },
      '?location=site-b',
    ));
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /unknown certification/);

    const row = testDb.prepare('SELECT * FROM staff_certifications WHERE id=?').get(id);
    assert.strictEqual(row.active, 1, 'active must remain 1');
    assert.strictEqual(row.location_id, 'site-a');
    assert.strictEqual(countAuditByAction('update'), 0);
  });

  it('200 when caller location matches the row location', async () => {
    const id = await addCert({ location_id: 'site-a' });

    const res = await PATCH(patchReq(
      { id, active: false },
      '?location=site-a',
    ));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.active, 0);

    const row = testDb.prepare('SELECT * FROM staff_certifications WHERE id=?').get(id);
    assert.strictEqual(row.active, 0);
    assert.strictEqual(countAuditByAction('update'), 1);
  });

  it('default-location compat: POST without location_id, PATCH without ?location= → 200', async () => {
    const id = await addCert();

    const res = await PATCH(patchReq({ id, active: false }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.active, 0);

    const row = testDb.prepare('SELECT * FROM staff_certifications WHERE id=?').get(id);
    assert.strictEqual(row.location_id, 'default');
    assert.strictEqual(row.active, 0);
    assert.strictEqual(countAuditByAction('update'), 1);
  });
});
