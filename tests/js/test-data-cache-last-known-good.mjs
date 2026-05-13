#!/usr/bin/env node
// Tests for GH #252 — last-known-good cache fallback in lib/data.ts.
//
// Pre-fix: when an ingest run partially flushed a JSON cache file (or
// someone hand-edited it into invalid syntax), lib/data::load<T> returned
// null. Every getter has a `|| []` / `|| {}` fallback, so the app
// silently flipped to "no allergens tagged" / "no stations" / "no
// recipes" until the file was repaired. That degrade-path is fine for
// non-regulated surfaces; for allergen + food-safety it is hostile —
// the cook sees a blank Big-9 column on the dish that triggers the
// anaphylaxis and sends it out.
//
// Post-fix: parse failures DO NOT clobber the in-memory cache. If a
// prior-good entry exists, lib/data continues to serve it AND registers
// the file in `getCacheHealth().degraded` so the freshness banner /
// /api/data/health can surface "your cache is broken — re-ingest" to
// the operator. Only if no prior-good entry exists do we fall back to
// the legacy null/empty path.
//
// Run:
//   node --experimental-strip-types --test \
//        tests/js/test-data-cache-last-known-good.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const data = await import('../../lib/data.ts');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-data-cache-'));

before(() => {
  data.setCacheRootForTest(TMP_DIR);
});

after(() => {
  data.setCacheRootForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  // Each test starts from a known-empty cache view.
  data.setCacheRootForTest(TMP_DIR);
});

function writeFixture(name, content, opts = {}) {
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  if (opts.mtimeMs !== undefined) {
    fs.utimesSync(p, opts.mtimeMs / 1000, opts.mtimeMs / 1000);
  }
  return p;
}

// ── Happy path: prior-good entry served, no degraded state ───────────

describe('lib/data.load — happy path (#252)', () => {
  it('parses a valid stations.json, marks no files as degraded', () => {
    writeFixture('stations.json', JSON.stringify([
      { id: 'grill', name: 'Grill', line: 'hot', line_check_key: 'grill_temp_check' },
    ]));
    const stations = data.getStations();
    assert.equal(stations.length, 1);
    assert.equal(stations[0].id, 'grill');
    assert.deepEqual(data.getCacheHealth(), { degraded: [] });
  });
});

// ── The audit fix (allergen_matrix.json) ─────────────────────────────

describe('lib/data.load — last-known-good fallback (#252)', () => {
  it('serves the prior-good allergen matrix after the file is corrupted mid-session', () => {
    // 1. Seed a valid allergen matrix and read it once so `_mem` holds
    //    the parse.
    writeFixture('allergen_matrix.json', JSON.stringify({
      'caesar_salad': [
        { ingredient: 'parmesan', big9: ['milk'] },
        { ingredient: 'anchovy', big9: ['fish'] },
      ],
    }));
    const good = data.getAllergenMatrix();
    assert.equal(good['caesar_salad'].length, 2, 'pre-corruption read should see both ingredients');

    // 2. Corrupt the on-disk file. Bump mtime so the load path treats
    //    it as a cache miss and tries to re-parse. Without the #252 fix
    //    this would silently flip the matrix to {}.
    writeFixture('allergen_matrix.json', '{ this is not json,', {
      mtimeMs: Date.now() + 10_000,
    });
    const afterBreak = data.getAllergenMatrix();
    assert.equal(
      afterBreak['caesar_salad'].length,
      2,
      'last-known-good fallback should keep the prior allergen tags visible',
    );

    // 3. Operator can SEE the broken state via getCacheHealth.
    const health = data.getCacheHealth();
    assert.equal(health.degraded.length, 1);
    assert.equal(health.degraded[0].name, 'allergen_matrix.json');
    assert.equal(health.degraded[0].hasLastKnownGood, true);
    assert.match(health.degraded[0].reason, /JSON|Unexpected/i);
  });

  it('clears the degraded flag once the file is repaired', () => {
    writeFixture('allergen_matrix.json', JSON.stringify({ a: [{ ingredient: 'x' }] }));
    data.getAllergenMatrix();
    writeFixture('allergen_matrix.json', '{ broken,', { mtimeMs: Date.now() + 10_000 });
    data.getAllergenMatrix();
    assert.equal(data.getCacheHealth().degraded.length, 1);

    // Repair: write valid JSON with a fresh mtime so the cache-miss
    // path runs the parser again, which should succeed and clear the
    // degraded flag.
    writeFixture('allergen_matrix.json', JSON.stringify({ b: [{ ingredient: 'y' }] }), {
      mtimeMs: Date.now() + 20_000,
    });
    const repaired = data.getAllergenMatrix();
    assert.deepEqual(Object.keys(repaired), ['b']);
    assert.deepEqual(data.getCacheHealth(), { degraded: [] });
  });

  it('falls back to the legacy null/empty path when there is no prior good', () => {
    // No in-memory cache entry exists yet for this file — write
    // garbage straight to disk and verify load returns the empty
    // fallback BUT also registers the degraded state so ops still
    // see it.
    writeFixture('recipes.json', '<<<not JSON>>>');
    const recipes = data.getRecipes();
    assert.deepEqual(recipes, [], 'getRecipes() must fall back to [] when no prior parse exists');
    const health = data.getCacheHealth();
    assert.ok(health.degraded.find((d) => d.name === 'recipes.json' && d.hasLastKnownGood === false));
  });

  it('does not spam logs on repeat reads of the same broken mtime', () => {
    // The logging gate is "one warning per (name, broken mtime)" — call
    // the getter several times in a row and make sure the broken-state
    // bookkeeping doesn't multiply degraded entries.
    writeFixture('allergen_matrix.json', JSON.stringify({ a: [] }));
    data.getAllergenMatrix();
    writeFixture('allergen_matrix.json', '{ bad,', { mtimeMs: Date.now() + 10_000 });
    data.getAllergenMatrix();
    data.getAllergenMatrix();
    data.getAllergenMatrix();
    assert.equal(data.getCacheHealth().degraded.length, 1);
  });
});
