/**
 * Next.js instrumentation hook.
 *
 * Next calls `register()` exactly once per server worker on boot — both
 * for `next dev` and `next start`. We use it as the single, framework-
 * sanctioned place to start the mDNS responder so peers on the LAN can
 * find this Lariat instance without any external supervisor.
 *
 * Why here and not in `next.config.mjs` or a route module:
 *   - `next.config.mjs` runs at config time, before the server has a port.
 *   - Route modules don't run until a request arrives, which is too late
 *     for "discoverable from boot".
 *   - The instrumentation hook is the documented, framework-supported
 *     boot point. It runs on the Node runtime *and* on edge runtimes,
 *     so we guard with `process.env.NEXT_RUNTIME === 'nodejs'` to skip
 *     edge workers (which can't speak multicast anyway).
 *
 * All node-specific work (reading package.json via `node:fs`, starting
 * the bonjour responder, installing signal handlers) lives in
 * `lib/mdnsAdvertiseLifecycle.ts::bootMdnsAutostart`. We dynamic-import
 * that module **only** under the runtime guard so webpack never tries
 * to bundle `node:fs`/`node:url` into the edge build.
 *
 * Mutual exclusion with the launchd plist (Item 5, future) is documented
 * in `lib/mdnsAdvertiseLifecycle.ts`. Operators must choose one — do not
 * run both.
 */

export async function register(): Promise<void> {
  // Edge runtime can't speak multicast and doesn't have node: imports. Bail.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { bootMdnsAutostart } = await import('./lib/mdnsAdvertiseLifecycle.ts');
  await bootMdnsAutostart();
}
