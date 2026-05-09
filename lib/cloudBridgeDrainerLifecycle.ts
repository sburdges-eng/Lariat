/**
 * Cloud-bridge drainer lifecycle helper.
 *
 * Mirrors `lib/mdnsAdvertiseLifecycle.ts` so the Next.js
 * `instrumentation.ts` boot hook can stay tiny. One public entry
 * point:
 *
 *   - bootCloudBridgeDrainer() — call from instrumentation.register().
 *     Reads env via isCloudBridgeConfigured(); if the bridge is dormant
 *     (no LARIAT_CLOUD_BRIDGE_URL / _SECRET) logs a one-line skip and
 *     returns. Otherwise calls startDrainer() once, stashes a "booted"
 *     flag on globalThis, installs SIGTERM/SIGINT handlers (also once),
 *     and logs the running tick cadence.
 *
 * **Why a separate file from instrumentation.ts.** The drainer module
 * imports `lib/db.ts` (better-sqlite3) which webpack must NOT bundle
 * into the edge runtime. instrumentation.ts gates on
 * `NEXT_RUNTIME==='nodejs'` and dynamic-imports this file, so the
 * sqlite chain only loads in the Node worker.
 *
 * **Mutual exclusion with the standalone runner**
 * (`scripts/cloud-bridge-drainer.mjs`). Both paths claim from the
 * single SQLite outbox via the same claim/ack/nack semantics, so two
 * drainers racing for one row is correct (worst case: one wins claim,
 * other no-ops). It just wastes one tick's work and one HTTP socket.
 * The standalone runner is for headless deploys where Next isn't
 * running; do not run both unless you need belt-and-suspenders.
 *
 * Idempotency: stash a `booted` flag on globalThis under a Lariat-
 * prefixed key. Next.js HMR reuses the V8 isolate across rebuilds, so
 * module-level `let` would be reset but globalThis survives. The
 * drainer module itself also stashes its handle on globalThis, so two
 * boot calls collapse to one running interval at the queue layer too.
 *
 * Test seam: bootCloudBridgeDrainer accepts a `BootOptions` overrides
 * record so unit tests can swap in fakes without touching the real
 * SQLite + fetch stack. See
 * `tests/js/test-cloud-bridge-drainer-instrumentation.mjs`.
 */

import type { DrainerHandle, DrainerOpts } from './cloudBridgeDrainer';

type StartDrainerFn = (_opts?: DrainerOpts) => DrainerHandle;
type StopDrainerFn = () => void;
type IsConfiguredFn = () => boolean;

interface LifecycleStash {
  booted: boolean;
  signalsInstalled: boolean;
}

const HANDLE_KEY = '__lariatCloudBridgeDrainerLifecycle' as const;

declare global {
   
  var __lariatCloudBridgeDrainerLifecycle: LifecycleStash | undefined;
}

function getStash(): LifecycleStash {
  let stash = globalThis[HANDLE_KEY];
  if (!stash) {
    stash = { booted: false, signalsInstalled: false };
    globalThis[HANDLE_KEY] = stash;
  }
  return stash;
}

function installSignalHandlersOnce(
  stash: LifecycleStash,
  stopDrainer: StopDrainerFn,
): void {
  if (stash.signalsInstalled) return;
  stash.signalsInstalled = true;

  const onSignal = (signal: NodeJS.Signals): void => {
    // eslint-disable-next-line no-console
    console.log(`[cloud-bridge] ${signal} received, stopping drainer…`);
    stopDrainer();
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

export interface BootOptions {
  /** Test-only seam: skip the dynamic-imports and inject deps. */
  customIsConfigured?: IsConfiguredFn;
  customStartDrainer?: StartDrainerFn;
  customStopDrainer?: StopDrainerFn;
}

/**
 * Boot helper invoked from `instrumentation.ts::register()`.
 *
 * No-ops if the bridge is not configured (env vars absent) — this is
 * the steady state for development laptops and any host that hasn't
 * been paired to a cloud peer. Idempotent across HMR + repeat calls.
 */
export async function bootCloudBridgeDrainer(
  opts: BootOptions = {},
): Promise<void> {
  const stash = getStash();
  if (stash.booted) return;

  let isConfigured = opts.customIsConfigured;
  let startDrainer = opts.customStartDrainer;
  let stopDrainer = opts.customStopDrainer;

  if (!isConfigured || !startDrainer || !stopDrainer) {
    // Lazy imports: keep `better-sqlite3` (via db.ts) out of any caller
    // that runs in the edge runtime. instrumentation.ts gates on
    // NEXT_RUNTIME before reaching here, but defence in depth.
    const cb = await import('./cloudBridge');
    const drainer = await import('./cloudBridgeDrainer');
    isConfigured ??= cb.isCloudBridgeConfigured;
    startDrainer ??= drainer.startDrainer;
    stopDrainer ??= drainer.stopDrainer;
  }

  if (!isConfigured()) {
    // eslint-disable-next-line no-console
    console.log(
      '[cloud-bridge] drainer skipped — bridge not configured ' +
        '(set LARIAT_CLOUD_BRIDGE_URL + LARIAT_CLOUD_BRIDGE_SECRET to enable)',
    );
    return;
  }

  const tickMs = Number(process.env.LARIAT_DRAINER_TICK_MS) || 30000;
  const staleClaimAgeSec =
    Number(process.env.LARIAT_DRAINER_STALE_AGE_S) || 300;

  startDrainer({ tickMs, staleClaimAgeSec });
  stash.booted = true;
  installSignalHandlersOnce(stash, stopDrainer);

  // eslint-disable-next-line no-console
  console.log(
    `[cloud-bridge] drainer started (tickMs=${tickMs}, staleClaimAgeSec=${staleClaimAgeSec})`,
  );
}

/**
 * Test-only: forget the booted + signal-installed flags without
 * stopping the drainer (call stopDrainer() first if you need that).
 * Production code must not call this.
 */
export function _resetForTests(): void {
  const stash = getStash();
  stash.booted = false;
  stash.signalsInstalled = false;
}
