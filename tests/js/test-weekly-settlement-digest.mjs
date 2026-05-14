#!/usr/bin/env node
// Tests for scripts/weekly-settlement-digest.mjs and renderDigestHtml.
//
// Run: node --experimental-strip-types --test tests/js/test-weekly-settlement-digest.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { renderDigestHtml } = await import('../../lib/settlementPrint.ts');
const { getSettlement } = await import('../../lib/settlementRepo.ts');
const { weekRange, runDigest } = await import('../../scripts/weekly-settlement-digest.mjs');

// ---- weekRange ------------------------------------------------------------

describe('weekRange', () => {
  it('returns Mon..Sun for a midweek anchor', () => {
    const wed = new Date('2026-05-06T00:00:00Z'); // Wed
    const r = weekRange(wed);
    assert.equal(r.start, '2026-05-04'); // Mon
    assert.equal(r.end, '2026-05-10');   // Sun
    assert.equal(r.label, '2026-W19');
  });

  it('returns the same week for any day in that week', () => {
    const mon = weekRange(new Date('2026-05-04T00:00:00Z'));
    const sun = weekRange(new Date('2026-05-10T00:00:00Z'));
    assert.deepEqual(mon, sun);
  });

  it('handles year boundary', () => {
    // 2026-01-01 is a Thursday → ISO week 2026-W01 (Mon Dec 29 2025 .. Sun Jan 4 2026)
    const r = weekRange(new Date('2026-01-01T00:00:00Z'));
    assert.equal(r.start, '2025-12-29');
    assert.equal(r.end, '2026-01-04');
    assert.equal(r.label, '2026-W01');
  });
});

// ---- renderDigestHtml -----------------------------------------------------

function mkSummary(overrides) {
  return {
    show: { id: 1, bandName: 'Band A', date: '2026-05-05', locationId: 'default' },
    deal: { guaranteeCents: 100000, vsPctAfterCosts: 0.85, costsOffTop: [], buyoutCents: 0 },
    ticketing: {
      grossCents: 200000,
      feesCents: 20000,
      netCents: 180000,
      bySource: {
        dice: { qty: 80, grossCents: 200000 },
        walkup: { qty: 0, grossCents: 0 },
        comp: { qty: 0, grossCents: 0 },
        will_call: { qty: 0, grossCents: 0 },
        guestlist: { qty: 0, grossCents: 0 },
      },
    },
    toast: { totalCents: 100000, ordersCount: 50, guestsCount: 80, attributionDate: '2026-05-05', rowsFound: 1 },
    talent: { guaranteeCents: 100000, vsBonusCents: 70000, buyoutCents: 0, totalCents: 170000 },
    costsOffTopCents: 0,
    netDoorCents: 10000,
    computedAt: '2026-05-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('renderDigestHtml', () => {
  it('renders empty digest with helpful zero-state', () => {
    const html = renderDigestHtml([], { weekOf: '2026-W19' });
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.match(html, /2026-W19/);
    assert.match(html, /no settlements/i);
  });

  it('renders one section per show with page-break between them', () => {
    const a = mkSummary({ show: { id: 1, bandName: 'Band A', date: '2026-05-05', locationId: 'default' } });
    const b = mkSummary({ show: { id: 2, bandName: 'Band B', date: '2026-05-07', locationId: 'default' } });
    const html = renderDigestHtml([a, b], { weekOf: '2026-W19' });
    assert.ok(html.includes('Band A'));
    assert.ok(html.includes('Band B'));
    assert.ok(html.includes('page-break'));
  });

  it('rollup totals across all shows', () => {
    const a = mkSummary({
      ticketing: { ...mkSummary().ticketing, grossCents: 100000 },
      talent: { ...mkSummary().talent, totalCents: 50000 },
      netDoorCents: 20000,
    });
    const b = mkSummary({
      ticketing: { ...mkSummary().ticketing, grossCents: 200000 },
      talent: { ...mkSummary().talent, totalCents: 80000 },
      netDoorCents: 30000,
    });
    const html = renderDigestHtml([a, b], { weekOf: '2026-W19' });
    assert.ok(html.includes('$3,000.00')); // total tickets 300000c
    assert.ok(html.includes('$1,300.00')); // total talent 130000c
    assert.ok(html.includes('$500.00'));   // total net door 50000c
  });

  it('honors noAutoPrint flag', () => {
    const html = renderDigestHtml([mkSummary()], { weekOf: '2026-W19', noAutoPrint: true });
    assert.ok(!/window\.print\(\)/.test(html));
  });

  it('includes window.print() when noAutoPrint omitted', () => {
    const html = renderDigestHtml([mkSummary()], { weekOf: '2026-W19' });
    assert.match(html, /window\.print\(\)/);
  });
});

// ---- runDigest (integration) ----------------------------------------------

describe('runDigest', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-digest-'));
    // Seed: ingest_run, three shows in week 2026-W19 (May 4–10),
    // and one show in the prior week.
    db.prepare(
      `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
    ).run();
    const seedShow = db.prepare(
      `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
       VALUES (?, 'default', ?, ?, 1, datetime('now'), 1)`,
    );
    seedShow.run(101, 'Friday Headliner', '2026-05-08');
    seedShow.run(102, 'Tuesday Opener', '2026-05-05');
    seedShow.run(103, 'Saturday Special', '2026-05-09');
    seedShow.run(104, 'Prior Week Band', '2026-05-03');

    // One has a deal + tickets, the others use defaults so the
    // settlement endpoint still produces a valid summary.
    db.prepare(
      `INSERT INTO show_deals
         (show_id, location_id, guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents, notes, updated_at, updated_by_cook_id)
       VALUES (101, 'default', 200000, 0.80, '[]', 0, NULL, datetime('now'), 'cook-x')`,
    ).run();
    db.prepare(
      `INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
       VALUES (101, 'default', 'dice', 100, 30.0, 3.0)`,
    ).run();
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a digest with exactly the in-week shows, sorted by date', async () => {
    const outPath = path.join(tmpDir, 'wk.html');
    const res = await runDigest(
      { location: 'default', weekOf: '2026-05-06', out: outPath },
      { getDb, getSettlement, renderDigestHtml },
    );
    assert.equal(res.count, 3);
    assert.equal(res.range.start, '2026-05-04');
    assert.equal(res.range.end, '2026-05-10');

    const html = fs.readFileSync(outPath, 'utf8');
    assert.ok(html.includes('Tuesday Opener'));
    assert.ok(html.includes('Friday Headliner'));
    assert.ok(html.includes('Saturday Special'));
    assert.ok(!html.includes('Prior Week Band'), 'prior-week show must not appear');
    // Sort order: Tuesday (5/5) before Friday (5/8) before Saturday (5/9).
    const idxTue = html.indexOf('Tuesday Opener');
    const idxFri = html.indexOf('Friday Headliner');
    const idxSat = html.indexOf('Saturday Special');
    assert.ok(idxTue < idxFri && idxFri < idxSat, `expected Tue<Fri<Sat, got ${idxTue}/${idxFri}/${idxSat}`);
  });

  it('writes the empty-state digest when no shows in the requested week', async () => {
    const outPath = path.join(tmpDir, 'empty.html');
    const res = await runDigest(
      { location: 'default', weekOf: '2026-06-15', out: outPath },
      { getDb, getSettlement, renderDigestHtml },
    );
    assert.equal(res.count, 0);
    const html = fs.readFileSync(outPath, 'utf8');
    assert.match(html, /no settlements/i);
  });
});
