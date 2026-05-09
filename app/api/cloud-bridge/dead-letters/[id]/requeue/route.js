/**
 * POST /api/cloud-bridge/dead-letters/[id]/requeue
 *
 * Manager action: take a dead-lettered cloud_bridge_outbox row and put
 * it back in the active queue. Resets attempts to 0 (fresh retry
 * budget), drops the claimed_at tombstone, clears last_error.
 *
 * Same PIN gate as the sibling status / dead-letters list routes.
 *
 * Audit: writes a `cloud_bridge_dead_letter_requeued` row to the
 * management-actions JSONL via lib/auditLog.mjs (per docs/PATTERNS.md
 * §3 — out-of-regulated-tables actions go to file audit, not
 * audit_events).
 *
 * Response: 200 with the requeued row metadata; 404 if the id is
 * unknown or already alive (caller should refresh).
 */

import { requirePin } from '../../../../../../lib/pin';
import {
  getDeadLetter,
  requeueDeadLetter,
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
  return withIdempotency(req, () => requeueDeadLetterPostHandler(req, ctx));
}

async function requeueDeadLetterPostHandler(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  const id = parseId(params?.id);
  if (id === null) {
    return Response.json({ error: 'Bad id' }, { status: 400 });
  }

  try {
    // Snapshot before mutating so the audit row records what was acted
    // on (table, location, prior attempts, last_error). Also lets us
    // 404 cleanly when the row isn't dead-lettered (or doesn't exist).
    const before = getDeadLetter(id);
    if (!before) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // Cross-location IDOR guard: a caller scoped to site-A must not be
    // able to act on a row whose location_id is site-B by guessing the
    // numeric id. Surfaced as 404 (not 403) so the existence of a row
    // at another site doesn't leak. If the caller didn't pass ?location=
    // we default to DEFAULT_LOCATION_ID per locationFromRequest, which
    // matches the GET list scope.
    const callerLocation = locationFromRequest(req);
    if (before.locationId !== callerLocation) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const ok = requeueDeadLetter(id);
    if (!ok) {
      // Race: row went alive between getDeadLetter and requeueDeadLetter.
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    logAuditAction({
      action: 'cloud_bridge_dead_letter_requeued',
      changes: {
        batch_id: before.id,
        table: before.table,
        location_id: before.locationId,
        prior_attempts: before.attempts,
        prior_error: before.lastError,
      },
    });

    return Response.json({
      ok: true,
      batch_id: before.id,
      table: before.table,
      location_id: before.locationId,
    });
  } catch (err) {
    console.error('POST /api/cloud-bridge/dead-letters/[id]/requeue failed:', err);
    return Response.json(
      { error: 'Failed to requeue dead letter' },
      { status: 500 },
    );
  }
}
