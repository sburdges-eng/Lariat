/**
 * GET /api/peers — enumerate LAN peers and report the elected hub.
 *
 * This is the HTTP face of `lib/peers.ts::loadPeersAndHub`, which composes
 * `lib/mdnsDiscovery.ts::discover()` with `lib/hubElection.ts::electHub()`.
 * Clients (sidebar status pill, hub-failover watchdog) hit this to answer
 * two questions in one round-trip: "who else is on the LAN?" and "who's
 * the hub right now?".
 *
 * Intentionally NOT PIN-gated — same reasoning as `/api/discover`: peer
 * discovery has to work before a user has entered a PIN, otherwise iPads
 * can't find the hub on first boot. Nothing returned here is sensitive
 * (it's the same identity each peer publishes over mDNS).
 *
 * Body shape: { peers: DiscoveredInstance[], hub: DiscoveredInstance | null }
 *
 * Query param:
 *   timeout=<ms>  override the default 2000ms discover() listen window.
 *                 Clamped to [1, 10000]; non-finite/negative/non-numeric
 *                 values fall back to the default. The 10000 cap exists so
 *                 a malicious caller can't pin a Next.js worker for a minute
 *                 by hammering /api/peers?timeout=600000.
 *
 * `dynamic = 'force-dynamic'` because this route does network IO and must
 * not be statically optimized at build time.
 */

import { loadPeersAndHub } from '../../../lib/peers';

export const dynamic = 'force-dynamic';

const MAX_TIMEOUT_MS = 10000;

/**
 * Parse and clamp the `timeout` query param. Returns undefined for any
 * non-finite, non-positive, or non-numeric input — `loadPeersAndHub` then
 * forwards `undefined` to `discover()`, which uses its own 2000ms default.
 */
function parseTimeout(raw) {
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (n <= 0) return undefined;
  return Math.min(n, MAX_TIMEOUT_MS);
}

export async function GET(request) {
  const url = new URL(request.url);
  const timeoutMs = parseTimeout(url.searchParams.get('timeout'));
  const { peers, hub } = await loadPeersAndHub({ timeoutMs });
  return Response.json({ peers, hub });
}
