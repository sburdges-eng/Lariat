#!/usr/bin/env node
// Tests for the GH #247 PIN-aware context tier in buildGroundedContext.
//
// Pre-fix the coordinator unconditionally injected:
//   - sales velocity (sales_lines aggregates) + daily sales trend
//     (toast_sales_daily incl. YoY)              — always on
//   - labor summary (7shifts cost / hours / per-employee)
//                                                 — on LABOR_KEYWORDS
//   - performance reviews                         — on PERFORMANCE_KEYWORDS
//   - gold-star recognition history               — on GOLD_STAR_KEYWORDS
//
// Anyone on the LAN — including any cook at any tablet — could POST a
// labor / sales / performance-flavored question to /api/kitchen-assistant
// and get a model summary of that data, because the route is unauth by
// design (line-cook ergonomics). The system prompt in lib/ollama.ts
// explicitly said this data was NOT available; the contradiction also
// taught the model to ignore SOURCE_BOUNDARIES.
//
// Fix: thread a `hasPin` flag through buildGroundedContext. The cook tier
// (default, no PIN cookie) gets none of the manager-only blocks; instead
// it gets short "ask a manager" sentinel lines so the LLM routes the cook
// to a manager rather than hallucinating numbers.
//
// Run:
//   node --experimental-strip-types --test \
//        tests/js/test-kitchen-assistant-context-pin.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-context-pin-'));
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
  for (const t of [
    'eighty_six', 'inventory_updates', 'station_signoffs',
    'sales_lines', 'order_guide_items', 'beo_prep_tasks', 'beo_events',
    'gold_stars', 'performance_reviews', 'toast_sales_daily',
  ]) {
    try { testDb.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore — table may not exist */ }
  }
});

const LOC = 'default';

function seedSales() {
  // A small non-zero sales footprint so renderSalesVelocity and
  // renderDailySalesTrend would actually produce content if invoked.
  const today = new Date().toISOString().slice(0, 10);
  testDb.prepare(
    `INSERT INTO sales_lines (location_id, period_label, item_name, quantity_sold, net_sales, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(LOC, today, 'Smoked Brisket Sandwich', 28, 420, 'test');
  try {
    testDb.prepare(
      `INSERT INTO toast_sales_daily
         (location_id, shift_date, net_sales, orders, guests, comparison_group)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(LOC, today, 12500, 320, 410, 0);
  } catch { /* table may not exist on this schema build */ }
}

function seedRecognition() {
  testDb.prepare(
    `INSERT INTO gold_stars (location_id, cook_name, reason, stars, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(LOC, 'A. Cook', 'best in show', 3, new Date().toISOString());
}

// ── #247 (a): sales blocks gated on hasPin ───────────────────────────

describe('buildGroundedContext sales gating (#247)', () => {
  it('cook-tier omits SALES VELOCITY and DAILY SALES TREND even with rows present', async () => {
    seedSales();
    const { contextText } = await ctx.buildGroundedContext(LOC, 'how is the sandwich selling today?');
    assert.doesNotMatch(
      contextText,
      /SALES VELOCITY/i,
      'cook-tier must not see sales aggregates',
    );
    assert.doesNotMatch(
      contextText,
      /DAILY SALES TREND/i,
      'cook-tier must not see Toast totals',
    );
  });

  it('manager-tier (hasPin=true) restores SALES VELOCITY when data is present', async () => {
    seedSales();
    const { contextText } = await ctx.buildGroundedContext(
      LOC, 'how is the sandwich selling today?', { hasPin: true },
    );
    assert.match(
      contextText,
      /SALES VELOCITY/i,
      'manager-tier should see the sales aggregates',
    );
  });
});

// ── #247 (b): LABOR_KEYWORDS gated on hasPin ─────────────────────────

describe('buildGroundedContext labor gating (#247)', () => {
  it('cook-tier replaces LABOR SUMMARY with an "ask a manager" sentinel on labor questions', async () => {
    const { contextText } = await ctx.buildGroundedContext(LOC, 'show me labor cost and overtime hours');
    assert.doesNotMatch(
      contextText,
      /LABOR SUMMARY \(from 7shifts export\):/i,
      'cook-tier MUST NOT see the 7shifts block',
    );
    assert.match(
      contextText,
      /LABOR SUMMARY: not available at this auth tier/i,
      'cook-tier should get the manager-redirect sentinel',
    );
  });

  it('non-labor question does not inject the labor sentinel either', async () => {
    const { contextText } = await ctx.buildGroundedContext(LOC, 'what sandwiches do we sell?');
    assert.doesNotMatch(contextText, /LABOR SUMMARY/i);
  });
});

// ── #247 (c): GOLD_STAR / PERFORMANCE_KEYWORDS gated on hasPin ──────

describe('buildGroundedContext recognition + performance gating (#247)', () => {
  it('cook-tier replaces gold-star and review blocks with sentinels', async () => {
    seedRecognition();
    const goldQuestion = await ctx.buildGroundedContext(LOC, 'who got a gold star recently?');
    assert.doesNotMatch(
      goldQuestion.contextText,
      /A\. Cook/i,
      'cook-tier must not see the actual recognition row',
    );
    assert.match(goldQuestion.contextText, /GOLD STAR RECOGNITION: not available/i);

    const perfQuestion = await ctx.buildGroundedContext(LOC, 'do we have a recent performance review for the line?');
    assert.match(
      perfQuestion.contextText,
      /PERFORMANCE REVIEWS: not available/i,
    );
  });

  it('manager-tier surfaces the gold-star row again', async () => {
    seedRecognition();
    const { contextText } = await ctx.buildGroundedContext(
      LOC, 'who got a gold star recently?', { hasPin: true },
    );
    assert.match(contextText, /A\. Cook/i, 'manager-tier should see the recognition row');
  });
});

// ── #247 (d): trailing SOURCE_BOUNDARIES reconciliation ─────────────

describe('buildGroundedContext trailing source-boundaries line (#247)', () => {
  it('cook-tier names labor + recognition as NOT in context', async () => {
    const { contextText } = await ctx.buildGroundedContext(LOC, 'hello');
    assert.match(
      contextText,
      /NOT IN THIS CONTEXT:[^\n]*labor figures/i,
      'cook-tier trailing boundary should reflect what is actually injected',
    );
  });

  it('manager-tier omits labor + Toast totals from the NOT-available list', async () => {
    const { contextText } = await ctx.buildGroundedContext(LOC, 'hello', { hasPin: true });
    const trail = contextText.match(/NOT IN THIS CONTEXT:[^\n]*/i)?.[0] || '';
    assert.doesNotMatch(trail, /labor figures/i);
    assert.doesNotMatch(trail, /Toast totals/i);
  });
});
