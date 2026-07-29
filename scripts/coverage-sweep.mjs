#!/usr/bin/env node
// Code-coverage sweep for the tests/js suites.
//
// WHY THIS EXISTS
// ---------------
// The repo had no code-coverage instrumentation of any kind. Every script
// named "coverage" measures something else — domain data coverage, or
// route-guard drift — so there was no line/branch number for the JS side and
// no way to produce one. "Tested" was an assertion nobody could check.
//
// READ THE NUMBER CORRECTLY
// -------------------------
// Node only instruments files it actually LOADS. A module no test ever
// imports does not appear in the report at all — it is missing from the
// denominator, not counted as zero. So the headline percentage is
// "coverage of exercised files", not "coverage of the codebase", and it
// flatters the untested parts of the tree by omitting them.
//
// This script therefore prints the loaded-file counts against what is on
// disk, which is the number that actually tells you where the holes are.
// At the time it was added: lib/ 154 of 159 files loaded (the module layer
// is genuinely exercised), app/ 135 of 364 (roughly two-thirds of the app
// layer never executes in any test — mostly pages and components).
//
// Usage:
//   npm run coverage           report only
//   npm run coverage -- --check   also fail if below the floors below
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Ratchet: raise these as coverage improves, never lower them silently.
const FLOORS = { line: 85, branch: 81, func: 87 };

// Suites excluded from the sweep, with reasons. Both still run in `verify`
// (except the snapshot one, which is allowlisted there too).
const EXCLUDED = new Map([
  ['test-mdns-autostart.mjs', 'starts a real mDNS responder'],
  ['test-mdns-discovery.mjs', 'starts a real mDNS responder'],
  ['test-mdns-warn-once-per-reason.mjs', 'starts a real mDNS responder'],
  ['test-dataset-v2-slices.mjs', 'needs the off-tree training/gcp/snapshot'],
]);

const suites = fs
  .readdirSync(path.join(REPO, 'tests/js'))
  .filter((f) => /^test-.*\.mjs$/.test(f) && !EXCLUDED.has(f))
  .map((f) => `tests/js/${f}`);

console.log(`Running ${suites.length} suites with coverage (${EXCLUDED.size} excluded)...\n`);

const run = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--experimental-test-coverage', '--test', '--test-timeout=60000', ...suites],
  { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
);

const out = run.stdout || '';
const totals = Object.fromEntries(
  ['tests', 'pass', 'fail'].map((k) => [k, (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1] ?? '?']),
);
const all = out.match(/^ℹ all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/m);

if (!all) {
  console.error(out.slice(-4000));
  console.error('\nNo coverage summary found — the run did not complete.');
  process.exit(1);
}

const [, line, branch, func] = all.map(Number);

// Loaded-file counts, so the percentage is read against a real denominator.
// The report groups files under a bare directory header and then lists each
// file by BASENAME, so files cannot be attributed by path — track the current
// section header while scanning instead.
const report = out.slice(out.indexOf('start of coverage report'));
const loadedByDir = (() => {
  const counts = {};
  let section = null;
  for (const raw of report.split('\n')) {
    const header = raw.match(/^ℹ ([a-zA-Z][\w./-]*)\s*\|\s*\|/);
    if (header) {
      section = header[1];
      counts[section] ??= 0;
      continue;
    }
    if (section && /^ℹ\s+[\w./-]+\.(?:ts|tsx|js|jsx|mjs)\s*\|\s*[\d.]/.test(raw)) counts[section] += 1;
  }
  return counts;
})();
const loaded = (dir) => loadedByDir[dir] ?? 0;
const onDisk = (dir, exts) => {
  const walk = (d) =>
    fs.existsSync(d)
      ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
          const p = path.join(d, e.name);
          if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
          return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
        })
      : [];
  return walk(path.join(REPO, dir)).length;
};

console.log(`tests ${totals.tests}  pass ${totals.pass}  fail ${totals.fail}`);
console.log(`\ncoverage of exercised files: ${line}% line  ${branch}% branch  ${func}% func`);
console.log(`\nexercised vs on disk (the number that shows the holes):`);
console.log(`  lib     ${String(loaded('lib')).padStart(4)} / ${onDisk('lib', ['.ts', '.js', '.mjs'])}`);
console.log(`  app     ${String(loaded('app')).padStart(4)} / ${onDisk('app', ['.ts', '.tsx', '.js', '.jsx'])}`);
console.log(`  scripts ${String(loaded('scripts')).padStart(4)} / ${onDisk('scripts', ['.mjs', '.js', '.ts'])}`);

if (totals.fail !== '0') {
  console.error(`\n${totals.fail} test(s) failed during the sweep.`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const below = Object.entries({ line, branch, func }).filter(([k, v]) => v < FLOORS[k]);
  if (below.length) {
    console.error(
      `\nBelow floor: ${below.map(([k, v]) => `${k} ${v}% < ${FLOORS[k]}%`).join(', ')}.\n` +
        `Add tests, or lower the floor in scripts/coverage-sweep.mjs and say why in the commit.`,
    );
    process.exit(1);
  }
  console.log(`\nAt or above floors (line ${FLOORS.line} / branch ${FLOORS.branch} / func ${FLOORS.func}).`);
}
