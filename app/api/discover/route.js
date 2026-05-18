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

import { locationIdFromEnv } from '../../../lib/location';

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
  // Delegate to lib/location.ts so the LARIAT_LOCATION → LARIAT_LOCATION_ID
  // legacy-alias handling (audit F7, 2026-05-16) lives in one place.
  return locationIdFromEnv();
}

export async function GET() {
  return Response.json({
    name: 'lariat',
    version: readVersion(),
    location_id: readLocationId(),
    started_at: STARTED_AT,
  });
}
