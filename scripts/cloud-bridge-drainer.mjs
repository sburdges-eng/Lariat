#!/usr/bin/env node
// Standalone cloud-bridge drainer (Item 8).
//
// For headless deploys without a Next.js process — runs the drainer
// loop until SIGTERM/SIGINT. Hosts running `npm run dev` or `npm run
// start` should rely on the instrumentation.ts auto-start (added in
// a follow-up after PR #163 merges) instead; running both wastes the
// queue's claim slot but is safe (claim/ack semantics dedup).
//
// Config:
//   LARIAT_CLOUD_BRIDGE_URL    — required
//   LARIAT_CLOUD_BRIDGE_SECRET — required (HMAC secret per §4.2)
//   LARIAT_DRAINER_TICK_MS     — optional, default 30000
//   LARIAT_DRAINER_STALE_AGE_S — optional, default 300
//
// Usage:
//   npm run cloud-bridge:drain
//   node --experimental-strip-types scripts/cloud-bridge-drainer.mjs

import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { startDrainer, stopDrainer } = await import('../lib/cloudBridgeDrainer.ts');
const { isCloudBridgeConfigured } = await import('../lib/cloudBridge.ts');

if (!isCloudBridgeConfigured()) {
  console.error(
    'cloud-bridge: LARIAT_CLOUD_BRIDGE_URL and LARIAT_CLOUD_BRIDGE_SECRET ' +
      'must both be set. Drainer will not start.',
  );
  process.exit(2);
}

const tickMs = Number(process.env.LARIAT_DRAINER_TICK_MS) || undefined;
const staleClaimAgeSec = Number(process.env.LARIAT_DRAINER_STALE_AGE_S) || undefined;

const handle = startDrainer({
  ...(tickMs !== undefined ? { tickMs } : {}),
  ...(staleClaimAgeSec !== undefined ? { staleClaimAgeSec } : {}),
});

console.log(
  `cloud-bridge: drainer started (tickMs=${tickMs ?? 30000}, ` +
    `staleClaimAgeSec=${staleClaimAgeSec ?? 300})`,
);

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`cloud-bridge: ${signal} received, stopping drainer`);
  stopDrainer();
  // Give in-flight tick (if any) a moment to settle, then exit.
  setTimeout(() => process.exit(0), 100).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Hold the event loop open. Without this, the unref'd setInterval
// inside the drainer would let the process exit immediately.
const keepalive = setInterval(() => {}, 1 << 30);
keepalive.unref(); // still won't actually keep alive — but the
// SIGTERM/SIGINT handlers above register listeners which DO keep
// the loop alive until they fire, which is what we want.
void handle;
