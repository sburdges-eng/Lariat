#!/usr/bin/env node
// Tests for lib/pin's shared `requirePin` and `requirePinOrScope` helpers.
//
// History: `requirePin` was duplicated as a local async function in 22+
// route files (audit 2026-05-08 §1, defense-in-depth opportunity); PR
// #221 extracted it. PR #222 extracted the scoped sibling
// `requirePinOrScope` from a further 6 routes that use
// `hasPinOrTempPin(req, SCOPE)` instead of `hasPinCookie(req)`.
//
// This test pins both shared exports' behavior so future hardening
// (e.g. a `Vary: Cookie` response header, deny-side logging,
// scope-mismatch logging, rate-limit hooks) can be added in one place
// and verified here.
//
// Pure extraction guard — body MUST stay byte-identical to the local
// duplicates that were removed:
//   - requirePin: returns null when the cookie is valid (or PIN gating
//     is disabled), 401 Response with `{error:'PIN required'}` when
//     the cookie is missing/invalid.
//   - requirePinOrScope: identical to requirePin but additionally
//     returns null when a temp-PIN cookie is present whose row in
//     temp_pins includes the supplied scope; returns 401 on missing
//     master cookie + missing/wrong-scope temp cookie.
//
// Run: node --experimental-strip-types --test tests/js/test-pin-helper-shared.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { requirePin, requirePinOrScope } = await import('../../lib/pin.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');
const tempPinCookie = await import('../../lib/tempPinCookie.ts');
const tempPin = await import('../../lib/tempPin.ts');
const dbMod = await import('../../lib/db.ts');

const SECRET = '813b7d4d4bac2cd4ce19db8574a598704c288455f3e6cc5ee0d8cd2a12e7288f';

function makeRequest({ cookie } = {}) {
  return new Request('http://localhost/test', {
    headers: cookie ? { cookie } : {},
  });
}

describe('lib/pin requirePin — shared helper', () => {
  it('is exported and is an async function', () => {
    assert.strictEqual(typeof requirePin, 'function');
    // async functions construct as `AsyncFunction`.
    assert.strictEqual(requirePin.constructor.name, 'AsyncFunction');
  });

  it('returns null when PIN gating is disabled (no LARIAT_PIN env)', async () => {
    const prev = process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN;
    try {
      const result = await requirePin(makeRequest());
      assert.strictEqual(result, null);
    } finally {
      if (prev !== undefined) process.env.LARIAT_PIN = prev;
    }
  });

  it('returns 401 Response when PIN gating is enabled and cookie is missing', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    process.env.LARIAT_PIN_SECRET = SECRET;
    try {
      const result = await requirePin(makeRequest());
      assert.ok(result instanceof Response, 'expected a Response');
      assert.strictEqual(result.status, 401);
      const body = await result.json();
      assert.deepStrictEqual(body, { error: 'PIN required' });
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret === undefined) delete process.env.LARIAT_PIN_SECRET;
      else process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });

  it('returns null when PIN gating is enabled and a valid signed cookie is present', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    process.env.LARIAT_PIN_SECRET = SECRET;
    try {
      const cookieValue = await signPinCookieValue(SECRET);
      const result = await requirePin(
        makeRequest({ cookie: `lariat_pin_ok=${cookieValue}` }),
      );
      assert.strictEqual(result, null);
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret === undefined) delete process.env.LARIAT_PIN_SECRET;
      else process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });

  it('returns 401 Response when an invalid (forged) cookie is present', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    process.env.LARIAT_PIN_SECRET = SECRET;
    try {
      // Hand-forged value — would have been the legacy unsigned form.
      const result = await requirePin(
        makeRequest({ cookie: 'lariat_pin_ok=1' }),
      );
      assert.ok(result instanceof Response);
      assert.strictEqual(result.status, 401);
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret === undefined) delete process.env.LARIAT_PIN_SECRET;
      else process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });
});

// ── requirePinOrScope ──────────────────────────────────────────────
//
// Extracted from 6 routes in PR #222: beo/prep-history, shows stage/
// sound (both list+detail), shows box-office (both list+detail).
// Same shape as requirePin but accepts EITHER a master PIN cookie OR a
// temp-PIN cookie whose row in temp_pins includes the supplied scope.
//
// The temp-pin path requires a real DB (the gate hits temp_pins on
// every check per spec invariant 5: revocation/expiry must take effect
// immediately). We use an in-memory DB via setDbPathForTest().

