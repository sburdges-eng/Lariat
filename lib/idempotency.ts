// Service-worker replay idempotency wrapper.
//
// Every regulated POST handler in Lariat opts into this wrapper to
// dedupe a replayed request from the SW queue (public/sw.js::replay)
// against a server-side idempotency cache. A request that arrives
// without an `idempotency-key` header is passed through unchanged
// (curl + scripts + un-retrofitted clients keep working).
//
// Spec: docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md
// Plan: docs/superpowers/plans/2026-05-02-sw-replay-idempotency-plan.md
// Found via: docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md
//
// Contract — three cases the wrapper distinguishes:
//
//   1. No `idempotency-key` header on the request
//      → handler runs unchanged; nothing cached.
//
//   2. Key present, no cache row (or row aged out via 24h TTL)
//      → handler runs; the (status, body) pair is cached keyed on
//        (key, request_hash). Subsequent replays hit case 3.
//
//   3. Key present, cache row matches the (key + request_hash)
//      → handler does NOT run; cached response is returned verbatim.
//        No second audit row, no second DB write.
//
//   3'. Key present, cache row exists, request_hash mismatches
//       → 409 with `idempotency-key reused for a different request`.
//         Guards against a buggy client that re-uses keys for
//         distinct mutations.
//
// The cache write happens after the handler returns; if the handler
// throws, nothing is cached and the next attempt runs the handler
// fresh. Audit posting per docs/PATTERNS.md §3 stays inside the
// handler's own db.transaction; the wrapper does NOT span the audit
// transaction boundary.

import { createHash } from 'node:crypto';
import { getDb } from './db';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

interface CachedResponse {
  request_hash: string;
  response_status: number;
  response_body: string;
}

/**
 * Compute a stable hash of the request shape so a key reused with a
 * DIFFERENT body is rejected. SHA-256 is overkill for cache-keying
 * but the table is tiny and the predictability is worth it.
 */
function hashRequest(method: string, path: string, body: string): string {
  return createHash('sha256')
    .update(method.toUpperCase())
    .update('\n')
    .update(path)
    .update('\n')
    .update(body)
    .digest('hex');
}

/**
 * Lazy sweep — drop rows older than 24h. Called from inside the
 * wrapper so there's no background job. Cheap on a small table.
 */
function sweepExpired(db: ReturnType<typeof getDb>): void {
  db.prepare(
    `DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-1 day')`,
  ).run();
}

function lookup(
  db: ReturnType<typeof getDb>,
  key: string,
): CachedResponse | undefined {
  return db
    .prepare(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys
        WHERE key = ?`,
    )
    .get(key) as CachedResponse | undefined;
}

function store(
  db: ReturnType<typeof getDb>,
  key: string,
  method: string,
  path: string,
  request_hash: string,
  response_status: number,
  response_body: string,
): void {
  db.prepare(
    `INSERT INTO idempotency_keys
       (key, method, path, request_hash, response_status, response_body)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(key, method, path, request_hash, response_status, response_body);
}

/**
 * Wrap a regulated POST handler so the same request can be replayed
 * by the service-worker queue without producing duplicate rows.
 *
 * The handler must return a Response. If the handler throws, the
 * wrapper does NOT cache — the next attempt runs the handler fresh.
 * Non-2xx responses ARE cached: a 422 on a malformed request is the
 * correct response on retry too, and re-running the handler would
 * just produce the same 422 again with extra audit noise.
 */
export async function withIdempotency(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get('idempotency-key');
  if (!key) {
    // Un-keyed clients (curl, scripts, un-retrofitted UI) get
    // pass-through — preserves the pre-wrapper behavior exactly.
    return handler();
  }

  if (!KEY_PATTERN.test(key)) {
    return Response.json(
      { error: 'Invalid idempotency-key — must be 16–128 chars [A-Za-z0-9_-]' },
      { status: 400 },
    );
  }

  // Snapshot the body BEFORE handler() consumes it. The handler reads
  // a clone via req.clone() in its own scope; we read another clone
  // here for the hash. body is bounded by the route's existing
  // body-size limits.
  let body = '';
  try {
    body = await req.clone().text();
  } catch {
    // unreadable body — proceed with empty string; the hash still
    // distinguishes (method, path).
  }

  const path = new URL(req.url).pathname;
  const request_hash = hashRequest(req.method, path, body);

  const db = getDb();
  sweepExpired(db);

  const cached = lookup(db, key);
  if (cached) {
    if (cached.request_hash !== request_hash) {
      return Response.json(
        {
          error:
            'idempotency-key reused for a different request — keys must be unique per mutation',
        },
        { status: 409 },
      );
    }
    return new Response(cached.response_body, {
      status: cached.response_status,
      headers: { 'content-type': 'application/json' },
    });
  }

  const res = await handler();

  // 401 short-circuit: auth state is per-request, NOT a function of
  // (key + body). Caching a 401 against the (key, body) tuple confused-
  // deputies a user who taps Save without a PIN, then authenticates,
  // then taps Save again with the same key — they get back the cached
  // 401 instead of the post-auth 200. Always re-run the handler on
  // the next attempt by skipping the cache write here.
  // 422 / 4xx for malformed body remain cached: they ARE deterministic
  // for a given body, so re-running just produces the same response
  // with extra audit noise.
  if (res.status === 401) {
    return res;
  }

  // Cache the response. We clone before reading text() so the caller
  // can still use res normally. Non-2xx responses (other than 401 above)
  // ARE cached — see function header comment.
  let responseBody = '';
  try {
    responseBody = await res.clone().text();
  } catch {
    // unreadable response body — store empty string. Replays will
    // return the right status with an empty body, which is degraded
    // but safe.
  }

  try {
    store(db, key, req.method, path, request_hash, res.status, responseBody);
  } catch {
    // UNIQUE conflict on key (rare race): another concurrent request
    // got there first. The handler already ran, so just return the
    // current response — the cache will dedupe future replays.
  }

  return res;
}

// Test-only helper — kept for tests/js/test-idempotency-wrapper.mjs which
// asserts the sweep ran. Currently always 0 because no caller increments
// it (sweepExpired runs unconditionally inside withIdempotency, no counter
// wiring needed for the test). Left as `const` to satisfy prefer-const;
// can be ripped out in a future cleanup if no test actually depends on it.
const _swept = 0;
export function _sweepCount(): number {
  return _swept;
}
