#!/usr/bin/env node
// T8 — Cooking shrinkage in inventory depletion.
//
// Acceptance (docs/MAPPING_ENGINE_GAPS.md §T8):
//   Toast sells cooked 8 oz burger. Inventory must deplete raw 10.66 oz
//   (25% loss), not 8 oz. When source='toast', look up bom_lines.loss_factor
//   and divide: raw = cooked / (1 - loss_factor).
//
// These tests exercise both layers:
//   1. The pure-math module (lib/inventoryShrinkage.ts) — directly, without
//      a request round-trip. Covers loss_factor boundary cases and the
//      formatting helpers.
//   2. The route handler (app/api/inventory/route.js) — in-process via
//      `new Request(...)`, mirroring test-temp-log-route.mjs. Asserts the
//      inventory_updates row shape after a POST and the source-gate
//      semantic (only source='toast' triggers shrinkage).
//
// Run: npm run test:t8-cooking-shrinkage

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-t8-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// Dynamic imports so the resolver hook is active.
const db = await import('../../lib/db.ts');
const route = await import('../../app/api/inventory/route.js');
const shrinkage = await import('../../lib/inventoryShrinkage.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;
const { todayISO } = db;
const {
  applyShrinkage,
  resolveCookingShrinkage,
  lookupLossFactor,
  formatDepletionDelta,
  formatShrinkageNote,
} = shrinkage;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM inventory_updates');
  testDb.exec('DELETE FROM bom_lines');
});

// ── helpers ───────────────────────────────────────────────────────

