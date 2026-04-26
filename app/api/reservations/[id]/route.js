import { getDb } from '../../../../lib/db';
import { locationFromBody } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

const VERBS = ['seat', 'complete', 'cancel', 'no_show'];

function parseId(params) {
  const id = Number(params?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * PATCH /api/reservations/:id
 *
 * Verbs (mutually exclusive — multiple → 400 'multiple verbs'):
 *   - { seat: true, table_id?, cook_id }     → status='seated', seated_at
 *   - { complete: true, cook_id }            → status='completed', completed_at
 *   - { cancel: true, cook_id }              → status='cancelled', completed_at
 *   - { no_show: true, cook_id }             → status='no_show', completed_at
 *
 * Field edits (no verb required, may also coexist with a non-conflicting
 * verb — e.g. `{ seat: true, notes: 'window seat' }` works):
 *   party_name, party_size, reservation_at, table_id, phone, email, notes
 *
 * Reservation × dining_tables wiring (in the same transaction):
 *   - seat     → linked table.status = 'seated'  (uses body.table_id if
 *                provided, else the reservation's existing table_id)
 *   - complete → linked table.status = 'dirty'
 *   - cancel   → linked table.status = 'open' ONLY if reservation was
 *                already 'seated'; a booked-but-not-seated cancel does
 *                not touch any table
 *   - no_show  → no table touch
 * A stale table_id (no matching dining_tables row) is skipped silently.
 */
export async function PATCH(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({}));

    const activeVerbs = VERBS.filter((v) => body[v] === true);
    if (activeVerbs.length > 1) {
      return Response.json({ error: 'multiple verbs' }, { status: 400 });
    }
    const verb = activeVerbs[0] || null;

    const loc = locationFromBody(body);
    const cookId = clip(body.cook_id, 64);
    const db = getDb();

    const result = db.transaction(() => {
      const row = db
        .prepare(`SELECT * FROM reservations WHERE id = ? AND location_id = ?`)
        .get(id, loc);
      if (!row) return { ok: false, status: 404, err: 'not found' };

      const sets = [];
      const args = [];
      let nextStatus = row.status;

      if (verb === 'seat') {
        nextStatus = 'seated';
        sets.push('status = ?');
        args.push(nextStatus);
        sets.push("seated_at = datetime('now')");
        // table_id may be set by the seat verb directly
        if (body.table_id !== undefined) {
          const tid = clip(body.table_id, 64);
          sets.push('table_id = ?');
          args.push(tid);
        }
      } else if (verb === 'complete') {
        nextStatus = 'completed';
        sets.push('status = ?');
        args.push(nextStatus);
        sets.push("completed_at = datetime('now')");
      } else if (verb === 'cancel') {
        nextStatus = 'cancelled';
        sets.push('status = ?');
        args.push(nextStatus);
        sets.push("completed_at = datetime('now')");
      } else if (verb === 'no_show') {
        nextStatus = 'no_show';
        sets.push('status = ?');
        args.push(nextStatus);
        sets.push("completed_at = datetime('now')");
      }

      // Field edits — only included if present in body.
      // table_id under `seat` was already handled; skip it there.
      if (body.party_name !== undefined) {
        const v = clip(body.party_name, 200);
        if (v !== null && v !== row.party_name) {
          sets.push('party_name = ?');
          args.push(v);
        }
      }
      if (body.party_size !== undefined) {
        const n = Number(body.party_size);
        if (Number.isInteger(n) && n >= 1 && n <= 50 && n !== row.party_size) {
          sets.push('party_size = ?');
          args.push(n);
        }
      }
      if (body.reservation_at !== undefined) {
        const v = clip(body.reservation_at, 64);
        if (v !== null && v !== row.reservation_at) {
          sets.push('reservation_at = ?');
          args.push(v);
        }
      }
      if (body.table_id !== undefined && verb !== 'seat') {
        const v = clip(body.table_id, 64);
        if (v !== row.table_id) {
          sets.push('table_id = ?');
          args.push(v);
        }
      }
      if (body.phone !== undefined) {
        const v = clip(body.phone, 64);
        if (v !== row.phone) {
          sets.push('phone = ?');
          args.push(v);
        }
      }
      if (body.email !== undefined) {
        const v = clip(body.email, 200);
        if (v !== row.email) {
          sets.push('email = ?');
          args.push(v);
        }
      }
      if (body.notes !== undefined) {
        const v = clip(body.notes, 1000);
        if (v !== row.notes) {
          sets.push('notes = ?');
          args.push(v);
        }
      }

      if (sets.length === 0) return { ok: false, status: 400, err: 'no change' };

      sets.push("updated_at = datetime('now')");
      args.push(id);
      db.prepare(`UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`).run(
        ...args,
      );

      postAuditEvent({
        entity: 'reservations',
        entity_id: id,
        action: 'update',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: {
          from_status: row.status,
          to_status: nextStatus,
          verb: verb || undefined,
        },
      });

      // Mirror reservation state changes onto the linked dining_tables row,
      // in the SAME transaction so the two updates are atomic.
      //   seat     → table.status = 'seated' (use new table_id if provided,
      //              otherwise the reservation's existing table_id)
      //   complete → table.status = 'dirty'
      //   cancel   → table.status = 'open' ONLY if the reservation was
      //              previously 'seated'. A 'booked' reservation never
      //              took the table; nothing to release.
      //   no_show  → no table touch (never seated)
      // If the linked table_id points at no row (stale reference), skip
      // silently — the reservation update still stands.
      const touchTable = (tableId, toStatus, triggeredBy) => {
        if (!tableId) return;
        const tRow = db
          .prepare(
            `SELECT id, status FROM dining_tables
              WHERE id = ? AND location_id = ?`,
          )
          .get(tableId, loc);
        if (!tRow) return; // stale table_id — skip silently
        db.prepare(
          `UPDATE dining_tables
              SET status = ?, updated_at = datetime('now')
            WHERE id = ? AND location_id = ?`,
        ).run(toStatus, tableId, loc);
        postAuditEvent({
          entity: 'dining_tables',
          entity_id: 0,
          action: 'update',
          actor_cook_id: cookId,
          actor_source: 'api',
          location_id: loc,
          payload: {
            id: tableId,
            from_status: tRow.status,
            to_status: toStatus,
            triggered_by: triggeredBy,
          },
        });
      };

      if (verb === 'seat') {
        const newTableId =
          body.table_id !== undefined ? clip(body.table_id, 64) : row.table_id;
        touchTable(newTableId, 'seated', 'reservation_seat');
      } else if (verb === 'complete') {
        touchTable(row.table_id, 'dirty', 'reservation_complete');
      } else if (verb === 'cancel') {
        if (row.status === 'seated') {
          touchTable(row.table_id, 'open', 'reservation_cancel');
        }
      }
      // verb === 'no_show' → no table change.

      return { ok: true };
    })();

    if (!result.ok) {
      return Response.json({ error: result.err }, { status: result.status });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/reservations/[id] failed:', err);
    return Response.json({ error: 'Could not update reservation' }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  const id = parseId(params);
  if (!id) return Response.json({ error: 'bad id' }, { status: 400 });
  try {
    const url = new URL(req.url);
    const loc =
      url.searchParams.get('location') ||
      url.searchParams.get('location_id') ||
      'default';
    const cookId = clip(url.searchParams.get('cook_id'), 64);
    const db = getDb();
    const result = db.transaction(() => {
      const info = db
        .prepare(`DELETE FROM reservations WHERE id = ? AND location_id = ?`)
        .run(id, loc);
      if (info.changes === 0) return { ok: false };
      postAuditEvent({
        entity: 'reservations',
        entity_id: id,
        action: 'delete',
        actor_cook_id: cookId,
        actor_source: 'api',
        location_id: loc,
        payload: {},
      });
      return { ok: true };
    })();
    if (!result.ok) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/reservations/[id] failed:', err);
    return Response.json({ error: 'Could not delete reservation' }, { status: 500 });
  }
}
