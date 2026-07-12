// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import Link from 'next/link';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  summarizeBoxOffice,
  parseStatusJson,
  parseRunOfShow,
  pickShowTime,
  pickEffectiveCapacity,
  computeAttendance,
} from '../../../lib/showsTonight';
import TonightLiveClient from './_components/TonightLiveClient';

export const dynamic = 'force-dynamic';

/**
 * Row shapes for this page's direct SQL reads. Nullability mirrors the
 * CREATE TABLE statements in lib/db.ts (selected columns only — each
 * query here selects a different column subset than the sibling
 * /api/shows/tonight route, so these are defined locally rather than
 * reused from there).
 * @typedef {{ id: number, room_config: string, run_of_show_json: string, hospitality_rider_json: string, tech_rider_json: string, notes: string | null, updated_at: string }} StageSetupRow
 * @typedef {{ id: number, scene_name: string, spl_limit_db: number | null, saved_at: string }} SoundSceneRow
 * @typedef {{ id: number, band_name: string, show_date: string }} PreviousShowRow
 */

/**
 * Shape of this page's initial payload, built in the same shape as
 * GET /api/shows/tonight so the client wrapper can re-poll and swap in
 * fresh data without a schema mismatch.
 * @typedef {{
 *   location_id: string,
 *   date: string,
 *   show: import('../../../lib/showsTonight').ShowRow,
 *   show_status: Record<string, unknown>,
 *   stage_setup: StageSetupRow | null,
 *   latest_sound_scene: SoundSceneRow | null,
 *   box_office_summary: import('../../../lib/showsTonight').BoxOfficeSummary,
 *   attendance: import('../../../lib/showsTonight').Attendance,
 *   venue_capacity: number | null,
 *   effective_capacity: number | null,
 *   capacity_override: number | null,
 *   run_of_show: import('../../../lib/showsTonight').RunOfShowEntry[],
 *   previous_show: PreviousShowRow | null,
 *   server_time: string,
 * }} TonightPayload
 */

/** @param {string | null | undefined} iso */
const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

