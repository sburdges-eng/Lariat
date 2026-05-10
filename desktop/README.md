# Lariat Desktop Wrapper

Electron supervisor + child Next.js server. See `docs/desktop-wrapper-design.md`
for the architecture.

## Quick reference

```bash
npm run desktop:dev    # local Electron loop (uses your dev data/lariat.db)
npm run desktop:dist   # produce dist/Lariat-0.1.0-arm64.dmg
```

## Prerequisites on the install Mac

The wrapper does NOT bundle these; the wizard points at them.

- **Node 20+** (for `npm install` of native modules; not needed at runtime
  inside the .app — the bundled Electron Node is used)
- **Python 3 venv** with `openpyxl` and `xlrd` for ingest scripts.
  ```bash
  python3 -m venv .venv
  .venv/bin/pip install -r requirements-dev.txt
  ```
- **Ollama** + the Lariat assistant model:
  ```bash
  brew install ollama
  brew services start ollama
  ollama create lari-the-kitchen-assistant -f training/Modelfile
  ```
- **Data Pack** on external SSD (optional; Kitchen Assistant grounds answers
  in FDA/USDA text when present). Pointed at via the wizard.

## Manual smoke checklist (run after every meaningful build)

- [ ] **Fresh-install path**
  1. `rm -rf ~/Library/Application\ Support/Lariat`
  2. `open dist/mac-arm64/Lariat.app`
  3. Wizard appears → defaults → Finish
  4. Main window opens at `127.0.0.1:3000` within 30s
  5. `~/Library/Application Support/Lariat/data/lariat.db` exists, schema initialized

- [ ] **Existing-install path**
  1. With `settings.json` populated, relaunch
  2. No wizard — straight to main window
  3. `~/Library/Logs/Lariat/server-YYYY-MM-DD.log` gets a "ready" line

- [ ] **iPad LAN handshake**
  1. From a second Mac on same wifi:
     ```
     dns-sd -B _lariat._tcp local.
     curl http://<host>.local:3000/api/discover
     ```
     → host appears, JSON identity returned.
  2. Open `http://<host>.local:3000` in iPad Safari → normal Lariat session.

- [ ] **Crash recovery**
  1. With app running: `kill -9 $(pgrep -f server-entry)`
  2. Within ~1s, server is back; `~/Library/Logs/Lariat/crashes.jsonl` has a
     new entry.
  3. iPad session reconnects within 5s.

- [ ] **Graceful shutdown**
  1. ⌘Q while a long ingest runs
  2. Quit waits up to 8s, exits 0
  3. `data/lariat.db` not corrupted; WAL checkpoints cleanly on next boot

- [ ] **Ad-hoc Gatekeeper bypass**
  1. On a fresh Mac (or after `xattr -d com.apple.quarantine Lariat.app`):
     first launch via right-click → Open
  2. Subsequent launches: double-click, no warning

## Implementation notes

- **No business logic in the wrapper.** Everything regulated (HACCP, labor,
  costing) stays in `lib/` and `app/api/`. The wrapper only does process
  supervision, window chrome, and OS integration.
- **No SQLite reads from the main process.** The forked Next server owns
  `data/lariat.db`; the wrapper talks to it over HTTP on localhost like any
  other client. Audit immutability stands — the wrapper never mutates
  `audit_events` or any regulated table directly.
- **Scaffold-only today.** Runtime code (main, supervisor, server-entry,
  preload, first-run wizard) lands in T3–T8; `electron-builder.yml` +
  entitlements in T9; CI smoke in T11. Until those ship, `npm run desktop:dev`
  has no `.ts` files for `tsc -p desktop` to emit.
