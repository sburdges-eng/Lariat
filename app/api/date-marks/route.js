// 7-day date marks (F2 / FDA §3-501.17).
//
// POST  /api/date-marks            → create a new date mark
// PATCH /api/date-marks            → mark batch as discarded
// GET   /api/date-marks            → active date marks + expiring scan

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  computeDiscardOn,
  scanExpiringBatches,
  validateDateMarkCreate,
} from '../../../lib/dateMarks';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/date-marks ──────────────────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json();
    const v = validateDateMarkCreate({
      item: body.item,
      prepared_on: body.prepared_on,
      batch_ref: body.batch_ref,
    });
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const item = clip(body.item, 200);
    const prepared_on = clip(body.prepared_on, 10);
    const batch_ref = clip(body.batch_ref, 120);
    const cook_id = clip(body.cook_id, 64);
    const location_id = locationFromBody(body);
    const discard_on = computeDiscardOn(prepared_on);

    const db = getDb();
    
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO date_marks
          (location_id, item, batch_ref, prepared_on, discard_on, cook_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(location_id, item, batch_ref, prepared_on, discard_on, cook_id);

      const row = db.prepare('SELECT * FROM date_marks WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'date_marks',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date: prepared_on,
        location_id,
      });
      
      return row;
    });

    const row = performWrite();

    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/date-marks failed:', err);
    return Response.json({ error: 'Failed to create date mark' }, { status: 500 });
  }
}

// ── PATCH /api/date-marks ─────────────────────────────────────────

export async function PATCH(req) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const reason = clip(body.discard_reason, 64);
    if (!reason) {
      return Response.json(
        { error: 'discard_reason is required (expired|early_use|quality|contamination)' },
        { status: 400 },
      );
    }
    const allowed = new Set(['expired', 'early_use', 'quality', 'contamination']);
    if (!allowed.has(reason)) {
      return Response.json({ error: 'unknown discard_reason' }, { status: 400 });
    }
    const cook_id = clip(body.cook_id, 64);

    const db = getDb();
    const existing = db.prepare('SELECT * FROM date_marks WHERE id=?').get(id);
    if (!existing) {
      return Response.json({ error: 'unknown date mark' }, { status: 404 });
    }
    if (existing.discarded_at) {
      return Response.json(
        { error: 'already discarded', entry: existing },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    
    const performUpdate = db.transaction(() => {
      db.prepare(`
        UPDATE date_marks
           SET discarded_at=?, discarded_by_cook_id=?, discard_reason=?
         WHERE id=?
      `).run(now, cook_id, reason, id);

      const updated = db.prepare('SELECT * FROM date_marks WHERE id=?').get(id);
      
      postAuditEvent({
        entity: 'date_marks',
        entity_id: id,
        action: 'update',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: updated,
        shift_date: existing.prepared_on,
        location_id: existing.location_id,
        note: `discarded: ${reason}`,
      });
      
      return updated;
    });

    const updated = performUpdate();

    return Response.json({ ok: true, entry: updated });
  } catch (err) {
    console.error('PATCH /api/date-marks failed:', err);
    return Response.json({ error: 'Failed to discard date mark' }, { status: 500 });
  }
}

// ── GET /api/date-marks ───────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const today = url.searchParams.get('today') || todayISO();

    const db = getDb();
    const active = db.prepare(`
      SELECT * FROM date_marks
       WHERE location_id=? AND discarded_at IS NULL
       ORDER BY discard_on ASC, id ASC
    `).all(location_id);

    const scan = scanExpiringBatches(active, today);
    return Response.json({ location_id, today, active, scan });
  } catch (err) {
    console.error('GET /api/date-marks failed:', err);
    return Response.json({ error: 'Failed to load date marks' }, { status: 500 });
  }
}
