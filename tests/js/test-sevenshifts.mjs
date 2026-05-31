#!/usr/bin/env node
// Tests for the 7shifts adapter. Three layers:
//   1. auth — readSevenShiftsCreds() error/normalize behavior (no live API).
//   2. client — paginate7shifts() iterates pages and stops on null cursor.
//      Uses a fake fetchImpl, never hits the network.
//   3. ingest — userToRow / shiftToRow / punchToRow mapping correctness.
//
// Run: node --experimental-strip-types --test tests/js/test-sevenshifts.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { readSevenShiftsCreds, bearerHeader } = await import(
  '../../scripts/sevenshifts_api/auth.mjs'
);
const { paginate7shifts, get7shifts } = await import(
  '../../scripts/sevenshifts_api/client.mjs'
);
const { mappers } = await import('../../scripts/ingest-sevenshifts.mjs');

// ── auth ───────────────────────────────────────────────────────────

describe('readSevenShiftsCreds', () => {
  beforeEach(() => {
    delete process.env.SEVENSHIFTS_API_TOKEN;
    delete process.env.SEVENSHIFTS_COMPANY_ID;
    delete process.env.SEVENSHIFTS_API_HOST;
  });

  it('throws when token + company missing', () => {
    assert.throws(() => readSevenShiftsCreds(), /SEVENSHIFTS_API_TOKEN.*SEVENSHIFTS_COMPANY_ID/s);
  });

  it('throws when only token missing', () => {
    process.env.SEVENSHIFTS_COMPANY_ID = '12345';
    assert.throws(() => readSevenShiftsCreds(), /SEVENSHIFTS_API_TOKEN/);
  });

  it('returns normalized host without scheme/trailing-slash', () => {
    process.env.SEVENSHIFTS_API_TOKEN = 'tok-abc-12345678';
    process.env.SEVENSHIFTS_COMPANY_ID = '12345';
    process.env.SEVENSHIFTS_API_HOST = 'https://api.7shifts.com/';
    const c = readSevenShiftsCreds();
    assert.strictEqual(c.host, 'api.7shifts.com');
    assert.strictEqual(c.token, 'tok-abc-12345678');
    assert.strictEqual(c.companyId, '12345');
    // Mask leaks at most the first/last few characters.
    assert.notStrictEqual(c.maskedToken, c.token);
    assert.match(c.maskedToken, /^tok-/);
  });

  it('bearerHeader builds "Bearer <tok>"', () => {
    assert.strictEqual(bearerHeader('xyz'), 'Bearer xyz');
  });
});

// ── client (paginate7shifts) ────────────────────────────────────────

function fakeCreds() {
  return { host: 'api.7shifts.com', token: 'tok', companyId: '99', maskedToken: 'tok***' };
}

function fakeFetchPages(pages) {
  // pages: array of { data, next }. Returns a fetch impl that responds
  // in order. Each invocation returns a Response-like object with .ok,
  // .status, .json(), .text().
  let i = 0;
  return async (_url) => {
    if (i >= pages.length) {
      throw new Error(`fakeFetchPages: out of pages on call ${i + 1}`);
    }
    const p = pages[i++];
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return { data: p.data, meta: { cursor: { next: p.next } } };
      },
      async text() { return ''; },
    };
  };
}

describe('paginate7shifts', () => {
  it('iterates pages and stops when next cursor is null', async () => {
    const fetchImpl = fakeFetchPages([
      { data: [{ id: 1 }, { id: 2 }], next: 'cur-2' },
      { data: [{ id: 3 }], next: null },
    ]);
    const out = [];
    for await (const r of paginate7shifts('users', { creds: fakeCreds(), fetchImpl })) {
      out.push(r.id);
    }
    assert.deepStrictEqual(out, [1, 2, 3]);
  });

  it('treats meta.next_cursor as a fallback to meta.cursor.next', async () => {
    let i = 0;
    const fetchImpl = async () => {
      i++;
      if (i === 1) {
        return {
          ok: true, status: 200, statusText: 'OK',
          async json() { return { data: [{ id: 'a' }], meta: { next_cursor: 'p2' } }; },
          async text() { return ''; },
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        async json() { return { data: [{ id: 'b' }], meta: {} }; },
        async text() { return ''; },
      };
    };
    const out = [];
    for await (const r of paginate7shifts('shifts', { creds: fakeCreds(), fetchImpl })) {
      out.push(r.id);
    }
    assert.deepStrictEqual(out, ['a', 'b']);
  });

  it('backs off on 429 using Retry-After before retrying the page', async () => {
    let calls = 0;
    const sleeps = [];
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false, status: 429, statusText: 'Too Many Requests',
          headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '2' : null) },
          async json() { return {}; },
          async text() { return 'rate limited'; },
        };
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        async json() { return { data: [{ id: 7 }], meta: {} }; },
        async text() { return ''; },
      };
    };
    const out = [];
    for await (const r of paginate7shifts('users', {
      creds: fakeCreds(),
      fetchImpl,
      sleepImpl: async (ms) => { sleeps.push(ms); },
    })) {
      out.push(r.id);
    }

    assert.deepStrictEqual(out, [7]);
    assert.strictEqual(calls, 2);
    assert.deepStrictEqual(sleeps, [2000]);
  });

  it('throws on non-2xx with body excerpt and masked token', async () => {
    const fetchImpl = async () => ({
      ok: false, status: 401, statusText: 'Unauthorized',
      async json() { return {}; },
      async text() { return 'invalid token'; },
    });
    let err;
    try {
       
      for await (const _ of paginate7shifts('users', { creds: fakeCreds(), fetchImpl })) {
        // no rows expected
      }
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /HTTP 401/);
    assert.match(err.message, /tok\*\*\*/);
    assert.match(err.message, /invalid token/);
    // Importantly: the URL is path-only, no query params logged.
    assert.doesNotMatch(err.message, /\?/);
  });
});

