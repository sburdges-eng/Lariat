# Toast API client (weekly pull)

Pulls last-N-days of sales (orders) + labor (time entries) from the
Toast API and dumps raw JSONL snapshots under
`data/toast-api/snapshots/<YYYY-MM-DD>/`. Aggregation into the existing
`toast_sales_*` SQLite tables is a separate follow-up — this module
intentionally stops at "raw JSON on disk" so a human can eyeball the
shape before committing schema-mapping code.

## One-time setup

1. Get API credentials from Toast.
   - **Standard / Analytics access**: create them yourself in Toast Web
     (Toast Web → Integrations → API access).
   - **Partner / Custom access**: request from the Toast integrations
     team. Multi-day turnaround.
   - You'll receive a **clientId** + **clientSecret** pair. Treat the
     secret like a database root password.

2. Find the **restaurant GUID**.
   - Toast Web → *Restaurants → Restaurant info* → the URL contains a
     UUID, or check the `Restaurant-External-ID` shown in any API
     example response from Toast support.

3. Add four lines to `.env.local` (already gitignored):

   ```
   TOAST_API_HOST=ws-api.toasttab.com
   TOAST_CLIENT_ID=<your client id>
   TOAST_CLIENT_SECRET=<your client secret>
   TOAST_RESTAURANT_GUID=<your restaurant GUID>
   ```

   Use `ws-api.eng.toasttab.com` for the sandbox environment.

4. Verify auth works:

   ```bash
   node scripts/toast-weekly-pull.mjs --dry-run
   ```

   Should print `token: cached, <N>s until expiry` and exit 0.

## Running

```bash
# Last 7 days (default — what a weekly cron should fire)
npm run toast:pull

# Custom day count
node scripts/toast-weekly-pull.mjs --days 14

# Explicit window
node scripts/toast-weekly-pull.mjs --start 2026-04-15 --end 2026-04-22

# Auth + window check, no fetches
node scripts/toast-weekly-pull.mjs --dry-run
```

Output for a successful run:

```
data/toast-api/
├── .token-cache.json              ← bearer + expiry, gitignored
└── snapshots/
    └── 2026-04-26/                ← one directory per pull (atomic rename)
        ├── manifest.json          ← window, page counts, timestamps
        ├── orders.jsonl           ← one Toast order per line
        └── time_entries.jsonl     ← one labor punch per line
```

Re-running for the same window overwrites the snapshot directory
atomically (writes to `<date>.tmp/`, then `rename`).

## Scheduling weekly

The script intentionally has no scheduling built in — pick whichever
mechanism your environment prefers:

### macOS launchd (recommended)

Save as `~/Library/LaunchAgents/com.lariat.toast-weekly.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lariat.toast-weekly</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>/Users/seanburdges/Dev/Lariat/scripts/toast-weekly-pull.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/seanburdges/Dev/Lariat</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>     <!-- Monday -->
    <key>Hour</key><integer>5</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/seanburdges/Dev/Lariat/data/toast-api/last-run.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/seanburdges/Dev/Lariat/data/toast-api/last-run.err.log</string>
</dict>
</plist>
```

Then:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lariat.toast-weekly.plist
launchctl print gui/$(id -u)/com.lariat.toast-weekly | grep state
```

### cron

```
# Mondays at 5am local
0 5 * * 1 cd ~/Dev/Lariat && node scripts/toast-weekly-pull.mjs >> data/toast-api/last-run.log 2>&1
```

## Security notes (per Toast guidance)

- The client secret stays in `.env.local` only. `.env.local` is in
  `.gitignore`. The client secret is **never** written to the token
  cache, command-line args, log lines, or error messages — `auth.mjs`
  masks it before any throw.
- The token cache (`data/toast-api/.token-cache.json`) holds only the
  bearer + expiry. Worst-case leak grants 5 hours (or whatever Toast
  sets `expiresIn` to) of read access until the JWT expires.
- A 401 from any Toast endpoint triggers exactly **one** force-refresh
  retry. Consistent 401s after that mean credentials were rotated;
  re-check `.env.local`.
- If you suspect the secret was committed to the repo or shared in
  plain text, contact Toast support — they will revoke and reissue.

## Token cache lifecycle

```
[script start]
  ↓
read .token-cache.json
  ↓
expiresAt - 300s > now ?
  ├─ yes → use cached token
  └─ no  → POST /authentication/v1/authentication/login
            ↓
          write .token-cache.json (atomic .tmp + rename)
            ↓
          use fresh token
```

The 300s early-refresh margin means a long pull that started near
expiry won't 401 halfway through.

## Files

- `scripts/toast_api/auth.mjs` — token fetch + on-disk cache
- `scripts/toast_api/client.mjs` — HTTP wrapper, pagination, date helpers
- `scripts/toast-weekly-pull.mjs` — CLI entry, JSONL dump
- `tests/js/test-toast-api-helpers.mjs` — unit tests for the pure helpers
- `data/toast-api/` — gitignored output dir (token cache + snapshots)
