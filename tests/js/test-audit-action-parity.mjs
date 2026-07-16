#!/usr/bin/env node
// Cross-language parity gate for the `audit_events.action` verb set.
//
// SSOT: tests/fixtures/audit_event_actions.json. The native enum
// AuditEventAction is pinned to the same fixture in AuditEventActionTests.swift.
// This test pins the WEB side by introspecting the real
// `CHECK(action IN ('insert', ...))` constraint from the initialized schema, so
// the fixture can never drift from the actual DDL — and, transitively, the
// native enum can never emit a verb the web CHECK would reject (a runtime
// constraint failure on the shared audit_events table).
//
// Run: node --experimental-strip-types --test tests/js/test-audit-action-parity.mjs
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

// Isolated temp DB — never touches the real data/lariat.db.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-audit-action-parity-'));
const db = await import('../../lib/db.ts');
db.setDbPathForTest(path.join(TMP_DIR, 'lariat-test.db'));
const testDb = db.getDb(); // initializes the real schema on the temp DB

after(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

const fixturePath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'audit_event_actions.json',
);
const fixtureSet = new Set(JSON.parse(fs.readFileSync(fixturePath, 'utf8')).values);

// Introspect the live CHECK(action IN ('insert', ...)) from the created table.
const row = testDb
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_events'")
  .get();
const checkMatch = row?.sql?.match(/CHECK\s*\(\s*action\s+IN\s*\(([^)]*)\)/i);
const schemaActions = checkMatch
  ? [...checkMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
  : [];
const schemaSet = new Set(schemaActions);

describe('audit_events.action verb set — web CHECK ↔ shared fixture parity', () => {
  it('the schema exposes a non-empty, unique action CHECK set', () => {
    assert.ok(
      schemaActions.length >= 5,
      `parsed too few actions from the DDL: ${JSON.stringify(schemaActions)}`,
    );
    assert.equal(schemaActions.length, schemaSet.size, 'schema CHECK has duplicate actions');
  });

  it('every schema CHECK action is in the fixture', () => {
    const extra = [...schemaSet].filter((v) => !fixtureSet.has(v));
    assert.deepEqual(extra, [], `schema has actions missing from the fixture: ${extra.join(', ')}`);
  });

  it('every fixture action is in the schema CHECK', () => {
    const missing = [...fixtureSet].filter((v) => !schemaSet.has(v));
    assert.deepEqual(missing, [], `fixture has actions missing from the schema: ${missing.join(', ')}`);
  });
});
