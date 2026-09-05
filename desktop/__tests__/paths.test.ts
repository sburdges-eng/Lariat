import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { settingsPath, logDir, crashLogPath, dataDirDefault } from '../paths.ts';

test('settingsPath lives under ~/Library/Application Support/Lariat', () => {
  const p = settingsPath();
  assert.equal(
    p,
    path.join(os.homedir(), 'Library', 'Application Support', 'Lariat', 'settings.json'),
  );
});

test('logDir lives under ~/Library/Logs/Lariat', () => {
  assert.equal(logDir(), path.join(os.homedir(), 'Library', 'Logs', 'Lariat'));
});

test('crashLogPath is logDir/crashes.jsonl', () => {
  assert.equal(crashLogPath(), path.join(logDir(), 'crashes.jsonl'));
});

test('dataDirDefault lives under ~/Library/Application Support/Lariat/data', () => {
  assert.equal(
    dataDirDefault(),
    path.join(os.homedir(), 'Library', 'Application Support', 'Lariat', 'data'),
  );
});

// --- detectExistingDbDir / isSqliteDatabase (restored 2026-07-09 hardening) ---

import fs from 'node:fs';
import { isSqliteDatabase, detectExistingDbDir } from '../paths.ts';

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-paths-'));
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'utf8');

test('detectExistingDbDir returns null when nothing exists', () => {
  assert.equal(detectExistingDbDir(tmpHome()), null);
});

test('detectExistingDbDir rejects a non-SQLite file', () => {
  const home = tmpHome();
  const dbPath = path.join(home, 'Dev', 'Lariat', 'data', 'lariat.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, 'this is not a database, it is a text file');
  assert.equal(detectExistingDbDir(home), null);
});

test('detectExistingDbDir rejects an empty stub', () => {
  const home = tmpHome();
  const dbPath = path.join(home, 'Dev', 'Lariat', 'data', 'lariat.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, '');
  assert.equal(detectExistingDbDir(home), null);
});

test('detectExistingDbDir accepts a real SQLite file and returns its dir', () => {
  const home = tmpHome();
  const dbPath = path.join(home, 'Dev', 'hospitality', 'Lariat', 'data', 'lariat.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.concat([SQLITE_HEADER, Buffer.alloc(64)]));
  assert.equal(detectExistingDbDir(home), path.dirname(dbPath));
});

test('detectExistingDbDir prefers ~/Lariat/Dev/Lariat over the legacy checkouts', () => {
  const home = tmpHome();
  for (const base of [['Lariat', 'Dev', 'Lariat'], ['lariat_dev', 'Lariat'], ['Dev', 'Lariat']]) {
    const dbPath = path.join(home, ...base, 'data', 'lariat.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, Buffer.concat([SQLITE_HEADER, Buffer.alloc(64)]));
  }
  assert.equal(
    detectExistingDbDir(home),
    path.join(home, 'Lariat', 'Dev', 'Lariat', 'data'),
  );
});

test('detectExistingDbDir still finds the legacy ~/lariat_dev checkout', () => {
  const home = tmpHome();
  const dbPath = path.join(home, 'lariat_dev', 'Lariat', 'data', 'lariat.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.concat([SQLITE_HEADER, Buffer.alloc(64)]));
  assert.equal(detectExistingDbDir(home), path.dirname(dbPath));
});

test('isSqliteDatabase is false for a directory', () => {
  const home = tmpHome();
  assert.equal(isSqliteDatabase(home), false);
});
