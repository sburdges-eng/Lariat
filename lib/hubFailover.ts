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
 * Match key: `peer.name`. The discover() contract guarantees `name` is a
 * non-empty string, and it's the stable identifier across restarts. A
 * restart with the same name but a different `started_at` is treated as
 * `unchanged` here — restart-detection is a separate signal future callers
 * can derive from `started_at`, and conflating it with failover would
 * cause needless hub churn on every reboot.
 *
 * Reference stability: in the `unchanged` case we return `prev.hub` (the
 * original object reference, not a freshly-discovered copy with the same
 * name). Callers can `===`-compare `result.hub` to their cached hub to
 * detect change cheaply. In `elected-new`, the returned `hub` is one of
 * the objects in the input `peers` array (whatever `electHub` picks).
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

  // Match by name (stable identifier). Same-name + different started_at
  // counts as the same hub — see module docstring for the rationale.
  const stillPresent = peers.some((p) => p.name === prevHub.name);
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
