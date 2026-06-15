#!/usr/bin/env node
// Unit tests for the pure KDS bump-back rule module (lib/kds.ts).
//
// Characterization tests against the REAL exports: KNOWN_STATIONS,
// isStationSlug, isIso8601Utc, hashPin, validateBumpPayload,
// bumpActionForExisting. The route's integration behavior lives in
// test-kds-bump-route.mjs; this file pins the decision logic only.
//
// Run: node --experimental-strip-types --test tests/js/test-kds-bump.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  KNOWN_STATIONS,
  isStationSlug,
  isIso8601Utc,
  hashPin,
  validateBumpPayload,
  bumpActionForExisting,
} from '../../lib/kds.ts';

// ── KNOWN_STATIONS ──────────────────────────────────────────────

describe('KNOWN_STATIONS', () => {
  it('lists the protocol §2 station slugs', () => {
    assert.deepStrictEqual([...KNOWN_STATIONS], ['grill', 'sides', 'bar']);
  });

  it('contains only lowercase slugs (all pass isStationSlug)', () => {
    for (const s of KNOWN_STATIONS) {
      assert.ok(isStationSlug(s), `${s} should be a valid station slug`);
    }
  });
});

// ── isStationSlug ───────────────────────────────────────────────

describe('isStationSlug', () => {
  it('accepts non-empty lowercased strings', () => {
    assert.equal(isStationSlug('grill'), true);
    assert.equal(isStationSlug('expo'), true); // unknown slug still valid shape
    assert.equal(isStationSlug('cold-line'), true);
    assert.equal(isStationSlug('123'), true); // digits are unchanged by toLowerCase
  });

  it('rejects empty string', () => {
    assert.equal(isStationSlug(''), false);
  });

  it('rejects mixed/upper case', () => {
    assert.equal(isStationSlug('Grill'), false);
    assert.equal(isStationSlug('GRILL'), false);
  });

  it('rejects non-string types', () => {
    assert.equal(isStationSlug(null), false);
    assert.equal(isStationSlug(undefined), false);
    assert.equal(isStationSlug(42), false);
    assert.equal(isStationSlug({}), false);
    assert.equal(isStationSlug(['grill']), false);
  });
});

// ── isIso8601Utc ────────────────────────────────────────────────

describe('isIso8601Utc', () => {
  it('accepts a canonical ISO-8601 UTC string (round-trips through toISOString)', () => {
    assert.equal(isIso8601Utc('2026-05-04T18:42:11.000Z'), true);
    assert.equal(isIso8601Utc(new Date().toISOString()), true);
  });

  it('rejects non-canonical but parseable timestamps', () => {
    // No millis / no Z — Date.parse succeeds but does not round-trip.
    assert.equal(isIso8601Utc('2026-05-04 18:42:11'), false);
    assert.equal(isIso8601Utc('2026-05-04T18:42:11Z'), false); // missing .000
    assert.equal(isIso8601Utc('2026-05-04T18:42:11+00:00'), false); // offset form
  });

  it('rejects unparseable strings', () => {
    assert.equal(isIso8601Utc('not a date'), false);
    assert.equal(isIso8601Utc(''), false);
  });

  it('rejects non-string types', () => {
    assert.equal(isIso8601Utc(1717000000), false);
    assert.equal(isIso8601Utc(null), false);
    assert.equal(isIso8601Utc(undefined), false);
    assert.equal(isIso8601Utc(new Date()), false);
  });
});

// ── hashPin ─────────────────────────────────────────────────────

describe('hashPin', () => {
  it('is deterministic: same input → same output', () => {
    assert.equal(hashPin('1234'), hashPin('1234'));
  });

  it('different inputs → different outputs', () => {
    assert.notEqual(hashPin('1234'), hashPin('1235'));
  });

  it('matches a SHA-256 hex digest (raw PIN never stored)', () => {
    const expected = createHash('sha256').update('1234').digest('hex');
    assert.equal(hashPin('1234'), expected);
    assert.equal(hashPin('1234').length, 64); // hex of 32 bytes
    assert.notEqual(hashPin('1234'), '1234');
  });
});