describe('get7shifts (single-page convenience)', () => {
  it('returns parsed JSON on 200', async () => {
    const fetchImpl = async (url) => {
      assert.match(url, /\/v2\/company\/99\/users/);
      return {
        ok: true, status: 200, statusText: 'OK',
        async json() { return { data: [{ id: 1 }], meta: {} }; },
        async text() { return ''; },
      };
    };
    const r = await get7shifts('users', { creds: fakeCreds(), fetchImpl });
    assert.deepStrictEqual(r, { data: [{ id: 1 }], meta: {} });
  });
});

// ── mappers ────────────────────────────────────────────────────────

describe('userToRow', () => {
  it('maps the canonical user shape', () => {
    const r = mappers.userToRow({
      id: 4729,
      first_name: 'Sarah',
      last_name: 'Johnson',
      preferred_name: 'Sarah J.',
      email: 'sarah@lariat.test',
      mobile_number: '+15555550100',
      employee_id: 'E-014',
      role_ids: [1, 7, 12],
      hire_date: '2024-09-15',
      inactive: false,
    }, 'default');
    assert.strictEqual(r.seven_id, '4729');
    assert.strictEqual(r.first_name, 'Sarah');
    assert.strictEqual(r.preferred_name, 'Sarah J.');
    assert.strictEqual(r.email, 'sarah@lariat.test');
    assert.strictEqual(r.phone, '+15555550100');
    assert.strictEqual(r.role_ids_json, '[1,7,12]');
    assert.strictEqual(r.active, 1);
    assert.match(r.raw_json, /"id":4729/);
  });

  it('marks inactive=1 → active=0', () => {
    const r = mappers.userToRow({ id: 1, inactive: true }, 'default');
    assert.strictEqual(r.active, 0);
  });
});

describe('shiftToRow', () => {
  it('coerces numeric ids to strings + extracts start/end', () => {
    const r = mappers.shiftToRow({
      id: 99, user_id: 4729, role_id: 12, department_id: 3,
      start: '2026-04-01T15:00:00Z', end: '2026-04-01T23:00:00Z',
      published: true, deleted: false,
    }, 'default');
    assert.strictEqual(r.seven_id, '99');
    assert.strictEqual(r.user_seven_id, '4729');
    assert.strictEqual(r.role_id, '12');
    assert.strictEqual(r.start_at, '2026-04-01T15:00:00Z');
    assert.strictEqual(r.published, 1);
    assert.strictEqual(r.deleted, 0);
  });
});

describe('punchToRow', () => {
  it('computes hours_worked from clocked_in/out when both present', () => {
    const r = mappers.punchToRow({
      id: 'p1', user_id: 4729, role_id: 12,
      clocked_in: '2026-04-01T15:00:00Z',
      clocked_out: '2026-04-01T23:30:00Z',
      approved: true,
    }, 'default');
    assert.ok(Math.abs(r.hours_worked - 8.5) < 1e-9, `hours_worked=${r.hours_worked}`);
    assert.strictEqual(r.approved, 1);
  });

  it('falls back to p.hours when clocked_out is missing', () => {
    const r = mappers.punchToRow({
      id: 'p2', user_id: 1, clocked_in: '2026-04-01T15:00:00Z', hours: 4.25,
    }, 'default');
    assert.strictEqual(r.hours_worked, 4.25);
    assert.strictEqual(r.clocked_out_at, null);
  });

  it('returns null hours when neither path supplies them', () => {
    const r = mappers.punchToRow({ id: 'p3', user_id: 1 }, 'default');
    assert.strictEqual(r.hours_worked, null);
  });
});
