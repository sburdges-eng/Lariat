# Lariat Desktop Packaging

## Current Stack

- Project: `lariat-cockpit`
- Desktop product name: `Lariat`
- Language/framework: TypeScript and JavaScript, Next.js, React, Electron
- Host for packaging: macOS
- Target OS: macOS 11+ on `arm64` and `x64`
- Primary desktop entry point: `desktop/main.ts`
- Compiled Electron entry point: `desktop/dist/desktop/main.js`
- Child server entry point: `desktop/server-entry.cjs`
- Build config: `electron-builder.yml`

Core runtime dependencies bundled with the app:

- `electron` for the desktop shell
- `next`, `react`, and `react-dom` for the web runtime
- `better-sqlite3` for the local SQLite write model
- `bonjour-service` for LAN discovery support
- `@huggingface/transformers` plus ONNX packages for local assistant features

## Toolchain Decision

Use Electron plus Electron Builder. This repo already runs a Next.js server,
needs Node native-module support for `better-sqlite3`, and exposes a local HTTP
server to kitchen iPads. Electron preserves that server architecture while
providing a real `.app`, `.dmg`, and `.zip` output.

Do not replace this with a second desktop stack for the current macOS target.
Tauri would require a separate native host strategy for the existing Next.js
server and Node native modules. A hand-rolled `.app` launcher does not provide
repeatable dependency inclusion, native rebuilds, or signing/notarization hooks.

## Authoritative Build Files

- `package.json`
  - `main`: `desktop/dist/desktop/main.js`
  - `desktop:build`: builds Next, compiles Electron TypeScript, and builds the first-run wizard
  - `desktop:dist`: runs `scripts/package-desktop.mjs`
  - `desktop:dist:dry`: validates the packaging contract without writing artifacts
- `scripts/package-desktop.mjs`
  - validates required source files and Electron Builder rules
  - runs the exact packaging command with update checks and publish disabled
  - defaults to macOS `arm64` and `x64`
- `electron-builder.yml`
  - defines app id, product name, output directory, included files, icon assets,
    macOS entitlements, ad-hoc signing posture, and DMG layout
- `desktop/tsconfig.json`
  - compiles the Electron main/preload/supervisor code into `desktop/dist`
- `desktop/firstRunWizard/vite.config.ts`
  - builds the first-run wizard into `desktop/dist/wizard`
- `desktop/entitlements.mac.plist`
  - grants the hardened-runtime permissions needed for local networking and native modules

## Build Commands

Validate the packaging setup without creating artifacts:

```bash
npm run desktop:dist:dry
```

Build the production Next server, Electron wrapper, wizard, native deps, `.dmg`,
and `.zip` artifacts:

```bash
npm run desktop:dist
```

Package only Apple Silicon:

```bash
node scripts/package-desktop.mjs --arch=arm64
```

Reuse an existing compiled `.next/` and `desktop/dist/` tree:

```bash
node scripts/package-desktop.mjs --skip-build
```

## Asset Bundling

Electron Builder copies these source assets into the packaged app:

- `desktop/dist/**` for compiled Electron main/preload/supervisor code and wizard output
- `desktop/server-entry.cjs` for the forked Next.js child process
- `.next/**` excluding `.next/cache/**` and `.next/trace`
- `public/**`
- `package.json`
- `node_modules/**` with tests, docs, TypeScript declarations, source maps, and markdown excluded
- `desktop/icons/AppIcon.icns`
- `desktop/icons/dmg-background.png`

The app icon and DMG background live under `desktop/icons/` because
`electron-builder.yml` uses that directory as `buildResources`.

## Dependency Inclusion

`npm run desktop:dist` runs `electron-builder install-app-deps` before packaging.
That rebuilds native dependencies such as `better-sqlite3` for Electron's Node
ABI. The packaged child server is launched with Electron's bundled Node runtime
and `ELECTRON_RUN_AS_NODE=1`, so runtime behavior does not depend on a system
Node install.

Python, Ollama, and external data packs are not bundled. The first-run wizard
records operator-selected paths in the local settings file. The app remains
usable without a data pack; those features degrade through existing runtime
guards.

## Binary Optimization

The current package is optimized by exclusion rather than by changing runtime
architecture:

- `.next/cache/**` and `.next/trace` are excluded
- tests, examples, docs, TypeScript declaration files, source maps, and markdown
  are excluded from `node_modules`
- Electron Builder publish and update checks are disabled in the packaging script
- output is per architecture instead of a single universal binary
- `asar` remains disabled because this app ships a Next server, native modules,
  and runtime-resolved assets

## Signing And Notarization

The default local build is ad-hoc signed by Electron Builder:

```yaml
mac:
  identity: null
```

To notarize later, set `mac.identity` to a Developer ID Application identity,
uncomment `afterSign: desktop/notarize.cjs`, and provide
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in
`~/.lariat-build.env`. That file is gitignored and must not be committed.

## Governance Notes

- Affected subsystem: desktop packaging and local build tooling
- Freeze-readiness impact: positive; packages are reproducible from committed
  source, package lock, and local build inputs
- Determinism impact: positive; one script owns validation, build order,
  native rebuild, architecture selection, and publish-off packaging
- Security impact: neutral; no runtime cloud dependency is introduced, and
  notarization secrets remain outside the repo
