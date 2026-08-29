# Orchestrator status — 2026-08-29

**Regenerated from repo state, not from memory.** The previous version was dated
2026-08-06 and pinned itself to `origin/main` `597bae6`. Seventy-two commits have landed
since, and every table in it had gone stale: the queued P3 wave, the five-PR review
queue, the worktree list, and the followups.

That is the same failure the 2026-08-06 version was itself written to correct — a
planning document freezing while the code moves. It is written down twice now because
it has happened twice.

Current `origin/main`: `357a1be4` ("chore: finish remaining handoff work", #635).

Where work actually lives:

| Question | File |
|---|---|
| What is done across web and native? | `docs/PROJECT_STATUS.md` |
| What is the next native front, and who gates it? | `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md` |
| What is queued for the orchestrator? | `tasks.yaml` |
| Which surfaces are contract-protected? | `docs/PROTECTED_CONTRACTS.md` |

---

## No orchestrator wave is in flight

`tasks.yaml` still holds the four queued P3 tasks (BEO batch flooring). None has been
dispatched, and the gating described in its header still holds. Nothing in this session
touched them.

## Open pull requests

Seven, all opened 2026-08-29 from a gap audit of `357a1be4`. None is merged.

| PR | Branch | What it closes |
|----|--------|----------------|
| #636 | `fix/boh-sheet-bundle-leak` | Every manager-tier line-book sheet shipped into a client chunk that `/boh` loads with no PIN — Sysco account number, a named vendor rep, a named private-event customer — and `sw.js` cached it offline |
| #637 | `fix/assistant-haccp-writes` | The kitchen assistant stamped an out-of-range temperature `pass`, stored the validator's own complaint as the corrective action, filed a drift-band delivery as clean, left `scale_recipe` ungated, and reported success for actions it never matched |
| #638 | `fix/haccp-corrective-sources` | The printed HACCP plan counted cooling breaches in one section and reported "No corrective actions recorded" two sections below — it read 2 of the 6 tables that hold one |
| #639 | `chore/repo-truth-refresh` | This file, `docs/PROJECT_STATUS.md`, and the CLAUDE.md §2 Swift claim |
| #640 | `fix/location-scoping-regulated` | Manager PINs written where login never looks, allergen attestations pooled across venues, a date-mark discard with no cross-location guard |
| #641 | `fix/day-plan-gates-and-lateness` | A "Line checks still open" row that could never be closed, a late banner contradicting its own rows, named cleaning tasks bypassing the food-safety close gate |
| #642 | `fix/protected-contract-pins` | Three PROTECTED_CONTRACTS invariants asserted only in comments — the management-rollup "contract" test mirrored the page's SQL and the mirror had rotted; receiving's compute trigger and the sick-note key's backup exclusion were pinned by nothing |

**Ordering:** all seven are disjoint by file and can land in any order. #637, #638 and #641
change what a board shows mid-service — land them **between services**. #636 also needs a
between-services deploy because `sheetStorageKey` moves modules (the string is
unchanged, so ticks survive).

## Worktrees

Ten live under `Lariat-worktrees/`. Six are this session's, one per PR above, and are
disposable once their PR merges.

| Worktree | Branch | Disposition |
|---|---|---|
| `claude-service-date-native-parity` | `chore/repo-truth-refresh` | PR #639 — misnamed; it holds the docs branch |
| `claude-assistant-haccp-writes` | `fix/assistant-haccp-writes` | PR #637 |
| `claude-haccp-corrective-sources` | `fix/haccp-corrective-sources` | PR #638 |
| `claude-location-scoping-regulated` | `fix/location-scoping-regulated` | PR #640 |
| `claude-day-plan-gates-and-lateness` | `fix/day-plan-gates-and-lateness` | PR #641 |
| `claude-protected-contract-pins` | `fix/protected-contract-pins` | PR #642 |
| `cursor-service-date-seal` | `feat/service-date-seal` | another agent's, in progress — do not touch |
| `cursor-finish-remaining` | `chore/finish-remaining` | merged as #635 — safe to remove |
| `cursor-finish-session` | `fix/day-plan-idempotency-lateness` | behind `main`; its commits landed via other PRs — safe to remove |

The 2026-08-06 version listed nine worktrees, four merged and one "at risk" with an
unpushed commit. That tree state no longer exists: `chore/native-single-data-dir` landed
as #614.

## Multi-agent coordination

Two agents worked this repo on 2026-08-29. `scripts/agent-session.mjs list` is the live
view; check it before claiming files. The service-date migration's remaining steps —
native `ServiceDate` (spec step 8) and the regression sweep (step 9) — are claimed by
the `cursor` session and are deliberately **not** covered by the PRs above.

## Followups outstanding

- **`npm run verify` is not hermetic.** `version.json` is gitignored and generated;
  `.github/workflows/ci.yml` runs `npm run version:stamp` before the suites *because*
  `test-discover-route` asserts the stamped version. `verify` itself does not, so it
  passes only in a checkout that already has one and fails on a fresh clone. One line in
  `package.json` fixes it; left alone here because that file was claimed by another
  session.
- **Stale GitNexus index** — carried from the 2026-05-14 and 2026-08-06 versions of this
  file and still open. `npx gitnexus analyze` to refresh.
- **`swift test` cannot run on this machine.** CLT-only, no XCTest. `swift build` is a
  real local signal; the test gate is `native-ci` on `macos-26`. See CLAUDE.md §2.
- Owner-gated fronts are listed in `tasks.yaml`'s header and in `PROJECT_STATUS.md`.
  They are deliberately not queued here because no agent can close them.

## Keeping this honest

Refresh the SHA at the top whenever a table below it changes. If the SHA is more than a
few dozen commits behind `origin/main`, assume every table is wrong and regenerate rather
than patch — that is how both previous versions of this file died.
