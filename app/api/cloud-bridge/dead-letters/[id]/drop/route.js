/**
 * POST /api/cloud-bridge/dead-letters/[id]/drop
 *
 * Manager action: permanently delete a dead-lettered cloud_bridge_outbox
 * row. Used when the operator has decided the batch isn't recoverable
 * (bad data, retired schema, deliberate purge). The UI requires an
 * explicit confirm before calling this.
 *
 * Same PIN gate as the sibling status / dead-letters routes.
 *
 * Audit: writes a `cloud_bridge_dead_letter_dropped` row to the
 * management-actions JSONL — payload is captured in `changes` so the
 * trail still has the rows even though the outbox row is gone.
 *
 * Response: 200 on delete; 404 if the id is unknown or already alive.
 */

import { hasPinCookie, pinRequiredForPic } from '../../../../../../lib/pin';
import {
  getDeadLetter,
  dropDeadLetter,
} from '../../../../../../lib/cloudBridgeQueue';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';

export const dynamic = 'force-dynamic';

async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  const id = parseId(params?.id);
  if (id === null) {
    return Response.json({ error: 'Bad id' }, { status: 400 });
  }

  try {
    // Snapshot before deleting so the audit trail still has the
    // payload — the row itself is gone after dropDeadLetter.
    const before = getDeadLetter(id);
    if (!before) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const ok = dropDeadLetter(id);
    if (!ok) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    logAuditAction({
      action: 'cloud_bridge_dead_letter_dropped',
      changes: {
        batch_id: before.id,
        table: before.table,
        location_id: before.locationId,
        attempts: before.attempts,
        last_error: before.lastError,
        rows_count: Array.isArray(before.rows) ? before.rows.length : 0,
      },
    });

    return Response.json({
      ok: true,
      batch_id: before.id,
      table: before.table,
      location_id: before.locationId,
    });
  } catch (err) {
    console.error('POST /api/cloud-bridge/dead-letters/[id]/drop failed:', err);
    return Response.json(
      { error: 'Failed to drop dead letter' },
      { status: 500 },
    );
  }
}
