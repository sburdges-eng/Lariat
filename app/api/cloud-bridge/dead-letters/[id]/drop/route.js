// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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
 * management-actions JSONL — the full row payload (rows[]) is captured
 * in `changes` so the trail still has the data even after the outbox
 * row is gone. The allow-listed tables (settlement_summaries,
 * beo_events, spend_monthly per ALLOWED_TABLES) are non-PII by design,
 * so capturing the rows in audit is safe; HACCP / sales-line / temp-log
 * surfaces are NOT on the allow-list and never reach this code path.
 *
 * Response: 200 on delete; 404 if the id is unknown or already alive.
 */

import { requirePin } from '../../../../../../lib/pin';
import {
  getDeadLetter,
  dropDeadLetter,
} from '../../../../../../lib/cloudBridgeQueue';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';
import { locationFromRequest } from '../../../../../../lib/location';
import { withIdempotency } from '../../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(req, ctx) {
  return withIdempotency(req, () => dropDeadLetterPostHandler(req, ctx));
}

async function dropDeadLetterPostHandler(req, { params }) {
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

    // Cross-location IDOR guard — see requeue route for the full note.
    const callerLocation = locationFromRequest(req);
    if (before.locationId !== callerLocation) {
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
        // Capture the full payload so an errant drop is recoverable
        // from the audit trail. Allow-list (cloudBridgeQueue.ts) keeps
        // PII out of this column.
        rows: Array.isArray(before.rows) ? before.rows : [],
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
