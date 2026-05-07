// Cloud-bridge HTTP push client (Item 7).
//
// What this module IS: a pure-network client that POSTs one outbox
// batch to the cloud peer per the wire contract in §5 of
// docs/cloud-bridge-backend-decision.md. No DB access; no queue
// awareness. The drainer (Item 8) is the single caller; lib/cloudBridge.ts
// also delegates to it for the legacy direct-push surface.
//
// What this module is NOT:
//   - Not a retry loop. Retry policy lives in the queue (nack +
//     DEFAULT_MAX_ATTEMPTS) and the drainer (sleep between ticks).
//   - Not an idempotency cache. Server-side dedup on
//     (location_id, batch_id) per §5.5 makes safe-replay the contract.
//
// Auth model is §4.2 HMAC for v1 — Ed25519 (§4.3) lands when Item 13
// ships. The wire-contract header X-Lariat-Signature carries either,
// so this module's signing function is the only thing that flips at
// migration time.

import crypto from 'node:crypto';
import type { OutboxBatch } from './cloudBridgeQueue';

/**
 * Result of a single push attempt — drainer maps to outbox actions:
 *   ok=true            → ack(id)         (drop from queue)
 *   permanent=true     → ack(id)         (drop; never retry — bad data,
 *                                          missing signature, etc.)
 *   permanent=false    → nack(id, reason) (queue retries up to
 *                                          DEFAULT_MAX_ATTEMPTS, then
 *                                          dead-letters)
 *
 * `status` is the HTTP status code when the server replied; absent on
 * pre-response failures (network error, timeout). `reason` is a short
 * human-readable string for logs / dead-letter triage; never contains
 * the secret or the row payload.
 */
export interface PushResult {
  ok: boolean;
  permanent?: boolean;
  status?: number;
  reason?: string;
}

export interface PushOpts {
  /** Cloud peer base URL, e.g. https://api.lariat.example. */
  url: string;
  /** Per-location HMAC secret. */
  secret: string;
  /** Wall-clock budget for the HTTP request (default 10s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Sign body with HMAC-SHA256, mixing in the idempotency key to bind
 * a single signature to a single batch identity. Verifying the same
 * way server-side ensures replay of (body, batch_id) only succeeds
 * when both halves are authentic.
 */
function signRequest(secret: string, body: string, idempotencyKey: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .update(idempotencyKey)
    .digest('hex');
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

/**
 * POST one outbox batch to the cloud peer per §5 of the decision doc.
 * Never throws — every failure category folds into a PushResult so the
 * drainer's branching is exhaustive.
 *
 * Request shape (§5.3):
 *   POST {url}/v1/snapshot
 *   Idempotency-Key: <batch.id>
 *   X-Lariat-Location: <batch.locationId>
 *   X-Lariat-Signature: HMAC-SHA256(secret, body || idempotency-key)
 *   Content-Type: application/json
 *   { table, location_id, batch_id, rows }
 *
 * Response mapping (§5.4):
 *   2xx → { ok: true }
 *   4xx → { ok: false, permanent: true, status, reason }
 *   5xx → { ok: false, permanent: false, status, reason }
 *   network/timeout/abort → { ok: false, permanent: false, reason }
 */
export async function pushBatch(
  batch: OutboxBatch,
  opts: PushOpts,
): Promise<PushResult> {
  const idempotencyKey = String(batch.id);
  const body = JSON.stringify({
    table: batch.table,
    location_id: batch.locationId,
    batch_id: batch.id,
    rows: batch.rows,
  });
  const signature = signRequest(opts.secret, body, idempotencyKey);

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(joinUrl(opts.url, '/v1/snapshot'), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
        'x-lariat-location': batch.locationId,
        'x-lariat-signature': signature,
      },
      body,
    });
  } catch (err: unknown) {
    return {
      ok: false,
      permanent: false,
      reason: err instanceof Error ? err.message : 'fetch failed',
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 200 && res.status < 300) {
    return { ok: true };
  }

  // Drain the body for the reason field; never log it (drainer's caller
  // decides what to surface). Bound the read so a hostile server can't
  // make us OOM on a 4xx.
  let reason = '';
  try {
    const text = await res.text();
    reason = text.slice(0, 500);
  } catch {
    /* swallow — reason stays empty */
  }

  const permanent = res.status >= 400 && res.status < 500;
  return { ok: false, permanent, status: res.status, reason };
}
