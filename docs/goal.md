# PR Goal

Complete the current scoped PR until it is production-ready, freeze-ready, deterministic, tested, and safe.

## Verified Current State

* Lines Added: 1475 across scoped PR files in working-tree diff.
* Lines Removed: 16 across scoped PR files in working-tree diff.
* Invariant Check: PASS.
* Focused tests went red first, then green.
* Targeted regression set passed 92/92.
* `npm run typecheck -- --pretty false` passed.
* `npx next build --webpack` passed.
* `bash scripts/ci/no-absolute-paths.sh` passed.
* `bash scripts/ci/no-cache-artifacts.sh` passed.
* `git -c core.fsmonitor=false diff --check` passed.
* Determinism Impact: Improved.
* Price shocks compare historical baseline against the live current `vendor_prices` row with stable ordering.
* Prep task mutations are location-scoped, audited in-transaction, and idempotency-wrapped.
* Runtime Coupling Introduced: NO.
* Freeze-readiness Impact: Positive.
* No schema changes.
* No runtime AI/cloud dependency.
* No absolute-path CI failure.
* Security Impact: Location boundary checks added for task update/delete paths.

## Operating Rules

Work autonomously. Do not ask for confirmation unless one of these is true:

1. A destructive action is required.
2. Credentials, secrets, payments, or external accounts are involved.
3. Product intent is genuinely ambiguous and cannot be resolved from repo context.
4. Two implementation paths have materially different security or data-integrity consequences.

Otherwise, continue working.

Stay inside the scoped PR unless a required fix proves the scope is incomplete. If scope must expand, document why before changing out-of-scope files.

Prefer minimal, reviewable patches. Do not rewrite working code casually.

Preserve:

* determinism
* stable ordering
* location boundaries
* idempotency
* transaction guarantees
* audit guarantees

Do not introduce:

* schema changes
* runtime AI/cloud dependencies
* absolute local paths
* cache artifacts
* hidden global state
* nondeterministic ordering
* cross-location mutation leakage
* new runtime coupling

## Context Reset Protocol

Actively monitor for context drift.

Before context becomes unreliable, update `AGENT_STATE.md` with:

* current goal
* current branch/status
* files changed
* important decisions
* tests run and exact results
* remaining tasks
* known risks
* next 3 concrete commands/actions

Add a section titled:

`NEXT_SESSION_START_HERE`

When resetting, stop relying on stale memory. Re-read:

* `AGENT_STATE.md`
* `git status --short`
* `git diff --stat`
* `git diff --check`
* `git diff`
* relevant changed files
* latest test output
* relevant package/CI scripts

Then resume from the written state.

Never continue blindly when context is uncertain. Reset from written state instead.

## Autonomous Work Loop

Repeat until complete:

1. Inspect current diff.
2. Identify remaining risks:

   * failing tests
   * missing tests
   * nondeterminism
   * unsafe location boundaries
   * missing audit/idempotency coverage
   * stale assumptions
   * type/build issues
   * accidental scope creep
3. Make the smallest correct patch.
4. Run narrow relevant tests first.
5. Run broader regression tests after narrow tests pass.
6. Re-run invariant checks:

   * `npm run typecheck -- --pretty false`
   * `npx next build --webpack`
   * `bash scripts/ci/no-absolute-paths.sh`
   * `bash scripts/ci/no-cache-artifacts.sh`
   * `git -c core.fsmonitor=false diff --check`
7. Update `AGENT_STATE.md` after meaningful progress.
8. Continue until no known correctness, security, determinism, test, typecheck, build, or CI issues remain.

## Completion Criteria

The task is complete only when:

* working-tree diff is understood and scoped
* changed behavior is tested or covered by existing tests
* focused tests pass
* regression tests pass
* typecheck passes
* build passes
* CI guard scripts pass
* `git diff --check` passes
* no unapproved schema changes exist
* no runtime AI/cloud dependency was introduced
* determinism impact is neutral or positive
* location boundary/security impact is neutral or positive
* `AGENT_STATE.md` contains final summary and verification results

## Final Response Format

When complete, return only:

1. Summary of changes
2. Files changed
3. Tests/checks run with pass/fail
4. Security impact
5. Determinism impact
6. Runtime coupling impact
7. Remaining risks, or `None known`
8. Recommended commit message

Do not produce long commentary. Do not ask whether to continue. Continue automatically until completion or a true blocker is reached.
