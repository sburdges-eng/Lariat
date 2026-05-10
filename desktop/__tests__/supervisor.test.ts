import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { computeRestartDecision, type Attempt } from '../supervisor.ts';

const NOW = 1_000_000;

test('first failure schedules restart at 1s', () => {
  const decision = computeRestartDecision([], NOW);
  assert.deepEqual(decision, { action: 'restart', delayMs: 1000 });
});

test('second failure (within 60s) schedules at 2s', () => {
  const attempts: Attempt[] = [{ tsMs: NOW - 5_000 }];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 2000 },
  );
});

test('third failure (within 60s) schedules at 5s', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 10_000 },
    { tsMs: NOW - 5_000 },
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 5000 },
  );
});

test('fourth failure within 60s gives up', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 30_000 },
    { tsMs: NOW - 20_000 },
    { tsMs: NOW - 10_000 },
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'give_up' },
  );
});

test('attempts older than 60s do not count toward give-up', () => {
  const attempts: Attempt[] = [
    { tsMs: NOW - 90_000 },  // expired
    { tsMs: NOW - 80_000 },  // expired
    { tsMs: NOW - 70_000 },  // expired
    { tsMs: NOW - 5_000 },   // counts as the only recent
  ];
  assert.deepEqual(
    computeRestartDecision(attempts, NOW),
    { action: 'restart', delayMs: 2000 },
  );
});

test('shutdown during restart backoff does not spawn a zombie child', { timeout: 10_000 }, async (t) => {
  // We need fs + path + os + url for the broken-fixture path
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const url = await import('node:url');
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

  const { Supervisor } = await import('../supervisor.ts');
  const { crashLogPath } = await import('../paths.ts');

  // Back up real crash log if any
  const cf = crashLogPath();
  const backup = cf + '.race-bak.' + Date.now();
  if (fs.existsSync(cf)) fs.renameSync(cf, backup);
  t.after(() => {
    try { if (fs.existsSync(cf)) fs.unlinkSync(cf); } catch {}
    if (fs.existsSync(backup)) fs.renameSync(backup, cf);
  });

  const entry = path.resolve(__dirname, 'fixtures', 'server-entry-broken.cjs');
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-race-'));

  let crashCount = 0;
  const sup = new Supervisor({
    entryPath: entry,
    electronExecPath: process.execPath,
    env: { ...process.env, LARIAT_DATA_DIR: tmpData, PORT: '3197' },
    onCrash: () => { crashCount++; },
  });
  sup.start();

  // Wait for first crash + initial 1s backoff to begin scheduling
  await new Promise(r => setTimeout(r, 1500));
  await sup.shutdown();

  // Wait past when the queued respawn would have fired (delayMs=1000)
  await new Promise(r => setTimeout(r, 2000));

  // Should be exactly 1 crash (the initial one). Without the fix this can
  // grow to 2+ as the queued respawn fires during/after shutdown.
  assert.equal(crashCount, 1, 'expected exactly 1 crash, no respawn after shutdown');
  fs.rmSync(tmpData, { recursive: true, force: true });
});
