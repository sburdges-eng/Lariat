// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { summarizeWaitlist } from '../../lib/hostStand';
import HostStand from './HostStand';

export const dynamic = 'force-dynamic';

/** @typedef {{ searchParams?: Promise<Record<string, string | string[] | undefined>> }} HostPageProps */

/** @param {HostPageProps} props */
export default async function HostPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const todayPrefix = new Date().toISOString().slice(0, 10);

  const parties = /** @type {import('../../lib/hostStand').WaitlistPartyRow[]} */ (db
    .prepare(
      `SELECT id, location_id, party_name, party_size, joined_at, status,
              seated_at, left_at, phone, notes
         FROM waitlist_parties
        WHERE location_id = ?
          AND (status = 'waiting'
               OR (status = 'seated' AND substr(seated_at, 1, 10) = ?)
               OR (status = 'left'   AND substr(left_at,   1, 10) = ?))
        ORDER BY joined_at`,
    )
    .all(loc, todayPrefix, todayPrefix));

  const summary = summarizeWaitlist(parties, new Date().toISOString());

  return <HostStand initialParties={parties} initialSummary={summary} locationId={loc} />;
}
