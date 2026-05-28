# Lariat Desktop Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Lariat as a macOS `.app`/`.dmg` via Electron supervisor + child Next.js server, preserving LAN-exposed iPad terminals and surviving server crashes.

**Architecture:** Electron main process supervises a forked Next.js child running on Electron's bundled Node ABI. Native deps (`better-sqlite3`) rebuild once. mDNS responder lives in supervisor and survives child restarts. Configurable data directory via first-run wizard + JSON settings file.

**Tech Stack:** Electron + electron-builder + electron-rebuild · Vite (wizard build) · React 18 (wizard UI) · Next.js 14 standalone (existing) · `node --test` (test runner)

**Spec:** `docs/desktop-wrapper-design.md` (commits `e89fa28`, `0278d95`)

---

## Pre-execution context (read once before starting)

### Worktree requirement

This plan has 12 commits. Per `~/.claude/projects/-Users-seanburdges-Dev-Lariat/memory/feedback_multi_session_worktrees.md`, multi-commit batches in Lariat MUST run in a per-tool worktree, not in `main` (other Claude/Cursor/Codex sessions edit main concurrently).

```bash
cd <repo-root>
scripts/worktree.sh new claude desktop-wrapper
cd ../Lariat-worktrees/claude-desktop-wrapper
git branch --show-current   # must print: feat/desktop-wrapper
```

If the script prefixes with `wip/` instead, that's also fine per the branch-naming rule. Just don't proceed if the branch starts with `cursor/`, `bundle-h-`, or anything other than `feat/`/`fix/`/`chore/`/`wip/` — the pre-commit guard will refuse.

### CLAUDE.md rules to remember

| Rule | Where it kicks in |
|---|---|
| `gitnexus_impact({target, direction:"upstream"})` before editing any function/class/method | T1 (before `lib/db.ts` edit) |
| `gitnexus_detect_changes()` before every commit | Every task's commit step |
| **Do not mock SQLite** in tests — use real in-memory or temp-file DB | T1 test, T5 integration test |
| `--experimental-strip-types` flag required for `node --test` importing `.ts` files | T1, T3, T4 test runs |
| Schema migrations live in `lib/db.ts`'s `initSchema` / `migrateLegacyColumns` (not edited in place) | This plan does not touch schema; if a future task does, follow the migration pattern |

### Re-indexing GitNexus

If a tool warns "GitNexus index is stale" after code edits, run `npx gitnexus analyze` from the project root before relying on impact analysis.

### Verification commands cheat-sheet

```bash
# Single Node test (the common case)
node --test tests/js/test-db-data-dir.mjs

# Single Node test importing .ts files
node --experimental-strip-types --test desktop/__tests__/settings.test.ts

# Full Lariat verify gate (typecheck + jest + node + pytest + build)
npm run verify   # if it exists in package.json; otherwise:
npm run lint && npm run typecheck && npm run test:unit && pytest tests/python && npm run build

# Desktop dev loop
npm run desktop:dev

# Desktop production .dmg
npm run desktop:dist   # output: dist/Lariat-0.1.0-arm64.dmg
```

---

## File map (locked before tasks)

### Modified

| Path | Change | Task |
|---|---|---|
| `lib/db.ts` (lines 6–7) | `DB_DIR` honors `LARIAT_DATA_DIR` env, fallback unchanged | T1 |
| `package.json` | Add `electron`, `electron-builder`, `@electron/rebuild`, `vite`, `@vitejs/plugin-react`, `electron-window-state` to devDeps; add `desktop:dev`, `desktop:build`, `desktop:dist`, `postinstall` scripts | T2 |
| `tsconfig.json` | Add `desktop/**` to `exclude` array | T2 |
| `.gitignore` | Add `dist/`, `desktop/dist/`, `~/.lariat-build.env` | T2 |

### Created

| Path | Purpose | Task |
|---|---|---|
| `tests/js/test-db-data-dir.mjs` | Regression: `lib/db.ts` honors env, falls back when unset | T1 |
| `desktop/tsconfig.json` | TS config for desktop tree (CJS, ES2022) | T2 |
| `desktop/README.md` | Manual smoke checklist + Python/Ollama install notes | T2 |
| `desktop/icons/AppIcon.icns` | Moved from `Lariat.app/Contents/Resources/AppIcon.icns` | T2 |
| `desktop/icons/dmg-background.png` | Plain 540×380 background (placeholder via ImageMagick) | T2 |
| `desktop/paths.ts` | OS path helpers: `settingsPath()`, `logDir()`, `crashLogPath()` | T3 |
| `desktop/__tests__/paths.test.ts` | Asserts macOS path shape, stubable | T3 |
| `desktop/settings.ts` | Read/write `settings.json` with hand-rolled validation, atomic temp+rename write | T4 |
| `desktop/__tests__/settings.test.ts` | Round-trip, malformed-JSON rejection, atomic-write fault tolerance | T4 |
| `desktop/server-entry.cjs` | Forked into child by supervisor; boots Next programmatically | T5 |
| `desktop/__tests__/server-boot.integration.ts` | Spawn server-entry against temp data dir, curl `/api/discover` | T5 |
| `desktop/supervisor.ts` | Child lifecycle: spawn, restart with backoff, daily log rotation, crashes.jsonl | T6 |
| `desktop/__tests__/supervisor.test.ts` | Backoff sequence, give-up after 3 failures in 60s (fake timers) | T6 |
| `desktop/__tests__/crash-recovery.integration.ts` | Real supervisor against deliberately-broken entry; verify 3 attempts logged | T6 |
| `desktop/main.ts` | Electron entry: settings bootstrap → wizard or supervisor → window → mDNS | T7 |
| `desktop/preload.ts` | `contextBridge` API for wizard | T8 |
| `desktop/firstRunWizard/index.html` | Wizard window root | T8 |
| `desktop/firstRunWizard/wizard.tsx` | React wizard, three steps | T8 |
| `desktop/firstRunWizard/wizard.css` | Minimal styling | T8 |
| `desktop/firstRunWizard/vite.config.ts` | Vite build config for wizard → `desktop/dist/wizard/` | T8 |
| `desktop/entitlements.mac.plist` | Hardened-runtime entitlements | T9 |
| `electron-builder.yml` | Build + dmg config (ad-hoc sign, notarize-ready) | T9 |
| `.github/workflows/desktop-smoke.yml` | CI: build + integration tests on `macos-14` | T11 |

### Deleted

| Path | Why | Task |
|---|---|---|
| `Lariat.app/` (entire directory) | Replaced by electron-builder output; AppIcon.icns moved | T9 |

---

## Task 1: `lib/db.ts` honors `LARIAT_DATA_DIR`