function postReq(body) {
  return new Request('http://localhost/api/inventory', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedBom({ recipe_id, ingredient, loss_factor, location_id = 'default' }) {
  testDb
    .prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, loss_factor, location_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(recipe_id, ingredient, 1, 'oz', loss_factor, location_id);
}

function readLatest() {
  return testDb
    .prepare(
      `SELECT shift_date, station_id, item, delta, direction, note,
              cook_id, location_id
         FROM inventory_updates
        ORDER BY id DESC LIMIT 1`,
    )
    .get();
}

// Parse the numeric portion of a formatted delta like "-10.667 oz".
function parseDelta(s) {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : NaN;
}

// ── pure math ─────────────────────────────────────────────────────

describe('applyShrinkage (pure)', () => {
  it('8 oz cooked with 0.25 loss → 10.667 oz raw (acceptance case)', () => {
    const r = applyShrinkage(8, 0.25, 'oz');
    assert.strictEqual(r.applied, true);
    assert.strictEqual(r.loss_factor, 0.25);
    assert.strictEqual(r.reason, 'shrinkage_applied');
    assert.ok(Math.abs(r.raw_qty - 10.6667) < 0.001, `raw_qty=${r.raw_qty}`);
  });

  it('loss_factor=null → no shrinkage, reason=no_loss_factor', () => {
    const r = applyShrinkage(8, null, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.raw_qty, 8);
    assert.strictEqual(r.reason, 'no_loss_factor');
  });

  it('loss_factor=0 → no shrinkage, reason=loss_factor_out_of_range (0 edge)', () => {
    const r = applyShrinkage(8, 0, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.raw_qty, 8);
    assert.strictEqual(r.reason, 'loss_factor_out_of_range');
  });

  it('loss_factor=1 → fall back to cooked (divide-by-zero guard)', () => {
    const r = applyShrinkage(8, 1, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.raw_qty, 8);
    assert.strictEqual(r.reason, 'loss_factor_out_of_range');
  });

  it('loss_factor negative → fall back', () => {
    const r = applyShrinkage(8, -0.1, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.reason, 'loss_factor_out_of_range');
  });

  it('loss_factor > 1 → fall back', () => {
    const r = applyShrinkage(8, 1.5, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.reason, 'loss_factor_out_of_range');
  });

  it('cooked_qty <= 0 → reason=invalid_cooked_qty', () => {
    const r = applyShrinkage(0, 0.25, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.reason, 'invalid_cooked_qty');
  });

  it('loss_factor=0.5 halves the denominator → raw = 2 × cooked', () => {
    const r = applyShrinkage(10, 0.5, 'g');
    assert.strictEqual(r.applied, true);
    assert.ok(Math.abs(r.raw_qty - 20) < 1e-9, `raw_qty=${r.raw_qty}`);
  });
});

describe('formatDepletionDelta', () => {
  it('produces a negative signed string with unit', () => {
    assert.strictEqual(formatDepletionDelta(10.6667, 'oz'), '-10.667 oz');
  });
  it('already-negative input still produces negative', () => {
    assert.strictEqual(formatDepletionDelta(-10.6667, 'oz'), '-10.667 oz');
  });
  it('strips trailing zeros', () => {
    assert.strictEqual(formatDepletionDelta(8, 'oz'), '-8 oz');
  });
  it('omits unit suffix when unit is null/empty', () => {
    assert.strictEqual(formatDepletionDelta(8, null), '-8');
    assert.strictEqual(formatDepletionDelta(8, ''), '-8');
  });
});

describe('formatShrinkageNote', () => {
  it('includes cooked, loss_factor, and raw when applied', () => {
    const note = formatShrinkageNote({
      cooked_qty: 8, unit: 'oz', raw_qty: 10.6667,
      applied: true, loss_factor: 0.25, reason: 'shrinkage_applied',
    });
    assert.match(note, /T8/);
    assert.match(note, /cooked=8 oz/);
    assert.match(note, /1-0\.25/);
    assert.match(note, /raw=10\.667 oz/);
    assert.match(note, /shrinkage_applied/);
  });
  it('explains "no shrinkage" when not applied', () => {
    const note = formatShrinkageNote({
      cooked_qty: 8, unit: 'oz', raw_qty: 8,
      applied: false, loss_factor: null, reason: 'no_loss_factor',
    });
    assert.match(note, /no shrinkage/);
    assert.match(note, /no_loss_factor/);
  });
});

// ── DB lookup ──────────────────────────────────────────────────────

describe('lookupLossFactor', () => {
  it('returns the loss_factor for a matching (recipe_id, ingredient)', () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const lf = lookupLossFactor(testDb, {
      recipe_id: 'burger', ingredient: 'patty', location_id: 'default',
    });
    assert.strictEqual(lf, 0.25);
  });

  it('is case-insensitive and whitespace-tolerant on ingredient', () => {
    seedBom({ recipe_id: 'burger', ingredient: 'Patty', loss_factor: 0.25 });
    const lf = lookupLossFactor(testDb, {
      recipe_id: 'burger', ingredient: '  patty ', location_id: 'default',
    });
    assert.strictEqual(lf, 0.25);
  });

  it('returns null when no matching row exists', () => {
    const lf = lookupLossFactor(testDb, {
      recipe_id: 'nope', ingredient: 'x', location_id: 'default',
    });
    assert.strictEqual(lf, null);
  });

  it('returns null when the matching row has NULL loss_factor', () => {
    seedBom({ recipe_id: 'burger', ingredient: 'bun', loss_factor: null });
    const lf = lookupLossFactor(testDb, {
      recipe_id: 'burger', ingredient: 'bun', location_id: 'default',
    });
    assert.strictEqual(lf, null);
  });

  it('respects location_id — rows for other sites are invisible', () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25, location_id: 'uptown' });
    const lf = lookupLossFactor(testDb, {
      recipe_id: 'burger', ingredient: 'patty', location_id: 'default',
    });
    assert.strictEqual(lf, null);
  });
});

describe('resolveCookingShrinkage', () => {
  it('reason=no_bom_line when no row matches', () => {
    const r = resolveCookingShrinkage(testDb, {
      recipe_id: 'x', ingredient: 'y', location_id: 'default',
      cooked_qty: 8, unit: 'oz',
    });
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.raw_qty, 8);
    assert.strictEqual(r.reason, 'no_bom_line');
  });

  it('reason=shrinkage_applied for the acceptance case', () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const r = resolveCookingShrinkage(testDb, {
      recipe_id: 'burger', ingredient: 'patty', location_id: 'default',
      cooked_qty: 8, unit: 'oz',
    });
    assert.strictEqual(r.applied, true);
    assert.ok(Math.abs(r.raw_qty - 10.6667) < 0.001);
  });
});

