// Activated by electron-builder when mac.identity is a real Developer ID
// AND afterSign points at this file. Until then it's dormant scaffolding.
//
// Required env (loaded from ~/.lariat-build.env, gitignored):
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
require('dotenv').config({ path: require('os').homedir() + '/.lariat-build.env' });
const { notarize } = require('@electron/notarize');

exports.default = async ({ appOutDir, packager }) => {
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.warn('[notarize] APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID not set — skipping notarization');
    return;
  }
  return notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${packager.appInfo.productFilename}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
