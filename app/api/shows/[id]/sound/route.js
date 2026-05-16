// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * /api/shows/[id]/sound — Phase 2 event-ops, sound scenes (SCAFFOLD).
 *
 * GET  — list saved scenes for the show.
 * POST — create a new scene.
 *
 * Multiple scenes per show — the band saves several (soundcheck, set 1,
 * encore). The sound engineer page autosaves with a draft scene name,
 * promotes to a final scene on "Save scene" click. PIN-gated via the
 * /api/shows matcher.
 */

import { getDb } from '../../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../../lib/location';
import { requirePinOrScope } from '../../../../../lib/pin';
import {
  listSoundScenesForShow,
  createSoundScene,
  soundCompleteness,
} from '../../../../../lib/soundRepo';
import { withIdempotency } from '../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

function parseShowId(rawId) {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

const SCOPE = 'event.sound_config';

export async function GET(req, { params }) {

  params = await params;
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  const showId = parseShowId(params?.id);
  if (showId == null) return Response.json({ error: 'Invalid show id' }, { status: 400 });
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const scenes = listSoundScenesForShow(db, showId, loc);
    return Response.json({
      show_id: showId,
      location_id: loc,
      scenes,
      completeness: soundCompleteness(scenes),
    });
  } catch (err) {
    console.error('GET /api/shows/[id]/sound failed:', err);
    return Response.json({ error: 'Failed to load sound scenes' }, { status: 500 });
  }
}

export async function POST(req, ctx) {
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => soundPostHandler(req, ctx));
}

async function soundPostHandler(req, { params }) {

  params = await params;
  const showId = parseShowId(params?.id);
  if (showId == null) return Response.json({ error: 'Invalid show id' }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const sceneName = typeof body?.scene_name === 'string' ? body.scene_name.trim() : '';
  if (!sceneName) {
    return Response.json({ error: 'scene_name required' }, { status: 400 });
  }
  const plot = body?.plot && typeof body.plot === 'object'
    ? body.plot
    : { channels: [], monitors: [] };
  const loc = locationFromBody(body);
  const splLimit = Number.isFinite(Number(body?.spl_limit_db)) ? Number(body.spl_limit_db) : null;
  const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 4000) : null;
  const actor = typeof body?.saved_by_cook_id === 'string' ? body.saved_by_cook_id : null;

  try {
    const db = getDb();
    const scene = createSoundScene(db, {
      show_id: showId,
      location_id: loc,
      scene_name: sceneName,
      plot,
      spl_limit_db: splLimit,
      notes,
      saved_by_cook_id: actor,
    });
    return Response.json({ show_id: showId, location_id: loc, scene }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create sound scene';
    console.error('POST /api/shows/[id]/sound failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
