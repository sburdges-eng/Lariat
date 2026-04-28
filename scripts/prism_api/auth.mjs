// scripts/prism_api/auth.mjs
//
// Prism.fm API authentication. Status: SCAFFOLD.
//
// Prism.fm is a private API — there's no public developer portal as of
// the time of this writing. To wire this adapter we need:
//
//   1. An API key from your Prism CSM (account manager).
//   2. The exact base URL Prism gives you (production vs. sandbox; some
//      tenants are on api.prism.fm, others on a tenant-specific host).
//   3. Their event/calendar endpoint paths (likely something under
//      /v1/events or /api/events — confirm before relying on a guess).
//
// This module reads creds from .env.local and validates that they exist.
// The actual request shape lives in client.mjs; we keep the auth layer
// trivial here so a credential-less environment fails with a clean
// "you need to populate .env.local" message rather than a network error.
//
// Required env:
//   PRISM_API_KEY     — Prism-issued API key. Treat as a secret.
//   PRISM_API_HOST    — Base URL host (no scheme). Confirm with Prism.
// Optional env:
//   PRISM_VENUE_ID    — If your Prism tenant scopes events by venue and
//                       requires the ID in the path or query.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

export function readPrismCreds() {
  loadEnvLocalIfPresent();
  const host = (process.env.PRISM_API_HOST || '').trim();
  const apiKey = (process.env.PRISM_API_KEY || '').trim();
  const venueId = (process.env.PRISM_VENUE_ID || '').trim();
  const missing = [];
  if (!host) missing.push('PRISM_API_HOST');
  if (!apiKey) missing.push('PRISM_API_KEY');
  if (missing.length) {
    throw new Error(
      `Prism.fm credentials missing in .env.local: ${missing.join(', ')}. ` +
        `See scripts/prism_api/README.md — Prism's API is private; you need ` +
        `your CSM to issue a key before this adapter can authenticate.`,
    );
  }
  const normalizedHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    host: normalizedHost,
    apiKey,
    venueId: venueId || null,
    maskedKey: maskSecret(apiKey),
  };
}
