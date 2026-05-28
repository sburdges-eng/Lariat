// Pin that lib/data.ts honors LARIAT_DATA_DIR in lockstep with lib/db.ts.
//
// Pre-fix, lib/data.ts hard-coded `process.cwd()/data/cache` while lib/db.ts
// resolved SQLite via LARIAT_DATA_DIR. On a relocated install, SQLite went to the new
// location but JSON cache silently kept reading from cwd — the
// "stations.json looks stale even after re-ingest" split-brain.
//
// Run: node --experimental-strip-types --test tests/js/test-data-cache-data-dir.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('lib/data.ts getStations() reads from LARIAT_DATA_DIR/cache when env is set', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-data-cache-'));
  fs.mkdirSync(path.join(tmp, 'cache'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'cache', 'stations.json'),
    JSON.stringify([
      { id: 'saute', name: 'Sauté', line: 'BOH', line_check_key: null },
    ]),
  );
  process.env.LARIAT_DATA_DIR = tmp;
  try {
    const mod = await import(`../../lib/data.ts?cb=${Date.now()}`);
    const stations = mod.getStations();
    assert.equal(stations.length, 1);
    assert.equal(stations[0].id, 'saute');
    assert.equal(stations[0].name, 'Sauté');
  } finally {
    delete process.env.LARIAT_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('lib/data.ts returns the unset-env empty fallback when LARIAT_DATA_DIR has no cache dir', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-data-cache-empty-'));
  // Intentionally do NOT create tmp/cache — getters should degrade to []/{}.
  process.env.LARIAT_DATA_DIR = tmp;
  try {
    const mod = await import(`../../lib/data.ts?cb=${Date.now()}`);
    assert.deepEqual(mod.getStations(), []);
    assert.deepEqual(mod.getRecipes(), []);
  } finally {
    delete process.env.LARIAT_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
