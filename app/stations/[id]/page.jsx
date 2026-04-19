import { notFound } from 'next/navigation';
import { getStation, getLineCheckTemplate, getSetups } from '../../../lib/data';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import StationChecklist from './StationChecklist';

export const dynamic = 'force-dynamic';

const SETUP_MAP = {
  grill_saute: 'Tab 1 - Hot Line',
  brunch: 'Tab 1 - Hot Line',
  fry: 'Tab 2 - Fry Station',
  garde: 'Tab 3 - Salad Station',
  expo: 'Tab 4 - Expo',
};

export default function StationPage({ params, searchParams }) {
  const station = getStation(params.id);
  if (!station) notFound();

  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const items = station.line_check_key ? getLineCheckTemplate(station.line_check_key) : [];
  const setups = getSetups();
  const setupSteps = SETUP_MAP[station.id] ? (setups[SETUP_MAP[station.id]] || []) : [];

  const db = getDb();
  const existing = db.prepare(`
    SELECT id, item, status, par, have, need, note, cook_id, created_at
    FROM line_check_entries
    WHERE shift_date=? AND station_id=? AND location_id=?
    ORDER BY id ASC
  `).all(date, station.id, loc);
  // collapse to last entry per item
  const byItem = {};
  for (const row of existing) byItem[row.item] = row;

  const signoff = db.prepare(
    'SELECT cook_id, created_at FROM station_signoffs WHERE shift_date=? AND station_id=? AND location_id=? ORDER BY id DESC LIMIT 1'
  ).get(date, station.id, loc);

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:8 }}>
        <div className="dot" style={{ background: station.color, width:18, height:18 }} />
        <h1 style={{ margin:0 }}>{station.name}</h1>
      </div>
      <p className="subtitle">{station.line} line · {items.length} items</p>

      {items.length === 0 ? (
        <div className="empty">
          No line check for this station.
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
