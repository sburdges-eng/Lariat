#!/usr/bin/env node
// Tests for scripts/dish-components-coverage.mjs — surfaces dishes that
// appear in sales_lines but lack a dish_components row, sorted by
// aggregate quantity_sold DESC.
//
// Run: node --experimental-strip-types --test tests/js/test-dish-components-coverage.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { buildCoverageReport, writeCoverageCsv, COVERAGE_CSV_HEADER } =
  await import('../../scripts/dish-components-coverage.mjs');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM sales_lines;
    DELETE FROM dish_components;
  `);
});

// Seed three distinct dishes in sales_lines with varying quantity_sold,
// and make one of them appear across two periods so the periods count
// is exercised. Then cover ONE of them with a dish_components row so
// only the other two surface in the gap report.
function seedSales(db) {
  // BAJA FISH TACOS — high velocity, 2 periods.
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
     VALUES ('Toast - Item Sales (Mar 2026)', 'BAJA FISH TACOS', 100, 1500.00, 'default')`,
  ).run();
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
     VALUES ('Toast - Item Sales (Apr 2026)', 'BAJA FISH TACOS', 50, 750.00, 'default')`,
  ).run();
  // ROPE BURGER — medium velocity, 1 period. Casing drift versus
  // dish_components ('rope burger' would match the LOWER+TRIM join in
  // the gap query, so this is the dish we cover to prove the join
  // catches case-insensitive matches.) — but we cover a DIFFERENT dish
  // here. ROPE BURGER stays in the gap.
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
     VALUES ('Toast - Item Sales (Mar 2026)', 'ROPE BURGER', 80, 1200.00, 'default')`,
  ).run();
  // RIBEYE — low velocity, 1 period. We'll cover this one in
  // dish_components so it does NOT appear in the gap.
  db.prepare(
    `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
     VALUES ('Toast - Item Sales (Mar 2026)', 'RIBEYE', 10, 400.00, 'default')`,
  ).run();
}

function coverRibeye(db) {
  // Use lowercase + trimmed casing to prove the LEFT JOIN's
  // LOWER(TRIM(...)) handles the casing drift the operator data has.
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', '  ribeye ', 'vendor_item', '12oz ribeye', 1, 'each')`,
  ).run();
}

describe('buildCoverageReport', () => {
  it('returns rows for sales dishes missing a dish_components row, sorted by qty_sold DESC', () => {
    seedSales(db);
    coverRibeye(db);

    const r = buildCoverageReport(db, { location: 'default' });

    // RIBEYE is covered → not in gap. BAJA FISH TACOS + ROPE BURGER are.
    assert.strictEqual(r.rows.length, 2);
    assert.strictEqual(r.rows[0].dish_name, 'BAJA FISH TACOS');
    assert.strictEqual(r.rows[0].qty_sold, 150); // 100 + 50 across 2 periods
    assert.strictEqual(r.rows[0].net_sales, 2250.0);
    assert.strictEqual(r.rows[0].periods, 2);
    assert.strictEqual(r.rows[1].dish_name, 'ROPE BURGER');
    assert.strictEqual(r.rows[1].qty_sold, 80);
    assert.strictEqual(r.rows[1].net_sales, 1200.0);
    assert.strictEqual(r.rows[1].periods, 1);
    // Aggregates.
    assert.strictEqual(r.total_dishes_in_gap, 2);
    assert.strictEqual(r.total_gap_qty, 230);
    assert.strictEqual(r.total_qty, 240); // 230 gap + 10 ribeye
    // 230/240 * 100 = 95.83… → rounded to 1 decimal = 95.8.
    assert.strictEqual(r.gap_pct, 95.8);
  });

  it('honors --top by limiting result rows', () => {
    seedSales(db);
    coverRibeye(db);

    const r = buildCoverageReport(db, { location: 'default', top: 1 });
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].dish_name, 'BAJA FISH TACOS');
    // Aggregates remain over the FULL gap (top is a display cap, not
    // a denominator change).
    assert.strictEqual(r.total_dishes_in_gap, 2);
    assert.strictEqual(r.total_gap_qty, 230);
  });

  it('returns empty rows + zero gap_pct when every dish is covered', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
       VALUES ('p1', 'RIBEYE', 5, 100.00, 'default')`,
    ).run();
    coverRibeye(db);
    const r = buildCoverageReport(db, { location: 'default' });
    assert.strictEqual(r.rows.length, 0);
    assert.strictEqual(r.total_dishes_in_gap, 0);
    assert.strictEqual(r.total_gap_qty, 0);
    assert.strictEqual(r.total_qty, 5);
    assert.strictEqual(r.gap_pct, 0);
  });

  it('scopes by location_id', () => {
    seedSales(db);
    // Same dish name in another location with a covering row — shouldn't
    // affect the 'default' gap.
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
       VALUES ('p1', 'BAJA FISH TACOS', 1, 10.00, 'satellite')`,
    ).run();
    db.prepare(
      `INSERT INTO dish_components
         (location_id, dish_name, component_type, vendor_ingredient,
          qty_per_serving, unit)
       VALUES ('satellite', 'baja fish tacos', 'vendor_item', 'fish', 1, 'oz')`,
    ).run();

    const r = buildCoverageReport(db, { location: 'default' });
    // BAJA FISH TACOS is not covered in 'default', so it still surfaces
    // there even though it's covered in 'satellite'.
    const baja = r.rows.find((x) => x.dish_name === 'BAJA FISH TACOS');
    assert.ok(baja, 'expected BAJA FISH TACOS in default-location gap');
    assert.strictEqual(baja.qty_sold, 150);
  });
});

