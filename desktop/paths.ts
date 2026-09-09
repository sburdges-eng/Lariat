import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const APP_NAME = 'Lariat';

/**
 * True only when the file exists, is a regular file, and starts with the
 * 16-byte SQLite header. Guards the wizard's "use existing data in place"
 * offer from ever adopting a directory, an empty stub, or a non-SQLite file
 * as "your existing Lariat data". (Restored from the shipped 2026-07-09
 * cockpit build, where this hardening existed compiled-only.)
 */
export function isSqliteDatabase(filePath: string): boolean {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 16) return false;
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, header.length, 0);
    return header.equals(Buffer.from('SQLite format 3\0', 'utf8'));
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Probe the canonical dev-tree locations for a real Lariat database so the
 * first-run wizard can offer "use it in place". Candidates are ordered by
 * where current work actually happens; any other location the user picks via
 * "Choose…". Returns the absolute parent dir (suitable for LARIAT_DATA_DIR)
 * or null.
 */
export function detectExistingDbDir(homeDir: string = os.homedir()): string | null {
  const candidates = [
    path.join(homeDir, 'Lariat', 'Dev', 'Lariat', 'data', 'lariat.db'),
    path.join(homeDir, 'lariat_dev', 'Lariat', 'data', 'lariat.db'),
    path.join(homeDir, 'Dev', 'hospitality', 'Lariat', 'data', 'lariat.db'),
    path.join(homeDir, 'Dev', 'Lariat', 'data', 'lariat.db'),
  ];
  for (const candidate of candidates) {
    if (isSqliteDatabase(candidate)) return path.dirname(candidate);
  }
  return null;
}

function appSupportDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
}

export function settingsPath(): string {
  return path.join(appSupportDir(), 'settings.json');
}

export function dataDirDefault(): string {
  return path.join(appSupportDir(), 'data');
}

export function logDir(): string {
  return path.join(os.homedir(), 'Library', 'Logs', APP_NAME);
}

export function crashLogPath(): string {
  return path.join(logDir(), 'crashes.jsonl');
}

export function serverLogPath(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return path.join(logDir(), `server-${yyyy}-${mm}-${dd}.log`);
}
