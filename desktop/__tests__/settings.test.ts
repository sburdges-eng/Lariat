import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, saveSettings, settingsToChildEnv, validateSettings, type Settings } from '../settings.ts';

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

test('validateSettings round-trips cloudBridgeUrl + cloudBridgeSecret', () => {
  const s = validateSettings({
    dataDir: '/x',
    port: 3000,
    cloudBridgeUrl: 'https://api.lariat.example',
    cloudBridgeSecret: 'hmac-shared-secret',
  });
  assert.equal(s?.cloudBridgeUrl, 'https://api.lariat.example');
  assert.equal(s?.cloudBridgeSecret, 'hmac-shared-secret');
});

test('validateSettings drops non-string cloudBridge fields', () => {
  const s = validateSettings({
    dataDir: '/x',
    port: 3000,
    cloudBridgeUrl: 42,
    cloudBridgeSecret: { nested: 'no' },
  });
  assert.equal(s?.cloudBridgeUrl, undefined);
  assert.equal(s?.cloudBridgeSecret, undefined);
});

test('settingsToChildEnv emits LARIAT_DATA_DIR always', () => {
  const env = settingsToChildEnv({ dataDir: '/x', port: 3000 });
  assert.equal(env.LARIAT_DATA_DIR, '/x');
});

test('settingsToChildEnv omits optional vars when settings are unset', () => {
  const env = settingsToChildEnv({ dataDir: '/x', port: 3000 });
  assert.equal(env.LARIAT_DATA_ROOT, undefined);
  assert.equal(env.LARIAT_PYTHON, undefined);
  assert.equal(env.LARIAT_OLLAMA_URL, undefined);
  assert.equal(env.LARIAT_CLOUD_BRIDGE_URL, undefined);
  assert.equal(env.LARIAT_CLOUD_BRIDGE_SECRET, undefined);
});

test('settingsToChildEnv emits cloud-bridge env vars when set', () => {
  const env = settingsToChildEnv({
    dataDir: '/x',
    port: 3000,
    cloudBridgeUrl: 'https://api.lariat.example',
    cloudBridgeSecret: 'hmac-shared-secret',
  });
  assert.equal(env.LARIAT_CLOUD_BRIDGE_URL, 'https://api.lariat.example');
  assert.equal(env.LARIAT_CLOUD_BRIDGE_SECRET, 'hmac-shared-secret');
});

test('settingsToChildEnv emits each optional var independently', () => {
  // Only cloudBridgeSecret is set; the URL stays unset. The drainer's
  // isCloudBridgeConfigured() requires BOTH so the runtime treats this
  // as "not configured" — but settingsToChildEnv itself is a pure
  // mapping and emits whatever's actually set.
  const env = settingsToChildEnv({
    dataDir: '/x',
    port: 3000,
    cloudBridgeSecret: 'only-secret',
  });
  assert.equal(env.LARIAT_CLOUD_BRIDGE_URL, undefined);
  assert.equal(env.LARIAT_CLOUD_BRIDGE_SECRET, 'only-secret');
});
