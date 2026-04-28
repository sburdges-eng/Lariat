// scripts/prism_api/client.mjs
//
// Prism.fm HTTP client. Status: SCAFFOLD.
//
// Without confirmed API documentation from Prism we can't ship a real
// implementation. This module:
//
//   1. Defines the call signature `getPrismEvents({ since, until })` so
//      the ingest can be written, tested with a mock fetchImpl, and
//      flipped on once creds + endpoint shape are confirmed.
//   2. Throws a CLEAR placeholder error when invoked with real creds
//      against the unverified endpoint, so a curious operator who
//      wires up creds without finishing the docs round-trip gets a
//      readable error instead of a 404 or a JSON parse failure.
//
// Once Prism docs are confirmed, fill in:
//   - REAL_ENDPOINT_PATH below
//   - the auth header style (X-API-Key vs Authorization: Bearer vs query
//     string ?api_key=…)
//   - response envelope shape parsing
//
// All of that needs CSM-issued documentation to commit; we deliberately
// don't guess.

import { readPrismCreds } from './auth.mjs';

// PLACEHOLDER — replace with the path Prism's API docs specify, e.g.
// 'v1/events' or 'api/calendar/events'. The current value will not
// resolve to anything real and is here only to make the scaffold
// inspectable / debuggable. The fetch is gated behind a runtime
// guard below; nothing leaves the box until that's lifted.
const REAL_ENDPOINT_PATH = null;

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Pull events from Prism. Throws when the endpoint path hasn't been
 * confirmed yet (the SCAFFOLD state); callers get a clear "wire me up"
 * error rather than a network failure.
 *
 * Tests pass `fetchImpl` and `endpointPath` directly, bypassing the
 * scaffold guard so they can verify the request shape we'd send once
 * docs are in.
 */
export async function getPrismEvents({
  since,
  until,
  creds = readPrismCreds(),
  fetchImpl = globalThis.fetch,
  endpointPath = REAL_ENDPOINT_PATH,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!endpointPath) {
    throw new Error(
      'Prism.fm adapter is a SCAFFOLD: REAL_ENDPOINT_PATH is unset because ' +
        'the API path/auth shape has not been confirmed. See scripts/prism_api/README.md ' +
        'for the open questions to ask your Prism CSM.',
    );
  }
  const u = new URL(`https://${creds.host}/${endpointPath}`);
  if (since) u.searchParams.set('since', since);
  if (until) u.searchParams.set('until', until);
  if (creds.venueId) u.searchParams.set('venue_id', creds.venueId);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(u.toString(), {
      method: 'GET',
      headers: {
        // Most likely Prism uses one of these — confirm before shipping.
        // Leaving Authorization: Bearer as the default since it's the
        // single most common pattern in modern SaaS APIs.
        Authorization: `Bearer ${creds.apiKey}`,
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      const excerpt = (await res.text().catch(() => '')).slice(0, 240);
      throw new Error(
        `Prism GET ${endpointPath} failed: HTTP ${res.status} ${res.statusText}` +
          (excerpt ? ` — ${excerpt}` : '') +
          ` (key=${creds.maskedKey})`,
      );
    }
    const body = await res.json();
    // Until we have the real envelope shape, both `body.events` and
    // `body.data` are accepted; the ingest script normalizes downstream.
    return Array.isArray(body) ? body : (body?.events ?? body?.data ?? []);
  } finally {
    clearTimeout(timer);
  }
}
