// scripts/sevenshifts_api/client.mjs
//
// Thin HTTP client over fetch() for the 7shifts v2 REST API. The shape
// mirrors scripts/toast_api/client.mjs — auth + request helper +
// pagination iterator — but adapted for 7shifts conventions:
//
//   - Bearer PAT auth (one header, no token-mint roundtrip).
//   - Cursor-based pagination via `meta.next_cursor` in the response
//     envelope. Pages until next_cursor is null/empty.
//   - Endpoints documented at https://developers.7shifts.com/.
//
// All requests are scoped to one company (companyId from creds). The
// caller passes an endpoint relative path like 'users' or 'shifts'; we
// stitch on '/v2/company/{companyId}/{path}' internally.

import { readSevenShiftsCreds, bearerHeader } from './auth.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_RETRIES = 5;
const MAX_RATE_LIMIT_DELAY_MS = 30_000;

function maskUrl(u) {
  // Scrub query params that might carry semi-sensitive cursor or
  // company-id info from logs. We log the path only.
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return u;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function clampDelay(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(Math.ceil(ms), MAX_RATE_LIMIT_DELAY_MS);
}

function rateLimitDelayMs(headers, attempt) {
  const retryAfter = responseHeader(headers, 'Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const secondsDelay = clampDelay(seconds * 1000);
    if (secondsDelay != null) return secondsDelay;

    const dateDelay = clampDelay(Date.parse(retryAfter) - Date.now());
    if (dateDelay != null) return dateDelay;
  }
  return Math.min(1000 * 2 ** attempt, MAX_RATE_LIMIT_DELAY_MS);
}

/**
 * Issue a single GET request to a 7shifts v2 endpoint and return the
 * parsed JSON body. Throws on non-2xx with a short body excerpt — we
 * never echo the bearer token.
 *
 * `creds` defaults to readSevenShiftsCreds() but tests pass an explicit
 * object so they don't have to mutate process.env.
 *
 * `fetchImpl` is a hook so unit tests can pass a stub without monkey-
 * patching globalThis.fetch.
 */
export async function get7shifts(
  endpoint,
  {
    query = {},
    creds = readSevenShiftsCreds(),
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    rateLimitRetries = DEFAULT_RATE_LIMIT_RETRIES,
    sleepImpl = sleep,
  } = {},
) {
  const u = new URL(`https://${creds.host}/v2/company/${creds.companyId}/${endpoint}`);
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    u.searchParams.set(k, String(v));
  }
  const maxRetries = Math.min(
    Math.max(0, Number(rateLimitRetries) || 0),
    MAX_RATE_LIMIT_RETRIES,
  );
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(u.toString(), {
        method: 'GET',
        headers: {
          Authorization: bearerHeader(creds.token),
          Accept: 'application/json',
        },
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429 && attempt < maxRetries) {
      await sleepImpl(rateLimitDelayMs(res.headers, attempt));
      continue;
    }

    if (!res.ok) {
      const excerpt = (await res.text().catch(() => '')).slice(0, 240);
      throw new Error(
        `7shifts GET ${maskUrl(u.toString())} failed: HTTP ${res.status} ${res.statusText}` +
          (excerpt ? ` — ${excerpt}` : '') +
          ` (token=${creds.maskedToken})`,
      );
    }
    return await res.json();
  }
}

/**
 * Async iterator that walks every page of a paginated 7shifts endpoint.
 * Yields `data` rows one envelope at a time so callers can `for-await`
 * without holding the entire result set in memory.
 *
 * 7shifts envelope (v2):
 *   { data: [...], meta: { cursor: { current, next, prev } } }
 *
 * We follow `meta.cursor.next` until it goes null. Some endpoints use a
 * different envelope key (notably `time_punches` returns `data` only);
 * the iterator falls back to a one-shot read when no cursor is present.
 */
export async function* paginate7shifts(
  endpoint,
  {
    query = {},
    creds = readSevenShiftsCreds(),
    fetchImpl = globalThis.fetch,
    pageSize = DEFAULT_PAGE_SIZE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    rateLimitRetries = DEFAULT_RATE_LIMIT_RETRIES,
    sleepImpl = sleep,
  } = {},
) {
  let cursor = null;
  // Hard cap to defend against an upstream pagination bug looping
  // forever — nobody has 100k pages of anything.
  const MAX_PAGES = 1000;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = { limit: pageSize, ...query };
    if (cursor) q.cursor = cursor;
    const body = await get7shifts(endpoint, {
      query: q,
      creds,
      fetchImpl,
      timeoutMs,
      rateLimitRetries,
      sleepImpl,
    });
    const rows = Array.isArray(body?.data) ? body.data : [];
    for (const row of rows) yield row;
    const next = body?.meta?.cursor?.next ?? body?.meta?.next_cursor ?? null;
    if (!next) return;
    cursor = next;
  }
  throw new Error(`7shifts pagination exceeded ${MAX_PAGES} pages on ${endpoint}`);
}