// ── validateBumpPayload ─────────────────────────────────────────

describe('validateBumpPayload — valid', () => {
  it('treats null body as a valid empty bump', () => {
    const v = validateBumpPayload(null);
    assert.equal(v.ok, true);
    assert.deepStrictEqual(v.payload, { bumped_at: null, station: null, cook_pin: null });
  });

  it('treats undefined body as a valid empty bump', () => {
    const v = validateBumpPayload(undefined);
    assert.equal(v.ok, true);
    assert.deepStrictEqual(v.payload, { bumped_at: null, station: null, cook_pin: null });
  });

  it('treats an empty object as a valid empty bump', () => {
    const v = validateBumpPayload({});
    assert.equal(v.ok, true);
    assert.deepStrictEqual(v.payload, { bumped_at: null, station: null, cook_pin: null });
  });

  it('accepts a fully-populated valid payload', () => {
    const v = validateBumpPayload({
      bumped_at: '2026-05-04T18:42:11.000Z',
      station: 'grill',
      cook_pin: '1234',
    });
    assert.equal(v.ok, true);
    assert.deepStrictEqual(v.payload, {
      bumped_at: '2026-05-04T18:42:11.000Z',
      station: 'grill',
      cook_pin: '1234',
    });
  });

  it('coerces explicit nulls to the null payload fields', () => {
    const v = validateBumpPayload({ bumped_at: null, station: null, cook_pin: null });
    assert.equal(v.ok, true);
    assert.deepStrictEqual(v.payload, { bumped_at: null, station: null, cook_pin: null });
  });

  it('accepts an unknown but well-formed station slug (forward compat)', () => {
    const v = validateBumpPayload({ station: 'expo' });
    assert.equal(v.ok, true);
    assert.equal(v.payload.station, 'expo');
  });
});

describe('validateBumpPayload — invalid', () => {
  it('rejects a non-object body with the documented error', () => {
    const v = validateBumpPayload('hello');
    assert.equal(v.ok, false);
    assert.equal(v.error, 'body must be a JSON object');
  });

  it('rejects a numeric body', () => {
    const v = validateBumpPayload(42);
    assert.equal(v.ok, false);
    assert.equal(v.error, 'body must be a JSON object');
  });

  it('rejects a non-canonical bumped_at', () => {
    const v = validateBumpPayload({ bumped_at: '2026-05-04 18:42:11' });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'bumped_at must be a canonical ISO-8601 UTC string');
  });

  it('rejects a numeric bumped_at (no silent coercion)', () => {
    const v = validateBumpPayload({ bumped_at: 1717000000 });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'bumped_at must be a canonical ISO-8601 UTC string');
  });

  it('rejects a mixed-case station', () => {
    const v = validateBumpPayload({ station: 'Grill' });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'station must be a non-empty lowercased slug');
  });

  it('rejects an empty-string station', () => {
    const v = validateBumpPayload({ station: '' });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'station must be a non-empty lowercased slug');
  });

  it('rejects a non-string cook_pin', () => {
    const v = validateBumpPayload({ cook_pin: 1234 });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'cook_pin must be a non-empty string when present');
  });

  it('rejects an empty-string cook_pin', () => {
    const v = validateBumpPayload({ cook_pin: '' });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'cook_pin must be a non-empty string when present');
  });
});

// ── bumpActionForExisting ───────────────────────────────────────

describe('bumpActionForExisting', () => {
  it("returns 'insert' for null existing", () => {
    assert.equal(bumpActionForExisting(null), 'insert');
  });

  it("returns 'insert' for undefined existing", () => {
    assert.equal(bumpActionForExisting(undefined), 'insert');
  });

  it("returns 'correction' for an existing row carrying a bumped_at", () => {
    assert.equal(bumpActionForExisting({ bumped_at: '2026-05-04T18:00:00.000Z' }), 'correction');
  });
});
