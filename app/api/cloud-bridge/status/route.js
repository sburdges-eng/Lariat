// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * GET /api/cloud-bridge/status — stub.
 *
 * Returns the cloud bridge's status JSON plus a `configured` flag so
 * the UI can answer "is this site paired with the corp cloud peer
 * yet?" without needing a real network round-trip.
 *
 * PIN-gated: the bridge sits in front of cross-site data and pairing
 * keys, so the same PIC-authority gate that protects analytics /
 * costing applies here. See lib/pin + lib/pinCookie.
 *
 * Today's implementation is a stub — see docs/cloud-bridge-design.md.
 */

import { requirePin } from '../../../../lib/pin';
import { createCloudBridge, isCloudBridgeConfigured } from '../../../../lib/cloudBridge';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const bridge = createCloudBridge();
    const status = await bridge.status();
    return Response.json({
      configured: isCloudBridgeConfigured(),
      stub: true,
      status,
    });
  } catch (err) {
    console.error('GET /api/cloud-bridge/status failed:', err);
    return Response.json({ error: 'Failed to load cloud bridge status' }, { status: 500 });
  }
}
