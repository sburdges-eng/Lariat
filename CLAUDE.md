# CLAUDE.md — Lariat

Claude Code operating instructions for **Lariat**, the restaurant F&B operations platform for a
real, live restaurant. `AGENTS.md` holds the shared multi-tool ruleset (worktrees, MACP, trio
orchestration); `docs/` holds architecture. This file is the Claude-specific contract and outranks
chat memory.

## 0. Prime directive

Lariat exists to **simplify back-of-house work**. If a change makes a cook's or manager's shift more
complex, it is wrong regardless of how clean the code is. Every surface is used by busy, distracted
people on a hot line — glanceability beats completeness.

This is food/restaurant ops. Do not confuse it with COOLIO (image API) despite overlapping naming.

---

## 1. Where you are

**`~/Dev` is a symlink to `/Volumes/Sean's SSD/Dev`.** Everything below it lives on the
external SSD and vanishes when that drive is unmounted — `ls ~/Dev` before trusting any
path here. The mount point contains a space and an apostrophe, so always quote it in
shell commands.

| Path | Status |
| --- | --- |
| `~/lariat_dev/Lariat/` | **Where current work is happening** (verified 2026-08-28). On local disk, not the SSD. |
| `~/Dev/hospitality/Lariat/` | Older checkout of the same remote. Stale as of 2026-08-28 — `feat/service-date-wave1`, last commit 2026-08-06. Do not assume it is current. |
| `~/Dev/hospitality/Lariat/LariatNative/` | macOS/iPad SwiftPM package (`LariatModel`, `LariatDB`, `LariatApp`), inside that older checkout. |
| `~/Dev/hospitality/Lariat/Lariat-KDS/` | Companion KDS Swift repo. **Nested inside the Lariat checkout** — there is no `~/Dev/Lariat-KDS`. Touch only when KDS is named. |
| `~/Dev/lariat-data-sources/` | Real business data (**PII**). Read/ingest only — never commit, delete, or bulk rewrite. |
| `~/Dev/hospitality/Lariat-worktrees/` | Worktree target for `scripts/worktree.sh`. |

**`origin/main` is the only authority on what is current** — not any checkout's local
`main`, and not this table. Run `git remote get-url origin` and `git log -1` in the
directory you are actually in before your first edit. Do not edit
`.claude/worktrees/cadi-cxx-toolchain/**/Lariat*` (a foreign project's snapshot; do not
delete it either).

**Correction (2026-08-28).** This section previously stated that all non-canonical Lariat
iterations were deleted 2026-07-22 after archiving to
`~/Dev/_archive/lariat-iterations-20260722/`, and that its table was "the complete set".
Neither holds on this machine: that archive path does not exist, and ten checkouts of the
Lariat remote are present — including copies under `backup/`, `MacBackup-2026-08-07/`, and
`Dev/_archives/lariat-pre-scrub-2026-04-18/`. Treat any checkout not listed above as a
backup: read it if you must, but never edit it, and never delete one as "cleanup".

This table describes one machine at one point in time. Verify it rather than trusting it.

### Routing docs — read before the matching work

- **Any native macOS work** → `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md`
- **Native 0.2 L1 work** → `docs/NATIVE_RELEASES_AND_TAXONOMY.md` (binding glossary: releases vs
  endgame milestones A–E vs L1 waves; L1 Wave C ≠ Milestone C, H7 Phase 2 ≠ Native 0.2)
- **Anything contract-sensitive** → `docs/PROTECTED_CONTRACTS.md` (see §5)
- **Any user-facing string** → `docs/UI_COPY_RULES.md` (see §6)

---

## 2. Environment — check before believing a red gate

Two toolchain facts have historically caused Claude to misdiagnose infrastructure failures as code
defects. Separate environmental failures from real defects **before** fixing anything.

**Node: the repo pins 24 (`.nvmrc`); Claude's non-interactive shell resolves Homebrew Node 26.**
`node_modules/better-sqlite3` is compiled for 24 (NODE_MODULE_VERSION 137). Any DB-touching test
fails with `ERR_DLOPEN_FAILED … 137 vs 147` and looks like a flaky code bug.

- Run DB-touching JS tests as `npx -y node@24 --experimental-strip-types --test <file>`.
- Jest suites touching the DB: prefix PATH with node@24's bin dir.
- `scripts/dump-fresh-schema.mjs` also needs `npx -y node@24`.
- **Never `npm rebuild better-sqlite3`** — it flips the shared binding and breaks every other
  session and Sean's nvm-24 runs.