// ── route handler ─────────────────────────────────────────────────

describe('POST /api/inventory — T8 acceptance', () => {
  it('Toast sale of 1 burger (8 oz patty, lf=0.25) depletes 10.667 oz raw (±0.1)', async () => {
    // Spec §T8 test fixture verbatim.
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: 8,
      unit: 'oz',
      source: 'toast',
      direction: 'out',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.source, 'toast');
    assert.strictEqual(body.shrinkage_applied, true);
    assert.strictEqual(body.shrinkage_reason, 'shrinkage_applied');
    assert.ok(Math.abs(body.raw_qty - 10.6667) < 0.001);

    const row = readLatest();
    assert.strictEqual(row.item, 'patty');
    assert.strictEqual(row.direction, 'out');
    assert.ok(Math.abs(parseDelta(row.delta) - -10.667) < 0.1,
      `delta=${row.delta}, parsed=${parseDelta(row.delta)}`);
    // Note captures the shrinkage math for audit.
    assert.match(row.note, /T8/);
    assert.match(row.note, /cooked=8 oz/);
    assert.match(row.note, /raw=10\.667 oz/);
    assert.match(row.note, /shrinkage_applied/);
  });
});

describe('POST /api/inventory — source gate', () => {
  it('source=manual does NOT apply shrinkage even if loss_factor exists', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: 8,
      unit: 'oz',
      source: 'manual',
      direction: 'out',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.source, 'manual');
    assert.strictEqual(body.shrinkage_applied, false);

    const row = readLatest();
    // delta should be -8, not -10.667 — manual preserves cooked-qty semantic.
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01,
      `expected -8, got ${row.delta}`);
    // No shrinkage audit line for the manual path.
    assert.ok(row.note == null || !/shrinkage_applied/.test(row.note),
      `manual POST should not carry shrinkage note; got ${row.note}`);
  });

  it('default source (no source field) is manual-equivalent — no shrinkage', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: 8,
      unit: 'oz',
    }));
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    const row = readLatest();
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01);
  });
});

describe('POST /api/inventory — shrinkage fallbacks when source=toast', () => {
  it('no bom row → delta=-8 oz, reason=no_bom_line', async () => {
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'no-such-recipe',
      qty: 8,
      unit: 'oz',
      source: 'toast',
    }));
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    assert.strictEqual(body.shrinkage_reason, 'no_bom_line');
    const row = readLatest();
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01);
    assert.match(row.note, /no_bom_line/);
  });

  it('loss_factor NULL on the bom row → delta=-8 oz, reason=no_loss_factor', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: null });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: 8,
      unit: 'oz',
      source: 'toast',
    }));
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    assert.strictEqual(body.shrinkage_reason, 'no_loss_factor');
    const row = readLatest();
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01);
  });

  it('loss_factor=0 → delta=-8 oz (no shrinkage, boundary case)', async () => {
    seedBom({ recipe_id: 'salad', ingredient: 'lettuce', loss_factor: 0 });
    const res = await POST(postReq({
      item: 'lettuce',
      ingredient: 'lettuce',
      recipe_id: 'salad',
      qty: 8,
      unit: 'oz',
      source: 'toast',
    }));
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    assert.strictEqual(body.shrinkage_reason, 'loss_factor_out_of_range');
    const row = readLatest();
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01);
  });

  it('loss_factor=1 → delta=-8 oz (divide-by-zero guard)', async () => {
    seedBom({ recipe_id: 'evap', ingredient: 'water', loss_factor: 1 });
    const res = await POST(postReq({
      item: 'water',
      ingredient: 'water',
      recipe_id: 'evap',
      qty: 8,
      unit: 'oz',
      source: 'toast',
    }));
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    assert.strictEqual(body.shrinkage_reason, 'loss_factor_out_of_range');
    const row = readLatest();
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01);
  });

  it('missing recipe_id on a toast POST → falls through to cooked-qty delta', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      qty: 8,
      unit: 'oz',
      source: 'toast',
    }));
    const body = await res.json();
    // Gate fails (no recipe_id), so shrinkage_applied remains false.
    assert.strictEqual(body.shrinkage_applied, false);
    const row = readLatest();
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01);
  });
});

