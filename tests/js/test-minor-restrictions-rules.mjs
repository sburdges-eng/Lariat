#!/usr/bin/env node
// Tests for lib/minorRestrictions — L5 (CO YEOA + federal HOs 14-16).
// Run: node --experimental-strip-types --test tests/js/test-minor-restrictions-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MINOR_PROHIBITION_CITATION,
  isStationProhibitedForMinor,
  evaluateMinorAssignment,
} from '../../lib/minorRestrictions.ts';

describe('isStationProhibitedForMinor — pattern coverage', () => {
  // Stations a minor MAY work (no power-driven hazard pattern hit).
  it('allows the line', () => {
    assert.strictEqual(isStationProhibitedForMinor('line'), false);
  });
  it('allows expo', () => {
    assert.strictEqual(isStationProhibitedForMinor('expo'), false);
  });
  it('allows dish', () => {
    assert.strictEqual(isStationProhibitedForMinor('dish'), false);
  });
  it('allows garmo / plate-up', () => {
    assert.strictEqual(isStationProhibitedForMinor('garmo'), false);
    assert.strictEqual(isStationProhibitedForMinor('plate-up'), false);
  });

  // Stations covered by HOs 10/11/14 — must be flagged.
  it('flags slicer station', () => {
    assert.strictEqual(isStationProhibitedForMinor('slicer'), true);
  });
  it('flags slicer-1 (numeric suffix)', () => {
    assert.strictEqual(isStationProhibitedForMinor('slicer-1'), true);
  });
  it('flags meat-grinder', () => {
    assert.strictEqual(isStationProhibitedForMinor('meat-grinder'), true);
  });
  it('flags prep (exact)', () => {
    assert.strictEqual(isStationProhibitedForMinor('prep'), true);
  });
  it('flags prep-cold (hyphen)', () => {
    assert.strictEqual(isStationProhibitedForMinor('prep-cold'), true);
  });
  it('flags prep_hot (underscore)', () => {
    assert.strictEqual(isStationProhibitedForMinor('prep_hot'), true);
  });
  it('flags fryer (exact)', () => {
    assert.strictEqual(isStationProhibitedForMinor('fryer'), true);
  });
  it('flags fryer-1', () => {
    assert.strictEqual(isStationProhibitedForMinor('fryer-1'), true);
  });
  it('flags fry-station', () => {
    assert.strictEqual(isStationProhibitedForMinor('fry-station'), true);
  });
  it('flags bakery', () => {
    assert.strictEqual(isStationProhibitedForMinor('bakery'), true);
  });
  it('flags hobart-mixer', () => {
    assert.strictEqual(isStationProhibitedForMinor('hobart-mixer'), true);
  });

  // Defensive: case-insensitive and whitespace-tolerant.
  it('matches case-insensitively', () => {
    assert.strictEqual(isStationProhibitedForMinor('SLICER'), true);
    assert.strictEqual(isStationProhibitedForMinor('Prep'), true);
  });
  it('trims surrounding whitespace', () => {
    assert.strictEqual(isStationProhibitedForMinor('  slicer  '), true);
  });

  // Bad input — never throws, returns false.
  it('returns false for empty string', () => {
    assert.strictEqual(isStationProhibitedForMinor(''), false);
  });
  it('returns false for whitespace-only', () => {
    assert.strictEqual(isStationProhibitedForMinor('   '), false);
  });
  it('returns false for non-string', () => {
    // @ts-expect-error - intentional bad input
    assert.strictEqual(isStationProhibitedForMinor(42), false);
    // @ts-expect-error - intentional bad input
    assert.strictEqual(isStationProhibitedForMinor(null), false);
    // @ts-expect-error - intentional bad input
    assert.strictEqual(isStationProhibitedForMinor(undefined), false);
  });

  // "prep" must be word-anchored — a station like "preprocessor" should
  // NOT match (it's a synthetic example but pins the pattern semantics).
  it('does not match "preprocessor" (anchored)', () => {
    assert.strictEqual(isStationProhibitedForMinor('preprocessor'), false);
  });
});

describe('evaluateMinorAssignment', () => {
  it('non-minor on prohibited station: ok', () => {
    const r = evaluateMinorAssignment({ is_minor: false, station_id: 'slicer' });
    assert.deepStrictEqual(r, { ok: true });
  });
  it('non-minor on allowed station: ok', () => {
    const r = evaluateMinorAssignment({ is_minor: false, station_id: 'line' });
    assert.deepStrictEqual(r, { ok: true });
  });
  it('minor on allowed station: ok', () => {
    const r = evaluateMinorAssignment({ is_minor: true, station_id: 'line' });
    assert.deepStrictEqual(r, { ok: true });
  });
  it('minor on prohibited station: blocks with citation', () => {
    const r = evaluateMinorAssignment({ is_minor: true, station_id: 'slicer' });
    assert.strictEqual(r.ok, false);
    if (r.ok === false) {
      assert.match(r.reason, /minor/i);
      assert.ok(r.citation.length > 0);
      assert.strictEqual(r.citation, MINOR_PROHIBITION_CITATION);
    }
  });
});

describe('citation constant', () => {
  it('is non-empty and references YEOA + HOs', () => {
    assert.ok(MINOR_PROHIBITION_CITATION.length > 0);
    assert.match(MINOR_PROHIBITION_CITATION, /YEOA/);
    assert.match(MINOR_PROHIBITION_CITATION, /Hazardous Orders/i);
  });
});
