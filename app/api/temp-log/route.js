// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import {
  classifyReading,
  classifyReadings,
  entryFromReading,
  getTempPoint,
  validateTempReading,
} from '../../../lib/tempLog';
import { calibrationWarningFor, classifyProbes } from '../../../lib/calibrations';
import { postAuditEvent } from '../../../lib/auditEvents';
import { hasPinOrTempPin } from '../../../lib/pin';
import { withIdempotency } from '../../../lib/idempotency';
import { appendOp } from '../../../lib/syncFeed';
import { localIdentityFields } from '../../../lib/localIdentity';

export const dynamic = 'force-dynamic';

/** @param {unknown} s @param {number} max @returns {string | null} */
const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// ── PIN gate ──────────────────────────────────────────────────────
// Cooks log TODAY's temps without a PIN (kitchen cadence — no login
// friction). Back-dating a reading requires the manager PIN cookie
// already issued by POST /api/auth/pin (see middleware.js, same cookie
// name). If LARIAT_PIN isn't configured at all, the gate is disabled
// the same way middleware.js disables gating — that matches the
// single-site LAN default where PIN is opt-in.

/** @param {string | null} shift_date */
function pinRequiredForDate(shift_date) {
  if (!process.env.LARIAT_PIN) return false;
  return shift_date !== todayISO();
}

// ── POST /api/temp-log ─────────────────────────────────────────────

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => tempLogHandler(req));
}

/** @param {Request} req */
async function tempLogHandler(req) {
  try {
    const body = await req.json();

    const shift_date = clip(body.shift_date, 32);
    const point_id = clip(body.point_id, 64);
    const reading_f = body.reading_f;

    if (!shift_date || !point_id) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }
    // reading_f === null is the JSON-round-trip of NaN (JSON.stringify({r: NaN})
    // produces '{"r":null}'), so we want a specific message here rather than
    // a generic "missing fields" 400 — and definitely not a 500 from a parse
    // failure further down.
    if (reading_f === undefined || reading_f === null || reading_f === '') {
      return Response.json({ error: 'reading_f is required' }, { status: 400 });
    }

    // PIN gate runs BEFORE the point lookup so an unauthenticated caller
    // can't probe point_id validity on past dates.
    // Conditional gate: only fires when back-dating beyond today.
    // Master PIN passes; a temp PIN scoped 'haccp.back_date' also passes
    // so a manager can hand a sous chef the ability to back-date a
    // forgotten fridge log without sharing the master PIN.
    if (pinRequiredForDate(shift_date) && !(await hasPinOrTempPin(req, 'haccp.back_date'))) {
      return Response.json(
        { error: 'manager PIN required for past dates' },
        { status: 403 },
      );
    }

    const point = getTempPoint(point_id);
    if (!point) {
      return Response.json({ error: 'unknown temp point', point_id }, { status: 400 });
    }

    // Reject (not silently truncate) over-long corrective actions so a cook
    // doesn't think their full note landed when only the first 500 chars did.
    if (typeof body.corrective_action === 'string' && body.corrective_action.length > 500) {
      return Response.json(
        { error: 'corrective action too long (max 500 chars)', length: body.corrective_action.length },
        { status: 400 },
      );
    }

    const corrective_action = body.corrective_action;
    const cook_id = clip(body.cook_id, 64);
    const location_id = locationFromBody(body);
    // Bundle G: optional probe id. When provided, the write ALWAYS
    // succeeds (advisory posture) but the response surfaces a
    // `calibration_warning` if the referenced probe has no passing
    // calibration on record (never calibrated / failed / overdue).
    const probe_id = clip(body.probe_id ?? body.thermometer_id, 64);

    const v = validateTempReading(point, reading_f, corrective_action);
    if (!v.ok) {
      // Bad-input vs. out-of-range-without-note: the library's classifier
      // disambiguates these. Bad input is a 400 (request shape wrong);
      // a well-formed out-of-range reading without a corrective action
      // is a 422 — the request CAN be resubmitted with a note.
      const klass = classifyReading(point, reading_f);
      if (klass === 'out_of_range') {
        return Response.json(
          { error: v.reason, needs_corrective_action: true },
          { status: 422 },
        );
      }
      return Response.json({ error: v.reason }, { status: 400 });
    }

    const row = entryFromReading({
      point,
      reading_f,
      corrective_action,
      shift_date,
      cook_id,
      location_id,
      probe_id,
    });

    const db = getDb();
    
    // Bundle G: evaluate the probe's calibration state outside the transaction
    let calibration_warning = null;
    if (probe_id) {
      try {
        const calRows = /** @type {import('../../../lib/calibrations').CalibrationRow[]} */ (db
          .prepare(
            `SELECT thermometer_id, method, before_reading_f, passed, calibrated_at, frequency_days
               FROM thermometer_calibrations
              WHERE location_id = ? AND thermometer_id = ?`
          )
          .all(row.location_id, probe_id));
        const [summary] = classifyProbes(calRows, {
          now: new Date(),
          known_probe_ids: [probe_id],
        });
        calibration_warning = calibrationWarningFor(summary);
      } catch (calErr) {
        console.error('calibration lookup failed:', calErr);
      }
    }

    const classification = classifyReading(point, reading_f);

    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, required_min_f, required_max_f, corrective_action, cook_id, probe_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.shift_date,
        row.location_id,
        row.point_id,
        row.reading_f,
        row.required_min_f,
        row.required_max_f,
        row.corrective_action,
        row.cook_id,
        row.probe_id
      );

      const inserted = db.prepare('SELECT * FROM temp_log WHERE id = ?').get(info.lastInsertRowid);

      const noteParts = [];
      if (classification === 'out_of_range') noteParts.push(`out_of_range:${point.id}`);
      if (calibration_warning) noteParts.push(`calibration_warning:${probe_id}`);
      
      postAuditEvent({
        entity: 'temp_log',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: inserted,
        shift_date: row.shift_date,
        location_id: row.location_id,
        note: noteParts.length ? noteParts.join('|') : null,
      });

      const identity = localIdentityFields();
      appendOp({
        opId: identity.opId,
        tableName: 'temp_log',
        locationId: row.location_id,
        opKind: 'insert',
        rowPk: String(info.lastInsertRowid),
        rowJson: JSON.stringify({
          shift_date: row.shift_date,
          location_id: row.location_id,
          point_id: row.point_id,
          reading_f: row.reading_f,
          required_min_f: row.required_min_f,
          required_max_f: row.required_max_f,
          corrective_action: row.corrective_action,
          cook_id: row.cook_id,
          probe_id: row.probe_id,
        }),
        createdAt: identity.createdAt,
        sourceHost: identity.sourceHost,
        sourceStartedAt: identity.sourceStartedAt,
      });

      return { info, inserted };
    });

    const { info, inserted } = performWrite();

    return Response.json({
      ok: true,
      id: info.lastInsertRowid,
      classification,
      calibration_warning,
      entry: {
        .../** @type {Record<string, unknown>} */ (inserted),
        point_label: point.label,
      },
    });
  } catch (err) {
    console.error('POST /api/temp-log failed:', err);
    return Response.json({ error: 'Failed to save temp reading' }, { status: 500 });
  }
}

