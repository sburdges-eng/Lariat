// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * POST /api/shows/[id]/capacity — set or clear the per-show capacity
 * override stored on `shows.status_json.capacity`.
 *
 * Body: { capacity: number | null, location_id?, actor_cook_id? }
 *   capacity > 0  → overrides locations.capacity for the tonight tile
 *   capacity null → deletes the key, falling back to the venue default
 *
 * Single-key surgical update — read status_json, merge or delete, write
 * the row back, log a management-action audit line, all inside one
 * db.transaction. PIN-gated; mirrors the pattern in
 * app/api/shows/[id]/box-office/[lineId]/route.js (no new repo file).
 */

import { getDb } from '../../../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../../../lib/location';
import { requirePinOrScope } from '../../../../../lib/pin';
import { withIdempotency } from '../../../../../lib/idempotency';
import { logAuditAction } from '../../../../../lib/auditLog.mjs';

export const dynamic = 'force-dynamic';

const SCOPE = 'event.show_capacity';
const MAX_CAPACITY = 5000;

function parseShowId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(req, ctx) {
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => capacityPostHandler(req, ctx));
}

async function capacityPostHandler(req, { params }) {

  params = await params;
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

  const raw = body?.capacity;
  let nextCapacity;
  if (raw === null || raw === undefined || raw === '') {
    nextCapacity = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return Response.json({ error: 'capacity must be a finite number or null' }, { status: 400 });
    }
    if (n <= 0) {
      // 0 / negative deletes the override (treated as "clear")
      nextCapacity = null;
    } else if (n > MAX_CAPACITY) {
      return Response.json({ error: `capacity must be <= ${MAX_CAPACITY}` }, { status: 400 });
    } else {
      nextCapacity = Math.floor(n);
    }
  }

  const loc = locationFromBody(body) || locationFromRequest(req);
  const actor = typeof body?.actor_cook_id === 'string' ? body.actor_cook_id : null;

  try {
    const db = getDb();
    const tx = db.transaction(() => {
      const row = db
        .prepare(`SELECT status_json FROM shows WHERE id = ? AND location_id = ?`)
        .get(showId, loc);
      if (!row) throw new Error('NotFound');
      let status = {};
      try {
        const parsed = row.status_json ? JSON.parse(row.status_json) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) status = parsed;
      } catch {
        /* unparseable → reset to {} */
      }
      if (nextCapacity == null) {
        delete status.capacity;
      } else {
        status.capacity = nextCapacity;
      }
      const nextJson = JSON.stringify(status);
      db.prepare(`UPDATE shows SET status_json = ? WHERE id = ? AND location_id = ?`)
        .run(nextJson, showId, loc);
      logAuditAction({
        action: 'show_capacity_set',
        show_id: showId,
        location_id: loc,
        capacity: nextCapacity,
        actor_cook_id: actor,
      });
      return { status, status_json: nextJson };
    });
    const result = tx();
    return Response.json({
      show_id: showId,
      location_id: loc,
      capacity: nextCapacity,
      status_json: JSON.parse(result.status_json),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to set capacity';
    if (msg === 'NotFound') {
      return Response.json({ error: 'Show not found' }, { status: 404 });
    }
    console.error('POST /api/shows/[id]/capacity failed:', err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
