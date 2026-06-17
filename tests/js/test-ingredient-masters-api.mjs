#!/usr/bin/env node
// Tests for app/api/costing/ingredient-masters/route.js — GET (list) +
// PATCH (update). Companion of test-ingredient-masters-repo.mjs.
//
// Run: node --experimental-strip-types --test tests/js/test-ingredient-masters-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

register(new URL('./resolver.mjs', import.meta.url));

// auditEvents writes DB-side, no jsonl chdir needed — but we still
// sandbox cwd because lib/auditLog.mjs (used by sibling /costing routes)
// captures process.cwd() at module load. Same pattern as
// test-pack-changes-route.mjs.
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-im-route-'));
process.chdir(tmpRoot);

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const route = await import('../../app/api/costing/ingredient-masters/route.js');
const { GET, PATCH } = route;

setDbPathForTest(':memory:');
const db = getDb();
after(() => {
  setDbPathForTest(null);
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`DELETE FROM ingredient_masters; DELETE FROM vendor_prices; DELETE FROM bom_lines; DELETE FROM audit_events;`);
  delete process.env.LARIAT_PIN;
});

function seedMaster(id, canonical, opts = {}) {
  db.prepare(
    `INSERT INTO ingredient_masters
       (master_id, canonical_name, category, preferred_vendor, last_reviewed)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    canonical,
    opts.category ?? null,
    opts.preferred_vendor ?? null,
    opts.last_reviewed ?? null,
  );
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/costing/ingredient-masters${qs}`);
}

