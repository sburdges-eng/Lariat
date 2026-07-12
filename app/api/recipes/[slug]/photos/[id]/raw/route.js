// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
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

/**
 * Next 15 route context: `params` may be a promise (async dynamic APIs).
 * @typedef {{ params: Promise<{ slug?: string, id?: string }> | { slug?: string, id?: string } }} RouteCtx
 */

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function GET(req, { params }) {

  params = await params;
  const { slug, id } = params;
  const location = locationFromRequest(req);
  const db = getDb();
  // recipe_photos DDL (lib/db.ts): stored_path/mime/size_bytes all NOT NULL.
  const row = /** @type {{ stored_path: string, mime: string, size_bytes: number } | undefined} */ (
    db
      .prepare(
        `SELECT stored_path, mime, size_bytes
           FROM recipe_photos
          WHERE id = ?
            AND recipe_slug = ?
            AND location_id = ?
            AND deleted_at IS NULL`,
      )
      .get(id, slug, location)
  );
  if (!row) return new Response('not found', { status: 404 });
  const file = await readPhoto(row.stored_path);
  if (!file) return new Response('file missing', { status: 410 });
  // Buffer is a Uint8Array — a valid BodyInit at runtime; the cast only
  // bridges @types/node's Buffer<ArrayBufferLike> generic vs BodyInit.
  return new Response(/** @type {BodyInit} */ (file.bytes), {
    status: 200,
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(file.size),
      'Cache-Control': 'private, max-age=300',
      // Stored mime is validated at upload, but never let a browser
      // second-guess it into something scriptable (2026-07-10 audit,
      // #459 adjacent finding).
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
