/**
 * Next.js instrumentation hook.
 *
 * Next calls `register()` exactly once per server worker on boot — both
 * for `next dev` and `next start`. We use it as the single, framework-
 * sanctioned place to start two long-running side-services:
 *
 *   1. mDNS responder — so peers on the LAN can find this Lariat instance.
 *   2. Cloud-bridge drainer — so rows enqueued in `cloud_bridge_outbox`
 *      get pushed to the configured cloud peer without an external
 *      supervisor. Skipped silently if env vars are absent.
 *
 * Why here and not in `next.config.mjs` or a route module:
 *   - `next.config.mjs` runs at config time, before the server has a port.
 *   - Route modules don't run until a request arrives, which is too late
 *     for "discoverable from boot" / "drains while idle".
 *   - The instrumentation hook is the documented, framework-supported
 *     boot point. It runs on the Node runtime *and* on edge runtimes,
 *     so we guard with `process.env.NEXT_RUNTIME === 'nodejs'` to skip
 *     edge workers (which can't speak multicast or open SQLite anyway).
 *
 * All node-specific work (reading package.json via `node:fs`, starting
 * the bonjour responder, opening SQLite, installing signal handlers)
 * lives in the per-service lifecycle helpers
 * (`lib/mdnsAdvertiseLifecycle.ts`, `lib/cloudBridgeDrainerLifecycle.ts`).
 * We dynamic-import them **only** under the runtime guard so webpack
 * never tries to bundle `node:fs`, `node:url`, or `better-sqlite3` into
 * the edge build.
 *
 * Mutual exclusion notes:
 *   - mDNS vs. launchd plist — see `lib/mdnsAdvertiseLifecycle.ts`.
 *   - Drainer vs. `scripts/cloud-bridge-drainer.mjs` — see
 *     `lib/cloudBridgeDrainerLifecycle.ts`. Both share the same outbox
 *     and are correct under a race; running both just wastes a tick.
 */

export async function register(): Promise<void> {
  // Edge runtime can't speak multicast and doesn't have node: imports. Bail.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { bootMdnsAutostart } = await import('./lib/mdnsAdvertiseLifecycle.ts');
  await bootMdnsAutostart();

  const { bootCloudBridgeDrainer } = await import(
    './lib/cloudBridgeDrainerLifecycle.ts'
  );
  await bootCloudBridgeDrainer();
}
