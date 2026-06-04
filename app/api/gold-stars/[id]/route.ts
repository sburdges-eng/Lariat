import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';
import { requirePin } from '../../../../lib/pin';
import { postAuditEvent } from '../../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  return withIdempotency(req, () => goldStarDeleteHandler(req, ctx));
}

async function goldStarDeleteHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  const resolvedParams = await params;
  const id = Number(resolvedParams?.id);

  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }

  const db = getDb();
  const loc = locationFromRequest(req);

  const row = db
    .prepare(
      `SELECT id, cook_name, reason, stars, awarded_date, location_id, deleted_at
         FROM gold_stars
        WHERE id = ? AND location_id = ?`,
    )
    .get(id, loc) as {
      id: number;
      cook_name: string;
      reason: string;
      stars: number | null;
      awarded_date: string | null;
      location_id: string;
      deleted_at: string | null;
    } | undefined;

  if (!row || row.deleted_at) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  db.transaction(() => {
    db
      .prepare(
        `UPDATE gold_stars
            SET deleted_at = datetime('now'),
                deleted_by = 'manager_pin'
          WHERE id = ? AND location_id = ? AND deleted_at IS NULL`,
      )
      .run(id, loc);
    postAuditEvent({
      entity: 'gold_stars',
      entity_id: id,
      action: 'delete',
      actor_cook_id: null,
      actor_source: 'manager_pin',
      location_id: loc,
      payload: {
        cook_name: row.cook_name,
        reason: row.reason,
        stars: row.stars,
        awarded_date: row.awarded_date,
      },
    });
  })();

  return Response.json({ ok: true, id });
}
