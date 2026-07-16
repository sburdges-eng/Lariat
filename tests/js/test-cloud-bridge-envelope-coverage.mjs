#!/usr/bin/env node
// Coverage gate: every table on the cloud-bridge push allow-list (ALLOWED_TABLES)
// must have a frozen golden envelope
// (tests/fixtures/cloud-bridge/golden-envelope.<table>.json), and there must be
// no stale fixture for a table that has been removed from the allow-list.
//
// Cloned from the allow-list-vs-filesystem shape of tests/js/test-pin-gate-
// coverage.mjs: a new pushable table can't merge without its golden envelope
// (the freeze test would otherwise never cover it); a dropped table can't leave
// a dangling fixture behind. Part of C.3 in the 2026-07-16 parity-harness spec.
//
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-envelope-coverage.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const { ALLOWED_TABLES } = await import('../../lib/cloudBridgeQueue.ts');

const FIX_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'cloud-bridge',
);
const fixtureTables = new Set(
  fs
    .readdirSync(FIX_DIR)
    .map((f) => f.match(/^golden-envelope\.(.+)\.json$/))
    .filter(Boolean)
    .map((m) => m[1]),
);
const allowed = new Set(ALLOWED_TABLES);

const REGEN = 'run: node --experimental-strip-types scripts/gen-cloud-bridge-golden-envelopes.mjs';

describe('cloud-bridge golden-envelope coverage', () => {
  it('ALLOWED_TABLES parses to a non-empty set', () => {
    assert.ok(allowed.size >= 1, 'ALLOWED_TABLES is empty — parser/import regression?');
  });

  it('every pushable table has a golden envelope fixture', () => {
    const missing = [...allowed].filter((t) => !fixtureTables.has(t));
    assert.deepEqual(missing, [], `pushable tables missing a golden envelope: ${missing.join(', ')} (${REGEN})`);
  });

  it('no stale golden envelope for a non-allow-listed table', () => {
    const stale = [...fixtureTables].filter((t) => !allowed.has(t));
    assert.deepEqual(stale, [], `stale golden-envelope fixtures for tables no longer on the allow-list: ${stale.join(', ')}`);
  });

  it('each fixture declares a table matching its filename', () => {
    for (const t of fixtureTables) {
      const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, `golden-envelope.${t}.json`), 'utf8'));
      assert.equal(fx.table, t, `golden-envelope.${t}.json declares table='${fx.table}', expected '${t}'`);
    }
  });
});
