#!/usr/bin/env node
// V.I.NN.NNN build-version stamp.
//
// Scheme: vMAJOR.ITERATION.NN.NNN  (e.g. v0.1.00.001)
//   MAJOR / ITERATION — semantic line + feature iteration
//   NN  — 2-digit minor (00..99)
//   NNN — 3-digit build counter (000..999), rolls into NN on bump
//
// Source of truth is the `buildVersion` field in package.json. This script
// is offline-deterministic (no network, no CI-only inputs): the stamped
// version is exactly package.json#buildVersion, decorated with the short git
// SHA and build timestamp for traceability.
//
// CLI:
//   node scripts/version-stamp.mjs            # write version.json + print
//   node scripts/version-stamp.mjs --print    # print only, no file write
//   node scripts/version-stamp.mjs --bump     # increment NNN in package.json
//
// Wired into the build via the `prebuild` npm hook, so every `next build`
// (local and CI) emits version.json.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const OUT_PATH = path.join(ROOT, 'version.json');
const DEFAULT_BUILD_VERSION = '0.1.00.001';

/** Parse `MAJOR.ITERATION.NN.NNN` (optional leading `v`) → numeric parts. */
export function parseBuildVersion(str) {
  const m = String(str)
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Invalid build version: "${str}" (expected MAJOR.ITERATION.NN.NNN)`);
  return { major: Number(m[1]), iteration: Number(m[2]), nn: Number(m[3]), nnn: Number(m[4]) };
}

/** Format numeric parts → `vMAJOR.ITERATION.NN.NNN` with NN/NNN zero-padded. */
export function formatBuildVersion({ major, iteration, nn, nnn }) {
  const pad = (n, w) => String(n).padStart(w, '0');
  return `v${major}.${iteration}.${pad(nn, 2)}.${pad(nnn, 3)}`;
}

/**
 * Increment the build counter. NNN rolls over into NN at 999; returns the
 * package.json form (no `v` prefix, padded).
 */
export function bumpBuild(str) {
  const v = parseBuildVersion(str);
  v.nnn += 1;
  if (v.nnn > 999) {
    v.nnn = 0;
    v.nn += 1;
  }
  return formatBuildVersion(v).replace(/^v/, '');
}

function readPkg() {
  return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
}

function shortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'nogit';
  }
}

function main(argv = process.argv.slice(2)) {
  const pkg = readPkg();
  const buildVersion = pkg.buildVersion || DEFAULT_BUILD_VERSION;

  if (argv.includes('--bump')) {
    const next = bumpBuild(buildVersion);
    pkg.buildVersion = next;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`buildVersion ${buildVersion} → ${next}`);
    return;
  }

  const version = formatBuildVersion(parseBuildVersion(buildVersion));
  if (argv.includes('--print')) {
    console.log(version);
    return;
  }

  // The v.I.NN.NNN scheme is the TEST-release channel (offline; external
  // vendor APIs disabled). Official builds set LARIAT_RELEASE_CHANNEL=official.
  // This is metadata; runtime behavior is gated by LARIAT_TEST_RELEASE (see
  // lib/release.ts).
  const channel = process.env.LARIAT_RELEASE_CHANNEL || 'test';
  const stamp = {
    version,
    semver: pkg.version,
    channel,
    testRelease: channel === 'test',
    sha: shortSha(),
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(stamp, null, 2) + '\n');
  console.log(`Stamped ${version} (${stamp.sha}) → version.json`);
}

// CLI guard — importing for tests is side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
