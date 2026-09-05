# Approve any deletion of a duplicate Lariat checkout or data root

**Why this is yours:** No agent may delete a Lariat checkout, backup copy, or data root as "cleanup" without an explicit instruction from you (`CLAUDE.md:70-71`; `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:94`, `:205`; `.cursor/rules/lariat-native-final.mdc:35`). Four of the surviving copies are the only record of pre-scrub history and still hold the PII the scrub removed (`CLAUDE.md:71-73`) — the call on what is a duplicate and what is the last copy is yours.
**Unblocks:** interim checkout pruning (disk: the recovery dump alone is 633 GB); Phase E E3 → E4 ☠ → E5 ☠ (`docs/superpowers/plans/2026-08-05-phase-e-consolidation.md:17-19`).
**Where:** chat (the answer) + this laptop (the checks)  **Time:** 15–30 min per ask, after the agent has done the pre-work below
**Status:** recurring — no instance pending as of 2026-09-02 (nothing addressed to you in `.agent-sessions/handoff.md` (last entry 2026-08-29, `:2`), `ORCHESTRATOR_STATUS.md`, `gh pr list --state open` (#674–#677), `gh issue list`). Last handled 2026-08-30 (four SSD copies, `CLAUDE.md:62-66`, PR #650) and 2026-08-31 (five app bundles, `docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:31-40`). Rule per `CLAUDE.md:70-71`. (Line numbers are the working copy; `CLAUDE.md` carries an uncommitted 8-line hunk above §1, so on `origin/main` subtract 8.)

## Before you start
- [ ] There is a real ask, naming absolute paths — check: `grep -n -iE "delet|prune|remove|checkout|data root" .agent-sessions/handoff.md ORCHESTRATOR_STATUS.md; gh pr list --state open` → a dated section or PR naming each path. No path = nothing to approve; a glob or "all duplicates" = send it back.
- [ ] You know which disk you are on — check: `test -d ~/Dev; echo "exit=$?"` → `exit=1` is the normal state (SSD unmounted: `~/Dev -> /Volumes/Sean's SSD/Dev`). Any `~/Dev/...` candidate is then unverifiable → answer "not yet", never "delete".
- [ ] The live data root is where you think — check: `grep -n LARIAT_DATA_DIR .env.local; ls -la "$HOME/Library/Application Support/Lariat/data/lariat.db"` → `.env.local:13` names `~/Library/Application Support/Lariat/data`; the DB is listed. That root, the repo `data/` (`audit/`, `cache/`, `lariat-data -> SSD`), and `~/lariat_dev/Lariat` are load-bearing — never candidates.
- [ ] The last export still checks out — check: `(cd ~/lariat_dev/stash-archive-2026-08-30 && shasum -c SHA1SUMS.txt | grep -c ': OK')` → `16`.
- [ ] Working from current `main` — check: `git fetch origin && git status -sb | head -1` → `## main...origin/main`. The on-origin checks below read this checkout's `origin/*` refs, so fetch first.

### What the live scan showed 2026-09-02 (re-run it; do not trust this table)
`D="$HOME/Documents/Codex/2026-08-24/thi/outputs/SanDisk Recovery 2026-08-24"` (the SanDisk recovery dump, 633 GB, local disk).

| Path | Found | Verdict today |
| --- | --- | --- |
| `~/lariat_dev/Lariat` | canonical, `main` `fdc708f2` | load-bearing — never |
| `~/lariat_dev/Lariat-worktrees/*` (7) | linked worktrees, not checkouts | not this gate — you remove them with `scripts/worktree.sh remove <tool>-<slug>` once the PR is merged (`scripts/worktree.sh:12`; `.claude/skills/person-only/SKILL.md:36`) |
| `~/Dev/hospitality/Lariat` (+`LariatNative`, `Lariat-KDS`), `~/Dev/lariat-data-sources`, `~/Dev/_archives/lariat-pre-scrub-2026-04-18` | SSD, unmounted | unverifiable; first three are load-bearing (`CLAUDE.md:44-47`) |
| `$D/backup/Lariat` (552M) | `main` `ab7f71c`; 7 stashes = `stash-archive-2026-08-30/backup-Lariat/01..07`; 3 branch tips on GitHub (`chore/session-log-2026-05-04` `5af02f5` exists as a commit, under no branch name) | duplicate-of-canonical candidate |
| `$D/Dev/hospitality/Lariat` (1.5G), `$D/MacRescue/Home/Dev/hospitality/Lariat` (9.9G) | `e5e178e` `feat/service-date-wave1`; 4 stashes each = `stash-archive-2026-08-30/hospitality-Lariat/01..04`; all 20 branch tips on `origin` | duplicate-of-canonical candidates; the 9.9G one carries 8G of untracked bulk — unknown ⇒ investigate what it is first |
| `$D/Dev/_archives/`, `$D/MacRescue/Home/Dev/_archives/`, `$D/backup/_archives/lariat-pre-scrub-2026-04-18` (1.2–2.3G each) | `b0c20f5`, on no remote; 44 branches; PII | never bare-delete (`CLAUDE.md:71-73`; checklist `:59`) |
| `$D/**/Lariat-KDS` ×3 (`c694206` ×2, `712cdfb`) | contradicts `CLAUDE.md:66-67` "exactly one Lariat-KDS checkout" | unknown ⇒ investigate against `origin` of Lariat-KDS |
| `$D/Lariat` (BEO/HR/Menu folders), `$D/MacBackup-2026-08-07/Documents/Lariat` (BEO xlsx, PDFs), `$D/Dev/Lariat` + `$D/MacRescue/Home/Dev/Lariat` (`data/lariat.db`, broken `.git`), `$D/MacBackup-2026-08-07/Library/Application Support/Lariat` (empty) | data roots, PII / DB copies | relocate + verify, never bare delete (plan `:26`; checklist `:59`) |

`CLAUDE.md:59-61` counts seven checkouts incl. "one inside the SanDisk recovery dump"; the dump holds six Lariat checkouts plus three Lariat-KDS today. The 2026-08-30 deletions were done on SSD paths (`~/lariat_dev/stash-archive-2026-08-30/README.md:7-9`), so the dump's `MacRescue/` and `backup/` copies were never in that batch. Do not "fix" `CLAUDE.md` from this runbook — it is dirty in another session; see Record the result.

## Steps
All on this laptop from the repo root unless marked **chat**.

1. **Read the ask.** Open the handoff section / PR / chat message from Before you start → expect: one absolute path per line, and for each a manifest row (E3 shape, checklist `:43-45`): size, last-modified, remote URL, HEAD, every local branch with its on-origin proof, stash count, dirty-file count, PII yes/no, classification `duplicate-of-canonical` / `stale-copy` / `unknown`. If any row is missing a field or says `unknown`: **chat** "Not yet: `<path>` — investigate `<field>`" and stop (checklist `:45` "Unknown ⇒ investigate, never delete").
2. **Refuse load-bearing paths on sight.** Compare each path against: `~/lariat_dev/Lariat`; `~/Dev/hospitality/Lariat`, its `LariatNative/`, its `Lariat-KDS/`; `~/Dev/lariat-data-sources`; `~/Library/Application Support/Lariat/data`; repo `data/`; any `lariat-pre-scrub-2026-04-18` (`CLAUDE.md:43-47,71-73`; checklist `:40-42,56`) → expect: none match. If one does: **chat** "Do not delete: `<path>` — load-bearing / pre-scrub" and drop it from the batch.
3. **Re-run the classification yourself.** For each remaining path:
   ```bash
   P="<path>"; C=~/lariat_dev/Lariat
   git -C "$P" remote get-url origin; git -C "$P" rev-parse --short HEAD; du -sh "$P"
   echo "stashes=$(git -C "$P" stash list | wc -l) dirty=$(git -C "$P" -c core.fsmonitor=false status --porcelain | wc -l)"
   git -C "$P" for-each-ref refs/heads --format='%(objectname) %(refname:short)' | while read sha br; do r=$(git -C "$C" branch -r --contains "$sha" 2>/dev/null | head -1 | tr -d ' '); echo "$br ${sha:0:7} -> ${r:-NOT-IN-LOCAL-OBJECTS}"; done
   ```
   → expect: remote is `https://github.com/sburdges-eng/Lariat.git` (or `Lariat-KDS.git`), and every branch prints an `origin/...` ref. A `NOT-IN-LOCAL-OBJECTS` tip is not yet lost: `gh api repos/sburdges-eng/Lariat/commits/<sha> --jq .sha` → the full SHA means GitHub has it; a 404 means it must be exported before any delete. If the agent's row disagrees with what you see: **chat** "Not yet" with the diff.
4. **Confirm everything not on origin is exported and checksummed.** Stashes, orphaned commits, untracked configs go to `~/lariat_dev/stash-archive-<YYYY-MM-DD>/` in the 2026-08-30 shape (`README.md:11-25` per-stash `meta.txt` / `tracked.patch` / `index.patch` / `untracked.patch` and a Restore recipe; `:43` manifest table; `:59` base-commit note; `SHA1SUMS.txt`). Check: `(cd ~/lariat_dev/stash-archive-<date> && shasum -c SHA1SUMS.txt | grep -vc ': OK')` → `0`, and `git apply --stat --binary ~/lariat_dev/stash-archive-<date>/<dir>/tracked.patch` prints a diffstat for each patch. If a patch will not parse or a sum fails: **chat** "Not yet — export is bad" and stop.
5. **Restore-test one export before a ☠ batch (E4, checklist `:46-47`).** In a throwaway worktree on the stash's base commit (from its `meta.txt`): `scripts/worktree.sh new sean restore/<name> <base_commit>` then, inside it, `git apply --binary ~/lariat_dev/stash-archive-<date>/<dir>/tracked.patch && git status --short | head` → expect: files listed, no `error:`. Then `scripts/worktree.sh remove sean-restore-<name>`. If the base commit is missing locally: it was on no remote — it must be in `orphaned-base-commits/` (`README.txt` there has the `git am` recipe) or the answer is "not yet".
6. **PII and data roots get a destination, not a delete.** If the path holds workbooks, PDFs, `lariat.db`, `lariat-data-sources`, or a pre-scrub tree: **chat** "Relocate: `<path>` → `<where>`; verify; then ask again" (plan `:26`; checklist `:59`). Never "delete".
7. **Answer — chat, one line per path, verbatim.** `Delete: <path>` / `Do not delete: <path>` / `Not yet: <path> — <what is missing>`. Keep the batch to what was asked, never "all" (E5, checklist `:48`). Say who does it: the agent on this line, or you. If the same session built the manifest, add "re-verify `git status` and the path first" (checklist `:57-58`). → expect: the agent echoes each line back before touching anything.
8. **Delete reversibly.** Whoever deletes: `mv "<path>" ~/.Trash/` rather than `rm -rf`; empty the Trash only after step 9 passes. → expect: `ls "<path>"` → `No such file or directory`; the dump's other copies untouched.
9. **Re-verify (E5, checklist `:48-49`).** `git -C ~/lariat_dev/Lariat status --short | head; ls -la "$HOME/Library/Application Support/Lariat/data/lariat.db"; open LariatNative/build/Lariat.app` → expect: no new dirty files, the DB the same size as before, the app launches to its boards. If not: put the path back from the Trash and go to If something goes wrong.

## Pass / fail
Handled = every path in the ask has exactly one of the three answers in chat. A `Delete:` line passes only when all of: not load-bearing and not a pre-scrub/PII path (step 2, 6); every branch tip proven on origin or on GitHub (step 3); every stash, orphaned commit and untracked config exported and checksummed (step 4); one restore test done for a ☠ batch (step 5); batch is small and named (step 7); post-delete re-verify green (step 9). Anything short of that is `Not yet:` — that is a pass too. A Phase E batch additionally follows the rails at checklist `:32-36` and the standing prohibitions at plan `:22-26` / checklist `:54-59`.

## Record the result
- Evidence: no template exists (`docs/superpowers/templates/` holds only `service-day-shutoff-log.md`). Use three things: (1) your chat lines copied verbatim into a new dated section at the end of `.agent-sessions/handoff.md` (after line 16): `## YYYY-MM-DD HH:MM MDT — Sean: checkout deletion decision`, one line per path plus the export dir; (2) the export dir `~/lariat_dev/stash-archive-<date>/` with its `README.md` manifest and `SHA1SUMS.txt` — outside the repo, never committed; (3) for a batch that removed something with history, a record doc in the shape of `docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:21-40` ("Salvaged before deletion → …" then "Deleted YYYY-MM-DD (Sean's explicit instruction, after archiving)" with one numbered line per path and why it was safe). The agent drafts (1) and (3); you say "commit".
- Then update:
  - `CLAUDE.md:59-61` (checkout count and where they are) and `:66-68` (Lariat-KDS count) — in their own PR in the shape of #650, **not** on this branch: `CLAUDE.md` is dirty in another session as of 2026-09-02 (`git status` shows ` M CLAUDE.md`). Hand that session the exact sentences, or wait until it lands.
  - `docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:74` ("The recovery dump's remaining checkouts stay read-only backups") — reword only if a dump checkout went.
  - `docs/superpowers/plans/2026-08-05-phase-e-consolidation.md:17-19` E3/E4/E5 boxes — tick only if this was a Phase E batch under E1/E2; an interim prune leaves them alone.
  - `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:19-37` — already stale (names `hospitality/Lariat` canonical and the false 2026-07-22 archive path); the E1 runbook owns that rewrite. Do not partially edit it here.
  - This runbook's **Status** line: `recurring — last handled YYYY-MM-DD (<n> paths, see handoff.md § …)`.
  - `docs/runbooks/person-only/README.md:11-14` index — add `| [approve-duplicate-checkout-deletion](approve-duplicate-checkout-deletion.md) | Approve any deletion of a duplicate Lariat checkout or data root | recurring — last 2026-08-31 |`. The README is owned by today's go-live session; add the row once that session is done.

## Close out
```bash
scripts/worktree.sh new sean chore/approve-duplicate-checkout-deletion
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main. Only `.agent-sessions/handoff.md`, the record doc, and this runbook go in — never the export dir, never `CLAUDE.md` while it is dirty elsewhere.

## If something goes wrong
- **Wrong path deleted, still in the Trash:** drag it back (or `mv ~/.Trash/<name> "<original parent>/"`); re-run step 3 on it.
- **Wrong path `rm -rf`'d:** branch tips come back with `git fetch origin && git checkout -b <br> origin/<br>`; stashes with the Restore recipe at `~/lariat_dev/stash-archive-2026-08-30/README.md:19-25` (`git apply --3way` if the base moved); the orphaned commit with `orphaned-base-commits/README.txt`. Nothing else in a duplicate-of-canonical copy is unique — that is what step 3 proved.
- **A `lariat-pre-scrub-2026-04-18` copy went:** its HEAD `b0c20f5` is on no remote. The two other dump copies are the fallback; the SSD `~/Dev/_archives/lariat-pre-scrub-2026-04-18` is last and unverified. If all four are gone, pre-scrub history is unrecoverable — say so in `handoff.md`, do not paper over it.
- **An agent deleted without your line:** stop that session, write what it did in `.agent-sessions/handoff.md`, re-run the inventory: `for r in ~/lariat_dev ~/Documents/Codex ~/Dev; do [ -d "$r" ] || continue; find "$r" -maxdepth 14 \( -path "*/node_modules" -o -path "*/.build" \) -prune -o -name .git -print 2>/dev/null; done | while read g; do d=$(dirname "$g"); u=$(git -C "$d" remote get-url origin 2>/dev/null); case "$u" in *[Ll]ariat*) echo "$d | $u | $(git -C "$d" rev-parse --short HEAD)";; esac; done`.
- **Re-verify fails after a delete:** put the path back from the Trash first, then diagnose. A missing `lariat.db` means a data root, not a checkout, was hit — `LARIAT_DATA_DIR` in `.env.local:13` names the only live one.
- **SSD unmounted mid-task:** every `~/Dev/...` answer becomes "Not yet". Nothing on the SSD can be verified or deleted while `test -d ~/Dev` fails.
- Who to tell: nobody but the next agent — the handoff.md entry is the notice.