**Files:**
- Modify: `lib/db.ts` (lines 6–7)
- Create test: `tests/js/test-db-data-dir.mjs`

- [ ] **Step 1.1: Run impact analysis on the symbol being edited**

```
gitnexus_impact({target: "DB_DIR", direction: "upstream"})
gitnexus_impact({target: "DB_PATH", direction: "upstream"})
```

If impact reports HIGH or CRITICAL risk, stop and surface to user before continuing. Expected: LOW (these are module-private constants used only by `getDb` paths inside `lib/db.ts`).

- [ ] **Step 1.2: Write the failing test**

Create `tests/js/test-db-data-dir.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('lib/db.ts uses process.cwd()/data when LARIAT_DATA_DIR is unset', async () => {
  delete process.env.LARIAT_DATA_DIR;
  // Re-import the module fresh so the constant is recomputed
  const dbModule = await import(`../../lib/db.ts?cb=${Date.now()}`);
  const { _resolveDbPathForTest } = dbModule;
  assert.equal(
    _resolveDbPathForTest(),
    path.join(process.cwd(), 'data', 'lariat.db'),
  );
});

test('lib/db.ts uses LARIAT_DATA_DIR/lariat.db when env is set', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-data-dir-'));
  process.env.LARIAT_DATA_DIR = tmp;
  try {
    const dbModule = await import(`../../lib/db.ts?cb=${Date.now()}`);
    const { _resolveDbPathForTest } = dbModule;
    assert.equal(_resolveDbPathForTest(), path.join(tmp, 'lariat.db'));
  } finally {
    delete process.env.LARIAT_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.3: Run test to verify it fails**

```bash
node --experimental-strip-types --test tests/js/test-db-data-dir.mjs
```

Expected: FAIL with `_resolveDbPathForTest is not a function` (or similar import error). Both subtests fail.

- [ ] **Step 1.4: Implement the env-var read + the test-only export**

Edit `lib/db.ts`. Replace lines 6–7:

```ts
const DB_DIR = process.env.LARIAT_DATA_DIR
  ? path.resolve(process.env.LARIAT_DATA_DIR)
  : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'lariat.db');

/**
 * Test-only: resolve the DB path the same way module init does, so a test
 * can assert env behavior without poking module state. Production code
 * never calls this.
 */
export function _resolveDbPathForTest(): string {
  return process.env.LARIAT_DATA_DIR
    ? path.join(path.resolve(process.env.LARIAT_DATA_DIR), 'lariat.db')
    : path.join(process.cwd(), 'data', 'lariat.db');
}
```

- [ ] **Step 1.5: Run test to verify it passes**

```bash
node --experimental-strip-types --test tests/js/test-db-data-dir.mjs
```

Expected: PASS, 2/2 subtests, exit 0.

- [ ] **Step 1.6: Run the full existing test suite to verify no regression**

```bash
npm run test:unit && node --test tests/js/*.mjs
```

Expected: all green. The default-branch behavior is preserved, so existing tests that rely on `data/lariat.db` keep working.

- [ ] **Step 1.7: Run gitnexus_detect_changes and verify scope**

```
gitnexus_detect_changes()
```

Expected: Only `lib/db.ts` and `tests/js/test-db-data-dir.mjs` flagged.

- [ ] **Step 1.8: Commit**

```bash
git add lib/db.ts tests/js/test-db-data-dir.mjs
git commit -m "$(cat <<'EOF'
feat(db): honor LARIAT_DATA_DIR for desktop wrapper bootstrap

lib/db.ts now resolves the data directory from LARIAT_DATA_DIR when
set, falling back to process.cwd()/data so dev/test/CI behavior is
unchanged. Adds _resolveDbPathForTest() for regression coverage.

Required by the desktop-wrapper supervisor (docs/desktop-wrapper-design.md
§5) which sets this env when forking the Next.js child.
EOF
)"
```

---

## Task 2: Desktop scaffolding (deps + dirs + tsconfig)

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `desktop/tsconfig.json`, `desktop/README.md`, `desktop/icons/` (with moved `AppIcon.icns`)

- [ ] **Step 2.1: Add devDependencies**

```bash
npm install --save-dev \
  electron@31 \
  electron-builder@24 \
  @electron/rebuild@3 \
  vite@5 \
  @vitejs/plugin-react@4 \
  electron-window-state@5
```

Expected: clean install, no peer warnings that block. `package-lock.json` updated.

- [ ] **Step 2.2: Add scripts to `package.json`**

In `package.json`, add to the `"scripts"` block (alphabetize if the file does, otherwise append):

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

If a `postinstall` script already exists, chain it: `"postinstall": "<existing> && electron-builder install-app-deps"`.

- [ ] **Step 2.3: Create `desktop/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["./**/*.ts"],
  "exclude": ["./dist/**", "./__tests__/**", "./firstRunWizard/**"]
}
```

The wizard has its own Vite config (T8) and isn't compiled by tsc.

- [ ] **Step 2.4: Update root `tsconfig.json` to exclude `desktop/`**

In `tsconfig.json`, add `"desktop/**"` and `"electron-builder.yml"` to the `"exclude"` array.

- [ ] **Step 2.5: Update `.gitignore`**

Append:

```
# Desktop wrapper build outputs
dist/
desktop/dist/

# Local notarization secrets (never commit)
.lariat-build.env
```

- [ ] **Step 2.6: Move the existing icon into the desktop tree**

```bash
mkdir -p desktop/icons
git mv Lariat.app/Contents/Resources/AppIcon.icns desktop/icons/AppIcon.icns
```

(Use `git mv` per CLAUDE.md "history-preserving moves." The rest of `Lariat.app/` is deleted in T9.)

- [ ] **Step 2.7: Create a placeholder DMG background**

```bash
# 540×380 transparent PNG; replace later with a real background
python3 -c "from PIL import Image; Image.new('RGBA',(540,380),(245,245,245,255)).save('desktop/icons/dmg-background.png')"
```

If PIL is not in the active venv, use ImageMagick: `magick -size 540x380 xc:'#F5F5F5' desktop/icons/dmg-background.png`.

- [ ] **Step 2.8: Create `desktop/README.md`** (write the literal contents below — note the outer fence here is 4 backticks because the README itself contains 3-backtick blocks)

````markdown
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
````

- [ ] **Step 2.9: Verify the scaffold doesn't break the existing Lariat build**

```bash
npm run build
```

Expected: Next build completes; no new TS errors from `desktop/` (excluded).

- [ ] **Step 2.10: Verify TypeScript checks the desktop tree on its own**

```bash
tsc -p desktop --noEmit
```

Expected: no files compiled (no `.ts` files yet), exits 0.

- [ ] **Step 2.11: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore desktop/ Lariat.app/
git commit -m "$(cat <<'EOF'
feat(desktop): scaffold electron wrapper deps + tree

Adds electron, electron-builder, @electron/rebuild, vite, @vitejs/plugin-react,
electron-window-state to devDeps. Creates desktop/ tree (tsconfig, README,
icons/) and excludes it from the root tsc pass. Moves AppIcon.icns from the
legacy Lariat.app/ launcher into desktop/icons/ via git mv.

Subsequent tasks add the actual main.ts, supervisor, settings, server-entry,
preload, and first-run wizard against this scaffold.
EOF
)"
```

