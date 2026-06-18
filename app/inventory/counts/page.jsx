import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import InventoryNav from '../_nav';
import StartCountButton from './StartCountButton';

export const dynamic = 'force-dynamic';

function fmt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default async function CountsListPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT c.id, c.count_date, c.label, c.opened_at, c.closed_at, c.cook_id,
              (SELECT COUNT(*) FROM inventory_count_lines l WHERE l.count_id = c.id) AS line_count
         FROM inventory_counts c
        WHERE c.location_id = ?
        ORDER BY c.opened_at DESC
        LIMIT 50`,
    )
    .all(loc);

  return (
    <div>
      <InventoryNav />
      <h1>Counts</h1>
      <p className="subtitle">Walk through and log what you have on hand.</p>

      <StartCountButton locationId={loc} />

      {counts.length === 0 ? (
        <div className="empty" role="status">No counts yet.</div>
      ) : (
        <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {counts.map(c => (
            <li key={c.id} className="check-row">
              <div>
                <div className="check-name">
                  <Link href={`/inventory/counts/${c.id}`}>
                    {c.label || `Count ${c.count_date}`}
                  </Link>
                  {!c.closed_at && (
                    <span
                      className="badge"
                      style={{
                        marginLeft: 8, padding: '2px 8px', borderRadius: 999,
                        background: 'var(--green, #2e7d32)', color: '#fff', fontSize: 12,
                      }}
                    >
                      open
                    </span>
                  )}
                </div>
                <div className="meta">
                  {c.line_count} line{c.line_count === 1 ? '' : 's'}
                  {' · opened '}<time dateTime={c.opened_at}>{fmt(c.opened_at)}</time>
                  {c.closed_at && (
                    <> · closed <time dateTime={c.closed_at}>{fmt(c.closed_at)}</time></>
                  )}
                  {c.cook_id && <> · {c.cook_id}</>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
