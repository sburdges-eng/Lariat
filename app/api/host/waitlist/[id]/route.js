// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { withIdempotency } from '../../../../../lib/idempotency';
import { logAuditAction } from '../../../../../lib/auditLog.mjs';
import { isValidStatusTransition } from '../../../../../lib/hostStand';

export const dynamic = 'force-dynamic';

// PATCH /api/host/waitlist/[id]
//   Body: { status: 'seated' | 'left', notes? }
//   Transitions allowed: waiting → seated | left. Anything else 409.
// PIN-gated, idempotent, file-stream audit per the operational-data
// pattern (no DB audit_events row).

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */
/** @typedef {import('../../../../../lib/hostStand').WaitlistStatus} WaitlistStatus */

const ALLOWED_NEXT = new Set(['seated', 'left']);

/** @param {unknown} raw @returns {number | null} */
function parsePartyId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function PATCH(req, ctx) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => patchHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function patchHandler(req, { params }) {

  params = await params;
  const id = parsePartyId(params?.id);
  if (id == null) {
    return Response.json({ error: 'Invalid party id' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const next = body?.status;
  if (typeof next !== 'string' || !ALLOWED_NEXT.has(next)) {
    return Response.json(
      { error: `status must be one of ${[...ALLOWED_NEXT].join(', ')}` },
      { status: 400 },
    );
  }

  const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 500) : null;

  try {
    const db = getDb();
    const result = db.transaction(() => {
      const row = /** @type {{ id: number, status: WaitlistStatus, location_id: string } | undefined} */ (db
        .prepare(`SELECT id, status, location_id FROM waitlist_parties WHERE id = ?`)
        .get(id));
      if (!row) return { code: 'NotFound' };
      // `next` is runtime-validated against ALLOWED_NEXT (⊂ WaitlistStatus).
      if (!isValidStatusTransition(row.status, /** @type {WaitlistStatus} */ (next))) {
        return { code: 'BadTransition', from: row.status, to: next };
      }
      const stamp = new Date().toISOString();
      if (next === 'seated') {
        db.prepare(
          `UPDATE waitlist_parties
              SET status = 'seated',
                  seated_at = ?,
                  notes = COALESCE(?, notes),
                  updated_at = ?
            WHERE id = ?`,
        ).run(stamp, notes, stamp, id);
      } else {
        db.prepare(
          `UPDATE waitlist_parties
              SET status = 'left',
                  left_at = ?,
                  notes = COALESCE(?, notes),
                  updated_at = ?
            WHERE id = ?`,
        ).run(stamp, notes, stamp, id);
      }
      logAuditAction({
        action: 'waitlist_status_change',
        waitlist_party_id: id,
        location_id: row.location_id,
        from: row.status,
        to: next,
      });
      return { code: 'ok', location_id: row.location_id };
    })();

    if (result.code === 'NotFound') {
      return Response.json({ error: 'Party not found' }, { status: 404 });
    }
    if (result.code === 'BadTransition') {
      return Response.json(
        { error: `Cannot transition from ${result.from} to ${result.to}` },
        { status: 409 },
      );
    }

    const row = db
      .prepare(
        `SELECT id, location_id, party_name, party_size, joined_at, status,
                seated_at, left_at, phone, notes
           FROM waitlist_parties WHERE id = ?`,
      )
      .get(id);

    return Response.json({ party: row });
  } catch (err) {
    console.error('PATCH /api/host/waitlist/[id] failed:', err);
    return Response.json({ error: 'Failed to update party' }, { status: 500 });
  }
}
