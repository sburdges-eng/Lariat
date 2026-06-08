# Next 3 PR Sequence

Status: draft
Purpose: turn the current protected-surface planning work into an execution order with exact branch names, scope boundaries, and verification gates.

## Sequence overview

1. `docs/protected-contracts`
2. `app/cloud-bridge-dead-letter-route-guards`
3. `app/sync-since-checkjs-hardening`

The order matters:
- PR 1 lands the review rulebook
- PR 2 proves a small protected-surface extraction can be done safely
- PR 3 hardens the most semantically dense sync route after the review model is already in place

---

## PR 1 — Docs rulebook

Branch
- `docs/protected-contracts`

Title
- `docs: add protected contracts and protected-surface PR template`

Commit
- `docs: add protected contracts and PR review template`

Files
- `docs/PROTECTED_CONTRACTS.md`
- `docs/PROTECTED_PR_TEMPLATE.md`
- `docs/ARCHITECTURE.md`

Optional reference-only artifact
- `docs/handoffs/2026-06-08-protected-contracts-pr.md`

Hard scope boundary
- docs only
- no `app/`
- no `lib/`
- no `tests/`
- no runtime behavior changes

Verification
- read for clarity and internal-link sanity
- confirm no runtime files changed

Merge condition
- reviewers agree the protected-surface map matches the current system shape

Biggest benefit
- future refactors now have an explicit contract and reviewer gate

---

## PR 2 — First protected extraction

Branch
- `app/cloud-bridge-dead-letter-route-guards`

Title
- `refactor: extract shared dead-letter route guards for cloud bridge`

Commit
- `refactor: share cloud-bridge dead-letter route guards`

Files in scope
- create `lib/cloudBridgeRouteGuards.ts`
- modify `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- modify `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Hard scope boundary
Do not touch:
- `lib/cloudBridgeQueue.ts`
- `app/api/cloud-bridge/dead-letters/route.js`
- `app/api/cloud-bridge/status/route.js`
- `app/api/peers/route.js`
- `app/api/peers/sync-since/route.js`
- retry budgets / DLQ thresholds
- audit schema or action names
- response shapes

Required unchanged invariants
- bad id still `400`
- unknown id still `404`
- alive row still `404`
- cross-location guessed id still `404`, not `403`
- `requirePin` still gates both routes
- `withIdempotency` still wraps both routes
- audit action names stay unchanged
- queue semantics stay in `lib/cloudBridgeQueue.ts`

Required tests
```bash
node --experimental-strip-types --test \
  tests/js/test-cloud-bridge-dead-letters-api.mjs \
  tests/js/test-cloud-bridge-queue-race-safety.mjs
```

Recommended extra
```bash
node --experimental-strip-types --test tests/js/test-cloud-bridge-drainer.mjs
```

Merge condition
- reviewer can clearly see only duplicated preconditions moved, not mutation semantics

Biggest benefit
- requeue/drop can no longer drift on scoped-404 / IDOR guard behavior as easily

---

## PR 3 — Sync-since hardening

Branch
- `app/sync-since-checkjs-hardening`

Title
- `refactor: harden peers sync-since route with typed request parsing`

Commit
- `refactor: add typed parsing guards to peers sync-since route`

Files in scope
- `app/api/peers/sync-since/route.js`

Possible narrow helper extraction only if it stays pure and obvious.

Hard scope boundary
Do not touch:
- `lib/peerTrust.ts`
- `lib/syncFeed.ts`
- `lib/syncScheduler.ts`
- `lib/syncSchedulerLifecycle.ts`
- `app/api/peers/route.js`
- auth payload format
- checkpoint math
- `last_seen_id` contract
- generic `401` behavior
- `touchPeerLastSeen()` timing

Required unchanged invariants
- auth failure and bad-param shape still collapse to generic `401`
- query-param validation still happens before surfacing auth outcome
- replay response still includes `last_seen_id`
- `touchPeerLastSeen()` still fires only after successful replay fetch
- replay/auth semantics remain unchanged

Required tests
```bash
node --experimental-strip-types --test \
  tests/js/test-peer-auth.mjs \
  tests/js/test-sync-client.mjs \
  tests/js/test-sync-scheduler.mjs \
  tests/js/test-sync-scheduler-lifecycle.mjs
```

Merge condition
- route is easier to reason about, but sync trust/replay behavior is unchanged

Biggest benefit
- hardens the highest-density trust/replay route without widening the change surface

---

## Recommended execution commands

Create branches in this order:
```bash
git checkout -b docs/protected-contracts
git checkout -b app/cloud-bridge-dead-letter-route-guards
git checkout -b app/sync-since-checkjs-hardening
```

Open PRs in the same order. Do not overlap PR 2 and PR 3 in the same branch.

---

## Stop conditions

Stop and re-scope if any PR begins to:
- change queue semantics instead of route structure
- change auth or replay semantics instead of typed hardening
- pull in unrelated cleanup for nearby files
- require broad test fallout outside its protected lane

If that happens, split again instead of expanding the PR.

---

## Bottom line

These three PRs together convert the current audit work into a practical path:
- rulebook
- proven safe extraction
- trust-boundary hardening
