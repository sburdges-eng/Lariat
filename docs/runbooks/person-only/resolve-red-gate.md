# Resolve a red orchestrator task or pick a fix-it hypothesis

**Why this is yours:** The coordinator stops on every `red` and `review_red` row — "do not retry automatically… Wait for the user" (`.claude/agents/coordinator.md:40,44`), "No retry on red — surface the failure, let the user decide" (`:63`); it never auto-merges (`:45,61`) and never removes a failed worktree (`:62`). Fix-it runs up to three hypotheses and stops: "Don't pick automatically — the user picks" (`.claude/agents/fix-it.md:34`), "No auto-apply… the user picks" (`:49`), and you cherry-pick the winner yourself (`:44`).
**Unblocks:** every task whose `dependencies:` name the red one (`coordinator.md:31` — eligible only when dependencies are green), the wave's dashboard closing (`:57`), and — for fix-it — whatever PR or verify run the red gate is holding.
**Where:** this laptop — the Claude Code chat that owns the wave or fix-it run, plus a terminal at the repo root.  **Time:** 10–30 min per row; longer if you re-run the gate yourself.
**Status:** recurring — nothing pending 2026-09-02: `ORCHESTRATOR_STATUS.md:25` reads "No orchestrator wave is in flight"; `ls .claude-worktrees/` → no such directory; `git branch --list 'orch/*' 'fix/H*'` → empty; open PRs #674–#677 and the last ten `gh run list` rows are all green. `ORCHESTRATOR_STATUS.md` itself is stale (pinned to `357a1be4` at `:12`; its own `:95-97` rule says regenerate). The `/orchestrate retry <id>` and `/orchestrate-merge` commands (`coordinator.md:40,61`) and `.claude/last_failure.txt` (`fix-it.md:13`) do not exist — no `.claude/commands/`, no `~/.claude/commands`, and the hooks in `.claude/settings.json:37-62` write no failure file (`docs/runbooks/person-only/STALE-DOCS-2026-09-01.md:39`). Your "command" is a plain chat message.

## Before you start
- [ ] Find the pending instance — check: `grep -nE '\|\s*(red|review_red)\s*\|' ORCHESTRATOR_STATUS.md` → a task row (`coordinator.md:47-55` format), **or** a fix-it comparison table in chat (`| Hyp | Outcome | Diff (LoC) |…`, `fix-it.md:36-42`). Corroborate on disk: `ls .claude-worktrees/ 2>/dev/null; git branch --list 'orch/*' 'fix/H*'`.
- [ ] The row carries the failure — check: its Notes cell has the command run + first 30 lines of error (`coordinator.md:70`). Empty → hand it back to the agent to fill before you decide.
- [ ] The red is not this machine — check the pasted error: `ERR_DLOPEN_FAILED … 137 vs 147` is the Node binding, not code (`CLAUDE.md:92-94`); `no such module 'XCTest'` is CLT-only, not code (`CLAUDE.md:116-121`). Either → step 3 first, no decision yet.
- [ ] The worktree still exists — check: `git worktree list | grep -E '<id>|fix-H'` (`CLAUDE.md:173`).
- [ ] Nobody else holds the files — check: `node scripts/agent-session.mjs list` (`AGENTS.md:73`).
- [ ] gh signed in — check: `gh auth status` → `Logged in to github.com`.

## Steps
Path A = a `red` row (implementer failed). Path B = a `review_red` row (reviewer asked for changes). Path C = a fix-it table. Steps 1–3 apply to all three.

