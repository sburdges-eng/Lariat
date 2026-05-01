#!/usr/bin/env node
// Integration tests for searchComplianceSemantic + searchComplianceHybrid.
//
// Uses a fake feature-extraction model (3-dim vectors) so the BGE
// model isn't downloaded from Hugging Face. The dimension assertion
// in the real path is bypassed via the override that also writes
// vectors at the same fake dimension.
//
// Run: node --experimental-strip-types --test tests/js/test-compliance-hybrid.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const npy = await import('../../scripts/lib/npy.mjs');
const compliance = await import('../../lib/complianceSearch.ts');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-compliance-hyb-'));
const DB_PATH = path.join(TMP, 'compliance.db');
const NPY_PATH = path.join(TMP, 'compliance.vectors.npy');
const IDS_PATH = path.join(TMP, 'compliance.vectors.ids.json');

const FIXTURE = [
  {
    id: 'sample.bouncer.detain',
    domain: 'security_law',
    jurisdiction: 'CO',
    topic: 'bouncer detention authority',
    audience: ['security'],
    plain_language_summary: 'A bouncer cannot detain a patron beyond reasonable suspicion.',
    required_actions: ['call police if force needed'],
    prohibited_actions: ['handcuff', 'physical restraint'],
    allowed_actions: ['ask to leave'],
    exceptions: [],
    notes: ['shopkeeper privilege limited to retail'],
    audience_text: 'security',
    body: 'A bouncer cannot detain a patron beyond reasonable suspicion. Handcuffs and physical restraint are not permitted.',
    vector: [1.0, 0.0, 0.0],
  },
  {
    id: 'sample.hfwa.sick.leave',
    domain: 'labor_law',
    jurisdiction: 'CO',
    topic: 'paid sick leave under HFWA',
    audience: ['manager'],
    plain_language_summary: 'CO HFWA grants 1 hour of paid sick leave per 30 hours worked.',
    required_actions: ['accrue sick leave from day one'],
    prohibited_actions: ['retaliation for taking sick leave'],
    allowed_actions: [],
    exceptions: [],
    notes: [],
    audience_text: 'manager',
    body: 'Healthy Families and Workplaces Act: 1 hour of paid sick leave per 30 hours worked.',
    vector: [0.0, 1.0, 0.0],
  },
  {
    id: 'sample.liquor.minor',
    domain: 'liquor_law',
    jurisdiction: 'CO',
    topic: 'service to minors',
    audience: ['bartender'],
    plain_language_summary: 'Selling alcohol to a minor is a class 2 misdemeanor.',
    required_actions: ['check ID for anyone under 30'],
    prohibited_actions: ['serve a minor'],
    allowed_actions: [],
    exceptions: [],
    notes: [],
    audience_text: 'bartender',
    body: 'Service to minors is prohibited; class 2 misdemeanor; check ID for anyone under 30.',
    vector: [0.0, 0.0, 1.0],
  },
];

function buildFixtureDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE compliance_rules (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL, jurisdiction TEXT NOT NULL,
      topic TEXT NOT NULL, audience TEXT NOT NULL, verification_status TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE compliance_fts USING fts5(
      id UNINDEXED, domain UNINDEXED, title, audience_text, body, tokenize='porter ascii'
    );
  `);
  const insR = db.prepare(
    `INSERT INTO compliance_rules (id, domain, jurisdiction, topic, audience, verification_status, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insF = db.prepare(
    `INSERT INTO compliance_fts (id, domain, title, audience_text, body) VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const r of FIXTURE) {
      insR.run(
        r.id,
        r.domain,
        r.jurisdiction,
        r.topic,
        JSON.stringify(r.audience),
        'unverified',
        JSON.stringify({
          ...r,
          source: { title: 'test', publisher: 't', url: 't', effective_date: '2026-01-01', retrieved_date: '2026-05-01' },
          verification: { status: 'unverified', last_verified: '2026-05-01', review_interval_days: 365 },
          escalation: {},
        }),
      );
      insF.run(r.id, r.domain, `${r.domain} :: ${r.topic}`, r.audience_text, r.body);
    }
  });
  tx();
  db.close();
}

function buildFixtureVectors() {
  const ids = FIXTURE.map((r) => r.id);
  const data = new Float32Array(FIXTURE.length * 3);
  for (let i = 0; i < FIXTURE.length; i++) {
    data.set(FIXTURE[i].vector, i * 3);
  }
  npy.writeNpyF32Matrix(NPY_PATH, data, FIXTURE.length, 3);
  fs.writeFileSync(
    IDS_PATH,
    JSON.stringify({
      built_at: '2026-05-01',
      built_from_db_sha: 'fake',
      model: 'fake/3d',
      dims: 3,
      ids,
    }),
  );
}

// Fake model returns a fixed vector keyed by which sample question we're
// asking — picks the matching fixture's basis vector. Lets us assert
// the dot-product picks the right id.
function makeFakeModel() {
  return async (texts, _opts) => {
    const t = texts[0].toLowerCase();
    let v = [0, 0, 0];
    if (t.includes('bouncer') || t.includes('restrain')) v = [1, 0, 0];
    else if (t.includes('sick') || t.includes('leave')) v = [0, 1, 0];
    else if (t.includes('minor') || t.includes('id')) v = [0, 0, 1];
    return { data: new Float32Array(v) };
  };
}

before(() => {
  buildFixtureDb();
  buildFixtureVectors();
  compliance._setDbPathForTest(DB_PATH);
  compliance._setVectorsPathForTest(NPY_PATH, IDS_PATH);
});

after(() => {
  compliance._setDbPathForTest(null);
  compliance._setVectorsPathForTest(null, null);
  compliance._setModelForTest(null);
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('searchComplianceSemantic', () => {
  it('returns [] for empty query', async () => {
    compliance._setModelForTest(makeFakeModel());
    assert.deepEqual(await compliance.searchComplianceSemantic(''), []);
  });

  it('routes a paraphrased query to the matching id', async () => {
    compliance._setModelForTest(makeFakeModel());
    const hits = await compliance.searchComplianceSemantic(
      'can security physically restrain a guest',
    );
    assert.ok(hits.length > 0);
    assert.equal(hits[0].id, 'sample.bouncer.detain');
    assert.ok(hits[0].score > 0.99); // fake basis vectors → exact 1.0
  });

  it('returns [] when vectors are missing (graceful degrade)', async () => {
    compliance._setVectorsPathForTest('/nonexistent/missing.npy', '/nonexistent/missing.json');
    const hits = await compliance.searchComplianceSemantic('anything');
    assert.deepEqual(hits, []);
    // Restore for downstream tests
    compliance._setVectorsPathForTest(NPY_PATH, IDS_PATH);
  });
});

describe('searchComplianceHybrid', () => {
  it('falls back to BM25 when semantic returns []', async () => {
    compliance._setModelForTest(null);                      // no fake model
    compliance._setVectorsPathForTest('/nonexistent/x', '/nonexistent/y');
    const hits = await compliance.searchComplianceHybrid('paid sick leave');
    assert.ok(hits.length > 0);
    assert.equal(hits[0].id, 'sample.hfwa.sick.leave');
    // fused=0 marks the fallback branch.
    assert.equal(hits[0].fused, 0);
    compliance._setVectorsPathForTest(NPY_PATH, IDS_PATH);
  });

  it('fuses BM25 + semantic via RRF', async () => {
    compliance._setModelForTest(makeFakeModel());
    const hits = await compliance.searchComplianceHybrid(
      'bouncer restraint minor sick',
    );
    assert.ok(hits.length > 0);
    // Every result should carry a fused score > 0 (hybrid path).
    for (const h of hits) assert.ok(h.fused > 0, `${h.id} fused = ${h.fused}`);
  });

  it('hybrid result includes the full rule payload', async () => {
    compliance._setModelForTest(makeFakeModel());
    const hits = await compliance.searchComplianceHybrid('paid sick leave');
    assert.ok(hits.length > 0);
    const h = hits[0];
    assert.equal(typeof h.rule.plain_language_summary, 'string');
    assert.ok(h.rule.required_actions.length >= 0);
  });
});
