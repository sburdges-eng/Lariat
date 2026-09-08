// Test-only loader hook that redirects `lib/mdnsDiscovery.ts` imports to
// mdns-discovery-mock.mjs in this same directory.
//
// `lib/peers.ts` takes an injectable `discoverFn`, so helper tests can
// stub the network seam directly. `app/api/peers/route.js` cannot — it
// calls `loadPeersAndHub({ timeoutMs })` and gets the real `discover()`,
// which listens for `_lariat._tcp` on the LAN. That makes route tests
// depend on the ambient network: green on a CI runner with no multicast,
// red on a developer Mac whose own hub is advertising. This loader gives
// the route the same deterministic seam without changing route or
// discovery code (peer trust/topology is a protected contract).
//
// Register this BEFORE resolver.mjs if both are needed, e.g.:
//   register(new URL('./mdns-discovery-mock-loader.mjs', import.meta.url));
//   register(new URL('./resolver.mjs', import.meta.url));

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const MOCK_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'mdns-discovery-mock.mjs')
).href;

const TARGET_SUFFIX = '/lib/mdnsDiscovery.ts';

export async function resolve(specifier, context, nextResolve) {
  // Match on the resolved URL rather than the raw specifier so this works
  // whether the importer wrote './mdnsDiscovery.ts' or the extensionless
  // Next.js form that resolver.mjs fills in.
  const resolved = await nextResolve(specifier, context);
  if (resolved?.url?.endsWith(TARGET_SUFFIX)) {
    return { url: MOCK_URL, format: 'module', shortCircuit: true };
  }
  return resolved;
}
