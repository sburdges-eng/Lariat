// @ts-check
import { getDb, todayISO } from '../../lib/db';
import { getStations, getRecipes } from '../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { cascadedFromEightySix } from '../../lib/subRecipeGraph';
import EightySixBoard from './EightySixBoard.jsx';

/** @typedef {import('../../lib/db.ts').EightySix} EightySix */

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

/** @param {{ searchParams: Promise<PageSearchParams> | PageSearchParams }} props */
export default async function EightySixPage({ searchParams }) {
  // Next 16 app router passes searchParams as a Promise. Reading
  // `searchParams.location` synchronously falls back to the default kitchen and
  // emits a runtime warning in Safari/Simulator. Await before deriving loc.
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const date = todayISO();
  const db = getDb();
  const active = /** @type {EightySix[]} */ (
    db
      .prepare(`SELECT * FROM eighty_six WHERE shift_date=? AND resolved_at IS NULL AND location_id=? ORDER BY id DESC`)
      .all(date, loc)
  );
  const resolved = /** @type {EightySix[]} */ (
    db
      .prepare(
        `SELECT * FROM eighty_six WHERE shift_date=? AND resolved_at IS NOT NULL AND location_id=? ORDER BY resolved_at DESC LIMIT 50`
      )
      .all(date, loc)
  );
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
