// @ts-check
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getStation, getLineCheckTemplate, getSetups } from '../../../lib/data';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import StationChecklist from './StationChecklist';

export const dynamic = 'force-dynamic';

/**
 * lib/data.ts's `Station` interface doesn't declare `color`, even though
 * every row in data/cache/stations.json carries one and this page (plus
 * the sibling app/stations/page.jsx) renders it as the station's status
 * dot. Widened locally rather than editing lib/data.ts, which is out of
 * this migration's file scope.
 * @typedef {import('../../../lib/data.ts').Station & { color?: string }} StationWithColor
 */

/**
 * Subset of `line_check_entries` (see CREATE TABLE in lib/db.ts) selected
 * by the query below. `glove_change_attested` is included — see the fix
 * note further down for why dropping it silently broke the F15 (FDA
 * §3-301.11) attestation checkbox's persistence.
 * @typedef {{
 *   id: number,
 *   item: string,
 *   status: 'pass' | 'fail' | 'na',
 *   par: string | null,
 *   have: string | null,
 *   need: string | null,
 *   note: string | null,
 *   cook_id: string | null,
 *   glove_change_attested: 0 | 1 | null,
 *   created_at: string,
 * }} LineCheckRow
 */

/**
 * Shape StationChecklist actually consumes per item (its `StationCheckItem`
 * minus `status` narrowed to what the DB CHECK constraint allows).
 * @typedef {{
 *   status: 'pass' | 'fail' | 'na' | null,
 *   par: string,
 *   have: string,
 *   need: string,
 *   note: string,
 *   glove_change_attested: boolean | null,
 * }} ExistingCheckRow
 */

/**
 * @typedef {{ cook_id: string, created_at: string }} SignoffRow
 */

/**
 * @typedef {{
 *   params: Promise<{ id?: string }> | { id?: string },
 *   searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>,
 * }} StationPageProps
 */

/** @param {StationPageProps} props */
export default async function StationPage({ params, searchParams }) {
  const p = await params;
  const id = /** @type {string} */ (p.id);
  const sp = (await searchParams) || {};
  const station = /** @type {StationWithColor | null} */ (getStation(id));
  if (!station) notFound();

  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const items = station.line_check_key ? getLineCheckTemplate(station.line_check_key) : [];
  const setups = getSetups();
  const setupSteps = /** @type {string[]} */ (station.setup_key ? (setups[station.setup_key] || []) : []);

  const db = getDb();
  // BUG FIX (F15 / FDA §3-301.11 glove-change attestation): this SELECT
  // used to omit `glove_change_attested`, so every reload/router.refresh()
  // rebuilt `byItem` without it. StationChecklist's tri-state check
  // (`typeof ex.glove_change_attested === 'boolean'`) then always failed
  // on the resulting `undefined`, resetting the checkbox to unchecked even
  // though the DB still had `1` from an earlier attest. The write path
  // (POST /api/checks) was never broken — only the read-back was. Column
  // is now selected and translated from SQLite's `0 | 1 | null` into the
  // `boolean | null` shape StationCheckItem actually declares.
  const existing = /** @type {LineCheckRow[]} */ (
    db.prepare(`
    SELECT id, item, status, par, have, need, note, cook_id, glove_change_attested, created_at
    FROM line_check_entries
    WHERE shift_date=? AND station_id=? AND location_id=?
    ORDER BY id ASC
  `).all(date, station.id, loc)
  );
  // collapse to last entry per item
  /** @type {Record<string, ExistingCheckRow>} */
  const byItem = {};
  for (const row of existing) {
    byItem[row.item] = {
      status: row.status,
      par: row.par ?? '',
      have: row.have ?? '',
      need: row.need ?? '',
      note: row.note ?? '',
      glove_change_attested:
        row.glove_change_attested === 1 ? true : row.glove_change_attested === 0 ? false : null,
    };
  }

  const signoff = /** @type {SignoffRow | undefined} */ (
    db.prepare(
      'SELECT cook_id, created_at FROM station_signoffs WHERE shift_date=? AND station_id=? AND location_id=? ORDER BY id DESC LIMIT 1'
    ).get(date, station.id, loc)
  );

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:8 }}>
        <div className="dot" style={{ background: station.color, width:18, height:18 }} />
        <h1 style={{ margin:0 }}>{station.name}</h1>
      </div>
      <p className="subtitle">{station.line} line · {items.length} items</p>

      {items.length === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>
            {station.name} is a position marker. No line check is assigned yet.
          </p>
          <div className="flex-center-gap" style={{ justifyContent: 'center' }}>
            <Link className="btn" href={`/stations${loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : ''}`}>
              Back to stations
            </Link>
            <Link className="btn primary" href={`/stations/expo${loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : ''}`}>
              Open Expo
            </Link>
          </div>
        </div>
      ) : (
        <StationChecklist
          stationId={station.id}
          stationName={station.name}
          date={date}
          items={items}
          existing={byItem}
          signoff={signoff}
          locationId={loc}
        />
      )}

      {setupSteps.length > 0 ? (
        <details style={{ marginTop: 32 }}>
          <summary style={{ cursor:'pointer', fontSize: 16, fontWeight: 700, color:'var(--muted)' }}>
            Opening steps ({setupSteps.length})
          </summary>
          <ol style={{ marginTop: 12, lineHeight: 1.7, color:'var(--text)' }}>
            {setupSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
