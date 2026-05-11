/**
 * Peers + hub composition — compose `discover()` with `electHub()`.
 *
 * `app/api/peers/route.js` is the public face of this; this module exists
 * separately so the network seam is injectable. `discover()` returns `[]`
 * in CI (no multicast on the runner), so a direct route test could only
 * cover the empty-peers branch — by routing through `loadPeersAndHub` with
 * an optional `discoverFn`, the helper test can exercise the "with peers"
 * path that the route would take in production. Production callers use the
 * default and never pass `discoverFn`.
 *
 * The shape of the return value matches what the `/api/peers` JSON body
 * advertises, so the route can `Response.json(await loadPeersAndHub(...))`
 * without reshaping.
 */
import { discover } from './mdnsDiscovery.ts';
import type { DiscoveredInstance, DiscoverOptions } from './mdnsDiscovery.ts';
import { electHub } from './hubElection.ts';

export interface PeersAndHub {
  peers: DiscoveredInstance[];
  hub: DiscoveredInstance | null;
}

export interface LoadPeersAndHubOptions {
  /** Forwarded to `discover()`. Undefined means "use the default" (2000 ms). */
  timeoutMs?: number;
  /**
   * Test seam — production callers don't pass this. Defaulting to the real
   * `discover` keeps the helper trivially correct in production while
   * letting tests stub the LAN-IO path deterministically.
   */
  discoverFn?: (_opts: DiscoverOptions) => Promise<DiscoveredInstance[]>;
}

/**
 * Discover peers on the LAN and elect a hub from the result.
 *
 * Always resolves: `discover()` is documented as never rejecting, and
 * `electHub()` is a pure function. An empty `peers` array yields `hub: null`.
 */
export async function loadPeersAndHub(
  opts: LoadPeersAndHubOptions = {}
): Promise<PeersAndHub> {
  const fn = opts.discoverFn ?? discover;
  const peers = await fn({ timeoutMs: opts.timeoutMs });
  return { peers, hub: electHub(peers) };
}