---

## Task 3: `desktop/paths.ts` (OS path helpers)

**Files:**
- Create: `desktop/paths.ts`
- Create test: `desktop/__tests__/paths.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `desktop/__tests__/paths.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { settingsPath, logDir, crashLogPath, dataDirDefault } from '../paths.ts';

test('settingsPath lives under ~/Library/Application Support/Lariat', () => {
  const p = settingsPath();
  assert.equal(
    p,
    path.join(os.homedir(), 'Library', 'Application Support', 'Lariat', 'settings.json'),
  );
});

test('logDir lives under ~/Library/Logs/Lariat', () => {
  assert.equal(logDir(), path.join(os.homedir(), 'Library', 'Logs', 'Lariat'));
});

test('crashLogPath is logDir/crashes.jsonl', () => {
  assert.equal(crashLogPath(), path.join(logDir(), 'crashes.jsonl'));
});

test('dataDirDefault lives under ~/Library/Application Support/Lariat/data', () => {
  assert.equal(
    dataDirDefault(),
    path.join(os.homedir(), 'Library', 'Application Support', 'Lariat', 'data'),
  );
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
node --experimental-strip-types --test desktop/__tests__/paths.test.ts
```

Expected: FAIL with `Cannot find module '../paths.ts'`.

- [ ] **Step 3.3: Implement `desktop/paths.ts`**

```ts
import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'Lariat';

function appSupportDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
}

export function settingsPath(): string {
  return path.join(appSupportDir(), 'settings.json');
}

export function dataDirDefault(): string {
  return path.join(appSupportDir(), 'data');
}

export function logDir(): string {
  return path.join(os.homedir(), 'Library', 'Logs', APP_NAME);
}

export function crashLogPath(): string {
  return path.join(logDir(), 'crashes.jsonl');
}

export function serverLogPath(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(logDir(), `server-${yyyy}-${mm}-${dd}.log`);
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
node --experimental-strip-types --test desktop/__tests__/paths.test.ts
```

Expected: PASS, 4/4 subtests.

- [ ] **Step 3.5: Commit**

```bash
git add desktop/paths.ts desktop/__tests__/paths.test.ts
git commit -m "feat(desktop): add OS path helpers (settings, logs, crash log)"
```

---

## Task 4: `desktop/settings.ts` (read/write with hand-rolled validation)

**Files:**
- Create: `desktop/settings.ts`
- Create test: `desktop/__tests__/settings.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `desktop/__tests__/settings.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, saveSettings, validateSettings, type Settings } from '../settings.ts';

function makeTmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-settings-'));
  return path.join(dir, 'settings.json');
}

test('readSettings returns null when file missing', () => {
  const p = makeTmpFile();
  assert.equal(readSettings(p), null);
});

test('readSettings returns null when JSON is malformed', () => {
  const p = makeTmpFile();
  fs.writeFileSync(p, '{not valid json');
  assert.equal(readSettings(p), null);
});

test('readSettings returns null when shape fails validation', () => {
  const p = makeTmpFile();
  fs.writeFileSync(p, JSON.stringify({ dataDir: 42 }));
  assert.equal(readSettings(p), null);
});

test('saveSettings + readSettings round-trips', () => {
  const p = makeTmpFile();
  const s: Settings = {
    dataDir: path.join(os.tmpdir(), 'lariat-data'),
    pythonPath: path.join(os.tmpdir(), '.venv', 'bin', 'python3'),
    datapackDir: path.join(os.tmpdir(), 'ssd-data'),
    ollamaUrl: 'http://127.0.0.1:11434',
    port: 3000,
  };
  saveSettings(p, s);
  assert.deepEqual(readSettings(p), s);
});

test('saveSettings writes atomically (temp file gone after success)', () => {
  const p = makeTmpFile();
  saveSettings(p, { dataDir: '/x', port: 3000 });
  const tempLeft = fs.readdirSync(path.dirname(p)).filter(f => f.includes('.tmp'));
  assert.deepEqual(tempLeft, []);
});

test('validateSettings accepts minimal settings (dataDir + port only)', () => {
  assert.deepEqual(
    validateSettings({ dataDir: '/x', port: 3000 }),
    { dataDir: '/x', port: 3000 },
  );
});

test('validateSettings rejects missing dataDir', () => {
  assert.equal(validateSettings({ port: 3000 }), null);
});

test('validateSettings rejects non-integer port', () => {
  assert.equal(validateSettings({ dataDir: '/x', port: 'three' }), null);
});

test('validateSettings rejects port out of range', () => {
  assert.equal(validateSettings({ dataDir: '/x', port: 70000 }), null);
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
node --experimental-strip-types --test desktop/__tests__/settings.test.ts
```

Expected: FAIL with `Cannot find module '../settings.ts'`.

- [ ] **Step 4.3: Implement `desktop/settings.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Settings {
  dataDir: string;
  port: number;                  // 1024–65535
  datapackDir?: string;          // populates LARIAT_DATA_ROOT
  pythonPath?: string;           // populates LARIAT_PYTHON
  ollamaUrl?: string;            // defaults to http://127.0.0.1:11434 if absent
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535;
}

/**
 * Validates an unknown blob against the Settings shape. Returns the
 * normalized object on success, null on any structural error. Optional
 * fields are dropped from the output if absent or non-string.
 */
export function validateSettings(input: unknown): Settings | null {
  if (input === null || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (!isString(o.dataDir)) return null;
  if (!isPort(o.port)) return null;
  const out: Settings = { dataDir: o.dataDir, port: o.port };
  if (isString(o.datapackDir)) out.datapackDir = o.datapackDir;
  if (isString(o.pythonPath)) out.pythonPath = o.pythonPath;
  if (isString(o.ollamaUrl)) out.ollamaUrl = o.ollamaUrl;
  return out;
}

export function readSettings(filePath: string): Settings | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateSettings(parsed);
}

/**
 * Atomic write: serialize to a sibling .tmp.<rand> file then rename
 * (POSIX rename is atomic on the same filesystem). On any error the
 * .tmp file is removed and the exception propagates.
 */
export function saveSettings(filePath: string, settings: Settings): void {
  const validated = validateSettings(settings);
  if (!validated) {
    throw new Error('saveSettings called with invalid settings');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
node --experimental-strip-types --test desktop/__tests__/settings.test.ts
```

Expected: PASS, 9/9 subtests.

- [ ] **Step 4.5: Commit**

```bash
git add desktop/settings.ts desktop/__tests__/settings.test.ts
git commit -m "feat(desktop): add settings reader/writer with hand-rolled validation"
```

---

## Task 5: `desktop/server-entry.cjs` (Next programmatic boot) + integration test

**Files:**
- Create: `desktop/server-entry.cjs`
- Create test: `desktop/__tests__/server-boot.integration.ts`

- [ ] **Step 5.1: Write the failing integration test**

Create `desktop/__tests__/server-boot.integration.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ENTRY = path.resolve(__dirname, '..', 'server-entry.cjs');
const PORT = 3199;

function waitForHttp(url: string, timeoutMs = 30_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  return (async function loop(): Promise<Response> {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok) return r;
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`timed out waiting for ${url}`);
  })();
}

test('server-entry.cjs boots Next and serves /api/discover', { timeout: 60_000 }, async (t) => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-srv-'));
  const child: ChildProcess = fork(ENTRY, [], {
    env: {
      ...process.env,
      LARIAT_DATA_DIR: tmpData,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
    },
    silent: true,
  });

  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM');
    fs.rmSync(tmpData, { recursive: true, force: true });
  });

  const r = await waitForHttp(`http://127.0.0.1:${PORT}/api/discover`);
  const body = await r.json();
  assert.equal(typeof body.location_id, 'string');
  assert.equal(typeof body.started_at, 'string');
});
```

- [ ] **Step 5.2: Verify the test fails (entry doesn't exist yet)**

Build Next first so `.next/standalone` is available, then run the test:

```bash
npm run build
node --experimental-strip-types --test desktop/__tests__/server-boot.integration.ts
```

Expected: FAIL — `Cannot find module 'desktop/server-entry.cjs'` or fork error.

- [ ] **Step 5.3: Implement `desktop/server-entry.cjs`**

```js
// desktop/server-entry.cjs
//
// Forked into a child by desktop/supervisor.ts. Boots Next.js
// programmatically against the project root (which is the unpacked .app
// Resources/app dir in production, or the repo root in dev).
//
// Required env (set by supervisor):
//   PORT, HOST, NODE_ENV, LARIAT_DATA_DIR
// Optional env:
//   LARIAT_DATA_ROOT (data pack dir), LARIAT_PYTHON, LARIAT_OLLAMA_URL

