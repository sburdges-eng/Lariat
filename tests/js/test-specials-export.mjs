#!/usr/bin/env node
// Tests for lib/specialsExport (pure CSV builder) and the export route
// (DB-backed, in-memory SQLite per project rule).
// Run: node --experimental-strip-types --test tests/js/test-specials-export.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-export-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const AUDIT_PATH = path.join(TMP_DIR, 'management-actions.jsonl');
process.env.LARIAT_AUDIT_PATH = AUDIT_PATH;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);

const ex = await import('../../lib/specialsExport.ts');
const create = await import('../../app/api/specials/saved/route.js');
const exportRoute = await import('../../app/api/specials/saved/[id]/export/route.js');
const detail = await import('../../app/api/specials/saved/[id]/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const d = db.getDb();
  try { d.prepare('DELETE FROM specials').run(); } catch { /* table may not be initialised on first test — harmless */ }
  try { fs.unlinkSync(AUDIT_PATH); } catch { /* ignore */ }
});

describe('escapeCsvField', () => {
  it('returns plain text unchanged', () => {
    assert.equal(ex.escapeCsvField('plain'), 'plain');
  });
  it('quotes fields with commas', () => {
    assert.equal(ex.escapeCsvField('a,b'), '"a,b"');
  });
  it('quotes fields with newlines', () => {
    assert.equal(ex.escapeCsvField('line1\nline2'), '"line1\nline2"');
  });
  it('doubles embedded quotes and wraps', () => {
    assert.equal(ex.escapeCsvField('he said "hi"'), '"he said ""hi"""');
  });
  it('returns empty for null/undefined', () => {
    assert.equal(ex.escapeCsvField(null), '');
    assert.equal(ex.escapeCsvField(undefined), '');
  });
  it('coerces numbers to strings', () => {
    assert.equal(ex.escapeCsvField(12.5), '12.5');
  });
});

describe('mapCostBreakdownToIngredientRows', () => {
  const breakdown = [
    { item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco Pork Belly Skin-On', pack_size: 10, pack_unit: 'lb', pack_price: 50, cost: 10 },
    { item: 'Tomato (soft)', req_qty: 0.5, req_unit: 'case', match: '', pack_size: null, pack_unit: null, pack_price: null, cost: null, note: 'no vendor match' },
  ];

  it('maps matched and unmatched rows', () => {
    const rows = ex.mapCostBreakdownToIngredientRows(breakdown);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      ingredient: 'Pork Belly', qty: 2, unit: 'lb',
      vendor_match: 'Sysco Pork Belly Skin-On', note: '',
    });
    assert.deepEqual(rows[1], {
      ingredient: 'Tomato (soft)', qty: 0.5, unit: 'case',
      vendor_match: '', note: 'unmatched — pick a vendor item before paste',
    });
  });

  it('handles partial rows defensively', () => {
    const rows = ex.mapCostBreakdownToIngredientRows([{ item: 'X' }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ingredient, 'X');
    assert.equal(rows[0].qty, '');
    assert.equal(rows[0].unit, '');
    assert.equal(rows[0].vendor_match, '');
    assert.equal(rows[0].note, 'unmatched — pick a vendor item before paste');
  });

  it('returns [] for null or non-array input', () => {
    assert.deepEqual(ex.mapCostBreakdownToIngredientRows(null), []);
    assert.deepEqual(ex.mapCostBreakdownToIngredientRows('not array'), []);
    assert.deepEqual(ex.mapCostBreakdownToIngredientRows([]), []);
  });
});

describe('selectSkippedRows', () => {
  it('returns only unmatched rows', () => {
    const rows = [
      { ingredient: 'A', qty: 1, unit: 'lb', vendor_match: 'X', note: '' },
      { ingredient: 'B', qty: 2, unit: 'lb', vendor_match: '', note: 'unmatched — pick a vendor item before paste' },
    ];
    assert.deepEqual(ex.selectSkippedRows(rows), [rows[1]]);
  });
});

describe('stripCostMarkdown', () => {
  it('strips a trailing > [!NOTE] block', () => {
    const ans = 'Sear belly.\nSeason it.\n\n> [!NOTE]\n> ⚡ COMPUTED RECIPE COST: $10.00\n>\n> | x | y |\n';
    assert.equal(ex.stripCostMarkdown(ans), 'Sear belly.\nSeason it.');
  });
  it('strips a trailing > [!WARNING] block', () => {
    const ans = 'Sear belly.\n\n> [!WARNING]\n> Could not compute deterministic cost: foo';
    assert.equal(ex.stripCostMarkdown(ans), 'Sear belly.');
  });
  it('leaves answers without cost blocks alone', () => {
    assert.equal(ex.stripCostMarkdown('Plain answer.'), 'Plain answer.');
  });
});

