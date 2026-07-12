// @ts-check
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import AddPrepParRow from './AddPrepParRow';
import DeletePrepParRow from './DeletePrepParRow';

/**
 * Row shape for `prep_par` (see CREATE TABLE in lib/db.ts). Matches the
 * SELECT list below and the local row shape read by
 * app/api/prep-par/route.js's GET — same table, same columns.
 * @typedef {{
 *   id: number,
 *   station_id: string,
 *   recipe_slug: string,
 *   ingredient: string,
 *   target_qty: number | null,
 *   unit: string | null,
 *   sort_order: number | null,
 *   note: string | null,
 *   updated_at: string | null,
 * }} PrepParRow
 */

export const dynamic = 'force-dynamic';

/** @param {string | null | undefined} iso */
function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props
 */
export default async function PrepParPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const rows = /** @type {PrepParRow[]} */ (
    db
      .prepare(
        `SELECT id, station_id, recipe_slug, ingredient, target_qty, unit, sort_order, note, updated_at
           FROM prep_par
          WHERE location_id = ?
          ORDER BY station_id, sort_order, recipe_slug, ingredient`,
      )
      .all(loc)
  );

  // Group by station_id; empty string → "General"
  const groups = /** @type {Map<string, PrepParRow[]>} */ (new Map());
  for (const r of rows) {
    const key = r.station_id || '';
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(r);
    } else {
      groups.set(key, [r]);
    }
  }
  const groupList = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div>
      <h1>Standing prep par</h1>
      <p className="subtitle">
        Recurring prep targets by station — separate from the daily task queue.
      </p>
      <p className="meta" style={{ marginBottom: 16 }}>
        <a href={`/prep${loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : ''}`}>
          ← Back to prep board
        </a>
      </p>

      <AddPrepParRow locationId={loc} />

      {rows.length === 0 ? (
        <div className="empty" role="status">
          No standing prep targets yet. Add one above.
        </div>
      ) : (
        groupList.map(([stationKey, items]) => (
          <section key={stationKey} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>
              {stationKey || 'General'}
            </h2>
            <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((r) => {
                const label = r.recipe_slug || r.ingredient || String(r.id);
                return (
                  <li
                    key={r.id}
                    className="check-row"
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
                  >
                    <div>
                      <div className="check-name">{label}</div>
                      <div className="meta">
                        target {r.target_qty ?? '—'} {r.unit || ''}
                        {r.note && <> · {r.note}</>}
                        {r.updated_at && (
                          <> · updated <time dateTime={r.updated_at}>{fmtDate(r.updated_at)}</time></>
                        )}
                      </div>
                    </div>
                    <DeletePrepParRow id={r.id} label={label} locationId={loc} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
