---
title: "Workspace merge + web/native project-completion unification"
date: 2026-08-06
status: approved — design agreed, implementation not started
canonical_id: lariat-workspace-and-status-unification
taxonomy: docs/NATIVE_RELEASES_AND_TAXONOMY.md
---

# Workspace merge + web/native project-completion unification

## Problem

Two things about Lariat are split that should not be.

**1. Two VSCode workspace files open the same canonical repo, and neither is a superset.**

| File | Folders |
|---|---|
| `~/Dev/workspaces/lariat.code-workspace` | Lariat · hubs · 4 `workspace-scaffold/*` shared folders |
| `~/Dev/workspaces/lariat-native.code-workspace` | Lariat · LariatNative · Lariat-KDS · lariat-data-sources · hubs |

Only the native file carries the `swift build` / `swift test` / `package-app` / KDS / web-typecheck
tasks and the `LariatApp` launch configs. Only the web file carries the shared scaffold folders and
`typescript.tsdk` / `python.analysis.extraPaths`. A session in either one is missing half the tooling,
so which workspace was opened silently changes what the session can do.

**2. Completion state is scattered across six documents, all stale, with no cross-cutting frame.**

| Doc | Last touched | Tracks |
|---|---|---|
| `docs/PROJECT_ROADMAP.md` | 2026-07-16 | web lanes, append-only dated sections |
| `docs/NATIVE_RELEASES_AND_TAXONOMY.md` | 2026-07-11 | releases 0.1/0.2/1.0, milestones A–E |
| `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md` | 2026-07-22 | native surface map |
| `docs/ROLLING_REVIEW_LEDGER.md` | 2026-07-15 | web freeze reviews only |
| `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md` | 2026-07 | L1 wave status |
| `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md` | 2026-07 | endgame A–E |

