/**
 * /api/shows/[id]/sound/spl — V3 SPL telemetry.
 *
 * GET  — list recent dB readings for the show (ordered oldest→newest
 *        so the sparkline draws left-to-right). Optional ?since= /
 *        ?limit= query params.
 * POST — append one reading. Body: { db_value, scene_id?, location_id,
 *        taken_by_cook_id?, notes? }. Returns the inserted row plus
 *        a freshly-computed summarizeSpl.
 *
 * PIN-gated via the same scope as the sound-scene endpoints
 * (`event.sound_config`) — the middleware /api/shows matcher still
 * applies, but we defend in depth so curl/replay can't bypass.
 */

import { getDb } from '../../../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../../../lib/location';
import { requirePinOrScope } from '../../../../../../lib/pin';
import {
  appendSplReading,
  listSplReadings,
  getLatestSoundScene,
} from '../../../../../../lib/soundRepo';
import { summarizeSpl } from '../../../../../../lib/splTelemetry';
import { withIdempotency } from '../../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const SCOPE = 'event.sound_config';

function parseShowId(rawId) {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(req, { params }) {
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  const showId = parseShowId(params?.id);
  if (showId == null) {
    return Response.json({ error: 'Invalid show id' }, { status: 400 });
  }
  try {
    const u = new URL(req.url);
    const since = u.searchParams.get('since') || undefined;
    const rawLimit = u.searchParams.get('limit');
    const limit = rawLimit ? Number(rawLimit) : undefined;
    const loc = locationFromRequest(req);
    const db = getDb();
    const readings = listSplReadings(db, showId, loc, {
      sinceIso: since,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    const latestScene = getLatestSoundScene(db, showId, loc);
    const summary = summarizeSpl(readings, latestScene?.spl_limit_db ?? null);
    return Response.json({
      show_id: showId,
      location_id: loc,
      readings,
      summary,
      latest_scene_id: latestScene?.id ?? null,
      latest_scene_spl_limit_db: latestScene?.spl_limit_db ?? null,
    });
  } catch (err) {
    console.error('GET /api/shows/[id]/sound/spl failed:', err);
    return Response.json({ error: 'Failed to load SPL readings' }, { status: 500 });
  }
}

export async function POST(req, ctx) {
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => splPostHandler(req, ctx));
}

async function splPostHandler(req, { params }) {
  const showId = parseShowId(params?.id);
  if (showId == null) {
    return Response.json({ error: 'Invalid show id' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const dbValueRaw = body?.db_value;
  if (typeof dbValueRaw !== 'number' && typeof dbValueRaw !== 'string') {
    return Response.json({ error: 'db_value required' }, { status: 400 });
  }
  const dbValue = Number(dbValueRaw);
  if (!Number.isFinite(dbValue)) {
    return Response.json({ error: 'db_value must be a finite number' }, { status: 400 });
  }

  const sceneIdRaw = body?.scene_id;
  let sceneId = null;
  if (sceneIdRaw != null) {
    const n = Number(sceneIdRaw);
    if (!Number.isInteger(n) || n <= 0) {
      return Response.json({ error: 'scene_id must be a positive integer' }, { status: 400 });
    }
    sceneId = n;
  }

  const loc = locationFromBody(body);
  const takenBy = typeof body?.taken_by_cook_id === 'string' ? body.taken_by_cook_id : null;
  const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null;

  try {
    const db = getDb();
    const row = appendSplReading(db, {
      show_id: showId,
      location_id: loc,
      scene_id: sceneId,
      db_value: dbValue,
      taken_by_cook_id: takenBy,
      notes,
    });
    const readings = listSplReadings(db, showId, loc, { limit: 200 });
    const latestScene = getLatestSoundScene(db, showId, loc);
    const summary = summarizeSpl(readings, latestScene?.spl_limit_db ?? null);
    return Response.json(
      {
        show_id: showId,
        location_id: loc,
        reading: row,
        readings,
        summary,
        latest_scene_id: latestScene?.id ?? null,
        latest_scene_spl_limit_db: latestScene?.spl_limit_db ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to append SPL reading';
    if (msg.startsWith('db_value') || msg.startsWith('show_id')) {
      return Response.json({ error: msg }, { status: 400 });
    }
    console.error('POST /api/shows/[id]/sound/spl failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
