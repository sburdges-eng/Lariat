# Prune merged worktrees

**Why this is yours:** Agents create worktrees and never remove them — "Sean removes worktrees; agents never do" (`.claude/skills/person-only/SKILL.md:36`); the coordinator leaves every worktree in place and "the user removes them with `git worktree remove`" (`.claude/agents/coordinator.md:62`). Every PR here is squash-merged, so no branch tip is an ancestor of `origin/main` and "merged" is a judgment (PR state + head SHA), not a git fact — a person confirms before anything is deleted.
**Unblocks:** Housekeeping only — a true `git worktree list`, an honest `ORCHESTRATOR_STATUS.md` worktree table, fewer stale checkouts sharing one `.git/`. Nothing downstream waits on it.
**Where:** this laptop  **Time:** 10 min for today's three; ~2 min per worktree after that.
**Status:** recurring — 3 pending as of 2026-09-02 (live `git worktree list`, `gh pr view`): `cursor-finish-remaining` (`chore/finish-remaining`, #635 MERGED 2026-08-29, PR head `fbce885c` = tip, one dirty generated file), `cursor-service-date-seal` (`feat/service-date-seal`, #643 MERGED 2026-08-29, PR head `809d6396` = tip, clean), `cursor-finish-session` (`fix/day-plan-idempotency-lateness`, no PR, local-only, all six unique commits accounted for on `origin/main` — see step 3). Leave the four `claude-*` worktrees: PRs #674, #675, #676, #677 are OPEN. `ORCHESTRATOR_STATUS.md:63` ("do not touch" `cursor-service-date-seal`) is stale — its session's work merged as #643 (`.agent-sessions/cursor.json:21`); `:64-65` "safe to remove" is confirmed.

## Before you start
- [ ] `gh` signed in — check: `gh auth status` → `Logged in to github.com`.
- [ ] Main checkout current — check: `git fetch origin && git rev-parse --short main origin/main` → two identical SHAs (today `fdc708f2`).
- [ ] No agent is working in the worktree — check: `node scripts/agent-session.mjs list` → no session whose `Worktree:` is `../Lariat-worktrees/<name>` (`AGENTS.md:73-74`; today both sessions sit in the main checkout, `.agent-sessions/cursor.json:4`).
- [ ] Nothing uncommitted in the worktree — check: `git -C ../Lariat-worktrees/<name> status --porcelain` → empty. (`scripts/worktree.sh:195-205` deliberately runs `git worktree remove` without `--force`; a dirty tree is refused.)
- [ ] Not locked — check: `git worktree list --porcelain | grep -c locked` → `0`.

## Steps
1. **List candidates (repo root).** One loop, one row per linked worktree:
   ```bash
   git worktree list --porcelain \
     | awk '$1=="worktree"{p=$2} $1=="branch"{sub("refs/heads/","",$2); print p, $2}' \
     | tail -n +2 | while read -r p b; do
       pr=$(gh pr list --state all --head "$b" --json number,state,mergedAt,headRefOid \
            --jq 'if length>0 then (.[0] | "#\(.number) \(.state) \(.mergedAt // "-" | .[:10]) prhead=\(.headRefOid[:8])") else "no-PR" end')
       printf '%-26s %-36s tip=%s %-42s dirty=%s upstream=%s\n' "$(basename "$p")" "$b" \
         "$(git rev-parse --short=8 "$b")" "$pr" \
         "$(git -C "$p" status --porcelain | wc -l | tr -d ' ')" \
         "$(git rev-parse --abbrev-ref "$b@{upstream}" 2>/dev/null || echo local-only)"
     done
   ```
   → expect (2026-09-02):
   ```
   claude-insights-tooling    chore/insights-tooling               tip=43035e96 #674 OPEN -                dirty=1 upstream=origin/chore/insights-tooling
   claude-readme-drift        chore/readme-drift                   tip=f85bf9ee #675 OPEN -                dirty=0 ...
   claude-smoke-day           feat/smoke-day                       tip=f5747efa #677 OPEN -                dirty=0 ...
   claude-tz-test-hardening   fix/tz-test-hardening                tip=5c503298 #676 OPEN -                dirty=0 ...
   cursor-finish-remaining    chore/finish-remaining               tip=fbce885c #635 MERGED 2026-08-29 prhead=fbce885c dirty=1 upstream=origin/chore/finish-remaining
   cursor-finish-session      fix/day-plan-idempotency-lateness    tip=6afeb682 no-PR                       dirty=0 upstream=local-only
   cursor-service-date-seal   feat/service-date-seal               tip=809d6396 #643 MERGED 2026-08-29 prhead=809d6396 dirty=0 upstream=origin/feat/service-date-seal
   ```
   Remove only rows that read `MERGED` **and** whose `tip=` equals `prhead=` (the PR that merged carried the whole branch). `OPEN` → leave. `no-PR` → step 3. `tip≠prhead` → commits landed after the PR; treat as `no-PR`. Keep this output — it is the evidence and the recovery table. `npm run branches:merged` will not find these (`scripts/branches.sh:45` uses `git branch --merged main`, blind to squash merges).
2. **Clear a dirty candidate.** `git -C ../Lariat-worktrees/<name> diff` → read every hunk. Generated noise only → discard it: today `cursor-finish-remaining` has a one-line `.next/dev/types` → `.next/types` path change in `next-env.d.ts` (the file itself says "This file should not be edited"), so `git -C ../Lariat-worktrees/cursor-finish-remaining checkout -- next-env.d.ts`. Real work → stop: commit it on that branch or copy it out first. Never `reset --hard` (`CLAUDE.md:161-162`).
3. **Decide a `no-PR` / local-only branch.** `git cherry -v origin/main <branch>` → a `-` line is patch-identical on `origin/main`; for each `+` line, `git log origin/main --oneline --fixed-strings --grep="<commit subject>"` → a twin commit, then `git show --stat <sha>` for any still unmatched. Measured 2026-09-02 for `fix/day-plan-idempotency-lateness` (6 unique commits): `6afeb682` is `-`; `aae72977`, `41f3045c`, `a6d7292e`, `e5c87e70` have twins `1fa74825`, `62255418`, `38b6fadd`, `afa39161`; `e2ba6c4e` ("wave 1 — seven surfaces record the service day") has no twin but its patch reverse-applies cleanly onto `origin/main` (it went in with #635). All six accounted for → safe. If you cannot account for a commit: still remove the worktree (step 4 — the branch ref keeps the commits) but skip that branch in step 5.
4. **Remove the worktree.** `scripts/worktree.sh remove <name>` → `✓ removed /Users/seanburdges/lariat_dev/Lariat-worktrees/<name>` (`scripts/worktree.sh:184-207`: unlinks the `node_modules`/`.venv` symlinks, deletes `.DS_Store`, then `git worktree remove`). Today, in order: `scripts/worktree.sh remove cursor-finish-remaining`, `scripts/worktree.sh remove cursor-service-date-seal`, `scripts/worktree.sh remove cursor-finish-session`. If git prints `contains modified or untracked files, use --force to delete it` → back to step 2; do not add `--force` (it would also wipe forgotten work — `scripts/worktree.sh:199-201`).
5. **Delete the branch — only if every commit is accounted for.** `git branch -D <branch>` (`-D` is required: squash merges leave the tip outside `origin/main`, so `-d` and `npm run branches:prune-merged` refuse — `scripts/branches.sh:49,59`). Today: `git branch -D chore/finish-remaining feat/service-date-seal fix/day-plan-idempotency-lateness`. Remote copies stay (`gh repo view --json deleteBranchOnMerge` → `false`); `git push origin --delete chore/finish-remaining feat/service-date-seal` only if you want them off GitHub too — optional.
6. **Verify.** `git worktree list` → main plus the four `claude-*` rows only; `ls ../Lariat-worktrees` → no `cursor-*` directory.

## Pass / fail
Pass: each removed worktree's branch had a MERGED PR whose head SHA equalled the branch tip, or (local-only) every unique commit was accounted for on `origin/main`; the worktree is gone from both `git worktree list` and disk; no `OPEN`-PR worktree was touched; `--force` was never used. Fail: a branch deleted with an unaccounted commit, an `OPEN` row removed, or `--force` needed. "Handled" for the queue (`.claude/skills/person-only/SKILL.md:36`): `git worktree list` shows no worktree whose branch has a merged PR.

## Record the result
- Evidence: no template or log file — paste the step 1 table (before) and `git worktree list` (after) into chat to the waiting agent; that is where `/person-only` Mode 1 reads prune candidates from (`SKILL.md:36`). Say which branches were deleted and which were kept (and the unaccounted SHA, if any).
- Then update: `ORCHESTRATOR_STATUS.md:50-65` (worktree section) — regenerate per its own rule `:95-97` (its SHA `:12` is `357a1be4`, ~40 PRs stale) to list main + the live `claude-*` rows and drop `:63-65`; strike `docs/runbooks/person-only/STALE-DOCS-2026-09-01.md` items 2 (`:8`), 37 (`:43`), 58 (`:64`); add or refresh this runbook's row in `docs/runbooks/person-only/README.md` (`:10-14`, Status `recurring — last run YYYY-MM-DD`); update this file's Status line. `CLAUDE.md:48` still gives the worktree target as `~/Dev/hospitality/Lariat-worktrees/` — stale (`scripts/worktree.sh:47` derives `../Lariat-worktrees` from the main checkout = `~/lariat_dev/Lariat-worktrees/`); CLAUDE.md is dirty in the shared checkout (PR #674's session), so hand that one-line fix to that session instead of editing.
- Ask an agent to pre-do next time: run step 1 and post the table; run the step 3 `git cherry` / subject-match for every `no-PR` row; draft the ORCHESTRATOR_STATUS regeneration and STALE-DOCS strikes. An agent never runs `worktree remove`, `branch -D`, or `checkout --` in a worktree it does not own.

## Close out
```bash
scripts/worktree.sh new sean chore/prune-merged-worktrees
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main. `.claude/skills/ship/SKILL.md` and `scripts/verify.sh` are untracked in the shared checkout (`git status`: `?? .claude/skills/`, `?? scripts/verify.sh`) — in a fresh `sean` worktree the tracked gate is `npm run version:stamp && npm run verify` (`SKILL.md:114-115`).

## If something goes wrong
- Removed the wrong worktree: nothing is lost while the branch ref exists — `scripts/worktree.sh new <tool> <branch>` recreates it on the existing branch (`scripts/worktree.sh:110-111`).
- Deleted a branch you needed: `git branch <branch> <tip-sha>` from the step 1 table (or `git reflog`); `chore/finish-remaining` and `feat/service-date-seal` are also still on `origin`.
- Directory already `rm -rf`'d but still listed: `git worktree prune -v`.
- `is locked` refusal: `git worktree unlock ../Lariat-worktrees/<name>`, then retry — only after `node scripts/agent-session.mjs list` shows nobody in it.
- Tell: append the blocker to `.agent-sessions/handoff.md` and `ORCHESTRATOR_STATUS.md` (`AGENTS.md:85`).
