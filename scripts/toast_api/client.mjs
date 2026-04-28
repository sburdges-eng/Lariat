// scripts/toast_api/client.mjs
//
// Thin HTTP client over the Toast API. Owns:
//   - Attaching `Authorization: Bearer <token>` (resolved via auth.mjs)
//   - Attaching `Toast-Restaurant-External-ID` from TOAST_RESTAURANT_GUID
//   - One-time retry on 401 with a forced token refresh (covers the case
//     where the cached token was revoked / rotated mid-script)
//   - Pagination (paginatedFetch): walks pageSize/pageToken-style endpoints
//     until exhausted and yields each page's parsed JSON
//
// We deliberately don't add backoff/jitter for transient 5xx; weekly
// cron-y workloads can just fail and retry next time. Adding that is a
// follow-up if real ops show it's needed.

import { getAccessToken } from './auth.mjs';

const DEFAULT_PAGE_SIZE = 100;

function readRestaurantGuid() {
  const guid = (process.env.TOAST_RESTAURANT_GUID || '').trim();
  if (!guid) {
    throw new Error(
      'TOAST_RESTAURANT_GUID missing in .env.local — see scripts/toast_api/README.md'
    );
  }
  return guid;
}

function buildHost() {
  const host = (process.env.TOAST_API_HOST || '').trim();
  if (!host) throw new Error('TOAST_API_HOST missing');
  return host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function buildUrl(host, pathOrUrl, query) {
  // Accept either a path ("/orders/v2/ordersBulk") or an absolute URL.
  // Toast pagination sometimes returns a `next` URL that's already absolute.
  const url = pathOrUrl.startsWith('http')
    ? new URL(pathOrUrl)
    : new URL(pathOrUrl, `https://${host}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Single GET against the Toast API. Returns the parsed JSON body on 2xx.
 * Throws on non-2xx with the status + a short response excerpt.
 *
 * Pass `{ retryOn401: true }` (default) to refresh the token and retry
 * once when the first attempt 401s. That covers the credential-rotation
 * case without thrashing the cache on every request.
 */
export async function get(pathOrUrl, { query, retryOn401 = true } = {}) {
  const host = buildHost();
  const guid = readRestaurantGuid();
  const url = buildUrl(host, pathOrUrl, query);

  const tryOnce = async ({ force }) => {
    const tok = await getAccessToken({ force });
    return fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `${tok.tokenType} ${tok.accessToken}`,
        'Toast-Restaurant-External-ID': guid,
        Accept: 'application/json',
      },
    });
  };

  let res = await tryOnce({ force: false });
  if (res.status === 401 && retryOn401) {
    res = await tryOnce({ force: true });
  }

  if (!res.ok) {
    const excerpt = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(
      `Toast GET ${url} failed: HTTP ${res.status} ${res.statusText}` +
        (excerpt ? ` — ${excerpt}` : '')
    );
  }

  // Some Toast endpoints return arrays directly; others return objects
  // with `data`/`results`. We don't rewrap — caller knows the shape.
  return res.json();
}

/**
 * Walk a paginated Toast endpoint until exhausted. Yields each page's
 * parsed JSON body. Most Toast list endpoints support `pageSize` (1..100)
 * and `pageToken` (opaque cursor returned in the previous response).
 *
 * `extractItems(body)` should return the array of items from one page;
 * `extractNextToken(body, res?)` should return the next-page token (or
 * `null`/`undefined` when the walk is done). We default both to the
 * common Toast shape and let the caller override per-endpoint.
 *
 * For endpoints that page via `?page=N` integers instead of a token,
 * pass `pageMode: 'integer'` and the loop will increment until a page
 * comes back empty or shorter than `pageSize`.
 */
export async function* paginatedFetch(
  pathOrUrl,
  {
    query = {},
    pageSize = DEFAULT_PAGE_SIZE,
    pageMode = 'token', // 'token' | 'integer'
    extractItems = (body) => (Array.isArray(body) ? body : body?.results ?? body?.data ?? []),
    extractNextToken = (body) =>
      typeof body?.nextPageToken === 'string' ? body.nextPageToken : null,
  } = {}
) {
  if (pageMode === 'integer') {
    let page = 1;
    while (true) {
      const body = await get(pathOrUrl, {
        query: { ...query, page, pageSize },
      });
      const items = extractItems(body);
      if (!items || items.length === 0) return;
      yield { page, body, items };
      if (items.length < pageSize) return; // last page
      page += 1;
    }
  } else {
    let pageToken = null;
    let page = 1;
    while (true) {
      const body = await get(pathOrUrl, {
        query: { ...query, pageSize, ...(pageToken ? { pageToken } : {}) },
      });
      const items = extractItems(body);
      yield { page, body, items };
      const next = extractNextToken(body);
      if (!next) return;
      pageToken = next;
      page += 1;
    }
  }
}

// ── Date helpers (ISO + Toast's expected formats) ─────────────────────

/**
 * Format a Date as Toast's expected query format for date-range params:
 * ISO 8601 with a Z suffix, e.g. "2026-04-20T00:00:00.000Z".
 * Toast accepts both `YYYY-MM-DD` and full ISO; we use full ISO so the
 * inclusive/exclusive boundary is unambiguous (UTC midnight).
 */
export function toIsoZ(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error('toIsoZ requires a valid Date');
  }
  return d.toISOString();
}

/**
 * Return the start (UTC midnight) of the day `daysAgo` days before `now`.
 * Pure, no I/O. Used by the weekly-pull entrypoint to build the
 * inclusive 7-day window.
 */
export function utcMidnightDaysAgo(now, daysAgo) {
  const t = new Date(now);
  t.setUTCHours(0, 0, 0, 0);
  t.setUTCDate(t.getUTCDate() - daysAgo);
  return t;
}
