#!/usr/bin/env node
// Tests for lib/pin::hasPinOrTempPin (T3) — the unified gate that accepts
// either the master PIN cookie OR a scoped temp PIN cookie.
// Run: node --experimental-strip-types --test tests/js/test-pin-gate.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const pin = await import('../../lib/pin.ts');
const tempPinCookie = await import('../../lib/tempPinCookie.ts');
const tempPin = await import('../../lib/tempPin.ts');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec('DELETE FROM temp_pins;');
});

const futureIso = (mins = 60) => new Date(Date.now() + mins * 60_000).toISOString();
const pastIso = (mins = 60) => new Date(Date.now() - mins * 60_000).toISOString();

function reqWithCookies(...cookies) {
  const headers = new Headers();
  if (cookies.length > 0) {
    headers.set('cookie', cookies.join('; '));
  }
  return new Request('http://localhost/', { headers });
}

async function tempPinCookieFor(id) {
  const value = await tempPinCookie.signTempPinCookieValue(id, undefined); // unsigned legacy mode
  return `${tempPinCookie.TEMP_PIN_COOKIE_NAME}=${value}`;
}

function insertTempPin({ pinValue = '1234', label = 'Test', scopes = ['beo.fire_at_edit'], expires_at = futureIso(), revoked = false } = {}) {
  const hash = tempPin.hashPin(pinValue);
  const res = conn
    .prepare(
      `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at, revoked_at)
       VALUES ('default', ?, ?, ?, ?, ?)`,
    )
    .run(hash, label, JSON.stringify(scopes), expires_at, revoked ? new Date().toISOString() : null);
  return Number(res.lastInsertRowid);
}

// ── hasPinCookie still works (no regression) ───────────────────────

describe('hasPinCookie (unchanged)', () => {
  it('returns true when the master PIN cookie is present (legacy unsigned)', async () => {
    const req = reqWithCookies('lariat_pin_ok=1');
    assert.equal(await pin.hasPinCookie(req), true);
  });

  it('returns false when no cookie', async () => {
    const req = reqWithCookies();
    assert.equal(await pin.hasPinCookie(req), false);
  });
});

// ── hasPinOrTempPin: master PIN path ───────────────────────────────

describe('hasPinOrTempPin — master PIN path', () => {
  it('true when master PIN cookie is valid (any scope works)', async () => {
    const req = reqWithCookies('lariat_pin_ok=1');
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), true);
  });

  it('master PIN bypasses scope check (manager has all scopes)', async () => {
    const req = reqWithCookies('lariat_pin_ok=1');
    // Even a scope nobody has been granted: master PIN gets through.
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), true);
  });
});

// ── hasPinOrTempPin: temp PIN path ─────────────────────────────────

describe('hasPinOrTempPin — temp PIN path', () => {
  it('true with a valid active temp PIN cookie holding the asked scope', async () => {
    const id = insertTempPin({ scopes: ['beo.fire_at_edit'] });
    const cookie = await tempPinCookieFor(id);
    const req = reqWithCookies(cookie);
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), true);
  });

  it('false when temp PIN exists but lacks the asked scope', async () => {
    // Insert a temp pin with NO scopes — should be denied.
    const id = insertTempPin({ scopes: [] });
    const cookie = await tempPinCookieFor(id);
    const req = reqWithCookies(cookie);
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), false);
  });

  it('false when the temp pin row has been revoked', async () => {
    const id = insertTempPin({ revoked: true });
    const cookie = await tempPinCookieFor(id);
    const req = reqWithCookies(cookie);
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), false);
  });

  it('false when the temp pin row has expired', async () => {
    const id = insertTempPin({ expires_at: pastIso() });
    const cookie = await tempPinCookieFor(id);
    const req = reqWithCookies(cookie);
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), false);
  });

  it('false when the cookie points at a non-existent id (forged)', async () => {
    const cookie = await tempPinCookieFor(99999);
    const req = reqWithCookies(cookie);
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), false);
  });

  it('false when no cookie at all', async () => {
    const req = reqWithCookies();
    assert.equal(await pin.hasPinOrTempPin(req, 'beo.fire_at_edit'), false);
  });
});
