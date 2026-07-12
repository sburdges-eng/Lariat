// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../lib/db';
import { logAuditAction } from '../../../../../lib/auditLog.mjs';
import { locationFromRequest } from '../../../../../lib/location';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../../../lib/pin';
import {
  validateName,
  validatePatchKeys,
  clipText,
  SCRATCH_NOTES_MAX,
} from '../../../../../lib/specialsValidators';
import { withIdempotency } from '../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

/**
 * `SELECT *` row from the specials table. Only the field this route reads
 * directly is typed; archived_at is nullable per lib/db.ts CREATE TABLE.
 * @typedef {{ archived_at: number | null } & Record<string, unknown>} SpecialsRow
 */

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string | undefined} id
 * @param {string} locationId
 * @returns {SpecialsRow | undefined}
 */
function loadRow(db, id, locationId) {
  return /** @type {SpecialsRow | undefined} */ (db.prepare(`
    SELECT * FROM specials
    WHERE id = ? AND location_id = ? AND archived_at IS NULL
  `).get(id, locationId));
}

/**
 * @param {ReturnType<typeof getDb>} db
 * @param {string | undefined} id
 * @param {string} locationId
 * @returns {SpecialsRow | undefined}
 */
function loadAnyRow(db, id, locationId) {
  return /** @type {SpecialsRow | undefined} */ (db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(id, locationId));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function GET(req, { params }) {

  params = await params;
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'menu.specials_edit'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const id = params.id;
  const locationId = locationFromRequest(req);
  const db = getDb();
  const row = loadAnyRow(db, id, locationId);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(row, { status: 200 });
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function PATCH(req, ctx) {
  return withIdempotency(req, () => specialsSavedPatchHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function specialsSavedPatchHandler(req, { params }) {

  params = await params;
  // Auth first — don't waste a JSON parse on an unauthenticated body.
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'menu.specials_edit'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'request body must be a JSON object' }, { status: 400 });
  }

  const keysRes = validatePatchKeys(body);
  if (!keysRes.ok) {
    if (keysRes.rejected.length === 0) {
      return Response.json({ error: 'no fields to update' }, { status: 400 });
    }
    return Response.json({ error: 'fields not editable', rejected: keysRes.rejected }, { status: 400 });
  }

  const updates = {};
  if ('name' in body) {
    const r = validateName(body.name);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    updates.name = r.value;
  }
  if ('scratch_notes' in body) {
    if (typeof body.scratch_notes !== 'string') {
      return Response.json({ error: 'scratch_notes must be a string' }, { status: 400 });
    }
    // Clip to prevent runaway disk usage from pasted-in essays.
    // See lib/specialsValidators.ts for the rationale.
    updates.scratch_notes = clipText(body.scratch_notes, SCRATCH_NOTES_MAX);
  }

  const id = params.id;
  const locationId = locationFromRequest(req);
  const now = Date.now();

  const db = getDb();
  const existing = loadRow(db, id, locationId);
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 });

  const SAFE_COLS = new Set(['name', 'scratch_notes']);
  const setFragments = Object.keys(updates).map((k) => {
    if (!SAFE_COLS.has(k)) throw new Error(`refusing to UPDATE unsafe column: ${k}`);
    return `${k} = @${k}`;
  }).concat(['updated_at = @updated_at']);
  const stmt = db.prepare(`UPDATE specials SET ${setFragments.join(', ')} WHERE id = @id AND location_id = @location_id`);

  const txn = db.transaction((args) => {
    stmt.run(args);
    logAuditAction({
      action: 'specials.update',
      special_id: id,
      changed: Object.keys(updates),
      location_id: locationId,
    });
  });
  txn({ ...updates, updated_at: now, id, location_id: locationId });

  return Response.json({ ok: true }, { status: 200 });
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function DELETE(req, ctx) {
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'menu.specials_edit'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return withIdempotency(req, () => specialsSavedDeleteHandler(req, ctx));
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
async function specialsSavedDeleteHandler(req, { params }) {

  params = await params;
  const id = params.id;
  const locationId = locationFromRequest(req);
  const now = Date.now();
  const db = getDb();

  const existing = loadAnyRow(db, id, locationId);
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
  if (existing.archived_at !== null) return Response.json({ ok: true }, { status: 200 });

  const stmt = db.prepare('UPDATE specials SET archived_at = ?, updated_at = ? WHERE id = ? AND location_id = ?');
  const txn = db.transaction(() => {
    stmt.run(now, now, id, locationId);
    logAuditAction({
      action: 'specials.delete',
      special_id: id,
      location_id: locationId,
    });
  });
  txn();

  return Response.json({ ok: true }, { status: 200 });
}
