import { getDb, todayISO } from '../../lib/db';
import { getStations, getRecipes } from '../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { cascadedFromEightySix } from '../../lib/subRecipeGraph';
import EightySixBoard from './EightySixBoard.jsx';

export const dynamic = 'force-dynamic';

export default function EightySixPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const db = getDb();
  const active = db
    .prepare(`SELECT * FROM eighty_six WHERE shift_date=? AND resolved_at IS NULL AND location_id=? ORDER BY id DESC`)
    .all(date, loc);
  const resolved = db
    .prepare(
      `SELECT * FROM eighty_six WHERE shift_date=? AND resolved_at IS NOT NULL AND location_id=? ORDER BY resolved_at DESC LIMIT 50`
    )
    .all(date, loc);
  const stations = getStations();
  const cascaded = cascadedFromEightySix(active.map((r) => r.item).filter(Boolean), getRecipes());
  return (
    <EightySixBoard
      active={active}
      resolved={resolved}
      cascaded={cascaded}
      stations={stations}
      date={date}
      locationId={loc}
    />
  );
}
