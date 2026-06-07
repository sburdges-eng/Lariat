// @ts-check
// /costing/price-shocks — manager-facing view of vendor SKUs that moved
// in price recently, with the dishes they touch.
//
// Server-rendered: no live mutation. The page renders the result of
// listPriceShocks() and joins each shock's ingredient against
// dish_components to surface "this price move affects N dishes". The
// dish join is an exact-match on vendor_ingredient (with fallback to
// recipe-side bom_lines.vendor_ingredient when present) — there's no
// fuzzy matching here because mismatches between catalog spelling and
// dish_components spelling are a real signal that the bridge is
// incomplete and the operator should see the gap.

import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { formatDollars } from '../../../lib/formatMoney';
import { listPriceShocks } from '../../../lib/vendorPricesRepo';
import { affectedDishes, affectedRecipes } from '../../../lib/priceShockImpact';

/** @typedef {import('../../../lib/vendorPricesRepo.ts').PriceShockRow} PriceShockRow */
/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */

export const dynamic = 'force-dynamic';

const WINDOW_OPTIONS = [
  { days: 1, label: '24h' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const MIN_PCT_OPTIONS = [5, 10, 25];

/** @param {number | string | null | undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

/** @param {number} n */
function fmtPrice(n) {
  return formatDollars(n, { decimals: 4 });
}

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
 * @param {unknown} s
 * @param {number} dflt
 * @param {number} min
 * @param {number} max
 */
function clampInt(s, dflt, min, max) {
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * @param {unknown} s
 * @param {number} dflt
 * @param {number} min
 * @param {number} max
 */
function clampNum(s, dflt, min, max) {
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

/**
 * @param {number} baseline
 * @param {number} latest
 */
function trendPoints(baseline, latest) {
  const a = Number(baseline);
  const b = Number(latest);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '4,18 56,18';
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi === lo) return '4,18 56,18';
  /** @param {number} v */
  const y = (v) => 30 - ((v - lo) / (hi - lo)) * 24;
  return `4,${y(a).toFixed(1)} 30,${((y(a) + y(b)) / 2).toFixed(1)} 56,${y(b).toFixed(1)}`;
}

/** @param {{ row: PriceShockRow }} props */
function PriceMoveSparkline({ row }) {
  const tone = row.direction === 'up' ? 'red' : 'green';
  return (
    <svg
      aria-label="Price move trend"
      role="img"
      viewBox="0 0 60 36"
      width="72"
      height="44"
      style={{ display: 'block' }}
    >
      <line x1="4" y1="30" x2="56" y2="30" stroke="var(--line)" strokeWidth="1" />
      <polyline
        fill="none"
        stroke={`var(--${tone === 'red' ? 'red' : 'green'})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
        points={trendPoints(row.baseline_unit_price, row.latest_unit_price)}
      />
    </svg>
  );
}

/** @param {{ searchParams: Promise<PageSearchParams> }} props */
export default async function PriceShocksPage({ searchParams }) {
  // Next 16 app router: searchParams is a Promise. Reading it synchronously
  // yields undefined, so location/days/minPct silently fell back to defaults
  // (default location's data, 14-day / 10% report) regardless of the URL.
  // Defaults match LaRi's `vendor_price_shocks` db_query contract.
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const days = clampInt(sp.days, 14, 1, 90);
  const minPct = clampNum(sp.minPct, 10, 0, 1000);

  const db = getDb();
  const shocks = listPriceShocks(db, {
    location_id: loc,
    windowDays: days,
    minPctMove: minPct,
    limit: 200,
  });

  const ingredients = [...new Set(shocks.map((s) => s.ingredient))];
  const dishes = affectedDishes(db, loc, ingredients);
  const recipes = affectedRecipes(db, loc, ingredients);

  // Whether vendor_prices_history has any rows — we tell the operator
  // when a zero-state is "no movement" vs "no data ingested yet".
  const totalHistory = /** @type {{ c: number }} */ (db
    .prepare(`SELECT COUNT(*) AS c FROM vendor_prices_history WHERE location_id = ?`)
    .get(loc)).c;

  /** @param {{ days?: number, minPct?: number }} [extra] */
  const locQ = (extra = {}) => {
    const params = new URLSearchParams();
    if (loc !== DEFAULT_LOCATION_ID) params.set('location', loc);
    if (extra.days !== undefined) params.set('days', String(extra.days));
    if (extra.minPct !== undefined) params.set('minPct', String(extra.minPct));
    const s = params.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div>
      <h1>Price moves</h1>
      <p className="subtitle">
        Vendor SKUs that changed price in the last {days} day{days === 1 ? '' : 's'}.
        Threshold: {minPct}% move.
      </p>

      <div className="card form-row" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
        <span style={{ opacity: 0.75, marginRight: 8 }}>Window:</span>
        {WINDOW_OPTIONS.map((w) => (
          <Link
            key={w.days}
            href={`/costing/price-shocks${locQ({ days: w.days, minPct })}`}
            className={w.days === days ? 'btn primary' : 'btn'}
            style={{ textDecoration: 'none' }}
          >
            {w.label}
          </Link>
        ))}
      </div>

      <div className="card form-row" style={{ marginBottom: 16, gap: 8, alignItems: 'center' }}>
        <span style={{ opacity: 0.75, marginRight: 8 }}>Threshold:</span>
        {MIN_PCT_OPTIONS.map((p) => (
          <Link
            key={p}
            href={`/costing/price-shocks${locQ({ days, minPct: p })}`}
            className={p === minPct ? 'btn primary' : 'btn'}
            style={{ textDecoration: 'none' }}
          >
            {p}%
          </Link>
        ))}
      </div>

      {shocks.length === 0 ? (
        <div className="empty" role="status">
          {totalHistory === 0
            ? 'No price history yet. Run npm run ingest:costing to capture a snapshot.'
            : 'No vendor price moves above this threshold in the window.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Trend</th>
                <th scope="col">Move</th>
                <th scope="col">Price change</th>
                <th scope="col">Used in</th>
              </tr>
            </thead>
            <tbody>
              {shocks.map((s) => {
                const tone = s.direction === 'up' ? 'red' : 'green';
                const dishHits = dishes.get(s.ingredient) || [];
                const recipeHits = recipes.get(s.ingredient) || [];
                const affectedText = dishHits.length > 0
                  ? `${dishHits.slice(0, 5).join(', ')}${dishHits.length > 5 ? ` and ${dishHits.length - 5} more` : ''}`
                  : recipeHits.length > 0
                    ? `${recipeHits.slice(0, 3).join(', ')}${recipeHits.length > 3 ? ` and ${recipeHits.length - 3} more` : ''}`
                    : 'Not currently used in any costed recipe or dish.';
                return (
                  <tr key={`${s.vendor}|${s.sku}|${s.ingredient}`}>
                    <td>
                      <div className="check-name">
                        <Link
                          href={`/costing/prices/${encodeURIComponent(s.vendor)}/${encodeURIComponent(s.sku)}${locQ()}`}
                        >
                          {s.ingredient}
                        </Link>
                      </div>
                      <div className="meta">
                        {s.vendor} · {s.sku}
                      </div>
                    </td>
                    <td>
                      <PriceMoveSparkline row={s} />
                    </td>
                    <td
                      style={{
                        color: `var(--${tone === 'red' ? 'red' : 'green'})`,
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtPct(s.delta_pct)}
                    </td>
                    <td className="meta">
                      {fmtPrice(s.baseline_unit_price)}{' '}
                      <time dateTime={s.baseline_at}>{fmtDate(s.baseline_at)}</time>
                      {' to '}
                      {fmtPrice(s.latest_unit_price)}{' '}
                      <time dateTime={s.latest_at}>{fmtDate(s.latest_at)}</time>
                    </td>
                    <td className="meta">{affectedText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
