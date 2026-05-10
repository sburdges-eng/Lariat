import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

test('lib/db.ts uses process.cwd()/data when LARIAT_DATA_DIR is unset', async () => {
  delete process.env.LARIAT_DATA_DIR;
  const dbModule = await import(`../../lib/db.ts?cb=${Date.now()}`);
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
    const dbModule = await import(`../../lib/db.ts?cb=${Date.now()}`);
    const { _resolveDbPathForTest } = dbModule;
    assert.equal(_resolveDbPathForTest(), path.join(tmp, 'lariat.db'));
  } finally {
    delete process.env.LARIAT_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
