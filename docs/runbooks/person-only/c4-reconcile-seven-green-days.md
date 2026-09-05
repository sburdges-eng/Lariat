# C4: run the nightly reconcile over ≥7 consecutive green live service days

**Why this is yours:** Seven real service days must pass on the venue Mac with someone running `scripts/phase-c-reconcile.mjs` against the live `data/lariat.db` every night; agents have no venue Mac, no live DB (this laptop has no `data/lariat.db`), and cannot fast-forward calendar time (index:25 "ops window"; c4:18-23; simulate:5-10).
**Unblocks:** Front 3 / C5 write-route cutover (c4:39; c5:4,14) → Phase D.
**Where:** venue Mac (day 0 + every night); this laptop only for the tooling preflight and the PR.  **Time:** day 0 ≈ 60 min; then ≈10 min per night × 7; calendar ≥7 consecutive service days.
**Status:** open — per `docs/superpowers/plans/2026-08-05-c4-reconcile.md:4` (`status: planned — gated on G0 PASS`; tasks 1–6 all unchecked at `:18-23`). G0 itself is still **FAIL / owner-pending** (`docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md:51`; `docs/PROJECT_STATUS.md:58`), so this cannot start today.

## Before you start
- [ ] G0 service-day shutoff is **PASS** and its log is filed — check: `ls docs/superpowers/plans/*service-day-shutoff-log.md && grep -n "| G0 " docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md` → a filed log exists and the G0 row reads `**PASS**` (today it reads `**FAIL**`). Hard gate (c4:14; g0:146).
- [ ] Reconcile tooling green (this laptop, repo root) — check: `node --test tests/js/test-phase-c-reconcile.mjs && node scripts/phase-c-reconcile-simulate.mjs && npm run test:actor-source-parity` → all exit 0. The parity test is c4 task 6 (`ActorSource` enum ↔ reconciler set).
- [ ] Venue Mac has a repo checkout with Node 24 and a built `better-sqlite3` — check (venue Mac, checkout root): `node --version && node -e "require('better-sqlite3'); console.log('ok')"` → `v24.x` and `ok`. `.nvmrc` pins 24; better-sqlite3 is compiled for that ABI.
- [ ] `sqlite3` CLI present on the venue Mac — check: `command -v sqlite3` → `/usr/bin/sqlite3`. Required by the backup/restore script.
- [ ] Live DB exists where the writers write — check (venue Mac): `ls -la "${LARIAT_DATA_DIR:-$PWD/data}/lariat.db"` → file listed. Web resolves `LARIAT_DATA_DIR` else `<cwd>/data`; native mirrors that, with a packaged fallback of `~/Library/Application Support/Lariat/data/lariat.db`.
- [ ] Seven consecutive service days picked, with one named person to run the nightly (c4:19). No command — calendar decision.

## Steps

**Day 0 — venue Mac, from the repo checkout root.** Pick `DAY1` = first service day of the window (YYYY-MM-DD). Use the same `DAY1` every night.

