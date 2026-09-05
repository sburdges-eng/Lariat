# Go-live: serving topology, DB of record, and launcher traps

**Why this is yours:** No doc names the serving machine, the serving process, or which SQLite copy is truth — that is a deployment/product decision. The scripts an agent would reach for either FATAL (`scripts/install-prod-data.sh:32-35`, no `data/lariat.db` here) or would clobber the live Application Support DB one-way (`:55-63`), and the launcher kill-9s port 3000 then starts the *dev* server (`scripts/launch_lariat.sh:12-15,23`).
**Unblocks:** the 2026-09-02 ops-only launch; a safe G0 service-day run (`docs/superpowers/plans/2026-08-05-g0-gui-smoke-and-shutoff.md` Part B, `:89-147`).
**Where:** chat + this laptop — this Mac *is* the venue Mac; no separate one exists (`docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:63-64`).  **Time:** 30m
**Status:** open — per `docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:55` ("decide deployment shape") and `:57` (LAN-hub / iPad = "Sean's call"); no go-live row exists in `docs/PROJECT_STATUS.md:55-62` or `docs/OPERATIONS_HANDOFF.md`.

## Before you start
- [ ] You are on the venue Mac (hostname `Mac.lan` on 2026-09-01) — check: `test -f "$HOME/Library/Application Support/Lariat/data/lariat.db" && echo venue-db-present`
- [ ] PIN + secret in `.env.local` (runbook `env-local-pin-secret`; `.env.example:11-14` says required for prod; without them regulated routes fail closed / 503 — `tests/js/test-unconfigured-install-fails-closed.mjs:2,12-13`) — check: `grep -cE '^LARIAT_PIN(_SECRET)?=.+' .env.local` → `2`. **2026-09-01: `0`** — `.env.local:9` sets only `LARIAT_DATA_ROOT`, which is the *datapack* root (`lib/datapackSearch.ts:34`), not the DB root.
- [ ] Production build present (needed by `npm run start`, `package.json:10,51`) — check: `cat .next/BUILD_ID` (2026-09-01: `dLL-EnYJZxpti3HdMhFlJ`)
- [ ] Nothing on :3000 and no Lariat.app running — check: `lsof -nP -iTCP:3000 -sTCP:LISTEN; pgrep -lx Lariat; echo done` → only `done`
- [ ] `sqlite3` on PATH (`scripts/install-prod-data.sh:77` uses it) — check: `command -v sqlite3`

## Steps
1. **Inventory every DB copy on this Mac.** (this laptop)
   ```bash
   ls -la "$HOME/Library/Application Support/Lariat/data/"lariat.db* data/lariat.db* "$HOME/lariat_dev/stash-archive-2026-08-30/app-lineage-20260831/"*.db 2>&1
   ```
   → expect: App Support `lariat.db` (+`-wal`, `-shm`), the archive `hybrid-smoke-db-backup-20260831.db`, and `data/lariat.db*: No such file or directory` (`data/lariat.db` is gitignored, `.gitignore:6-9`; 2026-09-01: absent). If `data/lariat.db` **exists**: a web process ran from this checkout without `LARIAT_DATA_DIR` (`lib/dataDir.ts:32-36` falls back to `<cwd>/data`; `lib/db/connection.ts:45-53` creates it; `README.md:164`). Move it aside (`mv data/lariat.db* <scratch>/`), note it in the record, and **never** run `scripts/install-prod-data.sh` — it would copy that stray file over the live DB after `pkill -x Lariat` (`:38-46`, `:55-63`).

2. **Fingerprint the App Support DB (read-only).** (this laptop)
   ```bash
   DB="$HOME/Library/Application Support/Lariat/data/lariat.db"
   sqlite3 -readonly "$DB" "PRAGMA integrity_check; SELECT MAX(version) FROM schema_migrations; SELECT COUNT(*) FROM line_check_entries; SELECT COUNT(*), MAX(created_at) FROM audit_events;"
   ```
   → expect: `ok`, `6`, then counts. 2026-09-01 read: `ok` / `6` (applied 2026-08-31 09:17:08) / `79` / `267|2026-08-31 09:34:48`; file 7,892,992 B, mtime Aug 31 03:17, WAL Aug 31 18:36. If not `ok`: stop — see "If something goes wrong".

