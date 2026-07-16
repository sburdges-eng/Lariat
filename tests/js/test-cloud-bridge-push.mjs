#!/usr/bin/env node
// Tests for the cloud-bridge HTTP push client (Item 7).
//
// Spec context:
//   - docs/cloud-bridge-backend-decision.md §5 (wire contract: POST
//     /v1/snapshot, headers, body shape, response→drainer-action map).
//   - docs/cloud-bridge-backend-decision.md §4.2 (HMAC: sign body with
//     Idempotency-Key concatenated, header = X-Lariat-Signature).
//
// Eight contracts:
//   1. 202 → { ok: true } (happy path).
//   2. 4xx → { ok: false, permanent: true, reason } — drainer should ack
//      to drop, NOT retry. Permanent rejects burn nothing.
//   3. 5xx → { ok: false, permanent: false, reason } — drainer should
//      nack and let the queue retry up to DEFAULT_MAX_ATTEMPTS.
//   4. Network error (ECONNREFUSED) → { ok: false, permanent: false }.
//   5. Timeout → { ok: false, permanent: false }.
//   6. HMAC signature present and verifiable (server-side recompute
//      matches X-Lariat-Signature).
//   7. Body matches §5.3: table, location_id, batch_id, rows.
//   8. Idempotency-Key + X-Lariat-Location headers match batch fields.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-cloud-bridge-push.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import crypto from 'node:crypto';

register(new URL('./resolver.mjs', import.meta.url));

const push = await import('../../lib/cloudBridgePush.ts');
const { pushBatch } = push;

const SECRET = 'test-secret-please-ignore';

/** A batch shape compatible with lib/cloudBridgeQueue.ts::OutboxBatch. */
function makeBatch(overrides = {}) {
  return {
    id: 4271,
    table: 'beo_events',
    locationId: 'default',
    rows: [{ totals_cents: 12345, settled_at: '2026-05-06T23:59:00Z' }],
    attempts: 1,
    enqueuedAt: '2026-05-06T23:58:00Z',
    ...overrides,
  };
}

async function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init = {}) => {
    const req = {
      url: String(url),
      method: init.method,
      headers: init.headers ?? {},
      body: typeof init.body === 'string' ? init.body : '',
      signal: init.signal,
    };
    requests.push(req);
    return handler(req);
  };

  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('pushBatch — happy path (202)', () => {
  it('returns { ok: true } and posts to /v2/snapshot', async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ batch_id: 4271 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
      async (requests) => {
        const result = await pushBatch(makeBatch(), {
          url: 'https://bridge.example',
          secret: SECRET,
        });
        assert.deepStrictEqual(result, { ok: true });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'POST');
        assert.equal(requests[0].url, 'https://bridge.example/v2/snapshot');
      },
    );
  });
});

describe('pushBatch — 4xx is permanent reject', () => {
  it('returns { ok: false, permanent: true, status: 422 } so the drainer ack-drops', async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ error: 'table not on allow-list', table: 'sales_lines' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
      async () => {
        const result = await pushBatch(makeBatch(), {
          url: 'https://bridge.example',
          secret: SECRET,
        });
        assert.equal(result.ok, false);
        assert.equal(result.permanent, true);
        assert.equal(result.status, 422);
        assert.match(result.reason ?? '', /allow-list/);
      },
    );
  });
});

describe('pushBatch — 5xx is transient', () => {
  it('returns { ok: false, permanent: false, status: 503 } so the drainer nack-retries', async () => {
    await withMockFetch(
      () => new Response('upstream is napping', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      }),
      async () => {
        const result = await pushBatch(makeBatch(), {
          url: 'https://bridge.example',
          secret: SECRET,
        });
        assert.equal(result.ok, false);
        assert.equal(result.permanent, false);
        assert.equal(result.status, 503);
      },
    );
  });
});

describe('pushBatch — network error is transient', () => {
  it('returns { ok: false, permanent: false } when the URL is unreachable', async () => {
    await withMockFetch(
      () => {
        throw new Error('connect ECONNREFUSED');
      },
      async () => {
        const result = await pushBatch(
          makeBatch(),
          { url: 'https://bridge.example', secret: SECRET, timeoutMs: 1500 },
        );
        assert.equal(result.ok, false);
        assert.equal(result.permanent, false);
        assert.ok(result.reason);
      },
    );
  });
});

describe('pushBatch — timeout is transient', () => {
  it('returns { ok: false, permanent: false } and aborts within timeoutMs', async () => {
    await withMockFetch(
      ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      }),
      async () => {
        const t0 = Date.now();
        const result = await pushBatch(
          makeBatch(),
          { url: 'https://bridge.example', secret: SECRET, timeoutMs: 250 },
        );
        const elapsed = Date.now() - t0;
        assert.equal(result.ok, false);
        assert.equal(result.permanent, false);
        // Generous upper bound — abort scheduling + GC overhead can land
        // ~300ms on a loaded test runner; tighter would be flaky.
        assert.ok(elapsed < 2000, `timeout took ${elapsed}ms, expected < 2000`);
      },
    );
  });
});

describe('pushBatch — wire contract (§5)', () => {
  it('sets Idempotency-Key, X-Lariat-Location, and a present X-Lariat-Signature', async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ batch_id: 4271 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
      async (requests) => {
        await pushBatch(makeBatch(), { url: 'https://bridge.example', secret: SECRET });
        const req = requests.at(-1);
        assert.equal(req.headers['idempotency-key'], '4271');
        assert.equal(req.headers['x-lariat-location'], 'default');
        assert.equal(req.headers['content-type'], 'application/json');
        assert.ok(req.headers['x-lariat-signature'], 'signature header missing');
        assert.match(req.headers['x-lariat-signature'], /^[0-9a-f]{64}$/, 'signature should be 64-hex SHA-256');
      },
    );
  });

  it('signs HMAC-SHA256(secret, body || idempotency-key) — server-side recompute matches', async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ batch_id: 999 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
      async (requests) => {
        await pushBatch(makeBatch({ id: 999, locationId: 'kitchen-1' }), {
          url: 'https://bridge.example',
          secret: SECRET,
        });
        const req = requests.at(-1);
        const sig = req.headers['x-lariat-signature'];
        const expected = crypto
          .createHmac('sha256', SECRET)
          .update(req.body)
          .update(String(req.headers['idempotency-key']))
          .digest('hex');
        assert.equal(sig, expected);
      },
    );
  });

  it('body shape matches §5.3 — { table, location_id, batch_id, rows }', async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ batch_id: 4271 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
      async (requests) => {
        await pushBatch(makeBatch(), { url: 'https://bridge.example', secret: SECRET });
        const req = requests.at(-1);
        const parsed = JSON.parse(req.body);
        assert.equal(parsed.table, 'beo_events');
        assert.equal(parsed.location_id, 'default');
        assert.equal(parsed.batch_id, 4271);
        assert.ok(Array.isArray(parsed.rows));
        assert.equal(parsed.rows.length, 1);
        assert.equal(parsed.rows[0].totals_cents, 12345);
        assert.equal(parsed.schema_version, 1);
      },
    );
  });
});
