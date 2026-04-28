// scripts/sevenshifts_api/auth.mjs
//
// 7shifts API authentication. 7shifts uses Personal Access Tokens (PATs)
// for company-level integrations — simpler than Toast's OAuth2 client-
// credentials flow because the token doesn't expire on its own and we
// don't have to mint new ones per-script.
//
// Env contract (loaded from .env.local — same lightweight loader as
// scripts/toast_api/auth.mjs::loadEnvLocalIfPresent):
//   SEVENSHIFTS_API_TOKEN     — required. Company PAT, generated in the
//                               7shifts admin UI under Integrations →
//                               Personal Access Tokens. Treat as a secret.
//   SEVENSHIFTS_COMPANY_ID    — required. Numeric/uuid string from the
//                               7shifts URL bar when logged in.
//   SEVENSHIFTS_API_HOST      — optional. Default 'api.7shifts.com'.
//
// We mask the token in any debug output and never log it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Same shape as scripts/toast_api/auth.mjs — duplicated here on purpose.
// Adding a shared lib pulls scripts/lib into the runtime path, which we
// keep clean for parity-tested Python ↔ JS modules only.
function loadEnvLocalIfPresent() {
  const envPath = path.join(REPO_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function maskSecret(s) {
  if (typeof s !== 'string' || s.length < 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

/**
 * Read + validate 7shifts credentials. Returns
 *   { host, token, companyId, maskedToken }
 * Throws a clear "missing X" error if any required env is unset.
 *
 * Tests can call this with `process.env` already populated; production
 * code should let it pull from .env.local.
 */
export function readSevenShiftsCreds() {
  loadEnvLocalIfPresent();
  const host = (process.env.SEVENSHIFTS_API_HOST || 'api.7shifts.com').trim();
  const token = (process.env.SEVENSHIFTS_API_TOKEN || '').trim();
  const companyId = (process.env.SEVENSHIFTS_COMPANY_ID || '').trim();
  const missing = [];
  if (!token) missing.push('SEVENSHIFTS_API_TOKEN');
  if (!companyId) missing.push('SEVENSHIFTS_COMPANY_ID');
  if (missing.length) {
    throw new Error(
      `7shifts credentials missing in .env.local: ${missing.join(', ')}. ` +
        `See scripts/sevenshifts_api/README.md for setup.`,
    );
  }
  const normalizedHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { host: normalizedHost, token, companyId, maskedToken: maskSecret(token) };
}

/** Build the standard Authorization header value for 7shifts. */
export function bearerHeader(token) {
  return `Bearer ${token}`;
}
