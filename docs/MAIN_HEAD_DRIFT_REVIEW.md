# Main HEAD typecheck drift — handoff

**Date:** 2026-04-27
**Status:** main HEAD red, working tree green (drift masks the failure locally)

## What's broken

`npm run typecheck` against bare main HEAD (commit `935f700`) fails with 3 errors in `lib/commandCenter.ts`:

```
lib/commandCenter.ts(11,10): error TS2305: Module '"./vendorPricesRepo"' has no exported member 'listPriceShocks'.
lib/commandCenter.ts(356,29): error TS7006: Parameter 'r' implicitly has an 'any' type.
lib/commandCenter.ts(357,31): error TS7006: Parameter 'r' implicitly has an 'any' type.
```

## Root cause

Commit `8ff7203 command-center: add probe-calibration signals` added:

```ts
import { listPriceShocks } from './vendorPricesRepo';
```

…but the matching `export function listPriceShocks(...)` was never committed. It exists only in the working tree as part of an in-progress diff:

```
M lib/vendorPricesRepo.ts   ← +export type PriceShockOptions / PriceShockRow / function listPriceShocks
```

Locally, `npm run typecheck` passes because TypeScript reads from the working tree, where the export exists. Anyone cloning fresh, switching worktrees, or running CI against HEAD sees the failure.

The pre-commit hook (`tsc --noEmit` via `simple-git-hooks`) does **not** catch this either — it runs against the working tree, not the staged set, so it inherits the same masking effect. This is a known limitation of working-tree-based pre-commit checks.

## Owner

Whichever session is mid-work on `vendorPricesRepo` price-shocks. The matching API route (`app/api/vendor-prices/shocks/`) is also untracked but wired in.

## Fix

Commit the `vendorPricesRepo` working-tree diff (the three `PriceShock*` exports, ~195 lines starting at line 331). Once that lands, main HEAD typecheck goes green.

## Why this is filed

- Caught while rebasing PR #35 onto main — the rebased worktree exposes the drift because it doesn't share main's working tree.
- The drift was **not** introduced by the strict-tsconfig hardening commit (`935f700`); the missing-export error (TS2305) and implicit-any errors (TS7006) both predate it. They were already latent under `strict: true` since `8ff7203`.
- PR #35 itself is clean and was pushed (`e543db9`) — its failures under `npm run verify` are this drift, not the PR.

## Related

- Pre-commit hook is `npm run typecheck` (~3s, fast). To make it staged-set-aware (catches drift like this before it lands), upgrade to `lint-staged` + `tsc --noEmit -p ./tsconfig.staged.json` or similar — out of scope for this handoff.
- `npm run verify` (typecheck + test:unit + test:rules + build) is the manual pre-merge gate; its build step also fails on bare HEAD with `Module not found: 'ort.webgpu.bundle.min.mjs'` from `lib/datapackSearch.ts` — likely the same shape (uncommitted dep / config in another session). Worth checking that the same fix-up commits both before declaring main green.
