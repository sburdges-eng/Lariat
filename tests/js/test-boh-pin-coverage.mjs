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
const swSrc = stripComments(fs.readFileSync(path.join(REPO_ROOT, 'public/sw.js'), 'utf8'));

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

describe('boh offline cache tier', () => {
  // public/sw.js keeps the cook sheets on the device so the line book
  // opens with the wifi down. It is the fourth place the tier split is
  // written down, and the most dangerous one to get wrong: a cached
  // manager sheet is vendor pricing readable by anyone holding the
  // phone, with no PIN in the way and no server round-trip to stop it.
  const offline = arrayLiteral(swSrc, 'OFFLINE_PAGES');

  it('caches every cook sheet for offline use', () => {
    const missing = COOK_SHEET_PATHS.filter((p) => !offline.includes(p));
    assert.deepEqual(missing, [], `cook sheet(s) absent from OFFLINE_PAGES:\n${missing.join('\n')}`);
  });

  it('caches the book index so a cook can still navigate', () => {
    assert.ok(offline.includes(BOH_BASE), '/boh itself must be cached');
  });

  it('never caches a manager sheet', () => {
    const leaked = MANAGER_SHEET_PATHS.filter((p) => offline.includes(p));
    assert.deepEqual(
      leaked,
      [],
      `manager sheet(s) would be served offline with no PIN:\n${leaked.join('\n')}`,
    );
  });

  it('caches nothing outside the line book', () => {
    // Live-ops surfaces must not be here either: a stale 86 board read
    // off a cache is worse than no 86 board.
    const known = new Set([BOH_BASE, ...COOK_SHEET_PATHS]);
    const extra = offline.filter((p) => !known.has(p));
    assert.deepEqual(extra, [], `OFFLINE_PAGES caches unexpected path(s): ${extra.join(', ')}`);
  });
});

describe('boh sheet data stays out of the client bundle', () => {
  // The fifth place the tier split can leak, and the only one the four
  // checks above cannot see: the JavaScript bundle itself.
  //
  // `lib/boh/index.ts` imports BOH_SHEETS (the whole 190KB packet, both
  // tiers) and evaluates MANAGER_SHEET_PATHS/COOK_SHEET_PATHS at module
  // scope, so the import survives tree-shaking. A `'use client'` file that
  // reaches that barrel for one string helper therefore ships every
  // manager sheet — Sysco account number, vendor reps and their phone
  // numbers, named private-event customers — into a chunk that /boh and
  // /boh/[sheet] load. Those two routes are deliberately open, and
  // config.matcher covers no /_next/static path, so the bytes arrive with
  // no PIN and public/sw.js then persists them into ASSET_CACHE for
  // offline reading.
  //
  // The check is static, not bundle-based, because `npm run test:boh`
  // runs before `npm run build` in verify — a scan of .next would find no
  // directory in CI and skip, which is the vacuous-gate failure this repo
  // has been bitten by before. The bundle scan below is corroboration
  // when a build happens to be present, not the gate.

  const CLIENT_ROOTS = ['app'];
  const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
  const SHEET_DATA = path.join(REPO_ROOT, 'lib/boh/sheets.generated.ts');

  /** @param {string} dir @param {string[]} out */
  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (SOURCE_EXTS.includes(path.extname(entry.name))) out.push(full);
    }
    return out;
  }

  /**
   * Runtime import edges only. `import type` is erased by the compiler and
   * JSDoc `import('...')` lives in a comment, so neither pulls bytes into
   * a bundle — counting them would report leaks that do not exist.
   * @param {string} file
   */
  function importsFrom(file) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const specifiers = [];
    const patterns = [
      /(?:^|\n)\s*import\s+(?!type\b)[^;'"]*from\s*['"]([^'"]+)['"]/g,
      /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
      /(?:^|\n)\s*export\s+(?!type\b)[^;'"]*from\s*['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const re of patterns) {
      for (const m of src.matchAll(re)) specifiers.push(m[1]);
    }
    return specifiers;
  }

  /** @param {string} fromFile @param {string} spec */
  function resolveRelative(fromFile, spec) {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    const candidates = [
      base,
      ...SOURCE_EXTS.map((e) => base + e),
      ...SOURCE_EXTS.map((e) => path.join(base, `index${e}`)),
    ];
    return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
  }

  /**
   * Every module a client entry pulls in, followed transitively. Returns
   * the first path that reaches the sheet data, or null.
   * @param {string} entry
   */
  function pathToSheetData(entry) {
    const queue = [[entry]];
    const seen = new Set([entry]);
    while (queue.length > 0) {
      const trail = /** @type {string[]} */ (queue.shift());
      const file = trail[trail.length - 1];
      for (const spec of importsFrom(file)) {
        const resolved = resolveRelative(file, spec);
        if (!resolved || seen.has(resolved)) continue;
        if (resolved === SHEET_DATA) return [...trail, resolved];
        seen.add(resolved);
        queue.push([...trail, resolved]);
      }
    }
    return null;
  }

  const clientEntries = CLIENT_ROOTS.flatMap((root) =>
    walk(path.join(REPO_ROOT, root)).filter((f) => {
      const head = fs.readFileSync(f, 'utf8').slice(0, 400);
      return /^\s*(['"])use client\1/m.test(head);
    }),
  );

  it('finds client components to check, so this gate is not vacuous', () => {
    assert.ok(clientEntries.length > 0, "no 'use client' files found under app/");
  });

  it('never lets a client component reach lib/boh/sheets.generated.ts', () => {
    const leaks = clientEntries
      .map((entry) => ({ entry, trail: pathToSheetData(entry) }))
      .filter((r) => r.trail !== null)
      .map(
        (r) =>
          `${path.relative(REPO_ROOT, r.entry)}\n    ` +
          /** @type {string[]} */ (r.trail).map((f) => path.relative(REPO_ROOT, f)).join('\n    -> '),
      );
    assert.deepEqual(
      leaks,
      [],
      'client component(s) pull the whole line book into the browser bundle:\n' +
        `${leaks.join('\n\n')}\n\n` +
        'Import the pure helpers from lib/boh/helpers.ts instead of the ' +
        'lib/boh/index.ts barrel — the barrel evaluates MANAGER_SHEET_PATHS ' +
        'over BOH_SHEETS at module scope, so it can never be tree-shaken.',
    );
  });
});