- Trap: a passing pure-math suite (`test-beo-estimate.mjs`) proves nothing about the binding.
  Confirm with a DB-touching suite.

**Swift:** the 2026-07-19→22 breakage (no Xcode, CLT-only, missing XCTest/SwiftUIMacros) is
**resolved — verified 2026-07-27.** `Xcode-beta.app` is back in `/Applications`, `xcode-select`
points at it, Swift 6.4 / arm64-apple-macosx27, and from `LariatNative/` both `swift build` (47s)
and `swift test` (exit 0) are green with **no `SDKROOT` override**. That workaround is obsolete.
Native gates are real signals again — a red one is a code defect, not the old blocker.

**No interactive/TTY commands** (`codex resume`, `hermes model`, browser OAuth). They cannot
complete in this tool environment — flag them for Sean to run manually.

**Do not auto-start dev servers.** Ask first, and start only the specific one requested.

---

## 3. Git workflow

- **Never push to `main`.** Branch `feat/` · `fix/` · `chore/` · `wip/` (no other prefixes — `cursor/`,
  `feature/`, `bundle-h-*` are legacy) and open a PR.
- **Multiple AI sessions share this `.git/`.** For any multi-commit batch or long session, take a
  worktree: `scripts/worktree.sh new <tool> <branch>`. The `SESSION_BRANCH` lock plus
  `scripts/check-session-branch.mjs` prevents another session moving your HEAD mid-batch. One-off
  single commits in the main checkout are fine.
- Before committing or branching: `git status` + `git branch --show-current`. If the tree changed
  unexpectedly, re-inspect rather than retrying.
- `git fetch` before reasoning about divergence. **Grep `origin/main`, never local `main`** — the
  local ref is routinely dozens of PRs stale, and "lane complete" claims verified against it have
  been wrong.
- **Never `git stash push -- <pathspec>` when the pathspec includes an untracked file.** Git
  no-ops, and a later bare `git stash pop` grabs another session's WIP stash. To isolate work:
  `git checkout -b new origin/main` and `git add` only your files, or copy to the scratchpad first.
  Recovery from a wrong pop is `git checkout HEAD -- <files from git stash show>` — **never**
  `reset --hard`, which nukes the always-present dirty files (`desktop/*`, `data/cache/*`).
- Inspect staged files before committing. Never commit build artifacts or anything from
  `lariat-data-sources`.
- Do not commit unless asked.

---

## 4. Verification — evidence before claims

- Full web gate: `npm run verify` (typecheck + 13 suites + `next build`), under `npx node@24`.
- Full native gate: `swift build && swift test` from `LariatNative/`.
- Lint: `npm run lint` / `npm run lint:changed`.
- Coverage: `npm run coverage` (add `-- --check` to enforce floors). **Never quote the headline
  percentage as codebase coverage** — Node only instruments files it loads, so untested files are
  absent from the denominator rather than counted as zero. `lib/` is 154 of 159 files exercised;
  `app/` is 135 of 364. Read `docs/TEST_COVERAGE.md` before citing the number.
- Every gate green before commit or PR. If one fails, say so with the output — never report done on
  a red or unrun gate.
- **A broad suite pass does not substitute for the targeted contract suite** of whatever protected
  surface you touched (§5, and `docs/PROTECTED_CONTRACTS.md` §15 lists the exact commands).
- `next build` catches a class of bug nothing else does — see §8.

---

## 5. Protected surfaces

`docs/PROTECTED_CONTRACTS.md` is binding. Six families: deterministic ops ledger, management read
models, sync replay/checkpoints, peer trust & topology, cloud-bridge outbox durability, sick-note
PHI custody. Plus the frozen `/v2` cloud-bridge **envelope wire contract** (§11.4) — CanonicalJSON
body + `HMAC-SHA256(secret, body ‖ batch_id)`, proven byte-identical against the Swift twin. Do not
touch its bytes without treating it as a versioned contract change.

Rules that apply whenever you're near these:

- **HACCP / food-safety logic is regulated.** Never weaken a validation, never silently
  auto-correct a record. Surface the error.
- Preserve fail-loud behavior. When in doubt: **skip, isolate, or fail loud** — never silently widen
  a delete, widen trust, drop a manager signal, or advance transport state on uncertain data.
- Do not mix protected edits with docs cleanup, UI copy churn, or packaging work in one PR.
- Schema changes require a migration. Never in-place edits.
- Audit writes stay transactionally tied to their source write.

