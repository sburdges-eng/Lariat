import { getDb, todayISO } from '../../lib/db';
import { getStations } from '../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import InventoryBoard from './InventoryBoard';
import InventoryNav from './_nav';

export const dynamic = 'force-dynamic';

export default async function InventoryPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const db = getDb();
  const updates = db
    .prepare(`SELECT * FROM inventory_updates WHERE shift_date=? AND location_id=? ORDER BY id DESC`)
    .all(date, loc);
  const stations = getStations();
  return (
    <>
      <InventoryNav />
      <InventoryBoard updates={updates} stations={stations} date={date} locationId={loc} />
    </>
  );
}
