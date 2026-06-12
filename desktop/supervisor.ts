import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { logDir, crashLogPath, serverLogPath } from './paths.ts';

export interface Attempt {
  tsMs: number;
}

export type RestartDecision =
  | { action: 'restart'; delayMs: number }
  | { action: 'give_up' };

const BACKOFF_MS = [1000, 2000, 5000];
const WINDOW_MS = 60_000;

export function computeRestartDecision(
  recentAttempts: Attempt[],
  nowMs: number,
): RestartDecision {
  const inWindow = recentAttempts.filter(a => a.tsMs >= nowMs - WINDOW_MS);
  if (inWindow.length >= BACKOFF_MS.length) return { action: 'give_up' };
  return { action: 'restart', delayMs: BACKOFF_MS[inWindow.length]! };
}

const STDERR_RING_LINES = 200;

export interface SupervisorOptions {
  entryPath: string;     // absolute path to server-entry.cjs
  electronExecPath: string; // process.execPath inside Electron main
  env: NodeJS.ProcessEnv;
  onCrash?: (_info: CrashInfo) => void;
  onReady?: () => void;
}

export interface CrashInfo {
  ts: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  restartAttempt: number;
  stderrTail: string;
}

export class Supervisor {
  private child: ChildProcess | null = null;
  private attempts: Attempt[] = [];
  private stderrRing: string[] = [];
  private stoppedByUser = false;
  private logStream: fs.WriteStream | null = null;
  private opts: SupervisorOptions;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(opts: SupervisorOptions) {
    this.opts = opts;
    fs.mkdirSync(logDir(), { recursive: true });
  }

  start(): void {
    this.stoppedByUser = false;
    this.spawnOnce();
  }

  /** Sends shutdown IPC, waits up to 8s, then SIGTERM, then SIGKILL. */
  async shutdown(): Promise<void> {
    this.stoppedByUser = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.child) return;
    const c = this.child;

    const exited = new Promise<void>((resolve) => c.once('exit', () => resolve()));

    try { c.send({ type: 'shutdown' }); } catch { /* IPC closed */ }

    const sigterm = setTimeout(() => { try { c.kill('SIGTERM'); } catch {} }, 8000);
    const sigkill = setTimeout(() => {
      try { c.kill('SIGKILL'); } catch {}
      this.appendCrash({
        ts: new Date().toISOString(),
        exitCode: null,
        signal: 'SIGKILL',
        restartAttempt: this.attempts.length,
        stderrTail: this.stderrRing.join(''),
      });
    }, 10_000);

    await exited;
    clearTimeout(sigterm);
    clearTimeout(sigkill);
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private spawnOnce(): void {
    if (this.stoppedByUser) return;
    if (!this.logStream) {
      this.logStream = fs.createWriteStream(serverLogPath(), { flags: 'a' });
    }
    const child = fork(this.opts.entryPath, [], {
      env: this.opts.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execPath: this.opts.electronExecPath,
    });
    this.child = child;
    this.stderrRing = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      this.logStream?.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.logStream?.write(chunk);
      const s = chunk.toString('utf8');
      this.stderrRing.push(s);
      while (this.stderrRing.length > STDERR_RING_LINES) this.stderrRing.shift();
    });

    child.on('exit', (code, signal) => this.onChildExit(code, signal));
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null;
    if (this.stoppedByUser) return;

    const now = Date.now();
    this.attempts.push({ tsMs: now });

    const decision = computeRestartDecision(this.attempts, now);
    const info: CrashInfo = {
      ts: new Date(now).toISOString(),
      exitCode: code,
      signal,
      restartAttempt: this.attempts.length,
      stderrTail: this.stderrRing.join(''),
    };
    this.appendCrash(info);
    this.opts.onCrash?.(info);

    if (decision.action === 'give_up') return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnOnce();
    }, decision.delayMs);
  }

  private appendCrash(info: CrashInfo): void {
    try {
      fs.appendFileSync(crashLogPath(), JSON.stringify(info) + '\n');
    } catch (e) {
      console.error('[supervisor] failed to append crash log:', e);
    }
  }
}
