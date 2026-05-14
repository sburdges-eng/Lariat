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

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| Phase 2B B3 — Settlement PDF | shipped | b1a39ec | 17/17 |
| T1 — line_check audit-row | shipped | 3f22201 | 19/19 (+3 new) |
| T2 — LARIAT_DATA_DIR JSON cache | shipped | c0df793 | 2/2 |
| T3 — .env hygiene | shipped | fbbeddb | (gitignore) |
| T4 — Ingredient-masters operator review UI | shipped | 45e4684 | 34/34 (17 repo + 17 api) |
| T5 — Weekly settlement digest | shipped | 4758e27 | 10/10 |
| Audit §4 access-matrix refresh | shipped | 36c7246 | (docs-only) |
| T6 — Desktop first-run wizard | shipped (already on main) | — | (existing) |
| T7a — sync_feed schema + appendOp + replaySince | shipped | aedd10e | 22/22 + 1 smoke |
| T7b — /api/peers/sync-since + Ed25519 auth | shipped | 6143758 | 24/24 |
| T8 — Graceful drainer stop + launchd template | shipped (partial) | a09804f | 9/9 |
| T7c — Receiving-side per-table appliers | pending | — | — |
| T8b — Cloud-bridge HMAC secret in settings.ts | pending | — | — |

## Session commits — 2026-05-14

```
a09804f feat(cloud-bridge): graceful drainer stop + launchd template (T8)
6143758 feat(peers): /api/peers/sync-since + Ed25519 signed-request auth (T7b)
aedd10e feat(sync): sync_feed + replay_checkpoints schema + appendOp/replaySince (T7a)
e264ea0 chore(orch): close out T1-T5 + audit branch, refresh remaining manifest
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
- 137 new/regressed tests pass (17 settlement-pdf, 10 weekly-digest,
  19 checks-api, 2 data-cache-data-dir, 34 ingredient-masters, 22 sync-
  feed, 24 peer-auth, 9 cloud-bridge-graceful-stop)
- 0 regressions on existing suites (settlement-route, datapack
  semantic/prewarm/search, data-cache-last-known-good, cloud-bridge-
  push, cloud-bridge-drainer, recipe-photos)

## Followups outstanding

- **Unpushed main** — now 25 commits ahead of `origin/main`. Push when ready.
- **Stale GitNexus index** — `af98d62` sentinel warned across session.
  Run `npx gitnexus analyze` to refresh.
- **Audit worktree fully drained** — all 4 fixes reapplied to main.
  The branch `audit/codebase-fixes-2026-05-13` in
  `/Users/seanburdges/Dev/Lariat-worktrees/` is now obsolete; remove
  when convenient.
- **Uncommitted on main** — `data/normalized/compliance_rules.jsonl`
  (regenerated; project says do not hand-edit), `.vscode/tasks.json`
  (untracked IDE config), `design/` (zips + dirs from the LaRi
  Whole-Design Remix; `ed05b13` already synced the canonical output
  into `public/`).

## Next wave — T7c, T8b

Each remaining task is M+ effort. Recommended order:

1. **T7c — Receiving-side sync appliers.** Family-1 (HACCP append-
   only, INSERT OR IGNORE on op_id) first — the bulk of regulated
   tables, narrowest conflict policy. Family-2 (financial DELETE+
   INSERT envelopes) second. Family-3 (LWW live state) last; v1
   single-KM workflow doesn't actually exercise it.
2. **T8b — Cloud-bridge HMAC in settings.ts + /management toggle.**
   Pure plumbing (lib/cloudBridge* already prefers opts.secret over
   env). Sequence after T7c so the desktop wrapper work happens in
   one wave.

Both tasks are documented in `tasks.yaml` with paths_touched +
acceptance_tests, ready for `/team-run` dispatch.
