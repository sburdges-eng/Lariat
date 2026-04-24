// Employee health reports (F5 / FDA §2-201.11).
//
// POST  /api/sick-worker           → file a sick report (PIC authority)
// PATCH /api/sick-worker           → record return-to-work clearance
// GET   /api/sick-worker           → currently excluded/restricted workers
//
// Sick reports contain PII (symptom data) and trigger exclusion
// from work. This route is ALWAYS PIN-gated when LARIAT_PIN is
// configured — a cook cannot file a report about a co-worker, only
// the PIC can. If no PIN is set (LAN-trust single-site install), the
// PIC/cook distinction collapses to trust.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  normalizeSymptoms,
  normalizeDiagnosis,
  validateSickReport,
} from '../../../lib/sickWorker';
import { hasPinCookie, pinRequiredForPic } from '../../../lib/pin';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

async function gate(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json(
      { error: 'manager PIN required — sick reports are PIC authority' },
      { status: 403 },
    );
  }
  return null;
}

// ── POST /api/sick-worker ────────────────────────────────────────

export async function POST(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const v = validateSickReport(body);
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const cook_id = clip(body.cook_id, 64);
    const reported_by_pic_id = clip(body.reported_by_pic_id, 64);
    const started_at = clip(body.started_at, 40);
    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const action = clip(body.action, 20);
    const clearance_source = clip(body.clearance_source, 64);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null;

    const syms = normalizeSymptoms(body.symptoms);
    const dx = normalizeDiagnosis(body.diagnosed_illness);
    const symptomsJoined = (syms || []).join(',');
    const diagnosisValue = dx === 'invalid' ? null : dx;

    const db = getDb();
    
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO sick_worker_reports
          (shift_date, location_id, cook_id, reported_by_pic_id,
           symptoms, diagnosed_illness, action, started_at, clearance_source, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        shift_date,
        location_id,
        cook_id,
        reported_by_pic_id,
        symptomsJoined,
        diagnosisValue,
        action,
        started_at,
        clearance_source,
        note
      );

      const row = db.prepare('SELECT * FROM sick_worker_reports WHERE id=?').get(info.lastInsertRowid);
      
      postAuditEvent({
        entity: 'sick_worker_reports',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: reported_by_pic_id,
        actor_source: 'pic_ui',
        // Payload intentionally does NOT include PII symptoms in the note
        // field; the JSON blob captures the full row for audit reconstruct.
        payload: row,
        shift_date,
        location_id,
      });

      return row;
    });

    const row = performWrite();

    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/sick-worker failed:', err);
    return Response.json({ error: 'Failed to file sick report' }, { status: 500 });
  }
}

// ── PATCH /api/sick-worker ───────────────────────────────────────

export async function PATCH(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    const clearance_source = clip(body.clearance_source, 64);
    if (!clearance_source) {
      return Response.json(
        { error: 'clearance_source is required (asymptomatic_24h|medical_clearance|health_dept|...)' },
        { status: 400 },
      );
    }
    const reported_by_pic_id = clip(body.reported_by_pic_id, 64);

    const db = getDb();
    const now = new Date().toISOString();

    // The pre-check + UPDATE must be in the same transaction so that two
    // concurrent clearances can't both pass the 409 guard and double-write.
    const performUpdate = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM sick_worker_reports WHERE id=?').get(id);
      if (!existing) return { status: 404, error: 'unknown sick report' };
      if (existing.return_at) return { status: 409, error: 'already cleared', entry: existing };

      db.prepare(`
        UPDATE sick_worker_reports
           SET return_at=?, clearance_source=?
         WHERE id=?
      `).run(now, clearance_source, id);

      const updated = db.prepare('SELECT * FROM sick_worker_reports WHERE id=?').get(id);

      postAuditEvent({
        entity: 'sick_worker_reports',
        entity_id: id,
        action: 'update',
        actor_cook_id: reported_by_pic_id,
        actor_source: 'pic_ui',
        payload: updated,
        shift_date: existing.shift_date,
        location_id: existing.location_id,
        note: `cleared: ${clearance_source}`,
      });

      return { status: 200, updated };
    });

    const result = performUpdate();
    if (result.status !== 200) {
      const { status, ...body } = result;
      return Response.json(body, { status });
    }

    return Response.json({ ok: true, entry: result.updated });
  } catch (err) {
    console.error('PATCH /api/sick-worker failed:', err);
    return Response.json({ error: 'Failed to clear sick report' }, { status: 500 });
  }
}

// ── GET /api/sick-worker ─────────────────────────────────────────

export async function GET(req) {
  // GET is a READ of who's currently excluded — we let the line know
  // (so the cook picker can grey out excluded cooks). The list is thin
  // enough that PII exposure is limited to the action label; the raw
  // symptoms are behind the PIN-gated PATCH/POST paths.
  try {
    const url = new URL(req.url);
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;
    const include_history = url.searchParams.get('all') === '1';

    const db = getDb();
    const active = db.prepare(`
      SELECT id, shift_date, location_id, cook_id, action, started_at, return_at
        FROM sick_worker_reports
       WHERE location_id=? AND return_at IS NULL
       ORDER BY started_at DESC
    `).all(location_id);

    let history = [];
    if (include_history && (await hasPinCookie(req))) {
      // Full rows only for PIN-authenticated callers.
      history = db.prepare(`
        SELECT * FROM sick_worker_reports
         WHERE location_id=? AND return_at IS NOT NULL
         ORDER BY return_at DESC LIMIT 100
      `).all(location_id);
    }

    return Response.json({ location_id, active, history });
  } catch (err) {
    console.error('GET /api/sick-worker failed:', err);
    return Response.json({ error: 'Failed to load sick worker list' }, { status: 500 });
  }
}
