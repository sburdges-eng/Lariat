#!/usr/bin/env node
// Rule-module tests for lib/sds.ts.
//
// Covers the pure-decision shape paired with POST /api/sds:
// required-field guards (product_name), type checks, GHS hazard-class
// enum, ISO date for last_reviewed, and the OSHA HazCom citation
// constants the rule module is supposed to be the single source of
// truth for. The route hits a real in-memory DB; rule tests are pure.
//
// Run: node --test tests/js/test-sds-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GHS_HAZARD_CLASSES,
  SDS_CITATION,
  SDS_RETENTION_CITATION,
  PRODUCT_NAME_MAX_LEN,
  MANUFACTURER_MAX_LEN,
  HAZARD_CLASS_MAX_LEN,
  STORAGE_LOCATION_MAX_LEN,
  PDF_PATH_MAX_LEN,
  URL_MAX_LEN,
  validateSds,
} from '../../lib/sds.ts';

// ── Citations and constants ───────────────────────────────────────

describe('sds rule constants — single source of truth', () => {
  it('SDS_CITATION points to OSHA 29 CFR 1910.1200 (HazCom)', () => {
    assert.match(SDS_CITATION, /1910\.1200/);
  });

  it('SDS_RETENTION_CITATION names the SDS-on-site requirement', () => {
    // §1910.1200(g) — employers must maintain SDSes for each chemical
    assert.match(SDS_RETENTION_CITATION, /1910\.1200\(g\)/);
  });

  it('GHS_HAZARD_CLASSES exposes the inspector-facing pictogram-level hazard classes', () => {
    // Collapsed to the inspector-facing top-level categories used on
    // container labels. The formal GHS Annex 1 / HCS 2012 classes include
    // self-reactive, pyrophoric, organic peroxide, aspiration toxin,
    // STOT-SE/RE, and others totalling many more; we reduce to the
    // pictogram-level set for the printed binder index.
    assert.ok(GHS_HAZARD_CLASSES.includes('flammable'));
    assert.ok(GHS_HAZARD_CLASSES.includes('corrosive'));
    assert.ok(GHS_HAZARD_CLASSES.includes('toxic'));
    assert.ok(GHS_HAZARD_CLASSES.includes('oxidizer'));
    assert.ok(GHS_HAZARD_CLASSES.includes('irritant'));
    assert.ok(GHS_HAZARD_CLASSES.length >= 6);
  });

  it('field length bounds are positive integers', () => {
    for (const n of [
      PRODUCT_NAME_MAX_LEN,
      MANUFACTURER_MAX_LEN,
      HAZARD_CLASS_MAX_LEN,
      STORAGE_LOCATION_MAX_LEN,
      PDF_PATH_MAX_LEN,
      URL_MAX_LEN,
    ]) {
      assert.ok(Number.isInteger(n) && n > 0, `expected positive int, got ${n}`);
    }
  });
});

// ── Body-shape guards ─────────────────────────────────────────────

describe('validateSds — body shape', () => {
  it('rejects null body', () => {
    const r = validateSds(null);
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /object/);
  });

  it('rejects undefined body', () => {
    const r = validateSds(undefined);
    assert.strictEqual(r.ok, false);
  });

  it('rejects array body', () => {
    const r = validateSds([]);
    assert.strictEqual(r.ok, false);
  });

  it('rejects scalar body', () => {
    assert.strictEqual(validateSds('hello').ok, false);
    assert.strictEqual(validateSds(42).ok, false);
  });
});

// ── Required: product_name ────────────────────────────────────────

