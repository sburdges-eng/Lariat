// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { formatDollars } from '../../lib/formatMoney';

export const dynamic = 'force-dynamic';

export default function PurchasingPage() {
  const loc = DEFAULT_LOCATION_ID;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ingredient, base_qty, unit, vendor, unit_price FROM order_guide_items WHERE location_id = ? ORDER BY vendor, ingredient LIMIT 200`
    )
    .all(loc);
  const n = db.prepare(`SELECT COUNT(*) as c FROM order_guide_items WHERE location_id = ?`).get(loc).c;

  return (
    <div>
      <h1>Order guide</h1>
      <p className="subtitle">
        From the <strong>Order Guide</strong> sheet ({n} items). Pull fresh after the operations workbook is updated.
      </p>

      {n === 0 && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          No order guide yet. Drop the operations workbook in place, then pull fresh.
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Base qty</th>
              <th>Unit</th>
              <th>Vendor</th>
              <th>Unit $</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.ingredient}</td>
                <td>{r.base_qty != null ? String(r.base_qty) : '—'}</td>
                <td>{r.unit}</td>
                <td>{r.vendor}</td>
                <td>{formatDollars(r.unit_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
