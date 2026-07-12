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

// 2026-07-12: the app/api drain is COMPLETE (GH #250 final wave) — the
// baseline is empty and this test now IS the P3 rule for the API
// surface: any `@ts-nocheck` directive under app/api fails CI. Fix the
// types instead (docs/checkjs-migration.md "How to migrate one file").
const BASELINE = new Set([]);

// Whitespace-tolerant: TypeScript honors the directive with leading
// indentation and extra spaces after `//` (e.g. `   //   @ts-nocheck`).
// Requires @ts-nocheck immediately after the comment opener so the
// mid-sentence mentions in drained files' migration comments (`…the
// pre-#250 @ts-nocheck baseline…`) never match.
const DIRECTIVE = /^\s*\/\/\s*@ts-nocheck\b/m;

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
