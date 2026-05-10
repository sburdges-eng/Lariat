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
