#!/usr/bin/env node
/**
 * scripts/start-mdns.mjs — standalone mDNS responder for Lariat.
 *
 * Run alongside the Next dev/prod server to advertise this instance on
 * the LAN. Kept separate (not wired into `npm run dev`) so the responder's
 * lifecycle is explicit — operators can stop just the mDNS layer without
 * killing the kitchen UI, and developers don't get surprised by extra
 * multicast traffic during normal local dev.
 *
 * Usage:
 *   npm run mdns:advertise                       # port 3000, location 'default'
 *   PORT=4000 LARIAT_LOCATION_ID=upstairs \
 *     npm run mdns:advertise
 *
 * Sibling: `npm run mdns:discover` runs scripts/start-mdns.mjs --discover
 * to listen for peers and print what it finds.
 *
 * Future work: a launchd/systemd unit can wrap this so the responder
 * comes up at boot. See docs/multi-instance.md.
 */

import { advertise, discover } from '../lib/mdnsDiscovery.ts';

const args = new Set(process.argv.slice(2));
const isDiscover = args.has('--discover') || args.has('-d');

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const locationId = process.env.LARIAT_LOCATION_ID ?? 'default';

if (isDiscover) {
  // One-shot scan: 3-second window is enough to catch all peers on a
  // healthy LAN without making the operator wait at a terminal prompt.
  const peers = await discover({ timeoutMs: 3000 });
  if (peers.length === 0) {
    console.log('No Lariat peers found on the LAN.');
  } else {
    console.log(`Found ${peers.length} Lariat peer(s):`);
    for (const p of peers) {
      const addr = p.addresses[0] ?? p.host;
      const loc = p.txt.location_id ?? '?';
      const ver = p.txt.version ?? '?';
      console.log(`  • ${p.name}  ${addr}:${p.port}  v${ver}  loc=${loc}`);
    }
  }
  process.exit(0);
}

const handle = await advertise({ port, locationId });
if (!handle.active) {
  // advertise() already logged the reason via warnOnce(); exit non-zero
  // so launchd/operators see the failure.
  console.error('mDNS responder did not start (see warning above).');
  process.exit(1);
}

console.log(
  `Advertising _lariat._tcp on port ${port} (location=${locationId}). ` +
    `Press Ctrl-C to stop.`
);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}, stopping responder…`);
  await handle.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