describe('lib/pin requirePinOrScope — shared helper', () => {
  // Ensure the DB module sees an in-memory schema; previous suites
  // didn't touch the DB so leaving it untouched would crash on the
  // temp_pins INSERT.
  dbMod.setDbPathForTest(':memory:');
  const conn = dbMod.getDb();

  after(() => {
    dbMod.setDbPathForTest(null);
  });

  beforeEach(() => {
    conn.exec('DELETE FROM temp_pins;');
  });

  const futureIso = (mins = 60) => new Date(Date.now() + mins * 60_000).toISOString();

  async function mintTempPinCookie(scopes, secret = undefined) {
    const id = Number(
      conn
        .prepare(
          `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
           VALUES ('default', ?, ?, ?, ?)`,
        )
        .run(
          tempPin.hashPin(`pin-${Math.random().toString(36).slice(2, 8)}`),
          'Test',
          tempPin.serializeScopes(scopes),
          futureIso(),
        ).lastInsertRowid,
    );
    const value = await tempPinCookie.signTempPinCookieValue(id, secret);
    return `${tempPinCookie.TEMP_PIN_COOKIE_NAME}=${value}`;
  }

  it('is exported and is an async function', () => {
    assert.strictEqual(typeof requirePinOrScope, 'function');
    assert.strictEqual(requirePinOrScope.constructor.name, 'AsyncFunction');
  });

  it('returns null when PIN gating is disabled (no LARIAT_PIN env)', async () => {
    const prev = process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN;
    try {
      const result = await requirePinOrScope(makeRequest(), 'menu.prep_history');
      assert.strictEqual(result, null);
    } finally {
      if (prev !== undefined) process.env.LARIAT_PIN = prev;
    }
  });

  it('returns null when a valid master PIN cookie is present', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    process.env.LARIAT_PIN_SECRET = SECRET;
    try {
      const cookieValue = await signPinCookieValue(SECRET);
      const result = await requirePinOrScope(
        makeRequest({ cookie: `lariat_pin_ok=${cookieValue}` }),
        'menu.prep_history',
      );
      assert.strictEqual(result, null);
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret === undefined) delete process.env.LARIAT_PIN_SECRET;
      else process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });

  it('returns null when a temp PIN cookie scoped to the requested scope is present', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    delete process.env.LARIAT_PIN_SECRET; // unsigned temp-pin cookie path
    try {
      const cookie = await mintTempPinCookie(['menu.prep_history']);
      const result = await requirePinOrScope(
        makeRequest({ cookie }),
        'menu.prep_history',
      );
      assert.strictEqual(result, null);
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret !== undefined) process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });

  it('returns 401 Response when no cookie is present', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    process.env.LARIAT_PIN_SECRET = SECRET;
    try {
      const result = await requirePinOrScope(makeRequest(), 'menu.prep_history');
      assert.ok(result instanceof Response, 'expected a Response');
      assert.strictEqual(result.status, 401);
      const body = await result.json();
      assert.deepStrictEqual(body, { error: 'PIN required' });
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret === undefined) delete process.env.LARIAT_PIN_SECRET;
      else process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });

  it('returns 401 Response when temp PIN cookie is for a DIFFERENT scope', async () => {
    const prevPin = process.env.LARIAT_PIN;
    const prevSecret = process.env.LARIAT_PIN_SECRET;
    process.env.LARIAT_PIN = '4242';
    delete process.env.LARIAT_PIN_SECRET;
    try {
      // Cookie is scoped to box_office; we ask for prep_history.
      const cookie = await mintTempPinCookie(['event.box_office']);
      const result = await requirePinOrScope(
        makeRequest({ cookie }),
        'menu.prep_history',
      );
      assert.ok(result instanceof Response, 'expected a Response');
      assert.strictEqual(result.status, 401);
      const body = await result.json();
      assert.deepStrictEqual(body, { error: 'PIN required' });
    } finally {
      if (prevPin === undefined) delete process.env.LARIAT_PIN;
      else process.env.LARIAT_PIN = prevPin;
      if (prevSecret !== undefined) process.env.LARIAT_PIN_SECRET = prevSecret;
    }
  });
});
