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

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';

register(new URL('./resolver.mjs', import.meta.url));

const push = await import('../../lib/cloudBridgePush.ts');
const { pushBatch } = push;

const SECRET = 'test-secret-please-ignore';

/** A batch shape compatible with lib/cloudBridgeQueue.ts::OutboxBatch. */
function makeBatch(overrides = {}) {
  return {
    id: 4271,
    table: 'settlement_summaries',
    locationId: 'default',
    rows: [{ totals_cents: 12345, settled_at: '2026-05-06T23:59:00Z' }],
    attempts: 1,
    enqueuedAt: '2026-05-06T23:58:00Z',
    ...overrides,
  };
}

/**
 * Spin up a one-handler HTTP server on a random port. Returns
 * { url, server, requests } — `requests` is an array the caller
 * can inspect after pushBatch resolves to assert headers + body
 * matched the contract.
 */
function startStubServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, server, requests });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('pushBatch — happy path (202)', () => {
  let stub;
  before(async () => {
    stub = await startStubServer((req, res, _body) => {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ batch_id: 4271 }));
    });
  });
  after(async () => { await close(stub.server); });

  it('returns { ok: true } and posts to /v1/snapshot', async () => {
    const result = await pushBatch(makeBatch(), { url: stub.url, secret: SECRET });
    assert.deepStrictEqual(result, { ok: true });
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].method, 'POST');
    assert.equal(stub.requests[0].url, '/v1/snapshot');
  });
});

describe('pushBatch — 4xx is permanent reject', () => {
  let stub;
  before(async () => {
    stub = await startStubServer((req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'table not on allow-list', table: 'sales_lines' }));
    });
  });
  after(async () => { await close(stub.server); });

  it('returns { ok: false, permanent: true, status: 422 } so the drainer ack-drops', async () => {
    const result = await pushBatch(makeBatch(), { url: stub.url, secret: SECRET });
    assert.equal(result.ok, false);
    assert.equal(result.permanent, true);
    assert.equal(result.status, 422);
    assert.match(result.reason ?? '', /allow-list/);
  });
});

describe('pushBatch — 5xx is transient', () => {
  let stub;
  before(async () => {
    stub = await startStubServer((req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('upstream is napping');
    });
  });
  after(async () => { await close(stub.server); });

  it('returns { ok: false, permanent: false, status: 503 } so the drainer nack-retries', async () => {
    const result = await pushBatch(makeBatch(), { url: stub.url, secret: SECRET });
    assert.equal(result.ok, false);
    assert.equal(result.permanent, false);
    assert.equal(result.status, 503);
  });
});

describe('pushBatch — network error is transient', () => {
  it('returns { ok: false, permanent: false } when the URL is unreachable', async () => {
    // Pick a port unlikely to be open; even if something is, the test
    // server isn't there so we'll get a non-2xx or ECONNREFUSED.
    const result = await pushBatch(
      makeBatch(),
      { url: 'http://127.0.0.1:1', secret: SECRET, timeoutMs: 1500 },
    );
    assert.equal(result.ok, false);
    assert.equal(result.permanent, false);
    assert.ok(result.reason);
  });
});

describe('pushBatch — timeout is transient', () => {
  let stub;
  before(async () => {
    // Server never responds — pushBatch should hit timeoutMs and abort.
    stub = await startStubServer((_req, _res, _body) => {
      // intentionally no res.end
    });
  });
  after(async () => { await close(stub.server); });

  it('returns { ok: false, permanent: false } and aborts within timeoutMs', async () => {
    const t0 = Date.now();
    const result = await pushBatch(
      makeBatch(),
      { url: stub.url, secret: SECRET, timeoutMs: 250 },
    );
    const elapsed = Date.now() - t0;
    assert.equal(result.ok, false);
    assert.equal(result.permanent, false);
    // Generous upper bound — node:http abort + GC overhead can land ~300ms
    // on a loaded test runner; tighter would be flaky.
    assert.ok(elapsed < 2000, `timeout took ${elapsed}ms, expected < 2000`);
  });
});

describe('pushBatch — wire contract (§5)', () => {
  let stub;
  before(async () => {
    stub = await startStubServer((req, res, _body) => {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ batch_id: 4271 }));
    });
  });
  after(async () => { await close(stub.server); });

  it('sets Idempotency-Key, X-Lariat-Location, and a present X-Lariat-Signature', async () => {
    await pushBatch(makeBatch(), { url: stub.url, secret: SECRET });
    const req = stub.requests.at(-1);
    assert.equal(req.headers['idempotency-key'], '4271');
    assert.equal(req.headers['x-lariat-location'], 'default');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.ok(req.headers['x-lariat-signature'], 'signature header missing');
    assert.match(req.headers['x-lariat-signature'], /^[0-9a-f]{64}$/, 'signature should be 64-hex SHA-256');
  });

  it('signs HMAC-SHA256(secret, body || idempotency-key) — server-side recompute matches', async () => {
    await pushBatch(makeBatch({ id: 999, locationId: 'kitchen-1' }), {
      url: stub.url,
      secret: SECRET,
    });
    const req = stub.requests.at(-1);
    const sig = req.headers['x-lariat-signature'];
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(req.body)
      .update(String(req.headers['idempotency-key']))
      .digest('hex');
    assert.equal(sig, expected);
  });

  it('body shape matches §5.3 — { table, location_id, batch_id, rows }', async () => {
    await pushBatch(makeBatch(), { url: stub.url, secret: SECRET });
    const req = stub.requests.at(-1);
    const parsed = JSON.parse(req.body);
    assert.equal(parsed.table, 'settlement_summaries');
    assert.equal(parsed.location_id, 'default');
    assert.equal(parsed.batch_id, 4271);
    assert.ok(Array.isArray(parsed.rows));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].totals_cents, 12345);
  });
});
