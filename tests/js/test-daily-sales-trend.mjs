#!/usr/bin/env node
// Unit tests for renderDailySalesTrend — the always-on assistant-context
// helper that surfaces the last 7 days of Toast daily sales plus YoY.
//
// We drive the helper directly (not through buildGroundedContext) so the
// test doesn't need to fabricate stations, recipes, menus, etc. The
// resolver hook is registered first so TS imports resolve under Node's
// experimental-strip-types.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-trend-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const ctx = await import('../../lib/kitchenAssistantContext.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.prepare(`DELETE FROM toast_sales_daily`).run();
});

const LOC = 'default';
const TODAY = '2026-04-17';

function insertDaily(shift_date, group, net_sales, orders, guests, loc = LOC) {
  testDb
    .prepare(
      `INSERT INTO toast_sales_daily
       (shift_date, net_sales, orders, guests, comparison_group, date_range, source, location_id)
       VALUES (?, ?, ?, ?, ?, ?, 'toast_csv', ?)`
    )
    .run(shift_date, net_sales, orders, guests, group, 'test', loc);
}

describe('renderDailySalesTrend', () => {
  it('returns empty when table has no rows', () => {
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('renders last 7 days of group-1 rows in descending date order', () => {
    // 10 days of group-1 rows — helper should cap at 7
    for (let i = 0; i < 10; i++) {
      const d = new Date('2026-04-17T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      insertDaily(iso, 1, 1000 + i * 10, 50 + i, 60 + i);
    }
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.match(out.text, /DAILY SALES TREND \(last 7 days, Toast\)/);
    // Today should be at top
    const lines = out.text.trim().split('\n').slice(1); // drop header
    assert.equal(lines.length, 7);
    assert.ok(lines[0].includes('2026-04-17'));
    assert.ok(lines[6].includes('2026-04-11'));
    // 8 days back should NOT appear
    assert.ok(!out.text.includes('2026-04-10'));
    assert.equal(out.source?.type, 'daily_sales_trend');
    assert.match(out.source?.detail ?? '', /7 day\(s\)/);
  });

  it('formats USD with 2 decimals and thousand separator', () => {
    insertDaily('2026-04-17', 1, 4231.5, 82, 95);
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.ok(out.text.includes('$4,231.50'));
    assert.ok(out.text.includes('82 orders'));
    assert.ok(out.text.includes('95 guests'));
  });

  it('joins YoY rows by shift_date minus one year', () => {
    insertDaily('2026-04-17', 1, 5000, 100, 110);
    insertDaily('2025-04-17', 2, 4000, 90, 100); // YoY match
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.match(out.text, /YoY: \$4,000\.00 \/ 90 \/ 100, \+25\.0% YoY/);
    assert.match(out.source?.detail ?? '', /1 with YoY/);
  });

  it('omits YoY segment when no matching group-2 row exists', () => {
    insertDaily('2026-04-17', 1, 5000, 100, 110);
    // group 2 row exists but wrong date
    insertDaily('2025-04-16', 2, 4000, 90, 100);
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.ok(!out.text.includes('YoY:'));
    assert.match(out.source?.detail ?? '', /^1 day\(s\)$/);
  });

  it('excludes group-2 rows from the primary listing', () => {
    insertDaily('2026-04-17', 2, 9999, 999, 999); // group-2 only
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('handles null metrics without crashing', () => {
    insertDaily('2026-04-17', 1, null, null, null);
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.ok(out.text.includes('2026-04-17'));
    assert.ok(out.text.includes('—'));
  });

  it('scopes to location_id', () => {
    insertDaily('2026-04-17', 1, 5000, 100, 110, 'other');
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.equal(out.text, '');
  });

  it('guards against division by zero in YoY pct', () => {
    insertDaily('2026-04-17', 1, 1234.5, 50, 60);
    insertDaily('2025-04-17', 2, 0, 0, 0);
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    // YoY block present, but no percent delta when prior is 0
    assert.match(out.text, /YoY: \$0\.00 \/ 0 \/ 0\)/);
    assert.ok(!out.text.includes('%'));
  });

  it('shows a negative delta when current is below YoY', () => {
    insertDaily('2026-04-17', 1, 800, 20, 25);
    insertDaily('2025-04-17', 2, 1000, 30, 35);
    const out = ctx.renderDailySalesTrend(testDb, LOC, TODAY);
    assert.match(out.text, /-20\.0% YoY/);
  });
});
