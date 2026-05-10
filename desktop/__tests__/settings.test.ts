import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, saveSettings, validateSettings, type Settings } from '../settings.ts';

function makeTmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-settings-'));
  return path.join(dir, 'settings.json');
}

test('readSettings returns null when file missing', () => {
  const p = makeTmpFile();
  assert.equal(readSettings(p), null);
});

test('readSettings returns null when JSON is malformed', () => {
  const p = makeTmpFile();
  fs.writeFileSync(p, '{not valid json');
  assert.equal(readSettings(p), null);
});

test('readSettings returns null when shape fails validation', () => {
  const p = makeTmpFile();
  fs.writeFileSync(p, JSON.stringify({ dataDir: 42 }));
  assert.equal(readSettings(p), null);
});

test('saveSettings + readSettings round-trips', () => {
  const p = makeTmpFile();
  const s: Settings = {
    dataDir: '/tmp/lariat-data',
    pythonPath: '/tmp/.venv/bin/python3',
    datapackDir: '/Volumes/SSD/data',
    ollamaUrl: 'http://127.0.0.1:11434',
    port: 3000,
  };
  saveSettings(p, s);
  assert.deepEqual(readSettings(p), s);
});

test('saveSettings writes atomically (temp file gone after success)', () => {
  const p = makeTmpFile();
  saveSettings(p, { dataDir: '/x', port: 3000 });
  const tempLeft = fs.readdirSync(path.dirname(p)).filter(f => f.includes('.tmp'));
  assert.deepEqual(tempLeft, []);
});

test('validateSettings accepts minimal settings (dataDir + port only)', () => {
  assert.deepEqual(
    validateSettings({ dataDir: '/x', port: 3000 }),
    { dataDir: '/x', port: 3000 },
  );
});

test('validateSettings rejects missing dataDir', () => {
  assert.equal(validateSettings({ port: 3000 }), null);
});

test('validateSettings rejects non-integer port', () => {
  assert.equal(validateSettings({ dataDir: '/x', port: 'three' }), null);
});

test('validateSettings rejects port out of range', () => {
  assert.equal(validateSettings({ dataDir: '/x', port: 70000 }), null);
});