function patchReq(body) {
  return new Request('http://localhost/api/costing/ingredient-masters', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────────────────────────

describe('GET /api/costing/ingredient-masters', () => {
  it('returns empty list when table empty', async () => {
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 0);
    assert.deepEqual(body.masters, []);
  });

  it('lists masters with counts', async () => {
    seedMaster('a', 'A');
    seedMaster('b', 'B');
    const res = await GET(getReq());
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.ok(body.masters.every((m) => 'vendor_price_count' in m && 'bom_line_count' in m));
  });

  it('filter=needs_review excludes recently-reviewed', async () => {
    seedMaster('reviewed', 'B', { last_reviewed: new Date().toISOString() });
    seedMaster('unreviewed', 'A');
    const res = await GET(getReq('?filter=needs_review'));
    const body = await res.json();
    assert.equal(body.filter, 'needs_review');
    assert.deepEqual(body.masters.map((m) => m.master_id), ['unreviewed']);
  });

  it('q=substring filters by master_id and canonical_name', async () => {
    seedMaster('ketchup_heinz_1gal', 'Ketchup — Heinz 1gal');
    seedMaster('mayo_kraft_1gal', 'Mayonnaise — Kraft 1gal');
    const res = await GET(getReq('?q=heinz'));
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.masters[0].master_id, 'ketchup_heinz_1gal');
  });

  it('unknown filter falls back to all', async () => {
    seedMaster('a', 'A');
    const res = await GET(getReq('?filter=garbage'));
    const body = await res.json();
    assert.equal(body.filter, 'all');
    assert.equal(body.total, 1);
  });

  it('returns 401 when LARIAT_PIN is set and no cookie', async () => {
    process.env.LARIAT_PIN = '1234';
    try {
      const res = await GET(getReq());
      assert.equal(res.status, 401);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/costing/ingredient-masters — validation', () => {
  it('400 on missing body', async () => {
    const req = new Request('http://localhost/api/costing/ingredient-masters', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await PATCH(req);
    assert.equal(res.status, 400);
  });

  it('400 when master_id missing', async () => {
    const res = await PATCH(patchReq({ updates: { category: 'sauce' } }));
    assert.equal(res.status, 400);
  });

  it('400 when updates missing', async () => {
    const res = await PATCH(patchReq({ master_id: 'a' }));
    assert.equal(res.status, 400);
  });

  it('400 when updates is empty', async () => {
    const res = await PATCH(patchReq({ master_id: 'a', updates: {} }));
    assert.equal(res.status, 400);
  });

  it('422 when canonical_name is empty string', async () => {
    seedMaster('a', 'A');
    const res = await PATCH(patchReq({ master_id: 'a', updates: { canonical_name: '   ' } }));
    assert.equal(res.status, 422);
  });

  it("422 when last_reviewed is not null/'now'/string", async () => {
    seedMaster('a', 'A');
    const res = await PATCH(patchReq({ master_id: 'a', updates: { last_reviewed: 99 } }));
    assert.equal(res.status, 422);
  });
});

describe('PATCH /api/costing/ingredient-masters — happy path', () => {
  it('404 for unknown master_id', async () => {
    const res = await PATCH(patchReq({ master_id: 'missing', updates: { category: 'sauce' } }));
    assert.equal(res.status, 404);
  });

  it('updates one field and posts one audit row', async () => {
    seedMaster('a', 'A');
    const res = await PATCH(
      patchReq({ master_id: 'a', updates: { category: 'sauce' }, cook_id: 'cook-jane' }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.changed, true);
    assert.equal(body.master.category, 'sauce');

    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity='ingredient_masters'`)
      .get();
    assert.ok(audit, 'audit row must exist');
    assert.equal(audit.action, 'correction');
    assert.equal(audit.actor_cook_id, 'cook-jane');
    assert.equal(audit.actor_source, 'manager_ui');
  });

  it("last_reviewed:'now' stamps via datetime('now')", async () => {
    seedMaster('a', 'A');
    const before = Date.now();
    await PATCH(patchReq({ master_id: 'a', updates: { last_reviewed: 'now' } }));
    const row = db.prepare(`SELECT last_reviewed FROM ingredient_masters WHERE master_id='a'`).get();
    assert.ok(row.last_reviewed);
    const stamped = new Date(row.last_reviewed + 'Z').getTime();
    assert.ok(Math.abs(stamped - before) < 5000);
  });

  it('multi-field update writes everything in one tx + one audit row', async () => {
    seedMaster('a', 'A');
    await PATCH(
      patchReq({
        master_id: 'a',
        updates: { canonical_name: 'Better A', category: 'sauce', preferred_vendor: 'shamrock' },
        cook_id: 'cook-x',
      }),
    );
    const after = db
      .prepare(`SELECT * FROM ingredient_masters WHERE master_id='a'`)
      .get();
    assert.equal(after.canonical_name, 'Better A');
    assert.equal(after.category, 'sauce');
    assert.equal(after.preferred_vendor, 'shamrock');
    const auditCount = db
      .prepare(`SELECT COUNT(*) c FROM audit_events WHERE entity='ingredient_masters'`)
      .get().c;
    assert.equal(auditCount, 1);
  });

  it('returns 401 when LARIAT_PIN is set and no cookie', async () => {
    process.env.LARIAT_PIN = '1234';
    try {
      seedMaster('a', 'A');
      const res = await PATCH(patchReq({ master_id: 'a', updates: { category: 'sauce' } }));
      assert.equal(res.status, 401);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});


describe('PATCH /api/costing/ingredient-masters — quality lock', () => {
  it('locks with preferred vendor in one request', async () => {
    seedMaster('a', 'Chicken Breast');
    const res = await PATCH(
      patchReq({
        master_id: 'a',
        updates: { preferred_vendor: 'shamrock', quality_locked: true, quality_lock_reason: 'quality' },
      }),
    );
    assert.equal(res.status, 200);
    const row = db.prepare('SELECT preferred_vendor, quality_locked FROM ingredient_masters WHERE master_id = ?').get('a');
    assert.equal(row.preferred_vendor, 'shamrock');
    assert.equal(row.quality_locked, 1);
  });

  it('422 when changing vendor while locked', async () => {
    seedMaster('a', 'Chicken Breast', { preferred_vendor: 'sysco' });
    db.prepare(`UPDATE ingredient_masters SET quality_locked = 1 WHERE master_id = 'a'`).run();
    const res = await PATCH(patchReq({ master_id: 'a', updates: { preferred_vendor: 'shamrock' } }));
    assert.equal(res.status, 422);
  });
});
