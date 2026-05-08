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

// Hold the event loop open until SIGTERM/SIGINT triggers shutdown().
// Without this, the unref'd setInterval inside the drainer (which is
// itself unref'd so unit tests don't hang) would let the process exit
// immediately. We keep this interval REF'd so the drainer process
// stays alive regardless of Node's handler-keepalive semantics.
//
// Cleanup: shutdown() (the SIGTERM/SIGINT path) calls clearInterval
// on the handle below before exiting. The 100ms setTimeout in
// shutdown() gives any in-flight tick a moment to settle.
const keepalive = setInterval(() => {}, 1 << 30);

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`cloud-bridge: ${signal} received, stopping drainer`);
  stopDrainer();
  clearInterval(keepalive);
  // Give in-flight tick (if any) a moment to settle, then exit.
  setTimeout(() => process.exit(0), 100).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void handle;
