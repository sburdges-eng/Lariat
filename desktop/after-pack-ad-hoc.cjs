const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPackAdHoc(context) {
  if (process.platform !== 'darwin' || context.electronPlatformName !== 'darwin') return;

  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productName}.app`);
  if (!fs.existsSync(appPath)) {
    throw new Error(`ad-hoc signing target missing: ${appPath}`);
  }

  rebuildNativeModules(context, appPath);

  const entitlements = path.join(context.packager.projectDir, 'desktop', 'entitlements.mac.plist');
  const signArgs = ['--force', '--deep', '--sign', '-', '--options', 'runtime'];
  if (fs.existsSync(entitlements)) {
    signArgs.push('--entitlements', entitlements);
  }
  signArgs.push(appPath);

  run('codesign', signArgs);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
};

function rebuildNativeModules(context, appPath) {
  const projectDir = context.packager.projectDir;
  const appRoot = path.join(appPath, 'Contents', 'Resources', 'app');
  const electronRebuildBin = path.join(
    projectDir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild',
  );
  if (!fs.existsSync(electronRebuildBin)) {
    throw new Error(`electron-rebuild is missing: ${electronRebuildBin}`);
  }

  const electronVersion = context.electronVersion || readElectronVersion(projectDir);
  const arch = normalizeArch(context.arch);
  // @electron/rebuild rewrites the project copy. Copy its Electron-targeted
  // output into the packaged app before signing.
  run(
    electronRebuildBin,
    ['--version', electronVersion, '--arch', arch, '--force', '--only', 'better-sqlite3'],
    { cwd: projectDir, env: packagingEnv(projectDir) },
  );
  copyNativeOutputs(projectDir, appRoot);
}

function copyNativeOutputs(projectDir, appRoot) {
  const sourceDir = path.join(projectDir, 'node_modules', 'better-sqlite3', 'build', 'Release');
  const targetDir = path.join(appRoot, 'node_modules', 'better-sqlite3', 'build', 'Release');
  fs.mkdirSync(targetDir, { recursive: true });
  for (const fileName of ['better_sqlite3.node', 'test_extension.node']) {
    const sourcePath = path.join(sourceDir, fileName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, path.join(targetDir, fileName));
    }
  }
}

function readElectronVersion(projectDir) {
  const electronPackageJson = path.join(projectDir, 'node_modules', 'electron', 'package.json');
  return JSON.parse(fs.readFileSync(electronPackageJson, 'utf8')).version;
}

function normalizeArch(arch) {
  if (typeof arch === 'string') return arch;
  return {
    0: 'x64',
    1: 'ia32',
    2: 'armv7l',
    3: 'arm64',
    4: 'universal',
  }[arch] || process.arch;
}

function packagingEnv(projectDir) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.npm_config_audit = 'false';
  env.npm_config_devdir = path.join(projectDir, 'dist', '.electron-gyp');
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  return env;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}`);
  }
}
