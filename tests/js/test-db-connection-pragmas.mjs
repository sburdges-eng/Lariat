#!/usr/bin/env node
// Connection-level SQLite PRAGMA coverage for lib/db.ts.
// Run: node --experimental-strip-types --test tests/js/test-db-connection-pragmas.mjs

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-db-pragmas-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('lib/db connection PRAGMAs', () => {
  it('runs in WAL mode for concurrent kitchen reads and writes', () => {
    const [{ journal_mode: journalMode }] = db.pragma('journal_mode');
    assert.equal(journalMode, 'wal');
  });

  it('keeps full synchronous durability for financial and personnel writes', () => {
    const [{ synchronous }] = db.pragma('synchronous');
    assert.equal(synchronous, 2, 'SQLite synchronous=FULL should report 2');
  });

  it('enforces foreign keys on the shared app connection', () => {
    const [{ foreign_keys: foreignKeys }] = db.pragma('foreign_keys');
    assert.equal(foreignKeys, 1);
  });

  it('bounds WAL growth with the configured auto-checkpoint threshold', () => {
    const [{ wal_autocheckpoint: walAutoCheckpoint }] = db.pragma('wal_autocheckpoint');
    assert.equal(walAutoCheckpoint, 1000);
  });
});
