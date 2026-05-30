# Lariat Desktop Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a current implementation plan and one authoritative build script for packaging Lariat as a standalone macOS desktop application.

**Architecture:** Keep the existing Electron supervisor plus child Next.js server architecture. Add a repository script that validates the required packaging files, runs the production desktop build, rebuilds native Electron dependencies, and invokes Electron Builder with publish disabled.

**Tech Stack:** Node.js, TypeScript, Next.js, React, Electron, Electron Builder, Vite, `better-sqlite3`.

---

## File Structure

- Modify: `package.json` to route `desktop:dist` through `scripts/package-desktop.mjs` and add `desktop:dist:dry`.
- Create: `scripts/package-desktop.mjs` as the canonical desktop package command.
- Modify: `desktop/README.md` so the quick reference points at the canonical script.
- Create: `docs/desktop-packaging.md` as the current packaging runbook.
- Create: `docs/superpowers/plans/2026-05-28-lariat-desktop-packaging.md` as this implementation plan.

## Task 1: Add The Packaging Script

**Files:**
- Create: `scripts/package-desktop.mjs`

- [ ] **Step 1: Create the script**

Create `scripts/package-desktop.mjs` with:

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const skipNativeDeps = args.has('--skip-native-deps');

const archArg = process.argv.find((arg) => arg.startsWith('--arch='));
const archList = archArg
  ? archArg.slice('--arch='.length).split(',').map((arch) => arch.trim()).filter(Boolean)
  : ['arm64', 'x64'];

const validArch = new Set(['arm64', 'x64']);
for (const arch of archList) {
  if (!validArch.has(arch)) {
    fail(`Unsupported --arch value "${arch}". Use arm64, x64, or arm64,x64.`);
  }
}
```

- [ ] **Step 2: Add input validation**

The script must validate these files before it runs a build:

```js
const requiredFiles = [
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'electron-builder.yml',
  'desktop/main.ts',
  'desktop/preload.ts',
  'desktop/supervisor.ts',
  'desktop/server-entry.cjs',
  'desktop/settings.ts',
  'desktop/paths.ts',
  'desktop/tsconfig.json',
  'desktop/entitlements.mac.plist',
  'desktop/icons/AppIcon.icns',
  'desktop/icons/dmg-background.png',
  'desktop/firstRunWizard/index.html',
  'desktop/firstRunWizard/vite.config.ts',
  'desktop/firstRunWizard/wizard.tsx',
];
```

- [ ] **Step 3: Run commands in fixed order**

The script must run:

```bash
npm run desktop:build
node_modules/.bin/electron-builder install-app-deps
node_modules/.bin/electron-builder --config electron-builder.yml --mac --arm64 --x64 --publish never
```

Expected result: `dist/` contains per-architecture macOS artifacts.

## Task 2: Wire NPM Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace `desktop:dist`**

Set:

```json
{
  "desktop:dist": "node scripts/package-desktop.mjs",
  "desktop:dist:dry": "node scripts/package-desktop.mjs --dry-run"
}
```

- [ ] **Step 2: Validate script discovery**

Run:

```bash
npm run desktop:dist:dry
```

Expected output includes:

```text
Lariat desktop packaging plan
$ npm run desktop:build
$ node_modules/.bin/electron-builder install-app-deps
$ node_modules/.bin/electron-builder --config electron-builder.yml --mac --arm64 --x64 --publish never
Dry run complete. No build artifacts were written.
```

## Task 3: Document The Packaging Contract

**Files:**
- Modify: `desktop/README.md`
- Create: `docs/desktop-packaging.md`

- [ ] **Step 1: Update quick reference**

`desktop/README.md` must list:

```bash
npm run desktop:dev        # local Electron loop
npm run desktop:dist:dry   # validate packaging inputs and commands
npm run desktop:dist       # build dmg/zip artifacts under dist/
```

- [ ] **Step 2: Write the runbook**

`docs/desktop-packaging.md` must define:

- chosen toolchain: Electron plus Electron Builder
- target OS: macOS 11+ on `arm64` and `x64`
- primary entry point: `desktop/main.ts`
- child server entry point: `desktop/server-entry.cjs`
- required configuration files: `package.json`, `scripts/package-desktop.mjs`, `electron-builder.yml`, `desktop/tsconfig.json`, `desktop/firstRunWizard/vite.config.ts`, and `desktop/entitlements.mac.plist`
- asset bundling rules from `electron-builder.yml`
- dependency inclusion and native rebuild rules
- binary optimization rules
- signing and notarization posture

## Task 4: Verify

**Files:**
- No source edits.

- [ ] **Step 1: Run dry package validation**

Run:

```bash
npm run desktop:dist:dry
```

Expected: exit 0.

- [ ] **Step 2: Run desktop TypeScript build**

Run:

```bash
npm run desktop:build
```

Expected: Next production build, desktop TypeScript compile, and wizard Vite build complete.

- [ ] **Step 3: Inspect dirty state**

Run:

```bash
git status --short
```

Expected: only the files listed in this plan are modified or untracked.