const path = require('node:path');
const http = require('node:http');
const next = require('next');

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';

// In production the .app's Resources/app/ holds package.json + .next/.
// In dev (npm run desktop:dev) this resolves to the repo root.
const projectDir = path.resolve(__dirname, '..');

const app = next({ dev, dir: projectDir });
const handle = app.getRequestHandler();

let server;

app.prepare()
  .then(() => {
    server = http.createServer((req, res) => handle(req, res));
    server.listen(port, host, () => {
      console.log(`[server-entry] ready on ${host}:${port} (dataDir=${process.env.LARIAT_DATA_DIR})`);
    });
  })
  .catch((err) => {
    console.error('[server-entry] failed to start Next:', err);
    process.exit(1);
  });

// Graceful shutdown — supervisor sends {type:"shutdown"} via IPC
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') {
    if (!server) return process.exit(0);
    const forceTimer = setTimeout(() => process.exit(0), 5_000);
    server.close(() => {
      clearTimeout(forceTimer);
      process.exit(0);
    });
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
```

- [ ] **Step 5.4: Run the integration test to verify it passes**

```bash
node --experimental-strip-types --test desktop/__tests__/server-boot.integration.ts
```

Expected: PASS within 60s. The test boots a real Next server, hits `/api/discover`, asserts shape.

If it fails with a port-in-use error, change `PORT` in the test to a higher number.

- [ ] **Step 5.5: Commit**

```bash
git add desktop/server-entry.cjs desktop/__tests__/server-boot.integration.ts
git commit -m "feat(desktop): add server-entry.cjs for forked Next.js child"
```

---

## Task 6: `desktop/supervisor.ts` (lifecycle + backoff + crashlog) + tests

**Files:**
- Create: `desktop/supervisor.ts`
- Create test: `desktop/__tests__/supervisor.test.ts`
- Create test: `desktop/__tests__/crash-recovery.integration.ts`
- Create fixture: `desktop/__tests__/fixtures/server-entry-broken.cjs`

- [ ] **Step 6.1: Write the failing unit test (backoff + give-up)**

Create `desktop/__tests__/supervisor.test.ts`:

```ts
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { computeRestartDecision, type Attempt } from '../supervisor.ts';

const NOW = 1_000_000;

test('first failure schedules restart at 1s', () => {
  const decision = computeRestartDecision([], NOW);
  assert.deepEqual(decision, { action: 'restart', delayMs: 1000 });
});

test('second failure (within 60s) schedules at 2s', () => {
  const attempts: Attempt[] = [{ tsMs: NOW - 5_000 }];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 2000 },
  );
});

test('third failure (within 60s) schedules at 5s', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 10_000 },
    { tsMs: NOW - 5_000 },
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 5000 },
  );
});

test('fourth failure within 60s gives up', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 30_000 },
    { tsMs: NOW - 20_000 },
    { tsMs: NOW - 10_000 },
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'give_up' },
  );
});

test('attempts older than 60s do not count toward give-up', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 90_000 },  // expired
    { tsMs: NOW - 80_000 },  // expired
    { tsMs: NOW - 70_000 },  // expired
    { tsMs: NOW - 5_000 },   // counts as the only recent
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 2000 },
  );
});
```

- [ ] **Step 6.2: Run unit test to verify it fails**

```bash
node --experimental-strip-types --test desktop/__tests__/supervisor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement the pure decision function in `desktop/supervisor.ts`**

Start with just the pure logic (Step 6.5 layers the I/O):

```ts
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logDir, crashLogPath, serverLogPath } from './paths';

export interface Attempt {
  tsMs: number;
}

export type RestartDecision =
  | { action: 'restart'; delayMs: number }
  | { action: 'give_up' };

const BACKOFF_MS = [1000, 2000, 5000];
const WINDOW_MS = 60_000;

export function computeRestartDecision(
  recentAttempts: Attempt[],
  nowMs: number,
): RestartDecision {
  const inWindow = recentAttempts.filter(a => a.tsMs >= nowMs - WINDOW_MS);
  if (inWindow.length >= BACKOFF_MS.length) return { action: 'give_up' };
  return { action: 'restart', delayMs: BACKOFF_MS[inWindow.length] };
}
```

