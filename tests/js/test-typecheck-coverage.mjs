#!/usr/bin/env node
// Coverage test — the typecheck gate must actually cover the app.
//
// tsconfig.json's `exclude` list is the one place a whole directory of live
// code can drop out of `npm run typecheck` with nothing to show for it. On
// 2026-05-14 `app/inventory/**` was added alongside `design/**` and
// `line_setups/**` to silence 1303 errors from gitignored prototypes — but
// unlike those two it holds thirteen tracked, shipping files behind the
// /inventory, /inventory/counts, /inventory/par, /inventory/log and
// /inventory/waste routes. They went unchecked for three and a half months,
// hiding 69 errors, and any NEW file added under that path would have been
// unchecked from birth with no signal at all.
//
// Same drift-detection posture as tests/js/test-pin-gate-coverage.mjs: this
// does not demand the exclude list be empty. It demands that nothing in it
// swallows source under app/ or lib/ — the two trees the web app is built
// from. Prototype and build directories are still free to be excluded.
//
// Run: node --experimental-strip-types --test tests/js/test-typecheck-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Trees the Next.js app is compiled from. Nothing here may be excluded. */
const COVERED_ROOTS = ['app', 'lib'];
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/** JSON with `//` comments, which tsconfig.json uses. */
function readTsconfig() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/[^\n]*$/gm, ''));
}

/** @param {string} dir @param {string[]} out */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTS.includes(path.extname(entry.name))) out.push(path.relative(REPO_ROOT, full));
  }
  return out;
}

/**
 * Does a tsconfig exclude glob cover this file? tsconfig globs are prefix
 * matches on a directory, optionally with a trailing `/**`, which is all this
 * list has ever used — deliberately not a full glob engine, because a wrong
 * "no match" here reads as coverage the project does not have.
 * @param {string} pattern @param {string} file
 */
function excludes(pattern, file) {
  const base = pattern.replace(/\/\*\*?$/, '').replace(/\/$/, '');
  if (!base || base.includes('*')) return false;
  return file === base || file.startsWith(`${base}/`);
}

describe('typecheck coverage', () => {
  const tsconfig = readTsconfig();
  const exclude = tsconfig.exclude ?? [];
  const sources = COVERED_ROOTS.flatMap((r) => walk(path.join(REPO_ROOT, r)));

  it('finds app and lib sources, so this gate is not vacuous', () => {
    assert.ok(sources.length > 100, `expected the app tree, found ${sources.length} files`);
  });

  it('excludes nothing under app/ or lib/ from the typecheck', () => {
    const swallowed = exclude
      .map((pattern) => ({ pattern, files: sources.filter((f) => excludes(pattern, f)) }))
      .filter((r) => r.files.length > 0)
      .map((r) => `  ${r.pattern} hides ${r.files.length} file(s), e.g. ${r.files[0]}`);

    assert.deepEqual(
      swallowed,
      [],
      'tsconfig.json "exclude" drops shipping source out of npm run typecheck:\n' +
        `${swallowed.join('\n')}\n\n` +
        'Type the files instead. An excluded directory is unchecked forever, ' +
        'including every file added to it later.',
    );
  });
});