3. **Decide the DB of record (chat).** The salvage record says this DB is the recovered Aug-5 real DB, migrated v5→v6 and promoted into Application Support (`2026-08-31-app-lineage-salvage.md:63-66`) — yet the same file calls the seeded App Support tree "a smoke fixture, not venue data" (`:77-78`). Only you know which is true. Reply one line: `DB of record: ~/Library/Application Support/Lariat/data/lariat.db` **or** `restore first from <path>`. → expect: exactly one path named. If "restore first": stop here, do the restore (replace files while everything is stopped — `docs/OPERATIONS.md:101`), then redo step 2.

4. **Decide the serving mode for 2026-09-02 (chat).** Pick one:

   | Mode | Start command | Who reaches it | DB it opens |
   |---|---|---|---|
   | **A — web hub** | `npm run start` = `next start -H 0.0.0.0 -p 3000` (`package.json:51`) | iPads/phones on LAN; mDNS auto-advertised (`instrumentation.ts:47-48`, `lib/mdnsAdvertiseLifecycle.ts:31-34`); the iPad precedent is `docs/audit/2026-06-09-ipad-gen7-hardware-runbook.md:55-64` | `LARIAT_DATA_DIR`, else `<repo>/data` (`lib/dataDir.ts:32-36`) |
   | **B — native** | `open LariatNative/build/Lariat.app` (v0.2.0, build 2047, ad-hoc signed, no baked `LSEnvironment`) | this Mac only — native serves no ports; iPads need the web hub (`salvage:57`) | `LARIAT_DATA_DIR` → repo-marker walk → App Support (`LariatNative/Sources/LariatModel/StationCatalog.swift:144-163`) |

   Not an option for 09-02: the Electron wrapper (`desktop/`) — no `~/Library/Application Support/Lariat/settings.json` exists so the first-run wizard would run (`desktop/main.ts:175-183`), and `npm run desktop:dist` flips the shared `better-sqlite3` binding (`desktop/README.md:14`, `CLAUDE.md:99`). Running A and B together = two writers on one WAL: `package-app.sh:34-37` says safe, `install-prod-data.sh:11-14` says never — on launch day, **one at a time**. → expect: reply `Mode: A` or `Mode: B`.

5. **Pin the data root.** (this laptop)
   - Mode A: add one line to `.env.local` (Next reads `.env.local`; `docs/OPERATIONS.md:93` already puts `LARIAT_PIN` there; `.env.example:16-17` documents the value):
     ```
     LARIAT_DATA_DIR=/Users/seanburdges/Library/Application Support/Lariat/data
     ```
     check: `grep -n '^LARIAT_DATA_DIR=' .env.local` → 1 line (2026-09-01: none).
   - Mode B: add nothing. Launch only via Finder or `open …` — LaunchServices gives cwd `/`, so resolution lands on App Support (`package-app.sh:26-28`, `StationCatalog.swift:158-163`). **Do not** run the binary directly from inside the repo (`PACKAGING.md:54-55` style): the marker walk finds `scripts/beo_cascade_cli.py` (`StationCatalog.swift:148`, present here) and picks `<repo>/data` — an empty DB. **Do not** rebuild with `--data-dir` (`package-app.sh:20-22,39-40`).

6. **Take the checksum backup of the DB of record (evidence; G0 B1 `:96`).** (this laptop)
   ```bash
   LARIAT_DATA_DIR="$HOME/Library/Application Support/Lariat/data" npm run backup
   ```
   → expect: `backups/<stamp>/` with `SHA256SUMS` + `manifest.json`; integrity_check runs before success (`scripts/backup.mjs:14`, default dir `:59-61`; gitignored `.gitignore:36`). Then `npm run backup -- verify backups/<stamp>` (`backup.mjs:22`) → restore drill passes. Copy the `lariat.db` line of `SHA256SUMS` into the record. If it fails: the DB is not launch-ready — go to "If something goes wrong".

