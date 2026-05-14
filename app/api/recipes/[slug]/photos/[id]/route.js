// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * Recipe photo item endpoint — soft-delete and metadata edits.
 *
 *   DELETE /api/recipes/:slug/photos/:id     soft-delete (PIN-gated)
 *   PATCH  /api/recipes/:slug/photos/:id     pin hero / edit caption (PIN-gated)
 *
 * "Soft" means we stamp `deleted_at` and stop showing the row, but the
 * file on disk stays — same pattern as audit_events (the photo may
 * have been part of an audit trail; never destroy evidence silently).
 * A separate maintenance script can hard-delete files older than a
 * retention window once the policy is decided.
 *
 * Hero pin: at most one row per (location_id, recipe_slug) is_hero=1.
 * Setting hero zeroes every peer and sets the target in one tx so the
 * invariant never goes through a "two heroes briefly" state.
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

export async function PATCH(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const { slug, id } = params;
  const location = locationFromRequest(req);

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }

  // Only the listed fields are updatable. Unknown keys are ignored.
  const hasHero = Object.prototype.hasOwnProperty.call(body, 'is_hero');
  if (!hasHero) {
    return Response.json({ error: 'no updatable fields' }, { status: 400 });
  }
  const wantHero = body.is_hero ? 1 : 0;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM recipe_photos
        WHERE id = ?
          AND recipe_slug = ?
          AND location_id = ?
          AND deleted_at IS NULL`,
    )
    .get(id, slug, location);
  if (!row) {
    return Response.json({ error: 'photo not found' }, { status: 404 });
  }

  // One transaction: clear all peers, then set the target. Order
  // matters — clear first so a re-set on the current hero ends up =1
  // without bouncing through =0. Scope = (location_id, recipe_slug).
  const tx = db.transaction(() => {
    if (wantHero === 1) {
      db.prepare(
        `UPDATE recipe_photos
            SET is_hero = 0
          WHERE recipe_slug = ?
            AND location_id = ?
            AND id != ?
            AND is_hero = 1`,
      ).run(slug, location, id);
    }
    db.prepare(
      `UPDATE recipe_photos
          SET is_hero = ?
        WHERE id = ?
          AND recipe_slug = ?
          AND location_id = ?`,
    ).run(wantHero, id, slug, location);
  });
  tx();

  await logAuditAction('recipe_photo_set_hero', {
    recipe_slug: slug,
    location_id: location,
    photo_id: id,
    is_hero: wantHero,
  });

  return Response.json({ ok: true, id, is_hero: wantHero });
}
