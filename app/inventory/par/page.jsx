import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import InventoryNav from '../_nav';
import AddParRow from './AddParRow';
import DeleteParRow from './DeleteParRow';

export const dynamic = 'force-dynamic';

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

export default function ParPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const onlyLow = searchParams?.low === '1';
  const db = getDb();

  // Latest line per ingredient across all counts at this location.
  // SQLite supports MAX() over rows so we use a correlated max subquery
  // to pick the most recent counted_at row for each ingredient/sku.
  const rows = db
    .prepare(
      `SELECT p.id, p.vendor, p.ingredient, p.sku, p.par_qty, p.par_unit,
              p.pack_size, p.pack_unit, p.category,
              latest.on_hand_qty, latest.unit AS on_hand_unit,
              latest.counted_at, latest.counted_by
         FROM inventory_par p
         LEFT JOIN (
           SELECT l1.ingredient, l1.sku, l1.on_hand_qty, l1.unit,
                  l1.counted_at, l1.counted_by
             FROM inventory_count_lines l1
            WHERE l1.location_id = ?
              AND l1.counted_at = (
                SELECT MAX(l2.counted_at)
                  FROM inventory_count_lines l2
                 WHERE l2.location_id = l1.location_id
                   AND l2.ingredient = l1.ingredient
                   AND COALESCE(l2.sku,'') = COALESCE(l1.sku,'')
              )
         ) AS latest
           ON latest.ingredient = p.ingredient
          AND COALESCE(latest.sku,'') = COALESCE(p.sku,'')
        WHERE p.location_id = ?
        ORDER BY p.category, p.ingredient`,
    )
    .all(loc, loc);

  const lowRows = rows.filter(
    (r) =>
      r.par_qty != null &&
      r.on_hand_qty != null &&
      Number(r.on_hand_qty) < Number(r.par_qty),
  );

  const display = onlyLow ? lowRows : rows;

  const groups = new Map();
  for (const r of display) {
    const cat = r.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(r);
  }
  const groupList = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();

  return (
    <div>
      <InventoryNav />
      <h1>Par levels</h1>
      <p className="subtitle">
        What we keep on hand. {lowRows.length > 0 && `${lowRows.length} item${lowRows.length === 1 ? '' : 's'} below par.`}
      </p>

      <div className="card form-row" style={{ marginBottom: 16, alignItems: 'center', gap: 8 }}>
        <a
          href="/inventory/par"
          className={!onlyLow ? 'btn primary' : 'btn'}
          aria-current={!onlyLow ? 'page' : undefined}
          style={{ textDecoration: 'none' }}
        >
          All ({rows.length})
        </a>
        <a
          href="/inventory/par?low=1"
          className={onlyLow ? 'btn primary' : 'btn'}
          aria-current={onlyLow ? 'page' : undefined}
          style={{ textDecoration: 'none' }}
        >
          Low ({lowRows.length})
        </a>
      </div>

      <AddParRow locationId={loc} categories={categories} />

      {display.length === 0 ? (
        <div className="empty" role="status">
          {onlyLow ? 'Nothing below par.' : 'No par list yet.'}
        </div>
      ) : (
        groupList.map(([cat, items]) => (
          <section key={cat} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>{cat}</h2>
            <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((r) => {
                const low =
                  r.par_qty != null &&
                  r.on_hand_qty != null &&
                  Number(r.on_hand_qty) < Number(r.par_qty);
                return (
                  <li
                    key={r.id}
                    className="check-row"
                    style={{
                      ...(low ? { borderLeft: '3px solid var(--orange, #c0531c)', paddingLeft: 8 } : null),
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    }}
                  >
                    <div>
                      <div className="check-name">{r.ingredient}</div>
                      <div className="meta">
                        {r.vendor && <>{r.vendor} · </>}
                        par {r.par_qty ?? '—'} {r.par_unit || ''}
                        {' · '}
                        on hand {r.on_hand_qty != null ? `${r.on_hand_qty} ${r.on_hand_unit || ''}` : '—'}
                        {r.counted_at && (
                          <> · <time dateTime={r.counted_at}>{fmtDate(r.counted_at)}</time></>
                        )}
                        {low && (
                          <span
                            style={{
                              marginLeft: 8, padding: '2px 8px', borderRadius: 999,
                              background: 'var(--orange, #c0531c)', color: '#fff', fontSize: 12,
                            }}
                          >
                            low
                          </span>
                        )}
                      </div>
                    </div>
                    <DeleteParRow id={r.id} ingredient={r.ingredient} locationId={loc} />
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