7. **Smoke-start the chosen mode once, then stop it.** (this laptop)
   - Mode A — terminal 1: `npm run start` → expect a ready line on port 3000. Terminal 2: `curl -s http://127.0.0.1:3000/api/health` → JSON (`degraded` is fine: integrations unset, `docs/OPERATIONS_HANDOFF.md:53-56`); `ls data/lariat.db` → `No such file or directory` (proves the env took — no repo DB was created); `lsof "$HOME/Library/Application Support/Lariat/data/lariat.db"` → a node/next row. Ctrl-C terminal 1. If `data/lariat.db` **appeared**: the `.env.local` line is missing or misspelled — delete the new empty file, fix, repeat; fallback is `export LARIAT_DATA_DIR=...` in the launch shell.
   - Mode B — `open LariatNative/build/Lariat.app` → window opens, boards show data; `lsof "$HOME/Library/Application Support/Lariat/data/lariat.db"` → `LariatApp` row. ⌘Q. If boards are empty: it opened another dir — `env | grep LARIAT` in the launching shell, unset (`g0 plan:34`), relaunch via Finder.

8. **Confirm no scheduler trap is armed.** (this laptop)
   ```bash
   crontab -l; ls "$HOME/Library/LaunchAgents" | grep -i lariat; launchctl list | grep -i lariat; echo checked
   ```
   → expect: `crontab: no crontab for seanburdges` and `checked` only (2026-09-01: true). Do **not** install either for 09-02: `examples/lariat.crontab:16-40` hardcodes `$HOME/Dev/Lariat/scripts/cron-wrapper.sh` (`~/Dev` is the unmounted SSD; `:7` says adjust), `scripts/install-cron.sh:75-79` copies the block verbatim, `scripts/cron-wrapper.sh:38,56` cd's to the repo and never exports `LARIAT_DATA_DIR` so every job would hit `<repo>/data`; `ops/launchd/com.seanburdges.lariat.mdns-responder.plist:35,47` hardcodes `/Users/seanburdges/Dev/Lariat` and must not run beside `npm run start` (`ops/launchd/README.md:104-115`).

9. **Retire the launcher traps by decision (nothing to run).** Write into the record that these are never used on a service day: `scripts/launch_lariat.sh` (kill -9 anything on :3000 `:12-15`, then `npm run dev` `:23`, Chrome app-mode `:29`), `scripts/Lariat Cockpit.command` (same thing, `DEMO.md:15-18`), `npm run restart` (kills the :3000 listener, `package.json:52`), `npm run dev` (`package.json:8`) while the hub or Lariat.app is up, `scripts/install-prod-data.sh`. Check none ran from here: `ls .lariat_dev.log` → `No such file` (`launch_lariat.sh:23` writes it; 2026-09-01: absent).

10. **Write the decision record.** In the close-out worktree, append to `.agent-sessions/handoff.md` (the protocol location, `AGENTS.md:85`; last entry is 2026-08-29 at `:2`):
    ```
    ## YYYY-MM-DD — Go-live topology (Sean)
    - Host: this Mac = venue Mac (hostname …)
    - Mode: A `npm run start` | B `open LariatNative/build/Lariat.app` — one writer at a time
    - Data root: LARIAT_DATA_DIR=/Users/seanburdges/Library/Application Support/Lariat/data (in .env.local for mode A)
    - DB of record: <path>; schema_migrations 6; integrity ok; sha256 <from backups/<stamp>/SHA256SUMS>; backup backups/<stamp>
    - Never on a service day: scripts/install-prod-data.sh, scripts/launch_lariat.sh, scripts/Lariat Cockpit.command, npm run dev, npm run restart, scripts/install-cron.sh, ops/launchd/*.plist, npm run desktop:dist
    - Cron/launchd: none installed (checked YYYY-MM-DD)
    ```
    → expect: all six fields filled, no "TBD".

