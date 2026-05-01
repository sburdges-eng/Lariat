#!/usr/bin/env node
// Tests for lib/specialsExport — pure CSV builder and helpers.
// Route-level last_exported_at semantics are tested in test-specials-saved-api.mjs.
// Run: node --experimental-strip-types --test tests/js/test-specials-export.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ex = await import('../../lib/specialsExport.ts');

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
