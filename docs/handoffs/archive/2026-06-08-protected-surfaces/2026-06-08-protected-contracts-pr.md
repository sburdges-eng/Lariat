# Protected Contracts Docs PR Bundle

Status: draft
Suggested branch: `docs/protected-contracts`
Suggested PR title: `docs: add protected contracts and protected-surface PR template`

## Goal

Land the protected-contract documentation lane as a docs-only PR with zero behavioral changes.

This PR exists to make future refactors safer by documenting:
- what surfaces are contract-sensitive
- what behaviors must not drift
- what targeted tests reviewers should require
- how to structure protected-surface PRs

## Files in scope

Create:
- `docs/PROTECTED_CONTRACTS.md`
- `docs/PROTECTED_PR_TEMPLATE.md`

Modify:
- `docs/ARCHITECTURE.md`
  - add a consistency-only cross-link to `docs/PROTECTED_CONTRACTS.md`

## Files intentionally out of scope

Do not include any edits to:
- `app/`
- `lib/`
- `tests/`
- `scripts/`
- `.github/workflows/`
- desktop or packaging files
- sync, cloud-bridge, receiving, inventory, or management runtime code

This PR is documentation-only.

## Contract families documented

- deterministic ops ledger
- management rollups
- sync replay and checkpoints
- peer trust / signed fetch
- peer discovery / topology disclosure
- scheduler boot / peer-source safety
- cloud bridge outbox / drainer / dead-letter handling

## Why this PR should be isolated

Mixing this doc lane with code changes weakens the exact discipline the doc is trying to establish.

If reviewers cannot tell whether a PR is defining rules or changing behavior, the protected-surface model loses value immediately.

## Expected reviewer stance

Review this PR for:
- correctness of system characterization
- completeness of protected-surface coverage
- clarity of reviewer instructions
- consistency with current repo behavior

Do not review this PR as if it were attempting to change behavior.

## Suggested PR description

### Summary

This PR adds the repo’s protected-contract reference and a reusable protected-surface PR template.

It documents the system behaviors that must not drift during refactors, route extraction, typing migrations, sync work, cloud-bridge work, and management/dashboard cleanup.

### Included

- new `docs/PROTECTED_CONTRACTS.md`
- new `docs/PROTECTED_PR_TEMPLATE.md`
- one consistency-only cross-link in `docs/ARCHITECTURE.md`

### Not included

- no route changes
- no query changes
- no schema changes
- no sync logic changes
- no cloud-bridge behavior changes
- no management threshold changes
- no runtime code changes

### Why now

The repo already has several high-blast-radius surfaces with good local logic and tests, but the review boundaries were mostly implicit. This PR makes those boundaries explicit before later refactor lanes proceed.

## Suggested reviewer checklist

- [ ] docs-only scope is preserved
- [ ] protected surfaces named here match the current system shape
- [ ] no behavioral claims contradict current code/tests
- [ ] PR template is concrete enough to gate future protected-surface PRs
- [ ] no unrelated documentation cleanup was mixed in

## Verification

Because this PR is docs-only, verification is limited to:
- markdown readability
- internal link/path sanity
- consistency against current codebase observations

No runtime tests are required for this PR.

## Follow-on work after merge

1. use `docs/PROTECTED_PR_TEMPLATE.md` for protected-surface PRs
2. run the sync/cloud route-thickness audit
3. identify the first isolated extraction PR in a protected lane

## Explicitly deferred

- sync/cloud route refactors
- event-ops route refactors
- management query changes
- stronger typing migrations on protected routes
- CI enforcement for protected-surface templates
