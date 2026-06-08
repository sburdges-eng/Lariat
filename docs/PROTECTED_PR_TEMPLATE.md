# Protected Surface PR Template

Use this template for any PR that touches a protected contract surface defined in `docs/PROTECTED_CONTRACTS.md`.

A protected-surface PR is successful only if it preserves operational truth, replay truth, trust boundaries, and recovery behavior — not merely if broad tests pass.

---

## PR Summary

### What this PR does

- 
- 
- 

### Why this PR exists

- 

### Protected contract families touched

Check all that apply:

- [ ] Deterministic ops ledger
- [ ] Management rollups
- [ ] Sync family classification / replay apply
- [ ] Replay checkpoints / scheduler progress
- [ ] Peer trust / signed sync fetch
- [ ] Peer discovery / topology disclosure
- [ ] Scheduler boot / peer-source safety
- [ ] Cloud bridge outbox / drainer / DLQ
- [ ] None of the above

---

## Scope Control

### Files touched

List the protected files changed in this PR.

- 
- 
- 

### Files intentionally not touched

List nearby dangerous files or layers that were explicitly left alone.

- 
- 
- 

### This PR does NOT mix with

Check every category intentionally excluded from this PR:

- [ ] schema / migration changes
- [ ] docs-only cleanup unrelated to the contract
- [ ] UI copy / layout churn unrelated to the contract
- [ ] startup / lifecycle changes unrelated to the contract
- [ ] packaging / desktop wrapper changes
- [ ] unrelated event-ops logic
- [ ] unrelated assistant / datapack work
- [ ] unrelated cloud / sync work

If anything above is included anyway, explain why the mix is unavoidable:

- 

---

## Contract Preservation

### Invariants intentionally unchanged

List the key behaviors this PR preserves.

- 
- 
- 

### Invariants intentionally changed

If this PR changes a contract, state it plainly.

- none

If a contract changes, explain:

1. old behavior
2. new behavior
3. why the change is required
4. what tests were updated to pin the new behavior

---

## Risk Review by Surface

Complete only the sections relevant to this PR.

### Deterministic ops ledger

- [ ] receiving credit semantics unchanged
- [ ] unresolved rows still route to repair queues correctly
- [ ] compute fan-out still occurs where expected
- [ ] audit coupling remains transactional
- Notes:
  - 

### Management rollups

- [ ] one broken reader still cannot blank the full page
- [ ] location scoping preserved
- [ ] linked destination counts remain aligned
- [ ] expensive reads remain bounded / snapshot-backed
- Notes:
  - 

### Sync replay

- [ ] family membership unchanged, or explicitly documented above
- [ ] family-2 delete scope not widened
- [ ] family-3 skip semantics preserved
- [ ] schema-drift still fails loud or skips safely
- Notes:
  - 

### Replay checkpoints

- [ ] checkpoint advancement math unchanged, or explicitly documented above
- [ ] gap handling preserved
- [ ] one peer failure still does not block others
- Notes:
  - 

### Peer trust / signed fetch

- [ ] signed payload contract unchanged
- [ ] replay-defense window preserved
- [ ] revoked-peer behavior preserved
- [ ] last_seen update semantics preserved
- Notes:
  - 

### Peer discovery / topology disclosure

- [ ] unauth response still redacts topology-sensitive fields
- [ ] auth response still exposes only intended fields
- [ ] timeout clamping preserved
- Notes:
  - 

### Scheduler boot / peer-source safety

- [ ] private / loopback / metadata host restrictions preserved
- [ ] startup idempotency preserved
- [ ] default peer identity semantics preserved
- Notes:
  - 

### Cloud bridge outbox / DLQ

- [ ] claim / ack / nack semantics preserved
- [ ] dead-letter gating preserved
- [ ] graceful-stop ownership semantics preserved
- [ ] dead-letter mutation remains PIN-gated and location-safe
- Notes:
  - 

---

## Required Targeted Verification

Check the exact suites you ran.

### Management rollups

- [ ] `node --experimental-strip-types --test tests/js/test-management-rollup.mjs`

### Sync apply / replay

- [ ] `node --experimental-strip-types --test tests/js/test-sync-apply.mjs tests/js/test-sync-scheduler.mjs tests/js/test-sync-scheduler-lifecycle.mjs tests/js/test-sync-client.mjs`

### Peer trust / topology

- [ ] `node --experimental-strip-types --test tests/js/test-peer-auth.mjs tests/js/test-peers-route.mjs`

### Cloud bridge

- [ ] `node --experimental-strip-types --test tests/js/test-cloud-bridge-drainer.mjs tests/js/test-cloud-bridge-dead-letters-api.mjs tests/js/test-cloud-bridge-queue-race-safety.mjs`

### Receiving / depletion / compliance

- [ ] `node --experimental-strip-types --test tests/js/test-receiving-api.mjs tests/js/test-receiving-rules.mjs tests/js/test-depletion-exceptions.mjs tests/js/test-compliance-hybrid.mjs tests/js/test-compliance-rrf.mjs`

### Additional focused tests run

- 
- 

### Manual verification

- 
- 

---

## Reviewer Checklist

Reviewer: do not approve until all applicable boxes are true.

- [ ] PR scope is narrow and matches summary
- [ ] protected files touched are explicitly listed
- [ ] dangerous nearby files intentionally left alone are named
- [ ] contract-preserving behavior is stated concretely, not vaguely
- [ ] any contract change is explicit, justified, and test-pinned
- [ ] targeted suites for touched surfaces were actually run
- [ ] no unrelated cleanup was mixed into the PR
- [ ] rollback is clear if behavior regresses

---

## Rollback / Failure Mode Notes

If this PR regresses in production or local ops, what is the fastest safe rollback path?

- 
- 
- 

## Follow-up Work Explicitly Deferred

List follow-up work that should not be mixed into this PR.

- 
- 
- 

---

## Short Reviewer Prompt

Use this question before approval:

"Does this PR preserve operational truth and failure semantics for the touched surface, or does it only look structurally cleaner?"
