#!/usr/bin/env node
// Tests for lib/pinCookie — HMAC-signed PIN cookie (A2 hardening).
// Run: node --test tests/js/test-pin-cookie-hmac.mjs
//
// Cookie format: `v1.<base64url(hmac-sha256(secret, "1"))>`.
// Legacy unsigned `1` is accepted only when the secret is unset.
//
// All sign/verify helpers are async because the implementation uses
// Web Crypto (crypto.subtle) — same code path runs in Node API routes
// AND the Next.js Edge-runtime middleware.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIGNED_COOKIE_PREFIX,
  signPinCookieValue,
  verifyPinCookieValue,
  hasValidPinCookie,
} from '../../lib/pinCookie.ts';

const SECRET = '813b7d4d4bac2cd4ce19db8574a598704c288455f3e6cc5ee0d8cd2a12e7288f';
const SECRET_ALT = 'a'.repeat(64); // different secret → different mac

describe('signPinCookieValue', () => {
  it('returns v1.<hmac> when secret is set', async () => {
    const v = await signPinCookieValue(SECRET);
    assert.ok(v.startsWith(SIGNED_COOKIE_PREFIX));
    assert.ok(v.length > SIGNED_COOKIE_PREFIX.length + 10);
  });

  it('is deterministic for the same secret', async () => {
    assert.strictEqual(await signPinCookieValue(SECRET), await signPinCookieValue(SECRET));
  });

  it('differs per secret', async () => {
    assert.notStrictEqual(await signPinCookieValue(SECRET), await signPinCookieValue(SECRET_ALT));
  });

  it('falls back to legacy "1" when secret is missing', async () => {
    assert.strictEqual(await signPinCookieValue(undefined), '1');
    assert.strictEqual(await signPinCookieValue(''), '1');
  });
});

describe('verifyPinCookieValue', () => {
  it('accepts a freshly-signed cookie', async () => {
    const signed = await signPinCookieValue(SECRET);
    assert.strictEqual(await verifyPinCookieValue(signed, SECRET), true);
  });

  it('rejects a forged bare "1" when secret is set', async () => {
    // This is the whole point of the hardening: stop the naked cookie.
    assert.strictEqual(await verifyPinCookieValue('1', SECRET), false);
  });

  it('rejects a cookie signed with a different secret', async () => {
    const signed = await signPinCookieValue(SECRET);
    assert.strictEqual(await verifyPinCookieValue(signed, SECRET_ALT), false);
  });

  it('rejects a cookie with a mangled tail', async () => {
    const signed = await signPinCookieValue(SECRET);
    const bad = signed.slice(0, -2) + 'xx';
    assert.strictEqual(await verifyPinCookieValue(bad, SECRET), false);
  });

  it('rejects a cookie with a v1 prefix but empty body', async () => {
    assert.strictEqual(await verifyPinCookieValue('v1.', SECRET), false);
  });

  it('rejects a cookie that looks signed when secret is missing', async () => {
    // Operator set PIN but forgot PIN_SECRET in some step. Don't let
    // the ghosts through the unchecked legacy path.
    const signed = await signPinCookieValue(SECRET);
    assert.strictEqual(await verifyPinCookieValue(signed, undefined), false);
  });

  it('accepts legacy "1" in no-secret fallback', async () => {
    assert.strictEqual(await verifyPinCookieValue('1', undefined), true);
  });

  it('rejects junk input in all modes', async () => {
    assert.strictEqual(await verifyPinCookieValue('', SECRET), false);
    assert.strictEqual(await verifyPinCookieValue(null, SECRET), false);
    assert.strictEqual(await verifyPinCookieValue(undefined, SECRET), false);
    assert.strictEqual(await verifyPinCookieValue('0', SECRET), false);
    assert.strictEqual(await verifyPinCookieValue('', undefined), false);
  });
});

describe('hasValidPinCookie (Request shape)', () => {
  function reqWithCookie(value) {
    return new Request('http://local/', {
      headers: value == null ? {} : { cookie: `lariat_pin_ok=${value}` },
    });
  }

  it('true for a valid signed cookie', async () => {
    const v = await signPinCookieValue(SECRET);
    assert.strictEqual(await hasValidPinCookie(reqWithCookie(v), SECRET), true);
  });

  it('false for a forged bare "1" when secret is set', async () => {
    assert.strictEqual(await hasValidPinCookie(reqWithCookie('1'), SECRET), false);
  });

  it('true for legacy "1" when secret is unset', async () => {
    assert.strictEqual(await hasValidPinCookie(reqWithCookie('1'), undefined), true);
  });

  it('false when cookie header is absent', async () => {
    assert.strictEqual(await hasValidPinCookie(reqWithCookie(null), SECRET), false);
  });

  it('ignores other cookies in the header', async () => {
    const v = await signPinCookieValue(SECRET);
    const req = new Request('http://local/', {
      headers: { cookie: `other=xxx; lariat_pin_ok=${v}; another=yyy` },
    });
    assert.strictEqual(await hasValidPinCookie(req, SECRET), true);
  });
});