1. **Resolve the live DB path.** `export DB="${LARIAT_DATA_DIR:-$PWD/data}/lariat.db"; ls -la "$DB" "$(dirname "$DB")/audit"` → both listed. If not: set `LARIAT_DATA_DIR` to the directory the running app actually uses (packaged native default is `~/Library/Application Support/Lariat/data`) and re-export.
2. **Confirm native and web write the same file.** Make one write in the native app and one in the web app, then `ls -la "$DB" "$DB-wal"` → mtime advanced after each. If only one advances, the two writers use different DBs — stop; C4 would measure one writer only (open question 7).
3. **Take the day-0 backup.** `scripts/phase-c-backup.sh --db "$DB" --audit-dir "$(dirname "$DB")/audit"` → prints `phase-c-backup: wrote backups/<STAMP>` plus a manifest with SHA256s. If it exits 2 with "audit dir not found": the JSONL audit dir is missing — locate it (`LARIAT_AUDIT_PATH` override or `<dataDir>/audit/management-actions.jsonl`) before continuing; it refuses a half backup by design.
4. **Restore drill (c4 task 3).** `scripts/phase-c-backup.sh verify backups/<STAMP>` → every line `[PASS]` and final `phase-c-backup verify: PASS` (re-checks SHA256SUMS, restores to a temp copy, `integrity_check`, `foreign_key_check`, row counts, tarball readable). If FAIL: the backup is unusable — re-run step 3, do not start the window on an unverified backup.
5. **"App opens" half of the drill.** No script does this. Copy `backups/<STAMP>/lariat.db` into an empty scratch folder and launch a native build with `LARIAT_DATA_DIR` pointing at that folder (native honors the env var); confirm a board renders. Record the SHA256 from `backups/<STAMP>/SHA256SUMS` in the window log. Quit that instance.
6. **Dry-run the reconcile on the backup copy (c4 task 1).** `node scripts/phase-c-reconcile.mjs --db backups/<STAMP>/lariat.db --audit-dir "$(dirname "$DB")/audit" --since <DAY1> --snapshot backups/<STAMP>/dryrun-snapshot.json; echo "exit=$?"` → table ends `RECONCILE: PASS`, `exit=0`. `INFO` rows are not failures. `writer_attribution` and `canonical_actor_source` scan all history; a FAIL there is pre-existing data and will fail every night — resolve or get a decision before DAY1 (open question 5). The throwaway `--snapshot` keeps the dry run from baselining the real snapshot.
7. **Fix the ritual (c4 task 2).** Write who runs it, the nightly run time (see UTC note in step 9), and the log path into the window log header (`docs/superpowers/plans/<DAY1>-c4-reconcile-window.md`, proposed — open question 1). Do not touch `data/cache/phase-c-reconcile-snapshot.json` from here on: the first nightly run creates the baseline.

**Nights 1–7 — venue Mac, repo checkout root, after close-out, same clock time every night.** Operate normally during the day: C4 is the coexistence window (native + web writers together); no shutoff is required.

8. **Run the reconcile.**
   ```bash
   export DB="${LARIAT_DATA_DIR:-$PWD/data}/lariat.db"
   mkdir -p docs/superpowers/plans/c4-logs
   node scripts/phase-c-reconcile.mjs --db "$DB" --audit-dir "$(dirname "$DB")/audit" --since <DAY1> > "docs/superpowers/plans/c4-logs/$(date +%F)-reconcile.txt" 2>&1; echo "exit=$?"
   tail -1 "docs/superpowers/plans/c4-logs/$(date +%F)-reconcile.txt"
   ```
   → `exit=0` and `RECONCILE: PASS`. Name the file for the service day just closed if you run after local midnight. Same `--since`, default `--snapshot` (`data/cache/phase-c-reconcile-snapshot.json`, gitignored) every night — the day-over-day money comparison depends on it.
9. **Read the table.** Any row with `FAIL` = red night (exit 1). `exit=2` = usage/environment (wrong `--db`, bad date), not a data verdict — fix and re-run. Night 1's `money_checksums` rows read `baseline captured (no prior snapshot)` — that is PASS; drift detection starts night 2. Note: "today" in the script is the **UTC** date, so after ~5 pm local the local service day already counts as "past" for `shift_date`-keyed money tables; enter late corrections for a day *before* its run, never after (open question 4).
10. **Log the night.** Add a row to the window log: date, exit code, PASS/FAIL, `FAIL` rows verbatim, snapshot `generated_at`, initials. Link the `c4-logs/<date>-reconcile.txt` file.
11. **Spot-check money once mid-window and once on night 7 (c4 task 5).** No script exists for "recipe_costs TOTAL vs SUM; sample variance" (open question 3). Manual: open the day's settlement/costing totals in the app and compare against the per-table daily sums the reconcile wrote to `data/cache/phase-c-reconcile-snapshot.json` (`tables.<table>.days.<day>.sums`); record match/mismatch in the window log.
12. **After night 7 green.** Take the closing backup — repeat steps 3–4; this is the "C4 backup" C5's rollback rehearsal restores from (c5:29). On this laptop re-run `npm run test:actor-source-parity` → exit 0 (c4 task 6). Then Record and Close out.

