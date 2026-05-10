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

import type { DiscoveredInstance } from './mdnsDiscovery.ts';

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
  // Hoist the txt fields so TS can narrow them inline below — splitting the
  // check into a separate `hasStartedAt` helper hides the narrowing from TS
  // and forces ugly `as string` casts at the comparison site.
  const aStarted = a.txt.started_at;
  const bStarted = b.txt.started_at;
  const aHas = typeof aStarted === 'string' && aStarted.length > 0;
  const bHas = typeof bStarted === 'string' && bStarted.length > 0;
  if (aHas !== bHas) return aHas ? -1 : 1;

  if (aStarted && bStarted) {
    // TS narrows both to `string` here from the truthiness check.
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
  // Copy the array before sorting so the caller's input is untouched.
  // We're sorting references, not deep-cloning peers — the function still
  // returns one of the original objects (preserves reference equality).
  // `?? null` covers the empty-array case without an explicit length check
  // and keeps `noUncheckedIndexedAccess` happy without a cast.
  return [...peers].sort(compareForHub)[0] ?? null;
}
