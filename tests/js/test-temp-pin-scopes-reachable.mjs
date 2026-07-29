#!/usr/bin/env node
// A temp-PIN scope that middleware shadows is a scope that does not work.
//
// THE SHAPE OF THE BUG
// --------------------
// `hasPinOrTempPin(req, scope)` reads the `temp_pins` table so a shift PIC
// carrying a scoped temp PIN gets through. Middleware runs on the Edge
// runtime with no DB handle and can only ever verify the master
// `lariat_pin_ok` cookie. So when a route gates on a temp-PIN scope AND its
// path is covered by `config.matcher`, middleware redirects the caller to
// /login-pin before the route that would have accepted them ever runs.
//
// The route looks gated, the scope exists in lib/tempPinScopes.ts, a manager
// can issue it, and it silently does nothing. Nothing failed loudly, because
// from the caller's side it is indistinguishable from "you need a PIN".
//
// This is the mirror of the invariant in
// tests/js/test-unconfigured-install-fails-closed.mjs: that one says a
// SENSITIVE_PREFIXES entry with no matcher entry protects nothing, this one
// says a matcher entry over a temp-PIN-scoped route breaks something.
//
// Run: node --test tests/js/test-temp-pin-scopes-reachable.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const API_ROOT = path.join(REPO_ROOT, 'app/api');

// Prefixes that stay in config.matcher even though a route under them gates
// on a temp-PIN scope, with the reason. An entry here is a KNOWN BROKEN
// SCOPE, not an approval — it is recorded so it cannot be forgotten, and so
// a new one cannot be added silently.
const KNOWN_SHADOWED = new Map([]);

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * @param {string} src
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

const middlewareSrc = stripComments(fs.readFileSync(path.join(REPO_ROOT, 'middleware.js'), 'utf8'));

/** @param {string} name */
function arrayLiteral(name) {
  const match = middlewareSrc.match(new RegExp(`${name}\\s*[=:]\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `could not find ${name} in middleware.js`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** @param {string} routePath */
function coveredByMatcher(routePath) {
  return arrayLiteral('matcher').some((entry) => {
    const base = entry.replace(/\/:path\*$/, '');
    return routePath === base || routePath.startsWith(`${base}/`);
  });
}

/** @param {string} dir @param {string} prefix */
function walkRoutes(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkRoutes(full, rel));
    else if (/^route\.(js|ts)$/.test(entry.name)) out.push({ file: full, route: `/api/${prefix}` });
  }
  return out;
}

/**
 * Scopes passed to either temp-PIN-aware helper, resolving a local
 * `const SCOPE = '...'` as well as an inline literal.
 *
 * BOTH helpers must be matched. `requirePinOrScope` hits temp_pins exactly
 * like `hasPinOrTempPin` — it is the wrapper the shows routes use — and an
 * earlier version of this file matched only the latter. It reported 2 dead
 * scopes when there were 6, which is the same failure it exists to catch:
 * a green check proving less than it claims.
 *
 * @param {string} src
 */
function tempPinScopes(src) {
  const scopes = new Set();
  for (const m of src.matchAll(/(?:hasPinOrTempPin|requirePinOrScope)\(\s*[\w.]+\s*,\s*([^)]+)\)/g)) {
    const arg = m[1].trim();
    const literal = arg.match(/^'([^']+)'/);
    if (literal) {
      scopes.add(literal[1]);
      continue;
    }
    const ident = arg.match(/^([A-Za-z_$][\w$]*)/);
    if (!ident) continue;
    const decl = src.match(new RegExp(`const\\s+${ident[1]}\\s*=\\s*['"]([^'"]+)`));
    scopes.add(decl ? decl[1] : `${ident[1]} (unresolved)`);
  }
  return [...scopes];
}

const scopedRoutes = walkRoutes(API_ROOT)
  .map(({ file, route }) => ({ file, route, scopes: tempPinScopes(fs.readFileSync(file, 'utf8')) }))
  .filter((r) => r.scopes.length > 0);

/** @param {string} route */
function knownShadowedPrefix(route) {
  return [...KNOWN_SHADOWED.keys()].find((p) => route === p || route.startsWith(`${p}/`));
}

describe('temp-PIN scopes are reachable', () => {
  it('finds routes that gate on a temp-PIN scope', () => {
    assert.ok(scopedRoutes.length > 0, 'no hasPinOrTempPin call sites found — has the helper been renamed?');
  });

  it('no temp-PIN-scoped route is shadowed by config.matcher', () => {
    const shadowed = scopedRoutes
      .filter((r) => coveredByMatcher(r.route) && !knownShadowedPrefix(r.route))
      .map((r) => `  ${r.route}  [${r.scopes.join(', ')}]`);

    assert.deepEqual(
      shadowed,
      [],
      `These routes gate on a temp-PIN scope but sit under config.matcher, so\n` +
        `middleware redirects the holder to /login-pin before the route runs.\n` +
        `The scope is issuable, the route honours it, and it does nothing:\n` +
        `${shadowed.join('\n')}\n\n` +
        `Middleware cannot evaluate a temp-PIN scope — it runs on the Edge\n` +
        `runtime with no DB handle and can only check the master cookie. So\n` +
        `either drop the prefix from SENSITIVE_PREFIXES and config.matcher and\n` +
        `let the route layer gate it, or record it in KNOWN_SHADOWED with the\n` +
        `reason it cannot be dropped yet.`,
    );
  });

  it('every KNOWN_SHADOWED entry is still real', () => {
    // Anti-rot, same posture as the ALLOWLIST checks in
    // test-pin-gate-coverage.mjs: an entry that no longer describes a live
    // problem would sit here forever pretending to.
    const stale = [...KNOWN_SHADOWED.keys()].filter(
      (p) => !scopedRoutes.some((r) => (r.route === p || r.route.startsWith(`${p}/`)) && coveredByMatcher(r.route)),
    );
    assert.deepEqual(stale, [], `KNOWN_SHADOWED entr(ies) no longer shadowed — delete them: ${stale.join(', ')}`);
  });
});