// ── CSV writer ──────────────────────────────────────────────────────

describe('writeCoverageCsv', () => {
  it('writes a UTF-8, LF-terminated CSV with the importer header and one row per gap dish', () => {
    seedSales(db);
    coverRibeye(db);
    const r = buildCoverageReport(db, { location: 'default' });

    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cov-csv-')),
      'gap.csv',
    );
    writeCoverageCsv(r.rows, tmp);

    assert.ok(fs.existsSync(tmp));
    const text = fs.readFileSync(tmp, 'utf8');
    // No CRLF.
    assert.ok(!text.includes('\r'), 'CSV must use LF, not CRLF');
    const lines = text.split('\n');
    // Header + 2 gap rows + trailing newline → 4 entries.
    assert.strictEqual(lines.length, 4);
    assert.strictEqual(lines[3], ''); // trailing newline

    // Header must match the importer's REQUIRED_COLUMNS exactly.
    assert.strictEqual(
      lines[0],
      'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
    );
    assert.strictEqual(
      COVERAGE_CSV_HEADER.join(','),
      'dish_name,component_type,recipe_slug,vendor_ingredient,qty_per_serving,unit,notes',
    );

    // Data rows: only dish_name populated; the rest are empty cells (six
    // trailing commas → seven cells total).
    assert.strictEqual(lines[1], 'BAJA FISH TACOS,,,,,,');
    assert.strictEqual(lines[2], 'ROPE BURGER,,,,,,');
  });

  it('quotes a dish_name that contains a comma per RFC 4180', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
       VALUES ('p1', 'Fish, Chips & Slaw', 9, 99.00, 'default')`,
    ).run();
    const r = buildCoverageReport(db, { location: 'default' });
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cov-csv-q-')),
      'gap.csv',
    );
    writeCoverageCsv(r.rows, tmp);
    const text = fs.readFileSync(tmp, 'utf8');
    const lines = text.split('\n');
    assert.strictEqual(lines[1], '"Fish, Chips & Slaw",,,,,,');
  });

  it('quotes a dish_name that contains a quote, doubling the embedded quote', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, location_id)
       VALUES ('p1', 'The "Big" Burger', 4, 40.00, 'default')`,
    ).run();
    const r = buildCoverageReport(db, { location: 'default' });
    const tmp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cov-csv-Q-')),
      'gap.csv',
    );
    writeCoverageCsv(r.rows, tmp);
    const text = fs.readFileSync(tmp, 'utf8');
    const lines = text.split('\n');
    assert.strictEqual(lines[1], '"The ""Big"" Burger",,,,,,');
  });
});
