#!/usr/bin/env node
// Per-helper tests for the conditional context blocks extracted from
// buildGroundedContext (HACCP/CCP, vendor, labor, historical-86, plus
// the previously-inline always-on blocks: active 86, inventory,
// sign-offs, line-check progress, staff roster, sales velocity, BEO
// events, order guide).
//
// Each helper is exported by lib/kitchenAssistantContext.ts as
// renderXxx(...) returning either { text, source } or { text, sources }.
// Pure where possible — DB-backed helpers receive a real in-memory DB.
// Per CLAUDE.md "Do not mock SQLite": setDbPathForTest() against a
// temp file so initSchema() runs the same DDL as production.
//
// Run: node --experimental-strip-types --test tests/js/test-ka-context-render-helpers.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-kactxhelpers-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const ctx = await import('../../lib/kitchenAssistantContext.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

const LOC = 'default';
const DATE = '2026-05-08';

// ─── Always-on blocks (header emitted even when empty) ──────────────

describe('renderActive86s', () => {
  beforeEach(() => testDb.prepare(`DELETE FROM eighty_six`).run());

  it('emits "(none)" + source with zero count when no rows', () => {
    const out = ctx.renderActive86s(testDb, LOC, DATE);
    assert.match(out.text, /ACTIVE 86 \(unresolved, today\):/);
    assert.match(out.text, /\(none\)/);
    assert.equal(out.source.type, 'eighty_six');
    assert.match(out.source.detail, /0 active/);
  });

  it('lists rows with optional station/reason/qty + respects location', () => {
    testDb.prepare(
      `INSERT INTO eighty_six (item, station_id, reason, quantity, shift_date, location_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('Salmon', 'grill', 'out of stock', '4 portions', DATE, LOC, '2026-05-08T10:00:00Z');
    testDb.prepare(
      `INSERT INTO eighty_six (item, shift_date, location_id, created_at)
       VALUES (?, ?, ?, ?)`
    ).run('Other Loc Item', DATE, 'other-loc', '2026-05-08T10:00:00Z');
    const out = ctx.renderActive86s(testDb, LOC, DATE);
    assert.match(out.text, /Salmon @ grill \| out of stock \| qty 4 portions/);
    assert.doesNotMatch(out.text, /Other Loc Item/);
    assert.match(out.source.detail, /1 active/);
  });
});

describe('renderInventoryUpdates', () => {
  beforeEach(() => testDb.prepare(`DELETE FROM inventory_updates`).run());

  it('emits "(none)" + source with zero count when no rows', () => {
    const out = ctx.renderInventoryUpdates(testDb, LOC, DATE);
    assert.match(out.text, /RECENT INVENTORY UPDATES \(today, newest first\):/);
    assert.match(out.text, /\(none\)/);
    assert.match(out.source.detail, /0 rows/);
  });

  it('lists rows with direction/delta/note joined by separator', () => {
    testDb.prepare(
      `INSERT INTO inventory_updates (item, direction, delta, station_id, note, shift_date, location_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('Romaine', 'received', '6 cs', 'salads', 'short 2 cs', DATE, LOC, '2026-05-08T08:00:00Z');
    const out = ctx.renderInventoryUpdates(testDb, LOC, DATE);
    assert.match(out.text, /Romaine \| received · 6 cs · salads · short 2 cs/);
  });
});

describe('renderStationSignoffs', () => {
  beforeEach(() => testDb.prepare(`DELETE FROM station_signoffs`).run());

  it('emits "(none)" with no signoffs and lists each row otherwise', () => {
    let out = ctx.renderStationSignoffs(testDb, LOC, DATE);
    assert.match(out.text, /STATION SIGN-OFFS \(today\):/);
    assert.match(out.text, /\(none\)/);
    testDb.prepare(
      `INSERT INTO station_signoffs (station_id, cook_id, shift_date, location_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('grill', 'cook-1', DATE, LOC, '2026-05-08T11:00:00Z');
    out = ctx.renderStationSignoffs(testDb, LOC, DATE);
    assert.match(out.text, /grill by cook-1/);
    // Pin source.type so a rename (e.g. to 'station_signoffs') trips the
    // test loudly. Per code-quality reviewer on PR review of this refactor:
    // the source.type naming is currently ad-hoc per helper and a future
    // convention sweep should canonicalize.
    assert.equal(out.source.type, 'signoffs');
    assert.match(out.source.detail, /1 sign-off/);
  });
});

describe('renderLineCheckProgress', () => {
  it('emits header even with no stations', () => {
    const out = ctx.renderLineCheckProgress(testDb, LOC, DATE, []);
    assert.match(out.text, /LINE CHECK PROGRESS/);
    assert.equal(out.source.type, 'line_checks');
    assert.match(out.source.detail, /\d+ station/);
  });
});

describe('renderStaffRoster', () => {
  it('returns empty when no active staff', () => {
    const out = ctx.renderStaffRoster([]);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('renders active staff with first/last/id, filters out inactive', () => {
    const out = ctx.renderStaffRoster([
      { id: 's-1', first: 'Anne', last: 'Doe' },
      { id: 's-2', first: 'Bob', last: 'Roe', active: false },
      { id: 's-3', first: 'Cy', last: 'Coe', active: true },
    ]);
    assert.match(out.text, /ACTIVE STAFF ROSTER/);
    assert.match(out.text, /Anne Doe \(ID: s-1\)/);
    assert.match(out.text, /Cy Coe \(ID: s-3\)/);
    assert.doesNotMatch(out.text, /Bob Roe/);
    assert.match(out.source.detail, /2 active staff/);
  });
});

// ─── Conditional / variable-length blocks ───────────────────────────

describe('renderSalesVelocity', () => {
  beforeEach(() => testDb.prepare(`DELETE FROM sales_lines`).run());

  it('returns empty with no rows and aggregates desc otherwise', () => {
    let out = ctx.renderSalesVelocity(testDb, LOC);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
    const stmt = testDb.prepare(
      `INSERT INTO sales_lines (item_name, quantity_sold, location_id) VALUES (?, ?, ?)`
    );
    stmt.run('Tacos', 10, LOC);
    stmt.run('Tacos', 5, LOC);
    stmt.run('Burger', 3, LOC);
    out = ctx.renderSalesVelocity(testDb, LOC);
    assert.match(out.text, /SALES VELOCITY/);
    assert.match(out.text, /Tacos: 15 units sold/);
    assert.ok(out.text.indexOf('Tacos') < out.text.indexOf('Burger'));
  });
});

describe('renderHistorical86s', () => {
  beforeEach(() => testDb.prepare(`DELETE FROM eighty_six`).run());

  it('returns empty with no rows', () => {
    const out = ctx.renderHistorical86s(testDb, LOC);
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('aggregates 86 frequency desc by count, respects location_id', () => {
    const stmt = testDb.prepare(
      `INSERT INTO eighty_six (item, shift_date, location_id, created_at) VALUES (?, ?, ?, ?)`
    );
    stmt.run('Salmon', '2026-05-01', LOC, '2026-05-01T10:00:00Z');
    stmt.run('Salmon', '2026-05-02', LOC, '2026-05-02T10:00:00Z');
    stmt.run('Salmon', '2026-05-03', LOC, '2026-05-03T10:00:00Z');
    stmt.run('Steak',  '2026-05-04', LOC, '2026-05-04T10:00:00Z');
    stmt.run('Other-Loc Salmon', '2026-05-01', 'other-loc', '2026-05-01T10:00:00Z');
    const out = ctx.renderHistorical86s(testDb, LOC);
    assert.match(out.text, /HISTORICAL 86 FREQUENCY \(Lifetime\):/);
    assert.match(out.text, /Salmon: 86'd 3 times/);
    assert.match(out.text, /Steak: 86'd 1 times/);
    assert.doesNotMatch(out.text, /Other-Loc Salmon/);
    assert.ok(out.text.indexOf('Salmon') < out.text.indexOf('Steak'));
    assert.match(out.source.detail, /Top 2 flagged/);
  });
});

describe('renderHaccpCcps', () => {
  it('returns empty when no CCPs', () => {
    const out = ctx.renderHaccpCcps({ ccps: [], temp_monitoring: [] });
    assert.equal(out.text, '');
    assert.equal(out.source, null);
  });

  it('renders each CCP with hazard, limit, monitoring, corrective', () => {
    const out = ctx.renderHaccpCcps({
      ccps: [{
        ccp_id: 'CCP-1',
        critical_control_point: 'Cooking poultry',
        hazard: 'Salmonella',
        critical_limit: '165°F for 15 sec',
        monitoring_procedure: 'Probe each batch',
        corrective_action: 'Continue cooking',
      }],
      temp_monitoring: [],
    });
    assert.match(out.text, /HACCP CRITICAL CONTROL POINTS:/);
    assert.match(out.text, /\[CCP-1\] Cooking poultry/);
    assert.match(out.text, /hazard: Salmonella \| limit: 165°F for 15 sec/);
    assert.match(out.text, /monitor: Probe each batch/);
    assert.match(out.text, /corrective: Continue cooking/);
    assert.match(out.source.detail, /1 CCP/);
  });
});

describe('renderVendorSummaryBlock', () => {
  it('returns empty when summary is null or recent_items missing', () => {
    assert.equal(ctx.renderVendorSummaryBlock(null).text, '');
    assert.equal(ctx.renderVendorSummaryBlock({ sysco: { recent_items: [] } }).text, '');
  });

  it('renders top 15 sysco items with description/category/pack/price', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      description: `Item ${i + 1}`,
      category: 'produce',
      pack_size: '6/case',
      price: 12.5 + i,
    }));
    const out = ctx.renderVendorSummaryBlock({
      sysco: { recent_items: items, last_invoice_date: '2026-05-01' },
    });
    assert.match(out.text, /SYSCO RECENT ITEMS \(top 15\):/);
    assert.match(out.text, /Item 1 \| produce \| 6\/case \| \$12\.5/);
    assert.match(out.text, /Item 15/);
    assert.doesNotMatch(out.text, /Item 16/);
    assert.match(out.text, /last invoice: 2026-05-01/);
    assert.match(out.source.detail, /15 Sysco item/);
  });
});

describe('renderLaborSummaryBlock', () => {
  it('returns empty when labor is null', () => {
    assert.equal(ctx.renderLaborSummaryBlock(null).text, '');
  });

  it('renders period, sales, role + employee breakdowns sorted desc', () => {
    const out = ctx.renderLaborSummaryBlock({
      period: 'Wk 18',
      net_sales: 50000,
      labor_cost: 12500,
      labor_pct_net: 0.25,
      splh_net: 88.5,
      by_role: [
        { job_title: 'Line Cook', total_hours: 120, ot_hours: 4, total_cost: 3000, labor_pct_net: 0.06 },
      ],
      by_employee: [
        { first_name: 'Anne', last_name: 'Doe', job_title: 'Line Cook', total_hours: 40, ot_hours: 2, total_cost: 1100 },
        { first_name: 'Bob', last_name: 'Roe', job_title: 'Line Cook', total_hours: 50, ot_hours: 0, total_cost: 1300 },
      ],
    });
    assert.match(out.text, /LABOR SUMMARY \(from 7shifts export\):/);
    assert.match(out.text, /period: Wk 18/);
    assert.match(out.text, /net sales: \$50,000/);
    assert.match(out.text, /labor cost: \$12,500 \(25\.0% of net\)/);
    assert.match(out.text, /SPLH \(net\): \$88\.5/);
    assert.match(out.text, /Line Cook: 120 hrs \(4 OT\), \$3,000 \(6\.0% net\)/);
    assert.ok(out.text.indexOf('Bob Roe') < out.text.indexOf('Anne Doe'));
    assert.match(out.source.detail, /Wk 18/);
  });

  it('falls back to "loaded" when period is missing', () => {
    const out = ctx.renderLaborSummaryBlock({ net_sales: 0, labor_cost: 0 });
    assert.equal(out.source.detail, 'loaded');
  });
});

describe('renderBeoEvents', () => {
  beforeEach(() => {
    testDb.prepare(`DELETE FROM beo_prep_tasks`).run();
    testDb.prepare(`DELETE FROM beo_events`).run();
  });

  it('returns empty with no upcoming events', () => {
    assert.equal(ctx.renderBeoEvents(testDb, LOC, DATE).text, '');
  });

  it('renders BEOs with id/title/date/covers/notes/prep + "(none yet)" fallback', () => {
    testDb.prepare(
      `INSERT INTO beo_events (id, location_id, title, event_date, guest_count, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(101, LOC, 'Smith Wedding', '2026-05-15', 80, 'No nuts');
    testDb.prepare(
      `INSERT INTO beo_events (id, location_id, title, event_date, guest_count, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(102, LOC, 'Bare Event', '2026-05-15', 20, '');
    const ptStmt = testDb.prepare(
      `INSERT INTO beo_prep_tasks (location_id, event_id, task, done, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    );
    ptStmt.run(LOC, 101, 'Brine chicken', 1, 1);
    ptStmt.run(LOC, 101, 'Plate salads', 0, 2);
    const out = ctx.renderBeoEvents(testDb, LOC, DATE);
    assert.match(out.text, /UPCOMING BANQUETS & PARTIES \(BEO\):/);
    assert.match(out.text, /\[BEO ID: 101\] Smith Wedding on 2026-05-15 \(Covers: 80\)/);
    assert.match(out.text, /Notes: No nuts/);
    assert.match(out.text, /\[DONE\] Brine chicken/);
    assert.match(out.text, /\[PENDING\] Plate salads/);
    assert.match(out.text, /Prep List: \(none yet\)/);
    assert.match(out.source.detail, /2 upcoming party/);
  });
});

describe('renderOrderGuide', () => {
  beforeEach(() => testDb.prepare(`DELETE FROM order_guide_items`).run());

  it('returns empty with no rows and lists items otherwise', () => {
    let out = ctx.renderOrderGuide(testDb, LOC);
    assert.equal(out.text, '');
    testDb.prepare(
      `INSERT INTO order_guide_items (location_id, ingredient, base_qty, unit) VALUES (?, ?, ?, ?)`
    ).run(LOC, 'Tomato', 24, 'lb');
    out = ctx.renderOrderGuide(testDb, LOC);
    assert.match(out.text, /ORDER GUIDE/);
    assert.match(out.text, /Tomato \(Target: 24 lb\)/);
    assert.match(out.source.detail, /1 item/);
  });
});

// ─── buildGroundedContext is now a coordinator ──────────────────────

describe('buildGroundedContext (coordinator)', () => {
  beforeEach(() => {
    for (const t of [
      'eighty_six', 'inventory_updates', 'station_signoffs',
      'sales_lines', 'order_guide_items', 'beo_prep_tasks', 'beo_events',
    ]) testDb.prepare(`DELETE FROM ${t}`).run();
  });

  it('emits unconditional headers in deterministic order, omits gated blocks', async () => {
    const { contextText, sources } = await ctx.buildGroundedContext(LOC, 'hello there');
    const headers = [
      /DATE: /,
      /LOCATION_ID: default/,
      /ACTIVE 86 \(unresolved, today\):/,
      /RECENT INVENTORY UPDATES \(today, newest first\):/,
      /STATION SIGN-OFFS \(today\):/,
      /LINE CHECK PROGRESS/,
      /RECIPES \(Isolated in XML tags/,
      /NOT IN THIS CONTEXT:/,
    ];
    let idx = -1;
    for (const h of headers) {
      const next = contextText.search(h);
      assert.ok(next >= 0, `missing header ${h}`);
      assert.ok(next > idx, `header ${h} out of order`);
      idx = next;
    }
    // Conditional blocks did not fire.
    for (const re of [
      /HACCP CRITICAL CONTROL POINTS:/,
      /HISTORICAL 86 FREQUENCY/,
      /SYSCO RECENT ITEMS/,
      /LABOR SUMMARY/,
    ]) assert.doesNotMatch(contextText, re);
    // Always-on source present even with no rows.
    const e86 = sources.find((s) => s.type === 'eighty_six');
    assert.ok(e86);
    assert.match(e86.detail, /0 active/);
  });

  it('fires the historical-86 conditional on a HISTORY_KEYWORD', async () => {
    testDb.prepare(
      `INSERT INTO eighty_six (item, shift_date, location_id, created_at) VALUES (?, ?, ?, ?)`
    ).run('Salmon', '2026-05-01', LOC, '2026-05-01T10:00:00Z');
    const { contextText, sources } = await ctx.buildGroundedContext(
      LOC, 'what items get 86d most often?'
    );
    assert.match(contextText, /HISTORICAL 86 FREQUENCY \(Lifetime\):/);
    assert.match(contextText, /Salmon: 86'd 1 times/);
    assert.ok(sources.find((s) => s.type === 'eighty_six_history'));
  });
});
