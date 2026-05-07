# Breaker Audit Finding

**Subsystem:** Offline queue / service worker (Section 8)

**Invariant:** `BREAKER_AUDIT.md §2` Section 8 row: "offline cook-flows degrade to localStorage drafts; on-reconnect sync **never duplicates rows**." The "never duplicates" half is what makes the offline queue safe to enable on regulated surfaces (HACCP temp logs, box-office tickets, inventory_updates). Without it, every queued mutation is a potential double-write.

**Break attempt:** Sequence on a flaky LAN (the production deployment target — kitchen WiFi has 5–15% packet loss in steel-walled walk-ins):

1. Cook records a temp log entry on the iPad. Network is up; POST sent.
2. Server processes the request, writes `temp_log` + `audit_events` rows, returns 201.
3. **The 201 response is dropped on the wire** before reaching the client.
4. SW's `fetch()` in `handleMutation` (`public/sw.js:98`) throws on the dropped response.
5. Catch path enqueues the mutation in IndexedDB.
6. Connection recovers; `replay()` fires.
7. Replay POSTs the same mutation again.
8. Server has no idempotency check — writes a SECOND `temp_log` row + a SECOND `audit_events` row.

**Observed result:**
- `public/sw.js:96–121` `handleMutation`: catches network failure → enqueues request body + headers + url + method. **No `Idempotency-Key` header is generated**. `grep -n "Idempotency-Key" public/sw.js app/api/*/route.*` returns zero matches across the entire repo.
- `public/sw.js:125–152` `replay()`: re-issues the queued fetch with the original headers + body. Server has no way to recognize the request as a retry vs a fresh mutation.
- `tests/e2e/offline-queue.spec.ts:83` — the full-offline-round-trip test is `test.skip`'d ("manual only"). The duplicate-on-replay case has no coverage at all.

**Concrete impact on regulated surfaces:**
- **HACCP temp_log**: two identical readings 100ms apart → audit trail shows the cook recorded twice for one CCP check. Inspector may see this as falsification.
- **box_office_lines**: walkup line replayed → same gross face_price double-counted → talent vs% bonus inflated. Same root cause as Section 5's DICE idempotency P1 (#113), but at the network layer instead of the bulk-import layer.
- **inventory_updates** (sales depletion + closed-loop receiving): double-debit / double-credit on retry. The receiving_log_id partial unique index from #95 protects the closed-loop credit path, but `inventory_updates` rows that don't carry a receiving_log_id (sales depletion, manual adjustments) have no constraint.
- **station_signoffs** (just got DB-audited in #103): a duplicate signoff is two attestations from the same cook for the same station-shift, which is non-sensical regulatorily.

**Expected result:** Generate a UUIDv7 (or crypto.randomUUID) `Idempotency-Key` header at the moment the mutation is FIRST issued (not at queue-time — see "expected — race avoidance" below). Server-side, every regulated POST handler maintains a small `idempotency_keys (key, response_status, response_body, created_at)` table with a UNIQUE constraint on `key`. On a duplicate key the server returns the cached response without re-writing.

The shape is well-known (Stripe's pattern, every modern payments API). Lariat doesn't need the full machinery — a 24-hour TTL on the table + the UNIQUE constraint is enough.

**Race avoidance:** The key MUST be generated before the FIRST send, not at queue-time. If we generated it on enqueue, the original request that succeeded had no key — and the replay's keyed request looks like a fresh mutation. Generate at the FETCH-INITIATION layer (a small client wrapper) so both the original and any replay carry the same key.

**Risk:** **P1.** Latent today because Lariat is single-restaurant on a LAN — the failure mode requires (a) network drop AFTER server commit, (b) before client sees response, (c) cook hits retry/auto-retry-fires, (d) replayed mutation is a regulated row. All four happen in production. The doctrine (`BREAKER_AUDIT.md §2`) explicitly names this as the load-bearing invariant for §8.

**Repro command:**
```bash
# 1. No Idempotency-Key anywhere in the codebase:
grep -rn "Idempotency-Key\|idempotency-key\|idempotency_keys" public/sw.js app/api/ lib/ tests/ docs/
# Returns nothing.

# 2. The offline-queue test that would have caught this is skipped:
sed -n '80,90p' tests/e2e/offline-queue.spec.ts
# test.skip('full offline POST → queue → replay (manual only)', async () => {});

# 3. Concrete repro (manual): Chrome DevTools → Network → Throttle to "Offline"
#    → cook records temp_log → un-throttle → observe the replay path posts the
#    same body to /api/temp-log without an Idempotency-Key header.
```

**Likely files:**
- `public/sw.js:96–152` — replace `handleMutation` + `replay` shape; the wrapper that generates Idempotency-Key needs to live in client code (either a `lib/clientFetch.ts` thin wrapper or a small inline helper) so the SW just queues whatever the client sent.
- `lib/db.ts` — new `idempotency_keys` table inside `migrateLegacyColumns` (the now-canonical migration entry from #113's debug).
- `lib/idempotency.ts` (new) — `withIdempotency(req, handler)` wrapper that EVERY regulated POST handler routes through.
- Every regulated POST handler — opt-in to the wrapper (`/api/temp-log`, `/api/receiving`, `/api/cooling`, `/api/sanitizer`, `/api/date-marks`, `/api/sick-worker`, `/api/breaks`, `/api/eighty-six`, `/api/signoff`, `/api/inventory`, `/api/shows/[id]/box-office`, etc.). The shows/[id]/* routes have the highest blast radius (cash custody) and should retrofit first.
- New: `tests/js/test-idempotency-key.mjs` — pin the header → cached-response contract.
- `tests/e2e/offline-queue.spec.ts:83` — un-skip the full round-trip test once the wrapper exists; assert no duplicate rows on a second replay.

**Fix class:** schema (migration) + new lib helper + ~10–15 route retrofits + e2e un-skip + new contract test

**Priority:** **P1** — silent data loss / audit corruption on a regulated surface; the failure mode is a normal LAN packet drop. Higher leverage than any single section-1-through-7 finding because it covers EVERY regulated POST surface at once.

---

## Optional notes

- This is a substantial fix — the right shape is **its own spec + plan in `docs/superpowers/specs/` and `docs/superpowers/plans/`**, not a one-PR drop. Recommend a 4-task TDD plan: (1) idempotency_keys table + migration, (2) `withIdempotency` wrapper + test, (3) retrofit the 4 highest-blast-radius routes (signoff, box-office, temp-log, receiving), (4) retrofit the rest + un-skip the e2e test.
- The retrofit can be staged: add the wrapper as opt-in via a function call (not a decorator), retrofit one route per PR, validate in production, then bulk-retrofit. The single-restaurant LAN deployment makes a one-shot retrofit acceptable, but the staged approach lets the spec compose with `REFACTOR_GOVERNANCE.md` 6-step edit order.
- Adjacent thing noticed but NOT this finding: `replay()` has no mutex. If two `replayQueue` messages fire in quick succession, both can drain the queue, sending the same entry twice before either calls `remove(e.id)`. With idempotency keys this becomes harmless; without them, it's the *same* duplicate-row bug from a different cause. The fix to this finding closes the race too.
- Adjacent #2: SW caches GET responses in `caches.open('lariat-api-v1')`. Cache versioning is hard-coded. If the response shape changes (e.g., a column rename), stale cached responses can render wrong data on a kitchen iPad until the cache evicts. Lower priority but worth a separate finding eventually — same shape as the v2 cache invalidation problem.
