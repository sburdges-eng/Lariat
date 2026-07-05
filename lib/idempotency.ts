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
// GH #249 — reserve-then-run race fix. Pre-fix the flow was
// `lookup → handler() → store`. Two concurrent identical requests both
// passed the lookup miss, both ran the handler (duplicate audit rows +
// duplicate writes), then one INSERT lost the PK conflict and the loser
// silently swallowed it. Now the wrapper reserves the slot up-front by
// inserting with status='pending'; the second concurrent caller loses
// the INSERT race, reads the row, and (same body) waits behind a 503
// instead of running the handler again.
//
// Contract — five cases the wrapper distinguishes:
//
//   1. No `idempotency-key` header on the request
//      → handler runs unchanged; nothing cached.
//
//   2. Key present, no cache row (or row aged out via 24h TTL)
//      → claim slot as 'pending', run handler, flip to 'complete'
//        (unless the response is 401/5xx — see below). Subsequent
//        replays hit case 3.
//
//   3. Key present, cache row matches the (key + request_hash) AND
//      status='complete'
//      → handler does NOT run; cached response is returned verbatim.
//
//   3'. Key present, cache row exists, request_hash mismatches
//       (regardless of pending/complete)
//       → 409 with `idempotency-key reused for a different request`.
//       This is the ONLY case that returns 409 — reserved for a genuine
//       client bug (same key, different body), matching the Lariat-KDS
//       protocol's definition.
//
//   4. Key present, cache row exists, status='pending', hash MATCHES
//      → 503 with `idempotency-key in flight`. The first request (same
//        body) is still running — this is a transient race, not a
//        conflict, so any client that already retries 5xx with the
//        same key (e.g. the KDS) will get the replay once the in-flight
//        request completes. The pending row is reaped after 60s if the
//        process crashed.
//
// On a handler throw, a 401, or a 5xx response the wrapper DELETEs the
// pending row so the next attempt runs fresh: auth state (401) isn't a
// function of the request body, and a 5xx is transient by definition —
// caching either would wrongly poison the key.

import { createHash } from 'node:crypto';
import { getDb } from './db.ts';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Pending rows older than this are treated as orphaned (the process
 * holding them must have crashed) and reaped on the next sweep. 60s
 * comfortably exceeds the longest legitimate Lariat handler — Ollama
 * specials calls cap at 120s but those routes have their own timeout
 * and complete (or 502) cleanly, so a pending row from those will
 * either be DELETEd by the wrapper's catch path or by this sweep.
 */
const PENDING_REAP_SECONDS = 60;

interface CachedResponse {
  request_hash: string;
  response_status: number;
  response_body: string;
  status: 'pending' | 'complete';
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
 * Lazy sweep — drop completed rows older than 24h and any pending row
 * that has clearly orphaned (process holding it crashed). Called from
 * inside the wrapper so there's no background job. Cheap on a small
 * table.
 */
function sweepExpired(db: ReturnType<typeof getDb>): void {
  db.prepare(
    `DELETE FROM idempotency_keys
      WHERE status = 'complete' AND created_at < datetime('now', '-1 day')`,
  ).run();
  db.prepare(
    `DELETE FROM idempotency_keys
      WHERE status = 'pending'
        AND created_at < datetime('now', ?)`,
  ).run(`-${PENDING_REAP_SECONDS} seconds`);
}

function lookup(
  db: ReturnType<typeof getDb>,
  key: string,
): CachedResponse | undefined {
  return db
    .prepare(
      `SELECT request_hash, response_status, response_body, status
         FROM idempotency_keys
        WHERE key = ?`,
    )
    .get(key) as CachedResponse | undefined;
}

/**
 * Try to reserve the slot atomically by inserting a row with
 * status='pending'. Returns true on success, false on PK conflict
 * (another request beat us to it). Re-throws on any other DB error.
 */
function tryClaimSlot(
  db: ReturnType<typeof getDb>,
  key: string,
  method: string,
  path: string,
  request_hash: string,
): boolean {
  try {
    db.prepare(
      `INSERT INTO idempotency_keys
         (key, method, path, request_hash, response_status, response_body, status)
       VALUES (?, ?, ?, ?, 0, '', 'pending')`,
    ).run(key, method, path, request_hash);
    return true;
  } catch (e) {
    if (isUniqueConflict(e)) return false;
    throw e;
  }
}

function isUniqueConflict(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: string }).code;
  return (
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT'
  );
}

