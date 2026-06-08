# Protected Surfaces Next 3 PRs Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Land the protected-surface docs rulebook, then complete one safe cloud-bridge protected-lane extraction, then harden the sync-since route without semantic drift.

Architecture: Execute three narrowly scoped PRs in order. PR 1 is docs-only and establishes the reviewer contract. PR 2 extracts duplicated dead-letter route guards while keeping queue semantics unchanged. PR 3 hardens the trust/replay route with typed parsing and checkJs discipline while preserving auth ordering and checkpoint-visible response behavior.

Tech Stack: Next.js route handlers, JS with checkJs/JSDoc, TypeScript helper module, node:test, better-sqlite3-backed libs.

---

## PR 1: docs/protected-contracts

### Task 1: Create the docs branch
Objective: Start the docs-only PR on an isolated branch.

Files:
- Modify: git branch state only

Step 1: Create branch
Run: `git checkout -b docs/protected-contracts`

Step 2: Verify branch
Run: `git status --short --branch`
Expected: current branch is `docs/protected-contracts`

### Task 2: Stage the docs PR files
Objective: Stage only the rulebook docs.

Files:
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/PROTECTED_CONTRACTS.md`
- Create: `docs/PROTECTED_PR_TEMPLATE.md`

Step 1: Review staged scope candidate
Run: `git diff -- docs/ARCHITECTURE.md docs/PROTECTED_CONTRACTS.md docs/PROTECTED_PR_TEMPLATE.md`

Step 2: Stage exact files
Run: `git add docs/ARCHITECTURE.md docs/PROTECTED_CONTRACTS.md docs/PROTECTED_PR_TEMPLATE.md`

Step 3: Confirm no runtime files are staged
Run: `git diff --cached --name-only`
Expected: only the three docs files above

### Task 3: Commit the docs PR
Objective: Create the docs-only commit.

Files:
- Modify: git history only

Step 1: Commit
Run: `git commit -m "docs: add protected contracts and PR review template"`

Step 2: Verify commit
Run: `git log -1 --stat`

---

## PR 2: app/cloud-bridge-dead-letter-route-guards

### Task 4: Create the extraction branch
Objective: Start the first protected-lane extraction from main or after PR 1 merge/cherry-pick.

Files:
- Modify: git branch state only

Step 1: Create branch
Run: `git checkout -b app/cloud-bridge-dead-letter-route-guards`

Step 2: Verify clean branch state
Run: `git status --short --branch`

### Task 5: Add the shared route-guard helper
Objective: Create a helper for dead-letter route preconditions only.

Files:
- Create: `lib/cloudBridgeRouteGuards.ts`
- Read for reference: `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- Read for reference: `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Step 1: Implement helper with narrow contract
Include:
- id parsing
- dead-letter snapshot lookup
- caller location scoping
- discriminated result or ready Response for short-circuit

Step 2: Keep helper out of mutation semantics
Do not include:
- requeue/drop calls
- audit action writing
- success response shaping
- idempotency wrapper

### Task 6: Rewire the requeue route
Objective: Replace duplicated precondition logic with the helper.

Files:
- Modify: `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`

Step 1: Keep `withIdempotency` intact
Step 2: Keep `requirePin` intact unless helper intentionally owns it and tests remain unchanged
Step 3: Preserve statuses and payload shape exactly

### Task 7: Rewire the drop route
Objective: Replace duplicated precondition logic with the helper.

Files:
- Modify: `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Step 1: Preserve cross-location 404 behavior
Step 2: Preserve audit payload retention for dropped rows
Step 3: Preserve success/error response shape exactly

### Task 8: Run focused cloud-bridge tests
Objective: Prove semantics did not drift.

Files:
- Test: `tests/js/test-cloud-bridge-dead-letters-api.mjs`
- Test: `tests/js/test-cloud-bridge-queue-race-safety.mjs`
- Optional: `tests/js/test-cloud-bridge-drainer.mjs`

Step 1: Run required suite
Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-dead-letters-api.mjs tests/js/test-cloud-bridge-queue-race-safety.mjs`
Expected: PASS

Step 2: Run recommended extra suite
Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-drainer.mjs`
Expected: PASS

### Task 9: Commit the extraction PR
Objective: Save the protected-lane refactor as one narrow commit.

Files:
- Create: `lib/cloudBridgeRouteGuards.ts`
- Modify: `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- Modify: `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Step 1: Review diff
Run: `git diff -- lib/cloudBridgeRouteGuards.ts app/api/cloud-bridge/dead-letters/[id]/requeue/route.js app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Step 2: Stage files
Run: `git add lib/cloudBridgeRouteGuards.ts app/api/cloud-bridge/dead-letters/[id]/requeue/route.js app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Step 3: Commit
Run: `git commit -m "refactor: share cloud-bridge dead-letter route guards"`

---

## PR 3: app/sync-since-checkjs-hardening

### Task 10: Create the sync hardening branch
Objective: Start the trust-boundary hardening PR separately.

Files:
- Modify: git branch state only

Step 1: Create branch
Run: `git checkout -b app/sync-since-checkjs-hardening`

Step 2: Verify branch
Run: `git status --short --branch`

### Task 11: Harden request parsing in sync-since
Objective: Make the route easier to reason about without changing semantics.

Files:
- Modify: `app/api/peers/sync-since/route.js`

Step 1: Add/improve JSDoc/checkJs-friendly helper typing
Step 2: Optionally extract a tiny pure parse helper
Step 3: Preserve these exact behaviors:
- generic 401 for auth failure and bad params
- param validation before surfacing auth outcome
- `touchPeerLastSeen()` only after successful replay fetch
- `last_seen_id` remains in response

### Task 12: Run focused sync/peer tests
Objective: Prove route hardening did not alter trust/replay behavior.

Files:
- Test: `tests/js/test-peer-auth.mjs`
- Test: `tests/js/test-sync-client.mjs`
- Test: `tests/js/test-sync-scheduler.mjs`
- Test: `tests/js/test-sync-scheduler-lifecycle.mjs`

Step 1: Run required suite
Run: `node --experimental-strip-types --test tests/js/test-peer-auth.mjs tests/js/test-sync-client.mjs tests/js/test-sync-scheduler.mjs tests/js/test-sync-scheduler-lifecycle.mjs`
Expected: PASS

### Task 13: Commit the sync hardening PR
Objective: Save the route hardening as one narrow commit.

Files:
- Modify: `app/api/peers/sync-since/route.js`

Step 1: Review diff
Run: `git diff -- app/api/peers/sync-since/route.js`

Step 2: Stage file
Run: `git add app/api/peers/sync-since/route.js`

Step 3: Commit
Run: `git commit -m "refactor: add typed parsing guards to peers sync-since route"`

---

## Stop Conditions

Stop and split scope if any PR starts to:
- change queue semantics instead of route structure
- change auth or replay semantics instead of typed hardening
- pull in unrelated nearby cleanup
- require broad fallout outside the touched protected lane

## Verification Summary

PR 1:
- docs-only scope check

PR 2:
- `node --experimental-strip-types --test tests/js/test-cloud-bridge-dead-letters-api.mjs tests/js/test-cloud-bridge-queue-race-safety.mjs`
- optional `node --experimental-strip-types --test tests/js/test-cloud-bridge-drainer.mjs`

PR 3:
- `node --experimental-strip-types --test tests/js/test-peer-auth.mjs tests/js/test-sync-client.mjs tests/js/test-sync-scheduler.mjs tests/js/test-sync-scheduler-lifecycle.mjs`
