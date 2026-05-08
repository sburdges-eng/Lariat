#!/usr/bin/env node
// Tests for the standalone cloud-bridge drainer script's process keepalive.
//
// Scope: pin the contract that scripts/cloud-bridge-drainer.mjs explicitly
// keeps the event loop open via a REF'd setInterval, and that shutdown()
// clears that interval before exiting.
//
// Why this test exists: the previous keepalive called .unref() with an
// inline comment acknowledging it doesn't actually keep the loop alive —
// the comment relied on Node's "registered listener keeps the loop alive"
// semantics, which is fragile across Node versions and process managers
// (PM2 / launchd can drain handlers differently). Audit reference:
// docs/audit/2026-05-08-codebase-audit.md §3 (Cloud-bridge HIGH).
//
// We deliberately do NOT spawn the real script — its top-level await of
// lib/cloudBridgeDrainer.ts requires a real DB and would tangle the test
// matrix. The structural assertion is enough: pre-fix, .unref() is in
// the source; post-fix it's gone and the cleanup is wired into shutdown.
//
// Run:
//   node --test tests/js/test-cloud-bridge-drainer-script-keepalive.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '../../scripts/cloud-bridge-drainer.mjs');
const scriptSource = readFileSync(scriptPath, 'utf8');

describe('cloud-bridge drainer script — keepalive contract', () => {
  it('does not call .unref() on the keepalive interval', () => {
    // The fragile pattern was `keepalive.unref()` with a comment admitting
    // it doesn't keep the loop alive. The fix drops the .unref() entirely
    // so the interval explicitly holds the loop open.
    assert.ok(
      !/keepalive\.unref\(\s*\)/.test(scriptSource),
      'scripts/cloud-bridge-drainer.mjs should not call keepalive.unref() — ' +
        'the interval must stay REF\'d so the process stays alive regardless ' +
        'of Node\'s handler-keepalive semantics.',
    );
  });

  it('declares a keepalive interval that holds the event loop open', () => {
    // Sanity-check the post-fix shape: a setInterval assigned to a
    // `keepalive` binding still exists (we didn't accidentally delete it).
    assert.ok(
      /(?:const|let)\s+keepalive\s*=\s*setInterval\s*\(/.test(scriptSource),
      'scripts/cloud-bridge-drainer.mjs should declare a `keepalive = setInterval(...)` binding',
    );
  });

  it('clears the keepalive interval inside shutdown()', () => {
    // shutdown() is the SIGTERM/SIGINT path. It must clear the keepalive
    // before process.exit so the loop can drain cleanly. Without this,
    // the REF'd interval would block the natural exit if anyone ever
    // removed the explicit process.exit call.
    const shutdownMatch = scriptSource.match(/function\s+shutdown\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(shutdownMatch, 'expected to find a `function shutdown(...) { ... }` declaration');
    const shutdownBody = shutdownMatch[1];
    assert.ok(
      /clearInterval\s*\(\s*keepalive\s*\)/.test(shutdownBody),
      'shutdown() must call clearInterval(keepalive) so the keepalive is released on SIGTERM/SIGINT.',
    );
  });
});
