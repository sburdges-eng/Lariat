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

  const entitlements = path.join(context.packager.projectDir, 'desktop', 'entitlements.mac.plist');
  const signArgs = ['--force', '--deep', '--sign', '-', '--options', 'runtime'];
  if (fs.existsSync(entitlements)) {
    signArgs.push('--entitlements', entitlements);
  }
  signArgs.push(appPath);

  run('codesign', signArgs);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
};

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}`);
  }
}
