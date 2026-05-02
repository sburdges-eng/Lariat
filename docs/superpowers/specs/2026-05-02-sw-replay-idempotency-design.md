# Service-worker replay idempotency — design

**Source:** Section 8 breaker audit P1 — `docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md`. Closes the load-bearing invariant from `BREAKER_AUDIT.md §2 Section 8`: "on-reconnect sync never duplicates rows."

## Goal

Every regulated POST handler in Lariat dedupes a replayed request from the service-worker queue against a server-side idempotency cache, so a network drop between server commit and client ack cannot produce duplicate `temp_log` / `box_office_lines` / `inventory_updates` / `station_signoffs` rows. The slice ships when:

1. The full offline round-trip e2e (`tests/e2e/offline-queue.spec.ts:83`) is un-skipped and asserts: queue → throttle online → replay → exactly one row written, even when the original POST is artificially "lost-after-commit".
2. The four highest-blast-radius regulated routes (signoff, box-office line write, temp-log, receiving) opt into the wrapper.
3. A unit test pins the wrapper's three cases: no key → unwrapped pass-through; new key → handler runs, response cached; seen key → cached response returned, handler does NOT run.

## Out of scope (named, so we don't drift)

- **Idempotency on GET routes.** GETs are already cache-served by the SW; no mutation to dedupe.
- **Replay-order guarantees beyond FIFO.** The IDB autoIncrement ordering already gives FIFO; we don't add transaction-style invariants ("if A fails, don't replay B").
- **Cross-device dedupe.** A second iPad re-issuing the same payload doesn't share an idempotency key with the first. That's a multi-device problem deferred to Phase 3 labor (per-cook session).
- **Long-lived keys.** 24-hour TTL on the `idempotency_keys` table is the bound. Anything older than 24h is treated as a fresh request. Acceptable per the kitchen ops cadence (shifts are <24h).
- **Retrofitting `lib/auditLog.mjs` (file audit).** Out of scope; only `lib/auditEvents.ts` (DB audit) routes need the wrapper.
- **Bulk-import idempotency** (the DICE-import shape closed by #113). That's a separate dedupe path keyed on `external_ref`; the wrapper here handles per-request dedupe at the POST boundary.

## Schema — one new table

```sql
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,                -- UUIDv7 string from the client
  method          TEXT NOT NULL,                    -- 'POST' | 'DELETE' | etc.
  path            TEXT NOT NULL,                    -- e.g. '/api/temp-log'
  request_hash    TEXT NOT NULL,                    -- sha256 of (method, path, body) — guards against key-reuse on different mutations
  response_status INTEGER NOT NULL,                 -- the HTTP status to replay
  response_body   TEXT NOT NULL,                    -- the JSON response to replay
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
```

The 24h TTL is enforced lazily — on every wrapped POST, drop rows where `created_at < datetime('now', '-1 day')`. No background job. Cheap on a small table.

## Wrapper — `lib/idempotency.ts`

```ts
export async function withIdempotency(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get('idempotency-key');
  if (!key) return handler();      // un-keyed clients (curl) get pass-through

  // (validate key shape — UUIDv7 or 16+ char alphanumeric)
  // (compute request_hash from method + path + body)
  // (sweep idempotency_keys older than 24h in same tx)
  // (look up by key)
  //   - cache hit + matching request_hash → return cached response
  //   - cache hit + mismatched hash → 409 with error 'idempotency-key reused for a different request'
  //   - miss → run handler, cache the response (status + body), return it
}
```

The wrapper is opt-in. Each regulated POST handler routes through it explicitly:

```ts
export async function POST(req: Request) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, async () => {
    // existing handler body
  });
}
```

This shape lets us retrofit one route per PR without breaking the others.

## Client — `lib/clientFetch.ts` (small wrapper)

```ts
export async function clientFetch(
  url: string,
  init: RequestInit & { idempotent?: boolean } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.idempotent && !headers.has('idempotency-key')) {
    // generate at the FETCH-INITIATION layer, not at queue-time —
    // so the original request and any replay carry the same key
    headers.set('idempotency-key', crypto.randomUUID());
  }
  return fetch(url, { ...init, headers });
}
```

Every client surface that POSTs to a wrapped route uses `clientFetch(url, { idempotent: true, ... })` instead of bare `fetch`. The SW (`public/sw.js`) does not generate keys; it just propagates whatever header was on the request when it was first issued. The replay path keeps the header intact.

## Verification — e2e and unit

The full-offline round-trip e2e (`tests/e2e/offline-queue.spec.ts:83` — currently `test.skip`) asserts no-duplicate-rows after a forced "lost-after-commit" replay. The unit test (`tests/js/test-idempotency-wrapper.mjs`) pins the three cases above directly against the wrapper without going through a route.

Per-route retrofit tests pair with each opt-in PR — assert that without an `idempotency-key` header behavior is unchanged (regression guard for un-keyed callers like curl scripts).

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| 24h TTL too short for shift overlap | Low | Low | Shifts are <24h; if a slow recovery exceeds it, the replayed request is treated as fresh — safe (just no longer deduped). |
| Request-hash mismatch fires on legitimate replays (e.g. a body-rewriting middleware adds a timestamp) | Med | Med | Hash on method + path + body BEFORE any middleware touches it; the SW's queued body is the canonical source. |
| Wrapper retrofit forgotten on a new regulated route | Med | High | Add a `tests/js/test-idempotency-coverage.mjs` that walks every route under `app/api/**/route.{js,ts}` and asserts each POST exports a handler that calls `withIdempotency`. Static check; same shape as the §7 P3 follow-up `test-ui-copy-rules.mjs`. |
| `crypto.randomUUID()` unavailable on legacy Safari iPad | Low | High | iPad iOS 14+ (the deployment target) has `crypto.randomUUID`. Fall back to a 16-char alphanumeric polyfill. |
| Replay race (two `replayQueue` messages drain in parallel) | Low | High | The wrapper closes this; both replays carry the same key, second is deduped to the cached response. |

## Cutover

Stage as 4 PRs, each independently mergeable:

1. **Schema + wrapper.** New `idempotency_keys` table via the existing `migrateLegacyColumns` entry; new `lib/idempotency.ts::withIdempotency`; `lib/clientFetch.ts::clientFetch` (test-only client until step 3); paired wrapper-unit test. **No route uses it yet** — strictly adds the kit.
2. **Retrofit signoff + box-office line write.** Two highest-blast-radius regulated routes. Add `withIdempotency` wrap; client-side `clientFetch({ idempotent: true })`; per-route test. Un-skip the e2e for these two routes.
3. **Retrofit temp-log + receiving.** Same shape.
4. **Coverage test + bulk retrofit.** Add `tests/js/test-idempotency-coverage.mjs` (assert every regulated POST is wrapped); fail it; bulk-retrofit the remaining ~8 regulated routes; flip the test to green.

The plan is in `docs/superpowers/plans/2026-05-02-sw-replay-idempotency-plan.md`.

## See also

- `docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md` — the audit finding
- `docs/agentic/audits/2026-05-02-breaker-section8.md` — the audit context
- `docs/PATTERNS.md §3` — DB audit two-track (the wrapper does NOT replace the audit; both fire)
- `lib/auditEvents.ts` — audit posting that must run inside the wrapped handler's transaction
