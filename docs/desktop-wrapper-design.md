# Lariat Desktop Wrapper — Design

> **Note (2026-07-07):** Superseded for **H8 native** by `LariatNative/Scripts/PACKAGING.md`
> and Phase III D1 (Application Support recipe root). This Electron+Next hub design remains
> reference only if a separate LAN-supervisor wrapper is revived — not the P3-1 path.

**Status:** Approved design, not yet implemented
**Date:** 2026-05-10
**Owner:** sburdges
**Replaces:** `Lariat.app/` hand-rolled bash launcher

## 1. Goal

Package Lariat as a real macOS `.app` (distributed via `.dmg`) that runs on a kitchen "hub" Mac, exposes the Next.js HTTP server on the LAN for iPad terminals, and is robust to server crashes.

## 2. Non-goals (v1)

- Multi-tenant distribution to other restaurants
- Auto-update channel
- Bundling Python or Ollama
- Hub election / multi-instance failover (`docs/multi-instance.md` covers that as future work)
- Universal arm64+x64 binary in a single `.dmg` (per-arch `.dmg`s are fine)
- Apple Developer ID + notarization (pipeline supports it; activation deferred until the $99/yr decision is made)

## 3. Constraints captured from current code

| Source | Implication |
|---|---|
| `lib/db.ts:6` uses `path.join(process.cwd(), 'data')` | Refactor to honor `LARIAT_DATA_DIR`, default to today's behavior so dev/test/CI are unaffected |
| `lib/mdnsDiscovery.ts` advertises `_lariat._tcp`; `docs/multi-instance.md` makes iPad-on-LAN load-bearing | Wrapper MUST keep server bound to `0.0.0.0:3000`; mDNS responder must survive child crashes |
| `better-sqlite3` is a native module | Use Electron's bundled Node ABI everywhere → one `electron-rebuild` pass via `electron-builder install-app-deps` postinstall |
| Python ingest scripts spawned via `execSync` from Node | Wrapper does not bundle Python; wizard exposes a `pythonPath` setting |
| Ollama runs as separate system service over HTTP | Wrapper-agnostic; wizard exposes `ollamaUrl` setting |
| `lib/datapackSearch.ts` already honors `LARIAT_DATA_ROOT` env var (verified: `lib/datapackSearch.ts:34`) | No code change needed — wrapper just populates the existing env var. Symlink fallback (`data/lariat-data`) and graceful-degrade preserved. |
| CLAUDE.md: "Do not mock SQLite" | All db-related tests use real (in-memory or temp-file) SQLite |
| CLAUDE.md: `audit_events` writes must be in same `db.transaction(...)` as the source row | Graceful shutdown allows up to 8s for in-flight transactions to complete before SIGTERM |

## 4. Architecture: supervisor + child server

```
┌──────────────────────────────────────────────────────────────────┐
│ Lariat.app (Electron main process — SUPERVISOR)                  │
│                                                                  │
│  • settings bootstrap (~/Library/Application Support/Lariat)     │
│  • mDNS advertise (survives child crashes)                       │
│  • child lifecycle: spawn, restart w/ backoff, structured log    │
│  • on crash: append crashes.jsonl + show in-window dialog        │
│                                                                  │
│         │ child_process.fork()                                   │
│         │ runtime = Electron's bundled Node (same ABI as main)   │
│         ▼                                                        │
│  ┌──────────────────────────────────────────────┐                │
│  │ Next.js HTTP server  (CHILD)                 │                │
│  │ - bound 0.0.0.0:3000                         │                │
│  │ - reads LARIAT_DATA_DIR / DATAPACK_DIR / ... │                │
│  │ - better-sqlite3 native binding              │                │
│  │ - if it dies, supervisor stays up            │                │
│  └──────────────────────────────────────────────┘                │
│         ▲                                                        │
│         │ HTTP loadURL                                           │
│  ┌──────┴───────────┐                                            │
│  │ BrowserWindow    │                                            │
│  │ → 127.0.0.1:3000 │                                            │
│  └──────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
                       ▲ same HTTP server, LAN-exposed
                       │
            ┌──────────┴──────────┐
            │ iPad terminals      │
            │ http://<host>.local │
            └─────────────────────┘
```

