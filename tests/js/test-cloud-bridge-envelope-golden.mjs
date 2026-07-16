#!/usr/bin/env node
// Freezes the web cloud-bridge producer to the golden envelope fixtures.
//
// For each tests/fixtures/cloud-bridge/golden-envelope.<table>.json, this
// re-runs lib/cloudBridgePush.ts::pushBatch with the fixture's recorded input
// and asserts the emitted HTTP request is BYTE-IDENTICAL to the frozen
// `expected`: the path, method, all four headers, and — crucially — the JSON
// body string and the HMAC signature over it. A change to the wire bytes (key
// order, header names/case, number formatting, HMAC construction) fails here.
// That is intentional: the envelope is a signed contract, so regenerate the
// fixtures only on a deliberate change (scripts/gen-cloud-bridge-golden-
// envelopes.mjs) and review the diff as a contract review.
//
// This is the web half of C.3 in
// docs/superpowers/specs/2026-07-16-cloud-bridge-envelope-contract-and-parity-harness.md;
// a future Swift encoder test asserts the SAME fixtures for cross-stack parity.
//
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-envelope-golden.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const { pushBatch } = await import('../../lib/cloudBridgePush.ts');

const FIX_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'cloud-bridge',
);
const files = fs
  .readdirSync(FIX_DIR)
  .filter((f) => /^golden-envelope\..+\.json$/.test(f))
  .sort();

/** Capture the exact request pushBatch would send, without a real fetch. */
async function capture(batch, secret) {
  const originalFetch = globalThis.fetch;
  let req = null;
  globalThis.fetch = async (url, init = {}) => {
    req = {
      url: String(url),
      method: init.method,
      headers: init.headers ?? {},
      body: typeof init.body === 'string' ? init.body : '',
    };
    return new Response(JSON.stringify({ batch_id: batch.id }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await pushBatch(batch, { url: 'https://bridge.example', secret });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return req;
}

describe('cloud-bridge golden envelope — web producer frozen to fixtures', () => {
  it('finds at least one golden fixture', () => {
    assert.ok(files.length >= 1, 'no golden-envelope.*.json fixtures found');
  });

  for (const f of files) {
    const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), 'utf8'));
    const table = f.replace(/^golden-envelope\.(.+)\.json$/, '$1');

    it(`${f}: pushBatch emits a byte-identical envelope`, async () => {
      const batch = {
        id: fx.input.batch_id,
        table,
        locationId: fx.input.location_id,
        rows: fx.input.rows,
        attempts: 0,
        enqueuedAt: '2026-05-06T23:58:00Z',
      };
      const req = await capture(batch, fx.test_secret);
      const e = fx.expected;

      assert.equal(req.method, e.method, 'method');
      assert.equal(req.url, e.url, 'url');
      assert.ok(req.url.endsWith(e.path), `url should end with ${e.path}`);
      // The signed bytes — must be byte-identical.
      assert.equal(req.body, e.body, 'body must be byte-identical to the frozen envelope');
      // All four headers, byte-exact, including the HMAC hex.
      for (const k of ['content-type', 'idempotency-key', 'x-lariat-location', 'x-lariat-signature']) {
        assert.equal(req.headers[k], e.headers[k], `header ${k}`);
      }
    });
  }
});
