#!/usr/bin/env node
// Env-name canonicalization canary for audit F7/F8.
//
// Run: node --experimental-strip-types --test tests/js/test-env-canonical-vars.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_EXAMPLE = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
const OPERATIONS = fs.readFileSync(path.join(ROOT, 'docs/OPERATIONS.md'), 'utf8');

function legacyNamePattern(name) {
  return new RegExp(`(^|[^A-Z0-9_])${name}([^A-Z0-9_]|$)`);
}

describe('canonical env names in operator docs', () => {
  it('.env.example lists LARIAT_LOCATION_ID without the legacy LARIAT_LOCATION alias', () => {
    assert.match(ENV_EXAMPLE, /^# LARIAT_LOCATION_ID=default$/m);
    assert.doesNotMatch(ENV_EXAMPLE, /^#?\s*LARIAT_LOCATION=/m);
  });

  it('.env.example lists LARIAT_7SHIFTS_API_KEY without the legacy spelled-out alias', () => {
    assert.match(ENV_EXAMPLE, /^# LARIAT_7SHIFTS_API_KEY=/m);
    assert.doesNotMatch(ENV_EXAMPLE, /^#?\s*LARIAT_SEVENSHIFTS_API_KEY=/m);
  });

  it('OPERATIONS.md names the canonical env vars only', () => {
    assert.match(OPERATIONS, /LARIAT_LOCATION_ID/);
    assert.match(OPERATIONS, /LARIAT_7SHIFTS_API_KEY/);
    assert.doesNotMatch(OPERATIONS, legacyNamePattern('LARIAT_LOCATION'));
    assert.doesNotMatch(OPERATIONS, legacyNamePattern('LARIAT_SEVENSHIFTS_API_KEY'));
  });
});