## Pass / fail
From the plan's gate table (c4:27-31):
- **Restore drill:** one documented restore with checksums — step 4 `verify: PASS` + step 5 app opened, SHA256 recorded.
- **7 green days:** seven **consecutive** nightly runs, each exit 0 / `RECONCILE: PASS`, with the daily outputs linked (c4:21,30). A red night breaks the streak: fix or explain, then restart the count at night 1.
- **Integrity:** no unexplained audit gap (`audit_coverage` FAIL) or money drift (`money_checksums` FAIL) anywhere in the window (c4:31). "Explained" means the cause is written in the window log with the audit_events evidence.
- Not failures: `INFO` rows (unattributable tables, skipped joins, mutable-only money tables, audit dir count).

## Record the result
- Evidence: `docs/superpowers/plans/c4-logs/<YYYY-MM-DD>-reconcile.txt` × 7 (raw script output) and `docs/superpowers/plans/<DAY1>-c4-reconcile-window.md` (header: who/when/where; table: one row per night; restore-drill block with `backups/<STAMP>` path + SHA256SUMS lines; spot-check rows). **Both paths are proposed** — c4 task 2 is the doc that fixes them; write the chosen path into that task line. `backups/` and `data/cache/*.json` are gitignored — commit only the text logs and doc edits.
- Then update:
  - `docs/superpowers/plans/2026-08-05-c4-reconcile.md:4` status → `done <date> — 7 green days <DAY1>..<DAY7>`; tick tasks 1–6 at `:18-23`; put the link/backup path in each gate row at `:29-31`.
  - `docs/superpowers/plans/2026-08-05-native-1-0-gap-execution-index.md:4` status line and row `:25` (Front 2) — mark exited; per the status-sync rule at `:69-77` also edit the three docs below in the same PR.
  - `docs/LARIAT_NATIVE_FINAL_AGENT_GUIDE.md:72` bullet "Phase C4 reconciliation" → done with date.
  - `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md:117` — note "7-day window green <date>" (box stays open until C5).
  - `docs/superpowers/plans/2026-07-07-native-0.2-l1-status.md:38` row "C4 shutoff + ≥7 green days" → done.
  - `docs/superpowers/plans/2026-08-05-c5-write-cutover.md:4` → `gated on C4` → `C4 green <date>; awaiting Opus/Max review`.
  - `docs/PROJECT_STATUS.md:48` row "Native 1.0 gap fronts" — add C4 done, C5 next; refresh the as-of SHA at `:10` (rule at `:132`).
  - `tasks.yaml:17` comment line "Front 2 C4 reconcile … needs a >=7-day ops window" → done.
  - `docs/OPERATIONS_HANDOFF.md` — has no C4 row (last updated 2026-06-12, `:3`); nothing to strike, add nothing.
  - `docs/runbooks/person-only/README.md` status column — only if that index exists by then (the directory does not exist today).

## Close out
```bash
scripts/worktree.sh new sean chore/c4-reconcile-window
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main.

## If something goes wrong
- **`exit=2`** — path or flag problem (`DB not found`, non-`YYYY-MM-DD` date); fix and re-run the same night. Not a red night.
- **`money_checksums` FAIL "past-day drift"** — a past day's money sum changed. Find who via `audit_events` for that table/day. Legitimate + explained: write it up, delete `data/cache/phase-c-reconcile-snapshot.json` to re-baseline (the script keeps the old checksum so it fails every night until you do), restart the streak. Unexplained: integrity gate FAIL — do not start C5.
- **`audit_coverage` FAIL** — mutation rows with no `audit_events` row (example ids in the DETAIL column). A writer is bypassing `postAuditEvent`; hand the log file to an agent session as a code bug. Streak restarts after the fix ships.
- **`canonical_actor_source` / `writer_attribution` FAIL** — a writer used a value outside the canonical set, or wrote none. Fix the writer. Historical rows are never rewritten (spec §C3), so if the offending rows predate the window you need a decision, not a fix (open question 5).
- **Rollback of the live DB** — only from the verified day-0 backup, only with both writers quit; no script restores over the live file — replace `$DB` with `backups/<STAMP>/lariat.db` by hand and make sure no stale `-wal`/`-shm` sidecar survives. Re-verify with `scripts/phase-c-backup.sh verify backups/<STAMP>` first.
- **During the window never:** enable native `SchemaMigrator` on the live DB, delete web write routes, or freeze web migrations (c4:33-37). Those are C5 steps and each would invalidate the window.
- **Who to tell:** post the red night's log path in chat; an agent can triage the DETAIL column. Restart the seven-day count only after the cause is closed.
