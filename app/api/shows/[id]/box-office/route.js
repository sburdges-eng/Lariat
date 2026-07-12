// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
/**
 * /api/shows/[id]/box-office — Phase 2 event-ops, ticket lines (SCAFFOLD).
 *
 * GET  — return summary + lines for the show.
 * POST — append one box-office line (walkup / comp / etc.).
 *
 * DICE bulk ingest is NOT this route's job — that lands via
 * scripts/ingest-dice.mjs which calls bulkUpsertFromDice() directly.
 *
 * Cash custody is regulated; writes audit through lib/auditEvents.ts (DB
 * stream), not lib/auditLog.mjs. PIN-gated via the /api/shows matcher.
 */

import { getDb } from '../../../../../lib/db';
import { locationFromRequest, locationFromBody } from '../../../../../lib/location';
import { requirePinOrScope } from '../../../../../lib/pin';
import { withIdempotency } from '../../../../../lib/idempotency';
import {
  listLinesForShow,
  summarizeBoxOffice,
  createBoxOfficeLine,
  boxOfficeCompleteness,
} from '../../../../../lib/boxOfficeRepo';

export const dynamic = 'force-dynamic';

/** @typedef {{ params: Promise<{ id?: string }> | { id?: string } }} RouteCtx */

/**
 * @param {unknown} rawId
 * @returns {number | null}
 */
function parseShowId(rawId) {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

const SCOPE = 'event.box_office';

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function GET(req, { params }) {

  params = await params;
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  const showId = parseShowId(params?.id);
  if (showId == null) return Response.json({ error: 'Invalid show id' }, { status: 400 });
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const lines = listLinesForShow(db, showId, loc);
    const summary = summarizeBoxOffice(db, showId, loc);
    return Response.json({
      show_id: showId,
      location_id: loc,
      summary,
      lines,
      completeness: boxOfficeCompleteness(summary),
    });
  } catch (err) {
    console.error('GET /api/shows/[id]/box-office failed:', err);
    return Response.json({ error: 'Failed to load box office' }, { status: 500 });
  }
}

/**
 * @param {Request} req
 * @param {RouteCtx} ctx
 */
export async function POST(req, { params }) {

  params = await params;
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => boxOfficePostHandler(req, { params }));
}

/**
 * @param {Request} req
 * @param {{ params: { id?: string } }} ctx — params already awaited by POST
 */
async function boxOfficePostHandler(req, { params }) {
  const showId = parseShowId(params?.id);
  if (showId == null) return Response.json({ error: 'Invalid show id' }, { status: 400 });

  /** @type {Record<string, unknown>} */
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const loc = locationFromBody(body);
  try {
    const db = getDb();
    const line = createBoxOfficeLine(db, {
      show_id: showId,
      location_id: loc,
      // Cast: createBoxOfficeLine's VALID_SOURCES guard rejects invalid values at runtime (throws → 400 below).
      source: /** @type {import('../../../../../lib/boxOfficeRepo').BoxOfficeSource} */ (body?.source),
      ticket_class: typeof body?.ticket_class === 'string' ? body.ticket_class : null,
      qty: Number(body?.qty),
      face_price: body?.face_price != null ? Number(body.face_price) : null,
      fees: body?.fees != null ? Number(body.fees) : null,
      external_ref: typeof body?.external_ref === 'string' ? body.external_ref : null,
      notes: typeof body?.notes === 'string' ? body.notes.slice(0, 4000) : null,
      actor_cook_id: typeof body?.actor_cook_id === 'string' ? body.actor_cook_id : null,
    });
    return Response.json({ show_id: showId, location_id: loc, line }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create box-office line';
    console.error('POST /api/shows/[id]/box-office failed:', err);
    return Response.json({ error: msg }, { status: 400 });
  }
}
