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

## Scope

Lariat is used for **operations features only** (BEO/service day workflows). iPads, KDS, and
front-of-house surfaces are NOT in scope — do not include them in audits, readiness checklists, or
gap analyses unless explicitly asked.

---

## 1. Where you are

**Everything Lariat lives under `~/Lariat/` as of 2026-09-05.** Two halves:

| Path | What |
| --- | --- |
| `~/Lariat/Restaurant Operations/` | Alias to iCloud Drive → `Lariat/`. The restaurant's documents (forms, HR, BEOs, recipes, SOPs, vendors, sales). Not code. Syncs to Sean's phone/iPad. |
| `~/Lariat/Dev/` | Code, data, experiments. Local disk only — never in iCloud or Google Drive. |
| `~/Lariat/Dev/Lariat/` | **This repo — the canonical checkout. The live app (`npm run start`, :3000) runs from here.** |
| `~/Lariat/Dev/Lariat-worktrees/` | Worktree target for `scripts/worktree.sh` (derived from the main checkout's parent, not hardcoded). |
| `~/Lariat/Dev/lariat-data/` | The 36 GB reference data pack. `data/lariat-data` symlinks here; `.env.local` `LARIAT_DATA_ROOT` should point here too. |
| `~/Lariat/Dev/lariat-data-sources/` | Real business data (**PII**). Read/ingest only — never commit, delete, or bulk rewrite. |
| `~/Lariat/Dev/lariat-jvm/`, `lariat-ops-mcp-server/`, `experiments-*/` | Adjacent projects and one-offs. |
| `~/lariat_dev` | **Compatibility symlink → `~/Lariat/Dev`.** Kept so old paths in editors, hooks, and notes keep resolving. Do not write new references to it. |

**`~/Dev` no longer exists.** It was a symlink to `/Volumes/Sean's SSD/Dev`; the SSD failed in
Aug 2026 and is kept unplugged as a fallback. What was recovered from it (661 GB) is at
`~/Archive/SanDisk SSD Recovery 2026-08-24/` — read its `RECOVERY STATUS.md`. Every old
`~/Dev/hospitality/Lariat`, `~/Dev/Lariat`, `backup/Lariat` checkout referenced in older docs
is a **backup inside that archive**: read it if you must, never edit it, never delete one as
"cleanup" absent an explicit instruction from Sean. The four `lariat-pre-scrub-2026-04-18` copies
there are the only record of pre-scrub history (HEAD `b0c20f5` is on no branch and no remote) and
still carry the PII the scrub removed.

If `~/Lariat/Dev/Lariat` does not exist on the machine you are on, the 2026-09-05 move has not
been applied there — check `~/Lariat/START HERE.md` and `~/Lariat/Dev/_migration-2026-09-05/`
before assuming anything about paths.

**`origin/main` is the only authority on what is current** — not any checkout's local `main`,
and not this table. Run `git remote get-url origin` and `git log -1` in the directory you are
actually in before your first edit. Do not edit `.claude/worktrees/cadi-cxx-toolchain/**/Lariat*`
(a foreign project's snapshot; do not delete it either).

Other checkouts of this remote on this Mac, as of 2026-09-05: `.claude/worktrees/*` and
`~/Lariat/Dev/Lariat-worktrees/*` (session worktrees, disposable once their PRs merge), and the
archive copies above. Exactly one Lariat-KDS checkout exists, inside the archived
`Dev/hospitality/Lariat/Lariat-KDS`; every KDS commit is on `origin`.

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

**Swift: `swift build` works, `swift test` does not — re-verified 2026-08-29.** The
2026-07-19→22 breakage has **returned**. This paragraph previously read "resolved — verified
2026-07-27", with `Xcode-beta.app` back in `/Applications` and Swift 6.4 / arm64-apple-macosx27.
None of that holds on this machine now:

| Check | 2026-07-27 (as documented) | 2026-08-29 (measured) |
| --- | --- | --- |
| `ls -d /Applications/Xcode*.app` | `Xcode-beta.app` | **no match — no Xcode at all** |
| `xcode-select -p` | `/Applications/Xcode-beta.app/…` | `/Library/Developer/CommandLineTools` |
| `swift --version` | 6.4 / arm64-apple-macosx27 | 6.3.3 / arm64-apple-macosx26.0 |
| `$(xcode-select -p)/Platforms` | present | **does not exist** |
| `swift build` | green, 47s | **green, 91s** |
| `swift test` | exit 0 | **`error: no such module 'XCTest'` → `error: fatalError`** |

So from `LariatNative/`: **`swift build` is a real local signal — a red build is a code defect.**
`swift test` cannot run here at all; CLT-only has no XCTest. Do not report the native gate as
green off a local run, and do not chase `no such module 'XCTest'` as a code bug — it is this
machine, not the suite.

**The native test gate still exists — it just lives in CI.** `.github/workflows/native-ci.yml`
runs `swift test` on a `macos-26` runner, path-filtered to `LariatNative/**`, `tests/fixtures/**`
and `lib/db.ts`. It ran green on `357a1be4` (#635). To verify native changes, push the branch and
read `gh run list`; a local `swift build` plus CI is the honest evidence chain until Xcode is
reinstalled. Piping `swift test` through `tail` hides this — `$?` then reports `tail`'s exit
code, not the compiler's, which is how a broken toolchain can read as a pass.

**No interactive/TTY commands** (`codex resume`, `hermes model`, browser OAuth). They cannot
complete in this tool environment — flag them for Sean to run manually.

**Do not auto-start dev servers.** Ask first, and start only the specific one requested.

### Environment bootstrap

Required toolchain: Node 24 (see `.nvmrc`), gh, ripgrep, jq, and the repo venv
(`.venv/bin/python`, Python 3.13 — the gate uses the venv, not a PATH python). On a bare machine
run `npm run bootstrap` (= `scripts/bootstrap.sh`) before any gates: it is idempotent, installs
what it can via Homebrew, and exits non-zero listing every step that needs interactive input.
Note: `gh auth login` is interactive-only — stop and hand back to Sean rather than attempting it.

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

### Before opening a PR

1. Rebase/verify against the latest merged `main` — do not build or smoke-test from a stale branch.
2. Run the full verify gate and confirm exit code 0.
3. Self-review the diff for regressions in code you touched (sanitizers, cache-busters, barrel
   exports are frequent offenders).
4. Confirm any worktree/branch you reference actually exists before using it.

---

## 4. Verification — evidence before claims

- Full web gate: `npm run verify` — typecheck, lint, **30 test steps covering 378
  `tests/js` suites**, then `next build`, under `npx node@24`. (It said "13 suites";
  it has not been 13 for a long time.) It is **not hermetic**: `version.json` is
  gitignored and generated, and CI runs `npm run version:stamp` before the suites
  because `test-discover-route` asserts the stamped version. `verify` does not, so on
  a fresh checkout it fails there — run `npm run version:stamp` first.
- Full native gate: `swift build` from `LariatNative/`, plus the `native-ci` run on the
  pushed branch. **`swift test` cannot run on this machine** — CLT-only, no XCTest (§2).
  Never report the native gate green off a local run.
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

### Verifying gate/CI results

Never infer a gate's result from stdout. Always capture and check the exit code directly, e.g.
`npm run verify > /tmp/verify.log 2>&1; VERIFY_EXIT=$?; echo "exit=$VERIFY_EXIT"` and read
`$VERIFY_EXIT` — a trailing `echo` will mask a non-zero status. Re-read the log tail before
declaring green.

Prefer `npm run verify:gate` (= `scripts/verify.sh`): it forces Node 24 via npx, runs
`version:stamp` first (verify is not hermetic on a fresh checkout), prints `VERIFY_EXIT=` on its
own line, and exits with the gate's real status.

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

### Dates and timezones

This codebase pins service dates to America/Denver. Any test asserting on dates must construct
expectations in Denver time, never UTC or system-local. When a test fails only at certain hours,
suspect a UTC-vs-Denver mismatch first.

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
