import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Supervisor } from '../supervisor.ts';
import { crashLogPath } from '../paths.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('supervisor records 3 crashes then gives up on a permanently-broken entry', { timeout: 60_000 }, async (t) => {
  // Move existing crash log out of the way so we can count clean
  const crashFile = crashLogPath();
  const backup = crashFile + '.bak.' + Date.now();
  if (fs.existsSync(crashFile)) fs.renameSync(crashFile, backup);
  t.after(() => {
    if (fs.existsSync(backup)) {
      try { fs.unlinkSync(crashFile); } catch {}
      fs.renameSync(backup, crashFile);
    }
  });

  const entry = path.resolve(__dirname, 'fixtures', 'server-entry-broken.cjs');
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-crash-'));

  let crashCount = 0;
  const sup = new Supervisor({
    entryPath: entry,
    electronExecPath: process.execPath,
    env: { ...process.env, LARIAT_DATA_DIR: tmpData, PORT: '3198' },
    onCrash: () => { crashCount++; },
  });
  sup.start();

  // Wait long enough for backoff sequence: 1s + 2s + 5s = 8s + spawn time
  await new Promise(r => setTimeout(r, 15_000));
  await sup.shutdown();

  assert.equal(crashCount, 3, 'expected exactly 3 crash callbacks');

  const lines = fs.readFileSync(crashFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3, 'expected 3 lines in crashes.jsonl');
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.notEqual(obj.exitCode, 0, 'crash should have non-zero exitCode');
    assert.match(obj.stderrTail, /intentional crash/);
  }

  fs.rmSync(tmpData, { recursive: true, force: true });
});
