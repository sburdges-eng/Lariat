# Orchestrator status — 2026-05-14

## Recipe-photo wave (2026-05-13)

Manifest: prior `tasks.yaml` (5 tasks)
Outcome: **all 5 tasks merged to main** between commits `c9b9a69` and `42deab5`.

| Task | Status | Branch | Merge commit | Tests |
|------|--------|--------|--------------|-------|
| T1 | merged | orch/T1 @ 31304de | c9b9a69 | 13/13 |
| T2 | merged (via T3) | orch/T2 @ a9099fd | a852fc8 | 8/8 |
| T3 | merged | orch/T3 @ 547330d | a852fc8 | 8 API + 4 UI |
| T4 | merged | orch/T4 @ afb19c5 | 319aa53 | 11/11 |
| T5 | merged | orch/T5 @ b8ecff6 | 42deab5 | 6/6 |

## Phase 3.5 wave (2026-05-14, in progress)

Manifest: current `tasks.yaml` (8 tasks)
Shipped: T1, T2, T3, T5 + Phase 2B B3 (settlement PDF).
Pending: T4, T6, T7, T8.

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| Phase 2B B3 — Settlement PDF | shipped | b1a39ec | 17/17 |
| T1 — line_check audit-row | shipped | 3f22201 | 19/19 (+3 new) |
| T2 — LARIAT_DATA_DIR JSON cache | shipped | c0df793 | 2/2 |
| T3 — .env hygiene | shipped | fbbeddb | (gitignore-only) |
| T4 — Ingredient-masters operator review UI | pending | — | — |
| T5 — Weekly settlement digest | shipped | 4758e27 | 10/10 |
| T6 — Desktop first-run wizard | pending | — | — |
| T7 — Ed25519 peer auth | pending | — | — |
| T8 — Cloud-bridge production wiring | pending | — | — |

## Session commits — 2026-05-14

```
4758e27 feat(shows): weekly settlement digest cron + renderDigestHtml (T5)
c0df793 fix(data): honor LARIAT_DATA_DIR for JSON cache root (T2)
3f22201 fix(checks): wrap line_check_entries INSERT in audit-event tx (T1)
fbbeddb chore(orch): Phase 3.5 task manifest + .env hygiene (T3)
b1a39ec feat(shows): printable settlement view + Download PDF button (Phase 2B B3)
fdfaf54 chore(docs): trio orchestration handoff protocol + recipe-photo wave closeout
```

All commits green: typecheck clean, 390/390 HACCP rules pass, 17 + 10 + 19 + 2
new tests pass with no regression on the existing settlement-route or
data-cache suites.

## Followups outstanding

- **Unpushed main** — now 20 commits ahead of `origin/main` (this wave +
  the recipe-photo wave + earlier work). Push when ready.
- **Stale GitNexus index** — `af98d62` sentinel warned across session.
  Run `npx gitnexus analyze` to refresh.
- **Audit worktree** (`/Users/seanburdges/Dev/Lariat-worktrees/claude-audit-codebase-fixes-2026-05-13`)
  — branch name uses legacy `audit/` prefix; rebase requires
  `LARIAT_ALLOW_ANY_BRANCH=1` override. Substance has been reapplied
  to main directly (T1 + T2 + T3 + .env hygiene). The branch can be
  removed once the operator confirms there's no other content there.
- **Uncommitted on main** — `data/normalized/compliance_rules.jsonl`
  (regenerated file, project says do not hand-edit), `.vscode/tasks.json`
  (untracked IDE config), `design/` (zips + extracted dirs from the
  LaRi Whole-Design Remix; `ed05b13` already synced the canonical
  output into `public/`).

## Next wave — T4, T6, T7, T8

Each remaining task is M+ effort. Recommended order:

1. **T4 — Ingredient-masters operator review UI** — operator-facing
   surface, no new external deps, composes with shipped T7 backfill.
2. **T7 — Ed25519 peer auth** — unblocks any multi-instance work that
   actually crosses the LAN trust boundary.
3. **T8 — Cloud-bridge production wiring** — depends on T7 if HMAC
   gets replaced with Ed25519 signatures.
4. **T6 — Desktop first-run wizard** — Electron + React + Vite; new
   territory, slowest to ship.
