#!/usr/bin/env node
// Tests for the print-ready settlement summary:
//   - lib/settlementPrint.ts  (pure HTML renderer)
//   - app/api/shows/[id]/settlement/pdf/route.js  (PIN-gated GET)
//
// Run: node --experimental-strip-types --test tests/js/test-settlement-pdf.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

process.env.LARIAT_PIN = '1234';
process.env.LARIAT_PIN_SECRET = 'test-secret-do-not-use-in-prod';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { renderSettlementHtml } = await import('../../lib/settlementPrint.ts');
const pdfRoute = await import('../../app/api/shows/[id]/settlement/pdf/route.js');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

async function validCookie() {
  return signPinCookieValue('test-secret-do-not-use-in-prod');
}

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'The <Test> Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
  db.prepare(
    `INSERT INTO show_deals
       (show_id, location_id, guarantee_cents, vs_pct_after_costs,
        costs_off_top_json, buyout_cents, notes, updated_at, updated_by_cook_id)
     VALUES (1, 'default', 100000, 0.85, '[{"label":"Sound","cents":5000}]',
             0, NULL, datetime('now'), 'cook-jane')`,
  ).run();
  db.prepare(
    `INSERT INTO box_office_lines
       (show_id, location_id, source, qty, face_price, fees)
     VALUES (1, 'default', 'dice', 100, 25.0, 2.5)`,
  ).run();
  db.prepare(
    `INSERT INTO toast_sales_daily
       (location_id, shift_date, net_sales, orders, guests, comparison_group)
     VALUES ('default', '2026-05-01', 1234.56, 87, 142, 0)`,
  ).run();
});

// ---- renderSettlementHtml (pure helper) -----------------------------------

const sampleSummary = {
  show: { id: 1, bandName: "Bob's Heavy Sounds", date: '2026-05-01', locationId: 'default' },
  deal: {
    guaranteeCents: 100000,
    vsPctAfterCosts: 0.85,
    costsOffTop: [{ label: 'Sound', cents: 5000 }],
    buyoutCents: 0,
  },
  ticketing: {
    grossCents: 250000,
    feesCents: 25000,
    netCents: 225000,
    bySource: {
      dice: { qty: 100, grossCents: 250000 },
      walkup: { qty: 0, grossCents: 0 },
      comp: { qty: 0, grossCents: 0 },
      will_call: { qty: 0, grossCents: 0 },
      guestlist: { qty: 0, grossCents: 0 },
    },
  },
  toast: { totalCents: 123456, ordersCount: 87, guestsCount: 142, attributionDate: '2026-05-01', rowsFound: 1 },
  talent: { guaranteeCents: 100000, vsBonusCents: 87500, buyoutCents: 0, totalCents: 187500 },
  costsOffTopCents: 5000,
  netDoorCents: 32500,
  computedAt: '2026-05-13T00:00:00.000Z',
};

describe('renderSettlementHtml', () => {
  it('returns a standalone HTML document', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.match(html, /<html[^>]*>/);
    assert.match(html, /<\/html>\s*$/);
  });

  it('contains the band name', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.ok(html.includes("Bob&#39;s Heavy Sounds"));
  });

  it('escapes HTML entities in band name (XSS guard)', () => {
    const evil = { ...sampleSummary, show: { ...sampleSummary.show, bandName: '<script>alert(1)</script>' } };
    const html = renderSettlementHtml(evil);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
    assert.ok(html.includes('&lt;script&gt;'), 'angle brackets must be escaped');
  });

  it('formats money as $X,XXX.XX', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.ok(html.includes('$2,500.00'), 'gross 250000 cents');
    assert.ok(html.includes('$1,875.00'), 'talent total 187500 cents');
    assert.ok(html.includes('$325.00'), 'net door 32500 cents');
  });

  it('renders negative amounts with a leading minus', () => {
    const html = renderSettlementHtml({ ...sampleSummary, netDoorCents: -12345 });
    assert.ok(html.includes('-$123.45'));
  });

  it('includes @media print rules', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.match(html, /@media\s+print/);
  });

  it('lists every ticket source with non-zero qty', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.ok(html.includes('DICE'));
    assert.ok(html.includes('100')); // qty
  });

  it('hides ticket sources with zero qty', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.ok(!html.includes('Walk-up'), 'walk-up has qty 0, should not appear');
  });

  it('shows costs-off-top line items', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.ok(html.includes('Sound'));
    assert.ok(html.includes('$50.00'));
  });

  it('renders the show date in ISO form', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.ok(html.includes('2026-05-01'));
  });

  it('auto-triggers window.print on load', () => {
    const html = renderSettlementHtml(sampleSummary);
    assert.match(html, /window\.print\(\)/);
  });

  it('renders a warning row when Toast has no rows for the date', () => {
    const noToast = { ...sampleSummary, toast: { ...sampleSummary.toast, rowsFound: 0 } };
    const html = renderSettlementHtml(noToast);
    assert.match(html, /no toast rows/i);
  });
});

// ---- GET /api/shows/[id]/settlement/pdf -----------------------------------

describe('GET /api/shows/[id]/settlement/pdf — auth', () => {
  it('returns 401 with no cookie', async () => {
    const req = new Request('http://localhost/api/shows/1/settlement/pdf');
    const res = await pdfRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 401);
  });
});

describe('GET /api/shows/[id]/settlement/pdf — happy path', () => {
  it('audit H7: response includes Content-Security-Policy + X-Content-Type-Options headers', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/1/settlement/pdf', {
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await pdfRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src/);
    assert.match(csp, /style-src/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  });

  it('returns 200 with text/html', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/1/settlement/pdf', {
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await pdfRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /^text\/html/);
  });

  it('returns markup containing the band name and key totals', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/1/settlement/pdf', {
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await pdfRoute.GET(req, { params: { id: '1' } });
    const html = await res.text();
    assert.ok(html.includes('The &lt;Test&gt; Band'), 'band name escaped + present');
    assert.match(html, /\$2,500\.00/);  // 100 * $25 gross
    assert.match(html, /\$1,000\.00/);  // guarantee
    assert.match(html, /2026-05-01/);
  });

  it('returns 400 for non-integer id', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/abc/settlement/pdf', {
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await pdfRoute.GET(req, { params: { id: 'abc' } });
    assert.equal(res.status, 400);
  });

  it('returns 404 for unknown show', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/9999/settlement/pdf', {
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await pdfRoute.GET(req, { params: { id: '9999' } });
    assert.equal(res.status, 404);
  });
});
