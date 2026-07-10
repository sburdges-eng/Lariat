#!/usr/bin/env node
// Temp PIN storage hardening (audit 2026-07-10 P0-3): issued PINs are stored
// with salted PBKDF2, login verifies by scanning active rows (salted hashes
// can't be looked up by SQL equality), and any temp PIN still in flight under
// the old unsalted SHA-256 keeps working until it expires.
//
// Run: node --experimental-strip-types --test tests/js/test-temp-pin-hashing.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const issueRoute = await import('../../app/api/auth/temp-pin/issue/route.js');
const loginRoute = await import('../../app/api/auth/temp-pin/login/route.js');
const { verifyPin, isLegacyHash } = await import('../../lib/pinHash.ts');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

const legacySha256 = (pin) => createHash('sha256').update(pin).digest('hex');
const futureIso = (min = 60) => new Date(Date.now() + min * 60_000).toISOString();

after(() => {
  db.setDbPathForTest(null);
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec('DELETE FROM temp_pins; DELETE FROM audit_events;');
  loginRoute._resetAttemptsForTest();
});

function issueReq(body) {
  return new Request('http://localhost/api/auth/temp-pin/issue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'lariat_pin_ok=1' },
    body: JSON.stringify(body),
  });
}
function loginReq(pin) {
  return new Request('http://localhost/api/auth/temp-pin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}
async function issue() {
  const res = await issueRoute.POST(
    issueReq({ label: 'Line lead', expires_at: futureIso(), scopes: ['menu.prep_history'], pin_length: 4 }),
  );
  assert.equal(res.status, 200, 'issue should succeed');
  return res.json();
}

describe('temp PIN issuance stores salted PBKDF2', () => {
  it('stores a salted PBKDF2 hash that verifies, never the raw PIN or SHA-256', async () => {
    const { id, pin } = await issue();
    const row = conn.prepare('SELECT pin_hash FROM temp_pins WHERE id = ?').get(id);
    assert.notEqual(row.pin_hash, pin);
    assert.notEqual(row.pin_hash, legacySha256(pin), 'must not be unsalted SHA-256');
    assert.equal(isLegacyHash(row.pin_hash), false);
    assert.equal(verifyPin(pin, row.pin_hash), true);
  });
});

describe('temp PIN login verifies by scan', () => {
  it('logs in with the freshly issued (PBKDF2) PIN', async () => {
    const { id, pin } = await issue();
    const res = await loginRoute.POST(loginReq(pin));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id);
  });

  it('rejects a wrong PIN with 401', async () => {
    const { pin } = await issue();
    const wrong = pin === '9999' ? '1111' : '9999';
    const res = await loginRoute.POST(loginReq(wrong));
    assert.equal(res.status, 401);
  });

  it('still accepts an in-flight legacy SHA-256 temp PIN (deploy migration safety)', async () => {
    const info = conn
      .prepare(
        `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
         VALUES ('default', ?, 'legacy', ?, ?)`,
      )
      .run(legacySha256('4321'), JSON.stringify(['menu.prep_history']), futureIso());
    const res = await loginRoute.POST(loginReq('4321'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, Number(info.lastInsertRowid));
  });
});
