#!/usr/bin/env node
// Cross-language parity gate for the audit_events `actor_source` taxonomy.
//
// Single source of truth: tests/fixtures/actor_source_canonical.json.
// The web reconciler constant (scripts/phase-c-reconcile.mjs ::
// CANONICAL_ACTOR_SOURCES) is asserted equal to the fixture here; the native
// enum (LariatNative/Sources/LariatModel/ActorSource.swift) is asserted equal
// to the SAME fixture in LariatNative/Tests/LariatModelTests/ActorSourceTests.
// swift. So the web set and the native enum cannot silently drift apart — a
// native write would otherwise carry an actor_source the C4 reconciler rejects
// (or vice versa), corrupting the shared audit_events attribution.
//
// Run: node --test tests/js/test-actor-source-parity.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CANONICAL_ACTOR_SOURCES } from '../../scripts/phase-c-reconcile.mjs';

const fixturePath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'actor_source_canonical.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const fixtureSet = new Set(fixture.values);

describe('actor_source canonical set — web ↔ shared fixture parity', () => {
  it('fixture is non-empty and has no duplicates', () => {
    assert.ok(fixture.values.length >= 19, `fixture too small: ${fixture.values.length}`);
    assert.equal(fixture.values.length, fixtureSet.size, 'fixture has duplicate values');
  });

  it('every CANONICAL_ACTOR_SOURCES value is in the fixture', () => {
    const extra = [...CANONICAL_ACTOR_SOURCES].filter((v) => !fixtureSet.has(v));
    assert.deepEqual(extra, [], `web set has values missing from the fixture: ${extra.join(', ')}`);
  });

  it('every fixture value is in CANONICAL_ACTOR_SOURCES', () => {
    const missing = [...fixtureSet].filter((v) => !CANONICAL_ACTOR_SOURCES.has(v));
    assert.deepEqual(missing, [], `fixture has values missing from the web set: ${missing.join(', ')}`);
  });

  it('sizes match exactly (no drift in either direction)', () => {
    assert.equal(CANONICAL_ACTOR_SOURCES.size, fixtureSet.size);
  });
});