## Pass / fail
No plan defines criteria for the decision itself; the nearest are G0 B1 (`g0-gui-smoke-and-shutoff.md:96-99`) and the 2026-08-31 base-data decision (`salvage:63-66`).
**PASS** = all of: `PRAGMA integrity_check` = `ok` and `schema_migrations` max = 6; one DB path named and its sha256 recorded from `backups/<stamp>/SHA256SUMS` with the verify drill green; one mode named; mode A has `LARIAT_DATA_DIR` in `.env.local`; the smoke start held the App Support DB open (`lsof`) and created no `data/lariat.db`; `crontab -l` empty and no Lariat LaunchAgent; `lsof -i :3000` empty after stopping (`g0 plan:99`).
**FAIL** = any integrity error, two candidate DBs still unresolved, the smoke start touched `<repo>/data`, or any record field left blank.

## Record the result
- Evidence: the `.agent-sessions/handoff.md` section from step 10 (all six fields); `backups/<stamp>/SHA256SUMS` + `manifest.json` stay local — `backups/` is gitignored (`.gitignore:36`) and holds the DB; never commit it.
- Then update: `docs/PROJECT_STATUS.md:55` "Blocked on an owner decision" — add a bullet **Go-live topology — decided YYYY-MM-DD: host / mode / data root / DB sha256 (see `.agent-sessions/handoff.md`)**, and bump the as-of SHA at `docs/PROJECT_STATUS.md:10` (rule at `:132`). `docs/OPERATIONS_HANDOFF.md:3` "Last updated" → today, and add `## 7. Go-live topology — DECIDED YYYY-MM-DD` after line 78 with the same six fields. Plan rows: `docs/superpowers/plans/2026-08-31-app-lineage-salvage.md:55` ("Launch-at-login / kiosk resilience — decide deployment shape") and `:57` ("LAN-hub / iPad architecture — Sean's call") — replace "Blocked on" with "decided YYYY-MM-DD — see handoff". If you also resolved the `:63-66` vs `:77-78` contradiction, fix the losing sentence.

## Close out
```bash
scripts/worktree.sh new sean chore/go-live-topology-decision
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main.
Commit only `.agent-sessions/handoff.md`, `docs/PROJECT_STATUS.md`, `docs/OPERATIONS_HANDOFF.md`, and the salvage plan — the main checkout has 4 modified + 2 untracked files from another session (`git status --short`: `.claude/settings.json`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `scripts/bootstrap.sh`, `scripts/verify.sh`); never `git add -A` there. Note `/ship` calls `bash scripts/verify.sh` (`.claude/skills/ship/SKILL.md:6`), which is untracked here and absent on `origin/main` — if the worktree lacks it, run `npm run verify` (`package.json:33`) instead.

## If something goes wrong
- **Integrity ≠ `ok` or the backup drill fails:** do not launch. With everything stopped (`pgrep -lx Lariat` and `lsof -i :3000` empty), restore = replace `lariat.db` + `-wal` + `-shm` from the newest good `backups/<stamp>/` (`docs/OPERATIONS.md:101`). The only other copy on disk is the hybrid *smoke fixture* `~/lariat_dev/stash-archive-2026-08-30/app-lineage-20260831/hybrid-smoke-db-backup-20260831.db` (`salvage:66`) — not venue data; the original "recovered Aug-5 real DB" is not located by any doc, so say so in chat before using the fixture.
- **A stray `data/lariat.db` appears at any point:** move it aside; never run `scripts/install-prod-data.sh`; the one-way copy would erase whatever the app wrote (`package-app.sh:30-32`).
- **Smoke start shows empty boards:** wrong data root; stop; fix `LARIAT_DATA_DIR` / unset stray `LARIAT_*` env; nothing was written to the DB of record.
- **Service day (09-02) rollback trigger:** any operator-blocking unexpected failure = G0 FAIL (`g0 plan:137`) — stop the process, fall back to paper, leave the DB untouched, log it in the shutoff template (`docs/superpowers/templates/service-day-shutoff-log.md`, `g0 plan:141`). If a fix needs `npm run dev`, stop the hub / Lariat.app first — one writer.
- **Who to tell:** agents read `.agent-sessions/handoff.md` (`AGENTS.md:85`); they are told to leave Front 0 alone until you decide (`handoff.md:13`).