1. **Read the failure, not the summary.** `grep -n '<id>' ORCHESTRATOR_STATUS.md` → the row's Tests and Notes cells; for fix-it, the table plus the failing output the agent was given. If not: ask the agent for the command and the first 30 lines (`coordinator.md:70`).
2. **Look at the worktree yourself.** `git -C .claude-worktrees/<id> log --oneline main..HEAD` → one commit `<id>: …` (`implementer.md:36`); `git -C .claude-worktrees/<id> diff main --stat` → only files in the task's `paths_touched` (`grep -n -A14 'id: <id>' tasks.yaml`). If it touched more: that alone is request_changes (`reviewer.md:38`).
3. **Re-run the gate under Node 24.** In the worktree: `npx -y node@24 --experimental-strip-types --test <test-file>` (`CLAUDE.md:96`), or `npm run verify:gate` (`package.json:16` → `scripts/verify.sh`, untracked until PR #674 lands; fallback `npm run version:stamp && npm run verify > /tmp/verify.log 2>&1; echo "exit=$?"`, `CLAUDE.md:179-184,201-208`) → the same failure. If it goes green: the red was environmental — say so in chat, ask the agent to re-run; no other decision needed. A `swift test` acceptance test (`tasks.yaml:56-57,83-84`) cannot run here — push the branch and read `gh run list` for `native-ci` (`CLAUDE.md:123-126`).

**Path A — `red` row**

4. **Pick one of four.** *retry* (same worktree, agent gets a one-line hint), *respec* (you edit the task's `description` / `acceptance_tests` in `tasks.yaml` — the manifest is yours), *drop* (delete the task from `tasks.yaml`), or *fix-it* (hand the failure to the fix-it agent, `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:167`). Never "make it green" by weakening the test (`implementer.md:56`).
5. **Say it in the chat that owns the wave.** Type `retry <id> — <hint>` (the literal `/orchestrate retry <id>` from `coordinator.md:40` is not a registered command; the words are the instruction) → expect: the coordinator re-dispatches into `.claude-worktrees/<id>` and rewrites the row. Respec: edit `tasks.yaml`, then `retry <id>`. Drop: `drop <id>`, then step 6. Fix-it: `run fix-it on <id> with this failure:` + the pasted output.
6. **Remove a dropped worktree yourself.** `git worktree remove .claude-worktrees/<id>` → gone from `git worktree list`; then `git branch -D orch/<id>`. Agents never do this (`coordinator.md:62`; `.claude/skills/person-only/SKILL.md:36`). If git refuses (uncommitted files): `git -C .claude-worktrees/<id> status --short`, read it, and only then `--force`.

**Path B — `review_red` row**

7. **Read every finding as `[severity] file:line — issue — fix`** (`reviewer.md:47`) from the row's Notes or the reviewer's chat output. Then `git -C .claude-worktrees/<id> diff main..HEAD` (`reviewer.md:17`) and read the hunks the findings point at.
8. **Decide per finding: fix, override, or drop the task.** Override only with a written reason; never override a finding on a `docs/PROTECTED_CONTRACTS.md` surface, a PIN gate, an audit event, or a HACCP threshold (`reviewer.md:30-35`; `.claude/skills/person-only/SKILL.md:127`).
9. **Say it in chat.** `<id>: fix findings 1,3; override 2 — <reason>` → expect: implementer re-runs in the same worktree, reviewer re-reviews, row becomes `ready_to_merge` (`coordinator.md:43`). `ready_to_merge` is still unmerged — the branch is unpushed (`implementer.md:36,53`) and named `orch/<id>`, which `AGENTS.md:45-50` no longer allows; when you land it, rename (`git -C .claude-worktrees/<id> branch -m orch/<id> feat/<id-slug>`), push, and open a PR — never push `main` (`CLAUDE.md:147`).

**Path C — fix-it hypotheses**

10. **Check the table against the worktrees.** For each `green` row: `git -C .claude-worktrees/fix-H<n> log -1 --format='%H %s'` and `git -C .claude-worktrees/fix-H<n> diff HEAD~1 --stat` → the LoC column is honest; `git -C .claude-worktrees/fix-H<n> diff HEAD~1 -- tests/` → a test was added or fixed, none deleted or loosened (`fix-it.md:27`; `implementer.md:56`). A `green` that deletes an assertion is red.
11. **Re-run the failing gate in the candidate worktree** (step 3 command) → exit 0. Prefer the smallest green diff with the lowest Risk; `green` means gate passes *and* hypothesis confirmed (`fix-it.md:31`).
12. **Pick, in chat: `use H<n>`** (`fix-it.md:44`) → expect: the agent stops; it applies nothing (`:49`). If every row is `red`: read what each learned (`:32`) and either ask for a new set (`:55` — fewer than three distinct means two, and it must say so), take the escalation if a hypothesis needs an architectural change (`:51`), or revert the red commit.
13. **Cherry-pick the winner yourself, into a worktree — not the main checkout.** `scripts/worktree.sh new sean fix/<slug>` (`scripts/worktree.sh:10,110-121`, off `origin/main`) → `cd ../Lariat-worktrees/sean-<slug>` → `git cherry-pick <sha from step 10>` → gate (step 3) exit 0 → `/ship`. `fix-it.md:44` says "into the main worktree"; the repo rule is a branch + PR (`CLAUDE.md:147,149-152`; `fix-it.md:48`).
14. **Leave the losing `fix-H*` worktrees until the PR merges** (`fix-it.md:50`), then remove them as in step 6 (`git worktree remove .claude-worktrees/fix-H<n>; git branch -D fix/H<n>`).

## Pass / fail
- A red row is **handled** when it no longer reads `red` / `review_red`: it is `ready_to_merge` (implementer green on the acceptance tests *and* reviewer `approve`, `coordinator.md:39-43`), or the task is gone from `tasks.yaml` with its worktree removed. `ready_to_merge` → merge is a separate step (`coordinator.md:61`; no `/orchestrate-merge` exists).
- A fix-it table is **handled** when exactly one `use H<n>` is on record and its commit sits on a `fix/` branch with the gate at exit 0 and a PR open — or a written "none; <next step>".
- **Fail:** a retry issued with no hint and no new information (`coordinator.md:63`); a gate turned green by deleting or weakening a test (`implementer.md:56`); a machine-side red (`137 vs 147`, `XCTest`) chased as code (`CLAUDE.md:118-121`); a fix applied straight onto `main` or the shared main checkout (`fix-it.md:48`; `CLAUDE.md:147`).

## Record the result
- Evidence: the task's row in `ORCHESTRATOR_STATUS.md` (`coordinator.md:47-55`: Task | Status | Worktree | Implementer | Reviewer | Tests | Notes). The agent rewrites Status after your answer; you append to Notes: `decided YYYY-MM-DD by Sean: retry|respec|drop|override|fix-it — <one-line reason>`, and bump the header timestamp and the `origin/main` SHA (`:1,:12`; rule at `:95`). Fix-it has no file: put the chosen H, its SHA, and one line per losing hypothesis (`fix-it.md:32`) in the cherry-pick PR body, plus one dated line in `.agent-sessions/handoff.md` (append-only, gitignored — `AGENTS.md:101`).
- Where the waiting agent reads your answer: **the chat session that dispatched the wave or the fix-it run** (`coordinator.md:40,44`; `fix-it.md:44`). If that session is gone: append a dated block to `.agent-sessions/handoff.md` addressed to the next agent with the exact `retry <id> — <hint>` / `use H<n>` line, and edit the `ORCHESTRATOR_STATUS.md` row yourself (`AGENTS.md:85`).
- Ask the agent to pre-do before it hands you a row: fill Notes with command + first 30 lines (`coordinator.md:70`); re-run under `npx -y node@24` and state whether the red survives (`CLAUDE.md:96`); paste `git diff main --stat` for the worktree; for fix-it, the table plus each candidate's SHA and `diff HEAD~1 -- tests/`; propose one option with a reason. It must not retry, merge, cherry-pick, or remove a worktree (`coordinator.md:61-63`; `fix-it.md:49-50`; `.claude/skills/person-only/SKILL.md:97-99`).
- Then update: the `ORCHESTRATOR_STATUS.md` row + header; `tasks.yaml` on respec/drop. This runbook's **Status** stays `recurring` and the README index row needs no per-instance edit.

## Close out
```bash
scripts/worktree.sh new sean chore/resolve-red-gate
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main. A fix-it cherry-pick carries code — use the `fix/<slug>` worktree from step 13 for it instead; `orch/` and `fix/H<n>` are the agents' scratch branch names and fail `scripts/worktree.sh:61-64`'s prefix check. `.claude/skills/ship/SKILL.md` and `scripts/verify.sh` are untracked today (PR #674; `git ls-files` empty); the tracked gate is `npm run verify` (`package.json:39`).

## If something goes wrong
- A retry goes red again → do not loop it (`coordinator.md:63`); switch to respec, fix-it, or drop.
- `git cherry-pick` conflicts → `git cherry-pick --abort`; never `reset --hard` in any checkout (`CLAUDE.md:161-162`).
- Removed the wrong worktree → the branch survives: `git worktree add .claude-worktrees/<id> orch/<id>` (or `fix/H<n>`).
- `git commit` blocked by the PreToolUse hook → `scripts/cursor-precommit-gate.sh:36-46` requires `npm run lint && npm run typecheck`; fix the lint/type error, do not bypass (`CLAUDE.md:303-304`; `implementer.md:55`).
- `ORCHESTRATOR_STATUS.md` too stale to trust (pinned at `357a1be4` `:12`; the seven "open" PRs at `:33-43` all merged — `STALE-DOCS-2026-09-01.md:37,63`) → per its own `:95-97`, have the agent regenerate it from `git`/`gh` before it adds your row. `tasks.yaml:33-89` P3-1..P3-4 shipped outside the orchestrator as #645 (`STALE-DOCS-2026-09-01.md:61`) — do not retry those.
- A finding touches HACCP, PIN, audit, or a `docs/PROTECTED_CONTRACTS.md` surface → do not override; run the targeted suite from `docs/PROTECTED_CONTRACTS.md` §15 before deciding (`CLAUDE.md:195-196`).
- Tell: append the blocker to `.agent-sessions/handoff.md` and the `ORCHESTRATOR_STATUS.md` row (`AGENTS.md:85`).
