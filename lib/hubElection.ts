/**
 * Hub election — pick the most-stable peer from an mDNS-discovered set.
 *
 * Lariat is local-first; once two or more instances coexist on a LAN
 * (back-of-house hub + service iPad, upstairs/downstairs), exactly one
 * needs to act as the coordination point ("hub") so writes don't fight.
 * `lib/mdnsDiscovery.ts` already publishes `started_at` in the TXT record —
 * the timestamp of when each instance came up — and that's all we need for
 * a deterministic, leaderless election: the oldest instance wins. Oldest
 * means most stable, least likely to have just rebooted, and gives any
 * future failover loop a stable, monotone tiebreaker.
 *
 * Pure function, by design: no I/O, no clock reads, no input mutation.
 * The eventual `/api/peers` route, a CLI "current hub" tool, and a
 * background election tick can all share this same logic.
 *
 * Selection order (lowest = winner):
 *   1. Earliest (lexicographically smallest ISO-8601) `txt.started_at`.
 *   2. Lexicographically smallest `name` (the discover() contract
 *      guarantees `name` is a non-empty string).
 *   3. Peers with missing/empty `started_at` sort AFTER any peer that
 *      has a real one — they only win if no one has a timestamp.
 */

import type { DiscoveredInstance } from './mdnsDiscovery';

/** True when the peer advertised a non-empty started_at TXT field. */
function hasStartedAt(p: DiscoveredInstance): boolean {
  const s = p.txt.started_at;
  return typeof s === 'string' && s.length > 0;
}

/**
 * Compare two peers for hub-election order. Returns a negative number if
 * `a` should be hub over `b`, positive if `b` wins, 0 if indistinguishable.
 *
 * Order:
 *   - peers with a started_at sort before peers without
 *   - among peers with started_at, smallest ISO string wins
 *   - tie-break on smallest name
 */
function compareForHub(
  a: DiscoveredInstance,
  b: DiscoveredInstance
): number {
  const aHas = hasStartedAt(a);
  const bHas = hasStartedAt(b);
  if (aHas !== bHas) return aHas ? -1 : 1;

  if (aHas && bHas) {
    // Non-null assertions are safe: hasStartedAt() proved both are strings.
    const aStarted = a.txt.started_at as string;
    const bStarted = b.txt.started_at as string;
    if (aStarted < bStarted) return -1;
    if (aStarted > bStarted) return 1;
  }

  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/**
 * Elect a hub from the given peer set.
 *
 * @param peers Peers as returned by `discover()`. Not mutated.
 * @returns The peer that should act as hub, or `null` if `peers` is empty.
 */
export function electHub(
  peers: DiscoveredInstance[]
): DiscoveredInstance | null {
  if (peers.length === 0) return null;
  // Copy the array before sorting so the caller's input is untouched.
  // We're sorting references, not deep-cloning peers — the function still
  // returns one of the original objects (preserves reference equality).
  const sorted = [...peers].sort(compareForHub);
  // length >= 1 was already established above, so sorted[0] exists; the
  // assertion sidesteps `noUncheckedIndexedAccess` widening to `undefined`.
  return sorted[0] as DiscoveredInstance;
}
