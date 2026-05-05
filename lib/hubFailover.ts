/**
 * Hub-failover change detection.
 *
 * Layered on top of `electHub()` (lib/hubElection.ts): given the LAST known
 * hub plus a fresh `discover()` peer list, classify what changed. Hub
 * election picks a winner; failover detection answers "did it change, and
 * how should the caller react?".
 *
 * Pure function: no I/O, no clock, no mutation. The eventual `/api/peers`
 * route, a CLI "current hub" tool, and a background failover tick all share
 * this same classification.
 *
 * Decision table — branch by `(prev.hub, peers)`:
 *
 *   prev.hub | peers      | action
 *   ---------+------------+--------
 *   null     | []         | no-peers        (cold start, LAN empty)
 *   null     | non-empty  | first-election  (cold start, first hub elected)
 *   set      | []         | lost-hub        (LAN went dark)
 *   set      | has prev   | unchanged       (hub still there)
 *   set      | gone       | elected-new     (hub disappeared, re-elect)
 *
 * Match key: `(host, started_at)`. Service `name` is NOT a stable
 * identifier — bonjour appends conflict suffixes ("Lariat (2)") when two
 * peers advertise the same service name, and a name vacated by a peer
 * going offline can be reclaimed by a different peer. Both cases would
 * cause name-based matching to lie:
 *
 *   - Same physical instance gets a new mDNS suffix after the network
 *     blips (its `host` and `started_at` are unchanged) → identity by
 *     name says "elected-new"; identity by `(host, started_at)` correctly
 *     reports `unchanged`.
 *   - A different instance reuses the prev hub's name after that hub
 *     vanishes → identity by name says "unchanged"; identity by
 *     `(host, started_at)` correctly reports `elected-new`.
 *
 * Restart of the same machine (same `host`, fresh `started_at`) is
 * treated as a NEW hub instance, because the prior hub's in-memory state
 * is gone — peers must re-elect rather than carry the old reference. If
 * a caller wants explicit "same machine restarted" detection, it can
 * compare `prev.hub.host` to the new hub's `host` independently.
 *
 * Fallbacks for degraded mDNS records (missing `host` or `started_at`):
 * use whichever stable signal is available, then `name` as a last resort.
 *
 * Reference stability: in the `unchanged` case we return `prev.hub` (the
 * original object reference, not a freshly-discovered copy with the same
 * identity). Callers can `===`-compare `result.hub` to their cached hub
 * to detect change cheaply. In `elected-new`, the returned `hub` is one
 * of the objects in the input `peers` array (whatever `electHub` picks).
 */

import type { DiscoveredInstance } from './mdnsDiscovery.ts';
import { electHub } from './hubElection.ts';

export interface HubState {
  /** Last known hub, or null on cold start / after total LAN loss. */
  hub: DiscoveredInstance | null;
}

export type HubChange =
  | { action: 'unchanged'; hub: DiscoveredInstance }
  | { action: 'first-election'; hub: DiscoveredInstance }
  | {
      action: 'elected-new';
      hub: DiscoveredInstance;
      prevHub: DiscoveredInstance;
    }
  | { action: 'lost-hub'; hub: null; prevHub: DiscoveredInstance }
  | { action: 'no-peers'; hub: null; prevHub: DiscoveredInstance | null };

/**
 * Stable identity for a discovered peer. `(host, started_at)` is the
 * canonical key — the same physical instance keeps both across mDNS
 * name-suffix shuffles, and any restart or different machine differs in
 * one of them. Falls back gracefully when a TXT record is missing those
 * fields (degraded discovery shouldn't crash failover).
 */
function peerKey(p: DiscoveredInstance): string {
  const host = p.host;
  const startedAt = p.txt.started_at;
  if (host && startedAt) return `hs:${host}|${startedAt}`;
  if (host) return `h:${host}`;
  if (startedAt) return `s:${startedAt}`;
  return `n:${p.name}`;
}

/**
 * Classify the transition from `prev.hub` to a freshly-discovered peer list.
 *
 * Pure: never mutates `prev` or `peers`. Always returns one of the five
 * `HubChange` variants — the union exhausts the (prev × peers) decision
 * table above.
 */
export function detectHubChange(
  prev: HubState,
  peers: DiscoveredInstance[]
): HubChange {
  const prevHub = prev.hub;

  if (peers.length === 0) {
    if (prevHub === null) {
      return { action: 'no-peers', hub: null, prevHub: null };
    }
    return { action: 'lost-hub', hub: null, prevHub };
  }

  if (prevHub === null) {
    // peers is non-empty so electHub returns a non-null peer — but TS only
    // sees `DiscoveredInstance | null`. Narrow explicitly so we don't widen
    // HubChange.hub to nullable for this variant.
    const elected = electHub(peers);
    if (elected === null) {
      // Unreachable given peers.length > 0 and electHub's contract, but
      // narrow defensively rather than non-null-asserting.
      return { action: 'no-peers', hub: null, prevHub: null };
    }
    return { action: 'first-election', hub: elected };
  }

  // Match by (host, started_at) — see module docstring. Service name is
  // not a stable identifier on mDNS.
  const prevKey = peerKey(prevHub);
  const stillPresent = peers.some((p) => peerKey(p) === prevKey);
  if (stillPresent) {
    // Return the PREV reference, not the freshly-discovered copy, so callers
    // can `===`-compare to detect change.
    return { action: 'unchanged', hub: prevHub };
  }

  const elected = electHub(peers);
  if (elected === null) {
    // Same defensive narrowing as above.
    return { action: 'lost-hub', hub: null, prevHub };
  }
  return { action: 'elected-new', hub: elected, prevHub };
}
