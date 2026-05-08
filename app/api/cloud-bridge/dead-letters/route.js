/**
 * GET /api/cloud-bridge/dead-letters
 *
 * Lists dead-lettered cloud_bridge_outbox rows for triage in the
 * /management/cloud-bridge UI. Same PIN gate as the sibling status
 * route — the bridge sits in front of cross-site data and pairing
 * keys, so PIC authority is required.
 *
 * Query: ?location=<id> scopes to one site (defaults to the current
 * location). Returns full payload (rows JSON-parsed) so the UI can
 * render the inspect modal without a second round-trip.
 */

import { hasPinCookie, pinRequiredForPic } from '../../../../lib/pin';
import { listDeadLetters, deadLetterDepth, depth } from '../../../../lib/cloudBridgeQueue';
import { isCloudBridgeConfigured } from '../../../../lib/cloudBridge';
import { locationFromRequest } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const location = locationFromRequest(req);
    const deadLetters = listDeadLetters({ locationId: location });
    return Response.json({
      configured: isCloudBridgeConfigured(),
      location,
      queued_depth: depth(),
      dead_letter_depth_total: deadLetterDepth(),
      dead_letters: deadLetters,
    });
  } catch (err) {
    console.error('GET /api/cloud-bridge/dead-letters failed:', err);
    return Response.json(
      { error: 'Failed to load dead letters' },
      { status: 500 },
    );
  }
}
