# Front 0 Part B: full live service day with Next.js OFF; fill and sign the shutoff log

**Why this is yours:** Only the owner/PIC can run a real service day on the venue Mac with the web server off and sign the log (g0 plan "Who runs what": Owner / PIC, live venue Mac). No filled `*-service-day-shutoff-log.md` exists under `docs/superpowers/plans/` — only the template and the plan.
**Unblocks:** Front 2 C4 reconcile window (c4-reconcile.md is "gated on G0 PASS"); endgame DoD §5 "§2 shut-off test passes"; Native 1.0.x row in the taxonomy ("Blocked on G0, C4, C5, H8").
**Where:** venue Mac — per the 2026-08-31 salvage record this laptop *is* the venue/testing Mac; no separate venue Mac exists.  **Time:** 1 service day + ~30 min before (backup, log setup) + ~30 min after (verdict, doc rows, PR).
**Status:** open — per `docs/superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md:4` (`ready-for-owner`) and `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md:51` (G0 **FAIL**).

## Before you start
Run every check from `/Users/seanburdges/lariat_dev/Lariat` in one terminal.

- [ ] **Part A (GUI smoke) recorded PASS.** Today it is NOT: verify-0.2 evidence still says `PENDING owner`, l1-status says `Owner-pending`. Do Part A first (g0 plan §A1–A4) or consciously run Part B anyway — the plan only requires Part A for the 0.2 freeze claim, not for G0. — check: `sed -n '26p' docs/superpowers/plans/2026-07-10-phase4-verify-0.2-evidence.md; sed -n '118p' docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md` → want `PASS` on both lines.
- [ ] **Live DB is the one under Application Support** (native resolves there when launched from Finder). — check: `ls -la "$HOME/Library/Application Support/Lariat/data/lariat.db"*` → `lariat.db`, `-shm`, `-wal` listed (7.9 MB DB measured 2026-09-01).
- [ ] **It is the real venue DB, not the smoke fixture.** The salvage record says the recovered Aug-5 real DB was promoted into Application Support, but its "Standing cautions" still calls that tree a smoke fixture — you decide which is true by looking. — check: `sqlite3 -readonly "$HOME/Library/Application Support/Lariat/data/lariat.db" 'SELECT name FROM entities_employees; SELECT COUNT(*) FROM audit_events;'` → real staff names, not fixture names (measured: 5 employees, 267 audit rows).
- [ ] **Manager PIN exists** (no-PIN installs fail closed on manager/costing/shows reads since #607/#609 and would sink the day). — check: `sqlite3 -readonly "$HOME/Library/Application Support/Lariat/data/lariat.db" 'SELECT COUNT(*) FROM manager_pin_users;'` → `≥ 1` (measured: 2).
- [ ] **`sqlite3` on PATH** (backup script refuses without it). — check: `command -v sqlite3` → `/usr/bin/sqlite3`.
- [ ] **Next.js not running.** — check: `lsof -i :3000; pgrep -fl 'next (dev|start)'` → both print nothing (both empty 2026-09-01). The web scripts bind `-p 3000`; there is no launchd unit for Next in this repo, so "OFF" just means do not start `npm run dev` / `npm start` and do not launch the Electron `desktop/` wrapper.
- [ ] **Built native app present.** — check: `defaults read "$PWD/LariatNative/build/Lariat.app/Contents/Info.plist" CFBundleShortVersionString CFBundleVersion 2>/dev/null || defaults read "$PWD/LariatNative/build/Lariat.app/Contents/Info.plist"` → version `0.2.0`, build `2047` (measured). Rebuild with `cd LariatNative && Scripts/package-app.sh --version 0.2.0` if missing.
- [ ] **Edge-blocker list read** (the only breaks allowed). — check: `sed -n '25,70p' docs/superpowers/specs/lariat-native-edge-blockers.md` → three surfaces: guest BEO share-and-sign, PWA/remote, peers/cloud-bridge transport.

## Steps
All on the venue Mac (this laptop), terminal at the repo root, unless stated.

**Pre-day (plan B1)**

1. **Quit any running Lariat.** Cmd-Q in the app → expect: `pgrep -x Lariat` prints nothing. If not: quit it from the Dock; do not `kill -9` a writing app.
2. **Make the audit dir exist** (native creates it on first audited write, but `phase-c-backup.sh` refuses a backup without it). `mkdir -p "$HOME/Library/Application Support/Lariat/data/audit"` → expect: no output.
3. **Back up DB (+WAL/SHM, via sqlite online backup) and audit dir.** `scripts/phase-c-backup.sh --db "$HOME/Library/Application Support/Lariat/data/lariat.db" --audit-dir "$HOME/Library/Application Support/Lariat/data/audit"` → expect: manifest printed, last lines `phase-c-backup: wrote backups/<UTC-stamp>` and a `verify with —` hint. If not: read the `phase-c-backup:` error (missing DB/audit dir/sqlite3) and fix; do not start the day without a backup.
4. **Restore-test the backup.** `scripts/phase-c-backup.sh verify backups/<UTC-stamp>` → expect: `[PASS]` on checksums, integrity_check, foreign_key_check, row counts (`entities_employees`, `locations`, `audit_events`), audit tarball; final `phase-c-backup verify: PASS`. If FAIL: the live DB is suspect — stop and investigate before service.
5. **Capture the checksum for the log.** `cat backups/<UTC-stamp>/SHA256SUMS` → expect: two sha256 lines. Copy them into the log (step 6); `backups/` is gitignored, so the text in the log is the evidence.
6. **Create today's log from the template.** `cp docs/superpowers/templates/service-day-shutoff-log.md docs/superpowers/plans/$(date +%F)-service-day-shutoff-log.md` → expect: new file. Then fill Run metadata: Date, Location, Tester, Native build (`git rev-parse --short HEAD` + `.app` 0.2.0 build 2047), Next.js row = **OFF** plus how verified (`lsof -i :3000` empty). Change the frontmatter `status:` from `template — fill when test runs` to `filled — <date>`. Print it or keep it open all day.
7. **Confirm Next.js is OFF at open.** `lsof -i :3000; pgrep -fl 'next (dev|start)'` → expect: nothing. If something listens: find whose terminal it is and Ctrl-C it (your own `npm run dev`/`npm start`); never blind-kill an unknown PID.
8. **Confirm a manager PIN exists.** `sqlite3 -readonly "$HOME/Library/Application Support/Lariat/data/lariat.db" 'SELECT COUNT(*) FROM manager_pin_users;'` → expect: `≥ 1`. If `0`: launch Lariat (step 9), open **Manager → PINs**, add the first PIN (allowed without an unlock on a fresh install, #606), then re-run the query.
9. **Launch the native app from Finder, not from a repo terminal.** Double-click `LariatNative/build/Lariat.app` or run `open LariatNative/build/Lariat.app` → expect: window opens, boards populated with venue data. If boards are empty/"not set up": you launched with a cwd inside the repo (the dev cwd-walk finds `scripts/beo_cascade_cli.py` and points at `<repo>/data`, which has no `lariat.db`) or `LARIAT_ROOT`/`LARIAT_DATA_DIR`/`LARIAT_PYTHON` are set — quit, unset them, relaunch from Finder.

**During service (plan B2/B3)**

10. **Run the whole day in the native app.** Exercise every tier the venue uses today; minimum for a G0 claim (plan B2 table): cook (today / 86 / stations or KDS), safety (≥1 HACCP write: temp or receiving), labor (breaks or punch-adjacent), inventory (count, waste, or par glance), manager (command alerts or morning digest), costing (variance or recipe cost read), purchasing (order guide glance), beo (cascade + prep if event day, else N/A), assistant (one audited write: scale or 86), foh/shows/house only if used today. Tick each row in the log's **Boards exercised** table as it happens; write the board name in the Board column.
11. **Do the regulated-writes spot-check** (log table: HACCP temp log, 86 item, BEO prep done if applicable, Assistant scale_recipe). For each: note whether a PIN was demanded, then confirm an audit row landed: `sqlite3 -readonly "$HOME/Library/Application Support/Lariat/data/lariat.db" 'SELECT id, entity, action, actor_source, created_at FROM audit_events ORDER BY id DESC LIMIT 5;'` → expect: a new row for the action just taken (also visible in the in-app manager audit-log viewer). If no row: that is an unexpected failure — log it (step 12).
12. **Log every surprise immediately** in the log's **Unexpected failures (blockers)** table (#, what failed, severity, ticket/fix). Only guest BEO e-sign, PWA/remote, and peers/cloud-bridge may break; record those in **Known gaps / edge surfaces** with "broke as expected? yes". Anything else that stops an operator = G0 FAIL for the day (keep running to collect all blockers, unless service itself is at risk — see "If something goes wrong").
13. **Re-check Next.js mid-shift and at close.** `lsof -i :3000` → expect: nothing both times. If it is listening, the day does not count as a shutoff; note when/why in Run metadata.

**After day (plan B4)**

14. **Fill Duration, then the Gate verdict.** Tick **G0 PASS** only if every needed tier ran and the Unexpected-failures table has no operator-blocking row; otherwise tick **G0 FAIL** and leave the blockers listed. Complete the **Sign-off** line (name + date).
15. **Do the doc rows in "Record the result", then hand off** per the plan's handoff snippet: reply `G0 pass` / `G0 fail <note>` in chat so an agent does the remaining doc flip and starts C4.

## Pass / fail
- **PASS:** shutoff log filed under `docs/superpowers/plans/`, every tier the venue used that day completed natively, only edge-blocker surfaces broke, no unexpected operator-blocking failure, sign-off line completed (plan Acceptance row B; plan B3: "Any operator-blocking unexpected failure → G0 FAIL").
- **Exit B (PASS):** C4 reconcile window may start (Front 2).
- **Exit B (FAIL):** file blockers in the log; no C5; fix and re-run a **full** day — partial days do not count.
- A day where Next.js was found listening on :3000 is not a shutoff day; re-run.

## Record the result
- Evidence: `docs/superpowers/plans/YYYY-MM-DD-service-day-shutoff-log.md` (copied from `docs/superpowers/templates/service-day-shutoff-log.md`). Fill: Run metadata (all 6 rows; Next.js row must say OFF + how verified), Boards exercised (tick + board name per tier used; N/A the rest), Regulated writes spot-check (PIN? / audit row? / pass for all 4), Known gaps (only edge-blocker surfaces), Unexpected failures (every surprise), Gate verdict (exactly one box), Sign-off + date. Paste the two `SHA256SUMS` lines and the `backups/<stamp>` path into the Run metadata notes.
- Then update (same PR, per the gap-index "Status sync rule"):
  - `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md:51` — G0 row `**FAIL**` → `**PASS**` (or stays FAIL) with a link to the log.
  - `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md:116` — tick `[x] §2 shut-off test passes` (PASS only) and add a one-line dated verdict + log link under §2 (lines 38–47).
  - `docs/PROJECT_STATUS.md:58` — "Service-day shutoff test" bullet under "Blocked on an owner decision": remove or mark done with the log link.
  - `docs/NATIVE_RELEASES_AND_TAXONOMY.md:22` — Native 1.0.x row: drop "G0" from "Blocked on G0, C4, C5, H8".
  - `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md:23` — Front 0 row: mark Part B done; `:4` status line.
  - `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:70` — "Front 0" bullet under "What still blocks": strike G0; `:202` guardrail item 6 satisfied.
  - `docs/superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md:4` — status line; tick B1/B2/B4 boxes (`:96-100`, `:139-144`).
  - `docs/superpowers/plans/2026-08-05-c4-reconcile.md:4` — status `planned — gated on G0 PASS` → active (PASS only).
  - `docs/OPERATIONS_HANDOFF.md` — no G0/native row exists (sections §1–§6 are iPad profiling, v2 cutover, tier-0, integrations, Spanish copy, Whisper); nothing to strike.

## Close out
```bash
scripts/worktree.sh new sean chore/g0-service-day-shutoff-log
```
Commit the log and doc updates on that branch (worktree lands at `../Lariat-worktrees/sean-g0-service-day-shutoff-log/`) and open a PR (the repo's /ship skill rebases on `origin/main`, runs `bash scripts/verify.sh`, then `gh pr create --fill`; `gh` auth is interactive-only, so do it from your own terminal). Never push to main. Do not commit `backups/` (gitignored) or the DB.

## If something goes wrong
- **Operator-blocking failure that threatens service:** keep the restaurant running first. Fall back to the web app for the rest of the day — but the web resolves its DB from `LARIAT_DATA_DIR` or `<cwd>/data`, and `data/lariat.db` does not exist in this checkout, so start it with `LARIAT_DATA_DIR="$HOME/Library/Application Support/Lariat/data" npm start` (untested path; see open questions) or accept a split day. Either way the day is **G0 FAIL**: log the blocker, do not start C5, fix, re-run a full day.
- **DB damage suspected:** quit Lariat; `scripts/phase-c-backup.sh verify backups/<stamp>` still PASSes → manually copy `backups/<stamp>/lariat.db` over `~/Library/Application Support/Lariat/data/lariat.db` and remove the stale `-wal`/`-shm` sidecars before relaunch. There is no scripted restore; this is a hand step — do it deliberately and note it in the log.
- **Backup or verify FAIL before service:** do not run the shutoff that day.
- **Next.js found listening on :3000 mid-day:** the day is void as a shutoff test; note it, finish service however is safest, re-run another day.
- **Who to tell:** reply in chat (`G0 pass` / `G0 fail <note>`); the agent side owns the doc flip PR and C4 kickoff.
