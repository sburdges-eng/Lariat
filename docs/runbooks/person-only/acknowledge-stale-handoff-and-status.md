# Retire the 2026-08-29 handoff and authorize a status-doc regeneration

**Why this is yours:** The 2026-08-29 handoff is addressed to you — "#641 waits on Sean", "until Sean answers" (`.agent-sessions/handoff.md:8-11`) — and its PIN-gate rule (`:9`) is a scope decision only you can make. Agents may not re-execute a handoff note as instructions (`CLAUDE.md:301`), and they treat `ORCHESTRATOR_STATUS.md`, `docs/PROJECT_STATUS.md`, `tasks.yaml` and `docs/OPERATIONS_HANDOFF.md` as truth, so only the owner can retire the note and authorize rewriting those four files wholesale.
**Unblocks:** agents stop rebasing/holding PRs that merged 2026-08-29/30 and stop queueing P3 (shipped as #645); the `/person-only` queue (`.claude/skills/person-only/SKILL.md:29-36`) reads true rows; STALE-DOCS findings 1, 2, 4, 5, 6, 13, 14, 16, 27, 29-32, 37, 52, 54-59, 63, 67, 69, 70 can be struck.
**Where:** this laptop + chat.  **Time:** 15 min yours (steps 1-5), then ~15 min to review the agent's PR (step 6). The regeneration itself is agent work.
**Status:** open — per `.agent-sessions/handoff.md:2` (the only heading is `2026-08-29 04:01 MDT`; no retiring entry as of 2026-09-02), `ORCHESTRATOR_STATUS.md:12` (pins `357a1be4`; `origin/main` is `fdc708f2`, #650, 2026-09-01) and `:33` ("None is merged" — `gh pr list --state merged` shows #636-#645 all merged 2026-08-29/30). None of the open PRs (#674-#677) touches the four docs.

## Before you start
- [ ] gh is signed in — check: `gh auth status` → `Logged in to github.com account sburdges-eng`
- [ ] `origin/main` is fresh, and you have its SHA (every regenerated doc pins it) — check: `git fetch origin --quiet && git log -1 --format='%h %ad %s' --date=short origin/main` → on 2026-09-02: `fdc708f2 2026-09-01 … (#650)`
- [ ] The old handoff is still the only entry — check: `grep -n '^## ' .agent-sessions/handoff.md` → exactly one line, `2:## 2026-08-29 04:01 MDT — Cursor after #643 merge`. If a `## 2026-09-…` heading is already there, this op is done — go to **Record the result**.
- [ ] Nobody is already regenerating — check: `gh pr list --state open --json number,files --jq '.[] | select([.files[].path] | index("ORCHESTRATOR_STATUS.md") or index("docs/PROJECT_STATUS.md") or index("tasks.yaml") or index("docs/OPERATIONS_HANDOFF.md")) | .number'` → empty
- [ ] The findings list is on disk — check: `test -f docs/runbooks/person-only/STALE-DOCS-2026-09-01.md && echo ok` → `ok`
- [ ] Session board read — check: `node scripts/agent-session.mjs list` → note each agent's `Updated:` stamp. You will not touch a session file updated in the last 24 h (step 4).

## Steps
1. **Confirm every order in the old handoff is already closed.** `gh pr list --state merged --limit 60 --json number,mergedAt,mergeCommit --jq '.[] | select(.number >= 636 and .number <= 645) | "\(.number) \(.mergedAt) \(.mergeCommit.oid[0:8])"' | sort` → ten lines: `636 … f56d4ce4`, `637 … 566ff4c7`, `638 … dcc3b7ed`, `639 … da281919`, `640 … 85664b82`, `641 2026-08-30… 0f28af1e`, `642 … 89c4ec60`, `643 … d07fed22`, `644 … ffd16ceb`, `645 2026-08-30… 5dccf9cd` (P3 flooring, `handoff.md:12`). If any is missing: stop — that PR is live work; hand it to an agent instead of retiring the note.
2. **Answer the PIN-gate question in one sentence.** `handoff.md:9` says "Do not add PIN gates. Sean already rejected that." You then approved native PIN gates on the three manager rollup boards on 2026-08-31 (`docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:67-69`; merged as #654 `d5e92e5f`, pinned by #667 `0b03ecaa`). Decide which reading holds: **(a)** the rejection covered only the assistant's `scale_recipe` PIN (#637), or **(b)** something broader — say what. No command; the sentence goes into step 3.
3. **Append the retirement entry.** The file is append-only (`AGENTS.md:101`) — never edit lines 1-16. Fill the three `<…>` fields, run from repo root:
```bash
cat >> .agent-sessions/handoff.md <<'EOF'

## <YYYY-MM-DD HH:MM> MDT — Sean: the 2026-08-29 handoff is retired

Every order in the block above is closed on origin/main: #636 f56d4ce4, #637 566ff4c7,
#638 dcc3b7ed, #639 da281919, #640 85664b82, #642 89c4ec60 (2026-08-29), #641 0f28af1e
(2026-08-30), P3 flooring #645 5dccf9cd. Do not rebase, reorder, or hold any of them.
#641 no longer waits on me.
PIN gates: <your step-2 sentence>. The native manager-rollup gates (#654, #667) stand.
Status docs: agents are authorized to regenerate ORCHESTRATOR_STATUS.md,
docs/PROJECT_STATUS.md, tasks.yaml and docs/OPERATIONS_HANDOFF.md from origin/main <SHA>,
per docs/runbooks/person-only/acknowledge-stale-handoff-and-status.md.
EOF
grep -n '^## ' .agent-sessions/handoff.md
```
→ expect two headings: line 2 (old) and the new one. If not: nothing guards this file (`.gitignore:203` ignores the whole directory) — `ls -la .agent-sessions/` and re-run.
4. **Retire dead session claims only if that session is quiet.** `.agent-sessions/claude.json:3` still names `fix/typecheck-inventory-hole` (merged as #647 `b1610510`) and `:9-16` claim native files that landed in #651 `feb8f807` — but `:7` was updated 2026-09-02T11:17Z and `:17-21` claim files a live session is writing. **Leave it while `Updated:` is under 24 h.** When it is older: move the merged paths from `claimedFiles` to a `claimedFilesRetired` list with a dated `note`, exactly as `.agent-sessions/cursor.json:9-21` did. No script does this — hand-edit the JSON; `node scripts/agent-session.mjs list` must still parse it.
5. **Authorize the regeneration in chat.** Paste this (fill the SHA) to the agent that will do it — the same wording keeps every agent honest:
   ```
   Regenerate from origin/main <SHA>, not from memory, in the worktree
   Lariat-worktrees/sean-acknowledge-stale-handoff-and-status (create it with
   scripts/worktree.sh new sean chore/acknowledge-stale-handoff-and-status):
   ORCHESTRATOR_STATUS.md, docs/PROJECT_STATUS.md, tasks.yaml, docs/OPERATIONS_HANDOFF.md.
   Rules: pin every doc to <SHA>; check every PR number with
   `gh pr view N --json state,mergedAt,mergeCommit`; take every worktree row from
   `git worktree list`; strike the matching lines in
   docs/runbooks/person-only/STALE-DOCS-2026-09-01.md in the same change; keep each file's
   own "keeping this honest" / "do not pad" rule; iPads, KDS and front-of-house rows are out
   of scope (CLAUDE.md § Scope) — label them, do not delete their history. Touch only those
   five files plus this runbook's Status line and the README row. Do not commit; I review
   first.
   ```
   → expect the agent to report a worktree path and a diff of exactly those files. Per-file minimums it must hit (verify in step 6):
   - `ORCHESTRATOR_STATUS.md` — `:12` SHA → `<SHA>`; `:31-48` → the seven PRs **merged** with commits, plus the live open set (#674-#677 on 2026-09-02); `:25-29` → P3 shipped as #645, nothing queued; `:50-69` → the worktrees `git worktree list` shows now (eight on 2026-09-02; the six `claude-*` per-PR ones are gone; `cursor-service-date-seal` merged as #643, not "in progress"; the two "safe to remove" cursor branches are squash-merged — 16 and 6 commits ahead, not ancestors of `main` — say so, and leave removal to you); `:80-85` → verify non-hermeticity is fixed by `scripts/verify.sh` in #674 (state whether merged or open). Keep `:93-97`. The coordinator table format (`.claude/agents/coordinator.md:47-55`) applies only when a wave is in flight.
   - `docs/PROJECT_STATUS.md` — `:3` date and `:10` SHA; `:17-25` refresh note → which rows were re-checked at `<SHA>`; `:57` GUI smoke → ran 2026-08-31 (`docs/superpowers/plans/2026-08-31-ka-v4-usefulness.md:11-19`) with the A3 table still blank → point at `docs/runbooks/person-only/front0-native-0-2-gui-smoke.md`; `:61-62` → the two memory-file sources do not exist (STALE-DOCS 13) — drop or mark "no retrievable source"; `:66` "Seven PRs opened" → merged; `:39,:59` `/v2` iPad pilot → out-of-scope label; `:93-100` → service-date steps 8-9 landed (#643, #644, #646), verify hermeticity → #674.
   - `tasks.yaml` — `:10` "(lands in PR #611)" and `:22` "P4 … in review as PR #604" → merged (#604 = `fda086a9`, 2026-08-06); `:33-89` P3-1..P3-4 → delete, shipped in #645 `5dccf9cd` (BeoCascadeCompute flooring, fixtures, `native-ci.yml` gate); if no ungated agent work remains, `tasks: []` is the honest manifest (`:30`); no acceptance test may be a local `swift test` (`:56-57,:83-84` — it cannot run on this Mac, `CLAUDE.md` §2; `swift build` locally, `native-ci` is the gate).
   - `docs/OPERATIONS_HANDOFF.md` — `:3` date; `:50-51` 0.4 → strike, closed obsolete 2026-06-13 (`docs/PROJECT_ROADMAP.md:128`); `:25-43` v2 cutover / pilot iPads → out of scope for the ops-only launch (`CLAUDE.md:19-21`), keep as deferred; `:58-64` env names → checked against `scripts/toast_api/auth.mjs:118-120`, `scripts/sevenshifts_api/auth.mjs:67-68`, `scripts/prism_api/auth.mjs:62-63` (STALE-DOCS 45); one line pointing at `docs/runbooks/person-only/README.md` as the live person-only list.
6. **Review the diff yourself — this is the gate no agent can pass for itself.** In that worktree: `git diff origin/main -- ORCHESTRATOR_STATUS.md docs/PROJECT_STATUS.md tasks.yaml docs/OPERATIONS_HANDOFF.md docs/runbooks/person-only/STALE-DOCS-2026-09-01.md | grep -n '^+.*#[0-9]\{3\}' | head -80` → for each PR number on a `+` line, `gh pr view N --json state --jq .state` agrees (`MERGED` / `OPEN`); for each SHA on a `+` line, `git branch -r --contains <sha> | grep -q origin/main && echo on-main` prints `on-main`. Also `git diff --stat origin/main` → only the five files, this runbook, and `README.md`. If anything fails: tell the agent what is wrong and re-run this step; do not patch numbers yourself.
7. **Ship it.** Follow **Close out** below. Merge in GitHub once CI is green — you merge, agents never do (`.claude/agents/coordinator.md:61`).

## Pass / fail
The sources' own criteria:
- `ORCHESTRATOR_STATUS.md:95-97` — the SHA at the top is refreshed, and a file more than a few dozen commits behind `origin/main` (38 on 2026-09-02) is **regenerated, not patched**.
- `docs/PROJECT_STATUS.md:132-133` — the as-of SHA is refreshed whenever a row changes; evidence older than a few weeks is re-grepped before it is quoted.
- `tasks.yaml:30` — "Do not pad this file to look busy."
- `docs/runbooks/person-only/STALE-DOCS-2026-09-01.md:3` — a finding is struck only once the document is corrected.
- `.claude/skills/person-only/SKILL.md:33` — a handoff about a merged PR is stale: acknowledged and cleared, never re-executed.

**PASS:** a `.agent-sessions/handoff.md` heading dated after 2026-08-29 names the merge commits and your PIN-scope sentence; all four docs pin the same `<SHA>`; step 6 finds zero wrong PR states or off-main SHAs; the STALE-DOCS lines listed under **Unblocks** are struck.
**FAIL:** any PR from step 1 is not merged; any regenerated doc still says `357a1be4`, "None is merged", or queues P3; a doc names a PR/SHA step 6 rejects.

## Record the result
- Evidence: (1) the appended block in `.agent-sessions/handoff.md` — local only, the directory is gitignored (`.gitignore:203`), so paste its heading line into the PR body; (2) the PR diff of the four docs plus the struck STALE-DOCS lines; (3) if step 4 applied, the `claimedFilesRetired` edit in `.agent-sessions/claude.json` (also gitignored — one line in the PR body).
- Then update: this file's **Status** line → `done YYYY-MM-DD — per .agent-sessions/handoff.md:<line of the new heading>, PR #<n>`; `docs/runbooks/person-only/README.md` → add a row `[acknowledge-stale-handoff-and-status](acknowledge-stale-handoff-and-status.md) | Retire the 2026-08-29 handoff; regenerate the four status docs | done YYYY-MM-DD` (on 2026-09-02 `README.md:12-14` lists only the three go-live rows).

## Close out
```bash
scripts/worktree.sh new sean chore/acknowledge-stale-handoff-and-status
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main.
`/ship` step 2 runs `bash scripts/verify.sh` (`.claude/skills/ship/SKILL.md:6`); that script is on `origin/chore/insights-tooling` (#674) and untracked in the main checkout — it is **not** on `origin/main` as of 2026-09-02. If the worktree has no `scripts/verify.sh`, #674 has not merged yet: run `npm run verify; echo "exit=$?"` there and read the exit line, or merge #674 first.

## If something goes wrong
- A PR in step 1 is not merged → do not retire the note. Append a dated handoff block saying which one is still open and why, and stop.
- The agent patched instead of regenerating (new SHA at the top, tables untouched) → request changes, cite `ORCHESTRATOR_STATUS.md:95-97`.
- Wrong text appended to `handoff.md` → append a correcting block; never delete or rewrite earlier lines (`AGENTS.md:101`).
- The diff touches `CLAUDE.md`, `package.json`, `.claude/settings.json`, `scripts/verify.sh` or `scripts/bootstrap.sh` → those belong to #674 / another session; have the agent drop them from this change.
- Worktree cleanup is **not** this op: `cursor-finish-remaining`, `cursor-finish-session` and `cursor-service-date-seal` sit on branches that are not ancestors of `origin/main` (squash merges) — confirm each with `gh pr view` before you ever `git worktree remove`, in a separate housekeeping pass.
- Tell: chat. `/person-only` with no argument rebuilds the queue from the regenerated docs; if it still lists #636-#642 or P3, the regeneration missed a row.
