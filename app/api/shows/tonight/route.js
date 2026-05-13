import { getDb, todayISO } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { requirePin } from '../../../../lib/pin';
import {
  summarizeBoxOffice,
  parseRunOfShow,
  parseStatusJson,
  computeAttendance,
  pickEffectiveCapacity,
} from '../../../../lib/showsTonight';

export const dynamic = 'force-dynamic';

// Tonight · Live — composed read of every per-show surface for the
// current calendar day. PIN-gated via the existing /api/shows/* match
// in middleware.js. Read-only — no mutations here. The detail surfaces
// (sound, stage, box-office, settlement) keep their own routes.
//
// The route narrows by `?date=YYYY-MM-DD` (operator/test override) or
// falls back to today's local-server date. Lariat's server runs on
// premise so server-local = venue-local; the location-aware tz refit
// is deferred to V2.

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;

  try {
    const u = new URL(req.url);
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const date = u.searchParams.get('date') || todayISO();

    const db = getDb();

    const show = db
      .prepare(
        `SELECT id, location_id, band_name, show_date, price, door_tix, status_json
           FROM shows
          WHERE location_id = ? AND show_date = ?
          LIMIT 1`,
      )
      .get(loc, date);

    const previous_show = db
      .prepare(
        `SELECT id, band_name, show_date, price
           FROM shows
          WHERE location_id = ? AND show_date < ?
          ORDER BY show_date DESC
          LIMIT 1`,
      )
      .get(loc, date);

    // Venue capacity lives on locations.capacity (per-venue config,
    // operator-set). NULL → the attendance tile renders without a
    // percent / status color; everything else still works.
    const locationRow = db
      .prepare(`SELECT capacity FROM locations WHERE id = ?`)
      .get(loc);
    const venue_capacity = locationRow?.capacity ?? null;

    let stage_setup = null;
    let latest_sound_scene = null;
    let box_office_summary = null;
    let attendance = null;
    let run_of_show = [];

    const show_status = show ? parseStatusJson(show.status_json) : {};
    const effective_capacity = pickEffectiveCapacity(show_status, venue_capacity);
    const capacity_override = show && Number.isFinite(Number(show_status.capacity))
      && Number(show_status.capacity) > 0
      ? Math.floor(Number(show_status.capacity))
      : null;

    if (show) {
      stage_setup = db
        .prepare(
          `SELECT id, show_id, room_config, run_of_show_json, hospitality_rider_json,
                  tech_rider_json, notes, updated_at
             FROM stage_setups
            WHERE show_id = ? AND location_id = ?`,
        )
        .get(show.id, loc) || null;

      latest_sound_scene = db
        .prepare(
          `SELECT id, scene_name, spl_limit_db, notes, saved_at
             FROM sound_scenes
            WHERE show_id = ? AND location_id = ?
            ORDER BY datetime(saved_at) DESC, id DESC
            LIMIT 1`,
        )
        .get(show.id, loc) || null;

      const boxLines = db
        .prepare(
          `SELECT id, show_id, location_id, source, ticket_class, qty,
                  face_price, fees, external_ref, scanned_at, notes
             FROM box_office_lines
            WHERE show_id = ? AND location_id = ?`,
        )
        .all(show.id, loc);
      box_office_summary = summarizeBoxOffice(boxLines);
      attendance = computeAttendance(
        box_office_summary.scanned_qty,
        box_office_summary.total_qty,
        effective_capacity,
      );

      if (stage_setup) {
        run_of_show = parseRunOfShow(stage_setup.run_of_show_json);
      }
    }

    return Response.json({
      location_id: loc,
      date,
      show: show || null,
      show_status,
      stage_setup,
      latest_sound_scene,
      box_office_summary,
      attendance,
      venue_capacity,
      effective_capacity,
      capacity_override,
      run_of_show,
      previous_show: previous_show || null,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /api/shows/tonight failed:', err);
    return Response.json({ error: 'Failed to load tonight view' }, { status: 500 });
  }
}
