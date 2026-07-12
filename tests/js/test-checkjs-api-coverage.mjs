#!/usr/bin/env node
// Drift guard for the GH #250 checkjs drain (docs/checkjs-migration.md P3).
//
// Every app/api file carrying a real `// @ts-nocheck` DIRECTIVE (line
// start — NOT the substring, which also appears in drained files'
// migration comments) must be in the BASELINE below. Two failure modes:
//
//   1. A file is pinned but NOT in the baseline → someone added a new
//      unchecked handler (or re-pinned a drained one). Fix the types
//      instead — see docs/checkjs-migration.md "How to migrate one file".
//   2. A baseline entry is no longer pinned (drained or deleted) →
//      progress! Remove it from the BASELINE so the ledger stays honest.
//
// The baseline may only shrink. When it hits zero, replace this list
// with an assert-empty and the P3 lint rule is effectively live.
//
// Run: node --test tests/js/test-checkjs-api-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const API_ROOT = path.join(REPO_ROOT, 'app/api');

// Files still pinned as of 2026-07-11 (the drain's remaining tail).
const BASELINE = new Set([
  'app/api/inventory/counts/[id]/lines/route.js',
  'app/api/inventory/counts/[id]/route.js',
  'app/api/inventory/counts/route.js',
  'app/api/kds/tickets/[id]/bump/route.js',
  'app/api/kds/tickets/route.js',
  'app/api/lari/predictions/route.js',
  'app/api/menu-engineering/margin-deltas/route.js',
  'app/api/menu-engineering/route.js',
  'app/api/morning/route.js',
  'app/api/prep-tasks/[id]/route.js',
  'app/api/prep-tasks/route.js',
  'app/api/purchasing/vendor-catalog/route.js',
  'app/api/purchasing/vendor-compare/route.js',
  'app/api/purchasing/vendor-link/attach/route.js',
  'app/api/purchasing/vendor-link/pair/route.js',
  'app/api/receiving/matches/[id]/route.js',
  'app/api/receiving/matches/route.js',
  'app/api/receiving/route.js',
  'app/api/recipes/[slug]/photos/[id]/raw/route.js',
  'app/api/recipes/[slug]/photos/[id]/route.js',
  'app/api/recipes/[slug]/photos/route.js',
  'app/api/recipes/[slug]/route.js',
  'app/api/recipes/route.js',
  'app/api/shows/[id]/box-office/[lineId]/route.js',
  'app/api/shows/[id]/box-office/route.js',
  'app/api/shows/[id]/capacity/route.js',
  'app/api/shows/[id]/deal/route.js',
  'app/api/shows/[id]/settlement/pdf/route.js',
  'app/api/shows/[id]/settlement/route.js',
  'app/api/shows/[id]/sound/[sceneId]/route.js',
  'app/api/shows/[id]/sound/route.js',
  'app/api/shows/[id]/sound/spl/route.js',
  'app/api/shows/[id]/stage/route.js',
  'app/api/shows/route.js',
  'app/api/shows/tonight/route.js',
  'app/api/sick-leave/route.js',
  'app/api/sick-worker/route.js',
  'app/api/specials/route.js',
  'app/api/specials/saved/[id]/export/route.js',
  'app/api/specials/saved/[id]/route.js',
  'app/api/specials/saved/route.js',
  'app/api/stations/route.js',
  'app/api/temp-log/route.js',
  'app/api/thermometer-calibrations/route.js',
  'app/api/tip-pool/route.js',
  'app/api/tphc/route.js',
  'app/api/unmapped/route.js',
  'app/api/vendor-prices/history/route.js',
  'app/api/vendor-prices/shocks/route.js',
  'app/api/wage-notices/route.js',
]);

const DIRECTIVE = /^\/\/ @ts-nocheck\b/m;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|ts|tsx|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function pinnedApiFiles() {
  return walk(API_ROOT)
    .filter((f) => DIRECTIVE.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'))
    .sort();
}

describe('checkjs drain — app/api @ts-nocheck baseline (GH #250 P3)', () => {
  const pinned = pinnedApiFiles();

  it('no NEW @ts-nocheck directives under app/api (baseline only shrinks)', () => {
    const added = pinned.filter((f) => !BASELINE.has(f));
    assert.deepEqual(
      added,
      [],
      `new unchecked handler(s) under app/api — fix the types instead of pinning:\n  ${added.join('\n  ')}`,
    );
  });

  it('baseline stays honest — drained files must be removed from it', () => {
    const still = new Set(pinned);
    const stale = [...BASELINE].filter((f) => !still.has(f)).sort();
    assert.deepEqual(
      stale,
      [],
      `baseline entries no longer pinned (progress!) — delete them from BASELINE:\n  ${stale.join('\n  ')}`,
    );
  });
});
