import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// The data dir is resolved ONCE, at module load, inside lib/db/connection.ts
// (lib/db.ts re-exports the hook). Cache-busting the barrel does not re-run
// that resolution — the barrel's own `from './db/connection.ts'` specifier
// carries no query string, so it keeps hitting the ESM module cache. So bust
// the module that owns the constant, the same way test-data-cache-data-dir.mjs
// busts lib/data.ts.
const CONNECTION = '../../lib/db/connection.ts';

test('lib/db.ts uses process.cwd()/data when LARIAT_DATA_DIR is unset', async () => {
  delete process.env.LARIAT_DATA_DIR;
  const dbModule = await import(`${CONNECTION}?cb=${Date.now()}`);
  const { _resolveDbPathForTest } = dbModule;
  assert.equal(
    _resolveDbPathForTest(),
    path.join(process.cwd(), 'data', 'lariat.db'),
  );
});

test('lib/db.ts uses LARIAT_DATA_DIR/lariat.db when env is set', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-data-dir-'));
  process.env.LARIAT_DATA_DIR = tmp;
  try {
    const dbModule = await import(`${CONNECTION}?cb=${Date.now()}`);
    const { _resolveDbPathForTest } = dbModule;
    assert.equal(_resolveDbPathForTest(), path.join(tmp, 'lariat.db'));
  } finally {
    delete process.env.LARIAT_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The barrel must keep exposing the same hook, so the public `@/lib/db`
// surface stays covered by the two tests above.
test('lib/db.ts re-exports the data-dir hook from lib/db/connection.ts', async () => {
  const barrel = await import('../../lib/db.ts');
  const connection = await import('../../lib/db/connection.ts');
  assert.equal(typeof barrel._resolveDbPathForTest, 'function');
  assert.equal(barrel._resolveDbPathForTest, connection._resolveDbPathForTest);
  assert.equal(barrel._resolveDbPathForTest(), connection._resolveDbPathForTest());
});
