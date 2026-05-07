/**
 * mDNS auto-start lifecycle helper.
 *
 * Owns the start/stop/HMR-survival/signal-handler dance so the Next.js
 * `instrumentation.ts` boot hook can stay tiny. Two public entry points:
 *
 *   - startAdvertiseOnce(opts) — call from instrumentation.register().
 *     If a handle already exists on globalThis (HMR rebooted the worker
 *     but kept the V8 isolate), returns the cached handle untouched.
 *     Otherwise calls advertise() once, stashes the handle, registers
 *     SIGTERM/SIGINT shutdown — also exactly once.
 *
 *   - stopAdvertiseOnce() — idempotent. Releases the handle and clears
 *     the stash so a future startAdvertiseOnce() can re-create. Used by
 *     the signal handlers and by tests that need a clean slate.
 *
 *   - bootMdnsAutostart() — convenience wrapper for instrumentation.ts.
 *     Reads version from package.json, port/locationId from env, calls
 *     startAdvertiseOnce, logs a one-line status. Lives here (not in
 *     instrumentation.ts) so webpack never tries to bundle node:fs into
 *     the edge runtime — instrumentation.ts dynamic-imports this file
 *     only when NEXT_RUNTIME==='nodejs'.
 *
 * **Operator note — mutual exclusion with launchd plist.** A future
 * `scripts/start-mdns.mjs`-backed launchd unit (planned Item 5) and this
 * Next-boot path advertise the *same* `_lariat._tcp` service from the
 * *same* host. Running both at once means two responders fight for the
 * multicast port, which `bonjour-service` will log loudly about and
 * which confuses peer discovery. **Operators must choose one — do not
 * run both:**
 *
 *   - In-process auto-start (this file) is the default for laptops and
 *     for `npm run dev` / `npm run start` deployments. It dies with the
 *     Next process, which is usually what you want.
 *   - launchd plist is for hosts where mDNS must survive Next restarts
 *     or where Next runs behind a separate supervisor. The opt-out
 *     mechanism for this in-process responder ships with Item 5.
 *
 * Idempotency strategy: stash the in-flight handle on `globalThis` under
 * a Lariat-prefixed key. Next.js HMR reuses the V8 isolate across rebuilds,
 * so module-level `let` would be reset but `globalThis` survives. The
 * signal-handler-installed flag rides on the same global so it also
 * survives HMR. Both keys are namespaced to avoid colliding with anything
 * else stashed on globalThis by app code or third-party libs.
 *
 * Test seam: every public function accepts an optional `customAdvertise`
 * so unit tests can swap in a fake without touching the real bonjour
 * stack. See `tests/js/test-mdns-autostart.mjs` for the contract.
 */

// Type-only import — erased at runtime, so webpack does not follow this
// chain into `bonjour-service` for edge-runtime bundles. The real
// `advertise()` is loaded via dynamic import in startAdvertiseOnce(),
// which only runs from the Node.js runtime guard in instrumentation.ts.
import type { AdvertiseHandle, AdvertiseOptions } from './mdnsDiscovery.ts';

type AdvertiseFn = (_opts: AdvertiseOptions) => Promise<AdvertiseHandle>;

interface LifecycleStash {
  handle: AdvertiseHandle | null;
  signalsInstalled: boolean;
}

const HANDLE_KEY = '__lariatMdnsLifecycle' as const;

declare global {
  var __lariatMdnsLifecycle: LifecycleStash | undefined;
}

function getStash(): LifecycleStash {
  let stash = globalThis[HANDLE_KEY];
  if (!stash) {
    stash = { handle: null, signalsInstalled: false };
    globalThis[HANDLE_KEY] = stash;
  }
  return stash;
}

