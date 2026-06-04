#!/usr/bin/env node
// Runtime UX source checks for small, easily-regressed copy/control states.
//
// Run: node --test tests/js/test-runtime-ux-source.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const kdsPunchSource = fs.readFileSync(
  new URL('../../app/kds/punch/page.jsx', import.meta.url),
  'utf8',
);
const barSource = fs.readFileSync(
  new URL('../../app/bar/page.jsx', import.meta.url),
  'utf8',
);

describe('runtime UX source checks', () => {
  it('does not render a disabled remove button on the first KDS punch line', () => {
    assert.doesNotMatch(kdsPunchSource, /disabled=\{lines\.length === 1\}/);
    assert.match(kdsPunchSource, /lines\.length > 1/);
  });

  it('gives setup-oriented bar empty-state copy', () => {
    assert.doesNotMatch(barSource, /No cocktail recipes found\./);
    assert.match(barSource, /No bar recipes are ready for pour-cost tracking yet\./);
    assert.match(barSource, /Open recipes/);
  });
});