/** @param {{ previousShow: PreviousShowRow | null }} props */
function EmptyState({ previousShow }) {
  return (
    <div style={{ padding: '40px 0', maxWidth: 600 }}>
      <div className="page-eyebrow" style={{ color: 'var(--muted)' }}>
        Tonight · Live
      </div>
      <h1 style={{ fontFamily: "var(--display)", fontSize: 42, fontWeight: 400, margin: '6px 0 14px' }}>
        No show on the calendar tonight.
      </h1>
      <p style={{ color: 'var(--muted)', maxWidth: 480, lineHeight: 1.5 }}>
        {previousShow ? (
          <>
            Last show was <strong>{previousShow.band_name}</strong> on {fmtDate(previousShow.show_date)}.
            Settle the books in the show archive, or open <Link href="/booking">Booking</Link> to look ahead.
          </>
        ) : (
          <>
            Open <Link href="/booking">Booking</Link> to see what's on the calendar, or check the show archive.
          </>
        )}
      </p>
      <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className="btn" href="/booking">Booking & calendar</Link>
        <Link className="btn" href="/shows/archive">Show archive</Link>
      </div>
    </div>
  );
}

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function TonightLivePage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc = (sp?.location && typeof sp.location === 'string')
    ? sp.location
    : DEFAULT_LOCATION_ID;
  const date = (sp?.date && typeof sp.date === 'string')
    ? sp.date
    : todayISO();

  const db = getDb();

  const show = /** @type {import('../../../lib/showsTonight').ShowRow | undefined} */ (
    db
      .prepare(
        `SELECT id, location_id, band_name, show_date, price, door_tix, status_json
           FROM shows
          WHERE location_id = ? AND show_date = ?
          LIMIT 1`,
      )
      .get(loc, date)
  );

  const previousShow = /** @type {PreviousShowRow | undefined} */ (
    db
      .prepare(
        `SELECT id, band_name, show_date
           FROM shows
          WHERE location_id = ? AND show_date < ?
          ORDER BY show_date DESC
          LIMIT 1`,
      )
      .get(loc, date)
  );

  if (!show) {
    return <EmptyState previousShow={previousShow || null} />;
  }

  const status = parseStatusJson(show.status_json);
  const doorsTime = pickShowTime(status, 'doors');
  const set1Time = pickShowTime(status, 'set1');
  const set2Time = pickShowTime(status, 'set2');
  const curfewTime = pickShowTime(status, 'curfew');

  const stageSetup = /** @type {StageSetupRow | undefined} */ (
    db
      .prepare(
        `SELECT id, room_config, run_of_show_json, hospitality_rider_json, tech_rider_json, notes, updated_at
           FROM stage_setups
          WHERE show_id = ? AND location_id = ?`,
      )
      .get(show.id, loc)
  );

  const latestScene = /** @type {SoundSceneRow | undefined} */ (
    db
      .prepare(
        `SELECT id, scene_name, spl_limit_db, saved_at
           FROM sound_scenes
          WHERE show_id = ? AND location_id = ?
          ORDER BY datetime(saved_at) DESC, id DESC
          LIMIT 1`,
      )
      .get(show.id, loc)
  );

  const boxLines = /** @type {import('../../../lib/showsTonight').BoxOfficeLine[]} */ (
    db
      .prepare(
        `SELECT id, show_id, location_id, source, ticket_class, qty,
                face_price, fees, external_ref, scanned_at, notes
           FROM box_office_lines
          WHERE show_id = ? AND location_id = ?`,
      )
      .all(show.id, loc)
  );
  const boxOffice = summarizeBoxOffice(boxLines);
  const runOfShow = stageSetup ? parseRunOfShow(stageSetup.run_of_show_json) : [];

  // Per-venue capacity (operator-set; nullable). Per-show override on
  // status_json.capacity beats it — see pickEffectiveCapacity.
  const venueCapacityRow = /** @type {{ capacity: number | null } | undefined} */ (
    db.prepare(`SELECT capacity FROM locations WHERE id = ?`).get(loc)
  );
  const venueCapacity = venueCapacityRow?.capacity ?? null;
  const effectiveCapacity = pickEffectiveCapacity(status, venueCapacity);
  const capacityOverride = Number.isFinite(Number(status?.capacity)) && Number(status.capacity) > 0
    ? Math.floor(Number(status.capacity))
    : null;
  const attendance = computeAttendance(boxOffice.scanned_qty, boxOffice.total_qty, effectiveCapacity);

  // Build the initial payload in the same shape as GET /api/shows/tonight so
  // the client wrapper can re-poll and swap in fresh data without a different
  // schema. The header (band + set times) stays server-rendered for TTFB.
  /** @type {TonightPayload} */
  const initialPayload = {
    location_id: loc,
    date,
    show,
    show_status: status,
    stage_setup: stageSetup || null,
    latest_sound_scene: latestScene || null,
    box_office_summary: boxOffice,
    attendance,
    venue_capacity: venueCapacity,
    effective_capacity: effectiveCapacity,
    capacity_override: capacityOverride,
    run_of_show: runOfShow,
    previous_show: previousShow || null,
    server_time: new Date().toISOString(),
  };

  return (
    <div style={{ padding: '4px 0 60px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 28 }}>
        <div>
          <div className="page-eyebrow" style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Tonight · Live · {fmtDate(show.show_date)}
          </div>
          <h1
            style={{
              fontFamily: "var(--display)",
              fontSize: 56,
              fontWeight: 400,
              margin: '8px 0 6px',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {show.band_name}
          </h1>
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            {[
              doorsTime ? `Doors ${doorsTime}` : null,
              set1Time ? `Set 1 ${set1Time}` : null,
              set2Time ? `Set 2 ${set2Time}` : null,
              curfewTime ? `Curfew ${curfewTime}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Set times not yet entered.'}
          </p>
          {capacityOverride != null ? (
            <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
              Tonight's cap: {capacityOverride}
              {venueCapacity != null && venueCapacity !== capacityOverride
                ? ` (venue default ${venueCapacity})`
                : ''}
            </p>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {latestScene?.spl_limit_db ? (
            <span className="pill warn">SPL limit {latestScene.spl_limit_db} dB</span>
          ) : null}
          <Link className="btn" href={`/shows/${show.id}/box-office`}>Box office</Link>
          <Link className="btn" href={`/shows/${show.id}/sound`}>Sound</Link>
          <Link className="btn" href={`/shows/${show.id}/stage`}>Stage</Link>
          <Link className="btn" href={`/shows/${show.id}/settlement`}>Settlement</Link>
        </div>
      </div>

      <TonightLiveClient initialPayload={initialPayload} loc={loc} date={date} showId={show.id} />

      {previousShow ? (
        <p style={{ marginTop: 32, fontSize: 12, color: 'var(--muted)', letterSpacing: '0.04em' }}>
          Last show: <strong>{previousShow.band_name}</strong> on {fmtDate(previousShow.show_date)}.
        </p>
      ) : null}
    </div>
  );
}
