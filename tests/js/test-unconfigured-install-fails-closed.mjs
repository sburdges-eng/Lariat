#!/usr/bin/env node
// An install with no PIN configured must not serve regulated surfaces.
//
// WHY THIS EXISTS
// ---------------
// `pinRequiredForPic()` returned `pinConfigured()`, so when NOTHING was
// configured it returned false and every gate built on it opened. The
// docstring called this "LAN-trust single-site deployment", which is a
// defensible trade-off for one restaurant on a known network and the wrong
// one for software that installs on a stranger's machine.
//
// Middleware masked most of it — /api/audit, /api/beo and /api/specials/saved
// sit behind SENSITIVE_PREFIXES and 503 when unconfigured. Six callers did
// not, and they are not the harmless ones:
//
//   /api/sick-leave     PHI
//   /api/sick-worker    PHI
//   /api/tip-pool       pay data
//   /api/wage-notices   pay data
//   /api/certifications staff records
//   /api/recipes/[slug] PUT — recipe rewrite
//
// On a fresh install those were readable and writable with no credential.
//
// WHY THE FIX IS THE ROUTE LAYER, NOT MIDDLEWARE
// ----------------------------------------------
// The first attempt added the five to SENSITIVE_PREFIXES. That closed
// nothing: Next.js only invokes middleware for paths matching
// `config.matcher`, and none of them were added there, so `isSensitive()`
// was never consulted. Membership in SENSITIVE_PREFIXES reads like
// protection and is inert on its own. The first describe block below is the
// gate that makes those two arrays impossible to desync again.
//
// Adding the matcher entries would have been worse than useless. Every one
// of these routes gates on `hasPinOrTempPin(req, 'pic.*')`, which reads the
// temp_pins table so a shift PIC carrying a scoped temp PIN gets through.
// Middleware runs on the Edge runtime with no DB handle and can only verify
// the master cookie, so a matcher entry would redirect exactly the staff the
// pic.* scopes exist to admit — a working PHI gate traded for a broken one.
//
// So these routes are gated where scopes are legible: the route layer, now
// fail-closed. /api/recipes stays out of middleware for the mirror-image
// reason — a prefix gates GET too, and cooks read recipes without a
// credential by design (see the ALLOWLIST in test-pin-gate-coverage.mjs).
// Its PUT is gated at the route layer, which is where the fix applies.
//
// Run: node --experimental-strip-types --test tests/js/test-unconfigured-install-fails-closed.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

// Routes that reach pinRequiredForPic but sat outside SENSITIVE_PREFIXES,
// paired with the source file whose gate is now the only thing standing.
const PREVIOUSLY_EXPOSED = [
  { route: '/api/sick-leave', file: 'app/api/sick-leave/route.js' },
  { route: '/api/sick-worker', file: 'app/api/sick-worker/route.js' },
  { route: '/api/tip-pool', file: 'app/api/tip-pool/route.js' },
  { route: '/api/wage-notices', file: 'app/api/wage-notices/route.js' },
  { route: '/api/certifications', file: 'app/api/certifications/route.js' },
  { route: '/api/recipes/[slug]', file: 'app/api/recipes/[slug]/route.js' },
];

/**
 * Comments come out before any quoted string is read — an apostrophe in
 * prose reads as a quote character otherwise and silently desyncs the scan
 * for the rest of the array. Borrowed from test-boh-pin-coverage.mjs.
 * @param {string} src
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

const middlewareSrc = stripComments(fs.readFileSync(path.join(REPO, 'middleware.js'), 'utf8'));

/**
 * @param {string} name
 * @returns {string[]}
 */
function arrayLiteral(name) {
  const match = middlewareSrc.match(new RegExp(`${name}\\s*[=:]\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(match, `could not find ${name} in middleware.js`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/**
 * Next.js only invokes middleware for paths matching config.matcher. A
 * SENSITIVE_PREFIXES entry with no matcher entry gates precisely nothing:
 * isSensitive() is never consulted because middleware() is never called.
 * @param {string} routePath
 */
function coveredByMatcher(routePath) {
  return arrayLiteral('matcher').some((entry) => {
    const base = entry.replace(/\/:path\*$/, '');
    return routePath === base || routePath.startsWith(`${base}/`);
  });
}

describe('the middleware prefix list is not inert', () => {
  it('every SENSITIVE_PREFIXES entry is reachable by config.matcher', () => {
    const prefixes = arrayLiteral('SENSITIVE_PREFIXES');
    const inert = prefixes.filter((p) => !coveredByMatcher(p));
    assert.deepEqual(
      inert,
      [],
      `SENSITIVE_PREFIXES entr(ies) that middleware never runs for:\n` +
        `${inert.map((p) => `  ${p}`).join('\n')}\n\n` +
        `Each is declared sensitive and served open. Either add a matching\n` +
        `config.matcher entry, or — if the route gates on a temp-PIN scope\n` +
        `that Edge middleware cannot evaluate — drop it from SENSITIVE_PREFIXES\n` +
        `and gate it at the route layer instead.`,
    );
  });

  it('does NOT gate /api/recipes wholesale', () => {
    // A prefix here gates GET as well, and cooks read recipes without a
    // credential by design. The PUT gate lives at the route layer.
    assert.ok(
      !arrayLiteral('SENSITIVE_PREFIXES').includes('/api/recipes'),
      'gating /api/recipes in middleware would block cooks from reading recipes',
    );
  });
});

describe('every previously-exposed route gates at the route layer', () => {
  for (const { route, file } of PREVIOUSLY_EXPOSED) {
    it(`${route} calls a PIN gate in its handler`, () => {
      const src = fs.readFileSync(path.join(REPO, file), 'utf8');
      assert.match(
        src,
        /\b(?:hasPinCookie|hasPinOrTempPin|requirePin(?:OrScope)?)\b/,
        `${file} carries PHI, pay data or staff records and is not covered by ` +
          `middleware. Losing its route-layer gate serves it to anyone.`,
      );
    });
  }
});

describe('an unconfigured install fails closed', () => {
  /** @type {typeof import('../../lib/pin.ts')} */
  let pin;
  const saved = process.env.LARIAT_PIN;

  before(async () => {
    delete process.env.LARIAT_PIN;
    pin = await import('../../lib/pin.ts');
  });

  after(() => {
    if (saved === undefined) delete process.env.LARIAT_PIN;
    else process.env.LARIAT_PIN = saved;
  });

  it('requires a PIN for PIC authority even when nothing is configured', () => {
    // The flip. Previously this returned pinConfigured() — false on a fresh
    // install — and every gate built on it opened. An operator who has not
    // finished setup gets a closed door, not an open one.
    assert.equal(pin.pinRequiredForPic(), true);
  });

  it('reports the install as unconfigured so setup can still prompt', () => {
    // pinRequiredForPic() and pinConfigured() answer different questions and
    // must not be collapsed: the onboarding flow (lib/setupStatus.ts) needs
    // to know a PIN is missing precisely while the gate is refusing traffic.
    assert.equal(pin.pinConfigured(), false);
  });

  it('stays closed once a PIN is configured', () => {
    process.env.LARIAT_PIN = '0708';
    try {
      assert.equal(pin.pinRequiredForPic(), true);
      assert.equal(pin.pinConfigured(), true);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});
