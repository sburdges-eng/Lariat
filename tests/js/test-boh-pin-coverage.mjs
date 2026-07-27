#!/usr/bin/env node
// Line-book sheets carry two very different things: a cook's own station
// paper, and vendor pricing / order history / manager sign-off. The split
// is declared once, as `tier` in lib/boh, and enforced in three other
// places — middleware.js's SENSITIVE_PREFIXES, its config.matcher, and
// navRegistry.js's MANAGER_PIN_PREFIXES.
//
// The failure this exists to catch: someone adds a 13th sheet marked
// `manager` and forgets the middleware entry, quietly publishing Sysco
// pricing to anyone on the venue wifi. Same drift-detection posture as
// tests/js/test-pin-gate-coverage.mjs.
//
// Run: node --experimental-strip-types --test tests/js/test-boh-pin-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANAGER_SHEET_PATHS, COOK_SHEET_PATHS, BOH_BASE } from '../../lib/boh/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Comments come out before any quoted string is read: an apostrophe in
 * prose ("the cook's own paper") reads as a quote character otherwise and
 * silently desyncs the scan for the rest of the array.
 * @param {string} src
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

const middlewareSrc = stripComments(
  fs.readFileSync(path.join(REPO_ROOT, 'middleware.js'), 'utf8'),
);
const navSrc = stripComments(
  fs.readFileSync(path.join(REPO_ROOT, 'app/_components/navRegistry.js'), 'utf8'),
);

/**
 * Pull the quoted strings out of a named array literal, whether it is
 * declared (`NAME = [...]`) or an object key (`matcher: [...]`).
 * @param {string} src
 * @param {string} name
 */
function arrayLiteral(src, name) {
  const match = src.match(new RegExp(`${name}\\s*[=:]\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `could not find ${name}`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const sensitive = arrayLiteral(middlewareSrc, 'SENSITIVE_PREFIXES');
const matcher = arrayLiteral(middlewareSrc, 'matcher');
const navManager = arrayLiteral(navSrc, 'MANAGER_PIN_PREFIXES');

/**
 * @param {string[]} prefixes
 * @param {string} routePath
 */
function coveredByPrefix(prefixes, routePath) {
  return prefixes.some((p) => routePath === p || routePath.startsWith(`${p}/`));
}

/**
 * Middleware only runs for paths in config.matcher, so a SENSITIVE prefix
 * without a matcher entry gates nothing at all.
 * @param {string} routePath
 */
function coveredByMatcher(routePath) {
  return matcher.some((entry) => {
    const base = entry.replace(/\/:path\*$/, '');
    return routePath === base || routePath.startsWith(`${base}/`);
  });
}

describe('boh pin coverage', () => {
  it('has sheets on both tiers', () => {
    assert.ok(MANAGER_SHEET_PATHS.length > 0, 'no manager sheets');
    assert.ok(COOK_SHEET_PATHS.length > 0, 'no cook sheets');
  });

  it('gates every manager sheet in middleware', () => {
    const ungated = MANAGER_SHEET_PATHS.filter(
      (p) => !coveredByPrefix(sensitive, p) || !coveredByMatcher(p),
    );
    assert.deepEqual(
      ungated,
      [],
      `manager sheet(s) not PIN-gated:\n${ungated.join('\n')}\n\n` +
        `Add each to BOTH SENSITIVE_PREFIXES and config.matcher in middleware.js.`,
    );
  });

  it('marks every manager sheet manager-only in the nav', () => {
    const unmarked = MANAGER_SHEET_PATHS.filter((p) => !coveredByPrefix(navManager, p));
    assert.deepEqual(
      unmarked,
      [],
      `manager sheet(s) missing from MANAGER_PIN_PREFIXES in navRegistry.js:\n${unmarked.join('\n')}`,
    );
  });

  it('leaves every cook sheet open', () => {
    // A cook holding a phone on the line must reach their own station SOP
    // without a manager walking over to punch a PIN.
    const gated = COOK_SHEET_PATHS.filter((p) => coveredByPrefix(sensitive, p));
    assert.deepEqual(gated, [], `cook sheet(s) behind the PIN:\n${gated.join('\n')}`);
  });

  it('leaves the book index itself open', () => {
    assert.equal(coveredByPrefix(sensitive, BOH_BASE), false, '/boh must not be gated wholesale');
  });

  it('gates no line-book path that is not a real sheet', () => {
    // Guard against rot: a renamed sheet would leave a dead prefix behind
    // that silently protects nothing.
    const known = new Set(MANAGER_SHEET_PATHS);
    const stale = sensitive.filter((p) => p.startsWith(`${BOH_BASE}/`) && !known.has(p));
    assert.deepEqual(stale, [], `middleware gates unknown line-book path(s): ${stale.join(', ')}`);
  });
});