describe('POST /api/inventory — validation', () => {
  it('missing item → 400', async () => {
    const res = await POST(postReq({ qty: 8, unit: 'oz' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /item required/i);
  });

  it('free-text delta from a non-toast caller is preserved verbatim', async () => {
    // Matches the pre-T8 contract: kitchen cooks can still POST free-text
    // quantities like "half a quart" without shrinkage mangling them.
    const res = await POST(postReq({
      item: 'cilantro',
      delta: 'half a bunch',
      direction: 'waste',
    }));
    assert.strictEqual(res.status, 200);
    const row = readLatest();
    assert.strictEqual(row.delta, 'half a bunch');
    assert.strictEqual(row.direction, 'waste');
  });
});

describe('GET /api/inventory', () => {
  it('returns today\'s inventory_updates rows, newest first', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    await POST(postReq({
      item: 'patty', ingredient: 'patty', recipe_id: 'burger',
      qty: 8, unit: 'oz', source: 'toast',
    }));
    await POST(postReq({ item: 'cilantro', delta: '1 bunch', direction: 'waste' }));
    const res = await GET(new Request(`http://localhost/api/inventory?date=${todayISO()}`));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.strictEqual(body.rows[0].item, 'cilantro'); // newest first
    assert.strictEqual(body.rows[1].item, 'patty');
  });
});

describe('SHRINKAGE_REASONS constant', () => {
  // Guards against future reason-key drift. The strings are the public contract —
  // they persist in inventory_updates.note and tests/T9 greps for them.
  it('APPLIED === "shrinkage_applied"', () => {
    assert.strictEqual(shrinkage.SHRINKAGE_REASONS.APPLIED, 'shrinkage_applied');
  });
  it('NO_LOSS_FACTOR === "no_loss_factor"', () => {
    assert.strictEqual(shrinkage.SHRINKAGE_REASONS.NO_LOSS_FACTOR, 'no_loss_factor');
  });
  it('OUT_OF_RANGE === "loss_factor_out_of_range"', () => {
    assert.strictEqual(shrinkage.SHRINKAGE_REASONS.OUT_OF_RANGE, 'loss_factor_out_of_range');
  });
  it('NO_BOM_LINE === "no_bom_line"', () => {
    assert.strictEqual(shrinkage.SHRINKAGE_REASONS.NO_BOM_LINE, 'no_bom_line');
  });
  it('INVALID_QTY === "invalid_cooked_qty"', () => {
    assert.strictEqual(shrinkage.SHRINKAGE_REASONS.INVALID_QTY, 'invalid_cooked_qty');
  });
});

describe('POST /api/inventory — extended edge cases (nit #5)', () => {
  // === Negative qty at the route level ===
  // Design choice: the T8 gate requires qty > 0, so a negative qty (qty=-5)
  // fails the gate condition `qty != null && qty > 0`, which means:
  //   - isToastSource branch: gate skips → shrinkage_applied=false, no BOM lookup
  //   - non-toast qty branch: also skips (qty > 0 is false)
  //   - delta stays whatever body.delta was (null → stored as null)
  // We assert 200 with shrinkage_applied=false and null/absent delta. The row
  // IS persisted (we do not 400 on negative qty at this layer; callers are
  // responsible for pre-validation). This is "sensible fallback" behavior —
  // the row is stored without a computed delta so the operator sees it in the
  // audit log rather than losing the data silently.
  it('negative qty (toast source) — gate skips, row stored with null delta', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: -5,
      unit: 'oz',
      source: 'toast',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.shrinkage_applied, false);
    const row = readLatest();
    assert.strictEqual(row.item, 'patty');
    // No computed delta — null or whatever body.delta was (not supplied → null).
    assert.ok(row.delta == null || row.delta === '', `expected null/empty delta, got ${row.delta}`);
  });

  // === Ingredient typo → no_bom_line ===
  // recipe='burger' exists in the DB but 'Patty Deluxe' is not in its BOM —
  // resolveCookingShrinkage finds no matching row and returns no_bom_line.
  it('known recipe but unknown ingredient → no_bom_line', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty deluxe',
      ingredient: 'Patty Deluxe',
      recipe_id: 'burger',
      qty: 8,
      unit: 'oz',
      source: 'toast',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    assert.strictEqual(body.shrinkage_reason, 'no_bom_line');
    const row = readLatest();
    assert.match(row.note, /no_bom_line/);
    // delta falls back to cooked qty
    assert.ok(Math.abs(parseDelta(row.delta) - -8) < 0.01, `expected -8, got ${row.delta}`);
  });

  // === String qty → treated as missing (typeof check) ===
  // The route's qty parse: `typeof body.qty === 'number' ? body.qty : null`.
  // A string '8' fails the typeof check → qty=null → T8 gate skips.
  // Non-toast qty branch also skips (qty == null).
  // This is consistent "missing qty" behavior — no delta computed.
  it('string qty ("8") → treated as missing, no delta computed', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: '8',   // string, not number
      unit: 'oz',
      source: 'toast',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.shrinkage_applied, false);
    // qty parsed as null → gate skips → no computed delta
    const row = readLatest();
    assert.ok(row.delta == null || row.delta === '', `expected null/empty delta for string qty, got ${row.delta}`);
  });

  // === NaN qty → treated as missing ===
  // typeof NaN === 'number' is TRUE, so qty=NaN passes the typeof check.
  // But the T8 gate's `qty > 0` is false for NaN (NaN comparisons are always
  // false) → gate skips → shrinkage_applied=false, no delta from qty path.
  it('NaN qty → gate skips, no shrinkage', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: NaN,
      unit: 'oz',
      source: 'toast',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    // NaN serializes to null in JSON, so route receives qty=null → gate skips.
    const row = readLatest();
    assert.ok(row.delta == null || row.delta === '', `expected null/empty delta for NaN qty, got ${row.delta}`);
  });

  // === Infinity qty → applyShrinkage's Number.isFinite guard → invalid_cooked_qty ===
  // Infinity > 0 is true, so it passes the route gate and enters resolveCookingShrinkage.
  // applyShrinkage's `!Number.isFinite(cooked_qty)` guard catches it → invalid_cooked_qty.
  // Note: JSON.stringify(Infinity) === 'null' — Infinity serializes to null in JSON,
  // so the route receives null → qty=null → gate skips (qty > 0 is false for null).
  // The invalid_cooked_qty path can only be hit by in-process callers (e.g. test of
  // applyShrinkage directly). We assert the JSON-transport behavior: null → gate skip.
  it('Infinity qty over JSON → serializes to null, gate skips (no shrinkage)', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: Infinity,
      unit: 'oz',
      source: 'toast',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.shrinkage_applied, false);
    const row = readLatest();
    assert.ok(row.delta == null || row.delta === '', `expected null/empty delta for Infinity qty, got ${row.delta}`);
  });

  // === applyShrinkage directly: Infinity is caught by Number.isFinite ===
  // Validates the pure-fn guard in isolation (route JSON transport can't reach it).
  it('applyShrinkage(Infinity, 0.25) → invalid_cooked_qty (pure-fn guard)', () => {
    const r = applyShrinkage(Infinity, 0.25, 'oz');
    assert.strictEqual(r.applied, false);
    assert.strictEqual(r.reason, 'invalid_cooked_qty');
  });

  // === source casing normalization (nit #2) ===
  // POST with source='TOAST' (uppercase) — the route lowercases at parse time.
  // Shrinkage fires; response echoes source='toast' (lowercase), not 'TOAST'.
  it('source="TOAST" (uppercase) → normalized to "toast" in response', async () => {
    seedBom({ recipe_id: 'burger', ingredient: 'patty', loss_factor: 0.25 });
    const res = await POST(postReq({
      item: 'patty',
      ingredient: 'patty',
      recipe_id: 'burger',
      qty: 8,
      unit: 'oz',
      source: 'TOAST',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.source, 'toast', 'source should be echoed lowercase');
    assert.strictEqual(body.shrinkage_applied, true, 'shrinkage should fire for TOAST');
  });
});
