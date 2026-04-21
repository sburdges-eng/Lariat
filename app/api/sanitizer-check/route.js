// Sanitizer concentration log (F4 / FDA §4-703.11).
//
// POST /api/sanitizer-check    → record a ppm reading (+ corrective note if out of range)
// GET  /api/sanitizer-check    → today's readings + latest-per-point roll-up
//
// Sanitizer checks are point-in-time, not range-based — every row is a
// completed observation, there is no PATCH. Out-of-range readings
// (low/high) MUST carry a corrective action to be accepted; without it
// the API returns 422 so the UI can prompt the cook inline.

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  CHEMISTRIES,
  DEFAULT_POINTS,
  classifySanitizer,
  validateSanitizerCheck,
} from '../../../lib/sanitizer';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/sanitizer-check ────────────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json();
    const v = validateSanitizerCheck({
      chemistry: body.chemistry,
      concentration_ppm: body.concentration_ppm,
      water_temp_f: body.water_temp_f ?? null,
      point_label: body.point_label,
    });
    if (!v.ok) return Response.json({ error: v.reason }, { status: 400 });

    const chemistry = body.chemistry;
    const concentration_ppm = Number(body.concentration_ppm);
    const water_temp_f =
      body.water_temp_f === null || body.water_temp_f === undefined
        ? null
        : Number(body.water_temp_f);
    const point_label = clip(body.point_label, 120);
    const station_id = clip(body.station_id, 64);
    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);
    const cook_id = clip(body.cook_id, 64);
    const corrective_action = typeof body.corrective_action === 'string'
      ? body.corrective_action.trim().slice(0, 500) || null
      : null;

    const decision = classifySanitizer(chemistry, concentration_ppm, water_temp_f);

    // Low/high reading without a corrective action is an incomplete
    // record — FDA wants evidence of WHAT the line did about it
    // (re-made bucket, test strip verified, etc.). Return 422 so the
    // UI can prompt inline rather than silently accepting a bad log.
    if (decision.status !== 'ok' && !corrective_action) {
      return Response.json(
        {
          error: `${decision.breach_reason} — needs a note on the fix`,
          needs_corrective_action: true,
          status: decision.status,
          required_min_ppm: decision.required_min_ppm,
          required_max_ppm: decision.required_max_ppm,
        },
        { status: 422 },
      );
    }

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO sanitizer_checks
        (shift_date, location_id, station_id, point_label, chemistry,
         concentration_ppm, required_min_ppm, required_max_ppm, water_temp_f,
         status, corrective_action, cook_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shift_date,
      location_id,
      station_id,
      point_label,
      chemistry,
      concentration_ppm,
      decision.required_min_ppm,
      decision.required_max_ppm,
      water_temp_f,
      decision.status,
      corrective_action,
      cook_id,
    );

    const row = db.prepare('SELECT * FROM sanitizer_checks WHERE id=?').get(info.lastInsertRowid);
    postAuditEvent({
      entity: 'sanitizer_checks',
      entity_id: Number(info.lastInsertRowid),
      action: 'insert',
      actor_cook_id: cook_id,
      actor_source: 'cook_ui',
      payload: row,
      shift_date,
      location_id,
      note: decision.breach_reason,
    });

    return Response.json({
      ok: true,
      entry: row,
      decision: {
        status: decision.status,
        breach_reason: decision.breach_reason,
        required_min_ppm: decision.required_min_ppm,
        required_max_ppm: decision.required_max_ppm,
      },
    });
  } catch (err) {
    console.error('POST /api/sanitizer-check failed:', err);
    return Response.json({ error: 'Failed to record sanitizer check' }, { status: 500 });
  }
}

// ── GET /api/sanitizer-check ─────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;

    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM sanitizer_checks
       WHERE location_id=? AND shift_date=?
       ORDER BY created_at ASC
    `).all(location_id, date);

    // Latest reading per point_label — the dashboard uses this to show
    // "is every bucket currently in spec?" without asking the cook to
    // scroll through the full log.
    const latestByPoint = new Map();
    for (const r of rows) {
      latestByPoint.set(r.point_label, r);
    }
    const latest = Array.from(latestByPoint.values()).sort(
      (a, b) => (a.point_label < b.point_label ? -1 : 1),
    );

    return Response.json({
      date,
      location_id,
      rows,
      latest,
      // Return the well-known points so the UI can render buttons for
      // surfaces that haven't been checked yet today.
      known_points: DEFAULT_POINTS,
      chemistries: CHEMISTRIES,
    });
  } catch (err) {
    console.error('GET /api/sanitizer-check failed:', err);
    return Response.json({ error: 'Failed to load sanitizer checks' }, { status: 500 });
  }
}
