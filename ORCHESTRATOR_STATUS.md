# Orchestrator status — 2026-08-06

**Regenerated from repo state, not from memory.** The previous version of this file was dated
2026-05-14 and described the Phase 3.5 / Phase 4 waves as the current front. Since that date
`origin/main` has taken **1,187 commits across 339 merged PRs** — 790 of them in July alone —
none of which this file or `tasks.yaml` (which read `tasks: []`) knew about. Agents kept
re-deriving project state from scratch because the planning documents had frozen in spring
while the code moved. That drift is the reason `/v2` was filed as throwaway in one agent's
memory while it was in fact a live front.

Current `origin/main`: `597bae6`.

Where work actually lives now:

| Question | File |
|---|---|
| What is done across web and native? | `docs/PROJECT_STATUS.md` (lands in PR #611) |
| What is the next native front, and who gates it? | `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md` |
| What is queued for the orchestrator? | `tasks.yaml` |

---

## Queued wave — P3 BEO batch flooring

No orchestrator wave is in flight. `tasks.yaml` holds four queued tasks, all from front P3,
the only agent-executable ungated front in the gap index. Nothing has been dispatched.

| Task | Status | Worktree | Implementer | Reviewer | Tests | Notes |
|------|--------|----------|-------------|----------|-------|-------|
| P3-1 | queued | — | — | — | — | fixtures + Python oracle coverage; no deps |
| P3-2 | queued | — | — | — | — | port flooring into `BeoCascadeCompute`; needs P3-1 |
| P3-3 | queued | — | — | — | — | wire fixture exporter into CI; needs P3-1 |
| P3-4 | queued | — | — | — | — | native board parity; needs P3-2 |

P3-1 and P3-3 can run in parallel once P3-1 is green; `paths_touched` do not overlap.

## Open pull requests

| PR | Branch | Base | Note |
|----|--------|------|------|
| #614 | `chore/native-packaged-data-dir` | `main` | recovers the orphaned `07ee7c0`; gates Front 0 |

Everything else landed 2026-08-06: #605, #610, #607, #604, #611, #612, #613, #609 — eight PRs
in one pass. `origin/main` moved `7e9627f` → `e6cb9c9`.

### The stacked-PR CI gap — closed, kept as the worked example

`native-ci.yml` used to filter `pull_request:` to `branches: [main]`, so a PR based on another
branch never triggered the Swift gate at all. #609 was entirely Swift, stacked on #607, and
sat mergeable for days on a green check that had compiled none of its code.

#610 removed the filter and was landed **first** for that reason. #609 was then retargeted to
`main` and its branch refreshed, which triggered `swift build + test` for the first time in
its life: **pass, 3m8s**. It merged on real evidence.

Landing this chain bottom-up would have merged #609 on the phantom green. When a stacked PR's
checks look green, confirm *which* gates ran before trusting it.

## Worktrees

Nine live under `Lariat-worktrees/`. Eight are now fully merged and disposable; none holds
unpushed work any more.

| Worktree branch | Ahead of `origin/main` | Disposition |
|---|---|---|
| `chore/native-single-data-dir` | 1 | **recovered** — `07ee7c0` cherry-picked onto current main as PR #614. Safe to remove once #614 lands. |
| `feat/master-catalog-import` | 0 | merged (#604) — safe to remove |
| `chore/native-ci-stacked-prs` | 0 | merged (#610) — safe to remove |
| `fix/native-unconfigured-read-gate` | 0 | merged (#607) — safe to remove |
| `fix/shows-unconfigured-read-gate` | 0 | merged (#609) — safe to remove |
| `chore/pr605-b1-fix` | 0 | absorbed into #605 — safe to remove |
| `feat/apply-ingredient-maps` | 0 | merged — safe to remove |
| `feat/master-product-catalog` | 0 | merged — safe to remove |
| `feat/recipe-cost-coverage` | 0 | merged — safe to remove |

## Followups outstanding

- **Local `main` carries 2 commits that are not on the remote** — `086cf04` (cursor extension
  recommendations) and `8b651cc` (cad-kernel docs pointer). `git cherry origin/main main`
  returns `+` for both, so they are absent upstream under any SHA. `origin/main` has since
  been merged into local `main`, so it is 3 ahead / 0 behind. They still need a branch and a
  PR to reach the remote — `main` is never pushed directly.
- **Stale GitNexus index** — last indexed `1ea814d`. `npx gitnexus analyze` to refresh. This
  followup carried over from the 2026-05-14 version of this file and is still open.
- Owner-gated fronts are listed in `tasks.yaml`'s header comment and in `PROJECT_STATUS.md`;
  they are deliberately not queued here because no agent can close them.

The three "uncommitted on main" items and the "unpushed main — 28 commits ahead" note from
the 2026-05-14 version are closed; that tree state no longer exists.

---

## Closed waves — historical record

Preserved because the commit references are real and still resolvable. These describe
2026-05-13/14 and are **not** current state.

### Recipe-photo wave (closed 2026-05-13)

Manifest: prior `tasks.yaml` (5 tasks). All 5 merged between `c9b9a69` and `42deab5`.

| Task | Branch | Merge commit | Tests |
|------|--------|--------------|-------|
| T1 | orch/T1 @ 31304de | c9b9a69 | 13/13 |
| T2 | orch/T2 @ a9099fd | a852fc8 (via T3) | 8/8 |
| T3 | orch/T3 @ 547330d | a852fc8 | 8 API + 4 UI |
| T4 | orch/T4 @ afb19c5 | 319aa53 | 11/11 |
| T5 | orch/T5 @ b8ecff6 | 42deab5 | 6/6 |

### Phase 3.5 wave (2026-05-14) — complete

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| Phase 2B B3 — Settlement PDF | shipped | b1a39ec | 17/17 |
| T1 — line_check audit-row | shipped | 3f22201 | 19/19 (+3 new) |
| T2 — LARIAT_DATA_DIR JSON cache | shipped | c0df793 | 2/2 |
| T3 — .env hygiene | shipped | fbbeddb | (gitignore) |
| T4 — Ingredient-masters operator review UI | shipped | 45e4684 | 34/34 |
| T5 — Weekly settlement digest | shipped | 4758e27 | 10/10 |
| Audit §4 access-matrix refresh | shipped | 36c7246 | (docs) |
| T6 — Desktop first-run wizard | shipped (pre-existing) | — | (existing) |
| T7a — sync_feed schema + appendOp + replaySince | shipped | aedd10e | 22/22 |
| T7b — /api/peers/sync-since + Ed25519 auth | shipped | 6143758 | 24/24 |
| T7c — Receiving-side appliers + sync client | shipped | 82989af | 27/27 |
| T8 — Graceful drainer stop + launchd template | shipped | a09804f | 9/9 |
| T8b — cloud-bridge secret in settings | shipped | 8104a2b | 15/15 (6 new) |

### Phase 4 wave (2026-05-14 evening) — complete

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| #17 — Sync apply scheduler | shipped | f15de27 | 20/20 |
| #18 — Shared LARIAT_DATA_DIR resolver | shipped | ea2f8bd | 8/8 |
| #19 — Operator diagnostic CLI (sync-status) | shipped | 491aaf1 | 5/5 |

Of the four items that wave left pending, three have since shipped (apply scheduler,
cloud-bridge UI form, appendOp wiring). Family-3 LWW sync and the Ed25519 cloud-bridge
migration remain deferred and are tracked as P6.9 and gap-index follow-ups, not here.