- [ ] **Step 6.4: Run unit test to verify it passes**

```bash
node --experimental-strip-types --test desktop/__tests__/supervisor.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 6.5: Layer in the live supervisor (lifecycle, log piping, crashlog append)**

Append to `desktop/supervisor.ts`:

```ts
const STDERR_RING_LINES = 200;

export interface SupervisorOptions {
  entryPath: string;     // absolute path to server-entry.cjs
  electronExecPath: string; // process.execPath inside Electron main
  env: NodeJS.ProcessEnv;
  onCrash?: (info: CrashInfo) => void;
  onReady?: () => void;
}

export interface CrashInfo {
  ts: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  restartAttempt: number;
  stderrTail: string;
}

export class Supervisor {
  private child: ChildProcess | null = null;
  private attempts: Attempt[] = [];
  private stderrRing: string[] = [];
  private stoppedByUser = false;
  private logStream: fs.WriteStream | null = null;

  constructor(private opts: SupervisorOptions) {
    fs.mkdirSync(logDir(), { recursive: true });
  }

  start(): void {
    this.stoppedByUser = false;
    this.spawnOnce();
  }

  /** Sends shutdown IPC, waits up to 8s, then SIGTERM, then SIGKILL. */
  async shutdown(): Promise<void> {
    this.stoppedByUser = true;
    if (!this.child) return;
    const c = this.child;

    const exited = new Promise<void>((resolve) => c.once('exit', () => resolve()));

    try { c.send({ type: 'shutdown' }); } catch { /* IPC closed */ }

    const sigterm = setTimeout(() => { try { c.kill('SIGTERM'); } catch {} }, 8000);
    const sigkill = setTimeout(() => {
      try { c.kill('SIGKILL'); } catch {}
      this.appendCrash({
        ts: new Date().toISOString(),
        exitCode: null,
        signal: 'SIGKILL',
        restartAttempt: this.attempts.length,
        stderrTail: this.stderrRing.join(''),
      });
    }, 10_000);

    await exited;
    clearTimeout(sigterm);
    clearTimeout(sigkill);
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private spawnOnce(): void {
    if (!this.logStream) {
      this.logStream = fs.createWriteStream(serverLogPath(), { flags: 'a' });
    }
    const child = fork(this.opts.entryPath, [], {
      env: this.opts.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execPath: this.opts.electronExecPath,
    });
    this.child = child;
    this.stderrRing = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logStream?.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.logStream?.write(chunk);
      const s = chunk.toString('utf8');
      this.stderrRing.push(s);
      while (this.stderrRing.length > STDERR_RING_LINES) this.stderrRing.shift();
    });

    child.on('exit', (code, signal) => this.onChildExit(code, signal));
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.stoppedByUser) return;

    const now = Date.now();
    this.attempts.push({ tsMs: now });

    const decision = computeRestartDecision(this.attempts, now);
    const info: CrashInfo = {
      ts: new Date(now).toISOString(),
      exitCode: code,
      signal,
      restartAttempt: this.attempts.length,
      stderrTail: this.stderrRing.join(''),
    };
    this.appendCrash(info);
    this.opts.onCrash?.(info);

    if (decision.action === 'give_up') return;
    setTimeout(() => this.spawnOnce(), decision.delayMs);
  }

  private appendCrash(info: CrashInfo): void {
    try {
      fs.appendFileSync(crashLogPath(), JSON.stringify(info) + '\n');
    } catch (e) {
      console.error('[supervisor] failed to append crash log:', e);
    }
  }
}
```

- [ ] **Step 6.6: Re-run unit tests (still pass with the new I/O code attached)**

```bash
node --experimental-strip-types --test desktop/__tests__/supervisor.test.ts
```

Expected: PASS, 5/5. The pure-function tests are unaffected by the class additions.

- [ ] **Step 6.7: Create the broken-entry fixture**

Create `desktop/__tests__/fixtures/server-entry-broken.cjs`:

```js
// Deliberately throws at module load — used by crash-recovery integration test.
console.error('[broken-entry] about to throw');
throw new Error('intentional crash for crash-recovery test');
```

- [ ] **Step 6.8: Write the crash-recovery integration test**

Create `desktop/__tests__/crash-recovery.integration.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Supervisor } from '../supervisor.ts';
import { crashLogPath } from '../paths.ts';

test('supervisor records 3 crashes then gives up on a permanently-broken entry', { timeout: 60_000 }, async (t) => {
  // Move existing crash log out of the way so we can count clean
  const crashFile = crashLogPath();
  const backup = crashFile + '.bak.' + Date.now();
  if (fs.existsSync(crashFile)) fs.renameSync(crashFile, backup);
  t.after(() => {
    if (fs.existsSync(backup)) {
      try { fs.unlinkSync(crashFile); } catch {}
      fs.renameSync(backup, crashFile);
    }
  });

  const entry = path.resolve(__dirname, 'fixtures', 'server-entry-broken.cjs');
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-crash-'));

  let crashCount = 0;
  const sup = new Supervisor({
    entryPath: entry,
    electronExecPath: process.execPath,
    env: { ...process.env, LARIAT_DATA_DIR: tmpData, PORT: '3198' },
    onCrash: () => { crashCount++; },
  });
  sup.start();

  // Wait long enough for backoff sequence: 1s + 2s + 5s = 8s + spawn time
  await new Promise(r => setTimeout(r, 15_000));
  await sup.shutdown();

  assert.equal(crashCount, 3, 'expected exactly 3 crash callbacks');

  const lines = fs.readFileSync(crashFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3, 'expected 3 lines in crashes.jsonl');
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.notEqual(obj.exitCode, 0, 'crash should have non-zero exitCode');
    assert.match(obj.stderrTail, /intentional crash/);
  }

  fs.rmSync(tmpData, { recursive: true, force: true });
});
```

- [ ] **Step 6.9: Run the crash-recovery test**

```bash
node --experimental-strip-types --test desktop/__tests__/crash-recovery.integration.ts
```

Expected: PASS within 60s. Asserts the supervisor logs 3 crashes and then stops trying.

- [ ] **Step 6.10: Commit**

```bash
git add desktop/supervisor.ts desktop/__tests__/supervisor.test.ts desktop/__tests__/crash-recovery.integration.ts desktop/__tests__/fixtures/server-entry-broken.cjs
git commit -m "feat(desktop): add Supervisor with backoff, crash log, graceful shutdown"
```

---

## Task 7: `desktop/main.ts` (Electron entry + window + mDNS)

**Files:**
- Create: `desktop/main.ts`

No new automated tests — Electron main is exercised by the manual smoke checklist (T10). Unit-coverage for the pieces it composes already exists (T3/T4/T6).

- [ ] **Step 7.1: Implement `desktop/main.ts`**

```ts
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Supervisor } from './supervisor';
import { readSettings, saveSettings, type Settings } from './settings';
import { settingsPath, dataDirDefault, logDir, crashLogPath } from './paths';
// Existing Lariat module — supervisor.ts doesn't need it but main.ts does
// because mDNS lifecycle should outlive the child.
import { advertise } from '../lib/mdnsDiscovery';

