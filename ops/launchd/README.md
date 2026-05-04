# Lariat launchd agents

User-level LaunchAgents for scheduled Lariat maintenance jobs. These run as the
logged-in user (no `sudo`) out of `~/Library/LaunchAgents/`.

## Agents

| Plist | Schedule | What it does |
| --- | --- | --- |
| `com.seanburdges.lariat.archive-stale.plist` | Daily at 03:00 local | Runs `npm run archive:stale` (→ `scripts/archive-stale.mjs`) to sweep stale rows. |
| `com.seanburdges.lariat.mdns-responder.plist` | **Long-running daemon** (RunAtLoad + KeepAlive) | Runs `npm run mdns:advertise` (→ `scripts/start-mdns.mjs`) to publish a `_lariat._tcp` Bonjour service so the Lariat-KDS iPad app + peer Lariat hubs can find this instance on the LAN. Required for `/api/discover` on the iPad to resolve a peer without typing IPs. |

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

---

## mDNS responder (long-running daemon, not a scheduled task)

`com.seanburdges.lariat.mdns-responder.plist` is different: it's a daemon that
runs continuously while the Mac is logged in, not a job that fires on a
schedule. `RunAtLoad=true` starts it at login; `KeepAlive=true` restarts it
if it dies; `ThrottleInterval=30` prevents tight-looping on hosts with no
multicast.

### Install

```sh
mkdir -p /Users/seanburdges/Dev/Lariat/logs
cp ops/launchd/com.seanburdges.lariat.mdns-responder.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.seanburdges.lariat.mdns-responder.plist
```

Confirm the responder is up:

```sh
launchctl list | grep lariat.mdns
# Expected: a PID in the middle column (the responder is running)
```

Verify on the wire from another Mac on the same LAN:

```sh
dns-sd -B _lariat._tcp .
# Expected: this Mac's hostname appears within 1–2 seconds
```

Or sanity-check from this same Mac:

```sh
npm run mdns:discover     # one-shot 3-second scan; prints discovered peers
```

### Tuning (port / location override)

Edit the `EnvironmentVariables` block in the plist. `PORT` must match whatever
Lariat is actually bound to (3000 by default; flip if you run multiple
instances per `docs/multi-instance.md`). `LARIAT_LOCATION_ID` lets upstairs/
downstairs splits be distinguished in the TXT record.

After editing, **unload + reload** so launchd re-reads:

```sh
launchctl unload ~/Library/LaunchAgents/com.seanburdges.lariat.mdns-responder.plist
cp ops/launchd/com.seanburdges.lariat.mdns-responder.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.seanburdges.lariat.mdns-responder.plist
```

### Logs

```sh
tail -n 100 /Users/seanburdges/Dev/Lariat/logs/mdns-responder.out.log
tail -n 100 /Users/seanburdges/Dev/Lariat/logs/mdns-responder.err.log
```

`err.log` will show a single warning (and the responder will exit, then
launchd will throttle/restart) on hosts without IPv4 multicast — Docker
without `--net=host`, locked-down corporate networks, etc. That's the
expected degraded posture per `lib/mdnsDiscovery.ts`.

### Uninstall

```sh
launchctl unload ~/Library/LaunchAgents/com.seanburdges.lariat.mdns-responder.plist
rm ~/Library/LaunchAgents/com.seanburdges.lariat.mdns-responder.plist
```
