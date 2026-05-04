#!/usr/bin/env node
// Tests for lib/beoCourses — pure rule module for BEO course payloads.
// Run: node --experimental-strip-types --test tests/js/test-beo-courses-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isIso8601Utc,
  validateCoursePayload,
  nextSortOrder,
  parseCourseIdPatch,
} from '../../lib/beoCourses.ts';

describe('isIso8601Utc', () => {
  it('accepts canonical Date.toISOString output', () => {
    assert.equal(isIso8601Utc('2026-05-04T19:30:00.000Z'), true);
  });
  it('rejects "Z without milliseconds"', () => {
    assert.equal(isIso8601Utc('2026-05-04T19:30:00Z'), false);
  });
  it('rejects space-separated date-time', () => {
    assert.equal(isIso8601Utc('2026-05-04 19:30:00'), false);
  });
  it('rejects garbage', () => {
    assert.equal(isIso8601Utc(''), false);
    assert.equal(isIso8601Utc(null), false);
    assert.equal(isIso8601Utc(1717000000), false);
  });
});

describe('validateCoursePayload', () => {
  it('accepts a well-formed payload', () => {
    const r = validateCoursePayload({
      course_label: 'Entree',
      fire_at: '2026-05-04T19:30:00.000Z',
      notes: 'no sauce on side',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.payload.course_label, 'Entree');
      assert.equal(r.payload.fire_at, '2026-05-04T19:30:00.000Z');
      assert.equal(r.payload.notes, 'no sauce on side');
      assert.equal(r.payload.sort_order, null);
    }
  });

  it('rejects missing course_label', () => {
    const r = validateCoursePayload({ fire_at: '2026-05-04T19:30:00.000Z' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /course_label/);
  });

  it('rejects empty course_label after trim', () => {
    const r = validateCoursePayload({ course_label: '   ', fire_at: '2026-05-04T19:30:00.000Z' });
    assert.equal(r.ok, false);
  });

  it('rejects course_label longer than 80 chars', () => {
    const r = validateCoursePayload({
      course_label: 'x'.repeat(81),
      fire_at: '2026-05-04T19:30:00.000Z',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /too long/);
  });

  it('rejects non-canonical fire_at', () => {
    const r = validateCoursePayload({ course_label: 'Entree', fire_at: '2026-05-04 19:30' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /fire_at/);
  });

  it('treats notes:null as absent (not an error)', () => {
    const r = validateCoursePayload({
      course_label: 'Entree',
      fire_at: '2026-05-04T19:30:00.000Z',
      notes: null,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.payload.notes, null);
  });

  it('rejects non-integer sort_order', () => {
    const r = validateCoursePayload({
      course_label: 'Entree',
      fire_at: '2026-05-04T19:30:00.000Z',
      sort_order: 'not a number',
    });
    assert.equal(r.ok, false);
  });

  it('rejects negative sort_order', () => {
    const r = validateCoursePayload({
      course_label: 'Entree',
      fire_at: '2026-05-04T19:30:00.000Z',
      sort_order: -1,
    });
    assert.equal(r.ok, false);
  });
});

describe('nextSortOrder', () => {
  it('returns 0 when no prior courses', () => {
    assert.equal(nextSortOrder(null), 0);
    assert.equal(nextSortOrder(undefined), 0);
  });

  it('appends with a +10 step (room to insert in between)', () => {
    assert.equal(nextSortOrder(0), 10);
    assert.equal(nextSortOrder(20), 30);
  });

  it('treats negative existing as 0 (corruption guard)', () => {
    assert.equal(nextSortOrder(-5), 10);
  });
});

describe('parseCourseIdPatch', () => {
  it('returns absent when body has no course_id key', () => {
    assert.equal(parseCourseIdPatch({}).kind, 'absent');
    assert.equal(parseCourseIdPatch(null).kind, 'absent');
    assert.equal(parseCourseIdPatch(undefined).kind, 'absent');
  });

  it('returns clear when course_id is explicit null', () => {
    assert.equal(parseCourseIdPatch({ course_id: null }).kind, 'clear');
  });

  it('returns set with the integer when course_id is a positive integer', () => {
    const r = parseCourseIdPatch({ course_id: 42 });
    assert.equal(r.kind, 'set');
    if (r.kind === 'set') assert.equal(r.course_id, 42);
  });

  it('throws on non-integer / non-positive values', () => {
    assert.throws(() => parseCourseIdPatch({ course_id: 'abc' }), /positive integer/);
    assert.throws(() => parseCourseIdPatch({ course_id: 0 }), /positive integer/);
    assert.throws(() => parseCourseIdPatch({ course_id: -1 }), /positive integer/);
    assert.throws(() => parseCourseIdPatch({ course_id: 1.5 }), /positive integer/);
  });
});