// ── v2 identity format (audit P0-1) ─────────────────────────────────────────
// `v2.<sub>.<mac>` where sub is the manager_pin_users.id that logged in
// (0 = env LARIAT_PIN override). The version prefix is inside the signed
// payload; v1 signed values are hard-cut (one re-login, 8h ceiling).

const { pinCookieSubject, pinCookieSubjectFromRequest } =
  await import('../../lib/pinCookie.ts');
const nodeCrypto = await import('node:crypto');

describe('v2 identity cookie (P0-1)', () => {
  it('signs v2.<sub>.<mac> and roundtrips', async () => {
    const v = await signPinCookieValue(SECRET, 42);
    assert.ok(v.startsWith('v2.42.'), v);
    assert.strictEqual(await verifyPinCookieValue(v, SECRET), true);
    assert.strictEqual(await pinCookieSubject(v, SECRET), 42);
  });

  it('defaults to sub 0 (override login)', async () => {
    const v = await signPinCookieValue(SECRET);
    assert.ok(v.startsWith('v2.0.'), v);
    assert.strictEqual(await pinCookieSubject(v, SECRET), 0);
  });

  it('rejects a tampered sub', async () => {
    const v = await signPinCookieValue(SECRET, 42);
    const forged = v.replace('v2.42.', 'v2.43.');
    assert.strictEqual(await verifyPinCookieValue(forged, SECRET), false);
    assert.strictEqual(await pinCookieSubject(forged, SECRET), null);
  });

  it('no longer accepts the v1 signed format (hard cut)', async () => {
    const mac = nodeCrypto
      .createHmac('sha256', SECRET)
      .update('1')
      .digest('base64url');
    assert.strictEqual(await verifyPinCookieValue(`v1.${mac}`, SECRET), false);
    assert.strictEqual(await pinCookieSubject(`v1.${mac}`, SECRET), null);
  });

  it('legacy unsigned "1" maps to sub 0 outside production', async () => {
    assert.strictEqual(await pinCookieSubject('1', undefined), 0);
  });

  it('extracts the subject from a request cookie header', async () => {
    const v = await signPinCookieValue(SECRET, 7);
    const req = new Request('http://local/', {
      headers: { cookie: `lariat_pin_ok=${v}` },
    });
    assert.strictEqual(await pinCookieSubjectFromRequest(req, SECRET), 7);
  });
});

// ── production fail-closed (audit P0-4) ─────────────────────────────────────
// The legacy unsigned fallback is a dev/partial-deploy convenience only.
// In NODE_ENV=production a missing LARIAT_PIN_SECRET must fail closed:
// a bare forgeable cookie is never an auth ticket on a real deployment.

const { signTempPinCookieValue, verifyTempPinCookieValue } =
  await import('../../lib/tempPinCookie.ts');

async function inProduction(run) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return await run();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
}

describe('production fail-closed without LARIAT_PIN_SECRET (P0-4)', () => {
  it('verify rejects legacy "1" in production', async () => {
    await inProduction(async () => {
      assert.strictEqual(await verifyPinCookieValue('1', undefined), false);
    });
  });

  it('sign refuses to issue an unsigned cookie in production', async () => {
    await inProduction(async () => {
      await assert.rejects(() => signPinCookieValue(undefined), /LARIAT_PIN_SECRET/);
    });
  });

  it('temp-pin verify rejects a legacy bare id in production', async () => {
    await inProduction(async () => {
      assert.strictEqual(await verifyTempPinCookieValue('42', undefined), null);
    });
  });

  it('temp-pin sign refuses an unsigned cookie in production', async () => {
    await inProduction(async () => {
      await assert.rejects(() => signTempPinCookieValue(42, undefined), /LARIAT_PIN_SECRET/);
    });
  });

  it('signed path still works in production with the secret set', async () => {
    await inProduction(async () => {
      const v = await signPinCookieValue(SECRET);
      assert.strictEqual(await verifyPinCookieValue(v, SECRET), true);
      const t = await signTempPinCookieValue(7, SECRET);
      assert.strictEqual(await verifyTempPinCookieValue(t, SECRET), 7);
    });
  });
});
