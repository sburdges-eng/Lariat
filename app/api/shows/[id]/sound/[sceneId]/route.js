/**
 * /api/shows/[id]/sound/[sceneId] — Phase 2 sound scene edit / delete.
 *
 * PATCH  — partial update of an existing sound_scenes row. The Sound
 *          board autosaves (30s + onBlur + beforeunload) by PATCHing
 *          the same scene id once it has one — first save POSTs to
 *          ../sound and gets back an id, then every subsequent save
 *          targets this route.
 * DELETE — drop a saved scene (e.g. accidental save).
 *
 * Both write a file-audit row inside the same db.transaction as the
 * UPDATE/DELETE, so an audit failure rolls back the source mutation.
 * PIN-gated defensively in addition to the middleware matcher.
 */

import { getDb } from '../../../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../../../lib/location';
import { hasPinCookie, pinRequiredForPic } from '../../../../../../lib/pin';
import {
  updateSoundScene,
  deleteSoundScene,
} from '../../../../../../lib/soundRepo';

export const dynamic = 'force-dynamic';

function parsePositiveInt(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

export async function PATCH(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const showId = parsePositiveInt(params?.id);
  const sceneId = parsePositiveInt(params?.sceneId);
  if (showId == null || sceneId == null) {
    return Response.json({ error: 'Invalid show or scene id' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const loc = locationFromBody(body) || locationFromRequest(req);

  const patch = {};
  if (typeof body?.scene_name === 'string') patch.scene_name = body.scene_name;
  if (body?.plot && typeof body.plot === 'object') patch.plot = body.plot;
  if (body?.spl_limit_db !== undefined) {
    patch.spl_limit_db = Number.isFinite(Number(body.spl_limit_db))
      ? Number(body.spl_limit_db)
      : null;
  }
  if (body?.notes !== undefined) {
    patch.notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null;
  }
  if (typeof body?.saved_by_cook_id === 'string') patch.saved_by_cook_id = body.saved_by_cook_id;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'No patch fields supplied' }, { status: 400 });
  }

  try {
    const db = getDb();
    const scene = updateSoundScene(db, sceneId, loc, patch);
    return Response.json({ show_id: showId, location_id: loc, scene });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update sound scene';
    if (msg === 'NotFound') return Response.json({ error: 'NotFound' }, { status: 404 });
    if (msg.startsWith('scene_name')) return Response.json({ error: msg }, { status: 400 });
    console.error('PATCH /api/shows/[id]/sound/[sceneId] failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const sceneId = parsePositiveInt(params?.sceneId);
  if (sceneId == null) {
    return Response.json({ error: 'Invalid scene id' }, { status: 400 });
  }
  const loc = locationFromRequest(req);
  try {
    const db = getDb();
    deleteSoundScene(db, sceneId, loc);
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete sound scene';
    if (msg === 'NotFound') return Response.json({ error: 'NotFound' }, { status: 404 });
    console.error('DELETE /api/shows/[id]/sound/[sceneId] failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
