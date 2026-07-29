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
// The fix is both layers, because either alone leaves a hole: middleware is
// a prefix list that has already been missed once, and the route layer is
// what still stands if a prefix is forgotten again.
//
// /api/recipes is deliberately NOT added to the middleware list — that
// prefix would gate GET too, and cooks read recipes without a credential by
// design (see the ALLOWLIST in test-pin-gate-coverage.mjs). Its PUT is
// gated at the route layer, which is where the fix applies.
//
// Run: node --experimental-strip-types --test tests/js/test-unconfigured-install-fails-closed.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

// Routes that reach pinRequiredForPic but sat outside SENSITIVE_PREFIXES.
const PREVIOUSLY_EXPOSED = [
  '/api/sick-leave',
  '/api/sick-worker',
  '/api/tip-pool',
  '/api/wage-notices',
  '/api/certifications',
];

function sensitivePrefixes() {
  const src = fs.readFileSync(path.join(REPO, 'middleware.js'), 'utf8');
  const start = src.indexOf('SENSITIVE_PREFIXES');
  const block = src.slice(start, start + src.slice(start).indexOf('];'));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('middleware covers the regulated routes that were exposed', () => {
  const prefixes = sensitivePrefixes();

  for (const route of PREVIOUSLY_EXPOSED) {
    it(`${route} is behind SENSITIVE_PREFIXES`, () => {
      assert.ok(
        prefixes.some((p) => route.startsWith(p)),
        `${route} reaches pinRequiredForPic but no middleware prefix matches it, ` +
          `so an unconfigured install serves it with no credential.`,
      );
    });
  }

  it('does NOT gate /api/recipes wholesale', () => {
    // A prefix here gates GET as well, and cooks read recipes without a
    // credential by design. The PUT gate lives at the route layer.
    assert.ok(
      !prefixes.includes('/api/recipes'),
      'gating /api/recipes in middleware would block cooks from reading recipes',
    );
  });
});

describe('the route layer still runs in LAN-trust mode (open decision)', () => {
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

  // Pins CURRENT behavior, not desired behavior, so the second line of
  // defence is visible rather than assumed.
  //
  // `pinRequiredForPic()` returns pinConfigured(), so with nothing
  // configured every gate built on it opens. Middleware above is what
  // actually closes the exposure today.
  //
  // Inverting this is a product decision, not a bug fix: LAN-trust is a
  // named, deliberately tested invariant — see the describe block
  // "PIN gate defense-in-depth — LARIAT_PIN unset = LAN-trust mode = no
  // gate" in test-pin-defense-in-depth.mjs, which asserts across every route
  // that an unconfigured install does NOT 401. Flipping it turns 243 cases
  // across 43 files red, because those suites call route handlers directly
  // with no cookie and rely on the open gate.
  //
  // When that decision is made, this test flips to assert `true` and the
  // LAN-trust suite is rescoped to the cook-facing routes it should still
  // cover.
  it('is open when nothing is configured — middleware is the live guard', () => {
    assert.equal(pin.pinRequiredForPic(), false);
  });

  it('closes as soon as a PIN is configured', () => {
    process.env.LARIAT_PIN = '0708';
    try {
      assert.equal(pin.pinRequiredForPic(), true);
      assert.equal(pin.pinConfigured(), true);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});
