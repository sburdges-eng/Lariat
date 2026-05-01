#!/usr/bin/env node
// Rule-module tests for lib/pestControl.ts.
//
// Covers the pure validation paired with POST /api/pest:
// entry_type / pest / severity enum guards, sighting-requires-pest
// rule, and null/garbage-input safety. The route-integration tests
// (DB writes, audit-event emission, transactional rollback) belong
// in tests/js/test-pest-api.mjs, which does not yet exist — see
// docs/PATTERNS.md §1 audit table.
//
// FDA citation: §6-501.111 (controlling pests). The rule module
// does not yet export this as a constant — tracked in the same
// audit table. When that lands, this file should grow citation
// assertions matching the test-sds-rules / test-cleaning-rules
// shape.
//
// Run: node --experimental-strip-types --test tests/js/test-pest-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validatePestControl } from '../../lib/pestControl.ts';

// ── Shape guards ──────────────────────────────────────────────────

describe('validatePestControl — input shape', () => {
  it('rejects null', () => {
    const r = validatePestControl(null);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /object/);
  });

  it('rejects undefined', () => {
    const r = validatePestControl(undefined);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /object/);
  });

  it('rejects a non-object (string)', () => {
    // The TS signature says Partial<PestControlEntry>|null|undefined,
    // but the validator is what actually protects the route at
    // runtime — JSON.parse() can hand it any shape.
    const r = validatePestControl(/** @type {any} */ ('service_visit'));
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /object/);
  });

  it('rejects a missing entry_type', () => {
    const r = validatePestControl({});
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /entry_type/);
  });

  it('rejects an unknown entry_type', () => {
    const r = validatePestControl({ entry_type: 'fumigation' });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /entry_type/);
  });
});

// ── Entry-type enum ───────────────────────────────────────────────

describe('validatePestControl — entry_type enum', () => {
  it('accepts service_visit (vendor monthly visit)', () => {
    const r = validatePestControl({ entry_type: 'service_visit' });
    assert.equal(r.ok, true);
  });

  it('accepts trap_check (interior glue-board sweep)', () => {
    const r = validatePestControl({ entry_type: 'trap_check' });
    assert.equal(r.ok, true);
  });

  it('accepts sighting only with a pest specified', () => {
    const without = validatePestControl({ entry_type: 'sighting' });
    assert.equal(without.ok, false);
    assert.match(without.reason ?? '', /pest/);

    const withPest = validatePestControl({ entry_type: 'sighting', pest: 'roach' });
    assert.equal(withPest.ok, true);
  });
});

// ── Pest enum ─────────────────────────────────────────────────────

describe('validatePestControl — pest enum', () => {
  // The five values cover the inspector-relevant species: roaches and
  // mice are the §6-501.111 red-flag pair; flies and ants surface as
  // adjacent FOH/BOH issues; "other" is the carve-out for spiders,
  // moths, etc. without ballooning the enum.
  for (const pest of ['roach', 'mouse', 'fly', 'ant', 'other']) {
    it(`accepts pest='${pest}'`, () => {
      const r = validatePestControl({ entry_type: 'sighting', pest });
      assert.equal(r.ok, true, r.reason);
    });
  }

  it('rejects an unknown pest', () => {
    const r = validatePestControl({ entry_type: 'sighting', pest: /** @type {any} */ ('rat') });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /pest/);
  });

  it('allows a pest with a non-sighting entry (e.g. service_visit found roach evidence)', () => {
    // service_visit + pest is valid: the vendor noted what they saw.
    const r = validatePestControl({ entry_type: 'service_visit', pest: 'mouse' });
    assert.equal(r.ok, true);
  });
});

// ── Severity enum ─────────────────────────────────────────────────

describe('validatePestControl — severity enum', () => {
  for (const severity of ['low', 'medium', 'high']) {
    it(`accepts severity='${severity}'`, () => {
      const r = validatePestControl({ entry_type: 'trap_check', severity });
      assert.equal(r.ok, true, r.reason);
    });
  }

  it('rejects an unknown severity', () => {
    const r = validatePestControl({
      entry_type: 'trap_check',
      severity: /** @type {any} */ ('critical'),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /severity/);
  });

  it('allows severity to be omitted (a clean trap check has no severity)', () => {
    const r = validatePestControl({ entry_type: 'trap_check' });
    assert.equal(r.ok, true);
  });
});

// ── Composed realistic shapes ─────────────────────────────────────

describe('validatePestControl — realistic operator entries', () => {
  it('accepts a vendor service visit with notes-shaped payload', () => {
    const r = validatePestControl({
      entry_type: 'service_visit',
      vendor: 'Orkin',
      notes: 'Replaced 6 glue boards along south wall; no activity.',
    });
    assert.equal(r.ok, true);
  });

  it('accepts a high-severity roach sighting with all fields', () => {
    const r = validatePestControl({
      entry_type: 'sighting',
      pest: 'roach',
      severity: 'high',
      location: 'dish pit corner',
      action_taken: 'killed, disposed, sanitized; vendor notified',
    });
    assert.equal(r.ok, true);
  });

  it('rejects a sighting that is missing the pest, even if severity is set', () => {
    // Severity without pest is meaningless on a sighting — surface
    // the missing pest field, not severity, because that is the
    // datum the inspector will ask about.
    const r = validatePestControl({ entry_type: 'sighting', severity: 'high' });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? '', /pest/);
  });
});
