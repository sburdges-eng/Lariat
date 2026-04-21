// Two-stage cooling log (F1 / CCP-8).
//
// POST  /api/cooling        → open a cooling batch
// PATCH /api/cooling        → add a stage-1 or stage-2 reading
// GET   /api/cooling        → list today's open + recently closed batches
//
// The library layer (lib/cooling.ts) owns the compliance math — this
// route is just DB I/O + shape validation. We POST an audit_events row
// for every insert/update so the trail survives a later correction.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  classifyCoolingStage,
  scanOpenBatches,
  validateCoolingStart,
} from '../../../lib/cooling';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/cooling ─────────────────────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json();
    const v = validateCoolingStart({
      item: body.item,
      started_at: body.started_at,
      start_reading_f: body.start_reading_f ?? null,
    });
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const item = clip(body.item, 200);
    const station_id = clip(body.station_id, 64);
    const cook_id = clip(body.cook_id, 64);
    const started_at = clip(body.started_at, 40);
    const start_reading_f =
      body.start_reading_f === null || body.start_reading_f === undefined
        ? null
        : Number(body.start_reading_f);

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO cooling_log
        (shift_date, location_id, item, station_id, started_at, start_reading_f, status, cook_id)
      VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)
    `).run(shift_date, location_id, item, station_id, started_at, start_reading_f, cook_id);

    const row = db.prepare('SELECT * FROM cooling_log WHERE id=?').get(info.lastInsertRowid);
    postAuditEvent({
      entity: 'cooling_log',
      entity_id: Number(info.lastInsertRowid),
      action: 'insert',
      actor_cook_id: cook_id,
      actor_source: 'cook_ui',
      payload: row,
      shift_date,
      location_id,
    });

    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/cooling failed:', err);
    return Response.json({ error: 'Failed to open cooling batch' }, { status: 500 });
  }
}

// ── PATCH /api/cooling ────────────────────────────────────────────

export async function PATCH(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const reading_f = body.reading_f === null || body.reading_f === undefined
      ? null
      : Number(body.reading_f);
    const at = clip(body.at, 40);
    const corrective_action = typeof body.corrective_action === 'string'
      ? body.corrective_action.trim()
      : null;
    if (corrective_action && corrective_action.length > 500) {
      return Response.json(
        { error: 'corrective action too long (max 500 chars)' },
        { status: 400 },
      );
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM cooling_log WHERE id=?').get(id);
    if (!existing) {
      return Response.json({ error: 'unknown cooling batch' }, { status: 404 });
    }

    const decision = classifyCoolingStage({
      row: existing,
      reading_f,
      at,
      corrective_action,
    });
    if (!decision.ok) {
      return Response.json({ error: decision.reason }, { status: 400 });
    }

    // A breach MUST have a corrective_action; FDA requires documentation.
    if (decision.status === 'breach' && !corrective_action) {
      return Response.json(
        { error: 'breach requires a corrective action note', needs_corrective_action: true },
        { status: 422 },
      );
    }

    const cook_id = clip(body.cook_id, 64);
    // Build the update. We only write the stage-appropriate fields; the
    // other stage's columns stay NULL if they were NULL.
    let sql;
    let args;
    if (decision.stage === 1) {
      sql = `UPDATE cooling_log
               SET stage1_at=?, stage1_reading_f=?, status=?, breach_reason=?,
                   corrective_action=COALESCE(?, corrective_action)
             WHERE id=?`;
      args = [
        at,
        reading_f,
        decision.status,
        decision.breach_reason,
        corrective_action,
        id,
      ];
    } else {
      sql = `UPDATE cooling_log
               SET stage2_at=?, stage2_reading_f=?, status=?, breach_reason=?,
                   corrective_action=COALESCE(?, corrective_action),
                   closed_by_cook_id=?
             WHERE id=?`;
      args = [
        at,
        reading_f,
        decision.status,
        decision.breach_reason,
        corrective_action,
        cook_id,
        id,
      ];
    }
    db.prepare(sql).run(...args);

    const updated = db.prepare('SELECT * FROM cooling_log WHERE id=?').get(id);
    postAuditEvent({
      entity: 'cooling_log',
      entity_id: id,
      action: 'update',
      actor_cook_id: cook_id,
      actor_source: 'cook_ui',
      payload: updated,
      shift_date: existing.shift_date,
      location_id: existing.location_id,
      note: decision.breach_reason ? `breach: ${decision.breach_reason}` : null,
    });

    return Response.json({
      ok: true,
      decision: {
        stage: decision.stage,
        status: decision.status,
        breach_reason: decision.breach_reason,
        minutes_elapsed: decision.minutes_elapsed,
      },
      entry: updated,
    });
  } catch (err) {
    console.error('PATCH /api/cooling failed:', err);
    return Response.json({ error: 'Failed to update cooling batch' }, { status: 500 });
  }
}

// ── GET /api/cooling ──────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const includeClosed = url.searchParams.get('all') === '1';

    const db = getDb();
    const openRows = db.prepare(`
      SELECT * FROM cooling_log
       WHERE location_id=? AND status='in_progress'
       ORDER BY started_at ASC
    `).all(location_id);

    const scan = scanOpenBatches(openRows, Date.now());

    let closed = [];
    if (includeClosed) {
      closed = db.prepare(`
        SELECT * FROM cooling_log
         WHERE location_id=? AND shift_date=? AND status != 'in_progress'
         ORDER BY id DESC
      `).all(location_id, date);
    }

    return Response.json({
      date,
      location_id,
      open: openRows,
      scan,
      closed,
    });
  } catch (err) {
    console.error('GET /api/cooling failed:', err);
    return Response.json({ error: 'Failed to load cooling log' }, { status: 500 });
  }
}