describe('validateSds — product_name (required)', () => {
  it('rejects when product_name is missing', () => {
    const r = validateSds({ manufacturer: 'Ecolab' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /product_name/);
  });

  it('rejects empty string product_name', () => {
    const r = validateSds({ product_name: '' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects whitespace-only product_name', () => {
    const r = validateSds({ product_name: '   ' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects non-string product_name', () => {
    const r = validateSds({ product_name: 99 });
    assert.strictEqual(r.ok, false);
  });

  it('accepts a non-empty product_name', () => {
    const r = validateSds({ product_name: 'Quat 256' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects product_name longer than PRODUCT_NAME_MAX_LEN', () => {
    const r = validateSds({ product_name: 'x'.repeat(PRODUCT_NAME_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /product_name|length/i);
  });

  it('accepts product_name at exactly PRODUCT_NAME_MAX_LEN (inclusive)', () => {
    const r = validateSds({ product_name: 'x'.repeat(PRODUCT_NAME_MAX_LEN) });
    assert.strictEqual(r.ok, true);
  });
});

// ── manufacturer / hazard_class / storage_location ───────────────

describe('validateSds — optional string fields', () => {
  const base = { product_name: 'Quat 256' };

  it('rejects non-string manufacturer', () => {
    const r = validateSds({ ...base, manufacturer: 5 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /manufacturer/);
  });

  it('rejects manufacturer longer than MANUFACTURER_MAX_LEN', () => {
    const r = validateSds({ ...base, manufacturer: 'm'.repeat(MANUFACTURER_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
  });

  it('accepts manufacturer at exactly MANUFACTURER_MAX_LEN (inclusive)', () => {
    const r = validateSds({ ...base, manufacturer: 'm'.repeat(MANUFACTURER_MAX_LEN) });
    assert.strictEqual(r.ok, true);
  });

  it('rejects non-string storage_location', () => {
    const r = validateSds({ ...base, storage_location: false });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /storage_location/);
  });

  it('rejects storage_location longer than STORAGE_LOCATION_MAX_LEN', () => {
    const r = validateSds({ ...base, storage_location: 'x'.repeat(STORAGE_LOCATION_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
  });
});

// ── hazard_class — GHS enum ───────────────────────────────────────

describe('validateSds — hazard_class (GHS enum)', () => {
  const base = { product_name: 'Quat 256' };

  it('accepts a known GHS class — flammable', () => {
    const r = validateSds({ ...base, hazard_class: 'flammable' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts a known GHS class — corrosive', () => {
    const r = validateSds({ ...base, hazard_class: 'corrosive' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts case-insensitively (FLAMMABLE)', () => {
    const r = validateSds({ ...base, hazard_class: 'FLAMMABLE' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects unknown hazard class', () => {
    const r = validateSds({ ...base, hazard_class: 'spicy' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /hazard_class/);
  });

  it('rejects non-string hazard_class', () => {
    const r = validateSds({ ...base, hazard_class: 7 });
    assert.strictEqual(r.ok, false);
  });

  it('accepts missing hazard_class (optional field)', () => {
    const r = validateSds({ ...base });
    assert.strictEqual(r.ok, true);
  });
});

// ── pdf_path / url ────────────────────────────────────────────────

describe('validateSds — file references', () => {
  const base = { product_name: 'Quat 256' };

  it('rejects non-string pdf_path', () => {
    const r = validateSds({ ...base, pdf_path: 1 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /pdf_path/);
  });

  it('rejects pdf_path longer than PDF_PATH_MAX_LEN', () => {
    const r = validateSds({ ...base, pdf_path: 'p'.repeat(PDF_PATH_MAX_LEN + 1) });
    assert.strictEqual(r.ok, false);
  });

  it('accepts a relative pdf_path', () => {
    const r = validateSds({ ...base, pdf_path: 'sds/quat-256.pdf' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts an http(s) url', () => {
    const r = validateSds({ ...base, url: 'https://example.com/sds.pdf' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects url that is not http/https', () => {
    const r = validateSds({ ...base, url: 'ftp://example.com/sds.pdf' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /url/);
  });

  it('rejects url longer than URL_MAX_LEN', () => {
    const r = validateSds({ ...base, url: 'https://example.com/' + 'x'.repeat(URL_MAX_LEN) });
    assert.strictEqual(r.ok, false);
  });

  it('rejects non-string url', () => {
    const r = validateSds({ ...base, url: { href: 'x' } });
    assert.strictEqual(r.ok, false);
  });
});

// ── last_reviewed ────────────────────────────────────────────────

describe('validateSds — last_reviewed (ISO date)', () => {
  const base = { product_name: 'Quat 256' };

  it('accepts YYYY-MM-DD form', () => {
    const r = validateSds({ ...base, last_reviewed: '2026-04-29' });
    assert.strictEqual(r.ok, true);
  });

  it('rejects mm/dd/yyyy form', () => {
    const r = validateSds({ ...base, last_reviewed: '04/29/2026' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /last_reviewed/);
  });

  it('rejects unparseable date', () => {
    const r = validateSds({ ...base, last_reviewed: 'tuesday' });
    assert.strictEqual(r.ok, false);
  });

  it('rejects non-string last_reviewed', () => {
    const r = validateSds({ ...base, last_reviewed: 20260429 });
    assert.strictEqual(r.ok, false);
  });

  it('accepts missing last_reviewed (route fills with today)', () => {
    const r = validateSds(base);
    assert.strictEqual(r.ok, true);
  });
});

// ── last_reviewed phantom-date guard ─────────────────────────────
//
// Date.parse silently normalizes invalid calendar dates: '2026-02-30'
// becomes 2026-03-02 instead of returning NaN, so a format-only check
// would let the corruption through. The corruption is invisible to the
// inspector-facing "current SDS" date check — the operator-typed string
// renders as Feb 30 but sorts/compares as Mar 2. The validator must
// round-trip the parsed Y/M/D back to the input.
//
// Audit reference: docs/audit/2026-05-08-codebase-audit.md §2 (HACCP
// MEDIUM, sds last_reviewed phantom dates).

describe('validateSds — last_reviewed phantom dates', () => {
  const base = { product_name: 'Quat 256' };

  it('rejects 2026-02-30 (Date.parse silently normalizes to Mar 2)', () => {
    const r = validateSds({ ...base, last_reviewed: '2026-02-30' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not a real calendar date/i);
  });

  it('rejects 2025-13-01 (month 13 does not exist)', () => {
    const r = validateSds({ ...base, last_reviewed: '2025-13-01' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /last_reviewed/);
  });

  it('rejects 2026-04-31 (April only has 30 days)', () => {
    const r = validateSds({ ...base, last_reviewed: '2026-04-31' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not a real calendar date/i);
  });

  it('rejects 2026-06-31 (June only has 30 days)', () => {
    const r = validateSds({ ...base, last_reviewed: '2026-06-31' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /not a real calendar date/i);
  });

  it('accepts 2026-02-28 (real date, regression guard)', () => {
    const r = validateSds({ ...base, last_reviewed: '2026-02-28' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts 2024-02-29 (leap year, regression guard)', () => {
    const r = validateSds({ ...base, last_reviewed: '2024-02-29' });
    assert.strictEqual(r.ok, true);
  });

  it('accepts 2026-12-31 (year boundary, regression guard)', () => {
    const r = validateSds({ ...base, last_reviewed: '2026-12-31' });
    assert.strictEqual(r.ok, true);
  });
});

// ── active flag ──────────────────────────────────────────────────

describe('validateSds — active flag', () => {
  const base = { product_name: 'Quat 256' };

  it('accepts active=true', () => {
    assert.strictEqual(validateSds({ ...base, active: true }).ok, true);
  });

  it('accepts active=false', () => {
    assert.strictEqual(validateSds({ ...base, active: false }).ok, true);
  });

  it('accepts active=1 / 0 (route coerces)', () => {
    assert.strictEqual(validateSds({ ...base, active: 1 }).ok, true);
    assert.strictEqual(validateSds({ ...base, active: 0 }).ok, true);
  });

  it('rejects active as a string', () => {
    const r = validateSds({ ...base, active: 'yes' });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /active/);
  });

  it('rejects active as an object', () => {
    const r = validateSds({ ...base, active: { on: true } });
    assert.strictEqual(r.ok, false);
  });

  it('accepts missing active (route defaults to 1)', () => {
    assert.strictEqual(validateSds(base).ok, true);
  });
});

// ── cook_id ───────────────────────────────────────────────────────

describe('validateSds — cook_id', () => {
  const base = { product_name: 'Quat 256' };

  it('rejects non-string cook_id', () => {
    const r = validateSds({ ...base, cook_id: 99 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /cook_id/);
  });

  it('accepts missing cook_id', () => {
    assert.strictEqual(validateSds(base).ok, true);
  });
});

// ── Normalized value on success ───────────────────────────────────

describe('validateSds — normalized value', () => {
  it('returns trimmed strings on ok', () => {
    const r = validateSds({
      product_name: '  Quat 256  ',
      manufacturer: '  Ecolab  ',
      hazard_class: '  Corrosive  ',
    });
    assert.strictEqual(r.ok, true);
    assert.ok(r.value);
    assert.strictEqual(r.value.product_name, 'Quat 256');
    assert.strictEqual(r.value.manufacturer, 'Ecolab');
    assert.strictEqual(r.value.hazard_class, 'corrosive'); // canonicalized lowercase
  });

  it('value fields are null when input is absent', () => {
    const r = validateSds({ product_name: 'Quat 256' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.manufacturer, null);
    assert.strictEqual(r.value.hazard_class, null);
    assert.strictEqual(r.value.url, null);
    assert.strictEqual(r.value.pdf_path, null);
  });
});