const DEFAULT_PORT = 3000;

let supervisor: Supervisor | null = null;
let mainWindow: BrowserWindow | null = null;
let wizardWindow: BrowserWindow | null = null;
let mdnsHandle: { stop: () => void } | null = null;

function entryPath(): string {
  // In production the .app unpacks resources at process.resourcesPath/app
  // In dev (npm run desktop:dev) __dirname is desktop/dist/
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'desktop', 'server-entry.cjs');
  }
  return path.resolve(__dirname, '..', 'server-entry.cjs');
}

function projectDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app');
  return path.resolve(__dirname, '..', '..');
}

async function bootSupervisor(settings: Settings): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LARIAT_DATA_DIR: settings.dataDir,
    PORT: String(settings.port),
    HOST: '0.0.0.0',
    NODE_ENV: 'production',
  };
  if (settings.datapackDir) env.LARIAT_DATA_ROOT = settings.datapackDir;
  if (settings.pythonPath) env.LARIAT_PYTHON = settings.pythonPath;
  if (settings.ollamaUrl) env.LARIAT_OLLAMA_URL = settings.ollamaUrl;

  supervisor = new Supervisor({
    entryPath: entryPath(),
    electronExecPath: process.execPath,
    env,
    onCrash: (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Lariat server crashed',
          message: `Server exited (code=${info.exitCode}, signal=${info.signal}).`,
          detail: `See ${crashLogPath()} for details. Supervisor will retry automatically.`,
          buttons: ['View Log', 'Continue'],
        }).then(({ response }) => {
          if (response === 0) shell.openPath(crashLogPath());
        });
      }
    },
  });
  supervisor.start();

  // Poll until /api/discover is reachable (max 30s), then open the window
  const ok = await waitForServer(`http://127.0.0.1:${settings.port}/api/discover`, 30_000);
  if (!ok) {
    dialog.showErrorBox('Lariat failed to start', `Server did not respond within 30s. See ${logDir()}.`);
    app.quit();
    return;
  }

  // Start mDNS responder so iPads can find the hub
  try {
    mdnsHandle = await advertise({ port: settings.port, hostname: undefined as any, locationId: 'default' });
  } catch (e) {
    console.warn('[main] mDNS advertise failed (non-fatal):', e);
  }

  openMainWindow(settings.port);
}

function openMainWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Lariat',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function openWizard(): Promise<Settings> {
  return new Promise((resolve, reject) => {
    wizardWindow = new BrowserWindow({
      width: 600,
      height: 500,
      modal: true,
      title: 'Lariat — Setup',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const wizardHtml = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'desktop', 'dist', 'wizard', 'index.html')
      : path.resolve(__dirname, 'wizard', 'index.html');
    wizardWindow.loadFile(wizardHtml);

    ipcMain.handleOnce('wizard:proceed', (_evt, settings: Settings) => {
      saveSettings(settingsPath(), settings);
      wizardWindow?.close();
      wizardWindow = null;
      resolve(settings);
    });
    ipcMain.handleOnce('wizard:cancel', () => {
      wizardWindow?.close();
      wizardWindow = null;
      reject(new Error('wizard cancelled'));
    });
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

ipcMain.handle('settings:get', () => readSettings(settingsPath()));
ipcMain.handle('dialog:pickDirectory', async (_evt, defaultPath?: string) => {
  const r = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath,
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('paths:dataDirDefault', () => dataDirDefault());

/**
 * Spec §6.6: detect a pre-existing dev-tree DB so the wizard can offer
 * "use in place" without a full path picker. Probes the canonical dev
 * location only — any other location, the user picks via "Choose…".
 * Returns the absolute parent dir (suitable for LARIAT_DATA_DIR) or null.
 */
ipcMain.handle('paths:detectExistingDb', () => {
  const candidate = path.join(require('os').homedir(), 'Dev', 'Lariat', 'data', 'lariat.db');
  if (fs.existsSync(candidate)) return path.dirname(candidate);
  return null;
});

app.whenReady().then(async () => {
  let settings = readSettings(settingsPath());
  if (!settings) {
    try {
      settings = await openWizard();
    } catch {
      app.quit();
      return;
    }
  }
  // Ensure data dir exists; first server boot will run initSchema
  fs.mkdirSync(settings.dataDir, { recursive: true });
  await bootSupervisor(settings);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (!supervisor) return;
  event.preventDefault();
  try { mdnsHandle?.stop(); } catch {}
  await supervisor.shutdown();
  supervisor = null;
  app.exit(0);
});
```

- [ ] **Step 7.2: Compile to verify TypeScript is happy**

```bash
tsc -p desktop --noEmit
```

Expected: clean exit. If `lib/mdnsDiscovery.ts` has different export names, fix the import.

- [ ] **Step 7.3: Commit**

```bash
git add desktop/main.ts
git commit -m "feat(desktop): add Electron main with wizard, supervisor, mDNS lifecycle"
```

---

## Task 8: `desktop/preload.ts` + first-run wizard (Vite + React)

**Files:**
- Create: `desktop/preload.ts`
- Create: `desktop/firstRunWizard/index.html`
- Create: `desktop/firstRunWizard/wizard.tsx`
- Create: `desktop/firstRunWizard/wizard.css`
- Create: `desktop/firstRunWizard/vite.config.ts`

- [ ] **Step 8.1: Implement `desktop/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Settings } from './settings';

contextBridge.exposeInMainWorld('lariat', {
  getSettings: (): Promise<Settings | null> => ipcRenderer.invoke('settings:get'),
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDirectory', defaultPath),
  getDataDirDefault: (): Promise<string> => ipcRenderer.invoke('paths:dataDirDefault'),
  detectExistingDb: (): Promise<string | null> => ipcRenderer.invoke('paths:detectExistingDb'),
  proceed: (settings: Settings): Promise<void> => ipcRenderer.invoke('wizard:proceed', settings),
  cancel: (): Promise<void> => ipcRenderer.invoke('wizard:cancel'),
});
```

- [ ] **Step 8.2: Create `desktop/firstRunWizard/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: './',
  build: {
    outDir: path.resolve(__dirname, '..', 'dist', 'wizard'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
    },
  },
});
```

- [ ] **Step 8.3: Create `desktop/firstRunWizard/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />
  <title>Lariat — Setup</title>
  <link rel="stylesheet" href="./wizard.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./wizard.tsx"></script>
</body>
</html>
```

- [ ] **Step 8.4: Create `desktop/firstRunWizard/wizard.css`**

```css
:root { --fg: #1a1a1a; --bg: #f7f7f7; --accent: #2c5282; --border: #d0d0d0; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); background: var(--bg); }
#root { padding: 24px; height: 100vh; display: flex; flex-direction: column; }
h1 { margin: 0 0 4px; font-size: 18px; }
.step-label { color: #666; font-size: 12px; margin-bottom: 16px; }
.field { margin-bottom: 16px; }
.field label { display: block; font-weight: 600; margin-bottom: 4px; }
.field .help { font-size: 12px; color: #666; margin-top: 4px; }
.path-row { display: flex; gap: 8px; }
.path-row input { flex: 1; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; }
.path-row button { padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; background: white; cursor: pointer; }
.actions { margin-top: auto; display: flex; justify-content: flex-end; gap: 8px; }
.actions button { padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; }
.actions button.primary { background: var(--accent); color: white; border: 1px solid var(--accent); }
.actions button.secondary { background: white; border: 1px solid var(--border); }
.banner { padding: 8px 12px; margin-bottom: 16px; background: #fffbe5; border: 1px solid #f0d97a; border-radius: 4px; font-size: 13px; }
.banner code { font-family: ui-monospace, monospace; background: rgba(0,0,0,0.04); padding: 1px 4px; border-radius: 2px; }
.banner button { margin-left: 6px; padding: 2px 8px; font-size: 12px; border: 1px solid var(--border); border-radius: 3px; background: white; cursor: pointer; }
```

- [ ] **Step 8.5: Create `desktop/firstRunWizard/wizard.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

declare global {
  interface Window {
    lariat: {
      getSettings: () => Promise<Settings | null>;
      pickDirectory: (defaultPath?: string) => Promise<string | null>;
      getDataDirDefault: () => Promise<string>;
      detectExistingDb: () => Promise<string | null>;
      proceed: (settings: Settings) => Promise<void>;
      cancel: () => Promise<void>;
    };
  }
}

interface Settings {
  dataDir: string;
  port: number;
  datapackDir?: string;
  pythonPath?: string;
  ollamaUrl?: string;
}

function PathField({ label, value, onChange, help, defaultPath }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
  defaultPath?: string;
}) {
  const pick = async () => {
    const p = await window.lariat.pickDirectory(defaultPath);
    if (p) onChange(p);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="path-row">
        <input value={value} onChange={e => onChange(e.target.value)} placeholder="(not set)" />
        <button onClick={pick}>Choose…</button>
      </div>
      {help && <div className="help">{help}</div>}
    </div>
  );
}

function App() {
  const [dataDir, setDataDir] = useState('');
  const [datapackDir, setDatapackDir] = useState('');
  const [pythonPath, setPythonPath] = useState('');
  const [existingDb, setExistingDb] = useState<string | null>(null);

  useEffect(() => {
    window.lariat.getDataDirDefault().then(setDataDir);
    window.lariat.detectExistingDb().then(setExistingDb);
  }, []);

  const finish = async () => {
    if (!dataDir) {
      alert('Data directory is required.');
      return;
    }
    const settings: Settings = { dataDir, port: 3000 };
    if (datapackDir) settings.datapackDir = datapackDir;
    if (pythonPath) settings.pythonPath = pythonPath;
    await window.lariat.proceed(settings);
  };

  return (
    <>
      <h1>Welcome to Lariat</h1>
      <div className="step-label">Tell Lariat where to keep its data and which tools to use.</div>

      {existingDb && existingDb !== dataDir && (
        <div className="banner">
          Found existing Lariat data at <code>{existingDb}</code>.{' '}
          <button onClick={() => setDataDir(existingDb)}>Use it in place</button>
        </div>
      )}

      <PathField
        label="Data directory"
        value={dataDir}
        onChange={setDataDir}
        help="Where lariat.db and audit logs will live. Default is recommended unless you have an external SSD."
      />
      <PathField
        label="Data Pack directory (optional)"
        value={datapackDir}
        onChange={setDatapackDir}
        help="Off-tree FDA/USDA reference data. Skip if not installed; the Kitchen Assistant will work without it."
      />
      <PathField
        label="Python venv (optional)"
        value={pythonPath}
        onChange={setPythonPath}
        help="Path to a python3 binary inside a venv with openpyxl + xlrd installed. Required for ingest scripts."
      />

      <div className="actions">
        <button className="secondary" onClick={() => window.lariat.cancel()}>Cancel</button>
        <button className="primary" onClick={finish}>Finish</button>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 8.6: Build the wizard once to verify Vite config works**

```bash
npx vite build --config desktop/firstRunWizard/vite.config.ts
```

Expected: outputs `desktop/dist/wizard/index.html` + bundled `wizard-*.js`. Exits 0.

- [ ] **Step 8.7: Compile preload + main against the new preload**

```bash
tsc -p desktop --noEmit
```

Expected: clean.

- [ ] **Step 8.8: Smoke-test the wrapper end-to-end (dev mode)**

```bash
npm run desktop:dev
```

Expected: Electron window opens; if no `~/Library/Application Support/Lariat/settings.json` exists, the wizard appears first. Pick defaults, click Finish, main window loads `127.0.0.1:3000`. Quit with ⌘Q.

If errors appear, fix and re-run before proceeding.

- [ ] **Step 8.9: Commit**

```bash
git add desktop/preload.ts desktop/firstRunWizard/
git commit -m "feat(desktop): add preload contextBridge + first-run wizard (Vite + React)"
```

---

## Task 9: `electron-builder.yml` + entitlements + delete legacy `Lariat.app/`

**Files:**
- Create: `electron-builder.yml`
- Create: `desktop/entitlements.mac.plist`
- Delete: `Lariat.app/` (entire dir)

- [ ] **Step 9.1: Create `desktop/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
  <key>com.apple.security.network.server</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict>
</plist>
```

- [ ] **Step 9.2: Create `electron-builder.yml`**

```yaml
appId: com.seanburdges.lariat.cockpit
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

asar: false

mac:
  category: public.app-category.business
  icon: desktop/icons/AppIcon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  identity: null
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

- [ ] **Step 9.3: Delete the legacy `Lariat.app/` (icon already moved in T2)**

```bash
git rm -r Lariat.app
```

Expected: removes `Lariat.app/Contents/{Info.plist,PkgInfo,MacOS/Lariat}` (icon is already gone via T2's `git mv`).

- [ ] **Step 9.4: Build the .dmg locally to verify the pipeline**

```bash
npm run desktop:dist
```

Expected: takes 3–8 minutes. Produces:
- `dist/Lariat-0.1.0-arm64.dmg`
- `dist/Lariat-0.1.0-x64.dmg`
- `dist/mac-arm64/Lariat.app/`
- `dist/mac-x64/Lariat.app/`

If electron-rebuild fails on `better-sqlite3`, run `npm rebuild better-sqlite3 --runtime=electron --target=$(./node_modules/.bin/electron --version | tr -d v) --dist-url=https://electronjs.org/headers` and retry.

- [ ] **Step 9.5: Spot-check the unpacked .app**

```bash
open dist/mac-arm64/Lariat.app
```

Expected: Wizard appears (assuming `~/Library/Application Support/Lariat` is empty). Picks defaults, finishes, main window opens.

If the OS blocks with "cannot be opened because the developer cannot be verified":
```bash
xattr -d com.apple.quarantine dist/mac-arm64/Lariat.app
```
Then retry.

- [ ] **Step 9.6: Commit**

```bash
git add electron-builder.yml desktop/entitlements.mac.plist
git rm -r Lariat.app  # already staged from 9.3 if you ran git rm there; this is idempotent
git commit -m "$(cat <<'EOF'
feat(desktop): add electron-builder config + entitlements; retire hand-rolled Lariat.app

electron-builder.yml produces ad-hoc-signed dmgs for arm64+x64 with
hardened runtime entitlements ready for future notarization. The
entitlements allow the JIT, unsigned executable memory, library
validation bypass for better-sqlite3's .node binding, and network
server/client + user-selected file access (for the wizard's path picker).

Deletes the legacy Lariat.app/ launcher; AppIcon.icns moved to
desktop/icons/ in an earlier task.
EOF
)"
```

---

## Task 10: Manual smoke checklist execution

**Files:** None modified. This is a verification gate.

- [ ] **Step 10.1: Walk every checkbox in `desktop/README.md` "Manual smoke checklist"**

The checklist covers: fresh-install path, existing-install path, iPad LAN handshake, crash recovery, graceful shutdown, ad-hoc Gatekeeper bypass.

- [ ] **Step 10.2: For any failure, file a follow-up commit (or surface to user)**

If a step fails and the cause is in code from this plan, fix it in a new commit on this branch with message `fix(desktop): <what>`. If the cause is out of scope (e.g., missing Ollama on the test Mac), document the workaround in `desktop/README.md` and surface to the user at hand-off.

- [ ] **Step 10.3: Capture pass/fail evidence**

Append to `desktop/README.md`:

```markdown
## Last manual smoke run

- Date: YYYY-MM-DD
- Branch / commit: feat/desktop-wrapper @ <sha>
- Build artifact: dist/Lariat-0.1.0-arm64.dmg
- Result: PASS — all 6 checkboxes green
- Notes: <anything noteworthy or deferred>
```

- [ ] **Step 10.4: Commit**

```bash
git add desktop/README.md
git commit -m "chore(desktop): record passing manual smoke run"
```

(If the smoke checklist failed and required fixes, those fixes are their own commits — this commit only records the passing run.)

---

## Task 11: CI workflow

**Files:**
- Create: `.github/workflows/desktop-smoke.yml`

- [ ] **Step 11.1: Create `.github/workflows/desktop-smoke.yml`**

```yaml
name: desktop-smoke

on:
  push:
    branches: [main]
    paths:
      - 'desktop/**'
      - 'electron-builder.yml'
      - 'package.json'
      - 'lib/db.ts'
      - 'lib/datapackSearch.ts'
      - 'lib/mdnsDiscovery.ts'
  pull_request:
    paths:
      - 'desktop/**'
      - 'electron-builder.yml'
      - 'package.json'
      - 'lib/db.ts'
      - 'lib/datapackSearch.ts'
      - 'lib/mdnsDiscovery.ts'

jobs:
  smoke:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - run: npm run desktop:build
      - name: Run desktop unit tests
        run: |
          node --experimental-strip-types --test desktop/__tests__/paths.test.ts
          node --experimental-strip-types --test desktop/__tests__/settings.test.ts
          node --experimental-strip-types --test desktop/__tests__/supervisor.test.ts
      - name: Run desktop integration tests
        run: |
          node --experimental-strip-types --test desktop/__tests__/server-boot.integration.ts
          node --experimental-strip-types --test desktop/__tests__/crash-recovery.integration.ts
      - name: Run lib regression test
        run: node --experimental-strip-types --test tests/js/test-db-data-dir.mjs
      # NOT running electron-builder --mac in CI for v1 (no signing identity available)
```

- [ ] **Step 11.2: Verify the workflow YAML is parseable**

```bash
# Use yq if available, otherwise just python
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/desktop-smoke.yml'))"
```

Expected: no traceback.

- [ ] **Step 11.3: Commit**

```bash
git add .github/workflows/desktop-smoke.yml
git commit -m "ci(desktop): add macOS smoke workflow (unit + integration, no packaging)"
```

---

## Final verification

- [ ] All 11 tasks committed on `feat/desktop-wrapper`
- [ ] `npm run verify` (or the equivalent gate) passes locally
- [ ] `npm run desktop:dist` produces a working `.dmg`
- [ ] Manual smoke checklist (T10) completed
- [ ] User has reviewed the branch before merge to `main`

---

## Decisions log (delta from spec)

| # | Question | Choice | Why |
|---|---|---|---|
| 7 | Validation library for `desktop/settings.ts` | Hand-rolled type guards (no Zod) | Zod isn't already a dep; one schema doesn't justify adding it |
| 8 | Test runner for desktop tree | `node --test` with `--experimental-strip-types` | Matches existing `tests/js/*.mjs` pattern; no new framework |
| 9 | Existing `LARIAT_DATA_ROOT` env var | Reused for datapack — wrapper sets it from `settings.datapackDir` | Avoids introducing a duplicate `LARIAT_DATAPACK_DIR` (caught during plan-write) |

## Open follow-ups for v1.1

These surfaced during planning but are out of v1 scope per the spec:

- Window state persistence via `electron-window-state` (the dep is already added in T2 but unused in v1; wire up in v1.1)
- Notarization activation when Apple Developer ID is provisioned (one-config-block change per spec §7.4)
- Auto-update channel (zip target ships in v1; needs hosting decision before activation)
- Universal arm64+x64 fat binary (per-arch dmgs are sufficient for hub-box use case)
- Secondary supervisor HTTP server for `/api/discover` during restarts (1–5s blackout accepted in v1)