// ── GET /api/temp-log ─────────────────────────────────────────────

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const point_id = url.searchParams.get('point_id');
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;

    const db = getDb();
    let q = 'SELECT * FROM temp_log WHERE shift_date = ? AND location_id = ?';
    const args = [date, location_id];
    if (point_id) {
      q += ' AND point_id = ?';
      args.push(point_id);
    }
    q += ' ORDER BY created_at DESC, id DESC';
    const rows = /** @type {({ point_id: string, reading_f: number } & Record<string, unknown>)[]} */ (
      db.prepare(q).all(...args));

    const entries = rows.map((r) => {
      // Join back to the live registry so the UI gets a human label without
      // a second round-trip. If the point has been retired since the
      // reading was taken, leave label null — the snapshotted bounds on
      // the row are still valid for audit; we just can't re-label it.
      const p = getTempPoint(r.point_id);
      return { ...r, point_label: p ? p.label : null };
    });

    // Per-point day summary — shaped for the board tiles. Additive to
    // the existing `entries` payload so older consumers keep working.
    // `?summary=0` opts out for callers that only want the raw rows.
    const wantSummary = url.searchParams.get('summary') !== '0';
    const summary = wantSummary ? classifyReadings(entries, { expectAllPoints: true }) : null;

    return Response.json({ date, location_id, entries, summary });
  } catch (err) {
    console.error('GET /api/temp-log failed:', err);
    return Response.json({ error: 'Failed to load temp log' }, { status: 500 });
  }
}
