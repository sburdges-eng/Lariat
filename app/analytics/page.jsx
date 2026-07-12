// @ts-check
import { getDb } from '../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { formatDollars } from '../../lib/formatMoney';
import AnalyticsCharts from './AnalyticsCharts';

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

/**
 * Columns selected for the daily-revenue-trend chart — a deliberate
 * subset of `toast_sales_daily` (not `SELECT *`).
 * @typedef {Pick<
 *   import('../../lib/db.ts').ToastSalesDailyRow,
 *   'shift_date' | 'net_sales' | 'orders' | 'guests'
 * >} DailyRow
 */

/**
 * Columns selected for the day-of-week comparison chart — a subset of
 * `toast_sales_dow`.
 * @typedef {Pick<
 *   import('../../lib/db.ts').ToastSalesDowRow,
 *   'day_of_week' | 'net_sales' | 'orders' | 'guests'
 * >} DowRow
 */

/**
 * Columns selected for the hourly revenue curve — a subset of
 * `toast_sales_hour`.
 * @typedef {Pick<
 *   import('../../lib/db.ts').ToastSalesHourRow,
 *   'hour_24' | 'label' | 'net_sales' | 'orders' | 'guests'
 * >} HourRow
 */

/**
 * Columns selected for the monthly Shamrock spend chart — a subset of
 * `spend_monthly`.
 * @typedef {Pick<
 *   import('../../lib/db.ts').SpendMonthly,
 *   'month' | 'shamrock_total_spend'
 * >} SpendRow
 */

/**
 * Aggregated top-seller row — `SUM(quantity_sold)` / `SUM(net_sales)`
 * grouped by `item_name` from `sales_lines`. Not a raw table row, so it
 * does not map onto a `lib/db.ts` interface.
 * @typedef {{ item_name: string, qty: number | null, rev: number | null }} TopItemRow
 */

export const dynamic = 'force-dynamic';

/**
 * Bug fix (GH #250 checkjs migration): this page previously took no props
 * at all and hardcoded `loc = DEFAULT_LOCATION_ID`, ignoring the URL. Every
 * sibling tile on /command builds its href as `` `/analytics${locQ}` ``
 * (same for /eighty-six, /inventory/par, /costing/price-shocks, /prep,
 * /labor, /food-safety, /beo, /reservations — see app/command/page.jsx),
 * where `locQ` is `?location=<id>` for a non-default location. Every one
 * of those sibling pages reads `searchParams.location` and scopes its
 * queries to it; this page silently discarded it and always rendered the
 * DEFAULT location's sales numbers — a manager at a non-default location
 * clicking the Sales tile would see another location's revenue data. Now
 * reads and honors `?location=` like the rest of the /command tile targets.
 * @param {{ searchParams?: Promise<PageSearchParams> | PageSearchParams }} props
 */
export default async function AnalyticsPage({ searchParams } = {}) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const db = getDb();

  /* ── Daily revenue trend (comparison_group 1 = current period) ── */
  const daily = /** @type {DailyRow[]} */ (
    db
      .prepare(
        `SELECT shift_date, net_sales, orders, guests
           FROM toast_sales_daily
          WHERE location_id = ? AND comparison_group = 1
          ORDER BY shift_date`,
      )
      .all(loc)
  );

  /* ── Day-of-week comparison ─────────────────────────────────────── */
  const dowCurrent = /** @type {DowRow[]} */ (
    db
      .prepare(
        `SELECT day_of_week, net_sales, orders, guests
           FROM toast_sales_dow
          WHERE location_id = ? AND comparison_group = 1`,
      )
      .all(loc)
  );
  const dowPrior = /** @type {DowRow[]} */ (
    db
      .prepare(
        `SELECT day_of_week, net_sales, orders, guests
           FROM toast_sales_dow
          WHERE location_id = ? AND comparison_group = 2`,
      )
      .all(loc)
  );

  /* ── Hourly revenue curve ───────────────────────────────────────── */
  const hourlyCurrent = /** @type {HourRow[]} */ (
    db
      .prepare(
        `SELECT hour_24, label, net_sales, orders, guests
           FROM toast_sales_hour
          WHERE location_id = ? AND comparison_group = 1
          ORDER BY hour_24`,
      )
      .all(loc)
  );
  const hourlyPrior = /** @type {HourRow[]} */ (
    db
      .prepare(
        `SELECT hour_24, label, net_sales, orders, guests
           FROM toast_sales_hour
          WHERE location_id = ? AND comparison_group = 2
          ORDER BY hour_24`,
      )
      .all(loc)
  );

  /* ── Monthly Shamrock spend ─────────────────────────────────────── */
  const spend = /** @type {SpendRow[]} */ (
    db
      .prepare(
        `SELECT month, shamrock_total_spend
           FROM spend_monthly
          WHERE location_id = ?
          ORDER BY month`,
      )
      .all(loc)
  );

  /* ── Top selling items ──────────────────────────────────────────── */
  const top = /** @type {TopItemRow[]} */ (
    db
      .prepare(
        `SELECT item_name, SUM(quantity_sold) as qty, SUM(net_sales) as rev
           FROM sales_lines
          WHERE location_id = ?
          GROUP BY item_name
          ORDER BY rev DESC
          LIMIT 20`,
      )
      .all(loc)
  );

  /* ── Derived KPIs ───────────────────────────────────────────────── */
  const dailyCurrentTotal = daily.reduce((s, r) => s + (r.net_sales || 0), 0);
  const dailyPrior = /** @type {{ rev: number | null } | undefined} */ (
    db
      .prepare(
        `SELECT SUM(net_sales) as rev
           FROM toast_sales_daily
          WHERE location_id = ? AND comparison_group = 2`,
      )
      .get(loc)
  );
  const priorRev = dailyPrior?.rev || 0;
  const yoyDelta =
    priorRev > 0 ? ((dailyCurrentTotal - priorRev) / priorRev) * 100 : null;

  const dateRange = /** @type {{ date_range: string | null } | undefined} */ (
    db
      .prepare(
        `SELECT date_range FROM toast_sales_daily
          WHERE location_id = ? AND comparison_group = 1 LIMIT 1`,
      )
      .get(loc)
  );
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
        Toast sales and Shamrock spend. Pull fresh numbers after the weekly update.
      </p>

      {/* ── KPI ribbon ──────────────────────────────────────────── */}
      <div className="grid grid-stations" style={{ marginBottom: 32 }}>
        <div className="card">
          <div className="kpi-label">Current period revenue</div>
          <div className="kpi-value">
            {dailyCurrentTotal > 0
              ? formatDollars(dailyCurrentTotal, { decimals: 0 })
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
              ? formatDollars(avgCheck)
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
              ? formatDollars(totalSpend, { decimals: 0 })
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