function installSignalHandlersOnce(stash: LifecycleStash): void {
  if (stash.signalsInstalled) return;
  stash.signalsInstalled = true;

  const onSignal = (signal: NodeJS.Signals): void => {
    // Coordinated shutdown: stop the responder. We *don't* call
    // process.exit here — that would skip Next's own shutdown hooks
    // (DB flush, etc.). Next's own SIGINT handler will exit the process.
    void (async (): Promise<void> => {
      // eslint-disable-next-line no-console
      console.log(`[mdns] ${signal} received, stopping responder…`);
      await stopAdvertiseOnce();
    })();
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

export interface StartOptions {
  /** Test-only seam to inject a fake advertise(). Production leaves unset. */
  customAdvertise?: AdvertiseFn;
}

/**
 * Start the mDNS responder if it is not already running.
 *
 * Returns the existing handle if one is cached (HMR / repeat-call); otherwise
 * calls advertise() once, stashes the handle, and installs SIGTERM/SIGINT
 * handlers (also once). Always resolves — never rejects, because advertise()
 * itself never rejects.
 */
export async function startAdvertiseOnce(
  opts: AdvertiseOptions,
  startOpts: StartOptions = {}
): Promise<AdvertiseHandle> {
  const stash = getStash();
  if (stash.handle) return stash.handle;

  let advertiseFn: AdvertiseFn;
  if (startOpts.customAdvertise) {
    advertiseFn = startOpts.customAdvertise;
  } else {
    // Lazy import keeps `bonjour-service` out of edge-runtime bundles.
    const mod = await import('./mdnsDiscovery.ts');
    advertiseFn = mod.advertise;
  }
  const handle = await advertiseFn(opts);

  // Cache *even when active=false* (multicast unavailable). The point is
  // not to retry on every render in HMR — the warning has already been
  // logged once via warnOnce() inside mdnsDiscovery.
  stash.handle = handle;
  installSignalHandlersOnce(stash);
  return handle;
}

/**
 * Stop the cached responder and clear the stash. Idempotent.
 * Safe to call from signal handlers and from tests.
 */
export async function stopAdvertiseOnce(): Promise<void> {
  const stash = getStash();
  const handle = stash.handle;
  if (!handle) return;
  stash.handle = null;
  try {
    await handle.stop();
  } catch {
    /* advertise()'s handle.stop() already swallows; defence in depth. */
  }
}

function readPackageVersion(): string {
  try {
    // Use require so webpack's `resolveJsonModule` handles this at build
    // time and we avoid pulling `node:fs`/`node:url` into the edge bundle.
    // Mirrors the technique already used in `lib/mdnsDiscovery.ts`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../package.json') as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Boot helper invoked from `instrumentation.ts::register()`.
 *
 * Reads version from package.json (via `require` so webpack handles it),
 * port/locationId from env, calls startAdvertiseOnce, and logs one
 * status line. Kept here (not inline in instrumentation.ts) so the boot
 * file stays minimal.
 */
export async function bootMdnsAutostart(): Promise<void> {
  const version = readPackageVersion();
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const locationId = process.env.LARIAT_LOCATION_ID ?? 'default';

  // Load (or create on first boot) the per-peer Ed25519 keypair and
  // derive a 16-hex fingerprint for the TXT record. We dynamic-import
  // peerKeypair so webpack never tries to bundle node:fs/node:crypto
  // into edge-runtime bundles. Failure is non-fatal — degrade to mDNS
  // without pubkey_fp rather than refusing to advertise at all.
  let pubkeyFp: string | undefined;
  try {
    const { loadOrCreateKeypair, fingerprint } = await import('./peerKeypair.ts');
    const kp = loadOrCreateKeypair();
    pubkeyFp = fingerprint(kp.pubKey);
  } catch (err) {
     
    console.warn(
      '[mdns] could not load peer keypair — advertising without pubkey_fp',
      err instanceof Error ? err.message : err
    );
  }

  const handle = await startAdvertiseOnce({
    port,
    locationId,
    version,
    pubkeyFp,
  });

  if (handle.active) {
    // eslint-disable-next-line no-console
    console.log(
      `[mdns] advertising as Lariat on port ${port} (location=${locationId}, v${version}${
        pubkeyFp ? `, fp=${pubkeyFp}` : ''
      })`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('[mdns] disabled — multicast unavailable (see warning above)');
  }
}

/**
 * Test-only: forget the cached handle and signal-installed flag without
 * stopping the handle (call stopAdvertiseOnce() first if you need that).
 * Production code must not call this.
 */
export function _resetForTests(): void {
  const stash = getStash();
  stash.handle = null;
  stash.signalsInstalled = false;
}
