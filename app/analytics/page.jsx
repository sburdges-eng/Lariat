// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import AnalyticsCharts from './AnalyticsCharts';

export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  const loc = DEFAULT_LOCATION_ID;
  const db = getDb();

  /* ── KPI totals ─────────────────────────────────────────────────── */
  const totals = db
    .prepare(
      `SELECT SUM(net_sales) as rev, SUM(quantity_sold) as qty
         FROM sales_lines WHERE location_id = ?`,
    )
    .get(loc);

  /* ── Daily revenue trend (comparison_group 1 = current period) ── */
  const daily = db
    .prepare(
      `SELECT shift_date, net_sales, orders, guests
         FROM toast_sales_daily
        WHERE location_id = ? AND comparison_group = 1
        ORDER BY shift_date`,
    )
    .all(loc);

  /* ── Day-of-week comparison ─────────────────────────────────────── */
  const dowCurrent = db
    .prepare(
      `SELECT day_of_week, net_sales, orders, guests
         FROM toast_sales_dow
        WHERE location_id = ? AND comparison_group = 1`,
    )
    .all(loc);
  const dowPrior = db
    .prepare(
      `SELECT day_of_week, net_sales, orders, guests
         FROM toast_sales_dow
        WHERE location_id = ? AND comparison_group = 2`,
    )
    .all(loc);

  /* ── Hourly revenue curve ───────────────────────────────────────── */
  const hourlyCurrent = db
    .prepare(
      `SELECT hour_24, label, net_sales, orders, guests
         FROM toast_sales_hour
        WHERE location_id = ? AND comparison_group = 1
        ORDER BY hour_24`,
    )
    .all(loc);
  const hourlyPrior = db
    .prepare(
      `SELECT hour_24, label, net_sales, orders, guests
         FROM toast_sales_hour
        WHERE location_id = ? AND comparison_group = 2
        ORDER BY hour_24`,
    )
    .all(loc);

  /* ── Monthly Shamrock spend ─────────────────────────────────────── */
  const spend = db
    .prepare(
      `SELECT month, shamrock_total_spend
         FROM spend_monthly
        WHERE location_id = ?
        ORDER BY month`,
    )
    .all(loc);

  /* ── Top selling items ──────────────────────────────────────────── */
  const top = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) as qty, SUM(net_sales) as rev
         FROM sales_lines
        WHERE location_id = ?
        GROUP BY item_name
        ORDER BY rev DESC
        LIMIT 20`,
    )
    .all(loc);

  /* ── Derived KPIs ───────────────────────────────────────────────── */
  const dailyCurrentTotal = daily.reduce((s, r) => s + (r.net_sales || 0), 0);
  const dailyPrior = db
    .prepare(
      `SELECT SUM(net_sales) as rev
         FROM toast_sales_daily
        WHERE location_id = ? AND comparison_group = 2`,
    )
    .get(loc);
  const priorRev = dailyPrior?.rev || 0;
  const yoyDelta =
    priorRev > 0 ? ((dailyCurrentTotal - priorRev) / priorRev) * 100 : null;

  const dateRange = db
    .prepare(
      `SELECT date_range FROM toast_sales_daily
        WHERE location_id = ? AND comparison_group = 1 LIMIT 1`,
    )
    .get(loc);
  const periodLabel = dateRange?.date_range || '';

  const avgCheck =
    daily.length > 0
      ? dailyCurrentTotal /
        daily.reduce((s, r) => s + (r.orders || 0), 0)
      : null;

  const totalSpend = spend.reduce(
    (s, r) => s + (r.shamrock_total_spend || 0),
    0,
  );

  return (
    <div>
      <h1>Sales numbers</h1>
      {periodLabel && (
        <p
          className="subtitle"
          style={{ marginBottom: 8 }}
        >
          {periodLabel}
        </p>
      )}
      <p className="subtitle" style={{ opacity: 0.65, fontSize: 12, marginBottom: 28 }}>
        Toast sales + Shamrock spend. Run{' '}
        <code className="text-accent">npm run ingest:analytics</code> to
        refresh.
      </p>

      {/* ── KPI ribbon ──────────────────────────────────────────── */}
      <div className="grid grid-stations" style={{ marginBottom: 32 }}>
        <div className="card">
          <div className="kpi-label">Current period revenue</div>
          <div className="kpi-value">
            {dailyCurrentTotal > 0
              ? `$${dailyCurrentTotal.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}`
              : '—'}
          </div>
          {yoyDelta != null && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                marginTop: 4,
                color: yoyDelta >= 0 ? 'var(--accent)' : 'var(--danger)',
              }}
            >
              {yoyDelta >= 0 ? '▲' : '▼'}{' '}
              {Math.abs(yoyDelta).toFixed(1)}% vs prior
            </div>
          )}
        </div>

        <div className="card">
          <div className="kpi-label">Avg check</div>
          <div className="kpi-value">
            {avgCheck != null && isFinite(avgCheck)
              ? `$${avgCheck.toFixed(2)}`
              : '—'}
          </div>
        </div>

        <div className="card">
          <div className="kpi-label">Trading days</div>
          <div className="kpi-value">{daily.length || '—'}</div>
        </div>

        <div className="card">
          <div className="kpi-label">Shamrock spend ({spend.length} mo)</div>
          <div className="kpi-value">
            {totalSpend > 0
              ? `$${totalSpend.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}`
              : '—'}
          </div>
        </div>
      </div>

      {/* ── Charts ──────────────────────────────────────────────── */}
      <AnalyticsCharts
        daily={daily}
        dowCurrent={dowCurrent}
        dowPrior={dowPrior}
        hourlyCurrent={hourlyCurrent}
        hourlyPrior={hourlyPrior}
        spend={spend}
        top={top}
      />
    </div>
  );
}
