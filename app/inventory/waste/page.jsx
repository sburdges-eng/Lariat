import { getDb, todayISO } from '../../../lib/db';
import { getStations } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import InventoryNav from '../_nav';
import WasteLogClient from './WasteLogClient';

export const dynamic = 'force-dynamic';

function startOfRange(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function WastePage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const days = (() => {
    const n = Number(searchParams?.days);
    return Number.isFinite(n) && n > 0 && n <= 90 ? Math.floor(n) : 7;
  })();
  const since = startOfRange(days - 1);
  const today = todayISO();
  const db = getDb();

  const recent = db
    .prepare(
      `SELECT id, shift_date, station_id, item, delta, note, cook_id, created_at
         FROM inventory_updates
        WHERE direction = 'waste'
          AND location_id = ?
          AND shift_date >= ?
        ORDER BY id DESC
        LIMIT 200`,
    )
    .all(loc, since);

  const byItem = db
    .prepare(
      `SELECT item, COUNT(*) AS hits, MAX(created_at) AS last_at
         FROM inventory_updates
        WHERE direction = 'waste'
          AND location_id = ?
          AND shift_date >= ?
        GROUP BY item
        ORDER BY hits DESC, last_at DESC
        LIMIT 20`,
    )
    .all(loc, since);

  const stations = getStations();

  return (
    <div>
      <InventoryNav />
      <WasteLogClient
        recent={recent}
        byItem={byItem}
        stations={stations}
        days={days}
        date={today}
        locationId={loc}
      />
    </div>
  );
}
