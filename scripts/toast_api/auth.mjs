// scripts/toast_api/auth.mjs
//
// Toast API OAuth2 client-credentials authentication. Owns:
//   - Reading TOAST_CLIENT_ID / TOAST_CLIENT_SECRET / TOAST_API_HOST from env
//   - POST /authentication/v1/authentication/login → bearer token + expiry
//   - On-disk token cache so we don't hit /login on every script invocation
//
// The cache file (data/toast-api/.token-cache.json) holds ONLY:
//   { accessToken, tokenType, expiresAt }   ← seconds-since-epoch
// We deliberately do NOT cache clientSecret. If the cache is leaked, the
// attacker has at most ~5 hours of bearer access (until the JWT expires)
// instead of indefinite credential reuse. The cache file is gitignored
// (data/toast-api/ is in .gitignore).
//
// Toast's published guidance is strict about secret handling:
//   - Env vars only, never committed, never logged.
// We mask the client secret from any debug output and never echo it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Env loading ─────────────────────────────────────────────────────

// Lightweight .env.local loader. We intentionally don't pull in `dotenv`
// (one more dep, one more gitignore footgun). Format: KEY=VALUE per line,
// `#` comments, blank lines ok. Quoted values get unquoted. Existing
// process.env entries WIN — so `TOAST_CLIENT_ID=… node script.mjs` still
// works.
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

// ── Cache helpers ───────────────────────────────────────────────────

const CACHE_DIR = path.join(REPO_ROOT, 'data', 'toast-api');
const CACHE_FILE = path.join(CACHE_DIR, '.token-cache.json');

// Refresh `EARLY_REFRESH_S` seconds BEFORE the token is due to expire,
// so a long-running batch job that started near expiry doesn't fail
// halfway through with a 401. 5 minutes is a comfortable margin.
const EARLY_REFRESH_S = 300;

function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.accessToken !== 'string' ||
      typeof parsed?.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Atomic-ish: write to .tmp + rename so a crash mid-write can't
  // corrupt the cache.
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entry, null, 2), 'utf8');
  fs.renameSync(tmp, CACHE_FILE);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// Pure helper, exported for tests. True iff the cached entry is unsafe
// to use right now.
export function isCacheStale(entry, now = nowSeconds()) {
  if (!entry) return true;
  if (typeof entry.expiresAt !== 'number') return true;
  return entry.expiresAt - EARLY_REFRESH_S <= now;
}

// ── Login ───────────────────────────────────────────────────────────

function maskSecret(s) {
  if (typeof s !== 'string' || s.length < 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

function readEnvOrThrow() {
  loadEnvLocalIfPresent();
  const host = (process.env.TOAST_API_HOST || '').trim();
  const clientId = (process.env.TOAST_CLIENT_ID || '').trim();
  const clientSecret = (process.env.TOAST_CLIENT_SECRET || '').trim();
  const missing = [];
  if (!host) missing.push('TOAST_API_HOST');
  if (!clientId) missing.push('TOAST_CLIENT_ID');
  if (!clientSecret) missing.push('TOAST_CLIENT_SECRET');
  if (missing.length) {
    throw new Error(
      `Toast credentials missing in .env.local: ${missing.join(', ')}. ` +
        `See scripts/toast_api/README.md for setup.`
    );
  }
  // Normalize the host: accept "ws-api.toasttab.com",
  // "https://ws-api.toasttab.com", or trailing-slash variants.
  const normalizedHost = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return { host: normalizedHost, clientId, clientSecret };
}

async function fetchToken({ host, clientId, clientSecret }) {
  const url = `https://${host}/authentication/v1/authentication/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId,
      clientSecret,
      userAccessType: 'TOAST_MACHINE_CLIENT',
    }),
  });
  // We never log the secret on failure. The status + a short body excerpt
  // is enough to debug 401 (bad credentials) vs 403 vs 5xx.
  if (!res.ok) {
    const excerpt = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(
      `Toast /authentication/login failed: HTTP ${res.status} ${res.statusText}` +
        (excerpt ? ` — ${excerpt}` : '') +
        ` (clientId=${maskSecret(clientId)})`
    );
  }
  const body = await res.json();
  const tok = body?.token;
  if (
    !tok ||
    typeof tok.accessToken !== 'string' ||
    typeof tok.expiresIn !== 'number'
  ) {
    throw new Error('Toast /authentication/login returned an unexpected shape');
  }
  return {
    accessToken: tok.accessToken,
    tokenType: tok.tokenType || 'Bearer',
    // Convert expiresIn (seconds remaining) → expiresAt (epoch seconds)
    // at the moment of the response. Slight clock-skew is fine.
    expiresAt: nowSeconds() + tok.expiresIn,
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Get a valid Toast bearer token. Returns the cached one if it's still
 * comfortably non-expired; otherwise hits /authentication/login to mint
 * a fresh token and persists it to the cache.
 *
 * Pass `{ force: true }` to skip the cache (useful for credential-rotation
 * verification or when a 401 indicates the cached token was revoked).
 */
export async function getAccessToken({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached && !isCacheStale(cached)) return cached;
  }
  const env = readEnvOrThrow();
  const fresh = await fetchToken(env);
  writeCache(fresh);
  return fresh;
}

/** Drop the on-disk cache. Useful for tests + the `--force-refresh` flag. */
export function clearTokenCache() {
  if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
}
