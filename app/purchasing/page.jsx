import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';

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
        From operations workbook <strong>Order Guide</strong> sheet ({n} rows). Run <code style={{ color: 'var(--accent)' }}>npm run ingest:costing</code>{' '}
        (includes ops workbook when <code>LARIAT_OPS</code> points at it).
      </p>

      {n === 0 && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          No order guide rows yet. Ensure <code>XL/lariat_operations_workbook_*.xlsx</code> exists and run{' '}
          <strong>npm run ingest:costing</strong>.
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
                <td>{r.unit_price != null ? `$${Number(r.unit_price).toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
