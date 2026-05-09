#!/usr/bin/env node
// Per-reason dedup for lib/mdnsDiscovery.ts::warnOnce. Pre-fix a single
// shared `warned` boolean let the first warning suppress all unrelated
// later warnings; post-fix each distinct reason warns once.
// Run: node --experimental-strip-types --test tests/js/test-mdns-warn-once-per-reason.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mdns = await import('../../lib/mdnsDiscovery.ts');

const REASON_A = 'package not loaded';
const REASON_B = 'discovery error';

function captureWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => {
    calls.push(args);
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

describe('mdnsDiscovery.warnOnce per-reason dedup', () => {
  beforeEach(() => {
    mdns._resetWarnedReasonsForTest();
  });

  it('fires the same reason exactly once across repeat calls', () => {
    const calls = captureWarn(() => {
      mdns.warnOnce(REASON_A);
      mdns.warnOnce(REASON_A);
      mdns.warnOnce(REASON_A);
    });
    assert.equal(
      calls.length,
      1,
      `same reason should warn once, got ${calls.length}`
    );
    assert.match(String(calls[0][0]), /package not loaded/);
  });

  it('fires distinct reasons independently (one each)', () => {
    const calls = captureWarn(() => {
      mdns.warnOnce(REASON_A);
      mdns.warnOnce(REASON_B);
    });
    assert.equal(
      calls.length,
      2,
      `distinct reasons should each warn once, got ${calls.length}`
    );
    const messages = calls.map(c => String(c[0]));
    assert.ok(
      messages.some(m => m.includes(REASON_A)),
      `expected a warning containing "${REASON_A}"`
    );
    assert.ok(
      messages.some(m => m.includes(REASON_B)),
      `expected a warning containing "${REASON_B}"`
    );
  });

  it('interleaved repeats still dedup per reason (A,B,A,B → 2 warns)', () => {
    const calls = captureWarn(() => {
      mdns.warnOnce('A');
      mdns.warnOnce('B');
      mdns.warnOnce('A');
      mdns.warnOnce('B');
    });
    assert.equal(
      calls.length,
      2,
      `A,B,A,B should produce exactly 2 warns, got ${calls.length}`
    );
  });

  it('preserves the existing message format and appends Error.message', () => {
    const plain = captureWarn(() => {
      mdns.warnOnce('format-check');
    });
    assert.equal(plain.length, 1);
    assert.equal(
      String(plain[0][0]),
      '[mdnsDiscovery] disabled: format-check'
    );

    mdns._resetWarnedReasonsForTest();

    const withErr = captureWarn(() => {
      mdns.warnOnce('with-err', new Error('boom'));
    });
    assert.equal(withErr.length, 1);
    assert.equal(
      String(withErr[0][0]),
      '[mdnsDiscovery] disabled: with-err (boom)'
    );
  });
});