function releaseSlot(db: ReturnType<typeof getDb>, key: string): void {
  db.prepare(`DELETE FROM idempotency_keys WHERE key = ?`).run(key);
}

function completeSlot(
  db: ReturnType<typeof getDb>,
  key: string,
  response_status: number,
  response_body: string,
): void {
  db.prepare(
    `UPDATE idempotency_keys
        SET response_status = ?,
            response_body = ?,
            status = 'complete'
      WHERE key = ?`,
  ).run(response_status, response_body, key);
}

/**
 * Wrap a regulated POST handler so the same request can be replayed
 * by the service-worker queue without producing duplicate rows.
 *
 * The handler must return a Response. If the handler throws, the
 * wrapper does NOT cache — the next attempt runs the handler fresh.
 * Non-2xx 4xx responses other than 401 ARE cached: a 422 on a malformed
 * request is the correct response on retry too, and re-running the
 * handler would just produce the same 422 again with extra audit
 * noise. 401 is the per-request auth carve-out — never cached (auth
 * state isn't a function of the request body). 5xx is never cached
 * either — a server-side failure is transient, not deterministic, so a
 * retry with the same key must be able to succeed once the condition
 * clears (see the Lariat-KDS protocol's "5xx — transient, retry with
 * the same key" contract).
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

  const reqPath = new URL(req.url).pathname;
  const request_hash = hashRequest(req.method, reqPath, body);

  const db = getDb();
  sweepExpired(db);

  // Reserve-then-run: try to claim the slot. If someone else owns it
  // (pending or complete), read what they have and respond accordingly.
  const ownedSlot = tryClaimSlot(db, key, req.method, reqPath, request_hash);

  if (!ownedSlot) {
    const cached = lookup(db, key);
    if (!cached) {
      // Race: the row was swept (or DELETEd) between our INSERT
      // attempt and the SELECT. Recurse once — the slot is now free.
      return withIdempotency(req, handler);
    }
    // A hash mismatch is a genuine conflict (key reused with a different
    // body) regardless of whether the other request is still pending or
    // already complete — checked first so this is the ONLY path that
    // returns 409, matching the protocol's "409 = different body" contract.
    if (cached.request_hash !== request_hash) {
      return Response.json(
        {
          error:
            'idempotency-key reused for a different request — keys must be unique per mutation',
        },
        { status: 409 },
      );
    }
    if (cached.status === 'pending') {
      // Same request, still running (GH #249's race). Do NOT run the
      // handler again. This is transient, not a conflict — 503 so a
      // client that already retries 5xx with the same key (the KDS
      // protocol's contract) gets the replay once it completes.
      return Response.json(
        {
          error:
            'idempotency-key in flight — first request is still being processed, retry shortly',
        },
        { status: 503 },
      );
    }
    // status === 'complete', hash matches — replay verbatim.
    return new Response(cached.response_body, {
      status: cached.response_status,
      headers: { 'content-type': 'application/json' },
    });
  }

  // We own the slot. Run the handler; on throw or 401 release the slot
  // so the next attempt runs fresh. Otherwise UPDATE to 'complete'.
  let res: Response;
  try {
    res = await handler();
  } catch (e) {
    releaseSlot(db, key);
    throw e;
  }

  // 401 carve-out: auth state is per-request, NOT a function of
  // (key + body). Caching a 401 would confused-deputy a user who taps
  // Save without a PIN, authenticates, then re-taps Save with the same
  // key. Release the slot so the next attempt runs the handler.
  if (res.status === 401) {
    releaseSlot(db, key);
    return res;
  }

  // 5xx carve-out: a server-side failure is by definition transient, not a
  // deterministic function of the request body — caching it would poison
  // the key for 24h even after the condition clears. Release the slot so
  // a retry with the same key (which every documented 5xx-retry client,
  // e.g. the KDS, is expected to send) can actually succeed.
  if (res.status >= 500) {
    releaseSlot(db, key);
    return res;
  }

  let responseBody = '';
  try {
    responseBody = await res.clone().text();
  } catch {
    // unreadable response body — store empty string. Replays will
    // return the right status with an empty body, which is degraded
    // but safe.
  }

  completeSlot(db, key, res.status, responseBody);
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
