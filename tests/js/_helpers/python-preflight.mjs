/**
 * Verifies that .venv/bin/python3 exists and has openpyxl + xlrd installed.
 * Import and call requirePythonDeps() at the top of before/beforeEach in any
 * test that shells out to Python fixture builders or ingest scripts.
 * Export VENV_PYTHON and use it in place of the bare 'python3' string.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const VENV_PYTHON = path.join(ROOT, '.venv', 'bin', 'python3');

const SETUP_HINT = 'Run once to create the test venv:\n\n  bash scripts/install-python-deps.sh';

let checked = false;

export function requirePythonDeps() {
  if (checked) return;
  if (!existsSync(VENV_PYTHON)) {
    throw new Error(`Python test venv not found at .venv/bin/python3.\n${SETUP_HINT}`);
  }
  try {
    execSync(`"${VENV_PYTHON}" -c 'import openpyxl, xlrd'`, { stdio: 'pipe' });
  } catch {
    throw new Error(`openpyxl / xlrd missing in .venv.\n${SETUP_HINT}`);
  }
  checked = true;
}
