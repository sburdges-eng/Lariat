#!/usr/bin/env node
// Generates the golden cloud-bridge /v1/snapshot envelope fixtures — the EXACT
// bytes lib/cloudBridgePush.ts::pushBatch emits for each pushable table. The
// freeze test (tests/js/test-cloud-bridge-envelope-golden.mjs) asserts the
// producer still matches these committed files; the coverage gate
// (tests/js/test-cloud-bridge-envelope-coverage.mjs) requires one per
// ALLOWED_TABLE. This is a FROZEN artifact: only regenerate on an intentional
// wire-contract change, and treat the resulting diff as a contract review.
//
// Run: node --experimental-strip-types scripts/gen-cloud-bridge-golden-envelopes.mjs
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { pushBatch } = await import('../lib/cloudBridgePush.ts');
const { ALLOWED_TABLES } = await import('../lib/cloudBridgeQueue.ts');

// A fixed test secret (never a real one) so the HMAC is deterministic. The
// freeze test uses the value stored in each fixture, so it stays in lockstep.
const TEST_SECRET = 'test-secret-please-ignore';
const URL_BASE = 'https://bridge.example';

// Deterministic, table-appropriate inputs. rows are opaque to the envelope, but
// distinct per table keeps the fixtures meaningful. Adding a table to
// ALLOWED_TABLES without an entry here is a hard error (below) — that is the
// point: a new pushable table must get a golden envelope.
const INPUTS = {
  beo_events: {
    batch_id: 4271,
    location_id: 'default',
    rows: [{ event_id: 42, totals_cents: 1250000, settled_at: '2026-05-06T23:59:00Z' }],
  },
  spend_monthly: {
    batch_id: 5120,
    location_id: 'default',
    rows: [{ month: '2026-05', spend_cents: 480000 }],
  },
};

/** Capture the exact HTTP request pushBatch would send, without a real fetch. */
async function captureEnvelope(batch, secret) {
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init = {}) => {
    captured = {
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
    await pushBatch(batch, { url: URL_BASE, secret });
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (!captured) throw new Error(`pushBatch did not send a request for '${batch.table}'`);
  return captured;
}

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'cloud-bridge',
);
fs.mkdirSync(outDir, { recursive: true });

let failed = false;
for (const table of ALLOWED_TABLES) {
  const inp = INPUTS[table];
  if (!inp) {
    console.error(`FAIL: pushable table '${table}' has no fixed input in INPUTS — add one.`);
    failed = true;
    continue;
  }
  const batch = {
    id: inp.batch_id,
    table,
    locationId: inp.location_id,
    rows: inp.rows,
    attempts: 0,
    enqueuedAt: '2026-05-06T23:58:00Z',
  };
  const req = await captureEnvelope(batch, TEST_SECRET);
  const fixture = {
    schema_version: 1,
    table,
    source_test: 'tests/js/test-cloud-bridge-envelope-golden.mjs',
    note:
      'Golden cloud-bridge /v2/snapshot envelope (§5) — the exact bytes '
      + 'lib/cloudBridgePush.ts::pushBatch emits for this table. FROZEN: the '
      + 'source_test asserts the producer still matches. Regenerate only on an '
      + 'intentional wire-contract change via '
      + 'scripts/gen-cloud-bridge-golden-envelopes.mjs and review the diff.',
    test_secret: TEST_SECRET,
    input: { batch_id: inp.batch_id, location_id: inp.location_id, rows: inp.rows },
    expected: {
      method: req.method,
      path: '/v2/snapshot',
      url: req.url,
      headers: {
        'content-type': req.headers['content-type'],
        'idempotency-key': req.headers['idempotency-key'],
        'x-lariat-location': req.headers['x-lariat-location'],
        'x-lariat-signature': req.headers['x-lariat-signature'],
      },
      body: req.body,
    },
  };
  const file = path.join(outDir, `golden-envelope.${table}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

if (failed) process.exitCode = 1;
