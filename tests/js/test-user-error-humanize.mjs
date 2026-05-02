#!/usr/bin/env node
// humanize(err) — kitchen-language error strings.
//
// Closes §7 P3 from the 2026-05-02 breaker audit. Replaces seven
// `setError(err.message)` surfaces with kitchen-language fallbacks.
//
// Run: node --experimental-strip-types --test tests/js/test-user-error-humanize.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { humanize } from '../../lib/userError.ts';

describe('humanize — network shapes', () => {
  it('TypeError "Failed to fetch" → "Lost connection. Try again."', () => {
    const err = new TypeError('Failed to fetch');
    assert.strictEqual(humanize(err), 'Lost connection. Try again.');
  });

  it('TypeError "NetworkError when attempting to fetch resource" → network fallback', () => {
    const err = new TypeError('NetworkError when attempting to fetch resource.');
    assert.strictEqual(humanize(err), 'Lost connection. Try again.');
  });

  it('TypeError "Load failed" (Safari) → network fallback', () => {
    const err = new TypeError('Load failed');
    assert.strictEqual(humanize(err), 'Lost connection. Try again.');
  });

  it('DOMException-shaped { name: "NetworkError" } → network fallback', () => {
    const err = { name: 'NetworkError', message: 'something' };
    assert.strictEqual(humanize(err), 'Lost connection. Try again.');
  });

  it('AbortError → network fallback (treat timeout as connection)', () => {
    const err = { name: 'AbortError', message: 'aborted' };
    assert.strictEqual(humanize(err), 'Lost connection. Try again.');
  });
});

describe('humanize — TypeError generic', () => {
  it('TypeError "Cannot read properties of undefined" → "Did not save. Try again."', () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'forEach')");
    assert.strictEqual(humanize(err), 'Did not save. Try again.');
  });
});

describe('humanize — fallback', () => {
  it('null → generic fallback', () => {
    assert.strictEqual(humanize(null), 'Something broke. Try again.');
  });

  it('undefined → generic fallback', () => {
    assert.strictEqual(humanize(undefined), 'Something broke. Try again.');
  });

  it('plain Error with non-network message → generic fallback', () => {
    const err = new Error('Server returned 500');
    assert.strictEqual(humanize(err), 'Something broke. Try again.');
  });

  it('arbitrary object → generic fallback', () => {
    assert.strictEqual(humanize({ foo: 'bar' }), 'Something broke. Try again.');
  });

  it('string with network keyword → network fallback', () => {
    assert.strictEqual(humanize('connection lost'), 'Lost connection. Try again.');
  });

  it('string without keyword → generic fallback', () => {
    assert.strictEqual(humanize('something arbitrary'), 'Something broke. Try again.');
  });
});

describe('humanize — never returns a banned phrase', () => {
  // UI_COPY_RULES.md §AVOID lists "error occurred" and "validation failed".
  // The helper must never produce either.
  it('does not contain "error occurred" or "validation failed"', () => {
    const samples = [
      humanize(null),
      humanize(undefined),
      humanize(new TypeError('foo')),
      humanize(new Error('bar')),
      humanize('baz'),
      humanize({ name: 'NetworkError' }),
    ];
    for (const s of samples) {
      assert.doesNotMatch(s, /error occurred/i, `produced banned phrase: ${s}`);
      assert.doesNotMatch(s, /validation failed/i, `produced banned phrase: ${s}`);
    }
  });
});
