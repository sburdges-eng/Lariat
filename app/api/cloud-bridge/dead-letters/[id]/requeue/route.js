// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
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
import { requeueDeadLetter } from '../../../../../../lib/cloudBridgeQueue';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';
import { loadScopedDeadLetterTarget } from '../../../../../../lib/cloudBridgeRouteGuards';
import { withIdempotency } from '../../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

export async function POST(req, ctx) {
  return withIdempotency(req, () => requeueDeadLetterPostHandler(req, ctx));
}

async function requeueDeadLetterPostHandler(req, { params }) {

  params = await params;
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    // Snapshot before mutating so the audit row records what was acted
    // on (table, location, prior attempts, last_error). Also lets us
    // 404 cleanly when the row isn't dead-lettered (or doesn't exist).
    const target = loadScopedDeadLetterTarget(req, params?.id);
    if (!target.ok) return target.response;
    const { id, before } = target;

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
