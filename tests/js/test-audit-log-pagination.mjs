#!/usr/bin/env node
// auditLog.mjs — getAuditLogByAction / getAuditLogForRecipe must surface
// older entries past the legacy "last 1000" cap. Pre-fix the filter ran
// through getRecentAuditLog(1000), so any matching entry past row 1000
// in the JSONL was silently dropped — an integrity hole for HACCP /
// management-actions defense (an inspector reading the UI saw "no
// edits" when the record existed past row 1000).
//
// Audit reference: docs/audit/2026-05-08-codebase-audit.md §1, MEDIUM
// (getAuditLogByAction last-1000 cap).
//
// Run: node --test tests/js/test-audit-log-pagination.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-audit-log-pagination-'));
const TMP_FILE = path.join(TMP_DIR, 'management-actions.jsonl');

let auditLog;

before(async () => {
  process.env.LARIAT_AUDIT_PATH = TMP_FILE;
  auditLog = await import('../../lib/auditLog.mjs');
});

after(() => {
  delete process.env.LARIAT_AUDIT_PATH;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Reset file between cases.
  try { fs.rmSync(TMP_FILE, { force: true }); } catch { /* ignore */ }
});

function seedJsonl(entries) {
  const text = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(TMP_FILE, text);
}

describe('getAuditLogByAction — stream-read past 1000-entry cap', () => {
  it('returns ALL matching entries even when matches sit before the last 1000 rows', () => {
    // Seed 1500 entries. Plant 5 matches for action="recipe_edit"
    // at positions 10, 50, 100, 250, 700 — all comfortably before
    // the legacy 1000-entry tail window when followed by 800+ noise
    // rows. Pre-fix the function would see zero matches because the
    // tail window is rows 500..1499, none of which match.
    const entries = [];
    const matchPositions = new Set([10, 50, 100, 250, 700]);
    for (let i = 0; i < 1500; i++) {
      entries.push({
        id: `audit_seed_${i}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        action: matchPositions.has(i) ? 'recipe_edit' : 'noise_action',
        index: i,
      });
    }
    seedJsonl(entries);

    const matches = auditLog.getAuditLogByAction('recipe_edit');
    assert.equal(matches.length, 5, 'all 5 matching entries must surface (no silent 1000-cap drop)');
    // Newest-first ordering — preserve the prior contract so the
    // route's `.slice(0, limit)` returns recent edits, not ancient ones.
    const indices = matches.map(m => m.index);
    assert.deepEqual(indices, [700, 250, 100, 50, 10]);
  });

  it('returns empty array for a missing audit file', () => {
    // No seed → file does not exist.
    const matches = auditLog.getAuditLogByAction('recipe_edit');
    assert.deepEqual(matches, []);
  });

  it('returns empty array when no entries match the action', () => {
    seedJsonl([
      { id: 'a', action: 'cost_update', timestamp: '2026-01-01T00:00:00.000Z' },
      { id: 'b', action: 'cost_update', timestamp: '2026-01-02T00:00:00.000Z' },
    ]);
    const matches = auditLog.getAuditLogByAction('recipe_edit');
    assert.deepEqual(matches, []);
  });

  it('skips misformed JSONL lines without crashing', () => {
    // Simulate a half-written line from an interrupted appendFileSync.
    const good1 = JSON.stringify({ id: '1', action: 'recipe_edit', timestamp: '2026-01-01T00:00:00.000Z' });
    const good2 = JSON.stringify({ id: '2', action: 'recipe_edit', timestamp: '2026-01-02T00:00:00.000Z' });
    const bad = '{"id":"truncated","action":"recipe_edit"'; // no closing brace
    fs.writeFileSync(TMP_FILE, good1 + '\n' + bad + '\n' + good2 + '\n');

    const matches = auditLog.getAuditLogByAction('recipe_edit');
    assert.equal(matches.length, 2, 'misformed line must be skipped, valid neighbors preserved');
    // Newest-first ordering — id '2' has the later timestamp.
    const ids = matches.map(m => m.id);
    assert.deepEqual(ids, ['2', '1']);
  });
});

describe('getAuditLogForRecipe — same stream-read fix applies', () => {
  it('returns ALL slug matches even past 500-entry legacy cap', () => {
    // Same shape as above but for the slug-keyed helper. Plant 3
    // matches at row indices well outside the legacy 500-entry tail.
    const entries = [];
    const matchPositions = new Set([5, 100, 200]);
    for (let i = 0; i < 900; i++) {
      entries.push({
        id: `audit_recipe_${i}`,
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        action: 'recipe_edit',
        slug: matchPositions.has(i) ? 'braised-short-rib' : 'other-dish',
        index: i,
      });
    }
    seedJsonl(entries);

    const matches = auditLog.getAuditLogForRecipe('braised-short-rib');
    assert.equal(matches.length, 3);
    // Newest-first ordering — same contract as getAuditLogByAction.
    const indices = matches.map(m => m.index);
    assert.deepEqual(indices, [200, 100, 5]);
  });

  it('returns empty array when no entries match the slug', () => {
    seedJsonl([
      { id: 'a', action: 'recipe_edit', slug: 'foo', timestamp: '2026-01-01T00:00:00.000Z' },
    ]);
    const matches = auditLog.getAuditLogForRecipe('not-present');
    assert.deepEqual(matches, []);
  });
});

describe('exportAuditLog — same stream-read fix applies', () => {
  it('returns ALL date-range matches even when they sit before the last 5000 rows', () => {
    // Seed 6100 entries: 5 sparse January matches planted at row
    // indices 10, 50, 100, 250, 700, and 6095 February noise rows
    // filling the rest. The January matches sit before the legacy
    // 5000-entry tail window (rows 1100..6099), so pre-fix the
    // function — which routed through getRecentAuditLog(5000) — saw
    // zero January matches because none were inside that tail window.
    const entries = [];
    const janPositions = [10, 50, 100, 250, 700];
    const janSet = new Set(janPositions);
    let janCount = 0;
    for (let i = 0; i < 6100; i++) {
      if (janSet.has(i)) {
        // Stamp January matches with strictly increasing timestamps so
        // the newest-first ordering is deterministic for assertion.
        entries.push({
          id: `audit_jan_${i}`,
          timestamp: new Date(Date.UTC(2026, 0, 1, 0, janCount, 0)).toISOString(),
          action: 'recipe_edit',
          month: 'jan',
          index: i,
        });
        janCount += 1;
      } else {
        entries.push({
          id: `audit_feb_${i}`,
          timestamp: new Date(Date.UTC(2026, 1, 1, 0, 0, i % 60, (i * 17) % 1000)).toISOString(),
          action: 'noise_action',
          month: 'feb',
          index: i,
        });
      }
    }
    seedJsonl(entries);

    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 0, 31, 23, 59, 59));
    const matches = auditLog.exportAuditLog(start, end);
    assert.equal(matches.length, 5, 'all 5 January matches must surface (no silent 5000-cap drop)');
    const indices = matches.map(m => m.index);
    // Newest-first ordering — streamFilter reverses before return.
    // janCount increases with row index, so later rows have later
    // timestamps within January.
    assert.deepEqual(indices, [700, 250, 100, 50, 10]);
  });

  it('returns date-range matches in newest-first order', () => {
    // 5 entries spaced 1 hour apart; export bounds cover all 5; assert
    // the returned array is newest-first via direct ordered comparison.
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push({
        id: `audit_${i}`,
        timestamp: new Date(Date.UTC(2026, 2, 1, i, 0, 0)).toISOString(),
        action: 'recipe_edit',
        index: i,
      });
    }
    seedJsonl(entries);

    const start = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 2, 1, 23, 59, 59));
    const matches = auditLog.exportAuditLog(start, end);
    const indices = matches.map(m => m.index);
    assert.deepEqual(indices, [4, 3, 2, 1, 0]);
  });

  it('returns empty array when start > end (empty range)', () => {
    seedJsonl([
      { id: 'a', action: 'recipe_edit', timestamp: '2026-03-15T00:00:00.000Z' },
      { id: 'b', action: 'recipe_edit', timestamp: '2026-03-16T00:00:00.000Z' },
    ]);
    const start = new Date(Date.UTC(2026, 2, 31, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
    const matches = auditLog.exportAuditLog(start, end);
    assert.deepEqual(matches, []);
  });

  it('skips entries with misformed timestamps without crashing', () => {
    seedJsonl([
      { id: 'before', action: 'recipe_edit', timestamp: '2026-04-01T00:00:00.000Z' },
      { id: 'bad', action: 'recipe_edit', timestamp: 'not-a-date' },
      { id: 'after', action: 'recipe_edit', timestamp: '2026-04-02T00:00:00.000Z' },
    ]);
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
    const matches = auditLog.exportAuditLog(start, end);
    const ids = matches.map(m => m.id);
    // Newest-first; bad entry is dropped, valid neighbors preserved.
    assert.deepEqual(ids, ['after', 'before']);
  });

  it('returns empty array for a missing audit file', () => {
    // No seed → file does not exist.
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
    const matches = auditLog.exportAuditLog(start, end);
    assert.deepEqual(matches, []);
  });
});
