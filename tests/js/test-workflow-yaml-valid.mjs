#!/usr/bin/env node
// A GitHub Actions workflow that does not parse does not run, and GitHub
// reports that as one terse line ("This run likely failed because of a
// workflow file issue") on a check most people read as an infrastructure
// blip. There is no failing test, no log, and no signal that the gates
// inside the file stopped running.
//
// That happened here. `.github/workflows/ci.yml` gained the step
//
//   - name: code coverage (floors: line 85 / branch 81 / func 87)
//
// and an unquoted scalar containing ": " parses as a nested mapping, which
// took the whole file down. Every gate in it — lint, the 362-file sweep,
// coverage --check, next build — silently stopped running, in the same
// commit range whose entire purpose was to stop tests being silently
// switched off. The repo could not tell the difference, again.
//
// Deliberately implemented WITHOUT a YAML library. js-yaml and yaml are both
// present in node_modules but neither is a declared dependency — they arrive
// transitively through eslint and next. A guard against silent rot must not
// itself rest on something that can silently disappear on the next
// `npm install`. This checks the one construct that actually broke, which
// costs nothing and cannot go stale.
//
// Run: node --test tests/js/test-workflow-yaml-valid.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_DIR = path.join(REPO_ROOT, '.github/workflows');

function workflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) return [];
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => path.join(WORKFLOW_DIR, f));
}

/**
 * A `name:` value is always a single-line scalar, so it can be checked by
 * line without tracking block-scalar state. An unquoted one containing ": "
 * is the construct that breaks the parse.
 * @param {string} src
 */
function unquotedNamesWithColonSpace(src) {
  const bad = [];
  src.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*-?\s*name:\s*(.+?)\s*$/);
    if (!m) return;
    const value = m[1];
    const quoted =
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'));
    if (quoted) return;
    if (value.includes(': ')) bad.push({ line: i + 1, value });
  });
  return bad;
}

describe('GitHub Actions workflows parse', () => {
  const files = workflowFiles();

  it('finds workflow files to check', () => {
    assert.ok(files.length > 0, `no workflow files under ${WORKFLOW_DIR}`);
  });

  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);

    it(`${rel} has no unquoted name: containing ": "`, () => {
      const bad = unquotedNamesWithColonSpace(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(
        bad.map((b) => `${rel}:${b.line}  name: ${b.value}`),
        [],
        `An unquoted step name containing ": " parses as a nested mapping and ` +
          `breaks the entire workflow file, which stops every gate in it from ` +
          `running with almost no visible signal. Wrap the value in quotes.`,
      );
    });
  }
});

describe('the CI workflow still runs the gates it claims to', () => {
  // Cheap presence checks. If ci.yml is ever rewritten in a way that drops
  // one of these, the branch's central claim — that verify and CI cover the
  // same suites — quietly stops being true.
  const ciPath = path.join(WORKFLOW_DIR, 'ci.yml');

  it('ci.yml exists', () => {
    assert.ok(fs.existsSync(ciPath), 'no .github/workflows/ci.yml');
  });

  const src = fs.existsSync(ciPath) ? fs.readFileSync(ciPath, 'utf8') : '';

  for (const gate of ['npm run lint', 'npm run coverage', 'npm run build']) {
    it(`ci.yml runs ${gate}`, () => {
      assert.ok(src.includes(gate), `ci.yml no longer runs \`${gate}\``);
    });
  }
});
