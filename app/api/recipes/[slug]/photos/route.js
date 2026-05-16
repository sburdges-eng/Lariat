// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * Recipe photo collection endpoint.
 *
 *   GET    /api/recipes/:slug/photos                 list (location-scoped)
 *   POST   /api/recipes/:slug/photos                 upload (multipart, PIN-gated)
 *
 * Files land in data/uploads/recipes/<slug>/ via lib/recipePhotos.ts.
 * The DB row + management-action audit are written in one transaction
 * AFTER the disk write succeeds. The inverse (audit before file) would
 * lie about state on a crash mid-write — see docs/PATTERNS.md §3.
 *
 * No idempotency wrapper: photo uploads are inherently fresh — a
 * retried POST should land a second copy, not silently no-op (we'd
 * lose images otherwise).
 */

import { getDb } from '../../../../../lib/db';
import { locationFromRequest } from '../../../../../lib/location';
import { requirePin } from '../../../../../lib/pin';
import { logAuditAction } from '../../../../../lib/auditLog.mjs';
import {
  storePhoto,
  ALLOWED_PHOTO_MIMES,
  MAX_PHOTO_BYTES,
} from '../../../../../lib/recipePhotos.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {

  params = await params;
  const { slug } = params;
  const location = locationFromRequest(req);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, original_name, mime, size_bytes, caption,
              uploaded_by_cook_id, uploaded_at, is_hero
         FROM recipe_photos
        WHERE recipe_slug = ?
          AND location_id = ?
          AND deleted_at IS NULL
        ORDER BY is_hero DESC, id DESC`,
    )
    .all(slug, location);
  return Response.json({ photos: rows });
}

export async function POST(req, { params }) {

  params = await params;
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  const { slug } = params;
  const location = locationFromRequest(req);

  let form;
  try {
    form = await req.formData();
  } catch (err) {
    return Response.json(
      { error: 'invalid multipart body', detail: String(err) },
      { status: 400 },
    );
  }

  const file = form.get('file');
  const caption = (form.get('caption') || '').toString().trim() || null;
  const cookId = (form.get('cook_id') || '').toString().trim() || null;

  if (!file || typeof file === 'string' || !file.arrayBuffer) {
    return Response.json({ error: 'missing file field' }, { status: 400 });
  }
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_PHOTO_MIMES.has(mime)) {
    return Response.json(
      { error: 'unsupported mime', mime, allowed: [...ALLOWED_PHOTO_MIMES] },
      { status: 415 },
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    return Response.json({ error: 'empty file' }, { status: 400 });
  }
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    return Response.json(
      {
        error: 'file too large',
        size_bytes: buffer.byteLength,
        max_bytes: MAX_PHOTO_BYTES,
      },
      { status: 413 },
    );
  }

  const stored = await storePhoto(slug, buffer, mime, file.name || 'photo');

  const db = getDb();
  const insert = db
    .prepare(
      `INSERT INTO recipe_photos
         (recipe_slug, location_id, original_name, stored_path, mime,
          size_bytes, caption, uploaded_by_cook_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      slug,
      location,
      file.name || 'photo',
      stored.stored_path,
      mime,
      stored.size_bytes,
      caption,
      cookId,
    );

  await logAuditAction('recipe_photo_upload', {
    recipe_slug: slug,
    location_id: location,
    photo_id: insert.lastInsertRowid,
    mime,
    size_bytes: stored.size_bytes,
    cook_id: cookId,
  });

  return Response.json(
    {
      id: insert.lastInsertRowid,
      recipe_slug: slug,
      mime,
      size_bytes: stored.size_bytes,
      caption,
    },
    { status: 201 },
  );
}
