#!/usr/bin/env node
// Tests for lib/wageNotices — CO Wage Theft Transparency Act (L7).
// Run: node --test tests/js/test-wage-notices-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WAGE_NOTICE_REASONS,
  WAGE_NOTICE_PAY_BASES,
  WAGE_NOTICE_REFRESH_DAYS,
  WAGE_NOTICE_CITATION,
  validateNoticeShape,
  requiresNewNotice,
  summarizeFreshness,
} from '../../lib/wageNotices.ts';

describe('Constants', () => {
  it('reason enum matches schema CHECK', () => {
    assert.deepStrictEqual([...WAGE_NOTICE_REASONS], ['hire', 'rate_change', 'annual', 'law_change', 'other']);
  });
  it('pay_basis enum matches schema CHECK', () => {
    assert.deepStrictEqual([...WAGE_NOTICE_PAY_BASES], ['hourly', 'salary', 'commission', 'tipped']);
  });
  it('refresh window is 365 days', () => {
    assert.strictEqual(WAGE_NOTICE_REFRESH_DAYS, 365);
  });
  it('citation references C.R.S. §8-4-103 + COMPS', () => {
    assert.match(WAGE_NOTICE_CITATION, /8-4-103/);
    assert.match(WAGE_NOTICE_CITATION, /COMPS/);
  });
});

describe('validateNoticeShape', () => {
  function notice(over = {}) {
    return {
      reason: 'hire',
      wage_rate_cents: 1500,
      pay_basis: 'hourly',
      tip_credit_cents: null,
      signed_on: '2026-04-20',
      document_path: null,
      ...over,
    };
  }

  it('happy path is ok', () => {
    assert.strictEqual(validateNoticeShape(notice()).ok, true);
  });

  it('rejects unknown reason', () => {
    const r = validateNoticeShape(notice({ reason: 'fired' }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /reason/);
  });

  it('rejects unknown pay_basis', () => {
    const r = validateNoticeShape(notice({ pay_basis: 'piece_rate' }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /pay_basis/);
  });

  it('rejects float wage_rate_cents', () => {
    const r = validateNoticeShape(notice({ wage_rate_cents: 14.81 }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /non-negative integer/);
  });

  it('rejects negative wage_rate_cents', () => {
    assert.strictEqual(validateNoticeShape(notice({ wage_rate_cents: -100 })).ok, false);
  });

  it('rejects malformed signed_on', () => {
    const r = validateNoticeShape(notice({ signed_on: '4/20/2026' }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /YYYY-MM-DD/);
  });

  it('tip_credit_cents > 0 on non-tipped pay_basis is rejected', () => {
    const r = validateNoticeShape(notice({ pay_basis: 'hourly', tip_credit_cents: 302 }));
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /tipped/);
  });

  it('tip_credit_cents = 0 is allowed on any pay_basis', () => {
    assert.strictEqual(validateNoticeShape(notice({ pay_basis: 'hourly', tip_credit_cents: 0 })).ok, true);
  });

  it('tip_credit_cents > 0 on tipped pay_basis is allowed', () => {
    assert.strictEqual(validateNoticeShape(notice({ pay_basis: 'tipped', tip_credit_cents: 302 })).ok, true);
  });

  it('rejects float tip_credit_cents', () => {
    const r = validateNoticeShape(notice({ pay_basis: 'tipped', tip_credit_cents: 3.02 }));
    assert.strictEqual(r.ok, false);
  });
});

describe('requiresNewNotice', () => {
  const PREV = {
    cook_id: 'alice',
    reason: 'hire',
    wage_rate_cents: 1500,
    pay_basis: 'hourly',
    tip_credit_cents: 0,
    signed_on: '2025-04-20',
  };

  it('no prev → required (hire)', () => {
    const r = requiresNewNotice({
      prev: null,
      next: { reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2026-04-20' },
    });
    assert.strictEqual(r.required, true);
    assert.match(r.reason, /no notice/);
  });

  it('reason=rate_change → required', () => {
    const r = requiresNewNotice({
      prev: PREV,
      next: { reason: 'rate_change', wage_rate_cents: 1600, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2026-01-01' },
    });
    assert.strictEqual(r.required, true);
    assert.match(r.reason, /rate change/);
  });

  it('pay_basis flip → required', () => {
    const r = requiresNewNotice({
      prev: PREV,
      next: { reason: 'other', wage_rate_cents: 1500, pay_basis: 'salary', tip_credit_cents: 0, signed_on: '2025-06-01' },
    });
    assert.strictEqual(r.required, true);
    assert.match(r.reason, /pay basis changed/);
  });

  it('wage rate change → required (even reason=other)', () => {
    const r = requiresNewNotice({
      prev: PREV,
      next: { reason: 'other', wage_rate_cents: 1600, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2025-06-01' },
    });
    assert.strictEqual(r.required, true);
    assert.match(r.reason, /wage rate changed/);
  });

  it('tip credit toggled on → required', () => {
    const tippedPrev = { ...PREV, pay_basis: 'tipped', wage_rate_cents: 1179, tip_credit_cents: 0 };
    const r = requiresNewNotice({
      prev: tippedPrev,
      next: { reason: 'other', wage_rate_cents: 1179, pay_basis: 'tipped', tip_credit_cents: 302, signed_on: '2025-06-01' },
    });
    assert.strictEqual(r.required, true);
    assert.match(r.reason, /tip credit/);
  });

  it('annual refresh: prev signed >365 days ago → required', () => {
    const r = requiresNewNotice({
      prev: { ...PREV, signed_on: '2024-01-01' },
      next: { reason: 'annual', wage_rate_cents: 1500, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2025-04-20' },
      today: '2025-04-20',
    });
    assert.strictEqual(r.required, true);
    assert.match(r.reason, /annual refresh/);
  });

  it('within 365 days, no changes → NOT required', () => {
    const r = requiresNewNotice({
      prev: PREV,
      next: { reason: 'annual', wage_rate_cents: 1500, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2025-09-01' },
      today: '2025-09-01',
    });
    assert.strictEqual(r.required, false);
  });

  it('exactly 365 days → NOT required (boundary inclusive)', () => {
    const r = requiresNewNotice({
      prev: { ...PREV, signed_on: '2025-04-20' },
      next: { reason: 'annual', wage_rate_cents: 1500, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2026-04-20' },
      today: '2026-04-20',
    });
    assert.strictEqual(r.required, false);
  });

  it('366 days → required', () => {
    const r = requiresNewNotice({
      prev: { ...PREV, signed_on: '2025-04-20' },
      next: { reason: 'annual', wage_rate_cents: 1500, pay_basis: 'hourly', tip_credit_cents: 0, signed_on: '2026-04-21' },
      today: '2026-04-21',
    });
    assert.strictEqual(r.required, true);
  });
});

describe('summarizeFreshness', () => {
  it('returns one row per cook with days_since + needs_new', () => {
    const rows = [
      { cook_id: 'alice', signed_on: '2025-04-20', reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly' },
      { cook_id: 'bob', signed_on: '2024-01-01', reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly' },
    ];
    const out = summarizeFreshness(rows, '2026-04-20');
    assert.strictEqual(out.length, 2);
    const alice = out.find((x) => x.cook_id === 'alice');
    const bob = out.find((x) => x.cook_id === 'bob');
    assert.strictEqual(alice.days_since, 365);
    assert.strictEqual(alice.needs_new, false);
    assert.ok(bob.days_since > 365);
    assert.strictEqual(bob.needs_new, true);
  });

  it('empty input → empty output', () => {
    assert.deepStrictEqual(summarizeFreshness([], '2026-04-20'), []);
  });
});
