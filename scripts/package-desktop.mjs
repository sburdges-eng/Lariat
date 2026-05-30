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
const packageStartedAt = Date.now();

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

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/package-desktop.mjs [--dry-run] [--skip-build] [--skip-native-deps] [--arch=arm64,x64]

Builds the Lariat Electron desktop package for macOS with electron-builder.

Options:
  --dry-run            Validate inputs and print the exact commands without building.
  --skip-build         Reuse an existing .next/ and desktop/dist/ build.
  --skip-native-deps   Skip electron-builder install-app-deps.
  --arch=arm64,x64     Comma-separated macOS architectures. Defaults to arm64,x64.
`);
  process.exit(0);
}

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'next.config.mjs',
  'electron-builder.yml',
  'desktop/main.ts',
  'desktop/preload.ts',
  'desktop/supervisor.ts',
  'desktop/server-entry.cjs',
  'desktop/after-pack-ad-hoc.cjs',
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

for (const relPath of requiredFiles) {
  if (!fs.existsSync(path.join(repoRoot, relPath))) {
    fail(`Required desktop packaging input is missing: ${relPath}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const builderConfig = fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');

if (packageJson.main !== 'desktop/dist/desktop/main.js') {
  fail(`package.json#main must be desktop/dist/desktop/main.js, found ${packageJson.main}`);
}

for (const needle of [
  'desktop/dist/**',
  'desktop/server-entry.cjs',
  '.next/**',
  '!.next/**/*.map',
  'public/**',
  '!public/design-atlas/**',
  'node_modules/**',
  'version.json',
  'asar: false',
  'identity: null',
  'afterPack: desktop/after-pack-ad-hoc.cjs',
]) {
  if (!builderConfig.includes(needle)) {
    fail(`electron-builder.yml is missing required packaging rule: ${needle}`);
  }
}

const electronBuilderBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);

if (!dryRun && !fs.existsSync(electronBuilderBin)) {
  fail('node_modules/.bin/electron-builder is missing. Run npm ci before packaging.');
}

if (!dryRun && process.platform !== 'darwin') {
  fail(`macOS packaging must run on macOS; current platform is ${process.platform}.`);
}

const commands = [];
if (!skipBuild) {
  commands.push(['npm', ['run', 'desktop:build']]);
}
if (!skipNativeDeps) {
  commands.push([electronBuilderBin, ['install-app-deps']]);
}
commands.push([
  electronBuilderBin,
  ['--config', 'electron-builder.yml', '--mac', ...archList.map((arch) => `--${arch}`), '--publish', 'never'],
]);

console.log('Lariat desktop packaging plan');
console.log(`  project: ${packageJson.name}@${packageJson.version}`);
console.log(`  main: ${packageJson.main}`);
console.log(`  target: macOS ${archList.join('+')} dmg/zip via electron-builder.yml`);
console.log(`  dryRun: ${dryRun ? 'yes' : 'no'}`);
console.log('');

for (const [cmd, cmdArgs] of commands) {
  const printableCmd = path.relative(repoRoot, cmd).startsWith('..') ? cmd : path.relative(repoRoot, cmd);
  console.log(`$ ${printableCmd} ${cmdArgs.join(' ')}`);
  if (!dryRun) {
    run(cmd, cmdArgs);
  }
}

if (dryRun) {
  console.log('');
  console.log('Dry run complete. No build artifacts were written.');
} else {
  const apps = expectedAppBundles(archList);
  if (apps.length === 0) {
    fail('electron-builder did not produce a macOS .app bundle under dist/.');
  }
  for (const appPath of apps) {
    assertFreshArtifacts(appPath, packageStartedAt);
    const appRoot = path.join(appPath, 'Contents', 'Resources', 'app');
    assertNoPackagedPath(appRoot, 'public/design-atlas');
    assertNoPackagedPath(appRoot, '.next/server/edge-instrumentation.js.map');
    assertNoPackagedPath(appRoot, 'node_modules/electron');
    assertNoPackagedPath(appRoot, 'node_modules/electron-builder');
    assertRequiredPackagedPath(appRoot, 'version.json');
    assertNoPackagedGlob(appRoot, (rel) => rel.endsWith('.js.map'), 'source maps');
    assertNoPackagedGlob(
      appRoot,
      (rel) => rel.endsWith('/.DS_Store') || rel === '.DS_Store',
      '.DS_Store files',
    );
    assertCodesignVerified(appPath);
  }
  restoreHostNativeDeps();
  console.log('');
  console.log('Desktop package complete. Artifacts are under dist/.');
}

function run(cmd, cmdArgs, extraEnv = {}) {
  const packageHome = path.join(repoRoot, 'dist', '.package-home');
  fs.mkdirSync(packageHome, { recursive: true });
  const result = spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_BUILDER_DISABLE_UPDATE_CHECK: 'true',
      HOME: packageHome,
      NEXT_TELEMETRY_DISABLED: '1',
      USERPROFILE: packageHome,
      npm_config_audit: 'false',
      npm_config_devdir: path.join(repoRoot, 'dist', '.electron-gyp'),
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      ...extraEnv,
    },
  });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    fail(`Command failed with exit ${result.status}: ${cmd} ${cmdArgs.join(' ')}`);
  }
}

function restoreHostNativeDeps() {
  console.log('');
  console.log('Restoring host Node native dependencies...');
  const packageHome = path.join(repoRoot, 'dist', '.package-home');
  fs.mkdirSync(packageHome, { recursive: true });
  const result = spawnSync('npm', ['rebuild', 'better-sqlite3'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOME: packageHome,
      NEXT_TELEMETRY_DISABLED: '1',
      USERPROFILE: packageHome,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
  });
  if (result.error) {
    fail(result.error.message);
  }
  if (result.status !== 0) {
    fail('Host native dependency restore failed: npm rebuild better-sqlite3');
  }
}

function expectedAppBundles(architectures) {
  const apps = [];
  for (const arch of architectures) {
    const rel = arch === 'arm64' ? 'dist/mac-arm64/Lariat.app' : 'dist/mac/Lariat.app';
    const appPath = path.join(repoRoot, rel);
    if (!fs.existsSync(appPath)) {
      fail(`electron-builder did not produce expected bundle: ${rel}`);
    }
    apps.push(appPath);
  }
  return apps;
}

function assertFreshArtifacts(appPath, startedAt) {
  const mtime = fs.statSync(appPath).mtimeMs;
  if (mtime + 5_000 < startedAt) {
    fail(`Packaged app is stale: ${path.relative(repoRoot, appPath)}`);
  }
}

function assertRequiredPackagedPath(root, relPath) {
  const target = path.join(root, relPath);
  if (!fs.existsSync(target)) {
    fail(`Packaged app is missing required file: ${relPath}`);
  }
}

function assertNoPackagedPath(root, relPath) {
  const target = path.join(root, relPath);
  if (fs.existsSync(target)) {
    fail(`Packaged app contains excluded path: ${relPath}`);
  }
}

function assertNoPackagedGlob(root, predicate, label) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (predicate(rel)) {
        fail(`Packaged app contains excluded ${label}: ${rel}`);
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
}

function assertCodesignVerified(appPath) {
  if (process.platform !== 'darwin') return;
  const result = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(`codesign verification failed for ${path.relative(repoRoot, appPath)}`);
  }
}

function fail(message) {
  console.error(`desktop package: ${message}`);
  process.exit(1);
}