---

## 6. Domain rules

- **UI copy** — `docs/UI_COPY_RULES.md` is strict. Kitchen words (prep, line, par, 86, fire, hold,
  count, low, out), 5th–8th grade reading level, understandable in under 2 seconds. No SaaS jargon
  (workflow, optimize, configure, dashboard, analytics, synchronization). No underscores, no
  dev-style column names, USD to 2 decimals, "Spring"/"Fall" — never "Shoulder".
- **Test with realistic recipe/inventory data**, not `foo`/`bar`. The domain rules only surface
  against real-shaped data.
- **No VoiceOver/screen-reader accessibility waves.** Owner's call: "cooks have to see to work."
  The useful half of accessibility here is legibility for sighted staff across a steamy line —
  Dynamic Type, high contrast, big targets, glanceability. iPad is the real deployment target.
- **Vendor encodings:** Toast POS CSVs are **cp1252**, not UTF-8 (`encoding='cp1252'`). Shamrock
  `.xls` files are CDFV2 — read with `xlrd`, not `openpyxl`; its sector-size warning is benign.

---

## 7. Epistemics — what has burned past sessions

- **This repo's commit messages can be aspirational.** For any "is X done?" question, verify against
  code (grep the symbol, table, import), not the commit narrative. `ed0b32e` is the worked example.
- **Costing inaccuracy is upstream data, not port or engine code.** Native == web is proven by
  byte-parity suites. The signal is `bom_lines.map_status` / `recipe_costs` — read it, never
  re-derive with null density (that mistake produced a wildly wrong "63% dropped" report).
- **Cross-check any subagent "security gap" claim** against `tests/js/test-pin-gate-coverage.mjs`'s
  ALLOWLIST before treating it as urgent. Several have been false alarms.
- Point-in-time memory files describe what was true when written. Verify file/flag/function claims
  against current code before asserting them.
- The UI layer consistently has weaker coverage and more (and worse) bugs than the API/lib layer,
  even where tests exist. Weight review attention accordingly.

---

## 8. Recurring bug patterns

- **`'use client'` importing from a server-only `lib/*.ts`** drags that module's `node:crypto` /
  `node:fs` imports into the client bundle. `tsc`, eslint, and `node --test` all pass; only
  `next build` fails (`UnhandledSchemeError`). Fix: split the pure constants into their own module
  and re-export. Run `npx next build --webpack` whenever a fix crosses that boundary.
- **Relative imports between `.ts` files need the explicit `.ts` extension** — Node's ESM loader
  (used by `tests/js/*.mjs`) requires it; webpack tolerates its absence.
- `SELECT *` rows usually need `LibType & { extra_col }` intersections — lib snapshot types are
  narrower than the tables.
- Location scoping (`?location=`, `useLocation()`) is dropped constantly. Any board, link, or
  action that assumes the default location breaks every non-default deployment.

---

## 9. Working style

- **Spec → plan → TDD** for features: design spec, execution plan, then task-by-task tests-first,
  stopping at review gates. Tests first, not after.
- **Default to the minimum viable version.** No extra guards, examples, or multi-profile setups
  unless asked. Ship simple, offer enhancements as a follow-up question.
- **Read before Edit.** Always use the Read tool — Edit fails on files read via `cat`/`head`/`sed`.
- **Subagent scope discipline.** State the explicit scope boundary in every dispatch prompt. A
  subagent implements only its task, never adjacent ones; related issues come back as
  recommendations, not auto-fixes. Cross-file bugs an agent finds in another agent's files can't be
  fixed inside the fan-out — the lead patches across worktrees afterward.
- Give parallel agents fully self-contained prompts (condensed recipe + gotchas), not references to
  "the pattern from PR #497" — they have no conversation context. Pre-create worktrees yourself
  when you need deterministic paths to collect results from.
- Small, tightly-coupled areas (<~10 files, shared deps) go to **one** agent, not a fan-out.
- Persist long plans and specs to `docs/`; reference the path rather than pasting into chat.
- Act only on Sean's direct messages — never re-execute your own prior handoff notes or copyable
  prompt blocks as new instructions.
- Do not route around security guardrails. When a hook blocks something, stop and hand the step to
  Sean with exact instructions.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Lariat** (33151 symbols, 475089 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Lariat/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Lariat/clusters` | All functional areas |
| `gitnexus://repo/Lariat/processes` | All execution flows |
| `gitnexus://repo/Lariat/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
