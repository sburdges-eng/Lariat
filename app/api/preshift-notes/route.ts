import { getDb, todayISO, getPreshiftNote, todayServiceLabel } from '../../../lib/db';
import {
  DEFAULT_LOCATION_ID,
  locationFromBody,
  locationFromRequest,
} from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const MAX_BODY = 4000;

function cleanBody(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY) : t;
}

function cleanService(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, 32);
}

/** GET /api/preshift-notes?date=YYYY-MM-DD&service=Dinner */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const location_id = locationFromRequest(req as any) || DEFAULT_LOCATION_ID;
  const shift_date = url.searchParams.get('date') || todayISO();

  // If client didn't pass ?service=…, resolve today's label from service_hours.
  let service_label: string | null;
  const paramSvc = url.searchParams.get('service');
  if (paramSvc !== null) {
    service_label = cleanService(paramSvc);
  } else {
    service_label = todayServiceLabel(location_id);
  }

  const note = getPreshiftNote(location_id, shift_date, service_label);
  return Response.json({ location_id, shift_date, service_label, note });
}

/** POST /api/preshift-notes — upsert by (location, shift_date, service_label). */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const text = cleanBody(body.body);
    if (!text) {
      return Response.json({ error: 'body is required' }, { status: 400 });
    }

    const shift_date = typeof body.shift_date === 'string' && body.shift_date.trim()
      ? body.shift_date.trim().slice(0, 32)
      : todayISO();
    const location_id = locationFromBody(body);
    const service_label = 'service_label' in body
      ? cleanService(body.service_label)
      : todayServiceLabel(location_id);
    const cook_id = typeof body.cook_id === 'string' ? body.cook_id.trim().slice(0, 64) || null : null;

    const db = getDb();

    // SQLite treats each NULL as distinct in UNIQUE constraints, so an
    // ON CONFLICT(location_id, shift_date, service_label) UPSERT silently
    // inserts a duplicate row when service_label is NULL (prep-day case).
    // Branch explicitly at the route layer: pre-check with a NULL-tolerant
    // SELECT, then INSERT or UPDATE. The whole thing runs inside a single
    // db.transaction so reads+writes are serialized (better-sqlite3 is
    // synchronous — the race window is eliminated).
    const upsert = db.transaction(() => {
      const existing = db
        .prepare(
          `SELECT id FROM preshift_notes
            WHERE location_id = ? AND shift_date = ?
              AND (service_label IS ? OR service_label = ?)
            LIMIT 1`,
        )
        .get(location_id, shift_date, service_label, service_label) as
          | { id: number }
          | undefined;

      let row: { id: number };
      let auditAction: 'insert' | 'update';

      if (existing) {
        db.prepare(
          `UPDATE preshift_notes
              SET body = ?,
                  author_cook_id = ?,
                  updated_at = datetime('now')
            WHERE id = ?`,
        ).run(text, cook_id, existing.id);
        row = db
          .prepare('SELECT * FROM preshift_notes WHERE id = ?')
          .get(existing.id) as { id: number };
        auditAction = 'update';
      } else {
        const info = db
          .prepare(
            `INSERT INTO preshift_notes
               (location_id, shift_date, service_label, body, author_cook_id)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(location_id, shift_date, service_label, text, cook_id);
        row = db
          .prepare('SELECT * FROM preshift_notes WHERE id = ?')
          .get(info.lastInsertRowid) as { id: number };
        auditAction = 'insert';
      }

      postAuditEvent({
        entity: 'preshift_notes',
        entity_id: Number(row.id),
        action: auditAction,
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date,
        location_id,
      });

      return row;
    });

    const note = upsert();
    return Response.json({ ok: true, note });
  } catch (err) {
    console.error('POST /api/preshift-notes failed:', err);
    return Response.json({ error: 'Failed to save pre-shift note' }, { status: 500 });
  }
}
