#!/usr/bin/env node
// Tests for lib/beoRates — the one place a BEO's tax rate and service fee
// come from. Runs against an :memory: better-sqlite3 fixture so we never
// touch data/lariat.db, and against a REAL locations table rather than a
// stub, so a wrong column name in the SELECT fails here instead of in a 500.
//
// Covers:
//   - precedence: per-event override > locations house rate > throw
//   - a rate of 0 is a real rate, not "unset" (0% tax must not fall through)
//   - a non-numeric override is ignored, not billed
//   - taxSource / feeSource report which rung applied, for the audit log
//   - the unset error names the field and location for logs, but its MESSAGE
//     is kitchen-plain: no SQL, no column names (docs/UI_COPY_RULES.md) —
//     it is returned to the operator as a 409 body by app/api/beo/route.js
//
// Run: npx -y node@24 --experimental-strip-types --test tests/js/test-beo-rates.mjs
// (node@24 — node_modules/better-sqlite3 is built for NODE_MODULE_VERSION 137)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const { resolveBeoRates, getLocationRates, BeoRateUnsetError } = await import(
  '../../lib/beoRates.ts'
);

// Mirrors the locations columns lib/db.ts:3926-3927 add. Deliberately NO
// column defaults here: the live table defaults these to 0.0675 / 20, and a
// fixture that copied that could never reach the unset branch.
function freshDb(rows = []) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE locations (
      id TEXT PRIMARY KEY,
      name TEXT,
      tax_rate REAL,
      service_fee_pct REAL
    );
  `);
  const ins = db.prepare(
    `INSERT INTO locations (id, name, tax_rate, service_fee_pct) VALUES (?, ?, ?, ?)`,
  );
  for (const r of rows) {
    ins.run(r.id, r.name ?? r.id, r.tax_rate ?? null, r.service_fee_pct ?? null);
  }
  return db;
}

const HOUSE = { id: 'lariat', name: 'The Lariat', tax_rate: 0.0675, service_fee_pct: 20 };

describe('getLocationRates', () => {
  it('reads both house rates off the locations row', () => {
    const db = freshDb([HOUSE]);
    assert.deepEqual(getLocationRates(db, 'lariat'), { taxRate: 0.0675, serviceFeePct: 20 });
  });

  it('returns nulls for a location that has neither set', () => {
    const db = freshDb([{ id: 'patio' }]);
    assert.deepEqual(getLocationRates(db, 'patio'), { taxRate: null, serviceFeePct: null });
  });

  it('returns nulls for a location that does not exist', () => {
    const db = freshDb([HOUSE]);
    assert.deepEqual(getLocationRates(db, 'no-such-place'), {
      taxRate: null,
      serviceFeePct: null,
    });
  });
});

describe('resolveBeoRates precedence', () => {
  it('falls back to the house rate when the event says nothing', () => {
    const db = freshDb([HOUSE]);
    const r = resolveBeoRates(db, 'lariat', {});
    assert.equal(r.taxRate, 0.0675);
    assert.equal(r.serviceFeePct, 20);
    assert.equal(r.taxSource, 'location');
    assert.equal(r.feeSource, 'location');
  });

  it('lets a per-event value override the house rate', () => {
    const db = freshDb([HOUSE]);
    const r = resolveBeoRates(db, 'lariat', { tax_rate: 0.0815, service_fee_pct: 22 });
    assert.equal(r.taxRate, 0.0815);
    assert.equal(r.serviceFeePct, 22);
    assert.equal(r.taxSource, 'event');
    assert.equal(r.feeSource, 'event');
  });

  it('mixes rungs independently — event tax, house fee', () => {
    const db = freshDb([HOUSE]);
    const r = resolveBeoRates(db, 'lariat', { tax_rate: 0.0815 });
    assert.equal(r.taxRate, 0.0815);
    assert.equal(r.taxSource, 'event');
    assert.equal(r.serviceFeePct, 20);
    assert.equal(r.feeSource, 'location');
  });

  it('reads a second location at its OWN rate, not the first one', () => {
    // The whole point of moving off a literal: a second location bills
    // differently and nothing in the code should know 6.75%.
    const db = freshDb([HOUSE, { id: 'airport', tax_rate: 0.0815, service_fee_pct: 18 }]);
    const r = resolveBeoRates(db, 'airport', {});
    assert.equal(r.taxRate, 0.0815);
    assert.equal(r.serviceFeePct, 18);
  });
});

describe('resolveBeoRates edge values', () => {
  it('treats 0 as a real rate, not as unset', () => {
    // A tax-exempt booking is 0%, and a comped service fee is 0. If this ever
    // regresses to `||` instead of `??` both silently become the house rate
    // and the guest is billed tax they do not owe.
    const db = freshDb([HOUSE]);
    const r = resolveBeoRates(db, 'lariat', { tax_rate: 0, service_fee_pct: 0 });
    assert.equal(r.taxRate, 0);
    assert.equal(r.serviceFeePct, 0);
    assert.equal(r.taxSource, 'event');
    assert.equal(r.feeSource, 'event');
  });

  it('ignores a non-numeric override and uses the house rate', () => {
    const db = freshDb([HOUSE]);
    for (const bad of ['', '  ', 'abc', null, undefined, NaN, {}]) {
      const r = resolveBeoRates(db, 'lariat', { tax_rate: bad });
      assert.equal(r.taxRate, 0.0675, `override ${JSON.stringify(bad)} should not bill`);
      assert.equal(r.taxSource, 'location');
    }
  });

  it('accepts a numeric string, the shape a form actually posts', () => {
    const db = freshDb([HOUSE]);
    const r = resolveBeoRates(db, 'lariat', { tax_rate: '0.0815' });
    assert.equal(r.taxRate, 0.0815);
    assert.equal(r.taxSource, 'event');
  });
});

describe('resolveBeoRates when nothing is set', () => {
  it('throws rather than billing a constant', () => {
    const db = freshDb([{ id: 'patio' }]);
    assert.throws(() => resolveBeoRates(db, 'patio', {}), BeoRateUnsetError);
  });

  it('throws on the fee even when the tax rate is fine', () => {
    const db = freshDb([{ id: 'patio', tax_rate: 0.0675 }]);
    assert.throws(() => resolveBeoRates(db, 'patio', {}), (e) => {
      assert.ok(e instanceof BeoRateUnsetError);
      assert.equal(e.field, 'service_fee_pct');
      return true;
    });
  });

  it('carries field and location as properties, for the log', () => {
    const db = freshDb([{ id: 'patio' }]);
    try {
      resolveBeoRates(db, 'patio', {});
      assert.fail('expected BeoRateUnsetError');
    } catch (e) {
      assert.equal(e.name, 'BeoRateUnsetError');
      assert.equal(e.field, 'tax_rate');
      assert.equal(e.locationId, 'patio');
    }
  });

  it('says it in kitchen words — no SQL, no column names, no echoed id', () => {
    // app/api/beo/route.js returns this message verbatim as a 409 body, so a
    // manager reads it. docs/UI_COPY_RULES.md: no dev-style column names, no
    // underscores. Echoing the raw location id back into a SQL snippet also
    // reads as an invitation to run a statement nobody should be running.
    const db = freshDb([{ id: "patio'; DROP TABLE locations;--" }]);
    try {
      resolveBeoRates(db, "patio'; DROP TABLE locations;--", {});
      assert.fail('expected BeoRateUnsetError');
    } catch (e) {
      const m = e.message;
      assert.ok(!/UPDATE|SELECT|INSERT|DROP|;/i.test(m), `message leaks SQL: ${m}`);
      assert.ok(!m.includes('tax_rate'), `message uses a column name: ${m}`);
      assert.ok(!m.includes('_'), `message uses an underscore: ${m}`);
      assert.ok(!m.includes('DROP TABLE'), `message echoes the location id: ${m}`);
      assert.ok(/tax rate/i.test(m), `message should name the tax rate plainly: ${m}`);
    }
  });

  it('names the service fee plainly too', () => {
    const db = freshDb([{ id: 'patio', tax_rate: 0.0675 }]);
    try {
      resolveBeoRates(db, 'patio', {});
      assert.fail('expected BeoRateUnsetError');
    } catch (e) {
      assert.ok(/service fee/i.test(e.message), `unexpected: ${e.message}`);
      assert.ok(!e.message.includes('_'), `message uses an underscore: ${e.message}`);
    }
  });
});
