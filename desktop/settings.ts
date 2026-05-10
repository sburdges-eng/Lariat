import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Settings {
  dataDir: string;
  port: number;                  // 1024–65535
  datapackDir?: string;          // populates LARIAT_DATA_ROOT
  pythonPath?: string;           // populates LARIAT_PYTHON
  ollamaUrl?: string;            // defaults to http://127.0.0.1:11434 if absent
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1024 && v <= 65535;
}

/**
 * Validates an unknown blob against the Settings shape. Returns the
 * normalized object on success, null on any structural error. Optional
 * fields are dropped from the output if absent or non-string.
 */
export function validateSettings(input: unknown): Settings | null {
  if (input === null || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (!isString(o.dataDir)) return null;
  if (!isPort(o.port)) return null;
  const out: Settings = { dataDir: o.dataDir, port: o.port };
  if (isString(o.datapackDir)) out.datapackDir = o.datapackDir;
  if (isString(o.pythonPath)) out.pythonPath = o.pythonPath;
  if (isString(o.ollamaUrl)) out.ollamaUrl = o.ollamaUrl;
  return out;
}

export function readSettings(filePath: string): Settings | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateSettings(parsed);
}

/**
 * Atomic write: serialize to a sibling .tmp.<rand> file then rename
 * (POSIX rename is atomic on the same filesystem). On any error the
 * .tmp file is removed and the exception propagates.
 */
export function saveSettings(filePath: string, settings: Settings): void {
  const validated = validateSettings(settings);
  if (!validated) {
    throw new Error('saveSettings called with invalid settings');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}
