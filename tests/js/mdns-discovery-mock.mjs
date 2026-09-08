// Test-only mock for `lib/mdnsDiscovery.ts`. Loaded in place of the real
// module by mdns-discovery-mock-loader.mjs.
//
// `discover()` is the one multicast-IO seam under `/api/peers`. Left
// real, a route test reports whatever is advertising `_lariat._tcp` on
// the LAN — so the same test passes on a CI runner with no multicast and
// fails on a developer Mac running scripts/start-hub.sh, which discovers
// its own hub. This mock replaces that seam so route tests describe the
// route's shaping of a known peer list.
//
// Only `discover` is mirrored — it is the sole export the `/api/peers`
// module graph pulls in (via lib/peers.ts). An import of anything else
// fails loudly at link time rather than silently reading a stub.
//
// Test-only `__set*` hooks follow the same pattern as `__setCookies` in
// next-headers-mock.mjs and `setDbPathForTest()` in lib/db.ts —
// production code never calls them.

/** @type {Array<object>} */
let _peers = [];
/** @type {Array<object>} */
let _calls = [];

/** Test-only: stage the peer list the next `discover()` call returns. */
export function __setDiscoveredPeers(peers = []) {
  _peers = peers.slice();
}

/**
 * Test-only: the options object each `discover()` call received, in
 * order. Lets a route test assert the timeout it parsed and clamped
 * actually reached the discovery layer.
 */
export function __discoverCalls() {
  return _calls.slice();
}

/** Test-only: clear both the staged peers and the recorded calls. */
export function __resetDiscoverMock() {
  _peers = [];
  _calls = [];
}

/**
 * Mock implementation of `discover()`. Same contract as the real one:
 * always resolves, never rejects, returns an array of
 * DiscoveredInstance-shaped rows. Returns a copy so a caller mutating
 * the result can't corrupt the staged fixture.
 */
export async function discover(options = {}) {
  _calls.push({ ...options });
  return _peers.slice();
}
