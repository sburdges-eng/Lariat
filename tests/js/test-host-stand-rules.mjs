#!/usr/bin/env node
// Pure-rule tests for lib/hostStand.ts.
// Run: node --experimental-strip-types --test tests/js/test-host-stand-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const m = await import('../../lib/hostStand.ts');
const {
  sanitizeWaitlistInput,
  isValidStatusTransition,
  summarizeWaitlist,
  minutesBetween,
  MAX_PARTY_NAME_LENGTH,
  MAX_PARTY_SIZE,
} = m;

describe('sanitizeWaitlistInput', () => {
  it('returns clean payload on valid input', () => {
    const out = sanitizeWaitlistInput({ party_name: 'Hendricks', party_size: 4 });
    assert.deepEqual(out, { party_name: 'Hendricks', party_size: 4, phone: null, notes: null });
  });

  it('trims party_name', () => {
    const out = sanitizeWaitlistInput({ party_name: '  Smith  ', party_size: 2 });
    assert.equal(out.party_name, 'Smith');
  });

  it('returns null on blank/missing party_name', () => {
    assert.equal(sanitizeWaitlistInput({ party_size: 2 }), null);
    assert.equal(sanitizeWaitlistInput({ party_name: '   ', party_size: 2 }), null);
    assert.equal(sanitizeWaitlistInput({ party_name: '', party_size: 2 }), null);
  });

  it('returns null on missing / non-numeric / non-positive party_size', () => {
    assert.equal(sanitizeWaitlistInput({ party_name: 'X' }), null);
    assert.equal(sanitizeWaitlistInput({ party_name: 'X', party_size: 'oops' }), null);
    assert.equal(sanitizeWaitlistInput({ party_name: 'X', party_size: 0 }), null);
    assert.equal(sanitizeWaitlistInput({ party_name: 'X', party_size: -3 }), null);
  });

  it('floors fractional party_size', () => {
    const out = sanitizeWaitlistInput({ party_name: 'X', party_size: 3.7 });
    assert.equal(out.party_size, 3);
  });

  it('clips name + phone + notes', () => {
    const out = sanitizeWaitlistInput({
      party_name: 'x'.repeat(200),
      party_size: 2,
      phone: '5'.repeat(100),
      notes: 'n'.repeat(2000),
    });
    assert.equal(out.party_name.length, MAX_PARTY_NAME_LENGTH);
    assert.equal(out.phone.length, 32);
    assert.equal(out.notes.length, 500);
  });

  it('caps party_size at MAX_PARTY_SIZE', () => {
    const out = sanitizeWaitlistInput({ party_name: 'X', party_size: 9999 });
    assert.equal(out.party_size, MAX_PARTY_SIZE);
  });

  it('coerces blank-string phone/notes to null', () => {
    const out = sanitizeWaitlistInput({ party_name: 'X', party_size: 2, phone: '  ', notes: '' });
    assert.equal(out.phone, null);
    assert.equal(out.notes, null);
  });

  it('returns null on non-object input', () => {
    assert.equal(sanitizeWaitlistInput(null), null);
    assert.equal(sanitizeWaitlistInput('string'), null);
    assert.equal(sanitizeWaitlistInput(42), null);
  });
});

describe('isValidStatusTransition', () => {
  it('allows waiting → seated and waiting → left', () => {
    assert.equal(isValidStatusTransition('waiting', 'seated'), true);
    assert.equal(isValidStatusTransition('waiting', 'left'), true);
  });

  it('rejects all other transitions', () => {
    assert.equal(isValidStatusTransition('seated', 'waiting'), false);
    assert.equal(isValidStatusTransition('seated', 'left'), false);
    assert.equal(isValidStatusTransition('left', 'waiting'), false);
    assert.equal(isValidStatusTransition('left', 'seated'), false);
    assert.equal(isValidStatusTransition('waiting', 'waiting'), false);
  });

  it('rejects bogus current/next values', () => {
    assert.equal(isValidStatusTransition('garbage', 'seated'), false);
  });
});

describe('minutesBetween', () => {
  it('returns floored minutes when end > start', () => {
    assert.equal(
      minutesBetween('2026-05-13T18:00:00Z', '2026-05-13T18:15:30Z'),
      15,
    );
  });
  it('returns 0 when end < start (no negative waits)', () => {
    assert.equal(
      minutesBetween('2026-05-13T19:00:00Z', '2026-05-13T18:00:00Z'),
      0,
    );
  });
  it('returns 0 on unparseable input', () => {
    assert.equal(minutesBetween('not-a-date', '2026-05-13T18:00:00Z'), 0);
    assert.equal(minutesBetween('2026-05-13T18:00:00Z', null), 0);
  });
});

describe('summarizeWaitlist', () => {
  const NOW = '2026-05-13T19:00:00.000Z';

  const make = (overrides) => ({
    id: overrides.id ?? 1,
    location_id: 'default',
    party_name: 'X',
    party_size: 4,
    joined_at: NOW,
    status: 'waiting',
    seated_at: null,
    left_at: null,
    phone: null,
    notes: null,
    ...overrides,
  });

  it('returns zero summary on empty input', () => {
    const s = summarizeWaitlist([], NOW);
    assert.equal(s.total, 0);
    assert.equal(s.waiting, 0);
    assert.equal(s.seated_today, 0);
    assert.equal(s.left_today, 0);
    assert.equal(s.avg_wait_minutes, null);
    assert.equal(s.longest_wait_minutes, null);
    assert.equal(s.longest_wait_party_id, null);
  });

  it('returns zero summary on non-array input', () => {
    const s = summarizeWaitlist(null, NOW);
    assert.equal(s.waiting, 0);
  });

  it('counts waiting parties and tracks longest waiter', () => {
    const rows = [
      make({ id: 1, joined_at: '2026-05-13T18:10:00.000Z' }),  // 50 min
      make({ id: 2, joined_at: '2026-05-13T18:40:00.000Z' }),  // 20 min
      make({ id: 3, joined_at: '2026-05-13T18:55:00.000Z' }),  //  5 min
    ];
    const s = summarizeWaitlist(rows, NOW);
    assert.equal(s.waiting, 3);
    assert.equal(s.longest_wait_minutes, 50);
    assert.equal(s.longest_wait_party_id, 1);
  });

  it('counts seated_today and computes avg wait', () => {
    const rows = [
      make({ id: 1, status: 'seated', joined_at: '2026-05-13T18:00:00.000Z', seated_at: '2026-05-13T18:20:00.000Z' }), // 20
      make({ id: 2, status: 'seated', joined_at: '2026-05-13T18:30:00.000Z', seated_at: '2026-05-13T18:40:00.000Z' }), // 10
      make({ id: 3, status: 'seated', joined_at: '2026-05-12T18:00:00.000Z', seated_at: '2026-05-12T18:30:00.000Z' }), // yesterday — skip
    ];
    const s = summarizeWaitlist(rows, NOW);
    assert.equal(s.seated_today, 2);
    assert.equal(s.avg_wait_minutes, 15);
  });

  it('counts left_today only when left_at is today', () => {
    const rows = [
      make({ id: 1, status: 'left', left_at: '2026-05-13T18:30:00.000Z' }),
      make({ id: 2, status: 'left', left_at: '2026-05-12T18:30:00.000Z' }),
    ];
    const s = summarizeWaitlist(rows, NOW);
    assert.equal(s.left_today, 1);
  });
});
