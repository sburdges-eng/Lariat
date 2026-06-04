#!/usr/bin/env node
// PIN-gated pages should name the exact destination and keep redirect
// sanitization same-origin only.
//
// Run: node --experimental-strip-types --test tests/js/test-login-pin-destination.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { destinationLabel, safeNextPath } = await import(
  '../../app/login-pin/pinDestination.js'
);

describe('login PIN destination copy', () => {
  it('names the requested sensitive destination from the sanitized next path', () => {
    assert.equal(destinationLabel('/costing?location=west'), 'Recipe costs');
    assert.equal(destinationLabel('/host'), 'Host Stand');
    assert.equal(destinationLabel('/management/audit-log'), 'Audit log');
  });

  it('falls back to analytics for unsafe or missing next paths', () => {
    assert.equal(safeNextPath('https://example.invalid/costing'), '/analytics');
    assert.equal(safeNextPath('//example.invalid/costing'), '/analytics');
    assert.equal(safeNextPath('/\\example.invalid/costing'), '/analytics');
    assert.equal(safeNextPath(''), '/analytics');
    assert.equal(destinationLabel('//example.invalid/costing'), 'Sales numbers');
  });
});
