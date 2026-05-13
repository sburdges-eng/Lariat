// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../lib/db';
import { locationFromBody } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import {
  isStationProhibitedForMinor,
  MINOR_PROHIBITION_CITATION,
} from '../../../lib/minorRestrictions';
import {
  cookHasActiveExclusion,
  SICK_WORKER_EXCLUSION_CITATION,
} from '../../../lib/sickWorkerGate';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// HACCP gate: a station sign-off is a manager attestation that CCP checks
// passed or that failures had corrective action noted. We refuse to record
// a sign-off if the latest check for any item is 'fail' with no note — the
// cook has to write what they did about it first. Surfacing this at the
// API (not just the UI) keeps a curl/replay attack from side-stepping it.
function failsMissingCorrectiveAction(db, shift_date, station_id, location_id) {
  return db.prepare(`
    SELECT item FROM line_check_entries AS l
    WHERE shift_date = ? AND station_id = ? AND location_id = ?
      AND id = (
        SELECT MAX(id) FROM line_check_entries
        WHERE shift_date = l.shift_date
          AND station_id = l.station_id
          AND location_id = l.location_id
          AND item = l.item
      )
      AND status = 'fail'
      AND (note IS NULL OR TRIM(note) = '')
  `).all(shift_date, station_id, location_id).map(r => r.item);
}

// L5 (CO YEOA + 29 CFR 570.50+): is the cook flagged as a minor with
// an ACTIVE staff_flags row? "Active" means effective_to IS NULL — a
// row with an effective_to timestamp set is a closed/historical flag
// and should NOT trigger the gate.
function cookHasActiveMinorFlag(db, location_id, cook_id) {
  const row = db.prepare(`
    SELECT 1 FROM staff_flags
     WHERE location_id = ?
       AND cook_id = ?
       AND flag = 'minor'
       AND effective_to IS NULL
     LIMIT 1
  `).get(location_id, cook_id);
  return Boolean(row);
}

// L6 (FDA 2022 §2-201.12): pull every OPEN sick-worker report for
// this cook + location. The pure helper `cookHasActiveExclusion`
// (lib/sickWorkerGate) decides whether any of them blocks line work
// (action 'excluded' or 'restricted'); 'monitor' / 'none' do not.
function cookSickExclusionRows(db, location_id, cook_id) {
  return db.prepare(`
    SELECT action, return_at FROM sick_worker_reports
     WHERE location_id = ?
       AND cook_id = ?
       AND return_at IS NULL
  `).all(location_id, cook_id);
}

export async function POST(req) {
  return withIdempotency(req, () => signoffHandler(req));
}

async function signoffHandler(req) {
  try {
    const body = await req.json();
    const shift_date = clip(body.shift_date, 32);
    const station_id = clip(body.station_id, 64);
    const cook_id = clip(body.cook_id, 64);
    if (!shift_date || !station_id || !cook_id) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }
    const loc = locationFromBody(body);
    const db = getDb();

    // Gate check + INSERT + audit run in one transaction so two concurrent
    // sign-offs can't both pass the unnoted-fails check and double-INSERT into
    // station_signoffs for the same (shift, station, cook), and an audit-row
    // failure rolls back the source signoff per docs/PATTERNS.md §3.
    //
    // Gate ordering: regulatory > operational > write. L5 (minor/HO
    // equipment) and L6 (sick-worker exclusion) are both 422 "fix and
    // resubmit" regulatory blocks; the unnoted-fails check is the
    // existing 409 operational block. Regulatory blocks come first so
    // an excluded cook on a prohibited station gets the L5 citation
    // (the more actionable one — reassign, don't wait on clearance).
    const signoff_type = clip(body.signoff_type, 32) || 'self';
    const result = db.transaction(() => {
      // L5 — minor on prohibited station (CO YEOA + HOs 14-16).
      if (cookHasActiveMinorFlag(db, loc, cook_id) && isStationProhibitedForMinor(station_id)) {
        return {
          status: 422,
          error: "this station has equipment minors can't use",
          citation: MINOR_PROHIBITION_CITATION,
          station_id,
        };
      }

      // L6 — sick-worker exclusion (FDA 2022 §2-201.12).
      const exclusionRows = cookSickExclusionRows(db, loc, cook_id);
      if (cookHasActiveExclusion(exclusionRows)) {
        return {
          status: 422,
          error: "this cook is on a reportable-illness exclusion and can't work the line",
          citation: SICK_WORKER_EXCLUSION_CITATION,
        };
      }

      const unnoted = failsMissingCorrectiveAction(db, shift_date, station_id, loc);
      if (unnoted.length) {
        return { status: 409, error: 'note the fix for failed items before signing off', items: unnoted };
      }
      const info = db.prepare(`
        INSERT INTO station_signoffs (shift_date, station_id, cook_id, signoff_type, location_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(shift_date, station_id, cook_id, signoff_type, loc);
      const row = db.prepare('SELECT * FROM station_signoffs WHERE id=?').get(info.lastInsertRowid);
      postAuditEvent({
        entity: 'station_signoffs',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        location_id: loc,
        shift_date,
        payload: { station_id, signoff_type },
      });
      return { status: 200, row };
    })();

    if (result.status !== 200) {
      const { status, ...body } = result;
      return Response.json(body, { status });
    }
    return Response.json(result.row);
  } catch (err) {
    console.error('POST /api/signoff failed:', err);
    return Response.json({ error: 'Failed to save signoff' }, { status: 500 });
  }
}
