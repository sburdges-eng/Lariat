# Lariat Desktop Wrapper

Electron wrapper that boots the Lariat Next.js cockpit as a forked Node child
process and renders it inside a native macOS window. Local-first, offline-capable;
no hidden runtime AI coupling. The wrapper exists so line cooks can launch
Lariat from the Dock like any other app, with persistent window state, mDNS
advertisement so iPads on the LAN can discover the box, and a first-run wizard
that picks a writable data directory.

The architecture rationale lives in `docs/desktop-wrapper-design.md`.

## Layout

```
desktop/
  main.ts              Electron entry — creates BrowserWindow, owns app lifecycle (T7)
  supervisor.ts        Forks server-entry.cjs, restarts on crash with backoff (T6)
  server-entry.cjs     CommonJS bootstrap that requires Next + starts on a free port (T5)
  paths.ts             OS-aware path helpers (data dir, log dir, settings file) (T3)
  settings.ts          Read/write/validate desktop-settings.json (T4)
  preload.ts           contextBridge exposure for the first-run wizard (T8)
  firstRunWizard/      Vite + React UI shown on first launch when no data dir (T8)
  icons/
    AppIcon.icns       macOS dock icon (moved from legacy Lariat.app/)
    dmg-background.png Placeholder DMG layout background (replace with branded art)
  tsconfig.json        Standalone TS project — emits CommonJS into desktop/dist/
  dist/                tsc output (gitignored)
```

## Develop

```bash
# One-time: ensure native modules (better-sqlite3) are rebuilt for Electron's ABI
npm install                     # postinstall runs `electron-builder install-app-deps`

# Iterate on the wrapper itself
npm run desktop:dev             # tsc -p desktop && electron desktop/dist/main.js
```

`desktop:dev` compiles the TypeScript entry into `desktop/dist/main.js` and hands
it to Electron. The supervisor forks a Next server in production mode against
the data dir chosen by the first-run wizard (or `LARIAT_DATA_DIR` if set).

## Build & Distribute

```bash
npm run desktop:build           # next build + tsc -p desktop + vite build wizard
npm run desktop:dist            # the above, then electron-builder --mac --arm64 --x64
```

`desktop:dist` produces a notarized `.dmg` plus a `.zip` for autoupdater feeds
under `dist/`. Notarization secrets live in `.lariat-build.env` (gitignored —
see `docs/OPERATIONS.md`).

## Boundaries

- **No business logic.** Everything regulated (HACCP, labor, costing) stays in
  `lib/` and `app/api/`. The wrapper only does process supervision, window
  chrome, and OS integration.
- **No SQLite reads from the main process.** The forked Next server owns
  `data/lariat.db`; the wrapper talks to it over HTTP on localhost like any
  other client.
- **Audit immutability stands.** The wrapper never mutates `audit_events` or
  any regulated table directly.

## Subsequent tasks

This scaffold is intentionally empty of runtime code. The actual entry points
and supervisor land in tasks T3–T8 of the desktop-wrapper plan; T9 adds the
`electron-builder.yml` + entitlements; T11 adds CI smoke. Until those tasks
ship, `npm run desktop:dev` will fail because there are no `.ts` files for
`tsc -p desktop` to emit.
