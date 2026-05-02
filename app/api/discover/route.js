/**
 * GET /api/discover — local instance identity.
 *
 * This is the HTTP entrypoint a peer hits AFTER finding us via mDNS, to
 * confirm "yes, I really am a Lariat instance and here's who I am".
 *
 * Intentionally NOT PIN-gated: discovery has to work before a user has
 * ever entered a PIN, otherwise iPads can't find the hub on first boot.
 * Nothing returned here is sensitive — it's the same identity advertised
 * over mDNS, served via HTTP for clients that already have the IP/host
 * (e.g. a fallback when multicast is filtered on hotel/guest Wi-Fi).
 *
 * Body shape: { name, version, location_id, started_at }
 *   name        — always 'lariat' (lets a peer distinguish us from any
 *                  other service answering on the discovered host:port)
 *   version     — package.json version
 *   location_id — operator-scoped location key
 *   started_at  — ISO timestamp of when this Next process came up
 *
 * Future work (see docs/multi-instance.md): negotiate role (hub vs.
 * tablet), advertise capabilities, return a public key for sync auth.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

// Captured at module load — same semantic as the mDNS TXT record's
// started_at. Acceptable because Next.js spins up one server process and
// route modules load once per process.
const STARTED_AT = new Date().toISOString();

function readVersion() {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readLocationId() {
  // LARIAT_LOCATION_ID is the deployment-time hint for which physical
  // site this instance represents. Falls back to 'default' to match the
  // location-scoping convention used elsewhere (lib/location.ts).
  const id = process.env.LARIAT_LOCATION_ID;
  return typeof id === 'string' && id.length > 0 ? id : 'default';
}

export async function GET() {
  return Response.json({
    name: 'lariat',
    version: readVersion(),
    location_id: readLocationId(),
    started_at: STARTED_AT,
  });
}
