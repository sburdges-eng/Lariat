/**
 * GET /api/peers — enumerate LAN peers and report the elected hub.
 *
 * This is the HTTP face of `lib/peers.ts::loadPeersAndHub`, which composes
 * `lib/mdnsDiscovery.ts::discover()` with `lib/hubElection.ts::electHub()`.
 * Clients (sidebar status pill, hub-failover watchdog) hit this to answer
 * two questions in one round-trip: "who else is on the LAN?" and "who's
 * the hub right now?".
 *
 * Auth model: the route itself is NOT in middleware.js SENSITIVE_PREFIXES —
 * peer discovery has to work before a user has entered a PIN, otherwise
 * iPads can't find the hub on first boot, and the sidebar's "other site is
 * online" pill should light up regardless of who's at the tablet. But
 * `pubkey_fp`, `host`, `port`, `version`, and `addresses` together form the
 * cluster topology + the long-term identity that the signed-sync handshake
 * uses for TOFU. Leaking that to a LAN attacker gives them a prepared-target
 * list. So:
 *
 *   - Without a valid PIN cookie: each peer is reduced to `{ name, txt:
 *     { location_id, started_at } }` and the hub is reported as `null`.
 *     `redacted: true` is set so the caller knows the response was filtered.
 *     This is enough information for the unauth use cases above (presence,
 *     count, names).
 *   - With a valid PIN cookie: full `DiscoveredInstance` rows + elected hub
 *     identity. Same shape as before. Powers /management/peers (PIN-gated).
 *
 * Closes GH #253.
 *
 * Body shape (unredacted):
 *   { peers: DiscoveredInstance[], hub: DiscoveredInstance | null }
 * Body shape (redacted):
 *   { peers: RedactedPeer[], hub: null, redacted: true }
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
import { hasPinCookie } from '../../../lib/pin';

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

/**
 * Strip identity + topology fields from a peer for unauthenticated callers.
 * Exported for unit testing — the goal is that a LAN attacker without the
 * PIN cannot read `pubkey_fp`, `host`, `port`, `addresses`, or `version`.
 *
 * `location_id` + `started_at` stay because the only known unauth caller
 * (the "another site is online" pill) wants to label peers something more
 * useful than "(unknown)". Both are advertised over mDNS already, so they
 * are not new disclosure surface.
 */
export function redactPeerForUnauth(peer) {
  const txt = peer && peer.txt ? peer.txt : {};
  const out = { name: typeof peer?.name === 'string' ? peer.name : '', txt: {} };
  if (typeof txt.location_id === 'string') out.txt.location_id = txt.location_id;
  if (typeof txt.started_at === 'string') out.txt.started_at = txt.started_at;
  return out;
}

/**
 * Pure shape-decider used by GET. Exposed for unit tests so the redaction
 * branch can be exercised without stubbing the multicast IO layer.
 */
export function buildPeersResponse(peers, hub, { pinOk }) {
  if (pinOk) return { peers, hub };
  return {
    peers: peers.map(redactPeerForUnauth),
    hub: null,
    redacted: true,
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const timeoutMs = parseTimeout(url.searchParams.get('timeout'));
  const { peers, hub } = await loadPeersAndHub({ timeoutMs });
  const pinOk = await hasPinCookie(request);
  return Response.json(buildPeersResponse(peers, hub, { pinOk }));
}