**Why child process, not in-process Next.** Crash containment. A native-binding segfault or unhandled exception in the server takes down only the child; the supervisor stays up, captures stderr, restarts, and surfaces a dialog to the operator. This is the standard pattern in production Electron apps (VS Code, Slack, Postman).

**Why one Node ABI (Electron's bundled).** Forking with `execPath: process.execPath` reuses Electron's Node binary as the child runtime → only one `better-sqlite3` rebuild is needed (handled by `electron-builder install-app-deps` in the `postinstall` script).

**Why mDNS lives in the supervisor, not Next.** So iPad discovery survives server restarts. The `/api/discover` endpoint itself is served by Next and will be unreachable for 1–5 s during a restart — accepted v1 limitation; iPad clients retry.

**Why no supervisor↔child IPC channel.** The renderer talks to Next over HTTP because it *is* a Next page. The only IPC needed is between the first-run wizard and the supervisor (Electron `contextBridge` preload).

## 5. Components & file layout

### New tree

```
desktop/
├── main.ts                # Electron entry — boot()
├── supervisor.ts          # ChildProcess lifecycle: spawn, restart, log, crashlog
├── settings.ts            # read/write ~/Library/Application Support/Lariat/settings.json
├── paths.ts               # OS-aware path helpers (data dir, log dir, crash log)
├── server-entry.cjs       # the script forked into the child — boots Next programmatically
├── preload.ts             # contextBridge: settings.get/set, dialog.pickDirectory, app.proceed
├── firstRunWizard/
│   ├── index.html
│   ├── wizard.tsx
│   ├── wizard.css
│   └── vite.config.ts
├── icons/
│   ├── AppIcon.icns       # moved from existing Lariat.app/Contents/Resources/
│   └── dmg-background.png
├── entitlements.mac.plist
├── tsconfig.json          # extends root, target=ES2022, module=commonjs, outDir=desktop/dist
└── README.md              # smoke checklist + Ollama/Python install notes

electron-builder.yml
```

### Modified files

| File | Change |
|---|---|
| `lib/db.ts` (line 6–7) | `const DB_DIR = process.env.LARIAT_DATA_DIR \|\| path.join(process.cwd(), 'data');` — default unchanged |
| `lib/datapackSearch.ts` | **No change** — already honors `LARIAT_DATA_ROOT` (line 34); wrapper just sets it |
| `package.json` | Add `electron`, `electron-builder`, `@electron/rebuild` (devDeps); new scripts `desktop:dev`, `desktop:build`, `desktop:dist`; `postinstall: electron-builder install-app-deps` |
| `tsconfig.json` | Add `desktop/**` to `exclude` so Next's tsc doesn't compile desktop code |
| `Lariat.app/` | **Deleted.** `AppIcon.icns` moved to `desktop/icons/` |

### Component responsibilities

- **`main.ts`** — `app.whenReady()` → load settings → if no `dataDir`, open wizard window → on wizard `app.proceed`, boot supervisor → create main `BrowserWindow` → start mDNS responder. Wires `before-quit` to `supervisor.shutdown()`.
- **`supervisor.ts`** — owns the child. `start()`, `shutdown()`, `restart()`. Listens for `exit`. Implements 1s/2s/5s backoff and the 3-failures-in-60s give-up rule. Pipes stdio to a daily-rotated log file. Appends to `crashes.jsonl` on every non-zero exit.
- **`server-entry.cjs`** — minimal CJS shim run inside the child. Reads env (already populated by supervisor), `require('next')` programmatically, binds `http.createServer` to `0.0.0.0:${PORT}`.
- **`settings.ts`** — Zod-validated read/write of `settings.json`. Atomic write via temp+rename.
- **`paths.ts`** — wraps `app.getPath('userData')` etc. so tests can stub it. Defines `settingsPath()`, `logDir()`, `crashLogPath()`.
- **`preload.ts`** — narrow `contextBridge` API: `settings.get()`, `settings.save(partial)`, `dialog.pickDirectory()`, `app.proceed()`.
- **`firstRunWizard/`** — React app loaded via `file://` from the .app, pre-built by Vite into `desktop/dist/wizard/`. Three steps: data dir / Python venv / Data Pack dir.

## 6. Data flow

### 6.1 Cold start (no settings.json)

```
double-click Lariat.app
  → Electron main starts
  → settings.read() → ENOENT → null
  → wizard window (modal, 600×500, file://wizard/index.html)
  → user picks dataDir / pythonPath / datapackDir → Finish
  → settings.save(...)
  → ipcRenderer.send('app.proceed')
  → wizard closes
  → goto §6.3
```

Wizard step 1 auto-detects `~/Dev/Lariat/data/lariat.db`; if found, offers "use in place" vs "copy to new location."

### 6.2 Subsequent launch (settings exist)

```
Electron main → settings.read() → valid → skip wizard → §6.3
```

### 6.3 Supervisor child boot

```
env = {
  ...process.env,
  LARIAT_DATA_DIR:     settings.dataDir,
  LARIAT_DATA_ROOT:    settings.datapackDir,            // unset if skipped — datapackSearch is graceful-degraded
  LARIAT_OLLAMA_URL:   settings.ollamaUrl ?? "http://127.0.0.1:11434",
  PORT:                String(settings.port),
  HOST:                "0.0.0.0",
  NODE_ENV:            "production",
}
child = fork(<resourcesPath>/desktop/server-entry.cjs, [], {
  env,
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  execPath: process.execPath,                           // Electron's bundled Node
})
pipe child.stdout → logRotator
pipe child.stderr → logRotator + ringBuffer(last 200 lines)

on child.exit (code, signal):
  crashLog.append({ts, code, signal, restartAttempt, stderrTail: ringBuffer.dump()})
  if shuttingDown: return
  if attemptsInLast60s < 3:
    schedule restart with backoff [1s, 2s, 5s][attemptsInLast60s]
  else:
    mainWindow.showCrashDialog({log: logPath, crashes: crashLogPath})

once port reachable (poll GET /api/discover every 250ms, timeout 30s):
  → start mDNS responder (advertises _lariat._tcp on settings.port)
  → create main BrowserWindow → loadURL("http://127.0.0.1:" + settings.port)
  → supervisor.state = "ready"
```

### 6.4 iPad LAN handshake (unchanged from today)

```
iPad on same wifi
  → multicast query for _lariat._tcp
  → supervisor's mDNS responder answers with TXT {version, location_id, started_at}
  → iPad GETs http://<host>.local:3000/api/discover → 200 identity confirmation
  → iPad navigates to http://<host>.local:3000/ → normal Lariat session
```

During a restart the discover endpoint returns connection-refused for 1–5s; iPad UI shows "reconnecting…" and retries every 2s.

### 6.5 Graceful shutdown

```
⌘Q (or Lariat → Quit)
  → app.on('before-quit') sets supervisor.shuttingDown = true
  → supervisor stops mDNS responder
  → supervisor.shutdown():
       child.send({type: "shutdown"})
       child handles → server.close() → wait for in-flight requests (5s max)
       if alive after 8s:  child.kill('SIGTERM')
       if alive after 10s: child.kill('SIGKILL') + log forced-kill
  → app.exit(0)
```

The 8s timeout exists to let `db.transaction(...)` blocks complete — `lib/auditEvents.ts::postAuditEvent` requires the audit row to commit in the same transaction as the source mutation.

### 6.6 Migration scenarios

| State on first launch | Wizard behavior |
|---|---|
| Fresh Mac, nothing | Default to `~/Library/Application Support/Lariat/data` (created empty on first server boot via `lib/db.ts::initSchema`) |
| `~/Dev/Lariat/data/lariat.db` exists | Step 1 surfaces it: "Found existing Lariat data — [Use in place] [Copy to ~/Library/...]" |
| Wrong-version DB found | Defer to existing `migrateLegacyColumns()` in `lib/db.ts` — runs on server boot regardless of location |
| Other Lariat process holds WAL lock | better-sqlite3 fails to open; supervisor catches → "Database is in use by another process" dialog |

## 7. Build pipeline

### 7.1 `package.json` scripts

```jsonc
{
  "scripts": {
    "desktop:dev":   "tsc -p desktop && electron desktop/dist/main.js",
    "desktop:build": "next build && tsc -p desktop && vite build --config desktop/firstRunWizard/vite.config.ts",
    "desktop:dist":  "npm run desktop:build && electron-builder --mac --arm64 --x64",
    "postinstall":   "electron-builder install-app-deps"
  }
}
```

### 7.2 `electron-builder.yml`

```yaml
appId: com.seanburdges.lariat.cockpit       # matches existing Info.plist CFBundleIdentifier
productName: Lariat
copyright: © 2026 Lariat — kitchen cockpit
artifactName: ${productName}-${version}-${arch}.${ext}

directories:
  output: dist
  buildResources: desktop/icons

files:
  - "desktop/dist/**"
  - ".next/standalone/**"
  - ".next/static/**"
  - "public/**"
  - "package.json"
  - "node_modules/better-sqlite3/**"
  - "node_modules/next/**"
  - "node_modules/react/**"
  - "node_modules/react-dom/**"
  - "!node_modules/**/*.{md,ts,map}"
  - "!**/test/**"
  - "!**/__tests__/**"

asar: false                                  # Next .next/ cannot live inside asar

mac:
  category: public.app-category.business
  icon: desktop/icons/AppIcon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  identity: null                             # TODAY: ad-hoc sign
  # identity: "Developer ID Application: Sean Burdges (TEAMID)"   ← LATER: uncomment
  entitlements: desktop/entitlements.mac.plist
  entitlementsInherit: desktop/entitlements.mac.plist
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  extendInfo:
    LSMinimumSystemVersion: "11.0"
    NSLocalNetworkUsageDescription: "Lariat needs local network access so kitchen iPads can connect to the hub."
    NSBonjourServices:
      - "_lariat._tcp"

dmg:
  title: "Lariat ${version}"
  icon: desktop/icons/AppIcon.icns
  background: desktop/icons/dmg-background.png
  contents:
    - { x: 130, y: 220, type: file }
    - { x: 410, y: 220, type: link, path: /Applications }
  window: { width: 540, height: 380 }
```

### 7.3 `desktop/entitlements.mac.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.server</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict></plist>
```

### 7.4 Notarization upgrade path

When a Developer ID is available, add `desktop/notarize.cjs`:

```js
require('dotenv').config({ path: require('os').homedir() + '/.lariat-build.env' });
const { notarize } = require('@electron/notarize');
exports.default = async ({ appOutDir, packager }) =>
  notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${packager.appInfo.productFilename}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
```

Then in `electron-builder.yml`: set `mac.identity` to the Developer ID string, uncomment `afterSign: desktop/notarize.cjs`, add `@electron/notarize` to devDeps. No architecture change.

### 7.5 Bundle size budget

| Component | Size |
|---|---|
| Electron runtime | ~120 MB |
| Next.js standalone server | ~25 MB |
| `better-sqlite3` native | ~3 MB |
| App code + public/ + .next/static | ~15 MB |
| **Per-arch .dmg** | **~165 MB compressed** |

## 8. Testing strategy

### 8.1 Unit tests (new)

| File | Asserts |
|---|---|
| `tests/js/test-db-data-dir.mjs` | `lib/db.ts` honors `LARIAT_DATA_DIR` when set; falls back to `process.cwd()/data` when unset |
| _(removed)_ | `lib/datapackSearch.ts` already has `LARIAT_DATA_ROOT` support; existing tests cover it. No new test needed for the wrapper. |
| `desktop/__tests__/settings.test.ts` | `settings.ts` round-trip, malformed-JSON rejection, atomic write (no corrupt file on partial write) |
| `desktop/__tests__/supervisor.test.ts` | Backoff sequence [1s, 2s, 5s], 4th-failure-in-60s → no restart + dialog signal. Fake timers; no real Electron. |
| `desktop/__tests__/paths.test.ts` | `paths.ts` returns correct dirs on macOS; stubable for tests |

All run via `node --test`. **Do not mock SQLite** in `test-db-data-dir.mjs` — use a real temp-file DB.

### 8.2 Integration tests (new)

| Test | Mechanism |
|---|---|
| `desktop/__tests__/server-boot.integration.ts` | Boot `server-entry.cjs` against a temp data dir; wait for `/api/discover` 200; assert response shape matches `app/api/discover/route.js` |
| `desktop/__tests__/crash-recovery.integration.ts` | Spawn supervisor against a deliberately broken `server-entry-broken.cjs`; assert 3 restart attempts logged + `crashes.jsonl` has 3 entries with non-zero codes + supervisor settles into give-up state |

### 8.3 Manual smoke checklist (lives in `desktop/README.md`)

```
□ Fresh-install path
   1. rm -rf ~/Library/Application\ Support/Lariat
   2. open dist/mac-arm64/Lariat.app
   3. Wizard → defaults → Finish
   4. Main window opens at 127.0.0.1:3000 within 30s
   5. ~/Library/Application Support/Lariat/data/lariat.db exists, schema initialized

□ Existing-install path
   1. With settings.json populated, relaunch
   2. No wizard — straight to main window
   3. ~/Library/Logs/Lariat/server-YYYY-MM-DD.log gets a "ready" line

□ iPad LAN handshake
   1. From a second Mac on same wifi:
      dns-sd -B _lariat._tcp local.        → host appears
      curl http://<host>.local:3000/api/discover  → 200, JSON identity
   2. Open http://<host>.local:3000 in iPad Safari → normal Lariat session

□ Crash recovery
   1. With app running, kill -9 the Next child PID (pgrep -f server-entry)
   2. Within ~1s, server is back; crashes.jsonl has a new entry
   3. iPad session reconnects within 5s

□ Graceful shutdown
   1. ⌘Q while a long ingest runs
   2. Quit waits up to 8s, then exits 0
   3. data/lariat.db not corrupted; WAL checkpoints cleanly on next boot

□ Ad-hoc Gatekeeper bypass
   1. On a fresh Mac (or after `xattr -d com.apple.quarantine`), first-launch via right-click → Open
   2. Subsequent launches double-click, no warning
```

### 8.4 Not tested in v1

- mDNS cross-host discovery (same exclusion as `tests/js/test-mdns-discovery.mjs` — multicast unreliable in CI)
- Notarization end-to-end (deferred until Developer ID exists)
- Universal arm64+x64 fat binary (per-arch is half the size; sufficient for hub-box use case)

### 8.5 CI integration

```yaml
desktop-build-smoke:
  runs-on: macos-14
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npm run desktop:build
    - run: node desktop/__tests__/server-boot.integration.js
    - run: node desktop/__tests__/crash-recovery.integration.js
    # NOT running electron-builder --mac on CI — packaging is local-only for v1
```

## 9. Out-of-scope / future work

| Item | Reason | Where it lives |
|---|---|---|
| Python venv auto-bootstrap | Multi-day relocatable-interpreter problem | Wizard exposes path picker; never installs |
| Ollama bundling + model preload | 8 GB model files; separate daemon | `desktop/README.md` documents `brew install ollama && ollama serve && ollama create lari-the-kitchen-assistant -f training/Modelfile` |
| `/api/discover` blackout during restart (1–5s) | Avoiding a secondary HTTP server in supervisor | iPad clients retry; documented v1 limitation |
| Auto-update channel | Needs hosting decision (S3 / GitHub Releases) | electron-builder zip target ships in v1, ready when decided |
| Hub election & failover | Already deferred per `docs/multi-instance.md` | Supervisor is single-instance for v1 |
| Universal binary | Per-arch is half the size; covers Apple Silicon | `arch: universal` flip later |
| Window-state persistence | Nice-to-have | `electron-window-state` package in v1.1 |
| In-app log viewer | Console.app open-on-click is sufficient | Native viewer overkill |
| Apple Developer ID + notarization | $99/yr decision pending | Pipeline pre-configured (§7.4) |

## 10. Decisions log

| # | Question | Choice | Date |
|---|---|---|---|
| 1 | Audience + LAN model | Hub box on a known kitchen Mac, iPads still need LAN access | 2026-05-09 |
| 2 | Data location | Configurable per-instance via settings file | 2026-05-09 |
| 3 | Signing posture | Defer signing decision — produce ad-hoc now, add notarization later | 2026-05-09 |
| 4 | Process model | Supervisor + child server (crash investigation > minimum moving parts) | 2026-05-10 |
| 5 | Wrapper framework | Electron (Tauri's binary-size win evaporates once Node sidecar is needed) | 2026-05-10 |
| 6 | Spec doc location | Flat `docs/` to match `cloud-bridge-design.md` / `multi-instance.md` convention | 2026-05-10 |

## 11. Open questions

None outstanding at design approval. New questions surfaced during implementation will be appended here.
