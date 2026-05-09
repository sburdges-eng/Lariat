#!/usr/bin/env node
// POST /api/compute/status period-override parsing.
//
// Audit reference: docs/audit/2026-05-08-codebase-audit.md §4 Compute, MEDIUM:
//   "POST handler reads period_start / period_end from URL query params
//    only — `curl -d '{"period_start":"..."}'` silently ignored the body,
//    inconsistent with locationFromBody / other Lariat compute routes."
//
// Fix: body fields take precedence over URL params. Malformed body falls
// back to URL params. Empty request uses defaultPeriod() unchanged.
//
// The route fires triggerComputeEngine via setImmediate (docs/PATTERNS.md §9
// fire-and-forget). The accounting_variance INSERT happens on that turn —
// we await one setImmediate cycle before reading the row.
//
// Run: node --experimental-strip-types --test tests/js/test-compute-status-route.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-compute-status-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// Run with PIN unset → LAN-trust mode → no PIN gate. Lets the test focus
// on body/URL parameter parsing without the cookie plumbing (exercised
// elsewhere in test-pin-defense-in-depth.mjs).
const ORIGINAL_PIN = process.env.LARIAT_PIN;
delete process.env.LARIAT_PIN;

const dbMod = await import('../../lib/db.ts');
dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

const routeMod = await import('../../app/api/compute/status/route.js');
const POST = routeMod.POST;

const LOC = 'default';
const ROUTE_URL_BASE = 'http://localhost/api/compute/status';

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

function resetTables() {
  testDb.exec(`
    DELETE FROM accounting_variance;
    DELETE FROM margin_snapshots;
    DELETE FROM recipe_costs;
    DELETE FROM sales_lines;
    DELETE FROM bom_lines;
    DELETE FROM vendor_prices;
    DELETE FROM spend_monthly;
  `);
}

// Wait long enough for the route's setImmediate-deferred
// triggerComputeEngine to complete. The route schedules the work via
// setImmediate; better-sqlite3 itself is synchronous so once the
// callback runs, the variance row is committed. One setImmediate flush
// is enough but we add a microtask drain for safety on slow CI.
async function flushDeferred() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function readLatestVariance() {
  return testDb.prepare(
    `SELECT period_start, period_end, theoretical_cogs, actual_cogs
       FROM accounting_variance
      WHERE location_id = ?
      ORDER BY id DESC LIMIT 1`,
  ).get(LOC);
}

function makePost(url, { body } = {}) {
  const headers = new Headers();
  let serialized;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    serialized = typeof body === 'string' ? body : JSON.stringify(body);
    headers.set('content-length', String(Buffer.byteLength(serialized)));
  }
  return new Request(url, {
    method: 'POST',
    headers,
    body: serialized,
  });
}

describe('POST /api/compute/status — period override parsing', () => {
  beforeEach(resetTables);

  it('case 1: URL params only — variance row uses URL period', async () => {
    const url = `${ROUTE_URL_BASE}?period_start=2026-04-01&period_end=2026-04-30`;
    const res = await POST(makePost(url));
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row, 'expected an accounting_variance row');
    assert.equal(row.period_start, '2026-04-01');
    assert.equal(row.period_end, '2026-04-30');
  });

  it('case 2: body only — variance row uses body period (RED pre-fix)', async () => {
    const res = await POST(
      makePost(ROUTE_URL_BASE, {
        body: { period_start: '2026-05-01', period_end: '2026-05-31' },
      }),
    );
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row, 'expected an accounting_variance row');
    assert.equal(
      row.period_start, '2026-05-01',
      'body period_start should be honored when no URL params are present',
    );
    assert.equal(row.period_end, '2026-05-31');
  });

  it('case 3: body wins over URL — body fields take precedence', async () => {
    const url = `${ROUTE_URL_BASE}?period_start=2026-01-01&period_end=2026-01-31`;
    const res = await POST(
      makePost(url, {
        body: { period_start: '2026-06-01', period_end: '2026-06-30' },
      }),
    );
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row);
    assert.equal(row.period_start, '2026-06-01');
    assert.equal(row.period_end, '2026-06-30');
  });

  it('case 4: malformed JSON body falls back to URL params', async () => {
    const url = `${ROUTE_URL_BASE}?period_start=2026-03-01&period_end=2026-03-31`;
    const res = await POST(makePost(url, { body: '{not valid json' }));
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row);
    assert.equal(row.period_start, '2026-03-01');
    assert.equal(row.period_end, '2026-03-31');
  });

  it('case 5: empty request — neither URL nor body — uses defaultPeriod', async () => {
    const res = await POST(makePost(ROUTE_URL_BASE));
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row);
    // defaultPeriod is "first of current month" → today, both ISO YYYY-MM-DD.
    assert.match(row.period_start, /^\d{4}-\d{2}-01$/);
    assert.match(row.period_end, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('case 6: non-string body fields are ignored — falls back to URL', async () => {
    const url = `${ROUTE_URL_BASE}?period_start=2026-02-01&period_end=2026-02-28`;
    const res = await POST(
      makePost(url, {
        // numbers / nulls — type-guarded out, URL wins.
        body: { period_start: 12345, period_end: null },
      }),
    );
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row);
    assert.equal(row.period_start, '2026-02-01');
    assert.equal(row.period_end, '2026-02-28');
  });

  it('case 7: only one body field set — that one wins, the other falls back to URL', async () => {
    const url = `${ROUTE_URL_BASE}?period_start=2026-07-01&period_end=2026-07-31`;
    const res = await POST(
      makePost(url, {
        body: { period_start: '2026-08-15' }, // body only sets start
      }),
    );
    assert.equal(res.status, 200);
    await flushDeferred();
    const row = readLatestVariance();
    assert.ok(row);
    assert.equal(row.period_start, '2026-08-15', 'body start wins');
    assert.equal(row.period_end, '2026-07-31', 'URL end is preserved');
  });
});
