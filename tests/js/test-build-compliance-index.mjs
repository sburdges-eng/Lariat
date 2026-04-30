#!/usr/bin/env node
// Tests for scripts/build-compliance-index.mjs (the FTS5 build) and
// lib/complianceSearch.ts (the read-only client).
//
// Run: node --experimental-strip-types --test tests/js/test-build-compliance-index.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const { rowToIndexable, readJsonlRows, buildIndex } = await import(
  '../../scripts/build-compliance-index.mjs'
);
const compliance = await import('../../lib/complianceSearch.ts');

let tmpRoot;
let jsonlPath;
let dbPath;

const sampleRows = [
  {
    id: 'co_labor_007',
    domain: 'labor_law',
    jurisdiction: 'Colorado',
    topic: 'paid_sick_leave',
    audience: ['owner', 'manager', 'payroll'],
    plain_language_summary: 'HFWA requires 1 hour of paid sick leave per 30 hours worked.',
    required_actions: ['Track accrual at 1:30 ratio'],
    prohibited_actions: ['Disciplining for HFWA leave use'],
    allowed_actions: [],
    exceptions: [],
    escalation: { manager_required: true },
    source: { title: 'CRS 8-13.3-401', publisher: 'CDLE', url: 'x', effective_date: 'UNKNOWN', retrieved_date: '2026-04-28' },
    verification: { status: 'unverified', last_verified: 'UNKNOWN', review_interval_days: 90 },
    notes: [],
  },
  {
    id: 'co_liquor_003',
    domain: 'liquor_law',
    jurisdiction: 'Colorado',
    topic: 'visibly_intoxicated_service',
    audience: ['server', 'bartender', 'manager'],
    plain_language_summary: 'Selling alcohol to a visibly intoxicated person is prohibited.',
    required_actions: ['Cut off service', 'Offer water and food'],
    prohibited_actions: ['Serving "one more"'],
    allowed_actions: [],
    exceptions: [],
    escalation: { manager_required: true, ems_required: true },
    source: { title: 'CRS 44-3-901(1)(j)', publisher: 'CDOR', url: 'x', effective_date: 'UNKNOWN', retrieved_date: '2026-04-28' },
    verification: { status: 'unverified', last_verified: 'UNKNOWN', review_interval_days: 90 },
    notes: [],
  },
  {
    id: 'sec_boundary_001',
    domain: 'security_boundaries',
    jurisdiction: 'Colorado',
    topic: 'use_of_force',
    audience: ['door_security', 'manager'],
    plain_language_summary: 'Bouncers are not law enforcement; physical force is limited to immediate self-defense.',
    required_actions: ['Disengage and create distance'],
    prohibited_actions: ['Striking', 'Tackling'],
    allowed_actions: ['Brief safe escort to exit'],
    exceptions: [],
    escalation: { manager_required: true, police_required: true, ems_required: true },
    source: { title: 'CRS 18-1-704', publisher: 'CO General Assembly', url: 'x', effective_date: 'UNKNOWN', retrieved_date: '2026-04-28' },
    verification: { status: 'unverified', last_verified: 'UNKNOWN', review_interval_days: 90 },
    notes: [],
  },
];

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-compliance-'));
  jsonlPath = path.join(tmpRoot, 'compliance.jsonl');
  dbPath = path.join(tmpRoot, 'compliance.db');
  fs.writeFileSync(jsonlPath, sampleRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
});

