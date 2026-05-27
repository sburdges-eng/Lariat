// Release channel.
//
// Lariat ships on two channels:
//   - TEST release  — version scheme `v.I.NN.NNN` (4-part). Runs fully
//     offline: external vendor integrations (Toast, 7shifts, Prism, and the
//     off-tree datapack) are intentionally DISABLED and need no credentials.
//     For demos, dev machines, and pre-flight verification with no API access.
//   - OFFICIAL release — version scheme `v.---.--` (semver). Expects the
//     vendor integrations to be configured for production operation.
//
// The channel is driven by the LARIAT_TEST_RELEASE env var (explicit and
// deterministic) so behavior never depends on which files happen to be on
// disk. A test-release build is stamped with the v.I.NN.NNN version AND run
// with LARIAT_TEST_RELEASE=1.

import fs from 'node:fs';
import path from 'node:path';

export type ReleaseChannel = 'test' | 'official';

export interface ReleaseInfo {
  /** Display version — v.I.NN.NNN for a test build, semver otherwise. */
  version: string;
  channel: ReleaseChannel;
  testRelease: boolean;
}

/**
 * True when this build is a TEST RELEASE — runs offline with external vendor
 * APIs disabled. Driven solely by LARIAT_TEST_RELEASE (`1` / `true`,
 * case-insensitive); defaults to the official channel.
 */
export function isTestRelease(): boolean {
  const v = (process.env.LARIAT_TEST_RELEASE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** Best-effort read of the build stamp written by scripts/version-stamp.mjs. */
function readVersionStamp(): { version?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'version.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function getReleaseInfo(): ReleaseInfo {
  const testRelease = isTestRelease();
  const version =
    readVersionStamp()?.version || process.env.npm_package_version || 'unknown';
  return { version, channel: testRelease ? 'test' : 'official', testRelease };
}
