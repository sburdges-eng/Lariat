# Phase 1 — Recap

**Branch:** `feature/phase1-depletion-exceptions` → PR #58 against `feature/in-flight-batch-2026-04-28`
**Commits:** 8 (Cursor Agent contributed 1 review-fix commit; the rest are Claude)
**Status:** every Phase 1 acceptance criterion in [the plan](../../.claude/plans/you-are-analyzing-an-iterative-parnas.md) is now ✅.

## Commit chain (oldest → newest)

| SHA | Title | What |
|---|---|---|
| `917a291` | `feat(costing): depletion-exception + pack-size triage queues` | New `/costing/depletion-exceptions` and `/costing/pack-changes` queues (PIN-gated). Idempotent acknowledge on pack-size with management-action audit. Dashboard tile + nav registry. 41 tests. |
| `2bd44a9` | `data(beo): replace 4 STUB recipes with USDA-sourced + composite templates` | Gazpacho + Chilled Corn Leek from USDA MyPlate. Italian Dinner + Mexican Dinner wired to existing in-house sub-recipes. Per-row `SOURCE:` provenance. |
| `7be1f69` | `data(beo): close last STUB + add USDA sides + house tomato_confit` | Beef tenderloin crostini (house). Spanish rice + refried black beans (USDA). Tomato confit (chef spec: 6"×1/3 pan + 1 sprig thyme + 100g garlic + EVOO to cover). BEO_TODO Open list: 5 → 0. |
| `ebe34d5` | `feat(recipes): CSV→bom_lines sync script + chef sign-off on Phase 1 stubs` | `scripts/sync-normalized-to-bom.mjs` upserts `entities_recipes` + DELETE+INSERTs `bom_lines` from CSVs. Idempotent. Sub-recipe link auto-detection. `chef_approved 2026-04-28 sburdges` stamps. 12 new tests. |
| `a324701` | `feat(jobs): cron-fired job runner with file-lock + ingest_runs reporting` | `lib/jobLock.ts` (POSIX O_EXCL atomic + dead-PID + stale-mtime reclaim). `scripts/run-job.mjs` (CLI wrapper, 4 exit codes, ingest_runs row + JSONL failure log). 22 new tests. |
| `737e469` | `feat(compliance,cron): seed CO compliance JSONL + cron-wrapper + installer` | 46-row `data/normalized/compliance_rules.jsonl` (12 labor, 7 liquor, 5 boundary, 22 ops). `scripts/cron-wrapper.sh` (PATH-safe). `scripts/install-cron.sh` (idempotent installer with begin/end markers). |
| `0587242` | `fix(costing): address triage queue review findings` (Cursor Agent) | Tightens depletion-exception limit handling (apply after filter, not before). Adds `getPackChangeById` + transactional ack to prevent orphan audit rows. `refreshRecipeFields` so sync picks up recipe_index metadata changes. |
| `3551f98` | `feat(compliance): in-tree FTS5 search + KA grounding for CO compliance rules` | `scripts/build-compliance-index.mjs` builds `data/cache/compliance.db` (FTS5). `lib/complianceSearch.ts` exposes `searchCompliance` + `renderCompliance`. KA `COMPLIANCE_KEYWORDS` gate folds the top 3 matches into grounded context. 18 new tests. |

## What's now possible that wasn't before

### For the operator
- **Depletion exception triage.** When auto-depletion runs and a Toast item doesn't map to `dish_components`, the dish surfaces in `/costing/depletion-exceptions` ranked by net-sales impact. A click-through from the `/costing` dashboard. No more silent under-/over-depletion.
- **Pack-size change acknowledgement.** Vendor pack-size flips detected during costing ingest land in `/costing/pack-changes` with a one-click acknowledge button. The acknowledge writes a management-action audit row through `lib/auditLog.mjs`.
- **Always-on compliance grounding.** Manager-level questions to the Kitchen Assistant ("how does HFWA paid sick leave work?", "can a bouncer detain a patron?") return the relevant CO labor / liquor / security rule with citation + verification status. Works even when the off-tree Data Pack SSD isn't mounted.
- **One-command cron install.** `bash scripts/install-cron.sh` paste-installs a 7-job schedule (ingest-costing, ingest-toast, ingest-shows, sync-normalized, ingest-analytics, rebuild-cache, backup). Idempotent; preserves any non-Lariat cron entries via `# LARIAT_CRON_BEGIN`/`END` markers. `crontab -l` to verify, `tail -f /tmp/lariat-cron.log` to watch.

### For the developer
- **Concurrent-run safety on cron jobs.** `lib/jobLock.ts` is a POSIX `O_EXCL` file lock with two reclamation paths (dead PID, stale mtime). Every cron-fired job goes through `scripts/run-job.mjs`, which locks → opens an `ingest_runs` row with `kind='job:<name>'` → spawns the command → updates the row to `ok`/`failed` → releases the lock. Lock-held returns POSIX exit 75 so cron's MAILTO can filter it.
- **CSV → DB sync as a first-class pipeline step.** `npm run sync:normalized` UPSERTs `entities_recipes` + DELETE+INSERTs `bom_lines` from `recipes/normalized/*.csv`. Sub-recipe links auto-detected by slug match. The workbook ingest is no longer the only path to populate `bom_lines`.
- **Compliance corpus authoring loop.** Edit `data/normalized/compliance_rules.jsonl` → run `npm run compliance:build` (idempotent on jsonl_sha) → KA picks up changes on next request. No off-tree pipeline to coordinate. Schema is the §4 unified shape from `docs/data_sources/colorado_law_liquor_security_dataset_plan.md`.
- **PR review pattern that survived a merge race.** Cursor Agent landed two review-fix commits on the PR mid-stream; the later compliance commit rebased cleanly because work was scoped to disjoint files. The `data/audit/` JSONL is the only cross-cutting artifact and is gitignored.

## Numbers

| Metric | Value |
|---|---|
| New TS/JS modules | 8 |
| New tests | 96 (passes 100%) |
| Existing tests still green | yes (40 Jest, 258 HACCP rules) |
| Recipes in `recipe_index.csv` | 73 (was 69) |
| `entities_recipes` rows in DB | 73 (was 47) |
| `bom_lines` rows in DB | 457 (was 302) |
| BEO_TODO Open items | 0 (was 5) |
| Compliance JSONL rows | 46 |
| Compliance domains covered | 4 (labor, liquor, security boundaries, security ops) |
| Cron jobs scheduled | 7 |

## Files changed (top-level)

### New
- `lib/depletionExceptions.ts`
- `lib/packChangesRepo.ts`
- `lib/jobLock.ts`
- `lib/complianceSearch.ts`
- `app/api/costing/depletion-exceptions/route.js`
- `app/api/costing/pack-changes/route.js`
- `app/costing/depletion-exceptions/page.jsx`
- `app/costing/pack-changes/page.jsx` + `AckButton.jsx`
- `scripts/sync-normalized-to-bom.mjs`
- `scripts/run-job.mjs`
- `scripts/cron-wrapper.sh`
- `scripts/install-cron.sh`
- `scripts/build-compliance-index.mjs`
- `data/normalized/compliance_rules.jsonl` + README
- `data/cache/compliance.db` (built artifact, gitignored? — currently committed for zero-config dev)
- `data/scheduled-jobs.json`
- `examples/lariat.crontab`
- `docs/JOBS.md`
- 4 new recipe CSVs: `beef_tenderloin_crostini`, `spanish_rice`, `refried_black_beans`, `tomato_confit`
- 8 new test files

### Modified
- `app/_components/navRegistry.js` — added depletion-exceptions + pack-changes palette entries
- `app/costing/page.jsx` — triage-link row, click-through pack-size badge
- `lib/kitchenAssistantContext.ts` — `COMPLIANCE_KEYWORDS` gate + `renderCompliance` block
- `lib/db.ts` — (no schema changes this phase; existing tables sufficient)
- `package.json` — `sync:normalized`, `sync:normalized:dry`, `compliance:build`, `compliance:build:force`, `job`, `job:list`, `job:status`
- `recipes/recipe_index.csv` + 4 STUB CSVs
- `menus/BEO_TODO.md` — Open list emptied; 4 new "Pending chef review" entries; 4 new "Resolved 2026-04-28" entries

## What carries forward

- The cron + lockfile + ingest_runs reporting shape is the foundation Phase 2 will reuse for any new background work (settlement publish, DICE ingest, outbound Toast 86 sync).
- The compliance grounding pattern (`render*` returning `{text, source}`) is the template for new KA grounding sources — Phase 2 event-ops will likely add `renderShowSettlement` and `renderStagePlot`.
- The CSV → DB sync pattern (declarative file → idempotent UPSERT + full-refresh-per-recipe) generalizes; Phase 4 procurement will use the same shape for vendor catalog sync.
- The sign-off provenance pattern (`SOURCE: <origin>` + `chef_approved <date> <user>` per row) is reusable for any data corpus that needs durable approval audit.

## What's still open

| Item | Notes |
|---|---|
| Workbook ingest of new `bom_lines` rows | The 4 USDA-sourced + 4 in-house recipes are now in the DB via the sync script; `npm run ingest:costing` (against the workbook in `~/Dev/_archives/`) is still authoritative for vendor pricing fields, which sync deliberately leaves NULL. |
| Verify `unverified` compliance rows | Each legal-rule row in `compliance_rules.jsonl` cites the source statute but the language has not been read against current text. Re-verification flips `verification.status` to `verified` with a `last_verified` date. |
| Compliance JSONL semantic search | The current FTS5 index is BM25 only. A future pass can add BGE embeddings into a vectors.npy (same shape as the off-tree Data Pack) for queries that miss on lexical match. |
| Five-file-shape audit | All 11 HACCP regulated concepts have the structure per `npm run test:rules` (258 passing across 37 suites) — but a full sweep of the `app/food-safety/*` tree against the convention hasn't been formalized. |

Phase 2 launch: see [PHASE2_PLAN.md](PHASE2_PLAN.md).
