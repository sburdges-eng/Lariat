# Orchestrator status — 2026-05-14 (end of session)

## Recipe-photo wave (closed 2026-05-13)

Manifest: prior `tasks.yaml` (5 tasks)
Outcome: all 5 merged between `c9b9a69` and `42deab5`.

| Task | Branch | Merge commit | Tests |
|------|--------|--------------|-------|
| T1 | orch/T1 @ 31304de | c9b9a69 | 13/13 |
| T2 | orch/T2 @ a9099fd | a852fc8 (via T3) | 8/8 |
| T3 | orch/T3 @ 547330d | a852fc8 | 8 API + 4 UI |
| T4 | orch/T4 @ afb19c5 | 319aa53 | 11/11 |
| T5 | orch/T5 @ b8ecff6 | 42deab5 | 6/6 |

## Phase 3.5 wave (2026-05-14)

Manifest: current `tasks.yaml`. Shipped vs pending:

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| Phase 2B B3 — Settlement PDF | shipped | b1a39ec | 17/17 |
| T1 — line_check audit-row | shipped | 3f22201 | 19/19 (+3 new) |
| T2 — LARIAT_DATA_DIR JSON cache | shipped | c0df793 | 2/2 |
| T3 — .env hygiene | shipped | fbbeddb | (gitignore) |
| T4 — Ingredient-masters operator review UI | shipped | 45e4684 | 34/34 (17 repo + 17 api) |
| T5 — Weekly settlement digest | shipped | 4758e27 | 10/10 |
| Audit §4 access-matrix refresh | shipped | 36c7246 | (docs-only) |
| T6 — Desktop first-run wizard | pending | — | — |
| T7 — Sync impl + Ed25519 peer auth | pending | — | — |
| T8 — Cloud-bridge production wiring | pending | — | — |

## Session commits — 2026-05-14

```
36c7246 docs(architecture): refresh §4 access-control matrix to match middleware
45e4684 feat(costing): /costing/ingredient-masters operator review surface (T4)
6d8a08a chore(orch): roll up Phase 3.5 progress in ORCHESTRATOR_STATUS
4758e27 feat(shows): weekly settlement digest cron + renderDigestHtml (T5)
c0df793 fix(data): honor LARIAT_DATA_DIR for JSON cache root (T2)
3f22201 fix(checks): wrap line_check_entries INSERT in audit-event tx (T1)
fbbeddb chore(orch): Phase 3.5 task manifest + .env hygiene (T3)
b1a39ec feat(shows): printable settlement view + Download PDF button (Phase 2B B3)
fdfaf54 chore(docs): trio orchestration handoff protocol + recipe-photo wave closeout
```

All commits green:
- typecheck clean on every commit
- 390/390 HACCP rules tests pass
- 17 + 10 + 19 + 2 + 34 new tests pass (Settlement PDF, weekly digest,
  line_check audit, LARIAT_DATA_DIR cache, ingredient-masters)
- 0 regressions on settlement-route, datapack semantic, datapack-prewarm,
  data-cache-last-known-good, datapack-search suites.

## Followups outstanding

- **Unpushed main** — now 22 commits ahead of `origin/main`. Push when ready.
- **Stale GitNexus index** — `af98d62` sentinel warned across session.
  Run `npx gitnexus analyze` to refresh.
- **Audit worktree fully drained** — all 4 fixes (T1 + T2 + T3 + audit
  doc) reapplied to main. The branch `audit/codebase-fixes-2026-05-13`
  in `/Users/seanburdges/Dev/Lariat-worktrees/` is now obsolete and can
  be removed.
- **Uncommitted on main** — `data/normalized/compliance_rules.jsonl`
  (regenerated; project says do not hand-edit), `.vscode/tasks.json`
  (untracked IDE config), `design/` (zips + dirs from the LaRi
  Whole-Design Remix; `ed05b13` already synced the canonical output
  into `public/`).

## Next wave — T6, T7, T8

Each remaining task is M+ effort, warrants its own dedicated session
or `/team-run` dispatch with a reviewer agent. Recommended order:

1. **T7 — Sync impl + Ed25519 peer auth** — largest design surface
   (conflict-resolution policy per HACCP/financial/live-state family
   needs sign-off). Unblocks any real multi-host work. lib/syncFeed.ts
   already has stubs; lib/peerKeypair.ts already has signProof/verifyProof.
2. **T8 — Cloud-bridge production wiring** — moves HMAC secret out of
   env into desktop/settings.ts, adds graceful drainer shutdown,
   replaces ad-hoc launch with launchd/systemd unit. Cron is NOT
   appropriate (drainer is long-running).
3. **T6 — Desktop first-run wizard** — Vite + Electron + React;
   slowest to ship. Useful once T8's settings.ts work lands so the
   wizard has more to wire.
