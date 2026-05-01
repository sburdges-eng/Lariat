#!/usr/bin/env node
// Rule-module tests for lib/receiving.ts.
//
// Covers the pure decision paths of validateReceivingReading + the
// per-category aggregate classifyDeliveries. The route-integration
// tests (temp DB + Request/Response) live in test-receiving-api.mjs.
//
// Run: node --test tests/js/test-receiving-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RECEIVING_CATEGORIES,
  RECEIVING_RULES,
  classifyDeliveries,
  dbStatusFor,
  getReceivingRule,
  libStatusFor,
  validateReceivingReading,
} from '../../lib/receiving.ts';

// ── Category registry ─────────────────────────────────────────────

describe('RECEIVING_CATEGORIES covers the expected truck-to-door set', () => {
  it('exposes the six+ categories the brief calls out', () => {
    const required = [
      'refrigerated',
      'frozen',
      'shell_eggs',
      'hot_held',
      'dry_goods',
      'produce',
    ];
    for (const id of required) {
      assert.ok(RECEIVING_CATEGORIES.includes(id), `missing category: ${id}`);
    }
    assert.ok(RECEIVING_CATEGORIES.length >= 6, `expected ≥ 6 categories, got ${RECEIVING_CATEGORIES.length}`);
  });

  it('every category has a rule with an FDA citation', () => {
    for (const id of RECEIVING_CATEGORIES) {
      const rule = RECEIVING_RULES[id];
      assert.ok(rule, `missing rule for ${id}`);
      assert.match(rule.citation, /§/, `${id} citation missing §-cite: ${rule.citation}`);
    }
  });

  it('refrigerated ceiling is 41°F per §3-501.16', () => {
    const r = RECEIVING_RULES.refrigerated;
    assert.strictEqual(r.required_max_f, 41);
    assert.strictEqual(r.requires_reading, true);
  });

  it('frozen practical ceiling is 10°F (matches temp-log registry)', () => {
    const r = RECEIVING_RULES.frozen;
    assert.strictEqual(r.required_max_f, 10);
  });

  it('shell_eggs ceiling is 45°F per §3-202.11(A)', () => {
    const r = RECEIVING_RULES.shell_eggs;
    assert.strictEqual(r.required_max_f, 45);
  });

  it('hot_held floor is 135°F per §3-501.16(A)(1)', () => {
    const r = RECEIVING_RULES.hot_held;
    assert.strictEqual(r.required_min_f, 135);
    assert.strictEqual(r.required_max_f, null);
  });

  it('dry_goods and produce do not require a reading', () => {
    assert.strictEqual(RECEIVING_RULES.dry_goods.requires_reading, false);
    assert.strictEqual(RECEIVING_RULES.produce.requires_reading, false);
  });

  it('getReceivingRule returns null for unknown id', () => {
    assert.strictEqual(getReceivingRule('not_a_category'), null);
    assert.strictEqual(getReceivingRule(null), null);
    assert.strictEqual(getReceivingRule(undefined), null);
    assert.strictEqual(getReceivingRule(42), null);
  });
});

// ── validateReceivingReading — happy path ─────────────────────────

describe('validateReceivingReading — ok path', () => {
  it('refrigerated at 38°F is ok', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 38, package_ok: true });
    assert.strictEqual(v.status, 'ok');
    assert.strictEqual(v.reason, null);
    assert.strictEqual(v.required_max_f, 41);
  });

  it('refrigerated at 41°F exactly is ok (inclusive bound)', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 41, package_ok: true });
    assert.strictEqual(v.status, 'ok');
  });

  it('frozen at -5°F is ok', () => {
    const v = validateReceivingReading({ category: 'frozen', reading_f: -5, package_ok: true });
    assert.strictEqual(v.status, 'ok');
  });

  it('shell_eggs at 45°F is ok (inclusive)', () => {
    const v = validateReceivingReading({ category: 'shell_eggs', reading_f: 45, package_ok: true });
    assert.strictEqual(v.status, 'ok');
  });

  it('hot_held at 140°F is ok', () => {
    const v = validateReceivingReading({ category: 'hot_held', reading_f: 140, package_ok: true });
    assert.strictEqual(v.status, 'ok');
  });

  it('dry_goods with NO reading is ok — category does not require a probe', () => {
    const v = validateReceivingReading({ category: 'dry_goods', package_ok: true });
    assert.strictEqual(v.status, 'ok');
  });

  it('produce with NO reading is ok', () => {
    const v = validateReceivingReading({ category: 'produce', package_ok: true });
    assert.strictEqual(v.status, 'ok');
  });

  it('omitted package_ok defaults to ok (defaults to "intact" — checkbox is an explicit yes/no)', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 38 });
    assert.strictEqual(v.status, 'ok');
  });
});

// ── validateReceivingReading — accept_with_note (drift band) ──────