describe('buildExportCsv', () => {
  it('produces a two-section CSV with the expected headers', () => {
    const csv = ex.buildExportCsv({
      recipe_row: {
        slug: 'pork-belly-app', display_name: 'Pork Belly App',
        yield_qty: 12, yield_unit: 'portions', category: 'appetizer',
        procedure: 'Sear belly.',
      },
      ingredient_rows: [
        { ingredient: 'Pork Belly', qty: 2, unit: 'lb', vendor_match: 'Sysco', note: '' },
      ],
    });
    assert.match(csv, /^# RECIPE\nslug,display_name,yield_qty,yield_unit,category,procedure\n/);
    assert.match(csv, /pork-belly-app,Pork Belly App,12,portions,appetizer,Sear belly\./);
    assert.match(csv, /\n\n# INGREDIENTS\ningredient,qty,unit,vendor_match,note\n/);
    assert.match(csv, /Pork Belly,2,lb,Sysco,/);
  });

  it('escapes commas, quotes, and newlines RFC-4180', () => {
    const csv = ex.buildExportCsv({
      recipe_row: {
        slug: 's', display_name: 'A, B "C"', yield_qty: 1, yield_unit: 'ea',
        category: '', procedure: 'line1\nline2',
      },
      ingredient_rows: [],
    });
    assert.match(csv, /"A, B ""C"""/);
    assert.match(csv, /"line1\nline2"/);
  });

  it('handles empty ingredient list', () => {
    const csv = ex.buildExportCsv({
      recipe_row: { slug: 's', display_name: 'X', yield_qty: 1, yield_unit: 'ea', category: '', procedure: '' },
      ingredient_rows: [],
    });
    assert.match(csv, /\n\n# INGREDIENTS\ningredient,qty,unit,vendor_match,note\n$/);
  });
});

const validBody = {
  name: 'Pork Belly App',
  pantry_text: '10 lbs pork belly',
  prompt_text: 'High-margin appetizer',
  ai_answer: 'Sear belly.\n\n> [!NOTE]\n> ⚡ COMPUTED RECIPE COST: $10.00',
  ai_model: 'lari-the-kitchen-assistant',
  cost_breakdown: [
    { item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco Pork Belly Skin-On', pack_size: 10, pack_unit: 'lb', pack_price: 50, cost: 10 },
    { item: 'Tomato (soft)', req_qty: 0.5, req_unit: 'case', match: '', pack_size: null, pack_unit: null, pack_price: null, cost: null },
  ],
  cost_total: 10,
  scratch_notes: '',
  sources: [],
};

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createOne(overrides = {}) {
  const res = await create.POST(jsonRequest('http://x/api/specials/saved', 'POST', { ...validBody, ...overrides }));
  return (await res.json()).id;
}

const exportBody = {
  slug: 'pork-belly-app',
  yield_qty: 12,
  yield_unit: 'portions',
  category: 'appetizer',
};

describe('POST /api/specials/saved/[id]/export', () => {
  it('builds a CSV with recipe + ingredient sections', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.csv, /^# RECIPE\n/);
    assert.match(data.csv, /pork-belly-app/);
    assert.match(data.csv, /\n\n# INGREDIENTS\n/);
    assert.match(data.csv, /Pork Belly,2,lb,Sysco Pork Belly Skin-On,/);
    assert.equal(data.recipe_row.slug, 'pork-belly-app');
    assert.equal(data.ingredient_rows.length, 2);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].ingredient, 'Tomato (soft)');
  });

  it('strips trailing cost markdown from procedure when no override', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const data = await res.json();
    assert.equal(data.recipe_row.procedure, 'Sear belly.');
  });

  it('uses procedure_override when provided', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', { ...exportBody, procedure_override: 'Custom procedure' }), { params: { id } });
    const data = await res.json();
    assert.equal(data.recipe_row.procedure, 'Custom procedure');
  });

  it('updates last_exported_at on each export', async () => {
    const id = await createOne();
    await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const t1 = db.getDb().prepare('SELECT last_exported_at FROM specials WHERE id = ?').get(id).last_exported_at;
    assert.ok(t1 > 0);
    await new Promise((r) => setTimeout(r, 5));
    await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const t2 = db.getDb().prepare('SELECT last_exported_at FROM specials WHERE id = ?').get(id).last_exported_at;
    assert.ok(t2 > t1);
  });

  it('410s when special is archived', async () => {
    const id = await createOne();
    await detail.DELETE(new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }), { params: { id } });
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    assert.equal(res.status, 410);
  });

  it('400s on invalid yield_qty', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', { ...exportBody, yield_qty: 0 }), { params: { id } });
    assert.equal(res.status, 400);
  });

  it('400s on bad slug', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', { ...exportBody, slug: 'Bad Slug' }), { params: { id } });
    assert.equal(res.status, 400);
  });

  it('writes a specials.export file-audit line', async () => {
    const id = await createOne();
    fs.unlinkSync(AUDIT_PATH);
    await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8').trim());
    assert.equal(audit.action, 'specials.export');
    assert.equal(audit.special_id, id);
    assert.equal(audit.slug, 'pork-belly-app');
  });
});
