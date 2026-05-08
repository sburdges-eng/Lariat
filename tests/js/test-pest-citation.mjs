#!/usr/bin/env node
// Citation-export tests for lib/pestControl.ts.
//
// Every other HACCP rule module (cleaning, sanitizer, calibrations,
// sds, receiving, tphc, cooling, tempLog, dateMarks, sickWorker)
// exports its controlling FDA / OSHA citation as a named string
// constant per CLAUDE.md: "the rule module is the single source of
// truth for thresholds and FDA/CO citations." Pest control was the
// last gap — see docs/audit/2026-05-08-codebase-audit.md §2 (HACCP
// HIGH).
//
// Convention pin (matches lib/cleaning.ts CLEANING_CITATION,
// lib/sds.ts SDS_CITATION): a single exported string of the shape
// 'FDA §X-XXX.XX — short description'. The validator return shape
// (`{ok, reason}`) does not carry the citation in those modules,
// so this PR also leaves validatePestControl's signature unchanged
// — the constant is consumed by the route / UI / inspector tooling.
//
// Run: node --experimental-strip-types --test tests/js/test-pest-citation.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PEST_CITATION, validatePestControl } from '../../lib/pestControl.ts';

describe('PEST_CITATION constant', () => {
  it('is exported as a non-empty string', () => {
    assert.equal(typeof PEST_CITATION, 'string');
    assert.ok(PEST_CITATION.length > 0, 'PEST_CITATION must not be empty');
  });

  it('cites FDA §6-501.111 (controlling pests on the premises)', () => {
    // §6-501.111 is the controlling FDA Food Code section for pest
    // presence. An inspector pulling citations programmatically
    // must see this exact §-cite, not a paraphrase.
    assert.match(PEST_CITATION, /§6-501\.111/);
  });

  it('matches the sibling-module shape (FDA §-cite — short description)', () => {
    // Same shape as CLEANING_CITATION / SDS_CITATION:
    //   "FDA §X-XXX.XX — <kitchen-language description>"
    // The em-dash separator is load-bearing — it is what the UI
    // tooltip splits on when surfacing the §-cite tile.
    assert.match(PEST_CITATION, /^FDA §6-501\.111 — /);
  });
});

describe('validatePestControl shape (unchanged)', () => {
  // Sibling modules (cleaning, sds) return {ok, reason} only — no
  // citation field on rejection. We mirror that here so the route
  // layer doesn't need to learn a pest-specific shape.
  it('returns {ok: true} on a valid input with no extra fields', () => {
    const r = validatePestControl({ entry_type: 'service_visit' });
    assert.equal(r.ok, true);
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'citation'), false);
  });

  it('returns {ok: false, reason} on a rejection with no citation field', () => {
    const r = validatePestControl({ entry_type: 'fumigation' });
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'citation'), false);
  });
});