describe('validateReceivingReading — accept_with_note path', () => {
  it('refrigerated at 43°F is accept_with_note (drift band 41–45)', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 43, package_ok: true });
    assert.strictEqual(v.status, 'accept_with_note');
    assert.match(v.reason, /drift band/);
    assert.strictEqual(v.required_max_f, 41);
  });

  it('refrigerated at 45°F exactly is accept_with_note (top of drift)', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 45, package_ok: true });
    assert.strictEqual(v.status, 'accept_with_note');
  });

  it('frozen at 20°F is accept_with_note (drift band 10–25)', () => {
    const v = validateReceivingReading({ category: 'frozen', reading_f: 20, package_ok: true });
    assert.strictEqual(v.status, 'accept_with_note');
  });

  it('hot_held at 132°F is accept_with_note (drift floor 130)', () => {
    const v = validateReceivingReading({ category: 'hot_held', reading_f: 132, package_ok: true });
    assert.strictEqual(v.status, 'accept_with_note');
  });

  it('shell_eggs at 48°F is accept_with_note (drift band 45–50)', () => {
    const v = validateReceivingReading({ category: 'shell_eggs', reading_f: 48, package_ok: true });
    assert.strictEqual(v.status, 'accept_with_note');
  });
});

// ── validateReceivingReading — rejected path ──────────────────────

describe('validateReceivingReading — rejected path', () => {
  it('refrigerated at 46°F is rejected (past drift ceiling)', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 46, package_ok: true });
    assert.strictEqual(v.status, 'rejected');
    assert.match(v.reason, /exceeds/);
  });

  it('frozen at 30°F is rejected (thawed)', () => {
    const v = validateReceivingReading({ category: 'frozen', reading_f: 30, package_ok: true });
    assert.strictEqual(v.status, 'rejected');
  });

  it('hot_held at 125°F is rejected (below drift floor)', () => {
    const v = validateReceivingReading({ category: 'hot_held', reading_f: 125, package_ok: true });
    assert.strictEqual(v.status, 'rejected');
  });

  it('package_ok=false beats a temp that would otherwise pass', () => {
    const v = validateReceivingReading({
      category: 'refrigerated',
      reading_f: 38,
      package_ok: false,
    });
    assert.strictEqual(v.status, 'rejected');
    assert.match(v.reason, /package/);
    assert.match(v.citation, /§3-202\.15/);
  });

  it('package_ok=false rejects a dry-goods delivery too', () => {
    const v = validateReceivingReading({ category: 'dry_goods', package_ok: false });
    assert.strictEqual(v.status, 'rejected');
    assert.match(v.reason, /package/);
  });

  it('sell-by date in the past rejects per §3-101.11', () => {
    const v = validateReceivingReading({
      category: 'refrigerated',
      reading_f: 38,
      package_ok: true,
      expiration_date: '2020-01-01',
      received_at: '2026-04-21',
    });
    assert.strictEqual(v.status, 'rejected');
    assert.match(v.citation, /§3-101\.11/);
  });

  it('sell-by same-day as receipt is accepted', () => {
    const v = validateReceivingReading({
      category: 'refrigerated',
      reading_f: 38,
      package_ok: true,
      expiration_date: '2026-04-21',
      received_at: '2026-04-21',
    });
    assert.strictEqual(v.status, 'ok');
  });

  it('sell-by in the future is accepted', () => {
    const v = validateReceivingReading({
      category: 'refrigerated',
      reading_f: 38,
      package_ok: true,
      expiration_date: '2026-05-01',
      received_at: '2026-04-21',
    });
    assert.strictEqual(v.status, 'ok');
  });

  it('refrigerated with NO reading rejects — temp is a required CCP', () => {
    const v = validateReceivingReading({ category: 'refrigerated', package_ok: true });
    assert.strictEqual(v.status, 'rejected');
    assert.match(v.reason, /temperature reading/);
  });

  it('frozen with NO reading rejects', () => {
    const v = validateReceivingReading({ category: 'frozen', package_ok: true });
    assert.strictEqual(v.status, 'rejected');
  });

  it('absurd reading (off the charts) rejects', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: 9999, package_ok: true });
    assert.strictEqual(v.status, 'rejected');
    assert.match(v.reason, /off the charts/);
  });

  it('NaN reading is treated as no reading and rejects', () => {
    const v = validateReceivingReading({ category: 'refrigerated', reading_f: Number.NaN, package_ok: true });
    assert.strictEqual(v.status, 'rejected');
  });
});

// ── validateReceivingReading — unknown category ───────────────────

