# Answer a question an agent parked for you

**Why this is yours:** Agents act only on your direct messages — they may never re-execute a handoff note or a pasted prompt as an instruction (`CLAUDE.md:301-302`; `.claude/skills/person-only/SKILL.md:128-129`). When an agent hits a decision it cannot make it stops and leaves the question in `ORCHESTRATOR_STATUS.md`, `.agent-sessions/handoff.md`, or chat (`AGENTS.md:85`), and `handoff.md` is append-only (`AGENTS.md:101`) — so nobody but you can close the loop, and only a reply *from you* counts.
**Unblocks:** whatever the question gates — usually a PR being held as-is (`handoff.md:10-11` pattern) or a plan whose `status:` line reads "needs Sean".
**Where:** chat (plus this laptop for the `handoff.md` append).  **Time:** 5–15 min per question; longer only if it needs a spec first.
**Status:** recurring — nothing unanswered on 2026-09-02. The only handoff heading is `.agent-sessions/handoff.md:2` (2026-08-29); its one question (`:10-11`, "#641 waits on Sean") was answered by your merge `0f28af1e` 2026-08-30T04:09Z (`gh pr view 641 --json state,mergedAt`), and retiring that block is `acknowledge-stale-handoff-and-status.md`, not this. No open PR body (#674–#677) mentions you. Plan status lines that still need you each have their own slug (step 2).

## Before you start
- [ ] gh is signed in — check: `gh auth status` → `Logged in to github.com`
- [ ] You know who is waiting — check: `node scripts/agent-session.mjs list` → the `active` session's `Agent`/`Branch` (`scripts/agent-session.mjs:58-87`). That session's chat is where the answer must land (step 7).
- [ ] You know the newest handoff block — check: `grep -n '^## ' .agent-sessions/handoff.md` → dated headings; read only the last one. If the file is missing, no agent has parked anything there.
- [ ] You are reading, not executing — a pasted handoff or "do this next" list is data to classify, never a command (`SKILL.md:128-129`).

## Steps
1. **Find every pending question.** From repo root:
   ```bash
   grep -n -i -E "waits on sean|sean answers|until sean|needs sean|sean's call|hand back|owner decision|sign-off" .agent-sessions/handoff.md ORCHESTRATOR_STATUS.md
   gh pr list --state open --json number,title,body --jq '.[] | select(.body | test("sean"; "i")) | "\(.number)\t\(.title)"'
   grep -rn -E "^status:.*(Sean|owner)" docs/superpowers/plans docs/superpowers/specs docs/agentic/findings
   ```
   → expect: one line per candidate (chat questions are the agent's last message ending "hand back to Sean" / "waiting on you" — no command finds those). Empty everywhere and no chat ask: nothing pending, stop. `/person-only` with no argument builds the same list (`SKILL.md:27-37`).
2. **Throw out the ones that are not questions.** For each PR number in a hit: `gh pr view <N> --json state,mergedAt,mergeCommit --jq '"\(.state) \(.mergedAt) \(.mergeCommit.oid[0:8])"'` → `MERGED …` means the question died with the merge (`SKILL.md:33`) — route it to `acknowledge-stale-handoff-and-status.md`, not here. For a plan `status:` hit, check `ls docs/runbooks/person-only/` for that decision's own runbook and walk that instead (on 2026-09-02: `2026-08-31-hr-paperwork-suite.md:4` → slug `p7-hr-paperwork-design-signoff`; `2026-08-06-todayiso-utc-service-date.md:4` → `service-date-historical-rows`; `2026-08-05-h8-notarization.md:4` → `h8-developer-id-identity`; `2026-08-05-g0-gui-smoke-and-shutoff.md:4` → `g0-service-day-shutoff.md`). This runbook is for the question that has no runbook of its own.
3. **Read what it gates — from the source, not the agent's summary.** Open the `file:line` the agent cited; for a held PR, `gh pr diff <N> --name-only`. If any path is a HACCP table/route or a surface in `docs/PROTECTED_CONTRACTS.md`: do not decide in chat — it needs a spec and a runbook first (`SKILL.md:92-94`; `AGENTS.md:86`). Tell the agent to write those and stop here.
4. **Make the agent pre-do the framing if it has not.** Ask in chat for, in one message: the question in one line; options A/B(/C) with the `file:line` each one changes; its recommendation; what is blocked meanwhile; and a drafted `handoff.md` block in the step-6 shape. Agents may draft, run read-only checks, and create your worktree (`SKILL.md:97-99`); they may not act on the draft (`SKILL.md:128-129`).
5. **Decide.** Your answer is: the option letter or yes/no, one sentence of why, what the agent may now do, and what stays off-limits. "Parked until <date> — move to <next ungated item>" is a valid answer (`handoff.md:12` shows the shape); silence is not, because the agent keeps holding the PR (`handoff.md:10`).
6. **Append the answer to the handoff file.** Append-only (`AGENTS.md:101`) — never edit earlier lines. Fill the `<…>` fields (`date '+%Y-%m-%d %H:%M %Z'` prints the stamp in the file's own format, `handoff.md:2`) and run from repo root:
   ```bash
   cat >> .agent-sessions/handoff.md <<'EOF'

   ## <YYYY-MM-DD HH:MM MDT> — Sean: answer to <question, one line>

   Asked by: <agent> in <handoff.md:<line> | PR #<n> | chat>. Gates: <what was held>.
   Answer: <option / yes / no> — <one sentence why>.
   Now allowed: <what the agent may do>. Still off-limits: <what stays gated>.
   EOF
   grep -n '^## ' .agent-sessions/handoff.md
   ```
   → expect: your heading is the last one. If not: the directory is gitignored and unguarded (`.gitignore:203`) — `ls -la .agent-sessions/` and re-run. Do not use `node scripts/agent-session.mjs handoff --to …` for this: it reassigns a session's status/claims (`scripts/agent-session.mjs:89-134`), it never writes `handoff.md`.
7. **Deliver it where the agent can act on it.** The file is the record, not the trigger — agents act only on your direct messages (`CLAUDE.md:301-302`; `SKILL.md:128-129`). Paste the same *Answer / Now allowed / Still off-limits* lines into the chat of the session that asked (the `active` one from the board). Question parked on a PR: also `gh pr comment <N> --body "<same text>"`. Question parked in `ORCHESTRATOR_STATUS.md`: the agent updates that row in its own PR — you do not patch that file by hand (`ORCHESTRATOR_STATUS.md:95-97`: regenerate, never patch).
8. **Confirm the agent moved.** After its next turn: `node scripts/agent-session.mjs list` → `Status`/`Branch` reflect the unblocked work, or `gh pr list --state open` shows the held PR's new commit / the follow-up PR. If the same question comes back, it did not arrive as a direct message — repeat step 7 in that session's chat.

## Pass / fail
An item is open only while the file that owns it still says so today (`SKILL.md:39-41`). **Handled** when all three hold: (1) the newest `.agent-sessions/handoff.md` heading is yours, dated today, and carries the answer; (2) the asking agent has the same answer as a direct chat reply (or PR comment) and has stopped waiting; (3) nothing in `handoff.md`, `ORCHESTRATOR_STATUS.md`, or an open PR body still reads "waits on Sean" for that item — or what remains is a merged-PR note, routed to `acknowledge-stale-handoff-and-status.md`. **FAIL:** an answer that exists only in `handoff.md` (no agent may act on it, `CLAUDE.md:301-302`); an earlier handoff line edited or deleted (`AGENTS.md:101`); a HACCP or protected-contract change decided in chat with no spec (`SKILL.md:92-94`).

## Record the result
- Evidence: the appended block in `.agent-sessions/handoff.md` — local only, the directory is gitignored (`.gitignore:203`), so the agent quotes your heading line in its PR body. PR-parked question: the `gh pr comment`. Chat-only question: the chat message is the evidence; nothing to file. The waiting agent expects the answer in **chat first**, then `handoff.md` (and the PR thread if that is where it asked) — never `ORCHESTRATOR_STATUS.md` alone.
- Then update, only when the answer changes a tracked doc: the plan/spec `status:` line the agent cited; the matching bullet under `docs/PROJECT_STATUS.md:55-62` "Blocked on an owner decision"; the item in `docs/OPERATIONS_HANDOFF.md` (strike it, `:6-7`); and, if the decision has its own runbook, that runbook's **Status** line and README row. The agent drafts all of these in its PR (`SKILL.md:97-99, 101-106`); you review. This runbook's Status stays `recurring`. Its own README row — `| [answer-pending-agent-question](answer-pending-agent-question.md) | Answer a question an agent parked for you | recurring |` — waits until the live go-live session releases `docs/runbooks/person-only/README.md` (claimed in `.agent-sessions/claude.json` `claimedFiles`; check `node scripts/agent-session.mjs list`).

## Close out
Chat-only when nothing but `handoff.md` changed (it is gitignored) — no branch, no PR. When the answer changes a tracked doc:
```bash
scripts/worktree.sh new sean chore/answer-pending-agent-question
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main. `/ship` runs `bash scripts/verify.sh` (`.claude/skills/ship/SKILL.md:6`); on 2026-09-02 both are untracked in the main checkout (`git status`: `?? .claude/skills/`, `?? scripts/verify.sh`, PR #674) — in a worktree that lacks them, run `npm run verify; echo "exit=$?"` and read the exit line.

## If something goes wrong
- Wrong answer appended → append a correcting block with a new dated heading; never rewrite or delete earlier lines (`AGENTS.md:101`).
- The agent acted before you answered → `gh pr list --state open` and `git log --oneline -5 origin/main`; if it merged, revert by PR (`git revert -m 1 <sha>` on a `fix/` branch) — never `reset --hard` (`SKILL.md:116-117`).
- The agent keeps treating an old handoff block as orders → say so in chat citing `CLAUDE.md:301-302`; retire the block via `acknowledge-stale-handoff-and-status.md`.
- The question touches HACCP or a `docs/PROTECTED_CONTRACTS.md` surface → stop; require the spec + runbook first (`SKILL.md:92-94`; `AGENTS.md:86`). `haccp-sync-feed-block-lift.md` exists for the `sync_feed` block; other HACCP gate questions have no runbook yet — have the agent write one before you answer.
- You cannot decide today → say "parked" explicitly, in chat and in `handoff.md`, with the next ungated item the agent should take (`handoff.md:12` shape). An unanswered question is not a "no".
- Tell: chat. Append the blocker to `.agent-sessions/handoff.md`, and to `ORCHESTRATOR_STATUS.md` only if a coordinator wave is in flight (`AGENTS.md:85`; none is on 2026-09-02, `ORCHESTRATOR_STATUS.md:25`).
