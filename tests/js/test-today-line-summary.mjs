#!/usr/bin/env node
// The Today hero should not promise six line-check shortcuts when one visible
// station is position-only.
//
// Run: node --experimental-strip-types --test tests/js/test-today-line-summary.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { lineSummaryText } = await import('../../lib/lineSummary.ts');

describe('lineSummaryText', () => {
  it('reports station count separately from line checks', () => {
    const stations = [
      { id: 'a', prog: {} },
      { id: 'b', prog: {} },
      { id: 'c', prog: {} },
      { id: 'd', prog: {} },
      { id: 'e', prog: {} },
      { id: 'f', prog: null },
    ];
    assert.equal(lineSummaryText(stations), '6 stations · 5 line checks · shortcuts 1–5');
  });
});