Roughly 60 PRs merged between 2026-07-15 and 2026-08-05 (through #606). No document puts web and
native in one frame, so "where is the project" has no answer that does not require reading six files
and reconciling them by hand.

**Non-problem — already resolved, recorded here so it is not re-investigated.** The repos are already
one: `LariatNative/` is a SwiftPM package *inside* the canonical Lariat repo, and all native docs live
in `Lariat/docs/`. There is no repo merge to perform. `Lariat-KDS` stays a separate repo by decision
(see Out of scope).

## Prior art — PR #605 (open)

`docs(native): Native 1.0 gap execution plans + Front 0 kickoff`, authored 2026-08-05 by a Cursor
background agent, **already performs the native half of this work**. It refreshes the taxonomy, agent
guide, L1 status and endgame DoD, and adds `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md`
— twelve execution fronts (0, 1–5, P1–P6) plus an "Already done — do not re-open" evidence table.

This design **complements and does not duplicate** #605. Rebuilding the native audit would be the
redundant-parallel-work failure that `~/Dev/CLAUDE.md` ("Concurrency / Multi-Session") warns against.

What #605 does not cover, and this design does:

- It is native-framed. Web appears only where web blocks native (P4 master catalog, P5 `/v2` Stage 1 pilot).
- The four web status docs are untouched and stay stale: `PROJECT_ROADMAP.md` (2026-07-16),
  `ROLLING_REVIEW_LEDGER.md` (2026-07-15), `V2_CUTOVER_PLAN.md` and `INTEGRATION_AUDIT.md` (both 2026-07-05).
- These merged web programs appear in no status document at all:
  - **Commercial v1 phase 0** (#584) — an entire program with no status entry anywhere
  - **BOH ops packet** (#573, #574, #576, #578, #593)
  - **Costing recovery chain** (#594–#599, #604)
  - **Hermetic-DB CI** (#600, #601, #603)
  - **Temp-PIN scope closure** (#586, #587)
  - **Native no-PIN / unconfigured-install lane** (#606 merged; #607, #609 open)
- Nothing puts the two halves side by side.

## Goals

1. One workspace file that can do everything either file could do.
2. One document that answers "what is done, what is not, and what is the evidence" across web *and* native.
3. Every completion claim carries evidence and a confidence tag, so a stale claim is visible as stale.
4. Every existing status doc keeps one clear job and points at the right place for the rest.

## Non-goals

- Rebuilding or relitigating #605's native audit.
- Running verification gates (`npm run verify`, `swift test`). Deliberately excluded — see Evidence rules.
- Changing any code, schema, test, or protected surface. This is workspace config plus documentation.

## Out of scope

- **Merging `~/Dev/Lariat-KDS` into the Lariat repo.** Considered and rejected: it would touch git
  history and CI for two repos for no benefit the workspace merge does not already deliver.
- **Consolidating the duplicate Claude memory directories.** `~/.claude/projects/-Users-seanburdges-Dev-Lariat`
  holds 33 memory files from the pre-move path. Real, but a separate concern from project completions.
- **Retiring `~/Dev/hosp-agent-workspace/workspaces/lariat.code-workspace`**, a third copy under a
  different tree. Not opened by this session; leave it alone.

---

## Design

### Part 1 — Workspace merge

Produce a single `~/Dev/workspaces/lariat.code-workspace` holding the union of both files, and delete
`~/Dev/workspaces/lariat-native.code-workspace`.

**Folders** (all ten verified to resolve from `~/Dev/workspaces/` on 2026-08-06):

| Name | Path |
|---|---|
| Lariat (app) | `../hospitality/Lariat` |
| LariatNative SwiftPM | `../hospitality/Lariat/LariatNative` |
| Lariat-KDS Companion | `../Lariat-KDS` |
| Lariat Data Sources (read/ingest) | `../lariat-data-sources` |
| hubs (routing) | `../docs/hubs` |
| docs (shared) | `../workspace-scaffold/docs` |
| scripts (shared) | `../workspace-scaffold/scripts` |
| agents (shared) | `../workspace-scaffold/agents` |
| hooks (shared) | `../workspace-scaffold/hooks` |
| skills (shared) | `../workspace-scaffold/skills` |

**Settings** — union, with the stricter value winning on any conflict:

- Keep from the web file: `typescript.tsdk`, `python.analysis.extraPaths`, `eslint.workingDirectories`.
- Keep from the native file: the `data/lariat.db*` exclude and the `lariat-data-sources/**` binary-file
  excludes (`*.pdf`, `*.docx`, `*.xlsx`, `*.xlsm`, `*.xls`, `*.jpeg`, `*.png`). These are strictly better
  and prevent the editor indexing PII binaries.
- Keep from both: `workbench.task.allowAutomaticTasks`, `search.followSymlinks: false`, `swift.path`,
  `json.schemaDownload.enable`, and the union of all `files.watcherExclude` / `search.exclude` globs
  (`node_modules`, `.build`, `.swiftpm`, `build`, `dist`, `.next`, `.turbo`, `.venv`, `venv`,
  `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `worktrees`, `cad-kernel/build*`,
  `Package.resolved`, `package-lock.json`).

**Tasks** — all six from the native file, unchanged: `LariatNative: swift test` (default test),
`LariatNative: swift build`, `LariatNative: package app`, `Lariat-KDS: swift test`,
`Lariat web edge: typecheck`, `Lariat web edge: build`.

**Launch** — both `LariatApp` configs (Debug, Release) from the native file.

**Extensions** — union: `swiftlang.swift-vscode`, `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`,
`ms-python.python`, `ms-python.vscode-pylance`, `charliermarsh.ruff`, `editorconfig.editorconfig`.

**Two consequences to accept explicitly:**

1. `lariat-data-sources` (real business data, PII) becomes part of the default workspace rather than
   only the native one. No new exposure — the native workspace already loaded it — but it is now always
   present. The binary excludes above are the mitigation; the read/ingest-only rule is unchanged.
2. Both workspace files are **tracked in the `~/Dev` container repo** (remote `sburdges-eng/Dev`).
   `~/Dev/CLAUDE.md` treats that repo as a container, not a normal push target. **Decision: make the
   edit and leave it as a working-tree change in `~/Dev`; do not commit or push there.** Sean decides
   separately whether the container repo gets a commit.

### Part 2 — Status architecture

Add one new document, `docs/PROJECT_STATUS.md`. It is the only cross-cutting sheet and is deliberately
thin — it frames and delegates, it does not restate.

Structure:

1. **Header** — as-of date, as-of `origin/main` SHA, and the standing caveat that this repo's commit
   messages can be aspirational, so code wins over this document (`CLAUDE.md` §7).
2. **One status table** — columns `Lane | Half | State | Evidence | Confidence`, where `Half` is
   `web` / `native` / `shared`.
3. **Blockers**, split into two lists: **owner-decision** (needs Sean: GUI smoke, service-day shutoff,
   notarization identity, per-piece `per_count` calls) and **code-work** (an agent can do it).
4. **Do not re-open** — a link to #605's evidence table, not a copy of it.
5. **Ownership map** — which document owns which detail, so the next reader routes correctly on the
   first try.

Each existing document keeps exactly one job and gains a one-line header pointer:

| Document | Role after this change |
|---|---|
| `NATIVE_RELEASES_AND_TAXONOMY.md` | Binding glossary **only** — releases, milestones A–E, L1 wave names. Status content moves out; it churns weekly and this file is cited as stable. |
| `2026-08-05-native-1-0-gap-execution-index.md` (#605) | Native execution SSOT — the twelve fronts. |
| `LARIAT_NATIVE_FINAL_AGENT_GUIDE.md` | Native surface map and container inventory. |
| `PROJECT_ROADMAP.md` | Historical append-only log. Header points at `PROJECT_STATUS.md` for current state. |
| `ROLLING_REVIEW_LEDGER.md` | Web freeze-review record — role unchanged, refreshed for sections reviewed since 2026-07-15. |
| `V2_CUTOVER_PLAN.md`, `INTEGRATION_AUDIT.md` | Refreshed, or marked superseded. Decided during the audit, from evidence, not assumed now. |

The programs listed under "Prior art" as appearing in no document each get a row in the status table.

### Part 3 — Evidence rules

Per the agreed evidence-tagged reconcile depth:

- **Evidence column** is a PR number, a `file:line`, or a test file path. A commit message alone is never
  sufficient evidence (`CLAUDE.md` §7; `ed0b32e` is the worked example of an aspirational message).
- **Confidence tags:**
  - `HIGH` — grep-confirmed symbol/table/test on `origin/main`, or a PR diff read directly.
  - `MED` — a single documentary or PR-title source, not cross-checked.
  - `LOW` — memory file only. Flagged for Sean rather than asserted.
- **Spot-verification** is targeted, not universal. Grep only where a row is *complete-but-gated*, or
  where two sources disagree. Always grep `origin/main` — local `main` is at `086cf04` against origin
  `7e9627f`, roughly twenty PRs stale, and "lane complete" claims checked against local `main` have been
  wrong before.
- **No gate runs.** `npm run verify` and `swift test` are out of scope by the agreed depth. If a row
  cannot be settled without a gate, it is tagged `MED` and named as needing one, rather than guessed.
- Memory files are treated as point-in-time. Any file, flag, or function they name is re-checked against
  current code before it becomes a `HIGH` row.

## Sequencing

`PROJECT_STATUS.md` links files that exist only on #605's branch, so it lands **after #605 merges**.

1. Merge the workspace file; delete the native one. Independent of #605, can go first.
2. Run the evidence audit; write findings to the session scratchpad, not the repo.
3. Wait for #605 to merge.
4. Write `PROJECT_STATUS.md` plus the header pointers and the web-doc refreshes.
5. Branch, PR. Never push to `main`.

Step 4 touches none of #605's files, so the two do not conflict even if #605 is updated meanwhile.

## Risks

| Risk | Mitigation |
|---|---|
| #605 is revised or closed, invalidating links | Step 3 gates on merge. If #605 closes instead, native rows fall back to `MED` and the native audit becomes in-scope — a re-decision, not a silent expansion. |
| `PROJECT_STATUS.md` becomes the seventh stale doc | It is thin by construction: a frame plus links. The as-of SHA in the header makes staleness self-evident on read. |
| Another session edits the same status docs concurrently | `git fetch` and re-check `origin/main` immediately before writing (§3). |
| Audit drifts into fixing what it finds | Findings are recorded as rows and recommendations. No code changes in this work. |

## Success criteria

1. Opening `lariat.code-workspace` gives all ten folders, all six tasks, and both launch configs;
   `lariat-native.code-workspace` no longer exists.
2. `docs/PROJECT_STATUS.md` answers "what is done across web and native" in one read.
3. Every row in it has an evidence reference and a confidence tag; no row cites only a commit message.
4. All six programs listed under "Prior art" as undocumented have a row.
5. Every one of the six pre-existing status docs has one stated job and a header pointer.
6. No code, schema, test, or protected surface changed.
