#!/usr/bin/env node
// Tests for lib/pin's shared `requirePin` helper.
//
// History: this function was duplicated as a local async function in 22+
// route files (audit 2026-05-08 §1, defense-in-depth opportunity). This
// test pins the shared export's behavior so future hardening (e.g. a
// `Vary: Cookie` response header, deny-side logging, rate-limit hooks)
// can be added in one place and verified here.
//
// Pure extraction guard — body MUST stay byte-identical to the local
// duplicates that were removed: returns null when the cookie is valid
// (or PIN gating is disabled), 401 Response with `{error:'PIN required'}`
// when the cookie is missing/invalid.
//
// Run: npx tsx --test tests/js/test-pin-helper-shared.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { requirePin } = await import('../../lib/pin.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

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
