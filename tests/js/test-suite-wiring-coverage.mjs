#!/usr/bin/env node
// Coverage test — every tests/js suite must actually be reachable from
// `npm run verify`.
//
// WHY THIS EXISTS
// ---------------
// Writing a test file does not make it run. Nothing in the toolchain
// connected the two, so suites drifted into being written, committed, and
// then never executed again. At the time this gate was added, 203 of 362
// files under tests/js — 2,247 passing cases, including 21 auth/PIN, 24 food
// safety, 36 costing and 17 sync suites — were referenced by no npm script
// at all. Every one of them passed when finally run, which is the point: the
// coverage was real, it was simply switched off, and nobody could tell.
//
// A count of test files is therefore not a measure of anything. This gate
// makes the number honest by failing the moment a suite exists that `verify`
// would not run.
//
// It anchors on `verify` rather than on "any npm script" deliberately. A file
// wired only into a script that nothing invokes is still dead, and anchoring
// here also keeps the local gate from drifting weaker than CI — which it had,
// running 37 files locally against CI's 157.
//
// Run: node --experimental-strip-types --test tests/js/test-suite-wiring-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests/js');

// Suites `verify` is not expected to reach, each with a reason.
//
// Keep this list short and justified. "It is slow" is not a reason — move it
// to its own CI lane instead, and it still has to be reachable from verify.
const ALLOWLIST = new Map([
  [
    'test-suite-wiring-coverage.mjs',
    'This gate. `verify` runs it via test:suite-wiring; excluding it avoids ' +
      'asserting on itself while the list is being read.',
  ],
  [
    'test-dataset-v2-slices.mjs',
    'Needs the ML training snapshot at training/gcp/snapshot, which is ' +
      'generated off-tree and is not in the repo. Cannot run on a fresh ' +
      'clone or in CI. Keep `npm run test:dataset-v2` for anyone who has ' +
      'the snapshot locally.',
  ],
]);

/** Every `tests/js/test-*.mjs` on disk. Helpers and mocks are not suites. */
function suitesOnDisk() {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((f) => /^test-.*\.mjs$/.test(f))
    .sort();
}

/**
 * Every tests/js file reachable from `npm run verify`, following
 * `npm run <script>` chains. Mirrors how npm actually expands the script.
 */
function suitesReachableFromVerify() {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const reached = new Set();
  const seen = new Set();

  const walk = (name) => {
    if (seen.has(name) || !scripts[name]) return;
    seen.add(name);
    const body = scripts[name];
    for (const m of body.matchAll(/tests\/js\/(test-[\w.-]+\.mjs)/g)) reached.add(m[1]);
    for (const m of body.matchAll(/npm run ([\w:-]+)/g)) walk(m[1]);
  };

  walk('verify');
  return reached;
}

describe('tests/js suite wiring', () => {
  it('every suite on disk is reachable from `npm run verify`', () => {
    const reachable = suitesReachableFromVerify();
    const unwired = suitesOnDisk().filter((f) => !reachable.has(f) && !ALLOWLIST.has(f));

    assert.deepEqual(
      unwired,
      [],
      unwired.length === 0
        ? ''
        : `${unwired.length} test suite(s) exist but nothing runs them.\n\n` +
            unwired.map((f) => `  tests/js/${f}`).join('\n') +
            '\n\nAdd each to the matching test:regression-* group in package.json ' +
            '(the group is already in verify), or allowlist it here with a reason.',
    );
  });

  it('the allowlist only names suites that exist', () => {
    const onDisk = new Set(suitesOnDisk());
    const stale = [...ALLOWLIST.keys()].filter((f) => !onDisk.has(f));
    assert.deepEqual(stale, [], `allowlist names suite(s) that no longer exist: ${stale.join(', ')}`);
  });
});
