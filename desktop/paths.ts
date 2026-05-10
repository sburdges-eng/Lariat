import os from 'node:os';
import path from 'node:path';

const APP_NAME = 'Lariat';

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
