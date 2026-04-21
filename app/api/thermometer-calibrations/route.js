// Thermometer calibration log (F9 / FDA §4-502.11).
//
// POST /api/thermometer-calibrations → record one calibration reading.
//   Unlike temp-log + receiving, this route PERSISTS both pass and
//   fail outcomes. A failing calibration IS the truth being recorded;
//   the audit trail wants to know the probe drifted before an operator
//   caught it. Refusing to save a fail would make operators re-run
//   calibrations they already documented, a worse posture than an
//   always-honest log.
//
// GET  /api/thermometer-calibrations → per-probe summary:
//       last calibration, pass/fail state, next-due date, status
//       (ok / due_soon / overdue / failed / unknown).
//       Optional ?probe_id= filter (returns entries + summary for
//       just that probe). ?entries=1 returns the raw row list too.
//
// The rule module in lib/calibrations.ts owns every threshold decision,
// altitude correction, and next-due computation. This route is
// persistence + audit + UI-shape only.

import { getDb, todayISO } from '../../../lib/db';
import {
  DEFAULT_LOCATION_ID,
  locationFromBody,
  locationFromRequest,
} from '../../../lib/location';
import {
  CALIBRATION_METHODS,
  DEFAULT_FREQUENCY_DAYS,
  LARIAT_ELEVATION_FT,
  TOLERANCE_F,
  classifyProbes,
  isCalibrationMethod,
  validateCalibrationReading,
} from '../../../lib/calibrations';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── POST /api/thermometer-calibrations ────────────────────────────

export async function POST(req) {
  try {
    const body = await req.json();

    const thermometer_id = clip(body.thermometer_id ?? body.probe_id, 64);
    if (!thermometer_id) {
      return Response.json(
        { error: 'thermometer_id (probe id) is required' },
        { status: 400 },
      );
    }

    const method = clip(body.method, 32);
    if (!isCalibrationMethod(method)) {
      return Response.json(
        {
          error: `unknown calibration method — must be one of: ${Object.values(CALIBRATION_METHODS).join(', ')}`,
          methods: Object.values(CALIBRATION_METHODS),
        },
        { status: 400 },
      );
    }

    const reading_raw = body.reading_f ?? body.before_reading_f;
    if (reading_raw === undefined || reading_raw === null || reading_raw === '') {
      return Response.json(
        { error: 'reading_f is required' },
        { status: 400 },
      );
    }
    const reading_f = Number(reading_raw);
    if (!Number.isFinite(reading_f)) {
      return Response.json(
        { error: 'reading_f must be a number in °F' },
        { status: 400 },
      );
    }

    let elevation_ft = LARIAT_ELEVATION_FT;
    if (body.elevation_ft !== undefined && body.elevation_ft !== null && body.elevation_ft !== '') {
      const n = Number(body.elevation_ft);
      if (!Number.isFinite(n)) {
        return Response.json(
          { error: 'elevation_ft must be a number in feet or omitted' },
          { status: 400 },
        );
      }
      elevation_ft = n;
    }

    // Reject (not silently truncate) over-long notes so an operator
    // doesn't think their full corrective text landed.
    if (typeof body.note === 'string' && body.note.length > 500) {
      return Response.json(
        { error: 'note too long (max 500 chars)', length: body.note.length },
        { status: 400 },
      );
    }
    const note = clip(body.note ?? body.action_taken, 500);

    // Optional per-probe frequency override — positive integer only.
    let frequency_days = null;
    if (body.frequency_days !== undefined && body.frequency_days !== null && body.frequency_days !== '') {
      const fd = Number(body.frequency_days);
      if (!Number.isInteger(fd) || fd <= 0) {
        return Response.json(
          { error: 'frequency_days must be a positive integer (days between calibrations) or omitted' },
          { status: 400 },
        );
      }
      frequency_days = fd;
    }

    const cook_id = clip(body.cook_id, 64);
    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);

    // Rule-module decision. Throws on bad input (we pre-guarded above),
    // so any throw here is a 500 (our mistake, not the operator's).
    let decision;
    try {
      decision = validateCalibrationReading({ method, reading_f, elevation_ft });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'invalid calibration reading' },
        { status: 400 },
      );
    }

    // Persist EVERY outcome, pass or fail. The fail row IS the audit
    // trail — the operator caught the drift, the inspector can read
    // when it was caught and when the probe came back into service
    // (by finding the next passing row with the same thermometer_id).
    // DDL has `before_reading_f` / `after_reading_f` columns from F9
    // scaffolding; we use before_reading_f for the primary reading and
    // leave after_reading_f NULL (it's only populated if/when an
    // operator re-calibrates the probe in-place after adjustment).
    const db = getDb();
    const calibrated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const info = db
      .prepare(
        `INSERT INTO thermometer_calibrations
           (location_id, thermometer_id, method, before_reading_f, after_reading_f,
            passed, action_taken, cook_id, calibrated_at, frequency_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        location_id,
        thermometer_id,
        method,
        reading_f,
        null,
        decision.status === 'pass' ? 1 : 0,
        note,
        cook_id,
        calibrated_at,
        frequency_days,
      );

    const row = db
      .prepare('SELECT * FROM thermometer_calibrations WHERE id = ?')
      .get(info.lastInsertRowid);

    // Append-only audit trail. Best-effort: a stranded calibration row
    // is less-bad than a 500 rejecting the operator's save.
    try {
      postAuditEvent({
        entity: 'thermometer_calibrations',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date,
        location_id,
        note:
          decision.status === 'pass'
            ? null
            : `fail:${thermometer_id}:${method}`,
      });
    } catch (auditErr) {
      console.error('postAuditEvent(thermometer_calibrations insert) failed:', auditErr);
    }

    return Response.json({
      ok: true,
      id: info.lastInsertRowid,
      decision: {
        status: decision.status,
        method: decision.method,
        expected_f: decision.expected_f,
        tolerance_f: decision.tolerance_f,
        deviation_f: decision.deviation_f,
        elevation_ft: decision.elevation_ft,
        citation: decision.citation,
        reason: decision.reason,
      },
      entry: row,
    });
  } catch (err) {
    console.error('POST /api/thermometer-calibrations failed:', err);
    return Response.json(
      { error: 'Failed to save calibration' },
      { status: 500 },
    );
  }
}

// ── GET /api/thermometer-calibrations ─────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const probe_id = url.searchParams.get('probe_id') || url.searchParams.get('thermometer_id');
    const wantEntries = url.searchParams.get('entries') === '1' || !!probe_id;
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;

    const db = getDb();
    let q = `SELECT * FROM thermometer_calibrations WHERE location_id = ?`;
    const args = [location_id];
    if (probe_id) {
      q += ' AND thermometer_id = ?';
      args.push(probe_id);
    }
    q += ' ORDER BY calibrated_at DESC, id DESC';
    const rows = db.prepare(q).all(...args);

    const summary = classifyProbes(rows, {
      now: new Date(),
      frequency_days: DEFAULT_FREQUENCY_DAYS,
    });

    return Response.json({
      location_id,
      summary,
      entries: wantEntries ? rows : null,
      methods: Object.values(CALIBRATION_METHODS),
      tolerance_f: TOLERANCE_F,
      default_elevation_ft: LARIAT_ELEVATION_FT,
      default_frequency_days: DEFAULT_FREQUENCY_DAYS,
    });
  } catch (err) {
    console.error('GET /api/thermometer-calibrations failed:', err);
    return Response.json(
      { error: 'Failed to load calibrations' },
      { status: 500 },
    );
  }
}
