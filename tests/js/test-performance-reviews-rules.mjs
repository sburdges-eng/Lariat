#!/usr/bin/env node
// Unit tests for lib/performanceReviews.ts logic.
// Run: node --test tests/js/test-performance-reviews-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReview, validateScores } from '../../lib/performanceReviews.ts';

describe('classifyReview()', () => {
  it('classifies exceptional performance (>= 4.5)', () => {
    const res = classifyReview({ punctuality_score: 5, technique_score: 4, speed_score: 5 });
    assert.strictEqual(res.status, 'green');
    assert.strictEqual(res.label, 'Exceptional');
    assert.strictEqual(res.average_score, 4.7);
  });

  it('classifies great performance (4.0 - 4.4)', () => {
    const res = classifyReview({ punctuality_score: 4, technique_score: 4, speed_score: 4 });
    assert.strictEqual(res.status, 'green');
    assert.strictEqual(res.label, 'Great');
    assert.strictEqual(res.average_score, 4.0);
  });

  it('classifies good performance (3.0 - 3.9)', () => {
    const res = classifyReview({ punctuality_score: 3, technique_score: 4, speed_score: 3 });
    assert.strictEqual(res.status, 'amber');
    assert.strictEqual(res.label, 'Good');
    assert.strictEqual(res.average_score, 3.3);
  });

  it('classifies solid performance (2.5 - 2.9)', () => {
    const res = classifyReview({ punctuality_score: 2, technique_score: 3, speed_score: 3 });
    assert.strictEqual(res.status, 'amber');
    assert.strictEqual(res.label, 'Solid');
    assert.strictEqual(res.average_score, 2.7);
  });

  it('classifies needs improvement (< 2.5)', () => {
    const res = classifyReview({ punctuality_score: 2, technique_score: 2, speed_score: 2 });
    assert.strictEqual(res.status, 'red');
    assert.strictEqual(res.label, 'Needs Improvement');
    assert.strictEqual(res.average_score, 2.0);
  });

  it('handles zero or missing scores gracefully', () => {
    const res = classifyReview({ punctuality_score: 0, technique_score: 0, speed_score: 0 });
    assert.strictEqual(res.status, 'gray');
    assert.strictEqual(res.label, 'No scores');
  });
});

describe('validateScores()', () => {
  it('accepts valid 1-5 scores', () => {
    const err = validateScores({ punctuality_score: 1, technique_score: 3, speed_score: 5 });
    assert.strictEqual(err, null);
  });

  it('rejects scores below 1', () => {
    const err = validateScores({ punctuality_score: 0, technique_score: 3, speed_score: 5 });
    assert.ok(err?.includes('On Time'));
  });

  it('rejects scores above 5', () => {
    const err = validateScores({ punctuality_score: 5, technique_score: 6, speed_score: 5 });
    assert.ok(err?.includes('Technique'));
  });

  it('rejects non-numeric scores', () => {
    const err = validateScores({ punctuality_score: 5, technique_score: NaN, speed_score: 5 });
    assert.ok(err?.includes('Technique'));
  });
});
