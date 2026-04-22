# Lariat launchd agents

User-level LaunchAgents for scheduled Lariat maintenance jobs. These run as the
logged-in user (no `sudo`) out of `~/Library/LaunchAgents/`.

## Agents

| Plist | Schedule | What it does |
| --- | --- | --- |
| `com.seanburdges.lariat.archive-stale.plist` | Daily at 03:00 local | Runs `npm run archive:stale` (→ `scripts/archive-stale.mjs`) to sweep stale rows. |

## One-time prerequisite

The agent writes logs to `logs/` under the Lariat checkout. That directory is
git-ignored and not created by this repo, so make it before loading:

```sh
mkdir -p /Users/seanburdges/Dev/Lariat/logs
```

If `logs/` is missing when launchd fires, the job will fail with a "no such
file or directory" error on `StandardOutPath`/`StandardErrorPath`.

## Log rotation

The two log files (`logs/archive-stale.out.log`, `logs/archive-stale.err.log`)
are append-only; on a noisy error day `err.log` can grow unboundedly. For a
quick manual trim after a known-good inspection, truncate in place:
`: > /Users/seanburdges/Dev/Lariat/logs/archive-stale.err.log`. For automatic
rotation, drop a `newsyslog` rule at
`/etc/newsyslog.d/lariat-archive-stale.conf` (not committed here).

## Install

From the Lariat checkout root:

```sh
cp ops/launchd/com.seanburdges.lariat.archive-stale.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.seanburdges.lariat.archive-stale.plist
```

Confirm it's registered:

```sh
launchctl list | grep lariat
```

You should see a line containing `com.seanburdges.lariat.archive-stale`. The
left column is the last exit status (`-` means it hasn't run yet); the middle
column is the PID when running.

## Manual trigger (kick off a run without waiting for 03:00)

```sh
launchctl start com.seanburdges.lariat.archive-stale
```

Then inspect the logs:

```sh
tail -n 100 /Users/seanburdges/Dev/Lariat/logs/archive-stale.out.log
tail -n 100 /Users/seanburdges/Dev/Lariat/logs/archive-stale.err.log
```

The job is wrapped in `/bin/zsh -lc "..."` so the login shell populates `PATH`
(Node is installed via Homebrew and is only on `PATH` through the login shell).
If stderr shows `npm: command not found`, check that your login shell actually
sets `PATH` to include Homebrew (`/opt/homebrew/bin` on Apple Silicon,
`/usr/local/bin` on Intel).

## Uninstall

```sh
launchctl unload ~/Library/LaunchAgents/com.seanburdges.lariat.archive-stale.plist
rm ~/Library/LaunchAgents/com.seanburdges.lariat.archive-stale.plist
```

## Updating the plist

After editing the template in this repo, re-copy it and reload:

```sh
launchctl unload ~/Library/LaunchAgents/com.seanburdges.lariat.archive-stale.plist
cp ops/launchd/com.seanburdges.lariat.archive-stale.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.seanburdges.lariat.archive-stale.plist
```

launchd caches the parsed plist, so a reload is required — editing the copy in
`~/Library/LaunchAgents/` in place without `unload`/`load` will not pick up
changes.
