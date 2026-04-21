// Meal / rest break tracking (L1 / CO COMPS #39).
//
// POST  /api/breaks    → start a break
// PATCH /api/breaks    → end the open break (or mark waived)
// GET   /api/breaks    → breaks for a shift + COMPS evaluation

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { evaluateShift } from '../../../lib/breaks';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/breaks ──────────────────────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json();
    const kind = clip(body.kind, 8);
    if (kind !== 'meal' && kind !== 'rest') {
      return Response.json({ error: 'kind must be "meal" or "rest"' }, { status: 400 });
    }
    const cook_id = clip(body.cook_id, 64);
    if (!cook_id) {
      return Response.json({ error: 'cook_id is required' }, { status: 400 });
    }
    const started_at = clip(body.started_at, 40) || new Date().toISOString();
    if (!Number.isFinite(Date.parse(started_at))) {
      return Response.json({ error: 'started_at must be an ISO timestamp' }, { status: 400 });
    }
    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const waived = body.waived ? 1 : 0;
    const waiver_ref = clip(body.waiver_ref, 300);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null;

    if (waived && kind !== 'meal') {
      return Response.json(
        { error: 'only meal breaks can be waived under COMPS #39' },
        { status: 400 },
      );
    }
    if (waived && !waiver_ref) {
      return Response.json(
        { error: 'meal-break waivers must reference a signed document (waiver_ref)' },
        { status: 400 },
      );
    }

    const db = getDb();
    // Reject overlapping OPEN breaks for the same cook — a cook cannot
    // be on two breaks at once, and leaving a prior break open is
    // usually a forgot-to-end bug the manager should resolve.
    const open = db.prepare(`
      SELECT id FROM shift_breaks
       WHERE location_id=? AND cook_id=? AND ended_at IS NULL AND waived=0
       ORDER BY started_at DESC LIMIT 1
    `).get(location_id, cook_id);
    if (open) {
      return Response.json(
        { error: 'cook has an open break', open_break_id: open.id },
        { status: 409 },
      );
    }

    // A waived meal is entered as a single completed row: started_at =
    // shift start or meal-time, ended_at = same (duration 0 — the cook
    // stayed on duty), waived = 1. The evaluator treats waived rows
    // as "provided but taken on duty."
    const ended_at = waived ? started_at : null;
    const duration_min = waived ? 0 : null;

    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO shift_breaks
          (shift_date, location_id, cook_id, kind, started_at, ended_at, duration_min, waived, waiver_ref, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(shift_date, location_id, cook_id, kind, started_at, ended_at, duration_min, waived, waiver_ref, note);

      const row = db.prepare('SELECT * FROM shift_breaks WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'shift_breaks',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date,
        location_id,
      });

      return row;
    });

    const row = performWrite();

    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/breaks failed:', err);
    return Response.json({ error: 'Failed to start break' }, { status: 500 });
  }
}

// ── PATCH /api/breaks ─────────────────────────────────────────────

export async function PATCH(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const ended_at = clip(body.ended_at, 40) || new Date().toISOString();
    if (!Number.isFinite(Date.parse(ended_at))) {
      return Response.json({ error: 'ended_at must be an ISO timestamp' }, { status: 400 });
    }
    const cook_id = clip(body.cook_id, 64);

    const db = getDb();
    const existing = db.prepare('SELECT * FROM shift_breaks WHERE id=?').get(id);
    if (!existing) {
      return Response.json({ error: 'unknown break' }, { status: 404 });
    }
    if (existing.ended_at) {
      return Response.json(
        { error: 'break already ended', entry: existing },
        { status: 409 },
      );
    }
    const startMs = Date.parse(existing.started_at);
    const endMs = Date.parse(ended_at);
    if (endMs <= startMs) {
      return Response.json(
        { error: 'ended_at must be after started_at' },
        { status: 400 },
      );
    }
    const duration_min = (endMs - startMs) / 60000;

    const performUpdate = db.transaction(() => {
      db.prepare(`
        UPDATE shift_breaks SET ended_at=?, duration_min=? WHERE id=?
      `).run(ended_at, duration_min, id);

      const updated = db.prepare('SELECT * FROM shift_breaks WHERE id=?').get(id);
      
      postAuditEvent({
        entity: 'shift_breaks',
        entity_id: id,
        action: 'update',
        actor_cook_id: cook_id || existing.cook_id,
        actor_source: 'cook_ui',
        payload: updated,
        shift_date: existing.shift_date,
        location_id: existing.location_id,
      });

      return updated;
    });

    const updated = performUpdate();

    return Response.json({ ok: true, entry: updated });
  } catch (err) {
    console.error('PATCH /api/breaks failed:', err);
    return Response.json({ error: 'Failed to end break' }, { status: 500 });
  }
}

// ── GET /api/breaks ───────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const cook_id = url.searchParams.get('cook_id');
    const shift_started_at = url.searchParams.get('shift_started_at');
    const shift_ended_at = url.searchParams.get('shift_ended_at');

    const db = getDb();
    let q = `SELECT * FROM shift_breaks
              WHERE location_id=? AND shift_date=?`;
    const args = [location_id, date];
    if (cook_id) {
      q += ' AND cook_id=?';
      args.push(cook_id);
    }
    q += ' ORDER BY started_at ASC';
    const breaks = db.prepare(q).all(...args);

    let evaluation = null;
    if (shift_started_at && shift_ended_at && cook_id) {
      evaluation = evaluateShift(shift_started_at, shift_ended_at, breaks);
    }

    return Response.json({ date, location_id, cook_id, breaks, evaluation });
  } catch (err) {
    console.error('GET /api/breaks failed:', err);
    return Response.json({ error: 'Failed to load breaks' }, { status: 500 });
  }
}
