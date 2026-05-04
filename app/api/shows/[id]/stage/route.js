/**
 * /api/shows/[id]/stage — Phase 2 event-ops, stage setup.
 *
 * GET   — read the current stage_setups row for (show, location). Returns
 *         null in `setup` when no row exists yet.
 * POST  — UPSERT the stage_setups row. Body shape per UpsertStageSetupInput.
 *
 * PIN-gated via the /api/shows matcher in middleware.js.
 */

import { getDb } from '../../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../../lib/location';
import { hasPinCookie, pinRequiredForPic } from '../../../../../lib/pin';
import {
  getStageSetup,
  upsertStageSetup,
  stageCompleteness,
  isKnownRoomConfig,
  KNOWN_ROOM_CONFIGS,
} from '../../../../../lib/stageRepo';
import { withIdempotency } from '../../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

function parseShowId(rawId) {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}

export async function GET(req, { params }) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const showId = parseShowId(params?.id);
  if (showId == null) {
    return Response.json({ error: 'Invalid show id' }, { status: 400 });
  }
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const setup = getStageSetup(db, showId, loc);
    return Response.json({
      show_id: showId,
      location_id: loc,
      setup,
      completeness: stageCompleteness(setup),
      known_room_configs: KNOWN_ROOM_CONFIGS,
    });
  } catch (err) {
    console.error('GET /api/shows/[id]/stage failed:', err);
    return Response.json({ error: 'Failed to load stage setup' }, { status: 500 });
  }
}

export async function POST(req, ctx) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => stagePostHandler(req, ctx));
}

async function stagePostHandler(req, { params }) {
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

  const roomConfig = typeof body?.room_config === 'string' ? body.room_config : null;
  if (!roomConfig || !isKnownRoomConfig(roomConfig)) {
    return Response.json(
      {
        error: 'room_config required and must be one of KNOWN_ROOM_CONFIGS',
        known: Object.keys(KNOWN_ROOM_CONFIGS),
      },
      { status: 400 },
    );
  }

  const loc = locationFromBody(body);
  const runOfShow = Array.isArray(body?.run_of_show) ? body.run_of_show : [];
  const hospitality = body?.hospitality_rider && typeof body.hospitality_rider === 'object'
    ? body.hospitality_rider
    : {};
  const tech = body?.tech_rider && typeof body.tech_rider === 'object' ? body.tech_rider : {};
  const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 4000) : null;
  const actor = typeof body?.actor_cook_id === 'string' ? body.actor_cook_id : null;

  try {
    const db = getDb();
    const result = upsertStageSetup(db, {
      show_id: showId,
      location_id: loc,
      room_config: roomConfig,
      run_of_show: runOfShow,
      hospitality_rider: hospitality,
      tech_rider: tech,
      notes,
      actor_cook_id: actor,
    });
    return Response.json({
      show_id: showId,
      location_id: loc,
      setup: result.setup,
      created: result.created,
      completeness: stageCompleteness(result.setup),
    }, { status: result.created ? 201 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save stage setup';
    console.error('POST /api/shows/[id]/stage failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
