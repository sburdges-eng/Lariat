import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { settingsPath, logDir, crashLogPath, dataDirDefault, detectExistingDbDir } from '../paths.ts';

function makeSqliteFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from('SQLite format 3\0', 'utf8'),
    Buffer.alloc(128),
  ]));
}

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

test('detectExistingDbDir prefers canonical hospitality/Lariat data over legacy placeholders', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-home-'));
  const legacyDb = path.join(home, 'Dev', 'Lariat', 'data', 'lariat.db');
  const canonicalDb = path.join(home, 'Dev', 'hospitality', 'Lariat', 'data', 'lariat.db');
  fs.mkdirSync(path.dirname(legacyDb), { recursive: true });
  fs.writeFileSync(legacyDb, '');
  makeSqliteFile(canonicalDb);

  try {
    assert.equal(detectExistingDbDir(home), path.dirname(canonicalDb));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('detectExistingDbDir falls back to a valid legacy Lariat database', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-home-'));
  const legacyDb = path.join(home, 'Dev', 'Lariat', 'data', 'lariat.db');
  makeSqliteFile(legacyDb);

  try {
    assert.equal(detectExistingDbDir(home), path.dirname(legacyDb));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('detectExistingDbDir ignores empty or non-SQLite files', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-home-'));
  const canonicalDb = path.join(home, 'Dev', 'hospitality', 'Lariat', 'data', 'lariat.db');
  const legacyDb = path.join(home, 'Dev', 'Lariat', 'data', 'lariat.db');
  fs.mkdirSync(path.dirname(canonicalDb), { recursive: true });
  fs.mkdirSync(path.dirname(legacyDb), { recursive: true });
  fs.writeFileSync(canonicalDb, 'not sqlite');
  fs.writeFileSync(legacyDb, '');

  try {
    assert.equal(detectExistingDbDir(home), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
