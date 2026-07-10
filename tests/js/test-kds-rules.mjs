#!/usr/bin/env node
// Tests for lib/kds — pure rule module for KDS bump-back (protocol §3).
// Run: node --experimental-strip-types --test tests/js/test-kds-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_STATIONS,
  isStationSlug,
  isIso8601Utc,
  hashPin,
  validateBumpPayload,
  bumpActionForExisting,
} from '../../lib/kds.ts';
import { verifyPin } from '../../lib/pinHash.ts';

// ── isStationSlug ──────────────────────────────────────────────────

describe('isStationSlug', () => {
  it('accepts known v1 stations', () => {
    for (const s of KNOWN_STATIONS) {
      assert.equal(isStationSlug(s), true, `${s} should be valid`);
    }
  });

  it('accepts unknown but well-formed lowercased slugs', () => {
    // Per protocol §2: KDS renders unknown stations with the default
    // chip — the API must accept them so a new station can roll out
    // without a coordinated deploy.
    assert.equal(isStationSlug('expo'), true);
    assert.equal(isStationSlug('cold-line'), true);
    assert.equal(isStationSlug('a'), true);
  });

  it('rejects mixed case', () => {
    assert.equal(isStationSlug('Grill'), false);
    assert.equal(isStationSlug('BAR'), false);
  });

  it('rejects empty / non-string', () => {
    assert.equal(isStationSlug(''), false);
    assert.equal(isStationSlug(null), false);
    assert.equal(isStationSlug(undefined), false);
    assert.equal(isStationSlug(42), false);
    assert.equal(isStationSlug({}), false);
  });
});

// ── isIso8601Utc ───────────────────────────────────────────────────

describe('isIso8601Utc', () => {
  it('accepts canonical Date.toISOString output', () => {
    assert.equal(isIso8601Utc('2026-05-04T18:42:11.000Z'), true);
    assert.equal(isIso8601Utc(new Date().toISOString()), true);
  });

  it('accepts bare-seconds form — protocol §3\'s own request example, and what ' +
     'the Swift client\'s default ISO8601DateFormatter actually sends', () => {
    assert.equal(isIso8601Utc('2026-05-04T18:42:11Z'), true);
  });

  it('rejects non-canonical forms even if Date can parse them', () => {
    // Wrong separator or a non-Z offset — not the wire contract's shape.
    assert.equal(isIso8601Utc('2026-05-04 18:42:11'), false);
    assert.equal(isIso8601Utc('2026-05-04T18:42:11+00:00'), false);
  });

  it('rejects garbage', () => {
    assert.equal(isIso8601Utc(''), false);
    assert.equal(isIso8601Utc('not a date'), false);
    assert.equal(isIso8601Utc(null), false);
    assert.equal(isIso8601Utc(1717000000), false);
  });
});

// ── hashPin ────────────────────────────────────────────────────────

describe('hashPin', () => {
  it('returns a salted PBKDF2 string, not unsalted SHA-256 (audit 2026-07-10 P0-3)', () => {
    const h = hashPin('1234');
    assert.match(h, /^p1\$/);
    assert.equal(verifyPin('1234', h), true);
  });

  it('salts — same PIN yields different hashes', () => {
    assert.notEqual(hashPin('1234'), hashPin('1234'));
  });

  it('distinguishes different PINs on verify', () => {
    const h = hashPin('1234');
    assert.equal(verifyPin('1234', h), true);
    assert.equal(verifyPin('1235', h), false);
  });

  it('does not echo the raw PIN in its output', () => {
    // The raw PIN must not appear anywhere in the hash. Catches a
    // future regression where someone "helpfully" changes hashPin
    // to prefix-with-PIN-for-debugging.
    const h = hashPin('1234');
    assert.equal(h.includes('1234'), false);
  });
});

// ── validateBumpPayload ────────────────────────────────────────────

describe('validateBumpPayload', () => {
  it('accepts null body — fully empty bump is valid', () => {
    const v = validateBumpPayload(null);
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.deepStrictEqual(v.payload, { bumped_at: null, station: null, cook_pin: null });
    }
  });

  it('accepts an empty object', () => {
    const v = validateBumpPayload({});
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.deepStrictEqual(v.payload, { bumped_at: null, station: null, cook_pin: null });
    }
  });

  it('accepts a fully-populated valid payload', () => {
    const iso = new Date().toISOString();
    const v = validateBumpPayload({ bumped_at: iso, station: 'grill', cook_pin: '1234' });
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.deepStrictEqual(v.payload, { bumped_at: iso, station: 'grill', cook_pin: '1234' });
    }
  });

  it('rejects non-object body', () => {
    const v = validateBumpPayload('not an object');
    assert.equal(v.ok, false);
  });

  it('rejects bumped_at that is not canonical ISO-8601 UTC', () => {
    const v = validateBumpPayload({ bumped_at: '2026-05-04 18:42:11' });
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /bumped_at/);
  });

  it('rejects mixed-case station', () => {
    const v = validateBumpPayload({ station: 'Grill' });
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /station/);
  });

  it('rejects empty-string cook_pin (use null/absent for anonymous)', () => {
    const v = validateBumpPayload({ cook_pin: '' });
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /cook_pin/);
  });

  it('treats explicit null on optional fields as absent', () => {
    const v = validateBumpPayload({ bumped_at: null, station: null, cook_pin: null });
    assert.equal(v.ok, true);
  });

  it('ignores unknown fields (forward compat)', () => {
    // Future protocol revisions may add fields. v2 routes must not
    // 422 on a v3 KDS that sends a new field — we just don't store it.
    const v = validateBumpPayload({ station: 'grill', future_field: 'whatever' });
    assert.equal(v.ok, true);
  });
});

// ── bumpActionForExisting ──────────────────────────────────────────

describe('bumpActionForExisting', () => {
  it("returns 'insert' for a fresh ticket", () => {
    assert.equal(bumpActionForExisting(null), 'insert');
    assert.equal(bumpActionForExisting(undefined), 'insert');
  });

  it("returns 'correction' when a row already exists", () => {
    assert.equal(bumpActionForExisting({ bumped_at: '2026-05-04T18:42:11.000Z' }), 'correction');
  });
});
