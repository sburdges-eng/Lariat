#!/usr/bin/env node
// Coverage sweep — no new todayISO() or "now → UTC slice" write may land
// outside an allowlist with a one-line rationale.
//
// Spec: docs/superpowers/specs/2026-08-06-service-date-design.md step 9.
// Shape matches test-pin-gate-coverage.mjs / test-idempotency-coverage.mjs.
//
// Two patterns, because the original defect exists in both forms:
//   1. todayISO() — the shared UTC helper
//   2. new Date().toISOString().slice(0, 10) — the same UTC slice inlined
//
// Date arithmetic on an *already resolved* ISO (`d.toISOString().slice(0,10)`
// after setUTCDate) is not this bug and is not scanned.
//
// Run: node --test tests/js/test-service-date-coverage.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const ROOTS = ['app', 'lib', 'scripts'];
const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  'LariatNative',
  'desktop',
  '__tests__',
]);
const SKIP_FILE_RE = /(\.test\.|\.spec\.)/;

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/** Files allowed to call todayISO(). Path is repo-relative. */
const TODAY_ISO_ALLOW = new Map([
  ['lib/db/queries.ts', 'definition of the UTC helper itself'],
  ['lib/db.ts', 'barrel re-export'],
  ['app/analytics/operators/page.jsx', 'rolling reporting window end — calendar, not shift'],
  ['app/api/analytics/operators/route.js', 'same reporting window as the operators page'],
  ['app/floor/page.jsx', 'guest reservation_at calendar bookings'],
  ['app/management/page.jsx', 'cert expires_on calendar math'],
  ['app/labor/certs/page.jsx', 'cert expires_on calendar math'],
  ['app/reservations/page.jsx', 'reservation calendar day'],
  ['scripts/phase-c-reconcile.mjs', 'C4 money checksums keyed to the UTC calendar day of the run'],
]);

/** Files allowed to inline `new Date().toISOString().slice(0, 10)`. */
const INLINE_NOW_ALLOW = new Map([
  ['lib/db/queries.ts', 'todayISO() implementation'],
  ['lib/showsRepo.ts', 'show_date is a billed calendar date; nextUpcoming compares calendar'],
  ['app/playbook/page.jsx', 'nextUpcoming show lookup is calendar, not service-day'],
  ['app/booking/page.jsx', 'booking calendar day'],
  ['app/host/page.jsx', 'waitlist created_at prefix is a calendar day'],
  ['app/api/host/waitlist/route.js', 'same waitlist calendar prefix as the host page'],
  ['app/labor/wage-notices/page.jsx', 'legal signed-on date is a calendar day'],
  ['app/api/wage-notices/route.js', 'same legal signed-on calendar day'],
  ['app/management/performance-reviews/PerformanceReviewBoard.tsx', 'HR review date is a calendar day'],
  ['scripts/phase-c-reconcile.mjs', 'C4 money checksums keyed to the UTC calendar day of the run'],
]);

const TODAY_ISO_RE = /\btodayISO\s*\(/;
const INLINE_NOW_RE = /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    if (SKIP_DIR.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!EXT.has(path.extname(ent.name))) continue;
    if (SKIP_FILE_RE.test(ent.name)) continue;
    out.push(full);
  }
  return out;
}

function rel(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/** Drop line and block comments so docstrings naming todayISO() are not hits. */
function withoutComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function hits(pattern, allow) {
  const found = [];
  for (const root of ROOTS) {
    const absRoot = path.join(REPO_ROOT, root);
    if (!fs.existsSync(absRoot)) continue;
    for (const file of walk(absRoot)) {
      const key = rel(file);
      const src = withoutComments(fs.readFileSync(file, 'utf8'));
      if (!pattern.test(src)) continue;
      if (allow.has(key)) continue;
      found.push(key);
    }
  }
  return found.sort();
}

function staleAllow(allow) {
  return [...allow.keys()].filter((p) => !fs.existsSync(path.join(REPO_ROOT, p)));
}

describe('service-date coverage sweep', () => {
  it('no new todayISO() call lands outside the calendar/reporting allowlist', () => {
    const stray = hits(TODAY_ISO_RE, TODAY_ISO_ALLOW);
    assert.deepEqual(
      stray,
      [],
      stray.length === 0
        ? ''
        : `todayISO() is UTC and rolls the dinner service to tomorrow.\n` +
            `Use serviceDate() for shift stamps, or add the file to TODAY_ISO_ALLOW with a reason.\n\n` +
            stray.map((f) => `  ${f}`).join('\n'),
    );
  });

  it('no new Date().toISOString().slice(0, 10) now-stamp lands outside the allowlist', () => {
    const stray = hits(INLINE_NOW_RE, INLINE_NOW_ALLOW);
    assert.deepEqual(
      stray,
      [],
      stray.length === 0
        ? ''
        : `Inline UTC now-stamps are the same defect as todayISO().\n` +
            `Use serviceDate() for shift stamps, or add the file to INLINE_NOW_ALLOW with a reason.\n\n` +
            stray.map((f) => `  ${f}`).join('\n'),
    );
  });

  it('TODAY_ISO_ALLOW paths exist', () => {
    assert.deepEqual(staleAllow(TODAY_ISO_ALLOW), [], 'stale TODAY_ISO_ALLOW entries');
  });

  it('INLINE_NOW_ALLOW paths exist', () => {
    assert.deepEqual(staleAllow(INLINE_NOW_ALLOW), [], 'stale INLINE_NOW_ALLOW entries');
  });
});
