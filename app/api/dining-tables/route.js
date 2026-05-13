// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'seated', 'dirty', 'closed'];

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

const numOrDefault = (v, def) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/**
 * GET /api/dining-tables — list dining tables.
 *
 * Query params:
 *   - location / location_id: site scope
 *
 * Response: { rows } sorted by id ASC.
 */
export async function GET(req) {
  try {
    const loc = locationFromRequest(req);
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, name, capacity, x, y, w, h, status, notes,
                location_id, created_at, updated_at
           FROM dining_tables
          WHERE location_id = ?
          ORDER BY id ASC`,
      )
      .all(loc);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/dining-tables failed:', err);
    return Response.json({ error: 'Could not load dining tables' }, { status: 500 });
  }
}

/**
 * POST /api/dining-tables — create one row.
 *
 * Required: id (<=32), name (<=100).
 * Optional: capacity (1..50, default 2), x, y, w, h, status, notes (<=500).
 *
 * 400 on validation failure. 409 on duplicate (location_id, id).
 */
export async function POST(req) {
  return withIdempotency(req, () => diningTablesPostHandler(req));
}

async function diningTablesPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const id = clip(body.id, 32);
    if (!id) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }
    const name = clip(body.name, 100);
    if (!name) {
      return Response.json({ error: 'name required' }, { status: 400 });
    }

    let capacity = 2;
    if (body.capacity !== undefined && body.capacity !== null) {
      const n = Number(body.capacity);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        return Response.json({ error: 'capacity must be 1..50' }, { status: 400 });
      }
      capacity = n;
    }

    const status = body.status === undefined || body.status === null
      ? 'open'
      : String(body.status);
    if (!STATUSES.includes(status)) {
      return Response.json({ error: 'bad status' }, { status: 400 });
    }

    const x = numOrDefault(body.x, 0);
    const y = numOrDefault(body.y, 0);
    const w = numOrDefault(body.w, 1);
    const h = numOrDefault(body.h, 1);
    const notes = clip(body.notes, 500);

    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO dining_tables
             (id, name, capacity, x, y, w, h, status, notes, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, name, capacity, x, y, w, h, status, notes, loc);

        postAuditEvent({
          entity: 'dining_tables',
          entity_id: 0,
          action: 'insert',
          actor_cook_id: cookId,
          actor_source: 'api',
          location_id: loc,
          payload: { id, name, capacity, status },
        });
      })();
    } catch (err) {
      const msg = String(err?.code || err?.message || '');
      if (
        msg.includes('SQLITE_CONSTRAINT_PRIMARYKEY') ||
        msg.includes('UNIQUE constraint failed') ||
        msg.includes('PRIMARY KEY')
      ) {
        return Response.json({ error: 'id already in use' }, { status: 409 });
      }
      throw err;
    }

    return Response.json({ ok: true, id });
  } catch (err) {
    console.error('POST /api/dining-tables failed:', err);
    return Response.json({ error: 'Could not create dining table' }, { status: 500 });
  }
}
