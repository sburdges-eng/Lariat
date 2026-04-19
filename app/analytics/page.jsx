import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';

export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  const loc = DEFAULT_LOCATION_ID;
  const db = getDb();
  const totals = db.prepare(`SELECT SUM(net_sales) as rev, SUM(quantity_sold) as qty FROM sales_lines WHERE location_id = ?`).get(loc);
  const top = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) as qty, SUM(net_sales) as rev FROM sales_lines WHERE location_id = ? GROUP BY item_name ORDER BY rev DESC LIMIT 20`
    )
    .all(loc);
  const spend = db.prepare(`SELECT month, shamrock_total_spend FROM spend_monthly WHERE location_id = ? ORDER BY month`).all(loc);

  return (
    <div>
      <h1>Analytics</h1>
      <p className="subtitle">
        Toast item sales + Shamrock monthly spend (from unified / analytics workbooks). Run <code className="text-accent">npm run ingest:analytics</code>.
      </p>

      <div className="grid grid-stations" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="kpi-label">Imported net sales</div>
          <div className="kpi-value">
            {totals.rev != null ? `$${Number(totals.rev).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Units sold (imported)</div>
          <div className="kpi-value">
            {totals.qty != null ? Number(totals.qty).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Spend months loaded</div>
          <div className="kpi-value">{spend.length}</div>
        </div>
      </div>

      {!top.length && (
        <div className="card" style={{ marginBottom: 20 }}>
          No sales_lines yet. Run <strong>npm run ingest:analytics</strong> (reads Toast - Item Sales from the unified workbook).
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Top items by net sales</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Net $</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.item_name}>
                  <td>{r.item_name}</td>
                  <td>{r.qty != null ? Number(r.qty).toFixed(0) : '—'}</td>
                  <td>{r.rev != null ? `$${Number(r.rev).toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          <h2>Monthly Shamrock spend</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Total $</th>
              </tr>
            </thead>
            <tbody>
              {spend.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{r.shamrock_total_spend != null ? Number(r.shamrock_total_spend).toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