after(() => {
  compliance._setDbPathForTest(null);
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('rowToIndexable', () => {
  it('joins searchable fields into the body', () => {
    const idx = rowToIndexable(sampleRows[0]);
    assert.match(idx.body, /HFWA/);
    assert.match(idx.body, /Track accrual/);
    assert.match(idx.body, /Disciplining/);
  });

  it('builds title from domain :: topic', () => {
    const idx = rowToIndexable(sampleRows[1]);
    assert.equal(idx.title, 'liquor_law :: visibly_intoxicated_service');
  });

  it('joins audience for the audience_text field', () => {
    const idx = rowToIndexable(sampleRows[2]);
    assert.equal(idx.audience_text, 'door_security, manager');
  });
});

describe('readJsonlRows', () => {
  it('round-trips the sample rows', () => {
    const rows = readJsonlRows(jsonlPath);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, 'co_labor_007');
  });

  it('throws with line context on invalid JSON', () => {
    const bad = path.join(tmpRoot, 'bad.jsonl');
    fs.writeFileSync(bad, '{"a":1}\nnot json\n');
    assert.throws(() => readJsonlRows(bad), /line 2/);
  });
});

describe('buildIndex', () => {
  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
  });

  it('creates compliance_rules + compliance_fts + _meta tables and populates rows', () => {
    const db = new Database(dbPath);
    const summary = buildIndex(db, { jsonlPath, jsonlSha: 'deadbeef' });
    db.close();

    assert.equal(summary.row_count, 3);

    const r = new Database(dbPath, { readonly: true });
    const rules = r.prepare('SELECT id, domain, verification_status FROM compliance_rules ORDER BY id').all();
    assert.equal(rules.length, 3);
    assert.equal(rules[0].id, 'co_labor_007');
    assert.equal(rules[0].domain, 'labor_law');
    assert.equal(rules[0].verification_status, 'unverified');

    const meta = r.prepare('SELECT row_count, jsonl_sha FROM _meta WHERE id = 1').get();
    assert.equal(meta.row_count, 3);
    assert.equal(meta.jsonl_sha, 'deadbeef');

    // Verify FTS table has rows
    const ftsCount = r.prepare("SELECT COUNT(*) AS c FROM compliance_fts").get().c;
    assert.equal(ftsCount, 3);
    r.close();
  });
});

describe('searchCompliance', () => {
  before(() => {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
    const db = new Database(dbPath);
    buildIndex(db, { jsonlPath, jsonlSha: 'sha' });
    db.close();
    compliance._setDbPathForTest(dbPath);
  });

  it('returns empty when query is empty', () => {
    assert.deepEqual(compliance.searchCompliance(''), []);
  });

  it('finds the labor rule by content keyword', () => {
    const hits = compliance.searchCompliance('paid sick leave');
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].id, 'co_labor_007');
  });

  it('finds the liquor rule by content keyword', () => {
    const hits = compliance.searchCompliance('visibly intoxicated');
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].id, 'co_liquor_003');
  });

  it('finds the security rule by content keyword', () => {
    const hits = compliance.searchCompliance('use of force');
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].id, 'sec_boundary_001');
  });

  it('respects domain filter', () => {
    const hits = compliance.searchCompliance('manager', { domains: ['liquor_law'] });
    for (const h of hits) assert.equal(h.domain, 'liquor_law');
  });

  it('honors limit', () => {
    const hits = compliance.searchCompliance('manager', { limit: 1 });
    assert.equal(hits.length, 1);
  });

  it('returns empty for nonsense queries that do not match the corpus', () => {
    const hits = compliance.searchCompliance('qqqqqqx zzzzzzx xyzzyzzz');
    assert.equal(hits.length, 0);
  });

  it('strips FTS5 operator characters from the query (does not throw)', () => {
    const hits = compliance.searchCompliance('"visibly intoxicated" AND alcohol');
    assert.ok(hits.length >= 1);
  });
});

describe('renderCompliance', () => {
  before(() => {
    if (!fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      buildIndex(db, { jsonlPath, jsonlSha: 'sha' });
      db.close();
    }
    compliance._setDbPathForTest(dbPath);
  });

  it('returns empty text+null source when no matches', () => {
    const out = compliance.renderCompliance('qqqqqqx zzzzzzx xyzzyzzz');
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('emits a compact text block with rule id, summary, source, verification', () => {
    const out = compliance.renderCompliance('paid sick leave');
    assert.match(out.text, /CO compliance|COLORADO COMPLIANCE/i);
    assert.match(out.text, /co_labor_007/);
    assert.match(out.text, /HFWA/);
    assert.match(out.text, /unverified/);
    assert.equal(out.source?.type, 'compliance');
  });
});

describe('available()', () => {
  it('returns true when DB exists', () => {
    compliance._setDbPathForTest(dbPath);
    assert.equal(compliance.available(), true);
  });

  it('returns false when DB is missing', () => {
    compliance._setDbPathForTest(path.join(tmpRoot, 'no-such.db'));
    assert.equal(compliance.available(), false);
  });
});
