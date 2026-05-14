// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * Recipe photo item endpoint — soft-delete only.
 *
 *   DELETE /api/recipes/:slug/photos/:id     soft-delete (PIN-gated)
 *
 * "Soft" means we stamp `deleted_at` and stop showing the row, but the
 * file on disk stays — same pattern as audit_events (the photo may
 * have been part of an audit trail; never destroy evidence silently).
 * A separate maintenance script can hard-delete files older than a
 * retention window once the policy is decided.
 */

import { getDb } from '../../../../../../lib/db';
import { locationFromRequest } from '../../../../../../lib/location';
import { requirePin } from '../../../../../../lib/pin';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';

export const runtime = 'nodejs';

export async function DELETE(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const { slug, id } = params;
  const location = locationFromRequest(req);
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE recipe_photos
          SET deleted_at = datetime('now')
        WHERE id = ?
          AND recipe_slug = ?
          AND location_id = ?
          AND deleted_at IS NULL`,
    )
    .run(id, slug, location);
  if (result.changes === 0) {
    return Response.json({ error: 'photo not found' }, { status: 404 });
  }
  await logAuditAction('recipe_photo_delete', {
    recipe_slug: slug,
    location_id: location,
    photo_id: id,
  });
  return Response.json({ ok: true, id });
}