describe('validateReceivingReading — unknown category', () => {
  // Direct lib callers (test fixtures, legacy-export scripts) must get a
  // non-throwing path when category isn't in the registry. The route
  // hard-400s these upstream; the lib stays loud-but-safe.
  it('unknown category returns accept_with_note, does NOT throw', () => {
    assert.doesNotThrow(() => {
      validateReceivingReading({ category: 'specialty_bakery', package_ok: true });
    });
    const v = validateReceivingReading({ category: 'specialty_bakery', package_ok: true });
    assert.strictEqual(v.status, 'accept_with_note');
    assert.match(v.reason, /Unknown category/);
    assert.strictEqual(v.citation, null);
    assert.strictEqual(v.required_max_f, null);
    assert.strictEqual(v.closed_loop_error, null);
  });

  it('null/undefined category falls through to accept_with_note', () => {
    const a = validateReceivingReading({ category: null, package_ok: true });
    assert.strictEqual(a.status, 'accept_with_note');
    const b = validateReceivingReading({ category: undefined, package_ok: true });
    assert.strictEqual(b.status, 'accept_with_note');
  });

  it('unknown category still surfaces closed_loop_error when qty/unit are malformed', () => {
    const v = validateReceivingReading({
      category: 'specialty_bakery',
      package_ok: true,
      received_qty: -5,
      received_unit: 'lb',
    });
    assert.strictEqual(v.status, 'accept_with_note');
    assert.match(v.closed_loop_error, /received_qty/);
  });
});


// ── classifyDeliveries — tile aggregator ──────────────────────────

describe('classifyDeliveries — per-category tiles', () => {
  it('empty day returns one gray tile per category', () => {
    const s = classifyDeliveries([]);
    assert.strictEqual(s.length, RECEIVING_CATEGORIES.length);
    for (const t of s) {
      assert.strictEqual(t.status, 'gray');
      assert.strictEqual(t.total, 0);
    }
  });

  it('one accepted refrigerated delivery turns the refrigerated tile green, rest stay gray', () => {
    const s = classifyDeliveries([
      { category: 'refrigerated', status: 'accepted', created_at: '2026-04-21 09:00:00' },
    ]);
    const ref = s.find((t) => t.category === 'refrigerated');
    assert.strictEqual(ref.status, 'green');
    assert.strictEqual(ref.accepted, 1);
    const frozen = s.find((t) => t.category === 'frozen');
    assert.strictEqual(frozen.status, 'gray');
  });

  it('accept-with-note tile is yellow', () => {
    const s = classifyDeliveries(
      [{ category: 'refrigerated', status: 'accepted_with_note', created_at: null }],
      { expectAllCategories: false },
    );
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].status, 'yellow');
    assert.strictEqual(s[0].accepted_with_note, 1);
  });

  it('rejected tile is red even when other accepts exist in the same category', () => {
    const s = classifyDeliveries(
      [
        { category: 'refrigerated', status: 'accepted', created_at: '2026-04-21 08:00:00' },
        { category: 'refrigerated', status: 'accepted', created_at: '2026-04-21 09:00:00' },
        { category: 'refrigerated', status: 'rejected', created_at: '2026-04-21 10:00:00' },
      ],
      { expectAllCategories: false },
    );
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].status, 'red');
    assert.strictEqual(s[0].rejected, 1);
    assert.strictEqual(s[0].accepted, 2);
  });

  it('rows with an orphan category are dropped from the aggregate', () => {
    const s = classifyDeliveries(
      [
        { category: 'refrigerated', status: 'accepted', created_at: null },
        { category: 'legacy_retired', status: 'accepted', created_at: null },
      ],
      { expectAllCategories: false },
    );
    assert.strictEqual(s.length, 1);
    assert.strictEqual(s[0].category, 'refrigerated');
  });

  it('last_at tracks the latest created_at in the bucket', () => {
    const s = classifyDeliveries(
      [
        { category: 'refrigerated', status: 'accepted', created_at: '2026-04-21 08:00:00' },
        { category: 'refrigerated', status: 'accepted', created_at: '2026-04-21 14:00:00' },
        { category: 'refrigerated', status: 'accepted', created_at: '2026-04-21 10:00:00' },
      ],
      { expectAllCategories: false },
    );
    assert.strictEqual(s[0].last_at, '2026-04-21 14:00:00');
  });

  it('returned summary shape carries citation + drift bands for UI tooltip', () => {
    const s = classifyDeliveries(
      [{ category: 'refrigerated', status: 'accepted', created_at: null }],
      { expectAllCategories: false },
    );
    const keys = Object.keys(s[0]).sort();
    assert.deepStrictEqual(keys, [
      'accepted',
      'accepted_with_note',
      'category',
      'citation',
      'drift_max_f',
      'drift_min_f',
      'label',
      'last_at',
      'rejected',
      'required_max_f',
      'required_min_f',
      'requires_reading',
      'status',
      'total',
    ]);
  });
});

// ── status helpers ───────────────────────────────────────────────

describe('dbStatusFor / libStatusFor', () => {
  it('round-trips ok → accepted → ok', () => {
    assert.strictEqual(dbStatusFor('ok'), 'accepted');
    assert.strictEqual(libStatusFor('accepted'), 'ok');
  });

  it('round-trips accept_with_note → accepted_with_note → accept_with_note', () => {
    assert.strictEqual(dbStatusFor('accept_with_note'), 'accepted_with_note');
    assert.strictEqual(libStatusFor('accepted_with_note'), 'accept_with_note');
  });

  it('round-trips rejected → rejected → rejected', () => {
    assert.strictEqual(dbStatusFor('rejected'), 'rejected');
    assert.strictEqual(libStatusFor('rejected'), 'rejected');
  });
});
