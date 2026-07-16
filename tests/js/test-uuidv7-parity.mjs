#!/usr/bin/env node
// Cross-language parity gate for the DETERMINISTIC portion of UUIDv7.
//
// SSOT: tests/fixtures/uuidv7_timestamp.json. The native generator
// LariatModel/UuidV7.generate is pinned to the same fixture in UuidV7Tests.swift.
// For a given ms both stacks must emit the same 48-bit big-endian timestamp
// prefix + version '7' + variant in {8,9,a,b}. The random tail is intentionally
// not pinned (see the SecRandom follow-up: native uses a non-crypto tail today).
//
// Run: node --experimental-strip-types --test tests/js/test-uuidv7-parity.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { uuidv7, isUuidV7 } from '../../lib/uuid.ts';

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'fixtures',
      'uuidv7_timestamp.json',
    ),
    'utf8',
  ),
);

describe('uuidv7 — deterministic ms/version/variant parity with shared fixture', () => {
  it('fixture carries the parity cases', () => {
    assert.ok(fixture.cases.length >= 5, `fixture too small: ${fixture.cases.length}`);
  });

  for (const { ms, ts_hex } of fixture.cases) {
    it(`ms=${ms} → 48-bit prefix ${ts_hex}, valid v7`, () => {
      const u = uuidv7(ms);
      // isUuidV7 enforces version==7 and variant in {8,9,a,b}.
      assert.ok(isUuidV7(u), `not a canonical v7: ${u}`);
      assert.strictEqual(
        u.replace(/-/g, '').slice(0, 12),
        ts_hex,
        `ms prefix mismatch for ms=${ms}: ${u}`,
      );
    });
  }
});
