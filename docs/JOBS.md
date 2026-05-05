# Background jobs

Lariat is a single-machine local-first system. Cron is the scheduler;
[`scripts/run-job.mjs`](../scripts/run-job.mjs) is the wrapper cron
calls. There is no queue server, no worker pool, no daemon. Adding a
new scheduled job is two changes: an entry in
[`data/scheduled-jobs.json`](../data/scheduled-jobs.json) and a row in
the operator's crontab pointing at `npm run job <name>`.

## Why this shape

- **Cron + lockfile** is what fits a single Mac mini in a back-of-house
  rack with no external infrastructure to babysit.
- **One row per run in `ingest_runs`** is already how every existing
  ingest reports status. The job runner adopts the same table — costing
  ingest, analytics ingest, and now arbitrary cron jobs all surface in
  `SELECT * FROM ingest_runs ORDER BY id DESC` with `kind` distinguishing
  the source.
- **Failures append to `data/audit/job-failures.jsonl`** so the operator
  can `tail -f` or grep without having to query SQLite. JSONL is also
  the right shape for a future webhook publisher to consume row-by-row.
- **POSIX exit codes** (75 = locked, 64 = usage, 1 = failed, 0 = ok)
  are what cron's `MAILTO` rules expect. A future supervisor can
  distinguish "lock held — try later" from "bad config — page someone."

## Components

### `lib/jobLock.ts`

File-based lock with `O_CREAT | O_EXCL` atomicity. Lockfiles live at
`data/locks/<job-name>.lock` and contain `{pid, jobName, acquiredAt}`.
Two reclamation paths handle orphaned lockfiles:

1. **Dead PID** — `process.kill(pid, 0)` raises `ESRCH` for processes
   that no longer exist. The lockfile is treated as orphaned, deleted,
   and re-acquired.
2. **Stale age** — lockfile mtime older than `staleAfterSec` (default
   4 hours; configurable per-job via `timeout_sec` in the manifest)
   is reclaimable even when the holder PID is alive. This is the
   safety valve for runaway jobs that wedge.

Public API: `acquireLock(jobName, opts) → AcquireResult`,
`releaseLock(lockfilePath, expectedPid) → void`,
`inspectLock(jobName, opts) → LockHeldInfo | null`.

### `scripts/run-job.mjs`

CLI wrapper. Reads the manifest, acquires a lock, opens an `ingest_runs`
row with `kind = 'job:<name>'`, spawns the command (`stdio: 'inherit'`),
updates the row with `status = 'ok' | 'failed'`, releases the lock.
Failures append to `data/audit/job-failures.jsonl`.

```text
usage: run-job.mjs <job-name>
       run-job.mjs --list
       run-job.mjs --status [<job-name>]

Exit codes: 0 ok | 1 job failed | 64 usage error | 75 already locked
```

### `data/scheduled-jobs.json`

```json
{
  "version": 1,
  "jobs": {
    "ingest-costing": {
      "command": ["npm", "run", "ingest:costing"],
      "cron": "0 6 * * *",
      "timeout_sec": 1800,
      "description": "Daily costing ingest from XL workbook."
    }
  }
}
```

`cron` is **informational only**. Actual cron registration lives in
the operator's crontab. The wrapper reads the manifest at the start
of every invocation, so editing the JSON is enough to update job
definitions — nothing to restart.

`timeout_sec` is currently the **stale-after window** for the lockfile,
not a hard kill. A future iteration can wire it through `spawnSync`'s
`timeout` option.

## npm scripts

- `npm run job <name>` — run one job
- `npm run job:list` — print the manifest as JSON
- `npm run job:status [name]` — print lock status (held / not held)

Examples:

```bash
npm run job ingest-costing
npm run job:list
npm run job:status ingest-costing
```

## Operator crontab

Cron's environment is sparse — no Homebrew PATH, no NVM init, no
shell rc files. Calling `npm run job` directly from cron usually
fails with "node: command not found". Two pieces handle this:

- **`scripts/cron-wrapper.sh`** — sets a sane PATH (Homebrew + system),
  cd's to the repo via `BASH_SOURCE` (not relative to the operator's
  cwd), exports `TZ=America/Denver` so `ingest_runs` timestamps stay
  consistent, then `exec`s `npm run job <name>`.

- **`examples/lariat.crontab`** — paste-able crontab block delimited
  by `# LARIAT_CRON_BEGIN` / `# LARIAT_CRON_END` markers. Calls the
  wrapper, not `npm` directly.

- **`scripts/install-cron.sh`** — idempotent installer. Reads the
  current crontab, strips any prior block bounded by the markers,
  appends the template, pipes to `crontab -`. Non-Lariat lines pass
  through verbatim. Run it as many times as you want.

```bash
# Preview what would be installed:
bash scripts/install-cron.sh --dry

# Install or update:
bash scripts/install-cron.sh

# Remove the Lariat block entirely:
bash scripts/install-cron.sh --remove
```

After install, verify with `crontab -l`. Watch live cron output with
`tail -f "$HOME/Library/Logs/Lariat/lariat-cron.log"`.

`MAILTO=` at the top of the crontab routes non-zero exits to the
operator's inbox. Exit code 75 (lock held) is *not* a failure for a
short job that runs more often than its peers — operators may want to
filter it out, e.g. by piping `MAILTO`'d output through a script that
ignores the canonical "already locked" message.

### Crontab if you want to edit by hand

If you'd rather not use the installer, paste the block from
[`examples/lariat.crontab`](../examples/lariat.crontab) into
`crontab -e` directly. The wrapper resolves the repo root from its own
file location, so you don't need a `cd` step in the cron entries.

## How a new job lands

1. Add the npm script that does the actual work (e.g. `npm run ingest:invoices`).
2. Add an entry to `data/scheduled-jobs.json` (`command`, `cron`, `timeout_sec`, `description`).
3. Add a row to the operator's crontab.
4. (Optional) Write a smoke test that calls `runJob(name)` against an
   in-memory DB and asserts the right `ingest_runs` row gets written.

## Inspecting state

```bash
# What's running right now?
npm run job:status

# What ran recently?
sqlite3 data/lariat.db "SELECT id, kind, status, started_at, finished_at FROM ingest_runs WHERE kind LIKE 'job:%' ORDER BY id DESC LIMIT 20;"

# What failed?
tail -f data/audit/job-failures.jsonl
```

## Out of scope (intentionally)

- **Queue durability** — if the machine reboots mid-run, the in-flight
  job dies and its `ingest_runs` row stays `running` until the next sync
  reclaims the lock. A future operator dashboard tile can highlight
  "running" rows older than the job's `timeout_sec`.
- **Retries** — cron retries the next tick. We don't want exponential
  backoff buried inside the runner; cron's schedule already encodes
  retry cadence.
- **Distributed coordination** — Lariat is single-machine. The day we
  add multi-site means the day we replace the lockfile with a row in
  SQLite or a real queue.
