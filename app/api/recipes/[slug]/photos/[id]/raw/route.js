// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * Stream a stored recipe photo back to the client.
 *
 *   GET /api/recipes/:slug/photos/:id/raw
 *
 * Reads from data/uploads/recipes/ (off-tree, gitignored). No PIN gate
 * on read — recipe pages are visible to staff. If a photo is missing
 * on disk the row is treated as 404 (orphan rows happen after manual
 * file cleanup; the DB row is harmless on its own).
 */

import { getDb } from '../../../../../../../lib/db';
import { locationFromRequest } from '../../../../../../../lib/location';
import { readPhoto } from '../../../../../../../lib/recipePhotos.ts';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const { slug, id } = params;
  const location = locationFromRequest(req);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT stored_path, mime, size_bytes
         FROM recipe_photos
        WHERE id = ?
          AND recipe_slug = ?
          AND location_id = ?
          AND deleted_at IS NULL`,
    )
    .get(id, slug, location);
  if (!row) return new Response('not found', { status: 404 });
  const file = await readPhoto(row.stored_path);
  if (!file) return new Response('file missing', { status: 410 });
  return new Response(file.bytes, {
    status: 200,
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, max-age=300',
    },
  });
}
