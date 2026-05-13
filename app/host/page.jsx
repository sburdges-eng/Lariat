import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { summarizeWaitlist } from '../../lib/hostStand';
import HostStand from './HostStand';

export const dynamic = 'force-dynamic';

export default function HostPage({ searchParams }) {
  const sp = searchParams ?? {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const todayPrefix = new Date().toISOString().slice(0, 10);

  const parties = db
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
    .all(loc, todayPrefix, todayPrefix);

  const summary = summarizeWaitlist(parties, new Date().toISOString());

  return <HostStand initialParties={parties} initialSummary={summary} locationId={loc} />;
}
