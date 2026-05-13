// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/reservations — list reservations (chronological).
 *
 * Query params:
 *   - date: 'YYYY-MM-DD' — restricts to reservations whose reservation_at
 *     starts with that date. Mutually exclusive with from/to (date wins).
 *   - status: filters to one status
 *   - from / to: 'YYYY-MM-DD' inclusive range, only used if date is absent
 *   - location / location_id: site scope
 */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const loc = locationFromRequest(req);

    const where = ['location_id = ?'];
    const args = [loc];

    if (date && DATE_RE.test(date)) {
      where.push('reservation_at LIKE ?');
      args.push(`${date}%`);
    } else if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
      where.push('reservation_at >= ?');
      where.push('reservation_at <= ?');
      args.push(from);
      // include the entire `to` day by extending the upper bound past 23:59
      args.push(`${to} 99:99`);
    }

    if (status && typeof status === 'string' && status.trim()) {
      where.push('status = ?');
      args.push(status.trim());
    }

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, party_name, party_size, reservation_at, status, table_id,
                phone, email, notes, source, source_ref,
                seated_at, completed_at, cook_id, created_at, updated_at
           FROM reservations
          WHERE ${where.join(' AND ')}
          ORDER BY reservation_at ASC, id ASC
          LIMIT 500`,
      )
      .all(...args);
    return Response.json({ rows });
  } catch (err) {
    console.error('GET /api/reservations failed:', err);
    return Response.json({ error: 'Could not load reservations' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => reservationsPostHandler(req));
}

async function reservationsPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const partyName = clip(body.party_name, 200);
    if (!partyName) {
      return Response.json({ error: 'party_name required' }, { status: 400 });
    }
    const partySizeNum = Number(body.party_size);
    if (
      !Number.isInteger(partySizeNum) ||
      partySizeNum < 1 ||
      partySizeNum > 50
    ) {
      return Response.json({ error: 'party_size must be 1..50' }, { status: 400 });
    }
    const reservationAt = clip(body.reservation_at, 64);
    if (!reservationAt) {
      return Response.json({ error: 'reservation_at required' }, { status: 400 });
    }

    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const newId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO reservations
             (party_name, party_size, reservation_at, table_id, phone, email,
              notes, source, source_ref, cook_id, location_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          partyName,
          partySizeNum,
          reservationAt,
          clip(body.table_id, 64),
          clip(body.phone, 64),
          clip(body.email, 200),
          clip(body.notes, 1000),
          clip(body.source, 32) || 'manual',
          clip(body.source_ref, 200),
          cookId,
          loc,
        );
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'reservations',
        entity_id: id,
        action: 'insert',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: {
          party_name: partyName,
          party_size: partySizeNum,
          reservation_at: reservationAt,
        },
      });
      return id;
    })();

    return Response.json({ ok: true, id: newId });
  } catch (err) {
    console.error('POST /api/reservations failed:', err);
    return Response.json({ error: 'Could not save reservation' }, { status: 500 });
  }
}
