import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, '..', 'server-entry.cjs');
const PORT = 3199;

function waitForHttp(url: string, timeoutMs = 30_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  return (async function loop(): Promise<Response> {
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url);
        if (r.ok) return r;
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`timed out waiting for ${url}`);
  })();
}

test('server-entry.cjs boots Next and serves /api/discover', { timeout: 60_000 }, async (t) => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-srv-'));
  const child: ChildProcess = fork(ENTRY, [], {
    env: {
      ...process.env,
      LARIAT_DATA_DIR: tmpData,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
    },
    silent: true,
  });

  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM');
    fs.rmSync(tmpData, { recursive: true, force: true });
  });

  const r = await waitForHttp(`http://127.0.0.1:${PORT}/api/discover`);
  const body = await r.json();
  assert.equal(typeof body.location_id, 'string');
  assert.equal(typeof body.started_at, 'string');
});
